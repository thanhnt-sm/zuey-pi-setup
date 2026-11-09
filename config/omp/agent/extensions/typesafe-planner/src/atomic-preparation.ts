import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import type { TaskContract, ReviewBinding } from "./types/verification";
import type { JudgeEvidencePacketSetResult } from "./judge-evidence-packet";
import type { ReviewSnapshot } from "./advisor-protocol";
import type { AtomicInput, DeterministicCheck, PredicateSpec } from "./atomic-judge";
import { createAtomicParentPredicates } from "./atomic-parent";

export interface AtomicPreparationOptions {
  contract: TaskContract; packetSet: JudgeEvidencePacketSetResult; binding: ReviewBinding; snapshot: ReviewSnapshot; model: string;
  predicates?: readonly PredicateSpec[];
}
/** Mapping retains every original obligation; generated predicates can add detail, never replace criteria. */
export function prepareAtomicInput(options: AtomicPreparationOptions): AtomicInput {
  const { contract, packetSet, binding, snapshot } = options;
  if (canonicalDigest(packetSet.manifest.criteria) !== canonicalDigest(contract.criteria) || packetSet.manifest.contractDigest !== canonicalDigest(contract)
    || snapshot.contractDigest !== canonicalDigest(contract) || snapshot.policyDigest !== contract.policyDigest
    || snapshot.evidenceDigest !== binding.provenance.evidenceDigest || snapshot.policyDigest !== binding.provenance.policyDigest
    || binding.purpose === "shadow" && binding.corpus.contractDigest !== snapshot.contractDigest
    || (binding.purpose === "task_review" || binding.purpose === "parent_review") && (binding.contract.contractId !== contract.contractId || binding.contract.revisionId !== contract.revisionId || binding.contract.incarnationId !== contract.incarnationId)
    || packetSet.packets.some(({ packet, digest }) => digest !== canonicalDigest(packet) || packet.binding.contractId !== contract.contractId
      || packet.binding.revisionId !== contract.revisionId || packet.binding.incarnationId !== contract.incarnationId
      || packet.binding.originalRequestDigest !== contract.originalUserRequest.digest || packet.binding.policyDigest !== contract.policyDigest
      || packet.snapshots.evaluatedTreeDigest !== snapshot.treeDigest || packet.criteria.some(criterion => !contract.criteria.some(original => canonicalDigest(original) === canonicalDigest(criterion))))) throw new Error("atomic_preparation_contract_mismatch");
  const children: readonly PredicateSpec[] = options.predicates ?? packetSet.packets.flatMap(({ packet, digest }) => packet.criteria.map(criterion => ({
    id: `q_${canonicalDigest({ criterionId: criterion.id, claim: criterion.text, packet: digest }).slice(0, 32)}`, criterionId: criterion.id, claim: criterion.text, packetDigest: digest,
    evidenceRefs: [...new Set(packet.obligations.filter(o => o.criterionId === criterion.id && o.kind !== "deterministic").flatMap(o => o.evidenceIds))],
    counterevidenceRefs: [...packet.counterevidence], applicability: "applicable" as const, answerType: "relation" as const,
    groupKey: criterion.kind === "parent_integration" ? "parent-integration" : "contract-evidence", dependsOn: [],
  })));
  const predicates = options.predicates ?? [...children, ...createAtomicParentPredicates(packetSet, children)];
  const deterministicChecks: DeterministicCheck[] = [];
  const receipts = new Set<string>();
  for (const { packet } of packetSet.packets) if (packet.verification && !receipts.has(packet.verification.receiptId)) {
    const verification = packet.verification; receipts.add(verification.receiptId);
    for (const criterionId of verification.criterionIds) {
      if (!contract.criteria.some(c => c.id === criterionId)) throw new Error("atomic_foreign_test_criterion");
      deterministicChecks.push({ id: `exit:${verification.commandId}:${criterionId}`, criterionId, kind: "exit_status", actual: verification.result.exitCode, expected: 0 },
        { id: `tree:${verification.commandId}:${criterionId}`, criterionId, kind: "digest", actual: verification.stableTreeDigest, expected: snapshot.treeDigest },
        { id: `tests:${verification.commandId}:${criterionId}`, criterionId, kind: "exact", actual: verification.testAssetsBefore, expected: verification.testAssetsAfter });
    }
  }
  return freezeContractValue({ binding, snapshot, criteria: contract.criteria, packetSet,
    rubricDigest: canonicalDigest({ version: "atomic-relations-v1", predicates }), predicates, deterministicChecks, model: options.model });
}
