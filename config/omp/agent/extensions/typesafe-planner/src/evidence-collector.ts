import type { ChildProcess } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { TaskContract } from "./types/verification";
import { canonicalDigest } from "./task-contract";
import { spawnChild, createVerificationHome } from "./typesafe-child-env.cjs";
import { captureWorkspaceSnapshot, diffSnapshots, digestBytes, gitBytes, isHostSnapshot, readEvidenceFile, releaseWorkspaceSnapshot, sameContract, taskSnapshotDiff, type EvidenceOmission, type WorkspaceSnapshot, type WorkspaceSnapshotOptions } from "./evidence-workspace";
import { validateVerificationReceipt, validateAuthorizedMutation, type AuthorizedMutationReceipt, type VerificationReceipt } from "./verification-receipt";
export { captureWorkspaceSnapshot, diffSnapshots, releaseWorkspaceSnapshot } from "./evidence-workspace";
export type { EvidenceOmission, WorkspaceSnapshot, WorkspaceSnapshotOptions } from "./evidence-workspace";
export class SecurityViolationError extends Error {
  constructor(message: string) { super(message); this.name = "SecurityViolationError"; }
}
export interface TestCommandResult {
  exitCode: number; output: string; signal?: string | null; timedOut?: boolean; aborted?: boolean;
  outputTruncated?: boolean; outputEncodingLoss?: boolean; outputDigest?: string; rawOutputDigest?: string; startedAt?: string; finishedAt?: string;
  actualExitCode?: number | null; terminationObserved?: boolean; environmentVerified?: boolean;
}
export interface TaskEvidenceOptions {
  cwd?: string; taskId?: string; planPath?: string; testCommand?: string; timeoutMs?: number;
  untrustedAgentState?: string; taskDoneProven?: boolean; todoCompleted?: boolean;
  baseline?: WorkspaceSnapshot; afterSnapshot?: WorkspaceSnapshot; testResult?: TestCommandResult;
  signal?: AbortSignal; contract?: TaskContract; verificationReceipt?: VerificationReceipt; nonGitPaths?: readonly string[];
  sourcePaths?: readonly string[];
  provenanceLimitations?: readonly string[];
  readScopePaths?: readonly string[];
  authorizedMutationReceipts?: readonly AuthorizedMutationReceipt[];
}
export interface TaskEvidenceResult {
  gitStatus: string; gitDiff: string; testExitCode: number | null; testOutput: string;
  criteria: string[]; cleanWorkingTree: boolean; timestamp: string; taskDoneProven?: boolean;
  todoCompleted?: boolean; changedFiles: string[]; diffScope: "task-baseline" | "full-working-tree";
  criteriaSource: "phase" | "plan" | "none" | "contract";
  snapshot?: WorkspaceSnapshot; baselineSnapshotId?: string; evaluatedTreeDigest?: string;
  contract?: TaskContract; verificationReceipt?: VerificationReceipt; omissions?: EvidenceOmission[];
  authorizedMutationReceipts?: readonly AuthorizedMutationReceipt[];
  evidenceStatus?: "READY" | "EVIDENCE_REQUIRED"; counterevidence?: string[];
  commitInterval?: { from?: string; to?: string; commits: string[]; patch: string };
  sourceEvidence?: Array<{ path: string; sha256: string; content?: string; encoding: "utf8" | "base64"; criterionIds: string[]; role?: "changed" | "context"; beforeMode?: string; afterMode?: string }>;
  readScopePaths?: readonly string[];
}
const issuedEvidence = new WeakMap<TaskEvidenceResult, string>();
export function isHostTaskEvidence(evidence: TaskEvidenceResult): boolean {
  return issuedEvidence.get(evidence) === canonicalDigest(evidence);
}
/** Raw artifact budget is not a transport allowance; required reports must fit whole. */
export const DELIVERABLE_ARTIFACT_MAX_BYTES = 4940;
export class InsufficientDeliverableEvidenceError extends Error {
  readonly code = "insufficient_deliverable_evidence";
  constructor() { super("insufficient_deliverable_evidence"); this.name = "InsufficientDeliverableEvidenceError"; }
}
export function normalizeEvidencePath(value: string): string {
  let result = value.trim();
  if (result.startsWith('"') && result.endsWith('"')) {
    const bytes: Buffer[] = []; const inner = result.slice(1, -1);
    const escapes: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\" };
    let start = 0;
    for (const match of inner.matchAll(/\\([0-7]{3}|[abfnrtv"\\])/g)) {
      bytes.push(Buffer.from(inner.slice(start, match.index), "utf8"));
      bytes.push(/^[0-7]{3}$/.test(match[1]) ? Buffer.from([Number.parseInt(match[1], 8)]) : Buffer.from(escapes[match[1]], "utf8"));
      start = match.index + match[0].length;
    }
    bytes.push(Buffer.from(inner.slice(start), "utf8")); result = Buffer.concat(bytes).toString("utf8");
  }
  return result.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
}
export function statusEvidencePaths(gitStatus: string): string[] {
  const paths: string[] = [];
  for (const line of gitStatus.split(/\r?\n/)) {
    if (!line.trim()) continue; const entry = line.replace(/^[ MADRCUT?!]{1,2}\s+/, "").trim(); let quoted = false; let start = 0;
    for (let i = 0; i < entry.length; i++) {
      if (entry[i] === "\\" && quoted) { i++; continue; } if (entry[i] === '"') quoted = !quoted;
      if (!quoted && entry.startsWith(" -> ", i)) { paths.push(normalizeEvidencePath(entry.slice(start, i))); start = i + 4; i += 3; }
    }
    paths.push(normalizeEvidencePath(entry.slice(start)));
  }
  return paths;
}
export function isResearchReportPath(value: string): boolean {
  const normalized = normalizeEvidencePath(value);
  if (normalized.split("/").some((part) => part === ".." || part === ".")) return false;
  return /^(?:reports|plans\/reports)\/.+\.(?:md|markdown|txt|rst|adoc|json)$/i.test(normalized) && !/(?:^|\/)(?:package(?:-lock)?|tsconfig(?:\.[^/]+)?|jsconfig|composer|deno|appsettings(?:\.[^/]+)?)\.json$/i.test(normalized) && !/\/(?:src|config|node_modules)\//i.test(normalized);
}
export function isImplementationLedTask(description: string): boolean {
  return /^\s*(?:(?:step|task|phase)\s*\d+\s*[:.-]\s*)?(?:implement\w*|fix\w*|build\w*|add\w*|create\s+src|refactor\w*|patch\w*|deploy\w*)\b/i.test(description);
}
/** Legacy advisory rubric only. Trusted callers MUST select applicability from TaskContract.taskKind. */
export function hasProductCodeChanges(gitStatus: string, taskDescription = "", contract?: TaskContract): boolean {
  if (contract) return contract.taskKind === "implementation";
  return isImplementationLedTask(taskDescription) || statusEvidencePaths(gitStatus).some((file) => /\.(?:ts|tsx|js|jsx|cjs|mjs|py|go|rs|json|ya?ml|toml|sql|sh|bat|cmd|ps1|psm1|exe|dll|c|h|cc|cpp|cs|java|kt|swift|rb|php|vue|svelte)$/i.test(file) && !isResearchReportPath(file));
}
export function deliverableArtifactsFromState(state: unknown): string | undefined {
  let parsed = state; if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { return undefined; } }
  return parsed && typeof parsed === "object" && "deliverable_artifacts" in parsed && typeof parsed.deliverable_artifacts === "string" ? parsed.deliverable_artifacts : undefined;
}
function isClaudeBoundaryPath(value: string): boolean { return /(?:^|\/)\.claude(?:\/|$)|(?:^|\/)\.claude\.json$/i.test(value.replace(/\\/g, "/").replace(/^["']|["']$/g, "")); }
export function touchesClaudeBoundary(gitStatus: string, gitDiff: string, changedFiles: readonly string[] = []): boolean {
  return changedFiles.some(isClaudeBoundaryPath) || statusEvidencePaths(gitStatus).some(isClaudeBoundaryPath) || gitDiff.split(/\r?\n/).some((line) => /^(?:diff --git |--- |\+\+\+ |rename from |rename to )/.test(line) && isClaudeBoundaryPath(line));
}
export function assertPathIsClaudeSafe(targetPath: string): void {
  const normalized = path.resolve(targetPath).replace(/\\/g, "/"); const home = os.homedir().replace(/\\/g, "/");
  if (isClaudeBoundaryPath(normalized) || normalized.toLowerCase() === `${home}/.claude.json`.toLowerCase()) throw new SecurityViolationError("Claude configuration access prohibited");
}
export function isPlanCliStub(content: string): boolean {
  return !!content.trim() && content.length <= 1500 && (/Brief description of scope and deliverables\./i.test(content) || (/-\s*\[\s*\]\s*Verifiable acceptance criteria/i.test(content) && /-\s*\[\s*\]\s*Test validation commands/i.test(content)) || /##\s+Overview\s*\r?\n+\s*TBD\.?\s*(?:\r?\n|$)/i.test(content));
}
/** Advisory parsing only: no keyword filtering may silently discard original criteria. */
export function extractCriteriaFromPlan(content: string, _taskId?: string): string[] {
  if (isPlanCliStub(content)) return [];
  const criteria = content.split(/\r?\n/).flatMap((line) => { const match = line.trim().match(/^-\s*\[[ xX]\]\s*(.+)$/); return match && !/^(?:Verifiable acceptance criteria|Test validation commands)\.?$/i.test(match[1]) ? [match[1].trim()] : []; });
  return criteria.length ? criteria : content.split(/\r?\n/).flatMap((line) => { const match = line.trim().match(/^\d+\.\s+\*\*(.+?)\*\*:\s*(.+)$/); return match ? [`${match[1]}: ${match[2]}`] : []; });
}
/** Retains cancellation/exit/output behavior; all children use the central allowlist. */
export async function executeTestCommand(command: string, cwd: string, timeoutMs = 15000, signal?: AbortSignal, purpose: "verification" | "evidence-git" = "verification"): Promise<TestCommandResult> {
  const startedAt = new Date().toISOString();
  if (signal?.aborted) return { exitCode: 130, actualExitCode: null, terminationObserved: false, output: "[Command aborted before start]", aborted: true, startedAt, finishedAt: startedAt };
  const home = purpose === "verification" ? createVerificationHome() : undefined;
  return new Promise<TestCommandResult>((resolve) => {
    let child: ChildProcess | undefined; let settled = false; let outputBytes = 0; let outputTruncated = false;
    const chunks: Buffer[] = []; const rawOutput = createHash("sha256");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forced: Omit<TestCommandResult, "output"> | undefined; let forcedSuffix = "";
    const finish = (result: Omit<TestCommandResult, "output">, suffix = "") => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      const captured = Buffer.concat(chunks, outputBytes);
      const output = captured.toString("utf8") + suffix;
      // A killed process may still hold its home open on Windows. Clean up on settled child close.
      resolve({ ...result, actualExitCode: result.actualExitCode ?? null, terminationObserved: result.terminationObserved ?? false, output, outputTruncated, outputEncodingLoss: !isUtf8(captured), outputDigest: digestBytes(output), rawOutputDigest: rawOutput.digest("hex"), startedAt, finishedAt: new Date().toISOString() });
    };
    const terminate = (result: Omit<TestCommandResult, "output">, suffix: string) => {
      if (settled || forced) return;
      forced = result; forcedSuffix = suffix;
      if (!child) { finish(result, suffix); return; }
      if (child.pid && process.platform === "win32") {
        try {
          const killer = spawnChild("evidence-git", "taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
          const killTimer = setTimeout(() => child?.kill(), 5000);
          killTimer.unref();
          killer.once("exit", (code) => { clearTimeout(killTimer); if (code !== 0) child?.kill(); });
          killer.once("error", () => { clearTimeout(killTimer); child?.kill(); });
        } catch { child.kill(); }
      } else if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else child.kill();
    };
    const abort = () => terminate({ exitCode: 130, aborted: true }, "\n[Command aborted]");
    const append = (chunk: Buffer) => {
      if (settled) return; rawOutput.update(chunk);
      const remaining = 1024 * 1024 - outputBytes; if (chunk.length > remaining) outputTruncated = true;
      if (remaining > 0) { const accepted = chunk.subarray(0, remaining); chunks.push(accepted); outputBytes += accepted.length; }
    };
    try {
      child = home ? home.spawn("verification", command, [], { cwd, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }) : spawnChild("evidence-git", command, [], { cwd, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
      child!.stdout!.on("data", append); child!.stderr!.on("data", append);
      child!.on("close", (code, terminationSignal) => {
        let environmentVerified = true;
        try { home?.cleanup(); } catch { environmentVerified = false; }
        const result = forced
          ? { ...forced, actualExitCode: code, terminationObserved: true, environmentVerified, signal: terminationSignal }
          : { exitCode: code ?? 1, actualExitCode: code, terminationObserved: true, environmentVerified, signal: terminationSignal };
        finish(result, forced ? forcedSuffix : "");
      });
      child!.on("error", () => { try { home?.cleanup(); } catch { /* Preserve the command failure. */ } finish({ exitCode: 1 }, "\n[Process spawn error]"); });
      timer = setTimeout(() => terminate({ exitCode: 124, timedOut: true }, `\n[Command timed out after ${timeoutMs}ms]`), timeoutMs);
      signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    } catch { try { home?.cleanup(); } catch { /* Preserve failure. */ } finish({ exitCode: 1 }, "[Process environment or spawn rejected]"); }
  });
}
export function pathInScope(file: string, paths: readonly string[]): boolean {
  const normalized = file.replace(/\\/g, "/");
  if (!normalized || path.isAbsolute(file) || path.win32.isAbsolute(file) || /[:\x00-\x1f]/.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return paths.some((allowed) => allowed === "**" || allowed === normalized || (allowed.endsWith("/**") && (normalized === allowed.slice(0, -3) || normalized.startsWith(allowed.slice(0, -2)))) || (allowed.endsWith("/") && normalized.startsWith(allowed)));
}
export async function collectTaskEvidence(options: TaskEvidenceOptions): Promise<TaskEvidenceResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd()); const timeoutMs = options.timeoutMs ?? 15000; const contract = options.contract;
  if (options.planPath) assertPathIsClaudeSafe(options.planPath);
  // Legacy commands remain advisory only; a native consumer must require the bound receipt below.
  const test = contract ? undefined : options.testResult ?? (options.testCommand ? await executeTestCommand(options.testCommand, cwd, timeoutMs, options.signal) : undefined);
  const snapshotOptions = { contract, timeoutMs, signal: options.signal, nonGitPaths: options.nonGitPaths ?? options.verificationReceipt?.workspacePaths ?? options.afterSnapshot?.manifestPaths ?? options.baseline?.manifestPaths };
  // Never reuse an earlier changed-file list: tests can mutate or create any relevant path.
  const after = await captureWorkspaceSnapshot(cwd, snapshotOptions); const baseline = options.baseline;
  const omissions: EvidenceOmission[] = [...(after.omissions ?? [])]; const counterevidence: string[] = [...(options.provenanceLimitations ?? [])];
  if (test?.environmentVerified === false) omissions.push({ reason: "VERIFICATION_HOME_IDENTITY_UNAVAILABLE", kind: "security", required: true });
  if (test?.outputTruncated || test?.outputEncodingLoss) omissions.push({ reason: "VERIFICATION_OUTPUT_INCOMPLETE", kind: test?.outputTruncated ? "budget" : "unavailable", required: true });
  const usableBaseline = baseline && isHostSnapshot(baseline) && baseline.cwd === cwd;
  if (baseline && !usableBaseline) omissions.push({ reason: "HISTORICAL_PREIMAGE_REQUIRED", kind: "binding", required: true });
  if (baseline) omissions.push(...(baseline.omissions ?? []));
  if (contract && (!usableBaseline || !sameContract(baseline.binding, contract) || baseline.originalRequestDigest !== contract.originalUserRequest.digest || baseline.contractDigest !== canonicalDigest(contract))) omissions.push({ reason: "BASELINE_CONTRACT_BINDING_REQUIRED", kind: "binding", required: true });
  if (usableBaseline && (baseline.mode !== after.mode || (baseline.headSha && !after.headSha))) omissions.push({ reason: "WORKSPACE_PROVENANCE_CHANGED", kind: "binding", required: true });
  let changedFiles: string[] = usableBaseline ? diffSnapshots(baseline, after) : [];
  let gitStatus = ""; let gitDiff = ""; let statusObserved = false;
  let commitInterval: TaskEvidenceResult["commitInterval"];
  if (usableBaseline) {
    if (baseline.mode === "non-git" && after.mode === "non-git") {
      const unobserved = new Set<string>();
      for (const file of after.files.keys()) {
        const covered = baseline.files.has(file) || baseline.manifestPaths?.some((scope) => {
          const prefix = scope.replace(/\/\*\*$/, "").replace(/\/$/, "");
          return file === prefix || file.startsWith(`${prefix}/`);
        });
        if (!covered) {
          unobserved.add(file);
          omissions.push({ path: file, reason: "HISTORICAL_PREIMAGE_SCOPE_REQUIRED", kind: "binding", required: true });
          counterevidence.push(`NON_GIT_PREIMAGE_OUTSIDE_CAPTURED_SCOPE:${file}`);
        }
      }
      changedFiles = changedFiles.filter((file) => !unobserved.has(file));
    }
    const result = taskSnapshotDiff(baseline, after, changedFiles); gitDiff = result.diff; omissions.push(...result.omissions);
    gitStatus = changedFiles.map((file) => `${!after.files.has(file) || after.files.get(file) === "<deleted>" ? " D" : !baseline.files.has(file) ? "??" : " M"} ${file}`).join("\n");
    if (baseline.mode === "git" && baseline.complete && after.complete && after.headSha && baseline.headSha !== after.headSha) {
      try {
        if (baseline.headSha) gitBytes(cwd, ["merge-base", "--is-ancestor", baseline.headSha, after.headSha], timeoutMs);
        const interval = baseline.headSha ? `${baseline.headSha}..${after.headSha}` : after.headSha;
        const commits = gitBytes(cwd, ["rev-list", "--reverse", interval], timeoutMs).toString().trim().split(/\r?\n/).filter(Boolean);
        const intervalFiles = gitBytes(cwd, ["log", "--format=", "--name-only", "-z", interval], timeoutMs).toString().split(/[\0\r\n]+/).filter(Boolean);
        changedFiles = [...new Set([...changedFiles, ...intervalFiles])].sort();
        for (const file of intervalFiles) assertPathIsClaudeSafe(path.join(cwd, file));
        const patch = gitBytes(cwd, ["log", "--root", "--format=commit %H", "--patch", "--binary", "--no-ext-diff", interval], timeoutMs).toString("utf8");
        commitInterval = { from: baseline.headSha, to: after.headSha, commits, patch };
        counterevidence.push("Commit patches are provenance/counterevidence; endpoint diff excludes pre-task dirty bytes. Commits may include pre-task WIP or reverted intermediate changes.");
      } catch { omissions.push({ reason: "COMMIT_INTERVAL_UNAVAILABLE_OR_NON_ANCESTOR", kind: "unavailable", required: true }); }
    }
  } else if (after.mode === "git" && after.complete) {
    try {
      gitStatus = gitBytes(cwd, ["status", "--porcelain", "-uall"], timeoutMs).toString().trimEnd(); statusObserved = true; changedFiles = statusEvidencePaths(gitStatus);
      const empty: WorkspaceSnapshot = { files: new Map(), truncated: false };
      // No historical scope is inferred from the latest commit. Current untracked proof still uses guarded bytes.
      gitDiff = gitBytes(cwd, ["diff", "--binary", "--no-ext-diff", ...(after.headSha ? [after.headSha] : [])], timeoutMs).toString();
      for (const file of changedFiles.filter((name) => !empty.files.has(name) && gitStatus.split(/\r?\n/).some((line) => line.startsWith("??") && normalizeEvidencePath(line.slice(3)) === name))) {
        try { const value = readEvidenceFile(cwd, file); gitDiff += `\ndiff --git a/${file} b/${file}\nnew file\n--- /dev/null\n+++ b/${file}\n${value.bytes.includes(0) ? `Binary content sha256 ${value.sha256}` : value.bytes.toString("utf8").split(/\r?\n/).map((line) => `+${line}`).join("\n")}\n`; }
        catch { omissions.push({ path: file, reason: "UNTRACKED_EVIDENCE_UNAVAILABLE", kind: "security", required: true }); }
      }
    } catch { omissions.push({ reason: "WORKING_TREE_UNAVAILABLE", kind: "unavailable", required: true }); }
    counterevidence.push("No host-owned task baseline: current worktree is advisory, not task-relative proof.");
  }
  let criteria = contract?.criteria.map((criterion) => criterion.text) ?? []; let criteriaSource: TaskEvidenceResult["criteriaSource"] = contract ? "contract" : "none";
  if (!contract && options.planPath) {
    try {
      const relative = path.relative(cwd, path.resolve(options.planPath)).replace(/\\/g, "/"); const content = readEvidenceFile(cwd, relative).bytes.toString("utf8"); criteria = extractCriteriaFromPlan(content); criteriaSource = criteria.length ? "plan" : "none";
      const phaseId = options.taskId?.match(/^\s*(?:phase\s*0*(\d+)\b|0*(\d+)\s*$)/i)?.slice(1).find(Boolean);
      if (phaseId) for (const match of content.matchAll(/\|\s*(\d+)\s*\|\s*\[[^\]]*\]\(([^)]+)\)/g)) if (Number(match[1]) === Number(phaseId)) {
        const phasePath = path.relative(cwd, path.resolve(path.dirname(options.planPath), match[2])).replace(/\\/g, "/"); criteria = extractCriteriaFromPlan(readEvidenceFile(cwd, phasePath).bytes.toString("utf8")); criteriaSource = "phase"; break;
      }
    } catch { omissions.push({ reason: "CRITERIA_SOURCE_UNAVAILABLE", kind: "security", required: true }); }
  }
  if (contract) {
    for (const file of changedFiles) {
      const operation = !after.files.has(file) || after.files.get(file) === "<deleted>" ? "delete" : !baseline?.files.has(file) || baseline.files.get(file) === "<deleted>" ? "create" : "modify";
      const originalScope = pathInScope(file, contract.allowedMutationScope.paths) && contract.allowedMutationScope.operations.includes(operation);
      const separateAuthorization = options.authorizedMutationReceipts?.some((receipt) => validateAuthorizedMutation(receipt, contract, after, { path: file, operation }));
      if (!originalScope && !separateAuthorization) {
        counterevidence.push(`UNATTRIBUTED_OR_UNAUTHORIZED_MUTATION:${file}`);
        omissions.push({ path: file, reason: "AUTHORIZED_MUTATION_RECEIPT_REQUIRED", kind: "binding", required: true });
      } else if (separateAuthorization) counterevidence.push(`SEPARATELY_AUTHORIZED_REMEDIATION:${file}`);
    }
    if (options.verificationReceipt) {
      const validation = validateVerificationReceipt(options.verificationReceipt, contract, after);
      if (!validation.ok) for (const reason of validation.reasons) omissions.push({ reason, kind: "binding", required: true });
    } else if (contract.taskKind === "implementation" && contract.approvedCommandIds.length) omissions.push({ reason: "VERIFICATION_RECEIPT_REQUIRED", kind: "binding", required: true });
  }
  const sourceEvidence: NonNullable<TaskEvidenceResult["sourceEvidence"]> = [];
  let sourceBytes = 0;
  const changedSet = new Set(changedFiles);
  const readScope = options.readScopePaths ?? contract?.allowedMutationScope.paths ?? [];
  const relevantFiles = new Set([...changedFiles, ...(options.sourcePaths ? options.sourcePaths.filter((file) => pathInScope(file, readScope)) : options.readScopePaths || contract?.allowedMutationScope.operations.includes("read") ? [...after.files.keys()].filter((file) => pathInScope(file, readScope)) : [])]);
  const sortedFiles = [...relevantFiles].sort((a, b) => (changedSet.has(a) === changedSet.has(b) ? a.localeCompare(b) : changedSet.has(a) ? -1 : 1));
  for (const file of sortedFiles) {
    if (!after.files.has(file) || after.files.get(file) === "<deleted>") continue;
    try {
      const value = readEvidenceFile(cwd, file); if (value.sha256 !== after.files.get(file) || JSON.stringify(value.identity) !== JSON.stringify(after.fileIdentities?.[file])) throw new Error("SOURCE_CHANGED");
      sourceBytes += value.bytes.length;
      if (sourceBytes > 1024 * 1024) { omissions.push({ path: file, reason: "FULL_SOURCE_BYTE_LIMIT", kind: "budget", required: changedSet.has(file) }); continue; }
      const binary = value.bytes.includes(0) || !isUtf8(value.bytes);
      sourceEvidence.push({ path: file, sha256: value.sha256, content: value.bytes.toString(binary ? "base64" : "utf8"), encoding: binary ? "base64" : "utf8", criterionIds: [], role: changedSet.has(file) ? "changed" : "context", beforeMode: baseline?.fileIdentities?.[file]?.mode, afterMode: after.fileIdentities?.[file]?.mode });
    }
    catch { omissions.push({ path: file, reason: "SOURCE_CHANGED_OR_UNSAFE", kind: "security", required: true }); }
  }
  const stable = await captureWorkspaceSnapshot(cwd, snapshotOptions);
  if (!stable.complete || stable.treeDigest !== after.treeDigest) omissions.push({ reason: "POST_COLLECTION_TREE_UNSTABLE", kind: "unavailable", required: true });
  const receipt = options.verificationReceipt;
  let cleanWorkingTree = false;
  if (after.mode === "git" && after.complete === true) {
    if (statusObserved && stable.complete && stable.treeDigest === after.treeDigest) {
      cleanWorkingTree = gitStatus.length === 0;
    } else {
      try { cleanWorkingTree = gitBytes(cwd, ["status", "--porcelain", "-uall"], timeoutMs).length === 0; }
      catch { omissions.push({ reason: "FINAL_GIT_STATUS_UNAVAILABLE", kind: "unavailable", required: true }); }
    }
  }
  const result: TaskEvidenceResult = { gitStatus, gitDiff, changedFiles, criteria, criteriaSource, cleanWorkingTree,
    testExitCode: receipt?.applicability === "diagnostic" ? null : receipt?.result.exitCode ?? test?.exitCode ?? null, testOutput: receipt?.result.output ?? test?.output ?? "", timestamp: new Date().toISOString(), taskDoneProven: options.taskDoneProven, todoCompleted: options.todoCompleted,
    diffScope: usableBaseline ? "task-baseline" : "full-working-tree", snapshot: stable, baselineSnapshotId: usableBaseline ? baseline.snapshotId : undefined, evaluatedTreeDigest: after.treeDigest, contract, verificationReceipt: receipt, readScopePaths: options.readScopePaths ? [...options.readScopePaths] : undefined, authorizedMutationReceipts: options.authorizedMutationReceipts, omissions, counterevidence, commitInterval, sourceEvidence,
    evidenceStatus: omissions.some((item) => item.required) ? "EVIDENCE_REQUIRED" : "READY" };
  issuedEvidence.set(result, canonicalDigest(result));
  releaseWorkspaceSnapshot(after, "operation_finished");
  return result;
}
export async function validateEvidenceFreshness(evidence: TaskEvidenceResult, cwd: string, options: WorkspaceSnapshotOptions = {}): Promise<{ ok: boolean; reasons: string[]; snapshot: WorkspaceSnapshot }> {
  const current = await captureWorkspaceSnapshot(cwd, { ...options, nonGitPaths: options.nonGitPaths ?? evidence.snapshot?.manifestPaths, contract: options.contract ?? evidence.contract });
  const reasons = !evidence.snapshot || !isHostSnapshot(evidence.snapshot) || !current.complete || current.treeDigest !== evidence.evaluatedTreeDigest ? ["EVALUATED_TREE_CHANGED_OR_UNAVAILABLE"] : [];
  if (evidence.contract && evidence.verificationReceipt) reasons.push(...validateVerificationReceipt(evidence.verificationReceipt, evidence.contract, current).reasons);
  return { ok: reasons.length === 0, reasons, snapshot: current };
}
