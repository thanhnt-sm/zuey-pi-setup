import { resolve } from "node:path";
import type { Attempt, Episode, Manifest } from "./jev-paired-types";
import type { EvaluationJournal } from "./jev-paired-runner";
import { readBoundFile } from "./jev-paired-files";
import { hostFileId, verifyNativeHostEnvelope } from "./jev-paired-host-protocol";
import { projectNativeArmRequest, projectNativeHostEnvelope } from "./jev-paired-inputs";
/** Every actual report re-verifies original signed Root receipts; derived JSON/JSONL files are never authority. */
export async function readNativeReceiptJournal(run:string,manifest:Manifest):Promise<EvaluationJournal> {
  const episodes:Episode[] = [],attempts:Attempt[] = [],paid = new Set<string>(),native = new Set<string>(); let gap = false;
  for (const scheduled of manifest.schedule) {
    const id = hostFileId(scheduled.id); let rawEnvelope:unknown;
    try { rawEnvelope = JSON.parse((await readBoundFile(run,`native-host/${id}.response.json`)).bytes.toString("utf8")); }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "FILE_MISSING") {gap = true;continue;} if (error instanceof SyntaxError) throw new Error("invalid_original_native_receipt_json"); throw error; }
    if (gap) throw new Error("signed_native_schedule_gap_no_resampling");
    let rawRequest:unknown; try {rawRequest = JSON.parse((await readBoundFile(run,`native-host/${id}.request.json`)).bytes.toString("utf8"));} catch (error) {if (error instanceof SyntaxError) throw new Error("invalid_original_native_request_json");throw error;}
    const request = projectNativeArmRequest(rawRequest),payload = verifyNativeHostEnvelope(projectNativeHostEnvelope(rawEnvelope),request,manifest);
    if (request.run !== resolve(run)) throw new Error("native_original_run_path_mismatch");
    if (payload.episode.id !== scheduled.id || payload.caseId !== scheduled.caseId || payload.arm !== scheduled.arm) throw new Error("signed_native_schedule_mismatch");
    const proof = `${payload.native.sessionEpoch}:${payload.native.parentToolCallId}:${payload.native.itemIndex}:${payload.native.childId}:${payload.native.terminalDigest}`;
    if (native.has(proof)) throw new Error("cross_arm_actual_native_provenance_reuse"); native.add(proof);
    for (const attempt of payload.attempts) {if (paid.has(attempt.receiptId)) throw new Error("duplicate_actual_paid_attempt_receipt");paid.add(attempt.receiptId);attempts.push(attempt);}
    episodes.push(payload.episode);
  }
  return {episodes,attempts};
}
