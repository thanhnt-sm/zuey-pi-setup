// TypeSafe Planner Integration Extension for OMP
// Connects OMP planning workflows with TypeSafe System One judgments (Choice, Noul, Score).

import { createRequire } from "node:module";
import { createHostToolInvocationRuntime } from "./src/host-tool-invocation";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readWorkspaceFile, listWorkspaceFiles } from "./src/typesafe-evidence-file.cjs";
import { taskArtifactAssociation } from "./src/evidence-artifacts";
import { fileMutationTargets, requestsPlanCompletion } from "./src/file-mutation-targets";
import { writeRecoveryReport } from "./src/typesafe-evidence-file.cjs";
import type { AdvisorHostServices } from "./src/advisor-host-types";
import { currentSourceMutationGrant, sourceMutationAllowed, sourceMutationGrantCurrent } from "./src/source-mutation-authority";
import { assertScopedPlanClosure, parsePlanCliCheck, phaseFileForCheck, PlanClosurePrerequisiteError } from "./src/plan-closure";
import { evaluatePlanDraft, type PlanJudgeClient, type PlanQuestion } from "./src/plan-evaluator";
import { resolveDebateModel, runMultiPersonaDebate, type DebateJudgeClient } from "./src/debate-evaluator";
import type { JudgePurpose, ResolvedToolPolicy, TrustedToolPolicy, PreparedRequestValidator, TypeSafePreparedRequest, TypeSafeJudgeResult } from "./src/payload-safety";
import { scoreValue, type SemanticResponse, type SemanticTransportMetadata } from "./src/semantic-judge-client";
import { verifyTaskCompletion, type GateJudgeClient, type GateQuestion } from "./src/verification-gate";
import { readHostBranch, projectHostHistory, originalTodoInput } from "./src/host-history";
import { canonicalDigest, nativeTodoInputDigest, normalizeNativeTodoInput, readNativeTodoOperation, validateNativeTodoTransition, type ContractHistoryProjection, type NormalizedNativeTodoInput } from "./src/task-contract";
import { freezeContractValue } from "./src/task-contract-source";
import { createSemanticApprovalPolicy } from "./src/semantic-approval-policy";
import type { VerificationOutcome } from "./src/types/verification";
import { createContractRuntime, type ContractBindingProposal, type ContractTaskSelector } from "./src/contract-runtime";
import { createTaskEvidenceRuntime, type TaskEvidenceCollectParams } from "./src/task-evidence-runtime";
import { createTaskVerificationRuntime, type TaskVerificationRuntime, type NativeTaskVerificationStage } from "./src/task-verification-runtime";
import { createTodoLifecycleAuthority, type LifecyclePreparationInput } from "./src/todo-lifecycle-authority";
import { registerAdvisorHost, type AdvisorHostAPI, type AdvisorHostExecuteContext, type AdvisorHostRegistration } from "./src/advisor-host";
import { createProjectExclusionPolicy, projectExcludedResult } from "./src/project-exclusion-policy";
import { selectVerificationTestAssets } from "./src/test-asset-selector";
import type { ApprovedVerificationCommand } from "./src/verification-receipt";
import type { SourceRetrievalRequest } from "./src/judge-evidence-packet";
import {
  isPlanCliStub,
  DELIVERABLE_ARTIFACT_MAX_BYTES,
  InsufficientDeliverableEvidenceError,
  normalizeEvidencePath,
  statusEvidencePaths,
  isResearchReportPath,
  hasProductCodeChanges,
  deliverableArtifactsFromState,
  type WorkspaceSnapshot,
} from "./src/evidence-collector";
import { clampText } from "./src/payload-safety";
import { isTechnicalImplementationQuestion, formatAdvisorAutoRemediation } from "./src/anti-blocking-guards";
import { sanitizeXmlText } from "./src/xml-enclosure";
import {
  evaluateScopeArbiter,
  evaluateDriftGuard,
  evaluateRiskSecurityTriage,
  generateVerificationScorecard,
  type ExpertJudgeClient,
  type ExpertJudgeQuestion,
} from "./src/cook-expert-judge";
import {
  evaluateAdvisorIntent,
  type AdvisorOptionCandidate,
} from "./src/bicameral-consensus";
export interface PendingRemediation {
  taskId: string;
  gate: string;
  diffHash: string;
  testExitCode?: number | null;
  reasons: string[];
  nextActions: string[];
  timestamp: number;
}

export interface CanonicalTodoTask {
  content: string;
  status: "pending" | "in_progress" | "completed" | "abandoned" | "blocked";
  blocker?: string;
}

export interface CanonicalTodoPhase {
  name: string;
  tasks: CanonicalTodoTask[];
}

interface TodoTargetBinding {
  phase: string;
  index: number;
  phaseOrdinal: number;
  content: string;
}


export interface StagedTodoCall {
  toolCallId: string;
  sessionId: string;
  inputHash: string;
  input: NormalizedNativeTodoInput;
  generation: number;
  revision: number;
  createdAt: number;
  op: string;
  affectedTasks: string[];
  targetBindings: TodoTargetBinding[];
  replacedTasks: string[];
  preCommitPhases: CanonicalTodoPhase[];
  workspaceSnapshot?: WorkspaceSnapshot;
  verificationStages: NativeTaskVerificationStage[];
  nativeResultObserved: boolean;
  pendingReports: TaskReport[];
  provenance: "judge" | "human" | "gate1";
}

interface CommittedTodoCall {
  inputHash: string;
  op: string;
  committedAt: number;
}

interface ExtensionToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
  isError?: boolean;
}

interface ToolDefinition<TParams> {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  approval?: "read" | "exec";
  execute: (
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: (result: ExtensionToolResult) => void,
    ctx?: unknown
  ) => Promise<ExtensionToolResult>;
}

export interface ExtensionAPI {
  zod: {
    object: (shape: Record<string, unknown>) => unknown;
    union: (options: unknown[]) => unknown;
    string: () => { optional: () => unknown; min?: (n: number) => unknown; [key: string]: unknown };
    number: () => { optional: () => unknown; [key: string]: unknown };
    record: (valueType: unknown) => unknown;
    enum: (values: string[]) => unknown;
    unknown: () => { optional(): unknown };
    array: (itemType: unknown) => { min: (n: number) => unknown; optional(): unknown; [key: string]: unknown };
  };
  on: (event: string, handler: (event: unknown, ctx: unknown) => unknown | Promise<unknown>) => void;
  registerTool: <T>(definition: ToolDefinition<T>) => void;
  appendEntry?: (customType: string, data: unknown) => void;
  sendMessage: (
    message: string | { customType?: string; content: string; display?: boolean },
    options?: { deliverAs?: "steer" | "followUp" | "nextTurn" | "aside"; triggerTurn?: boolean }
  ) => Promise<void>;
}

export interface ExtensionRuntimeOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  preflightBudgetMs?: number;
  toolPolicies?: Partial<Record<JudgePurpose, TrustedToolPolicy>>;
}

export interface PlannerSessionState {
  readonly resolverOptions: Required<Pick<ExtensionRuntimeOptions, "homeDir" | "env">>;
  generation: number;
  revision: number;
  phases: CanonicalTodoPhase[];
  readonly activeContractedTasks: ReadonlySet<string>;
  taskBaselines: Map<string, WorkspaceSnapshot>;
  lastCheckpoint?: WorkspaceSnapshot;
  pendingRemediations: Map<string, PendingRemediation>;
  consecutiveFailuresByTask: Map<string, number>;
  lastFailureReasonByTask: Map<string, string>;
  nativeHistory?: ContractHistoryProjection;
  debtByIncarnation: Map<string, { reason?: string; failures?: number; remediation?: PendingRemediation }>;
  stagedCalls: Map<string, StagedTodoCall>;
  committedCallTombstones: Map<string, CommittedTodoCall>;
  uninitialized: boolean;
}

export interface TypeSafeQuestion {
  type: "noul" | "choice" | "score";
  instructions: string | Record<string, unknown>;
  criteria?: unknown;
}

interface TypeSafeJudgeParams {
  state: string | Record<string, unknown>;
  questions: Record<string, TypeSafeQuestion>;
  model?: string;
}

// ---------------------------------------------------------------------------
// Bundled runtime modules.
//
// Every security-sensitive dependency is loaded from this extension's sibling
// `src/` directory. The host's global kit and any alternate workspace are
// deliberately not candidates: a stale or poisoned global module must never
// influence this bundle. Successful CommonJS loads remain cached until the
// host restarts.
const nodeRequire = createRequire(import.meta.url);

type RuntimeOriginDigest = {
  origin: string;
  sha256: string | null;
};

type RuntimeOriginProof = {
  kind: "runtime-origin";
  algorithm: "sha256";
  interpretation: "disk-observation-not-loaded-code-proof";
  loadedFactoryDigest: string;
  entrypoint: RuntimeOriginDigest;
  bundledModules: RuntimeOriginDigest[];
};

const RUNTIME_ORIGIN_MODULE_URLS = [
  new URL("./src/typesafe-enabled-resolver.cjs", import.meta.url).href,
  new URL("./src/typesafe-redact.cjs", import.meta.url).href,
  new URL("./src/typesafe-api-client.cjs", import.meta.url).href,
  new URL("./src/typesafe-policy-client.cjs", import.meta.url).href,
];

let cachedRuntimeOriginProof: RuntimeOriginProof | undefined;

function sha256AtOrigin(origin: string): string | null {
  try {
    return crypto.createHash("sha256").update(readFileSync(new URL(origin))).digest("hex");
  } catch {
    return null;
  }
}

function getRuntimeOriginProof(): RuntimeOriginProof {
  if (cachedRuntimeOriginProof) return cachedRuntimeOriginProof;

  cachedRuntimeOriginProof = {
    kind: "runtime-origin",
    algorithm: "sha256",
    interpretation: "disk-observation-not-loaded-code-proof",
    loadedFactoryDigest: canonicalDigest(Function.prototype.toString.call(registerExtension)),
    entrypoint: {
      origin: import.meta.url,
      sha256: sha256AtOrigin(import.meta.url),
    },
    bundledModules: RUNTIME_ORIGIN_MODULE_URLS.map((origin) => ({
      origin,
      sha256: sha256AtOrigin(origin),
    })),
  };
  return cachedRuntimeOriginProof;
}

interface EnabledResolverModule {
  resolveTypeSafeEnabled: (
    projectDir: string,
    opts?: { env?: Record<string, string | undefined>; homeDir?: string }
  ) => { enabled: boolean; reason: string; dialect?: string; endpoint?: string; baseUrl?: string };
  resolveTypeSafeProjectExclusion: (
    projectDir: string,
    opts?: { homeDir?: string }
  ) => { excluded: boolean; reason: string };
}

interface RedactModule {
  preparePayload: (payload: unknown, opts?: { maxBytes?: number; apiKey?: string }) => unknown;
  redactString: (value: string, opts?: { apiKey?: string }) => string;
}

interface ApiClientModule {
  validateInput: (args: unknown) => { ok: boolean; message?: string };
  redactEvidenceState(state: unknown, options: { apiKey: string; homeDirs?: readonly string[] }): unknown;
  sanitizeAnswers: (
    questions: Record<string, TypeSafeQuestion>,
    rawAnswers: unknown
  ) => Record<string, unknown> | null;
  requestWithRetry: (options: {
    apiKey: string;
    body: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxAttempts?: number;
    totalBudgetMs?: number;
    nowImpl?: () => number;
    wallNowImpl?: () => number;
    sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
    randomImpl?: () => number;
    rateLimitState?: object;
    debugLog?: (message: string) => void;
    setTimeoutImpl?: (callback: () => void, ms: number) => unknown;
    clearTimeoutImpl?: (timer: unknown) => void;
  }) => Promise<
    | { kind: "ok"; data: unknown }
    | { kind: "auth"; status: number }
    | { kind: "http_error"; status: number }
    | { kind: "bad_response" }
  >;
  checkCredentialCooldown: (
    apiKey: string,
    options?: { rateLimitState?: object }
  ) => { status: number; cooldown?: true; authFailed?: true; until?: number } | null;
}


interface PolicyClientModule {
  resolveToolPolicies(
    overrides?: Partial<Record<JudgePurpose, TrustedToolPolicy>>,
    defaults?: { baseline: string; lattice: string[] }
  ): Readonly<Record<JudgePurpose, ResolvedToolPolicy>>;
  judgeWithPolicy(options: {
    args: TypeSafeJudgeParams;
    purpose: JudgePurpose;
    trustedPolicy: ResolvedToolPolicy;
    apiKey: string;
    homeDir?: string;
    signal?: AbortSignal;
    fetchImpl: typeof fetch;
    timeoutMs?: number;
    totalBudgetMs?: number;
    maxAttempts?: number;
    validatePrepared?: PreparedRequestValidator;
  }): Promise<TypeSafeJudgeResult>;
}

function loadResolverModule(): EnabledResolverModule | null {
  try {
    const mod = nodeRequire(path.join(__dirname, "src", "typesafe-enabled-resolver.cjs")) as EnabledResolverModule;
    return mod && typeof mod.resolveTypeSafeEnabled === "function" && typeof mod.resolveTypeSafeProjectExclusion === "function" ? mod : null;
  } catch {
    return null;
  }
}

function loadRedactModule(): RedactModule | null {
  try {
    const mod = nodeRequire(path.join(__dirname, "src", "typesafe-redact.cjs")) as RedactModule;
    return mod && typeof mod.preparePayload === "function" && typeof mod.redactString === "function" ? mod : null;
  } catch {
    return null;
  }
}

function loadApiClientModule(): ApiClientModule | null {
  try {
    const mod = nodeRequire(path.join(__dirname, "src", "typesafe-api-client.cjs")) as ApiClientModule;
    return mod &&
      typeof mod.validateInput === "function" &&
      typeof mod.sanitizeAnswers === "function" &&
      typeof mod.requestWithRetry === "function" &&
      typeof mod.checkCredentialCooldown === "function"
      ? mod
      : null;
  } catch {
    return null;
  }
}

function loadPolicyClientModule(pi?: ExtensionAPI): PolicyClientModule | null {
  try {
    const mod = nodeRequire(path.join(__dirname, "src", "typesafe-policy-client.cjs")) as PolicyClientModule;
    if (mod && typeof mod.resolveToolPolicies === "function" && typeof mod.judgeWithPolicy === "function") return mod;
    throw new Error("missing canonical policy exports");
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    if (pi && typeof pi.sendMessage === "function") {
      try {
        const result = pi.sendMessage({
          customType: "typesafe-health",
          content: `TypeSafe warning: Failed to load bundled typesafe-policy-client.cjs: ${detail}`,
          display: true,
        });
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {});
        }
      } catch {}
    }
    return null;
  }
}


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
  "src/debate-evaluator.ts",
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

export const COGNITIVE_TASK_PATTERN =
  /\b(?:scout\w*|diagnos\w*|investigat\w*|research\w*|analy[sz]\w*|explor\w*|find|audit\w*|review\w*|check\w*|trac\w*|inspect\w*|read\w*|clarif\w*|brainstorm\w*|plan|planning|design\w*|synthesi[sz]\w*|consult\w*|evaluat\w*|assess\w*|document\w*|journal\w*|organi[sz]\w*|verif\w*|ask\w*|propos\w*|validat\w*|compar\w*|summariz\w*|kiểm tra|phân tích|tìm|nghiên cứu|lập kế hoạch)\b/i;


export function inferTaskType(
  gitStatus: string,
  deliverableArtifacts?: string,
  taskDescription?: string
): "code_change" | "analysis_research" | "doc_specification" {
  const filepaths = statusEvidencePaths(gitStatus);
  if (hasProductCodeChanges(gitStatus, taskDescription)) {
    return "code_change";
  }

  // Check for documentation specifications (.md, .txt, .rst)
  const docFilepaths = filepaths
    .filter((fp) => /\.(md|markdown|txt|rst|adoc)$/i.test(fp) && !isResearchReportPath(fp));
  const onlyFilteredPlanStubs =
    deliverableArtifacts === "" &&
    Boolean(taskDescription) &&
    docFilepaths.length > 0 &&
    docFilepaths.every((fp) => /(?:^|[\/\\])plans[\/\\]/i.test(fp));
  if (docFilepaths.length > 0 && !onlyFilteredPlanStubs) {
    return "doc_specification";
  }

  // If only reports or artifact text exists, or no diff with artifact
  if (deliverableArtifacts && deliverableArtifacts.trim().length > 0) {
    return "analysis_research";
  }
  const hasReportFiles = filepaths.some(isResearchReportPath);
  if (hasReportFiles) {
    return "analysis_research";
  }

  if (
    taskDescription &&
    COGNITIVE_TASK_PATTERN.test(taskDescription)
  ) {
    return "analysis_research";
  }

  // Fallback default
  return "code_change";
}

export async function collectDeliverableArtifacts(
  projectDir: string,
  changedFiles: string[] = [],
  taskDescription: string = ""
): Promise<string> {
  const candidates: { file: string; content: string; mandatory: boolean; relevance: number }[] = [];
  let unreadable = 0;
  for (const file of new Set(changedFiles.map(normalizeEvidencePath))) {
    if (!/\.(?:md|markdown|txt|rst|adoc)$/i.test(file) && !isResearchReportPath(file)) continue;
    if (path.isAbsolute(file) || path.win32.isAbsolute(file) || file.split("/").includes("..")) {
      unreadable++;
      continue;
    }
    let content: string;
    try {
      content = readWorkspaceFile(projectDir, file, { maxBytes: 1024 * 1024 }).bytes.toString("utf8");
    } catch {
      unreadable++;
      continue;
    }
    if (isPlanCliStub(content)) continue;
    candidates.push({ file, content, ...taskArtifactAssociation(file, content, taskDescription) });
  }
  if (candidates.length === 0 && unreadable === 0) return "";
  candidates.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) ||
    b.relevance - a.relevance || a.file.localeCompare(b.file));
  const mandatoryCount = candidates.filter((candidate) => candidate.mandatory).length;
  const metadata = (selected: number, truncated: number): string =>
    `\n[Artifact selection=${mandatoryCount ? "exact-task-bound" : "relevance-fallback (not completeness proof)"}; selected=${selected}; omitted=${candidates.length - selected}; unreadable=${unreadable}; truncated=${truncated}]\n`;
  const blocks: string[] = [];
  let bytes = 0;
  let truncated = 0;
  for (const candidate of candidates) {
    const header = `--- Deliverable: ${candidate.file} ---\n`;
    const block = `${header}${candidate.content}\n`;
    const blockBytes = Buffer.byteLength(block, "utf8");
    const footerBytes = Buffer.byteLength(metadata(blocks.length + 1, truncated), "utf8");
    if (bytes + blockBytes + footerBytes <= DELIVERABLE_ARTIFACT_MAX_BYTES) {
      blocks.push(block);
      bytes += blockBytes;
      continue;
    }
    if (candidate.mandatory) {
      throw new InsufficientDeliverableEvidenceError();
    }
    const marker = "\n[Artifact truncated; omitted content is not evidence of completeness.]\n";
    const remaining = DELIVERABLE_ARTIFACT_MAX_BYTES - bytes -
      Buffer.byteLength(metadata(blocks.length + 1, truncated + 1) + header + marker, "utf8");
    if (remaining <= 0) continue;
    const contentBytes = Buffer.from(candidate.content, "utf8");
    let end = Math.min(remaining, contentBytes.length);
    while (end > 0 && (contentBytes[end] & 0xc0) === 0x80) end--;
    const partial = header + contentBytes.subarray(0, end).toString("utf8") + marker;
    blocks.push(partial);
    bytes += Buffer.byteLength(partial, "utf8");
    truncated++;
  }
  return blocks.join("") + metadata(blocks.length, truncated);
}



/** Short, non-descriptive error code only — never forward upstream error
 * bodies, raw JSON, or exception messages to the model (contract Section 4). */
function shortError(code: string): ExtensionToolResult {
  return { content: [{ type: "text", text: `TypeSafe error: ${code}` }], isError: true };
}

export function summarizeUnifiedDiff(diff: string, maxChars = 28000): string {
  if (diff.length <= maxChars) return diff;

  const xmlMatch = diff.match(/^<([a-z_]+)>\n([\s\S]*)\n<\/\1>$/);
  if (xmlMatch) {
    const tagName = xmlMatch[1];
    const inner = xmlMatch[2];
    const tagOverhead = tagName.length * 2 + 7;
    const summarizedInner = summarizeUnifiedDiff(inner, Math.max(200, maxChars - tagOverhead));
    return `<${tagName}>\n${summarizedInner}\n</${tagName}>`;
  }

  const fileBlocks = diff.includes("diff --git ")
    ? diff.split(/(?=^diff --git )/m).filter((b) => b.trim().length > 0)
    : [diff];
  const numFiles = fileBlocks.length;
  const perFileBudget = Math.max(350, Math.floor((maxChars - 60) / numFiles));

  const summarizedBlocks = fileBlocks.map((block) => {
    if (block.length <= perFileBudget) return block.trimEnd();
    const lines = block.split("\n");
    const headerLines: string[] = [];
    const bodyLines: string[] = [];
    for (const line of lines) {
      if (
        line.startsWith("diff --git") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("new file")
      ) {
        headerLines.push(line);
      } else {
        bodyLines.push(line);
      }
    }
    const headerStr = headerLines.join("\n");
    const remainingBudget = Math.max(120, perFileBudget - headerStr.length - 45);
    const keptBody: string[] = [];
    let len = 0;
    let skipped = 0;
    for (const line of bodyLines) {
      const isPriority =
        line.startsWith("@@ ") ||
        /(?:expect\(|assert\(|assert\.[a-zA-Z]+\(|describe\(|test\(|function\s+|class\s+|export\s+|interface\s+|type\s+|const\s+[a-zA-Z0-9_]+\s*=\s*(?:async\s*)?\(|return\s+|throw\s+|TODO|unimplemented)/.test(
          line
        );
      if (
        len + line.length + 1 <= remainingBudget * 0.65 ||
        (isPriority && len + line.length + 1 <= remainingBudget)
      ) {
        if (skipped > 0) {
          const marker = `[... ${skipped} lines truncated ...]`;
          if (len + marker.length + 1 <= remainingBudget) {
            keptBody.push(marker);
            len += marker.length + 1;
          }
          skipped = 0;
        }
        keptBody.push(line);
        len += line.length + 1;
      } else {
        skipped++;
      }
    }
    if (skipped > 0) {
      keptBody.push(`[... ${skipped} lines truncated ...]`);
    }
    return headerStr ? `${headerStr}\n${keptBody.join("\n")}` : keptBody.join("\n");
  });

  let result = summarizedBlocks.join("\n\n");
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 40) + "\n[... diff truncated ...]";
  }
  return result;
}

export function sanitizeStateForTypeSafe(state: string | Record<string, unknown>): Record<string, unknown> | string {
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

  const clampEnclosedOrRaw = (val: string, maxLen: number, mode: "head" | "tail" = "head"): string => {
    const match = val.match(/^<([a-z_]+)>\n([\s\S]*)\n<\/\1>$/);
    if (match) {
      const tagName = match[1];
      const inner = match[2];
      const tagOverhead = tagName.length * 2 + 7; // <tag>\n\n</tag>
      const budget = Math.max(0, maxLen - tagOverhead);
      if (inner.length > budget) {
        const clampedInner = clampText(inner, budget, mode);
        return `<${tagName}>\n${clampedInner}\n</${tagName}>`;
      }
      return val;
    }
    return clampText(val, maxLen, mode);
  };

  const TAIL_KEYS: Record<string, true> = {
    agent_work_log: true,
    test_summary: true,
    testOutput: true,
    user_request: true,
  };
  const LARGE_FIELD_KEYS: Record<string, true> = {
    plan: true,
    plan_content: true,
    planContent: true,
  };

  if (typeof resolved === "object" && resolved !== null) {
    const obj: Record<string, unknown> = { ...resolved };
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === "string") {
        if (key === "deliverable_artifacts") continue; // Already budgeted; never silently remove task-bound proof.
        if (key === "unified_diff" || key === "gitDiff" || key === "diff") {
          obj[key] = summarizeUnifiedDiff(val, 14000);
        } else {
          const fieldLimit = LARGE_FIELD_KEYS[key] ? 5000 : 2000;
          const clampMode = TAIL_KEYS[key] ? "tail" : "head";
          if (val.length > fieldLimit) {
            obj[key] = clampEnclosedOrRaw(val, fieldLimit, clampMode);
          }
        }
      }
    }

    let serialized = JSON.stringify(obj);
    if (serialized.length > 28000) {
      for (const diffK of ["unified_diff", "gitDiff", "diff"]) {
        if (typeof obj[diffK] === "string" && (obj[diffK] as string).length > 10000) {
          obj[diffK] = summarizeUnifiedDiff(obj[diffK] as string, 10000);
        }
      }
      serialized = JSON.stringify(obj);
    }
    if (serialized.length > 28000) {
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (
          typeof val === "string" &&
          key !== "unified_diff" &&
          key !== "gitDiff" &&
          key !== "deliverable_artifacts" &&
          key !== "diff" &&
          val.length > 1500
        ) {
          obj[key] = clampEnclosedOrRaw(val, 1500, TAIL_KEYS[key] ? "tail" : "head");
        }
      }
    }
    return obj;
  }

  if (typeof resolved === "string") {
    if (resolved.startsWith("diff --git") || resolved.includes("\n--- a/") || resolved.includes("\n+++ b/")) {
      return summarizeUnifiedDiff(resolved, 14000);
    }
    if (resolved.startsWith("<plan_evaluation_state>") && resolved.endsWith("</plan_evaluation_state>")) {
      if (resolved.length > 14000) {
        const clamped = clampEnclosedOrRaw(resolved, 14000, "head");
        if (!clamped.endsWith("</plan_evaluation_state>")) {
          const closeTag = "\n</plan_evaluation_state>";
          return clampText(resolved, 14000 - closeTag.length, "head") + closeTag;
        }
        return clamped;
      }
      return resolved;
    }
    if (resolved.length > 6000) {
      return clampEnclosedOrRaw(resolved, 6000);
    }
  }

  return resolved;
}

export function collectConversationContext(ctx: unknown): {
  userRequest: string;
  agentWorkLog: string;
  lastTestSummary?: string;
} {
  if (!ctx || typeof ctx !== "object") {
    return { userRequest: "", agentWorkLog: "" };
  }

  const ctxRecord = ctx as Record<string, unknown>;
  const directUserReq = typeof ctxRecord.userRequest === "string" ? ctxRecord.userRequest : "";
  const directWorkLog = typeof ctxRecord.agentWorkLog === "string" ? ctxRecord.agentWorkLog : "";
  const sessionManager = ctxRecord.sessionManager;
  if (!sessionManager || typeof sessionManager !== "object") {
    return { userRequest: directUserReq, agentWorkLog: directWorkLog };
  }

  const smRecord = sessionManager as Record<string, unknown>;
  if (typeof smRecord.getBranch !== "function") {
    return { userRequest: directUserReq, agentWorkLog: directWorkLog };
  }

  try {
    const branch = smRecord.getBranch() as unknown;
    if (!Array.isArray(branch)) {
      return { userRequest: directUserReq, agentWorkLog: directWorkLog };
    }

    const userMessages: string[] = [];
    const assistantMessages: string[] = [];
    let lastTestSummary: string | undefined;

    for (const entry of branch) {
      if (!entry || typeof entry !== "object") continue;
      const entryRecord = entry as Record<string, unknown>;

      if (entryRecord.type === "custom_message") {
        const customType = typeof entryRecord.customType === "string" ? entryRecord.customType : "";
        const rawContent = typeof entryRecord.content === "string" ? entryRecord.content.trim() : "";
        if (customType === "skill-prompt" && rawContent.length > 0) {
          const userMatch = rawContent.match(/\nUser:\s*([\s\S]+)$/);
          const extractedUser = userMatch ? userMatch[1].trim() : rawContent;
          if (extractedUser.length > 0) {
            userMessages.push(extractedUser);
          }
        } else if (customType === "advisor" && rawContent.length > 0) {
          assistantMessages.push(`[Advisor]: ${rawContent}`);
        }
        continue;
      }

      if (entryRecord.type !== "message" || !entryRecord.message || typeof entryRecord.message !== "object") {
        continue;
      }
      const msg = entryRecord.message as Record<string, unknown>;
      let textContent = "";
      if (typeof msg.content === "string") {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        const parts: string[] = [];
        for (const block of msg.content) {
          if (block && typeof block === "object") {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0) {
              parts.push(b.text);
            } else if (msg.role === "assistant" && b.type === "toolCall" && typeof b.name === "string") {
              const intentStr = typeof b.intent === "string" ? b.intent : (b.arguments && typeof b.arguments === "object" && typeof (b.arguments as Record<string, unknown>).i === "string" ? (b.arguments as Record<string, unknown>).i as string : "");
              parts.push(`[toolCall: ${b.name}${intentStr ? ` (${intentStr})` : ""}]`);
            }
          }
        }
        textContent = parts.join("\n");
      }

      const trimmed = textContent.trim();
      if (!trimmed) continue;

      if (msg.role === "user") {
        if (
          /^<system-notice>\s*Background job bg_/i.test(trimmed) ||
          /^Task completion rejected by TypeSafe/i.test(trimmed) ||
          /^📋 TypeSafe task report/u.test(trimmed) ||
          /\n📋 TypeSafe task report/u.test(trimmed)
        ) {
          if (/(?:bun test|npm test|vitest|jest|pytest|cargo test|go test|dotnet test|msbuild|node --test|\bRan \d+ tests\b|\b\d+ pass(?:ing|ed)?\b|SUCCESS: Baseline deployed)/i.test(trimmed)) {
            lastTestSummary = clampText(trimmed, 2000, "tail");
          }
          const bgMatch = trimmed.match(/<system-notice>([\s\S]*?)<\/system-notice>/);
          if (bgMatch && bgMatch[1]) {
            assistantMessages.push(`[backgroundJob]: ${clampText(bgMatch[1].trim(), 400, "tail")}`);
          }
        } else {
          const userMatch = trimmed.match(/\nUser:\s*([\s\S]+)$/);
          const extracted = (userMatch ? userMatch[1] : trimmed)
            .replace(/<system-notice>[\s\S]*?<\/system-notice>/g, "")
            .trim();
          if (extracted.length > 0 && extracted.toLowerCase() !== "retry") {
            userMessages.push(extracted);
          }
        }
      } else if (msg.role === "assistant") {
        assistantMessages.push(trimmed);
      } else if (msg.role === "toolResult" && !msg.isError) {
        const tName = typeof msg.toolName === "string" ? msg.toolName : "tool";
        const clampedResult = trimmed.includes("<task-result")
          ? clampText(trimmed, 1200, "head")
          : clampText(trimmed, 400, "tail");
        assistantMessages.push(`[toolResult:${tName}]: ${clampedResult}`);
        if (
          (tName === "bash" || tName === "eval") &&
          /(?:bun test|npm test|vitest|jest|pytest|cargo test|go test|dotnet test|msbuild|node --test|\bRan \d+ tests\b|\b\d+ pass(?:ing|ed)?\b|SUCCESS: Baseline deployed)/i.test(trimmed)
        ) {
          lastTestSummary = clampText(trimmed, 2000, "tail");
        }
      }
    }

    const lastUser = userMessages.length > 0 ? userMessages.slice(-2).join("\n---\n") : directUserReq;
    const lastAssistant = assistantMessages.length > 0 ? assistantMessages.slice(-8).join("\n---\n") : directWorkLog;

    return {
      userRequest: clampText(lastUser, 2000, "tail"),
      agentWorkLog: clampText(lastAssistant, 3000, "tail"),
      lastTestSummary,
    };
  } catch {
    return { userRequest: directUserReq, agentWorkLog: directWorkLog };
  }
}

export interface TaskReport {
  kind: "DONE" | "DROP";
  tasks: string[];
  approved: boolean;
  decidedBy: "judge" | "human" | "host-authorization" | "gate1";
  scores?: {
    meetsCriteria?: number;
    drift?: string;
    scope?: string;
    verdict?: string;
    confidence?: number;
    taskType?: string;
    dropJustified?: number;
  };
  diffScope?: string;
  changedFiles?: string[];
  test?: string;
  reasons: string[];
}

export function formatTaskReport(r: TaskReport): string {
  const tasksFormatted = r.tasks.map((t) => `"${t}"`).join(", ");
  const lines: string[] = [
    `📋 TypeSafe task report — ${r.kind} ${tasksFormatted}`,
    `Decision: ${r.approved ? "APPROVED" : "REJECTED"} (by: ${r.decidedBy})`,
  ];

  if (r.scores) {
    if (r.scores.meetsCriteria !== undefined) {
      const extras: string[] = [];
      if (r.scores.verdict) extras.push(`verdict=${r.scores.verdict}`);
      if (r.scores.taskType) extras.push(`task_type=${r.scores.taskType}`);
      const suffix = extras.length > 0 ? ` | ${extras.join(" | ")}` : "";
      lines.push(
        `Judge: meets_criteria=${r.scores.meetsCriteria.toFixed(2)} | drift=${r.scores.drift || "none"} | scope=${r.scores.scope || "none"}${suffix}`
      );
    }
    if (r.scores.dropJustified !== undefined) {
      const dropVerdictSuffix = r.scores.verdict ? ` | verdict=${r.scores.verdict}` : "";
      lines.push(
        `Judge: drop_justified=${r.scores.dropJustified.toFixed(2)}${dropVerdictSuffix}`
      );
    }
  }

  const evidenceParts: string[] = [];
  if (r.diffScope) {
    evidenceParts.push(`diff_scope=${r.diffScope}`);
  }
  if (r.changedFiles) {
    if (r.changedFiles.length === 0) {
      evidenceParts.push("files changed: none");
    } else if (r.changedFiles.length <= 10) {
      evidenceParts.push(`files changed: ${r.changedFiles.join(", ")}`);
    } else {
      const top10 = r.changedFiles.slice(0, 10).join(", ");
      const remainder = r.changedFiles.length - 10;
      evidenceParts.push(`files changed: ${top10} (+${remainder} more)`);
    }
  }
  if (r.test) {
    evidenceParts.push(`tests: ${r.test}`);
  }
  if (evidenceParts.length > 0) {
    lines.push(`Evidence: ${evidenceParts.join("; ")}`);
  }

  if (r.reasons && r.reasons.length > 0) {
    lines.push("Reasons:");
    for (const reason of r.reasons) {
      lines.push(`- ${reason}`);
    }
  }

  return lines.join("\n");
}



export function normalizeQuestionForTypeSafe(
  questions: Record<string, TypeSafeQuestion>
): Record<string, TypeSafeQuestion> {
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    return questions;
  }
  const normalized: Record<string, TypeSafeQuestion> = {};
  for (const [key, q] of Object.entries(questions)) {
    if (!q || typeof q !== "object") {
      normalized[key] = q;
      continue;
    }
    const newQ: TypeSafeQuestion = { ...q };
    if (newQ.type === "choice" && Array.isArray(newQ.criteria)) {
      const criteriaObj: Record<string, string> = {};
      for (let i = 0; i < newQ.criteria.length; i++) {
        const item = newQ.criteria[i];
        if (typeof item === "string") {
          const match = item.match(/^([^:\-]+)[:\-]\s*(.+)$/);
          if (match) {
            criteriaObj[match[1].trim()] = match[2].trim();
          } else {
            criteriaObj[`option_${i}`] = item.trim();
          }
        } else {
          criteriaObj[`option_${i}`] = String(item);
        }
      }
      newQ.criteria = criteriaObj;
    } else if (newQ.type === "noul" && Array.isArray(newQ.criteria)) {
      const stripBoolPrefix = (s: string, prefix: "true" | "false") =>
        s.replace(new RegExp(`^\\s*${prefix}\\s*[:\\-]\\s*`, "i"), "").trim();
      if (newQ.criteria.length >= 2) {
        newQ.criteria = {
          true: stripBoolPrefix(String(newQ.criteria[0]), "true"),
          false: stripBoolPrefix(String(newQ.criteria[1]), "false"),
        };
      } else if (newQ.criteria.length === 1) {
        const cleaned = stripBoolPrefix(String(newQ.criteria[0]), "true");
        newQ.criteria = {
          true: cleaned,
          false: `Not ${cleaned}`,
        };
      }
    } else if (newQ.type === "score" && Array.isArray(newQ.criteria)) {
      newQ.criteria = newQ.criteria.map((c) => (typeof c === "string" ? c : String(c)));
    }
    normalized[key] = newQ;
  }
  return normalized;
}


const OPEN_TODO_STATUSES = new Set<CanonicalTodoTask["status"]>(["pending", "in_progress", "blocked"]);
const MUTATING_TODO_OPS = new Set(["init", "start", "done", "rm", "drop", "block", "unblock", "append"]);
const TODO_STAGE_TTL_MS = 60_000;
const TODO_TOMBSTONE_LIMIT = 128;
class NativeTodoGuardError extends Error {
  constructor(message: string, readonly outcome?: Exclude<VerificationOutcome, { status: "APPROVED_PENDING_COMMIT" }>) {
    super(message); this.name = "NativeTodoGuardError";
  }
}

function cloneTodoPhases(phases: CanonicalTodoPhase[]): CanonicalTodoPhase[] {
  return phases.map((phase) => ({ name: phase.name, tasks: phase.tasks.map((task) => ({ ...task })) }));
}

function activeTasksFromPhases(phases: CanonicalTodoPhase[]): Set<string> {
  const tasks = new Set<string>();
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (OPEN_TODO_STATUSES.has(task.status)) tasks.add(task.content);
    }
  }
  return tasks;
}


function taskMatches(phases: CanonicalTodoPhase[], taskName: string): CanonicalTodoTask[] {
  for (const phase of phases) {
    const task = phase.tasks.find((candidate) => candidate.content === taskName);
    if (task) return [task];
  }
  return [];
}

function phaseMatches(phases: CanonicalTodoPhase[], phaseName: string): CanonicalTodoTask[] {
  return phases.find((phase) => phase.name === phaseName)?.tasks ?? [];
}

function allTodoTasks(phases: CanonicalTodoPhase[]): CanonicalTodoTask[] {
  return phases.flatMap((phase) => phase.tasks);
}

function resolveTodoTargets(
  phases: CanonicalTodoPhase[],
  taskName: string,
  phaseName: string
): TodoTargetBinding[] {
  if (taskName) {
    for (let phaseOrdinal = 0; phaseOrdinal < phases.length; phaseOrdinal++) {
      const phase = phases[phaseOrdinal];
      const index = phase.tasks.findIndex(task => task.content === taskName);
      if (index >= 0) return !phaseName || phaseName === phase.name
        ? [{ phase: phase.name, phaseOrdinal, index, content: taskName }] : [];
    }
    return [];
  }
  return phases.flatMap((phase, phaseOrdinal) => phaseName && phaseName !== phase.name ? []
    : phase.tasks.map((task, index) => ({ phase: phase.name, phaseOrdinal, index, content: task.content })));
}

function sameTodoTargets(left: TodoTargetBinding[], right: TodoTargetBinding[]): boolean {
  return left.length === right.length && left.every((target, index) =>
    target.phase === right[index]?.phase &&
    target.index === right[index]?.index &&
    target.content === right[index]?.content
  );
}



export interface GateRejectionOptions {
  gate: "Gate 1 Micro-Check" | "Gate 2 Macro-Check";
  taskId: string;
  reasons: string[];
  testCommand?: string;
  testExitCode?: number | null;
  planRequirements?: string[];
  scores?: {
    meetsCriteria?: number;
    drift?: string;
    scope?: string;
  };
  isUnavailable?: boolean;
  testEvasion?: boolean;
}

function sanitizeSafe(text: string): string {
  return sanitizeXmlText(text).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildGateRejectionMessage(opts: GateRejectionOptions): string {
  const safeTaskId = clampText(sanitizeSafe(opts.taskId), 200, "head");
  const safeTestCmd = opts.testCommand ? `$ ${clampText(sanitizeSafe(opts.testCommand), 200, "head")}` : "testCommand";
  const reasonsList = opts.reasons.length > 0 ? opts.reasons : ["Verification rejected without specific reason details."];
  const reasonLines = reasonsList.map((r) => `- ${clampText(sanitizeSafe(r), 400, "head")}`).join("\n");
  const actions: string[] = [];

  if (opts.isUnavailable) {
    actions.push(
      "1. TypeSafe evaluation service is unavailable. Do NOT alter codebase or tests evasively.",
      "2. Verify network connectivity and TYPESAFE_API_KEY environment configuration, or report outage to user."
    );
  } else if (opts.gate.includes("Gate 1")) {
    let actNum = 1;
    const reasonsLower = opts.reasons.join(" ").toLowerCase();
    if (
      reasonsLower.includes("test suite failed") ||
      (opts.testExitCode !== null && opts.testExitCode !== undefined && opts.testExitCode !== 0)
    ) {
      actions.push(
        `${actNum++}. Run ${safeTestCmd} locally to verify all assertions pass with clean exit code 0 before re-attempting completion.`
      );
    }
    if (opts.testEvasion) {
      actions.push(
        `${actNum++}. Review removed coverage or meaningful behavior before re-attempting completion. Deleting or weakening tests to fake completion is prohibited.`
      );
    }
    if (reasonsLower.includes("zero evidence")) {
      actions.push(
        `${actNum++}. Produce real implementation code changes or execute tests for "${safeTaskId}". Zero changes/tests observed.`
      );
    }
    if (actions.length === 0) {
      actions.push(
        `${actNum++}. Fix test failures or build errors identified above.`,
        `${actNum++}. Run testCommand locally to verify all assertions pass cleanly before re-attempting completion.`
      );
    }
    actions.push(`${actNum++}. Do NOT retry 'todo done' without modifying code or fixing test failures.`);
  } else {
    let actNum = 1;
    const reasonsLower = opts.reasons.join(" ").toLowerCase();
    if (opts.scores?.meetsCriteria !== undefined) {
      const scoreStr = `meets_criteria=${opts.scores.meetsCriteria.toFixed(2)}, drift=${opts.scores.drift || "none"}, scope=${opts.scores.scope || "none"}`;
      actions.push(`[Judge Evaluation]: ${scoreStr}`);
    }
    if (opts.scores?.scope === "REDUCTION" || reasonsLower.includes("scope reduction")) {
      const reqSnippet =
        opts.planRequirements && opts.planRequirements.length > 0
          ? ` Requirements: ${opts.planRequirements.slice(0, 3).map((r) => `"${clampText(sanitizeSafe(r), 300, "head")}"`).join(", ")}`
          : "";
      actions.push(
        `${actNum++}. Address omitted deliverables for "${safeTaskId}": complete all planned implementation criteria in-place.${reqSnippet}`
      );
    }
    if (opts.scores?.drift && opts.scores.drift !== "no_drift") {
      actions.push(
        `${actNum++}. Resolve architectural drift (${opts.scores.drift}): confine modifications strictly to planned task contracts.`
      );
    }
    if (actions.length === 0 || (actions.length === 1 && actions[0].startsWith("[Judge"))) {
      actions.push(
        `${actNum++}. Align implementation changes with the plan requirements.`,
        `${actNum++}. Re-read the phase acceptance criteria and remove any uncontracted drift.`
      );
    }
    actions.push(
      `${actNum++}. Do NOT retry 'todo done' immediately without implementing missing deliverables or addressing the above findings.`
    );
  }

  const msg = `Task completion rejected by TypeSafe Dual Verification Gate (${opts.gate}):\n${reasonLines}\nNEXT ACTIONS FOR AGENT:\n${actions.join("\n")}`;

  return clampText(msg, 3500, "head");
}
async function safeSendMessage(
  pi: { sendMessage: (msg: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<unknown> | unknown },
  msg: Record<string, unknown>,
  opts?: Record<string, unknown>
): Promise<void> {
  try {
    if (pi && typeof pi.sendMessage === "function") {
      await Promise.resolve(pi.sendMessage(msg, opts));
    }
  } catch {}
}

function supportsAdvisorHost(api: ExtensionAPI): api is ExtensionAPI & AdvisorHostAPI {
  const host = api as unknown as Record<string, unknown>;
  return host.events !== null && typeof host.events === "object"
    && ["getAllTools", "getActiveTools", "setActiveTools", "appendEntry"].every(name => typeof host[name] === "function");
}

export default function registerExtension(
  pi: ExtensionAPI,
  options: ExtensionRuntimeOptions = {}
): PlannerSessionState {
  const resolverOptions: PlannerSessionState["resolverOptions"] = {
    homeDir: options.homeDir ?? os.homedir(),
    env: options.env ?? process.env,
  };
  const policyClient = loadPolicyClientModule(pi);
  const toolPolicies = policyClient?.resolveToolPolicies(options.toolPolicies, {
    baseline: resolverOptions.env.TYPESAFE_BASELINE?.trim() || "review",
    lattice: resolverOptions.env.TYPESAFE_LATTICE
      ? resolverOptions.env.TYPESAFE_LATTICE.split(",").map((value) => value.trim())
      : ["auto", "review", "block"],
  });
  const resolver = loadResolverModule();
  const isProjectExcluded = createProjectExclusionPolicy(pi, cwd => {
    try { return resolver?.resolveTypeSafeProjectExclusion(cwd, { homeDir: resolverOptions.homeDir }).excluded === true; }
    catch { return false; }
  });
  const state: PlannerSessionState = {
    resolverOptions,
    generation: 0,
    revision: 0,
    phases: [],
    get activeContractedTasks() {
      return activeTasksFromPhases(this.phases);
    },
    taskBaselines: new Map<string, WorkspaceSnapshot>(),
    pendingRemediations: new Map<string, PendingRemediation>(),
    consecutiveFailuresByTask: new Map<string, number>(),
    lastFailureReasonByTask: new Map<string, string>(),
    debtByIncarnation: new Map(),
    stagedCalls: new Map<string, StagedTodoCall>(),
    committedCallTombstones: new Map<string, CommittedTodoCall>(),
    uninitialized: false,
  };
  const z = pi.zod;
  const pendingNativeObservations = new Set<string>();
  const exercisedBySession = new Map<string, Map<string, StagedTodoCall>>();
  function registerTool<T>(definition: ToolDefinition<T>): void {
    pi.registerTool({ ...definition, execute: (callId, params, signal, onUpdate, ctx) => {
      if (definition.name.startsWith("typesafe_") && isProjectExcluded(ctx)) return Promise.resolve(projectExcludedResult());
      const owned = freezeContractValue(structuredClone(params));
      return invocations.run(ctx, definition.name, callId, owned, () => definition.execute(callId, owned, signal, onUpdate, ctx));
    } });
  }
  const approvalPolicy = createSemanticApprovalPolicy(resolverOptions.env);
  const policyDigest = canonicalDigest({ policies: toolPolicies ?? null, approvalPolicy,
    commands: [{ id: "workspace-tests", command: "bun test", timeoutMs: 300_000 }] });
  const appendEntry = typeof pi.appendEntry === "function" ? pi.appendEntry.bind(pi) : undefined;
  const invocations = createHostToolInvocationRuntime(appendEntry);
  const contracts = appendEntry ? createContractRuntime({ appendEntry, invocations, policyDigest, approvedCommandIds: ["workspace-tests"] }) : undefined;
  const evidenceRuntime = contracts ? createTaskEvidenceRuntime({ contracts, invocations, commands(contract, cwd) {
    const commands = new Map<string, ApprovedVerificationCommand>();
    if (!contract.approvedCommandIds.includes("workspace-tests")) return commands;
    try {
      const allAssets = listWorkspaceFiles(cwd, "tests", { maxFiles: 10_000 });
      if (allAssets.length) {
        let changedFiles: string[] = [];
        try {
          const { execFileSync } = createRequire(import.meta.url)("node:child_process");
          const out = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd, encoding: "utf8", windowsHide: true });
          changedFiles = statusEvidencePaths(out);
        } catch {
          changedFiles = contract.allowedMutationScope.paths.filter(p => p !== "**");
        }
        const assets = selectVerificationTestAssets(cwd, allAssets, changedFiles);
        const testCmd = `bun test --timeout 30000 ${assets.map(a => `"${a}"`).join(" ")}`;
        commands.set("workspace-tests", {
          id: "workspace-tests", command: testCmd, cwd, criterionIds: contract.criteria.map(criterion => criterion.id),
          testAssetPaths: assets, timeoutMs: 300_000, kind: contract.taskKind === "implementation" ? "verification" : "diagnostic",
        });
      }
    } catch { /* Missing or unsafe assets cannot become an executable verification command. */ }
    return commands;
  } }) : undefined;
  let advisorRegistration: AdvisorHostRegistration | undefined;
  const verificationRuntime = contracts && evidenceRuntime && appendEntry ? createTaskVerificationRuntime({
    contracts, evidence: evidenceRuntime, invocations, policyDigest, approvalPolicy, appendEntry,
    privacy: { apiKey: resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "", homeDirs: [resolverOptions.homeDir] },
    createClient: (ctx, purpose, validatePrepared) => createExtensionJudgeClient(
      resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "", undefined, ctx, purpose, validatePrepared),
    getAdvisorReviews: async ctx => advisorRegistration ? advisorRegistration.reviews(ctx as AdvisorHostExecuteContext) : [],
  }) : undefined;
  const lifecycleAuthority = contracts && appendEntry ? createTodoLifecycleAuthority({
    appendEntry, project: ctx => contracts.projection(ctx), apiKey: resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "",
    hasDebt: (ctx, incarnation) => verificationRuntime?.hasDebt(ctx, incarnation.incarnationId) === true,
  }) : undefined;
  const privacyDigest = canonicalDigest({ projection: "canonical-public-v1", thinking: "excluded", homeRedaction: true });
  const evaluationHost = appendEntry && policyClient && loadApiClientModule() ? (() => {
    try {
      const { createEvaluationHost } = nodeRequire("./src/evaluation-host.ts") as {
        createEvaluationHost: typeof import("./src/evaluation-host").createEvaluationHost;
      };
      const { createPairedReviewDriver } = nodeRequire("./src/atomic-evaluation.ts") as {
        createPairedReviewDriver: typeof import("./src/atomic-evaluation").createPairedReviewDriver;
      };
      return createEvaluationHost({
        getRegistration: () => advisorRegistration,
        facts(ctx) {
          const branch = readHostBranch(ctx);
          if (!branch) throw new Error("actual_host_branch_required");
          const root = fileURLToPath(new URL(".", import.meta.url));
          const files = ["typesafe-planner.ts", ...listWorkspaceFiles(root, "src", { maxFiles: 10_000 }),
            ...listWorkspaceFiles(root, "tools", { maxFiles: 10_000 })].sort();
          return { branchId: branch.branchId, requestEntryId: invocations.current(ctx)?.entryId ?? branch.entries[branch.entries.length - 1].id,
            policyDigest, privacyDigest, candidateSourceManifestDigest: canonicalDigest(files.map(file => ({
              path: file, sha256: readWorkspaceFile(root, file, { maxBytes: 4 * 1024 * 1024 }).sha256,
            }))) };
        },
        driverOptions: () => ({ trustedPolicy: toolPolicies?.evaluation, apiKey: resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "", approvalPolicy }),
        async requestHumanApproval(summary, ctx) {
          const host = ctx as AdvisorHostExecuteContext & { hasUI?: boolean; ui?: { confirm?(title: string, message: string): Promise<boolean> } };
          return host.hasUI === true && typeof host.ui?.confirm === "function"
            && await host.ui.confirm("Authorize exact paid shadow evaluation?", summary) === true;
        },
        appendEntry, createDriver: createPairedReviewDriver,
        projectPublic(value) {
          const client = loadApiClientModule();
          if (!client) throw new Error("canonical_public_projection_required");
          return client.redactEvidenceState(value, { apiKey: resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "", homeDirs: [resolverOptions.homeDir] });
        },
      });
    } catch { return undefined; }
  })() : undefined;
  const hostServices: AdvisorHostServices | undefined = verificationRuntime ? {
    trustedAdvisorPolicy: toolPolicies?.advisor,
    prepareReview: (...args) => verificationRuntime.advisorServices.prepareReview(...args),
    createTaskRequest: (params, ctx, callId, preparation) =>
      (preparation.draft.binding.purpose === "shadow" && evaluationHost ? evaluationHost.shadowServices : verificationRuntime.advisorServices)
        .createTaskRequest(params, ctx, callId, preparation),
    createConsultationRequest: (...args) => verificationRuntime.advisorServices.createConsultationRequest(...args),
    onReceipt: (receipt, ctx) => (receipt.binding.purpose === "shadow" && evaluationHost ? evaluationHost.shadowServices : verificationRuntime.advisorServices).onReceipt(receipt, ctx),
    isCurrent: (request, ctx) => (request.binding.purpose === "shadow" && evaluationHost ? evaluationHost.shadowServices : verificationRuntime.advisorServices).isCurrent(request, ctx),
    deadline: (request, ctx) => (request.binding.purpose === "shadow" && evaluationHost ? evaluationHost.shadowServices : verificationRuntime.advisorServices).deadline?.(request, ctx),
  } : undefined;
  if (verificationRuntime && hostServices && supportsAdvisorHost(pi)) advisorRegistration = registerAdvisorHost(pi, hostServices, {
    isProjectExcluded: ctx => isProjectExcluded(ctx),
    mutationDelegation: {
      capture: ctx => contracts && !state.stagedCalls.size ? currentSourceMutationGrant(contracts, ctx, getProjectDir(ctx), policyDigest) : undefined,
      isCurrent: (grant, ctx) => Boolean(contracts && !state.stagedCalls.size
        && sourceMutationGrantCurrent(grant, contracts, ctx, getProjectDir(ctx), policyDigest)),
    },
    nativeTodo: {
      beforeExecute: (params, ctx, callId, signal) => invocations.run(ctx, "todo", callId, params, async () => {
        if (isProjectExcluded(ctx)) {
          const normalized = normalizeNativeTodoInput(params);
          if (!normalized.valid) return { status: "EVIDENCE_REQUIRED" as const, reasons: [normalized.reason] };
          return { status: "READY" as const, input: normalized.input };
        }
        try {
          await reconcileNativeCommits(ctx);
          pruneTodoTransactions();
          await stageNativeTodoCall({ input: params, toolCallId: callId }, ctx, signal);
          const normalized = normalizeNativeTodoInput(params);
          if (!normalized.valid) return { status: "EVIDENCE_REQUIRED" as const, reasons: [normalized.reason] };
          return { status: "READY" as const, input: state.stagedCalls.get(callId)?.input ?? normalized.input };
        } catch (error) {
          if (error instanceof NativeTodoGuardError && error.outcome) return error.outcome;
          return { status: "EVIDENCE_REQUIRED" as const, reasons: [error instanceof NativeTodoGuardError ? error.message : "native_preflight_unavailable"] };
        }
      }),
      afterExecute(params, ctx, callId, result) {
        if (isProjectExcluded(ctx)) return;
        const staged = state.stagedCalls.get(callId);
        if (!staged) return;
        staged.nativeResultObserved = true;
        pendingNativeObservations.add(callId);
        const native = result && typeof result === "object" ? result as Record<string, unknown> : undefined;
        verificationRuntime.observeNativeResult(ctx, staged.verificationStages, {
          callId, input: params, before: staged.preCommitPhases, details: native?.details, isError: native?.isError,
        });
      },
    },
  });

  function publicResult(value: unknown): ExtensionToolResult {
    const client = loadApiClientModule();
    if (!client || typeof client.redactEvidenceState !== "function") return shortError("public_projection_unavailable");
    const details = client.redactEvidenceState(value, { apiKey: resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "", homeDirs: [resolverOptions.homeDir] });
    return { content: [{ type: "text", text: JSON.stringify(details) }], details };
  }
  const taskSelectorSchema = { task: z.string(), phase: z.string().optional() };
  registerTool({
    name: "typesafe_bind_task", label: "Bind genuine native task source", approval: "exec",
    description: "Freeze the exact current Core todo incarnation and genuine original user request. Optional plan/phase is explicit source context, never the newest plan. Implementation scope needs actual cook or real host confirmation; proposed flags cannot authorize it.",
    parameters: z.object({ ...taskSelectorSchema, planPath: z.string().optional(), phaseHeading: z.string().optional(), originalUserEntryId: z.string().optional() }),
    async execute(callId, params: ContractBindingProposal, _signal, _onUpdate, ctx) {
      if (!contracts) return publicResult({ status: "UNAVAILABLE", reasons: ["Supported host appendEntry and actual session history are required."] });
      const outcome = await contracts.bind(ctx, callId, params);
      if (outcome.status === "BOUND" && evidenceRuntime && !await evidenceRuntime.captureBaseline(ctx, outcome.contract)) {
        return publicResult({ status: "EVIDENCE_REQUIRED", contract: outcome.contract,
          reasons: ["Exact source was bound, but an authenticated pre-change workspace baseline is unavailable. No completion authority was granted."] });
      }
      return publicResult(outcome);
    },
  });
  registerTool({
    name: "typesafe_collect_evidence", label: "Collect authentic bounded task evidence", approval: "exec",
    description: "Collect current source and fixed approved command receipts outside native preflight. Returns public hashes/manifests, not portable approval. Curation selects exact cached lines and retains every original criterion, omission, and parent obligation.",
    parameters: z.object({ ...taskSelectorSchema, commandId: z.string().optional(), artifactPaths: z.array(z.string()).optional(), selections: z.array(z.unknown()).optional() }),
    async execute(callId, params: TaskEvidenceCollectParams, _signal, _onUpdate, ctx) {
      if (!evidenceRuntime) return publicResult({ status: "UNAVAILABLE", reasons: ["Supported task contract and evidence host are required."] });
      const result = await evidenceRuntime.collect(ctx, callId, params);
      const record = result.record;
      return publicResult({ status: result.status, reasons: result.reasons, recordId: record?.id, contract: record?.contract,
        evaluatedTreeDigest: record?.evidence.evaluatedTreeDigest, criteria: record?.contract.criteria,
        sourceManifest: record?.sourceManifest.source, packetManifest: record?.packetSet.manifest, provenance: record?.provenance,
        nextActions: result.status === "CURATION_REQUIRED"
          ? ["Retrieve necessary cached source ranges, then provide explicit selections covering all original task criteria; no summary or omitted parent proof counts as completion."]
          : undefined });
    },
  });
  registerTool({
    name: "typesafe_retrieve_evidence", label: "Retrieve authenticated cached source spans", approval: "read",
    description: "Read exact cached source under the current task binding and full-file SHA. Large results require explicit line spans; no caller excerpt, ambient file reopening, silent clipping, or portable authorization.",
    parameters: z.object({ ...taskSelectorSchema, path: z.string(), fullFileDigest: z.string(), spans: z.array(z.unknown()).optional() }),
    async execute(_callId, params: ContractTaskSelector & SourceRetrievalRequest, _signal, _onUpdate, ctx) {
      const record = evidenceRuntime?.get(ctx, params);
      if (!record || !evidenceRuntime) return publicResult({ status: "EVIDENCE_REQUIRED", reasons: ["Collect current authenticated task source first."] });
      const result = evidenceRuntime.retrieve(ctx, record, { path: params.path, fullFileDigest: params.fullFileDigest, spans: params.spans });
      const client = loadApiClientModule();
      if (!client) return shortError("public_projection_unavailable");
      const projection = client.redactEvidenceState(result, { apiKey: resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "", homeDirs: [resolverOptions.homeDir] });
      if (Buffer.byteLength(JSON.stringify(projection), "utf8") > 16_384) return publicResult({ status: "EVIDENCE_REQUIRED",
        reasons: ["Requested source exceeds the read-output budget. Supply smaller exact line ranges; no bytes were silently clipped."] });
      return publicResult({ retrieval: projection, originalFullFileDigest: params.fullFileDigest,
        returnedRepresentationDigest: canonicalDigest(projection), representation: "canonical-redacted" });
    },
  });
  registerTool({
    name: "typesafe_review_task", label: "Review bound task outside native preflight", approval: "exec",
    description: "Evaluate current authentic task evidence with the unchanged M rubric and actual independent Advisor receipt. H remains shadow-only. Returns typed prerequisites or approval-pending-commit; never changes native lifecycle.",
    parameters: z.object(taskSelectorSchema),
    async execute(callId, params: ContractTaskSelector, _signal, _onUpdate, ctx) {
      return publicResult(verificationRuntime ? await verificationRuntime.review(ctx, callId, params)
        : { status: "UNAVAILABLE", component: "host", reasons: ["Supported contract/evidence/real Advisor host is required."] });
    },
  });
  registerTool({
    name: "typesafe_prepare_todo_mutation", label: "Prepare exact lifecycle recovery", approval: "exec",
    description: "Prepare block/drop/removal/replacement outside native preflight. Blocking needs owner, next action, unblock condition and resume command; exports a guarded durable public handoff. Scope reduction or blocking rejection debt requires genuine host human confirmation. No completion or debt forgiveness.",
    parameters: z.object({ input: z.unknown(), handoff: z.unknown().optional() }),
    async execute(_callId, params: LifecyclePreparationInput, _signal, _onUpdate, ctx) {
      refreshTodoState(ctx);
      return publicResult(lifecycleAuthority ? await lifecycleAuthority.prepare(ctx, params)
        : { status: "UNAVAILABLE", reasons: ["Supported host lifecycle and persistent recovery are required."] });
    },
  });
  registerTool({
    name: "typesafe_resolve_historical_debt", label: "Reconcile exact historical debt", approval: "exec",
    description: "Request genuine host human reconciliation for exact historical debt IDs on a completed, abandoned or removed incarnation. Does not approve native completion, forgive another incarnation, or mutate Core state.",
    parameters: z.object({ incarnationId: z.string(), reason: z.string() }),
    async execute(callId, params: { incarnationId: string; reason: string }, _signal, _onUpdate, ctx) {
      return publicResult(verificationRuntime ? await verificationRuntime.resolveHistoricalDebt(ctx, callId, params)
        : { status: "UNAVAILABLE", reasons: ["Supported historical debt host required."] });
    },
  });
  registerTool({
    name: "typesafe_recovery_report", label: "Export durable task recovery", approval: "exec",
    description: "Export the actual bound task recovery state as a guarded public report with owner, next action, release condition and resume command. No native mutation, semantic retry or debt forgiveness.",
    parameters: z.object(taskSelectorSchema),
    async execute(_callId, params: ContractTaskSelector, _signal, _onUpdate, ctx) {
      const recovery = verificationRuntime?.getRecovery(ctx, params);
      if (!recovery) return publicResult({ status: "EVIDENCE_REQUIRED", reasons: ["No applicable bound recovery state exists; bind/review or inspect the original failure first."] });
      const projection = publicResult({ recovery }).details;
      const content = `# TypeSafe recovery handoff\n\n${JSON.stringify(projection, null, 2)}\n`;
      const file = writeRecoveryReport(getProjectDir(ctx), { id: crypto.randomUUID(), content });
      return publicResult({ status: "RECOVERY_EXPORTED", ...file, recovery: projection, authority: "none" });
    },
  });
  registerTool({
    name: "typesafe_eval_host", label: "Native signed shadow evaluation bridge", approval: "exec",
    description: "Finite identity/authorize/prepare/collect bridge for frozen real paired M/H evaluation. Requires actual host human approval of genuine labels, exact models, operating points and paid budget; never approves native todo or deployment.",
    parameters: z.object({ action: z.enum(["identity", "authorize", "prepare", "collect"]), run: z.string().optional(), protocolPath: z.string().optional(), requestId: z.string().optional() }),
    async execute(_callId, params: { action: "identity" | "authorize" | "prepare" | "collect"; run?: string; protocolPath?: string; requestId?: string }, signal, _onUpdate, ctx) {
      if (!evaluationHost) return publicResult({ status: "UNAVAILABLE", reasons: ["Supported real native host required."] });
      const host = ctx as AdvisorHostExecuteContext;
      try {
        if (params.action === "identity") return await evaluationHost.identity(host);
        if (params.action === "authorize") return await evaluationHost.authorizeRun(params, host);
        if (params.action === "prepare") return await evaluationHost.prepare(params, host);
        return await evaluationHost.collect(params, host, signal);
      } catch {
        return publicResult({ status: "UNAVAILABLE", reasons: ["Exact frozen host, source, corpus, original response or genuine authorization could not be authenticated. No substitute observation was fabricated."] });
      }
    },
  });
  pi.on("input", (event, ctx) => contracts?.captureCookInput(ctx, event));
  let originProofEmitted = false;

  // Session pre-flight probe is diagnostic only; todo state is always owned by
  // this factory's returned PlannerSessionState.
    const PROMPT_INJECTION =
      "Native todos retain exact goals and incarnations from actual Core history. Bind the current target with typesafe_bind_task, collect approved evidence/command receipts using typesafe_collect_evidence, then call typesafe_review_task for the unchanged M assessment. Prepare an independent review with typesafe_prepare_advisor, execute its returned native task, then call typesafe_review_task again to compose the applicable cached M result with the actual Advisor receipt. No unchanged semantic dispatch is repeated merely because an Advisor receipt was added. Only afterward call native todo done; its short preflight runs no HTTP, test command, or child reasoning. Native arguments accept no extra requirements, testCommand, approval, human, EGC, or lifecycle flags." +
      "\nThe default M rubric and raw probabilities are unchanged. H/atomic remains a shadow candidate until actual independent human holdout adoption. Missing full evidence is EVIDENCE_REQUIRED, not semantic failure; outages are UNAVAILABLE. Never retry unchanged semantic rejection, lower thresholds, rewrite a verdict, fake human/Advisor authority, or treat child passes as parent integration. Ordinary turn boundaries do not discard genuine applicable reviews." +
      "\nAUTONOMOUS RESOLUTION PROTOCOL: DO NOT freeze, block, or drop todos upon test failures or missing evidence! The agent MUST autonomously execute the 5-step resolution loop: (1) Self-research root causes via read/find/grep/docs; (2) Reason & design technical repairs; (3) Execute code/test updates; (4) Run real tests (bun test) and collect objective evidence via typesafe_collect_evidence; (5) Review via typesafe_review_task and independent Advisor to achieve APPROVED_PENDING_COMMIT, then complete and clear the todo via todo done. If a task is currently blocked, call todo(op=\"unblock\", task=\"...\") then todo(op=\"start\", task=\"...\") to resume and complete it autonomously. NEVER park, freeze, or drop todos upon test failures or missing review; continue refining code and tests autonomously until verified. Only after bun test passes with exit code 0 and clean AST diff, review and clear the todo via todo done. A matching settled actual Core result is required for finality.";
  pi.on("session_start", async (_event: unknown, ctx: unknown) => {
    invalidateTodoState(ctx);
    // Explicit exclusion is latched per native session: no extension prompt,
    // origin proof, health probe, or TypeSafe semantic workflow is emitted.
    if (isProjectExcluded(ctx)) return;
    const context = ctx as { agent?: { kind?: string }; ui?: { notify?(message: string, kind: string): void } } | undefined;
    if (context?.agent?.kind === "sub") return;
    if (!originProofEmitted) {
      originProofEmitted = true;
      await safeSendMessage(pi, { customType: "typesafe-health", content: JSON.stringify(getRuntimeOriginProof()), display: false });
      await safeSendMessage(pi, { customType: "typesafe-planner", content: PROMPT_INJECTION, display: false }, { deliverAs: "nextTurn" });
    }
    const apiKey = resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "";
    const resolver = loadResolverModule();
    const healthPolicy = toolPolicies?.health;
    const resolvedWire = resolver?.resolveTypeSafeEnabled(getProjectDir(ctx), resolverOptions);
    if (!apiKey || !resolvedWire?.enabled || !policyClient || !healthPolicy?.ok) return;
    if (loadApiClientModule()?.checkCredentialCooldown(apiKey)) {
      const skipped = "TypeSafe warning: diagnostic probe skipped while the credential is unavailable.";
      try { await Promise.resolve(context?.ui?.notify?.(skipped, "warning")); } catch { /* host UI failure never changes the skip */ }
      await safeSendMessage(pi, { customType: "typesafe-health", content: skipped, display: true });
      return;
    }
    let outcome: TypeSafeJudgeResult;
    try {
      outcome = await policyClient.judgeWithPolicy({
        args: { state: "Transport availability diagnostic, not task verification.", questions: { ping: { type: "noul", instructions: "Return whether this diagnostic request was received." } }, model: "jev-latest" },
        purpose: "health", trustedPolicy: healthPolicy, apiKey, fetchImpl: globalThis.fetch,
        timeoutMs: 3000, totalBudgetMs: 3000, maxAttempts: 1,
        dialect: resolvedWire.dialect, endpoint: resolvedWire.endpoint, baseUrl: resolvedWire.baseUrl,
      });
    } catch {
      await safeSendMessage(pi, { customType: "typesafe-health", content: "TypeSafe diagnostic implementation unavailable; no network diagnosis or task rejection is inferred.", display: true });
      return;
    }
    const message = outcome.ok
      ? `TypeSafe: ONLINE (jev-latest). Transport only; resolved model: ${outcome.metadata.resolvedModel ?? "unreported"}. This is not semantic approval.`
      : outcome.authError
        ? "TypeSafe warning: TYPESAFE_API_KEY is invalid or expired. Check your environment configuration. No task was semantically rejected."
        : outcome.code === "http_404"
          ? "TypeSafe warning: TypeSafe API routing failed (404). Check models.yml baseUrl configuration. No task was semantically rejected."
          : outcome.code === "network_error" || outcome.code === "timeout"
            ? "TypeSafe warning: TypeSafe API unreachable. Check internet connection or proxy settings. No task was semantically rejected."
            : `TypeSafe warning: Pre-flight diagnostic probe unavailable (${outcome.code}). No task was semantically rejected.`;
    try { await Promise.resolve(context?.ui?.notify?.(message, outcome.ok ? "info" : "warning")); }
    catch { await safeSendMessage(pi, { customType: "typesafe-ui-unavailable", content: "Health notification UI failed; the transport result is unchanged.", display: false }); }
    await safeSendMessage(pi, { customType: "typesafe-health", content: message, display: true });
  });
  function phasesFromBranch(ctx: unknown): CanonicalTodoPhase[] | undefined {
    const branch = readHostBranch(ctx);
    if (!branch) return undefined;
    for (const native of state.nativeHistory?.incarnations ?? []) {
      const content = native.target.content;
      const reason = state.lastFailureReasonByTask.get(content);
      const remediation = state.pendingRemediations.get(content);
      const failures = state.consecutiveFailuresByTask.get(content);
      if (reason !== undefined || remediation !== undefined || failures !== undefined) {
        state.debtByIncarnation.set(native.incarnationId, { reason, remediation, failures });
      }
    }
    const projection = contracts?.projection(ctx) ?? projectHostHistory(branch, getProjectDir(ctx));
    const order = new Map(branch.entries.map((entry, index) => [entry.id, index]));
    const events = [...projection.nativeFailures, ...projection.nativeSuccesses]
      .sort((a, b) => (order.get(a.resultEntryId) ?? -1) - (order.get(b.resultEntryId) ?? -1));
    for (const event of events) {
      for (const target of event.targets) {
        if (!target.before) continue;
        if (event.outcome === "native_failure" && event.operation === "done"
          && !state.debtByIncarnation.has(target.before.incarnationId)) {
          state.debtByIncarnation.set(target.before.incarnationId, {
            reason: `Unclassified native verification failure (${event.resultEntryId}); inspect the exact original operation and evidence.`,
          });
        } else if (event.outcome === "native_success" && event.operation === "done" && target.completionReported
          && target.beforeStatus !== "completed" && target.afterStatus === "completed"
          && target.before.incarnationId === target.after?.incarnationId) {
          state.debtByIncarnation.delete(target.before.incarnationId);
        }
      }
    }
    const legacyRemediations = new Map(state.pendingRemediations);
    const legacyReasons = new Map(state.lastFailureReasonByTask);
    const legacyFailures = new Map(state.consecutiveFailuresByTask);
    state.nativeHistory = projection;
    state.lastFailureReasonByTask.clear();
    state.pendingRemediations.clear();
    state.consecutiveFailuresByTask.clear();
    for (const native of projection.incarnations) {
      const debt = state.debtByIncarnation.get(native.incarnationId);
      if (!debt) continue;
      if (debt.reason !== undefined) state.lastFailureReasonByTask.set(native.target.content, debt.reason);
      if (debt.remediation !== undefined) state.pendingRemediations.set(native.target.content, debt.remediation);
      if (debt.failures !== undefined) state.consecutiveFailuresByTask.set(native.target.content, debt.failures);
    }
    for (const [task, remediation] of legacyRemediations) {
      const active = projection.nativePhases?.some(phase => phase.tasks.some(candidate =>
        candidate.content === task && candidate.status !== "completed" && candidate.status !== "abandoned"));
      const reincarnated = projection.nativeSuccesses.some(event => ["drop", "rm", "append"].includes(event.operation)
        && event.targets.some(target => target.before?.target.content === task || target.after?.target.content === task));
      if (!active || reincarnated || state.pendingRemediations.has(task)) continue;
      state.pendingRemediations.set(task, remediation);
      const reason = legacyReasons.get(task); if (reason !== undefined) state.lastFailureReasonByTask.set(task, reason);
      const failures = legacyFailures.get(task); if (failures !== undefined) state.consecutiveFailuresByTask.set(task, failures);
    }
    state.uninitialized = !projection.nativeStateReliable && branch.entries.some(entry =>
      entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolName === "todo"
      || entry.type === "custom" && entry.customType === "user_todo_edit");
    return projection.nativePhases ? cloneTodoPhases(projection.nativePhases) : undefined;
  }

  function pruneTodoTransactions(now = Date.now()): void {
    for (const [callId, stage] of state.stagedCalls) {
      if (!stage.nativeResultObserved && now - stage.createdAt > TODO_STAGE_TTL_MS) state.stagedCalls.delete(callId);
    }
    for (const [callId, tombstone] of state.committedCallTombstones) {
      if (now - tombstone.committedAt > TODO_STAGE_TTL_MS) state.committedCallTombstones.delete(callId);
    }
  }

  function refreshTodoState(ctx: unknown): void {
    const phases = phasesFromBranch(ctx);
    if (!phases) return;
    if (JSON.stringify(phases) !== JSON.stringify(state.phases)) {
      state.phases = phases;
      state.revision++;
      for (const [callId, stage] of state.stagedCalls) if (!stage.nativeResultObserved) state.stagedCalls.delete(callId);
    }
  }

  function invalidateTodoState(ctx: unknown): void {
    lifecycleAuthority?.invalidate();
    evidenceRuntime?.clear(ctx);
    verificationRuntime?.invalidate(ctx, "session_lifecycle_changed");
    for (const [callId, stage] of state.stagedCalls) if (stage.nativeResultObserved) {
      let observed = exercisedBySession.get(stage.sessionId);
      if (!observed) { observed = new Map(); exercisedBySession.set(stage.sessionId, observed); }
      observed.set(callId, stage);
    }
    pendingNativeObservations.clear();
    state.generation++;
    state.revision++;
    state.stagedCalls.clear();
    // An observed Core result is retained off-state until its authentic settled result
    // re-enters this session. Lifecycle transitions must not leave a pre-persistence
    // completion stage live on the new branch.
    state.committedCallTombstones.clear();
    state.taskBaselines.clear();
    state.lastCheckpoint = undefined;
    const phases = phasesFromBranch(ctx);
    if (phases) state.phases = phases;
    else if (readHostBranch(ctx)) state.phases = [];
    else state.uninitialized = true;
  }


  async function stageNativeTodoCall(evt: Record<string, unknown>, ctx: unknown, signal?: AbortSignal): Promise<void> {
    const rawInput = evt.input;
    const normalized = normalizeNativeTodoInput(rawInput);
    if (!normalized.valid) throw new NativeTodoGuardError(normalized.reason);
    const params = normalized.input;
    if (params.op === "view") return;
    refreshTodoState(ctx);
    const operation = readNativeTodoOperation(params, state.phases);
    if (!operation || !MUTATING_TODO_OPS.has(operation)) return;
    if (state.uninitialized) throw new NativeTodoGuardError("todo_state_uninitialized: observe actual native view before preparing a mutation.");
    const callId = typeof evt.toolCallId === "string" ? evt.toolCallId : "";
    if (!callId) throw new NativeTodoGuardError("todo_call_id_missing");
    const sessionId = readHostBranch(ctx)?.sessionId;
    if (!sessionId) throw new NativeTodoGuardError("actual_native_session_required");
    if (state.stagedCalls.has(callId) || state.committedCallTombstones.has(callId)) throw new NativeTodoGuardError("todo_call_id_duplicate");
    if (state.stagedCalls.size) throw new NativeTodoGuardError("todo_native_commit_pending: wait for the actual settled Core result; do not retry semantic evaluation.");
    const inputHash = nativeTodoInputDigest(rawInput);
    const generation = state.generation;
    const revision = state.revision;
    const taskName = params.task ?? "";
    const phaseName = params.phase ?? "";
    let targetBindings = ["done", "drop", "rm", "block", "unblock", "start"].includes(operation)
      ? resolveTodoTargets(state.phases, taskName, phaseName) : [];
    if (operation === "done") targetBindings = targetBindings.filter(target =>
      state.phases[target.phaseOrdinal]?.tasks[target.index]?.status !== "completed");
    const verificationStages: NativeTaskVerificationStage[] = [];
    const controller = new AbortController();
    const currentSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), options.preflightBudgetMs ?? 22_000);
    let provenance: StagedTodoCall["provenance"] = "gate1";
    try {
      if (operation === "done" && targetBindings.length) {
        if (!verificationRuntime) throw new NativeTodoGuardError("UNAVAILABLE: supported host contract, evidence, and real Advisor registration are required.");
        for (const target of targetBindings) {
          const result = await verificationRuntime.preflight(ctx, { task: target.content, phase: target.phase }, "done", currentSignal);
          if (result.status !== "APPROVED_PENDING_COMMIT") {
          const remediation = formatAdvisorAutoRemediation(target.content, target.phase, result.reasons);
          throw new NativeTodoGuardError(`${JSON.stringify(result)}\n${remediation}`, result);
        }
          if (result.stage.target.phase !== target.phase || result.stage.target.phaseOrdinal !== target.phaseOrdinal
            || result.stage.target.ordinal !== target.index || result.stage.target.content !== target.content) {
            throw new NativeTodoGuardError("todo_review_target_mismatch");
          }
          verificationStages.push(result.stage);
        }
        provenance = "judge";
      } else if (["init", "drop", "rm", "block"].includes(operation)) {
        if (!lifecycleAuthority) throw new NativeTodoGuardError("UNAVAILABLE: supported host lifecycle history is required.");
        const result = await lifecycleAuthority.consume(ctx, params);
        if (!result.allowed) throw new NativeTodoGuardError(result.reason);
        if (operation !== "block" && (operation !== "init" || state.phases.length)) provenance = "human";
      }
      if (currentSignal.aborted) throw new NativeTodoGuardError("preflight_budget_exhausted");
      if (nativeTodoInputDigest(rawInput) !== inputHash || state.generation !== generation || state.revision !== revision) {
        throw new NativeTodoGuardError("todo_state_revised");
      }
      const affectedTasks = targetBindings.map(target => target.content);
      state.stagedCalls.set(callId, {
        toolCallId: callId, sessionId, inputHash, input: params, generation, revision, createdAt: Date.now(), op: operation,
        affectedTasks, targetBindings, replacedTasks: operation === "init" ? allTodoTasks(state.phases).map(task => task.content) : [],
        preCommitPhases: cloneTodoPhases(state.phases), workspaceSnapshot: verificationStages[0]?.snapshot,
        verificationStages, nativeResultObserved: false,
        pendingReports: ["done", "drop", "rm"].includes(operation) && affectedTasks.length ? [{
          kind: operation === "done" ? "DONE" : "DROP", tasks: affectedTasks, approved: true, decidedBy: provenance, reasons: [],
        }] : [],
        provenance,
      });
    } finally {
      clearTimeout(timer);
    }
  }
  async function handleExcludedMutationGuard(event: unknown, ctx: unknown): Promise<void> {
    const evt = event && typeof event === "object" ? event as Record<string, unknown> : {};
    const toolName = typeof evt.toolName === "string" ? evt.toolName : "";
    if (toolName !== "write" && toolName !== "edit") return;
    const targets = fileMutationTargets(toolName, evt.input);
    if (!targets.length) {
      const raw = evt.input && typeof evt.input === "object" ? evt.input as Record<string, unknown> : {};
      if (typeof raw.path === "string" && /^(?!file:)[a-z][a-z0-9+.-]*:\/\//i.test(raw.path)) return;
      throw new NativeTodoGuardError("EVIDENCE_REQUIRED: unsupported local file-mutation wire shape; use the supported write/hashline edit ABI.");
    }
    const cwd = getProjectDir(ctx);
    for (const target of targets) {
      if (/^file:/i.test(target.path)) throw new NativeTodoGuardError("Use a canonical local path for file URI aliases cannot bypass source guards.");
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target.path)) continue;
      const resolved = path.resolve(cwd, target.path);
      const normalized = resolved.replace(/\\/g, "/");
      const baseName = path.basename(resolved).toLowerCase();
      if (normalized.toLowerCase().includes("/.omp/agent/extensions/typesafe-planner.ts")) throw new NativeTodoGuardError("Global OMP proxy is immutable. Edit only the development workspace and use the authorized managed sync path.");
      if (baseName === "todo.json" || baseName.startsWith(".todo")) throw new NativeTodoGuardError("Direct native todo storage edits are prohibited; use the real Core todo tool.");
      const deployment = path.join(resolverOptions.homeDir, "Projects", "omp_extension");
      const deployedRelative = path.relative(deployment, resolved);
      if (deployedRelative && !path.isAbsolute(deployedRelative) && !deployedRelative.split(path.sep).includes("..")) throw new NativeTodoGuardError("Direct active deployment writes are prohibited; use the reviewed managed sync transaction.");
    }
  }

  async function handleTodoInterception(event: unknown, ctx: unknown): Promise<void> {
    if (!event || typeof event !== "object") return;
    const evt = event as Record<string, unknown>;
    const toolName = evt.toolName as string | undefined;
    if (toolName === "todo") {
      const normalized = normalizeNativeTodoInput(evt.input);
      if (!normalized.valid) throw new NativeTodoGuardError(normalized.reason);
      if (normalized.input.op !== "view" && !advisorRegistration?.todoReady(ctx as AdvisorHostExecuteContext)) {
        throw new NativeTodoGuardError("UNAVAILABLE: the actual same-native todo execution guard is not active.");
      }
      return;
    }
    if (toolName === "write" || toolName === "edit") {
      const targets = fileMutationTargets(toolName, evt.input);
      if (!targets.length) {
        const raw = evt.input && typeof evt.input === "object" ? evt.input as Record<string, unknown> : {};
        if (typeof raw.path === "string" && /^(?!file:)[a-z][a-z0-9+.-]*:\/\//i.test(raw.path)) return;
        throw new NativeTodoGuardError("EVIDENCE_REQUIRED: unsupported local file-mutation wire shape; use the supported write/hashline edit ABI.");
      }
      const cwd = getProjectDir(ctx);
      const bundleRoot = fileURLToPath(new URL(".", import.meta.url));
      const protectedSources = new Set(["typesafe-planner.ts", ...listWorkspaceFiles(bundleRoot, "src", { maxFiles: 10_000 }),
        ...listWorkspaceFiles(bundleRoot, "tools", { maxFiles: 10_000 })]);
      const direct = contracts && !state.stagedCalls.size ? currentSourceMutationGrant(contracts, ctx, cwd, policyDigest) : undefined;
      const delegated = await advisorRegistration?.delegatedMutationScope(ctx as AdvisorHostExecuteContext);
      for (const target of targets) {
        if (/^file:/i.test(target.path)) throw new NativeTodoGuardError("Use a canonical local path for file mutation; file URI aliases cannot bypass source guards.");
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target.path)) continue;
        const resolved = path.resolve(cwd, target.path);
        const normalized = resolved.replace(/\\/g, "/");
        const relative = path.relative(cwd, resolved).replace(/\\/g, "/");
        const baseName = path.basename(resolved).toLowerCase();
        if (normalized.toLowerCase().includes("/.omp/agent/extensions/typesafe-planner.ts")) {
          throw new NativeTodoGuardError("Global OMP proxy is immutable. Edit only the development workspace and use the authorized managed sync path.");
        }
        if (baseName === "todo.json" || baseName.startsWith(".todo")) {
          throw new NativeTodoGuardError("Direct native todo storage edits are prohibited; use the real Core todo tool.");
        }
        const isPlan = !normalized.includes("/plans/reports/") && (baseName === "plan.md" || /^phase-.*\.md$/i.test(baseName));
        if (isPlan && requestsPlanCompletion(target.content)) {
          await assertScopedPlanClosure(contracts, verificationRuntime, ctx, cwd, resolved);
        }
        const deployment = path.join(resolverOptions.homeDir, "Projects", "omp_extension");
        const deployedRelative = path.relative(deployment, resolved);
        if (deployedRelative && !path.isAbsolute(deployedRelative) && !deployedRelative.split(path.sep).includes("..")) {
          throw new NativeTodoGuardError("Direct active deployment writes are prohibited; use the reviewed managed sync transaction.");
        }
        const protectedFile = protectedSources.has(relative) || PROTECTED_INTEGRITY_PATTERNS.some(pattern =>
          baseName === pattern.toLowerCase() || normalized.toLowerCase().endsWith("/" + pattern.toLowerCase()));
        const operation = target.operation === "modify" && !existsSync(resolved) ? "create" : target.operation;
        if (protectedFile && !sourceMutationAllowed(direct, cwd, target.path, operation)
          && !sourceMutationAllowed(delegated, cwd, target.path, operation)) {
          throw new NativeTodoGuardError("HUMAN_REQUIRED: protected source mutation needs a current genuinely authorized implementation/operations contract covering this exact path and operation. Bind source first; child executors require actual supported same-workspace delegation. Payload flags, package names, test mode and environment markers cannot authorize it.");
        }
      }
      return;
    }

    // Human Decision Interception: Automatically evaluate any decision/question before it reaches the human
    if (toolName === "ask") {
      const params = (evt.params || evt.args || evt.input || {}) as Record<string, unknown>;
      const firstQ = Array.isArray(params.questions) && params.questions[0] && typeof params.questions[0] === "object"
        ? (params.questions[0] as Record<string, unknown>) : undefined;
      const qText = (typeof firstQ?.question === "string" ? firstQ.question : undefined) ||
        (typeof params.question === "string" ? params.question : undefined) ||
        (typeof params.i === "string" ? params.i : "");
      if (isTechnicalImplementationQuestion(qText)) {
        throw new NativeTodoGuardError(
          "BLOCKED: Câu hỏi liên quan đến lỗi kỹ thuật, gỡ lỗi hoặc chi tiết triển khai mã nguồn. Tác tử BẮT BUỘC phải tự động triệu hồi Advisor (typesafe_prepare_advisor) và Thẩm phán TypeSafe Jev Judge để tự phân tích và lập giải pháp, KHÔNG ĐƯỢC tra khảo người dùng."
        );
      }
      const apiKey = resolverOptions.env.TYPESAFE_API_KEY?.trim() || "";
      const resolverModule = loadResolverModule();
      const projectDir = getProjectDir(ctx);
      const isEnabled = Boolean(apiKey && resolverModule && resolverModule.resolveTypeSafeEnabled(projectDir, resolverOptions).enabled);
      const convo = collectConversationContext(ctx);

      const firstQObj =
        Array.isArray(params.questions) && params.questions[0] && typeof params.questions[0] === "object"
          ? (params.questions[0] as Record<string, unknown>)
          : undefined;
      const primaryQuestionText =
        (typeof firstQObj?.question === "string" ? firstQObj.question : undefined) ||
        (typeof params.question === "string" ? params.question : undefined) ||
        (typeof params.i === "string" ? params.i : "Decision presented to human");
      const primaryOptions = Array.isArray(firstQObj?.options)
        ? (firstQObj.options as Array<string | AdvisorOptionCandidate>)
        : undefined;
      const primaryRecommended =
        typeof firstQObj?.recommended === "number" ? firstQObj.recommended : undefined;

      const advisor = evaluateAdvisorIntent({
        operation: "decision",
        task: primaryQuestionText,
        question: primaryQuestionText,
        options: primaryOptions,
        recommendedIndex: primaryRecommended,
        userRequest: convo.userRequest,
        agentWorkLog: convo.agentWorkLog,
      });

      if (Array.isArray(params.questions)) {
        for (const q of params.questions) {
          if (q && typeof q === "object") {
            const qObj = q as Record<string, unknown>;
            if (qObj.recommended === undefined && Array.isArray(qObj.options) && qObj.options.length > 0) {
              const qAdvisor = evaluateAdvisorIntent({
                operation: "decision",
                task: typeof qObj.question === "string" ? qObj.question : primaryQuestionText,
                question: typeof qObj.question === "string" ? qObj.question : primaryQuestionText,
                options: qObj.options as Array<string | AdvisorOptionCandidate>,
                userRequest: convo.userRequest,
                agentWorkLog: convo.agentWorkLog,
              });
              if (qAdvisor.recommendedIndex !== undefined) {
                qObj.recommended = qAdvisor.recommendedIndex;
              }
            }
          }
        }
      }

      const advisorLine = `\n[Local intent heuristic only — not independent Advisor reasoning or approval]: ${advisor.recommendation || advisor.reason}`;

      if (!isEnabled || !apiKey) {
        const note = `\n\n⚠️ [TypeSafe System One: Evaluation offline / not configured]${advisorLine}`;
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
          const note = `\n\n⚠️ [TypeSafe System One: Evaluation unavailable (${response.error || "no response"})]${advisorLine}`;
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
          const note = `\n\n⚠️ [TypeSafe System One: Incomplete evaluation - proceeding with human review]${advisorLine}`;
          if (Array.isArray(params.questions) && params.questions[0] && typeof params.questions[0] === "object") {
            const q = params.questions[0] as Record<string, unknown>;
            if (typeof q.question === "string") q.question += note;
          } else if (typeof params.question === "string") {
            params.question += note;
          }
          return;
        }

        const riskLabel = riskScore <= 1.0 ? "Low" : riskScore <= 2.0 ? "Moderate" : "High/Critical";
        const annotation = `\n\n🛡️ [TypeSafe System One Verdict]: Risk: ${riskLabel} (${riskScore.toFixed(1)}/3) | Decision Clarity: ${Math.round(clarity * 100)}%${advisorLine}`;

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
          content: `TypeSafe advisory assessment of human handoff:\n- Risk: ${riskLabel} (${riskScore.toFixed(1)}/3)\n- Clarity: ${Math.round(clarity * 100)}%\n- Local heuristic only: ${advisor.recommendation || advisor.reason}\nNo native or human authority is granted by these annotations.`,
          display: true,
        });
      } catch {
        const note = `\n\n⚠️ [TypeSafe System One: Evaluation failed - proceeding with human review]${advisorLine}`;
        if (Array.isArray(params.questions) && params.questions[0] && typeof params.questions[0] === "object") {
          const q = params.questions[0] as Record<string, unknown>;
          if (typeof q.question === "string") q.question += note;
        } else if (typeof params.question === "string") {
          params.question += note;
        }
      }
      return;
    }

    
    if (toolName === "bash") {
      const params = evt.input && typeof evt.input === "object" ? evt.input as Record<string, unknown> : {};
      const check = parsePlanCliCheck(typeof params.command === "string" ? params.command : "");
      if (check.kind === "unsupported") throw new NativeTodoGuardError("EVIDENCE_REQUIRED: use one direct quoted plan-cli check command with explicit cwd; compound or ambiguous shell input cannot acquire closure authority.");
      if (check.kind === "complete") {
        const cwd = getProjectDir(ctx);
        const directory = typeof params.cwd === "string" && params.cwd ? params.cwd : cwd;
        const phase = phaseFileForCheck(cwd, directory, check.phase);
        await assertScopedPlanClosure(contracts, verificationRuntime, ctx, cwd, phase);
      }
      return;
    }

    return;
  }

  let nativeReconciliation: Promise<void> | undefined;
  async function reconcileNativeCommits(ctx: unknown): Promise<void> {
    if (!state.stagedCalls.size && !pendingNativeObservations.size) return;
    if (nativeReconciliation) return nativeReconciliation;
    nativeReconciliation = (async () => {
      const branch = readHostBranch(ctx);
      if (!branch) return;
      const generation = state.generation;
      for (const [callId, staged] of state.stagedCalls) {
        const results = branch.entries.filter(entry => entry.type === "message"
          && entry.message?.role === "toolResult" && entry.message.toolName === "todo" && entry.message.toolCallId === callId);
        if (!results.length) continue;
        if (results.length !== 1) { state.stagedCalls.delete(callId); state.uninitialized = true; continue; }
        const entry = results[0];
        const message = entry.message!;
        if (message.isError === true) { state.stagedCalls.delete(callId); continue; }
        const input = originalTodoInput(branch, callId);
        const normalized = normalizeNativeTodoInput(input);
        if ((message.isError !== undefined && message.isError !== false) || !normalized.valid
          || nativeTodoInputDigest(normalized.input) !== staged.inputHash) {
          state.stagedCalls.delete(callId); state.uninitialized = true; continue;
        }
        const details = message.details && typeof message.details === "object" ? message.details as Record<string, unknown> : undefined;
        const transition = validateNativeTodoTransition(staged.preCommitPhases, input, details?.phases, details);
        if (!transition.valid || transition.operation !== staged.op) { state.stagedCalls.delete(callId); state.uninitialized = true; continue; }
        const accepted = (contracts?.projection(ctx) ?? projectHostHistory(branch, getProjectDir(ctx))).nativeSuccesses
          .find(event => event.resultEntryId === entry.id && event.callId === callId && event.inputDigest === staged.inputHash && event.operation === staged.op);
        if (!accepted) { state.stagedCalls.delete(callId); state.uninitialized = true; continue; }
        const verified = !staged.verificationStages.length || Boolean(verificationRuntime
          && await verificationRuntime.commit(ctx, staged.verificationStages, {
            callId, input, before: staged.preCommitPhases, details, resultEntryId: entry.id,
          }));
        if (readHostBranch(ctx)?.sessionId !== branch.sessionId || state.stagedCalls.get(callId) !== staged) return;
        state.stagedCalls.delete(callId);
        state.committedCallTombstones.set(callId, { inputHash: staged.inputHash, op: staged.op, committedAt: Date.now() });
        while (state.committedCallTombstones.size > TODO_TOMBSTONE_LIMIT) {
          const oldest = state.committedCallTombstones.keys().next().value;
          if (oldest) state.committedCallTombstones.delete(oldest); else break;
        }
        if (staged.op === "done" && staged.workspaceSnapshot && verified) state.lastCheckpoint = staged.workspaceSnapshot;
        if (!verified) {
          await safeSendMessage(pi, { customType: "typesafe-native-reconciliation", display: true,
            content: "Core lifecycle completion was observed, but its exact verification commit could not be authenticated. Rejection debt is retained; inspect the bound recovery report. No semantic approval is claimed." });
        } else if (staged.pendingReports.length) {
          await safeSendMessage(pi, { customType: "typesafe-task-report", display: true,
            content: staged.pendingReports.map(formatTaskReport).join("\n\n") });
        }
      }
      for (const callId of pendingNativeObservations) if (branch.entries.some(entry => entry.type === "message"
        && entry.message?.role === "toolResult" && entry.message.toolName === "todo" && entry.message.toolCallId === callId)) {
        pendingNativeObservations.delete(callId);
      }
      refreshTodoState(ctx);
    })();
    try { await nativeReconciliation; } finally { nativeReconciliation = undefined; }
  }

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (isProjectExcluded(ctx)) {
        await handleExcludedMutationGuard(event, ctx);
        return;
      }
      await reconcileNativeCommits(ctx);
      pruneTodoTransactions();
      return await handleTodoInterception(event, ctx);
    } catch (error) {
      return { block: true, reason: error instanceof NativeTodoGuardError || error instanceof PlanClosurePrerequisiteError
        ? error.message : "UNAVAILABLE: the source/history guard could not authenticate this operation. Preserve the original obligation and inspect the bound recovery report." };
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!event || typeof event !== "object") return;
    const value = event as Record<string, unknown>;
    const callId = typeof value.toolCallId === "string" ? value.toolCallId : undefined;
    if (!callId) return;
    // A lifecycle transition invalidates every pre-persistence stage. A late result
    // can become historical evidence after an actual view, never retroactively
    // commit a stale native mutation.
    pendingNativeObservations.add(callId);
    const staged = state.stagedCalls.get(callId);
    if (staged) staged.nativeResultObserved = true;
    // This middleware event is not finality. Only actual settled branch rows commit.
    await reconcileNativeCommits(ctx);
  });
  for (const event of ["message_end", "before_agent_start"]) pi.on(event, (_event, ctx) => reconcileNativeCommits(ctx));

  for (const lifecycleEvent of ["session_switch", "session_branch", "session_tree"]) {
    pi.on(lifecycleEvent, (_event: unknown, ctx: unknown) => {
      invalidateTodoState(ctx);
    });
  }
  pi.on("session_shutdown", async (_event, ctx) => {
    await reconcileNativeCommits(ctx);
    lifecycleAuthority?.invalidate();
    evidenceRuntime?.clear(ctx);
    verificationRuntime?.invalidate(ctx, "session_shutdown");
    state.generation++;
    state.revision++;
    for (const [callId, stage] of state.stagedCalls) if (!stage.nativeResultObserved) state.stagedCalls.delete(callId);
  });
  for (const lifecycleEvent of ["turn_end", "agent_end"]) {
    pi.on(lifecycleEvent, async (_event, ctx) => {
      await reconcileNativeCommits(ctx);
      state.generation++;
      state.revision++;
      for (const [callId, stage] of state.stagedCalls) if (!stage.nativeResultObserved) state.stagedCalls.delete(callId);
    });
  }

  // Tool is registered UNCONDITIONALLY. Availability (API key, bundled
  // modules, project opt-in) is re-checked on every call rather than once at
  // extension load. A key set BEFORE OMP starts (so this process's
  // `process.env` already has it — env vars set in a shell afterward never
  // reach an already-running process) now works without needing the old
  // early-return-at-load-time removed below to also be worked around by a
  // restart. User opt-in via ~/.omp/agent/typesafe.json DOES take effect
  // without an OMP restart (the resolver reads that file from disk on every
  // call — no caching involved there). Installing the bundled module for the
  // FIRST time after a failed require also takes effect immediately, since
  // Node never caches a failed require().
  //
  // A successful require() of a bundled absolute path is cached by Node's
  // module system for the lifetime of this process (`nodeRequire`'s cache is
  // the ordinary CJS require cache). A bundle update therefore takes effect
  // only after OMP restarts.
  async function executeTypeSafe(
    params: TypeSafeJudgeParams,
    apiKey: string,
    signal?: AbortSignal,
    ctx?: unknown,
    purpose: JudgePurpose = "judge",
    validatePrepared?: PreparedRequestValidator
  ): Promise<ExtensionToolResult> {
    if (ctx && isProjectExcluded(ctx)) return projectExcludedResult();
    const resolver = loadResolverModule();
    const resolvedWire = resolver?.resolveTypeSafeEnabled(getProjectDir(ctx), resolverOptions);
    if (!resolvedWire?.enabled) return DISABLED_RESULT;
    const credentialStatus = loadApiClientModule()?.checkCredentialCooldown(apiKey);
    if (credentialStatus) return credentialStatus.authFailed ? DISABLED_RESULT : shortError(`http_${credentialStatus.status}`);
    const boundPolicy = toolPolicies?.[purpose];
    if (!policyClient || !boundPolicy) return shortError("policy_client_missing");
    if (!boundPolicy.ok) return shortError("policy_invalid");
    const artifacts = deliverableArtifactsFromState(params.state);
    const redactor = artifacts === undefined ? undefined : loadRedactModule();
    if (artifacts !== undefined && !redactor) return shortError("redact_unavailable");
    const outcome = await policyClient.judgeWithPolicy({
      args: params,
      purpose,
      trustedPolicy: boundPolicy,
      apiKey,
      homeDir: resolverOptions.homeDir,
      signal,
      fetchImpl: globalThis.fetch,
      dialect: resolvedWire.dialect,
      endpoint: resolvedWire.endpoint,
      baseUrl: resolvedWire.baseUrl,
      ...(artifacts === undefined && !validatePrepared ? {} : {
        async validatePrepared(prepared: TypeSafePreparedRequest) {
          if (artifacts !== undefined) {
            const body = JSON.parse(prepared.body) as { state?: unknown };
            if (deliverableArtifactsFromState(body.state) !== redactor!.redactString(artifacts, { apiKey })) {
              return { ok: false as const, code: "insufficient_deliverable_evidence" };
            }
          }
          return validatePrepared ? await validatePrepared(prepared) : { ok: true as const };
        },
      }),
    });
    if (!outcome.ok) {
      if (outcome.authError) {
        await safeSendMessage(pi, {
          customType: "typesafe-auth-recovery",
          content: "TypeSafe authentication failed. Update TYPESAFE_API_KEY in the environment to restore service.",
          display: true,
        });
      }
      return {
        ...shortError(outcome.code),
        isError: true,
        details: { code: outcome.code, metadata: outcome.metadata },
      };
    }
    const invocation = invocations.current(ctx);
    if (invocation && verificationRuntime) verificationRuntime.observeAvailability(ctx, { callId: invocation.callId, purpose, metadata: outcome.metadata });
    return publicResult({ answers: outcome.answers, metadata: outcome.metadata });
  }
  function createExtensionJudgeClient(
    apiKey: string,
    signal?: AbortSignal,
    ctx?: unknown,
    expertPurpose: JudgePurpose = "expert",
    validatePrepared?: PreparedRequestValidator
  ): ExpertJudgeClient & PlanJudgeClient & GateJudgeClient & DebateJudgeClient {
    async function request(params: TypeSafeJudgeParams, purpose: JudgePurpose): Promise<SemanticResponse> {
      if (!apiKey) return { error: "api_key_missing" };
      const response = await executeTypeSafe(params, apiKey, signal, ctx, purpose, validatePrepared);
      const details = response.details && typeof response.details === "object"
        ? response.details as { answers?: Record<string, unknown>; metadata?: SemanticTransportMetadata }
        : undefined;
      if (!response.isError && details?.answers && typeof details.answers === "object") {
        return { answers: details.answers, metadata: details.metadata };
      }
      return { error: response.content[0]?.text || "judge_unavailable", metadata: details?.metadata };
    }
    return {
      evaluate: (params) => request(params, expertPurpose),
      evaluatePlan: (params) => request(params, "plan"),
      evaluateGate: (params) => request(params, "advisory"),
      evaluateDebate: (params) => request({
        ...params,
        model: params.model || resolverOptions.env.TYPESAFE_PREDICT_MODEL?.trim()
          || resolverOptions.env.TYPESAFE_DEBATE_MODEL?.trim() || "jev-latest",
      }, "debate"),
    };
  }

  registerTool({
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
      model: z.string().optional(),
    }),
    async execute(
      _toolCallId: string,
      params: TypeSafeJudgeParams,
      signal?: AbortSignal,
      _onUpdate?: (result: ExtensionToolResult) => void,
      ctx?: unknown
    ): Promise<ExtensionToolResult> {
      const apiKey = resolverOptions.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return DISABLED_RESULT;
      return executeTypeSafe(params, apiKey, signal, ctx);
    },
  });

  registerTool({
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
      const apiKey = resolverOptions.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return DISABLED_RESULT;
      const policy = toolPolicies?.rerank;
      if (!policy?.ok) return shortError("policy_invalid");
      if (!Array.isArray(params.candidates) || !params.candidates.length || params.candidates.length > policy.maxQuestionsPerRequest) return shortError("question_limit_exceeded");

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
      const res = await executeTypeSafe({ state, questions }, apiKey, signal, ctx, "rerank");
      if (res.isError || !res.details || typeof res.details !== "object") return res;
      const details = res.details as { answers?: Record<string, unknown>; metadata?: unknown };
      if (!details.answers) return shortError("bad_response");
      const ranked: Array<{ candidate: string; score: number }> = [];
      for (let index = 0; index < params.candidates.length; index++) {
        const score = scoreValue(details.answers[`candidate_${index}`], 2);
        if (score === undefined) return shortError("bad_response");
        ranked.push({ candidate: params.candidates[index], score });
      }
      ranked.sort((left, right) => right.score - left.score);
      return publicResult({ ranked, answers: details.answers, metadata: details.metadata });
    }
  });

  registerTool({
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
      const apiKey = resolverOptions.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return DISABLED_RESULT;
      const policy = toolPolicies?.multi;
      if (!policy?.ok) return shortError("policy_invalid");
      if (!Array.isArray(params.dimensions) || !params.dimensions.length || params.dimensions.length > policy.maxQuestionsPerRequest) return shortError("question_limit_exceeded");
      if (new Set(params.dimensions).size !== params.dimensions.length) return shortError("duplicate_question_id");

      const questions: Record<string, TypeSafeQuestion> = Object.create(null);
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
      return executeTypeSafe({ state: params.state, questions }, apiKey, signal, ctx, "multi");
    }
  });

  registerTool({
    name: "typesafe_elevate_plan",
    label: "TypeSafe Plan Elevation",
    description:
      "Evaluates an implementation plan draft against TypeSafe System One rubrics (Scope, Algorithm, Actionability) and Claude isolation invariants.",
    parameters: z.object({
      planTitle: z.string(),
      planContent: z.string(),
      userPrompt: z.string().optional(),
      attempt: z.number().optional(),
    }),
    async execute(
      _toolCallId: string,
      params: { planTitle: string; planContent: string; userPrompt?: string; attempt?: number },
      signal?: AbortSignal,
      _onUpdate?: (result: ExtensionToolResult) => void,
      ctx?: unknown
    ): Promise<ExtensionToolResult> {
      const apiKey = resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "";
      const client = createExtensionJudgeClient(apiKey, signal, ctx);
      const resolvedUserPrompt = params.userPrompt || collectConversationContext(ctx).userRequest || undefined;
      const result = await evaluatePlanDraft({ ...params, userPrompt: resolvedUserPrompt }, client, { approvalPolicy });
      const debateModel = resolveDebateModel();
      const debate = result.approved ? await runMultiPersonaDebate(params.planContent, client) : {
        approved: false, status: "unavailable" as const, advisoryOnly: true as const, modelTier: debateModel, requestedModel: debateModel,
        reasons: ["Independent multi-persona review was not dispatched because the plan evaluation did not approve."], personas: {},
      };
      return publicResult({ ...result, approved: result.approved && debate.approved, status: result.approved ? debate.status : result.status,
        reasons: [...result.reasons, ...debate.reasons], debate, advisoryOnly: true });
    },
  });

  registerTool({
    name: "typesafe_verify_completion", label: "Advisory bound-evidence dual gate", approval: "read",
    description: "Inspect current already-collected task evidence using advisory deterministic and semantic gates. Executes no caller command and grants no native authority. Use typesafe_review_task plus an actual independent Advisor for native staging.",
    parameters: z.object({ taskId: z.string(), phase: z.string().optional() }),
    async execute(_callId, params: { taskId: string; phase?: string }, signal, _onUpdate, ctx) {
      const record = evidenceRuntime?.get(ctx, { task: params.taskId, phase: params.phase });
      if (!record || !evidenceRuntime || !await evidenceRuntime.isCurrent(ctx, record)) return publicResult({
        status: "EVIDENCE_REQUIRED", advisoryOnly: true, reasons: ["Collect current approved contract/source/verification evidence first."] });
      const nativePurposeClient = createExtensionJudgeClient(resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "", signal, ctx, "native_done");
      const client: GateJudgeClient = { evaluateGate: nativePurposeClient.evaluate };
      return publicResult({ ...await verifyTaskCompletion({
        cwd: getProjectDir(ctx), taskId: record.contract.target.content, contract: record.contract,
        baseline: record.baseline, afterSnapshot: record.snapshot, verificationReceipt: record.verificationReceipt,
        authorizedMutationReceipts: record.evidence.authorizedMutationReceipts, signal,
      }, client, { approvalPolicy }), advisoryOnly: true });
    },
  });
  const criteriaSchema = z.array(z.string()).optional();

  registerTool({
    name: "typesafe_expert_review",
    label: "TypeSafe Expert Review",
    description:
      "Advisory TypeSafe assessments for scope adherence, drift, and technical risk. These are not independent native Advisor reasoning and cannot authorize task completion.",
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
      const apiKey = resolverOptions.env.TYPESAFE_API_KEY?.trim() ?? "";
      if (!apiKey) return publicResult({ approved: false, status: "unavailable", advisoryOnly: true,
        reasons: ["Independent TypeSafe expert review is unavailable; no injected credential was supplied, so no provider request was dispatched."] });
      const client = createExtensionJudgeClient(apiKey, signal, ctx);
      if (!["scope_arbiter", "drift_guard", "risk_security_triage"].includes(params.role)) return shortError("invalid_role");
      try {
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
        return publicResult(result);
      } catch {
        return publicResult({ approved: false, status: "unavailable", advisoryOnly: true,
          reasons: ["Independent TypeSafe expert review is unavailable; no approval or native authority was produced."] });
      }
    },
  });

  if (!advisorRegistration) {
    for (const name of ["typesafe_advisor", "typesafe_prepare_advisor"]) registerTool({
      name, label: "Independent native Advisor unavailable",
      description: "Requires the real supported native task/schema/hooks/read-only/provider adapter. A local heuristic or fabricated receipt cannot substitute for this missing host prerequisite.",
      parameters: z.object({ question: z.string().optional(), task: z.string().optional(), phase: z.string().optional() }),
      async execute() { return publicResult({ status: "UNAVAILABLE", reasons: ["Supported actual native Advisor host API is required."] }); },
    });
  }
  return state;
}
