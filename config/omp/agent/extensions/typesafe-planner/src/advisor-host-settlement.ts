import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import { record, advisorOutputSchema, type AdvisorRequest } from "./advisor-protocol";
import { findProjectToolCall, readHostBranch } from "./host-history";
import { validAdvisorNativeControls } from "./advisor-native-schema";
import { hasSettledAdvisorHistory } from "./advisor-host-history";
import { advisorHub, type HostScope } from "./advisor-host-state";
import type { AdvisorHostReview } from "./advisor-host-types";
import type { AdvisorNativeAccounting } from "./advisor-native-observation";

export interface AdvisorHostSettlementProvenance {
  parentToolCallId: string; itemIndex: number; sessionEpoch: string; childId?: string; reportedChildId?: string;
  terminalDigest: string; terminalEntryIds: readonly string[];
}
interface AdvisorHostSettlementBase {
  source: "actual_host_task_history"; token: string; request: AdvisorRequest;
  provenance: AdvisorHostSettlementProvenance; nativeInvocationObserved: boolean | "unknown"; accounting?: AdvisorNativeAccounting;
  reasonCodes: readonly string[]; authority: "none";
}
export type AdvisorHostSettlement =
  | AdvisorHostSettlementBase & { status: "accepted"; review: AdvisorHostReview }
  | AdvisorHostSettlementBase & { status: "failed"; review?: never };
const owned = new WeakMap<object, HostScope>();
/** Process-owned history observation, not a JSON/digest/billing/approval attestation. */
export function ownsAdvisorHostSettlement(value: unknown): value is AdvisorHostSettlement {
  return value !== null && typeof value === "object" && owned.has(value);
}
export async function isCurrentAdvisorHostSettlement(value: unknown): Promise<boolean> {
  if (!ownsAdvisorHostSettlement(value)) return false;
  const scope = owned.get(value);
  if (!scope?.active || scope.epoch !== value.request.sessionEpoch || scope.sessionId !== scope.context.sessionManager.getSessionId()
    || advisorHub(scope.api).roots.get(scope.context.sessionManager) !== scope) return false;
  try { return await scope.services.isCurrent(value.request, scope.context); } catch { return false; }
}
/** Called only by the registration closure. A middleware callback is never a settled history row. */
export async function collectAdvisorHostSettlement(scope: HostScope, token: string, publish: (request: AdvisorRequest) => AdvisorHostReview | undefined): Promise<AdvisorHostSettlement | undefined> {
  const provisional = scope.provisionals.get(token); const request = provisional?.finalRequestId ? scope.requests.get(provisional.finalRequestId) : undefined;
  if (!request || !scope.active || request.sessionEpoch !== scope.epoch || scope.inflight.has(request.parentToolCallId)) return undefined;
  const branch = readHostBranch(scope.context);
  if (!branch || branch.sessionId !== scope.sessionId) return undefined;
  const call = findProjectToolCall(branch, request.parentToolCallId, "task");
  const items = call && (Array.isArray(call.params.tasks) ? call.params.tasks : [call.params]); const item = items?.[request.itemIndex];
  if (!call || !record(item) || item.agent !== request.agent || item.task !== request.publicPrompt || item.schemaMode !== "strict"
    || canonicalDigest(item.outputSchema) !== canonicalDigest(advisorOutputSchema)
    || !validAdvisorNativeControls(call.params, item, Array.isArray(call.params.tasks) ? "batch" : "flat")) return undefined;
  const rows = branch.entries.filter(entry => entry.type === "message" && entry.message?.role === "toolResult"
    && entry.message.toolCallId === request.parentToolCallId && entry.message.toolName === call.transportToolName);
  if (!rows.length) return undefined;
  const reasons = new Set(scope.failures.get(request.requestId) ?? []);
  const terminalBodies = rows.map(entry => {
    const message: Record<string, unknown> = entry.message ?? {}; const { timestamp: _timestamp, ...body } = message; return body;
  });
  const bodyDigests = terminalBodies.map(canonicalDigest);
  if (new Set(bodyDigests).size !== 1) reasons.add("advisor_conflicting_settled_native_results");
  for (const row of rows) {
    if (row.message?.isError !== undefined && row.message.isError !== false) reasons.add("advisor_settled_outer_result_failed");
    if (record(row.message?.details) && row.message.details.async !== undefined) reasons.add("advisor_async_ack_not_assessment");
  }
  const observation = scope.nativeObservations.get(request.requestId);
  for (const code of observation?.reasonCodes ?? []) reasons.add(code);
  let current = false;
  try { current = await scope.services.isCurrent(request, scope.context); } catch { reasons.add("advisor_current_snapshot_revalidation_unavailable"); }
  if (!current) reasons.add("advisor_settled_snapshot_not_current");
  const receipt = scope.runtime.currentReceipt(request.requestId);
  const review = current && receipt && reasons.size === 0 && hasSettledAdvisorHistory(scope, request, receipt) ? publish(request) : undefined;
  if (!review) reasons.add("advisor_no_current_valid_native_assessment");
  const body = { source: "actual_host_task_history" as const, token, request, authority: "none" as const,
    provenance: { parentToolCallId: request.parentToolCallId, itemIndex: request.itemIndex, sessionEpoch: request.sessionEpoch,
      ...(observation?.actualAllocatedChildId ? { childId: observation.actualAllocatedChildId } : {}),
      ...(observation?.reportedChildId ? { reportedChildId: observation.reportedChildId } : {}),
      terminalDigest: canonicalDigest(bodyDigests), terminalEntryIds: rows.map(row => row.id) },
    nativeInvocationObserved: observation?.nativeInvocationObserved ?? ("unknown" as const),
    ...(observation?.accounting ? { accounting: observation.accounting } : {}),
    reasonCodes: [...reasons, ...(!observation ? ["advisor_native_accounting_observation_unavailable"] : [])] };
  const settlement: AdvisorHostSettlement = review ? freezeContractValue({ ...body, status: "accepted" as const, review }) : freezeContractValue({ ...body, status: "failed" as const });
  owned.set(settlement, scope); return settlement;
}
