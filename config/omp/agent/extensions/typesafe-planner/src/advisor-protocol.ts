import { canonicalDigest, freezeContractValue, isDigest, nonempty } from "./task-contract-source";
import { validateReviewBinding, type ReviewBindingContext } from "./task-contract-review";
import type { ReviewBinding } from "./types/verification";

export interface ReviewSnapshot {
  contractDigest: string; evidenceDigest: string; treeDigest: string; testDigest: string;
  policyDigest: string; parentDigest: string; childDigest: string; integrationDigest: string;
}
export function isReviewSnapshot(value: unknown): value is ReviewSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  const keys = ["contractDigest", "evidenceDigest", "treeDigest", "testDigest", "policyDigest", "parentDigest", "childDigest", "integrationDigest"];
  return Object.keys(fields).length === keys.length && keys.every(key => isDigest(fields[key]));
}
export interface AdvisorScope {
  workspaceRoot: string;
  /** Exact host-authorized immutable files, not recursive directory grants. */
  files: readonly { path: string; sha256: string }[];
  resources: readonly { uri: string; digest: string }[];
  publicContextDigest: string;
  egressPolicyDigest: string;
}
export interface AdvisorRequest {
  schemaVersion: 1; requestId: string; binding: ReviewBinding; bindingDigest: string;
  snapshot: ReviewSnapshot; scope: AdvisorScope; criterionIds: readonly string[];
  parentRequirementIds: readonly string[];
  evidenceRefs: readonly string[]; integrationEvidenceRefs: readonly string[];
  publicPrompt: string; promptDigest: string; sessionEpoch: string;
  parentAgentId: string; parentToolCallId: string; itemIndex: number;
  agent: "advisor" | "ck:advisor"; requestDigest: string;
}
export interface AdvisorAssessment {
  verdict: "proceed" | "revise" | "block" | "human_required" | "unavailable";
  recommendation: string;
  rankedOptions: readonly { option: string; rationale: string; rank: number }[];
  findings: readonly { severity: "critical" | "high" | "medium" | "low" | "info"; claim: string; evidenceRefs: readonly string[] }[];
  confidence: number; openQuestions: readonly string[];
  criterionCoverage: readonly { criterionId: string; status: "covered" | "uncovered" | "contradicted"; evidenceRefs: readonly string[] }[];
  parentIntegration: { status: "not_applicable" | "supported" | "contradicted" | "insufficient"; criterionIds: readonly string[]; evidenceRefs: readonly string[] };
}
export interface AdvisorReceipt {
  schemaVersion: 1; receiptId: string; requestId: string; binding: ReviewBinding; bindingDigest: string;
  snapshot: ReviewSnapshot; assessment: AdvisorAssessment; assessmentDigest: string;
  parentRequirementIds: readonly string[];
  provenance: { parentToolCallId: string; itemIndex: number; childId: string; sessionEpoch: string; terminalDigest: string };
  authority: "none" | "task_bound";
}
export const advisorOutputSchema = freezeContractValue({
  type: "object", additionalProperties: false,
  required: ["verdict", "recommendation", "rankedOptions", "findings", "confidence", "openQuestions", "criterionCoverage", "parentIntegration"],
  properties: {
    verdict: { type: "string", enum: ["proceed", "revise", "block", "human_required", "unavailable"] },
    recommendation: { type: "string", minLength: 1 }, confidence: { type: "number", minimum: 0, maximum: 1 },
    rankedOptions: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["option", "rationale", "rank"], properties: { option: { type: "string" }, rationale: { type: "string" }, rank: { type: "integer", minimum: 1 } } } },
    findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["severity", "claim", "evidenceRefs"], properties: { severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] }, claim: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } } } },
    openQuestions: { type: "array", items: { type: "string" } },
    criterionCoverage: { type: "array", items: { type: "object", additionalProperties: false, required: ["criterionId", "status", "evidenceRefs"], properties: { criterionId: { type: "string" }, status: { type: "string", enum: ["covered", "uncovered", "contradicted"] }, evidenceRefs: { type: "array", items: { type: "string" } } } } },
    parentIntegration: { type: "object", additionalProperties: false, required: ["status", "criterionIds", "evidenceRefs"], properties: { status: { type: "string", enum: ["not_applicable", "supported", "contradicted", "insufficient"] }, criterionIds: { type: "array", items: { type: "string" } }, evidenceRefs: { type: "array", items: { type: "string" } } } },
  },
});
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);
export type AdvisorRequestInput = Omit<AdvisorRequest, "schemaVersion" | "requestId" | "requestDigest" | "bindingDigest" | "promptDigest" | "parentRequirementIds"> & { parentRequirementIds?: readonly string[] };
export function createAdvisorRequest(input: AdvisorRequestInput, context: ReviewBindingContext): AdvisorRequest {
  const validated = validateReviewBinding(input.binding, context);
  if (!validated.valid) throw new Error(validated.reason);
  const parentRequirementIds = input.parentRequirementIds ?? (input.binding.purpose === "parent_review" ? input.binding.parentObligationIds : []);
  if (!parentRequirementIds.every(nonempty) || new Set(parentRequirementIds).size !== parentRequirementIds.length
    || input.binding.purpose === "parent_review" && canonicalDigest(parentRequirementIds) !== canonicalDigest(input.binding.parentObligationIds)) throw new Error("advisor_original_parent_requirements_required");
  if (!isReviewSnapshot(input.snapshot) || input.snapshot.evidenceDigest !== input.binding.provenance.evidenceDigest || input.snapshot.policyDigest !== input.binding.provenance.policyDigest
    || !input.criterionIds.length || new Set(input.criterionIds).size !== input.criterionIds.length || !input.criterionIds.every(nonempty)
    || !input.evidenceRefs.length || !input.evidenceRefs.every(nonempty) || !input.integrationEvidenceRefs.every(ref => nonempty(ref) && input.evidenceRefs.includes(ref))
    || ![input.publicPrompt, input.sessionEpoch, input.parentAgentId, input.parentToolCallId, input.scope.workspaceRoot].every(nonempty)
    || !Number.isSafeInteger(input.itemIndex) || input.itemIndex < 0 || !["advisor", "ck:advisor"].includes(input.agent)
    || ![input.scope.publicContextDigest, input.scope.egressPolicyDigest].every(isDigest)
    || input.scope.files.some(file => !nonempty(file.path) || !isDigest(file.sha256))
    || input.scope.resources.some(resource => !nonempty(resource.uri) || !isDigest(resource.digest))) throw new Error("advisor_request_invalid");
  const body = structuredClone({ schemaVersion: 1 as const, binding: input.binding, snapshot: input.snapshot, scope: input.scope,
    criterionIds: input.criterionIds, parentRequirementIds, evidenceRefs: input.evidenceRefs, integrationEvidenceRefs: input.integrationEvidenceRefs,
    publicPrompt: input.publicPrompt, sessionEpoch: input.sessionEpoch, parentAgentId: input.parentAgentId,
    parentToolCallId: input.parentToolCallId, itemIndex: input.itemIndex, agent: input.agent,
    bindingDigest: canonicalDigest(input.binding), promptDigest: canonicalDigest(input.publicPrompt) });
  const requestDigest = canonicalDigest(body);
  return freezeContractValue({ ...body, requestId: `advisor:${requestDigest}`, requestDigest });
}
export function validateAdvisorRequestIdentity(request: unknown): request is AdvisorRequest {
  if (!record(request) || !record(request.binding) || !record(request.binding.provenance) || !nonempty(request.binding.provenance.sessionId)
    || !record(request.binding.authorizedScope) || !Array.isArray(request.binding.authorizedScope.operations)
    || !Array.isArray(request.binding.authorizedScope.paths) || !isReviewSnapshot(request.snapshot)
    || !record(request.scope) || !nonempty(request.scope.workspaceRoot) || !Array.isArray(request.scope.files) || !Array.isArray(request.scope.resources)
    || request.scope.files.some(file => !record(file) || !nonempty(file.path) || !isDigest(file.sha256))
    || request.scope.resources.some(resource => !record(resource) || !nonempty(resource.uri) || !isDigest(resource.digest))
    || !stringList(request.criterionIds) || !request.criterionIds.length || !stringList(request.parentRequirementIds)
    || new Set(request.parentRequirementIds).size !== request.parentRequirementIds.length
    || !stringList(request.evidenceRefs) || !stringList(request.integrationEvidenceRefs)
    || ![request.publicPrompt, request.sessionEpoch, request.parentAgentId, request.parentToolCallId].every(nonempty)
    || !Number.isSafeInteger(request.itemIndex) || Number(request.itemIndex) < 0 || !["advisor", "ck:advisor"].includes(String(request.agent))) return false;
  const { requestId, requestDigest, ...body } = request;
  return request.schemaVersion === 1 && requestId === `advisor:${requestDigest}` && requestDigest === canonicalDigest(body)
    && request.bindingDigest === canonicalDigest(request.binding) && request.promptDigest === canonicalDigest(request.publicPrompt);
}
/**
 * Invariant: cross-dispatch reuse is permitted only for an identical binding
 * (contract/revision/evidence/policy), snapshot, scope, criteria and prompt;
 * dispatchId is excluded by design so turn boundaries don't discard genuine reviews.
 */
export function advisorApplicabilityDigest(request: AdvisorRequest): string {
  const { provenance, ...binding } = request.binding;
  const { dispatchId: _dispatchId, ...origin } = provenance;
  return canonicalDigest({ binding, origin, snapshot: request.snapshot, scope: request.scope, criterionIds: request.criterionIds, parentRequirementIds: request.parentRequirementIds,
    evidenceRefs: request.evidenceRefs, integrationEvidenceRefs: request.integrationEvidenceRefs, promptDigest: request.promptDigest,
    sessionEpoch: request.sessionEpoch, parentAgentId: request.parentAgentId, agent: request.agent });
}
export function validateAssessment(raw: unknown, criterionIds: readonly string[], parent: boolean): raw is AdvisorAssessment {
  if (!record(raw) || !["proceed", "revise", "block", "human_required", "unavailable"].includes(String(raw.verdict)) || !nonempty(raw.recommendation)
    || typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1 || !stringList(raw.openQuestions)
    || !Array.isArray(raw.rankedOptions) || !raw.rankedOptions.length || !raw.rankedOptions.every((v, index) => record(v) && Object.keys(v).every(key => ["option", "rationale", "rank"].includes(key)) && nonempty(v.option) && nonempty(v.rationale) && v.rank === index + 1)
    || !Array.isArray(raw.findings) || !raw.findings.every(v => record(v) && Object.keys(v).every(key => ["severity", "claim", "evidenceRefs"].includes(key)) && ["critical", "high", "medium", "low", "info"].includes(String(v.severity)) && nonempty(v.claim) && stringList(v.evidenceRefs))
    || !Array.isArray(raw.criterionCoverage) || raw.criterionCoverage.length !== criterionIds.length
    || !raw.criterionCoverage.every(v => record(v) && Object.keys(v).every(key => ["criterionId", "status", "evidenceRefs"].includes(key)) && criterionIds.includes(String(v.criterionId)) && ["covered", "uncovered", "contradicted"].includes(String(v.status)) && stringList(v.evidenceRefs) && (v.status !== "covered" || v.evidenceRefs.length > 0))
    || new Set(raw.criterionCoverage.map(v => v.criterionId)).size !== criterionIds.length
    || !record(raw.parentIntegration) || !["not_applicable", "supported", "contradicted", "insufficient"].includes(String(raw.parentIntegration.status))
    || !Object.keys(raw.parentIntegration).every(key => ["status", "criterionIds", "evidenceRefs"].includes(key))
    || !stringList(raw.parentIntegration.criterionIds) || !stringList(raw.parentIntegration.evidenceRefs)) return false;
  if (parent && (raw.parentIntegration.status === "not_applicable" || !raw.parentIntegration.criterionIds.length
    || new Set(raw.parentIntegration.criterionIds).size !== raw.parentIntegration.criterionIds.length
    || (raw.parentIntegration.status === "supported" && !raw.parentIntegration.evidenceRefs.length))) return false;
  return Object.keys(raw).every(key => ["verdict", "recommendation", "rankedOptions", "findings", "confidence", "openQuestions", "criterionCoverage", "parentIntegration"].includes(key));
}
export function validateAssessmentForRequest(raw: unknown, request: AdvisorRequest): raw is AdvisorAssessment {
  if (!validateAssessment(raw, request.criterionIds, request.parentRequirementIds.length > 0)) return false;
  const references = [...raw.findings.flatMap(finding => [...finding.evidenceRefs]), ...raw.criterionCoverage.flatMap(criterion => [...criterion.evidenceRefs]), ...raw.parentIntegration.evidenceRefs];
  if (references.some(ref => !request.evidenceRefs.includes(ref))) return false;
  if (request.parentRequirementIds.length) {
    if (canonicalDigest([...raw.parentIntegration.criterionIds].sort()) !== canonicalDigest([...request.parentRequirementIds].sort())) return false;
    if (raw.parentIntegration.status === "supported" && (!raw.parentIntegration.evidenceRefs.length || raw.parentIntegration.evidenceRefs.some(ref => !request.integrationEvidenceRefs.includes(ref)))) return false;
  } else if (raw.parentIntegration.status !== "not_applicable" || raw.parentIntegration.criterionIds.length || raw.parentIntegration.evidenceRefs.length) return false;
  return true;
}
export function makeAdvisorReceipt(request: AdvisorRequest, assessment: AdvisorAssessment, childId: string, terminalDigest: string): AdvisorReceipt {
  if (!validateAssessmentForRequest(assessment, request) || !nonempty(childId) || !isDigest(terminalDigest)) throw new Error("advisor_assessment_invalid");
  const body = { schemaVersion: 1 as const, requestId: request.requestId, binding: request.binding, bindingDigest: request.bindingDigest,
    snapshot: request.snapshot, parentRequirementIds: request.parentRequirementIds, assessment: structuredClone(assessment), assessmentDigest: canonicalDigest(assessment),
    provenance: { parentToolCallId: request.parentToolCallId, itemIndex: request.itemIndex, childId, sessionEpoch: request.sessionEpoch, terminalDigest },
    authority: request.binding.purpose === "consultation" || request.binding.purpose === "shadow" ? "none" as const : "task_bound" as const };
  return freezeContractValue({ ...body, receiptId: `advisor-receipt:${canonicalDigest(body)}` });
}
export interface AdvisorReceiptExpectation {
  binding: ReviewBinding; snapshot: ReviewSnapshot; criterionIds: readonly string[]; parentRequirementIds?: readonly string[]; requireParentIntegration?: boolean; request?: AdvisorRequest;
}
export function validateAdvisorReceipt(raw: unknown, expected: AdvisorReceiptExpectation): { valid: boolean; reason?: string } {
  if (!record(raw)) return { valid: false, reason: "advisor_receipt_missing" };
  const { receiptId, ...body } = raw;
  if (raw.schemaVersion !== 1 || receiptId !== `advisor-receipt:${canonicalDigest(body)}` || raw.bindingDigest !== canonicalDigest(expected.binding)
    || canonicalDigest(raw.binding) !== canonicalDigest(expected.binding) || canonicalDigest(raw.snapshot) !== canonicalDigest(expected.snapshot)
    || !stringList(raw.parentRequirementIds) || new Set(raw.parentRequirementIds).size !== raw.parentRequirementIds.length
    || expected.parentRequirementIds && canonicalDigest(raw.parentRequirementIds) !== canonicalDigest(expected.parentRequirementIds)
    || !validateAssessment(raw.assessment, expected.criterionIds, expected.requireParentIntegration === true) || raw.assessmentDigest !== canonicalDigest(raw.assessment)
    || !record(raw.provenance) || !nonempty(raw.provenance.childId) || !nonempty(raw.provenance.parentToolCallId) || !nonempty(raw.provenance.sessionEpoch) || !isDigest(raw.provenance.terminalDigest)
    || !Number.isSafeInteger(raw.provenance.itemIndex) || Number(raw.provenance.itemIndex) < 0
    || raw.authority !== (["consultation", "shadow"].includes(expected.binding.purpose) ? "none" : "task_bound")) return { valid: false, reason: "advisor_receipt_stale_or_invalid" };
  if (canonicalDigest([...raw.assessment.parentIntegration.criterionIds].sort()) !== canonicalDigest([...raw.parentRequirementIds].sort())) return { valid: false, reason: "advisor_parent_requirement_coverage_mismatch" };
  if (expected.request && (raw.requestId !== expected.request.requestId || raw.provenance.parentToolCallId !== expected.request.parentToolCallId
    || raw.provenance.itemIndex !== expected.request.itemIndex || raw.provenance.sessionEpoch !== expected.request.sessionEpoch
    || canonicalDigest(raw.parentRequirementIds) !== canonicalDigest(expected.request.parentRequirementIds)
    || !validateAssessmentForRequest(raw.assessment, expected.request))) return { valid: false, reason: "advisor_request_or_evidence_manifest_mismatch" };
  return { valid: true };
}
export type AdvisorJournalRecord =
  | { kind: "advisor_request"; request: AdvisorRequest }
  | { kind: "advisor_receipt"; receipt: AdvisorReceipt }
  | { kind: "advisor_invalidated"; requestId: string; reason: string }
  | { kind: "advisor_continued"; requestId: string };
/** Only host-owned active-branch entries may be passed; JSON imports are not an authority source. */
export function foldAdvisorHistory(entries: readonly AdvisorJournalRecord[], current: { sessionId: string; sessionEpoch: string }): Map<string, { request: AdvisorRequest; receipt?: AdvisorReceipt; continued: boolean; invalidated: boolean }> {
  const requests = new Map<string, { request: AdvisorRequest; receipt?: AdvisorReceipt; continued: boolean; invalidated: boolean }>();
  for (const entry of entries) {
    if (entry.kind === "advisor_request") {
      const request = entry.request;
      if (validateAdvisorRequestIdentity(request) && request.binding.provenance.sessionId === current.sessionId && request.sessionEpoch === current.sessionEpoch && !requests.has(request.requestId)) requests.set(request.requestId, { request: freezeContractValue(structuredClone(request)), continued: false, invalidated: false });
      continue;
    }
    const state = requests.get(entry.kind === "advisor_receipt" ? entry.receipt.requestId : entry.requestId);
    if (!state) continue;
    if (entry.kind === "advisor_invalidated") { state.invalidated = true; delete state.receipt; }
    if (entry.kind === "advisor_continued") state.continued = true;
    if (entry.kind === "advisor_receipt") {
      const valid = validateAdvisorReceipt(entry.receipt, { binding: state.request.binding, snapshot: state.request.snapshot, criterionIds: state.request.criterionIds, requireParentIntegration: state.request.binding.purpose === "parent_review", request: state.request });
      if (!valid.valid || (state.receipt && canonicalDigest(state.receipt) !== canonicalDigest(entry.receipt))) { state.invalidated = true; delete state.receipt; }
      else if (!state.invalidated) state.receipt = freezeContractValue(structuredClone(entry.receipt));
    }
  }
  return requests;
}
