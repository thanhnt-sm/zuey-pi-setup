import { createRequire } from "node:module";
import { canonicalDigest, freezeContractValue, isDigest, nonempty } from "./task-contract-source";
import type { ReviewBinding, ContractCriterion } from "./types/verification";
import { isReviewSnapshot, type ReviewSnapshot } from "./advisor-protocol";
import { createEvidenceStateValidator, type JudgeEvidencePacketSetResult, type PreparedPacketBody } from "./judge-evidence-packet";
import { runAtomicDeterministicChecks } from "./atomic-checks";
import { parentPredicateState } from "./atomic-parent";
import { resolveAtomicDecisionPolicy, atomicDecisionEvidence, atomicNoulPolicy, atomicNoulPolicyApplies, decideAtomicNoul, validAtomicDecisionEvidence, type AtomicPredicateDecisionPolicy, type AtomicDecisionEvidence, type AtomicNoulSemanticMode } from "./atomic-decision-policy";

export type AtomicRelation = "supports" | "contradicts" | "insufficient";
export interface PredicateSpec {
  id: string; criterionId: string; claim: string; packetDigest: string; evidenceRefs: readonly string[]; counterevidenceRefs: readonly string[];
  /** Independent parent target; criterionId only anchors the selected child packet, never rewrites the child criterion. */
  parentRequirementId?: string;
  applicability: "applicable" | "not_applicable" | "unknown"; answerType: "relation" | "noul";
  semanticMode?: AtomicNoulSemanticMode;
  /** Identical state/coherence key, not probabilistic independence. */
  groupKey: string; dependsOn: readonly string[];
}
export type DeterministicCheck =
  | { id: string; criterionId: string; kind: "exit_status"; actual: number | null; expected: number }
  | { id: string; criterionId: string; kind: "digest"; actual: string; expected: string }
  | { id: string; criterionId: string; kind: "exact"; actual: unknown; expected: unknown };
export interface AtomicInput {
  binding: ReviewBinding; snapshot: ReviewSnapshot; criteria: readonly ContractCriterion[];
  /** Complete original-obligation manifest plus host-curated independently bounded packets. */
  packetSet: JudgeEvidencePacketSetResult; rubricDigest: string;
  predicates: readonly PredicateSpec[]; deterministicChecks: readonly DeterministicCheck[]; model: string;
}
export interface AtomicOutcome { predicateId: string; criterionId: string; parentRequirementId?: string; relation: AtomicRelation; probability?: number; confidence?: number; decisionEvidence?: AtomicDecisionEvidence; packetId: string }
export interface AtomicAttempt {
  packetId: string; policyIdentity: string; questionIds: readonly string[]; questionCount: number;
  bodyBytes?: number; bodyDigest?: string; attempts?: unknown; requestedModel: string; resolvedModel?: string;
  usage?: unknown; attemptReceipts?: unknown; provider?: string; startedAt: number; endedAt?: number; error?: string;
}
export interface AtomicReviewReceipt {
  schemaVersion: 1; receiptId: string; binding: ReviewBinding; bindingDigest: string; snapshot: ReviewSnapshot;
  packetDigest: string; rubricDigest: string; policyDigest: string; requestedModel: string;
  decisionPolicy?: AtomicPredicateDecisionPolicy; decisionPolicyDigest?: string;
  outcomes: readonly AtomicOutcome[]; deterministic: readonly { id: string; criterionId: string; passed: boolean }[];
  manifest: readonly { id: string; criteria: readonly string[]; predicateIds: readonly string[]; packetDigest: string }[];
  uncoveredCriterionIds: readonly string[]; contradictedCriterionIds: readonly string[];
  uncoveredParentRequirementIds: readonly string[]; uncoveredArtifactPaths: readonly string[];
  parentRequirementIds: readonly string[]; contradictedParentRequirementIds: readonly string[];
  attempts: readonly AtomicAttempt[]; status: "supported" | "contradicted" | "insufficient" | "unavailable"; failureCode?: string;
}
export interface AtomicJudgeOptions { trustedPolicy?: unknown; predicateDecisionPolicy?: AtomicPredicateDecisionPolicy; apiKey?: string; fetchImpl?: typeof fetch }
export interface AtomicJudge { review(input: AtomicInput, signal?: AbortSignal): Promise<AtomicReviewReceipt> }
interface TrustedPolicy { ok: true; purpose: string; policyIdentity: string; maxQuestionsPerRequest: number; provider: { allowedModels: readonly string[] }; semanticReviewLimits: { maxPackets: number; maxDispatches: number; deadlineMs: number; maxActive: number; maxQueued: number } }
interface ReviewJob { signal: AbortSignal; admitPacket(id: string): { ok: boolean; code?: string }; markCovered(id: string): void }
interface TransportResult { ok: boolean; code?: string; answers?: Record<string, { choice?: string; noul?: number; confidence?: number }>; metadata?: { policyIdentity?: string; bodyBytes?: number; bodyDigest?: string; attempts?: unknown; attemptReceipts?: unknown; provider?: string; resolvedModel?: string; usage?: unknown } }
interface Scheduler { run(manifest: readonly { id: string; criteria: readonly string[] }[], worker: (job: ReviewJob) => Promise<{ ok: boolean }>, options: { signal?: AbortSignal }): Promise<{ ok: boolean; code?: string }> }
interface SharedClient {
  resolveTrustedToolPolicy(purpose: string, supplied?: unknown): TrustedPolicy | { ok: false; code: string };
  createSemanticReviewScheduler(policy: TrustedPolicy): Scheduler;
  judgeWithPolicy(options: { args: { state: unknown; questions: Record<string, unknown>; model: string }; trustedPolicy: TrustedPolicy; purpose: string; apiKey?: string; fetchImpl?: typeof fetch; signal: AbortSignal; reviewJob: ReviewJob; validatePrepared(prepared: PreparedPacketBody): { ok: true } | { ok: false; code: string } }): Promise<TransportResult>;
}
function loadPolicyClient(): SharedClient | undefined {
  try {
    const client = createRequire(import.meta.url)("./typesafe-policy-client.cjs") as SharedClient;
    return client && typeof client.resolveTrustedToolPolicy === "function" && typeof client.createSemanticReviewScheduler === "function"
      && typeof client.judgeWithPolicy === "function" ? client : undefined;
  } catch { return undefined; }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function createAtomicJudge(options: AtomicJudgeOptions = {}): AtomicJudge {
  const client = loadPolicyClient();
  const policy = client?.resolveTrustedToolPolicy("evaluation", options.trustedPolicy) ?? { ok: false as const, code: "policy_client_unavailable" };
  const scheduler = policy.ok && client ? client.createSemanticReviewScheduler(policy) : undefined;
  const decision = resolveAtomicDecisionPolicy(options.predicateDecisionPolicy);
  const decisionPolicy = decision.ok ? decision.policy : undefined;
  async function review(input: AtomicInput, signal?: AbortSignal): Promise<AtomicReviewReceipt> {
    input = freezeContractValue(structuredClone(input));
    if (!input.criteria.length || new Set(input.criteria.map(c => c.id)).size !== input.criteria.length || !isReviewSnapshot(input.snapshot)
      || !isDigest(input.rubricDigest) || input.packetSet.manifest.contractDigest !== input.snapshot.contractDigest
      || input.packetSet.manifest.evidenceDigest !== input.snapshot.evidenceDigest
      || canonicalDigest(input.packetSet.manifest.packets.map(packet => packet.digest)) !== canonicalDigest(input.packetSet.packets.map(packet => packet.digest))
      || canonicalDigest(input.packetSet.manifest.criteria) !== canonicalDigest(input.criteria)
      || input.packetSet.packets.some(({ packet, digest }) => digest !== canonicalDigest(packet) || packet.snapshots.evaluatedTreeDigest !== input.snapshot.treeDigest
        || packet.criteria.some(criterion => !input.criteria.some(original => canonicalDigest(original) === canonicalDigest(criterion))))
      || input.snapshot.policyDigest !== input.binding.provenance.policyDigest || input.snapshot.evidenceDigest !== input.binding.provenance.evidenceDigest) throw new Error("atomic_input_binding_invalid");
    if (input.binding.purpose === "shadow" && input.binding.authorizedScope.operations.some(operation => operation !== "read")) throw new Error("shadow_mutation_scope_forbidden");
    const binding = input.binding;
    if (binding.purpose === "parent_review" && (binding.parentObligationIds.length !== input.criteria.length
      || input.criteria.some(criterion => !binding.parentObligationIds.includes(criterion.id)))) throw new Error("atomic_original_parent_coverage_required");
    const known = new Set(input.criteria.map(c => c.id));
    const ids = new Set(input.predicates.map(p => p.id));
    const packets = new Map(input.packetSet.packets.map(entry => [entry.digest, entry.packet]));
    const parentRequirements = new Map(input.packetSet.manifest.parentRequirements.map(parent => [`parent:${parent.parentContractId}:${parent.criterionId}`, parent]));
    if (ids.size !== input.predicates.length || input.predicates.some(p => !known.has(p.criterionId) || !nonempty(p.id) || !nonempty(p.claim) || !nonempty(p.groupKey)
      || !["applicable", "not_applicable", "unknown"].includes(p.applicability) || !["relation", "noul"].includes(p.answerType)
      || p.semanticMode !== undefined && !["open_world_support", "closed_world_boolean", "counterevidence"].includes(p.semanticMode)
      || ![...p.evidenceRefs, ...p.counterevidenceRefs].every(nonempty) || p.dependsOn.some(id => !ids.has(id) || id === p.id)
      || !packets.has(p.packetDigest) || !packets.get(p.packetDigest)!.criteria.some(criterion => criterion.id === p.criterionId)
      || p.parentRequirementId !== undefined && !parentRequirements.has(p.parentRequirementId)
      || p.evidenceRefs.some(ref => !packets.get(p.packetDigest)!.obligations.some(obligation => obligation.criterionId === p.criterionId && obligation.evidenceIds.includes(ref))
        && !(p.parentRequirementId && packets.get(p.packetDigest)!.integrationReceipts?.some(receipt => ref === receipt.receiptId && p.parentRequirementId === `parent:${receipt.parentContractId}:${receipt.criterionId}`)))
      || p.counterevidenceRefs.some(ref => !packets.get(p.packetDigest)!.counterevidence.includes(ref)))
      || input.deterministicChecks.some(c => !known.has(c.criterionId))) throw new Error("atomic_predicate_invalid");
    const deterministic = runAtomicDeterministicChecks(input.deterministicChecks);
    const manifests: { id: string; criteria: string[]; predicateIds: string[]; packetDigest: string }[] = [];
    const pending = [...input.predicates];
    const planned = new Set<string>();
    const maxQuestions = policy.ok ? policy.maxQuestionsPerRequest : 128;
    while (pending.length) {
      const ready = pending.filter(p => p.dependsOn.every(id => planned.has(id)));
      if (!ready.length) throw new Error("atomic_dependency_cycle");
      const first = ready[0];
      const independent = ready.filter(p => p.packetDigest === first.packetDigest && p.groupKey === first.groupKey && canonicalDigest(p.dependsOn) === canonicalDigest(first.dependsOn)).slice(0, maxQuestions);
      const packet = { id: `packet_${canonicalDigest({ index: manifests.length, predicateIds: independent.map(p => p.id), packet: first.packetDigest })}`, packetDigest: first.packetDigest, criteria: [...new Set(independent.map(p => p.criterionId))], predicateIds: independent.map(p => p.id) };
      manifests.push(packet);
      for (const p of independent) { planned.add(p.id); pending.splice(pending.indexOf(p), 1); }
    }
    const outcomes: AtomicOutcome[] = []; const attempts: AtomicAttempt[] = [];
    let failureCode: string | undefined;
    const inFlight: { current?: { index: number; promise: Promise<TransportResult> } } = {};
    if (!decision.ok || !decisionPolicy) failureCode = "atomic_decision_policy_invalid";
    else if (input.predicates.some(spec => spec.answerType === "noul" && atomicNoulPolicy(decisionPolicy, spec.id) && !atomicNoulPolicyApplies(spec, decisionPolicy))) failureCode = "atomic_noul_semantics_policy_mismatch";
    else if (!policy.ok || !scheduler) failureCode = "policy_invalid";
    else if (!policy.provider.allowedModels.includes(input.model)) failureCode = "model_policy_invalid";
    else if (manifests.length) {
      const jobResult = await scheduler.run(manifests, async job => {
        for (const manifest of manifests) {
          const admitted = job.admitPacket(manifest.id);
          if (!admitted.ok) { failureCode = admitted.code; return { ok: false }; }
          const specs = manifest.predicateIds.map(id => input.predicates.find(p => p.id === id)!);
          const selectedPacket = packets.get(manifest.packetDigest)!;
          if (selectedPacket.omissions.some(omission => omission.required)) { failureCode = "EVIDENCE_REQUIRED"; return { ok: false }; }
          const dependencies = outcomes.filter(outcome => specs.some(p => p.dependsOn.includes(outcome.predicateId)));
          const questions: Record<string, unknown> = {};
          for (const p of specs) questions[p.id] = p.answerType === "relation" ? { type: "choice", instructions: `Assess only this relation: ${p.claim}. Evidence references: ${JSON.stringify(p.evidenceRefs)}. Counterevidence: ${JSON.stringify(p.counterevidenceRefs)}. Applicability: ${p.applicability}. An excerpt never establishes global absence. Missing or conflicting proof is insufficient.`, criteria: { supports: "Evidence establishes the claim and applicability with counterevidence resolved", contradicts: "Evidence establishes a contradiction", insufficient: "Missing, inapplicable, ambiguous, or conflicting evidence" } }
            : { type: "noul", instructions: `Probability that the cited ${atomicNoulPolicy(decisionPolicy, p.id)?.orientation === "contradiction_probability" ? "actual counterevidence contradicts" : "evidence supports"} this exact claim: ${p.claim}. Do not treat absent evidence as proof. References ${JSON.stringify(p.evidenceRefs)}; counterevidence ${JSON.stringify(p.counterevidenceRefs)}.` };
          const parentIntegration = parentPredicateState(input, specs, dependencies);
          const state = { evidence_packet: selectedPacket, packetDigest: manifest.packetDigest, originalManifestDigest: canonicalDigest(input.packetSet.manifest), dependencies, dependencyDigest: canonicalDigest(dependencies), snapshot: input.snapshot, decisionPolicyDigest: decision.ok ? decision.digest : undefined,
            ...(parentIntegration ? { parent_integration: parentIntegration } : {}) };
          const startedAt = Date.now();
          const attemptIndex = attempts.length;
          attempts.push({ packetId: manifest.id, policyIdentity: policy.policyIdentity, questionIds: specs.map(p => p.id), questionCount: specs.length, requestedModel: input.model, startedAt });
          let result: TransportResult;
          try {
            const promise = client.judgeWithPolicy({ args: { state, questions, model: input.model }, trustedPolicy: policy, purpose: "evaluation", apiKey: options.apiKey, fetchImpl: options.fetchImpl, signal: job.signal, reviewJob: job, validatePrepared: createEvidenceStateValidator(state, { apiKey: options.apiKey }) });
            inFlight.current = { index: attemptIndex, promise };
            result = await promise;
          } catch {
            if (job.signal.aborted) return { ok: false };
            attempts[attemptIndex] = { ...attempts[attemptIndex], endedAt: Date.now(), error: "atomic_transport_unavailable" };
            failureCode = "atomic_transport_unavailable"; return { ok: false };
          }
          if (job.signal.aborted) return { ok: false };
          attempts[attemptIndex] = { ...attempts[attemptIndex], ...result.metadata, endedAt: Date.now(), ...(!result.ok ? { error: result.code ?? "atomic_transport_invalid" } : {}) };
          inFlight.current = undefined;
          if (!result.ok || !result.answers || result.metadata?.policyIdentity !== policy.policyIdentity) { failureCode = result.code ?? "atomic_transport_invalid"; return { ok: false }; }
          const packetOutcomes: AtomicOutcome[] = [];
          for (const p of specs) {
            const answer = result.answers[p.id];
            if (!answer || (p.answerType === "relation" ? !["supports", "contradicts", "insufficient"].includes(answer.choice ?? "") : typeof answer.noul !== "number" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)
              || answer.confidence !== undefined && (typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) { failureCode = "atomic_answer_invalid"; return { ok: false }; }
            // Thresholds are applied only here under the predeclared trusted operating point, never by the judge.
            const evidence = p.answerType === "noul" ? atomicDecisionEvidence(p) : undefined;
            const relation: AtomicRelation = evidence ? decideAtomicNoul(answer.noul!, evidence, decisionPolicy)
              : p.applicability !== "applicable" || !p.evidenceRefs.length ? "insufficient" : answer.choice as AtomicRelation;
            packetOutcomes.push({ predicateId: p.id, criterionId: p.criterionId, ...(p.parentRequirementId ? { parentRequirementId: p.parentRequirementId } : {}), relation, packetId: manifest.id,
              ...(evidence ? { probability: answer.noul, decisionEvidence: evidence } : {}), ...(typeof answer.confidence === "number" ? { confidence: answer.confidence } : {}) });
          }
          outcomes.push(...packetOutcomes); job.markCovered(manifest.id);
        }
        return { ok: true };
      }, { signal });
      if (!jobResult.ok) failureCode ??= jobResult.code ?? "atomic_review_unavailable";
      // Drain only the already-aborted canonical transport, never issue another dispatch.
      // This retains paid-attempt receipts even when the scheduler deadline settles first.
      if (inFlight.current) {
        const pending = inFlight.current;
        try {
          const result = await pending.promise;
          attempts[pending.index] = { ...attempts[pending.index], ...result.metadata, endedAt: Date.now(), error: failureCode ?? "cancelled" };
        } catch {
          attempts[pending.index] = { ...attempts[pending.index], endedAt: Date.now(), error: failureCode ?? "atomic_transport_unavailable" };
        }
      }
    }
    const contradictedCriterionIds = [...known].filter(id => deterministic.some(c => c.criterionId === id && !c.passed) || outcomes.some(o => o.criterionId === id && !o.parentRequirementId && o.relation === "contradicts"));
    const uncoveredCriterionIds = [...known].filter(id => {
      const checks = deterministic.filter(c => c.criterionId === id); const specs = input.predicates.filter(p => p.criterionId === id && !p.parentRequirementId);
      return !specs.length || specs.some(p => !outcomes.some(o => o.predicateId === p.id && o.relation === "supports")) || checks.some(c => !c.passed);
    });
    const parentRequirementIds = [...parentRequirements.keys()];
    const contradictedParentRequirementIds = parentRequirementIds.filter(id => outcomes.some(outcome => outcome.parentRequirementId === id && outcome.relation === "contradicts"));
    const uncoveredParentRequirementIds = parentRequirementIds.filter(id => input.packetSet.manifest.uncoveredParentRequirementIds.includes(id)
      || !input.predicates.some(predicate => predicate.parentRequirementId === id)
      || input.predicates.some(predicate => predicate.parentRequirementId === id && !outcomes.some(outcome => outcome.predicateId === predicate.id && outcome.relation === "supports")));
    const uncoveredArtifactPaths = [...input.packetSet.manifest.uncoveredArtifactPaths];
    const evidenceLimited = failureCode !== undefined && ["EVIDENCE_REQUIRED", "payload too large", "question_limit_exceeded", "review_packet_limit", "review_dispatch_limit"].includes(failureCode);
    const body = { schemaVersion: 1 as const, binding: input.binding, bindingDigest: canonicalDigest(input.binding), snapshot: input.snapshot,
      packetDigest: canonicalDigest(input.packetSet.manifest), rubricDigest: input.rubricDigest, policyDigest: input.snapshot.policyDigest, requestedModel: input.model,
      ...(decision.ok ? { decisionPolicy: decision.policy, decisionPolicyDigest: decision.digest } : {}),
      outcomes, deterministic, manifest: manifests, uncoveredCriterionIds, contradictedCriterionIds, uncoveredParentRequirementIds, uncoveredArtifactPaths, parentRequirementIds, contradictedParentRequirementIds, attempts,
      status: contradictedCriterionIds.length || contradictedParentRequirementIds.length ? "contradicted" as const : failureCode && !evidenceLimited ? "unavailable" as const : uncoveredCriterionIds.length || uncoveredParentRequirementIds.length || uncoveredArtifactPaths.length || evidenceLimited ? "insufficient" as const : "supported" as const,
      ...(failureCode ? { failureCode } : {}) };
    return freezeContractValue({ ...body, receiptId: `atomic:${canonicalDigest(body)}` });
  }
  return Object.freeze({ review });
}
export interface AtomicReceiptExpectation { binding: ReviewBinding; snapshot: ReviewSnapshot; criterionIds: readonly string[]; parentRequirementIds?: readonly string[]; packetDigest?: string; rubricDigest?: string; decisionPolicyDigest?: string }
export function validateAtomicReceipt(raw: unknown, expected: AtomicReceiptExpectation): raw is AtomicReviewReceipt {
  if (!object(raw)) return false;
  const { receiptId, ...body } = raw;
  const decision = raw.decisionPolicy === undefined ? undefined : resolveAtomicDecisionPolicy(raw.decisionPolicy);
  const decisionPolicy = decision?.ok ? decision.policy : undefined;
  if (raw.schemaVersion !== 1 || receiptId !== `atomic:${canonicalDigest(body)}` || raw.bindingDigest !== canonicalDigest(expected.binding)
    || canonicalDigest(raw.binding) !== canonicalDigest(expected.binding) || canonicalDigest(raw.snapshot) !== canonicalDigest(expected.snapshot)
    || !isDigest(raw.packetDigest) || !isDigest(raw.rubricDigest) || raw.policyDigest !== expected.snapshot.policyDigest
    || expected.packetDigest !== undefined && raw.packetDigest !== expected.packetDigest
    || expected.rubricDigest !== undefined && raw.rubricDigest !== expected.rubricDigest
    || raw.status !== "unavailable" && !decisionPolicy || raw.decisionPolicy !== undefined && (!decision?.ok || raw.decisionPolicyDigest !== decision.digest)
    || expected.decisionPolicyDigest !== undefined && raw.decisionPolicyDigest !== expected.decisionPolicyDigest
    || !["supported", "contradicted", "insufficient", "unavailable"].includes(String(raw.status))
    || !Array.isArray(raw.outcomes) || !Array.isArray(raw.deterministic) || !Array.isArray(raw.uncoveredCriterionIds)
    || !Array.isArray(raw.contradictedCriterionIds) || !Array.isArray(raw.manifest) || !Array.isArray(raw.attempts)
    || !Array.isArray(raw.uncoveredParentRequirementIds) || !raw.uncoveredParentRequirementIds.every(nonempty)
    || !Array.isArray(raw.parentRequirementIds) || !raw.parentRequirementIds.every(nonempty) || new Set(raw.parentRequirementIds).size !== raw.parentRequirementIds.length
    || !Array.isArray(raw.contradictedParentRequirementIds) || !raw.contradictedParentRequirementIds.every(nonempty)
    || [...raw.uncoveredParentRequirementIds, ...raw.contradictedParentRequirementIds].some(id => !raw.parentRequirementIds.includes(id))
    || expected.parentRequirementIds && canonicalDigest(raw.parentRequirementIds) !== canonicalDigest(expected.parentRequirementIds)
    || !Array.isArray(raw.uncoveredArtifactPaths) || !raw.uncoveredArtifactPaths.every(nonempty)) return false;
  const outcomes = raw.outcomes; const deterministic = raw.deterministic; const uncovered = raw.uncoveredCriterionIds; const manifest = raw.manifest;
  const contradicted = raw.contradictedCriterionIds;
  if (new Set(outcomes.map(outcome => object(outcome) ? outcome.predicateId : undefined)).size !== outcomes.length
    || outcomes.some(outcome => !object(outcome) || !nonempty(outcome.predicateId) || !nonempty(outcome.packetId) || !expected.criterionIds.includes(String(outcome.criterionId))
      || !["supports", "contradicts", "insufficient"].includes(String(outcome.relation))
      || outcome.parentRequirementId !== undefined && !raw.parentRequirementIds.includes(outcome.parentRequirementId)
      || outcome.probability !== undefined && (typeof outcome.probability !== "number" || !Number.isFinite(outcome.probability) || outcome.probability < 0 || outcome.probability > 1
        || !decisionPolicy || !validAtomicDecisionEvidence(outcome.decisionEvidence) || outcome.decisionEvidence.id !== outcome.predicateId || outcome.relation !== decideAtomicNoul(outcome.probability, outcome.decisionEvidence, decisionPolicy))
      || outcome.confidence !== undefined && (typeof outcome.confidence !== "number" || !Number.isFinite(outcome.confidence) || outcome.confidence < 0 || outcome.confidence > 1))
    || deterministic.some(check => !object(check) || !nonempty(check.id) || !expected.criterionIds.includes(String(check.criterionId)) || typeof check.passed !== "boolean")
    || [...uncovered, ...contradicted].some(id => typeof id !== "string" || !expected.criterionIds.includes(id))
    || new Set(uncovered).size !== uncovered.length || new Set(contradicted).size !== contradicted.length
    || manifest.some(packet => !object(packet) || !nonempty(packet.id) || !isDigest(packet.packetDigest) || !Array.isArray(packet.criteria) || !packet.criteria.length
      || !Array.isArray(packet.predicateIds) || !packet.predicateIds.length || packet.criteria.some(id => typeof id !== "string" || !expected.criterionIds.includes(id)))
    || new Set(manifest.map(packet => packet.id)).size !== manifest.length
    || outcomes.some(outcome => !manifest.some(packet => packet.id === outcome.packetId && packet.predicateIds.includes(outcome.predicateId) && packet.criteria.includes(outcome.criterionId)))) return false;
  for (const id of expected.criterionIds) {
    const relations = outcomes.filter(outcome => outcome.criterionId === id && outcome.parentRequirementId === undefined);
    const failed = deterministic.some(check => check.criterionId === id && !check.passed);
    const contradiction = failed || relations.some(outcome => outcome.relation === "contradicts");
    const missing = !relations.length || relations.some(outcome => outcome.relation !== "supports") || failed
      || manifest.some(packet => packet.criteria.includes(id) && packet.predicateIds.some((predicateId: unknown) => !outcomes.some(outcome => outcome.predicateId === predicateId)));
    if (contradiction !== contradicted.includes(id) || missing !== uncovered.includes(id)) return false;
  }
  for (const id of raw.parentRequirementIds) {
    const relations = outcomes.filter(outcome => outcome.parentRequirementId === id);
    if (relations.some(outcome => outcome.relation === "contradicts") !== raw.contradictedParentRequirementIds.includes(id)
      || (!relations.length || relations.some(outcome => outcome.relation !== "supports")) && !raw.uncoveredParentRequirementIds.includes(id)) return false;
  }
  if (raw.status === "supported" && (uncovered.length || contradicted.length || raw.uncoveredParentRequirementIds.length || raw.contradictedParentRequirementIds.length || raw.uncoveredArtifactPaths.length || raw.failureCode !== undefined)) return false;
  if (raw.status === "contradicted" && !contradicted.length && !raw.contradictedParentRequirementIds.length) return false;
  if (raw.status === "insufficient" && !uncovered.length && !raw.uncoveredParentRequirementIds.length && !raw.uncoveredArtifactPaths.length) return false;
  return true;
}
