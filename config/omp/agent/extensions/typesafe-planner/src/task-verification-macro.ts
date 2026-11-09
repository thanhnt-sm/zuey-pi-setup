import type { TaskContract } from "./types/verification";
import { createEvidenceStateValidator, type JudgeEvidencePacket } from "./judge-evidence-packet";
import { runPhaseMacroCheck, type MacroCheckResult } from "./cook-expert-judge";
import { canonicalDigest } from "./task-contract-source";
import { digestBytes } from "./evidence-workspace";
import type { TaskEvidenceRecord } from "./task-evidence-runtime";
import type { FrozenContractSourceContext } from "./contract-runtime";
import type { TaskVerificationRuntimeOptions } from "./task-verification-types";
import type { PreparedRequestValidator } from "./payload-safety";

export interface MonolithicReviewResult { packet?: JudgeEvidencePacket; result: MacroCheckResult }

/** M remains exactly one original-rubric task judgment, never an atomic/child-pass aggregate. */
export async function evaluateMonolithicTask(options: TaskVerificationRuntimeOptions, context: unknown, evidence: TaskEvidenceRecord, source: FrozenContractSourceContext, semanticAttemptCount: number): Promise<MonolithicReviewResult> {
  const contract = evidence.contract;
  const ids = contract.criteria.map(criterion => criterion.id).sort();
  const selected = evidence.packetSet.packets.filter(value => canonicalDigest(value.packet.criteria.map(criterion => criterion.id).sort()) === canonicalDigest(ids));
  if (!evidence.packetSet.ok || !evidence.packetSet.manifest.coverageComplete || selected.length !== 1) {
    const reasons = ["M requires exactly one authentic bounded packet covering every original task criterion. Provide explicit complete-task curation; otherwise an independent H benchmark/human adoption prerequisite is required, not silent atomic adoption."];
    return { result: { approved: false, reasons, outcome: { status: "EVIDENCE_REQUIRED", missingCriterionIds: ids, reasons }, error: "monolithic_packet_curation_required" } };
  }
  const packet = selected[0].packet;
  if (selected[0].digest !== canonicalDigest(packet)) throw new Error("monolithic_packet_identity_invalid");
  const state = buildMonolithicMacroState(contract, source, evidence, packet);
  if (state.overflow) {
    const reasons = ["The complete M task packet could not be delivered under its exact final-body policy. The proof exceeds the 32768-byte ceiling. Supply honest bounded curation with selections."];
    return { packet, result: { approved: false, reasons, outcome: { status: "EVIDENCE_REQUIRED", missingCriterionIds: ids, reasons }, error: "payload_too_large" } };
  }
  const guard: PreparedRequestValidator = createEvidenceStateValidator(state, options.privacy);
  const client = options.createClient(context, "native_done", guard);
  const result = await runPhaseMacroCheck({
    todoTask: contract.target.content, phaseTitle: contract.target.phase,
    planRequirements: contract.criteria.map(criterion => criterion.text), contract,
    diffSummary: evidence.evidence.gitStatus, unifiedDiff: packet.diff,
    testSummary: evidence.evidence.testOutput,
    taskType: contract.taskKind === "implementation" ? "code_change" : "analysis_research",
    userRequest: source.originalUserRequest.text,
    attemptCount: semanticAttemptCount,
  }, { async evaluate(request) { return client.evaluate({ state, questions: request.questions }); } }, { approvalPolicy: options.approvalPolicy });
  if (result.error && /(?:budget|packet|EVIDENCE_REQUIRED|too_large|payload|curation|question.*(?:limit|count|many)|body.*(?:limit|bytes))/i.test(result.error + " " + result.reasons.join(" "))) {
    const reasons = ["The complete M task packet could not be delivered under its exact final-body policy. Supply honest bounded curation or resolve the independent benchmark/human prerequisite; no clipping, summary, threshold change or H adoption is permitted."];
    return { packet, result: { ...result, approved: false, outcome: { status: "EVIDENCE_REQUIRED", missingCriterionIds: ids, reasons }, reasons } };
  }
  return { packet, result };
}
function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xC0) === 0x80) {
    end--;
  }
  if (end > 0) {
    const lead = buf[end];
    let seqLen = 1;
    if ((lead & 0xE0) === 0xC0) seqLen = 2;
    else if ((lead & 0xF0) === 0xE0) seqLen = 3;
    else if ((lead & 0xF8) === 0xF0) seqLen = 4;
    if (end + seqLen > maxBytes) {
      end = Math.max(0, end - 1);
      while (end > 0 && (buf[end] & 0xC0) === 0x80) end--;
    }
  }
  return buf.subarray(0, end).toString("utf8");
}

export function buildMonolithicMacroState(
  contract: TaskContract,
  source: FrozenContractSourceContext,
  evidence: TaskEvidenceRecord,
  packet: JudgeEvidencePacket,
  maxBytes: number = 32768
): Record<string, unknown> & { truncated: boolean; overflow: boolean } {
  let truncated = false;
  let overflow = false;

  // 1. Deduplicate nested evidence_packet: replace duplicate diff and artifacts with digest pointers
  const deduplicatedPacket = {
    ...packet,
    diff: `[Diff content mapped to state.unified_diff (sha256: ${digestBytes(packet.diff)}, bytes: ${Buffer.byteLength(packet.diff, "utf8")})]`,
    artifacts: packet.artifacts?.map(a => ({
      path: a.path,
      sha256: a.sha256,
      criterionIds: a.criterionIds,
      required: a.required,
      content: `[Artifact content mapped to state.deliverable_artifacts (sha256: ${a.sha256}, bytes: ${Buffer.byteLength(a.content, "utf8")})]`,
    })) ?? [],
  };

  let testExcerpt = "No test execution required for this task type.";
  if (evidence.evidence.testOutput) {
    const rawOut = evidence.evidence.testOutput;
    const outBytes = Buffer.byteLength(rawOut, "utf8");
    if (outBytes > 3000) {
      const fullSha = digestBytes(rawOut);
      testExcerpt = truncateToUtf8Bytes(rawOut, 3000) + `\n\n[TRUNCATED: shown 3000 of ${outBytes} bytes, full_sha256: ${fullSha}]`;
    } else {
      testExcerpt = rawOut;
    }
  } else if (evidence.verificationReceipt) {
    const rawReceiptOut = evidence.verificationReceipt.result.output || "";
    const receiptBytes = Buffer.byteLength(rawReceiptOut, "utf8");
    const exit = evidence.verificationReceipt.result.exitCode;
    if (receiptBytes > 2000) {
      const fullSha = digestBytes(rawReceiptOut);
      testExcerpt = `exitCode: ${exit}, output: ${truncateToUtf8Bytes(rawReceiptOut, 2000)}\n\n[TRUNCATED: shown 2000 of ${receiptBytes} bytes, full_sha256: ${fullSha}]`;
    } else {
      testExcerpt = `exitCode: ${exit}, output: ${rawReceiptOut}`;
    }
  }

  // Budget allocation: reserve ~14KB for diff and ~6KB for artifacts, leaving ~12KB for base state
  const MAX_DIFF_BYTES = 14000;
  const MAX_ARTIFACT_BYTES = 6000;

  let unifiedDiffText = packet.diff || "No code diff (research or unchanged task).";
  const diffBytes = Buffer.byteLength(unifiedDiffText, "utf8");
  if (diffBytes > MAX_DIFF_BYTES) {
    const fullSha = digestBytes(unifiedDiffText);
    const sliced = truncateToUtf8Bytes(unifiedDiffText, MAX_DIFF_BYTES);
    const shownBytes = Buffer.byteLength(sliced, "utf8");
    unifiedDiffText = sliced + `\n\n[TRUNCATED: shown ${shownBytes} of ${diffBytes} bytes, full_sha256: ${fullSha}]`;
    truncated = true;
  }

  let artifactsText = packet.artifacts?.length
    ? packet.artifacts.map(a => `[${a.path}]:\n${a.content}`).join("\n\n")
    : "No deliverable artifacts generated.";
  const artifactsBytes = Buffer.byteLength(artifactsText, "utf8");
  if (artifactsBytes > MAX_ARTIFACT_BYTES) {
    const fullSha = digestBytes(artifactsText);
    const sliced = truncateToUtf8Bytes(artifactsText, MAX_ARTIFACT_BYTES);
    const shownBytes = Buffer.byteLength(sliced, "utf8");
    artifactsText = sliced + `\n\n[TRUNCATED: shown ${shownBytes} of ${artifactsBytes} bytes, full_sha256: ${fullSha}]`;
    truncated = true;
  }

  const state = {
    todo_task: contract.target.content,
    task_requirements: contract.criteria.map(criterion => ({ id: criterion.id, text: criterion.text, source: criterion.source })),
    user_request: source.originalUserRequest.text,
    diff_scope: "Task-bound authentic endpoint evidence and retained full-source manifest; unrelated changes are not task deliverables.",
    diff_summary: evidence.evidence.changedFiles,
    unified_diff: unifiedDiffText,
    test_summary: testExcerpt,
    deliverable_artifacts: artifactsText,
    evidence_packet: deduplicatedPacket,
    evidence_manifest: evidence.packetSet.manifest,
    truncated,
    overflow,
  };

  const totalBytes = Buffer.byteLength(JSON.stringify(state), "utf8");
  if (totalBytes > maxBytes) {
    state.overflow = true;
  }

  return state;
}
