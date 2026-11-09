import path from "node:path";
import { readWorkspaceFile } from "./typesafe-evidence-file.cjs";
import { userRequestText, type HostBranch } from "./host-history";
import { canonicalDigest, contractDigest, nonempty, parseContractCriteria } from "./task-contract-source";
import type { AllowedMutationScope, ContractCriterion, HostReference, TaskContract } from "./types/verification";
import type { ContractBindingProposal, FrozenParentSourceContext, FrozenSourceDocument } from "./task-contract-runtime-types";

export function workspaceSourcePath(cwd: string, value: string): string | undefined {
  if (!path.isAbsolute(cwd) || !nonempty(value) || /[\x00-\x1f]/.test(value)) return undefined;
  const relative = path.isAbsolute(value) ? path.relative(cwd, value) : value;
  const normalized = relative.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  if (!normalized || path.isAbsolute(relative) || /^[\\/]/.test(normalized)
    || normalized.split("/").some((part) => !part || part === "." || part === "..") || normalized.includes(":")) return undefined;
  return normalized;
}

function readDocument(cwd: string, sourcePath: string): FrozenSourceDocument {
  const file = readWorkspaceFile(cwd, sourcePath, { maxBytes: 1024 * 1024 });
  const text = file.bytes.toString("utf8");
  if (contractDigest(text) !== file.sha256) throw new Error("contract_source_utf8_required");
  return { path: sourcePath, digest: file.sha256, text };
}

export function explicitCookPath(text: string, cwd: string): string | undefined {
  // A whole actual user invocation, not skill help, a quoted example, or prose consent.
  const command = /^\/?ck:cook\s+([^\r\n]+)$/.exec(text.trim());
  if (!command) return undefined;
  const tokens = command[1].match(/"[^"\r\n]+"|'[^'\r\n]+'|`[^`\r\n]+`|[^\s]+/g) ?? [];
  const flags = tokens.filter((token) => token.startsWith("--"));
  // Non-auto workflows retain human checkpoints; unknown/conflicting modes cannot become execution permission.
  if (!flags.includes("--auto") || flags.some((flag) => !["--auto", "--tdd", "--delegate"].includes(flag))) return undefined;
  const sources = tokens.filter((token) => !token.startsWith("--"));
  if (sources.length !== 1) return undefined;
  const raw = sources[0].replace(/^["'`]|["'`]$/g, "");
  const source = workspaceSourcePath(cwd, raw);
  if (!source || path.posix.extname(source) && !/\.md$/i.test(source) || !path.posix.extname(source) && !/[\\/]/.test(raw)) return undefined;
  return path.posix.extname(source) ? source : `${source}/plan.md`;
}

function linkedPhase(master: FrozenSourceDocument, selected: FrozenSourceDocument): boolean {
  if (path.posix.basename(master.path).toLowerCase() !== "plan.md") return false;
  if (!/^phase-\d+.*\.md$/i.test(path.posix.basename(selected.path)) && !/^phase:\s*\d+\s*$/m.test(selected.text)) return false;
  for (const match of master.text.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].split("#")[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) continue;
    if (path.posix.normalize(path.posix.join(path.posix.dirname(master.path), href)) === selected.path) return true;
  }
  return false;
}

export function snapshotCookDocuments(cwd: string, sourcePath: string): readonly FrozenSourceDocument[] {
  const master = readDocument(cwd, sourcePath);
  const documents = new Map<string, FrozenSourceDocument>([[master.path, master]]);
  if (path.posix.basename(master.path).toLowerCase() !== "plan.md") return [...documents.values()];
  for (const match of master.text.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].split("#")[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) continue;
    const candidate = workspaceSourcePath(cwd, path.posix.normalize(path.posix.join(path.posix.dirname(master.path), href)));
    if (!candidate || !/\.md$/i.test(candidate) || documents.has(candidate)) continue;
    try {
      const document = readDocument(cwd, candidate);
      if (linkedPhase(master, document)) documents.set(candidate, document);
    } catch (error) {
      if (/^phase-\d+.*\.md$/i.test(path.posix.basename(candidate))) throw error;
    }
  }
  return [...documents.values()];
}

export interface ParentSourceResolution { parent: FrozenParentSourceContext; observedCookRequest?: HostReference }
export function resolveParentSource(branch: HostBranch, cwd: string, proposal: ContractBindingProposal, callEntryId: string): ParentSourceResolution | undefined {
  if (!proposal.planPath) return undefined;
  const sourcePath = workspaceSourcePath(cwd, proposal.planPath);
  if (!sourcePath) throw new Error("contract_plan_path_outside_workspace");
  const selected = readDocument(cwd, sourcePath);
  const headings = [...selected.text.matchAll(/^#\s+([^\r\n]+)$/gm)].map((match) => match[1].trim());
  const phaseHeading = proposal.phaseHeading ?? (headings.length === 1 ? headings[0] : undefined);
  if (!phaseHeading) throw new Error("contract_explicit_phase_heading_required");
  let criteria: ContractCriterion[];
  try { criteria = parseContractCriteria({ kind: "plan", ...selected, phaseHeading }); }
  catch (error) {
    if (path.posix.basename(sourcePath) !== "plan.md" || !(error instanceof Error) || error.message !== "contract_phase_has_no_criteria") throw error;
    criteria = [];
  }
  const parent: FrozenParentSourceContext = { ...selected, phaseHeading, criteria };
  let observedCookRequest: HostReference | undefined;
  for (const entry of branch.entries) {
    if (entry.id === callEntryId) break;
    const text = userRequestText(entry);
    const masterPath = text && explicitCookPath(text, cwd);
    if (!text || !masterPath) continue;
    const reference: HostReference = { kind: "user_request", sessionId: branch.sessionId, entryId: entry.id, digest: contractDigest(text) };
    if (masterPath === selected.path) { observedCookRequest = reference; delete parent.master; continue; }
    try {
      const master = readDocument(cwd, masterPath);
      if (linkedPhase(master, selected)) { parent.master = master; observedCookRequest = reference; }
    } catch { /* Context discovery is not source/scope authorization. */ }
  }
  return { parent, observedCookRequest };
}

export function parentSourceCriteriaIdentity(parent: FrozenParentSourceContext | undefined): string | undefined {
  if (!parent) return undefined;
  return canonicalDigest({ path: parent.path, phaseHeading: parent.phaseHeading,
    criteria: parent.criteria.map((criterion) => ({ kind: criterion.kind, text: criterion.text })) });
}

export function trustedNativeTaskKind(goal: string, originalUserText: string): TaskContract["taskKind"] {
  if (/^(?:run|execute|release|deploy|promote|sync|restart)\b/i.test(goal)
    || /^(?:chạy|thực thi|phát hành|triển khai giao dịch|đồng bộ|khởi động lại)\b/i.test(goal)) return "operations";
  const hasCodeMutationVerb = /\b(?:fix|repair|refactor|patch|sửa|sửa lỗi|khắc phục|cập nhật)\b/i.test(goal)
    || (/\btriển khai\b/i.test(goal) && !/\btriển khai giao dịch\b/i.test(goal));
  if (hasCodeMutationVerb) return "implementation";
  if (/^(?:implement|repair|fix|refactor|build|create|integrate|wire|migrate|add|update)\b/i.test(goal)
    || /^(?:triển khai|sửa|sửa lỗi|khắc phục|tạo|xây dựng|tích hợp|cập nhật|bổ sung)\b/i.test(goal)) return "implementation";
  if (/^(?:review|verify|audit|inspect|evaluate|assess|read[- ]only)\b/i.test(goal)
    || /^(?:thẩm định|đánh giá|kiểm tra|rà soát|đối chiếu)\b/i.test(goal)) return "review";
  if (/^(?:read|read and analy[sz]e|map|research|investigate|analy[sz]e|trace|reproduce|diagnose|document|write (?:a )?(?:report|analysis))\b/i.test(goal)
    || /^(?:đọc|đọc và phân tích|xác định|nghiên cứu|tìm kiếm|điều tra|phân tích|chẩn đoán|tái hiện|viết báo cáo|tài liệu hóa)\b/i.test(goal)) return "research";
  return /\bread[- ]only\b|^(?:research|review|investigate|inspect|analy[sz]e|nghiên cứu|rà soát|đánh giá)\b/i.test(originalUserText) ? "research" : "implementation";
}

export function approvedContractScope(
  kind: TaskContract["taskKind"], parent: FrozenParentSourceContext | undefined, execution: boolean, commandIds: readonly string[],
): { scope: AllowedMutationScope; commandIds: readonly string[] } {
  if (!execution) return { scope: { paths: ["**"], operations: ["read"] }, commandIds: [] };
  const commands = [...commandIds];
  if (kind === "review" || kind === "research") return {
    scope: { paths: ["plans/reports/**", "docs/**"], operations: commands.length ? ["read", "create", "modify", "execute"] : ["read", "create", "modify"] }, commandIds: commands,
  };
  if (kind === "operations") return { scope: { paths: ["**"], operations: commands.length ? ["read", "execute"] : ["read"] }, commandIds: commands };
  const paths = new Set<string>();
  if (parent) {
    for (const match of parent.text.matchAll(/\b(src|tests|tools|docs|plans)\/[\w./*-]+/g)) paths.add(`${match[1]}/**`);
    for (const file of ["typesafe-planner.ts", "package.json", "README.md"]) if (parent.text.includes(file)) paths.add(file);
    paths.add(parent.path);
  }
  return { scope: { paths: paths.size ? [...paths] : ["**"],
    operations: commands.length ? ["read", "create", "modify", "delete", "execute"] : ["read", "create", "modify", "delete"] }, commandIds: commands };
}
