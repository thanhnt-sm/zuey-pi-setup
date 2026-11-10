import type { Cash } from "./jev-paired-accounting";
import type { AblationIdentity } from "./jev-paired-ablations";
import type { Decision, Protocol } from "./jev-paired-types";
import type { QuantileInterval, RiskSummary } from "./jev-paired-statistics";
export interface ArmMetrics {
  scheduled:number; terminal:number; correct:number; unsafe:number; approvals:number; nonApprovable:number;
  falseApprovalRisk:RiskSummary; unsafeApprovalFraction:RiskSummary;
  errors:number; unnecessaryDeferrals:number; errorRate:number|null; unnecessaryDeferralRate:number|null;
  dispositions:Record<string,number>; requests:number|null; observedRequestReceipts:number; requestCountReason:string|null; inputTokens:number|null; outputTokens:number|null;
  criterionCoverage:{ required:number; covered:number; parentRequired:number; parentCovered:number; uncoveredArtifacts:number; episodesWithUnknownCoverage:number };
  integrationMisses:number|null; integrationSupport:number; cost:Cash; billing:Cash;
  p50:number|null; p95:number|null; p95Interval:QuantileInterval; reviewerActions:number|null;
}
export interface PairedComparison { n:number; a:number; b:number; hOnlyWrong:number; improvementLower:number|null; inferenceReason:string|null; M:ArmMetrics; H:ArmMetrics }
export interface DominanceComparison extends PairedComparison { id:string; required:boolean; primary:boolean }
export interface GateAssessment { failedGates:string[]; unknownGates:string[] }
export interface EvaluationMetrics {
  kind:Protocol["kind"]; modelBenchmark:boolean; rawCases:number; independentPrimaryParents:number;
  populationsAndStrata:DominanceComparison[];
  scheduledEpisodes:number; terminalEpisodes:number; actualBilled:Cash;
  allAttemptPricedCash:Cash; costPerScheduledEpisode:Cash; modelQualitySuccessfulArmExecutions:number;
  generalization:{ holdoutUnit:Protocol["holdoutUnit"]; projects:number; claim:string };
  productionCostPerCompletedTask:Cash;
  ablations:{ id:string; kind:Protocol["ablations"][number]["kind"]; scheduledCases:number; results:PairedComparison; baseline:PairedComparison; identity:AblationIdentity; primary:boolean }[];
}
export interface EvaluationReplay { decision:Decision; metrics:EvaluationMetrics }
