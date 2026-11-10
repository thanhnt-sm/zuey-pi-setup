import { canonicalDigest } from "../src/task-contract-source";
import { DISPOSITIONS, type Attempt, type CorpusCase, type Episode, type Manifest, type Strategy } from "./jev-paired-types";
import type { EvaluationMetrics, EvaluationReplay, DominanceComparison, GateAssessment } from "./jev-paired-metric-types";
import { episodeCash, billingTotal, validateReceipts, priceAttempt } from "./jev-paired-accounting";
import { matches, validateBundle, labelGold, isFloatingModelAlias, connectedGroups } from "./jev-paired-validation";
import { nearestRank, pairedImprovement, quantileInterval, riskSummary } from "./jev-paired-statistics";
import { ablationIdentity } from "./jev-paired-ablations";
export function computeMetrics(manifest: Manifest, episodes: Episode[], attempts: Attempt[]): EvaluationMetrics {
  const b = manifest.frozen, p = b.protocol;
  const casesById = new Map(b.cases.map(c => [c.id,c])),independentCanonical = new Set<string>();
  for (const group of connectedGroups(b.cases)) {
    const members = group.map(id => casesById.get(id)!),canonical = members.filter(c => c.canonical);
    if (canonical.length === 1 && new Set(members.map(c => c.independentGroup)).size === 1) independentCanonical.add(canonical[0].id);
  }
  const primary = b.cases.filter(c => independentCanonical.has(c.id) && b.splits[c.id] === "holdout" && b.labels.some(l => l.caseId === c.id && labelGold(l,p.kind === "model_benchmark") !== null));
  const groups = (["challenge","natural"] as const).map(population => ({ id:population,cases:primary.filter(c => c.population === population),required:p.strata.some(s => s.population === population),primary:true }));
  const strata = p.strata.map(s => ({ id:s.id,cases:primary.filter(c => matches(c,s)),required:true,primary:false }));
  const summarize = (cases: CorpusCase[],independent = p.kind === "model_benchmark") => {
    const inferenceReason = independent ? cases.length ? null : "no_usable_independent_groups" : p.kind === "deterministic_fixture" ? "deterministic_fixture_has_zero_model_observations" : "correlated_variants_descriptive_only";
    const selected = episodes.filter(e => cases.some(c => c.id === e.caseId));
    const get = (id: string, arm: Strategy) => selected.find(e => e.caseId === id && e.arm === arm);
    let a = 0, bWrong = 0, hOnlyWrong = 0;
    for (const c of cases) {
      const gold = b.labels.find(l => l.caseId === c.id)?.expected;
      const m = get(c.id,"M"),h = get(c.id,"H"),mCorrect = m?.status === "terminal" && m.disposition === gold,hCorrect = h?.status === "terminal" && h.disposition === gold;
      if (hCorrect && !mCorrect) a++;
      if (mCorrect && !hCorrect) { bWrong++; hOnlyWrong++; }
    }
    const arms = (["M","H"] as const).map(arm => {
      const es = selected.filter(e => e.arm === arm), terminal = es.filter(e => e.status === "terminal");
      const allTerminal = terminal.length === cases.length;
      const latencies = terminal.flatMap(e => e.latencyMs === null ? [] : [e.latencyMs]);
      let correct = 0, unsafe = 0, nonApprovable = 0, approvals = 0, unnecessaryDeferrals = 0;
      for (const c of cases) {
        const gold = b.labels.find(l => l.caseId === c.id)?.expected, e = get(c.id,arm);
        if (e?.status === "terminal" && e.disposition === gold) correct++;
        if (gold !== "APPROVE") nonApprovable++;
        if (e?.status === "terminal" && e.disposition === "APPROVE") { approvals++; if (gold !== "APPROVE") unsafe++; }
        if (gold && !["EVIDENCE_REQUIRED","HUMAN_ESCALATION"].includes(gold) && e?.status === "terminal" && ["EVIDENCE_REQUIRED","HUMAN_ESCALATION"].includes(e.disposition)) unnecessaryDeferrals++;
      }
      const integration = cases.filter(c => c.integrationRequired && b.labels.find(l => l.caseId === c.id)?.integrationDefect);
      const integrationOutcomes = integration.map(c => {
        const e = get(c.id,arm);
        if (!e || e.status !== "terminal" || e.disposition === "UNAVAILABLE") return null;
        if (e.disposition === "APPROVE") return true;
        if (e.integrationMiss !== null) return e.integrationMiss;
        return e.integrationAssessment === "defect_detected" ? false : e.integrationAssessment === "no_defect" || e.integrationAssessment === "insufficient" ? true : null;
      });
      const integrationMisses = integrationOutcomes.some(x => x === null) ? null : integrationOutcomes.filter(Boolean).length;
      const paid = attempts.filter(a => a.arm === arm && cases.some(c => c.id === a.caseId));
      const unknownUsage = !cases.length || !paid.length || es.some(e => !e.accountingComplete) || paid.some(a => !a.usage) || es.length !== cases.length;
      const errors = cases.length-terminal.filter(e => e.disposition !== "UNAVAILABLE").length;
      return [arm, { scheduled:cases.length, terminal:terminal.length, correct, unsafe, approvals, nonApprovable,
        falseApprovalRisk:independent && allTerminal ? riskSummary(unsafe,nonApprovable) : {events:unsafe,denominator:nonApprovable,estimate:nonApprovable ? unsafe/nonApprovable : null,upper95:null,zeroEventUpper95:null,reason:inferenceReason ?? "scheduled_episodes_incomplete_or_censored"},
        unsafeApprovalFraction:independent && allTerminal ? riskSummary(unsafe,approvals) : {events:unsafe,denominator:approvals,estimate:approvals ? unsafe/approvals : null,upper95:null,zeroEventUpper95:null,reason:inferenceReason ?? "scheduled_episodes_incomplete_or_censored"},
        errors, unnecessaryDeferrals, errorRate:cases.length ? errors/cases.length : null, unnecessaryDeferralRate:cases.length ? unnecessaryDeferrals/cases.length : null,
        dispositions:Object.fromEntries(DISPOSITIONS.map(d => [d,terminal.filter(e => e.disposition === d).length])),
        requests:allTerminal && es.every(e => e.accountingComplete) && cases.length ? paid.length : null,observedRequestReceipts:paid.length,requestCountReason:allTerminal && es.every(e => e.accountingComplete) && cases.length ? null : "all_required_attempt_accounting_incomplete_or_no_observations",inputTokens:unknownUsage ? null : paid.reduce((s,a) => s+(a.usage?.inputTokens ?? 0),0),outputTokens:unknownUsage ? null : paid.reduce((s,a) => s+(a.usage?.outputTokens ?? 0),0),
        criterionCoverage:{ required:es.reduce((s,e) => s+(e.coverage?.required ?? 0),0),covered:es.reduce((s,e) => s+(e.coverage?.covered ?? 0),0),parentRequired:es.reduce((s,e) => s+(e.coverage?.parentRequired ?? 0),0),parentCovered:es.reduce((s,e) => s+(e.coverage?.parentCovered ?? 0),0),uncoveredArtifacts:es.reduce((s,e) => s+(e.coverage?.uncoveredArtifactPaths.length ?? 0),0),episodesWithUnknownCoverage:cases.length-es.filter(e => e.coverage !== null).length },
        integrationMisses,integrationSupport:integration.length,
        cost:episodeCash(es,attempts,b.prices,cases.length),billing:allTerminal && es.every(e => e.accountingComplete) ? billingTotal(paid) : {value:null,reason:"all_required_attempt_billing_incomplete",support:0},
        p50:allTerminal && latencies.length === cases.length ? nearestRank(latencies,.5) : null,
        p95:allTerminal && latencies.length === cases.length ? nearestRank(latencies,.95) : null,
        p95Interval:independent && allTerminal && latencies.length === cases.length ? quantileInterval(latencies) : {lower:null,upper:null,lowerRank:0,upperRank:null,reason:inferenceReason ?? "scheduled_episodes_incomplete_or_censored"},
        reviewerActions:allTerminal && es.every(e => e.unnecessaryReviewerActions !== null) && cases.length ? es.reduce((s,e) => s+(e.unnecessaryReviewerActions ?? 0),0)/cases.length : null,
      }] as const;
    });
    return { n:cases.length,a,b:bWrong,hOnlyWrong,improvementLower:independent ? pairedImprovement(a,bWrong,cases.length) : null,inferenceReason,M:arms[0][1],H:arms[1][1] };
  };
  const pricedAttempts = attempts.map(a => priceAttempt(a,b.prices)), unknownPrice = pricedAttempts.find(x => x.value === null);
  const runAccountingComplete = episodes.length === manifest.schedule.length && episodes.every(e => e.accountingComplete) && new Set(attempts.map(a => a.receiptId)).size === attempts.length;
  const pricedTotal = pricedAttempts.reduce((sum,x) => sum+(x.value ?? 0),0);
  const allAttemptPricedCash = !runAccountingComplete || !attempts.length || unknownPrice || !Number.isFinite(pricedTotal) ? { value:null,reason:!runAccountingComplete ? "all_required_attempt_accounting_incomplete_or_duplicate" : !Number.isFinite(pricedTotal) ? "all_attempt_cash_not_representable" : unknownPrice?.reason ?? "no_actual_attempts",support:pricedAttempts.filter(x => x.value !== null).length }
    : { value:pricedTotal,reason:null,support:attempts.length };
  const projectCount = new Set(primary.map(c => c.projectId)).size;
  return { kind:p.kind,modelBenchmark:p.kind === "model_benchmark",rawCases:b.cases.length,independentPrimaryParents:primary.length,
    populationsAndStrata:[...groups,...strata].map(g => ({ id:g.id,required:g.required,primary:g.primary,...summarize(g.cases) })),
    scheduledEpisodes:manifest.schedule.length,terminalEpisodes:episodes.filter(e => e.status === "terminal").length,
    actualBilled:runAccountingComplete ? billingTotal(attempts) : {value:null,reason:"all_required_attempt_billing_incomplete",support:0},
    allAttemptPricedCash,costPerScheduledEpisode:episodeCash(episodes,attempts,b.prices,manifest.schedule.length),
    modelQualitySuccessfulArmExecutions:p.kind === "deterministic_fixture" ? 0 : episodes.filter(e => e.status === "terminal" && e.disposition !== "UNAVAILABLE" && e.attemptIds.length > 0).length,
    generalization:{holdoutUnit:p.holdoutUnit,projects:projectCount,claim:p.holdoutUnit === "project" && projectCount > 1 ? "project_disjoint_observed_cohort_only" : "within_project_or_family_holdout_only_not_cross_project_generalization"},
    productionCostPerCompletedTask:{ value:null,reason:"shadow_has_no_independently_verified_native_completion",support:0 },
    ablations:p.ablations.map(a => ({ id:a.id,kind:a.kind,scheduledCases:a.caseIds.length,results:summarize(b.cases.filter(c => a.caseIds.includes(c.id)),false),baseline:summarize(b.cases.filter(c => a.baselineCaseIds.includes(c.id)),false),identity:ablationIdentity(a,b.cases,episodes,attempts),primary:false })),
  };
}
export function decide(manifest: Manifest, episodes: Episode[], attempts: Attempt[]): EvaluationReplay {
  const validation = validateBundle(manifest.frozen), failed = [...validation.errors], unknown = [...validation.pending];
  if (manifest.status === "prerequisite_pending") unknown.push(...manifest.pendingInputs.map(p => `${p.owner}:${p.action}`));
  const receiptErrors = validateReceipts(attempts,episodes,manifest.runId);
  for (const a of attempts) if (manifest.frozen.cases.find(c => c.id === a.caseId)?.parentId !== a.parentId) receiptErrors.push(`original_parent_attempt_ownership_mismatch:${a.receiptId}`);
  failed.push(...receiptErrors);
  const metrics = computeMetrics(manifest,episodes,attempts);
  if (manifest.kind === "deterministic_fixture") unknown.push("deterministic_fixture_not_a_model_benchmark");
  if (manifest.schedule.length !== episodes.length || episodes.some(e => e.status !== "terminal") || manifest.interrupted) unknown.push("incomplete_or_censored_scheduled_episodes");
  for (const e of episodes) {
    if (!e.accountingComplete) unknown.push(`accounting_incomplete:${e.id}:${e.accountingReason ?? "reason_not_returned"}`);
    if (!e.coverage) unknown.push(`criterion_coverage_missing:${e.id}`);
    if (manifest.kind === "model_benchmark" && !e.advisorReceiptId) unknown.push(`genuine_advisor_receipt_missing:${e.id}`);
    if (manifest.kind === "model_benchmark" && !attempts.some(a => e.attemptIds.includes(a.receiptId) && a.role === "advisor")) unknown.push(`paid_Advisor_attempt_accounting_missing:${e.id}`);
    if (manifest.kind === "model_benchmark" && e.arm === "H") {
      if (!e.predicateDecisionPolicyDigest) unknown.push(`actual_predicate_operating_point_receipt_missing:${e.id}`);
      else if (e.predicateDecisionPolicyDigest !== canonicalDigest(manifest.frozen.protocol.predicateDecisionPolicy)) { const reason = `predicate_operating_point_drift:${e.id}`; failed.push(reason); receiptErrors.push(reason); }
    }
    if (manifest.kind === "model_benchmark" && e.arm === "M") {
      if (!e.macroApprovalPolicyDigest) unknown.push(`actual_M_approval_policy_receipt_missing:${e.id}`);
      else if (e.macroApprovalPolicyDigest !== canonicalDigest(manifest.frozen.protocol.approvalPolicy)) { const reason = `M_approval_policy_drift:${e.id}`; failed.push(reason); receiptErrors.push(reason); }
    }
  }
  const scheduled = new Map(manifest.schedule.map(s => [s.id,s]));
  for (const e of episodes) { const s = scheduled.get(e.id); if (!s || s.caseId !== e.caseId || s.arm !== e.arm) failed.push(`unscheduled_episode:${e.id}`); }
  for (const g of metrics.populationsAndStrata) {
    const gates = strictDominanceGates(g);
    failed.push(...gates.failedGates); unknown.push(...gates.unknownGates);
  }
  // Resolved provider identities are observations, never inferred from a request alias.
  for (const a of attempts) {
    const models = manifest.frozen.protocol.models;
    const expected = a.role === "jev" ? models.jev : a.role === "parent" ? models.parent?.model : models.advisorModel;
    const expectedProvider = a.role === "jev" ? "typesafe" : a.role === "parent" ? models.parent?.provider : models.advisorProvider;
    const requested = a.role === "jev" ? models.jevRequest ?? models.jev : a.role === "parent" ? models.parent?.requestedModel ?? models.parent?.model : models.advisorRequest ?? models.advisorModel;
    if (requested && a.requestedModel !== requested) { const reason = `requested_model_drift:${a.receiptId}`; failed.push(reason); receiptErrors.push(reason); }
    if (!expected) unknown.push(`original_parent_model_not_frozen:${a.receiptId}`);
    if (!a.resolvedModel || isFloatingModelAlias(a.resolvedModel)) unknown.push(`resolved_model_missing:${a.receiptId}`);
    else if (expected && a.resolvedModel !== expected) { const reason = `resolved_model_drift:${a.receiptId}`; failed.push(reason); receiptErrors.push(reason); }
    if (manifest.kind === "model_benchmark" && (!a.provider || !expectedProvider)) unknown.push(`actual_provider_identity_missing:${a.receiptId}`);
    else if (manifest.kind === "model_benchmark" && a.provider !== expectedProvider) { const reason = `actual_provider_identity_drift:${a.receiptId}`; failed.push(reason); receiptErrors.push(reason); }
    if (!a.bodyDigest || a.bodyBytes === null) unknown.push(`prepared_body_identity_missing:${a.receiptId}`);
    if (manifest.kind === "model_benchmark" && a.role === "jev") {
      if (!a.policyIdentity || a.questionCount === null || a.questionCount === undefined) unknown.push(`actual_policy_or_question_metadata_missing:${a.receiptId}`);
      else if (a.policyIdentity !== manifest.frozen.protocol.expectedPolicyIdentity) { const reason = `actual_bound_policy_drift:${a.receiptId}`; failed.push(reason); receiptErrors.push(reason); }
    }
  }
  const measurementStatus = validation.pending.length || manifest.status === "prerequisite_pending" ? "prerequisite_pending" : unknown.length || validation.errors.length || receiptErrors.length ? "inconclusive" : "complete";
  return { decision:{ selection:failed.length || unknown.length ? "retain_repaired_M" : "adopt_H",measurementStatus,failedGates:[...new Set(failed)],unknownGates:[...new Set(unknown)],authority:"assessment_only_no_deployment",modelBenchmark:manifest.kind === "model_benchmark" },metrics };
}

/** Pure mathematical gate replay; input provenance and shadow authority are checked separately by decide. */
export function strictDominanceGates(g: DominanceComparison): GateAssessment {
  const failed:string[] = [], unknown:string[] = [];
  if (!g.required) return {failedGates:failed,unknownGates:unknown};
  if (!g.n) return {failedGates:failed,unknownGates:[`${g.id}:no_independent_support`]};
  if (g.H.unsafe !== 0) failed.push(`${g.id}:unsafe_approvals`);
  if (g.hOnlyWrong !== 0) failed.push(`${g.id}:h_only_wrong`);
  if (g.H.integrationMisses === null || !g.H.integrationSupport) unknown.push(`${g.id}:integration_support_missing`);
  else if (g.H.integrationMisses > 0) failed.push(`${g.id}:integration_misses`);
  if (g.primary) {
    if (g.improvementLower === null) unknown.push(`${g.id}:correctness_lower_unknown`);
    else if (g.improvementLower <= 0) failed.push(`${g.id}:correctness_lower_not_positive`);
  } else if (g.H.correct < g.M.correct) failed.push(`${g.id}:stratum_correctness_worse`);
  const comparisons = [["errors",g.H.errors,g.M.errors],["unnecessary_deferrals",g.H.unnecessaryDeferrals,g.M.unnecessaryDeferrals],["priced_cost",g.H.cost.value,g.M.cost.value],["p95_latency",g.H.p95,g.M.p95],["reviewer_actions",g.H.reviewerActions,g.M.reviewerActions]] as const;
  for (const [name,h,m] of comparisons) {
    if (h === null || m === null) unknown.push(`${g.id}:${name}_unknown`);
    else if (h > m) failed.push(`${g.id}:${name}_worse`);
  }
  return {failedGates:failed,unknownGates:unknown};
}
