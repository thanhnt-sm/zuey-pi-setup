import { canonicalDigest, freezeContractValue, isDigest, nonempty } from "./task-contract-source";
import { readHostBranch } from "./host-history";
import { verificationInvocationSource } from "./task-verification-invocation";
import { historicalDebtCatalogue, semanticDebtId } from "./task-verification-debt";
import { validHistoricalResolution } from "./task-verification-historical";
import type { HistoricalDebtCatalogue, HistoricalDebtResolutionFact, HistoricalRawJev } from "./task-verification-debt-types";
import type { TypeSafeRequestMetadata, JudgePurpose } from "./payload-safety";
import type { ContractReference } from "./types/verification";
import type { TaskNativeCommit, TaskReviewState, TaskVerificationRuntimeOptions, TaskRecoveryPlan } from "./task-verification-types";

export const TASK_VERIFICATION_FACTS = "omp.typesafe.task-verification-facts.v1";
export interface TaskAvailabilityObservation { callId: string; purpose: JudgePurpose; metadata: TypeSafeRequestMetadata }
export interface ReviewFailureFact {
  schemaVersion: 1; kind: "review_failure"; contextKey: string; contract: ContractReference;
  sourceEntryId: string; callId: string; bindingDigest: string; progressDigest: string;
  status: "REJECTED" | "UNAVAILABLE" | "EVIDENCE_REQUIRED"; criterionIds: readonly string[]; reasons: readonly string[];
  policyDigest: string; component: string; resolvedModel?: string;
  semanticDispatch: boolean;
  rawJev?: HistoricalRawJev;
}
interface AvailabilityFact {
  schemaVersion: 1; kind: "availability"; contextKey: string; sourceEntryId: string; callId: string;
  observationId: string; purpose: JudgePurpose; policyDigest: string; resolvedModel?: string; bodyDigest: string;
}
interface RecoveryGrantFact { schemaVersion: 1; kind: "availability_consumed"; contextKey: string; observationId: string; failedAttemptId: string; retryCallId: string; progressDigest: string }
interface DebtResolutionFact { schemaVersion: 1; kind: "debt_resolved"; contextKey: string; contract: ContractReference; debtBindingDigest: string; bindingDigest: string; callId: string; resultEntryId: string }
interface RecoveryPlanFact { schemaVersion: 1; kind: "recovery_plan"; contextKey: string; contract: ContractReference; sourceEntryId: string; callId: string; plan: TaskRecoveryPlan }
interface NativeCommitFact { schemaVersion: 1; kind: "native_commit"; contextKey: string; contract: ContractReference; bindingDigest: string; callId: string; resultEntryId: string }
type VerificationFact = ReviewFailureFact | AvailabilityFact | RecoveryGrantFact | DebtResolutionFact | RecoveryPlanFact | NativeCommitFact | HistoricalDebtResolutionFact;
export interface VerificationHistory {
  sourceEntry(context: unknown, callId: string, expectedEntryId?: string): string | undefined;
  failures(context: unknown, contract: ContractReference): ReviewFailureFact[];
  recordFailure(context: unknown, callId: string, state: TaskReviewState): void;
  observeAvailability(context: unknown, observation: TaskAvailabilityObservation): void;
  consumeAvailability(context: unknown, failure: ReviewFailureFact, progressDigest: string, retryCallId: string): boolean;
  resolveDebt(context: unknown, state: TaskReviewState, native: TaskNativeCommit): void;
  recordRecovery(context: unknown, callId: string, state: TaskReviewState): void;
  recovery(context: unknown, contract: ContractReference): TaskRecoveryPlan | undefined;
  hasDebt(context: unknown, incarnationId: string): boolean;
  historicalCatalogue(context: unknown, incarnationId: string): HistoricalDebtCatalogue | undefined;
  recordHistoricalResolution(context: unknown, fact: HistoricalDebtResolutionFact): boolean;
}

export function createVerificationHistory(options: TaskVerificationRuntimeOptions): VerificationHistory {
  const live = new Map<string, VerificationFact[]>();
  function facts(context: unknown): VerificationFact[] {
    const branch = readHostBranch(context);
    if (!branch) return [];
    const key = `${branch.sessionId}|${branch.branchId}`;
    const persisted = branch.entries.flatMap(entry => {
      const raw = entry.type === "custom" && entry.customType === TASK_VERIFICATION_FACTS ? entry.data : undefined;
      if (!raw || typeof raw !== "object" || !("schemaVersion" in raw) || raw.schemaVersion !== 1 || !("contextKey" in raw) || raw.contextKey !== key || !("kind" in raw)) return [];
      // Only host-owned active-branch custom entries are considered; user messages/imported JSON are not an authority source.
      if (!["review_failure", "availability", "availability_consumed", "recovery_plan", "native_commit", "debt_resolved", "historical_resolution"].includes(String(raw.kind))) return [];
      return [raw as VerificationFact];
    });
    const all = [...persisted]; const seen = new Set(persisted.map(canonicalDigest));
    for (const fact of live.get(key) ?? []) if (!seen.has(canonicalDigest(fact))) all.push(fact);
    return all;
  }
  function append(fact: VerificationFact): void {
    const snapshot = freezeContractValue(structuredClone(fact));
    live.set(fact.contextKey, [...(live.get(fact.contextKey) ?? []), snapshot]);
    options.appendEntry(TASK_VERIFICATION_FACTS, snapshot);
  }
  function contextKey(context: unknown): string | undefined {
    const branch = readHostBranch(context); return branch ? `${branch.sessionId}|${branch.branchId}` : undefined;
  }
  function trustedAmendment(context: unknown, reference: ContractReference, successor: ContractReference): boolean {
    const projection = options.contracts.projection(context);
    const revisions = projection?.contractRevisions ?? [];
    const previous = revisions.find(contract => canonicalDigest({ contractId: contract.contractId, revisionId: contract.revisionId, incarnationId: contract.incarnationId }) === canonicalDigest(reference));
    let next = revisions.find(contract => contract.contractId === reference.contractId && contract.incarnationId === reference.incarnationId && contract.revisionId === successor.revisionId && successor.contractId === reference.contractId && successor.incarnationId === reference.incarnationId);
    if (!previous || !next || next.revisionId === previous.revisionId) return false;
    const visited = new Set<string>();
    while (next.previousRevisionId && !visited.has(next.revisionId)) {
      visited.add(next.revisionId);
      const ancestor = revisions.find(contract => contract.contractId === reference.contractId && contract.incarnationId === reference.incarnationId && contract.revisionId === next!.previousRevisionId);
      if (!ancestor || options.contracts.validators(context).validateAmendment?.(ancestor, next) !== true) return false;
      if (ancestor.revisionId === previous.revisionId) return true;
      next = ancestor;
    }
    return false;
  }
  function committed(context: unknown, reference: ContractReference): boolean {
    const projection = options.contracts.projection(context);
    return facts(context).some(fact => fact.kind === "native_commit" && (canonicalDigest(fact.contract) === canonicalDigest(reference) || trustedAmendment(context, reference, fact.contract)) &&
      projection?.nativeSuccesses.some(success => success.callId === fact.callId && success.resultEntryId === fact.resultEntryId && success.operation === "done" &&
        success.targets.some(target => target.completionReported && target.before?.incarnationId === reference.incarnationId && target.after?.incarnationId === reference.incarnationId)));
  }
  function humanResolutions(context: unknown, incarnationId: string): Set<string> {
    const branch = readHostBranch(context);
    return new Set(branch ? facts(context).flatMap(fact => fact.kind === "historical_resolution" && fact.incarnationId === incarnationId && validHistoricalResolution(branch, fact) ? fact.debtIds : []) : []);
  }
  const history: VerificationHistory = {
    sourceEntry(context, callId, expectedEntryId) {
      return verificationInvocationSource(context, options.invocations, callId, expectedEntryId)?.entryId;
    },
    recordRecovery(context, callId, state) {
      const key = contextKey(context); const sourceEntryId = history.sourceEntry(context, callId);
      if (!key || !sourceEntryId || !state.recovery) return;
      append({ schemaVersion: 1, kind: "recovery_plan", contextKey: key, contract: { contractId: state.contract.contractId, revisionId: state.contract.revisionId, incarnationId: state.contract.incarnationId }, sourceEntryId, callId, plan: state.recovery });
    },
    recovery(context, contract) {
      const all = facts(context);
      if (committed(context, contract)) return undefined;
      const plans = all.filter((fact): fact is RecoveryPlanFact => fact.kind === "recovery_plan" && canonicalDigest(fact.contract) === canonicalDigest(contract) && history.sourceEntry(context, fact.callId, fact.sourceEntryId) === fact.sourceEntryId);
      return plans.at(-1)?.plan;
    },
    hasDebt(context, incarnationId) {
      const catalogue = history.historicalCatalogue(context, incarnationId);
      if (catalogue) return catalogue.debts.length > 0;
      const contracts = new Map<string, ContractReference>();
      for (const fact of facts(context)) if (fact.kind === "review_failure" && fact.status === "REJECTED" && fact.contract.incarnationId === incarnationId) contracts.set(canonicalDigest(fact.contract), fact.contract);
      return [...contracts.values()].some(contract => history.failures(context, contract).some(failure => failure.status === "REJECTED")) ||
        (options.contracts.projection(context)?.debt.some(debt => debt.contract.incarnationId === incarnationId && !committed(context, debt.contract)) ?? false);
    },
    failures(context, contract) {
      const all = facts(context); const projection = options.contracts.projection(context); const resolvedHuman = humanResolutions(context, contract.incarnationId);
      if (committed(context, contract)) return [];
      return all.filter((fact): fact is ReviewFailureFact => fact.kind === "review_failure" && canonicalDigest(fact.contract) === canonicalDigest(contract) &&
        [fact.callId, fact.sourceEntryId].every(nonempty) && [fact.bindingDigest, fact.progressDigest, fact.policyDigest].every(isDigest) &&
        history.sourceEntry(context, fact.callId, fact.sourceEntryId) === fact.sourceEntryId && ["REJECTED", "UNAVAILABLE", "EVIDENCE_REQUIRED"].includes(fact.status) &&
        !resolvedHuman.has(semanticDebtId(fact)) &&
        !(fact.status === "UNAVAILABLE" && all.some(grant => grant.kind === "availability_consumed" && grant.failedAttemptId === fact.callId &&
          all.some(observation => observation.kind === "availability" && observation.callId === grant.retryCallId && observation.purpose === "native_done" && observation.policyDigest === fact.policyDigest && history.sourceEntry(context, observation.callId, observation.sourceEntryId) === observation.sourceEntryId))) &&
        !all.some(resolved => resolved.kind === "debt_resolved" && resolved.debtBindingDigest === fact.bindingDigest && canonicalDigest(resolved.contract) === canonicalDigest(contract) &&
          projection?.nativeSuccesses.some(success => success.callId === resolved.callId && success.resultEntryId === resolved.resultEntryId && success.operation === "done" && success.targets.some(target => target.completionReported && target.before?.incarnationId === contract.incarnationId && target.after?.incarnationId === contract.incarnationId))));
    },
    recordFailure(context, callId, state) {
      const key = contextKey(context); const sourceEntryId = history.sourceEntry(context, callId, state.binding.provenance.requestEntryId);
      const measurement = state.results[0];
      const semanticRejected = !!measurement && !measurement.approved && !measurement.error && measurement.outcome?.status !== "EVIDENCE_REQUIRED";
      const status = semanticRejected ? "REJECTED" : state.outcome.status;
      if (!key || !sourceEntryId || (status !== "REJECTED" && status !== "UNAVAILABLE" && status !== "EVIDENCE_REQUIRED")) return;
      if (status === "EVIDENCE_REQUIRED" && (!measurement || measurement.error || measurement.approved)) return;
      const fact: ReviewFailureFact = { schemaVersion: 1, kind: "review_failure", contextKey: key,
        contract: { contractId: state.contract.contractId, revisionId: state.contract.revisionId, incarnationId: state.contract.incarnationId }, sourceEntryId, callId,
        bindingDigest: canonicalDigest(state.binding), progressDigest: state.progressDigest, status,
        criterionIds: state.outcome.status === "REJECTED" ? state.outcome.criterionIds : state.outcome.status === "EVIDENCE_REQUIRED" ? state.outcome.missingCriterionIds : [],
        reasons: "reasons" in state.outcome ? state.outcome.reasons : measurement?.reasons ?? [],
        policyDigest: state.snapshot.policyDigest, component: state.outcome.status === "UNAVAILABLE" ? state.outcome.component : "semantic_judge",
        semanticDispatch: !!measurement && !measurement.error,
        ...(measurement ? { rawJev: { verdict: measurement.verdict, probability: measurement.meetsCriteriaNoul,
          confidence: measurement.expertConfidence, driftChoice: measurement.driftChoice, scopeChoice: measurement.scopeChoice,
          ...(measurement.rawAnswers ? { rawAnswersDigest: canonicalDigest(measurement.rawAnswers) } : {}),
          ...(measurement.metadata?.bodyDigest ? { bodyDigest: measurement.metadata.bodyDigest } : {}) } } : {}),
        ...(measurement?.metadata?.resolvedModel ? { resolvedModel: measurement.metadata.resolvedModel } : {}),
      };
      if (!facts(context).some(value => value.kind === "review_failure" && value.callId === fact.callId && value.bindingDigest === fact.bindingDigest && value.status === fact.status)) append(fact);
    },
    observeAvailability(context, observation) {
      const key = contextKey(context); const sourceEntryId = options.invocations.current(context, undefined, observation.callId)?.entryId;
      const metadata = observation.metadata;
      if (!key || !sourceEntryId || observation.purpose !== "native_done" || metadata.purpose !== observation.purpose || !isDigest(metadata.bodyDigest) || !metadata.policyIdentity || !metadata.attemptReceipts?.some(attempt => attempt.kind === "ok" && attempt.status !== null && attempt.status >= 200 && attempt.status < 300 && attempt.bodyDigest === metadata.bodyDigest)) return;
      const observationId = canonicalDigest({ contextKey: key, callId: observation.callId, purpose: observation.purpose, bodyDigest: metadata.bodyDigest });
      if (facts(context).some(value => value.kind === "availability" && value.observationId === observationId)) return;
      append({ schemaVersion: 1, kind: "availability", contextKey: key, sourceEntryId, callId: observation.callId, observationId,
        purpose: observation.purpose, policyDigest: options.policyDigest, bodyDigest: metadata.bodyDigest,
        ...(metadata.resolvedModel ? { resolvedModel: metadata.resolvedModel } : {}) });
    },
    consumeAvailability(context, failure, progressDigest, retryCallId) {
      const all = facts(context); const index = all.findIndex(fact => canonicalDigest(fact) === canonicalDigest(failure));
      if (index < 0 || !history.sourceEntry(context, retryCallId) || failure.status !== "UNAVAILABLE" || failure.component !== "semantic_judge" || failure.progressDigest !== progressDigest) return false;
      const observation = all.slice(index + 1).find((fact): fact is AvailabilityFact => fact.kind === "availability" && fact.purpose === "native_done" && fact.policyDigest === failure.policyDigest &&
        (!failure.resolvedModel || failure.resolvedModel === fact.resolvedModel) && history.sourceEntry(context, fact.callId, fact.sourceEntryId) === fact.sourceEntryId &&
        !all.some(consumed => consumed.kind === "availability_consumed" && (consumed.observationId === fact.observationId || consumed.failedAttemptId === failure.callId)));
      if (!observation) return false;
      append({ schemaVersion: 1, kind: "availability_consumed", contextKey: failure.contextKey, observationId: observation.observationId, failedAttemptId: failure.callId, retryCallId, progressDigest });
      return true;
    },
    historicalCatalogue(context, incarnationId) {
      const references = new Map<string, ContractReference>();
      for (const fact of facts(context)) if (fact.kind === "review_failure" && fact.contract.incarnationId === incarnationId) references.set(canonicalDigest(fact.contract), fact.contract);
      const failures = [...references.values()].flatMap(contract => history.failures(context, contract));
      const resolved = humanResolutions(context, incarnationId);
      return historicalDebtCatalogue(options, context, incarnationId, failures, debtId => resolved.has(debtId), contract => committed(context, contract));
    },
    recordHistoricalResolution(context, fact) {
      const branch = readHostBranch(context);
      if (!branch || options.invocations.current(context, "typesafe_resolve_historical_debt", fact.invocation.callId) !== fact.invocation || !validHistoricalResolution(branch, fact)) return false;
      append(fact);
      return true;
    },
    resolveDebt(context, state, native) {
      const reference = { contractId: state.contract.contractId, revisionId: state.contract.revisionId, incarnationId: state.contract.incarnationId };
      const references = new Map<string, ContractReference>();
      for (const fact of facts(context)) if (fact.kind === "review_failure" && fact.status === "REJECTED" && fact.contract.incarnationId === reference.incarnationId &&
        (canonicalDigest(fact.contract) === canonicalDigest(reference) || trustedAmendment(context, fact.contract, reference))) references.set(canonicalDigest(fact.contract), fact.contract);
      const failures = [...references.values()].flatMap(contract => history.failures(context, contract));
      append({ schemaVersion: 1, kind: "native_commit", contextKey: state.contextKey,
        contract: { contractId: state.contract.contractId, revisionId: state.contract.revisionId, incarnationId: state.contract.incarnationId },
        bindingDigest: canonicalDigest(state.binding), callId: native.callId, resultEntryId: native.resultEntryId });
      for (const failure of failures) {
        if (failure.status !== "REJECTED") continue;
        append({ schemaVersion: 1, kind: "debt_resolved", contextKey: state.contextKey, contract: failure.contract,
          debtBindingDigest: failure.bindingDigest, bindingDigest: canonicalDigest(state.binding), callId: native.callId, resultEntryId: native.resultEntryId });
      }
    },
  };
  return history;
}
