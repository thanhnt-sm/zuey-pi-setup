import { installAdvisorHostHooks } from "./advisor-host-hooks";
import { executeHostTask, hostReadiness, hostUnavailable, prepareHostReview, prepareHostShadowReview } from "./advisor-host-dispatch";
import { ADVISOR_HOST_SOURCE, advisorAgent, advisorHub, hostContext, routeChild, wrappedByAdvisor, type HostScope } from "./advisor-host-state";
import type { AdvisorHostAPI, AdvisorHostExecuteContext, AdvisorHostRegistration, AdvisorHostReview, AdvisorHostServices, AdvisorHostOptions } from "./advisor-host-types";
import { hasSettledAdvisorHistory } from "./advisor-host-history";
import { executeAdvisorNativeTodo } from "./advisor-native-todo";
import { createNativeMutationDelegation } from "./advisor-mutation-delegation";
import { collectAdvisorHostSettlement } from "./advisor-host-settlement";
import { projectExcludedResult } from "./project-exclusion-policy";
export type { NativeMutationScopeGrant, NativeMutationDelegationOptions } from "./advisor-mutation-delegation";
export type { AdvisorHostSettlement, AdvisorHostSettlementProvenance } from "./advisor-host-settlement";
export { ownsAdvisorHostSettlement, isCurrentAdvisorHostSettlement } from "./advisor-host-settlement";
export type { AdvisorHostAPI, AdvisorHostContext, AdvisorHostExecuteContext, AdvisorHostRegistration, AdvisorHostReview, AdvisorHostServices, AdvisorHostOutcome, AdvisorRequestDraft, AdvisorDispatchPreparation, AdvisorShadowDraftFactory, AdvisorHostIdentity, AdvisorHostToolResult, AdvisorHostOptions, AdvisorNativeTodoServices, AdvisorNativeTodoOutcome } from "./advisor-host-types";
const publishedHostReviews = new WeakMap<object, HostScope>();
/** Process-local source ownership, not a JSON/digest/boolean attestation or native permission. */
export function ownsAdvisorHostReview(value: unknown): value is AdvisorHostReview {
  return value !== null && typeof value === "object" && publishedHostReviews.has(value);
}
export async function isCurrentAdvisorHostReview(value: unknown): Promise<boolean> {
  if (!ownsAdvisorHostReview(value)) return false;
  const scope = publishedHostReviews.get(value);
  if (!scope?.active || advisorHub(scope.api).roots.get(scope.context.sessionManager) !== scope || scope.epoch !== value.request.sessionEpoch
    || scope.sessionId !== scope.context.sessionManager.getSessionId() || scope.runtime.currentReceipt(value.request.requestId) !== value.receipt) return false;
  try { return hasSettledAdvisorHistory(scope, value.request, value.receipt) && await scope.services.isCurrent(value.request, scope.context); }
  catch { return false; }
}

/** Source-supported 18.12.3 adapter. No registration-time getAllTools or arbitrary dispatcher. */
export function registerAdvisorHost(api: AdvisorHostAPI, services: AdvisorHostServices, options: AdvisorHostOptions = {}): AdvisorHostRegistration {
  const isProjectExcluded = options.isProjectExcluded ?? (() => false);
  let installing: Promise<void> | undefined;
  const mutation = options.mutationDelegation ? createNativeMutationDelegation(api, options.mutationDelegation) : undefined;
  let installedSession: string | undefined;
  let installationFailure: string | undefined;
  const nativeSchemas = new Map<string, unknown>();
  function todoReady(context: AdvisorHostExecuteContext): boolean {
    if (isProjectExcluded(context)) return false;
    const scope = advisorHub(api).roots.get(context.sessionManager);
    try {
      return !!options.nativeTodo && nativeSchemas.has("todo") && !!scope?.active && scope.sessionId === context.sessionManager.getSessionId()
        && scope.context.agent.id === context.agent.id && wrappedByAdvisor(api, ["todo"])
        && api.getAllTools().find(tool => tool.name === "todo")?.parameters === nativeSchemas.get("todo");
    } catch { return false; }
  }
  async function initialize(context: AdvisorHostExecuteContext): Promise<void> {
    const sessionId = context.sessionManager.getSessionId();
    if (installedSession === sessionId && installing) return installing;
    installedSession = sessionId;
    installing = (async () => {
      try {
        const active = api.getActiveTools();
        const tools = api.getAllTools();
        for (const name of ["task", "read", "grep", "glob", ...(options.nativeTodo ? ["todo"] : [])]) {
          const original = tools.find(tool => tool.name === name);
          if (!original || original.sourceInfo.source !== "builtin") continue;
          nativeSchemas.set(name, original.parameters);
          // Preserve the actual native schema instance (including Zod/ArkType identity).
          api.registerTool({ name, label: `Guarded ${name}`, description: original.description, parameters: original.parameters, sourcePath: ADVISOR_HOST_SOURCE, approval: name === "task" ? "exec" : "read",
            ...(name === "task" ? { strict: false, lenientArgValidation: true } : name === "todo" ? { strict: true, lenientArgValidation: true, concurrency: "exclusive" as const } : {}),
            async execute(toolCallId, params, signal, onUpdate, current) {
              if (isProjectExcluded(current)) {
                if (!current.invokeTool) return hostUnavailable(`advisor_same_native_${name}_invokeTool_required`);
                return current.invokeTool(params, { signal, onUpdate });
              }
              if (name === "task") return executeHostTask(api, services, toolCallId, params, signal, onUpdate, current, mutation);
              if (name === "todo" && options.nativeTodo) return executeAdvisorNativeTodo(options.nativeTodo, todoReady(current), advisorHub(api).roots.get(current.sessionManager)?.epoch, toolCallId, params, signal, onUpdate, current);
              const child = routeChild(api, current);
              if (!child) {
                if (current.agent.kind === "sub" && advisorAgent(current.agent.name)) return hostUnavailable("advisor_bound_child_source_reader_required");
                if (!current.invokeTool) return hostUnavailable(`advisor_same_native_${name}_invokeTool_required`);
                return current.invokeTool(params, { signal, onUpdate });
              }
              if (!wrappedByAdvisor(api, ["read", "grep", "glob"]) || !(await child.scope.services.isCurrent(child.request, child.scope.context))) {
                current.abort(); return hostUnavailable("advisor_guarded_source_snapshot_or_wrappers_not_current");
              }
              return child.scope.runtime.executeReadOnlyTool(name, params, { ...hostContext(current, child.parentEpoch), sessionEpoch: child.parentEpoch }, toolCallId)
                ?? hostUnavailable("advisor_guarded_read_execution_binding_required");
            },
          });
        }
        // SDK serializes this behind late tool registrations (session-tools.ts).
        // The selection is unchanged; this is an activation barrier, not a grant.
        await api.setActiveTools(active);
        installationFailure = undefined;
      } catch {
        installationFailure = "advisor_native_schema_registration_or_activation_unavailable";
      }
    })();
    return installing;
  }
  installAdvisorHostHooks(api, services, initialize, mutation, isProjectExcluded);
  const z = api.zod;
  const common = { decision: z.string().optional(), question: z.string().optional(), role: z.string().optional(), options: z.unknown().optional(), constraints: z.unknown().optional(), context: z.unknown().optional(), task: z.string().optional(), phase: z.string().optional() };
  api.registerTool({ name: "typesafe_prepare_advisor", label: "Prepare bound independent review", sourcePath: ADVISOR_HOST_SOURCE, approval: "read",
    description: "Prepare a server-owned task/parent review descriptor from the current approved contract and public evidence. Returns an executable real native task call, never semantic approval. The final dispatch is bound only when the actual native task executes.",
    parameters: z.object({ ...common, purpose: z.string().optional() }),
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      if (isProjectExcluded(context)) return projectExcludedResult();
      if (installationFailure) return hostUnavailable(installationFailure);
      if (params.purpose !== undefined && (typeof params.purpose !== "string" || !["consultation", "task_review", "parent_review"].includes(params.purpose))) return hostUnavailable("advisor_review_purpose_invalid");
      return prepareHostReview(api, services, params, context, params.purpose === "consultation" ? "consultation" : "task");
    },
  });
  api.registerTool({ name: "typesafe_advisor", label: "Independent native Advisor consultation", sourcePath: ADVISOR_HOST_SOURCE, approval: "read",
    description: "Obtain a genuine independent read-only native Advisor assessment. A first call returns a pending executable native task request; after the parent executes it, the applicable immutable receipt supplies the actual recommendation, options, findings, confidence, coverage and open questions. Consultation creates no todo or native authority.",
    parameters: z.object(common),
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      if (isProjectExcluded(context)) return projectExcludedResult();
      if (installationFailure) return hostUnavailable(installationFailure);
      return prepareHostReview(api, services, params, context, "consultation");
    },
  });
  return {
    todoReady,
    delegatedMutationScope(context) { return isProjectExcluded(context) ? Promise.resolve(undefined) : mutation?.scope(context) ?? Promise.resolve(undefined); },
    async settlement(token, context) {
      if (isProjectExcluded(context)) return undefined;
      const scope = advisorHub(api).roots.get(context.sessionManager);
      if (!scope?.active || scope.sessionId !== context.sessionManager.getSessionId() || scope.context.agent.id !== context.agent.id) return undefined;
      scope.context = hostContext(context, scope.epoch);
      return collectAdvisorHostSettlement(scope, token, request => {
        const receipt = scope.runtime.currentReceipt(request.requestId);
        if (!receipt || !hasSettledAdvisorHistory(scope, request, receipt)) return undefined;
        const review = Object.freeze({ request, receipt }); publishedHostReviews.set(review, scope); return review;
      });
    },
    prepareShadowReview(prepare, context) { return isProjectExcluded(context) ? Promise.resolve(projectExcludedResult()) : prepareHostShadowReview(api, services, prepare, context); },
    identity(context) {
      if (isProjectExcluded(context)) return undefined;
      const scope = advisorHub(api).roots.get(context.sessionManager);
      return scope?.active && scope.sessionId === context.sessionManager.getSessionId() && scope.context.agent.id === context.agent.id
        ? { sessionId: scope.sessionId, sessionEpoch: scope.epoch, parentAgentId: scope.context.agent.id } : undefined;
    },
    async reviews(context): Promise<readonly AdvisorHostReview[]> {
      if (isProjectExcluded(context)) return [];
      const scope = advisorHub(api).roots.get(context.sessionManager);
      if (!scope || !scope.active || scope.sessionId !== context.sessionManager.getSessionId()) return [];
      const view = hostContext(context, scope.epoch); const result: AdvisorHostReview[] = [];
      scope.context = view;
      for (const request of scope.requests.values()) {
        const receipt = scope.runtime.currentReceipt(request.requestId);
        if (receipt && hasSettledAdvisorHistory(scope, request, receipt) && await services.isCurrent(request, view)) {
          const review = Object.freeze({ request, receipt }); publishedHostReviews.set(review, scope); result.push(review);
        }
      }
      return result;
    },
    status(context) {
      if (isProjectExcluded(context)) return { status: "UNAVAILABLE", reasons: ["global-excluded: TypeSafe review authority is disabled; ordinary native Advisor remains available."] };
      if (installationFailure) return { status: "UNAVAILABLE", reasons: [installationFailure] };
      const unavailable = hostReadiness(api); if (unavailable) return unavailable;
      const scope = advisorHub(api).roots.get(context.sessionManager);
      return scope?.active ? { status: "available" } : { status: "UNAVAILABLE", reasons: ["advisor_actual_parent_session_not_initialized"] };
    },
  };
}
