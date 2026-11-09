import { contractDigest, projectContractHistory, CONTRACT_HISTORY_CUSTOM_TYPE } from "./task-contract";
import type { ContractHistoryContext, ContractHistoryProjection } from "./task-contract";
import type { HostReference, NativeIncarnationReference, SourceSpan, TaskContract } from "./types/verification";
import { readWorkspaceFile } from "./typesafe-evidence-file.cjs";
import { canonicalDigest } from "./task-contract-source";
import { validateHostToolInvocation, type HostToolInvocation } from "./host-tool-invocation";

export interface HostHistoryEntry {
  id: string;
  parentId?: string | null;
  type: string;
  customType?: string;
  content?: unknown;
  data?: unknown;
  message?: { role?: string; content?: unknown; toolName?: string; toolCallId?: string; isError?: boolean; details?: unknown };
}
export interface HostBranch {
  sessionId: string;
  /** A local stable ancestry anchor, not a claimed SDK branch UUID or moving leaf. */
  branchId: string;
  entries: readonly HostHistoryEntry[];
  byId: ReadonlyMap<string, HostHistoryEntry>;
}
export interface HostProjectToolCall { entryId: string; params: Record<string, unknown>; transportToolName: string }
export interface HostContractValidators {
  validateContract(contract: TaskContract): boolean;
  validateAmendment?(previous: TaskContract, next: TaskContract): boolean;
  validateReference(reference: HostReference): boolean;
  validateSourceSpan(span: SourceSpan): boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function publicHostText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((block) => record(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
}
export function userRequestText(entry: HostHistoryEntry): string | undefined {
  let text: string | undefined;
  if (entry.type === "message" && entry.message?.role === "user") {
    text = publicHostText(entry.message.content);
  } else if (entry.type === "custom_message" && (entry as Record<string, unknown>).customType === "skill-prompt") {
    const raw = typeof (entry as Record<string, unknown>).content === "string" ? (entry as Record<string, unknown>).content as string : "";
    const match = /\nUser:\s*([\s\S]*)$/i.exec(raw);
    if (match) text = match[1].trim();
  }
  if (!text) return undefined;
  text = text.replace(/<system-(?:notice|reminder)\b[^>]*>[\s\S]*?<\/system-(?:notice|reminder)>/gi, "").trim();
  const isBareContinuation = /^(?:please\s+)?(?:retry|continue|proceed|resume|go ahead|try again|yes|ok|tiếp tục)\s*[.!?]*$/iu.test(text);
  if (!text || isBareContinuation
    || /^(?:<(?:system-notice|system-reminder|task-result|irc)\b|\[Wait interrupted|\[automated)/i.test(text)) return undefined;
  return text;
}

/** Only obtains history from the supported live context; never accepts a file/JSON registry. */
export function readHostBranch(ctx: unknown): HostBranch | undefined {
  if (!record(ctx) || !record(ctx.sessionManager)) return undefined;
  const manager = ctx.sessionManager;
  if (typeof manager.getBranch !== "function" || typeof manager.getSessionId !== "function") return undefined;
  try {
    const sessionId: unknown = manager.getSessionId();
    const values: unknown = manager.getBranch();
    if (typeof sessionId !== "string" || !sessionId || !Array.isArray(values) || !values.length || values.length > 100000) return undefined;
    const entries: HostHistoryEntry[] = [];
    const byId = new Map<string, HostHistoryEntry>();
    for (const value of values) {
      if (!record(value) || typeof value.id !== "string" || !value.id || typeof value.type !== "string" || byId.has(value.id)) return undefined;
      const entry = value as unknown as HostHistoryEntry;
      if ((entries.length > 0 && entry.parentId !== entries[entries.length - 1].id)
        || (value.sessionId !== undefined && value.sessionId !== sessionId)) return undefined;
      entries.push(entry);
      byId.set(entry.id, entry);
    }
    return { sessionId, branchId: `${sessionId}:${entries[0].id}`, entries, byId };
  } catch { return undefined; }
}

export function originalTodoInput(branch: HostBranch, callId: string): Record<string, unknown> | undefined {
  let match: Record<string, unknown> | undefined;
  for (const entry of branch.entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (!record(block) || block.type !== "toolCall" || block.name !== "todo" || block.id !== callId) continue;
      if (match || !record(block.arguments)) return undefined;
      match = block.arguments;
    }
  }
  return match;
}

/** Actual direct project tool calls and the supported public write-device transport only. */
export function findProjectToolCall(branch: HostBranch, toolCallId: string, toolName: string): HostProjectToolCall | undefined {
  let found: HostProjectToolCall | undefined;
  let matches = 0;
  for (const entry of branch.entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (!record(block) || block.type !== "toolCall" || block.id !== toolCallId) continue;
      if (++matches !== 1 || !record(block.arguments)) return undefined;
      if (block.name === toolName) found = { entryId: entry.id, params: { ...block.arguments }, transportToolName: toolName };
      else if (block.name === "write" && block.arguments.path === `xd://${toolName}`
        && typeof block.arguments.content === "string" && block.arguments.content.length <= 131072) {
        try {
          const params: unknown = JSON.parse(block.arguments.content);
          if (!record(params)) return undefined;
          found = { entryId: entry.id, params, transportToolName: "write" };
        } catch { return undefined; }
      } else return undefined;
    }
  }
  return found;
}

/** Own actual execute observation first, exact SDK call/result join when its async history rows publish. */
export function validateProjectToolInvocationJoin(branch: HostBranch, invocation: HostToolInvocation, requireSettled = false): boolean {
  if (!validateHostToolInvocation(branch, invocation)) return false;
  let calls = 0;
  let results = 0;
  let resultTool: string | undefined;
  for (const entry of branch.entries) {
    if (entry.type === "message" && entry.message?.role === "assistant" && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) if (record(block) && block.type === "toolCall" && block.id === invocation.callId) calls++;
    }
    if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolCallId === invocation.callId) {
      if (++results > 1 || entry.message.isError !== undefined && entry.message.isError !== false) return false;
      resultTool = entry.message.toolName;
    }
  }
  if (calls > 1 || calls === 0 && results > 0) return false;
  if (requireSettled && (calls !== 1 || results !== 1)) return false;
  if (calls === 0) return true;
  const actual = findProjectToolCall(branch, invocation.callId, invocation.toolName);
  if (!actual || results !== 0 && resultTool !== actual.transportToolName) return false;
  if (canonicalDigest(actual.params) === invocation.inputDigest) return true;
  // The host may strip the display-only intent before schema-validated execute.
  // Ignore only that known metadata field; every authority-bearing argument stays exact.
  if (typeof actual.params.i !== "string") return false;
  const { i: _intent, ...executionParams } = actual.params;
  return canonicalDigest(executionParams) === invocation.inputDigest;
}

/** Cache commitment over all contract-relevant host data, excluding assistant private/text blocks. */
export function contractHostHistoryDigest(branch: HostBranch): string {
  const rows = branch.entries.map((entry) => {
    const identity = [entry.id, entry.parentId, entry.type];
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const calls: unknown[] = [];
      if (Array.isArray(entry.message.content)) for (const block of entry.message.content) {
        if (record(block) && block.type === "toolCall") calls.push({ id: block.id, name: block.name, arguments: block.arguments });
      }
      return [...identity, "assistant", calls];
    }
    if (entry.type === "message" && entry.message?.role === "user") return [...identity, "user", publicHostText(entry.message.content)];
    if (entry.type === "message" && entry.message?.role === "toolResult") return [...identity, "toolResult",
      entry.message.toolCallId, entry.message.toolName, entry.message.isError, entry.message.details];
    return [...identity, entry.customType, entry.data];
  });
  return canonicalDigest([branch.sessionId, branch.branchId, rows]);
}

export function validateUserReference(branch: HostBranch, reference: HostReference): boolean {
  if (reference.sessionId !== branch.sessionId) return false;
  const entry = branch.byId.get(reference.entryId);
  if (!entry || !["user_request", "user_amendment"].includes(reference.kind)) return false;
  const text = userRequestText(entry);
  return text !== undefined && contractDigest(text) === reference.digest;
}

export function nativeCreationReferences(branch: HostBranch, resultEntryId: string): readonly NativeIncarnationReference[] | undefined {
  const index = branch.entries.findIndex((candidate) => candidate.id === resultEntryId);
  if (index < 0) return undefined;
  const projection = projectContractHistory(branch.entries.slice(0, index + 1), {
    sessionId: branch.sessionId, branchId: branch.branchId,
    isHostOwnedEntry: () => false, validateContract: () => false, validateSourceSpan: () => false,
    validateReference: (reference) => validateUserReference(branch, reference),
  });
  return projection.nativeStateReliable ? projection.incarnations.filter((candidate) => candidate.creationKnown
    && candidate.creation.entryId === resultEntryId) : undefined;
}

export function nativeCreationReference(
  branch: HostBranch, resultEntryId: string, phaseOrdinal: number, ordinal: number,
): NativeIncarnationReference | undefined {
  return nativeCreationReferences(branch, resultEntryId)?.find((candidate) => candidate.target.phaseOrdinal === phaseOrdinal
    && candidate.target.ordinal === ordinal);
}

export function validateSourceSpan(branch: HostBranch, cwd: string, span: SourceSpan): boolean {
  let text: string;
  const prefix = `session://${branch.sessionId}/`;
  try {
    if (span.path.startsWith(prefix)) {
      const entry = branch.byId.get(span.path.slice(prefix.length));
      const source = entry && userRequestText(entry);
      if (source === undefined) return false;
      text = source;
    } else if (span.path.startsWith("native-todo://")) {
      const match = /^native-todo:\/\/([^/]+)\/([^?]+)\?phaseOrdinal=(\d+)&ordinal=(\d+)$/.exec(span.path);
      if (!match || decodeURIComponent(match[1]) !== branch.sessionId) return false;
      const source = nativeCreationReference(branch, decodeURIComponent(match[2]), Number(match[3]), Number(match[4]));
      if (!source) return false;
      text = source.target.content;
    } else {
      text = readWorkspaceFile(cwd, span.path, { maxBytes: 1024 * 1024 }).bytes.toString("utf8");
    }
    return contractDigest(text) === span.digest && Number.isInteger(span.startLine) && span.startLine > 0
      && Number.isInteger(span.endLine) && span.endLine >= span.startLine
      && text.split(/\r?\n/).slice(span.startLine - 1, span.endLine).join(text.includes("\r\n") ? "\r\n" : "\n") === span.text;
  } catch { return false; }
}

export function projectHostHistory(branch: HostBranch, cwd: string, validators?: HostContractValidators): ContractHistoryProjection {
  const context: ContractHistoryContext = {
    sessionId: branch.sessionId,
    branchId: branch.branchId,
    resolveCreationBranchId: (entryId) => branch.byId.has(entryId) ? branch.branchId : undefined,
    acceptsOriginBranch: (origin, entryId) => origin.startsWith(`${branch.sessionId}:`) && branch.byId.has(entryId),
    isHostOwnedEntry: (entryId, customType) => {
      const entry = branch.byId.get(entryId);
      return customType === CONTRACT_HISTORY_CUSTOM_TYPE && entry?.type === "custom" && entry.customType === customType;
    },
    validateReference: (reference) => validators ? validators.validateReference(reference) : validateUserReference(branch, reference),
    validateSourceSpan: (span) => validators ? validators.validateSourceSpan(span) : validateSourceSpan(branch, cwd, span),
    validateContract: (contract) => validators?.validateContract(contract) === true,
    validateAmendment: (previous, next) => validators?.validateAmendment?.(previous, next) === true,
  };
  return projectContractHistory(branch.entries, context);
}

