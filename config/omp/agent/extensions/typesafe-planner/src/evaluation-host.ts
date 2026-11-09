import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createPairedReviewDriver } from "./atomic-evaluation";
import { createAdvisorRequest, type AdvisorRequest } from "./advisor-protocol";
import type { AdvisorHostContext, AdvisorHostExecuteContext, AdvisorHostToolResult, AdvisorRequestDraft } from "./advisor-host-types";
import { ownsAdvisorHostSettlement } from "./advisor-host-settlement";
import { observedNativeProof, failedNativeObservation, type OriginalEvaluationObservation } from "./evaluation-host-observation";
import { shadowAdvisorDispatchId, validateShadowAdvisorReview } from "./advisor-shadow";
import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import type { EvaluationHost, EvaluationHostOptions, EvaluationHostParameters } from "./evaluation-host-types";
import { loadOwnedEvaluationCase, loadOwnedEvaluationRun, type OwnedEvaluationCase, type OwnedEvaluationRun } from "./evaluation-host-corpus";
import { createWorkspaceBenchmarkAuthority, checkBoundBenchmarkPolicy, checkBenchmarkApprovalPolicy, actualBenchmarkPolicyIdentity } from "../tools/jev-paired-workspace";
import { readBoundFile, writeJson } from "../tools/jev-paired-files";
import { readJournal } from "../tools/jev-paired-runner";
import { claimUnseenHoldout } from "../tools/jev-paired-exposure";
import { nativeRequestPaths, readOptionalHostJson } from "../tools/jev-paired-host-client";
import { EVALUATION_HOST_PROTOCOL, matchesHost, publicKeyDigest, verifyNativeHostEnvelope, type NativeHostDescriptor, type NativeHostEnvelope, type NativeHostPayload, type NativeProof } from "../tools/jev-paired-host-protocol";
import { projectAttempt, projectEpisode, projectNativeHostEnvelope } from "../tools/jev-paired-inputs";
import { priceAttempt } from "../tools/jev-paired-accounting";
import { resolveAtomicDecisionPolicy, atomicNoulPolicyApplies } from "./atomic-decision-policy";
export type { EvaluationHost, EvaluationHostOptions, EvaluationHostParameters, EvaluationHostFacts } from "./evaluation-host-types";
interface Job {owned:OwnedEvaluationCase;admittedAt:string;clock:number;deadline:number;prepared?:AdvisorHostToolResult;token?:string;original?:Promise<OriginalEvaluationObservation>;nativeProof?:NativeProof}
interface SavedReply {run:string;reply:AdvisorHostToolResult;responsePath:string;envelope:NativeHostEnvelope}
function response(status:string,data:Record<string,unknown> = {}):AdvisorHostToolResult { const details = {status,...data}; return {content:[{type:"text",text:JSON.stringify(details)}],details}; }
function advisorToken(result:AdvisorHostToolResult):string|undefined {
  const d = result.details; if (!d || typeof d !== "object" || !("advisor" in d)) return undefined;
  const a = d.advisor; return a && typeof a === "object" && "token" in a && typeof a.token === "string" ? a.token : undefined;
}
/** Source-owned bridge. Native execution happens ONLY through the separately returned protected native task. */
export function createEvaluationHost(options:EvaluationHostOptions):EvaluationHost {
  if (options.createDriver !== createPairedReviewDriver) throw new Error("actual_loaded_paired_driver_factory_required");
  const sessions = new Map<string,{descriptor:NativeHostDescriptor;key:KeyObject}>(),approvals = new Map<string,string>(),jobs = new Map<string,Job>(),completedReplies = new Map<string,SavedReply>();
  const loadedFactoryIdentity = `createPairedReviewDriver:${createHash("sha256").update(Function.prototype.toString.call(options.createDriver)).digest("hex")}`;
  function current(context:AdvisorHostExecuteContext) {
    if (context.agent.kind !== "main") throw new Error("actual_Root_context_required");
    const actual = options.getRegistration()?.identity(context),facts = options.facts(context);
    if (!actual || !actual.sessionId || !actual.sessionEpoch || !facts.branchId || !facts.requestEntryId) throw new Error("actual_current_native_host_identity_required");
    if (![facts.policyDigest,facts.privacyDigest,facts.candidateSourceManifestDigest].every(value => /^[a-f0-9]{64}$/.test(value))) throw new Error("actual_Root_policy_privacy_candidate_manifest_facts_required");
    const id = `${actual.sessionId}:${actual.sessionEpoch}`,old = sessions.get(id);
    if (old) return old;
    const pair = generateKeyPairSync("ed25519"),publicKey = pair.publicKey.export({format:"pem",type:"spki"}).toString();
    const descriptor:NativeHostDescriptor = freezeContractValue({schemaVersion:1,protocolIdentity:EVALUATION_HOST_PROTOCOL,hostId:randomUUID(),publicKey,publicKeyDigest:publicKeyDigest(publicKey),sessionId:actual.sessionId,branchId:facts.branchId,sessionEpoch:actual.sessionEpoch,loadedFactoryIdentity,candidateSourceManifestDigest:facts.candidateSourceManifestDigest});
    const state = {descriptor,key:pair.privateKey}; sessions.set(id,state); return state;
  }
  function scope(owned:OwnedEvaluationRun,context:AdvisorHostExecuteContext):string {
    const now = current(context),p = owned.manifest.frozen.protocol,facts = options.facts(context);
    if (!p.nativeHost || !matchesHost(now.descriptor,p.nativeHost) || facts.branchId !== p.nativeHost.branchId || facts.candidateSourceManifestDigest !== p.nativeHost.candidateSourceManifestDigest) throw new Error("frozen_loaded_host_or_candidate_manifest_changed");
    return canonicalDigest({run:owned.run,bundleDigest:owned.manifest.frozen.digest,freezeCreatedAt:owned.manifest.createdAt,host:p.nativeHost,spend:p.spend,models:p.models,episodeCount:owned.manifest.schedule.length,predicateDecisionPolicy:p.predicateDecisionPolicy,approvalPolicy:p.approvalPolicy});
  }
  function authorized(owned:OwnedEvaluationRun,context:AdvisorHostExecuteContext):boolean { return approvals.get(owned.run) === scope(owned,context); }
  async function fresh(job:Job,context:AdvisorHostContext):Promise<boolean> {
    const p = job.owned.manifest.frozen.protocol,facts = options.facts(context);
    if (!p.nativeHost || context.sessionManager.getSessionId() !== p.nativeHost.sessionId || context.advisorSessionEpoch !== p.nativeHost.sessionEpoch || facts.branchId !== p.nativeHost.branchId || facts.policyDigest !== job.owned.input.atomic.snapshot.policyDigest || facts.privacyDigest !== job.owned.input.advisorRequest.scope.egressPolicyDigest || facts.candidateSourceManifestDigest !== p.nativeHost.candidateSourceManifestDigest || resolve(job.owned.input.advisorRequest.scope.workspaceRoot) !== resolve(context.cwd)) return false;
    try {
      const actual = await loadOwnedEvaluationCase(context.cwd,job.owned.run,job.owned.request.requestId,job.owned.protocolPath);
      if (actual.manifest.createdAt !== job.owned.manifest.createdAt) return false;
      for (const file of job.owned.input.advisorRequest.scope.files) if ((await readBoundFile(context.cwd,file.path)).sha256 !== file.sha256) return false;
      return approvals.get(job.owned.run) === canonicalDigest({run:job.owned.run,bundleDigest:job.owned.manifest.frozen.digest,freezeCreatedAt:job.owned.manifest.createdAt,host:p.nativeHost,spend:p.spend,models:p.models,episodeCount:job.owned.manifest.schedule.length,predicateDecisionPolicy:p.predicateDecisionPolicy,approvalPolicy:p.approvalPolicy});
    } catch { return false; }
  }
  function forRequest(request:AdvisorRequest|AdvisorRequestDraft):Job|undefined { return [...jobs.values()].find(j => shadowAdvisorDispatchId({runId:j.owned.manifest.runId,caseId:j.owned.case.id,arm:j.owned.request.arm}) === request.binding.provenance.dispatchId); }
  const shadowServices:EvaluationHost["shadowServices"] = {
    prepareReview:() => ({status:"UNAVAILABLE",reasons:["registered_frozen_shadow_prepare_required"]}),
    createTaskRequest:async (_params,context,actualCallId,preparation) => {
      const job = forRequest(preparation.draft);
      if (!job || !await fresh(job,context) || Date.now() >= job.deadline) return {status:"UNAVAILABLE",reasons:["shadow_source_currentness_or_deadline_failed"]};
      const binding = preparation.draft.binding;
      if (binding.purpose !== "shadow") return {status:"UNAVAILABLE",reasons:["shadow_binding_required"]};
      return createAdvisorRequest({...preparation.draft,parentToolCallId:actualCallId,itemIndex:preparation.itemIndex},{sessionId:context.sessionManager.getSessionId(),branchId:options.facts(context).branchId,purpose:"shadow",expectedProvenance:binding.provenance,authorizedScope:binding.authorizedScope,corpus:binding.corpus,validateReference:() => false});
    },
    createConsultationRequest:() => ({status:"UNAVAILABLE",reasons:["shadow_review_requires_actual_native_task"]}),
    onReceipt:(receipt) => { options.appendEntry("jev_paired_shadow_native_observed",{dispatchId:receipt.binding.provenance.dispatchId,receiptId:receipt.receiptId,authority:"none"}); },
    isCurrent:async (request,context) => { const job = forRequest(request); return !!job && await fresh(job,context); },
    deadline:(request) => forRequest(request)?.deadline,
  };
  async function identity(context:AdvisorHostExecuteContext):Promise<AdvisorHostToolResult> {
    const actual = options.driverOptions(context);
    return response("available",{identity:current(context).descriptor,configuration:{approvalPolicy:actual.approvalPolicy ?? null,transportPolicyIdentity:actualBenchmarkPolicyIdentity(actual.trustedPolicy)},notice:"Public current loaded-factory identity; candidateSourceManifestDigest is separate candidate disk evidence, not a claim that disk proves loaded dependencies. Freeze this exact public identity and configuration before outputs; no private signing key is exported."});
  }
  async function authorizeRun(parameters:EvaluationHostParameters,context:AdvisorHostExecuteContext):Promise<AdvisorHostToolResult> {
    if (!parameters.run || !parameters.protocolPath) return response("HUMAN_REQUIRED",{reason:"run_and_exact_protocolPath_required"});
    const owned = await loadOwnedEvaluationRun(context.cwd,parameters.run,parameters.protocolPath),digest = scope(owned,context),p = owned.manifest.frozen.protocol;
    if (Date.parse(owned.manifest.createdAt) > Date.now()) return response("HUMAN_REQUIRED",{reason:"actual_preregistration_time_cannot_be_in_the_future"});
    if (approvals.get(owned.run) === digest) return response("authorized",{run:owned.run,bundleDigest:owned.manifest.frozen.digest});
    const summary = `Authorize REAL PAID SHADOW EVALUATION ONLY? Run ${owned.manifest.runId}; frozen digest ${owned.manifest.frozen.digest}; ${owned.manifest.frozen.cases.length} cases / ${owned.manifest.schedule.length} scheduled M/H review episodes; maximum USD ${p.spend?.maximumUsd}; exact models ${JSON.stringify(p.models)}; M comparator ${JSON.stringify(p.approvalPolicy)}; H operating-point digest ${canonicalDigest(p.predicateDecisionPolicy)}; deadline ${p.limits.deadlineAt}. Confirm permission-cleared sanitized exports, genuine independent blind human labels plus adjudication, exact frozen operating points/prices, and provider/native account enforcement of this budget. This NEVER authorizes native todo completion, plan commits, deployment or label invention.`;
    if (!await options.requestHumanApproval(summary,context)) return response("HUMAN_REQUIRED",{reason:"actual_native_UI_approval_not_granted_no_remote_dispatch"});
    if (scope(owned,context) !== digest) throw new Error("Root_identity_changed_during_human_approval");
    approvals.set(owned.run,digest); options.appendEntry("jev_paired_run_human_authorized",{approvalId:randomUUID(),scopeDigest:digest,run:owned.run,bundleDigest:owned.manifest.frozen.digest,maximumUsd:p.spend?.maximumUsd,authority:"shadow_only"});
    return response("authorized",{run:owned.run,bundleDigest:owned.manifest.frozen.digest});
  }
  async function prepare(parameters:EvaluationHostParameters,context:AdvisorHostExecuteContext):Promise<AdvisorHostToolResult> {
    if (!parameters.run || !parameters.requestId) return response("HUMAN_REQUIRED",{reason:"original_run_and_requestId_required"});
    const owned = await loadOwnedEvaluationCase(context.cwd,parameters.run,parameters.requestId);
    if (!authorized(owned,context)) return response("HUMAN_REQUIRED",{reason:"actual_UI_authorize_exact_frozen_run_first",authorize:{run:owned.run,protocolPath:owned.protocolPath}});
    const paths = nativeRequestPaths(owned.run,`${owned.case.id}:${owned.request.arm}`),published = await readOptionalHostJson(owned.run,relative(owned.run,paths.response),projectNativeHostEnvelope);
    if (published) {verifyNativeHostEnvelope(published,owned.request,owned.manifest); return response("original_signed_result_available",{requestId:owned.request.requestId,responsePath:paths.response});}
    const actualPolicy = checkBoundBenchmarkPolicy(options.driverOptions(context).trustedPolicy,owned.manifest.frozen.protocol.expectedPolicyIdentity);
    if (!actualPolicy.ok) return response("UNAVAILABLE",{reason:actualPolicy.reason});
    const approvalPolicy = checkBenchmarkApprovalPolicy(options.driverOptions(context).approvalPolicy,owned.manifest.frozen.protocol.approvalPolicy);
    if (!approvalPolicy.ok) return response("UNAVAILABLE",{reason:approvalPolicy.reason});
    const operatingPoint = resolveAtomicDecisionPolicy(owned.manifest.frozen.protocol.predicateDecisionPolicy);
    if (!operatingPoint.ok || !Array.isArray(owned.input.atomic.predicates) || owned.input.atomic.predicates.some(predicate => !atomicNoulPolicyApplies(predicate,operatingPoint.policy))) return response("HUMAN_REQUIRED",{reason:"complete_predeclared_raw_noul_operating_point_required_before_any_native_dispatch"});
    const existing = jobs.get(parameters.requestId); if (existing?.prepared) return existing.prepared;
    if ([...jobs.values()].some(j => j.owned.request.requestId !== parameters.requestId && !completedReplies.has(j.owned.request.requestId))) return response("UNAVAILABLE",{reason:"one_shadow_review_active_collect_original_first"});
    const journal = await readJournal(owned.run),p = owned.manifest.frozen.protocol;
    const prices = journal.attempts.map(a => priceAttempt(a,owned.manifest.frozen.prices));
    if (journal.episodes.some(e => !e.accountingComplete) || prices.some(x => x.value === null) || prices.reduce((sum,x) => sum+(x.value ?? 0),0) >= (p.spend?.maximumUsd ?? 0) || owned.manifest.schedule.length > (p.limits.maxEpisodes ?? 0)) return response("UNAVAILABLE",{reason:"frozen_spend_quota_or_original_attempt_accounting_prevents_admission"});
    const remaining = (p.limits.maxRunMs ?? 0)-journal.episodes.reduce((sum,e) => sum+(e.latencyMs ?? 0),0),deadline = Math.min(Date.parse(p.limits.deadlineAt ?? ""),Date.now()+remaining,Date.now()+300000);
    if (!(remaining > 0) || deadline <= Date.now()) return response("UNAVAILABLE",{reason:"frozen_custodian_or_per_review_deadline_exhausted"});
    await claimUnseenHoldout(owned.run,owned.manifest.frozen,owned.manifest.runId);
    const job:Job = {owned,admittedAt:new Date().toISOString(),clock:performance.now(),deadline}; jobs.set(parameters.requestId,job);
    const registration = options.getRegistration(); if (!registration) return response("UNAVAILABLE",{reason:"actual_native_host_required"});
    const prepared = await registration.prepareShadowReview(actual => {
      const template = owned.input.advisorRequest,facts = options.facts(actual),binding = template.binding;
      if (binding.purpose !== "shadow") return {status:"UNAVAILABLE",reasons:["frozen_shadow_template_required"]};
      const liveBinding = {...binding,provenance:{...binding.provenance,sessionId:actual.sessionManager.getSessionId(),branchId:facts.branchId,requestEntryId:facts.requestEntryId,dispatchId:shadowAdvisorDispatchId({runId:owned.manifest.runId,caseId:owned.case.id,arm:owned.request.arm})}};
      const {schemaVersion,requestId,requestDigest,bindingDigest,promptDigest,parentToolCallId,itemIndex,...semantic} = template;
      return {...semantic,binding:liveBinding,sessionEpoch:actual.advisorSessionEpoch,parentAgentId:actual.agent.id};
    },context);
    job.prepared = prepared; job.token = advisorToken(prepared); if (!job.token) {jobs.delete(parameters.requestId); return prepared;}
    return prepared;
  }
  async function publishOriginal(job:Job,original:OriginalEvaluationObservation,native:NativeProof):Promise<AdvisorHostToolResult> {
    const pinned = job.owned.manifest.frozen.protocol.nativeHost,state = pinned ? sessions.get(`${pinned.sessionId}:${pinned.sessionEpoch}`) : undefined;
    if (!pinned || !state || !matchesHost(state.descriptor,pinned)) throw new Error("original_session_signing_key_unavailable_never_replace_frozen_trust");
    const execution = {runId:job.owned.manifest.runId,caseId:job.owned.case.id,arm:job.owned.request.arm},paths = nativeRequestPaths(job.owned.run,`${execution.caseId}:${execution.arm}`);
    const payload:NativeHostPayload = {schemaVersion:1,kind:"shadow_evaluation",host:state.descriptor,requestDigest:canonicalDigest(job.owned.request),requestId:job.owned.request.requestId,runId:execution.runId,bundleDigest:job.owned.manifest.frozen.digest,freezeCreatedAt:job.owned.manifest.createdAt,caseId:execution.caseId,arm:execution.arm,...original,native,mutationAllowed:false,authorityReusable:false};
    const bytes = Buffer.from(JSON.stringify(options.projectPublic(payload))),envelope:NativeHostEnvelope = {schemaVersion:1,payloadBase64:bytes.toString("base64"),signatureBase64:sign(null,bytes,state.key).toString("base64")};
    verifyNativeHostEnvelope(envelope,job.owned.request,job.owned.manifest);
    const reply = response("signed_shadow_result_available",{requestId:job.owned.request.requestId,responsePath:paths.response,envelope,notice:"Actual signed shadow observation only; native SDK aggregate costs remain distinct from provider billing/per-attempt completeness. Never completion/deployment authority. Resume the original CLI."});
    completedReplies.set(job.owned.request.requestId,{run:job.owned.run,reply,responsePath:paths.response,envelope});
    await writeJson(paths.response,envelope);
    options.appendEntry("jev_paired_signed_shadow_result",{...execution,requestId:job.owned.request.requestId,bodyDigest:canonicalDigest(envelope),authority:"none"});
    jobs.delete(job.owned.request.requestId); return reply;
  }
  async function collect(parameters:EvaluationHostParameters,context:AdvisorHostExecuteContext,signal?:AbortSignal):Promise<AdvisorHostToolResult> {
    if (context.agent.kind !== "main") return response("UNAVAILABLE",{reason:"actual_Root_context_required"});
    const prior = parameters.requestId ? completedReplies.get(parameters.requestId) : undefined;
    if (prior && parameters.run === prior.run) {
      const existing = await readOptionalHostJson(prior.run,relative(prior.run,prior.responsePath),projectNativeHostEnvelope);
      if (!existing) await writeJson(prior.responsePath,prior.envelope);
      else if (canonicalDigest(existing) !== canonicalDigest(prior.envelope)) throw new Error("original_signed_result_cannot_be_replaced");
      return prior.reply;
    }
    const job = parameters.requestId ? jobs.get(parameters.requestId) : undefined;
    if (!job || parameters.run !== job.owned.run || !job.token) return response("UNAVAILABLE",{reason:"original_prepared_current_session_request_required_no_redispatch"});
    const paths = nativeRequestPaths(job.owned.run,`${job.owned.case.id}:${job.owned.request.arm}`),lock = await open(`${paths.response}.lock`,"wx");
    try {
      if (job.original && job.nativeProof) return await publishOriginal(job,await job.original,job.nativeProof);
      const registration = options.getRegistration(),execution = {runId:job.owned.manifest.runId,caseId:job.owned.case.id,arm:job.owned.request.arm};
      if (!registration) return response("UNAVAILABLE",{reason:"actual_native_host_required"});
      const settlement = await registration.settlement(job.token,context);
      if (!ownsAdvisorHostSettlement(settlement) || settlement.token !== job.token || settlement.request.binding.purpose !== "shadow" || settlement.request.binding.provenance.dispatchId !== shadowAdvisorDispatchId(execution)) return response("UNAVAILABLE",{reason:"actual_settled_native_task_history_required_collect_after_native_publication"});
      job.nativeProof = observedNativeProof(settlement);
      if (settlement.status === "failed") {
        job.original = Promise.resolve(failedNativeObservation(job.owned,settlement,job.admittedAt,new Date().toISOString(),performance.now()-job.clock));
        return await publishOriginal(job,await job.original,job.nativeProof);
      }
      if (!authorized(job.owned,context)) return response("HUMAN_REQUIRED",{reason:"original_frozen_run_authorization_not_current"});
      const checked = await validateShadowAdvisorReview(job.owned.input.advisorRequest,settlement.review,execution);
      if (!checked.valid) return response("UNAVAILABLE",{reason:checked.reason});
      const actualReview = checked.review,controller = new AbortController(),abort = () => controller.abort();
      signal?.addEventListener("abort",abort,{once:true}); if (signal?.aborted || Date.now() >= job.deadline) controller.abort();
      const timer = setTimeout(() => controller.abort(),Math.max(1,job.deadline-Date.now()));
      try {
        const driverOptions = options.driverOptions(context),authority = createWorkspaceBenchmarkAuthority({...driverOptions,predicateDecisionPolicy:job.owned.manifest.frozen.protocol.predicateDecisionPolicy ?? undefined,authorize:async () => ({allowed:authorized(job.owned,context),reason:"actual_native_UI_exact_frozen_scope"}),dispatchAdvisor:async () => actualReview});
        const approval = await authority.authorize(job.owned.manifest.frozen); if (!approval.allowed) return response("HUMAN_REQUIRED",{reason:approval.reason});
        job.original = authority.driver.evaluate(job.owned.request.arm,job.owned.input,{mode:"shadow",allowMutation:false,allowAuthorityReuse:false,signal:controller.signal,runId:execution.runId,caseId:execution.caseId,parentId:job.owned.case.parentId}).then(result => {
          const terminal = new Date().toISOString(),elapsed = performance.now()-job.clock;
          return {episode:projectEpisode({...result.episode,id:`${execution.caseId}:${execution.arm}`,caseId:execution.caseId,arm:execution.arm,admittedAt:job.admittedAt,terminalAt:terminal,latencyMs:elapsed,timingSegments:[{start:job.admittedAt,end:terminal,elapsedMs:elapsed}],completionEvent:null}),attempts:result.attempts.map(projectAttempt)};
        });
        return await publishOriginal(job,await job.original,job.nativeProof);
      } finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);}
    } finally {await lock.close();await unlink(`${paths.response}.lock`);}
  }
  return Object.freeze({identity,authorizeRun,prepare,collect,shadowServices});
}
