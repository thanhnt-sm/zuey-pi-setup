import { record, advisorOutputSchema, validateAssessmentForRequest, type AdvisorReceipt, type AdvisorRequest } from "./advisor-protocol";
import { canonicalDigest } from "./task-contract-source";
import type { HostScope } from "./advisor-host-state";
import { nativeAdvisorPrompt } from "./advisor-native-prompt";
import { findProjectToolCall, readHostBranch } from "./host-history";
import { validAdvisorNativeControls } from "./advisor-native-schema";

/** A callback/journal is not the final native toolResult. Read the actual active branch. */
export function hasSettledAdvisorHistory(scope: HostScope, request: AdvisorRequest, receipt: AdvisorReceipt): boolean {
  const branch = readHostBranch(scope.context);
  if (!branch || branch.sessionId !== request.binding.provenance.sessionId) return false;
  const call = findProjectToolCall(branch, request.parentToolCallId, "task");
  if (!call) return false;
  const items = Array.isArray(call.params.tasks) ? call.params.tasks : [call.params];
  const item = items[request.itemIndex];
  if (!record(item) || item.agent !== request.agent || item.task !== request.publicPrompt || item.schemaMode !== "strict"
    || canonicalDigest(item.outputSchema) !== canonicalDigest(advisorOutputSchema)
    || !validAdvisorNativeControls(call.params, item, Array.isArray(call.params.tasks) ? "batch" : "flat")) return false;
  const rows = scope.context.sessionManager.getBranch().flatMap(entry => record(entry) && entry.type === "message" && record(entry.message)
    && entry.message.role === "toolResult" && entry.message.toolName === "task" && entry.message.toolCallId === request.parentToolCallId ? [entry.message] : []);
  if (!rows.length) return false;
  // Conflicting duplicated final rows never become authority by choosing the favorable one.
  let identity: string | undefined;
  for (const message of rows) {
    if (message.isError !== undefined && message.isError !== false || !record(message.details) || message.details.async !== undefined || !Array.isArray(message.details.results)
      || !record(message.details.advisorReceipt) || message.details.advisorReceipt.receiptId !== receipt.receiptId
      || message.details.advisorReceipt.requestId !== request.requestId) return false;
    const matches = message.details.results.filter(item => record(item) && (item.index === request.itemIndex || item.id === receipt.provenance.childId));
    if (matches.length !== 1) return false;
    const child = matches[0];
    if (!record(child) || child.index !== request.itemIndex || child.id !== receipt.provenance.childId || child.agent !== request.agent
      || child.agentSource !== "project" || child.task !== nativeAdvisorPrompt(request.publicPrompt) || child.assignment !== request.publicPrompt || child.exitCode !== 0 || child.error !== undefined
      || child.aborted !== undefined && child.aborted !== false || child.abortReason !== undefined || child.retryFailure !== undefined
      || !record(child.structuredOutput) || child.structuredOutput.source !== "caller" || child.structuredOutput.mode !== "strict"
      || child.structuredOutput.status !== "valid" || child.structuredOutput.error !== undefined || child.structuredOutput.incremental !== undefined
      || child.structuredOutput.useLastTurn !== undefined || child.structuredOutput.schemaOverridden !== undefined
      || !validateAssessmentForRequest(child.structuredOutput.data, request)
      || canonicalDigest(child.structuredOutput.data) !== receipt.assessmentDigest) return false;
    const { timestamp: _timestamp, ...terminal } = message;
    const next = canonicalDigest(terminal);
    if (identity && identity !== next) return false;
    identity = next;
  }
  return identity !== undefined;
}
