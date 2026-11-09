import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import { advisorApplicabilityDigest, advisorOutputSchema, foldAdvisorHistory, makeAdvisorReceipt, record, validateAdvisorRequestIdentity, validateAssessmentForRequest, type AdvisorJournalRecord, type AdvisorReceipt, type AdvisorRequest } from "./advisor-protocol";
import { advisorProviderApis, guardAdvisorTool, missingAdvisorCapabilities, projectAdvisorPayload, publicAdvisorMessages, sameChild, textOf, validPublicPrompt, type AdvisorCapabilities, type AdvisorChildContext } from "./advisor-guards";
import { createAdvisorReadSession, type AdvisorReadSession, type AdvisorMediatedReadResult } from "./advisor-read-session";
import { defaultAdvisorReadLimits, type AdvisorReadLimits } from "./advisor-readonly";
import { ADVISOR_NATIVE_CONTEXT, nativeAdvisorPrompt } from "./advisor-native-prompt";

export interface NativeTaskContext { invokeTool?: (params: Record<string, unknown>, options?: { signal?: AbortSignal; onUpdate?: (update: unknown) => void }) => Promise<unknown> }
export interface AdvisorRuntimeOptions {
  capabilities: AdvisorCapabilities;
  readLimits?: Partial<AdvisorReadLimits>; apiKey?: string;
  append(record: AdvisorJournalRecord): void;
  continueParent(receiptId: string): void;
  /** Optional additional tightening; built-in caller/strict/valid validation always applies. */
  validateStructuredMetadata?(metadata: Record<string, unknown>): boolean;
  beforeProviderRequest?(request: AdvisorRequest): void;
  observeNativeResult?(request: AdvisorRequest, envelope: unknown, actualAllocatedChildId?: string): void;
  observeNativeDispatch?(request: AdvisorRequest): void;
  observeChildAllocation?(request: AdvisorRequest, actualAllocatedChildId: string): void;
}
export interface NativeAdvisorTaskItem { agent: AdvisorRequest["agent"]; task: string; solutionSpace: string; outputSchema: typeof advisorOutputSchema; schemaMode: "strict" }
export type AdvisorPreparation =
  | { status: "pending"; requestId: string; task: NativeAdvisorTaskItem }
  | { status: "ready"; receipt: AdvisorReceipt; request: AdvisorRequest }
  | { status: "UNAVAILABLE"; reasons: string[] };
export interface AdvisorToolBlock { block: true; reason: string }
export interface AdvisorToolResultPatch { isError: boolean; content: { type: string; text: string }[]; details: Record<string, never> }
export interface AdvisorRuntime {
  prepare(request: AdvisorRequest): AdvisorPreparation;
  observeAllocation(context: AdvisorChildContext, publicPrompt: string): boolean;
  childContext(context: AdvisorChildContext, messages: unknown[]): { messages: { role: "user"; content: string }[] } | undefined;
  providerPayload(context: AdvisorChildContext, payload: unknown): Record<string, unknown> | undefined;
  toolCall(context: AdvisorChildContext, event: { toolName: string; input: unknown; toolCallId?: string }): AdvisorToolBlock | undefined;
  toolResult(context: AdvisorChildContext, event: { toolName: string; input?: unknown; isError?: boolean; details?: unknown; toolCallId?: string; content?: unknown }): AdvisorToolResultPatch | undefined;
  executeReadOnlyTool(toolName: string, params: unknown, context: AdvisorChildContext, toolCallId: string): AdvisorMediatedReadResult | undefined;
  executeNativeTask(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: ((update: unknown) => void) | undefined, context: NativeTaskContext): Promise<unknown>;
  restore(entries: readonly AdvisorJournalRecord[], current: { sessionId: string; sessionEpoch: string }): void;
  currentReceipt(requestId: string, snapshotDigest?: string): AdvisorReceipt | undefined;
  invalidateBranch(sessionId: string, sessionEpoch: string): void;
  invalidateRequest(requestId: string, reason: string): void;
}
type RuntimeState = { request: AdvisorRequest; receipt?: AdvisorReceipt; continued: boolean; invalidated: boolean; childId?: string; dispatching?: boolean; providerObserved?: boolean; terminalDigest?: string; pendingYieldDigest?: string; finalYieldDigest?: string };
export function createAdvisorRuntime(options: AdvisorRuntimeOptions): AdvisorRuntime {
  let requests = new Map<string, RuntimeState>();
  const children = new Map<string, RuntimeState>();
  const readLimits = { ...defaultAdvisorReadLimits, ...options.readLimits };
  for (const [key, ceiling] of Object.entries({ maxFileBytes: 16777216, maxOutputBytes: 65536, maxContextBytes: 4194304 })) {
    const value = readLimits[key as keyof AdvisorReadLimits];
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new Error("advisor_trusted_read_limits_invalid");
  }
  const readSessions = new WeakMap<RuntimeState, AdvisorReadSession>();
  function readSession(state: RuntimeState): AdvisorReadSession {
    let session = readSessions.get(state);
    if (!session) { session = createAdvisorReadSession(state.request, readLimits, reason => invalidate(state, reason), options.apiKey); readSessions.set(state, session); }
    return session;
  }
  function invalidate(state: RuntimeState, reason: string) {
    const wasInvalidated = state.invalidated; state.invalidated = true; delete state.receipt;
    if (!wasInvalidated) options.append({ kind: "advisor_invalidated", requestId: state.request.requestId, reason });
  }
  function stateFor(context: AdvisorChildContext): RuntimeState | undefined {
    const state = children.get(context.agent.id);
    if (state && !sameChild(context, state.request, context.agent.id)) { invalidate(state, "advisor_child_identity_changed"); return undefined; }
    return state;
  }
  function prepare(request: AdvisorRequest): AdvisorPreparation {
    const missing = missingAdvisorCapabilities(options.capabilities);
    if (missing.length) return { status: "UNAVAILABLE" as const, reasons: missing };
    if (!validateAdvisorRequestIdentity(request) || !validPublicPrompt(request)) return { status: "UNAVAILABLE" as const, reasons: ["advisor_public_context_digest_mismatch"] };
    const existing = requests.get(request.requestId);
    if (existing?.invalidated) return { status: "UNAVAILABLE" as const, reasons: ["advisor_request_invalidated_new_dispatch_required"] };
    if (existing?.receipt) return { status: "ready", receipt: existing.receipt, request: existing.request };
    // Preserve independent shadow arms; ordinary reviews reuse unchanged applicable source receipts.
    if (request.binding.purpose !== "shadow") {
      const key = advisorApplicabilityDigest(request);
      const applicable = [...requests.values()].find(state => !state.invalidated && state.receipt && advisorApplicabilityDigest(state.request) === key);
      if (applicable?.receipt) return { status: "ready", receipt: applicable.receipt, request: applicable.request };
    }
    if (!existing) { requests.set(request.requestId, { request, continued: false, invalidated: false }); options.append({ kind: "advisor_request", request }); }
    return { status: "pending", requestId: request.requestId, task: { agent: request.agent, task: request.publicPrompt, solutionSpace: "Independently assess original obligations using curated public packets and guarded exact-SHA source reads; no mutation or authority reuse.", outputSchema: advisorOutputSchema, schemaMode: "strict" } };
  }
  function observeAllocation(context: AdvisorChildContext, publicPrompt: string): boolean {
    if (context.agent.kind !== "sub") return false;
    const candidates = [...requests.values()].filter(state => state.dispatching && !state.invalidated && state.request.parentAgentId === context.agent.parentId
      && nativeAdvisorPrompt(state.request.publicPrompt) === publicPrompt && state.request.promptDigest === canonicalDigest(state.request.publicPrompt)
      && context.agent.name === state.request.agent);
    if (candidates.length !== 1) return false;
    const state = candidates[0];
    if (state.childId && state.childId !== context.agent.id) { invalidate(state, "advisor_ambiguous_child_allocation"); return false; }
    state.childId = context.agent.id; children.set(context.agent.id, state);
    options.observeChildAllocation?.(state.request, context.agent.id);
    return true;
  }
  function childContext(context: AdvisorChildContext, messages: unknown[]) {
    if (context.agent.kind !== "sub") return undefined;
    let state = stateFor(context);
    if (!state) {
      const prompts = messages.filter(message => record(message) && message.role === "user").map(textOf).filter((text): text is string => typeof text === "string");
      if (prompts.length === 1) observeAllocation(context, prompts[0]);
      state = stateFor(context);
    }
    // Every advisor-named child must have a prior host request before its first provider call.
    if (!state) {
      if (["advisor", "ck:advisor"].includes(context.agent.name)) throw new Error("advisor_unbound_child_context");
      return undefined;
    }
    if (state.invalidated || !state.dispatching || !validPublicPrompt(state.request)) throw new Error("advisor_context_not_current");
    if (!context.model?.api || !advisorProviderApis[context.model.api]) { invalidate(state, "advisor_provider_onPayload_unsupported"); throw new Error(`advisor_provider_api_unsupported:${context.model?.api ?? "missing"}`); }
    return { messages: publicAdvisorMessages(state.request) };
  }
  function providerPayload(context: AdvisorChildContext, payload: unknown) {
    const state = stateFor(context);
    if (!state) {
      if (context.agent.kind === "sub" && ["advisor", "ck:advisor"].includes(context.agent.name)) throw new Error("advisor_unbound_provider_dispatch");
      return undefined;
    }
    if (state.invalidated || !state.dispatching) throw new Error("advisor_stale_provider_dispatch");
    if (!context.model?.api || !advisorProviderApis[context.model.api]) { invalidate(state, "advisor_provider_onPayload_unsupported"); throw new Error(`advisor_provider_api_unsupported:${context.model?.api ?? "missing"}`); }
    let projected: Record<string, unknown>;
    try { projected = projectAdvisorPayload(payload, state.request, readSessions.get(state)?.transactions(), readLimits.maxContextBytes); }
    catch (error) { invalidate(state, "advisor_provider_projection_invalid"); throw error; }
    options.beforeProviderRequest?.(state.request);
    state.providerObserved = true;
    return projected;
  }
  function toolCall(context: AdvisorChildContext, event: { toolName: string; input: unknown; toolCallId?: string }) {
    const state = stateFor(context);
    if (!state) return context.agent.kind === "sub" && ["advisor", "ck:advisor"].includes(context.agent.name) ? { block: true as const, reason: "advisor_unbound_tool_call" } : undefined;
    if (state.invalidated || !state.dispatching) return { block: true as const, reason: "advisor_stale_tool_call" };
    if (["read", "grep", "glob"].includes(event.toolName)) return readSession(state).authorize(event.toolName, event.input, event.toolCallId);
    if (event.toolName === "yield" && record(event.input) && (event.input.error === undefined || event.input.error === null || event.input.error === "")
      && (event.input.type === undefined || event.input.type === null || event.input.type === "result")
      && Object.keys(event.input).every(key => ["data", "type", "error"].includes(key))
      && validateAssessmentForRequest(event.input.data, state.request)) {
      const digest = canonicalDigest(event.input.data);
      if (state.finalYieldDigest && state.finalYieldDigest !== digest) { invalidate(state, "advisor_conflicting_yield"); return { block: true as const, reason: "advisor_conflicting_yield" }; }
      state.pendingYieldDigest = digest;
      return undefined;
    }
    return guardAdvisorTool(state.request, event.toolName, event.input);
  }
  function toolResult(context: AdvisorChildContext, event: { toolName: string; input?: unknown; isError?: boolean; details?: unknown; toolCallId?: string; content?: unknown }) {
    const state = stateFor(context);
    if (!state) return undefined;
    if (["read", "grep", "glob"].includes(event.toolName) && readSession(state).observe(event)) return undefined;
    if (event.toolName !== "yield") { invalidate(state, "advisor_unapproved_tool_result"); return { isError: true, content: [{ type: "text", text: "Advisor tool result withheld by scope policy." }], details: {} }; }
    if (event.isError || !record(event.details) || event.details.status !== "success" || event.details.error || event.details.useLastTurn || event.details.schemaOverridden || Array.isArray(event.details.type)
      || !state.pendingYieldDigest || canonicalDigest(event.details.data) !== state.pendingYieldDigest) invalidate(state, "advisor_yield_result_invalid");
    else state.finalYieldDigest = state.pendingYieldDigest;
    return undefined;
  }
  function executeReadOnlyTool(toolName: string, params: unknown, context: AdvisorChildContext, toolCallId: string): AdvisorMediatedReadResult | undefined {
    const state = stateFor(context);
    if (!state) {
      if (context.agent.kind === "sub" && ["advisor", "ck:advisor"].includes(context.agent.name)) return { isError: true, content: [{ type: "text", text: "Unbound Advisor source read denied." }], details: {} };
      return undefined;
    }
    if (state.invalidated || !state.dispatching) return { isError: true, content: [{ type: "text", text: "Stale Advisor source read denied." }], details: {} };
    return readSession(state).execute(toolName, params, toolCallId);
  }
  async function executeNativeTask(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: ((update: unknown) => void) | undefined, context: NativeTaskContext): Promise<unknown> {
    if (!context.invokeTool) return { isError: true, content: [{ type: "text", text: "UNAVAILABLE: native task invokeTool capability required." }] };
    const items = Array.isArray(params.tasks) ? params.tasks : [params];
    const relevant = [...requests.values()].filter(state => !state.invalidated && state.request.parentToolCallId === toolCallId);
    const advisorItems = items.filter(item => record(item) && ["advisor", "ck-advisor", "ck:advisor"].includes(String(item.agent)));
    if (!advisorItems.length && !relevant.length) return context.invokeTool(params, { signal, onUpdate });
    for (const state of relevant) {
      const item = items[state.request.itemIndex];
      if (state.dispatching || state.receipt || !record(item) || item.task !== state.request.publicPrompt || item.agent !== state.request.agent
        || canonicalDigest(item.outputSchema) !== canonicalDigest(advisorOutputSchema) || item.schemaMode !== "strict"
        || item.tools !== undefined || item.sourceSession !== undefined || item.isolated === true || item.model !== undefined || params.model !== undefined || params.context !== undefined && params.context !== "" && params.context !== ADVISOR_NATIVE_CONTEXT
        || params.blocking !== undefined || item.blocking !== undefined) {
        invalidate(state, "advisor_dispatch_mismatch");
        return { isError: true, content: [{ type: "text", text: "Advisor request/native task binding mismatch." }] };
      }
    }
    if (!relevant.length || relevant.length !== advisorItems.length) return { isError: true, content: [{ type: "text", text: "UNAVAILABLE: host-owned Advisor request required before dispatch." }] };
    for (const state of relevant) state.dispatching = true;
    let envelope: unknown;
    try {
      const nativePromise = context.invokeTool(params, { signal, onUpdate });
      for (const state of relevant) options.observeNativeDispatch?.(state.request);
      envelope = await nativePromise;
      for (const state of relevant) options.observeNativeResult?.(state.request, envelope, state.childId);
    }
    catch (error) { for (const state of relevant) invalidate(state, "advisor_native_dispatch_failed"); throw error; }
    finally { for (const state of relevant) state.dispatching = false; }
    for (const state of relevant) {
      const terminalDigest = canonicalDigest(envelope);
      if (state.terminalDigest && state.terminalDigest !== terminalDigest) { invalidate(state, "advisor_conflicting_terminal_delivery"); continue; }
      state.terminalDigest = terminalDigest;
      const details = record(envelope) && record(envelope.details) ? envelope.details : undefined;
      const results = details && Array.isArray(details.results) ? details.results : [];
      const matches = results.filter(result => record(result) && result.index === state.request.itemIndex);
      const result = matches.length === 1 && record(matches[0]) ? matches[0] : undefined;
      const output = result && record(result.structuredOutput) ? result.structuredOutput : undefined;
      if (state.invalidated || signal?.aborted || !record(envelope) || envelope.isError !== undefined && envelope.isError !== false || !details || details.async !== undefined
        || !state.childId || !state.providerObserved || !state.finalYieldDigest || !result || result.id !== state.childId || result.agent !== state.request.agent
        || results.filter(item => record(item) && item.id === state.childId).length !== 1
        || result.agentSource !== "project" || result.task !== nativeAdvisorPrompt(state.request.publicPrompt) || result.assignment !== state.request.publicPrompt
        || result.exitCode !== 0 || result.aborted !== undefined && result.aborted !== false || result.abortReason !== undefined || result.error !== undefined || result.retryFailure !== undefined
        || !output || output.source !== "caller" || output.mode !== "strict" || output.status !== "valid" || output.error !== undefined
        || output.incremental !== undefined || output.useLastTurn !== undefined || output.schemaOverridden !== undefined
        || options.validateStructuredMetadata && !options.validateStructuredMetadata(output)
        || canonicalDigest(output.data) !== state.finalYieldDigest
        || !validateAssessmentForRequest(output.data, state.request)) {
        invalidate(state, "advisor_terminal_native_result_invalid"); continue;
      }
      const receipt = makeAdvisorReceipt(state.request, output.data, state.childId, terminalDigest);
      state.receipt = receipt; options.append({ kind: "advisor_receipt", receipt });
      if (!state.continued) {
        state.continued = true; options.append({ kind: "advisor_continued", requestId: state.request.requestId });
        options.continueParent(receipt.receiptId);
      }
    }
    return envelope;
  }
  function restore(entries: readonly AdvisorJournalRecord[], current: { sessionId: string; sessionEpoch: string }) {
    requests = foldAdvisorHistory(entries, current); children.clear();
  }
  function currentReceipt(requestId: string, snapshotDigest?: string): AdvisorReceipt | undefined {
    const state = requests.get(requestId);
    if (!state || state.invalidated || snapshotDigest && canonicalDigest(state.request.snapshot) !== snapshotDigest) return undefined;
    return state.receipt;
  }
  function invalidateBranch(sessionId: string, sessionEpoch: string) {
    for (const state of requests.values()) if (state.request.binding.provenance.sessionId !== sessionId || state.request.sessionEpoch !== sessionEpoch) invalidate(state, "advisor_session_or_branch_changed");
  }
  function invalidateRequest(requestId: string, reason: string) {
    const state = requests.get(requestId);
    if (state) invalidate(state, reason);
  }
  return freezeContractValue({ prepare, observeAllocation, childContext, providerPayload, toolCall, toolResult, executeReadOnlyTool, executeNativeTask, restore, currentReceipt, invalidateBranch, invalidateRequest });
}
