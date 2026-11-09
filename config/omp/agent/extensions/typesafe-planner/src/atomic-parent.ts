import { canonicalDigest } from "./task-contract-source";
import type { AtomicInput, AtomicOutcome, PredicateSpec } from "./atomic-judge";
import type { JudgeEvidencePacketSetResult } from "./judge-evidence-packet";

export function createAtomicParentPredicates(packetSet: JudgeEvidencePacketSetResult, children: readonly PredicateSpec[]): PredicateSpec[] {
  return packetSet.manifest.parentRequirements.flatMap(parent => {
    const selected = packetSet.packets.find(({ packet }) => packet.integrationReceipts?.some(receipt => receipt.parentContractId === parent.parentContractId && receipt.criterionId === parent.criterionId)) ?? packetSet.packets[0];
    if (!selected?.packet.criteria.length) return [];
    const parentRequirementId = `parent:${parent.parentContractId}:${parent.criterionId}`;
    return [{ id: `parent_${canonicalDigest({ parentRequirementId, packet: selected.digest }).slice(0, 32)}`,
      criterionId: selected.packet.criteria[0].id, parentRequirementId, claim: parent.source.text, packetDigest: selected.digest,
      evidenceRefs: [...new Set([...selected.packet.obligations.filter(obligation => obligation.criterionId === selected.packet.criteria[0].id && obligation.kind !== "deterministic").flatMap(obligation => obligation.evidenceIds),
        ...(selected.packet.integrationReceipts ?? []).filter(receipt => receipt.parentContractId === parent.parentContractId && receipt.criterionId === parent.criterionId).map(receipt => receipt.receiptId)])],
      counterevidenceRefs: [...selected.packet.counterevidence], applicability: "applicable" as const, answerType: "relation" as const,
      groupKey: `parent-integration:${parentRequirementId}`, dependsOn: children.map(child => child.id) }];
  });
}
export function parentPredicateState(input: AtomicInput, specs: readonly PredicateSpec[], dependencies: readonly AtomicOutcome[]): unknown {
  const targets = specs.flatMap(spec => input.packetSet.manifest.parentRequirements.filter(parent => spec.parentRequirementId === `parent:${parent.parentContractId}:${parent.criterionId}`));
  if (!targets.length) return undefined;
  return { requirements: targets, originalChildCriteria: input.criteria,
    dependencyClaims: input.predicates.filter(predicate => dependencies.some(outcome => outcome.predicateId === predicate.id)).map(predicate => ({ id: predicate.id, criterionId: predicate.criterionId, claim: predicate.claim, packetDigest: predicate.packetDigest, evidenceRefs: predicate.evidenceRefs })),
    coverage: "Parent integration is independent of each child's individual pass. Typed dependency outcomes do not substitute for missing integration proof or global source investigation." };
}
