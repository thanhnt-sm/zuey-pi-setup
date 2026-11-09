import { parseAdvisorStructuredResponse } from "./proactive-advisor";
import { randomUUID } from "node:crypto";
import { advisorOutputSchema, record, validateAdvisorRequestIdentity, type AdvisorRequest } from "./advisor-protocol";
import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import { ADVISOR_HOST_ENTRY, advisorAgent, advisorDispatchFrame, draftApplicability, getHostScope, noteNativeObservation, wrappedByAdvisor, type HostScope, type ProvisionalReview } from "./advisor-host-state";
import type { AdvisorHostAPI, AdvisorHostExecuteContext, AdvisorHostServices, AdvisorHostOutcome, AdvisorHostToolResult, AdvisorHostReview, AdvisorRequestDraft, AdvisorShadowDraftFactory } from "./advisor-host-types";
import { hasSettledAdvisorHistory } from "./advisor-host-history";
import { advisorNativeParameters, advisorNativeTaskCapabilities, validAdvisorNativeControls } from "./advisor-native-schema";
import type { NativeMutationDelegationRuntime } from "./advisor-mutation-delegation";

export function advisorHostResult(value: unknown, isError = false): AdvisorHostToolResult {
  return { isError, content: [{ type: "text", text: JSON.stringify(value) }], details: { advisor: value } };
}
export function hostUnavailable(reason: string): AdvisorHostToolResult {
  return advisorHostResult({ status: "UNAVAILABLE", reasons: [reason] }, true);
}
export function hostReadiness(api: AdvisorHostAPI): AdvisorHostOutcome | undefined {
  if (typeof api.on !== "function" || typeof api.appendEntry !== "function" || typeof api.sendMessage !== "function" || typeof api.getAllTools !== "function"
    || typeof api.getActiveTools !== "function" || typeof api.setActiveTools !== "function" || !api.events) return { status: "UNAVAILABLE", reasons: ["advisor_supported_host_actions_required"] };
  try {
    if (!wrappedByAdvisor(api, ["task", "read", "grep", "glob"])) return { status: "UNAVAILABLE", reasons: ["advisor_native_task_and_guarded_read_wrappers_required"] };
  } catch { return { status: "UNAVAILABLE", reasons: ["advisor_runtime_tool_metadata_not_initialized"] }; }
  return undefined;
}
function persistedReview(scope: HostScope, provisional: ProvisionalReview): AdvisorHostReview | undefined {
  for (const request of scope.requests.values()) {
    if (request.publicPrompt !== provisional.draft.publicPrompt) continue;
    const receipt = scope.runtime.currentReceipt(request.requestId);
    if (receipt && hasSettledAdvisorHistory(scope, request, receipt)) return { request, receipt };
  }
  return undefined;
}
export async function prepareHostReview(api: AdvisorHostAPI, services: AdvisorHostServices, params: Record<string, unknown>, raw: AdvisorHostExecuteContext, mode: "task" | "consultation"): Promise<AdvisorHostToolResult> {
  if (raw.agent?.kind === "sub" && advisorAgent(raw.agent.name)) return hostUnavailable("advisor_recursive_consultation_denied");
  const readiness = hostReadiness(api); if (readiness) return advisorHostResult(readiness, true);
  const scope = getHostScope(api, services, raw);
  const proposed = await services.prepareReview(params, scope.context, mode);
  if ("status" in proposed) return advisorHostResult(proposed, proposed.status === "UNAVAILABLE");
  if (proposed.binding.purpose !== (mode === "consultation" ? "consultation" : params.purpose ?? "task_review")) return hostUnavailable("advisor_public_review_purpose_mismatch");
  return prepareHostDraft(api, services, proposed, scope, mode);
}
export async function prepareHostShadowReview(api: AdvisorHostAPI, services: AdvisorHostServices, prepare: AdvisorShadowDraftFactory, raw: AdvisorHostExecuteContext): Promise<AdvisorHostToolResult> {
  if (raw.agent.kind !== "main" || typeof prepare !== "function") return hostUnavailable("advisor_trusted_main_shadow_factory_required");
  const readiness = hostReadiness(api); if (readiness) return advisorHostResult(readiness, true);
  const scope = getHostScope(api, services, raw);
  const proposed = await prepare(scope.context);
  if ("status" in proposed) return advisorHostResult(proposed, proposed.status === "UNAVAILABLE");
  if (proposed.binding.purpose !== "shadow" || proposed.binding.authorizedScope.operations.some(operation => operation !== "read")) return hostUnavailable("advisor_authenticated_readonly_shadow_binding_required");
  return prepareHostDraft(api, services, proposed, scope, "task");
}
async function prepareHostDraft(api: AdvisorHostAPI, services: AdvisorHostServices, proposed: AdvisorRequestDraft, scope: HostScope, mode: "task" | "consultation"): Promise<AdvisorHostToolResult> {
  if (!scope.active || proposed.binding.provenance.sessionId !== scope.sessionId || proposed.sessionEpoch !== scope.epoch || proposed.parentAgentId !== scope.context.agent.id
    || !(await services.isCurrent(proposed, scope.context))) return hostUnavailable("advisor_provisional_scope_or_snapshot_not_current");
  const key = draftApplicability(proposed);
  const logicalShadow = proposed.binding.purpose === "shadow" ? [...scope.provisionals.values()].find(value => value.draft.binding.purpose === "shadow" && value.draft.binding.provenance.dispatchId === proposed.binding.provenance.dispatchId) : undefined;
  if (logicalShadow && logicalShadow.key !== key) return advisorHostResult({ status: "UNAVAILABLE", token: logicalShadow.token, requestId: logicalShadow.finalRequestId, reasons: ["advisor_shadow_execution_already_bound_collect_existing_settlement"], authority: "none" }, true);
  let provisional = [...scope.provisionals.values()].find(value => value.key === key);
  if (provisional) {
    const prior = persistedReview(scope, provisional);
    if (prior && await services.isCurrent(prior.request, scope.context)) return advisorHostResult({ status: "ready", receiptId: prior.receipt.receiptId, requestId: prior.request.requestId, authority: prior.receipt.authority, assessment: prior.receipt.assessment, cachedSourceReceipt: true });
    if ([...scope.inflight.values()].some(request => request.publicPrompt === provisional.draft.publicPrompt)) return advisorHostResult({
      status: "REVIEW_REQUIRED", token: provisional.token, reasons: ["advisor_actual_native_task_still_inflight"], authority: "none" });
    if (provisional.draft.binding.purpose === "shadow" && provisional.finalRequestId) return advisorHostResult({ status: "UNAVAILABLE", token: provisional.token, requestId: provisional.finalRequestId, reasons: ["advisor_shadow_dispatch_consumed_collect_existing_settlement"], authority: "none" }, true);
  } else {
    const capabilities = advisorNativeTaskCapabilities(api);
    if (!capabilities) return hostUnavailable("advisor_native_structured_task_schema_required");
    const token = randomUUID();
    const publicPrompt = JSON.stringify({ reviewHandle: token, publicReview: proposed.publicPrompt });
    const draft = freezeContractValue(structuredClone({ ...proposed, publicPrompt, scope: { ...proposed.scope, publicContextDigest: canonicalDigest([{ role: "user", content: publicPrompt }]) } }));
    provisional = { token, key, mode, nativeShape: capabilities.shape, nativeDisableIsolation: capabilities.disableIsolation, draft };
    scope.provisionals.set(token, provisional);
    api.appendEntry(ADVISOR_HOST_ENTRY, { kind: "provisional", sessionId: scope.sessionId, agentId: scope.context.agent.id, epoch: scope.epoch, review: provisional });
  }
  return advisorHostResult({ status: "REVIEW_REQUIRED", token: provisional.token, authority: "none", instructions: "The parent must execute this actual native task call. blocking:true is already in the project Advisor definition, never a wire argument. This pending request is not an assessment.",
    nativeTool: "task", parameters: advisorNativeParameters(provisional.draft, provisional.nativeShape, provisional.nativeDisableIsolation) });
}
export async function executeHostTask(api: AdvisorHostAPI, services: AdvisorHostServices, toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: ((update: unknown) => void) | undefined, raw: AdvisorHostExecuteContext, mutation?: NativeMutationDelegationRuntime): Promise<unknown> {
  if (!raw.invokeTool) return hostUnavailable("advisor_same_native_task_invokeTool_required");
  const items = Array.isArray(params.tasks) ? params.tasks : [params];
  const reviews = items.flatMap((item, index) => record(item) && advisorAgent(String(item.agent)) ? [{ item, index }] : []);
  if (!reviews.length) {
    if (!mutation) return raw.invokeTool(params, { signal, onUpdate });
    return mutation.run(getHostScope(api, services, raw), toolCallId, raw, async () => {
      if (!raw.invokeTool) return hostUnavailable("advisor_same_native_task_invokeTool_required");
      return raw.invokeTool(params, { signal, onUpdate });
    });
  }
  params = freezeContractValue(structuredClone(params));
  const readiness = hostReadiness(api); if (readiness) return advisorHostResult(readiness, true);
  if (reviews.length !== 1) return hostUnavailable("advisor_one_bound_review_item_per_native_call_required");
  const scope = getHostScope(api, services, raw);
  const observedItems = Array.isArray(params.tasks) ? params.tasks : [params]; const review = { item: observedItems[reviews[0].index], index: reviews[0].index };
  const capabilities = advisorNativeTaskCapabilities(api);
  if (!capabilities || !record(review.item) || !validAdvisorNativeControls(params, review.item, capabilities.shape, capabilities.disableIsolation)) return hostUnavailable("advisor_native_public_context_and_readonly_item_controls_required");
  const item = review.item;
  const matches = [...scope.provisionals.values()].filter(value => value.draft.publicPrompt === item.task && value.draft.agent === item.agent);
  if (matches.length !== 1) return hostUnavailable("advisor_scoped_provisional_request_required");
  const provisional = matches[0];
  if (provisional.nativeShape !== capabilities.shape || (provisional.nativeDisableIsolation === true) !== capabilities.disableIsolation) return hostUnavailable("advisor_native_task_shape_changed_prepare_fresh_review");
  if (provisional.draft.binding.purpose === "shadow" && provisional.finalRequestId) return hostUnavailable("advisor_shadow_dispatch_token_consumed_collect_existing_settlement");
  if (!(await services.isCurrent(provisional.draft, scope.context))) return advisorHostResult({ status: "EVIDENCE_REQUIRED", reasons: ["advisor_provisional_evidence_changed_prepare_fresh_review"] });
  const prepared = { token: provisional.token, mode: provisional.mode, draft: provisional.draft, itemIndex: review.index };
  const final = await (provisional.mode === "consultation" ? services.createConsultationRequest(params, scope.context, toolCallId, prepared) : services.createTaskRequest(params, scope.context, toolCallId, prepared));
  if ("status" in final) return advisorHostResult(final, final.status === "UNAVAILABLE");
  const parentIds = provisional.draft.parentRequirementIds ?? (provisional.draft.binding.purpose === "parent_review" ? provisional.draft.binding.parentObligationIds : []);
  if (!validateAdvisorRequestIdentity(final) || final.parentToolCallId !== toolCallId || final.itemIndex !== review.index || final.sessionEpoch !== scope.epoch
    || final.binding.provenance.sessionId !== scope.sessionId || final.parentAgentId !== raw.agent.id || final.agent !== provisional.draft.agent || final.publicPrompt !== provisional.draft.publicPrompt
    || canonicalDigest(final.snapshot) !== canonicalDigest(provisional.draft.snapshot) || canonicalDigest(final.binding) !== canonicalDigest(provisional.draft.binding)
    || canonicalDigest(final.scope) !== canonicalDigest(provisional.draft.scope) || canonicalDigest(final.criterionIds) !== canonicalDigest(provisional.draft.criterionIds)
    || canonicalDigest(final.parentRequirementIds) !== canonicalDigest(parentIds) || canonicalDigest(final.evidenceRefs) !== canonicalDigest(provisional.draft.evidenceRefs)
    || canonicalDigest(final.integrationEvidenceRefs) !== canonicalDigest(provisional.draft.integrationEvidenceRefs) || !(await services.isCurrent(final, scope.context))) return hostUnavailable("advisor_final_actual_dispatch_binding_mismatch");
  const preparation = scope.runtime.prepare(final);
  if (preparation.status === "UNAVAILABLE") return advisorHostResult(preparation, true);
  if (preparation.status === "ready") return hasSettledAdvisorHistory(scope, preparation.request, preparation.receipt)
    ? advisorHostResult({ status: "ready", cachedSourceReceipt: true, receiptId: preparation.receipt.receiptId, requestId: preparation.request.requestId, authority: preparation.receipt.authority, assessment: preparation.receipt.assessment })
    : hostUnavailable("advisor_actual_settled_native_task_history_required");
  scope.requests.set(final.requestId, final); scope.inflight.set(toolCallId, final); provisional.finalRequestId = final.requestId;
  noteNativeObservation(scope, final.requestId, { nativeInvocationObserved: false, reasonCodes: [] });
  try {
    const deadline = services.deadline?.(final, scope.context);
    const bounded = await scope.reviewBudget.run(final, deadline, signal, async boundedSignal => {
      if (!scope.active || scope.epoch !== final.sessionEpoch || boundedSignal.aborted || hostReadiness(api)
        || !(await services.isCurrent(final, scope.context))) {
        scope.runtime.invalidateRequest(final.requestId, "advisor_queued_dispatch_scope_or_evidence_changed");
        return hostUnavailable("advisor_queued_dispatch_scope_or_evidence_changed");
      }
      const childName = capabilities.namedChild ? `Advisor${randomUUID().replace(/-/g, "").slice(0, 24)}` : undefined;
      const allocatedName = childName && (raw.agent.kind === "sub" ? `${raw.agent.id}.${childName}` : childName);
      const nativeParams = childName ? capabilities.shape === "batch"
        ? { ...params, tasks: (params.tasks as Record<string, unknown>[]).map((task, index) => index === review.index ? { ...task, name: childName } : task) }
        : { ...params, name: childName } : params;
      return advisorDispatchFrame.run({ scope, request: final, toolCallId, spawnAuthorized: false, allocatedName },
        () => scope.runtime.executeNativeTask(toolCallId, nativeParams, boundedSignal, onUpdate, raw));
    });
    if (!bounded.ok) {
      scope.runtime.invalidateRequest(final.requestId, "advisor_trusted_native_job_exhausted");
      const failure = { status: "UNAVAILABLE", reasons: [bounded.code], authority: "none" };
      if (record(bounded.result)) return { ...bounded.result, isError: true,
        content: [...(Array.isArray(bounded.result.content) ? bounded.result.content : []), { type: "text", text: JSON.stringify(failure) }],
        details: { ...(record(bounded.result.details) ? bounded.result.details : {}), advisor: failure } };
      return advisorHostResult(failure, true);
    }
    const native = bounded.result; const receipt = scope.runtime.currentReceipt(final.requestId);
    if (!receipt) return native;
    if (!scope.active || signal?.aborted || scope.epoch !== final.sessionEpoch || deadline !== undefined && Date.now() >= deadline || !(await services.isCurrent(final, scope.context))) {
      scope.runtime.invalidateRequest(final.requestId, "advisor_snapshot_changed_before_publication"); return hostUnavailable("advisor_snapshot_changed_before_publication");
    }
    await services.onReceipt(receipt, scope.context);
    api.appendEntry(ADVISOR_HOST_ENTRY, { kind: "provisional", sessionId: scope.sessionId, agentId: scope.context.agent.id, epoch: scope.epoch, review: provisional });
    if (!record(native) || !Array.isArray(native.content)) { scope.runtime.invalidateRequest(final.requestId, "advisor_native_envelope_missing_content"); return hostUnavailable("advisor_native_envelope_missing_content"); }
    const textContent = native.content
      .filter((c: unknown) => c && typeof c === "object" && (c as Record<string, unknown>).type === "text" && typeof (c as Record<string, unknown>).text === "string")
      .map((c: unknown) => (c as Record<string, unknown>).text as string)
      .join("\n\n");
    const parsedAdvisor = parseAdvisorStructuredResponse(textContent);
    const extraContent: Array<{ type: "text"; text: string }> = [
      { type: "text", text: `Host-owned Advisor receipt: ${receipt.receiptId} (request ${final.requestId}; ${receipt.authority}; not native commit or human permission).` },
    ];
    if (parsedAdvisor.valid && parsedAdvisor.actionItems.length > 0) {
      extraContent.push({
        type: "text",
        text: `[ADVISOR RE-PLAN ACTION ITEMS]:\n${parsedAdvisor.actionItems.map((item, idx) => `${idx + 1}. ${item}`).join("\n")}`,
      });
    }
    return {
      ...native,
      content: [...native.content, ...extraContent],
      details: {
        ...(record(native.details) ? native.details : {}),
        advisorReceipt: { receiptId: receipt.receiptId, requestId: final.requestId, authority: receipt.authority },
        ...(parsedAdvisor.valid ? { parsedAdvisor } : {}),
      },
    };
  } catch (error) { scope.runtime.invalidateRequest(final.requestId, "advisor_host_dispatch_or_publication_failed"); throw error; }
  finally { scope.inflight.delete(toolCallId); }
}
