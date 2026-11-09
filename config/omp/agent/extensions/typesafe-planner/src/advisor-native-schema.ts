import { record, advisorOutputSchema } from "./advisor-protocol";
import { ADVISOR_NATIVE_CONTEXT, ADVISOR_SOLUTION_SPACE } from "./advisor-native-prompt";
import type { AdvisorHostAPI, AdvisorRequestDraft } from "./advisor-host-types";
export type AdvisorNativeTaskShape = "batch" | "flat";
export interface AdvisorNativeTaskCapabilities { shape: AdvisorNativeTaskShape; disableIsolation: boolean; namedChild: boolean }
/** omp/18.12.3 omptype Type.toJsonSchema + task/types.ts dynamic batch/structured fields. */
export function advisorNativeTaskCapabilities(api: AdvisorHostAPI): AdvisorNativeTaskCapabilities | undefined {
  const original = api.getAllTools().find(tool => tool.name === "task")?.parameters;
  let schema: unknown = original;
  if ((typeof original === "function" || record(original)) && typeof Reflect.get(original, "toJsonSchema") === "function") schema = Reflect.apply(Reflect.get(original, "toJsonSchema"), original, []);
  if (!record(schema) || !record(schema.properties)) return undefined;
  const properties = schema.properties;
  const item = record(properties.tasks) && record(properties.tasks.items) && record(properties.tasks.items.properties) ? properties.tasks.items.properties : properties;
  if (!Object.hasOwn(item, "task") || !Object.hasOwn(item, "agent") || !Object.hasOwn(item, "outputSchema") || !Object.hasOwn(item, "schemaMode")) return undefined;
  const shape = Object.hasOwn(properties, "tasks") && Object.hasOwn(properties, "context") ? "batch" : Object.hasOwn(properties, "task") ? "flat" : undefined;
  return shape ? { shape, disableIsolation: Object.hasOwn(item, "isolated"), namedChild: Object.hasOwn(item, "name") } : undefined;
}
export function advisorNativeParameters(draft: AdvisorRequestDraft, shape: AdvisorNativeTaskShape, disableIsolation = false): Record<string, unknown> {
  const item = { agent: draft.agent, task: draft.publicPrompt, solutionSpace: ADVISOR_SOLUTION_SPACE, outputSchema: advisorOutputSchema, schemaMode: "strict", ...(disableIsolation ? { isolated: false } : {}) };
  return shape === "batch" ? { context: ADVISOR_NATIVE_CONTEXT, tasks: [item] } : item;
}
export function validAdvisorNativeControls(params: Record<string, unknown>, item: Record<string, unknown>, shape: AdvisorNativeTaskShape, requireNonIsolation = false): boolean {
  const keys = ["agent", "task", "solutionSpace", "outputSchema", "schemaMode", "isolated"];
  return item.solutionSpace === ADVISOR_SOLUTION_SPACE && (item.isolated === undefined || item.isolated === false) && (!requireNonIsolation || item.isolated === false) && Object.keys(item).every(key => keys.includes(key))
    && (shape === "flat" ? !Array.isArray(params.tasks) && Object.keys(params).every(key => keys.includes(key))
      : params.context === ADVISOR_NATIVE_CONTEXT && Array.isArray(params.tasks) && params.tasks.length === 1 && Object.keys(params).every(key => ["context", "tasks"].includes(key)));
}
