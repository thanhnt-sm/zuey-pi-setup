import { createHash, createPublicKey, verify } from "node:crypto";
import type { Attempt, Episode, Manifest, Strategy } from "./jev-paired-types";
import type { AdvisorNativeAccounting } from "../src/advisor-native-observation";
import { canonicalDigest } from "../src/task-contract-source";
import { projectNativeHostPayload } from "./jev-paired-inputs";
export const EVALUATION_HOST_PROTOCOL = "jev-paired-native-host-v1";
export interface NativeHostDescriptor {
  schemaVersion:1; protocolIdentity:typeof EVALUATION_HOST_PROTOCOL; hostId:string; publicKey:string;
  publicKeyDigest:string; sessionId:string; branchId:string; sessionEpoch:string;
  loadedFactoryIdentity:string; candidateSourceManifestDigest:string;
}
export type NativeHostBinding = NativeHostDescriptor;
export interface NativeArmRequest {
  schemaVersion:1; requestId:string; nonce:string; runId:string; bundleDigest:string;
  caseId:string; arm:Strategy; inputDigest:string; protocolPath:string; run:string; createdAt:string;
  hostId:string; hostKeyDigest:string;
}
export interface NativePendingIndex {schemaVersion:1;requestId:string;episodeId:string;requestPath:string}
export interface FrozenRunOwnership {runId:string;run:string;bundleDigest:string}
export interface NativeProof {
  status:"accepted"|"failed"; requestDigest:string; parentToolCallId:string; itemIndex:number; childId:string|null; reportedChildId:string|null; sessionEpoch:string; terminalDigest:string;
  terminalEntryIds:string[]; nativeInvocationObserved:boolean|"unknown"; sdkAccounting:AdvisorNativeAccounting|null; reasonCodes:string[];
}
export interface NativeHostPayload {
  schemaVersion:1; kind:"shadow_evaluation"; host:NativeHostDescriptor;
  requestDigest:string; requestId:string; runId:string; bundleDigest:string; freezeCreatedAt:string; caseId:string; arm:Strategy;
  episode:Episode; attempts:Attempt[]; native:NativeProof; mutationAllowed:false; authorityReusable:false;
}
export interface NativeHostEnvelope { schemaVersion:1; payloadBase64:string; signatureBase64:string }
export interface NativeBridgeAdvance {
  status:"needs_native_dispatch"|"complete"|"prerequisite_pending"|"inconclusive";
  requestPath?:string; requestId?:string; instructions?:string;
  prepare?:{tool:"typesafe_eval_host";action:"prepare";run:string;requestId:string};
  selection?:"adopt_H"|"retain_repaired_M";
}
export function hostFileId(episodeId:string):string { return createHash("sha256").update(episodeId).digest("hex"); }
export function publicKeyDigest(publicKey:string):string {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("native_host_key_must_be_ed25519");
  return createHash("sha256").update(key.export({format:"der",type:"spki"})).digest("hex");
}
export function matchesHost(actual:NativeHostDescriptor,expected:NativeHostDescriptor):boolean {
  return canonicalDigest(actual) === canonicalDigest({schemaVersion:expected.schemaVersion,protocolIdentity:expected.protocolIdentity,hostId:expected.hostId,publicKey:expected.publicKey,publicKeyDigest:expected.publicKeyDigest,sessionId:expected.sessionId,branchId:expected.branchId,sessionEpoch:expected.sessionEpoch,loadedFactoryIdentity:expected.loadedFactoryIdentity,candidateSourceManifestDigest:expected.candidateSourceManifestDigest});
}
export function validateHostBinding(value:unknown):value is NativeHostBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string,unknown>;
  if (v.schemaVersion !== 1 || v.protocolIdentity !== EVALUATION_HOST_PROTOCOL || !["hostId","publicKey","publicKeyDigest","sessionId","branchId","sessionEpoch","loadedFactoryIdentity","candidateSourceManifestDigest"].every(k => typeof v[k] === "string" && v[k].length > 0)) return false;
  try { return publicKeyDigest(String(v.publicKey)) === v.publicKeyDigest && /^[a-f0-9]{64}$/.test(String(v.candidateSourceManifestDigest)); } catch { return false; }
}
export function verifyNativeHostEnvelope(envelope:NativeHostEnvelope,request:NativeArmRequest,manifest:Manifest):NativeHostPayload {
  const binding = manifest.frozen.protocol.nativeHost;
  if (!binding || !validateHostBinding(binding) || envelope.schemaVersion !== 1 || typeof envelope.payloadBase64 !== "string" || typeof envelope.signatureBase64 !== "string") throw new Error("frozen_real_native_host_identity_required");
  if (request.schemaVersion !== 1 || request.runId !== manifest.runId || request.bundleDigest !== manifest.frozen.digest || request.hostId !== binding.hostId || request.hostKeyDigest !== binding.publicKeyDigest || request.inputDigest !== manifest.frozen.cases.find(c => c.id === request.caseId)?.input.sha256) throw new Error("native_original_request_frozen_binding_mismatch");
  const bytes = Buffer.from(envelope.payloadBase64,"base64");
  if (!bytes.length || bytes.length > 8*1024*1024 || !verify(null,bytes,createPublicKey(binding.publicKey),Buffer.from(envelope.signatureBase64,"base64"))) throw new Error("native_host_signature_invalid");
  let raw:unknown; try { raw = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("invalid_native_host_payload"); }
  const p = projectNativeHostPayload(raw);
  if (p.schemaVersion !== 1 || p.kind !== "shadow_evaluation" || !p.host || !matchesHost(p.host,binding)
    || p.requestDigest !== canonicalDigest(request) || p.requestId !== request.requestId || p.runId !== manifest.runId || p.bundleDigest !== manifest.frozen.digest
    || p.freezeCreatedAt !== manifest.createdAt
    || p.caseId !== request.caseId || p.arm !== request.arm || p.mutationAllowed !== false || p.authorityReusable !== false || !Array.isArray(p.attempts)) throw new Error("native_host_receipt_binding_mismatch");
  const {episode,attempts} = p;
  if (episode.id !== `${request.caseId}:${request.arm}` || episode.caseId !== request.caseId || episode.arm !== request.arm || episode.completionEvent !== null
    || !p.native || ![p.native.requestDigest,p.native.parentToolCallId,p.native.sessionEpoch,p.native.terminalDigest].every(x => typeof x === "string" && x.length > 0)
    || p.native.sessionEpoch !== binding.sessionEpoch || !Number.isSafeInteger(p.native.itemIndex) || p.native.itemIndex < 0 || !p.native.terminalEntryIds.length
    || p.native.status === "accepted" && (!p.native.childId || episode.advisorReceiptId === null)
    || p.native.status === "failed" && (episode.disposition !== "UNAVAILABLE" || episode.advisorReceiptId !== null)
    || !["accepted","failed"].includes(p.native.status)
    || attempts.some(a => a.runId !== manifest.runId || a.caseId !== request.caseId || a.arm !== request.arm)) throw new Error("actual_native_shadow_provenance_required");
  return {...p,episode:{...episode,nativeObservation:p.native},attempts};
}
