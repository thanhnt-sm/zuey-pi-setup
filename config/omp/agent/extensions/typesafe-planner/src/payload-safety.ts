import { createRequire } from "node:module";
import path from "node:path";

const nodeRequire = createRequire(import.meta.url);

export interface SafePayloadOptions {
  maxBytes?: number;
  apiKey?: string;
  trustedPolicy?: TrustedToolPolicy;
}

export interface TypeSafeQuestionDefinition {
  type: "noul" | "choice" | "score";
  instructions: string | Record<string, unknown>;
  criteria?: unknown;
}

export interface TypeSafePayload {
  state: unknown;
  questions: Record<string, TypeSafeQuestionDefinition | unknown>;
  model?: string;
  [key: string]: unknown;
}

export type JudgePurpose =
  | "judge" | "rerank" | "multi" | "plan" | "debate" | "advisory"
  | "expert" | "advisor" | "native_done" | "native_drop"
  | "decision" | "health" | "egc" | "evaluation";

export interface SemanticReviewLimits {
  readonly maxPackets: number;
  readonly maxDispatches: number;
  readonly deadlineMs: number;
  readonly maxActive: number;
  readonly maxQueued: number;
}

export interface TrustedToolPolicy {
  readonly maxQuestionsPerRequest: number;
  readonly provider: { readonly allowedModels: readonly string[] };
  readonly routing?: {
    readonly baseline: string;
    readonly lattice: readonly string[];
    readonly questionKeys?: readonly string[];
  };
  readonly semanticReviewLimits?: Partial<SemanticReviewLimits>;
}

export type ResolvedToolPolicy =
  | { readonly ok: false; readonly code: "policy_invalid"; readonly purpose: JudgePurpose }
  | (TrustedToolPolicy & {
      readonly ok: true;
      readonly purpose: JudgePurpose;
      readonly policyIdentity: string;
      readonly semanticReviewLimits: SemanticReviewLimits;
    });

export interface TypeSafeAttemptReceipt {
  readonly receiptId: string;
  readonly provider: "typesafe";
  readonly endpoint: "https://api.typesafe.ai/v1/systemone";
  readonly attempt: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly clock: "monotonic_ms";
  readonly kind: "ok" | "auth" | "http_error" | "bad_response" | "request_error";
  readonly status: number | null;
  readonly error: "timeout" | "cancelled" | "network_error" | null;
  readonly bodyDigest: string;
  readonly bodyBytes: number;
  readonly questionIds: readonly string[] | null;
  readonly questionCount: number | null;
  readonly policyIdentity: string | null;
  readonly resolvedModel: string | null;
  readonly modelUnavailableReason: string | null;
  readonly usage: Record<string, unknown> | null;
  readonly usageUnavailableReason: string | null;
  readonly billing: Record<string, unknown> | number | null;
  readonly billingUnavailableReason: string | null;
}

export interface TypeSafeRequestMetadata {
  readonly policyIdentity?: string;
  readonly purpose?: JudgePurpose;
  readonly maxQuestionsPerRequest: number;
  readonly questionIds: readonly string[];
  readonly questionCount: number;
  readonly bodyBytes: number;
  readonly bodyDigest: string;
  readonly attempts?: number;
  readonly attemptReceipts?: readonly TypeSafeAttemptReceipt[];
  readonly resolvedModel?: string;
  readonly usage?: Record<string, unknown>;
  readonly billing?: Record<string, unknown> | number;
  readonly cooldown?: boolean;
  readonly cooldownUntil?: number;
}

export interface TypeSafePreparedRequest {
  readonly ok: true;
  readonly body: string;
  readonly questions: Readonly<Record<string, TypeSafeQuestionDefinition>>;
  readonly bodyBytes: number;
  readonly bodyDigest: string;
  readonly questionCount: number;
  readonly policyIdentity?: string;
  readonly metadata: TypeSafeRequestMetadata;
}

export type PreparedRequestValidationResult = { ok: true } | { ok: false; code: string };
export type PreparedRequestValidator = (prepared: TypeSafePreparedRequest) =>
  PreparedRequestValidationResult | Promise<PreparedRequestValidationResult>;
export type TypeSafePreparationResult = TypeSafePreparedRequest | { ok: false; code: string };
export type TypeSafeAnswer =
  | { noul: number }
  | { choice: string; confidence: number }
  | { score: number; confidence: number };
export type TypeSafeJudgeResult =
  | { ok: true; answers: Record<string, TypeSafeAnswer>; metadata: TypeSafeRequestMetadata }
  | { ok: false; code: string; authError: boolean; metadata?: TypeSafeRequestMetadata };

interface RedactModule {
  preparePayload: (payload: unknown, opts?: { maxBytes?: number; apiKey?: string }) => unknown;
}

interface RedactPatternsModule {
  detectSecret: (str: string) => boolean;
}

function loadRedactModule(): RedactModule | null {
  try {
    const mod = nodeRequire(path.join(__dirname, "typesafe-redact.cjs")) as RedactModule;
    if (mod && typeof mod.preparePayload === "function") {
      return mod;
    }
  } catch {}
  return null;
}

function loadPatternsModule(): RedactPatternsModule | null {
  try {
    const mod = nodeRequire(path.join(__dirname, "typesafe-redact-patterns.cjs")) as RedactPatternsModule;
    if (mod && typeof mod.detectSecret === "function") {
      return mod;
    }
  } catch {}
  return null;
}

const ANTHROPIC_KEY_REGEX = /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g;
const CLAUDE_SESSION_KEY_REGEX = /\bsessionKey=[A-Za-z0-9_-]{20,}\b/g;
const CLAUDE_TOKEN_REGEX = /\bCLAUDE_CODE_TOKEN=[A-Za-z0-9_-]{20,}\b/g;

/**
 * Redacts Anthropic API keys, Claude Code tokens, and session cookies from strings.
 */
export function redactAnthropicSecrets(text: string): string {
  if (typeof text !== "string") return text;
  return text
    .replace(ANTHROPIC_KEY_REGEX, "[REDACTED:anthropic-key]")
    .replace(CLAUDE_SESSION_KEY_REGEX, "sessionKey=[REDACTED:anthropic-key]")
    .replace(CLAUDE_TOKEN_REGEX, "CLAUDE_CODE_TOKEN=[REDACTED:anthropic-key]");
}

/**
 * Checks if a string contains a secret pattern (Anthropic key or general credential).
 */
export function isSecretInKey(key: string, patterns = loadPatternsModule()): boolean {
  if (ANTHROPIC_KEY_REGEX.test(key)) return true;
  if (CLAUDE_SESSION_KEY_REGEX.test(key)) return true;
  if (CLAUDE_TOKEN_REGEX.test(key)) return true;
  return patterns ? patterns.detectSecret(key) : true;
}

/**
 * Recursively applies string redaction across objects and arrays.
 */
function deepScrubAnthropic<T>(val: T): T {
  if (typeof val === "string") {
    return redactAnthropicSecrets(val) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val.map((item) => deepScrubAnthropic(item)) as unknown as T;
  }
  if (val && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = deepScrubAnthropic(v);
    }
    return out as unknown as T;
  }
  return val;
}

const ERROR_KEYWORDS = [
  "FAIL",
  "Error:",
  "Exception:",
  "AssertionError:",
  "SyntaxError:",
  "TypeError:",
  "ReferenceError:",
  "stack:",
];
const STACK_FRAME_RE = /^\s*at\s+\S+/;
/**
 * Structural smart truncation that prioritizes test errors and symbols
 * over repetitive diff lines while strictly satisfying the byte budget.
 */
export function truncatePayloadState(state: string, maxBytes: number): string {
  if (Buffer.byteLength(state, "utf8") <= maxBytes) {
    return state;
  }

  const lines = state.split("\n");
  const errorLines: string[] = [];
  const headerLines: string[] = [];
  const diffLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ERROR_KEYWORDS.some((kw) => line.includes(kw)) || STACK_FRAME_RE.test(line)) {
      errorLines.push(line);
    } else if (
      line.startsWith("diff --git") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("Summary:") ||
      line.startsWith("Header:")
    ) {
      headerLines.push(line);
    } else {
      diffLines.push(line);
    }
  }
  const marker = "\n... [diff truncated for size budget] ...\n";
  const reservedBytes =
    Buffer.byteLength(headerLines.join("\n") + "\n" + errorLines.join("\n") + marker, "utf8");

  const diffAllowance = Math.max(0, maxBytes - reservedBytes);

  let keptDiff = "";
  if (diffAllowance > 100 && diffLines.length > 0) {
    const selected: string[] = [];
    let currentBytes = 0;
    // Take from start of diff
    for (const line of diffLines) {
      const lineBytes = Buffer.byteLength(line + "\n", "utf8");
      if (currentBytes + lineBytes > diffAllowance) break;
      selected.push(line);
      currentBytes += lineBytes;
    }
    keptDiff = selected.join("\n");
  }

  let assembled = "";
  if (headerLines.length > 0) {
    assembled += headerLines.join("\n") + "\n";
  }
  if (errorLines.length > 0) {
    assembled += errorLines.join("\n") + "\n";
  }
  if (keptDiff.length > 0) {
    assembled += marker + keptDiff;
  } else if (diffLines.length > 0) {
    assembled += marker;
  }

  // Safety fallback if assembled still exceeds maxBytes
  if (Buffer.byteLength(assembled, "utf8") > maxBytes) {
    // Structural trimming: slice by characters to avoid broken UTF-8,
    // and ensure we don't return something that looks like broken JSON.
    let charBudget = maxBytes;
    while (Buffer.byteLength(assembled.substring(0, charBudget), "utf8") > maxBytes) {
      charBudget--;
    }
    assembled = assembled.substring(0, charBudget);
    if (assembled.startsWith("{") || assembled.startsWith("[")) {
       assembled = "--- Truncated Payload ---\n" + assembled;
    }
  }
  return assembled;
}

export const DEFAULT_MAX_BYTES = 32768;

/**
 * Redaction is permitted; implicit evidence/question truncation is not.
 * The canonical request preparer owns count, identity and final UTF-8 bounds.
 */
export function preparePayloadSafe<T extends TypeSafePayload>(
  payload: T,
  opts?: SafePayloadOptions
): T {
  const maxBytes = Math.min(opts?.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("policy_invalid");
  const redactMod = loadRedactModule();
  const patternsMod = loadPatternsModule();
  if (!redactMod || !patternsMod) throw new Error("payload_safety_unavailable");
  if (!payload.questions || typeof payload.questions !== "object") {
    const scrubbed = redactMod.preparePayload(deepScrubAnthropic(payload), {
      maxBytes: Infinity, apiKey: opts?.apiKey,
    }) as T;
    if (Buffer.byteLength(JSON.stringify(scrubbed), "utf8") > maxBytes) throw new Error("payload too large");
    return scrubbed;
  }
  let client: {
    prepareRequest: (args: TypeSafePayload, limits?: TrustedToolPolicy, options?: { apiKey?: string }) => TypeSafePreparationResult;
  };
  try {
    client = nodeRequire(path.join(__dirname, "typesafe-api-client.cjs"));
    if (typeof client.prepareRequest !== "function") throw new Error("missing");
  } catch {
    throw new Error("payload_safety_unavailable");
  }
  const prepared = client.prepareRequest(deepScrubAnthropic(payload), opts?.trustedPolicy, { apiKey: opts?.apiKey });
  if (!prepared.ok) throw new Error(prepared.code);
  if (Buffer.byteLength(prepared.body, "utf8") > maxBytes) throw new Error("payload too large");
  return JSON.parse(prepared.body) as T;
}

/**
 * Clamps text to maxChars, inserting a truncation marker at the cut point.
 */
export function clampText(text: string, maxChars: number, keep: "head" | "tail"): string {
  if (text.length <= maxChars) {
    return text;
  }
  const markerTemplate = "\n[... 00000 chars truncated ...]\n";
  const overhead = markerTemplate.length;
  if (maxChars <= overhead) {
    return keep === "head" ? text.slice(0, maxChars) : text.slice(-maxChars);
  }

  const budget = maxChars - overhead;
  const cutCount = text.length - budget;
  const marker = `\n[... ${cutCount} chars truncated ...]\n`;

  if (keep === "head") {
    return text.slice(0, budget) + marker;
  }
  return marker + text.slice(-budget);
}
