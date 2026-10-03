import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const nodeRequire = createRequire(import.meta.url);

export interface SafePayloadOptions {
  maxBytes?: number;
  apiKey?: string;
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

interface RedactModule {
  preparePayload: (payload: unknown, opts?: { maxBytes?: number; apiKey?: string }) => unknown;
}

interface RedactPatternsModule {
  detectSecret: (str: string) => boolean;
}

function loadRedactModule(): RedactModule | null {
  try {
    const modPath = path.join(
      os.homedir(),
      ".claude",
      "mcp",
      "typesafe",
      "typesafe-redact.cjs"
    );
    return nodeRequire(modPath) as RedactModule;
  } catch {
    return null;
  }
}

function loadPatternsModule(): RedactPatternsModule | null {
  try {
    const modPath = path.join(
      os.homedir(),
      ".claude",
      "mcp",
      "typesafe",
      "typesafe-redact-patterns.cjs"
    );
    return nodeRequire(modPath) as RedactPatternsModule;
  } catch {
    return null;
  }
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
export function isSecretInKey(key: string): boolean {
  if (ANTHROPIC_KEY_REGEX.test(key)) return true;
  if (CLAUDE_SESSION_KEY_REGEX.test(key)) return true;
  if (CLAUDE_TOKEN_REGEX.test(key)) return true;

  const patterns = loadPatternsModule();
  if (patterns && typeof patterns.detectSecret === "function") {
    return patterns.detectSecret(key);
  }
  return false;
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
  "at ",
];
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
    if (ERROR_KEYWORDS.some((kw) => line.includes(kw))) {
      errorLines.push(line);
    } else if (
      line.startsWith("diff --git") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("Summary:") ||
      line.startsWith("Header:") ||
      line.startsWith("# ")
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

const DEFAULT_MAX_BYTES = 32768;

/**
 * Prepares and sanitizes a payload before transmission:
 * 1. Validates round-trip question keys for secrets (rejects if present).
 * 2. Redacts all sensitive credentials (Anthropic tokens, AWS, JWT, API keys).
 * 3. Enforces hard max byte cap (<= 32,768 bytes) with priority truncation.
 */
export function preparePayloadSafe<T extends TypeSafePayload>(
  payload: T,
  opts?: SafePayloadOptions
): T {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

  // 1. Secret in key check
  if (payload.questions && typeof payload.questions === "object") {
    for (const key of Object.keys(payload.questions)) {
      if (isSecretInKey(key)) {
        throw new Error("payload rejected: secret in key");
      }
    }
  }

  // 2. Deep scrub Anthropic tokens
  let scrubbed = deepScrubAnthropic(payload);

  // 3. Smart structural truncation of oversized state BEFORE delegation
  const baseJsonBytes = Buffer.byteLength(
    JSON.stringify({ ...scrubbed, state: "" }),
    "utf8"
  );
  // Reserve headroom for JSON serialization and questions
  const stateBudget = Math.max(1024, maxBytes - baseJsonBytes - 2048);

  let stateStr = "";
  if (typeof scrubbed.state === "string") {
    stateStr = scrubbed.state;
  } else if (scrubbed.state !== undefined) {
    stateStr = JSON.stringify(scrubbed.state);
  }

  if (Buffer.byteLength(stateStr, "utf8") > stateBudget) {
    let currentBudget = stateBudget;
    scrubbed = {
      ...scrubbed,
      state: truncatePayloadState(stateStr, currentBudget),
    };
    while (Buffer.byteLength(JSON.stringify(scrubbed), "utf8") > maxBytes - 256 && currentBudget > 1024) {
      currentBudget -= 2048;
      scrubbed = {
        ...scrubbed,
        state: truncatePayloadState(stateStr, Math.max(1024, currentBudget)),
      };
    }
  }

  // 4. Delegate to shared kit redaction module if available
  const redactMod = loadRedactModule();
  if (redactMod && typeof redactMod.preparePayload === "function") {
    try {
      scrubbed = redactMod.preparePayload(scrubbed, {
        maxBytes,
        apiKey: opts?.apiKey,
      }) as T;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("secret in key")) {
        throw new Error("payload rejected: secret in key");
      }
      throw err;
    }
  }

  // 5. Final bounding guarantee
  let bodyStr = JSON.stringify(scrubbed);
  if (Buffer.byteLength(bodyStr, "utf8") > maxBytes) {
    const budget = Math.max(
      256,
      maxBytes - Buffer.byteLength(JSON.stringify({ ...scrubbed, state: "" }), "utf8") - 32
    );
    const currState = typeof scrubbed.state === "string" ? scrubbed.state : JSON.stringify(scrubbed.state);
    
    // Structural JSON trimming: avoid severing byte streams and prevent 422 from broken JSON parsers
    let charBudget = budget;
    while (Buffer.byteLength(currState.substring(0, charBudget), "utf8") > budget) {
      charBudget--;
    }
    let forcedTrunc = currState.substring(0, charBudget);
    if (typeof scrubbed.state !== "string" || forcedTrunc.startsWith("{") || forcedTrunc.startsWith("[")) {
      forcedTrunc = "--- Truncated State ---\n" + forcedTrunc;
    }
    
    scrubbed = {
      ...scrubbed,
      state: forcedTrunc,
    };
  }
  return scrubbed;
}
