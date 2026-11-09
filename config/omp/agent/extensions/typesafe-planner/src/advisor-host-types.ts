import type { AdvisorRequestInput, AdvisorRequest, AdvisorReceipt } from "./advisor-protocol";
import type { NativeTaskContext } from "./advisor-runtime";
import type { NormalizedNativeTodoInput } from "./task-contract-input";
import type { VerificationOutcome } from "./types/verification";
import type { TrustedToolPolicy, ResolvedToolPolicy } from "./payload-safety";
import type { NativeMutationDelegationOptions, NativeMutationScopeGrant } from "./advisor-mutation-delegation";
import type { AdvisorHostSettlement } from "./advisor-host-settlement";

export interface AdvisorHostSessionManager {
  getSessionId(): string;
  getEntries?(): readonly unknown[];
  getSessionFile(): string | undefined;
  getHeader(): { parentSession?: string } | null;
  getBranch(): readonly unknown[];
}
/** Readonly projection of actual SDK context; deliberately excludes invokeTool. */
export interface AdvisorHostContext {
  cwd: string; agent: { kind: "main" | "sub"; id: string; name: string; parentId?: string; depth?: number };
  model?: { api?: string; provider?: string; id?: string; contextWindow?: number };
  sessionManager: AdvisorHostSessionManager; abort(): void;
  advisorSessionEpoch: string;
}
export interface AdvisorHostExecuteContext extends Omit<AdvisorHostContext, "advisorSessionEpoch">, NativeTaskContext {}
export interface AdvisorHostToolResult { content: { type: "text"; text: string }[]; details?: unknown; isError?: boolean }
export interface AdvisorHostToolDefinition {
  name: string; label: string; description: string; parameters: unknown; sourcePath?: string; approval?: "read" | "exec"; strict?: boolean; lenientArgValidation?: boolean; concurrency?: "exclusive";
  execute(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: ((update: unknown) => void) | undefined, context: AdvisorHostExecuteContext): Promise<unknown>;
}
export interface AdvisorHostToolInfo { name: string; description: string; parameters: unknown; sourceInfo: { path: string; source: string } }
export interface AdvisorHostAPI {
  zod: { object(shape: Record<string, unknown>): unknown; string(): { optional(): unknown }; unknown(): { optional(): unknown } };
  events: object;
  on(event: string, handler: (event: unknown, context: AdvisorHostExecuteContext) => unknown | Promise<unknown>): void;
  registerTool(definition: AdvisorHostToolDefinition): void;
  getAllTools(): AdvisorHostToolInfo[];
  getActiveTools(): string[];
  setActiveTools(names: string[]): Promise<void>;
  appendEntry(customType: string, data: unknown): void;
  sendMessage(message: { customType: string; content: string; display: boolean }, options: { deliverAs: "nextTurn"; triggerTurn: true }): void | Promise<void>;
}
export type AdvisorRequestDraft = Omit<AdvisorRequestInput, "parentToolCallId" | "itemIndex">;
export interface AdvisorHostOutcome { status: "UNAVAILABLE" | "EVIDENCE_REQUIRED" | "REVIEW_REQUIRED"; reasons: readonly string[] }
export interface AdvisorDispatchPreparation { token: string; mode: "task" | "consultation"; draft: AdvisorRequestDraft; itemIndex: number }
export interface AdvisorHostServices {
  prepareReview(params: Record<string, unknown>, context: AdvisorHostContext, mode: "task" | "consultation"): Promise<AdvisorRequestDraft | AdvisorHostOutcome> | AdvisorRequestDraft | AdvisorHostOutcome;
  createTaskRequest(params: Record<string, unknown>, context: AdvisorHostContext, actualTaskToolCallId: string, preparation: AdvisorDispatchPreparation): Promise<AdvisorRequest | AdvisorHostOutcome> | AdvisorRequest | AdvisorHostOutcome;
  createConsultationRequest(params: Record<string, unknown>, context: AdvisorHostContext, actualTaskToolCallId: string, preparation: AdvisorDispatchPreparation): Promise<AdvisorRequest | AdvisorHostOutcome> | AdvisorRequest | AdvisorHostOutcome;
  onReceipt(receipt: AdvisorReceipt, context: AdvisorHostContext): Promise<void> | void;
  isCurrent(request: AdvisorRequestDraft | AdvisorRequest, context: AdvisorHostContext): Promise<boolean> | boolean;
  deadline?(request: AdvisorRequest, context: AdvisorHostContext): number | undefined;
  trustedAdvisorPolicy?: TrustedToolPolicy | ResolvedToolPolicy;
}
export type AdvisorShadowDraftFactory = (context: AdvisorHostContext) => AdvisorRequestDraft | AdvisorHostOutcome | Promise<AdvisorRequestDraft | AdvisorHostOutcome>;
export interface AdvisorHostIdentity { sessionId: string; sessionEpoch: string; parentAgentId: string }
export type AdvisorNativeTodoOutcome = AdvisorHostOutcome | Exclude<VerificationOutcome, { status: "APPROVED_PENDING_COMMIT" }>;
export interface AdvisorNativeTodoServices {
  beforeExecute(params: Record<string, unknown>, context: AdvisorHostContext, actualCallId: string, signal?: AbortSignal): Promise<{ status: "READY"; input: NormalizedNativeTodoInput } | AdvisorNativeTodoOutcome>;
  afterExecute(params: NormalizedNativeTodoInput, context: AdvisorHostContext, actualCallId: string, actualNativeResult: unknown): void | Promise<void>;
}
export interface AdvisorHostOptions {
  nativeTodo?: AdvisorNativeTodoServices;
  mutationDelegation?: NativeMutationDelegationOptions;
  /** Trusted session-latched policy, never caller tool arguments or transport availability. */
  isProjectExcluded?: (context: AdvisorHostExecuteContext) => boolean;
}
export interface AdvisorHostReview { request: AdvisorRequest; receipt: AdvisorReceipt }
export interface AdvisorHostRegistration {
  prepareShadowReview(prepare: AdvisorShadowDraftFactory, context: AdvisorHostExecuteContext): Promise<AdvisorHostToolResult>;
  identity(context: AdvisorHostExecuteContext): AdvisorHostIdentity | undefined;
  todoReady(context: AdvisorHostExecuteContext): boolean;
  delegatedMutationScope(context: AdvisorHostExecuteContext): Promise<NativeMutationScopeGrant | undefined>;
  settlement(token: string, context: AdvisorHostExecuteContext): Promise<AdvisorHostSettlement | undefined>;
  reviews(context: AdvisorHostExecuteContext): Promise<readonly AdvisorHostReview[]>;
  status(context: AdvisorHostExecuteContext): AdvisorHostOutcome | { status: "available" };
}
