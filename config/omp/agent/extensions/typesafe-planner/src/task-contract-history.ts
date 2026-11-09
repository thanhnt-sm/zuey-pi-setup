import type {
  ContractDebtReference, ContractHistoryRecord, NativeHistoryFailure, NativeHistorySuccess, NativeIncarnationReference, ProjectedNativePhase, SourceSpan, TaskContract,
} from "./types/verification";
import { canonicalDigest, freezeContractValue, isDigest, nonempty } from "./task-contract-source";
import { contractRevisionDigest, taskIncarnationId, validHostReference } from "./task-contract";
import { assertContractIntegrity } from "./task-contract-integrity";
import { applyNativeResult, captureNativeCall, type NativeCallSnapshot } from "./task-contract-native";

export const CONTRACT_HISTORY_CUSTOM_TYPE = "omp.typesafe.contract.v1";

export interface ContractHistoryContext {
  sessionId: string;
  branchId: string;
  /** Stable origin identity for an ancestor creation, not the moving branch leaf. */
  resolveCreationBranchId?(entryId: string): string | undefined;
  acceptsOriginBranch?(branchId: string, sourceEntryId: string): boolean;
  /** Host adapter authenticates custom entries; imported JSON must never call this boundary. */
  isHostOwnedEntry(entryId: string, customType: string): boolean;
  validateReference: (reference: TaskContract["originalUserRequest"]) => boolean;
  validateSourceSpan(span: SourceSpan): boolean;
  validateContract(contract: TaskContract): boolean;
  /** Required to replay a material reduction; absence is fail-closed. */
  validateAmendment?(previous: TaskContract, next: TaskContract): boolean;
}

export interface ContractHistoryProjection {
  nativePhases: ProjectedNativePhase[] | undefined;
  nativeStateEntryId?: string;
  /** False after an unpaired/malformed latest native result or broken ancestry. */
  nativeStateReliable: boolean;
  incarnations: NativeIncarnationReference[];
  contracts: TaskContract[];
  /** Accepted durable revisions, including superseded revisions; never transient approvals. */
  contractRevisions: TaskContract[];
  debt: ContractDebtReference[];
  rejected: Array<{ entryId: string; reason: string }>;
  /** Historical success is lifecycle observation only, never semantic approval. */
  nativeSuccesses: NativeHistorySuccess[];
  nativeFailures: NativeHistoryFailure[];
}

interface BranchEntry {
  id?: unknown; parentId?: unknown; type?: unknown; sessionId?: unknown; branchId?: unknown;
  customType?: unknown; data?: unknown;
  message?: { role?: unknown; content?: unknown; toolName?: unknown; toolCallId?: unknown; isError?: unknown; details?: unknown };
}
interface NativeCall { id: string; name: string; arguments: Record<string, unknown> }


export function createContractHistoryRecord(
  context: Pick<ContractHistoryContext, "sessionId" | "branchId">,
  operationId: string,
  sourceEntryId: string,
  value: { kind: "contract"; contract: TaskContract } | { kind: "debt"; debt: ContractDebtReference },
): ContractHistoryRecord {
  if (![context.sessionId, context.branchId, operationId, sourceEntryId].every(nonempty)) throw new Error("contract_history_identity_required");
  if (value.kind === "contract") assertContractIntegrity(value.contract);
  const identity = { schemaVersion: 1 as const, sessionId: context.sessionId, branchId: context.branchId, operationId, sourceEntryId };
  const record: ContractHistoryRecord = value.kind === "contract"
    ? { ...identity, kind: "contract", contract: value.contract }
    : { ...identity, kind: "debt", debt: value.debt };
  return freezeContractValue(structuredClone(record));
}

/** Only call with the actual supported sessionManager.getBranch() return value. */
export function projectContractHistory(entries: readonly unknown[], context: ContractHistoryContext): ContractHistoryProjection {
  const projection: ContractHistoryProjection = { nativePhases: undefined, nativeStateReliable: false, incarnations: [], contracts: [], contractRevisions: [], debt: [], rejected: [], nativeSuccesses: [], nativeFailures: [] };
  const calls = new Map<string, NativeCallSnapshot>();
  const seenEntries = new Set<string>();
  const operations = new Set<string>();
  const contracts = new Map<string, TaskContract>();
  const debt = new Map<string, ContractDebtReference>();
  const duplicateIds = new Set<string>();
  const counts = new Map<string, number>();
  const callCounts = new Map<string, number>();
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as BranchEntry;
    if (nonempty(entry.id)) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    if (entry.message?.role === "assistant" && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block && typeof block === "object" && block.type === "toolCall" && block.name === "todo" && nonempty(block.id)) {
          callCounts.set(block.id, (callCounts.get(block.id) ?? 0) + 1);
        }
      }
    }
  }
  for (const [id, count] of counts) if (count > 1) duplicateIds.add(id);
  let previousEntryId: string | undefined;
  let branchBroken = false;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") { projection.rejected.push({ entryId: "", reason: "malformed_entry" }); branchBroken = true; projection.nativeStateReliable = false; continue; }
    const entry = raw as BranchEntry;
    const entryId = typeof entry.id === "string" ? entry.id : "";
    const reject = (reason: string) => projection.rejected.push({ entryId, reason });
    if (!entryId || duplicateIds.has(entryId)) { reject("missing_or_ambiguous_entry_identity"); branchBroken = true; projection.nativeStateReliable = false; continue; }
    if ((entry.sessionId !== undefined && entry.sessionId !== context.sessionId)
      || (entry.branchId !== undefined && entry.branchId !== context.branchId
        && !(typeof entry.branchId === "string" && context.acceptsOriginBranch?.(entry.branchId, entryId)))
      || (previousEntryId !== undefined && entry.parentId !== previousEntryId)) {
      reject("foreign_or_disconnected_branch"); branchBroken = true; projection.nativeStateReliable = false;
    }
    previousEntryId = entryId;
    if (branchBroken) continue;
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block || typeof block !== "object" || block.type !== "toolCall" || block.name !== "todo") continue;
        const call = block as NativeCall;
        if (!nonempty(call.id) || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) { reject("malformed_native_call"); continue; }
        if (callCounts.get(call.id) !== 1) { reject("ambiguous_native_call"); continue; }
        const snapshot = captureNativeCall(call.id, entryId, call.arguments, projection);
        if (!snapshot) { reject("malformed_native_call"); continue; }
        calls.set(call.id, snapshot);
      }
    }
    if (message?.role === "toolResult" && message.toolName === "todo") {
      const match = typeof message.toolCallId === "string" ? calls.get(message.toolCallId) : undefined;
      if (!match || match.used) {
        reject("unmatched_or_duplicate_native_result");
        if (message.isError !== true) projection.nativeStateReliable = false;
        continue;
      }
      match.used = true;
      const outcome = applyNativeResult(projection, match, { entryId, isError: message.isError, details: message.details }, {
        sessionId: context.sessionId, branchId: context.resolveCreationBranchId?.(entryId) ?? context.branchId,
      });
      if (outcome.reason) reject(outcome.reason);
      if (outcome.success) projection.nativeSuccesses.push(outcome.success);
      if (outcome.failure) projection.nativeFailures.push(outcome.failure);
    }
    if (entry.type === "custom" && entry.customType === "user_todo_edit") {
      projection.nativeStateReliable = false;
      reject("native_edit_requires_supported_observation");
    }
    if (entry.type === "custom" && entry.customType === CONTRACT_HISTORY_CUSTOM_TYPE) {
      try {
        if (!context.isHostOwnedEntry(entryId, entry.customType)) throw new Error("untrusted_custom_entry");
        const record = entry.data as ContractHistoryRecord;
        if (!record || record.schemaVersion !== 1 || record.sessionId !== context.sessionId
          || (record.branchId !== context.branchId && !context.acceptsOriginBranch?.(record.branchId, record.sourceEntryId))
          || !nonempty(record.operationId) || operations.has(record.operationId) || !seenEntries.has(record.sourceEntryId)) {
          throw new Error("stale_or_malformed_contract_record");
        }
        if (record.kind === "contract") {
          const contract = record.contract;
          assertContractIntegrity(contract);
          if (!validHostReference(contract.originalUserRequest)
            || contract.originalUserRequest.sessionId !== context.sessionId || !Array.isArray(contract.amendments)
            || !context.validateReference(contract.originalUserRequest) || !contract.amendments.every((reference) => validHostReference(reference)
              && reference.kind !== "user_request" && reference.sessionId === context.sessionId && context.validateReference(reference))) {
            throw new Error("malformed_contract");
          }
          const { revisionId, ...body } = contract;
          const native = projection.incarnations.find((reference) => reference.incarnationId === contract.incarnationId && reference.creationKnown);
          const prior = contracts.get(contract.contractId);
          if (!native || canonicalDigest(native.target) !== canonicalDigest(contract.target)
            || canonicalDigest(native.creation) !== canonicalDigest(contract.creation)
            || contractRevisionDigest(body) !== revisionId || contract.incarnationId !== taskIncarnationId(contract.creation, contract.target)
            || contract.contractId !== canonicalDigest({ incarnationId: contract.incarnationId, originalUserRequest: contract.originalUserRequest })
            || (prior ? contract.revision !== prior.revision + 1 || contract.previousRevisionId !== prior.revisionId : contract.revision !== 1)
            || !contract.criteria.every((criterion) => context.validateSourceSpan(criterion.source))
            || !contract.approvedSource.spans.every((span) => context.validateSourceSpan(span))
            || !contract.parentRequirements.every((requirement) => context.validateSourceSpan(requirement.source))
            || !validHostReference(contract.approvedSource.approval) || !context.validateReference(contract.approvedSource.approval)
            || !context.validateContract(contract)) throw new Error("stale_or_forged_contract");
          if (prior) {
            const reduced = prior.criteria.some((criterion) => !contract.criteria.some((next) => next.id === criterion.id))
              || canonicalDigest(prior.allowedMutationScope) !== canonicalDigest(contract.allowedMutationScope)
              || prior.approvedCommandIds.some((id) => !contract.approvedCommandIds.includes(id))
              || prior.parentRequirements.some((requirement) => !contract.parentRequirements.some((next) => canonicalDigest(next) === canonicalDigest(requirement)));
            if (contract.amendments.length !== prior.amendments.length + 1
              || canonicalDigest(contract.amendments.slice(0, -1)) !== canonicalDigest(prior.amendments)
              || (reduced && !context.validateAmendment?.(prior, contract))) throw new Error("contract_obligation_reduction_unauthorized");
          } else if (contract.amendments.length !== 0) throw new Error("contract_initial_amendments_invalid");
          const accepted = structuredClone(contract);
          contracts.set(contract.contractId, accepted);
          projection.contractRevisions.push(accepted);
        } else if (record.kind === "debt") {
          const reference = record.debt;
          const contract = reference?.contract && contracts.get(reference.contract.contractId);
          if (!reference || !nonempty(reference.debtId) || !nonempty(reference.reason) || !seenEntries.has(reference.sourceEntryId)
            || !reference.contract || ![reference.contract.contractId, reference.contract.incarnationId, reference.contract.revisionId].every(isDigest)
            || !Array.isArray(reference.criterionIds) || !reference.criterionIds.length
            || !reference.criterionIds.every(isDigest)) throw new Error("malformed_or_unbound_debt");
          // An unavailable/stale contract cannot silently erase authentic unresolved debt.
          if (!contract || reference.contract.incarnationId !== contract.incarnationId || reference.contract.revisionId !== contract.revisionId
            || !reference.criterionIds.every((id) => contract.criteria.some((criterion) => criterion.id === id))) reject("debt_contract_unavailable");
          const prior = debt.get(reference.debtId);
          if (prior && canonicalDigest(prior) !== canonicalDigest(reference)) throw new Error("debt_replacement_not_authorized");
          debt.set(reference.debtId, structuredClone(reference));
        } else throw new Error("unsupported_record_kind");
        operations.add(record.operationId);
      } catch (error) { reject(error instanceof Error ? error.message : "malformed_contract_record"); }
    }
    seenEntries.add(entryId);
  }
  projection.contracts = projection.nativeStateReliable
    ? [...contracts.values()].filter((contract) => projection.incarnations.some((reference) => reference.incarnationId === contract.incarnationId))
    : [];
  projection.debt = [...debt.values()];
  return freezeContractValue(projection);
}
