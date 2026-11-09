import type {
  AllowedMutationScope, CreationProvenance, HostReference, NativeTaskTarget, ParentRequirement, TaskContract,
} from "./types/verification";
import { canonicalDigest, freezeContractValue, isDigest, nonempty, parseContractCriteria, type ContractSourceInput } from "./task-contract-source";

export { contractDigest, canonicalDigest, nativeTaskSourceUri } from "./task-contract-source";
export { projectContractHistory, createContractHistoryRecord, CONTRACT_HISTORY_CUSTOM_TYPE } from "./task-contract-history";
export type { ContractHistoryContext, ContractHistoryProjection } from "./task-contract-history";
export { validateReviewBinding } from "./task-contract-review";
export type { ReviewBindingContext, BindingValidation } from "./task-contract-review";
export { validateNativeTodoTransition, readNativeTodoOperation, normalizeNativeTodoPointer, parseNativeTodoPhases,
  normalizeNativeTodoInput, nativeTodoInputDigest } from "./task-contract-transition";
export type { NativeTodoOperation, NativeTodoTransitionValidation, NativeTodoInputNormalization, NormalizedNativeTodoInput,
  NativeTodoInitPhaseInput } from "./task-contract-transition";
export type * from "./types/verification";

export interface ContractAuthority {
  /** Resolve against supported host user/confirmation entries, never proposal flags. */
  validateReference(reference: HostReference): boolean;
  /** Confirm exact target creation in matched native call/result history. */
  validateCreation(creation: CreationProvenance, target: NativeTaskTarget): boolean;
  /** Verify kind, scope, commands and source association against the approved request. */
  validateProposal(input: CreateTaskContractInput): boolean;
}

export interface CreateTaskContractInput {
  source: ContractSourceInput & { approval: HostReference };
  originalUserRequest: HostReference;
  creation: CreationProvenance;
  target: NativeTaskTarget;
  taskKind: TaskContract["taskKind"];
  allowedMutationScope: AllowedMutationScope;
  approvedCommandIds: readonly string[];
  parentRequirements: readonly ParentRequirement[];
  policyDigest: string;
  authority: ContractAuthority;
}

export function taskIncarnationId(creation: CreationProvenance, target: NativeTaskTarget): string {
  return canonicalDigest({ creation, target });
}

export function contractRevisionDigest(contract: Omit<TaskContract, "revisionId">): string {
  return canonicalDigest(contract);
}

export function validHostReference(reference: HostReference): boolean {
  return !!reference && nonempty(reference.sessionId) && nonempty(reference.entryId) && isDigest(reference.digest)
    && ["user_request", "user_amendment", "host_confirmation"].includes(reference.kind);
}

export function createTaskContract(input: CreateTaskContractInput): TaskContract {
  const { creation, target, source, authority } = input;
  if (!creation || !target || !source || !authority
    || ![creation.sessionId, creation.branchId, creation.entryId, creation.callId, target.phase, target.content].every(nonempty)
    || !Number.isInteger(target.ordinal) || target.ordinal < 0 || !Number.isInteger(target.phaseOrdinal) || target.phaseOrdinal < 0) {
    throw new Error("contract_creation_binding_invalid");
  }
  if (source.kind === "native_task" && (!source.nativeBinding
    || canonicalDigest(source.nativeBinding.creation) !== canonicalDigest(creation)
    || canonicalDigest(source.nativeBinding.target) !== canonicalDigest(target))) throw new Error("contract_native_source_binding_invalid");
  if (!validHostReference(source.approval) || !validHostReference(input.originalUserRequest)
    || input.originalUserRequest.kind !== "user_request"
    || source.approval.sessionId !== creation.sessionId || input.originalUserRequest.sessionId !== creation.sessionId
    || !authority.validateReference(source.approval) || !authority.validateReference(input.originalUserRequest)
    || !authority.validateCreation(creation, target) || !authority.validateProposal(input)) {
    throw new Error("contract_host_authority_required");
  }
  if (!["implementation", "research", "review", "operations"].includes(input.taskKind)
    || !isDigest(input.policyDigest) || !Array.isArray(input.approvedCommandIds)
    || !input.approvedCommandIds.every(nonempty) || new Set(input.approvedCommandIds).size !== input.approvedCommandIds.length
    || !input.allowedMutationScope || !Array.isArray(input.allowedMutationScope.paths) || !Array.isArray(input.allowedMutationScope.operations)
    || !input.allowedMutationScope.paths.every(nonempty)
    || !input.allowedMutationScope.operations.every((operation) => ["read", "create", "modify", "delete", "execute"].includes(operation))
    || !Array.isArray(input.parentRequirements)
    || !input.parentRequirements.every((requirement) => nonempty(requirement.parentContractId) && nonempty(requirement.criterionId)
      && requirement.source && isDigest(requirement.source.digest) && nonempty(requirement.source.path) && nonempty(requirement.source.text)
      && Number.isInteger(requirement.source.startLine) && requirement.source.startLine > 0
      && Number.isInteger(requirement.source.endLine) && requirement.source.endLine >= requirement.source.startLine)) {
    throw new Error("contract_policy_or_scope_invalid");
  }
  const criteria = parseContractCriteria(source);
  const incarnationId = taskIncarnationId(creation, target);
  const contract: Omit<TaskContract, "revisionId"> = {
    schemaVersion: 1, contractId: canonicalDigest({ incarnationId, originalUserRequest: input.originalUserRequest }),
    revision: 1, incarnationId, creation, target, taskKind: input.taskKind,
    allowedMutationScope: input.allowedMutationScope,
    approvedSource: { kind: source.kind, path: source.path, digest: source.digest, phaseHeading: source.phaseHeading,
      nativeBinding: source.nativeBinding, approval: source.approval, spans: criteria.map((criterion) => criterion.source) },
    originalUserRequest: input.originalUserRequest, amendments: [], criteria,
    approvedCommandIds: input.approvedCommandIds, parentRequirements: input.parentRequirements, policyDigest: input.policyDigest,
  };
  return freezeContractValue(structuredClone({ ...contract, revisionId: contractRevisionDigest(contract) }));
}

export interface ReviseTaskContractInput {
  source: CreateTaskContractInput["source"];
  amendment: HostReference;
  authority: ContractAuthority;
  /** Explicit removals only; omitted criteria remain obligations even after context rolls. */
  removeCriterionIds?: readonly string[];
  allowedMutationScope?: AllowedMutationScope;
  approvedCommandIds?: readonly string[];
  additionalParentRequirements?: readonly ParentRequirement[];
  policyDigest?: string;
  /** Parent must authenticate an actual human decision about these precise changes. */
  validateAmendment(previous: TaskContract, input: ReviseTaskContractInput): boolean;
}

export function reviseTaskContract(previous: TaskContract, input: ReviseTaskContractInput): TaskContract {
  if (!validHostReference(input.amendment) || input.amendment.kind === "user_request"
    || input.amendment.sessionId !== previous.creation.sessionId
    || !input.authority.validateReference(input.amendment) || !input.validateAmendment(previous, input)) {
    throw new Error("contract_authentic_amendment_required");
  }
  const proposed = createTaskContract({
    source: input.source, originalUserRequest: previous.originalUserRequest, creation: previous.creation,
    target: previous.target, taskKind: previous.taskKind,
    allowedMutationScope: input.allowedMutationScope ?? previous.allowedMutationScope,
    approvedCommandIds: input.approvedCommandIds ?? previous.approvedCommandIds,
    parentRequirements: [...previous.parentRequirements, ...(input.additionalParentRequirements ?? [])],
    policyDigest: input.policyDigest ?? previous.policyDigest, authority: input.authority,
  });
  const removals = new Set(input.removeCriterionIds ?? []);
  if ([...removals].some((id) => !previous.criteria.some((criterion) => criterion.id === id))) throw new Error("contract_unknown_obligation_removal");
  const criteria = previous.criteria.filter((criterion) => !removals.has(criterion.id));
  for (const criterion of proposed.criteria) {
    if (!criteria.some((existing) => existing.kind === criterion.kind && existing.text === criterion.text)) criteria.push(criterion);
  }
  const { revisionId: _previousDigest, ...prior } = previous;
  const contract: Omit<TaskContract, "revisionId"> = {
    ...prior, revision: previous.revision + 1, previousRevisionId: previous.revisionId,
    approvedSource: proposed.approvedSource, allowedMutationScope: proposed.allowedMutationScope,
    criteria, amendments: [...previous.amendments, input.amendment],
    approvedCommandIds: proposed.approvedCommandIds, parentRequirements: proposed.parentRequirements, policyDigest: proposed.policyDigest,
  };
  return freezeContractValue(structuredClone({ ...contract, revisionId: contractRevisionDigest(contract) }));
}
