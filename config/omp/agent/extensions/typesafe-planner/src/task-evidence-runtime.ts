import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ContractRuntime, ContractTaskSelector, FrozenContractSourceContext } from "./contract-runtime";
import { readHostBranch, validateProjectToolInvocationJoin, type HostBranch } from "./host-history";
import { canonicalDigest } from "./task-contract";
import type { CreationProvenance, TaskContract } from "./types/verification";
import { captureWorkspaceSnapshot, collectTaskEvidence, isHostTaskEvidence, pathInScope, releaseWorkspaceSnapshot, statusEvidencePaths, type TaskEvidenceResult, type WorkspaceSnapshot } from "./evidence-collector";
import { collectVerificationReceipt, isVerificationReceiptCurrent, VerificationReceiptError, type ApprovedVerificationCommand, type VerificationReceipt } from "./verification-receipt";
import { buildJudgeEvidencePacketSet, retrieveEvidenceSource, type CriterionPacketSelection, type EvidenceArtifact, type EvidencePacketSetManifest, type JudgeEvidencePacketSetResult, type SourceRetrievalRequest, type SourceRetrievalResult } from "./judge-evidence-packet";
import { collectTaskArtifacts, referencedWorkspacePaths } from "./evidence-artifacts";
import type { ReviewSnapshot } from "./advisor-protocol";
import { gitBytes, type EvidenceOmission } from "./evidence-workspace";
import { isPrivateEvidencePath } from "./evidence-privacy";
import type { HostToolInvocation, HostToolInvocationRuntime } from "./host-tool-invocation";
export interface TaskVisualEvidence { imageBase64?: string; mimeType?: string }
export interface TaskEvidenceCollectParams extends ContractTaskSelector { commandId?: string; artifactPaths?: readonly string[]; selections?: readonly CriterionPacketSelection[] }
export function isUIFrontendPath(file: string): boolean {
  return /\.(?:css|tsx|vue|html|svg)$/i.test(file);
}
export function detectUIVisualEvidence(
  changedFiles: readonly string[],
  sourceEvidence?: readonly { path: string; sha256: string; content?: string; encoding: "utf8" | "base64" }[],
  snapshot?: WorkspaceSnapshot,
): TaskVisualEvidence | undefined {
  const hasUI = changedFiles.some(isUIFrontendPath);
  if (!hasUI || !sourceEvidence?.length) return undefined;
  const candidate = sourceEvidence.find((item) =>
    item.encoding === "base64" &&
    typeof item.content === "string" &&
    item.content.length > 0 &&
    /\.(?:png|jpe?g)$/i.test(item.path) &&
    (!snapshot || snapshot.files.get(item.path) === item.sha256)
  );
  if (!candidate) return undefined;
  const mimeType = /\.jpe?g$/i.test(candidate.path) ? "image/jpeg" : "image/png";
  return { imageBase64: candidate.content, mimeType };
}
export interface EvidenceBaselineOrigin { kind: "binding" | "first_collection"; capturedAt: string; snapshotId: string; historyCoverage: "from_capture_only" }
export interface TaskEvidenceProvenance extends CreationProvenance {
  toolName: "typesafe_collect_evidence"; cwd: string; contractDigest: string; sourceContextDigest: string;
  baselineOrigin: EvidenceBaselineOrigin; collectionCallIds: readonly string[]; commandPolicyDigest?: string; expiresOnScopeClear: true;
}
export interface TaskEvidenceSourceReference { path: string; sha256: string; bytes: number; cached: boolean }
export type TaskEvidenceCollectionStatus = "COLLECTED" | "CURATION_REQUIRED" | "EVIDENCE_REQUIRED" | "UNAVAILABLE";
export interface TaskEvidenceRecord {
  id: string; contract: TaskContract; baseline: WorkspaceSnapshot; evidence: TaskEvidenceResult;
  packetSet: JudgeEvidencePacketSetResult; artifacts: readonly EvidenceArtifact[]; verificationReceipt?: VerificationReceipt;
  snapshot: WorkspaceSnapshot; reviewSnapshot: ReviewSnapshot; provenance: TaskEvidenceProvenance;
  sourceContext: FrozenContractSourceContext; sourceManifest: EvidencePacketSetManifest; authorizedSources: readonly TaskEvidenceSourceReference[];
  visualEvidence?: TaskVisualEvidence;
  status: TaskEvidenceCollectionStatus; reasons: readonly string[];
}
export interface TaskEvidenceCollectionOutcome { status: TaskEvidenceCollectionStatus; record?: TaskEvidenceRecord; reasons: readonly string[] }
export interface TaskEvidenceRuntimeOptions { contracts: ContractRuntime; invocations: HostToolInvocationRuntime; commands: (contract: TaskContract, cwd: string) => ReadonlyMap<string, ApprovedVerificationCommand> }
export interface TaskEvidenceRuntime {
  collect(ctx: unknown, toolCallId: string, params: TaskEvidenceCollectParams): Promise<TaskEvidenceCollectionOutcome>;
  get(ctx: unknown, selector: ContractTaskSelector): TaskEvidenceRecord | undefined;
  isCurrent(ctx: unknown, record: TaskEvidenceRecord): Promise<boolean>;
  retrieve(ctx: unknown, record: TaskEvidenceRecord, request: SourceRetrievalRequest): SourceRetrievalResult;
  captureBaseline(ctx: unknown, contract: TaskContract): Promise<boolean>;
  clear(ctx: unknown): void;
}
interface RuntimeScope {
  sessionId: string; epoch: number; records: Map<string, TaskEvidenceRecord>;
  baselines: Map<string, { snapshot: WorkspaceSnapshot; origin: EvidenceBaselineOrigin }>;
  usedCalls: Set<string>; active: Set<string>; jobs: Map<string, AbortController>;
}
interface LiveContext { cwd: string; manager: object; branch: HostBranch }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function liveContext(ctx: unknown): LiveContext | undefined {
  if (!object(ctx) || typeof ctx.cwd !== "string" || !path.isAbsolute(ctx.cwd) || !object(ctx.sessionManager)) return undefined;
  const branch = readHostBranch(ctx); return branch ? { cwd: path.resolve(ctx.cwd), manager: ctx.sessionManager, branch } : undefined;
}
function commandDigest(command: ApprovedVerificationCommand, contract: TaskContract): string {
  return canonicalDigest({ ...command, cwd: path.resolve(command.cwd), artifactPaths: command.artifactPaths ?? [], timeoutMs: command.timeoutMs ?? 120000, kind: command.kind ?? (contract.taskKind === "implementation" ? "verification" : "diagnostic") });
}
function sourcePaths(cwd: string, context: FrozenContractSourceContext): { approved: string[]; initial: string[] } {
  const task = referencedWorkspacePaths(cwd, context.taskSource.text);
  const phase = context.parentSource ? referencedWorkspacePaths(cwd, context.parentSource.text) : [];
  const master = context.parentSource?.master ? referencedWorkspacePaths(cwd, context.parentSource.master.text) : [];
  const approved = [...new Set([...task, ...phase, ...master, ...(context.parentSource ? [context.parentSource.path] : [])])].filter((file) => pathInScope(file, context.readScope) && !isPrivateEvidencePath(file));
  return { approved, initial: (task.length ? task : phase).filter((file) => approved.includes(file)) };
}
/** Records are private host objects, not portable JSON proof or native-completion authorization. */
export function createTaskEvidenceRuntime(options: TaskEvidenceRuntimeOptions): TaskEvidenceRuntime {
  const scopes = new WeakMap<object, RuntimeScope>(); const owned = new WeakSet<TaskEvidenceRecord>();
  const invocationWitnesses = new WeakMap<TaskEvidenceRecord, HostToolInvocation>();
  const commandInvocations = new WeakMap<VerificationReceipt, HostToolInvocation>();
  function expire(scope: RuntimeScope): void {
    scope.epoch++;
    for (const controller of scope.jobs.values()) controller.abort();
    for (const record of scope.records.values()) { owned.delete(record); releaseWorkspaceSnapshot(record.snapshot, "retention_expired"); }
    for (const retained of scope.baselines.values()) releaseWorkspaceSnapshot(retained.snapshot, "retention_expired");
    scope.records.clear(); scope.baselines.clear();
  }
  function scopeFor(live: LiveContext): RuntimeScope {
    let scope = scopes.get(live.manager);
    if (!scope || scope.sessionId !== live.branch.sessionId) {
      if (scope) expire(scope);
      scope = { sessionId: live.branch.sessionId, epoch: 0, records: new Map(), baselines: new Map(), usedCalls: new Set(), active: new Set(), jobs: new Map() };
      scopes.set(live.manager, scope);
    }
    return scope;
  }
  function get(ctx: unknown, selector: ContractTaskSelector): TaskEvidenceRecord | undefined {
    const live = liveContext(ctx); if (!live) return undefined;
    const contract = options.contracts.contractFor(ctx, selector); if (!contract) return undefined;
    const value = scopeFor(live).records.get(contract.incarnationId);
    const witness = value && invocationWitnesses.get(value);
    if (!value || !witness || !owned.has(value) || value.provenance.cwd !== live.cwd || value.provenance.branchId !== live.branch.branchId || value.provenance.contractDigest !== canonicalDigest(contract) || witness.entryId !== value.provenance.entryId || !validateProjectToolInvocationJoin(live.branch, witness)) return undefined;
    return value;
  }
  async function isCorpusCurrent(ctx: unknown, record: TaskEvidenceRecord): Promise<boolean> {
    const live = liveContext(ctx); if (!live || !owned.has(record) || get(ctx, { task: record.contract.target.content, phase: record.contract.target.phase }) !== record || !isHostTaskEvidence(record.evidence)) return false;
    try {
      const source = options.contracts.sourceContext(record.contract);
      if (!source || canonicalDigest(source) !== record.provenance.sourceContextDigest || !options.contracts.validators(ctx).validateContract(record.contract)) return false;
      if (record.verificationReceipt) {
        const registered = options.commands(record.contract, live.cwd).get(record.verificationReceipt.commandId);
        if (!registered || commandDigest(registered, record.contract) !== record.provenance.commandPolicyDigest) return false;
      }
      const deadline = Date.now() + 5000;
      const current = await captureWorkspaceSnapshot(live.cwd, { contract: record.contract, nonGitPaths: record.snapshot.manifestPaths, timeoutMs: Math.max(1, deadline - Date.now()) });
      try {
        return current.complete === true && Date.now() < deadline && current.treeDigest === record.evidence.evaluatedTreeDigest && (!record.verificationReceipt || isVerificationReceiptCurrent(record.verificationReceipt, record.contract, current, { deadline }));
      } finally { releaseWorkspaceSnapshot(current, "operation_finished"); }
    } catch { return false; }
  }
  async function isCurrent(ctx: unknown, record: TaskEvidenceRecord): Promise<boolean> {
    const live = liveContext(ctx); const witness = invocationWitnesses.get(record);
    const command = record.verificationReceipt && commandInvocations.get(record.verificationReceipt);
    return !!live && !!witness && validateProjectToolInvocationJoin(live.branch, witness, true)
      && (!record.verificationReceipt || !!command && validateProjectToolInvocationJoin(live.branch, command, true))
      && await isCorpusCurrent(ctx, record);
  }
  async function captureBaseline(ctx: unknown, contract: TaskContract): Promise<boolean> {
    const live = liveContext(ctx); const context = options.contracts.sourceContext(contract);
    if (!live || !context || !options.contracts.validators(ctx).validateContract(contract) || canonicalDigest(options.contracts.contractFor(ctx, { task: contract.target.content, phase: contract.target.phase }) ?? null) !== canonicalDigest(contract)) return false;
    const scope = scopeFor(live); const key = contract.incarnationId;
    const existing = scope.baselines.get(key);
    if (existing?.snapshot.contractDigest === canonicalDigest(contract)) return true;
    if (scope.active.has(key)) return false;
    const controller = new AbortController(); const epoch = scope.epoch; scope.active.add(key); scope.jobs.set(key, controller);
    let snapshot: WorkspaceSnapshot | undefined;
    try {
      const paths = sourcePaths(live.cwd, context);
      snapshot = await captureWorkspaceSnapshot(live.cwd, { contract, signal: controller.signal, nonGitPaths: [...new Set([...paths.approved, ...contract.allowedMutationScope.paths.filter((name) => name !== "**")])] });
      const after = liveContext(ctx);
      if (!snapshot.complete || !after || after.branch.sessionId !== live.branch.sessionId || after.branch.branchId !== live.branch.branchId || scope.epoch !== epoch || controller.signal.aborted || !options.contracts.validators(ctx).validateContract(contract)) return false;
      scope.baselines.set(key, { snapshot, origin: { kind: "binding", capturedAt: snapshot.capturedAt ?? new Date().toISOString(), snapshotId: snapshot.snapshotId ?? "", historyCoverage: "from_capture_only" } });
      if (existing) releaseWorkspaceSnapshot(existing.snapshot, "retention_expired");
      snapshot = undefined; return true;
    } catch { return false; }
    finally { if (snapshot) releaseWorkspaceSnapshot(snapshot, "operation_finished"); scope.active.delete(key); scope.jobs.delete(key); }
  }
  async function collect(ctx: unknown, toolCallId: string, params: TaskEvidenceCollectParams): Promise<TaskEvidenceCollectionOutcome> {
    const unavailable = (reason: string): TaskEvidenceCollectionOutcome => ({ status: "UNAVAILABLE", reasons: [reason] });
    const live = liveContext(ctx); if (!live) return unavailable("ACTUAL_HOST_SESSION_CONTEXT_REQUIRED");
    if (!object(params) || typeof params.task !== "string" || !params.task.trim() || Object.keys(params).some((key) => !["task", "phase", "commandId", "artifactPaths", "selections"].includes(key)) || (params.artifactPaths && (!Array.isArray(params.artifactPaths) || params.artifactPaths.length > 128)) || (params.selections && (!Array.isArray(params.selections) || params.selections.length > 128))) return unavailable("EVIDENCE_PARAMETERS_INVALID");
    const call = options.invocations.current(ctx, "typesafe_collect_evidence", toolCallId, params);
    if (!call || !validateProjectToolInvocationJoin(live.branch, call) || live.branch.entries.some((entry) => entry.message?.role === "toolResult" && entry.message.toolCallId === toolCallId)) return unavailable("OWNED_PROJECT_EXECUTE_OBSERVATION_REQUIRED");
    const contract = options.contracts.contractFor(ctx, params); const context = contract && options.contracts.sourceContext(contract);
    if (!contract || !context || !options.contracts.validators(ctx).validateContract(contract)) return { status: "EVIDENCE_REQUIRED", reasons: ["APPROVED_TASK_CONTRACT_REQUIRED"] };
    const scope = scopeFor(live); const key = contract.incarnationId;
    if (scope.usedCalls.has(toolCallId) || scope.usedCalls.size >= 4096) return unavailable("PROJECT_EVIDENCE_CALL_REPLAY_OR_LIMIT");
    if (scope.active.has(key)) return unavailable("TASK_EVIDENCE_COLLECTION_IN_PROGRESS");
    scope.usedCalls.add(toolCallId); scope.active.add(key);
    const controller = new AbortController(); const epoch = scope.epoch; scope.jobs.set(key, controller);
    try {
      const paths = sourcePaths(live.cwd, context);
      const previous = get(ctx, params);
      const approved = [...new Set([...paths.approved, ...(previous?.evidence.sourceEvidence ?? []).filter((source) => pathInScope(source.path, context.readScope) && !isPrivateEvidencePath(source.path)).map((source) => source.path)])];
      const proposals = [...(params.artifactPaths ?? []), ...(params.selections ?? []).flatMap((selection) => selection.sources.map((source) => source.path))];
      if (proposals.some((file) => typeof file !== "string" || !pathInScope(file, context.readScope) || isPrivateEvidencePath(file))) return { status: "EVIDENCE_REQUIRED", reasons: ["SOURCE_OUTSIDE_PUBLIC_APPROVED_READ_SCOPE"] };
      const registered = options.commands(contract, live.cwd); const selectedCommand = params.commandId ? registered.get(params.commandId) : undefined;
      if (params.commandId && (!selectedCommand || !contract.approvedCommandIds.includes(params.commandId))) return { status: "EVIDENCE_REQUIRED", reasons: ["COMMAND_NOT_APPROVED"] };
      const current = previous ? await isCorpusCurrent(ctx, previous) : false;
      const mayReuse = current && (!params.commandId || (params.selections !== undefined && previous?.verificationReceipt?.commandId === params.commandId));
      const capturePaths = [...new Set([...(previous?.snapshot.manifestPaths ?? []), ...contract.allowedMutationScope.paths.filter((name) => name !== "**"), ...approved, ...proposals, ...(selectedCommand?.testAssetPaths ?? []), ...(selectedCommand?.artifactPaths ?? [])])];
      let retained = scope.baselines.get(key);
      if (retained && retained.snapshot.contractDigest !== canonicalDigest(contract)) {
        releaseWorkspaceSnapshot(retained.snapshot, "retention_expired"); scope.baselines.delete(key); retained = undefined;
      }
      if (!retained) {
        const snapshot = await captureWorkspaceSnapshot(live.cwd, { contract, signal: controller.signal, nonGitPaths: capturePaths });
        retained = { snapshot, origin: { kind: "first_collection", capturedAt: snapshot.capturedAt ?? new Date().toISOString(), snapshotId: snapshot.snapshotId ?? "", historyCoverage: "from_capture_only" } };
        if (scope.epoch !== epoch || controller.signal.aborted) { releaseWorkspaceSnapshot(snapshot, "retention_expired"); return unavailable("COLLECTION_SCOPE_INVALIDATED"); }
        scope.baselines.set(key, retained);
      }
      const baseline = retained.snapshot; const baselineOrigin = retained.origin;
      const collectionOmissions: EvidenceOmission[] = [];
      let verificationReceipt = current ? previous?.verificationReceipt : undefined;
      let executionPolicyDigest = current ? previous?.provenance.commandPolicyDigest : undefined;
      if (params.commandId && !mayReuse) {
        executionPolicyDigest = commandDigest(selectedCommand!, contract);
        try {
          verificationReceipt = await collectVerificationReceipt({ contract, commandId: params.commandId, commands: registered, cwd: live.cwd, workspacePaths: capturePaths, signal: controller.signal, host: { sessionId: live.branch.sessionId, branchId: live.branch.branchId, entryId: call.entryId, callId: toolCallId } });
          commandInvocations.set(verificationReceipt, call);
        } catch (failure) {
          collectionOmissions.push({ reason: failure instanceof VerificationReceiptError ? failure.code : "VERIFICATION_COLLECTION_UNAVAILABLE", kind: "unavailable", required: true });
          verificationReceipt = undefined;
        }
      }
      const requestedSources = params.selections?.flatMap((selection) => selection.sources.map((source) => source.path));
      const sourceNames = [...new Set(requestedSources ?? [...paths.initial, ...(params.artifactPaths ?? [])])];
      const canUseCorpus = mayReuse && previous && sourceNames.every((name) => previous.evidence.sourceEvidence?.some((source) => source.path === name));
      const collectSources = (names: readonly string[]) => collectTaskEvidence({ cwd: live.cwd, contract, baseline, verificationReceipt, signal: controller.signal, sourcePaths: names, readScopePaths: context.readScope, nonGitPaths: verificationReceipt?.workspacePaths ?? capturePaths, provenanceLimitations: [baselineOrigin.kind === "first_collection" ? "BASELINE_CAPTURED_AT_FIRST_COLLECTION: no earlier task preimage or commit attribution is asserted." : "BASELINE_CAPTURED_AT_BINDING: task attribution covers changes after this host capture only; earlier task mutations are not asserted."] });
      let evidence = canUseCorpus ? previous.evidence : await collectSources(sourceNames);
      if (!evidence.snapshot || typeof evidence.snapshot.treeDigest !== "string") return unavailable("COLLECTED_SOURCE_SNAPSHOT_REQUIRED");
      const currentCandidatePaths = [...paths.initial];
      if (evidence.snapshot.mode === "git" && evidence.snapshot.complete) {
        try { currentCandidatePaths.push(...statusEvidencePaths(gitBytes(live.cwd, ["status", "--porcelain", "-uall"], 5000).toString("utf8"))); }
        catch { collectionOmissions.push({ reason: "CURRENT_ARTIFACT_DISCOVERY_UNAVAILABLE", kind: "unavailable", required: true }); }
      }
      const artifactPaths = [...new Set([...(previous?.artifacts.filter((artifact) => artifact.required).map((artifact) => artifact.path) ?? []), ...(params.artifactPaths ?? [])])];
      let reports = collectTaskArtifacts({ cwd: live.cwd, contract, evidence, readScope: context.readScope, requestedPaths: artifactPaths, currentCandidatePaths });
      if (reports.artifacts.some((artifact) => !evidence.sourceEvidence?.some((source) => source.path === artifact.path))) {
        const firstEvidence = evidence;
        evidence = await collectSources([...new Set([...sourceNames, ...(evidence.sourceEvidence ?? []).map((source) => source.path), ...reports.artifacts.map((artifact) => artifact.path)])]);
        if (!evidence.snapshot || typeof evidence.snapshot.treeDigest !== "string") return unavailable("COLLECTED_SOURCE_SNAPSHOT_REQUIRED");
        reports = collectTaskArtifacts({ cwd: live.cwd, contract, evidence, readScope: context.readScope, requestedPaths: artifactPaths, currentCandidatePaths });
        if (firstEvidence !== previous?.evidence && firstEvidence.snapshot) releaseWorkspaceSnapshot(firstEvidence.snapshot, "operation_finished");
      }
      reports.omissions.push(...collectionOmissions);
      const snapshot = evidence.snapshot;
      if (!snapshot || typeof snapshot.treeDigest !== "string") return unavailable("COLLECTED_SOURCE_SNAPSHOT_REQUIRED");
      const visualEvidence = detectUIVisualEvidence(evidence.changedFiles, evidence.sourceEvidence, snapshot);
      const packetSet = buildJudgeEvidencePacketSet({
        contract, evidence, artifacts: reports.artifacts, requiredArtifactPaths: reports.requiredPaths,
        artifactOmissions: reports.omissions, selections: params.selections,
        artifactSelection: { requiredPaths: reports.requiredPaths, outOfPacketScope: reports.outOfPacketScope, acceptedBytes: reports.artifacts.reduce((total, artifact) => total + Buffer.byteLength(artifact.content, "utf8"), 0), maxBytes: 4940 },
        visualEvidence,
      });
      const reasons = [...new Set([...reports.omissions.map((omission) => omission.reason), ...(evidence.omissions ?? []).filter((omission) => omission.required).map((omission) => omission.reason), ...packetSet.reasons])];
      const sourceProof = (evidence.sourceEvidence?.length ?? 0) > 0 || reports.artifacts.length > 0 || evidence.gitDiff.length > 0;
      if (!sourceProof) reasons.push("TASK_SOURCE_PROOF_REQUIRED");
      const completeSingleTask = packetSet.packets.length === 1 && canonicalDigest(packetSet.packets[0].packet.criteria.map((criterion) => criterion.id)) === canonicalDigest(contract.criteria.map((criterion) => criterion.id));
      if (!completeSingleTask) reasons.push("ONE_COMPLETE_ORIGINAL_TASK_PACKET_REQUIRED");
      const status: TaskEvidenceCollectionStatus = evidence.evidenceStatus === "EVIDENCE_REQUIRED" || reports.omissions.some((omission) => omission.required) ? "EVIDENCE_REQUIRED" : !packetSet.ok || !sourceProof || !completeSingleTask ? "CURATION_REQUIRED" : "COLLECTED";
      const sourceManifest = packetSet.manifest;
      const value: TaskEvidenceRecord = {
        id: randomUUID(), contract, baseline, evidence, packetSet, artifacts: reports.artifacts, verificationReceipt, snapshot,
        reviewSnapshot: { contractDigest: canonicalDigest(contract), evidenceDigest: sourceManifest.evidenceDigest, treeDigest: snapshot.treeDigest, testDigest: canonicalDigest(verificationReceipt ?? null), policyDigest: contract.policyDigest, parentDigest: canonicalDigest(contract.parentRequirements), childDigest: canonicalDigest([]), integrationDigest: canonicalDigest([]) },
        sourceContext: context, sourceManifest, visualEvidence,
        authorizedSources: [...snapshot.files.keys()]
          .filter((file) => pathInScope(file, context.readScope) && !isPrivateEvidencePath(file) && !evidence.sourceEvidence?.some((source) => source.path === file && source.encoding === "base64"))
          .flatMap((file) => {
            const sha256 = snapshot.files.get(file); const identity = snapshot.fileIdentities?.[file];
            return sha256 && sha256 !== "<deleted>" && identity ? [{ path: file, sha256, bytes: Number(identity.size), cached: !!evidence.sourceEvidence?.some((source) => source.path === file) }] : [];
          }),
        provenance: { sessionId: live.branch.sessionId, branchId: live.branch.branchId, entryId: call.entryId, callId: toolCallId, toolName: "typesafe_collect_evidence", cwd: live.cwd, contractDigest: canonicalDigest(contract), sourceContextDigest: canonicalDigest(context), baselineOrigin, collectionCallIds: [...(previous?.provenance.collectionCallIds ?? []), toolCallId], commandPolicyDigest: executionPolicyDigest, expiresOnScopeClear: true }, status, reasons,
      };
      const finalContext = liveContext(ctx); const finalContract = options.contracts.contractFor(ctx, params);
      if (scope.epoch !== epoch || controller.signal.aborted || !finalContext || finalContext.branch.sessionId !== live.branch.sessionId || finalContext.branch.branchId !== live.branch.branchId || options.invocations.current(ctx, "typesafe_collect_evidence", toolCallId, params)?.nonce !== call.nonce || !validateProjectToolInvocationJoin(finalContext.branch, call) || !finalContract || canonicalDigest(finalContract) !== canonicalDigest(contract) || !options.contracts.validators(ctx).validateContract(finalContract)) return unavailable("COLLECTION_SCOPE_OR_CONTRACT_CHANGED");
      const superseded = scope.records.get(key);
      if (superseded) {
        owned.delete(superseded);
        if (superseded.snapshot !== snapshot && superseded.snapshot !== baseline) releaseWorkspaceSnapshot(superseded.snapshot, "retention_expired");
      }
      invocationWitnesses.set(value, call); owned.add(value); scope.records.set(key, value); return { status, record: value, reasons };
    } catch { return { status: "UNAVAILABLE", reasons: ["EVIDENCE_COLLECTION_UNAVAILABLE"] }; }
    finally { scope.active.delete(key); scope.jobs.delete(key); }
  }
  function retrieve(ctx: unknown, record: TaskEvidenceRecord, request: SourceRetrievalRequest): SourceRetrievalResult {
    if (get(ctx, { task: record.contract.target.content, phase: record.contract.target.phase }) !== record || !record.authorizedSources.some((source) => source.path === request.path && source.sha256 === request.fullFileDigest)) return { ok: false, status: "EVIDENCE_REQUIRED", reason: "TASK_SOURCE_RETRIEVAL_NOT_AUTHORIZED" };
    return retrieveEvidenceSource(record.evidence, request);
  }
  function clear(ctx: unknown): void {
    const live = liveContext(ctx); if (!live) return; const scope = scopes.get(live.manager); if (!scope) return;
    expire(scope);
  }
  return { collect, get, isCurrent, retrieve, captureBaseline, clear };
}
