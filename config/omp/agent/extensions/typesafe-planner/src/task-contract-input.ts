import type { NativeTodoOperation } from "./types/verification";
import { canonicalDigest } from "./task-contract-source";

export type { NativeTodoOperation } from "./types/verification";
export interface NativeTodoInitPhaseInput { phase: string; items: string[] }
export type NormalizedNativeTodoInput = {
  op?: NativeTodoOperation;
  list?: NativeTodoInitPhaseInput[];
  items?: string[];
  task?: string;
  phase?: string;
  reason?: string;
};
export type NativeTodoInputNormalization =
  | { valid: true; input: NormalizedNativeTodoInput }
  | { valid: false; reason: string };
interface NativeTodoWireInput { op?: unknown; list?: unknown; items?: unknown; task?: unknown; phase?: unknown; reason?: unknown }
interface NativeInitWireEntry { phase?: unknown; items?: unknown }

/** Actual host wire uses null for absent optionals and i for transport intent. */
export function normalizeNativeTodoInput(raw: unknown): NativeTodoInputNormalization {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { valid: false, reason: "native_input_malformed" };
  if ("ops" in raw) return { valid: false, reason: "native_ops_unsupported" };
  if (Object.keys(raw).some((key) => !["op", "list", "items", "task", "phase", "reason", "i"].includes(key))) {
    return { valid: false, reason: "native_input_field_unsupported" };
  }
  const wire = raw as NativeTodoWireInput;
  const input: NormalizedNativeTodoInput = {};
  if (wire.op !== undefined) {
    if (typeof wire.op !== "string" || !["init", "append", "view", "done", "drop", "rm", "start", "block", "unblock"].includes(wire.op)) {
      return { valid: false, reason: "native_operation_invalid" };
    }
    input.op = wire.op as NativeTodoOperation;
  }
  for (const field of ["task", "phase", "reason"] as const) {
    const value = wire[field];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string") return { valid: false, reason: "native_input_optional_malformed" };
    input[field] = value;
  }
  if (wire.items !== null && wire.items !== undefined) {
    if (!Array.isArray(wire.items) || !wire.items.every((item): item is string => typeof item === "string")) {
      return { valid: false, reason: "native_items_malformed" };
    }
    input.items = wire.items.slice();
  }
  if (wire.list !== null && wire.list !== undefined) {
    if (!Array.isArray(wire.list)) return { valid: false, reason: "native_list_malformed" };
    input.list = [];
    for (const rawEntry of wire.list) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)
        || Object.keys(rawEntry).some((key) => key !== "phase" && key !== "items")) return { valid: false, reason: "native_list_malformed" };
      const entry = rawEntry as NativeInitWireEntry;
      if (typeof entry.phase !== "string" || !Array.isArray(entry.items) || !entry.items.length
        || !entry.items.every((item): item is string => typeof item === "string")) return { valid: false, reason: "native_list_malformed" };
      input.list.push({ phase: entry.phase, items: entry.items.slice() });
    }
  }
  return { valid: true, input };
}

export function nativeTodoInputDigest(raw: unknown): string {
  const normalized = normalizeNativeTodoInput(raw);
  if (!normalized.valid) throw new Error(normalized.reason);
  return canonicalDigest(normalized.input);
}
