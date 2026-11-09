import type { ContractRuntime } from "./contract-runtime";
import type { TaskEvidenceRuntime, TaskEvidenceRecord } from "./task-evidence-runtime";
import type { AdvisorHostServices, AdvisorHostReview } from "./advisor-host";
import type { AdvisorReceipt, AdvisorRequest, ReviewSnapshot } from "./advisor-protocol";
import type { ExpertJudgeClient, MacroCheckResult } from "./cook-expert-judge";
import type { JudgePurpose, PreparedRequestValidator } from "./payload-safety";
import type { WorkspaceSnapshot } from "./evidence-collector";
import type { ContractReference, NativeTaskTarget, ProjectedNativePhase, ReviewBinding, TaskContract, VerificationOutcome } from "./types/verification";
import type { RecoveryAttempt, RecoveryPlan } from "./task-recovery";
import type { TaskAvailabilityObservation } from "./task-verification-history";
import type { HostToolInvocation, HostToolInvocationRuntime } from "./host-tool-invocation";
import type { SemanticApprovalPolicy } from "./semantic-approval-policy";
import type { HistoricalDebtResolver } from "./task-verification-debt-types";

export interface TaskVerificationTarget { task: string; phase?: string }
export interface NativeTaskVerificationStage {
  readonly contract: ContractReference;
  readonly receiptId: string;
  readonly bindingDigest: string;
  readonly snapshot: WorkspaceSnapshot;
  readonly target: NativeTaskTarget;
  readonly evidenceDigest: string;
  readonly policyDigest: string;
  readonly sessionId: string;
  readonly branchId: string;
}
export type TaskVerificationFailure = Exclude<VerificationOutcome, { status: "APPROVED_PENDING_COMMIT" }> & {
  nextActions?: readonly string[];
  handoff?: { owner: string; action: string; releaseCondition: string };
};
export type TaskPreflightOutcome = { status: "APPROVED_PENDING_COMMIT"; stage: NativeTaskVerificationStage } | TaskVerificationFailure;
export type TaskReviewOutcome = (VerificationOutcome | { status: "REVIEW_REQUIRED"; reasons: readonly string[]; nextActions: readonly string[] }) & {
  nextActions?: readonly string[];
  handoff?: { owner: string; action: string; releaseCondition: string };
};
export interface TaskRecoveryPlan extends RecoveryPlan {
  schemaVersion: 1;
  owner: string;
  action: string;
  report: string;
  unblockCondition: string;
  resumeCommand: string;
}
export interface TaskNativeCommit {
  callId: string;
  input: unknown;
  before: readonly ProjectedNativePhase[];
  details: unknown;
  resultEntryId: string;
}
export interface TaskNativeObservation {
  callId: string;
  input: unknown;
  before: readonly ProjectedNativePhase[];
  details: unknown;
  isError: boolean;
}
export interface TaskVerificationRuntimeOptions {
  contracts: ContractRuntime;
  evidence: TaskEvidenceRuntime;
  invocations: HostToolInvocationRuntime;
  policyDigest: string;
  approvalPolicy: SemanticApprovalPolicy;
  privacy?: { apiKey: string; homeDirs?: readonly string[] };
  createClient(context: unknown, purpose: JudgePurpose, validatePrepared?: PreparedRequestValidator): ExpertJudgeClient;
  getAdvisorReviews(context: unknown): Promise<readonly AdvisorHostReview[]>;
  appendEntry(customType: string, data: unknown): void;
}
export interface TaskVerificationRuntime {
  readonly advisorServices: AdvisorHostServices;
  review(context: unknown, callId: string, target: TaskVerificationTarget): Promise<TaskReviewOutcome>;
  preflight(context: unknown, target: TaskVerificationTarget, operation: "done", signal?: AbortSignal): Promise<TaskPreflightOutcome>;
  commit(context: unknown, stages: readonly NativeTaskVerificationStage[], native: TaskNativeCommit): Promise<boolean>;
  observeNativeResult(context: unknown, stages: readonly NativeTaskVerificationStage[], native: TaskNativeObservation): void;
  resolveHistoricalDebt: HistoricalDebtResolver;
  observeAvailability(context: unknown, observation: TaskAvailabilityObservation): void;
  getRecovery(context: unknown, target: TaskVerificationTarget): TaskRecoveryPlan | undefined;
  hasDebt(context: unknown, incarnationId: string): boolean;
  getCurrentPlanPhaseReview(context: unknown, planPath: string, phaseHeading?: string): Promise<AdvisorHostReview | undefined>;
  invalidate(context: unknown, reason: string): void;
}
export interface TaskReviewState {
  key: string;
  contextKey: string;
  contract: TaskContract;
  evidence: TaskEvidenceRecord;
  binding: ReviewBinding;
  snapshot: ReviewSnapshot;
  invocation: HostToolInvocation;
  results: readonly MacroCheckResult[];
  receipt?: AdvisorReceipt;
  provisionalReceiptId?: string;
  request?: AdvisorRequest;
  outcome: VerificationOutcome;
  progressDigest: string;
  attempt?: RecoveryAttempt;
  recovery?: TaskRecoveryPlan;
  generation: number;
}
