import { DISPOSITIONS } from "./jev-paired-types";
import type { Attempt, Episode, Price, Strategy } from "./jev-paired-types";
import { isFloatingModelAlias } from "./jev-paired-validation";
export interface Cash { value: number | null; reason: string | null; support: number }
export function priceAttempt(a: Attempt, prices: Price[]): Cash {
  if (!a.resolvedModel || isFloatingModelAlias(a.resolvedModel) || !a.usage || !a.provider || a.metadataComplete === false) return {value:null,reason:a.unknownReason || "resolved_model_or_usage_unavailable",support:0};
  const u = a.usage;
  if (![u.inputTokens,u.outputTokens,u.cachedInputTokens].every(x => Number.isSafeInteger(x) && x >= 0) || u.cachedInputTokens > u.inputTokens) return { value:null,reason:"invalid_provider_usage",support:0 };
  const applicable = prices.filter(p => p.provider === a.provider && p.model === a.resolvedModel);
  if (applicable.length !== 1) return { value:null,reason:"applicable_frozen_price_unavailable",support:0 };
  const p = applicable[0];
  if (!Number.isFinite(Date.parse(p.effectiveAt)) || Date.parse(p.effectiveAt) > Date.parse(a.startedAt)) return {value:null,reason:"frozen_price_not_applicable_at_attempt_time",support:0};
  if (u.cachedInputTokens > 0 && p.cachedInputPerMillion === null) return { value:null,reason:"cache_price_unavailable",support:0 };
  const value = ((u.inputTokens-u.cachedInputTokens)*(p.inputPerMillion/1e6) + u.cachedInputTokens*((p.cachedInputPerMillion ?? 0)/1e6) + u.outputTokens*(p.outputPerMillion/1e6));
  return Number.isFinite(value) && value >= 0 ? {value,reason:null,support:1} : {value:null,reason:"usage_priced_cash_not_representable",support:0};
}
export function validateReceipts(attempts: Attempt[], episodes: Episode[], runId: string): string[] {
  const errors: string[] = [], owned = new Map<string,Attempt>(), episodesSeen = new Set<string>(), usage = new Map<string,string>();
  const advisorReceipts = new Set<string>(), terminalReceipts = new Set<string>();
  for (const a of attempts) {
    if (!a.receiptId || owned.has(a.receiptId)) errors.push(`duplicate_attempt_receipt:${a.receiptId}`);
    owned.set(a.receiptId,a);
    if (a.runId !== runId || !["M","H"].includes(a.arm) || !["jev","advisor","parent"].includes(a.role)) errors.push(`attempt_ownership_mismatch:${a.receiptId}`);
    if (!a.parentId || !a.requestedModel || ((!a.provider || a.resolvedModel === null || a.usage === null) && !a.unknownReason)) errors.push(`incomplete_attempt_metadata:${a.receiptId}`);
    if ((a.billedUsd !== null && (!Number.isFinite(a.billedUsd) || a.billedUsd < 0)) || (a.billedUsd === null && !a.billingReason)) errors.push(`invalid_billing:${a.receiptId}`);
    if (a.bodyBytes !== null && (!Number.isSafeInteger(a.bodyBytes) || a.bodyBytes < 0 || (a.role === "jev" && a.bodyBytes > 32768))) errors.push(`invalid_body_bytes:${a.receiptId}`);
    if ((a.role === "jev" && a.questionIds.length > 128) || new Set(a.questionIds).size !== a.questionIds.length) errors.push(`invalid_questions:${a.receiptId}`);
    if (a.questionCount !== undefined && a.questionCount !== null && (!Number.isInteger(a.questionCount) || a.questionCount < 0 || a.questionCount !== a.questionIds.length)) errors.push(`question_count_identity_mismatch:${a.receiptId}`);
    if (!Number.isFinite(Date.parse(a.startedAt)) || !Number.isFinite(Date.parse(a.endedAt)) || Date.parse(a.endedAt) < Date.parse(a.startedAt) || !Number.isInteger(a.retry) || a.retry < 0 || (a.cooldownMs !== null && (!Number.isFinite(a.cooldownMs) || a.cooldownMs < 0))) errors.push(`invalid_attempt_timing:${a.receiptId}`);
  }
  for (const e of episodes) {
    if (episodesSeen.has(e.id)) errors.push(`duplicate_episode:${e.id}`); episodesSeen.add(e.id);
    if (!e.receiptId || terminalReceipts.has(e.receiptId)) errors.push(`duplicate_terminal_receipt:${e.receiptId}`);
    terminalReceipts.add(e.receiptId);
    if (e.advisorReceiptId) {
      if (advisorReceipts.has(e.advisorReceiptId)) errors.push(`cross_arm_Advisor_receipt_reuse:${e.advisorReceiptId}`);
      advisorReceipts.add(e.advisorReceiptId);
    }
    if (!DISPOSITIONS.includes(e.disposition) || !["terminal","censored"].includes(e.status)) errors.push(`invalid_five_disposition:${e.id}`);
    if (e.unnecessaryReviewerActions !== null && (!Number.isFinite(e.unnecessaryReviewerActions) || e.unnecessaryReviewerActions < 0)) errors.push(`invalid_reviewer_actions:${e.id}`);
    if (e.completionEvent !== null) errors.push(`invented_shadow_completion:${e.id}`);
    if (new Set(e.attemptIds).size !== e.attemptIds.length) errors.push(`duplicate_episode_attempt:${e.id}`);
    for (const id of e.attemptIds) {
      const a = owned.get(id);
      if (!a || a.caseId !== e.caseId || a.arm !== e.arm) errors.push(`unowned_episode_attempt:${id}`);
      if (usage.has(id)) errors.push(`cross_episode_receipt_reuse:${id}`); usage.set(id,e.id);
    }
    if (e.status === "terminal" && (e.latencyMs === null || !Number.isFinite(e.latencyMs) || e.latencyMs < 0 || !e.terminalAt || !e.timingSegments.length)) errors.push(`missing_terminal_timing:${e.id}`);
    if (e.timingSegments.some(x => !Number.isFinite(x.elapsedMs) || x.elapsedMs < 0 || !Number.isFinite(Date.parse(x.start)) || !Number.isFinite(Date.parse(x.end)))) errors.push(`invalid_timing_segment:${e.id}`);
    if (e.latencyMs !== null && e.timingSegments.length && (e.timingSegments[0].start !== e.admittedAt || e.timingSegments[e.timingSegments.length-1].end !== e.terminalAt)) errors.push(`timing_does_not_cover_original_admission:${e.id}`);
    if (e.status === "terminal" && e.latencyMs !== null && Math.abs(e.timingSegments.reduce((sum,x) => sum+x.elapsedMs,0)-e.latencyMs) > 1) errors.push(`incomplete_or_inconsistent_timing_segments:${e.id}`);
  }
  for (const id of owned.keys()) if (!usage.has(id)) errors.push(`orphan_paid_attempt:${id}`);
  return errors;
}
export function episodeCash(episodes: Episode[], attempts: Attempt[], prices: Price[], scheduled: number): Cash {
  if (!scheduled || episodes.length !== scheduled || episodes.some(e => e.status !== "terminal" || !e.attemptIds.length || !e.accountingComplete)) return { value:null,reason:episodes.find(e => !e.accountingComplete)?.accountingReason || "scheduled_episode_accounting_incomplete",support:episodes.length };
  const wanted = new Set(episodes.flatMap(e => e.attemptIds)), selected = attempts.filter(a => wanted.has(a.receiptId));
  if (selected.length !== wanted.size) return { value:null,reason:"attempt_receipts_missing",support:selected.length };
  const priced = selected.map(a => priceAttempt(a,prices));
  const unknown = priced.find(p => p.value === null);
  if (unknown) return {value:null,reason:unknown.reason,support:priced.filter(p => p.value !== null).length};
  const value = priced.reduce((sum,p) => sum+(p.value ?? 0)/scheduled,0);
  return Number.isFinite(value) ? {value,reason:null,support:scheduled} : {value:null,reason:"episode_cash_not_representable",support:scheduled};
}
export function billingTotal(attempts: Attempt[], arm?: Strategy): Cash {
  const selected = attempts.filter(a => !arm || a.arm === arm);
  if (!selected.length || selected.some(a => a.billedUsd === null)) return { value:null,reason:"actual_billing_not_returned_for_every_attempt",support:selected.filter(a => a.billedUsd !== null).length };
  if (new Set(selected.map(a => a.receiptId)).size !== selected.length) return {value:null,reason:"duplicate_actual_billing_receipts",support:0};
  const value = selected.reduce((sum,a) => sum+(a.billedUsd ?? 0),0);
  return Number.isFinite(value) && value >= 0 ? {value,reason:null,support:selected.length} : {value:null,reason:"actual_billing_total_not_representable",support:selected.length};
}
