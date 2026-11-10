import { createRequire } from "node:module";
import type { ResolvedToolPolicy } from "../src/payload-safety";
import { createPairedReviewDriver, type AtomicEvaluationResult, type NativeAdvisorUnavailable } from "../src/atomic-evaluation";
import type { AdvisorRequest } from "../src/advisor-protocol";
import { isSemanticApprovalPolicy, type SemanticApprovalPolicy } from "../src/semantic-approval-policy";
import { canonicalDigest } from "../src/task-contract-source";
import type { NativeAdvisorReview } from "../src/advisor-shadow";
import type { AtomicPredicateDecisionPolicy } from "../src/atomic-decision-policy";
import type { Attempt, EvaluationDriver, FrozenBundle, ProviderMetadata } from "./jev-paired-types";
import type { BenchmarkAuthority } from "./jev-paired-runner";
import { digest, isFloatingModelAlias } from "./jev-paired-validation";
import { projectAttempt } from "./jev-paired-inputs";
const policyClient = createRequire(import.meta.url)("../src/typesafe-policy-client.cjs") as {resolveTrustedToolPolicy(purpose:string,policy?:unknown):ResolvedToolPolicy};
export interface BenchmarkPolicyAdmission { ok:boolean; reason:string|null }
export function checkBoundBenchmarkPolicy(trustedPolicy:unknown,expectedIdentity:string|null|undefined):BenchmarkPolicyAdmission {
  const actual = policyClient.resolveTrustedToolPolicy("evaluation",trustedPolicy);
  return actual.ok && !!expectedIdentity && actual.policyIdentity === expectedIdentity ? {ok:true,reason:null} : {ok:false,reason:"actual_Root_bound_policy_does_not_match_frozen_identity"};
}
export function actualBenchmarkPolicyIdentity(trustedPolicy:unknown):string|null { const actual = policyClient.resolveTrustedToolPolicy("evaluation",trustedPolicy); return actual.ok ? actual.policyIdentity : null; }
export function checkBenchmarkApprovalPolicy(actual:SemanticApprovalPolicy|undefined,frozen:SemanticApprovalPolicy|null):BenchmarkPolicyAdmission {
  return isSemanticApprovalPolicy(actual) && !!frozen && canonicalDigest(actual) === canonicalDigest(frozen) ? {ok:true,reason:null} : {ok:false,reason:"actual_Root_M_approval_policy_does_not_match_frozen_control"};
}
export interface NativeAccounting {
  attempts: Attempt[]; complete: boolean; reason: string | null;
  unnecessaryReviewerActions: number | null;
}
export interface ArmExecutionIdentity { runId:string; caseId:string; arm:"M"|"H" }
export interface WorkspaceBenchmarkOptions {
  trustedPolicy?: unknown; apiKey?: string; fetchImpl?: typeof fetch; predicateDecisionPolicy?:AtomicPredicateDecisionPolicy; approvalPolicy?:SemanticApprovalPolicy;
  /** Trusted host authenticates export, blind human/adjudicator provenance and invariants, and enforces exact paid budget/quota limits through its provider/native accounts; corpus JSON cannot grant authority. */
  authorize(bundle: FrozenBundle): Promise<{ allowed:boolean; reason:string }>;
  dispatchAdvisor?: (request:AdvisorRequest,signal:AbortSignal|undefined,execution:ArmExecutionIdentity) => Promise<NativeAdvisorReview|NativeAdvisorUnavailable>;
  collectNativeAccounting?: (result: AtomicEvaluationResult, context: ArmExecutionIdentity) => Promise<NativeAccounting>;
}
function record(raw: unknown): raw is Record<string,unknown> { return !!raw && typeof raw === "object" && !Array.isArray(raw); }
function providerMetadata(raw: unknown): Record<string,ProviderMetadata> | undefined {
  const valid = (v: unknown, depth:number): boolean => {
    if (depth > 32) return false;
    if (v === null || typeof v === "string" || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.every(x => valid(x,depth+1));
    if (record(v)) return Object.values(v).every(x => valid(x,depth+1));
    return false;
  };
  return record(raw) && valid(raw,0) ? raw as Record<string,ProviderMetadata> : undefined;
}
function usageOf(raw: unknown): Attempt["usage"] {
  if (!record(raw)) return null;
  const details = record(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const input = raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens;
  const output = raw.outputTokens ?? raw.output_tokens ?? raw.completion_tokens;
  const cached = raw.cachedInputTokens ?? raw.cached_input_tokens ?? details.cached_tokens;
  if (typeof input !== "number" || typeof output !== "number" || typeof cached !== "number" || ![input,output,cached].every(x => Number.isSafeInteger(x) && x >= 0) || cached > input) return null;
  return { inputTokens:input,outputTokens:output,cachedInputTokens:cached };
}
/** A real host injects only native dispatch and trusted consent/accounting; neither arm is injectable or cached. */
export function createWorkspaceBenchmarkAuthority(options: WorkspaceBenchmarkOptions): BenchmarkAuthority {
  let activeInvocation = "", boundRun: string | undefined, inflight = 0;
  let activeExecution: ArmExecutionIdentity | undefined;
  let captureQuestionIdentity = false;
  const preparedQuestionIdentities = new Map<string,Record<string,string>>();
  const fetchImpl: typeof fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(url) !== "https://api.typesafe.ai/v1/systemone" || typeof init?.body !== "string") throw new Error("unexpected_evaluation_transport");
    if (!activeInvocation || inflight) throw new Error("single_active_semantic_dispatch_required");
    if (captureQuestionIdentity) {
      const bodyDigest = digest(init.body);
      if (!preparedQuestionIdentities.has(bodyDigest)) {
        const body:unknown = JSON.parse(init.body);
        if (!record(body) || !record(body.questions)) throw new Error("prepared_question_identity_unavailable");
        preparedQuestionIdentities.set(bodyDigest,Object.fromEntries(Object.entries(body.questions).map(([id,question]) => [id,digest(JSON.stringify({state:body.state,question}))])));
      }
    }
    inflight++;
    try { return await (options.fetchImpl ?? globalThis.fetch)(url,init); } finally { inflight--; }
  },{ preconnect:(options.fetchImpl ?? globalThis.fetch).preconnect });
  const dispatchAdvisor = options.dispatchAdvisor ? (request:AdvisorRequest,signal?:AbortSignal) => activeExecution ? options.dispatchAdvisor!(request,signal,activeExecution) : Promise.resolve<NativeAdvisorUnavailable>({status:"UNAVAILABLE",reasons:["active_native_execution_identity_required"]}) : undefined;
  let real = createPairedReviewDriver({...options,fetchImpl,dispatchAdvisor});
  const driver: EvaluationDriver = { async evaluate(arm,input,context) {
    if (activeInvocation || (boundRun && boundRun !== context.runId)) throw new Error("evaluation_single_active_run_required");
    boundRun = context.runId;
    activeInvocation = `${context.runId}:${context.caseId}:${arm}`;
    activeExecution = { runId:context.runId,caseId:context.caseId,arm };
    const started = Date.now();
    let result: AtomicEvaluationResult;
    try { result = await real.evaluate(arm,input,context); } finally { activeInvocation = ""; activeExecution = undefined; }
    if (result.mutationAllowed !== false || result.authorityReusable !== false) throw new Error("workspace_driver_shadow_violation");
    const inputRecord = record(input) ? input : {}, atomic = record(inputRecord.atomic) ? inputRecord.atomic : {};
    const parentId = context.parentId;
    const attempts: Attempt[] = [];
    let transportComplete = true;
    for (const packet of result.attempts) {
      const raw: unknown = packet;
      const metadata = record(raw) ? raw : {};
      const receipts = Array.isArray(metadata.attemptReceipts) ? metadata.attemptReceipts.filter(record) : [];
      if (!receipts.length && metadata.attempts !== 0) transportComplete = false;
      for (const [index,r] of receipts.entries()) {
        const usage = usageOf(r.usage), resolvedModel = typeof r.resolvedModel === "string" && !isFloatingModelAlias(r.resolvedModel) ? r.resolvedModel : null;
        const provider = typeof r.provider === "string" ? r.provider : null;
        const rawUsage = providerMetadata(r.usage);
        const questionIds = Array.isArray(r.questionIds) && r.questionIds.every((id:unknown) => typeof id === "string") ? r.questionIds as string[] : [];
        const questionCount = typeof r.questionCount === "number" ? r.questionCount : null;
        const unknownReason = typeof r.resolvedModel === "string" && isFloatingModelAlias(r.resolvedModel) ? `provider_returned_alias_not_resolved_identity:${r.resolvedModel}`
          : typeof r.unknownReason === "string" ? r.unknownReason : !usage || !resolvedModel || !provider
            ? [r.modelUnavailableReason,r.usageUnavailableReason].filter(x => typeof x === "string").join(";") || "provider_usage_cache_or_resolved_identity_unavailable" : null;
        const billing = typeof r.billedUsd === "number" ? r.billedUsd : null;
        const providerBilling = typeof r.billing === "number" ? r.billing : providerMetadata(r.billing) ?? null;
        const receiptId = typeof r.receiptId === "string" ? r.receiptId : `${context.runId}:${context.caseId}:${arm}:${packet.packetId}:${index}`;
        if (typeof r.receiptId !== "string" || !r.receiptId) transportComplete = false;
        attempts.push({ receiptId,runId:context.runId,caseId:context.caseId,arm,parentId,role:"jev",requestedModel:packet.requestedModel,resolvedModel,provider,usage,unknownReason,billedUsd:billing,billingReason:billing === null ? typeof r.billingUnavailableReason === "string" ? r.billingUnavailableReason : providerBilling === null ? "actual_provider_bill_not_returned" : "returned_billing_currency_or_total_semantics_unconfirmed" : null,providerBilling,
          bodyDigest:typeof r.bodyDigest === "string" ? r.bodyDigest : packet.bodyDigest ?? null,bodyBytes:typeof r.bodyBytes === "number" ? r.bodyBytes : packet.bodyBytes ?? null,
          questionStateDigests:preparedQuestionIdentities.get(typeof r.bodyDigest === "string" ? r.bodyDigest : packet.bodyDigest ?? ""),
          questionIds:[...questionIds],questionCount,policyIdentity:typeof r.policyIdentity === "string" ? r.policyIdentity : packet.policyIdentity ?? null,startedAt:new Date(packet.startedAt ?? started).toISOString(),endedAt:new Date(packet.endedAt ?? Date.now()).toISOString(),retry:typeof r.attempt === "number" ? Math.max(0,r.attempt-1) : index,cooldownMs:typeof r.cooldownMs === "number" ? r.cooldownMs : null,error:typeof r.error === "string" ? r.error : packet.error ?? null,providerUsage:rawUsage,metadataComplete:!!provider && !!usage && !!resolvedModel && questionCount !== null,
          wallTimingScope:"packet_envelope",httpStatus:typeof r.status === "number" ? r.status : null,transportKind:typeof r.kind === "string" ? r.kind : null,cooldown:{observed:typeof metadata.cooldown === "boolean" ? metadata.cooldown : null,until:typeof metadata.cooldownUntil === "number" ? metadata.cooldownUntil : null},
          monotonicTiming:typeof r.startedAtMs === "number" && typeof r.endedAtMs === "number" ? { startedAtMs:r.startedAtMs,endedAtMs:r.endedAtMs } : null });
      }
    }
    let native:NativeAccounting = { attempts:[],complete:false,reason:"all_paid_Advisor_and_distinct_parent_attempt_accounting_required",unnecessaryReviewerActions:null };
    if (options.collectNativeAccounting) {
      try { const observed = await options.collectNativeAccounting(result,{runId:context.runId,caseId:context.caseId,arm}); native = {...observed,attempts:observed.attempts.map(projectAttempt)}; }
      catch { native.reason = "native_accounting_receipts_unavailable_preserved_JEV_attempts_require_original_receipt_recovery"; }
    }
    attempts.push(...native.attempts);
    const required = Array.isArray(atomic.criteria) ? atomic.criteria.length : 0;
    const packetSet = record(atomic.packetSet) ? atomic.packetSet : {},manifest = record(packetSet.manifest) ? packetSet.manifest : {};
    const parents = Array.isArray(manifest.parentRequirements) ? manifest.parentRequirements.filter(record) : [];
    const assessed = !!result.atomicReceipt || !!result.macroResult;
    const childUncovered = assessed ? result.uncoveredCriterionIds : Array.isArray(atomic.criteria) ? atomic.criteria.filter(record).map(c => String(c.id)) : [];
    const parentUncovered = assessed ? result.uncoveredParentRequirementIds : parents.map(p => `parent:${String(p.parentContractId)}:${String(p.criterionId)}`);
    const accountingComplete = transportComplete && native.complete;
    const parentCriterionIds = Array.isArray(atomic.criteria) ? atomic.criteria.filter(record).filter(c => c.kind === "parent_integration").map(c => String(c.id)) : [];
    const integrationDetected = result.advisorReceipt?.assessment.parentIntegration.status === "contradicted" || (result.atomicReceipt?.contradictedParentRequirementIds.length ?? 0) > 0 || result.atomicReceipt?.contradictedCriterionIds.some(id => parentCriterionIds.includes(id));
    return { episode:{ receiptId:result.atomicReceipt?.receiptId ?? result.advisorReceipt?.receiptId ?? `terminal:${digest(JSON.stringify({runId:context.runId,caseId:context.caseId,arm,result}))}`,
      disposition:result.disposition,status:"terminal",reason:result.reasons.join(";") || null,attemptIds:attempts.map(a => a.receiptId),integrationMiss:null,unnecessaryReviewerActions:native.unnecessaryReviewerActions,
      integrationAssessment:result.disposition === "UNAVAILABLE" ? "unavailable" : integrationDetected ? "defect_detected" : result.advisorReceipt?.assessment.parentIntegration.status === "supported" ? "no_defect" : "insufficient",
      accountingComplete,accountingReason:accountingComplete ? null : !transportComplete ? "per_dispatch_transport_receipts_missing" : native.reason,
      predicateDecisionPolicyDigest:result.atomicReceipt?.decisionPolicyDigest ?? null,
      macroApprovalPolicyDigest:result.macroApprovalPolicyDigest ?? null,
      coverage:required ? {required,covered:Math.max(0,required-childUncovered.length),uncoveredCriterionIds:[...childUncovered],parentRequired:parents.length,parentCovered:Math.max(0,parents.length-parentUncovered.length),uncoveredParentRequirementIds:[...parentUncovered],uncoveredArtifactPaths:[...result.uncoveredArtifactPaths]} : null,
      advisorReceiptId:result.advisorReceipt?.receiptId ?? null },attempts };
  } };
  const authority:BenchmarkAuthority = Object.freeze({
    authorize:async (bundle:FrozenBundle) => {
      if (!options.dispatchAdvisor) return {allowed:false,reason:"native_host_required"};
      captureQuestionIdentity = bundle.protocol.ablations.some(a => a.kind === "batching");
      try {
        const approval = await options.authorize(bundle);
        if (approval.allowed) {
          if (bundle.protocol.kind === "model_benchmark") { const policy = checkBoundBenchmarkPolicy(options.trustedPolicy,bundle.protocol.expectedPolicyIdentity); if (!policy.ok) return {allowed:false,reason:policy.reason ?? "policy_invalid"}; }
          if (bundle.protocol.kind === "model_benchmark") { const approval = checkBenchmarkApprovalPolicy(options.approvalPolicy,bundle.protocol.approvalPolicy); if (!approval.ok) return {allowed:false,reason:approval.reason ?? "approval_policy_invalid"}; }
          if (!bundle.protocol.predicateDecisionPolicy) return {allowed:false,reason:"frozen_predicate_operating_point_required"};
          real = createPairedReviewDriver({...options,fetchImpl,dispatchAdvisor,predicateDecisionPolicy:bundle.protocol.predicateDecisionPolicy});
        }
        return approval;
      }
      catch { return {allowed:false,reason:"trusted_host_authorization_unavailable_no_paid_dispatch"}; }
    },
    driver:Object.freeze(driver),
  });
  return authority;
}
