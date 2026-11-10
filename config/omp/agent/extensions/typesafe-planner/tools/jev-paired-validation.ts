import { createHash } from "node:crypto";
import { DISPOSITIONS, METRIC_IDS, type CorpusCase, type FrozenBundle, type HumanLabel, type ScheduleEntry, type Stratum } from "./jev-paired-types";
import { resolveAtomicDecisionPolicy } from "../src/atomic-decision-policy";
import { validateHostBinding } from "./jev-paired-host-protocol";
import { parseSemanticApprovalPolicySnapshot } from "../src/semantic-approval-policy";
export const SCENARIOS = ["U1","U2","U3","I1","I2","I3","T1","T2","T3","S1","S2","S3","ST1","ST2","ST3","E1","E2","E3","ER1","ER2","ER3","A1","A2","A3","D1","D2","D3","IT1","IT2","IT3","C1","C2","C3","B1","B2","B3"];
export const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const isFloatingModelAlias = (model:string):boolean => /\b(latest|default|auto)\b/i.test(model);
export function matches(c: CorpusCase, s: Stratum): boolean { return c.population === s.population && (!s.language || c.language === s.language) && (!s.taskType || c.taskType === s.taskType) && (!s.risk || c.risk === s.risk) && (s.integrationRequired === undefined || c.integrationRequired === s.integrationRequired); }
export function schedulePairs(bundle: FrozenBundle): ScheduleEntry[] {
  const cases = bundle.cases.map(c => ({c,key:digest(bundle.protocol.seed+c.id)}));
  cases.sort((a,b) => Number(b.c.canonical)-Number(a.c.canonical) || a.key.localeCompare(b.key));
  return cases.flatMap(({c},i) => {
    const arms = i % 2 ? ["H","M"] as const : ["M","H"] as const;
    return arms.map((arm,j) => ({ id:`${c.id}:${arm}`,caseId:c.id,arm,pair:i,order:i*2+j }));
  });
}
export function labelGold(label: HumanLabel, requireHumanProvenance = false): string | null {
  const a = label.reviewerA, b = label.reviewerB, j = label.adjudicator;
  if (!a?.humanId || !b?.humanId || a.humanId === b.humanId || !a.receipt || !b.receipt || !DISPOSITIONS.includes(a.disposition) || !DISPOSITIONS.includes(b.disposition)) return null;
  if (j && (!j.humanId || !j.receipt || [a.humanId,b.humanId].includes(j.humanId) || !DISPOSITIONS.includes(j.disposition))) return null;
  if (requireHumanProvenance) {
    const p = label.provenance;
    if (!j || !p || p.source !== "independent_human" || !p.custodianReceipt || !p.independenceReceipt || p.blindedToVariantsAndOutputs !== true || !Number.isFinite(Date.parse(p.labeledAt))
      || !Array.isArray(p.excludedAuthorAndAdvisorIds) || [a.humanId,b.humanId,j.humanId].some(id => p.excludedAuthorAndAdvisorIds.includes(id))) return null;
  }
  const expected = a.disposition === b.disposition ? a.disposition : j?.disposition;
  return expected && expected !== "UNAVAILABLE" && expected === label.expected ? expected : null;
}
// Connected provenance is computed before splitting; a shared template or parent never yields independent samples.
export function connectedGroups(cases: CorpusCase[], groupProjects = false): string[][] {
  const parent = cases.map((_, i) => i);
  const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const keys = new Map<string, number>();
  cases.forEach((c, i) => {
    for (const key of [`parent:${c.parentId}`,`family:${c.familyId}`,...c.derivationIds.map(id => `derivation:${id}`),`declared:${c.independentGroup}`,...(groupProjects ? [`project:${c.projectId}`] : [])]) {
      const old = keys.get(key); if (old !== undefined) parent[root(i)] = root(old); else keys.set(key, i);
    }
  });
  const result = new Map<number, string[]>();
  cases.forEach((c,i) => { const r = root(i), group = result.get(r); if (group) group.push(c.id); else result.set(r,[c.id]); });
  return [...result.values()].map(ids => ids.sort()).sort((a,b) => a[0].localeCompare(b[0]));
}
export function assignSplits(cases: CorpusCase[], seed: string, projectDisjoint: boolean): FrozenBundle["splits"] {
  const groups = connectedGroups(cases,projectDisjoint).map(ids => ({ids,key:digest(seed+JSON.stringify(ids))}));
  groups.sort((a,b) => a.key.localeCompare(b.key));
  const result: FrozenBundle["splits"] = {};
  groups.forEach(({ids},i) => { const split = i < Math.floor(groups.length*.6) ? "dev" : i < Math.floor(groups.length*.8) ? "calibration" : "holdout"; for (const id of ids) result[id] = split; });
  return result;
}
export function validateBundle(b: FrozenBundle): { errors: string[]; pending: string[] } {
  const { protocol: p, cases, labels } = b, errors: string[] = [], pending: string[] = [];
  if (p.schemaVersion !== 1 || !["model_benchmark","deterministic_fixture"].includes(p.kind) || !["ready","prerequisite_pending"].includes(p.state) || p.decisionRule !== "strict-corpus-dominance-v1") errors.push("unsupported_protocol");
  if (p.state === "prerequisite_pending") pending.push(...p.pendingInputs.map(x => `${x.owner}: ${x.action}; release: ${x.releaseCondition}`));
  if (!p.targetScope?.trim() || !p.seed || !Number.isInteger(p.minimumGroups) || p.minimumGroups <= 0 || !p.strata?.length) pending.push("custodian_scope_and_positive_support_declarations_required");
  if (p.canonicalSelection !== "declared_before_outputs" || JSON.stringify(p.splitRatio) !== "[60,20,20]" || !["project","provenance_group"].includes(p.holdoutUnit)) errors.push("invalid_split_policy");
  if (p.limits?.concurrency !== 1 || p.limits.maxQuestions !== 128 || p.limits.maxBodyBytes !== 32768) errors.push("invalid_per_review_local_limits");
  if (p.limits.maxEpisodes === null || p.limits.maxRunMs === null) pending.push("custodian_experiment_quota_and_deadline_required_not_invented_from_per_review_limits");
  else if (!Number.isSafeInteger(p.limits.maxEpisodes) || p.limits.maxEpisodes <= 0 || !Number.isFinite(p.limits.maxRunMs) || p.limits.maxRunMs <= 0) errors.push("invalid_custodian_experiment_limits");
  if (p.limits.deadlineAt === null) pending.push("custodian_absolute_experiment_deadline_required");
  else if (!Number.isFinite(Date.parse(p.limits.deadlineAt)) || new Date(p.limits.deadlineAt).toISOString() !== p.limits.deadlineAt) errors.push("invalid_custodian_UTC_deadline");
  if (p.accounting?.ownership !== "independent_arms" || p.accounting.latency !== "admission_to_terminal_including_queue" || p.accounting.quantile !== "nearest_rank" || !p.accounting.cacheConditions || !p.accounting.cooldownConditions) errors.push("unfrozen_accounting");
  if (!p.models?.jev || !p.models.advisorModel || !p.models.advisorProvider) pending.push("exact_model_identity_required");
  if (p.kind === "model_benchmark" && [p.models.jev,p.models.advisorModel,...(p.models.parent ? [p.models.parent.model] : [])].some(isFloatingModelAlias)) pending.push("resolved_model_version_required_alias_is_not_resolved_identity");
  if (p.kind === "model_benchmark" && !p.expectedPolicyIdentity) pending.push("actual_bound_policy_identity_must_be_frozen_before_outputs");
  if (p.kind === "model_benchmark" && (!p.spend?.approvalReceipt || !(p.spend.maximumUsd > 0))) pending.push("trusted_data_spend_owner_approval_required_JSON_is_not_consent");
  if (p.kind === "model_benchmark" && (!p.implementationInvariants || p.implementationInvariants.complete !== true)) pending.push("integrated_implementation_invariant_receipt_required");
  if (p.predicateDecisionPolicy === null) pending.push("custodian_predicate_operating_point_required_before_outputs");
  else if (!resolveAtomicDecisionPolicy(p.predicateDecisionPolicy).ok) errors.push("invalid_frozen_predicate_operating_point");
  if (p.approvalPolicy === null) pending.push("actual_Root_M_approval_policy_must_be_frozen_before_outputs");
  else if (!parseSemanticApprovalPolicySnapshot(p.approvalPolicy)) errors.push("invalid_frozen_M_approval_policy");
  if (p.kind === "model_benchmark" && (!p.nativeHost || !validateHostBinding(p.nativeHost))) pending.push("real_current_Root_public_host_identity_must_be_frozen_before_outputs");
  if (p.accounting.admission !== (p.kind === "model_benchmark" ? "trusted_root_prepare" : "in_process_driver")) errors.push("invalid_frozen_admission_definition");
  if (p.controlRule !== "matched_repaired_M_frozen_approval_policy_not_claimed_optimal") errors.push("unfrozen_or_unsupported_matched_M_control_rule");
  const ids = new Set<string>();
  for (const c of cases) {
    if (!c.id || ids.has(c.id)) errors.push(`duplicate_or_missing_case:${c.id}`); ids.add(c.id);
    if (![c.projectId,c.parentId,c.familyId,c.independentGroup,c.language,c.taskType,c.risk].every(v => typeof v === "string" && v.trim()) || !Array.isArray(c.derivationIds) || !["challenge","natural"].includes(c.population)) errors.push(`incomplete_provenance:${c.id}`);
    if (!c.privacy?.sanitized || !c.privacy.approvedBy || !c.privacy.approvalReceipt || !c.privacy.exportScope || !c.snapshots?.length || !c.input) errors.push(`privacy_or_snapshot_missing:${c.id}`);
    const label = labels.filter(l => l.caseId === c.id);
    if (label.length !== 1 || !labelGold(label[0],p.kind === "model_benchmark")) pending.push(`independent_adjudicated_gold_required:${c.id}`);
  }
  if (labels.some(l => !ids.has(l.caseId))) errors.push("orphan_label");
  for (const group of connectedGroups(cases)) {
    const members = cases.filter(c => group.includes(c.id));
    if (members.filter(c => c.canonical).length !== 1 || new Set(members.map(c => c.independentGroup)).size !== 1) errors.push(`noncanonical_independent_group:${group.join(",")}`);
  }
  const expectedSplits = assignSplits(cases, p.seed, p.holdoutUnit === "project");
  if (JSON.stringify(Object.entries(b.splits).sort()) !== JSON.stringify(Object.entries(expectedSplits).sort())) errors.push("split_leakage_or_seed_mismatch");
  if (cases.length && (["dev","calibration","holdout"] as const).some(split => !Object.values(b.splits).includes(split))) pending.push("grouped_split_requires_nonempty_dev_calibration_and_holdout");
  const heldout = cases.filter(c => c.canonical && b.splits[c.id] === "holdout" && labels.some(l => l.caseId === c.id && labelGold(l,p.kind === "model_benchmark") !== null));
  if (heldout.length < p.minimumGroups) pending.push("undersupported_overall_holdout");
  const strataIds = new Set<string>();
  for (const dimension of ["language","taskType","risk","integrationRequired"] as const) if (!p.strata.some(s => s[dimension] !== undefined)) pending.push(`custodian_required_strata_dimension_missing:${dimension}`);
  for (const s of p.strata) {
    if (!s.id || ["challenge","natural","population"].includes(s.id) || strataIds.has(s.id) || !Number.isInteger(s.minimumGroups) || s.minimumGroups <= 0 || !["challenge","natural"].includes(s.population)) errors.push("invalid_stratum_declaration"); strataIds.add(s.id);
    if (heldout.filter(c => matches(c,s)).length < s.minimumGroups) pending.push(`undersupported_stratum:${s.id}`);
    for (const metric of METRIC_IDS) {
      const gateScope = metric === "correctness_lower" ? "population" : s.id;
      const rows = p.metricGates.filter(g => g.stratum === gateScope && g.population === s.population && g.metric === metric);
      const row = rows[0], high = metric === "correctness_lower", zero = ["unsafe_approvals","h_only_wrong","integration_misses","correctness_lower"].includes(metric);
      if (rows.length !== 1 || !row || row.denominator !== "scheduled_independent_pairs" || row.numerator !== metric || row.direction !== (high ? "higher" : "lower") || row.comparator !== (zero ? "zero" : "M") || row.allowEquality !== !high || row.requiredSupport !== true || row.unknown !== "retain") errors.push(`ambiguous_metric_gate:${s.id}:${metric}`);
    }
  }
  if (p.metricGates.some(g => (!strataIds.has(g.stratum) && !(g.metric === "correctness_lower" && g.stratum === "population" && p.strata.some(s => s.population === g.population))) || !METRIC_IDS.includes(g.metric))) errors.push("undeclared_metric_gate");
  for (const population of ["challenge","natural"] as const) if (p.strata.some(s => s.population === population) && heldout.filter(c => c.population === population).length < p.minimumGroups) pending.push(`undersupported_primary_population:${population}`);
  for (const id of SCENARIOS) {
    const mapping = p.scenarioCoverage[id];
    if (!mapping || (!mapping.assertion && !mapping.semanticCaseIds?.length) || mapping.semanticCaseIds?.some(caseId => !ids.has(caseId))) errors.push(`unmapped_scenario:${id}`);
  }
  if (!cases.length) pending.push("approved_exportable_whole_parent_corpus_required");
  if (!b.prices.length || b.prices.some(x => !x.provider || !x.model || !x.source || !x.effectiveAt || ![x.inputPerMillion,x.outputPerMillion].every(v => Number.isFinite(v) && v >= 0) || (x.cachedInputPerMillion !== null && (!Number.isFinite(x.cachedInputPerMillion) || x.cachedInputPerMillion < 0)))) pending.push("applicable_frozen_prices_required");
  if (new Set(b.prices.map(x => `${x.provider}:${x.model}`)).size !== b.prices.length) errors.push("ambiguous_price_record");
  for (const a of p.ablations) {
    if (!Array.isArray(a.baselineCaseIds) || !a.baselineCaseIds.length || !a.caseIds.length || [...a.baselineCaseIds,...a.caseIds].some(id => !ids.has(id))
      || a.caseIds.some(id => a.baselineCaseIds.includes(id) || cases.find(c => c.id === id)?.canonical)
      || (a.kind === "batching" && !/^[a-f0-9]{64}$/.test(a.stateQuestionDigest ?? ""))) errors.push(`invalid_ablation:${a.id}`);
  }
  return { errors: [...new Set(errors)], pending: [...new Set(pending)] };
}
