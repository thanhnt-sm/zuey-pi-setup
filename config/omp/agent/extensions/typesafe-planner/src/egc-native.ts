import { createHash } from "node:crypto";
import { assertEgcIdentity, boundedEgcJson } from "./egc-safety";
import type { ProjectedNativePhase } from "./types/verification";
import { nativeTodoInputDigest, normalizeNativeTodoInput, readNativeTodoOperation, validateNativeTodoTransition } from "./task-contract-transition";
import { canonicalDigest } from "./task-contract-source";

export function egcRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
export interface NativeTarget {
  key: string; phase: string; phaseOrdinal: number; content: string; ordinal: number;
  incarnation: string; status: string; completionCall?: string;
}
export interface NativeProjection {
  targets: NativeTarget[];
  incarnations: Map<string, NativeTarget>;
  calls: Map<string, { name: string; input: unknown; entry: string }>;
  settledCalls: Set<string>;
  nativePhases: readonly ProjectedNativePhase[] | undefined;
}
export function egcInputDigest(input: unknown): string {
  return nativeTodoInputDigest(boundedEgcJson(input));
}
export function todoOperations(input: unknown, before?: readonly ProjectedNativePhase[]): Record<string, unknown>[] {
  const normalized = normalizeNativeTodoInput(boundedEgcJson(input));
  if (!normalized.valid) throw new Error("egc_invalid_todo_input");
  const operation = readNativeTodoOperation(normalized.input, before);
  if (!operation) throw new Error("egc_invalid_todo_input");
  return [{ ...normalized.input, op: operation }];
}
export function selectNativeTargets(targets: NativeTarget[], operation: Record<string, unknown>): NativeTarget[] {
  return targets.filter((target) => (typeof operation.task !== "string" || target.content === operation.task)
    && (typeof operation.phase !== "string" || target.phase === operation.phase));
}
/** Only host history assistant-call/result pairs can establish native incarnations/effects. */
export function projectEgcNativeHistory(entries: readonly unknown[]): NativeProjection {
  const calls: NativeProjection["calls"] = new Map();
  const incarnations = new Map<string, NativeTarget>();
  let targets: NativeTarget[] = [];
  const consumed = new Set<string>();
  const duplicateCalls = new Set<string>();
  const settledCalls = new Set<string>();
  let lastAcceptedPhases: readonly ProjectedNativePhase[] | undefined;
  for (const raw of entries) {
    const entry = egcRecord(raw), message = egcRecord(entry.message ?? entry);
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const blockRaw of message.content) {
        const block = egcRecord(blockRaw);
        if (block.type === "toolCall" && typeof block.id === "string" && (block.name === "todo" || block.name === "todo_write") && typeof entry.id === "string") {
          if (calls.has(block.id) || duplicateCalls.has(block.id)) { calls.delete(block.id); duplicateCalls.add(block.id); }
          else calls.set(block.id, { name: block.name, input: block.arguments, entry: entry.id });
        }
      }
    }
    if (message.role === "toolResult" && typeof message.toolCallId === "string" && calls.get(message.toolCallId)?.name === message.toolName) settledCalls.add(message.toolCallId);
    if (message.role !== "toolResult" || message.isError !== false || typeof message.toolCallId !== "string" || consumed.has(message.toolCallId)) continue;
    const call = calls.get(message.toolCallId), details = egcRecord(message.details);
    if (!call || message.toolName !== call.name || !Array.isArray(details.phases)) continue;
    const transition = validateNativeTodoTransition(lastAcceptedPhases, call.input, details.phases, details);
    if (!transition.valid || transition.observationOnly) continue;
    const acceptedPhases = transition.phases;
    const next: NativeTarget[] = [];
    let valid = true;
    const completedTasks = Array.isArray(details.completedTasks) ? details.completedTasks.map(egcRecord) : [];
    for (const [phaseOrdinal, phase] of acceptedPhases.entries()) {
      for (const [ordinal, task] of phase.tasks.entries()) {
        // Native init/append prohibit duplicate content. Unrelated removals may shift positions.
        const previous = targets.find((target) => target.phase === phase.name && target.content === task.content);
        const creating = transition.operation === "init" || transition.operation === "append" && !previous;
        if (!previous && !creating) { valid = false; break; }
        const incarnation = creating || !previous ? `${call.entry}:${message.toolCallId}:${phaseOrdinal}:${ordinal}` : previous.incarnation;
        const key = !creating && previous ? previous.key
          : createHash("sha256").update(JSON.stringify([phase.name, phaseOrdinal, task.content, ordinal, incarnation])).digest("hex").replace(/(.{16})(?=.)/g, "$1:");
        const done = previous && previous.status !== "completed" && task.status === "completed" && transition.operation === "done"
          && completedTasks.some((item) => item.phase === phase.name && item.content === task.content);
        next.push({ key, phase: phase.name, phaseOrdinal, content: task.content, ordinal, incarnation, status: task.status,
          ...(done ? { completionCall: message.toolCallId } : previous?.completionCall ? { completionCall: previous.completionCall } : {}) });
      }
    }
    if (valid) {
      targets = next;
      lastAcceptedPhases = acceptedPhases;
      for (const target of next) incarnations.set(target.key, target);
      consumed.add(message.toolCallId);
    }
  }
  return { targets, incarnations, calls, settledCalls, nativePhases: lastAcceptedPhases };
}
/** tool_result may be delivered before its history entry is appended; the original call still must exist. */
export function egcHistoryWithResult(entries: readonly unknown[], event: unknown): readonly unknown[] {
  const result = egcRecord(event);
  if (typeof result.toolCallId !== "string" || typeof result.toolName !== "string" || !TODO_TOOL_NAMES[result.toolName]) return entries;
  const present = entries.some((raw) => { const entry = egcRecord(raw), message = egcRecord(entry.message ?? entry); return message.role === "toolResult" && message.toolCallId === result.toolCallId; });
  return present ? entries : [...entries, { message: { role: "toolResult", toolName: result.toolName, toolCallId: result.toolCallId, isError: result.isError, details: result.details } }];
}
const TODO_TOOL_NAMES: Record<string, true> = { todo: true, todo_write: true };
export interface EgcDebt extends NativeTarget {
  assessment: "unassessed" | "ready" | "rejected" | "unavailable";
  lifecycle: "open" | "completed" | "blocked" | "stalled";
  attempts: number; best: number; fp: string; stalls: number; passFp: string; note: string;
}
interface Pending { name: string; digest: string; generation: number; targets: string[]; }
/** READY is supporting evidence; only the exact real native semantic result commits. */
export class EgcNativeLedger {
  readonly debts = new Map<string, EgcDebt>();
  private pending = new Map<string, Pending>();
  private generation = 0;
  reconcile(entries: readonly unknown[], restored?: unknown): void {
    this.generation++; this.pending.clear();
    const projection = projectEgcNativeHistory(entries), prior = new Map(this.debts);
    this.debts.clear();
    let persisted: Record<string, unknown>[] = [];
    for (const raw of entries) {
      const entry = egcRecord(raw), data = egcRecord(entry.data);
      if (entry.type === "custom" && entry.customType === "egc-ledger" && Array.isArray(data.tasks)) persisted = data.tasks.map(egcRecord);
    }
    if (Array.isArray(restored)) for (const value of restored) {
      const item = egcRecord(value);
      if (typeof item.key !== "string" || typeof item.incarnation !== "string") continue;
      const target = projection.incarnations.get(item.key);
      if (!target || target.incarnation !== item.incarnation) continue;
      const origin = prior.get(target.key)?.lifecycle === "completed" || persisted.some((saved) => saved.key === target.key
        && saved.incarnation === target.incarnation && saved.lifecycle === "completed" && saved.completionCall === item.completionCall && saved.passFp === item.passFp);
      const completed = origin && item.lifecycle === "completed" && typeof item.completionCall === "string"
        && target.completionCall === item.completionCall && typeof item.passFp === "string" && item.passFp.length > 0;
      prior.set(target.key, { ...target, assessment: item.assessment === "rejected" || item.assessment === "unavailable" ? item.assessment : "unassessed",
        lifecycle: completed ? "completed" : item.lifecycle === "blocked" || item.lifecycle === "stalled" ? item.lifecycle : "open",
        attempts: typeof item.attempts === "number" ? item.attempts : 0, best: typeof item.best === "number" ? item.best : 1e9,
        fp: typeof item.fp === "string" ? item.fp : "", stalls: typeof item.stalls === "number" ? item.stalls : 0,
        passFp: completed && typeof item.passFp === "string" ? item.passFp : "", note: typeof item.note === "string" ? item.note : "" });
    }
    for (const target of projection.incarnations.values()) {
      assertEgcIdentity(target.content);
      const previous = prior.get(target.key);
      const debt: EgcDebt = { lifecycle: "open", attempts: 0, best: 1e9, fp: "", stalls: 0, note: "", ...previous,
        ...target, assessment: previous?.assessment === "rejected" || previous?.assessment === "unavailable" ? previous.assessment : "unassessed",
        passFp: previous?.lifecycle === "completed" ? previous.passFp : "" };
      if (previous?.lifecycle === "completed" && target.status === "completed" && target.completionCall === previous.completionCall) debt.lifecycle = "completed";
      else if (debt.lifecycle === "completed") { debt.lifecycle = "open"; debt.passFp = ""; }
      this.debts.set(target.key, debt);
    }
  }
  stage(callId: string, name: string, input: unknown, targets: EgcDebt[], entries: readonly unknown[]): void {
    const projection = projectEgcNativeHistory(entries), original = projection.calls.get(callId);
    if (!original || original.name !== name || projection.settledCalls.has(callId) || egcInputDigest(original.input) !== egcInputDigest(input)) throw new Error("egc_stage_original_call_required");
    if (!callId || this.pending.has(callId) || !targets.length || targets.some((target) => this.debts.get(target.key) !== target || target.assessment !== "ready" || target.lifecycle !== "open" || !target.passFp)) throw new Error("egc_stage_unavailable");
    this.pending.set(callId, { name, digest: egcInputDigest(input), generation: this.generation, targets: targets.map((target) => target.key) });
  }
  commit(event: unknown, entries: readonly unknown[]): boolean {
    const result = egcRecord(event), id = result.toolCallId;
    if (typeof id !== "string") return false;
    const pending = this.pending.get(id);
    this.pending.delete(id);
    const refuse = () => {
      if (pending) for (const key of pending.targets) {
        const debt = this.debts.get(key);
        if (debt?.assessment === "ready") { debt.assessment = "unassessed"; debt.passFp = ""; }
      }
      return false;
    };
    if (!pending || pending.generation !== this.generation || result.toolName !== pending.name || result.isError !== false) return refuse();
    const history = egcHistoryWithResult(entries, result);
    const projection = projectEgcNativeHistory(history), call = projection.calls.get(id);
    if (!call || call.name !== pending.name || egcInputDigest(call.input) !== pending.digest) return refuse();
    if (result.input !== undefined && egcInputDigest(result.input) !== pending.digest) return refuse();
    const details = egcRecord(result.details), completed = Array.isArray(details.completedTasks) ? details.completedTasks.map(egcRecord) : [];
    const historyResult = history.map(egcRecord).map((entry) => egcRecord(entry.message ?? entry))
      .find((message) => message.role === "toolResult" && message.toolCallId === id && message.toolName === pending.name && message.isError === false);
    if (!historyResult || canonicalDigest(boundedEgcJson(historyResult.details)) !== canonicalDigest(boundedEgcJson(details))) return refuse();
    if (!Array.isArray(details.phases)) return refuse();
    const matched = pending.targets.map((key) => {
      const debt = this.debts.get(key), native = projection.targets.find((target) => target.key === key);
      return debt && debt.lifecycle === "open" && debt.assessment === "ready" && native?.completionCall === id
        && native.status === "completed" && completed.some((item) => item.phase === debt.phase && item.content === debt.content) ? { debt, native } : null;
    });
    if (!matched.length || matched.some((match) => !match)) return refuse();
    for (const match of matched) if (match) { match.debt.lifecycle = "completed"; match.debt.completionCall = id; match.debt.status = "completed"; }
    return true;
  }
  revoke(): void {
    this.generation++; this.pending.clear();
    for (const debt of this.debts.values()) if (debt.lifecycle !== "completed") {
      if (debt.assessment === "ready") debt.assessment = "unassessed";
      debt.passFp = "";
    }
  }
}
