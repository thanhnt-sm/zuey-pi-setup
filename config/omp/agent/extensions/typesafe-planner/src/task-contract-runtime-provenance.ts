import { validateProjectToolInvocationJoin, userRequestText, type HostBranch } from "./host-history";
import { canonicalDigest, contractDigest, nonempty } from "./task-contract-source";
import type { ContractHistoryProjection } from "./task-contract-history";
import type { HostReference, NativeIncarnationReference } from "./types/verification";
import type { HostToolInvocation } from "./host-tool-invocation";
import { CONTRACT_BIND_TOOL_NAME, type ContractBindingInvocationInput, type ContractBindingProposal, type ContractTaskSelector } from "./task-contract-runtime-types";

export function parseContractBindingProposal(raw: unknown): ContractBindingProposal | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const values = raw as Record<string, unknown>;
  if (Object.keys(values).some((key) => !["task", "phase", "planPath", "phaseHeading", "originalUserEntryId", "i"].includes(key))
    || !nonempty(values.task) || values.i !== undefined && typeof values.i !== "string") return undefined;
  const proposal: ContractBindingProposal = { task: values.task };
  for (const field of ["phase", "planPath", "phaseHeading", "originalUserEntryId"] as const) {
    if (values[field] === undefined) continue;
    if (!nonempty(values[field])) return undefined;
    proposal[field] = values[field];
  }
  if (proposal.phaseHeading && !proposal.planPath) return undefined;
  return proposal;
}

export interface ActiveContractBindingCall {
  entryId: string;
  proposal: ContractBindingProposal;
  invocation: HostToolInvocation;
  invocationInput: ContractBindingInvocationInput;
}
export function activeContractBindingCall(
  branch: HostBranch, callId: string, raw: unknown, invocation: HostToolInvocation,
): ActiveContractBindingCall | undefined {
  const proposal = parseContractBindingProposal(raw);
  if (!proposal || invocation.callId !== callId || invocation.toolName !== CONTRACT_BIND_TOOL_NAME
    || canonicalDigest(raw) !== invocation.inputDigest || !validateProjectToolInvocationJoin(branch, invocation)) return undefined;
  const invocationInput: ContractBindingInvocationInput = { ...proposal };
  if (raw && typeof raw === "object" && "i" in raw && typeof raw.i === "string") invocationInput.i = raw.i;
  return { entryId: invocation.entryId, proposal, invocation, invocationInput };
}

export interface OriginalHostTaskRequest { reference: HostReference; text: string; requiresConfirmation: boolean }
export function originalHostTaskRequest(
  branch: HostBranch, native: NativeIncarnationReference, requestedEntryId?: string,
): OriginalHostTaskRequest | undefined {
  const callIndex = branch.entries.findIndex((entry) => entry.type === "message" && entry.message?.role === "assistant"
    && Array.isArray(entry.message.content) && entry.message.content.some((block) => block && typeof block === "object"
      && "type" in block && block.type === "toolCall" && "name" in block && block.name === "todo" && "id" in block && block.id === native.creation.callId));
  if (callIndex < 0) return undefined;
  let nearest: { entryId: string; text: string } | undefined;
  let selected: { entryId: string; text: string } | undefined;
  for (const entry of branch.entries.slice(0, callIndex)) {
    const text = userRequestText(entry);
    if (!text) continue;
    nearest = { entryId: entry.id, text };
    if (entry.id === requestedEntryId) selected = nearest;
  }
  selected = requestedEntryId ? selected : nearest;
  if (!selected || !nearest) return undefined;
  return { reference: { kind: "user_request", sessionId: branch.sessionId, entryId: selected.entryId, digest: contractDigest(selected.text) },
    text: selected.text, requiresConfirmation: selected.entryId !== nearest.entryId };
}

export function currentNativeContractTarget(projection: ContractHistoryProjection, selector: ContractTaskSelector): NativeIncarnationReference | undefined {
  if (!projection.nativeStateReliable || !nonempty(selector.task) || (selector.phase !== undefined && !nonempty(selector.phase))) return undefined;
  const matches = projection.incarnations.filter((reference) => reference.creationKnown && reference.target.content === selector.task
    && (selector.phase === undefined || reference.target.phase === selector.phase));
  return matches.length === 1 ? matches[0] : undefined;
}
