import { isDigest } from "./task-contract-source";
import { readHostBranch } from "./host-history";
import { HOST_TOOL_INVOCATION_ENTRY, validateHostToolInvocation, type HostToolInvocation, type HostToolInvocationRuntime } from "./host-tool-invocation";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A durable host execution witness is a source fact, not an assistant message or approval. */
export function verificationInvocationSource(context: unknown, invocations: HostToolInvocationRuntime, callId: string, expectedEntryId?: string): HostToolInvocation | undefined {
  const active = invocations.current(context, undefined, callId);
  if (active && (!expectedEntryId || active.entryId === expectedEntryId)) return active;
  const branch = readHostBranch(context);
  if (!branch) return undefined;
  const candidates: HostToolInvocation[] = [];
  for (const entry of branch.entries) {
    if (expectedEntryId && entry.id !== expectedEntryId || entry.type !== "custom" || entry.customType !== HOST_TOOL_INVOCATION_ENTRY || !object(entry.data)) continue;
    const data = entry.data;
    if (data.schemaVersion !== 1 || data.callId !== callId || data.sessionId !== branch.sessionId || !nonempty(data.nonce) || !nonempty(data.toolName) || !isDigest(data.inputDigest)) continue;
    const invocation: HostToolInvocation = { sessionId: branch.sessionId, branchId: branch.branchId, entryId: entry.id, callId, toolName: data.toolName, inputDigest: data.inputDigest, nonce: data.nonce };
    if (validateHostToolInvocation(branch, invocation)) candidates.push(invocation);
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}
