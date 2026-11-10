import type { AblationSpec, Attempt, CorpusCase, Episode } from "./jev-paired-types";
import { digest } from "./jev-paired-validation";
export interface AblationIdentity { status:"complete"|"unavailable"|"invalid"; reason:string|null; baselineEpisodes:number; variantEpisodes:number; hQuestionStateDigest:string|null }
export function ablationIdentity(spec: AblationSpec, cases: CorpusCase[], episodes: Episode[], attempts: Attempt[]): AblationIdentity {
  const baseline = episodes.filter(e => spec.baselineCaseIds.includes(e.caseId)), variants = episodes.filter(e => spec.caseIds.includes(e.caseId));
  const base = { baselineEpisodes:baseline.length,variantEpisodes:variants.length,hQuestionStateDigest:null };
  if (baseline.length !== spec.baselineCaseIds.length*2 || variants.length !== spec.caseIds.length*2 || [...baseline,...variants].some(e => e.status !== "terminal")) return { ...base,status:"unavailable",reason:"independent_ablation_executions_incomplete" };
  if (spec.caseIds.some(id => cases.find(c => c.id === id)?.canonical)) return { ...base,status:"invalid",reason:"ablation_variant_must_not_inflate_primary_independent_cohort" };
  if (spec.kind !== "batching") return { ...base,status:"complete",reason:null };
  const signatures = (caseId:string): string | null => {
    const e = episodes.find(e => e.caseId === caseId && e.arm === "H");
    if (!e) return null;
    const actual = attempts.filter(a => e.attemptIds.includes(a.receiptId) && a.role === "jev");
    if (!actual.length || actual.some(a => !a.questionStateDigests)) return null;
    const questions = new Map<string,string>();
    for (const a of actual) for (const [id,identity] of Object.entries(a.questionStateDigests ?? {})) {
      const old = questions.get(id); if (old && old !== identity) return null; questions.set(id,identity);
    }
    return digest(JSON.stringify([...questions.entries()].sort(([a],[b]) => a.localeCompare(b))));
  };
  const hashes = [...spec.baselineCaseIds,...spec.caseIds].map(signatures);
  if (hashes.some(x => x === null)) return { ...base,status:"unavailable",reason:"prepared_per_question_state_identity_missing" };
  if (!spec.stateQuestionDigest || hashes.some(x => x !== spec.stateQuestionDigest)) return { ...base,status:"invalid",reason:"not_pure_batching_state_or_questions_changed_use_context_selection_experiment" };
  return { ...base,status:"complete",reason:null,hQuestionStateDigest:spec.stateQuestionDigest };
}
