import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import type { PredicateSpec, AtomicRelation } from "./atomic-judge";
export type AtomicNoulSemanticMode = "open_world_support" | "closed_world_boolean" | "counterevidence";
interface NoulUncertainty { uncertainty: "strict_boundary_or_missing_evidence_insufficient" }
export type AtomicNoulDecisionPolicy = NoulUncertainty & (
  | { semanticMode: "support_only"; orientation: "support_probability"; supportsAbove: number }
  | { semanticMode: "counterevidence_only"; orientation: "contradiction_probability"; contradictsAbove: number }
  | { semanticMode: "closed_world_boolean"; orientation: "support_probability"; supportsAbove: number; contradictsBelow: number }
);
export interface AtomicPredicateDecisionPolicy {
  schemaVersion: 1; categorical: "declared_relations";
  noul?: AtomicNoulDecisionPolicy; byPredicate?: Readonly<Record<string, AtomicNoulDecisionPolicy>>;
}
export interface AtomicDecisionEvidence {
  id: string; semanticMode: AtomicNoulSemanticMode; applicability: PredicateSpec["applicability"];
  evidenceRefs: readonly string[]; counterevidenceRefs: readonly string[];
}
export type AtomicDecisionPolicyResolution = { ok: true; policy: AtomicPredicateDecisionPolicy; digest: string } | { ok: false; code: "atomic_decision_policy_invalid" };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const probability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
function validNoul(raw: unknown): raw is AtomicNoulDecisionPolicy {
  if (!object(raw) || raw.uncertainty !== "strict_boundary_or_missing_evidence_insufficient") return false;
  const keys = ["semanticMode", "orientation", "uncertainty"];
  if (raw.semanticMode === "support_only" && raw.orientation === "support_probability" && probability(raw.supportsAbove)) keys.push("supportsAbove");
  else if (raw.semanticMode === "counterevidence_only" && raw.orientation === "contradiction_probability" && probability(raw.contradictsAbove)) keys.push("contradictsAbove");
  else if (raw.semanticMode === "closed_world_boolean" && raw.orientation === "support_probability" && probability(raw.supportsAbove) && probability(raw.contradictsBelow) && raw.contradictsBelow <= raw.supportsAbove) keys.push("supportsAbove", "contradictsBelow");
  else return false;
  return Object.keys(raw).every(key => keys.includes(key));
}
/** Only trusted factory options enter here. No model or request payload can select an operating point. */
export function resolveAtomicDecisionPolicy(raw?: unknown): AtomicDecisionPolicyResolution {
  const value = raw ?? { schemaVersion: 1, categorical: "declared_relations" };
  if (!object(value) || value.schemaVersion !== 1 || value.categorical !== "declared_relations" || Object.keys(value).some(key => !["schemaVersion", "categorical", "noul", "byPredicate"].includes(key))
    || value.noul !== undefined && !validNoul(value.noul)
    || value.byPredicate !== undefined && (!object(value.byPredicate) || Object.entries(value.byPredicate).some(([id, policy]) => !id.trim() || !validNoul(policy)))) return { ok: false, code: "atomic_decision_policy_invalid" };
  const policy = freezeContractValue(structuredClone(value)) as unknown as AtomicPredicateDecisionPolicy;
  return { ok: true, policy, digest: canonicalDigest(policy) };
}
export function atomicDecisionEvidence(spec: PredicateSpec): AtomicDecisionEvidence {
  return { id: spec.id, semanticMode: spec.semanticMode ?? "open_world_support", applicability: spec.applicability, evidenceRefs: spec.evidenceRefs, counterevidenceRefs: spec.counterevidenceRefs };
}
export function atomicNoulPolicy(policy: AtomicPredicateDecisionPolicy, id: string): AtomicNoulDecisionPolicy | undefined { return policy.byPredicate?.[id] ?? policy.noul; }
export function atomicNoulPolicyApplies(spec: PredicateSpec, policy: AtomicPredicateDecisionPolicy): boolean {
  const selected = atomicNoulPolicy(policy, spec.id);
  return spec.answerType !== "noul" || selected !== undefined && (selected.semanticMode !== "closed_world_boolean" || spec.semanticMode === "closed_world_boolean")
    && (selected.semanticMode !== "counterevidence_only" || spec.semanticMode === "counterevidence");
}
export function decideAtomicNoul(score: number, evidence: AtomicDecisionEvidence, policy: AtomicPredicateDecisionPolicy): AtomicRelation {
  if (!probability(score) || evidence.applicability !== "applicable" || !evidence.evidenceRefs.length) return "insufficient";
  const selected = atomicNoulPolicy(policy, evidence.id);
  if (!selected) return "insufficient";
  if (selected.semanticMode === "counterevidence_only") return evidence.semanticMode === "counterevidence" && evidence.counterevidenceRefs.length > 0 && score > selected.contradictsAbove ? "contradicts" : "insufficient";
  if (score > selected.supportsAbove) return "supports";
  // Low P(support) is not a contradiction under open-world/missing-evidence semantics.
  if (selected.semanticMode === "closed_world_boolean" && evidence.semanticMode === "closed_world_boolean" && score < selected.contradictsBelow) return "contradicts";
  return "insufficient";
}
export function validAtomicDecisionEvidence(raw: unknown): raw is AtomicDecisionEvidence {
  return object(raw) && typeof raw.id === "string" && !!raw.id && ["open_world_support", "closed_world_boolean", "counterevidence"].includes(String(raw.semanticMode))
    && ["applicable", "not_applicable", "unknown"].includes(String(raw.applicability))
    && Array.isArray(raw.evidenceRefs) && raw.evidenceRefs.every(ref => typeof ref === "string" && !!ref)
    && Array.isArray(raw.counterevidenceRefs) && raw.counterevidenceRefs.every(ref => typeof ref === "string" && !!ref);
}
