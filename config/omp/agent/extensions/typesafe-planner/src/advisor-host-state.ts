import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdvisorRuntime, type AdvisorRuntime } from "./advisor-runtime";
import { canonicalDigest, freezeContractValue, nonempty } from "./task-contract-source";
import { record, validateAdvisorRequestIdentity, type AdvisorJournalRecord, type AdvisorRequest } from "./advisor-protocol";
import type { AdvisorHostAPI, AdvisorHostContext, AdvisorHostExecuteContext, AdvisorHostServices, AdvisorRequestDraft } from "./advisor-host-types";
import { createAdvisorNativeBudget, type AdvisorNativeBudget } from "./advisor-native-budget";
import { captureAdvisorNativeObservation, decodeAdvisorNativeObservation, type AdvisorNativeObservation } from "./advisor-native-observation";
import { nativeAdvisorPrompt } from "./advisor-native-prompt";
import type { AdvisorNativeTaskShape } from "./advisor-native-schema";

export const ADVISOR_HOST_ENTRY = "typesafe:advisor:host:v1";
export const ADVISOR_HOST_SOURCE = fileURLToPath(new URL("./advisor-host.ts", import.meta.url));
export const advisorAgent = (name: string) => name === "advisor" || name === "ck:advisor";
export interface ProvisionalReview { token: string; key: string; mode: "task" | "consultation"; nativeShape: AdvisorNativeTaskShape; nativeDisableIsolation?: boolean; draft: AdvisorRequestDraft; finalRequestId?: string }
export interface HostScope {
  api: AdvisorHostAPI; services: AdvisorHostServices; context: AdvisorHostContext; sessionId: string; epoch: string; active: boolean;
  runtime: AdvisorRuntime; provisionals: Map<string, ProvisionalReview>; requests: Map<string, AdvisorRequest>;
  inflight: Map<string, AdvisorRequest>; reasons: string[];
  reviewBudget: AdvisorNativeBudget; nativeObservations: Map<string, AdvisorNativeObservation>; failures: Map<string, string[]>;
}
export interface ChildRoute { scope: HostScope; request: AdvisorRequest; childSessionId: string; childSessionManager: object; childAgentId: string; parentEpoch: string }
export interface HostHub { roots: Map<object, HostScope>; children: Map<string, ChildRoute> }
export interface DispatchFrame { scope: HostScope; request: AdvisorRequest; toolCallId: string; spawnAuthorized: boolean; spawnKey?: string; allocatedName?: string }
export const advisorDispatchFrame = new AsyncLocalStorage<DispatchFrame>();
const hubs = new WeakMap<object, HostHub>();
const hookProof = new WeakMap<object, Set<string>>();
export function noteAdvisorHook(api: AdvisorHostAPI, name: string): void {
  let names = hookProof.get(api);
  if (!names) { names = new Set(); hookProof.set(api, names); }
  names.add(name);
}
export function advisorHub(api: AdvisorHostAPI): HostHub {
  let hub = hubs.get(api.events);
  if (!hub) { hub = { roots: new Map(), children: new Map() }; hubs.set(api.events, hub); }
  return hub;
}
export function hostContext(context: AdvisorHostExecuteContext, epoch = ""): AdvisorHostContext {
  if (!context?.sessionManager || typeof context.sessionManager.getSessionId !== "function" || typeof context.sessionManager.getBranch !== "function"
    || typeof context.sessionManager.getSessionFile !== "function" || typeof context.sessionManager.getHeader !== "function" || typeof context.abort !== "function"
    || !context.agent || !nonempty(context.agent.id) || !nonempty(context.cwd)) throw new Error("advisor_actual_session_context_required");
  return { cwd: context.cwd, sessionManager: context.sessionManager, agent: { ...context.agent }, model: context.model ? { api: context.model.api, id: context.model.id, provider: context.model.provider, contextWindow: context.model.contextWindow } : undefined,
    abort: context.abort, advisorSessionEpoch: epoch };
}
export function wrappedByAdvisor(api: AdvisorHostAPI, names: readonly string[]): boolean {
  const tools = api.getAllTools();
  return names.every(name => tools.some(tool => tool.name === name && tool.sourceInfo?.source === "extension" && path.resolve(tool.sourceInfo.path) === path.resolve(ADVISOR_HOST_SOURCE)));
}
export function getHostScope(api: AdvisorHostAPI, services: AdvisorHostServices, raw: AdvisorHostExecuteContext): HostScope {
  const hub = advisorHub(api); const view = hostContext(raw); const sessionId = view.sessionManager.getSessionId();
  let scope = hub.roots.get(view.sessionManager);
  if (scope && scope.sessionId === sessionId && scope.active) { scope.context = hostContext(raw, scope.epoch); return scope; }
  if (scope) { scope.active = false; scope.reviewBudget.cancel("advisor_parent_session_replaced"); scope.runtime.invalidateBranch(sessionId, randomUUID()); }
  const records = view.sessionManager.getBranch().flatMap(entry => record(entry) && entry.type === "custom" && entry.customType === ADVISOR_HOST_ENTRY && record(entry.data) ? [entry.data] : []);
  const priorEpoch = [...records].reverse().find(data => data.kind === "epoch" && data.sessionId === sessionId && data.agentId === view.agent.id && nonempty(data.epoch));
  const epoch = priorEpoch ? String(priorEpoch.epoch) : randomUUID();
  const context = hostContext(raw, epoch);
  let state: HostScope;
  const hooks = hookProof.get(api);
  const reviewBudget = createAdvisorNativeBudget(services.trustedAdvisorPolicy);
  const runtime = createAdvisorRuntime({
    capabilities: { childContext: hooks?.has("context") === true && hooks.has("before_agent_start"), providerPayload: hooks?.has("before_provider_request") === true,
      toolCall: hooks?.has("tool_call") === true, toolResult: hooks?.has("tool_result") === true,
      actualChildIdentity: !!context.agent.id && !!context.agent.kind && typeof context.sessionManager.getHeader === "function",
      providerOnPayload: hooks?.has("before_provider_request") === true && hooks.has("before_agent_start"),
      guardedReadExecution: wrappedByAdvisor(api, ["read", "grep", "glob"]) },
    append(item) {
      if (item.kind === "advisor_invalidated") state.failures.set(item.requestId, [...new Set([...(state.failures.get(item.requestId) ?? []), item.reason])]);
      api.appendEntry(ADVISOR_HOST_ENTRY, { kind: "journal", sessionId, agentId: context.agent.id, epoch: state.epoch, record: item });
    },
    beforeProviderRequest(request) {
      const admission = reviewBudget.beforeProvider(request.requestId);
      if (!admission.ok) { state.runtime.invalidateRequest(request.requestId, "advisor_trusted_native_dispatch_budget_exhausted"); throw new Error(admission.code ?? "advisor_native_review_budget_unavailable"); }
    },
    observeNativeDispatch(request) { noteNativeObservation(state, request.requestId, { nativeInvocationObserved: true, reasonCodes: [] }); },
    observeChildAllocation(request, id) { noteNativeObservation(state, request.requestId, { ...state.nativeObservations.get(request.requestId), nativeInvocationObserved: true, actualAllocatedChildId: id, reasonCodes: state.nativeObservations.get(request.requestId)?.reasonCodes ?? [] }); },
    observeNativeResult(request, envelope, id) { noteNativeObservation(state, request.requestId, captureAdvisorNativeObservation(request, envelope, id)); },
    continueParent(receiptId) { void api.sendMessage({ customType: "typesafe:advisor:continuation", content: `Independent Advisor receipt available: ${receiptId}. Revalidate current contract/evidence/policy and compose this receipt; it grants no native or human authority.`, display: true }, { deliverAs: "nextTurn", triggerTurn: true }); },
  });
  state = { api, services, context, sessionId, epoch, active: true, runtime, reviewBudget, nativeObservations: new Map(), failures: new Map(), provisionals: new Map(), requests: new Map(), inflight: new Map(), reasons: [] };
  if (!priorEpoch) api.appendEntry(ADVISOR_HOST_ENTRY, { kind: "epoch", sessionId, agentId: context.agent.id, epoch });
  const journal: AdvisorJournalRecord[] = [];
  for (const data of records) if (data.sessionId === sessionId && data.agentId === context.agent.id && data.epoch === epoch) {
    if (data.kind === "journal" && record(data.record)) {
      const item = data.record;
      if (item.kind === "advisor_request" && validateAdvisorRequestIdentity(item.request)) {
        const request = freezeContractValue(structuredClone(item.request)); state.requests.set(request.requestId, request); journal.push({ kind: "advisor_request", request });
      } else if (item.kind === "advisor_receipt" && record(item.receipt) && nonempty(item.receipt.requestId)) journal.push(item as unknown as AdvisorJournalRecord);
      else if ((item.kind === "advisor_invalidated" || item.kind === "advisor_continued") && nonempty(item.requestId)) {
        if (item.kind === "advisor_continued") journal.push({ kind: "advisor_continued", requestId: item.requestId });
        else if (typeof item.reason === "string" && /^[a-z0-9_:.-]{1,160}$/.test(item.reason)) {
          journal.push({ kind: "advisor_invalidated", requestId: item.requestId, reason: item.reason });
          state.failures.set(item.requestId, [...new Set([...(state.failures.get(item.requestId) ?? []), item.reason])]);
        }
      }
    }
    if (data.kind === "native_observation" && nonempty(data.requestId)) {
      const observation = decodeAdvisorNativeObservation(data.observation);
      if (observation) state.nativeObservations.set(data.requestId, observation);
    }
    if (data.kind === "provisional" && record(data.review) && nonempty(data.review.token)) {
      const provisional = data.review as unknown as ProvisionalReview;
      if (provisional.draft?.sessionEpoch === epoch) state.provisionals.set(provisional.token, { ...structuredClone(provisional), draft: freezeContractValue(structuredClone(provisional.draft)) });
    }
  }
  state.runtime.restore(journal, { sessionId, sessionEpoch: epoch }); hub.roots.set(view.sessionManager, state);
  return state;
}
export function rotateHostScope(scope: HostScope): void {
  scope.reviewBudget.cancel("advisor_parent_branch_or_epoch_changed");
  scope.epoch = randomUUID(); scope.context = { ...scope.context, advisorSessionEpoch: scope.epoch };
  scope.runtime.invalidateBranch(scope.sessionId, scope.epoch); scope.provisionals.clear(); scope.requests.clear(); scope.inflight.clear(); scope.nativeObservations.clear(); scope.failures.clear();
  scope.api.appendEntry(ADVISOR_HOST_ENTRY, { kind: "epoch", sessionId: scope.sessionId, agentId: scope.context.agent.id, epoch: scope.epoch });
}
export function routeChild(api: AdvisorHostAPI, raw: AdvisorHostExecuteContext, prompt?: string): ChildRoute | undefined {
  const view = hostContext(raw); const hub = advisorHub(api); const sessionId = view.sessionManager.getSessionId();
  const key = `${sessionId}\0${view.agent.id}`; const existing = hub.children.get(key);
  if (existing) return existing.scope.active && existing.parentEpoch === existing.scope.epoch && existing.childAgentId === view.agent.id
    && existing.childSessionManager === view.sessionManager && view.agent.kind === "sub" && view.agent.name === existing.request.agent
    && view.agent.parentId === existing.scope.context.agent.id && existing.scope.inflight.get(existing.request.parentToolCallId)?.requestId === existing.request.requestId ? existing : undefined;
  if (view.agent.kind !== "sub" || !advisorAgent(view.agent.name) || !nonempty(prompt)) return undefined;
  const frame = advisorDispatchFrame.getStore();
  if (!frame || !frame.spawnAuthorized || !frame.scope.active || frame.scope.epoch !== frame.request.sessionEpoch
    || (frame.allocatedName ? frame.spawnKey !== frame.allocatedName || view.agent.id !== frame.allocatedName
      : frame.spawnKey !== `${frame.toolCallId}:${frame.request.itemIndex}` && frame.spawnKey !== view.agent.id)
    || advisorHub(frame.scope.api).roots.get(frame.scope.context.sessionManager) !== frame.scope
    || frame.scope.inflight.get(frame.toolCallId)?.requestId !== frame.request.requestId || nativeAdvisorPrompt(frame.request.publicPrompt) !== prompt
    || view.agent.name !== frame.request.agent || view.agent.parentId !== frame.scope.context.agent.id) return undefined;
  const parent = view.sessionManager.getHeader()?.parentSession;
  const parentFile = frame.scope.context.sessionManager.getSessionFile();
  if (!parent || parent !== frame.scope.sessionId && (!parentFile || path.resolve(parent) !== path.resolve(parentFile))) return undefined;
  const routed: ChildRoute = { scope: frame.scope, request: frame.request, childSessionId: sessionId, childSessionManager: view.sessionManager, childAgentId: view.agent.id, parentEpoch: frame.scope.epoch };
  if (!frame.scope.runtime.observeAllocation({ ...view, sessionEpoch: frame.scope.epoch }, prompt)) return undefined;
  hub.children.set(key, routed); return routed;
}
export function draftApplicability(draft: AdvisorRequestDraft): string {
  const { provenance, ...binding } = draft.binding;
  const { dispatchId, ...origin } = provenance;
  return canonicalDigest({ binding, origin, snapshot: draft.snapshot, scope: draft.scope, criterionIds: draft.criterionIds, parentRequirementIds: draft.parentRequirementIds ?? [],
    evidenceRefs: draft.evidenceRefs, integrationEvidenceRefs: draft.integrationEvidenceRefs, publicPrompt: draft.publicPrompt, sessionEpoch: draft.sessionEpoch, agent: draft.agent,
    ...(draft.binding.purpose === "shadow" ? { independentDispatch: dispatchId } : {}) });
}
export function noteNativeObservation(scope: HostScope, requestId: string, observation: AdvisorNativeObservation): void {
  const owned = freezeContractValue(structuredClone(observation)); scope.nativeObservations.set(requestId, owned);
  scope.api.appendEntry(ADVISOR_HOST_ENTRY, { kind: "native_observation", sessionId: scope.sessionId, agentId: scope.context.agent.id, epoch: scope.epoch, requestId, observation: owned });
}
