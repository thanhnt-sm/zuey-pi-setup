import { canonicalDigest, freezeContractValue, isDigest } from "./task-contract-source";
import { readHostBranch } from "./host-history";
import { recoveryProgressDigest, createTaskRecoveryPolicy } from "./task-recovery";
import { referencedWorkspacePaths, taskArtifactAssociation } from "./evidence-artifacts";
import { isResearchReportPath } from "./evidence-collector";
import type { TaskEvidenceRecord } from "./task-evidence-runtime";
import type { ReviewSnapshot } from "./advisor-protocol";
import type { TaskRecoveryPlan, TaskReviewState, TaskVerificationTarget, TaskVerificationRuntimeOptions } from "./task-verification-types";
import type { RecoveryProgress } from "./task-recovery";

export function taskContextKey(context: unknown): string | undefined {
  const branch = readHostBranch(context); return branch ? `${branch.sessionId}|${branch.branchId}` : undefined;
}
export function taskReviewKey(context: unknown, record: TaskEvidenceRecord): string {
  return `${taskContextKey(context)}|${record.contract.contractId}|${record.contract.revisionId}|${record.contract.incarnationId}`;
}
export function taskReviewSnapshot(record: TaskEvidenceRecord): ReviewSnapshot {
  const treeDigest = record.snapshot.treeDigest;
  if (!isDigest(treeDigest)) throw new Error("review_evaluated_tree_required");
  return freezeContractValue({ contractDigest: canonicalDigest(record.contract), evidenceDigest: canonicalDigest(record.packetSet.manifest),
    treeDigest, testDigest: canonicalDigest(record.verificationReceipt ?? null), policyDigest: record.contract.policyDigest,
    parentDigest: canonicalDigest(record.contract.parentRequirements), childDigest: canonicalDigest(record.packetSet.manifest.packets),
    integrationDigest: canonicalDigest(record.packetSet.packets.flatMap(value => value.packet.integrationReceipts ?? [])) });
}

/** Only selected criterion/source/test/integration facts are progress; global tree timestamps and prose are not. */
export function taskRecoveryProgress(record: TaskEvidenceRecord): RecoveryProgress {
  const verification = record.verificationReceipt;
  const explicitPaths = new Set(referencedWorkspacePaths(record.provenance.cwd, [record.sourceContext.taskSource.text, ...record.contract.criteria.map(criterion => criterion.text)].join("\n")));
  const meaningfulArtifact = (path: string, content: string): boolean => !isResearchReportPath(path) || explicitPaths.has(path) || taskArtifactAssociation(path, content, record.contract.target.content).mandatory;
  const criterionEvidence = Object.fromEntries(record.contract.criteria.map(criterion => {
    const selected = record.packetSet.packets.filter(({ packet }) => packet.criteria.some(item => item.id === criterion.id));
    const sources = selected.flatMap(({ packet }) => packet.source.filter(source => !isResearchReportPath(source.path) ||
      explicitPaths.has(source.path) || packet.artifacts.some(artifact => artifact.path === source.path && artifact.required && meaningfulArtifact(artifact.path, artifact.content)))
      .map(source => ({ path: source.path, sha256: source.sha256, spans: source.spans?.map(span => ({ startLine: span.startLine, endLine: span.endLine, digest: span.digest })) })));
    const artifacts = selected.flatMap(({ packet }) => packet.artifacts.filter(artifact => artifact.required && artifact.criterionIds.includes(criterion.id) && meaningfulArtifact(artifact.path, artifact.content))
      .map(artifact => ({ path: artifact.path, sha256: artifact.sha256 })));
    const integration = selected.flatMap(({ packet }) => (packet.integrationReceipts ?? []).filter(receipt => record.contract.parentRequirements.some(requirement => requirement.parentContractId === receipt.parentContractId && requirement.criterionId === receipt.criterionId))
      .map(receipt => ({ parentContractId: receipt.parentContractId, criterionId: receipt.criterionId, evidenceDigest: receipt.evidenceDigest })));
    const test = verification?.criterionIds.includes(criterion.id) ? { commandId: verification.commandId,
      command: verification.command,
      testAssetsBefore: verification.testAssetsBefore.map(asset => ({ path: asset.path, sha256: asset.sha256 })).sort((left, right) => left.path.localeCompare(right.path)),
      testAssetsAfter: verification.testAssetsAfter.map(asset => ({ path: asset.path, sha256: asset.sha256 })).sort((left, right) => left.path.localeCompare(right.path)),
      result: { exitCode: verification.result.exitCode, signal: verification.result.signal ?? null, timedOut: verification.result.timedOut === true, aborted: verification.result.aborted === true } } : null;
    return [criterion.id, [canonicalDigest(criterion), canonicalDigest(sources), canonicalDigest(artifacts), canonicalDigest(integration), canonicalDigest(test)]];
  }));
  // Operational reports and ambient tree changes remain visible counterevidence/freshness facts;
  // they are not permission to repeat unchanged rejected semantics.
  return { contractDigest: canonicalDigest(record.contract), policyDigest: record.contract.policyDigest, criterionEvidence };
}
export function stateProgressDigest(record: TaskEvidenceRecord): string { return recoveryProgressDigest(taskRecoveryProgress(record)); }

export function reviewRecovery(state: TaskReviewState): TaskRecoveryPlan {
  const policy = createTaskRecoveryPolicy({ consumeAvailabilityChange: () => false, nativeCommitSucceeded: () => false, humanAmendmentValidated: () => false });
  const plan = policy.plan({ outcome: state.outcome, progress: taskRecoveryProgress(state.evidence), previous: state.attempt });
  const first = plan.assignments[0];
  const target = { task: state.contract.target.content, phase: state.contract.target.phase };
  return freezeContractValue({ ...plan, schemaVersion: 1, owner: first?.owner ?? "parent", action: first?.action ?? "Resolve this exact task review prerequisite.",
    report: JSON.stringify({ task: target, resultKind: state.outcome.status, reasons: "reasons" in state.outcome ? state.outcome.reasons : [],
      criterionIds: state.contract.criteria.map(criterion => criterion.id), policyDigest: state.snapshot.policyDigest,
      actualM: state.results.map(result => ({ verdict: result.verdict, probability: result.meetsCriteriaNoul, confidence: result.expertConfidence, metadata: result.metadata })),
      realAdvisorReceipt: state.receipt?.receiptId ?? null, sourceManifest: state.evidence.sourceManifest, assignments: plan.assignments }),
    unblockCondition: plan.releaseCondition,
    resumeCommand: `typesafe_review_task ${JSON.stringify(target)}`,
  });
}
export function matchingReview(states: ReadonlyMap<string, TaskReviewState>, options: TaskVerificationRuntimeOptions, context: unknown, target: TaskVerificationTarget): TaskReviewState | undefined {
  const contract = options.contracts.contractFor(context, target);
  const key = taskContextKey(context);
  return contract && key ? [...states.values()].find(state => state.contextKey === key && state.contract.contractId === contract.contractId && state.contract.revisionId === contract.revisionId && state.contract.incarnationId === contract.incarnationId) : undefined;
}
