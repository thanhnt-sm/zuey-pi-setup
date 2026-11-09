import { canonicalDigest, freezeContractValue, nonempty } from "./task-contract-source";
import { readHostBranch, originalTodoInput } from "./host-history";
import { nativeTodoInputDigest, normalizeNativeTodoInput, parseNativeTodoPhases, validateNativeTodoTransition } from "./task-contract-transition";
import type { NativeTaskVerificationStage, TaskNativeCommit, TaskNativeObservation, TaskReviewState, TaskVerificationRuntimeOptions } from "./task-verification-types";

interface NativeExercise { callId: string; inputDigest: string; beforeDigest: string; effectDigest: string }
export interface NativeStageRecord {
  review: TaskReviewState; contextKey: string; consumed: boolean; receiptId: string; bindingDigest: string; exercise?: NativeExercise;
}
export interface NativeStageRegistry {
  issue(context: unknown, review: TaskReviewState): NativeTaskVerificationStage;
  observe(context: unknown, stages: readonly NativeTaskVerificationStage[], native: TaskNativeObservation): void;
  commit(context: unknown, stages: readonly NativeTaskVerificationStage[], native: TaskNativeCommit): Promise<boolean>;
  invalidate(contextKey: string): void;
}
function observedEffect(native: TaskNativeObservation | TaskNativeCommit): NativeExercise | undefined {
  const details = native.details && typeof native.details === "object" ? native.details as Record<string, unknown> : undefined;
  const before = parseNativeTodoPhases(native.before);
  const transition = validateNativeTodoTransition(before, native.input, details?.phases, native.details);
  if (!nonempty(native.callId) || !before || !transition.valid || transition.operation !== "done" || transition.observationOnly) return undefined;
  const completed = Array.isArray(details?.completedTasks) ? details.completedTasks.map(value => value && typeof value === "object" && "phase" in value && "content" in value ? { phase: value.phase, content: value.content } : null) : [];
  return { callId: native.callId, inputDigest: nativeTodoInputDigest(native.input), beforeDigest: canonicalDigest(before),
    effectDigest: canonicalDigest({ operation: transition.operation, phases: transition.phases, completedTasks: completed }) };
}

/** Object identity authenticates the grant. An exercised observation is not finality or reusable authority. */
export function createNativeStageRegistry(options: TaskVerificationRuntimeOptions, releaseDebt: (context: unknown, state: TaskReviewState, native: TaskNativeCommit) => void): NativeStageRegistry {
  const issued = new Map<NativeTaskVerificationStage, NativeStageRecord>();
  const settled = new Map<string, { stages: readonly NativeTaskVerificationStage[]; effectDigest: string }>();
  return {
    issue(context, review) {
      const branch = readHostBranch(context);
      if (!branch || review.outcome.status !== "APPROVED_PENDING_COMMIT") throw new Error("native_stage_current_bound_approval_required");
      const contract = review.contract;
      const stage: NativeTaskVerificationStage = Object.freeze({
        contract: Object.freeze({ contractId: contract.contractId, revisionId: contract.revisionId, incarnationId: contract.incarnationId }),
        receiptId: review.outcome.receiptId, bindingDigest: review.outcome.bindingDigest,
        snapshot: review.evidence.snapshot, target: freezeContractValue(structuredClone(contract.target)),
        evidenceDigest: review.snapshot.evidenceDigest, policyDigest: review.snapshot.policyDigest,
        sessionId: branch.sessionId, branchId: branch.branchId,
      });
      issued.set(stage, { review, contextKey: review.contextKey, consumed: false, receiptId: stage.receiptId, bindingDigest: stage.bindingDigest });
      return stage;
    },
    observe(context, stages, native) {
      const branch = readHostBranch(context);
      if (!branch || !stages.length || new Set(stages).size !== stages.length) return;
      const effect = observedEffect(native);
      for (const stage of stages) {
        const record = issued.get(stage);
        if (!record || record.consumed || stage.sessionId !== branch.sessionId || stage.branchId !== branch.branchId) continue;
        if (native.isError) { issued.delete(stage); continue; }
        if (!effect || record.exercise && canonicalDigest(record.exercise) !== canonicalDigest(effect)) continue;
        record.exercise = Object.freeze(effect);
      }
      // No journal, no task mutation, no debt release. Only the supported final branch join below commits.
    },
    async commit(context, stages, native) {
      const branch = readHostBranch(context);
      const projection = options.contracts.projection(context);
      if (!branch || !projection || !stages.length || new Set(stages).size !== stages.length) return false;
      const result = branch.byId.get(native.resultEntryId);
      const input = originalTodoInput(branch, native.callId);
      const observationId = `${branch.sessionId}:${native.callId}:${native.resultEntryId}`;
      const effect = observedEffect(native);
      const normalized = normalizeNativeTodoInput(input);
      if (!effect || !normalized.valid || effect.inputDigest !== canonicalDigest(normalized.input) || result?.type !== "message" || result.message?.role !== "toolResult" ||
        result.message.toolName !== "todo" || result.message.toolCallId !== native.callId || result.message.isError !== false || result.message.details === undefined ||
        canonicalDigest(result.message.details) !== canonicalDigest(native.details)) return false;
      const success = projection.nativeSuccesses.find(value => value.callId === native.callId && value.resultEntryId === native.resultEntryId && value.operation === "done" && value.inputDigest === effect.inputDigest);
      if (!success) return false;
      const accepted = settled.get(observationId);
      if (accepted) return accepted.effectDigest === canonicalDigest(effect) && accepted.stages.length === stages.length && accepted.stages.every((stage, index) => stage === stages[index]);
      const completed = success.targets.filter(target => target.completionReported && target.before && target.after && target.beforeStatus !== "completed" && target.afterStatus === "completed");
      if (completed.length !== stages.length) return false;
      const records: NativeStageRecord[] = [];
      for (const stage of stages) {
        const record = issued.get(stage);
        if (!record || record.consumed || !record.exercise || canonicalDigest(record.exercise) !== canonicalDigest(effect) || stage.sessionId !== branch.sessionId || stage.branchId !== branch.branchId ||
          record.receiptId !== stage.receiptId || record.bindingDigest !== stage.bindingDigest) return false;
        const target = completed.find(value => value.before?.incarnationId === stage.contract.incarnationId && value.after?.incarnationId === stage.contract.incarnationId &&
          canonicalDigest(value.before.target) === canonicalDigest(stage.target) && canonicalDigest(value.after.target) === canonicalDigest(stage.target));
        if (!target) return false;
        records.push(record);
      }
      const confirmed = readHostBranch(context);
      const confirmedResult = confirmed?.byId.get(native.resultEntryId);
      const confirmedInput = confirmed && normalizeNativeTodoInput(originalTodoInput(confirmed, native.callId));
      if (!confirmed || confirmed.sessionId !== branch.sessionId || confirmed.branchId !== branch.branchId || !confirmedInput?.valid ||
        canonicalDigest(confirmedInput.input) !== effect.inputDigest || confirmedResult?.message?.role !== "toolResult" || confirmedResult.message.toolCallId !== native.callId ||
        confirmedResult.message.toolName !== "todo" || confirmedResult.message.isError !== false || canonicalDigest(confirmedResult.message.details) !== canonicalDigest(native.details)) return false;
      // Core's actual before/after incarnation at this call is authoritative for this historical join.
      // Later file edits/removal/reappend cannot erase old success or resolve a newer incarnation.
      settled.set(observationId, { stages: Object.freeze([...stages]), effectDigest: canonicalDigest(effect) });
      for (let index = 0; index < stages.length; index++) {
        records[index].consumed = true; issued.delete(stages[index]);
        releaseDebt(context, records[index].review, native);
      }
      return true;
    },
    invalidate(contextKey) {
      for (const [stage, record] of issued) if (record.contextKey === contextKey && !record.exercise) issued.delete(stage);
    },
  };
}
