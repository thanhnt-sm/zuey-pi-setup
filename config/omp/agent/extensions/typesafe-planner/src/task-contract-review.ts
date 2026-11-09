import type { AllowedMutationScope, HostReference, ReviewBinding, ReviewProvenance, TaskContract } from "./types/verification";
import { canonicalDigest, freezeContractValue, isDigest, nonempty } from "./task-contract-source";
import { validHostReference } from "./task-contract";

export interface ReviewBindingContext {
  sessionId: string;
  branchId: string;
  purpose: ReviewBinding["purpose"];
  expectedProvenance: ReviewProvenance;
  authorizedScope: AllowedMutationScope;
  validateReference(reference: HostReference): boolean;
  acceptsOriginBranch?(branchId: string, sourceEntryId: string): boolean;
  contract?: TaskContract;
  logicalOperationId?: string;
  parentObligationIds?: readonly string[];
  childReceiptIds?: readonly string[];
  integrationReceiptIds?: readonly string[];
  /** Explicit frozen shadow corpus, never looked up as a live contract. */
  corpus?: { corpusId: string; caseId: string; contractDigest: string };
}

export type BindingValidation =
  | { valid: true; binding: ReviewBinding; authority: "none" | "task_bound" }
  | { valid: false; reason: string };

/** Validating binding is not semantic approval or native authorization. */
export function validateReviewBinding(raw: unknown, context: ReviewBindingContext): BindingValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { valid: false, reason: "binding_malformed" };
  // This single boundary assertion is followed by validation of every consumed field.
  const binding = raw as ReviewBinding;
  const provenance = binding.provenance;
  if (!provenance || binding.purpose !== context.purpose || provenance.sessionId !== context.sessionId || provenance.branchId !== context.branchId
    || ![provenance.requestEntryId, provenance.dispatchId].every(nonempty)
    || ![provenance.evidenceDigest, provenance.questionDigest, provenance.policyDigest].every(isDigest)
    || (provenance.resultCallId !== undefined && !nonempty(provenance.resultCallId))
    || canonicalDigest(provenance) !== canonicalDigest(context.expectedProvenance)
    || !binding.authorizedScope || canonicalDigest(binding.authorizedScope) !== canonicalDigest(context.authorizedScope)) {
    return { valid: false, reason: "binding_provenance_or_scope_mismatch" };
  }
  if (binding.purpose === "consultation") {
    if ("contract" in binding || "target" in binding || "logicalOperationId" in binding || "corpus" in binding
      || !validHostReference(binding.request) || binding.request.sessionId !== context.sessionId
      || binding.request.entryId !== provenance.requestEntryId || !context.validateReference(binding.request)) {
      return { valid: false, reason: "consultation_has_no_native_authority" };
    }
    return { valid: true, binding: freezeContractValue(structuredClone(binding)), authority: "none" };
  }
  if (binding.purpose === "shadow") {
    if ("contract" in binding || "target" in binding || "logicalOperationId" in binding
      || !context.corpus || !binding.corpus || !nonempty(binding.corpus.corpusId) || !nonempty(binding.corpus.caseId)
      || !isDigest(binding.corpus.contractDigest) || canonicalDigest(binding.corpus) !== canonicalDigest(context.corpus)) {
      return { valid: false, reason: "shadow_corpus_has_no_live_authority" };
    }
    return { valid: true, binding: freezeContractValue(structuredClone(binding)), authority: "none" };
  }
  const contract = context.contract;
  if (!contract || !binding.contract || !binding.target || "corpus" in binding || "request" in binding
    || contract.creation.sessionId !== context.sessionId
    || (contract.creation.branchId !== context.branchId && !context.acceptsOriginBranch?.(contract.creation.branchId, contract.creation.entryId))
    || binding.contract.contractId !== contract.contractId || binding.contract.revisionId !== contract.revisionId
    || binding.contract.incarnationId !== contract.incarnationId || provenance.policyDigest !== contract.policyDigest
    || !nonempty(binding.logicalOperationId) || binding.logicalOperationId !== context.logicalOperationId
    || canonicalDigest(binding.target) !== canonicalDigest(contract.target)
    || canonicalDigest(binding.authorizedScope) !== canonicalDigest(contract.allowedMutationScope)) {
    return { valid: false, reason: "task_binding_stale_or_foreign" };
  }
  if (binding.purpose === "parent_review") {
    const expectedObligations = context.parentObligationIds;
    if (!expectedObligations?.length || !Array.isArray(binding.parentObligationIds)
      || !Array.isArray(binding.childReceiptIds) || !Array.isArray(binding.integrationReceiptIds)
      || ![...binding.parentObligationIds, ...binding.childReceiptIds, ...binding.integrationReceiptIds].every(nonempty)
      || canonicalDigest(binding.parentObligationIds) !== canonicalDigest(expectedObligations)
      || canonicalDigest(binding.childReceiptIds) !== canonicalDigest(context.childReceiptIds ?? [])
      || canonicalDigest(binding.integrationReceiptIds) !== canonicalDigest(context.integrationReceiptIds ?? [])) {
      return { valid: false, reason: "parent_obligations_or_receipts_mismatch" };
    }
  }
  return { valid: true, binding: freezeContractValue(structuredClone(binding)), authority: "task_bound" };
}
