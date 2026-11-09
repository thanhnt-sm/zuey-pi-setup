import { createRequire } from "node:module";
import { createAtomicJudge, type AtomicAttempt, type AtomicInput, type AtomicReviewReceipt } from "./atomic-judge";
import { isReviewSnapshot, record, validateAdvisorReceipt, validateAssessmentForRequest, type AdvisorReceipt, type AdvisorRequest } from "./advisor-protocol";
import { runPhaseMacroCheck, type MacroCheckContext, type MacroCheckResult, type ExpertJudgeClient } from "./cook-expert-judge";
import { canonicalDigest } from "./task-contract-source";
import type { SemanticTransportMetadata } from "./semantic-judge-client";
import { createEvidencePacketSetValidator, type PreparedPacketBody } from "./judge-evidence-packet";
import { runAtomicDeterministicChecks } from "./atomic-checks";
import { validateShadowAdvisorReview, type NativeAdvisorReview, type ShadowAdvisorExecution } from "./advisor-shadow";
import { isCurrentAdvisorHostReview } from "./advisor-host";
import { resolveAtomicDecisionPolicy, atomicNoulPolicyApplies, type AtomicPredicateDecisionPolicy } from "./atomic-decision-policy";
import { assertSemanticApprovalPolicy, type SemanticApprovalPolicy } from "./semantic-approval-policy";
export type { NativeAdvisorReview } from "./advisor-shadow";

export interface AtomicEvaluationInput { atomic: AtomicInput; macro: MacroCheckContext; advisorRequest: AdvisorRequest }
export interface AtomicShadowContext { mode: "shadow"; allowMutation: false; allowAuthorityReuse: false; signal?: AbortSignal; runId?: string; caseId?: string }
export interface AtomicEvaluationResult {
  disposition: "APPROVE" | "REJECT" | "EVIDENCE_REQUIRED" | "HUMAN_ESCALATION" | "UNAVAILABLE";
  status: "terminal" | "prerequisite_pending"; reasons: string[];
  atomicReceipt?: AtomicReviewReceipt; macroResult?: MacroCheckResult; advisorReceipt?: AdvisorReceipt; advisorRequest?: AdvisorRequest;
  macroApprovalPolicyDigest?: string; predicateDecisionPolicyDigest?: string;
  attempts: AtomicAttempt[]; uncoveredCriterionIds: string[]; uncoveredParentRequirementIds: string[]; uncoveredArtifactPaths: string[]; mutationAllowed: false; authorityReusable: false;
}
export interface NativeAdvisorUnavailable { status: "UNAVAILABLE"; reasons: string[] }
export interface AtomicExecutionIdentity extends ShadowAdvisorExecution {}
export interface PairedReviewDriverOptions {
  trustedPolicy?: unknown; predicateDecisionPolicy?: AtomicPredicateDecisionPolicy; approvalPolicy?: SemanticApprovalPolicy; apiKey?: string; fetchImpl?: typeof fetch;
  dispatchAdvisor?: (request: AdvisorRequest, signal: AbortSignal | undefined, execution: AtomicExecutionIdentity) => Promise<NativeAdvisorReview | NativeAdvisorUnavailable>;
}
export interface PairedReviewDriver {
  evaluate(strategy: "M" | "H", input: unknown, shadowContext: AtomicShadowContext): Promise<AtomicEvaluationResult>;
}
interface Job { signal: AbortSignal; admitPacket(id: string): { ok: boolean }; markCovered(id: string): void }
interface Policy { ok: true; policyIdentity: string }
type EvaluationTransportResult = { ok: true; answers: Record<string, unknown>; metadata: SemanticTransportMetadata } | { ok: false; code: string; metadata?: SemanticTransportMetadata };
interface PolicyTransport {
  resolveTrustedToolPolicy(purpose: string, raw?: unknown): Policy | { ok: false };
  createSemanticReviewScheduler(policy: Policy): { run(manifest: { id: string; criteria: string[] }[], worker: (job: Job) => Promise<{ ok: boolean }>, options: { signal?: AbortSignal }): Promise<{ ok: boolean; code?: string }> };
  judgeWithPolicy(options: { args: { state: unknown; questions: Record<string, unknown>; model: string }; purpose: string; trustedPolicy: Policy; apiKey?: string; fetchImpl?: typeof fetch; signal: AbortSignal; reviewJob: Job; validatePrepared(prepared: PreparedPacketBody): { ok: true } | { ok: false; code: string } }): Promise<EvaluationTransportResult>;
}
/** Both arms execute real clients; the host supplies native dispatch, never a synthetic reasoner. */
export function createPairedReviewDriver(options: PairedReviewDriverOptions = {}): PairedReviewDriver {
  const atomic = createAtomicJudge(options);
  const transport = createRequire(import.meta.url)("./typesafe-policy-client.cjs") as PolicyTransport;
  const policy = transport.resolveTrustedToolPolicy("evaluation", options.trustedPolicy);
  const scheduler = policy.ok ? transport.createSemanticReviewScheduler(policy) : undefined;
  const dispatchAdvisor = options.dispatchAdvisor;
  const approvalPolicy = options.approvalPolicy;
  const decision = resolveAtomicDecisionPolicy(options.predicateDecisionPolicy);
  const usedNativeReceipts = new Set<string>();
  async function evaluate(strategy: "M" | "H", raw: unknown, shadow: AtomicShadowContext): Promise<AtomicEvaluationResult> {
    const base = { attempts: [] as AtomicAttempt[], uncoveredCriterionIds: [] as string[], uncoveredParentRequirementIds: [] as string[], uncoveredArtifactPaths: [] as string[], mutationAllowed: false as const, authorityReusable: false as const };
    const unavailable = (reason: string): AtomicEvaluationResult => ({ ...base, disposition: "UNAVAILABLE", status: "prerequisite_pending", reasons: [reason] });
    if (shadow.mode !== "shadow" || shadow.allowMutation !== false || shadow.allowAuthorityReuse !== false) return unavailable("shadow_mutation_and_authority_reuse_forbidden");
    if (!record(raw) || !record(raw.atomic) || !record(raw.macro) || !record(raw.advisorRequest)) return unavailable("atomic_evaluation_input_required");
    if (!isReviewSnapshot(raw.atomic.snapshot) || !record(raw.atomic.binding) || !record(raw.advisorRequest.binding)
      || !record(raw.atomic.binding.authorizedScope) || !Array.isArray(raw.atomic.binding.authorizedScope.operations)
      || !record(raw.advisorRequest.binding.authorizedScope) || !Array.isArray(raw.advisorRequest.binding.authorizedScope.operations)
      || !Array.isArray(raw.atomic.predicates) || !Array.isArray(raw.atomic.deterministicChecks) || !record(raw.atomic.packetSet) || !record(raw.atomic.packetSet.manifest) || !Array.isArray(raw.atomic.packetSet.packets)
      || !Array.isArray(raw.atomic.packetSet.manifest.uncoveredCriterionIds) || !Array.isArray(raw.atomic.packetSet.manifest.uncoveredParentRequirementIds) || !Array.isArray(raw.atomic.packetSet.manifest.uncoveredArtifactPaths)) return unavailable("atomic_evaluation_input_required");
    // Runtime domain validation remains in each real implementation; this assertion only bridges the unknown corpus boundary.
    const input = raw as unknown as AtomicEvaluationInput;
    if (!input.atomic.binding || !input.advisorRequest.binding || !Array.isArray(input.atomic.criteria) || !Array.isArray(input.advisorRequest.criterionIds)
      || !input.macro.contract || canonicalDigest(input.macro.contract.criteria) !== canonicalDigest(input.atomic.criteria)
      || canonicalDigest(input.macro.contract) !== input.atomic.snapshot.contractDigest
      || canonicalDigest(input.atomic.packetSet.manifest.criteria) !== canonicalDigest(input.atomic.criteria)
      || input.atomic.packetSet.manifest.contractDigest !== input.atomic.snapshot.contractDigest
      || input.atomic.binding.purpose !== "shadow" || input.advisorRequest.binding.purpose !== "shadow"
      || canonicalDigest(input.atomic.binding) !== canonicalDigest(input.advisorRequest.binding)
      || canonicalDigest(input.atomic.snapshot) !== canonicalDigest(input.advisorRequest.snapshot)
      || canonicalDigest(input.atomic.criteria.map(c => c.id)) !== canonicalDigest(input.advisorRequest.criterionIds)) return unavailable("shadow_binding_or_coverage_mismatch");
    const parentRequirementIds = input.atomic.packetSet.manifest.parentRequirements.map(parent => `parent:${parent.parentContractId}:${parent.criterionId}`);
    if (canonicalDigest(parentRequirementIds) !== canonicalDigest(input.advisorRequest.parentRequirementIds)) return unavailable("shadow_original_parent_coverage_mismatch");
    if (input.atomic.binding.authorizedScope.operations.some(operation => operation !== "read")
      || input.advisorRequest.binding.authorizedScope.operations.some(operation => operation !== "read")) return unavailable("shadow_mutation_scope_forbidden");
    if (!dispatchAdvisor) return unavailable("native_host_required");
    if (!shadow.runId?.trim() || !shadow.caseId?.trim()) return unavailable("shadow_execution_identity_required");
    if (!policy.ok || !scheduler) return unavailable("trusted_evaluation_policy_required");
    if (!approvalPolicy) return unavailable("predeclared_macro_approval_policy_required");
    try { assertSemanticApprovalPolicy(approvalPolicy); } catch { return unavailable("trusted_macro_approval_policy_required"); }
    if (!decision.ok || input.atomic.predicates.some(predicate => !atomicNoulPolicyApplies(predicate, decision.policy))) return unavailable("predeclared_atomic_decision_policy_required");
    if (shadow.signal?.aborted) return unavailable("cancelled");
    let atomicReceipt: AtomicReviewReceipt | undefined;
    let macroResult: MacroCheckResult | undefined;
    let advisorReceipt: AdvisorReceipt | undefined;
    let advisorReview: NativeAdvisorReview | undefined;
    const reasons: string[] = [];
    const attempts = base.attempts;
    const inFlight: { current?: { index: number; promise: Promise<EvaluationTransportResult> } } = {};
    try {
      // The native assessment is independent: it sees the frozen public template, never a desired JEV verdict.
      // The broker supplies only a genuine settled host pair, not corpus/native-placeholder identifiers.
      const result = await dispatchAdvisor(input.advisorRequest, shadow.signal, { runId: shadow.runId, caseId: shadow.caseId, arm: strategy });
      if ("status" in result) return { ...unavailable(result.reasons[0] ?? "native_advisor_unavailable"), reasons: [...result.reasons] };
      const checked = await validateShadowAdvisorReview(input.advisorRequest, result, { runId: shadow.runId, caseId: shadow.caseId, arm: strategy });
      if (!checked.valid) return unavailable(checked.reason);
      const identity = canonicalDigest(checked.review.receipt.provenance);
      if (usedNativeReceipts.has(identity)) return unavailable("shadow_native_receipt_reuse_forbidden");
      usedNativeReceipts.add(identity); advisorReview = checked.review; advisorReceipt = checked.review.receipt;
      if (strategy === "H") {
        atomicReceipt = await atomic.review(input.atomic, shadow.signal);
        attempts.push(...atomicReceipt.attempts);
      } else if (strategy === "M") {
        const packetId = `repaired-M:${canonicalDigest(input.atomic.packetSet.manifest)}`;
        const result = await scheduler.run([{ id: packetId, criteria: input.atomic.criteria.map(c => c.id) }], async job => {
          if (!job.admitPacket(packetId).ok) return { ok: false };
          const client: ExpertJudgeClient = { async evaluate(params) {
            const index = attempts.length;
            attempts.push({ packetId, policyIdentity: policy.policyIdentity, questionIds: Object.keys(params.questions), questionCount: Object.keys(params.questions).length, requestedModel: input.atomic.model, startedAt: Date.now() });
            const promise = transport.judgeWithPolicy({ args: { state: { original: typeof params.state === "string" ? JSON.parse(params.state) : params.state, evidence_packets: input.atomic.packetSet.packets.map(entry => entry.packet), evidence_manifest: input.atomic.packetSet.manifest, snapshot: input.atomic.snapshot }, questions: params.questions, model: input.atomic.model }, purpose: "evaluation", trustedPolicy: policy, apiKey: options.apiKey, fetchImpl: options.fetchImpl, signal: job.signal, reviewJob: job, validatePrepared: createEvidencePacketSetValidator(input.atomic.packetSet, { apiKey: options.apiKey }) });
            inFlight.current = { index, promise };
            const response = await promise;
            if (!job.signal.aborted) attempts[index] = { ...attempts[index], ...response.metadata, endedAt: Date.now(), ...(!response.ok ? { error: response.code } : {}) };
            if (!job.signal.aborted) inFlight.current = undefined;
            return response.ok ? { answers: response.answers, metadata: response.metadata } : { error: response.code, metadata: response.metadata };
          } };
          const criterionEvidence = Object.fromEntries(input.atomic.criteria.map(criterion => [criterion.id, input.atomic.predicates.filter(p => p.criterionId === criterion.id).flatMap(p => [...p.evidenceRefs])]));
          macroResult = await runPhaseMacroCheck({ ...input.macro, planRequirements: [...new Set([...input.macro.planRequirements, ...input.atomic.packetSet.manifest.parentRequirements.map(parent => parent.source.text)])], criterionEvidence }, client, { approvalPolicy });
          if (!macroResult.error) job.markCovered(packetId);
          return { ok: !macroResult.error };
        }, { signal: shadow.signal });
        if (!result.ok) reasons.push(result.code ?? "repaired_M_unavailable");
      } else reasons.push("unknown_strategy");
    } catch { reasons.push("evaluation_runtime_unavailable"); }
    finally {
      if (inFlight.current) {
        const pending = inFlight.current;
        try {
          const result = await pending.promise;
          attempts[pending.index] = { ...attempts[pending.index], ...result.metadata, endedAt: Date.now(), ...(!result.ok ? { error: result.code } : { error: "cancelled" }) };
        } catch { attempts[pending.index] = { ...attempts[pending.index], endedAt: Date.now(), error: "transport_unavailable" }; }
      }
    }
    const uncoveredCriterionIds = [...new Set([...(atomicReceipt ? atomicReceipt.uncoveredCriterionIds : macroResult?.approved ? [] : input.atomic.criteria.map(c => c.id)), ...input.atomic.packetSet.manifest.uncoveredCriterionIds])];
    const uncoveredParentRequirementIds = [...new Set([...input.atomic.packetSet.manifest.uncoveredParentRequirementIds, ...(atomicReceipt?.uncoveredParentRequirementIds ?? []),
      ...(advisorReceipt?.assessment.parentIntegration.status === "supported" ? [] : parentRequirementIds)])];
    const uncoveredArtifactPaths = [...input.atomic.packetSet.manifest.uncoveredArtifactPaths];
    let disposition: AtomicEvaluationResult["disposition"] = "EVIDENCE_REQUIRED";
    const assessment = advisorReceipt?.assessment;
    const deterministicFailed = runAtomicDeterministicChecks(input.atomic.deterministicChecks).some(check => !check.passed);
    if (advisorReview && !(await isCurrentAdvisorHostReview(advisorReview))) reasons.push("shadow_native_review_became_stale");
    if (shadow.signal?.aborted || reasons.length || !assessment || atomicReceipt?.status === "unavailable" || macroResult?.error || assessment?.verdict === "unavailable") disposition = "UNAVAILABLE";
    else if (assessment.verdict === "human_required") disposition = "HUMAN_ESCALATION";
    else if (deterministicFailed || assessment.verdict === "block" || assessment.parentIntegration.status === "contradicted"
      || assessment.criterionCoverage.some(criterion => criterion.status === "contradicted") || atomicReceipt?.status === "contradicted" || macroResult?.outcome?.status === "REJECTED") disposition = "REJECT";
    else if (assessment.verdict === "proceed" && !uncoveredCriterionIds.length && !uncoveredParentRequirementIds.length && !uncoveredArtifactPaths.length && assessment.criterionCoverage.every(c => c.status === "covered")
      && (!parentRequirementIds.length || assessment.parentIntegration.status === "supported"
        && assessment.parentIntegration.evidenceRefs.length > 0 && assessment.parentIntegration.evidenceRefs.every(ref => input.advisorRequest.integrationEvidenceRefs.includes(ref)))
      && (atomicReceipt?.status === "supported" || macroResult?.approved === true)) disposition = "APPROVE";
    return { disposition, status: disposition === "UNAVAILABLE" ? "prerequisite_pending" : "terminal", reasons, atomicReceipt, macroResult, advisorReceipt, advisorRequest: advisorReview?.request,
      macroApprovalPolicyDigest: canonicalDigest(approvalPolicy), predicateDecisionPolicyDigest: decision.digest,
      attempts, uncoveredCriterionIds, uncoveredParentRequirementIds, uncoveredArtifactPaths, mutationAllowed: false, authorityReusable: false };
  }
  return Object.freeze({ evaluate });
}
