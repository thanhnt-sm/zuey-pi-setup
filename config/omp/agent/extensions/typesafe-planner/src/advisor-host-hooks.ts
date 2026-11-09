import { advisorAgent, advisorDispatchFrame, advisorHub, getHostScope, hostContext, noteAdvisorHook, rotateHostScope, routeChild, wrappedByAdvisor } from "./advisor-host-state";
import { record } from "./advisor-protocol";
import { advisorProviderApis } from "./advisor-guards";
import type { AdvisorHostAPI, AdvisorHostExecuteContext, AdvisorHostServices } from "./advisor-host-types";
import { nativeAdvisorPrompt } from "./advisor-native-prompt";
import type { NativeMutationDelegationRuntime } from "./advisor-mutation-delegation";

type InitializeHost = (context: AdvisorHostExecuteContext) => Promise<void>;
export function installAdvisorHostHooks(api: AdvisorHostAPI, services: AdvisorHostServices, initialize: InitializeHost, mutation?: NativeMutationDelegationRuntime,
  isProjectExcluded: (context: AdvisorHostExecuteContext) => boolean = () => false): void {
  const protectedChild = (context: AdvisorHostExecuteContext) => context?.agent?.kind === "sub" && advisorAgent(context.agent.name);
  const guard = async (raw: AdvisorHostExecuteContext) => {
    const route = routeChild(api, raw);
    if (!route) throw new Error("advisor_actual_child_session_route_required");
    if (!wrappedByAdvisor(api, ["read", "grep", "glob"]) || !raw.model?.api || !advisorProviderApis[raw.model.api]
      || !(await route.scope.services.isCurrent(route.request, route.scope.context))) throw new Error("advisor_child_mediation_or_current_evidence_required");
    return { route, context: { ...hostContext(raw, route.parentEpoch), sessionEpoch: route.parentEpoch } };
  };
  const subscribe = (name: string, handler: (event: unknown, context: AdvisorHostExecuteContext) => unknown | Promise<unknown>) => {
    api.on(name, (event, context) => {
      // Explicit exclusion disables only TypeSafe mediation. Native wrapper
      // registration/lifecycle still runs so task/read/write/Advisor remain
      // ordinary host operations; child mediation is intentionally untouched
      // by this extension in excluded sessions.
      if (isProjectExcluded(context) && !["session_start", "session_branch", "session_tree", "session_switch"].includes(name)) return undefined;
      return handler(event, context);
    }); noteAdvisorHook(api, name);
  };
  subscribe("session_start", async (_event, context) => {
    await initialize(context);
    if (!protectedChild(context)) getHostScope(api, services, context);
  });
  subscribe("before_subagent_spawn", async (event, context) => {
    if (!record(event)) return { block: true, reason: "advisor_spawn_event_malformed" };
    const child = routeChild(api, context);
    if (child || context.agent.kind === "sub" && advisorAgent(context.agent.name)) return { block: true, reason: "advisor_nested_subagent_spawn_denied" };
    if (!advisorAgent(String(event.agent))) { await mutation?.observeSpawn(event, context); return undefined; }
    const frame = advisorDispatchFrame.getStore();
    if (!frame || frame.scope.context.sessionManager !== context.sessionManager || frame.scope.sessionId !== context.sessionManager.getSessionId()
      || !frame.scope.active || frame.scope.api !== api || advisorHub(api).roots.get(context.sessionManager) !== frame.scope
      || frame.toolCallId !== frame.request.parentToolCallId || frame.scope.epoch !== frame.request.sessionEpoch || event.invocationKind !== "task"
      || typeof event.spawnKey !== "string" || !event.spawnKey.trim()
      || frame.allocatedName !== undefined && event.spawnKey !== frame.allocatedName
      || event.agent !== frame.request.agent || frame.spawnAuthorized || !(await frame.scope.services.isCurrent(frame.request, frame.scope.context))) return { block: true, reason: "advisor_approved_actual_native_task_dispatch_required" };
    frame.spawnAuthorized = true;
    frame.spawnKey = event.spawnKey;
    return undefined;
  });
  subscribe("before_agent_start", async (event, raw) => {
    const root = advisorHub(api).roots.get(raw.sessionManager);
    if (root?.active && root.sessionId === raw.sessionManager.getSessionId()) root.context = hostContext(raw, root.epoch);
    await mutation?.bindChild(raw);
    const current = advisorDispatchFrame.getStore();
    const exactDispatchedPrompt = raw.agent.kind === "sub" && record(event) && current && event.prompt === nativeAdvisorPrompt(current.request.publicPrompt);
    if (!protectedChild(raw) && !exactDispatchedPrompt && !routeChild(api, raw)) return undefined;
    try {
      await initialize(raw);
      if (!record(event) || typeof event.prompt !== "string" || !routeChild(api, raw, event.prompt)) throw new Error("advisor_exact_initial_public_prompt_and_ancestry_required");
      const { route, context } = await guard(raw);
      const allowed: Record<string, true> = { read: true, grep: true, glob: true, yield: true };
      await api.setActiveTools(api.getActiveTools().filter(name => allowed[name] === true));
      route.scope.runtime.childContext(context, [{ role: "user", content: event.prompt }]);
      return { systemPrompt: ["Independently review only the authorized public task packet and guarded source file scope. Read-only does not grant private-file access. No shell, eval, writes, nested tasks, web search, or recursive review is allowed. Return one terminal structured yield(data); never use last-turn extraction or schema override."] };
    } catch (error) { raw.abort(); throw error; }
  });
  subscribe("context", async (event, raw) => {
    if (!protectedChild(raw) && !routeChild(api, raw)) return undefined;
    try {
      const { route, context } = await guard(raw);
      if (!record(event) || !Array.isArray(event.messages)) throw new Error("advisor_actual_context_messages_required");
      return route.scope.runtime.childContext(context, event.messages);
    } catch (error) { raw.abort(); throw error; }
  });
  subscribe("before_provider_request", async (event, raw) => {
    if (!protectedChild(raw) && !routeChild(api, raw)) return undefined;
    try {
      const { route, context } = await guard(raw);
      if (!record(event) || !("payload" in event)) throw new Error("advisor_actual_provider_payload_required");
      // SDK expects the replacement itself, not {payload: replacement}.
      return route.scope.runtime.providerPayload(context, event.payload);
    } catch (error) { raw.abort(); throw error; }
  });
  subscribe("tool_call", async (event, raw) => {
    let routed;
    try { routed = routeChild(api, raw); }
    catch { return { block: true, reason: "advisor_actual_session_context_required" }; }
    if (!protectedChild(raw) && !routed) return undefined;
    try {
      const { route, context } = await guard(raw);
      if (!record(event) || typeof event.toolName !== "string" || typeof event.toolCallId !== "string") { raw.abort(); return { block: true, reason: "advisor_actual_tool_call_identity_required" }; }
      const decision = route.scope.runtime.toolCall(context, { toolName: event.toolName, toolCallId: event.toolCallId, input: event.input });
      if (decision?.block) raw.abort();
      return decision;
    } catch { raw.abort(); return { block: true, reason: "advisor_child_tool_mediation_unavailable" }; }
  });
  subscribe("tool_result", async (event, raw) => {
    if (!record(event) || typeof event.toolName !== "string") return undefined;
    const routed = routeChild(api, raw);
    if (routed || protectedChild(raw)) {
      try {
        if (event.isError !== undefined && typeof event.isError !== "boolean") throw new Error("advisor_malformed_actual_tool_result_error_flag");
        const { route, context } = await guard(raw);
        return route.scope.runtime.toolResult(context, { toolName: event.toolName, toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
          input: event.input, isError: event.isError === true, details: event.details, content: event.content });
      } catch { raw.abort(); return { isError: true, content: [{ type: "text", text: "Advisor result withheld: no current host-bound mediation." }], details: {} }; }
    }
    if (event.toolName === "task" && (event.isError === true || record(event.details) && event.details.async !== undefined)) {
      const scope = advisorHub(api).roots.get(raw.sessionManager);
      for (const request of scope?.requests.values() ?? []) if (request.parentToolCallId === event.toolCallId) scope!.runtime.invalidateRequest(request.requestId, "advisor_actual_outer_task_result_failed");
    }
    return undefined;
  });
  for (const name of ["session_branch", "session_tree", "session_switch"]) subscribe(name, async (_event, context) => {
    if (name === "session_switch") for (const [manager, prior] of advisorHub(api).roots) {
      if (manager !== context.sessionManager || prior.sessionId !== context.sessionManager.getSessionId()) {
        prior.active = false; prior.reviewBudget.cancel("advisor_parent_session_switched"); advisorHub(api).roots.delete(manager);
      }
    }
    const scope = advisorHub(api).roots.get(context.sessionManager);
    if (scope) rotateHostScope(scope);
    await initialize(context);
    if (!protectedChild(context)) getHostScope(api, services, context);
  });
  subscribe("session_shutdown", (_event, context) => {
    const hub = advisorHub(api); const scope = hub.roots.get(context.sessionManager);
    if (scope) {
      scope.active = false;
      scope.reviewBudget.cancel("advisor_parent_session_shutdown");
      for (const request of scope.inflight.values()) scope.runtime.invalidateRequest(request.requestId, "advisor_shutdown_before_settled_native_result");
      hub.roots.delete(context.sessionManager);
    }
    for (const [key, child] of hub.children) if (child.childSessionId === context.sessionManager.getSessionId() || child.scope === scope) hub.children.delete(key);
  });
}
