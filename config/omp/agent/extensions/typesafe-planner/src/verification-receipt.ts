import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CreationProvenance, HostReference, TaskContract } from "./types/verification";
import { canonicalDigest } from "./task-contract";
import type { WorkspaceFileIdentity } from "./typesafe-evidence-file.cjs";
import { captureWorkspaceSnapshot, contractReference, digestBytes, isHostSnapshot, readEvidenceFile, releaseWorkspaceSnapshot, sameContract, type WorkspaceSnapshot } from "./evidence-workspace";
import { executeTestCommand, type TestCommandResult } from "./evidence-collector";
export interface ApprovedVerificationCommand {
  id: string; command: string; cwd: string; criterionIds: readonly string[];
  testAssetPaths: readonly string[]; artifactPaths?: readonly string[]; timeoutMs?: number;
  kind?: "verification" | "diagnostic";
}
export interface VerificationAsset { path: string; sha256: string; identity: WorkspaceFileIdentity }
export interface VerificationReceipt {
  schemaVersion: 1; receiptId: string; contract: { contractId: string; revisionId: string; incarnationId: string };
  originalRequestDigest: string; contractDigest: string; policyDigest: string; host: CreationProvenance;
  commandId: string; command: string; cwd: string; criterionIds: readonly string[];
  applicability: "required" | "diagnostic";
  startedAt: string; finishedAt: string; timeoutMs: number; result: TestCommandResult;
  preSnapshotId: string; postSnapshotId: string; stableSnapshotId: string;
  preTreeDigest: string; postTreeDigest: string; stableTreeDigest: string;
  workspacePaths: readonly string[];
  testAssetsBefore: readonly VerificationAsset[]; testAssetsAfter: readonly VerificationAsset[];
  artifacts: readonly VerificationAsset[]; outputDigest: string; reasons: readonly string[];
  digest: string;
}
export interface VerificationReceiptOptions {
  contract: TaskContract; commandId: string; commands: ReadonlyMap<string, ApprovedVerificationCommand>;
  cwd: string; host: CreationProvenance; signal?: AbortSignal; timeoutMs?: number;
  workspacePaths?: readonly string[];
}
const issued = new WeakMap<VerificationReceipt, string>();
export class VerificationReceiptError extends Error {
  readonly status = "EVIDENCE_REQUIRED";
  constructor(readonly code: string) { super(code); this.name = "VerificationReceiptError"; }
}
function assets(cwd: string, names: readonly string[], deadline = Infinity): VerificationAsset[] {
  return names.map((name) => { if (Date.now() >= deadline) throw new VerificationReceiptError("RECEIPT_ASSET_DEADLINE"); const value = readEvidenceFile(cwd, name); return { path: name, sha256: value.sha256, identity: value.identity }; });
}
function receiptDigest(receipt: VerificationReceipt): string {
  const { digest: _digest, ...body } = receipt;
  return canonicalDigest(body);
}
export async function collectVerificationReceipt(options: VerificationReceiptOptions): Promise<VerificationReceipt> {
  const contract = structuredClone(options.contract); const { commandId } = options; const host = { ...options.host }; const cwd = path.resolve(options.cwd);
  const registered = options.commands.get(commandId);
  if (!contract.approvedCommandIds.includes(commandId) || !registered || registered.id !== commandId) throw new VerificationReceiptError("COMMAND_NOT_APPROVED");
  const command: ApprovedVerificationCommand = { ...registered, criterionIds: [...registered.criterionIds], testAssetPaths: [...registered.testAssetPaths], artifactPaths: registered.artifactPaths ? [...registered.artifactPaths] : undefined };
  if (path.resolve(command.cwd) !== cwd || !command.command.trim() || /^(?:\s*(?:echo|printf)\b|\s*(?:cmd\s+\/c\s+)?echo\b)/i.test(command.command)) throw new VerificationReceiptError("COMMAND_NOT_VERIFICATION");
  if (!command.testAssetPaths.length || !command.criterionIds.length || command.criterionIds.some((id) => !contract.criteria.some((criterion) => criterion.id === id))) throw new VerificationReceiptError("COMMAND_APPLICABILITY_REQUIRED");
  if (host.sessionId !== contract.creation.sessionId || host.branchId !== contract.creation.branchId || !host.callId || !host.entryId) throw new VerificationReceiptError("RECEIPT_HOST_BINDING_INVALID");
  const approvedTimeout = command.timeoutMs ?? 120000;
  const timeoutMs = options.timeoutMs ?? approvedTimeout;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > approvedTimeout || !Number.isSafeInteger(approvedTimeout) || approvedTimeout > 300000) throw new VerificationReceiptError("COMMAND_TIMEOUT_POLICY_INVALID");
  const startedAt = new Date().toISOString();
  const paths = [...new Set([...(options.workspacePaths ?? contract.allowedMutationScope.paths), ...command.testAssetPaths, ...(command.artifactPaths ?? [])])];
  const before = await captureWorkspaceSnapshot(cwd, { contract, signal: options.signal, nonGitPaths: paths });
  if (!before.complete || !isHostSnapshot(before)) throw new VerificationReceiptError("PRE_TEST_SNAPSHOT_REQUIRED");
  let testAssetsBefore: VerificationAsset[];
  try { testAssetsBefore = assets(cwd, command.testAssetPaths); } catch { throw new VerificationReceiptError("TEST_ASSET_UNSAFE_OR_UNAVAILABLE"); }
  const result = await executeTestCommand(command.command, cwd, timeoutMs, options.signal);
  const after = await captureWorkspaceSnapshot(cwd, { contract, signal: options.signal, nonGitPaths: paths });
  const reasons: string[] = [];
  let testAssetsAfter: VerificationAsset[] = []; let artifactDigests: VerificationAsset[] = [];
  try { testAssetsAfter = assets(cwd, command.testAssetPaths); artifactDigests = assets(cwd, command.artifactPaths ?? []); } catch { reasons.push("POST_TEST_ASSET_UNSAFE_OR_UNAVAILABLE"); }
  const stable = await captureWorkspaceSnapshot(cwd, { contract, signal: options.signal, nonGitPaths: paths });
  if (!after.complete || !stable.complete || after.treeDigest !== stable.treeDigest) reasons.push("POST_TEST_TREE_UNSTABLE");
  const outputPaths = new Set(command.artifactPaths ?? []);
  const mutatedPaths = new Set([...before.files.keys(), ...after.files.keys()]);
  if (before.mode !== after.mode || before.indexDigest !== after.indexDigest || JSON.stringify(before.rootIdentity) !== JSON.stringify(after.rootIdentity) || before.headSha !== after.headSha || [...mutatedPaths].some((file) => !outputPaths.has(file) && (before.files.get(file) !== after.files.get(file) || JSON.stringify(before.fileIdentities?.[file]) !== JSON.stringify(after.fileIdentities?.[file])))) reasons.push("SOURCE_CHANGED_DURING_VERIFICATION");
  if (JSON.stringify(testAssetsBefore) !== JSON.stringify(testAssetsAfter)) reasons.push("TEST_ASSETS_CHANGED_DURING_VERIFICATION");
  if (result.exitCode !== 0 || result.actualExitCode !== 0 || result.terminationObserved !== true || result.aborted || result.timedOut || result.signal) reasons.push("VERIFICATION_COMMAND_FAILED");
  if (result.environmentVerified !== true) reasons.push("VERIFICATION_ENVIRONMENT_UNPROVEN");
  if (result.outputTruncated || result.outputEncodingLoss) reasons.push("VERIFICATION_OUTPUT_INCOMPLETE");
  const body: Omit<VerificationReceipt, "digest"> = {
    schemaVersion: 1, receiptId: randomUUID(), contract: contractReference(contract), originalRequestDigest: contract.originalUserRequest.digest, contractDigest: canonicalDigest(contract),
    policyDigest: contract.policyDigest, host: { ...host }, commandId, command: command.command, cwd, criterionIds: [...command.criterionIds],
    applicability: command.kind === "diagnostic" || (command.kind === undefined && contract.taskKind !== "implementation") ? "diagnostic" : "required",
    startedAt, finishedAt: new Date().toISOString(), timeoutMs, result: { ...result },
    preSnapshotId: before.snapshotId!, postSnapshotId: after.snapshotId!, stableSnapshotId: stable.snapshotId!,
    preTreeDigest: before.treeDigest!, postTreeDigest: after.treeDigest!, stableTreeDigest: stable.treeDigest!, workspacePaths: paths,
    testAssetsBefore, testAssetsAfter, artifacts: artifactDigests, outputDigest: digestBytes(result.output), reasons,
  };
  const receipt: VerificationReceipt = { ...body, digest: canonicalDigest(body) };
  issued.set(receipt, receipt.digest);
  releaseWorkspaceSnapshot(before, "operation_finished"); releaseWorkspaceSnapshot(after, "operation_finished"); releaseWorkspaceSnapshot(stable, "operation_finished");
  return receipt;
}
/** JSON and source hashes alone never recreate host execution provenance. */
export interface ReceiptValidationOptions { deadline?: number }
export function validateVerificationReceipt(receipt: VerificationReceipt, contract: TaskContract, snapshot: WorkspaceSnapshot, options: ReceiptValidationOptions = {}): { ok: boolean; reasons: string[] } {
  const original = issued.get(receipt);
  if (!original) return { ok: false, reasons: ["HOST_VERIFICATION_RECEIPT_REQUIRED"] };
  const reasons = receipt.reasons.filter((reason) => receipt.applicability !== "diagnostic" || reason !== "VERIFICATION_COMMAND_FAILED");
  if (original !== receipt.digest || receiptDigest(receipt) !== original) return { ok: false, reasons: ["HOST_VERIFICATION_RECEIPT_REQUIRED"] };
  if (!sameContract(receipt.contract, contract) || receipt.contractDigest !== canonicalDigest(contract) || receipt.originalRequestDigest !== contract.originalUserRequest.digest || receipt.policyDigest !== contract.policyDigest || receipt.host.sessionId !== contract.creation.sessionId || receipt.host.branchId !== contract.creation.branchId) reasons.push("FOREIGN_VERIFICATION_RECEIPT");
  if (!contract.approvedCommandIds.includes(receipt.commandId)) reasons.push("COMMAND_NOT_APPROVED");
  if (!isHostSnapshot(snapshot) || !snapshot.complete || !sameContract(snapshot.binding, contract) || snapshot.contractDigest !== receipt.contractDigest || path.resolve(receipt.cwd) !== snapshot.cwd || receipt.postTreeDigest !== receipt.stableTreeDigest || snapshot.treeDigest !== receipt.stableTreeDigest) reasons.push("STALE_VERIFICATION_RECEIPT");
  const requiredFailure = receipt.applicability === "required" && (receipt.result.exitCode !== 0 || receipt.result.actualExitCode !== 0);
  if (requiredFailure || receipt.result.terminationObserved !== true || receipt.result.timedOut || receipt.result.aborted || receipt.result.signal || receipt.result.outputTruncated || receipt.result.outputEncodingLoss || receipt.outputDigest !== digestBytes(receipt.result.output)) reasons.push("VERIFICATION_COMMAND_FAILED");
  if (receipt.result.environmentVerified !== true) reasons.push("VERIFICATION_ENVIRONMENT_UNPROVEN");
  try {
    if (JSON.stringify(assets(receipt.cwd, receipt.testAssetsAfter.map((asset) => asset.path), options.deadline)) !== JSON.stringify(receipt.testAssetsAfter) || JSON.stringify(assets(receipt.cwd, receipt.artifacts.map((asset) => asset.path), options.deadline)) !== JSON.stringify(receipt.artifacts)) reasons.push("STALE_VERIFICATION_ASSET");
  } catch { reasons.push("VERIFICATION_ASSET_UNSAFE_OR_UNAVAILABLE"); }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export interface AuthorizedMutation { path: string; operation: "create" | "modify" | "delete" }
export interface AuthorizedMutationReceipt {
  schemaVersion: 1; receiptId: string; reviewContractDigest: string; remediationContractDigest: string;
  remediationContract: TaskContract; approval: HostReference; host: CreationProvenance;
  evaluatedTreeDigest: string; policyDigest: string; mutations: readonly AuthorizedMutation[]; digest: string;
}
export interface AuthorizedMutationReceiptOptions {
  reviewContract: TaskContract; remediationContract: TaskContract; approval: HostReference;
  host: CreationProvenance; snapshot: WorkspaceSnapshot; mutations: readonly AuthorizedMutation[];
  validateAuthority: (input: { reviewContract: TaskContract; remediationContract: TaskContract; approval: HostReference; host: CreationProvenance }) => boolean;
}
const authorizedMutations = new WeakMap<AuthorizedMutationReceipt, string>();
/** Host integration supplies actual user/ask authority, never a model flag or a source hash. */
export function issueAuthorizedMutationReceipt(options: AuthorizedMutationReceiptOptions): AuthorizedMutationReceipt {
  const { reviewContract, remediationContract, approval, host, snapshot, mutations } = options;
  let authorized = false;
  try { authorized = options.validateAuthority({ reviewContract, remediationContract, approval, host }) === true; } catch { /* A callback failure cannot create authority or expose its error. */ }
  if (!authorized) throw new VerificationReceiptError("REMEDIATION_AUTHORITY_REQUIRED");
  if (reviewContract.contractId === remediationContract.contractId || !["implementation", "operations"].includes(remediationContract.taskKind) || !isHostSnapshot(snapshot) || !snapshot.complete || !sameContract(snapshot.binding, reviewContract) || snapshot.contractDigest !== canonicalDigest(reviewContract) || host.sessionId !== reviewContract.creation.sessionId || host.branchId !== reviewContract.creation.branchId || !host.entryId || !host.callId || approval.sessionId !== host.sessionId || !approval.entryId || !approval.digest || !mutations.length) throw new VerificationReceiptError("REMEDIATION_BINDING_INVALID");
  for (const mutation of mutations) {
    const permitted = remediationContract.allowedMutationScope.paths.some((allowed) => allowed === mutation.path || (allowed.endsWith("/**") && mutation.path.startsWith(allowed.slice(0, -2))));
    if (!permitted || !remediationContract.allowedMutationScope.operations.includes(mutation.operation)) throw new VerificationReceiptError("REMEDIATION_SCOPE_INVALID");
  }
  const body = { schemaVersion: 1 as const, receiptId: randomUUID(), reviewContractDigest: canonicalDigest(reviewContract), remediationContractDigest: canonicalDigest(remediationContract), remediationContract, approval, host: { ...host }, evaluatedTreeDigest: snapshot.treeDigest!, policyDigest: reviewContract.policyDigest, mutations: mutations.map((mutation) => ({ ...mutation })) };
  const receipt = { ...body, digest: canonicalDigest(body) }; authorizedMutations.set(receipt, receipt.digest); return receipt;
}
export function validateAuthorizedMutation(receipt: AuthorizedMutationReceipt, contract: TaskContract, snapshot: WorkspaceSnapshot, mutation: AuthorizedMutation): boolean {
  const { digest, ...body } = receipt;
  return authorizedMutations.get(receipt) === digest && canonicalDigest(body) === digest && receipt.reviewContractDigest === canonicalDigest(contract) && receipt.policyDigest === contract.policyDigest && receipt.evaluatedTreeDigest === snapshot.treeDigest && receipt.mutations.some((item) => item.path === mutation.path && item.operation === mutation.operation);
}

/** Freshness is independent of success: a current failed run remains real counterevidence and must not be rerun merely to curate it. */
export function isVerificationReceiptCurrent(receipt: VerificationReceipt, contract: TaskContract, snapshot: WorkspaceSnapshot, options: ReceiptValidationOptions = {}): boolean {
  const checked = validateVerificationReceipt(receipt, contract, snapshot, options);
  const freshnessFailures: Record<string, true> = { HOST_VERIFICATION_RECEIPT_REQUIRED: true, FOREIGN_VERIFICATION_RECEIPT: true, COMMAND_NOT_APPROVED: true, STALE_VERIFICATION_RECEIPT: true, STALE_VERIFICATION_ASSET: true, VERIFICATION_ASSET_UNSAFE_OR_UNAVAILABLE: true };
  return !checked.reasons.some((reason) => freshnessFailures[reason]);
}
