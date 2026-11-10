import type { AtomicPredicateDecisionPolicy } from "../src/atomic-decision-policy";
import type { SemanticApprovalPolicy } from "../src/semantic-approval-policy";
import type { NativeHostBinding, NativeProof } from "./jev-paired-host-protocol";
export const DISPOSITIONS = ["APPROVE", "REJECT", "EVIDENCE_REQUIRED", "HUMAN_ESCALATION", "UNAVAILABLE"] as const;
export type Disposition = typeof DISPOSITIONS[number];
export type Strategy = "M" | "H";
export type Population = "challenge" | "natural";
export type MeasurementStatus = "complete" | "prerequisite_pending" | "unavailable" | "inconclusive";
export interface PendingInput { owner: string; action: string; releaseCondition: string }
export interface FileBinding { path: string; sha256: string }
export interface CorpusCase {
  id: string; projectId: string; parentId: string; familyId: string; derivationIds: string[];
  independentGroup: string; canonical: boolean; population: Population;
  language: string; taskType: string; risk: string; integrationRequired: boolean;
  scenarioIds: string[]; snapshots: FileBinding[]; input: FileBinding;
  privacy: { approvedBy: string; approvalReceipt: string; sanitized: true; exportScope: string };
}
export interface HumanLabel {
  caseId: string; reviewerA: { humanId: string; disposition: Disposition; receipt: string };
  reviewerB: { humanId: string; disposition: Disposition; receipt: string };
  adjudicator: { humanId: string; disposition: Disposition; receipt: string } | null;
  expected: Disposition; integrationDefect: boolean; unnecessaryReviewerActions: number;
  provenance?: { source:"independent_human"; custodianReceipt:string; independenceReceipt:string; blindedToVariantsAndOutputs:true; labeledAt:string; excludedAuthorAndAdvisorIds:string[] };
}
export interface Stratum { id: string; population: Population; language?: string; taskType?: string; risk?: string; integrationRequired?: boolean; minimumGroups: number }
export const METRIC_IDS = ["unsafe_approvals", "h_only_wrong", "integration_misses", "correctness_lower", "errors", "unnecessary_deferrals", "priced_cost", "p95_latency", "reviewer_actions"] as const;
export type MetricId = typeof METRIC_IDS[number];
export interface MetricGate { metric: MetricId; population: Population; stratum: string; numerator: string; denominator: "scheduled_independent_pairs"; direction: "lower" | "higher"; comparator: "M" | "zero"; allowEquality: boolean; requiredSupport: true; unknown: "retain" }
export interface AblationSpec {
  id:string; kind:"input_repair" | "duplicate_choice_noul" | "incremental_advisor" | "batching" | "context_selection";
  baselineCaseIds:string[]; caseIds:string[]; stateQuestionDigest?:string;
}
export interface Protocol {
  schemaVersion: 1; kind: "model_benchmark" | "deterministic_fixture"; state: "ready" | "prerequisite_pending";
  pendingInputs: PendingInput[]; seed: string; decisionRule: "strict-corpus-dominance-v1";
  targetScope: string; minimumGroups: number; strata: Stratum[]; metricGates: MetricGate[];
  files: { corpus: string; labels: string; splits: string; prices: string };
  models: { jev:string; jevRequest?:string; advisorProvider:string; advisorModel:string; advisorRequest?:string; parent?:{provider:string;model:string;requestedModel?:string} };
  expectedPolicyIdentity?: string | null;
  predicateDecisionPolicy:AtomicPredicateDecisionPolicy|null; nativeHost:NativeHostBinding|null;
  approvalPolicy:SemanticApprovalPolicy|null;
  controlRule:"matched_repaired_M_frozen_approval_policy_not_claimed_optimal";
  frozenConfiguration: { policy: FileBinding; prompts: FileBinding; packetSelection: FileBinding; implementation: FileBinding };
  limits: { concurrency: 1; maxQuestions: 128; maxBodyBytes: 32768; maxEpisodes: number | null; maxRunMs: number | null; deadlineAt:string|null };
  accounting: { ownership: "independent_arms"; latency: "admission_to_terminal_including_queue"; admission:"trusted_root_prepare"|"in_process_driver"; quantile: "nearest_rank"; cacheConditions: string; cooldownConditions: string };
  canonicalSelection: "declared_before_outputs"; splitRatio: [60, 20, 20]; holdoutUnit: "project" | "provenance_group";
  spend: { approvalReceipt: string; maximumUsd: number } | null;
  implementationInvariants: { receipt: FileBinding; complete: true } | null;
  scenarioCoverage: Record<string, { assertion?: string; semanticCaseIds?: string[] }>;
  ablations:AblationSpec[];
}
export interface Price { provider: string; model: string; inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion: number | null; effectiveAt: string; source: string }
export type ProviderMetadata = string | number | boolean | null | ProviderMetadata[] | { [key:string]:ProviderMetadata };
export interface Attempt {
  receiptId: string; runId: string; caseId: string; arm: Strategy; parentId: string;
  role: "jev" | "advisor" | "parent"; requestedModel: string; resolvedModel: string | null; provider: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null;
  unknownReason: string | null; billedUsd: number | null; billingReason: string | null;
  bodyDigest: string | null; bodyBytes: number | null; questionIds: string[];
  startedAt: string; endedAt: string; retry: number; cooldownMs: number | null; error: string | null;
  policyIdentity?: string | null; questionCount?: number | null;
  monotonicTiming?: { startedAtMs: number; endedAtMs: number } | null;
  wallTimingScope?: "packet_envelope" | "attempt";
  httpStatus?: number | null; transportKind?: string | null;
  cooldown?: { observed:boolean|null; until:number|null };
  questionStateDigests?: Record<string,string>;
  providerUsage?: Record<string, ProviderMetadata>;
  providerBilling?: number | Record<string, ProviderMetadata> | null;
  metadataComplete?: boolean;
}
export interface ReviewCoverage {
  required:number; covered:number; uncoveredCriterionIds:string[];
  parentRequired:number; parentCovered:number; uncoveredParentRequirementIds:string[]; uncoveredArtifactPaths:string[];
}
export interface Episode {
  id: string; caseId: string; arm: Strategy; receiptId: string; disposition: Disposition;
  status: "terminal" | "censored"; reason: string | null; admittedAt: string; terminalAt: string | null;
  latencyMs: number | null; timingSegments: { start: string; end: string; elapsedMs: number }[];
  attemptIds: string[]; integrationMiss: boolean | null; unnecessaryReviewerActions: number | null;
  integrationAssessment?: "defect_detected" | "no_defect" | "insufficient" | "unavailable";
  accountingComplete: boolean; accountingReason: string | null;
  predicateDecisionPolicyDigest:string|null;
  macroApprovalPolicyDigest:string|null;
  nativeObservation?:NativeProof;
  coverage:ReviewCoverage | null;
  advisorReceiptId: string | null; completionEvent: null;
}
export interface ScheduleEntry { id: string; caseId: string; arm: Strategy; pair: number; order: number }
export interface FrozenBundle { protocol: Protocol; cases: CorpusCase[]; labels: HumanLabel[]; prices: Price[]; splits: Record<string, "dev" | "calibration" | "holdout">; files: Record<string, string>; digest: string }
export interface Manifest {
  schemaVersion: 1; runId: string; kind: Protocol["kind"]; frozen: FrozenBundle; schedule: ScheduleEntry[]; createdAt: string;
  status: MeasurementStatus; pendingInputs: PendingInput[]; interrupted: boolean;
  runtime?: { activeElapsedMs:number; startedAt:string };
}
export interface Decision { selection: "adopt_H" | "retain_repaired_M"; measurementStatus: MeasurementStatus; failedGates: string[]; unknownGates: string[]; authority: "assessment_only_no_deployment"; modelBenchmark: boolean }
export interface EvaluationDriverResult {
  episode:Omit<Episode,"id"|"caseId"|"arm"|"admittedAt"|"terminalAt"|"latencyMs"|"timingSegments"|"completionEvent">;
  attempts:Attempt[];
}
export interface EvaluationDriver {
  evaluate(arm:Strategy,input:unknown,context:{mode:"shadow";allowMutation:false;allowAuthorityReuse:false;signal:AbortSignal;runId:string;caseId:string;parentId:string}):Promise<EvaluationDriverResult>;
}
