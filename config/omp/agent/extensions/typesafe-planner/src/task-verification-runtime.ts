import { canonicalDigest, isDigest } from "./task-contract-source";
import { readHostBranch, validateProjectToolInvocationJoin } from "./host-history";
import { checkDeterministicPreconditions } from "./verification-gate";
import { evaluateBicameralDoneConsensus } from "./bicameral-consensus";
import { validateAdvisorReceipt } from "./advisor-protocol";
import { createTaskAdvisorServices } from "./task-verification-advisor";
import { createNativeStageRegistry } from "./task-verification-native";
import { createVerificationHistory } from "./task-verification-history";
import { evaluateMonolithicTask } from "./task-verification-macro";
import { assertSemanticApprovalPolicy } from "./semantic-approval-policy";
import { createHistoricalDebtResolver } from "./task-verification-historical";
import { matchingReview, reviewRecovery, stateProgressDigest, taskContextKey, taskReviewKey, taskReviewSnapshot } from "./task-verification-state";
import type { TaskReviewState, TaskReviewOutcome, TaskVerificationRuntime, TaskVerificationRuntimeOptions, TaskVerificationTarget } from "./task-verification-types";
import type { ReviewBinding, VerificationOutcome } from "./types/verification";
export type { TaskVerificationRuntime, TaskVerificationRuntimeOptions, NativeTaskVerificationStage, TaskReviewOutcome, TaskPreflightOutcome, TaskNativeCommit, TaskNativeObservation, TaskVerificationTarget, TaskRecoveryPlan } from "./task-verification-types";
export type { TaskAvailabilityObservation } from "./task-verification-history";
export { planPhaseReviewDigest } from "./task-verification-plan";
export type { ApprovedPlanPhaseSource } from "./task-verification-plan";
export type { HistoricalDebtResolutionProposal, HistoricalDebtResolutionOutcome, HistoricalDebtResolver } from "./task-verification-debt-types";

/** Owns transient semantic/staging capabilities; only rejection/recovery/source facts are durable. */
export function createTaskVerificationRuntime(options: TaskVerificationRuntimeOptions): TaskVerificationRuntime {
  options = Object.freeze({ ...options, ...(options.privacy ? { privacy: Object.freeze({ apiKey: options.privacy.apiKey, ...(options.privacy.homeDirs ? { homeDirs: Object.freeze([...options.privacy.homeDirs]) } : {}) }) } : {}) });
  assertSemanticApprovalPolicy(options.approvalPolicy);
  if (!isDigest(options.policyDigest)) throw new Error("task_verification_trusted_policy_digest_required");
  const states = new Map<string, TaskReviewState>();
  const inflight = new Map<string, Promise<TaskReviewOutcome>>();
  const currentChecks = new Map<TaskReviewState, Promise<boolean>>();
  const history = createVerificationHistory(options);
  const resolveHistorical = createHistoricalDebtResolver(options, history);
  let generation = 0;
  async function current(context: unknown, state: TaskReviewState): Promise<boolean> {
    const cached = currentChecks.get(state);
    if (cached) return cached;
    return currentSource(context, state);
  }
  async function currentSource(context: unknown, state: TaskReviewState): Promise<boolean> {
    const branch = readHostBranch(context);
    const contract = options.contracts.contractFor(context, { task: state.contract.target.content, phase: state.contract.target.phase });
    const projection = options.contracts.projection(context);
    const phase = projection?.nativePhases?.[state.contract.target.phaseOrdinal];
    const task = phase?.tasks[state.contract.target.ordinal];
    return !!branch && states.get(state.key) === state && state.generation >= 0 && state.contextKey === taskContextKey(context) &&
      !!contract && canonicalDigest(contract) === state.snapshot.contractDigest && !!options.contracts.sourceContext(contract) &&
      contract.policyDigest === options.policyDigest && task?.content === contract.target.content && phase?.name === contract.target.phase &&
      task.status !== "completed" && task.status !== "abandoned" && validateProjectToolInvocationJoin(branch, state.invocation) &&
      options.evidence.get(context, { task: contract.target.content, phase: contract.target.phase }) === state.evidence && await options.evidence.isCurrent(context, state.evidence);
  }
  async function compose(context: unknown, state: TaskReviewState): Promise<VerificationOutcome> {
    const reviews = await options.getAdvisorReviews(context);
    const actual = state.request && reviews.find(review => review.request === state.request && review.receipt.requestId === state.request?.requestId);
    if (actual && validateAdvisorReceipt(actual.receipt, { binding: state.binding, snapshot: state.snapshot,
      criterionIds: actual.request.criterionIds, requireParentIntegration: state.binding.purpose === "parent_review", request: actual.request }).valid) state.receipt = actual.receipt;
    else state.receipt = undefined;
    const result = state.results[0];
    if (!result) return state.outcome;
    if (result.outcome?.status === "EVIDENCE_REQUIRED") { state.outcome = result.outcome; return state.outcome; }
    const decision = await evaluateBicameralDoneConsensus({ todoTask: state.contract.target.content,
      userRequest: options.contracts.sourceContext(state.contract)?.originalUserRequest.text,
      macroResult: result, evidence: state.evidence.evidence,
      ...(state.receipt && state.request ? { reasoning: { receipt: state.receipt, binding: state.binding, snapshot: state.snapshot,
        criterionIds: state.request.criterionIds, requireParentIntegration: state.binding.purpose === "parent_review" } } : {}) }, { approvalPolicy: options.approvalPolicy });
    state.outcome = decision.disposition;
    return state.outcome;
  }
  const advisor = createTaskAdvisorServices({ runtime: options, states, isCurrent: current });
  const stages = createNativeStageRegistry(options, (context, state, native) => { history.resolveDebt(context, state, native); state.recovery = undefined; });
  function report(context: unknown, callId: string, state: TaskReviewState): TaskReviewOutcome {
    if (state.outcome.status === "APPROVED_PENDING_COMMIT") return state.outcome;
    state.recovery = reviewRecovery(state);
    history.recordFailure(context, state.binding.provenance.dispatchId, state);
    history.recordRecovery(context, callId, state);
    if (state.results[0]?.approved && !state.receipt) return { status: "REVIEW_REQUIRED", reasons: [state.provisionalReceiptId
      ? "A provisional Advisor receipt exists, but actual settled native task history and final outer result have not yet proved it usable."
      : "M source assessment is favorable; a real independent exact-bound Advisor/Parent review is still required."],
      nextActions: [`typesafe_prepare_advisor ${JSON.stringify({ purpose: state.binding.purpose, task: state.contract.target.content, phase: state.contract.target.phase })}`,
        "Execute only the genuine native task request returned by that host tool; after its settled result, call typesafe_review_task again. No fake receipt or lifecycle flag can substitute."] };
    return { ...state.outcome, nextActions: state.recovery.assignments.map(assignment => `${assignment.owner}: ${assignment.action}`),
      handoff: { owner: state.recovery.owner, action: state.recovery.action, releaseCondition: state.recovery.unblockCondition } };
  }
  async function performReview(context: unknown, callId: string, target: TaskVerificationTarget): Promise<TaskReviewOutcome> {
    const branch = readHostBranch(context); const invocation = options.invocations.current(context, "typesafe_review_task", callId, target);
    const contract = options.contracts.contractFor(context, target);
    const source = contract && options.contracts.sourceContext(contract);
    const record = options.evidence.get(context, target);
    if (!branch || !invocation || !contract || !source || !record || record.contract !== contract && canonicalDigest(record.contract) !== canonicalDigest(contract)) return {
      status: "EVIDENCE_REQUIRED", missingCriterionIds: contract?.criteria.map(criterion => criterion.id) ?? [],
      reasons: ["Bind the actual native task to its genuine public source and collect authentic contract-bound evidence before review."],
      nextActions: ["typesafe_bind_task: bind the exact actual native target and approved original source.", "typesafe_collect_evidence: collect genuine task/source/test evidence; use a standalone source-bound Advisor consultation for missing-proof diagnosis."] };
    if (contract.policyDigest !== options.policyDigest || !await options.evidence.isCurrent(context, record)) return {
      status: "EVIDENCE_REQUIRED", missingCriterionIds: contract.criteria.map(criterion => criterion.id), reasons: ["Current contract/policy/tree/test/source identities differ; collect a fresh authentic evidence record before review."] };
    const phase = options.contracts.projection(context)?.nativePhases?.[contract.target.phaseOrdinal];
    const task = phase?.tasks[contract.target.ordinal];
    if (!task || phase?.name !== contract.target.phase || task.content !== contract.target.content || task.status === "completed" || task.status === "abandoned") return {
      status: "EVIDENCE_REQUIRED", missingCriterionIds: contract.criteria.map(criterion => criterion.id),
      reasons: ["This exact native incarnation is no longer an active completion target. Historical work may support a genuine standalone source/phase consultation, not a new native completion grant."] };
    const key = taskReviewKey(context, record); const progressDigest = stateProgressDigest(record);
    const previous = states.get(key);
    if (previous && previous.evidence === record && await current(context, previous)) {
      await compose(context, previous);
      if (previous.outcome.status !== "UNAVAILABLE" && previous.results[0]) return report(context, callId, previous);
    }
    const failures = history.failures(context, { contractId: contract.contractId, revisionId: contract.revisionId, incarnationId: contract.incarnationId });
    const unchanged = failures.filter(failure => failure.progressDigest === progressDigest);
    const rejected = unchanged.find(failure => failure.status === "REJECTED");
    if (rejected) return { status: "REJECTED", criterionIds: [...rejected.criterionIds], reasons: ["Unchanged semantic rejection cannot be retried. Change relevant criterion/source/test/parent evidence or obtain an exact validated amendment; prose, timestamps and unrelated edits are not progress.", ...rejected.reasons],
      nextActions: ["Use a genuine standalone Advisor consultation to diagnose exact rejected criteria, then scoped correction/evidence collection, parent affected checks, independent review and same-target evaluation."] };
    const prerequisite = unchanged.filter(failure => failure.status === "EVIDENCE_REQUIRED").at(-1);
    if (prerequisite) return { status: "EVIDENCE_REQUIRED", missingCriterionIds: prerequisite.criterionIds.length ? [...prerequisite.criterionIds] : contract.criteria.map(criterion => criterion.id),
      reasons: ["The actual prior M assessment requires changed task-relevant evidence or an exact validated amendment, not another unchanged request to fish for a pass.", ...prerequisite.reasons],
      nextActions: ["typesafe_advisor: obtain genuine source-bound diagnosis for this task's exact evidence prerequisite, then collect the resulting relevant proof before fresh M evaluation."] };
    const outage = unchanged.filter(failure => failure.status === "UNAVAILABLE").at(-1);
    if (outage && !history.consumeAvailability(context, outage, progressDigest, callId)) return {
      status: "UNAVAILABLE", component: outage.component, reasons: ["A real matching-purpose/backend availability observation after this failed dispatch must be durably consumed once before same-evidence retry. No fake code edit or repeated unavailable request is allowed."],
      nextActions: ["Service owner: restore the actual provider/credential/runtime prerequisite; a genuine successful canonical request can publish an availability observation through the private host callback. Then request one fresh review."] };
    const snapshot = taskReviewSnapshot(record);
    const parent = contract.parentRequirements.length > 0;
    const provenance = { sessionId: branch.sessionId, branchId: branch.branchId, requestEntryId: invocation.entryId, dispatchId: callId,
      evidenceDigest: snapshot.evidenceDigest, policyDigest: options.policyDigest, questionDigest: canonicalDigest({ rubric: "original-M", criteria: contract.criteria }) };
    const reference = { contractId: contract.contractId, revisionId: contract.revisionId, incarnationId: contract.incarnationId };
    const base = { contract: reference, target: contract.target, logicalOperationId: `done:${contract.incarnationId}:${contract.revisionId}`, provenance, authorizedScope: contract.allowedMutationScope };
    const binding: ReviewBinding = parent ? { ...base, purpose: "parent_review", parentObligationIds: [...new Set(contract.parentRequirements.map(requirement => requirement.criterionId))],
      childReceiptIds: [], integrationReceiptIds: [...new Set(record.packetSet.packets.flatMap(value => (value.packet.integrationReceipts ?? []).map(receipt => receipt.receiptId)))] } : { ...base, purpose: "task_review" };
    const state: TaskReviewState = { key, contextKey: taskContextKey(context)!, contract, evidence: record, binding, snapshot, invocation, results: [],
      outcome: { status: "EVIDENCE_REQUIRED", missingCriterionIds: contract.criteria.map(criterion => criterion.id), reasons: ["Current source assessment and independent real review are required."] }, progressDigest,
      ...(failures.length ? { attempt: { progressDigest: failures.at(-1)!.progressDigest, semanticFailures: failures.filter(failure => failure.status === "REJECTED" && failure.semanticDispatch).length, status: failures.at(-1)!.status } } : {}),
      generation: ++generation };
    states.set(key, state);
    const deterministic = checkDeterministicPreconditions(record.evidence);
    if (!deterministic.passed) state.outcome = deterministic.outcome ?? { status: "REJECTED", criterionIds: [], reasons: deterministic.reasons };
    else {
      const assessment = await evaluateMonolithicTask(options, context, record, source, failures.filter(failure => failure.status === "REJECTED" && failure.semanticDispatch).length + 1);
      const stale = !await current(context, state);
      state.results = Object.freeze([stale ? { ...assessment.result, approved: false } : assessment.result]);
      if (stale) state.outcome = { status: "EVIDENCE_REQUIRED", missingCriterionIds: contract.criteria.map(criterion => criterion.id), reasons: ["Task source/tree/test/contract changed during review; the returned assessment cannot authorize its replacement."] };
      else await compose(context, state);
    }
    return report(context, callId, state);
  }
  const runtime: TaskVerificationRuntime = {
    advisorServices: advisor.services,
    async review(context, callId, target) {
      const branchKey = taskContextKey(context);
      const key = `${branchKey}|${canonicalDigest(target)}`;
      const existing = inflight.get(key); if (existing) return existing;
      const operation = performReview(context, callId, target).catch((error: unknown): TaskReviewOutcome => ({ status: "UNAVAILABLE", component: "task_verification_runtime", reasons: [`Actual task review prerequisite unavailable: ${error instanceof Error ? error.message : "source capability unavailable"}. No native approval was produced.`] }));
      inflight.set(key, operation);
      try { return await operation; } finally { if (inflight.get(key) === operation) inflight.delete(key); }
    },
    async preflight(context, target, operation, signal) {
      const state = matchingReview(states, options, context, target);
      if (operation !== "done" || signal?.aborted || !state) return { status: "EVIDENCE_REQUIRED", missingCriterionIds: [], reasons: ["A current task-bound source review and real settled Advisor receipt must exist before native preflight. Run typesafe_review_task outside this short native callback."] };
      const check = currentSource(context, state); currentChecks.set(state, check);
      try {
        if (!await check || signal?.aborted) return { status: "EVIDENCE_REQUIRED", missingCriterionIds: state.contract.criteria.map(criterion => criterion.id), reasons: ["Current contract/incarnation/tree/test/policy/evidence differs from the actual reviewed snapshot; no native staging."] };
        const branch = readHostBranch(context);
        if (!branch || !validateProjectToolInvocationJoin(branch, state.invocation, true)) return {
          status: "EVIDENCE_REQUIRED", missingCriterionIds: state.contract.criteria.map(criterion => criterion.id),
          reasons: ["The original real review invocation has not yet joined its exact successful settled SDK call/result, or that outer result failed. Its host execution witness alone is not native authority."] };
        const outcome = await compose(context, state);
        if (signal?.aborted) return { status: "UNAVAILABLE", component: "preflight", reasons: ["Native preflight was cancelled before staging."] };
        return outcome.status === "APPROVED_PENDING_COMMIT" ? { status: "APPROVED_PENDING_COMMIT", stage: stages.issue(context, state) }
          : { ...outcome, nextActions: state.recovery?.assignments.map(assignment => `${assignment.owner}: ${assignment.action}`),
            ...(state.recovery ? { handoff: { owner: state.recovery.owner, action: state.recovery.action, releaseCondition: state.recovery.unblockCondition } } : {}) };
      } finally { if (currentChecks.get(state) === check) currentChecks.delete(state); }
    },
    commit: stages.commit,
    observeNativeResult: stages.observe,
    observeAvailability: history.observeAvailability,
    getRecovery(context, target) {
      const state = matchingReview(states, options, context, target);
      const contract = options.contracts.contractFor(context, target);
      return state?.recovery ?? (contract ? history.recovery(context, { contractId: contract.contractId, revisionId: contract.revisionId, incarnationId: contract.incarnationId }) : undefined);
    },
    hasDebt: history.hasDebt,
    async resolveHistoricalDebt(context, callId, proposal) {
      const outcome = await resolveHistorical(context, callId, proposal);
      if (outcome.status === "HUMAN_RECONCILED_NO_NATIVE_APPROVAL") for (const state of states.values()) {
        if (state.contextKey === taskContextKey(context) && state.contract.incarnationId === proposal.incarnationId) {
          state.generation = -1; state.recovery = undefined; state.receipt = undefined; state.request = undefined;
        }
      }
      return outcome;
    },
    getCurrentPlanPhaseReview: advisor.getCurrentPlanPhaseReview,
    invalidate(context, reason) {
      const key = taskContextKey(context); if (!key) return;
      if (reason === "turn_end" || reason === "agent_end") return; // Ordinary turn boundaries are not source or native permission changes.
      stages.invalidate(key);
      for (const state of states.values()) if (state.contextKey === key) { state.generation = -1; state.receipt = undefined; state.request = undefined; }
    },
  };
  return runtime;
}
