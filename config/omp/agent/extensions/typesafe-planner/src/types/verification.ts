export interface HostReference {
  sessionId: string;
  entryId: string;
  digest: string;
  kind: "user_request" | "user_amendment" | "host_confirmation";
}

export interface CreationProvenance {
  sessionId: string;
  branchId: string;
  entryId: string;
  callId: string;
}

export interface NativeTaskTarget {
  phase: string;
  phaseOrdinal: number;
  content: string;
  ordinal: number;
}

export interface SourceSpan {
  path: string;
  digest: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface ContractCriterion {
  id: string;
  kind: "requirement" | "acceptance" | "original_request" | "native_task" | "parent_integration";
  text: string;
  source: SourceSpan;
}

export interface NativeTaskSourceBinding {
  creation: CreationProvenance;
  target: NativeTaskTarget;
}

export interface ApprovedContractSource {
  kind: "plan" | "user_request" | "native_task";
  path: string;
  digest: string;
  phaseHeading?: string;
  nativeBinding?: NativeTaskSourceBinding;
  approval: HostReference;
  spans: readonly SourceSpan[];
}

export interface AllowedMutationScope {
  paths: readonly string[];
  operations: readonly ("read" | "create" | "modify" | "delete" | "execute")[];
}

export interface ParentRequirement {
  parentContractId: string;
  criterionId: string;
  source: SourceSpan;
}

export interface TaskContract {
  schemaVersion: 1;
  contractId: string;
  revision: number;
  revisionId: string;
  incarnationId: string;
  creation: CreationProvenance;
  target: NativeTaskTarget;
  taskKind: "implementation" | "research" | "review" | "operations";
  allowedMutationScope: AllowedMutationScope;
  approvedSource: ApprovedContractSource;
  originalUserRequest: HostReference;
  amendments: readonly HostReference[];
  criteria: readonly ContractCriterion[];
  approvedCommandIds: readonly string[];
  parentRequirements: readonly ParentRequirement[];
  policyDigest: string;
  previousRevisionId?: string;
}

/** Different measurements intentionally have different discriminants. */
export interface NoulProbability { kind: "noul_probability"; probability: number }
export interface ChoiceConfidence { kind: "choice_confidence"; confidence: number; choice: string }
export interface HeuristicScore { kind: "heuristic_score"; score: number; scale: string }
export interface HostAuthorization { kind: "host_authorization"; reference: HostReference }

export type VerificationOutcome =
  | { status: "EVIDENCE_REQUIRED"; missingCriterionIds: readonly string[]; reasons: readonly string[] }
  | { status: "UNAVAILABLE"; component: string; reasons: readonly string[] }
  | { status: "REJECTED"; criterionIds: readonly string[]; reasons: readonly string[] }
  | { status: "HUMAN_REQUIRED"; reasons: readonly string[] }
  | { status: "APPROVED_PENDING_COMMIT"; receiptId: string; bindingDigest: string };

export type NativeLifecycleStatus = "pending" | "in_progress" | "completed" | "blocked" | "abandoned";
export type NativeTodoOperation = "init" | "append" | "view" | "done" | "drop" | "rm" | "start" | "block" | "unblock";
export interface ProjectedNativePhase {
  name: string;
  tasks: Array<{ content: string; status: NativeLifecycleStatus; blocker?: string }>;
}

export interface ContractReference {
  contractId: string;
  revisionId: string;
  incarnationId: string;
}

export interface ReviewProvenance {
  sessionId: string;
  branchId: string;
  requestEntryId: string;
  dispatchId: string;
  evidenceDigest: string;
  policyDigest: string;
  questionDigest: string;
  /** If present, host-matched result identity. Immutable dispatches may use separate authenticated receipt provenance. */
  resultCallId?: string;
}

interface ReviewBase { provenance: ReviewProvenance; authorizedScope: AllowedMutationScope }
export type ReviewBinding =
  | (ReviewBase & { purpose: "consultation"; request: HostReference })
  | (ReviewBase & { purpose: "task_review"; contract: ContractReference; logicalOperationId: string; target: NativeTaskTarget })
  | (ReviewBase & {
      purpose: "parent_review"; contract: ContractReference; logicalOperationId: string; target: NativeTaskTarget;
      parentObligationIds: readonly string[]; childReceiptIds: readonly string[]; integrationReceiptIds: readonly string[];
    })
  | (ReviewBase & { purpose: "shadow"; corpus: { corpusId: string; caseId: string; contractDigest: string } });

export interface ContractDebtReference {
  debtId: string;
  contract: ContractReference;
  criterionIds: readonly string[];
  reason: string;
  sourceEntryId: string;
}

export interface NativeIncarnationReference {
  incarnationId: string;
  creation: CreationProvenance;
  target: NativeTaskTarget;
  creationKnown: boolean;
}

export interface NativeHistoryTargetTransition {
  before?: NativeIncarnationReference;
  after?: NativeIncarnationReference;
  beforeStatus?: NativeLifecycleStatus;
  afterStatus?: NativeLifecycleStatus;
  /** Native completion list observation, not semantic approval. */
  completionReported: boolean;
}

export interface NativeHistoryResultProvenance {
  callId: string;
  callEntryId: string;
  resultEntryId: string;
  inputDigest: string;
  operation: string;
  targets: NativeHistoryTargetTransition[];
}

export interface NativeHistorySuccess extends NativeHistoryResultProvenance {
  outcome: "native_success";
}

export interface NativeHistoryFailure extends NativeHistoryResultProvenance {
  outcome: "native_failure";
  classification: "unclassified-native-failure";
}

/** Persist only contract/debt facts. Semantic approvals are deliberately absent. */
export type ContractHistoryRecord = {
  schemaVersion: 1;
  sessionId: string;
  branchId: string;
  operationId: string;
  sourceEntryId: string;
} & (
  | { kind: "contract"; contract: TaskContract }
  | { kind: "debt"; debt: ContractDebtReference }
);
