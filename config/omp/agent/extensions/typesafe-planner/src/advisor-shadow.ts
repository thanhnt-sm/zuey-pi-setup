import { canonicalDigest } from "./task-contract-source";
import { record, validateAdvisorRequestIdentity, validateAdvisorReceipt, type AdvisorRequest, type AdvisorReceipt } from "./advisor-protocol";
import { ownsAdvisorHostReview, isCurrentAdvisorHostReview } from "./advisor-host";

export interface ShadowAdvisorExecution { runId: string; caseId: string; arm: "M" | "H" }
export interface NativeAdvisorReview { readonly request: AdvisorRequest; readonly receipt: AdvisorReceipt }
export type ShadowAdvisorReviewValidation = { valid: true; review: NativeAdvisorReview } | { valid: false; reason: string };
export function shadowAdvisorDispatchId(execution: ShadowAdvisorExecution): string {
  if (!execution.runId.trim() || !execution.caseId.trim() || !["M", "H"].includes(execution.arm)) throw new Error("shadow_execution_identity_required");
  return `shadow:${canonicalDigest(execution)}`;
}
/** Only live routing identity is rebound. Source resultCallId, corpus, proof, policy and question stay exact. */
export function shadowAdvisorTemplateDigest(request: AdvisorRequest, publicPrompt = request.publicPrompt): string {
  const { sessionId: _session, branchId: _branch, requestEntryId: _entry, dispatchId: _dispatch, ...semanticProvenance } = request.binding.provenance;
  const { workspaceRoot: _root, publicContextDigest: _context, ...scope } = request.scope;
  return canonicalDigest({ binding: { ...request.binding, provenance: semanticProvenance }, snapshot: request.snapshot, scope,
    criterionIds: request.criterionIds, parentRequirementIds: request.parentRequirementIds, evidenceRefs: request.evidenceRefs,
    integrationEvidenceRefs: request.integrationEvidenceRefs, publicPrompt, agent: request.agent });
}
export async function validateShadowAdvisorReview(template: AdvisorRequest, value: unknown, execution: ShadowAdvisorExecution): Promise<ShadowAdvisorReviewValidation> {
  if (!ownsAdvisorHostReview(value) || !(await isCurrentAdvisorHostReview(value))) return { valid: false, reason: "current_host_owned_native_review_required" };
  const { request, receipt } = value;
  if (request.binding.purpose !== "shadow" || template.binding.purpose !== "shadow" || request.binding.provenance.dispatchId !== shadowAdvisorDispatchId(execution)
    || request.binding.authorizedScope.operations.some(operation => operation !== "read") || !validateAdvisorRequestIdentity(request)) return { valid: false, reason: "shadow_actual_dispatch_identity_mismatch" };
  let assignment: unknown;
  try { assignment = JSON.parse(request.publicPrompt); } catch { return { valid: false, reason: "shadow_host_public_assignment_required" }; }
  if (!record(assignment) || Object.keys(assignment).length !== 2 || typeof assignment.reviewHandle !== "string"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(assignment.reviewHandle)
    || assignment.publicReview !== template.publicPrompt || shadowAdvisorTemplateDigest(request, assignment.publicReview) !== shadowAdvisorTemplateDigest(template)) return { valid: false, reason: "shadow_frozen_semantic_template_changed" };
  const checked = validateAdvisorReceipt(receipt, { request, binding: request.binding, snapshot: request.snapshot, criterionIds: request.criterionIds,
    parentRequirementIds: request.parentRequirementIds, requireParentIntegration: request.parentRequirementIds.length > 0 });
  if (!checked.valid || receipt.authority !== "none") return { valid: false, reason: checked.reason ?? "shadow_receipt_authority_invalid" };
  return { valid: true, review: value };
}
