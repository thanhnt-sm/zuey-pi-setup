import { canonicalDigest, freezeContractValue, isDigest, nonempty } from "./task-contract-source";
import type { ContractReference, HostReference, VerificationOutcome } from "./types/verification";

export interface RecoveryIdentity {
  contract: ContractReference;
  bindingDigest: string;
  criterionIds: readonly string[];
}
export interface RecoveryProgress {
  contractDigest: string;
  policyDigest: string;
  /** Digests of only task-relevant evidence, including applicable verification receipts. */
  criterionEvidence: Readonly<Record<string, readonly string[]>>;
}
export interface RecoveryAttempt {
  progressDigest: string;
  semanticFailures: number;
  status: VerificationOutcome["status"];
}
export interface RejectionDebt {
  debtId: string;
  identity: RecoveryIdentity;
  rejectedProgressDigest: string;
  criterionIds: readonly string[];
  reasons: readonly string[];
}
export interface RecoveryAssignment {
  id: string;
  owner: "advisor" | "scoped_executor" | "parent" | "independent_reviewer" | "service_owner" | "human";
  dependsOn: readonly string[];
  action: string;
  verification: string;
}
export interface RecoveryPlan {
  kind: "repair" | "evidence" | "service" | "human" | "pending_commit";
  retryAllowed: boolean;
  progressDigest: string;
  assignments: readonly RecoveryAssignment[];
  releaseCondition: string;
}
export interface AvailabilityChange {
  failedAttemptId: string;
  previousObservationId: string;
  currentObservationId: string;
  component: string;
}
export type DebtResolution =
  | { kind: "native_commit"; contract: ContractReference; debtBindingDigest: string; bindingDigest: string; stagedReceiptId: string; nativeCallId: string; nativeResultEntryId: string }
  | { kind: "human_amendment"; contract: ContractReference; amendsBindingDigest: string; amendment: HostReference };
export interface RecoveryHostValidators {
  /** Atomically validate and durably consume a real restoration grant for this actual failed host attempt/evidence. Reused observations, including across restarts, MUST return false. */
  consumeAvailabilityChange(change: AvailabilityChange, expected: { failedAttemptId: string; progressDigest: string }): boolean;
  /** Must join the exact staged native call and successful settled result envelope. */
  nativeCommitSucceeded(resolution: Extract<DebtResolution, { kind: "native_commit" }>): boolean;
  /** Must resolve the host-owned exact-target amendment/confirmation; message text alone is insufficient. */
  humanAmendmentValidated(resolution: Extract<DebtResolution, { kind: "human_amendment" }>): boolean;
}

export function recoveryProgressDigest(progress: RecoveryProgress): string {
  if (!isDigest(progress.contractDigest) || !isDigest(progress.policyDigest) || !Object.keys(progress.criterionEvidence).length ||
    Object.entries(progress.criterionEvidence).some(([id, digests]) => !nonempty(id) || !Array.isArray(digests) || !digests.every(isDigest))) {
    throw new Error("recovery_progress_invalid");
  }
  return canonicalDigest({ contractDigest: progress.contractDigest, policyDigest: progress.policyDigest,
    criterionEvidence: Object.fromEntries(Object.entries(progress.criterionEvidence).sort(([a], [b]) => a.localeCompare(b)).map(([id, digests]) => [id, [...new Set(digests)].sort()])) });
}

/** Journal each actual semantic rejection; outages/evidence requests are not failed implementations. */
export function recordRecoveryAttempt(previous: RecoveryAttempt | undefined, outcome: VerificationOutcome, progressDigest: string): RecoveryAttempt {
  if (!isDigest(progressDigest)) throw new Error("recovery_progress_invalid");
  return freezeContractValue({ progressDigest, status: outcome.status,
    semanticFailures: (previous?.semanticFailures ?? 0) + (outcome.status === "REJECTED" ? 1 : 0) });
}

export function createRejectionDebt(identity: RecoveryIdentity, outcome: Extract<VerificationOutcome, { status: "REJECTED" }>, progressDigest: string): RejectionDebt {
  if (!isDigest(identity.bindingDigest) || !isDigest(progressDigest) || ![identity.contract.contractId, identity.contract.revisionId, identity.contract.incarnationId].every(nonempty) ||
    outcome.criterionIds.some(id => !identity.criterionIds.includes(id))) throw new Error("rejection_debt_binding_invalid");
  const body = { identity: structuredClone(identity), rejectedProgressDigest: progressDigest,
    criterionIds: [...outcome.criterionIds], reasons: [...outcome.reasons] };
  return freezeContractValue({ ...body, debtId: `debt:${canonicalDigest(body)}` });
}

/** Host capabilities are injected once; model payloads cannot assert isHuman/approved flags. */
export function createTaskRecoveryPolicy(host: RecoveryHostValidators) {
  const consumedRestorations = new Set<string>();
  return {
    plan(input: { outcome: VerificationOutcome; progress: RecoveryProgress; previous?: RecoveryAttempt; failedAttemptId?: string; availabilityChange?: AvailabilityChange }): RecoveryPlan {
      const progressDigest = recoveryProgressDigest(input.progress);
      const changed = !input.previous || input.previous.progressDigest !== progressDigest;
      const status = input.outcome.status;
      if (status === "APPROVED_PENDING_COMMIT") return freezeContractValue({ kind: "pending_commit", retryAllowed: false, progressDigest,
        releaseCondition: "Only the matching successful native commit may close the obligation or release debt.", assignments: [{ id: "commit", owner: "parent", dependsOn: [], action: "Join the exact staged native call with its genuine successful settled result.", verification: "Operation/input/target/incarnation/revision/evidence/policy bindings match; outer error/abort/missing result cannot commit." }] });
      if (status === "UNAVAILABLE") {
        const change = input.availabilityChange;
        let restored = false;
        if (change && nonempty(input.failedAttemptId) && change.failedAttemptId === input.failedAttemptId &&
          change.component === input.outcome.component && nonempty(change.previousObservationId) && nonempty(change.currentObservationId) &&
          change.previousObservationId !== change.currentObservationId) {
          const restorationId = canonicalDigest({ component: change.component, current: change.currentObservationId });
          if (!consumedRestorations.has(restorationId) && host.consumeAvailabilityChange(change, { failedAttemptId: input.failedAttemptId, progressDigest }) === true) {
            consumedRestorations.add(restorationId);
            restored = true;
          }
        }
        return freezeContractValue({ kind: "service", retryAllowed: restored, progressDigest,
          releaseCondition: "A host-observed real availability change permits one fresh service attempt only after atomically consuming its failed-attempt-bound restoration grant; no code edit is required.",
          assignments: [{ id: "restore", owner: "service_owner", dependsOn: [], action: `Restore ${input.outcome.component}; record the failed and restored host observations without disclosing credentials.`, verification: "Host atomically validates and consumes the exact failed-attempt restoration grant; repeated observations, timestamps or agent claims do not qualify." },
            { id: "reevaluate", owner: "parent", dependsOn: ["restore"], action: "Dispatch exactly one fresh same-target review using the consumed restoration grant.", verification: "Fresh dispatch/result identity; another outage requires a new failed attempt and actual restoration event, never reuse of this observation pair." }] });
      }
      if (status === "HUMAN_REQUIRED" || (!changed && status === "REJECTED")) return freezeContractValue({ kind: "human", retryAllowed: false, progressDigest,
        releaseCondition: "Exact host-validated resolution or genuinely changed relevant evidence with a fresh review; never self-retry the unchanged rejection.",
        assignments: [{ id: "resolve", owner: "human", dependsOn: [], action: "Resolve the exact criterion conflict or approve a task-bound amendment through trusted host context.", verification: "Validate exact target/incarnation/binding and amendment source; a message, unblock, branch switch, or reappend cannot release debt." }] });
      const criteria = status === "REJECTED" ? input.outcome.criterionIds : input.outcome.missingCriterionIds;
      const target = criteria.length ? criteria.join(", ") : "the exact missing criterion-level diagnosis/evidence prerequisite";
      return freezeContractValue({ kind: status === "REJECTED" ? "repair" : "evidence", retryAllowed: changed, progressDigest,
        releaseCondition: "Dependency-ordered correction/evidence collection, parent affected verification, independent fresh review, then same-target evaluation.",
        assignments: [
          { id: "diagnose", owner: "advisor", dependsOn: [], action: `Diagnose ${target}; cite real task evidence and define the smallest criterion-specific action.`, verification: "Real Advisor receipt names the criterion/evidence prerequisite; no unrelated implementation demand." },
          { id: "execute", owner: "scoped_executor", dependsOn: ["diagnose"], action: status === "REJECTED" ? `Repair only diagnosed violations in ${target}.` : `Collect the required task-bound evidence for ${target}.`, verification: "Preserve all scope and tests; report exact source/artifact/evidence changes." },
          { id: "verify", owner: "parent", dependsOn: ["execute"], action: "Run full affected checks applicable to this task and collect changed-path evidence.", verification: "Genuine command results or investigation/report artifacts, according to the trusted task contract." },
          { id: "review", owner: "independent_reviewer", dependsOn: ["verify"], action: "Review fresh criterion evidence and parent integration obligations independently.", verification: "Fresh exact-bound real Advisor and raw JEV assessments; relevant progress digest changed." },
          { id: "reevaluate", owner: "parent", dependsOn: ["review"], action: "Evaluate the original same-target obligation with the new evidence and review receipts.", verification: "No unchanged semantic retry; staging is not native completion or debt release." },
        ] });
    },
    releaseDebt(debt: RejectionDebt, resolution: DebtResolution): boolean {
      if (canonicalDigest(debt.identity.contract) !== canonicalDigest(resolution.contract)) return false;
      if (resolution.kind === "native_commit") return resolution.debtBindingDigest === debt.identity.bindingDigest && isDigest(resolution.bindingDigest) &&
        [resolution.stagedReceiptId, resolution.nativeCallId, resolution.nativeResultEntryId].every(nonempty) && host.nativeCommitSucceeded(resolution);
      return resolution.amendsBindingDigest === debt.identity.bindingDigest && resolution.amendment.kind === "user_amendment" &&
        nonempty(resolution.amendment.entryId) && isDigest(resolution.amendment.digest) && host.humanAmendmentValidated(resolution);
    },
  };
}
