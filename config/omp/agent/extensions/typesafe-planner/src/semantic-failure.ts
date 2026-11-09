import type { VerificationOutcome } from "./types/verification";

const evidenceCodes = new Set(["EVIDENCE_REQUIRED", "payload too large", "payload_too_large", "question_limit_exceeded", "question_identity_changed", "prepared_validation_failed", "insufficient_deliverable_evidence", "review_packet_limit", "review_packet_invalid", "review_packet_not_admitted", "review_dispatch_limit"]);
const configurationCodes = new Set(["policy_invalid", "policy_client_missing", "policy_client_unavailable", "model_not_allowed", "redact_unavailable", "invalid_input"]);
const credentialCodes = new Set(["credential_unavailable", "api_key_missing", "missing_api_key"]);
const schedulerCodes = new Set(["review_queue_full", "review_deadline_exceeded"]);

/** Local proof/configuration failures are not failed implementations or invented remote outages. */
export function semanticFailureDisposition(code: string | undefined, criterionIds: readonly string[] = []): VerificationOutcome {
  if (code && evidenceCodes.has(code)) return { status: "EVIDENCE_REQUIRED", missingCriterionIds: [...criterionIds],
    reasons: [`Local prepared evidence/request prerequisite failed (${code}). Supply honest complete bounded proof; no clipping, rubric change, threshold tuning or implementation failure was inferred.`] };
  const component = code && configurationCodes.has(code) ? "semantic_configuration"
    : code && credentialCodes.has(code) ? "semantic_credentials"
    : code && schedulerCodes.has(code) ? "semantic_scheduler"
    : code === "cancelled" ? "review_cancelled"
    : code === "bad_response" || code === undefined ? "semantic_response" : "semantic_judge";
  return { status: "UNAVAILABLE", component, reasons: [component === "semantic_configuration"
    ? `Trusted verification configuration/preparation is unavailable (${code}). Restore that exact prerequisite; this is not a semantic rejection or a claimed provider outage.`
    : `Actual verification prerequisite unavailable (${code ?? "required primitive answers absent or invalid"}). Preserve the task and restore the named runtime/service/response prerequisite; no implementation defect or approval was inferred.`] };
}
