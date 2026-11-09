import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ContractReference, TaskContract } from "./types/verification";
import { canonicalDigest } from "./task-contract";
import { readWorkspaceFile, listWorkspaceFiles, type WorkspaceFileRead, type WorkspaceFileIdentity } from "./typesafe-evidence-file.cjs";
import { execFileChildSync } from "./typesafe-child-env.cjs";
export const SNAPSHOT_LIMITS = Object.freeze({ files: 4000, fileBytes: 1024 * 1024, retainedBytes: 8 * 1024 * 1024, totalRetainedBytes: 32 * 1024 * 1024, diffBytes: 1024 * 1024 });
export interface EvidenceOmission { path?: string; reason: string; required: boolean; kind: "security" | "unavailable" | "budget" | "binding" }
export interface WorkspaceSnapshotOptions { signal?: AbortSignal; timeoutMs?: number; contract?: TaskContract; nonGitPaths?: readonly string[] }
export interface WorkspaceSnapshot {
  files: Map<string, string>; truncated: boolean; headSha?: string;
  schemaVersion?: 1; snapshotId?: string; treeDigest?: string; cwd?: string;
  mode?: "git" | "non-git" | "unavailable"; complete?: boolean;
  binding?: ContractReference; originalRequestDigest?: string; contractDigest?: string; capturedAt?: string;
  omissions?: readonly EvidenceOmission[]; manifestPaths?: readonly string[];
  fileIdentities?: Readonly<Record<string, WorkspaceFileIdentity>>;
  rootIdentity?: { dev: string; ino: string; birthtimeNs: string; mode: string };
  indexDigest?: string;
}
interface RetainedSnapshot { bytes: Map<string, Buffer>; clean: Set<string>; seal: string; retainedSize: number }
const retained = new WeakMap<WorkspaceSnapshot, RetainedSnapshot>();
let totalRetainedBytes = 0;
const finalizedSnapshots = new FinalizationRegistry<number>((size) => { totalRetainedBytes -= size; });
export const digestBytes = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
export const contractReference = (contract: TaskContract): ContractReference => ({ contractId: contract.contractId, revisionId: contract.revisionId, incarnationId: contract.incarnationId });
export function sameContract(reference: ContractReference | undefined, contract: TaskContract): boolean {
  return !!reference && reference.contractId === contract.contractId && reference.revisionId === contract.revisionId && reference.incarnationId === contract.incarnationId;
}
export function gitBytes(cwd: string, args: string[], timeoutMs = 15000): Buffer {
  const safeArgs = args[0] === "diff" || args[0] === "log" ? [args[0], "--no-ext-diff", "--no-textconv", ...args.slice(1)] : args;
  return execFileChildSync("evidence-git", "git", ["-c", "core.quotePath=false", "-c", "core.hooksPath=", "-c", "core.fsmonitor=false", ...safeArgs], { cwd, timeout: timeoutMs, maxBuffer: SNAPSHOT_LIMITS.diffBytes + 1, stdio: ["ignore", "pipe", "pipe"] });
}
function omission(error: unknown, file?: string): EvidenceOmission {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "SNAPSHOT_UNAVAILABLE";
  const kind = error && typeof error === "object" && "kind" in error && error.kind === "security" ? "security" : "unavailable";
  return { path: file, reason: code, kind, required: true };
}
function snapshotSeal(snapshot: WorkspaceSnapshot): string {
  const { files, ...metadata } = snapshot;
  return canonicalDigest({ metadata, files: [...files] });
}
export function readEvidenceFile(cwd: string, file: string, maxBytes = SNAPSHOT_LIMITS.fileBytes): WorkspaceFileRead {
  return readWorkspaceFile(cwd, file, { maxBytes });
}
export async function captureWorkspaceSnapshot(cwd: string, options: WorkspaceSnapshotOptions = {}): Promise<WorkspaceSnapshot> {
  const root = path.resolve(cwd); const files = new Map<string, string>(); const bytes = new Map<string, Buffer>(); const clean = new Set<string>(); const identities: Array<[string, WorkspaceFileIdentity]> = [];
  const omissions: EvidenceOmission[] = []; let headSha: string | undefined; let mode: WorkspaceSnapshot["mode"] = "git"; let names: string[] = []; let dirty = new Set<string>(); const indexBlobs = new Map<string, string>();
  let rootIdentity: WorkspaceSnapshot["rootIdentity"]; let indexDigest: string | undefined;
  try {
    const stat = fs.lstatSync(root, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n || typeof stat.birthtimeNs !== "bigint") throw Object.assign(new Error("WORKSPACE_ROOT_UNSAFE_OR_UNAVAILABLE"), { code: "WORKSPACE_ROOT_UNSAFE_OR_UNAVAILABLE", kind: "security" });
    rootIdentity = { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), mode: String(stat.mode) };
  } catch (failure) { omissions.push(omission(failure)); }
  let retainedSize = 0; const timeout = options.timeoutMs ?? 15000; const deadline = Date.now() + timeout;
  const snapshotGit = (args: string[]): Buffer => {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || options.signal?.aborted) throw Object.assign(new Error("SNAPSHOT_DEADLINE_OR_ABORT"), { code: "SNAPSHOT_DEADLINE_OR_ABORT" });
    return gitBytes(root, args, remaining);
  };
  if (options.signal?.aborted) omissions.push({ reason: "SNAPSHOT_ABORTED", kind: "unavailable", required: true });
  try {
    const repositoryRoot = snapshotGit(["rev-parse", "--show-toplevel"]).toString().trim();
    const actualRoot = fs.realpathSync.native(repositoryRoot); const expectedRoot = fs.realpathSync.native(root);
    if (process.platform === "win32" ? actualRoot.toLowerCase() !== expectedRoot.toLowerCase() : actualRoot !== expectedRoot) throw Object.assign(new Error("GIT_ROOT_BINDING_REQUIRED"), { code: "GIT_ROOT_BINDING_REQUIRED" });
    try { headSha = snapshotGit(["rev-parse", "--verify", "HEAD"]).toString().trim(); }
    catch {
      const ref = snapshotGit(["symbolic-ref", "--quiet", "HEAD"]).toString().trim();
      if (!ref.startsWith("refs/heads/") || snapshotGit(["for-each-ref", "--format=%(refname)", ref]).toString().split(/\r?\n/).includes(ref)) throw Object.assign(new Error("GIT_HEAD_UNAVAILABLE"), { code: "GIT_HEAD_UNAVAILABLE" });
    }
    const stagedIndex = snapshotGit(["ls-files", "--stage", "-z"]); indexDigest = digestBytes(stagedIndex);
    const cachedNames: string[] = [];
    for (const entry of stagedIndex.toString("utf8").split("\0").filter(Boolean)) {
      const separator = entry.indexOf("\t"); const header = entry.slice(0, separator).split(" ");
      if (separator > 0) {
        const entryPath = entry.slice(separator + 1);
        cachedNames.push(entryPath);
        if (header[2] === "0") indexBlobs.set(entryPath, header[1]);
        else omissions.push({ reason: "UNMERGED_INDEX_PREIMAGE_REQUIRED", kind: "unavailable", required: true });
      } else omissions.push({ reason: "UNMERGED_INDEX_PREIMAGE_REQUIRED", kind: "unavailable", required: true });
    }
    const untracked = snapshotGit(["ls-files", "-z", "--others", "--exclude-standard"]).toString("utf8").split("\0").filter(Boolean);
    names = [...new Set([...cachedNames, ...untracked])];
    dirty = new Set(snapshotGit(["diff", "--name-only", "-z", ...(headSha ? [headSha] : [])]).toString("utf8").split("\0").filter(Boolean));
    for (const name of untracked) dirty.add(name);
  } catch (error) {
    // Only the absence of any repository ancestor is a supported non-Git lane.
    let cursor = root; let repositoryMarker = false;
    for (;;) { if (fs.existsSync(path.join(cursor, ".git"))) { repositoryMarker = true; break; } const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent; }
    if (repositoryMarker) { mode = "unavailable"; omissions.push(omission(error)); }
    else {
      mode = "non-git";
      const scope = options.nonGitPaths ?? options.contract?.allowedMutationScope.paths ?? [];
      for (const requested of scope) {
        const prefix = requested.replace(/\/\*\*$/, "").replace(/\/$/, "");
        if (!prefix || path.isAbsolute(prefix) || prefix.split(/[\\/]/).some((part) => part === ".." || part === ".") || prefix.includes("*")) { omissions.push({ reason: "NON_GIT_SCOPE_INVALID", kind: "security", required: true }); continue; }
        try {
          const stat = fs.lstatSync(path.join(root, prefix));
          if (stat.isDirectory()) names.push(...listWorkspaceFiles(root, prefix, { maxFiles: SNAPSHOT_LIMITS.files }));
          else names.push(prefix);
        } catch (failure) {
          if (failure && typeof failure === "object" && "code" in failure && failure.code === "ENOENT") names.push(prefix);
          else omissions.push(omission(failure, prefix));
        }
      }
      if (!scope.length) omissions.push({ reason: "NON_GIT_SCOPE_REQUIRED", kind: "binding", required: true });
    }
  }
  if (mode === "git") for (const requested of options.nonGitPaths ?? options.contract?.allowedMutationScope.paths ?? []) {
    if (requested.includes("*")) continue;
    const file = requested.replace(/\/$/, "");
    try {
      const stat = fs.lstatSync(path.join(root, file));
      if (stat.isDirectory()) names.push(...listWorkspaceFiles(root, file, { maxFiles: SNAPSHOT_LIMITS.files }));
      else names.push(file);
    } catch (failure) {
      if (failure && typeof failure === "object" && "code" in failure && failure.code === "ENOENT") names.push(file);
      else omissions.push(omission(failure, file));
    }
  }
  names = [...new Set(names)].sort();
  if (names.length > SNAPSHOT_LIMITS.files) omissions.push({ reason: "SNAPSHOT_FILE_LIMIT", kind: "budget", required: true });
  for (const file of names.slice(0, SNAPSHOT_LIMITS.files)) {
    if (options.signal?.aborted || Date.now() >= deadline) { omissions.push({ reason: options.signal?.aborted ? "SNAPSHOT_ABORTED" : "SNAPSHOT_DEADLINE", kind: "unavailable", required: true }); break; }
    try {
      const value = readEvidenceFile(root, file); files.set(file, value.sha256); identities.push([file, value.identity]);
      const blobId = indexBlobs.get(file);
      const rawBlobId = blobId ? createHash(blobId.length === 64 ? "sha256" : "sha1").update(`blob ${value.bytes.length}\0`).update(value.bytes).digest("hex") : undefined;
      if (mode === "git" && headSha && blobId !== undefined && !dirty.has(file) && rawBlobId === blobId) clean.add(file);
      else if (retainedSize + value.bytes.length <= SNAPSHOT_LIMITS.retainedBytes && totalRetainedBytes + retainedSize + value.bytes.length <= SNAPSHOT_LIMITS.totalRetainedBytes) { bytes.set(file, Buffer.from(value.bytes)); retainedSize += value.bytes.length; }
      else omissions.push({ path: file, reason: "PREIMAGE_BYTE_LIMIT", kind: "budget", required: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "FILE_MISSING") files.set(file, "<deleted>");
      else omissions.push(omission(error, file));
    }
  }
  try {
    const stat = fs.lstatSync(root, { bigint: true });
    if (stat.isSymbolicLink() || !rootIdentity || canonicalDigest(rootIdentity) !== canonicalDigest({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), mode: String(stat.mode) })) omissions.push({ reason: "WORKSPACE_ROOT_IDENTITY_CHANGED", kind: "security", required: true });
  } catch (failure) { omissions.push(omission(failure)); }
  const treeDigest = canonicalDigest({ mode, headSha, indexDigest, rootIdentity, files: [...files], identities });
  const binding = options.contract ? contractReference(options.contract) : undefined;
  const snapshot: WorkspaceSnapshot = { schemaVersion: 1, snapshotId: randomUUID(), cwd: root, files, headSha, mode, treeDigest, complete: omissions.length === 0, truncated: omissions.some((item) => item.kind === "budget"), omissions, binding, originalRequestDigest: options.contract?.originalUserRequest.digest, contractDigest: options.contract ? canonicalDigest(options.contract) : undefined, capturedAt: new Date().toISOString(), manifestPaths: options.nonGitPaths ? [...options.nonGitPaths] : undefined, fileIdentities: Object.fromEntries(identities) };
  snapshot.rootIdentity = rootIdentity;
  snapshot.indexDigest = indexDigest;
  totalRetainedBytes += retainedSize;
  retained.set(snapshot, { bytes, clean, seal: snapshotSeal(snapshot), retainedSize }); finalizedSnapshots.register(snapshot, retainedSize, snapshot); return snapshot;
}
export function isHostSnapshot(snapshot: WorkspaceSnapshot): boolean {
  const owned = retained.get(snapshot);
  return !!owned && snapshotSeal(snapshot) === owned.seal;
}
export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  return [...new Set([...before.files.keys(), ...after.files.keys()])].filter((file) => before.files.get(file) !== after.files.get(file) || before.fileIdentities?.[file]?.mode !== after.fileIdentities?.[file]?.mode).sort();
}
function snapshotBytes(snapshot: WorkspaceSnapshot, file: string): Buffer | undefined {
  const owned = retained.get(snapshot); if (!owned || !isHostSnapshot(snapshot)) throw Object.assign(new Error("BASELINE_PREIMAGE_REQUIRED"), { code: "BASELINE_PREIMAGE_REQUIRED" });
  if (!snapshot.files.has(file) || snapshot.files.get(file) === "<deleted>") return undefined;
  const value = owned.bytes.get(file) ?? (owned.clean.has(file) && snapshot.headSha && snapshot.cwd ? gitBytes(snapshot.cwd, ["cat-file", "blob", `${snapshot.headSha}:${file}`]) : undefined);
  if (!value || digestBytes(value) !== snapshot.files.get(file)) throw Object.assign(new Error("PREIMAGE_UNAVAILABLE"), { code: "PREIMAGE_UNAVAILABLE" });
  return value;
}
export function taskSnapshotDiff(before: WorkspaceSnapshot, after: WorkspaceSnapshot, files: readonly string[]): { diff: string; omissions: EvidenceOmission[] } {
  if (!files.length) return { diff: "", omissions: [] };
  if (before.mode === "non-git" && after.mode === "non-git") {
    const changes: Array<{ path: string; before: string | null; after: string | null; encoding: "base64" }> = []; const omissions: EvidenceOmission[] = []; let bytes = 0;
    for (const file of files) try {
      const prior = snapshotBytes(before, file); const current = snapshotBytes(after, file);
      bytes += (prior?.length ?? 0) + (current?.length ?? 0);
      if (bytes > SNAPSHOT_LIMITS.diffBytes / 2) { omissions.push({ path: file, reason: "NON_GIT_TRANSITION_BYTE_LIMIT", kind: "budget", required: true }); continue; }
      changes.push({ path: file, before: prior?.toString("base64") ?? null, after: current?.toString("base64") ?? null, encoding: "base64" });
    } catch (error) { omissions.push(omission(error, file)); }
    return { diff: `[Non-Git task-relative content transitions; no VCS history asserted]\n${JSON.stringify(changes)}`, omissions };
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "typesafe-task-diff-")); const omissions: EvidenceOmission[] = [];
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  try {
    fs.mkdirSync(path.join(directory, "before")); fs.mkdirSync(path.join(directory, "after"));
    for (const file of files) {
      try {
        const oldBytes = snapshotBytes(before, file); const newBytes = snapshotBytes(after, file);
        for (const [prefix, value] of [["before", oldBytes], ["after", newBytes]] as const) if (value) {
          const target = path.join(directory, prefix, file);
          fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value, { mode: 0o600 });
        }
      } catch (error) { omissions.push(omission(error, file)); }
    }
    // Git supplies text, binary, addition, deletion and rename boundaries in one bounded operation.
    let patch: Buffer;
    try { patch = gitBytes(directory, ["diff", "--no-index", "--binary", "--find-renames", "--no-ext-diff", "--", "before", "after"]); }
    catch (error) {
      if (!error || typeof error !== "object" || !("status" in error) || error.status !== 1 || !("stdout" in error) || !Buffer.isBuffer(error.stdout)) {
        omissions.push(omission(error)); return { diff: "", omissions };
      }
      patch = error.stdout;
    }
    if (patch.length > SNAPSHOT_LIMITS.diffBytes) { omissions.push({ reason: "DIFF_BYTE_LIMIT", kind: "budget", required: true }); return { diff: "", omissions }; }
    return { diff: patch.toString("utf8").replaceAll("a/before/", "a/").replaceAll("b/after/", "b/").replaceAll("a/after/", "a/").replaceAll("b/before/", "b/"), omissions };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
/** The owning host closes a baseline only on legitimate contract closure/expiry; transient operation snapshots may close after use. */
export function releaseWorkspaceSnapshot(snapshot: WorkspaceSnapshot, reason: "contract_closed" | "retention_expired" | "operation_finished"): void {
  if (!["contract_closed", "retention_expired", "operation_finished"].includes(reason)) throw new Error("SNAPSHOT_RELEASE_REASON_REQUIRED");
  const owned = retained.get(snapshot); if (!owned) return;
  totalRetainedBytes -= owned.retainedSize; finalizedSnapshots.unregister(snapshot); retained.delete(snapshot);
}
