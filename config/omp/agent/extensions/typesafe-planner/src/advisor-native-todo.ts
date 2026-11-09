import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import { normalizeNativeTodoInput } from "./task-contract-input";
import { hostContext } from "./advisor-host-state";
import { hostUnavailable } from "./advisor-host-dispatch";
import type { AdvisorHostExecuteContext, AdvisorNativeTodoServices } from "./advisor-host-types";

/** The real execute boundary, after every tool_call middleware revision. Never retain invokeTool. */
export async function executeAdvisorNativeTodo(services: AdvisorNativeTodoServices, ready: boolean, epoch: string | undefined, actualCallId: string,
  params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: ((update: unknown) => void) | undefined, context: AdvisorHostExecuteContext): Promise<unknown> {
  if (!context.invokeTool) return hostUnavailable("native_todo_same_tool_invokeTool_required");
  const observed = freezeContractValue(structuredClone(params));
  const original = normalizeNativeTodoInput(observed);
  if (!original.valid) return hostUnavailable(original.reason);
  const view = original.input.op === "view" || original.input.op === undefined && !original.input.list?.length && !original.input.items?.length;
  if (!ready || !epoch) return view ? context.invokeTool(freezeContractValue(structuredClone(original.input)), { signal, onUpdate }) : hostUnavailable("native_todo_owned_schema_and_execute_guard_required");
  if (typeof services.beforeExecute !== "function" || typeof services.afterExecute !== "function") return hostUnavailable("native_todo_sealed_preflight_and_core_observer_required");
  const viewContext = hostContext(context, epoch);
  const prepared = await services.beforeExecute(observed, viewContext, actualCallId, signal);
  if (prepared.status !== "READY") {
    const outcome = freezeContractValue(structuredClone(prepared));
    return { isError: true, content: [{ type: "text", text: JSON.stringify(outcome) }], details: outcome };
  }
  const normalized = normalizeNativeTodoInput(structuredClone(prepared.input));
  if (!normalized.valid || canonicalDigest(normalized.input) !== canonicalDigest(prepared.input)
    || canonicalDigest(normalized.input) !== canonicalDigest(original.input)) return hostUnavailable("native_todo_owned_normalized_input_mismatch");
  const input = freezeContractValue(structuredClone(normalized.input));
  if (signal?.aborted) return hostUnavailable("native_todo_aborted_before_core_execution");
  const result = await context.invokeTool(input, { signal, onUpdate });
  await services.afterExecute(input, viewContext, actualCallId, result);
  return result;
}
