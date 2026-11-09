import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { canonicalDigest } from "./task-contract-source";
import { readHostBranch, type HostBranch } from "./host-history";

export const HOST_TOOL_INVOCATION_ENTRY = "omp.typesafe.tool-execution.v1";
export interface HostToolInvocation {
  readonly sessionId: string;
  readonly branchId: string;
  readonly entryId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly inputDigest: string;
  readonly nonce: string;
}
interface ScopedInvocation { invocation: HostToolInvocation; manager: object; open: boolean }
export interface HostToolInvocationRuntime {
  run<T>(context: unknown, toolName: string, callId: string, input: unknown, execute: () => Promise<T>): Promise<T>;
  current(context: unknown, toolName?: string, callId?: string, input?: unknown): HostToolInvocation | undefined;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function session(context: unknown): { manager: object; sessionId: string } | undefined {
  if (!record(context) || !record(context.sessionManager) || typeof context.sessionManager.getSessionId !== "function") return undefined;
  const id: unknown = context.sessionManager.getSessionId();
  return typeof id === "string" && id ? { manager: context.sessionManager, sessionId: id } : undefined;
}
/** A callback witness is a host fact, never a synthetic assistant message or semantic permission. */
export function validateHostToolInvocation(branch: HostBranch, invocation: HostToolInvocation): boolean {
  if (branch.sessionId !== invocation.sessionId || branch.branchId !== invocation.branchId) return false;
  const entry = branch.byId.get(invocation.entryId);
  if (entry?.type !== "custom" || entry.customType !== HOST_TOOL_INVOCATION_ENTRY || !record(entry.data)) return false;
  const { schemaVersion, nonce, sessionId, callId, toolName, inputDigest } = entry.data;
  return schemaVersion === 1 && nonce === invocation.nonce && sessionId === invocation.sessionId
    && callId === invocation.callId && toolName === invocation.toolName && inputDigest === invocation.inputDigest;
}

/** Constructed by the extension, entered only by its actual registered execute callback. */
export function createHostToolInvocationRuntime(appendEntry?: (customType: string, data: unknown) => void): HostToolInvocationRuntime {
  const active = new AsyncLocalStorage<ScopedInvocation>();
  return {
    async run(context, toolName, callId, input, execute) {
      const origin = session(context);
      if (!appendEntry || !origin || !toolName || !callId) return execute();
      const nonce = randomUUID();
      const inputDigest = canonicalDigest(input);
      appendEntry(HOST_TOOL_INVOCATION_ENTRY, { schemaVersion: 1, nonce, sessionId: origin.sessionId, callId, toolName, inputDigest });
      const branch = readHostBranch(context);
      const entries = branch?.entries.filter(entry => entry.type === "custom" && entry.customType === HOST_TOOL_INVOCATION_ENTRY && record(entry.data) && entry.data.nonce === nonce);
      if (!branch || entries?.length !== 1) return execute();
      const invocation: HostToolInvocation = Object.freeze({ sessionId: origin.sessionId, branchId: branch.branchId,
        entryId: entries[0].id, callId, toolName, inputDigest, nonce });
      const scope: ScopedInvocation = { invocation, manager: origin.manager, open: true };
      return active.run(scope, async () => {
        try { return await execute(); }
        finally { scope.open = false; }
      });
    },
    current(context, toolName, callId, input) {
      const scope = active.getStore(); const origin = session(context);
      if (!scope?.open || !origin || origin.manager !== scope.manager || origin.sessionId !== scope.invocation.sessionId
        || toolName !== undefined && toolName !== scope.invocation.toolName
        || callId !== undefined && callId !== scope.invocation.callId
        || input !== undefined && canonicalDigest(input) !== scope.invocation.inputDigest) return undefined;
      const branch = readHostBranch(context);
      return branch && validateHostToolInvocation(branch, scope.invocation) ? scope.invocation : undefined;
    },
  };
}
