import type {
  CreationProvenance, NativeHistoryFailure, NativeHistorySuccess, NativeHistoryTargetTransition,
  NativeIncarnationReference, NativeLifecycleStatus, ProjectedNativePhase,
} from "./types/verification";
import { canonicalDigest, nonempty } from "./task-contract-source";
import { nativeTodoInputDigest, normalizeNativeTodoInput, readNativeTodoOperation, validateNativeTodoTransition,
  type NativeTodoOperation, type NormalizedNativeTodoInput } from "./task-contract-transition";

export interface NativeProjectionState {
  nativePhases: ProjectedNativePhase[] | undefined;
  nativeStateEntryId?: string;
  nativeStateReliable: boolean;
  incarnations: NativeIncarnationReference[];
}

export interface NativeCallSnapshot {
  id: string;
  entryId: string;
  input: NormalizedNativeTodoInput;
  operation?: NativeTodoOperation;
  inputDigest: string;
  reliable: boolean;
  stateEntryId?: string;
  targets: Array<{ reference: NativeIncarnationReference; status: NativeLifecycleStatus }>;
  used: boolean;
}

export function captureNativeCall(id: string, entryId: string, input: Record<string, unknown>, state: NativeProjectionState): NativeCallSnapshot | undefined {
  const normalized = normalizeNativeTodoInput(input);
  if (!normalized.valid) return undefined;
  const operation = readNativeTodoOperation(normalized.input, state.nativePhases);
  return { id, entryId, input: normalized.input, operation, inputDigest: nativeTodoInputDigest(normalized.input), reliable: state.nativeStateReliable,
    stateEntryId: state.nativeStateEntryId, used: false,
    targets: state.incarnations.flatMap((reference) => {
      const status = state.nativePhases?.[reference.target.phaseOrdinal]?.tasks[reference.target.ordinal]?.status;
      return status ? [{ reference, status }] : [];
    }) };
}


/** Receives only a unique, genuine, matched host call/result pair from the branch adapter. */
export function applyNativeResult(
  state: NativeProjectionState,
  call: NativeCallSnapshot,
  result: { entryId: string; isError: unknown; details: unknown },
  origin: Pick<CreationProvenance, "sessionId" | "branchId">,
): { success?: NativeHistorySuccess; failure?: NativeHistoryFailure; reason?: string } {
  const operation = call.operation;
  const provenance = { callId: call.id, callEntryId: call.entryId, resultEntryId: result.entryId, inputDigest: call.inputDigest };
  if (result.isError === true) {
    const input = call.input;
    if (!operation || !["done", "drop", "rm", "start", "block", "unblock"].includes(operation)
      || (!nonempty(input.task) && !nonempty(input.phase)) || !call.reliable || !state.nativeStateReliable) return {};
    const targets: NativeHistoryTargetTransition[] = call.targets.flatMap(({ reference, status }) => {
      const after = state.incarnations.find((current) => current.incarnationId === reference.incarnationId);
      const afterStatus = after && state.nativePhases?.[after.target.phaseOrdinal]?.tasks[after.target.ordinal]?.status;
      if (!reference.creationKnown || !after || !afterStatus || status === "completed" || status === "abandoned"
        || afterStatus === "completed" || afterStatus === "abandoned"
        || (nonempty(input.task) && reference.target.content !== input.task)
        || (nonempty(input.phase) && reference.target.phase !== input.phase)) return [];
      return [{ before: reference, after, beforeStatus: status, afterStatus, completionReported: false }];
    });
    return targets.length ? { failure: { ...provenance, outcome: "native_failure", operation, classification: "unclassified-native-failure", targets } } : {};
  }
  if (result.isError !== false && result.isError !== undefined) { state.nativeStateReliable = false; return { reason: "native_result_error_flag_malformed" }; }
  if (call.stateEntryId !== state.nativeStateEntryId || call.reliable !== state.nativeStateReliable) {
    return { reason: "native_result_state_revised" };
  }
  const details = result.details as { op?: unknown; phases?: unknown; completedTasks?: unknown } | undefined;
  const validation = validateNativeTodoTransition(state.nativePhases, call.input, details?.phases, result.details);
  if (!validation.valid || validation.operation !== operation) {
    state.nativeStateReliable = false;
    return { reason: validation.valid ? "native_call_operation_revised" : validation.reason };
  }
  const phases = validation.phases;
  const previous = state.incarnations;
  const next: NativeIncarnationReference[] = [];
  phases.forEach((phase, phaseOrdinal) => phase.tasks.forEach((task, ordinal) => {
    const target = { phase: phase.name, phaseOrdinal, content: task.content, ordinal };
    const existing = previous.find((reference) => reference.target.phaseOrdinal === phaseOrdinal && reference.target.ordinal === ordinal
      && reference.target.phase === phase.name && reference.target.content === task.content);
    const oldStatus = state.nativePhases?.[phaseOrdinal]?.tasks[ordinal]?.status;
    const reappended = operation === "append" && (oldStatus === "abandoned" || oldStatus === "completed")
      && task.status !== "abandoned" && task.status !== "completed";
    const oldDuplicates = previous.filter((reference) => reference.target.phase === phase.name
      && reference.target.phaseOrdinal === phaseOrdinal && reference.target.content === task.content).length;
    const newDuplicates = phase.tasks.filter((candidate) => candidate.content === task.content).length;
    const ambiguousRemoval = operation === "rm" && oldDuplicates > 1 && newDuplicates < oldDuplicates;
    const ambiguousObservation = operation === "view" && oldDuplicates !== newDuplicates && (oldDuplicates > 1 || newDuplicates > 1);
    if (existing && state.nativeStateReliable && operation !== "init" && !reappended && !ambiguousRemoval && !ambiguousObservation) next.push(existing);
    else {
      const creation = { ...origin, entryId: result.entryId, callId: call.id };
      const items = Array.isArray(call.input.items) ? call.input.items : [];
      const appendedIndex = ordinal - (phase.tasks.length - items.length);
      const appended = operation === "append" && call.input.phase === phase.name && appendedIndex >= 0 && items[appendedIndex] === task.content;
      next.push({ target, creation, incarnationId: canonicalDigest({ creation, target }), creationKnown: operation === "init" || appended });
    }
  }));
  const completed = Array.isArray(details?.completedTasks) ? details.completedTasks : [];
  const targets: NativeHistoryTargetTransition[] = next.map((after) => {
    const before = call.targets.find((snapshot) => snapshot.reference.incarnationId === after.incarnationId);
    const completionReported = operation === "done" && completed.some((item) => item && typeof item === "object"
      && item.phase === after.target.phase && item.content === after.target.content)
      && (!nonempty(call.input.task) || call.input.task === after.target.content)
      && (!nonempty(call.input.phase) || call.input.phase === after.target.phase);
    return { before: before?.reference, after, beforeStatus: before?.status,
      afterStatus: phases[after.target.phaseOrdinal].tasks[after.target.ordinal].status, completionReported };
  });
  for (const before of call.targets) {
    if (!next.some((after) => after.incarnationId === before.reference.incarnationId)) {
      targets.push({ before: before.reference, beforeStatus: before.status, completionReported: false });
    }
  }
  state.nativePhases = phases;
  state.nativeStateEntryId = result.entryId;
  state.nativeStateReliable = true;
  state.incarnations = next;
  return { success: { ...provenance, outcome: "native_success", operation, targets } };
}
