import { ownsAdvisorHostSettlement, type AdvisorHostSettlement } from "./advisor-host-settlement";
import { canonicalDigest } from "./task-contract-source";
import type { OwnedEvaluationCase } from "./evaluation-host-corpus";
import type { Attempt, Episode } from "../tools/jev-paired-types";
import type { NativeProof } from "../tools/jev-paired-host-protocol";
export interface OriginalEvaluationObservation {episode:Episode;attempts:Attempt[]}
export function observedNativeProof(settlement:AdvisorHostSettlement):NativeProof {
  if (!ownsAdvisorHostSettlement(settlement) || settlement.source !== "actual_host_task_history" || settlement.authority !== "none") throw new Error("actual_process_owned_native_settlement_required");
  return {status:settlement.status,requestDigest:settlement.request.requestDigest,parentToolCallId:settlement.provenance.parentToolCallId,itemIndex:settlement.provenance.itemIndex,
    childId:settlement.provenance.childId ?? (settlement.status === "accepted" ? settlement.review.receipt.provenance.childId : null),reportedChildId:settlement.provenance.reportedChildId ?? null,
    sessionEpoch:settlement.provenance.sessionEpoch,terminalDigest:settlement.provenance.terminalDigest,terminalEntryIds:[...settlement.provenance.terminalEntryIds],nativeInvocationObserved:settlement.nativeInvocationObserved,
    sdkAccounting:settlement.accounting ?? null,reasonCodes:[...settlement.reasonCodes]};
}
/** A real settled native failure is a workflow UNAVAILABLE, never a forged assessment or provider attempt. */
export function failedNativeObservation(owned:OwnedEvaluationCase,settlement:AdvisorHostSettlement,admittedAt:string,terminalAt:string,elapsedMs:number):OriginalEvaluationObservation {
  if (!ownsAdvisorHostSettlement(settlement) || settlement.status !== "failed") throw new Error("actual_failed_native_settlement_required");
  const manifest = owned.input.atomic.packetSet.manifest,parentIds = manifest.parentRequirements.map(p => `parent:${p.parentContractId}:${p.criterionId}`);
  const episode:Episode = {id:`${owned.case.id}:${owned.request.arm}`,caseId:owned.case.id,arm:owned.request.arm,receiptId:`native-failure:${canonicalDigest({request:settlement.request.requestDigest,provenance:settlement.provenance})}`,
    disposition:"UNAVAILABLE",status:"terminal",reason:settlement.reasonCodes.join(";") || "actual_native_assessment_unavailable",admittedAt,terminalAt,latencyMs:elapsedMs,timingSegments:[{start:admittedAt,end:terminalAt,elapsedMs}],
    attemptIds:[],integrationMiss:null,integrationAssessment:"unavailable",unnecessaryReviewerActions:null,accountingComplete:false,
    accountingReason:"actual_native_sdk_aggregate_is_not_provider_attempt_or_billing_attestation;all_paid_Advisor_and_parent_attempt_metadata_unavailable",
    predicateDecisionPolicyDigest:null,macroApprovalPolicyDigest:null,
    coverage:{required:owned.input.atomic.criteria.length,covered:0,uncoveredCriterionIds:owned.input.atomic.criteria.map(c => c.id),parentRequired:parentIds.length,parentCovered:0,uncoveredParentRequirementIds:parentIds,uncoveredArtifactPaths:manifest.artifacts.filter(a => a.required).map(a => a.path)},
    advisorReceiptId:null,completionEvent:null};
  return {episode,attempts:[]};
}
