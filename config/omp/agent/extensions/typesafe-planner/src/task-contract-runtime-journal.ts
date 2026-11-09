import {
  nativeCreationReferences, validateProjectToolInvocationJoin, validateSourceSpan, validateUserReference,
  type HostBranch, type HostContractValidators, type HostHistoryEntry,
} from "./host-history";
import { canonicalDigest, contractDigest, freezeContractValue, isDigest, nativeTaskSourceUri, parseContractCriteria } from "./task-contract-source";
import { CONTRACT_HISTORY_CUSTOM_TYPE, contractRevisionDigest, taskIncarnationId, validHostReference } from "./task-contract";
import { assertContractIntegrity } from "./task-contract-integrity";
import { approvedContractScope, parentSourceCriteriaIdentity, trustedNativeTaskKind, workspaceSourcePath } from "./task-contract-runtime-sources";
import { readCookInputObservations } from "./task-contract-cook-input";
import { originalHostTaskRequest, parseContractBindingProposal } from "./task-contract-runtime-provenance";
import {
  CONTRACT_BIND_TOOL_NAME, CONTRACT_CONFIRMATION_CUSTOM_TYPE, CONTRACT_SOURCE_CUSTOM_TYPE,
  type ContractConfirmationJournalRecord, type ContractSourceJournalRecord, type CookInputObservation, type FrozenContractSourceContext,
} from "./task-contract-runtime-types";
import type { ContractCriterion, HostReference, NativeIncarnationReference, TaskContract } from "./types/verification";

export interface HostContractSourceFact { entryId: string; record: ContractSourceJournalRecord }
export interface ContractRuntimeJournal {
  facts: readonly HostContractSourceFact[];
  observations: readonly CookInputObservation[];
  validators: HostContractValidators;
  sourceFor(contract: TaskContract): HostContractSourceFact | undefined;
  contextFor(contract: TaskContract): FrozenContractSourceContext | undefined;
}

export function readContractRuntimeJournal(branch: HostBranch, cwd: string): ContractRuntimeJournal {
  const order = new Map(branch.entries.map((entry, index) => [entry.id, index]));
  const observations = readCookInputObservations(branch, cwd);
  const nativeCache = new Map<string, readonly NativeIncarnationReference[] | undefined>();
  const candidates: HostContractSourceFact[] = [];
  const confirmations = new Map<string, ContractConfirmationJournalRecord>();
  const exactRecord = (entry: HostHistoryEntry, type: string): boolean => entry.type === "custom" && entry.customType === type;
  for (const entry of branch.entries) if (exactRecord(entry, CONTRACT_CONFIRMATION_CUSTOM_TYPE)) {
    try {
      const data = entry.data as ContractConfirmationJournalRecord;
      const binding = data?.nativeBinding;
      if (!binding?.creation || !binding.target || !isDigest(data.parentContextDigest)) continue;
      if (!nativeCache.has(binding.creation.entryId)) nativeCache.set(binding.creation.entryId, nativeCreationReferences(branch, binding.creation.entryId));
      if (!nativeCache.get(binding.creation.entryId)?.some((native) => canonicalDigest(native.creation) === canonicalDigest(binding.creation)
        && canonicalDigest(native.target) === canonicalDigest(binding.target))) continue;
      if (data?.schemaVersion === 1 && data.sessionId === branch.sessionId && data.branchId === branch.branchId
        && data.decision === "confirmed_source_scope" && typeof data.execution === "boolean" && isDigest(data.policyDigest)
        && validHostReference(data.originalUserRequest) && validateUserReference(branch, data.originalUserRequest)) confirmations.set(entry.id, data);
    } catch { /* Malformed host data cannot grant source permission. */ }
  }
  const confirmationValid = (reference: HostReference, source?: ContractSourceJournalRecord): boolean => {
    const data = confirmations.get(reference.entryId);
    if (!data || reference.kind !== "host_confirmation" || reference.sessionId !== branch.sessionId || reference.digest !== canonicalDigest(data)) return false;
    const invocation = data.invocation;
    if (!invocation || invocation.callId !== data.toolCallId || invocation.toolName !== CONTRACT_BIND_TOOL_NAME
      || invocation.entryId !== data.callEntryId || !validateProjectToolInvocationJoin(branch, invocation)
      || (order.get(invocation.entryId) ?? Infinity) >= (order.get(reference.entryId) ?? -1)) return false;
    return !source || data.toolCallId === source.toolCallId && data.callEntryId === source.callEntryId
      && canonicalDigest(data.invocation) === canonicalDigest(source.invocation)
      && canonicalDigest(data.originalUserRequest) === canonicalDigest(source.originalUserRequest.reference)
      && canonicalDigest(data.nativeBinding) === canonicalDigest(source.taskSource.nativeBinding)
      && data.parentContextDigest === canonicalDigest({ parent: source.parentSource })
      && canonicalDigest({ observation: data.inputObservation }) === canonicalDigest({ observation: source.inputObservation })
      && data.taskDigest === source.taskSource.digest && data.parentDigest === source.parentSource?.digest && data.taskKind === source.taskKind
      && source.authorization.kind === "host_confirmation" && data.execution === source.authorization.execution
      && data.previousRevisionId === source.previousRevisionId
      && data.previousParentDigest === candidates.find((fact) => fact.record.revision === source.revision - 1
        && canonicalDigest(fact.record.taskSource.nativeBinding) === canonicalDigest(source.taskSource.nativeBinding)
        && canonicalDigest(fact.record.originalUserRequest.reference) === canonicalDigest(source.originalUserRequest.reference))?.record.parentSource?.digest
      && data.policyDigest === source.policyDigest && canonicalDigest(data.allowedMutationScope) === canonicalDigest(source.allowedMutationScope)
      && canonicalDigest(data.approvedCommandIds) === canonicalDigest(source.approvedCommandIds);
  };
  for (const entry of branch.entries) if (exactRecord(entry, CONTRACT_SOURCE_CUSTOM_TYPE)) {
    try {
      const source = entry.data as ContractSourceJournalRecord;
      if (!source || source.schemaVersion !== 1 || source.sessionId !== branch.sessionId || source.branchId !== branch.branchId
        || !Number.isInteger(source.revision) || source.revision < 1 || !isDigest(source.policyDigest)) continue;
      const invocation = source.invocation;
      const proposal = parseContractBindingProposal(source.invocationInput);
      if (!invocation || invocation.callId !== source.toolCallId || invocation.toolName !== CONTRACT_BIND_TOOL_NAME
        || invocation.entryId !== source.callEntryId || !validateProjectToolInvocationJoin(branch, invocation)
        || canonicalDigest(source.invocationInput) !== invocation.inputDigest
        || !proposal || canonicalDigest(proposal) !== canonicalDigest(source.proposal)
        || (order.get(invocation.entryId) ?? Infinity) >= (order.get(entry.id) ?? -1)) continue;
      const task = source.taskSource;
      const binding = task?.nativeBinding;
      if (!binding?.creation || !binding.target || task.kind !== "native_task" || task.text !== binding.target.content
        || task.digest !== contractDigest(task.text) || task.path !== nativeTaskSourceUri(binding.creation, binding.target)
        || proposal.task !== binding.target.content || proposal.phase !== undefined && proposal.phase !== binding.target.phase) continue;
      if (!nativeCache.has(binding.creation.entryId)) nativeCache.set(binding.creation.entryId, nativeCreationReferences(branch, binding.creation.entryId));
      const native = nativeCache.get(binding.creation.entryId)?.find((candidate) => candidate.target.phaseOrdinal === binding.target.phaseOrdinal
        && candidate.target.ordinal === binding.target.ordinal);
      if (!native || canonicalDigest(native.creation) !== canonicalDigest(binding.creation) || canonicalDigest(native.target) !== canonicalDigest(binding.target)) continue;
      const previousSource = candidates.find((fact) => fact.record.revision === source.revision - 1
        && canonicalDigest(fact.record.taskSource.nativeBinding) === canonicalDigest(binding)
        && canonicalDigest(fact.record.originalUserRequest.reference) === canonicalDigest(source.originalUserRequest.reference));
      const original = originalHostTaskRequest(branch, native, proposal.originalUserEntryId
        ?? (source.revision > 1 ? source.originalUserRequest.reference.entryId : undefined));
      if (!original || canonicalDigest(original.reference) !== canonicalDigest(source.originalUserRequest.reference)
        || original.text !== source.originalUserRequest.text || source.taskKind !== trustedNativeTaskKind(task.text, original.text)) continue;
      const criteria = parseContractCriteria({ kind: "native_task", path: task.path, text: task.text, digest: task.digest, nativeBinding: binding });
      if (canonicalDigest(task.spans) !== canonicalDigest(criteria.map((criterion) => criterion.source))) continue;
      if (source.parentSource) {
        const parent = source.parentSource;
        if ((proposal.planPath ? workspaceSourcePath(cwd, proposal.planPath) !== parent.path
          : !previousSource || canonicalDigest({ parent: previousSource.record.parentSource }) !== canonicalDigest({ parent }))
          || contractDigest(parent.text) !== parent.digest || proposal.phaseHeading !== undefined && proposal.phaseHeading !== parent.phaseHeading) continue;
        let expected: ContractCriterion[];
        try { expected = parseContractCriteria({ kind: "plan", ...parent }); }
        catch (error) {
          if ((parent.path !== "plan.md" && !parent.path.endsWith("/plan.md")) || !(error instanceof Error) || error.message !== "contract_phase_has_no_criteria") continue;
          expected = [];
        }
        if (canonicalDigest(expected) !== canonicalDigest(parent.criteria)
          || parent.master && (workspaceSourcePath(cwd, parent.master.path) !== parent.master.path || contractDigest(parent.master.text) !== parent.master.digest)) continue;
      } else if (proposal.planPath) continue;
      if (source.inputObservation && (!source.parentSource || !observations.some((observation) =>
        canonicalDigest(observation.reference) === canonicalDigest(source.inputObservation)
        && observation.documents.some((document) => document.path === source.parentSource?.path)
        && (order.get(observation.userRequest.entryId) ?? Infinity) < (order.get(invocation.entryId) ?? -1)))) continue;
      const authorization = source.authorization;
      if (!authorization || !["readonly", "host_confirmation"].includes(authorization.kind)
        || source.parentSource && authorization.kind !== "host_confirmation") continue;
      if (authorization.kind === "host_confirmation" && typeof authorization.execution !== "boolean") continue;
      if (authorization.kind === "host_confirmation" && (!confirmationValid(authorization.reference, source)
        || (order.get(authorization.reference.entryId) ?? Infinity) >= (order.get(entry.id) ?? -1))) continue;
      if (original.requiresConfirmation && authorization.kind !== "host_confirmation" && !previousSource) continue;
      if (previousSource?.record.parentSource && parentSourceCriteriaIdentity(previousSource.record.parentSource) !== parentSourceCriteriaIdentity(source.parentSource)
        && authorization.kind !== "host_confirmation") continue;
      if (!Array.isArray(source.approvedCommandIds) || !source.approvedCommandIds.every((id) => typeof id === "string" && id.length > 0)
        || new Set(source.approvedCommandIds).size !== source.approvedCommandIds.length || canonicalDigest(source.readScope) !== canonicalDigest(["**"])) continue;
      const execution = authorization.kind === "host_confirmation" && authorization.execution === true;
      if ((source.taskKind === "implementation" || source.taskKind === "operations") && !execution) continue;
      const permissions = approvedContractScope(source.taskKind, source.parentSource, execution, source.approvedCommandIds);
      if (canonicalDigest(permissions.scope) !== canonicalDigest(source.allowedMutationScope)
        || canonicalDigest(permissions.commandIds) !== canonicalDigest(source.approvedCommandIds)) continue;
      if (source.revision === 1 ? source.previousRevisionId !== undefined || source.amendment !== undefined
        : !isDigest(source.previousRevisionId) || !source.amendment || authorization.kind === "readonly"
          || !validHostReference(source.amendment) || source.amendment.kind === "user_request"
          || source.amendment.sessionId !== branch.sessionId
          || source.amendment.entryId !== authorization.reference.entryId || source.amendment.digest !== authorization.reference.digest) continue;
      candidates.push({ entryId: entry.id, record: source });
    } catch { /* Reject incomplete, forged, or foreign source facts independently. */ }
  }
  const counts = new Map<string, number>();
  for (const fact of candidates) {
    const key = canonicalDigest([fact.record.taskSource.nativeBinding, fact.record.originalUserRequest.reference, fact.record.revision]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const facts = candidates.filter((fact) => counts.get(canonicalDigest([fact.record.taskSource.nativeBinding, fact.record.originalUserRequest.reference, fact.record.revision])) === 1);
  const sourceFor = (contract: TaskContract): HostContractSourceFact | undefined => facts.find(({ record }) => record.revision === contract.revision
    && taskIncarnationId(record.taskSource.nativeBinding.creation, record.taskSource.nativeBinding.target) === contract.incarnationId
    && canonicalDigest(record.originalUserRequest.reference) === canonicalDigest(contract.originalUserRequest));
  const storedContract = (revisionId: string): TaskContract | undefined => {
    const matches: TaskContract[] = [];
    for (const entry of branch.entries) if (exactRecord(entry, CONTRACT_HISTORY_CUSTOM_TYPE)) {
      const data = entry.data as { schemaVersion?: unknown; sessionId?: unknown; branchId?: unknown; sourceEntryId?: unknown; kind?: unknown; contract?: TaskContract } | undefined;
      if (data?.schemaVersion !== 1 || data.kind !== "contract" || data.sessionId !== branch.sessionId || data.branchId !== branch.branchId
        || data.contract?.revisionId !== revisionId) continue;
      const source = sourceFor(data.contract);
      if (source && data.sourceEntryId === source.entryId && (order.get(source.entryId) ?? Infinity) < (order.get(entry.id) ?? -1)) matches.push(data.contract);
    }
    return matches.length === 1 ? matches[0] : undefined;
  };
  const validateContract = (contract: TaskContract): boolean => {
    try {
      let current: TaskContract | undefined = contract;
      const seen = new Set<string>();
      while (current) {
        assertContractIntegrity(current);
        if (seen.has(current.revisionId)) return false;
        seen.add(current.revisionId);
        const stored = storedContract(current.revisionId);
        const fact = sourceFor(current);
        if (!stored || !fact || canonicalDigest(stored) !== canonicalDigest(current)) return false;
        const source = fact.record;
        const { revisionId, ...body } = current;
        const binding = source.taskSource.nativeBinding;
        const criteria = parseContractCriteria({ kind: "native_task", ...source.taskSource });
        if (contractRevisionDigest(body) !== revisionId || current.contractId !== canonicalDigest({ incarnationId: current.incarnationId, originalUserRequest: current.originalUserRequest })
          || canonicalDigest(current.creation) !== canonicalDigest(binding.creation) || canonicalDigest(current.target) !== canonicalDigest(binding.target)
          || current.taskKind !== source.taskKind || current.policyDigest !== source.policyDigest || current.parentRequirements.length !== 0
          || canonicalDigest(current.criteria) !== canonicalDigest(criteria) || canonicalDigest(current.allowedMutationScope) !== canonicalDigest(source.allowedMutationScope)
          || canonicalDigest(current.approvedCommandIds) !== canonicalDigest(source.approvedCommandIds)
          || canonicalDigest(current.approvedSource) !== canonicalDigest({ kind: "native_task", path: source.taskSource.path, digest: source.taskSource.digest,
            nativeBinding: binding, approval: source.authorization.kind === "host_confirmation" ? source.authorization.reference : source.originalUserRequest.reference,
            spans: source.taskSource.spans })) return false;
        if (current.revision === 1) return current.amendments.length === 0 && current.previousRevisionId === undefined;
        const previous = current.previousRevisionId && storedContract(current.previousRevisionId);
        if (!previous || previous.contractId !== current.contractId || previous.incarnationId !== current.incarnationId
          || previous.revision + 1 !== current.revision || source.previousRevisionId !== previous.revisionId
          || current.amendments.length !== previous.amendments.length + 1
          || canonicalDigest(current.amendments.slice(0, -1)) !== canonicalDigest(previous.amendments)
          || canonicalDigest(current.amendments.at(-1)) !== canonicalDigest(source.amendment)) return false;
        current = previous;
      }
      return false;
    } catch { return false; }
  };
  const validators: HostContractValidators = {
    validateContract,
    validateReference: (reference) => validateUserReference(branch, reference) || confirmationValid(reference),
    validateSourceSpan: (span) => {
      for (const { record } of facts) for (const document of [record.taskSource, record.parentSource, record.parentSource?.master]) {
        if (document && document.path === span.path && document.digest === span.digest && Number.isInteger(span.startLine) && span.startLine > 0
          && Number.isInteger(span.endLine) && span.endLine >= span.startLine
          && document.text.split(/\r?\n/).slice(span.startLine - 1, span.endLine).join(document.text.includes("\r\n") ? "\r\n" : "\n") === span.text) return true;
      }
      return (span.path.startsWith("session://") || span.path.startsWith("native-todo://")) && validateSourceSpan(branch, cwd, span);
    },
    validateAmendment: (previous, next) => validateContract(previous) && validateContract(next) && next.previousRevisionId === previous.revisionId
      && next.incarnationId === previous.incarnationId && canonicalDigest(next.criteria) === canonicalDigest(previous.criteria),
  };
  return { facts, observations, validators, sourceFor, contextFor: (contract) => {
    const source = sourceFor(contract)?.record;
    if (!source || !validateContract(contract)) return undefined;
    return freezeContractValue(structuredClone({ contract: { contractId: contract.contractId, revisionId: contract.revisionId, incarnationId: contract.incarnationId },
      originalUserRequest: source.originalUserRequest, taskSource: source.taskSource, parentSource: source.parentSource, taskKind: source.taskKind,
      observedCookInput: observations.find((observation) => canonicalDigest(observation.reference) === canonicalDigest(source.inputObservation ?? {})),
      readScope: source.readScope, allowedMutationScope: source.allowedMutationScope, approvedCommandIds: source.approvedCommandIds,
      policyDigest: source.policyDigest, authorization: source.authorization }));
  } };
}

