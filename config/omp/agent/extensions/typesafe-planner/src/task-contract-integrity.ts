import type { SourceSpan, TaskContract } from "./types/verification";
import { canonicalDigest, contractDigest, isDigest, nativeTaskSourceUri, nonempty } from "./task-contract-source";

function assertSourceSpan(raw: unknown): asserts raw is SourceSpan {
  if (!raw || typeof raw !== "object") throw new Error("contract_source_span_malformed");
  const span = raw as SourceSpan;
  if (!nonempty(span.path) || !isDigest(span.digest) || !nonempty(span.text)
    || !Number.isInteger(span.startLine) || span.startLine < 1 || !Number.isInteger(span.endLine) || span.endLine < span.startLine
    || span.text.split(/\r?\n/).length !== span.endLine - span.startLine + 1) throw new Error("contract_source_span_malformed");
}

/** Parse the persisted boundary once before trusting its named domain fields. */
export function assertContractIntegrity(raw: unknown): asserts raw is TaskContract {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("malformed_contract");
  const contract = raw as TaskContract;
  if (Object.keys(contract).some((key) => ![
    "schemaVersion", "contractId", "revision", "revisionId", "incarnationId", "creation", "target", "taskKind",
    "allowedMutationScope", "approvedSource", "originalUserRequest", "amendments", "criteria", "approvedCommandIds",
    "parentRequirements", "policyDigest", "previousRevisionId",
  ].includes(key))) throw new Error("contract_nonportable_field");
  const creation = contract.creation;
  const target = contract.target;
  if (contract.schemaVersion !== 1 || ![contract.contractId, contract.revisionId, contract.incarnationId, contract.policyDigest].every(isDigest)
    || !Number.isInteger(contract.revision) || contract.revision < 1
    || (contract.previousRevisionId !== undefined && !isDigest(contract.previousRevisionId))
    || !creation || ![creation.sessionId, creation.branchId, creation.entryId, creation.callId].every(nonempty)
    || !target || ![target.phase, target.content].every(nonempty)
    || !Number.isInteger(target.ordinal) || target.ordinal < 0 || !Number.isInteger(target.phaseOrdinal) || target.phaseOrdinal < 0
    || !["implementation", "research", "review", "operations"].includes(contract.taskKind)
    || !contract.allowedMutationScope || !Array.isArray(contract.allowedMutationScope.paths)
    || !contract.allowedMutationScope.paths.every(nonempty) || !Array.isArray(contract.allowedMutationScope.operations)
    || !contract.allowedMutationScope.operations.every((operation) => ["read", "create", "modify", "delete", "execute"].includes(operation))
    || !Array.isArray(contract.approvedCommandIds) || !contract.approvedCommandIds.every(nonempty)
    || new Set(contract.approvedCommandIds).size !== contract.approvedCommandIds.length
    || !Array.isArray(contract.parentRequirements) || !Array.isArray(contract.criteria) || !contract.criteria.length) throw new Error("malformed_contract");
  const criterionIds = new Set<string>();
  for (const criterion of contract.criteria) {
    if (!criterion || !nonempty(criterion.text) || !["requirement", "acceptance", "original_request", "native_task", "parent_integration"].includes(criterion.kind)) throw new Error("malformed_contract_criterion");
    assertSourceSpan(criterion.source);
    const sourceLines = criterion.source.text.split(/\r?\n/);
    const bullet = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)(\S.*)$/.exec(sourceLines[0]);
    const extracted = criterion.kind === "original_request" || criterion.kind === "native_task" ? criterion.source.text
      : [bullet?.[1] ?? sourceLines[0].trim(), ...sourceLines.slice(1).map((line) => line.trim())].join("\n");
    if (criterion.text !== extracted || (criterion.kind === "native_task" && criterion.text !== target.content)) {
      throw new Error("malformed_contract_criterion");
    }
    const id = canonicalDigest({ path: criterion.source.path, digest: criterion.source.digest, kind: criterion.kind,
      start: criterion.source.startLine - 1, end: criterion.source.endLine - 1, text: criterion.text });
    if (criterion.id !== id || criterionIds.has(id)) throw new Error("malformed_contract_criterion");
    criterionIds.add(id);
  }
  for (const requirement of contract.parentRequirements) {
    if (!requirement || !nonempty(requirement.parentContractId) || !nonempty(requirement.criterionId)) throw new Error("malformed_parent_requirement");
    assertSourceSpan(requirement.source);
  }
  const source = contract.approvedSource;
  if (!source || !["plan", "user_request", "native_task"].includes(source.kind) || !nonempty(source.path) || !isDigest(source.digest)
    || (source.kind === "plan" && !nonempty(source.phaseHeading)) || !Array.isArray(source.spans) || !source.spans.length) throw new Error("malformed_approved_source");
  if (source.kind === "native_task" && (!source.nativeBinding
    || canonicalDigest(source.nativeBinding.creation) !== canonicalDigest(creation)
    || canonicalDigest(source.nativeBinding.target) !== canonicalDigest(target)
    || source.path !== nativeTaskSourceUri(creation, target)
    || source.digest !== contractDigest(target.content) || source.spans.length !== 1 || source.spans[0]?.text !== target.content)) {
    throw new Error("contract_native_source_binding_invalid");
  }
  for (const span of source.spans) {
    assertSourceSpan(span);
    if (span.path !== source.path || span.digest !== source.digest) throw new Error("malformed_approved_source");
  }
}
