import type { ContractHistoryProjection } from "./task-contract-history";
import type { HostContractValidators } from "./host-history";
import type { HostToolInvocation, HostToolInvocationRuntime } from "./host-tool-invocation";
import type {
  AllowedMutationScope, ContractCriterion, ContractReference, HostReference, NativeTaskSourceBinding, SourceSpan, TaskContract,
} from "./types/verification";

export const CONTRACT_SOURCE_CUSTOM_TYPE = "omp.typesafe.contract.source.v1";
export const CONTRACT_CONFIRMATION_CUSTOM_TYPE = "omp.typesafe.contract.confirmation.v1";
export const CONTRACT_BIND_TOOL_NAME = "typesafe_bind_task";

export interface ContractBindingProposal {
  task: string;
  phase?: string;
  planPath?: string;
  phaseHeading?: string;
  originalUserEntryId?: string;
}
/** Exact supported public binding transport fields, never assistant history or model authority flags. */
export interface ContractBindingInvocationInput extends ContractBindingProposal { i?: string }
export interface ContractTaskSelector { task: string; phase?: string }
export interface FrozenSourceDocument { path: string; digest: string; text: string }
export interface FrozenParentSourceContext extends FrozenSourceDocument {
  phaseHeading: string;
  criteria: readonly ContractCriterion[];
  master?: FrozenSourceDocument;
}
export interface FrozenNativeTaskSource extends FrozenSourceDocument {
  kind: "native_task";
  nativeBinding: NativeTaskSourceBinding;
  spans: readonly SourceSpan[];
}
export interface CookInputObservationReference { sessionId: string; entryId: string; digest: string }
export interface CookInputObservation {
  reference: CookInputObservationReference;
  userRequest: HostReference;
  sourcePath: string;
  origin: "interactive" | "rpc";
  documents: readonly FrozenSourceDocument[];
}
/** Factual SDK input/source observation, never a raw-human or execution authorization receipt. */
export interface CookInputObservationRecord {
  schemaVersion: 1;
  kind: "cook_input_observation";
  sessionId: string;
  originParentId: string | null;
  nonce: string;
  origin: "interactive" | "rpc";
  prompt: string;
  promptDigest: string;
  sourcePath: string;
  documents: readonly FrozenSourceDocument[];
}
export type ContractSourceAuthorization =
  | { kind: "readonly" }
  | { kind: "host_confirmation"; reference: HostReference; sourcePath?: string; execution: boolean };

export interface FrozenContractSourceContext {
  contract: ContractReference;
  originalUserRequest: { reference: HostReference; text: string };
  taskSource: FrozenNativeTaskSource;
  parentSource?: FrozenParentSourceContext;
  observedCookInput?: CookInputObservation;
  taskKind: TaskContract["taskKind"];
  /** Workspace source inspection is separate from the scope of authorized edits. */
  readScope: readonly string[];
  allowedMutationScope: AllowedMutationScope;
  approvedCommandIds: readonly string[];
  policyDigest: string;
  authorization: ContractSourceAuthorization;
}
export type ContractBindingOutcome =
  | { status: "BOUND"; contract: TaskContract; sourceContext: FrozenContractSourceContext }
  | { status: "EVIDENCE_REQUIRED" | "UNAVAILABLE" | "REJECTED" | "HUMAN_REQUIRED"; reasons: readonly string[] };

export interface ContractRuntimeOptions {
  appendEntry(customType: string, data: unknown): void;
  policyDigest: string;
  approvedCommandIds: readonly string[];
  invocations: HostToolInvocationRuntime;
}
export interface ContractRuntime {
  projection(ctx: unknown): ContractHistoryProjection | undefined;
  captureCookInput(ctx: unknown, actualEvent: unknown): Promise<void>;
  bind(ctx: unknown, toolCallId: string, proposal: ContractBindingProposal): Promise<ContractBindingOutcome>;
  contractFor(ctx: unknown, target: ContractTaskSelector): TaskContract | undefined;
  sourceContext(contract: TaskContract): FrozenContractSourceContext | undefined;
  validators(ctx: unknown): HostContractValidators;
}

export interface ContractSourceJournalRecord {
  schemaVersion: 1;
  sessionId: string;
  branchId: string;
  toolCallId: string;
  callEntryId: string;
  invocation: HostToolInvocation;
  invocationInput: ContractBindingInvocationInput;
  revision: number;
  previousRevisionId?: string;
  amendment?: HostReference;
  proposal: ContractBindingProposal;
  originalUserRequest: { reference: HostReference; text: string };
  taskSource: FrozenNativeTaskSource;
  parentSource?: FrozenParentSourceContext;
  inputObservation?: CookInputObservationReference;
  taskKind: TaskContract["taskKind"];
  readScope: readonly string[];
  allowedMutationScope: AllowedMutationScope;
  approvedCommandIds: readonly string[];
  policyDigest: string;
  authorization: ContractSourceAuthorization;
}
export interface ContractConfirmationJournalRecord {
  schemaVersion: 1;
  sessionId: string;
  branchId: string;
  toolCallId: string;
  callEntryId: string;
  invocation: HostToolInvocation;
  originalUserRequest: HostReference;
  taskDigest: string;
  nativeBinding: NativeTaskSourceBinding;
  parentDigest?: string;
  parentContextDigest: string;
  inputObservation?: CookInputObservationReference;
  previousRevisionId?: string;
  previousParentDigest?: string;
  taskKind: TaskContract["taskKind"];
  execution: boolean;
  allowedMutationScope: AllowedMutationScope;
  approvedCommandIds: readonly string[];
  policyDigest: string;
  /** Written only after the actual host UI confirmation returns true. Not semantic approval. */
  decision: "confirmed_source_scope";
}
