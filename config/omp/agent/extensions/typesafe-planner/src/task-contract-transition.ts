import type { NativeTodoOperation, ProjectedNativePhase } from "./types/verification";
import { nonempty } from "./task-contract-source";

import { normalizeNativeTodoInput, type NormalizedNativeTodoInput } from "./task-contract-input";
export { normalizeNativeTodoInput, nativeTodoInputDigest } from "./task-contract-input";
export type { NativeTodoOperation, NativeTodoInputNormalization, NormalizedNativeTodoInput, NativeTodoInitPhaseInput } from "./task-contract-input";
export type NativeTodoTransitionValidation =
  | { valid: true; operation: NativeTodoOperation; observationOnly: boolean; phases: ProjectedNativePhase[] }
  | { valid: false; reason: string };
interface NativeInitEntry { phase?: unknown; items?: unknown }

function operationFromNormalizedInput(input: NormalizedNativeTodoInput, before?: readonly ProjectedNativePhase[]): NativeTodoOperation | undefined {
  return input.op ?? (input.list?.length ? "init" : input.items?.length ? nonempty(input.phase) ? "append" : !before?.length ? "init" : undefined : undefined);
}

export function readNativeTodoOperation(raw: unknown, before?: readonly ProjectedNativePhase[]): NativeTodoOperation | undefined {
  const normalized = normalizeNativeTodoInput(raw);
  return normalized.valid ? operationFromNormalizedInput(normalized.input, before) : undefined;
}

/** Owned sanitized copy of actual details.phases; no native schema extensions. */
export function parseNativeTodoPhases(raw: unknown): ProjectedNativePhase[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const phases: ProjectedNativePhase[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") return undefined;
    const phase = value as ProjectedNativePhase;
    if (!nonempty(phase.name) || !Array.isArray(phase.tasks)) return undefined;
    const tasks: ProjectedNativePhase["tasks"] = [];
    for (const task of phase.tasks) {
      if (!task || !nonempty(task.content) || !["pending", "in_progress", "completed", "blocked", "abandoned"].includes(task.status)
        || (task.blocker !== undefined && typeof task.blocker !== "string")) return undefined;
      tasks.push({ content: task.content, status: task.status, ...(task.blocker !== undefined ? { blocker: task.blocker } : {}) });
    }
    phases.push({ name: phase.name, tasks });
  }
  return phases;
}

/** Native v18.12.3 todo.ts normalizeInProgressTask; view does not call this. */
export function normalizeNativeTodoPointer(phases: ProjectedNativePhase[]): void {
  let active = false;
  let pending: ProjectedNativePhase["tasks"][number] | undefined;
  for (const phase of phases) for (const task of phase.tasks) {
    if (task.status === "in_progress") {
      if (active) task.status = "pending";
      else active = true;
    }
    if (!pending && task.status === "pending") pending = task;
  }
  if (!active && pending) pending.status = "in_progress";
}

/**
 * Exact native operation effects, including the documented automatic pointer only.
 * Source: https://github.com/can1357/oh-my-pi/blob/v18.12.3/packages/coding-agent/src/tools/todo.ts
 * This validates lifecycle facts, never host permission or semantic completion.
 */
export function validateNativeTodoTransition(
  before: readonly ProjectedNativePhase[] | undefined, rawInput: unknown, rawAfter: unknown, rawDetails: unknown,
): NativeTodoTransitionValidation {
  const normalized = normalizeNativeTodoInput(rawInput);
  if (!normalized.valid) return normalized;
  const input = normalized.input;
  const operation = operationFromNormalizedInput(input, before);
  const phases = parseNativeTodoPhases(rawAfter);
  const details = rawDetails && typeof rawDetails === "object" ? rawDetails as { op?: unknown; completedTasks?: unknown } : undefined;
  if (!operation || !phases || details?.op !== operation || (details.completedTasks !== undefined && !Array.isArray(details.completedTasks))) {
    return { valid: false, reason: "native_transition_malformed" };
  }
  if (operation === "view") return { valid: true, operation, observationOnly: true, phases };
  let expected: ProjectedNativePhase[];
  if (operation === "init") {
    const list = input.list ?? (Array.isArray(input.items) && input.items.length ? [{ phase: input.phase ?? "Tasks", items: input.items }] : undefined);
    if (!Array.isArray(list)) return { valid: false, reason: "native_init_list_required" };
    expected = [];
    const names = new Set<string>();
    const contents = new Set<string>();
    for (const raw of list) {
      if (!raw || typeof raw !== "object") return { valid: false, reason: "native_init_list_malformed" };
      const item = raw as NativeInitEntry;
      if (!nonempty(item.phase) || names.has(item.phase) || !Array.isArray(item.items) || !item.items.length
        || !item.items.every(nonempty)) return { valid: false, reason: "native_init_list_malformed" };
      names.add(item.phase);
      const tasks: ProjectedNativePhase["tasks"] = [];
      for (const content of item.items) {
        if (contents.has(content)) return { valid: false, reason: "native_init_duplicate_content" };
        contents.add(content);
        tasks.push({ content, status: "pending" });
      }
      expected.push({ name: item.phase, tasks });
    }
  } else {
    const snapshot = parseNativeTodoPhases(before);
    if (!snapshot) return { valid: false, reason: "native_before_state_required" };
    expected = snapshot;
    if (operation === "append") {
      if (!nonempty(input.phase) || !Array.isArray(input.items) || !input.items.length || !input.items.every(nonempty)) {
        return { valid: false, reason: "native_append_target_required" };
      }
      const contents = new Set(expected.flatMap((phase) => phase.tasks.map((task) => task.content)));
      for (const content of input.items) {
        if (contents.has(content)) return { valid: false, reason: "native_append_duplicate_content" };
        contents.add(content);
      }
      let phase = expected.find((candidate) => candidate.name === input.phase);
      if (!phase) { phase = { name: input.phase, tasks: [] }; expected.push(phase); }
      for (const content of input.items) phase.tasks.push({ content, status: "pending" });
    } else {
      const targets: ProjectedNativePhase["tasks"] = [];
      if (nonempty(input.task)) {
        const phase = expected.find((candidate) => candidate.tasks.some((task) => task.content === input.task));
        const task = phase?.tasks.find((candidate) => candidate.content === input.task);
        if (!task || (nonempty(input.phase) && phase?.name !== input.phase)) return { valid: false, reason: "native_target_missing_or_mismatched" };
        targets.push(task);
      } else if (nonempty(input.phase)) {
        const phase = expected.find((candidate) => candidate.name === input.phase);
        if (!phase) return { valid: false, reason: "native_target_missing_or_mismatched" };
        targets.push(...phase.tasks);
      } else {
        if (["start", "block", "unblock"].includes(operation)) return { valid: false, reason: "native_target_required" };
        for (const phase of expected) targets.push(...phase.tasks);
      }
      if (operation === "start" && !nonempty(input.task)) return { valid: false, reason: "native_start_task_required" };
      const selected = new Set(targets);
      if (operation === "rm") {
        for (const phase of expected) phase.tasks = phase.tasks.filter((task) => !selected.has(task));
      } else {
        if (operation === "start") for (const phase of expected) for (const task of phase.tasks) {
          if (task.status === "in_progress" && !selected.has(task)) task.status = "pending";
        }
        for (const task of targets) {
          if (operation === "start") task.status = "in_progress";
          else if (operation === "done") task.status = "completed";
          else if (operation === "drop") task.status = "abandoned";
          else if (operation === "block" && ["pending", "in_progress", "blocked"].includes(task.status)) {
            task.status = "blocked";
            task.blocker = typeof input.reason === "string" ? input.reason.replace(/\s+/g, " ").trim() || undefined : undefined;
          } else if (operation === "unblock" && task.status === "blocked") { task.status = "pending"; task.blocker = undefined; }
        }
      }
    }
  }
  normalizeNativeTodoPointer(expected);
  if (phases.length !== expected.length || expected.some((phase, index) => phase.name !== phases[index].name
    || phase.tasks.length !== phases[index].tasks.length || phase.tasks.some((task, ordinal) => {
      const actual = phases[index].tasks[ordinal];
      return actual.content !== task.content || actual.status !== task.status || actual.blocker !== task.blocker;
    }))) return { valid: false, reason: "native_target_or_unrelated_effect_mismatch" };
  const previousStatuses = new Map<string, string>();
  for (const phase of before ?? []) for (const task of phase.tasks) previousStatuses.set(JSON.stringify([phase.name, task.content]), task.status);
  const completed = expected.flatMap((phase) => phase.tasks.flatMap((task) => {
    const previous = previousStatuses.get(JSON.stringify([phase.name, task.content]));
    return task.status === "completed" && previous && previous !== "completed" ? [{ phase: phase.name, content: task.content }] : [];
  }));
  const reported = details.completedTasks ?? [];
  if (!Array.isArray(reported) || reported.length !== completed.length || completed.some((task, index) => {
    const raw = reported[index];
    return !raw || typeof raw !== "object" || !("phase" in raw) || raw.phase !== task.phase || !("content" in raw) || raw.content !== task.content;
  })) return { valid: false, reason: "native_completion_transition_mismatch" };
  return { valid: true, operation, observationOnly: false, phases };
}
