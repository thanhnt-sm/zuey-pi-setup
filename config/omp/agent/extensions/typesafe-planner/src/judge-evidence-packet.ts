import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import type { ContractCriterion, TaskContract } from "./types/verification";
import { canonicalDigest } from "./task-contract";
import { DELIVERABLE_ARTIFACT_MAX_BYTES, isHostTaskEvidence, pathInScope, type TaskEvidenceResult } from "./evidence-collector";
import { contractReference, digestBytes, isHostSnapshot, sameContract, type EvidenceOmission } from "./evidence-workspace";
import { validateVerificationReceipt } from "./verification-receipt";
import { selectCriterionEvidence, type CriterionPacketSelection, type CriterionEvidenceManifest, type PacketSourceEvidence } from "./evidence-selection";
import { isPrivateEvidencePath } from "./evidence-privacy";
export { retrieveEvidenceSource } from "./evidence-selection";
export type { CriterionPacketSelection, EvidenceSourceSelection, EvidenceSourceRange, CriterionEvidenceManifest, PacketSourceEvidence, SourceRetrievalRequest, SourceRetrievalResult } from "./evidence-selection";
export interface EvidenceArtifact { path: string; content: string; sha256: string; criterionIds: readonly string[]; required?: boolean }
export interface IntegrationEvidenceReceipt { parentContractId: string; criterionId: string; receiptId: string; evidenceDigest: string }
export interface ArtifactSelectionManifest { requiredPaths: readonly string[]; outOfPacketScope: readonly string[]; acceptedBytes: number; maxBytes: 4940 }
export interface VisualAssetMetadata { key: string; format: "png" | "jpeg"; bytes: number; sha256: string }
export interface SystemOneImageAsset { type: "image"; format: "png" | "jpeg"; data_base64: string }
export interface VisualEvidence { imageBase64?: string; mimeType?: string }
export interface JudgeEvidencePacket {
  schemaVersion: 1;
  binding: { contractId: string; revisionId: string; incarnationId: string; originalRequestDigest: string; policyDigest: string; target: TaskContract["target"] };
  applicability: { taskKind: TaskContract["taskKind"]; allowedMutationScope: TaskContract["allowedMutationScope"]; sourceMutations: readonly string[] };
  originalSource: TaskContract["approvedSource"];
  parentRequirements: TaskContract["parentRequirements"];
  criteria: readonly ContractCriterion[];
  obligations: Array<{ id: string; criterionId: string; kind: "deterministic" | "semantic" | "integration"; evidenceIds: string[]; requirement: string }>;
  snapshots: { baselineId: string; evaluatedId: string; evaluatedTreeDigest: string };
  source: PacketSourceEvidence[];
  diff: string;
  commitInterval?: TaskEvidenceResult["commitInterval"];
  artifacts: readonly EvidenceArtifact[];
  verification?: TaskEvidenceResult["verificationReceipt"];
  diagnosticObservations?: readonly NonNullable<TaskEvidenceResult["verificationReceipt"]>[];
  authorizedMutations?: TaskEvidenceResult["authorizedMutationReceipts"];
  integrationReceipts?: readonly IntegrationEvidenceReceipt[];
  counterevidence: readonly string[];
  omissions: readonly EvidenceOmission[];
  artifactSelection?: ArtifactSelectionManifest;
  scope?: { kind: "criterion"; selectedCriterionIds: readonly string[]; globalCompletionEligible: false };
  manifest?: CriterionEvidenceManifest;
  visualAssets?: readonly VisualAssetMetadata[];
}
export type JudgeEvidencePacketResult = { ok: true; packet: JudgeEvidencePacket; digest: string; assetPayload?: Record<string, SystemOneImageAsset> } | { ok: false; status: "EVIDENCE_REQUIRED"; reasons: string[]; omissions: EvidenceOmission[] };
export interface JudgeEvidencePacketOptions {
  contract: TaskContract; evidence: TaskEvidenceResult; artifacts?: readonly EvidenceArtifact[];
  requiredArtifactPaths?: readonly string[]; maxBytes?: number;
  artifactOmissions?: readonly EvidenceOmission[];
  artifactSelection?: ArtifactSelectionManifest;
  integrationReceipts?: readonly IntegrationEvidenceReceipt[];
  validateIntegrationReceipt?: (receipt: IntegrationEvidenceReceipt) => boolean;
  selection?: CriterionPacketSelection;
  assets?: Record<string, SystemOneImageAsset>;
  visualEvidence?: VisualEvidence;
}
/** One preparation path, no lexical task guessing and no silent clipping. */
export function buildJudgeEvidencePacket(options: JudgeEvidencePacketOptions): JudgeEvidencePacketResult {
  const { contract, evidence } = options; const omissions = [...(evidence.omissions ?? []), ...(options.artifactOmissions ?? [])]; const reasons: string[] = [];
  const allArtifacts = options.artifacts ?? [];
  const selected = options.selection ? selectCriterionEvidence(contract, evidence, allArtifacts, options.selection) : undefined;
  if (selected) reasons.push(...selected.reasons);
  let assets: Record<string, SystemOneImageAsset> | undefined;
  const visualAssets: VisualAssetMetadata[] = [];
  if (options.assets || options.visualEvidence?.imageBase64) {
    assets = { ...(options.assets ?? {}) };
    if (options.visualEvidence?.imageBase64) {
      const mime = (options.visualEvidence.mimeType ?? "").toLowerCase();
      if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/jpg") {
        reasons.push("UNSUPPORTED_IMAGE_MIME_TYPE");
        omissions.push({ reason: "UNSUPPORTED_IMAGE_MIME_TYPE", kind: "unavailable", required: true });
      } else {
        const format = mime === "image/jpeg" || mime === "image/jpg" ? "jpeg" : "png";
        assets["ui_visual_evidence"] = { type: "image", format, data_base64: options.visualEvidence.imageBase64 };
      }
    }
    for (const [key, asset] of Object.entries(assets)) {
      const buf = Buffer.from(asset.data_base64, "base64");
      visualAssets.push({ key, format: asset.format, bytes: buf.length, sha256: digestBytes(buf) });
    }
  }
  const artifacts = selected?.artifacts ?? allArtifacts; const snapshot = evidence.snapshot;
  const criteria = selected?.criteria ?? contract.criteria;
  const selectedIds = new Set(criteria.map((criterion) => criterion.id));
  const parentRequirements = selected ? contract.parentRequirements.filter((parent) => selectedIds.has(parent.criterionId)) : contract.parentRequirements;
  const maxBytes = options.maxBytes ?? 32768;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 32768) reasons.push("PACKET_POLICY_INVALID");
  if (!isHostTaskEvidence(evidence)) reasons.push("HOST_TASK_EVIDENCE_REQUIRED");
  if (!snapshot || !isHostSnapshot(snapshot) || !snapshot.complete || !sameContract(snapshot.binding, contract) || snapshot.contractDigest !== canonicalDigest(contract) || snapshot.originalRequestDigest !== contract.originalUserRequest.digest || evidence.evaluatedTreeDigest !== snapshot.treeDigest || !evidence.baselineSnapshotId) reasons.push("TASK_BOUND_SNAPSHOT_REQUIRED");
  if (!evidence.contract || !sameContract(contractReference(evidence.contract), contract) || evidence.contract.originalUserRequest.digest !== contract.originalUserRequest.digest) reasons.push("EVIDENCE_CONTRACT_MISMATCH");
  if (evidence.criteriaSource !== "contract" || JSON.stringify(evidence.criteria) !== JSON.stringify(contract.criteria.map((criterion) => criterion.text))) reasons.push("EXACT_CONTRACT_CRITERIA_REQUIRED");
  if (!contract.criteria.length || contract.criteria.some((criterion) => !criterion.id || !criterion.text || !criterion.source.text || criterion.source.startLine < 1 || criterion.source.endLine < criterion.source.startLine)) reasons.push("CRITERION_SOURCE_SPANS_REQUIRED");
  if (contract.approvedCommandIds.length && (contract.taskKind === "implementation" || evidence.verificationReceipt)) {
    if (!evidence.verificationReceipt || !snapshot) reasons.push("VERIFICATION_RECEIPT_REQUIRED");
    else reasons.push(...validateVerificationReceipt(evidence.verificationReceipt, contract, snapshot).reasons);
  }
  const required = new Set([...(options.requiredArtifactPaths ?? []).filter((file) => !selected || !allArtifacts.some((artifact) => artifact.path === file) || allArtifacts.some((artifact) => artifact.path === file && artifact.criterionIds.some((id) => selectedIds.has(id)))), ...allArtifacts.filter((artifact) => artifact.required && (!selected || artifact.criterionIds.some((id) => selectedIds.has(id)))).map((artifact) => artifact.path)]);
  for (const file of required) if (!artifacts.some((artifact) => artifact.path === file)) omissions.push({ path: file, reason: "MANDATORY_ARTIFACT_MISSING", kind: "unavailable", required: true });
  let artifactBytes = 0;
  const seenPaths = new Set<string>();
  for (const artifact of allArtifacts) {
    if (artifacts.includes(artifact) && isPrivateEvidencePath(artifact.path)) reasons.push("PRIVATE_ARTIFACT_REQUIRES_PUBLIC_REPRESENTATION");
    if (artifacts.includes(artifact)) artifactBytes += Buffer.byteLength(artifact.content, "utf8");
    if (seenPaths.has(artifact.path)) reasons.push("DUPLICATE_ARTIFACT_PATH"); seenPaths.add(artifact.path);
    if (digestBytes(artifact.content) !== artifact.sha256 || snapshot?.files.get(artifact.path) !== artifact.sha256) reasons.push("ARTIFACT_CONTENT_NOT_EVALUATED");
    if (artifact.criterionIds.some((id) => !contract.criteria.some((criterion) => criterion.id === id))) reasons.push("FOREIGN_ARTIFACT_CRITERION");
    if (required.has(artifact.path) && !artifact.criterionIds.length) reasons.push("MANDATORY_ARTIFACT_CRITERION_BINDING_REQUIRED");
  }
  if (artifactBytes > DELIVERABLE_ARTIFACT_MAX_BYTES) omissions.push({ reason: "MANDATORY_ARTIFACT_BUDGET_EXCEEDED", kind: "budget", required: true });
  for (const item of omissions) if (item.required) reasons.push(item.reason);
  const fullSource = evidence.sourceEvidence ?? [];
  const source: PacketSourceEvidence[] = selected?.source ?? fullSource;
  for (const item of source) {
    if (evidence.readScopePaths && !pathInScope(item.path, evidence.readScopePaths)) reasons.push("SOURCE_OUTSIDE_APPROVED_READ_SCOPE");
    if (isPrivateEvidencePath(item.path)) reasons.push("PRIVATE_SOURCE_REQUIRES_PUBLIC_REPRESENTATION");
    if (item.encoding === "base64") reasons.push("BINARY_PUBLIC_REPRESENTATION_REQUIRED");
  }
  if (!selected && evidence.changedFiles.some(isPrivateEvidencePath) && (evidence.gitDiff || evidence.commitInterval?.patch)) reasons.push("PRIVATE_DIFF_REQUIRES_SCOPED_PACKET");
  if (!selected && evidence.readScopePaths && evidence.changedFiles.some((file) => !pathInScope(file, evidence.readScopePaths!)) && (evidence.gitDiff || evidence.commitInterval?.patch)) reasons.push("OUT_OF_READ_SCOPE_DIFF_REQUIRES_SELECTION");
  if (!selected && /^GIT binary patch\r?$/m.test(`${evidence.gitDiff}\n${evidence.commitInterval?.patch ?? ""}`)) reasons.push("BINARY_PUBLIC_REPRESENTATION_REQUIRED");
  for (const item of fullSource) if (item.content === undefined || digestBytes(Buffer.from(item.content, item.encoding === "base64" ? "base64" : "utf8")) !== item.sha256 || snapshot?.files.get(item.path) !== item.sha256) reasons.push("SOURCE_CONTENT_NOT_EVALUATED");
  for (const file of evidence.changedFiles) {
    const digest = snapshot?.files.get(file);
    if (digest && digest !== "<deleted>" && !fullSource.some((item) => item.path === file && item.sha256 === digest && item.content !== undefined)) omissions.push({ path: file, reason: "FULL_CHANGED_SOURCE_REQUIRED", kind: "unavailable", required: true });
  }
  const counterevidence = evidence.counterevidence ?? [];
  // Unauthorized source mutation remains explicit evidence; it never changes review into implementation.
  if (counterevidence.some((item) => item.startsWith("UNATTRIBUTED_OR_UNAUTHORIZED_MUTATION:"))) reasons.push("AUTHORIZED_MUTATION_RECEIPT_REQUIRED");
  const obligations: JudgeEvidencePacket["obligations"] = criteria.map((criterion) => ({
    id: `${criterion.id}:semantic`, criterionId: criterion.id, kind: criterion.kind === "parent_integration" ? "integration" : "semantic",
    evidenceIds: [...(!selected ? [`diff:${digestBytes(evidence.gitDiff)}`] : []), ...source.flatMap((item) => item.spans ? item.spans.map((span) => `source:${item.path}:${item.sha256}:lines:${span.startLine}-${span.endLine}:${span.digest}`) : [`source:${item.path}:${item.sha256}`]), ...artifacts.filter((artifact) => artifact.criterionIds.includes(criterion.id)).map((artifact) => `artifact:${artifact.path}:${artifact.sha256}`)], requirement: criterion.text,
  }));
  for (const criterionId of evidence.verificationReceipt?.applicability === "diagnostic" ? [] : evidence.verificationReceipt?.criterionIds ?? []) if (selectedIds.has(criterionId)) obligations.push({ id: `${criterionId}:verification:${evidence.verificationReceipt!.commandId}`, criterionId, kind: "deterministic", evidenceIds: [evidence.verificationReceipt!.receiptId], requirement: "Applicable approved command succeeded against the bound stable evaluated source and test assets; this is not semantic correctness." });
  for (const parent of parentRequirements) if (!obligations.some((obligation) => obligation.kind === "integration" && obligation.criterionId === parent.criterionId)) obligations.push({ id: `${parent.parentContractId}:${parent.criterionId}:integration`, criterionId: parent.criterionId, kind: "integration", evidenceIds: [], requirement: parent.source.text });
  const integrationReceipts = options.integrationReceipts ?? [];
  for (const parent of parentRequirements) {
    const applicable = integrationReceipts.filter((receipt) => {
      if (receipt.parentContractId !== parent.parentContractId || receipt.criterionId !== parent.criterionId || !receipt.receiptId || !receipt.evidenceDigest) return false;
      try { return options.validateIntegrationReceipt?.(receipt) === true; } catch { return false; }
    });
    if (!applicable.length) omissions.push({ reason: `PARENT_INTEGRATION_EVIDENCE_REQUIRED:${parent.parentContractId}:${parent.criterionId}`, kind: "binding", required: true });
    for (const obligation of obligations) if (obligation.kind === "integration" && obligation.criterionId === parent.criterionId) obligation.evidenceIds.push(...applicable.map((receipt) => receipt.receiptId));
  }
  for (const item of omissions) if (item.required) reasons.push(item.reason);
  const packet: JudgeEvidencePacket = {
    schemaVersion: 1, binding: { ...contractReference(contract), originalRequestDigest: contract.originalUserRequest.digest, policyDigest: contract.policyDigest, target: contract.target },
    applicability: { taskKind: contract.taskKind, allowedMutationScope: contract.allowedMutationScope, sourceMutations: evidence.changedFiles },
    originalSource: selected ? { ...contract.approvedSource, spans: criteria.map((criterion) => criterion.source) } : contract.approvedSource, parentRequirements, criteria, obligations,
    snapshots: { baselineId: evidence.baselineSnapshotId ?? "", evaluatedId: snapshot?.snapshotId ?? "", evaluatedTreeDigest: evidence.evaluatedTreeDigest ?? "" },
    source, diff: selected ? "" : evidence.gitDiff, commitInterval: selected ? undefined : evidence.commitInterval, artifacts, verification: evidence.verificationReceipt?.applicability === "diagnostic" ? undefined : evidence.verificationReceipt, diagnosticObservations: evidence.verificationReceipt?.applicability === "diagnostic" ? [evidence.verificationReceipt] : undefined, authorizedMutations: evidence.authorizedMutationReceipts, integrationReceipts, counterevidence, omissions,
    artifactSelection: options.artifactSelection,
    ...(selected ? { scope: { kind: "criterion" as const, selectedCriterionIds: [...selectedIds], globalCompletionEligible: false as const }, manifest: selected.manifest } : {}),
    ...(visualAssets.length ? { visualAssets } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(packet), "utf8") > maxBytes) { reasons.push("MANDATORY_PACKET_PROOF_EXCEEDS_BUDGET"); omissions.push({ reason: "MANDATORY_PACKET_PROOF_EXCEEDS_BUDGET", kind: "budget", required: true }); }
  return reasons.length ? { ok: false, status: "EVIDENCE_REQUIRED", reasons: [...new Set(reasons)], omissions } : { ok: true, packet, digest: canonicalDigest(packet), ...(assets && Object.keys(assets).length ? { assetPayload: assets } : {}) };
}

export type CriterionPacketSelector = (selection: CriterionPacketSelection) => JudgeEvidencePacketResult;
/** The closure retains real host evidence; selectors are proposals, never portable approval. */
export function createCriterionPacketSelector(options: Omit<JudgeEvidencePacketOptions, "selection">): CriterionPacketSelector {
  const bound = { ...options, contract: structuredClone(options.contract), artifacts: options.artifacts?.map((artifact) => ({ ...artifact, criterionIds: [...artifact.criterionIds] })), requiredArtifactPaths: options.requiredArtifactPaths ? [...options.requiredArtifactPaths] : undefined, visualEvidence: options.visualEvidence, assets: options.assets };
  return (selection) => buildJudgeEvidencePacket({ ...bound, selection });
}
export interface EvidencePacketSetManifest {
  schemaVersion: 1; contractDigest: string; evidenceDigest: string;
  criteria: TaskContract["criteria"]; originalSource: TaskContract["approvedSource"]; parentRequirements: TaskContract["parentRequirements"];
  source: Array<{ path: string; fullFileDigest: string; bytes: number; encoding: "utf8" | "base64" }>;
  diff: { digest: string; bytes: number }; commitInterval?: { from?: string; to?: string; commits: readonly string[]; patchDigest: string };
  artifacts: Array<{ path: string; sha256: string; criterionIds: readonly string[]; required: boolean }>;
  verificationReceiptDigest?: string; changedFiles: readonly string[];
  packets: Array<{ digest: string; criterionIds: readonly string[]; source: NonNullable<JudgeEvidencePacket["manifest"]>["source"]; artifactPaths: string[] }>;
  counterevidence: readonly string[]; omissions: readonly EvidenceOmission[];
  artifactSelection?: ArtifactSelectionManifest;
  uncoveredCriterionIds: string[]; uncoveredParentRequirementIds: string[]; uncoveredArtifactPaths: string[];
  coverageComplete: boolean; requiresIndependentParentReview: true; globalCompletionEligible: false;
}
export interface JudgeEvidencePacketSetResult {
  ok: boolean; status: "READY_FOR_PARENT_REVIEW" | "EVIDENCE_REQUIRED";
  packets: Array<{ packet: JudgeEvidencePacket; digest: string }>; manifest: EvidencePacketSetManifest; reasons: string[];
  assetPayload?: Record<string, SystemOneImageAsset>;
}
export function buildJudgeEvidencePacketSet(options: Omit<JudgeEvidencePacketOptions, "selection"> & { selections?: readonly CriterionPacketSelection[] }): JudgeEvidencePacketSetResult {
  const packets: JudgeEvidencePacketSetResult["packets"] = []; const reasons: string[] = [];
  const selector = createCriterionPacketSelector(options);
  let assetPayload: Record<string, SystemOneImageAsset> | undefined;
  if (options.selections === undefined) {
    const result = buildJudgeEvidencePacket(options);
    if (result.ok) {
      packets.push({ packet: result.packet, digest: result.digest });
      if (result.assetPayload) assetPayload = { ...result.assetPayload };
    } else reasons.push(...result.reasons);
  } else if (!options.selections.length || options.selections.length > 128) reasons.push("PACKET_SET_POLICY_INVALID");
  else for (const selection of options.selections) {
    const result = selector(selection);
    if (result.ok) {
      packets.push({ packet: result.packet, digest: result.digest });
      if (result.assetPayload) assetPayload = { ...(assetPayload ?? {}), ...result.assetPayload };
    } else reasons.push(...result.reasons);
  }
  const covered = new Set(packets.flatMap(({ packet }) => packet.criteria.map((criterion) => criterion.id)));
  const coveredArtifacts = new Set(packets.flatMap(({ packet }) => packet.artifacts.map((artifact) => artifact.path)));
  const uncoveredCriterionIds = options.contract.criteria.filter((criterion) => !covered.has(criterion.id)).map((criterion) => criterion.id);
  const uncoveredParentRequirementIds = options.contract.parentRequirements.filter((parent) => !(options.integrationReceipts ?? []).some((receipt) => {
    if (receipt.parentContractId !== parent.parentContractId || receipt.criterionId !== parent.criterionId || !receipt.receiptId || !receipt.evidenceDigest) return false;
    try { return options.validateIntegrationReceipt?.(receipt) === true; } catch { return false; }
  })).map((parent) => `parent:${parent.parentContractId}:${parent.criterionId}`);
  const uncoveredArtifactPaths = [...new Set([...(options.requiredArtifactPaths ?? []), ...(options.artifacts ?? []).filter((artifact) => artifact.required).map((artifact) => artifact.path)])].filter((file) => !coveredArtifacts.has(file));
  if (uncoveredCriterionIds.length) reasons.push("ORIGINAL_CRITERION_COVERAGE_REQUIRED");
  if (uncoveredParentRequirementIds.length) reasons.push("PARENT_INTEGRATION_EVIDENCE_REQUIRED");
  if (uncoveredArtifactPaths.length) reasons.push("MANDATORY_ARTIFACT_COVERAGE_REQUIRED");
  const manifest: EvidencePacketSetManifest = {
    schemaVersion: 1, contractDigest: canonicalDigest(options.contract), evidenceDigest: canonicalDigest(options.evidence),
    criteria: options.contract.criteria, originalSource: options.contract.approvedSource, parentRequirements: options.contract.parentRequirements,
    source: (options.evidence.sourceEvidence ?? []).map((item) => ({ path: item.path, fullFileDigest: item.sha256, bytes: Buffer.byteLength(item.content ?? "", item.encoding), encoding: item.encoding })),
    diff: { digest: digestBytes(options.evidence.gitDiff), bytes: Buffer.byteLength(options.evidence.gitDiff) },
    ...(options.evidence.commitInterval ? { commitInterval: { from: options.evidence.commitInterval.from, to: options.evidence.commitInterval.to, commits: options.evidence.commitInterval.commits, patchDigest: digestBytes(options.evidence.commitInterval.patch) } } : {}),
    artifacts: (options.artifacts ?? []).map((artifact) => ({ path: artifact.path, sha256: artifact.sha256, criterionIds: artifact.criterionIds, required: !!artifact.required })),
    artifactSelection: options.artifactSelection,
    verificationReceiptDigest: options.evidence.verificationReceipt?.digest, changedFiles: options.evidence.changedFiles,
    packets: packets.map(({ packet, digest }) => ({ digest, criterionIds: packet.criteria.map((criterion) => criterion.id), source: packet.manifest?.source ?? packet.source.map((source) => ({ path: source.path, fullFileDigest: source.sha256, bytes: Buffer.byteLength(source.content ?? "", source.encoding), encoding: source.encoding, coverage: "full" as const })), artifactPaths: packet.artifacts.map((artifact) => artifact.path) })),
    counterevidence: options.evidence.counterevidence ?? [], omissions: [...(options.evidence.omissions ?? []), ...(options.artifactOmissions ?? [])],
    uncoveredCriterionIds, uncoveredParentRequirementIds, uncoveredArtifactPaths, coverageComplete: reasons.length === 0, requiresIndependentParentReview: true, globalCompletionEligible: false,
  };
  return { ok: reasons.length === 0, status: reasons.length ? "EVIDENCE_REQUIRED" : "READY_FOR_PARENT_REVIEW", packets, manifest, reasons: [...new Set(reasons)], ...(assetPayload ? { assetPayload } : {}) };
}
/** Called only with the transport's final redacted encoded body, not an earlier approximation. */
export function finalizeEvidencePacket(packet: JudgeEvidencePacket, preparedBody: string): { packetDigest: string; bodyDigest: string; bodyBytes: number } {
  if (!preparedBody || Buffer.byteLength(preparedBody, "utf8") > 32768) throw new Error("FINAL_PREPARED_BODY_INVALID");
  JSON.parse(preparedBody);
  return { packetDigest: canonicalDigest(packet), bodyDigest: digestBytes(preparedBody), bodyBytes: Buffer.byteLength(preparedBody, "utf8") };
}

export interface PreparedPacketBody { body: string; bodyDigest?: string; bodyBytes?: number }
export interface PacketRedactionOptions { apiKey?: string; homeDirs?: readonly string[] }
export type PreparedPacketValidation = { ok: true } | { ok: false; code: string };
export type EvidencePacketValidator = (prepared: PreparedPacketBody) => PreparedPacketValidation;
/** Host-only final-body guard: compare the complete permitted-redaction projection, not hash assertions. */
export function createEvidenceStateValidator(fields: Readonly<Record<string, unknown>>, options: PacketRedactionOptions = {}): EvidencePacketValidator {
  const { redactEvidenceState } = createRequire(import.meta.url)("./typesafe-api-client.cjs");
  const redaction = { ...options, apiKey: options.apiKey ?? process.env.TYPESAFE_API_KEY };
  const expectedState = redactEvidenceState(fields, redaction);
  const serialized = JSON.stringify(expectedState);
  if (!serialized) throw new Error("EVIDENCE_REQUIRED");
  const expected: unknown = JSON.parse(serialized);
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw new Error("EVIDENCE_REQUIRED");
  return (prepared) => {
    try {
      if (prepared.bodyBytes !== undefined && prepared.bodyBytes !== Buffer.byteLength(prepared.body, "utf8")) return { ok: false, code: "EVIDENCE_REQUIRED" };
      if (prepared.bodyDigest !== undefined && prepared.bodyDigest !== digestBytes(prepared.body)) return { ok: false, code: "EVIDENCE_REQUIRED" };
      const body: unknown = JSON.parse(prepared.body);
      if (!body || typeof body !== "object" || !("state" in body) || !body.state || typeof body.state !== "object") return { ok: false, code: "EVIDENCE_REQUIRED" };
      for (const [key, value] of Object.entries(expected)) if (!Object.hasOwn(body.state, key) || !isDeepStrictEqual(Reflect.get(body.state, key), value)) return { ok: false, code: "EVIDENCE_REQUIRED" };
      return { ok: true };
    } catch { return { ok: false, code: "EVIDENCE_REQUIRED" }; }
  };
}

export function createEvidencePacketValidator(packet: JudgeEvidencePacket, options: PacketRedactionOptions = {}): EvidencePacketValidator {
  return createEvidenceStateValidator({ evidence_packet: packet }, options);
}
/** Composite macro proof is checked against the actual final complete packet array and original-obligation manifest. */
export function createEvidencePacketSetValidator(packetSet: JudgeEvidencePacketSetResult, options: PacketRedactionOptions = {}): EvidencePacketValidator {
  return createEvidenceStateValidator({ evidence_packets: packetSet.packets.map(({ packet }) => packet), evidence_manifest: packetSet.manifest }, options);
}
