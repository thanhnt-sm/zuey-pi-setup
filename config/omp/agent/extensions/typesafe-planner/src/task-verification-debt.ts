import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import { readHostBranch } from "./host-history";
import type { ContractReference, NativeHistoryFailure, NativeIncarnationReference } from "./types/verification";
import type { TaskVerificationRuntimeOptions } from "./task-verification-types";
import type { ReviewFailureFact } from "./task-verification-history";
import type { HistoricalDebtCatalogue, HistoricalDebtRecord } from "./task-verification-debt-types";

export function semanticDebtId(failure: ReviewFailureFact): string {
  return `semantic-debt:${canonicalDigest({ contract: failure.contract, bindingDigest: failure.bindingDigest, callId: failure.callId, sourceEntryId: failure.sourceEntryId })}`;
}
export function legacyNativeDebtId(failure: NativeHistoryFailure, incarnationId: string): string {
  return `native-failure:${canonicalDigest({ incarnationId, callId: failure.callId, resultEntryId: failure.resultEntryId, inputDigest: failure.inputDigest })}`;
}

/** Lifecycle/source facts classify debt only; neither native success nor this catalogue is semantic approval. */
export function historicalDebtCatalogue(options: TaskVerificationRuntimeOptions, context: unknown, incarnationId: string,
  failures: readonly ReviewFailureFact[], resolved: (debtId: string) => boolean, committed: (contract: ContractReference) => boolean): HistoricalDebtCatalogue | undefined {
  const branch = readHostBranch(context); const projection = options.contracts.projection(context);
  if (!branch || !projection) return undefined;
  const contracts = projection.contractRevisions.filter(contract => contract.incarnationId === incarnationId);
  const successes = projection.nativeSuccesses.filter(success => success.targets.some(target => target.before?.incarnationId === incarnationId || target.after?.incarnationId === incarnationId));
  const nativeFailures = projection.nativeFailures.filter(failure => failure.targets.some(target => target.before?.incarnationId === incarnationId || target.after?.incarnationId === incarnationId));
  const current = projection.incarnations.find(reference => reference.incarnationId === incarnationId);
  const refs: NativeIncarnationReference[] = [...successes, ...nativeFailures].flatMap(result => result.targets.flatMap(target => [target.before, target.after].filter((reference): reference is NativeIncarnationReference => reference?.incarnationId === incarnationId)));
  const incarnation = current ?? refs.find(reference => reference.creationKnown) ?? (contracts[0] ? { incarnationId, creation: contracts[0].creation, target: contracts[0].target, creationKnown: true } : undefined);
  if (!incarnation?.creationKnown) return undefined;
  const phase = current && projection.nativePhases?.[current.target.phaseOrdinal];
  const task = current && phase?.tasks[current.target.ordinal];
  const present = current && phase?.name === current.target.phase && task?.content === current.target.content;
  const removed = !current && successes.some(success => success.targets.some(target => target.before?.incarnationId === incarnationId && target.after?.incarnationId !== incarnationId));
  const lifecycle: HistoricalDebtCatalogue["lifecycle"] = !projection.nativeStateReliable ? "unknown" : present && task
    ? task.status === "completed" || task.status === "abandoned" ? task.status : "open"
    : removed ? "removed" : "unknown";
  const debts: HistoricalDebtRecord[] = [];
  for (const failure of failures) {
    if (failure.status !== "REJECTED" || failure.contract.incarnationId !== incarnationId) continue;
    const debtId = semanticDebtId(failure);
    if (!resolved(debtId)) debts.push({ debtId, kind: "semantic_rejection", contract: failure.contract, criterionIds: failure.criterionIds,
      reasons: failure.reasons, sourceEntryId: failure.sourceEntryId, callId: failure.callId, bindingDigest: failure.bindingDigest, rawJev: failure.rawJev });
  }
  for (const debt of projection.debt) if (debt.contract.incarnationId === incarnationId && !committed(debt.contract) && !resolved(debt.debtId)) {
    debts.push({ debtId: debt.debtId, kind: "contract_debt", contract: debt.contract, criterionIds: debt.criterionIds, reasons: [debt.reason], sourceEntryId: debt.sourceEntryId });
  }
  const resultOrder = new Map(branch.entries.map((entry, index) => [entry.id, index]));
  for (const failure of nativeFailures) {
    const debtId = legacyNativeDebtId(failure, incarnationId);
    const failedAt = resultOrder.get(failure.resultEntryId);
    const laterSuccess = failedAt !== undefined && successes.some(success => success.operation === "done" && (resultOrder.get(success.resultEntryId) ?? -1) > failedAt
      && success.targets.some(target => target.completionReported && target.before?.incarnationId === incarnationId && target.after?.incarnationId === incarnationId && target.afterStatus === "completed"));
    if (!laterSuccess && !resolved(debtId)) debts.push({ debtId, kind: "unclassified_native_failure", criterionIds: [],
      reasons: ["Actual native tool failure remains unclassified. No criterion violation, JEV probability or unrelated implementation deficit was inferred."], sourceEntryId: failure.resultEntryId, callId: failure.callId });
  }
  return freezeContractValue({ incarnation, lifecycle, contracts, debts,
    nativeProvenanceDigest: canonicalDigest({ incarnation, present: present ? task : null, successes, nativeFailures }) });
}
