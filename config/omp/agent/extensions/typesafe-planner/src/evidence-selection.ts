import type { ContractCriterion, TaskContract } from "./types/verification";
import { canonicalDigest } from "./task-contract";
import { isHostTaskEvidence, pathInScope, type TaskEvidenceResult } from "./evidence-collector";
import { digestBytes, isHostSnapshot } from "./evidence-workspace";
import type { EvidenceArtifact } from "./judge-evidence-packet";
import { isPrivateEvidencePath } from "./evidence-privacy";
export interface EvidenceSourceRange { startLine: number; endLine: number; digest?: string }
export interface EvidenceSourceSelection { path: string; fullFileDigest: string; spans?: readonly EvidenceSourceRange[] }
export interface CriterionPacketSelection { criterionIds: readonly string[]; sources: readonly EvidenceSourceSelection[]; artifactPaths?: readonly string[] }
export interface AcceptedEvidenceSpan { startLine: number; endLine: number; digest: string; text: string }
export type PacketSourceEvidence = NonNullable<TaskEvidenceResult["sourceEvidence"]>[number] & { coverage?: "full" | "spans"; spans?: readonly AcceptedEvidenceSpan[] };
export interface CriterionEvidenceManifest {
  schemaVersion: 1; contractDigest: string; evidenceDigest: string;
  criteria: Array<{ id: string; kind: ContractCriterion["kind"]; textDigest: string; source: { path: string; digest: string; startLine: number; endLine: number; spanDigest: string }; coverage: "selected" | "out_of_packet_scope" }>;
  parentRequirements: Array<{ id: string; parentContractId: string; criterionId: string; sourceDigest: string; coverage: "out_of_packet_scope" }>;
  source: Array<{ path: string; fullFileDigest: string; bytes: number; encoding: "utf8" | "base64"; coverage: "full" | "spans" | "out_of_packet_scope"; spans?: Array<{ startLine: number; endLine: number; digest: string }> }>;
  artifacts: Array<{ path: string; sha256: string; criterionIds: readonly string[]; required: boolean; coverage: "full" | "out_of_packet_scope" }>;
  diff: { digest: string; bytes: number; coverage: "out_of_packet_scope" };
  commitInterval?: { from?: string; to?: string; commits: readonly string[]; patchDigest: string; coverage: "out_of_packet_scope" };
  counterevidenceDigest: string; omissionsDigest: string;
}
export interface SelectedCriterionEvidence { criteria: ContractCriterion[]; source: PacketSourceEvidence[]; artifacts: EvidenceArtifact[]; manifest: CriterionEvidenceManifest; reasons: string[] }
export interface SourceRetrievalRequest extends EvidenceSourceSelection {}
export type SourceRetrievalResult = { ok: true; source: PacketSourceEvidence } | { ok: false; status: "EVIDENCE_REQUIRED"; reason: string };
/** Reads only the accepted immutable host snapshot corpus; never reopens a filename or trusts a caller-provided excerpt. */
export function retrieveEvidenceSource(evidence: TaskEvidenceResult, request: SourceRetrievalRequest): SourceRetrievalResult {
  if (isPrivateEvidencePath(request.path)) return { ok: false, status: "EVIDENCE_REQUIRED", reason: "PRIVATE_SOURCE_REQUIRES_PUBLIC_REPRESENTATION" };
  if (!isHostTaskEvidence(evidence) || !evidence.snapshot || !isHostSnapshot(evidence.snapshot)) return { ok: false, status: "EVIDENCE_REQUIRED", reason: "HOST_TASK_EVIDENCE_REQUIRED" };
  if (evidence.readScopePaths && !pathInScope(request.path, evidence.readScopePaths)) return { ok: false, status: "EVIDENCE_REQUIRED", reason: "SOURCE_OUTSIDE_APPROVED_READ_SCOPE" };
  const source = evidence.sourceEvidence?.find((item) => item.path === request.path);
  if (!source || source.content === undefined || source.sha256 !== request.fullFileDigest || evidence.snapshot.files.get(request.path) !== request.fullFileDigest || digestBytes(Buffer.from(source.content, source.encoding)) !== request.fullFileDigest) return { ok: false, status: "EVIDENCE_REQUIRED", reason: "SELECTED_SOURCE_IDENTITY_MISMATCH" };
  if (source.encoding === "base64") return { ok: false, status: "EVIDENCE_REQUIRED", reason: "BINARY_PUBLIC_REPRESENTATION_REQUIRED" };
  if (!request.spans) return { ok: true, source: { ...source, criterionIds: [...source.criterionIds], coverage: "full" } };
  if (!request.spans.length) return { ok: false, status: "EVIDENCE_REQUIRED", reason: "SELECTED_SOURCE_RANGE_INVALID" };
  // Retain exact LF/CRLF and final-line bytes. A line range is not a textual summary.
  const lines = source.content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const spans: AcceptedEvidenceSpan[] = [];
  let previousEnd = 0;
  for (const range of request.spans) {
    if (!Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLine) || range.startLine <= previousEnd || range.endLine < range.startLine || range.endLine > lines.length) return { ok: false, status: "EVIDENCE_REQUIRED", reason: "SELECTED_SOURCE_RANGE_INVALID" };
    const text = lines.slice(range.startLine - 1, range.endLine).join(""); const digest = digestBytes(text);
    if (range.digest !== undefined && range.digest !== digest) return { ok: false, status: "EVIDENCE_REQUIRED", reason: "SELECTED_SOURCE_SPAN_DIGEST_MISMATCH" };
    spans.push({ startLine: range.startLine, endLine: range.endLine, digest, text }); previousEnd = range.endLine;
  }
  const { content: _fullContent, ...identity } = source;
  return { ok: true, source: { ...identity, criterionIds: [...source.criterionIds], coverage: "spans", spans } };
}
export function selectCriterionEvidence(contract: TaskContract, evidence: TaskEvidenceResult, artifacts: readonly EvidenceArtifact[], selection: CriterionPacketSelection): SelectedCriterionEvidence {
  const selectedIds = new Set(selection.criterionIds); const reasons: string[] = [];
  if (!selectedIds.size || selectedIds.size !== selection.criterionIds.length || [...selectedIds].some((id) => !contract.criteria.some((criterion) => criterion.id === id))) reasons.push("SELECTED_CRITERION_BINDING_INVALID");
  const source: PacketSourceEvidence[] = []; const selectedPaths = new Set<string>();
  for (const request of selection.sources) {
    if (selectedPaths.has(request.path)) { reasons.push("DUPLICATE_SOURCE_SELECTION"); continue; } selectedPaths.add(request.path);
    const retrieved = retrieveEvidenceSource(evidence, request);
    if (retrieved.ok) source.push({ ...retrieved.source, criterionIds: [...selection.criterionIds] }); else reasons.push(retrieved.reason);
  }
  const artifactPaths = new Set(selection.artifactPaths ?? artifacts.filter((artifact) => artifact.criterionIds.some((id) => selectedIds.has(id))).map((artifact) => artifact.path));
  const selectedArtifacts = artifacts.filter((artifact) => artifactPaths.has(artifact.path));
  for (const file of artifactPaths) if (!selectedArtifacts.some((artifact) => artifact.path === file)) reasons.push("SELECTED_ARTIFACT_MISSING");
  for (const artifact of selectedArtifacts) if (!artifact.criterionIds.some((id) => selectedIds.has(id))) reasons.push("SELECTED_ARTIFACT_CRITERION_MISMATCH");
  if (!source.length && !selectedArtifacts.length) reasons.push("SELECTED_CLAIM_PROOF_REQUIRED");
  const manifest: CriterionEvidenceManifest = {
    schemaVersion: 1, contractDigest: canonicalDigest(contract), evidenceDigest: canonicalDigest(evidence),
    criteria: contract.criteria.map((criterion) => ({ id: criterion.id, kind: criterion.kind, textDigest: digestBytes(criterion.text), source: { path: criterion.source.path, digest: criterion.source.digest, startLine: criterion.source.startLine, endLine: criterion.source.endLine, spanDigest: digestBytes(criterion.source.text) }, coverage: selectedIds.has(criterion.id) ? "selected" : "out_of_packet_scope" })),
    parentRequirements: contract.parentRequirements.map((parent) => ({ id: `parent:${parent.parentContractId}:${parent.criterionId}`, parentContractId: parent.parentContractId, criterionId: parent.criterionId, sourceDigest: canonicalDigest(parent.source), coverage: "out_of_packet_scope" })),
    source: (evidence.sourceEvidence ?? []).map((item) => { const selected = source.find((candidate) => candidate.path === item.path); return { path: item.path, fullFileDigest: item.sha256, bytes: Buffer.byteLength(item.content ?? "", item.encoding), encoding: item.encoding, coverage: selected?.coverage ?? "out_of_packet_scope", ...(selected?.spans ? { spans: selected.spans.map(({ startLine, endLine, digest }) => ({ startLine, endLine, digest })) } : {}) }; }),
    artifacts: artifacts.map((artifact) => ({ path: artifact.path, sha256: artifact.sha256, criterionIds: artifact.criterionIds, required: !!artifact.required, coverage: artifactPaths.has(artifact.path) ? "full" : "out_of_packet_scope" })),
    diff: { digest: digestBytes(evidence.gitDiff), bytes: Buffer.byteLength(evidence.gitDiff), coverage: "out_of_packet_scope" },
    ...(evidence.commitInterval ? { commitInterval: { from: evidence.commitInterval.from, to: evidence.commitInterval.to, commits: evidence.commitInterval.commits, patchDigest: digestBytes(evidence.commitInterval.patch), coverage: "out_of_packet_scope" as const } } : {}),
    counterevidenceDigest: canonicalDigest(evidence.counterevidence ?? []), omissionsDigest: canonicalDigest(evidence.omissions ?? []),
  };
  return { criteria: contract.criteria.filter((criterion) => selectedIds.has(criterion.id)), source, artifacts: selectedArtifacts, manifest, reasons };
}
