import type { Attempt, CorpusCase, Episode, HumanLabel, Price, Protocol, ReviewCoverage } from "./jev-paired-types";
import type { NativeArmRequest, NativeHostEnvelope, NativeHostPayload, NativePendingIndex, FrozenRunOwnership } from "./jev-paired-host-protocol";
import { isFloatingModelAlias } from "./jev-paired-validation";
// DTO projections retain only declared audit metadata. Raw prompts/thinking/credentials in
// unknown fields never become manifest/report fields. Case evidence remains file-bound.
type Shape = "string" | "number" | "boolean" | "metadata" | { nullable:Shape } | { array:Shape } | { record:Shape } | { fields:Record<string,Shape>; optional?:string[] };
const binding:Shape = {fields:{path:"string",sha256:"string"}};
const human:Shape = {fields:{humanId:"string",disposition:"string",receipt:"string"}};
const noulPolicy:Shape = {fields:{semanticMode:"string",orientation:"string",supportsAbove:"number",supportsBelow:"number",contradictsAbove:"number",contradictsBelow:"number",uncertainty:"string"},optional:["supportsAbove","supportsBelow","contradictsAbove","contradictsBelow"]};
const nativeHost:Shape = {fields:{schemaVersion:"number",protocolIdentity:"string",hostId:"string",publicKey:"string",publicKeyDigest:"string",sessionId:"string",branchId:"string",sessionEpoch:"string",loadedFactoryIdentity:"string",candidateSourceManifestDigest:"string"}};
const sdkCost:Shape = {fields:{input:"number",output:"number",cacheRead:"number",cacheWrite:"number",total:"number"},optional:["input","output","cacheRead","cacheWrite","total"]};
const sdkUsage:Shape = {fields:{input:"number",output:"number",cacheRead:"number",cacheWrite:"number",totalTokens:"number",cost:sdkCost},optional:["input","output","cacheRead","cacheWrite","totalTokens","cost"]};
const sdkAccounting:Shape = {fields:{source:"string",requests:"number",tokens:"number",durationMs:"number",resolvedModel:"string",usage:sdkUsage,unknownReasons:{array:"string"}},optional:["requests","tokens","durationMs","resolvedModel","usage"]};
const nativeProof:Shape = {fields:{status:"string",requestDigest:"string",parentToolCallId:"string",itemIndex:"number",childId:{nullable:"string"},reportedChildId:{nullable:"string"},sessionEpoch:"string",terminalDigest:"string",terminalEntryIds:{array:"string"},nativeInvocationObserved:"metadata",sdkAccounting:{nullable:sdkAccounting},reasonCodes:{array:"string"}}};
const protocolFields:Record<keyof Protocol,Shape> = {
  schemaVersion:"number",kind:"string",state:"string",pendingInputs:{array:{fields:{owner:"string",action:"string",releaseCondition:"string"}}},seed:"string",decisionRule:"string",targetScope:"string",minimumGroups:"number",
  strata:{array:{fields:{id:"string",population:"string",language:"string",taskType:"string",risk:"string",integrationRequired:"boolean",minimumGroups:"number"},optional:["language","taskType","risk","integrationRequired"]}},
  metricGates:{array:{fields:{metric:"string",population:"string",stratum:"string",numerator:"string",denominator:"string",direction:"string",comparator:"string",allowEquality:"boolean",requiredSupport:"boolean",unknown:"string"}}},
  files:{fields:{corpus:"string",labels:"string",splits:"string",prices:"string"}},models:{fields:{jev:"string",jevRequest:"string",advisorProvider:"string",advisorModel:"string",advisorRequest:"string",parent:{fields:{provider:"string",model:"string",requestedModel:"string"},optional:["requestedModel"]}},optional:["parent","jevRequest","advisorRequest"]},expectedPolicyIdentity:{nullable:"string"},
  frozenConfiguration:{fields:{policy:binding,prompts:binding,packetSelection:binding,implementation:binding}},
  predicateDecisionPolicy:{nullable:{fields:{schemaVersion:"number",categorical:"string",noul:noulPolicy,byPredicate:{record:noulPolicy}},optional:["noul","byPredicate"]}},nativeHost:{nullable:nativeHost},
  approvalPolicy:{nullable:{fields:{threshold:"number",comparator:"string"}}},
  controlRule:"string",
  limits:{fields:{concurrency:"number",maxQuestions:"number",maxBodyBytes:"number",maxEpisodes:{nullable:"number"},maxRunMs:{nullable:"number"},deadlineAt:{nullable:"string"}}},
  accounting:{fields:{ownership:"string",latency:"string",admission:"string",quantile:"string",cacheConditions:"string",cooldownConditions:"string"}},canonicalSelection:"string",splitRatio:{array:"number"},holdoutUnit:"string",
  spend:{nullable:{fields:{approvalReceipt:"string",maximumUsd:"number"}}},implementationInvariants:{nullable:{fields:{receipt:binding,complete:"boolean"}}},
  scenarioCoverage:{record:{fields:{assertion:"string",semanticCaseIds:{array:"string"}},optional:["assertion","semanticCaseIds"]}},
  ablations:{array:{fields:{id:"string",kind:"string",baselineCaseIds:{array:"string"},caseIds:{array:"string"},stateQuestionDigest:"string"},optional:["stateQuestionDigest"]}},
};
const caseFields:Record<keyof CorpusCase,Shape> = {
  id:"string",projectId:"string",parentId:"string",familyId:"string",derivationIds:{array:"string"},independentGroup:"string",canonical:"boolean",population:"string",language:"string",taskType:"string",risk:"string",integrationRequired:"boolean",scenarioIds:{array:"string"},snapshots:{array:binding},input:binding,
  privacy:{fields:{approvedBy:"string",approvalReceipt:"string",sanitized:"boolean",exportScope:"string"}},
};
const labelFields:Record<keyof HumanLabel,Shape> = {
  caseId:"string",reviewerA:human,reviewerB:human,adjudicator:{nullable:human},expected:"string",integrationDefect:"boolean",unnecessaryReviewerActions:"number",
  provenance:{fields:{source:"string",custodianReceipt:"string",independenceReceipt:"string",blindedToVariantsAndOutputs:"boolean",labeledAt:"string",excludedAuthorAndAdvisorIds:{array:"string"}}},
};
const priceFields:Record<keyof Price,Shape> = {provider:"string",model:"string",inputPerMillion:"number",outputPerMillion:"number",cachedInputPerMillion:{nullable:"number"},effectiveAt:"string",source:"string"};
const attemptFields:Record<keyof Attempt,Shape> = {
  receiptId:"string",runId:"string",caseId:"string",arm:"string",parentId:"string",role:"string",requestedModel:"string",resolvedModel:{nullable:"string"},provider:{nullable:"string"},
  usage:{nullable:{fields:{inputTokens:"number",outputTokens:"number",cachedInputTokens:"number"}}},unknownReason:{nullable:"string"},billedUsd:{nullable:"number"},billingReason:{nullable:"string"},bodyDigest:{nullable:"string"},bodyBytes:{nullable:"number"},questionIds:{array:"string"},startedAt:"string",endedAt:"string",retry:"number",cooldownMs:{nullable:"number"},error:{nullable:"string"},
  policyIdentity:{nullable:"string"},questionCount:{nullable:"number"},monotonicTiming:{nullable:{fields:{startedAtMs:"number",endedAtMs:"number"}}},wallTimingScope:"string",httpStatus:{nullable:"number"},transportKind:{nullable:"string"},cooldown:{fields:{observed:{nullable:"boolean"},until:{nullable:"number"}}},questionStateDigests:{record:"string"},providerUsage:{record:"metadata"},providerBilling:{nullable:"metadata"},metadataComplete:"boolean",
};
const coverageFields:Record<keyof ReviewCoverage,Shape> = {required:"number",covered:"number",uncoveredCriterionIds:{array:"string"},parentRequired:"number",parentCovered:"number",uncoveredParentRequirementIds:{array:"string"},uncoveredArtifactPaths:{array:"string"}};
const episodeFields:Record<keyof Episode,Shape> = {
  id:"string",caseId:"string",arm:"string",receiptId:"string",disposition:"string",status:"string",reason:{nullable:"string"},admittedAt:"string",terminalAt:{nullable:"string"},latencyMs:{nullable:"number"},timingSegments:{array:{fields:{start:"string",end:"string",elapsedMs:"number"}}},attemptIds:{array:"string"},integrationMiss:{nullable:"boolean"},unnecessaryReviewerActions:{nullable:"number"},integrationAssessment:"string",accountingComplete:"boolean",accountingReason:{nullable:"string"},coverage:{nullable:{fields:coverageFields}},advisorReceiptId:{nullable:"string"},completionEvent:{nullable:{fields:{}}},
  predicateDecisionPolicyDigest:{nullable:"string"},
  macroApprovalPolicyDigest:{nullable:"string"},
  nativeObservation:nativeProof,
};
function project(shape:Shape,value:unknown,path:string,depth = 0):unknown {
  if (depth > 32) throw new Error(`metadata_nesting_limit:${path}`);
  if (typeof shape === "string") {
    if (shape === "metadata") {
      if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
      if (Array.isArray(value)) return value.map((v,i) => project("metadata",v,`${path}.${i}`,depth+1));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,v]) => [key,project("metadata",v,`${path}.${key}`,depth+1)]));
    } else if (typeof value === shape && (shape !== "number" || Number.isFinite(value))) return value;
    throw new Error(`invalid_input_field:${path}`);
  }
  if ("nullable" in shape) return value === null ? null : project(shape.nullable,value,path,depth+1);
  if ("array" in shape) { if (!Array.isArray(value)) throw new Error(`input_array_required:${path}`); return value.map((v,i) => project(shape.array,v,`${path}.${i}`,depth+1)); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`input_object_required:${path}`);
  const raw = value as Record<string,unknown>;
  if ("record" in shape) return Object.fromEntries(Object.entries(raw).map(([key,v]) => [key,project(shape.record,v,`${path}.${key}`,depth+1)]));
  const result:Record<string,unknown> = {};
  for (const key in shape.fields) {
    if (raw[key] === undefined && shape.optional?.includes(key)) continue;
    result[key] = project(shape.fields[key],raw[key],`${path}.${key}`,depth+1);
  }
  return result;
}
export function projectProtocol(value:unknown):Protocol { return project({fields:protocolFields,optional:["expectedPolicyIdentity"]},value,"protocol") as Protocol; }
export function projectCase(value:unknown):CorpusCase { return project({fields:caseFields},value,"case") as CorpusCase; }
export function projectLabel(value:unknown):HumanLabel { return project({fields:labelFields,optional:["provenance"]},value,"label") as HumanLabel; }
export function projectPrice(value:unknown):Price { return project({fields:priceFields},value,"price") as Price; }
export function projectAttempt(value:unknown):Attempt {
  const attempt = project({fields:attemptFields,optional:["policyIdentity","questionCount","monotonicTiming","wallTimingScope","httpStatus","transportKind","cooldown","questionStateDigests","providerUsage","providerBilling","metadataComplete"]},value,"attempt") as Attempt;
  if (attempt.resolvedModel && isFloatingModelAlias(attempt.resolvedModel)) {
    attempt.unknownReason = `provider_returned_alias_not_resolved_identity:${attempt.resolvedModel}`;
    attempt.resolvedModel = null; attempt.metadataComplete = false;
  }
  return attempt;
}
export function projectEpisode(value:unknown):Episode { return project({fields:episodeFields,optional:["integrationAssessment","nativeObservation"]},value,"episode") as Episode; }
export function projectNativeArmRequest(value:unknown):NativeArmRequest {
  return project({fields:{schemaVersion:"number",requestId:"string",nonce:"string",runId:"string",bundleDigest:"string",caseId:"string",arm:"string",inputDigest:"string",protocolPath:"string",run:"string",createdAt:"string",hostId:"string",hostKeyDigest:"string"}},value,"native_request") as NativeArmRequest;
}
export function projectNativeHostEnvelope(value:unknown):NativeHostEnvelope {
  return project({fields:{schemaVersion:"number",payloadBase64:"string",signatureBase64:"string"}},value,"native_envelope") as NativeHostEnvelope;
}
export function projectNativePendingIndex(value:unknown):NativePendingIndex {
  return project({fields:{schemaVersion:"number",requestId:"string",episodeId:"string",requestPath:"string"}},value,"native_pending") as NativePendingIndex;
}
export function projectFrozenRunOwnership(value:unknown):FrozenRunOwnership {
  return project({fields:{runId:"string",run:"string",bundleDigest:"string"}},value,"frozen_run_ownership") as FrozenRunOwnership;
}
export function projectNativeHostPayload(value:unknown):NativeHostPayload {
  const payload = project({fields:{schemaVersion:"number",kind:"string",host:nativeHost,requestDigest:"string",requestId:"string",runId:"string",bundleDigest:"string",freezeCreatedAt:"string",caseId:"string",arm:"string",episode:{fields:episodeFields,optional:["integrationAssessment","nativeObservation"]},attempts:{array:{fields:attemptFields,optional:["policyIdentity","questionCount","monotonicTiming","wallTimingScope","httpStatus","transportKind","cooldown","questionStateDigests","providerUsage","providerBilling","metadataComplete"]}},native:nativeProof,mutationAllowed:"boolean",authorityReusable:"boolean"}},value,"native_payload") as NativeHostPayload;
  payload.attempts = payload.attempts.map(projectAttempt); return payload;
}
