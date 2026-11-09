import path from "node:path";
import { isUtf8 } from "node:buffer";
import { DELIVERABLE_ARTIFACT_MAX_BYTES, isPlanCliStub, isResearchReportPath, normalizeEvidencePath, pathInScope, type TaskEvidenceResult } from "./evidence-collector";
import { readEvidenceFile, type EvidenceOmission } from "./evidence-workspace";
import type { TaskContract } from "./types/verification";
import type { EvidenceArtifact } from "./judge-evidence-packet";
import { isPrivateEvidencePath } from "./evidence-privacy";
export interface TaskArtifactAssociation { mandatory: boolean; relevance: number }
/** Same exact native-task association used by the F16 root consumer; association is not approval. */
export function taskArtifactAssociation(file: string, content: string, taskDescription: string): TaskArtifactAssociation {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  const task = normalize(taskDescription);
  const escaped = task.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const pattern = task ? new RegExp(String.raw`^[\t ]*(?:task|original[\t ]+task(?:[\t ]*\(verbatim\))?)[\t ]*:\s*["'“‘]?${escaped}["'”’]?[\t ]*\r?$`, "imu") : undefined;
  let mandatory = pattern?.test(content.normalize("NFKC")) ?? false;
  if (task && /\.json$/i.test(file)) try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "task" in parsed && typeof parsed.task === "string") mandatory = normalize(parsed.task) === task;
  } catch { /* Unparseable JSON has no structured task association. */ }
  const normalizedName = normalize(file); const normalizedContent = normalize(content); let relevance = 0;
  for (const token of new Set(task.match(/[\p{L}\p{N}_-]{4,}/gu) ?? [])) { if (normalizedName.includes(token)) relevance += 3; if (normalizedContent.includes(token)) relevance++; }
  return { mandatory, relevance };
}
/** Public approved text proposes filenames only; filesystem authorization still precedes all bytes. */
export function referencedWorkspacePaths(cwd: string, text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:[A-Za-z]:[\\/])?(?:[^\s`"'<>()[\]{}|,;:]+[\\/])*[^\s`"'<>()[\]{}|,;:]+\.(?:[cm]?[jt]sx?|json|md|markdown|txt|rst|adoc|py|go|rs|ya?ml|toml|sql|sh|ps1|c|h|cs|java|kt|swift)\b/gu)) {
    const raw = match[0]; if (/^[a-z]+:\/\//i.test(raw)) continue;
    const relative = path.isAbsolute(raw) || path.win32.isAbsolute(raw) ? path.relative(cwd, raw) : raw;
    const normalized = normalizeEvidencePath(relative);
    if (normalized && !path.isAbsolute(normalized) && !path.win32.isAbsolute(normalized) && !normalized.split("/").includes("..") && !normalized.includes(":")) names.add(normalized);
  }
  return [...names].sort();
}
export interface TaskArtifactCollectionOptions { cwd: string; contract: TaskContract; evidence: TaskEvidenceResult; readScope: readonly string[]; requestedPaths?: readonly string[]; currentCandidatePaths?: readonly string[] }
export interface TaskArtifactCollection { artifacts: EvidenceArtifact[]; requiredPaths: string[]; omissions: EvidenceOmission[]; outOfPacketScope: string[] }
export function collectTaskArtifacts(options: TaskArtifactCollectionOptions): TaskArtifactCollection {
  const { cwd, contract, evidence } = options; const task = contract.target.content;
  const references = referencedWorkspacePaths(cwd, task).filter(isResearchReportPath);
  const requested = options.requestedPaths ?? [];
  const candidates = [...new Set([...references, ...requested, ...evidence.changedFiles, ...(options.currentCandidatePaths ?? [])])].filter((file) => /\.(?:md|markdown|txt|rst|adoc)$/i.test(file) || isResearchReportPath(file) || (requested.includes(file) && /\.json$/i.test(file)));
  const omissions: EvidenceOmission[] = []; const found: Array<{ artifact: EvidenceArtifact; relevance: number }> = []; const outOfPacketScope: string[] = [];
  let inspectedBytes = 0;
  if (candidates.length > 512) omissions.push({ reason: "ARTIFACT_DISCOVERY_FILE_LIMIT", kind: "budget", required: true });
  for (const file of candidates.slice(0, 512)) {
    if (isPrivateEvidencePath(file)) {
      if (references.includes(file) || requested.includes(file)) omissions.push({ path: file, reason: "PRIVATE_ARTIFACT_REQUIRES_PUBLIC_REPRESENTATION", kind: "security", required: true });
      else outOfPacketScope.push(file);
      continue;
    }
    if (!pathInScope(file, options.readScope)) {
      if (references.includes(file) || requested.includes(file)) omissions.push({ path: file, reason: "ARTIFACT_OUTSIDE_APPROVED_SOURCE_SCOPE", kind: "security", required: true }); else outOfPacketScope.push(file);
      continue;
    }
    try {
      const value = readEvidenceFile(cwd, file);
      inspectedBytes += value.bytes.length;
      if (inspectedBytes > 8 * 1024 * 1024) { omissions.push({ reason: "ARTIFACT_DISCOVERY_BYTE_LIMIT", kind: "budget", required: true }); break; }
      const snapshot = evidence.snapshot;
      if (!snapshot || !isUtf8(value.bytes) || value.sha256 !== snapshot.files.get(file) || JSON.stringify(value.identity) !== JSON.stringify(snapshot.fileIdentities?.[file])) throw new Error("ARTIFACT_NOT_IN_EVALUATED_TREE");
      const content = value.bytes.toString("utf8"); if (isPlanCliStub(content)) { if (references.includes(file) || requested.includes(file)) omissions.push({ path: file, reason: "MANDATORY_ARTIFACT_IS_TEMPLATE", kind: "unavailable", required: true }); continue; }
      const association = taskArtifactAssociation(file, content, task);
      const required = association.mandatory || references.includes(file) || requested.includes(file);
      if (!required && association.relevance === 0) { outOfPacketScope.push(file); continue; }
      found.push({ artifact: { path: file, content, sha256: value.sha256, criterionIds: contract.criteria.map((criterion) => criterion.id), required }, relevance: association.relevance });
    } catch (failure) {
      const security = failure && typeof failure === "object" && "kind" in failure && failure.kind === "security";
      omissions.push({ path: file, reason: security ? "UNSAFE_ARTIFACT_FILE" : "ARTIFACT_NOT_IN_EVALUATED_TREE", kind: security ? "security" : "unavailable", required: true });
    }
  }
  found.sort((a, b) => Number(!!b.artifact.required) - Number(!!a.artifact.required) || b.relevance - a.relevance || a.artifact.path.localeCompare(b.artifact.path));
  const artifacts: EvidenceArtifact[] = []; let bytes = 0;
  for (const { artifact } of found) {
    const size = Buffer.byteLength(artifact.content, "utf8");
    if (bytes + size <= DELIVERABLE_ARTIFACT_MAX_BYTES) { artifacts.push(artifact); bytes += size; }
    else if (artifact.required) omissions.push({ path: artifact.path, reason: "insufficient_deliverable_evidence", kind: "budget", required: true });
    else outOfPacketScope.push(artifact.path);
  }
  return { artifacts, requiredPaths: [...new Set([...candidates.filter((file) => references.includes(file) || requested.includes(file)), ...found.filter(({ artifact }) => artifact.required).map(({ artifact }) => artifact.path)])], omissions, outOfPacketScope };
}
