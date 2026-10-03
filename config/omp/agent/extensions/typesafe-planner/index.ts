// TypeSafe Planner Integration Extension for OMP
// Connects OMP planning workflows with TypeSafe System One judgments (Choice, Noul, Score).

import { createRequire } from "node:module";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { evaluatePlanDraft, type PlanJudgeClient, type PlanQuestion } from "./src/plan-evaluator";
import { verifyTaskCompletion, type GateJudgeClient, type GateQuestion } from "./src/verification-gate";
import { collectTaskEvidence } from "./src/evidence-collector";
import {
  runTaskMicroCheck,
  runPhaseMacroCheck,
  evaluateScopeArbiter,
  evaluateDriftGuard,
  evaluateRiskSecurityTriage,
  generateVerificationScorecard,
  type ExpertJudgeClient,
  type ExpertJudgeQuestion,
  type ExpertJudgeResponse,
  type DriftChoice,
  type ScopeChoice,
} from "./src/cook-expert-judge";
interface ExtensionToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
}

interface ToolDefinition<TParams> {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: (result: ExtensionToolResult) => void,
    ctx?: unknown
  ) => Promise<ExtensionToolResult>;
}

interface ExtensionAPI {
  zod: {
    object: (shape: Record<string, unknown>) => unknown;
    union: (options: unknown[]) => unknown;
    string: () => { optional: () => unknown; min?: (n: number) => unknown; [key: string]: unknown };
    number: () => { optional: () => unknown; [key: string]: unknown };
    record: (valueType: unknown) => unknown;
    enum: (values: string[]) => unknown;
    unknown: () => unknown;
    array: (itemType: unknown) => { min: (n: number) => unknown; [key: string]: unknown };
  };
  on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) => void;
  registerTool: <T>(definition: ToolDefinition<T>) => void;
  sendMessage: (
    message: string | { customType?: string; content: string; display?: boolean },
    options?: { deliverAs?: "steer" | "followUp" | "nextTurn" | "aside"; triggerTurn?: boolean }
  ) => Promise<void>;
}

interface TypeSafeQuestion {
  type: "noul" | "choice" | "score";
  instructions: string | Record<string, unknown>;
  criteria?: unknown;
}

interface TypeSafeJudgeParams {
  state: string | Record<string, unknown>;
  questions: Record<string, TypeSafeQuestion>;
}

// ---------------------------------------------------------------------------
// Shared kit modules (DRY / guaranteed parity).
//
// The OMP extension loads the SAME CommonJS modules the Claude Code MCP
// server and hooks use, by absolute path under the installed kit
// (~/.claude/hooks/lib/... and ~/.claude/mcp/typesafe/...), instead of
// porting/duplicating the resolver or redaction logic. This guarantees the
// three call sites (session-init hook, MCP server, OMP extension) can never
// silently drift apart on "is TypeSafe on for this project" or "what gets
// redacted before it leaves the machine".
//
// createRequire(import.meta.url) gives a require() bound to this file that
// still resolves absolute paths exactly like a normal CJS require — Node's
// module loader treats an absolute path the same way regardless of which
// require() instance you call it through, so this works whether this file
// itself runs under Bun or under Node with TypeScript type-stripping (both
// support ESM `import` + `createRequire`, and both can `require()` a plain
// `.cjs` file by absolute path). If the kit isn't installed, the shared
// module was renamed, or anything else fails to load, every load* function
// below returns null and the caller treats TypeSafe as disabled — never
// throws, never crashes the OMP process.
const nodeRequire = createRequire(import.meta.url);

interface EnabledResolverModule {
  resolveTypeSafeEnabled: (
    projectDir: string,
    opts?: { env?: Record<string, string | undefined>; homeDir?: string }
  ) => { enabled: boolean; reason: string };
}

interface RedactModule {
  /** Throws an Error with message exactly "payload rejected: secret in key"
   * when a round-trip-critical key (question name, or a `choice` question's
   * DICT-shaped option identifier) contains a detected secret — caller must
   * never build/send a request in that case, only report the rejection. */
  preparePayload: (payload: unknown, opts?: { maxBytes?: number; apiKey?: string }) => unknown;
}

interface ApiClientModule {
  /** Validates raw tool-call arguments against the canonical request shape
   * (Section 3 of the shared contract) BEFORE any redaction/network call —
   * shared with the MCP server (L1: OMP previously skipped this, so the two
   * call sites could accept/reject different malformed inputs). Returns
   * `{ ok: true }` or `{ ok: false, message }`. */
  validateInput: (args: unknown) => { ok: boolean; message?: string };
  /** Parses+validates upstream `answers` down to only the allow-listed
   * numeric/enum fields per question type (Section 4 of the shared
   * contract) — returns `null` if any key is missing/malformed/out of
   * range/not a sent option. Shared with the MCP server so both call sites
   * enforce identical rules (confidence required in [0,1], score finite
   * number in [0, criteria.length-1], noul in [0,1]). */
  sanitizeAnswers: (
    questions: Record<string, TypeSafeQuestion>,
    rawAnswers: unknown
  ) => Record<string, unknown> | null;
}

/** Load the shared enabled-resolver by absolute path; null on any failure. */
function loadResolverModule(): EnabledResolverModule | null {
  try {
    const modulePath = path.join(
      os.homedir(),
      ".claude",
      "hooks",
      "lib",
      "typesafe-enabled-resolver.cjs"
    );
    return nodeRequire(modulePath) as EnabledResolverModule;
  } catch {
    return null;
  }
}

/** Load the shared egress-redaction module by absolute path; null on any failure. */
function loadRedactModule(): RedactModule | null {
  try {
    const modulePath = path.join(
      os.homedir(),
      ".claude",
      "mcp",
      "typesafe",
      "typesafe-redact.cjs"
    );
    return nodeRequire(modulePath) as RedactModule;
  } catch {
    return null;
  }
}

/** Load the shared response-sanitization module (the same one the MCP
 * server uses) by absolute path; null on any failure — same fail-closed
 * contract as the other loaders (kit not installed / renamed -> disabled,
 * never a fallback to locally-duplicated rules that could drift). */
function loadApiClientModule(): ApiClientModule | null {
  try {
    const modulePath = path.join(
      os.homedir(),
      ".claude",
      "mcp",
      "typesafe",
      "typesafe-api-client.cjs"
    );
    const mod = nodeRequire(modulePath) as ApiClientModule;
    // Guard against a malformed/mismatched module version silently letting
    // fetch() fire and then surfacing a TypeError as a misleading
    // "network_error" — verify the exported shape, not just that require()
    // didn't throw.
    if (!mod || typeof mod.sanitizeAnswers !== "function" || typeof mod.validateInput !== "function") return null;
    return mod;
  } catch {
    return null;
  }
}

interface PolicyClientModule {
  checkPolicy(
    baseline: string,
    choice: string,
    lattice: string[]
  ): { ok: boolean; reason?: string; attempted?: string; baseline?: string; choice?: string };
}

/** Load the shared policy client module by absolute path.
 * Unlike the other modules, this enforces strict module loading (fail-closed).
 * If it fails to load, it throws a hard error to halt execution immediately,
 * preventing a silent fallback to an insecure state.
 */
function loadPolicyClientModule(): PolicyClientModule {
  try {
    const modulePath = path.join(
      os.homedir(),
      ".claude",
      "mcp",
      "typesafe",
      "typesafe-policy-client.cjs"
    );
    const mod = nodeRequire(modulePath) as PolicyClientModule;
    if (!mod || typeof mod.checkPolicy !== "function") {
      throw new Error("Missing checkPolicy export");
    }
    return mod;
  } catch (err) {
    throw new Error(`Failed to load typesafe-policy-client.cjs: ${err}`);
  }
}

const HOST_POLICY = {
  baseline: process.env.TYPESAFE_BASELINE || "review",
  lattice: process.env.TYPESAFE_LATTICE ? process.env.TYPESAFE_LATTICE.split(",") : ["auto", "review", "block"]
};

/**
 * Best-effort project directory for the resolver: OMP's per-call ctx.cwd
 * when the host exposes it (ctx's real shape isn't part of the documented
 * ExtensionAPI, so this is read defensively), else process.cwd().
 */
function getProjectDir(ctx: unknown): string {
  if (ctx && typeof ctx === "object") {
    const cwd = (ctx as Record<string, unknown>).cwd;
    if (typeof cwd === "string" && cwd.trim()) return cwd;
  }
  return process.cwd();
}

const MAX_BODY_BYTES = 32768;

const DISABLED_RESULT: ExtensionToolResult = {
  content: [{ type: "text", text: "TypeSafe disabled" }],
};
const PROTECTED_INTEGRITY_PATTERNS = [
  "typesafe-planner.ts",
  "models.yml",
  "typesafe-policy-client.cjs",
  "typesafe-redact.cjs",
  "typesafe-enabled-resolver.cjs",
];
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}



/** Short, non-descriptive error code only — never forward upstream error
 * bodies, raw JSON, or exception messages to the model (contract Section 4). */
function shortError(code: string): ExtensionToolResult {
  return { content: [{ type: "text", text: `TypeSafe error: ${code}` }] };
}
function summarizeUnifiedDiff(diff: string, maxChars = 4000): string {
  if (diff.length <= maxChars) return diff;

  const lines = diff.split("\n");
  const preservedLines: string[] = [];
  let skippedCount = 0;
  for (const line of lines) {
    const isFileHeader = line.startsWith("diff --git") || line.startsWith("--- ") || line.startsWith("+++ ");
    const isHunkHeader = line.startsWith("@@ ");
    const isAssertion = /(?:expect\(|assert\(|assert\.[a-zA-Z]+\(|describe\(|test\()/.test(line);
    const isSignature = /(?:function\s+|class\s+|export\s+|interface\s+|type\s+|const\s+[a-zA-Z0-9_]+\s*=\s*(?:async\s*)?\()/.test(line);

    if (isFileHeader || isHunkHeader || isAssertion || isSignature) {
      if (skippedCount > 0) {
        preservedLines.push(`[... ${skippedCount} lines truncated ...]`);
        skippedCount = 0;
      }
      preservedLines.push(line);
    } else {
      skippedCount++;
    }
  }
  if (skippedCount > 0) {
    preservedLines.push(`[... ${skippedCount} lines truncated ...]`);
  }
  let result = preservedLines.join("\n");
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 40) + "\n[... diff truncated ...]";
  }
  return result;
}

function sanitizeStateForTypeSafe(state: string | Record<string, unknown>): Record<string, unknown> | string {
  let resolved: Record<string, unknown> | string = state;

  if (typeof state === "string") {
    const trimmed = state.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          resolved = parsed as Record<string, unknown>;
        }
      } catch {
        // Retain original string if invalid JSON
      }
    }
  }

  if (typeof resolved === "object" && resolved !== null) {
    const obj: Record<string, unknown> = { ...resolved };
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === "string") {
        if (key === "unified_diff" || key === "gitDiff" || key === "diff") {
          obj[key] = summarizeUnifiedDiff(val, 4000);
        } else if (val.length > 2000) {
          obj[key] = val.slice(0, 1950) + "... [truncated]";
        }
      }
    }

    const serialized = JSON.stringify(obj);
    if (serialized.length > 8000) {
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === "string" && val.length > 1000) {
          obj[key] = val.slice(0, 950) + "... [truncated]";
        }
      }
    }
    return obj;
  }

  if (typeof resolved === "string") {
    if (resolved.startsWith("diff --git") || resolved.includes("\n--- a/") || resolved.includes("\n+++ b/")) {
      return summarizeUnifiedDiff(resolved, 4000);
    }
    if (resolved.length > 8000) {
      return resolved.slice(0, 7950) + "... [truncated]";
    }
  }

  return resolved;
}


export default function (pi: ExtensionAPI): void {
  const z = pi.zod;

  // Dynamic Auth Watchdog: tracks auth failure per key hash, allowing dynamic
  // self-healing when environment updates with a valid key without restart.
  let lastFailedKeyHash: string | null = null;
  let lastAlertedKeyHash: string | null = null;
  const PROMPT_INJECTION =
    "TypeSafe System One is integrated into the host for all human handoffs and task completions. When you call the 'ask' tool to present decisions to the user, TypeSafe automatically evaluates your proposal and attaches a risk/clarity verdict directly to what the human sees (high risk increases human oversight, never blocks it). When you mark a task complete via 'todo done', the completion is strictly hard-gated: Gate 1 verifies tests locally, and Gate 2 runs a TypeSafe Macro-Check that actively rejects completion if requirements are dropped or architectural drift occurs. Tighten-only policies are enforced structurally. If you encounter auth or configuration errors, you MUST inform the user.";
  // Session Pre-Flight Health Probe (Phase 3): event-driven diagnostic probe on session_start.
  pi.on("session_start", async (_event: unknown, ctx: unknown) => {
    try {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return;

      const resolverModule = loadResolverModule();
      if (!resolverModule) return;

      const projectDir = getProjectDir(ctx);
      const { enabled } = resolverModule.resolveTypeSafeEnabled(projectDir);
      if (!enabled) return;

      // Minimal probe payload (<200 bytes) with 3000ms abort deadline
      try {
        const probeSignal = AbortSignal.timeout(3000);
        const probePayload = JSON.stringify({
          state: "ping",
          questions: { ping: { type: "noul", instructions: "ping" } },
          model: "jev-latest",
        });

        const probeRes = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: probePayload,
          signal: probeSignal,
        });

        if (probeRes.status === 401 || probeRes.status === 403) {
          lastFailedKeyHash = hashToken(apiKey);
          await pi.sendMessage(
            {
              customType: "typesafe-health",
              content: "TypeSafe warning: TYPESAFE_API_KEY is invalid or expired. Check your environment configuration.",
              display: true,
            },
            { deliverAs: "nextTurn" }
          );
          return;
        }

        if (probeRes.status === 404) {
          await pi.sendMessage(
            {
              customType: "typesafe-health",
              content: "TypeSafe warning: TypeSafe endpoint returned 404 Not Found. Verify models.yml baseUrl does not have an extraneous '/v1' suffix.",
              display: true,
            },
            { deliverAs: "nextTurn" }
          );
          return;
        }

        if (probeRes.ok) {
          await pi.sendMessage(
            {
              customType: "typesafe-health",
              content: "TypeSafe: ONLINE (jev-latest)",
              display: true,
            },
            { deliverAs: "nextTurn" }
          );
          await pi.sendMessage(
            { customType: "typesafe-planner", content: PROMPT_INJECTION, display: false },
            { deliverAs: "nextTurn" }
          );
          return;
        }

        await pi.sendMessage(
          {
            customType: "typesafe-health",
            content: `TypeSafe warning: Pre-flight probe failed with HTTP status ${probeRes.status}.`,
            display: true,
          },
          { deliverAs: "nextTurn" }
        );
      } catch {
        await pi.sendMessage(
          {
            customType: "typesafe-health",
            content: "TypeSafe warning: TypeSafe API unreachable. Check internet connection or proxy settings.",
            display: true,
          },
          { deliverAs: "nextTurn" }
        );
      }
    } catch {
      // Non-critical notification failure — the tool is registered
      // regardless and will report "TypeSafe disabled" if actually called.
    }
  });
  const handledToolCallIds = new Set<string>();
  async function handleTodoInterception(event: unknown, ctx: unknown): Promise<void> {
    if (!event || typeof event !== "object") return;
    const evt = event as Record<string, unknown>;
    const callId = (evt.toolCallId || evt.id || evt.callId) as string | undefined;
    if (callId) {
      if (handledToolCallIds.has(callId)) return;
      handledToolCallIds.add(callId);
      if (handledToolCallIds.size > 500) {
        const first = handledToolCallIds.values().next().value;
        if (first) handledToolCallIds.delete(first);
      }
    }
    const toolName = (evt.tool || evt.name || evt.toolName) as string | undefined;
    // Direct File Bypass Defense (RT-3) & Resource Integrity Shield (Phase 1)
    if (toolName === "write" || toolName === "edit") {
      const params = (evt.params || evt.args || evt.input || {}) as Record<string, unknown>;
      const targetPath = ((params.path as string) || (params.filepath as string) || "").trim();
      const normalizedPath = targetPath.replace(/\\/g, "/");
      const baseName = normalizedPath.split("/").pop() || "";

      if (baseName === "todo.json" || baseName.startsWith(".todo")) {
        const msg = "Direct file modification of todo.json is prohibited. Task state must be managed via the todo tool.";
        if (typeof evt.cancel === "function") {
          (evt.cancel as (r: string) => void)(msg);
        }
        await pi.sendMessage({
          customType: "typesafe-compliance-escalation",
          content: msg,
        });
        throw new Error(msg);
      }

      const isProtected = PROTECTED_INTEGRITY_PATTERNS.some((pattern) => {
        const patLower = pattern.toLowerCase();
        if (baseName.toLowerCase() === patLower) return true;
        if (normalizedPath.toLowerCase().endsWith("/" + patLower)) return true;
        try {
          const resolved = path.resolve(getProjectDir(ctx), targetPath).replace(/\\/g, "/");
          return resolved.toLowerCase().endsWith("/" + patLower) || resolved.toLowerCase() === patLower;
        } catch {
          return targetPath.toLowerCase().includes(patLower);
        }
      });

      if (isProtected) {
        if (params.allowJudgeModification === true) {
          return;
        }
        const msg = `Direct file modification of protected TypeSafe infrastructure (${baseName || targetPath}) is prohibited without explicit authorization (allowJudgeModification: true).`;
        if (typeof evt.cancel === "function") {
          (evt.cancel as (r: string) => void)(msg);
        }
        await pi.sendMessage({
          customType: "typesafe-integrity-violation",
          content: msg,
        });
        throw new Error(msg);
      }
      return;
    }

    // Human Decision Interception: Automatically evaluate any decision/question before it reaches the human
    if (toolName === "ask") {
      const params = (evt.params || evt.args || evt.input || {}) as Record<string, unknown>;
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      const resolverModule = loadResolverModule();
      const projectDir = getProjectDir(ctx);
      const isEnabled = apiKey && resolverModule && resolverModule.resolveTypeSafeEnabled(projectDir).enabled;

      if (!isEnabled || !apiKey) {
        const note = "\n\n⚠️ [TypeSafe System One: Evaluation offline / not configured]";
        if (Array.isArray(params.questions) && params.questions[0] && typeof params.questions[0] === "object") {
          const q = params.questions[0] as Record<string, unknown>;
          if (typeof q.question === "string") q.question += note;
        } else if (typeof params.question === "string") {
          params.question += note;
        }
        return;
      }

      try {
        const client = createExtensionJudgeClient(apiKey, undefined, ctx);
        const questionsPayload = params.questions || params.question || params;
        const state = JSON.stringify({
          intent: params.i || "Decision presented to human",
          questions: questionsPayload,
          projectDir,
        });

        const questions: Record<string, ExpertJudgeQuestion> = {
          risk_posture: {
            type: "score",
            instructions: "Rate the technical risk and security implications of this proposal or question being presented to the human:",
            criteria: [
              "Zero Risk — routine inquiry, safe tradeoffs, fully bounded options",
              "Low Risk — minor architectural choice with manageable side effects",
              "Moderate Risk — tradeoffs involving data, architecture, or credentials requiring human scrutiny",
              "Critical Risk — dangerous action, security sensitive choice, or potential data loss",
            ],
          },
          decision_clarity: {
            type: "noul",
            instructions: "Does this question present clear, actionable, mutually distinct choices to the human without misleading information?",
            criteria: {
              true: "Choices are distinct, well-explained, and technically clear",
              false: "Choices are vague, incomplete, misleading, or poorly formed",
            },
          },
        };

        const response = await client.evaluate({ state, questions });
        if (response.error || !response.answers) {
          const note = `\n\n⚠️ [TypeSafe System One: Evaluation unavailable (${response.error || "no response"})]`;
          if (Array.isArray(params.questions) && params.questions[0] && typeof params.questions[0] === "object") {
            const q = params.questions[0] as Record<string, unknown>;
            if (typeof q.question === "string") q.question += note;
          } else if (typeof params.question === "string") {
            params.question += note;
          }
          return;
        }

        const riskScore = response.answers.risk_posture?.score;
        const clarity = response.answers.decision_clarity?.noul;
        if (riskScore === undefined || clarity === undefined) {
          const note = "\n\n⚠️ [TypeSafe System One: Incomplete evaluation - proceeding with human review]";
          if (Array.isArray(params.questions) && params.questions[0] && typeof params.questions[0] === "object") {
            const q = params.questions[0] as Record<string, unknown>;
            if (typeof q.question === "string") q.question += note;
          } else if (typeof params.question === "string") {
            params.question += note;
          }
          return;
        }

        const riskLabel = riskScore <= 1.0 ? "Low" : riskScore <= 2.0 ? "Moderate" : "High/Critical";
        const annotation = `\n\n🛡️ [TypeSafe System One Verdict]: Risk: ${riskLabel} (${riskScore.toFixed(1)}/3) | Decision Clarity: ${Math.round(clarity * 100)}%`;

        if (Array.isArray(params.questions)) {
          for (const q of params.questions) {
            if (q && typeof q === "object") {
              const qObj = q as Record<string, unknown>;
              if (typeof qObj.question === "string") {
                qObj.question += annotation;
              }
              if (typeof qObj.header === "string") {
                qObj.header = `[${riskLabel} Risk] ${qObj.header}`;
              }
            }
          }
        } else if (typeof params.question === "string") {
          params.question += annotation;
        }

        await pi.sendMessage({
          customType: "typesafe-human-verdict",
          content: `TypeSafe System One evaluated human handoff:\n- Risk: ${riskLabel} (${riskScore.toFixed(1)}/3)\n- Clarity: ${Math.round(clarity * 100)}%`,
          display: true,
        });
      } catch {
        const note = "\n\n⚠️ [TypeSafe System One: Evaluation failed - proceeding with human review]";
        if (Array.isArray(params.questions) && params.questions[0] && typeof params.questions[0] === "object") {
          const q = params.questions[0] as Record<string, unknown>;
          if (typeof q.question === "string") q.question += note;
        } else if (typeof params.question === "string") {
          params.question += note;
        }
      }
      return;
    }

    if (toolName !== "todo") return;

    const params = (evt.params || evt.args || evt.input || {}) as Record<string, unknown>;
    const op = params.op as string | undefined;
    if (op !== "done" && op !== "rm") return;

    const apiKey = process.env.TYPESAFE_API_KEY?.trim();
    const resolverModule = loadResolverModule();
    const projectDir = getProjectDir(ctx);
    const isEnabled = apiKey && resolverModule && resolverModule.resolveTypeSafeEnabled(projectDir).enabled;

    const taskId = (params.task as string) || (params.taskId as string) || "task";
    const planPath = (params.planPath as string) || (params.plan as string);
    const testCommand = (params.testCommand as string) || process.env.TYPESAFE_TEST_COMMAND;

    if (!isEnabled) {
      const msg = "TypeSafe verification gate blocked task completion: TypeSafe is not enabled or TYPESAFE_API_KEY is missing. Manual user review required.";
      if (typeof evt.cancel === "function") {
        (evt.cancel as (r: string) => void)(msg);
      }
      await pi.sendMessage({
        customType: "typesafe-compliance-escalation",
        content: msg,
      });
      throw new Error(msg);
    }

    const evidence = await collectTaskEvidence({
      cwd: projectDir,
      taskId,
      planPath,
      testCommand,
    });

    const microResult = await runTaskMicroCheck(evidence);
    if (!microResult.passed) {
      const msg = `Task completion rejected by TypeSafe Dual Verification Gate (Gate 1 Micro-Check):\n- ${microResult.reasons.join("\n- ")}`;
      if (typeof evt.cancel === "function") {
        (evt.cancel as (r: string) => void)(msg);
      }
      await pi.sendMessage({
        customType: "typesafe-compliance",
        content: msg,
      });
      throw new Error(msg);
    }

    // Gate 2: Semantic macro-check against TypeSafe System One runs for ALL task completions
    const client = createExtensionJudgeClient(apiKey, undefined, ctx);
    const macroResult = await runPhaseMacroCheck(
      {
        phaseTitle: taskId,
        planRequirements: evidence.criteria.length > 0 ? evidence.criteria : [taskId],
        diffSummary: evidence.gitStatus || "No unstaged changes",
        unifiedDiff: evidence.gitDiff || "+ // No diff",
        testSummary: evidence.testOutput || "Tests passed",
      },
      client
    );
    if (!macroResult.approved) {
      const msg = `Task completion rejected by TypeSafe Dual Verification Gate (Gate 2 Macro-Check):\n- ${macroResult.reasons.join("\n- ")}`;
      if (typeof evt.cancel === "function") {
        (evt.cancel as (r: string) => void)(msg);
      }
      await pi.sendMessage({
        customType: macroResult.escalateToUser
          ? "typesafe-compliance-escalation"
          : "typesafe-compliance",
        content: msg,
      });
      throw new Error(msg);
    }
  }

  pi.on("tool_call", handleTodoInterception);
  pi.on("before_tool_call", handleTodoInterception);

  // Tool is registered UNCONDITIONALLY. Availability (API key, shared kit
  // modules, project opt-in) is re-checked on every call rather than once at
  // extension load. A key set BEFORE OMP starts (so this process's
  // `process.env` already has it — env vars set in a shell afterward never
  // reach an already-running process) now works without needing the old
  // early-return-at-load-time removed below to also be worked around by a
  // restart. A project opting in via .claude/.ck.json DOES take effect
  // without an OMP restart (the resolver reads that file from disk on every
  // call — no caching involved there). Installing the kit for the FIRST
  // time (a module that was previously missing, so require() had been
  // throwing) also takes effect immediately, since Node never caches a
  // FAILED require().
  //
  // L8 (corrected — this comment previously claimed the opposite): a
  // SUCCESSFUL require() of a given absolute path IS cached by Node's
  // module system for the lifetime of this process (`nodeRequire`'s cache
  // is the ordinary CJS require cache — createRequire() doesn't get its own
  // isolated one). So once loadResolverModule()/loadRedactModule()/
  // loadApiClientModule() have successfully loaded a module, a later KIT
  // UPDATE that changes that same file's on-disk content is NOT picked up
  // by this already-running OMP process — the stale in-memory version keeps
  // being used until OMP itself is restarted.
  async function executeTypeSafe(
    params: TypeSafeJudgeParams,
    apiKey: string,
    signal?: AbortSignal,
    ctx?: unknown
  ): Promise<ExtensionToolResult> {
    const currentKeyHash = hashToken(apiKey);
    if (lastFailedKeyHash !== null && currentKeyHash === lastFailedKeyHash) {
      return DISABLED_RESULT;
    }
    const resolverModule = loadResolverModule();
    if (!resolverModule) return DISABLED_RESULT;

    const projectDir = getProjectDir(ctx);
    const { enabled } = resolverModule.resolveTypeSafeEnabled(projectDir);
    if (!enabled) return DISABLED_RESULT;

    const apiClientModule = loadApiClientModule();
    if (!apiClientModule) return DISABLED_RESULT;

    const policyClientModule = loadPolicyClientModule();

    const sanitizedState = sanitizeStateForTypeSafe(params.state);
    const validParams = {
      state: sanitizedState,
      questions: params.questions,
    };

    const validation = apiClientModule.validateInput(validParams);
    if (!validation.ok) {
      return { content: [{ type: "text", text: validation.message ?? "invalid_input" }] };
    }

    const redactModule = loadRedactModule();
    if (!redactModule) return DISABLED_RESULT;

    const outgoing = { state: validParams.state, questions: validParams.questions, model: "jev-latest" };
    let prepared: typeof outgoing;
    try {
      prepared = redactModule.preparePayload(outgoing, { maxBytes: MAX_BODY_BYTES, apiKey }) as typeof outgoing;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "payload rejected: secret in key") {
        return { content: [{ type: "text", text: "payload rejected: secret in key" }] };
      }
      return shortError("redact_failed");
    }

    const bodyStr = JSON.stringify(prepared);
    if (Buffer.byteLength(bodyStr, "utf8") > MAX_BODY_BYTES) {
      return shortError("payload_too_large");
    }

    try {
      const fetchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000);

      let res = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: bodyStr,
        signal: fetchSignal,
      });
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        const delay = 50 + Math.floor(Math.random() * 100);
        await sleep(delay);
        res = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: bodyStr,
          signal: fetchSignal,
        });
      }

      if (res.status === 401 || res.status === 403) {
        lastFailedKeyHash = currentKeyHash;
        if (lastAlertedKeyHash !== currentKeyHash) {
          lastAlertedKeyHash = currentKeyHash;
          await pi.sendMessage({
            customType: "typesafe-auth-recovery",
            content: "TypeSafe authentication failed (HTTP 401/403). TYPESAFE_API_KEY is invalid or revoked. Update the key in your environment to automatically restore service.",
            display: true,
          }).catch(() => {});
        }
        return shortError("unauthorized");
      }

      if (lastFailedKeyHash === currentKeyHash) {
        lastFailedKeyHash = null;
      }
      if (!res.ok) {
        return shortError(`http_${res.status}`);
      }

      const data: unknown = await res.json().catch(() => null);
      if (!data || typeof data !== "object" || !("answers" in data)) {
        return shortError("bad_response");
      }
      
      let rawAnswers: unknown;
      if ("answers" in data) {
        rawAnswers = data.answers;
      }

      const answers = apiClientModule.sanitizeAnswers(prepared.questions, rawAnswers);
      if (!answers) return shortError("bad_response");

      for (const key of Object.keys(answers)) {
        // Validate against `prepared.questions` (the post-redaction,
        // post-cap version actually SENT), not `params.questions` — a
        // `choice` option that was redacted/capped before sending is judged
        // by the upstream API against what it actually received.
        const q = prepared.questions[key];
        if (q && q.type === "choice") {
          const ans = answers[key];
          if (ans && typeof ans === "object" && "choice" in ans && typeof ans.choice === "string") {
            const criteriaKeys = q.criteria && typeof q.criteria === "object" ? Object.keys(q.criteria) : [];
            const isLatticeQuestion = criteriaKeys.some((opt) => HOST_POLICY.lattice.includes(opt));
            if (isLatticeQuestion || HOST_POLICY.lattice.includes(ans.choice)) {
              const result = policyClientModule.checkPolicy(HOST_POLICY.baseline, ans.choice, HOST_POLICY.lattice);
              if (!result.ok) {
                return { content: [{ type: "text", text: `lattice-violation: ${result.reason}` }] };
              }
            }
          }
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ answers }) }],
        details: { answers },
      };
    } catch (err: unknown) {
      const isAbort =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      return shortError(isAbort ? "timeout" : "network_error");
    }
  }
  function createExtensionJudgeClient(
    apiKey: string,
    signal?: AbortSignal,
    ctx?: unknown
  ): ExpertJudgeClient & PlanJudgeClient & GateJudgeClient {
    return {
      async evaluate(params: {
        state: string;
        questions: Record<string, ExpertJudgeQuestion>;
      }): Promise<ExpertJudgeResponse> {
        const res = await executeTypeSafe(
          {
            state: params.state,
            questions: params.questions as Record<string, TypeSafeQuestion>,
          },
          apiKey,
          signal,
          ctx
        );

        if (res.details && typeof res.details === "object" && "answers" in res.details) {
          const rawAnswers = res.details.answers;
          return { answers: rawAnswers as ExpertJudgeResponse["answers"] };
        }

        try {
          const text = res.content?.[0]?.text;
          if (text && text.startsWith("{")) {
            const parsed = JSON.parse(text) as { answers?: ExpertJudgeResponse["answers"] };
            if (parsed && typeof parsed === "object" && parsed.answers) {
              return { answers: parsed.answers };
            }
          }
          return { error: text || "TypeSafe evaluation failed" };
        } catch {
          return { error: res.content?.[0]?.text || "TypeSafe evaluation failed" };
        }
      },

      async evaluatePlan(params: {
        state: string;
        questions: Record<string, PlanQuestion>;
      }) {
        const res = await executeTypeSafe(
          {
            state: params.state,
            questions: params.questions as Record<string, TypeSafeQuestion>,
          },
          apiKey,
          signal,
          ctx
        );

        if (res.details && typeof res.details === "object" && "answers" in res.details) {
          const rawAnswers = res.details.answers;
          return {
            answers: rawAnswers as {
              scope_mode?: { choice: string };
              algorithm_depth?: { score: number };
              task_actionability?: { noul: number };
              claude_isolation_adherence?: { noul: number };
            },
          };
        }

        try {
          const text = res.content?.[0]?.text;
          if (text && text.startsWith("{")) {
            const parsed = JSON.parse(text) as {
              answers?: {
                scope_mode?: { choice: string };
                algorithm_depth?: { score: number };
                task_actionability?: { noul: number };
                claude_isolation_adherence?: { noul: number };
              };
            };
            if (parsed && typeof parsed === "object" && parsed.answers) {
              return { answers: parsed.answers };
            }
          }
          return { error: text || "TypeSafe evaluation failed" };
        } catch {
          return { error: res.content?.[0]?.text || "TypeSafe evaluation failed" };
        }
      },

      async evaluateGate(params: {
        state: string;
        questions: Record<string, GateQuestion>;
      }) {
        const res = await executeTypeSafe(
          {
            state: params.state,
            questions: params.questions as Record<string, TypeSafeQuestion>,
          },
          apiKey,
          signal,
          ctx
        );

        if (res.details && typeof res.details === "object" && "answers" in res.details) {
          const rawAnswers = res.details.answers;
          return {
            answers: rawAnswers as {
              meets_criteria?: { noul: number };
              plan_drift?: { choice: string };
              claude_account_untouched?: { noul: number };
            },
          };
        }

        try {
          const text = res.content?.[0]?.text;
          if (text && text.startsWith("{")) {
            const parsed = JSON.parse(text) as {
              answers?: {
                meets_criteria?: { noul: number };
                plan_drift?: { choice: string };
                claude_account_untouched?: { noul: number };
              };
            };
            if (parsed && typeof parsed === "object" && parsed.answers) {
              return { answers: parsed.answers };
            }
          }
          return { error: text || "TypeSafe evaluation failed" };
        } catch {
          return { error: res.content?.[0]?.text || "TypeSafe evaluation failed" };
        }
      },
    };
  }

  pi.registerTool({
    name: "typesafe_judge",
    label: "TypeSafe Judge",
    description:
      "Send state and structured questions (noul, choice, score) to TypeSafe System One for fast structured judgments. Tighten-only: use a result to add gates or raise review level, never to auto-approve or skip review/test.",
    parameters: z.object({
      state: z.union([z.string(), z.record(z.unknown())]),
      questions: z.record(
        z.object({
          type: z.enum(["noul", "choice", "score"]),
          instructions: z.union([z.string(), z.record(z.unknown())]),
          criteria: z.unknown().optional(),
        })
      ),
    }),
    async execute(
      _toolCallId: string,
      params: TypeSafeJudgeParams,
      signal?: AbortSignal,
      _onUpdate?: (result: ExtensionToolResult) => void,
      ctx?: unknown
    ): Promise<ExtensionToolResult> {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return DISABLED_RESULT;
      return executeTypeSafe(params, apiKey, signal, ctx);
    },
  });

  pi.registerTool({
    name: "typesafe_rerank",
    label: "TypeSafe Rerank",
    description: "Rank multiple candidate strings or code snippets against a query. Returns candidates ordered by relevance score.",
    parameters: z.object({
      query: z.string(),
      candidates: z.array(z.string()).min(1)
    }),
    async execute(
      _toolCallId: string,
      params: { query: string, candidates: string[] },
      signal?: AbortSignal,
      _onUpdate?: (result: ExtensionToolResult) => void,
      ctx?: unknown
    ): Promise<ExtensionToolResult> {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return DISABLED_RESULT;

      const questions: Record<string, TypeSafeQuestion> = {};
      for (let i = 0; i < params.candidates.length; i++) {
        questions[`candidate_${i}`] = {
          type: "score",
          instructions: `Rate how relevant candidate \`candidates[${i}]\` is to the target \`query\`.`,
          criteria: [
            "Level 0: Completely irrelevant or unrelated to `query`.",
            "Level 1: Partially relevant, touches adjacent topics but does not resolve `query`.",
            "Level 2: Highly relevant, directly and accurately addresses `query`."
          ]
        };
      }

      const state = { query: params.query, candidates: params.candidates };
      const res = await executeTypeSafe({ state, questions }, apiKey, signal, ctx);
      
      if (res.content[0].text.startsWith("TypeSafe error:") || res.content[0].text === "TypeSafe disabled" || res.content[0].text.startsWith("lattice-violation:")) {
        return res;
      }
      
      try {
        const parsed = JSON.parse(res.content[0].text);
        const answers = parsed.answers;
        const scoredCandidates = params.candidates.map((c, i) => {
          const ans = answers[`candidate_${i}`];
          const score = (ans && typeof ans === "object" && "score" in ans && typeof ans.score === "number") ? ans.score : 0;
          return { candidate: c, score };
        });
        scoredCandidates.sort((a, b) => b.score - a.score);
        return { content: [{ type: "text", text: JSON.stringify({ ranked: scoredCandidates }) }] };
      } catch (e) {
        return shortError("bad_response");
      }
    }
  });

  pi.registerTool({
    name: "typesafe_evaluate_multi",
    label: "TypeSafe Multi-Label Evaluation",
    description: "Evaluate the exact same state against multiple dimension labels simultaneously.",
    parameters: z.object({
      state: z.union([z.string(), z.record(z.unknown())]),
      dimensions: z.array(z.string()).min(1)
    }),
    async execute(
      _toolCallId: string,
      params: { state: string | Record<string, unknown>, dimensions: string[] },
      signal?: AbortSignal,
      _onUpdate?: (result: ExtensionToolResult) => void,
      ctx?: unknown
    ): Promise<ExtensionToolResult> {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return DISABLED_RESULT;

      const questions: Record<string, TypeSafeQuestion> = {};
      for (const dim of params.dimensions) {
        questions[dim] = {
          type: "noul",
          instructions: `Does the content in \`state\` clearly satisfy, demonstrate, or exhibit "${dim}"?`,
          criteria: {
            true: `The content clearly exhibits or satisfies "${dim}".`,
            false: `The content does not satisfy or exhibit "${dim}".`
          }
        };
      }
      return executeTypeSafe({ state: params.state, questions }, apiKey, signal, ctx);
    }
  });

  pi.registerTool({
    name: "typesafe_elevate_plan",
    label: "TypeSafe Plan Elevation",
    description:
      "Evaluates an implementation plan draft against TypeSafe System One rubrics (Scope, Algorithm, Actionability) and Claude isolation invariants.",
    parameters: z.object({
      planTitle: z.string(),
      planContent: z.string(),
      attempt: z.number().optional(),
    }),
    async execute(
      _toolCallId: string,
      params: { planTitle: string; planContent: string; attempt?: number },
      signal?: AbortSignal,
      _onUpdate?: (result: ExtensionToolResult) => void,
      ctx?: unknown
    ): Promise<ExtensionToolResult> {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim() || "";
      const client = createExtensionJudgeClient(apiKey, signal, ctx);
      const result = await evaluatePlanDraft(params, client);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "typesafe_verify_completion",
    label: "TypeSafe Task Completion Dual Gate",
    description:
      "Intercepts and gates task completion via Gate 1 deterministic local verification and Gate 2 TypeSafe System One semantic validation.",
    parameters: z.object({
      taskId: z.string(),
      planPath: z.string().optional(),
      testCommand: z.string().optional(),
      timeoutMs: z.number().optional(),
    }),
    async execute(
      _toolCallId: string,
      params: { taskId: string; planPath?: string; testCommand?: string; timeoutMs?: number },
      signal?: AbortSignal,
      _onUpdate?: (result: ExtensionToolResult) => void,
      ctx?: unknown
    ): Promise<ExtensionToolResult> {
      const cwd = getProjectDir(ctx);
      const apiKey = process.env.TYPESAFE_API_KEY?.trim() || "";
      const client = createExtensionJudgeClient(apiKey, signal, ctx);
      const result = await verifyTaskCompletion({ ...params, cwd }, client);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
  const criteriaBase = z.array(z.string());
  const criteriaSchema =
    criteriaBase && typeof criteriaBase === "object" && "optional" in criteriaBase && typeof criteriaBase.optional === "function"
      ? criteriaBase.optional()
      : criteriaBase;

  pi.registerTool({
    name: "typesafe_expert_review",
    label: "TypeSafe Expert Review",
    description:
      "Invokes TypeSafe System One expert evaluation: scope_arbiter (scope adherence and reduction prevention), drift_guard (architectural deviation and creep detection), or risk_security_triage (technical risk and trade-off rating).",
    parameters: z.object({
      role: z.enum(["scope_arbiter", "drift_guard", "risk_security_triage"]),
      context: z.union([z.string(), z.record(z.unknown())]),
      criteria: criteriaSchema,
    }),
    async execute(
      _toolCallId: string,
      params: {
        role: "scope_arbiter" | "drift_guard" | "risk_security_triage";
        context: string | Record<string, unknown>;
        criteria?: string[];
      },
      signal?: AbortSignal,
      _onUpdate?: (result: ExtensionToolResult) => void,
      ctx?: unknown
    ): Promise<ExtensionToolResult> {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim() || "";
      const client = createExtensionJudgeClient(apiKey, signal, ctx);
      let result: unknown;
      if (params.role === "scope_arbiter") {
        const planStr = typeof params.context === "string" ? params.context : JSON.stringify(params.context);
        result = await evaluateScopeArbiter(planStr, params.criteria?.join("\n") || "Implement plan", client);
      } else if (params.role === "drift_guard") {
        const diffStr = typeof params.context === "string" ? params.context : JSON.stringify(params.context);
        result = await evaluateDriftGuard(diffStr, params.criteria || [], client);
      } else {
        result = await evaluateRiskSecurityTriage(params.context, client);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
