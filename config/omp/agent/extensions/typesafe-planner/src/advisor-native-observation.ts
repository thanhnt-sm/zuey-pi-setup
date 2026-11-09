import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import { record, type AdvisorRequest } from "./advisor-protocol";
export interface AdvisorNativeUsage { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number } }
export interface AdvisorNativeAccounting {
  source: "native_sdk_reported"; requests?: number; tokens?: number; durationMs?: number; resolvedModel?: string;
  usage?: AdvisorNativeUsage; unknownReasons: readonly string[];
}
export interface AdvisorNativeObservation {
  nativeInvocationObserved: boolean; actualAllocatedChildId?: string; reportedChildId?: string;
  nativeTerminalDigest?: string; accounting?: AdvisorNativeAccounting; reasonCodes: readonly string[];
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
function usage(raw: unknown): AdvisorNativeUsage | undefined {
  if (!record(raw)) return undefined;
  const result: AdvisorNativeUsage = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) if (finite(raw[key])) result[key] = raw[key];
  if (record(raw.cost)) {
    const cost: NonNullable<AdvisorNativeUsage["cost"]> = {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) if (finite(raw.cost[key])) cost[key] = raw.cost[key];
    if (Object.keys(cost).length) result.cost = cost;
  }
  return Object.keys(result).length ? result : undefined;
}
/** Observation only. It does not claim final outer success, an assessment, billing certainty, or native authority. */
export function captureAdvisorNativeObservation(request: AdvisorRequest, envelope: unknown, actualAllocatedChildId?: string): AdvisorNativeObservation {
  const reasons: string[] = []; let nativeTerminalDigest: string | undefined;
  try { nativeTerminalDigest = canonicalDigest(envelope); } catch { reasons.push("native_envelope_not_serializable"); }
  const details = record(envelope) && record(envelope.details) ? envelope.details : undefined;
  const rows = details && Array.isArray(details.results) ? details.results.filter(row => record(row) && row.index === request.itemIndex) : [];
  const child = rows.length === 1 && record(rows[0]) ? rows[0] : undefined;
  const observedUsage = usage(child?.usage) ?? usage(details?.usage);
  const unknownReasons: string[] = [];
  if (!child) unknownReasons.push("matching_native_child_metadata_unobserved");
  if (!observedUsage) unknownReasons.push("native_sdk_usage_unobserved");
  if (observedUsage?.cost?.total === undefined) unknownReasons.push("native_sdk_cost_unobserved");
  if (!finite(child?.requests)) unknownReasons.push("native_sdk_request_count_unobserved");
  unknownReasons.push("native_sdk_http_retry_breakdown_unobserved", "native_sdk_cost_not_vendor_billing_attestation");
  if (!actualAllocatedChildId) unknownReasons.push("actual_child_context_allocation_unobserved");
  if (actualAllocatedChildId && child?.id !== actualAllocatedChildId) reasons.push("native_reported_child_allocation_mismatch");
  if (record(envelope) && envelope.isError !== undefined && envelope.isError !== false) reasons.push("native_outer_result_failed");
  if (details?.async !== undefined) reasons.push("native_async_ack_not_settled_child");
  if (child && (child.exitCode !== 0 || child.error !== undefined || child.aborted || child.retryFailure !== undefined)) reasons.push("native_child_failed_or_aborted");
  const resolvedModel = typeof child?.resolvedModel === "string" && child.resolvedModel.length <= 256 && /^[\w.+:/-]+$/.test(child.resolvedModel) ? child.resolvedModel : undefined;
  const accounting: AdvisorNativeAccounting = { source: "native_sdk_reported", ...(finite(child?.requests) ? { requests: child.requests } : {}),
    ...(finite(child?.tokens) ? { tokens: child.tokens } : {}), ...(finite(child?.durationMs) ? { durationMs: child.durationMs } : {}),
    ...(resolvedModel ? { resolvedModel } : {}), ...(observedUsage ? { usage: observedUsage } : {}), unknownReasons };
  return freezeContractValue({ nativeInvocationObserved: true, ...(actualAllocatedChildId ? { actualAllocatedChildId } : {}),
    ...(typeof child?.id === "string" && child.id.length <= 256 ? { reportedChildId: child.id } : {}), ...(nativeTerminalDigest ? { nativeTerminalDigest } : {}), accounting, reasonCodes: reasons });
}

export function decodeAdvisorNativeObservation(value: unknown): AdvisorNativeObservation | undefined {
  if (!record(value) || typeof value.nativeInvocationObserved !== "boolean" || !Array.isArray(value.reasonCodes)
    || !value.reasonCodes.every(code => typeof code === "string" && /^[a-z0-9_:.-]{1,160}$/.test(code))) return undefined;
  const identity = (key: string) => value[key] === undefined || typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 256;
  if (!identity("actualAllocatedChildId") || !identity("reportedChildId")
    || value.nativeTerminalDigest !== undefined && (typeof value.nativeTerminalDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.nativeTerminalDigest))) return undefined;
  let accounting: AdvisorNativeAccounting | undefined;
  if (value.accounting !== undefined) {
    const raw = value.accounting;
    if (!record(raw) || raw.source !== "native_sdk_reported" || !Array.isArray(raw.unknownReasons)
      || !raw.unknownReasons.every(code => typeof code === "string" && /^[a-z0-9_:.-]{1,160}$/.test(code))
      || ["requests", "tokens", "durationMs"].some(key => raw[key] !== undefined && !finite(raw[key]))) return undefined;
    const model = typeof raw.resolvedModel === "string" && raw.resolvedModel.length <= 256 && /^[\w.+:/-]+$/.test(raw.resolvedModel) ? raw.resolvedModel : undefined;
    const decodedUsage = usage(raw.usage);
    accounting = { source: "native_sdk_reported", ...(finite(raw.requests) ? { requests: raw.requests } : {}), ...(finite(raw.tokens) ? { tokens: raw.tokens } : {}),
      ...(finite(raw.durationMs) ? { durationMs: raw.durationMs } : {}), ...(model ? { resolvedModel: model } : {}), ...(decodedUsage ? { usage: decodedUsage } : {}), unknownReasons: [...raw.unknownReasons] };
  }
  return freezeContractValue({ nativeInvocationObserved: value.nativeInvocationObserved,
    ...(typeof value.actualAllocatedChildId === "string" ? { actualAllocatedChildId: value.actualAllocatedChildId } : {}),
    ...(typeof value.reportedChildId === "string" ? { reportedChildId: value.reportedChildId } : {}),
    ...(typeof value.nativeTerminalDigest === "string" ? { nativeTerminalDigest: value.nativeTerminalDigest } : {}),
    ...(accounting ? { accounting } : {}), reasonCodes: [...value.reasonCodes] });
}
