import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalDigest } from "../src/task-contract-source";
import type { Manifest } from "./jev-paired-types";
import { assertFrozenFiles, readBoundFile, writeJson } from "./jev-paired-files";
import { readJournal, reportRun } from "./jev-paired-runner";
import { priceAttempt, validateReceipts } from "./jev-paired-accounting";
import { validateBundle } from "./jev-paired-validation";
import { hostFileId, verifyNativeHostEnvelope, type NativeArmRequest, type NativeBridgeAdvance, type NativeHostEnvelope } from "./jev-paired-host-protocol";
import { projectNativeArmRequest, projectNativeHostEnvelope, projectFrozenRunOwnership } from "./jev-paired-inputs";
export interface NativeRequestPaths { request:string; response:string; cancel:string }
export function nativeRequestPaths(run:string,episodeId:string):NativeRequestPaths {
  const id = hostFileId(episodeId); return {request:resolve(run,"native-host",`${id}.request.json`),response:resolve(run,"native-host",`${id}.response.json`),cancel:resolve(run,"native-host",`${id}.cancel.json`)};
}
export async function readOptionalHostJson<T>(root:string,path:string,parse:(value:unknown)=>T):Promise<T|null> {
  try { return parse(JSON.parse((await readBoundFile(root,path)).bytes.toString("utf8"))); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "FILE_MISSING") return null; if (error instanceof SyntaxError) throw new Error("invalid_native_bridge_json"); throw error; }
}
/** One finite control step. Never calls a model/native tool, polls, launches a daemon or accepts host modules. */
export async function advanceNativeBenchmark(run:string,protocolPath:string,manifest:Manifest):Promise<NativeBridgeAdvance> {
  const validation = validateBundle(manifest.frozen);
  if (validation.errors.length || validation.pending.length) return {status:"prerequisite_pending",instructions:[...validation.errors,...validation.pending].join(";")};
  if (manifest.kind !== "model_benchmark" || !manifest.frozen.protocol.nativeHost) throw new Error("real_frozen_native_host_required");
  await assertFrozenFiles(dirname(resolve(protocolPath)),manifest.frozen);
  const registry = await readOptionalHostJson(dirname(resolve(run)),`.frozen-${manifest.frozen.digest}.json`,projectFrozenRunOwnership);
  if (!registry || registry.runId !== manifest.runId || registry.run !== resolve(run) || registry.bundleDigest !== manifest.frozen.digest) throw new Error("original_frozen_run_ownership_required");
  await mkdir(resolve(run,"native-host"),{recursive:true}); const lockPath = resolve(run,"native-bridge.lock"),lock = await open(lockPath,"wx");
  try {
    const journal = await readJournal(run,manifest),completed = new Set(journal.episodes.map(e => e.id));
    if (journal.episodes.length) manifest.runtime = {startedAt:journal.episodes[0].admittedAt,activeElapsedMs:journal.episodes.reduce((sum,e) => sum+(e.latencyMs ?? 0),0)};
    for (const scheduled of manifest.schedule) {
      if (completed.has(scheduled.id)) continue;
      const c = manifest.frozen.cases.find(c => c.id === scheduled.caseId); if (!c) throw new Error("scheduled_case_missing");
      const paths = nativeRequestPaths(run,scheduled.id),relativeRequest = `native-host/${hostFileId(scheduled.id)}.request.json`;
      let request = await readOptionalHostJson(run,relativeRequest,projectNativeArmRequest);
      if (request && (request.runId !== manifest.runId || request.bundleDigest !== manifest.frozen.digest || request.caseId !== c.id || request.arm !== scheduled.arm || request.inputDigest !== c.input.sha256 || request.run !== resolve(run) || request.protocolPath !== resolve(protocolPath))) throw new Error("owned_native_request_cannot_be_replaced");
      const envelope = await readOptionalHostJson(run,`native-host/${hostFileId(scheduled.id)}.response.json`,projectNativeHostEnvelope);
      if (envelope) {
        if (!request) throw new Error("native_response_without_owned_request");
        const payload = verifyNativeHostEnvelope(envelope,request,manifest),errors = validateReceipts(payload.attempts,[payload.episode],manifest.runId);
        if (errors.length) throw new Error(`invalid_original_host_receipts:${errors.join(";")}`);
        if (payload.attempts.some(a => journal.attempts.some(old => old.receiptId === a.receiptId)) || payload.episode.attemptIds.some(id => !payload.attempts.some(a => a.receiptId === id))) throw new Error("native_paid_receipt_already_owned_or_missing");
        const event = {episode:payload.episode,attempts:payload.attempts},file = await open(resolve(run,"receipts.jsonl"),"a");
        try { await file.writeFile(JSON.stringify(event)+"\n"); await file.sync(); } finally { await file.close(); }
        journal.episodes.push(payload.episode); journal.attempts.push(...payload.attempts); completed.add(scheduled.id);
        const elapsed = journal.episodes.reduce((sum,e) => sum+(e.latencyMs ?? 0),0);
        manifest.runtime = {startedAt:journal.episodes[0].admittedAt,activeElapsedMs:elapsed}; manifest.interrupted = false;
        await writeJson(resolve(run,"manifest.json"),manifest); await reportRun(run,manifest,journal.episodes,journal.attempts);
        continue;
      }
      const limits = manifest.frozen.protocol.limits,priced = journal.attempts.map(a => priceAttempt(a,manifest.frozen.prices));
      if (limits.deadlineAt === null || limits.maxRunMs === null || limits.maxEpisodes === null || Date.now() >= Date.parse(limits.deadlineAt) || manifest.schedule.length > limits.maxEpisodes || (manifest.runtime?.activeElapsedMs ?? 0) >= limits.maxRunMs
        || journal.episodes.some(e => !e.accountingComplete) || priced.some(p => p.value === null) || priced.reduce((sum,p) => sum+(p.value ?? 0),0) >= (manifest.frozen.protocol.spend?.maximumUsd ?? 0)) {
        manifest.interrupted = true; await writeJson(resolve(run,"manifest.json"),manifest); await reportRun(run,manifest,journal.episodes,journal.attempts);
        return {status:"inconclusive",selection:"retain_repaired_M",instructions:"Original frozen quota/deadline/spend/accounting does not permit another admission. Reconcile only original receipts; do not resample observed provenance."};
      }
      if (!request) {
        const host = manifest.frozen.protocol.nativeHost;
        request = {schemaVersion:1,requestId:`native:${randomUUID()}`,nonce:randomUUID(),runId:manifest.runId,bundleDigest:manifest.frozen.digest,caseId:c.id,arm:scheduled.arm,inputDigest:c.input.sha256,protocolPath:resolve(protocolPath),run:resolve(run),createdAt:new Date().toISOString(),hostId:host.hostId,hostKeyDigest:host.publicKeyDigest};
        const file = await open(paths.request,"wx"); try { await file.writeFile(JSON.stringify(request)+"\n"); await file.sync(); } finally { await file.close(); }
      }
      await writeJson(resolve(run,"native-host/pending.json"),{schemaVersion:1,requestId:request.requestId,episodeId:scheduled.id,requestPath:`${hostFileId(scheduled.id)}.request.json`});
      return {status:"needs_native_dispatch",requestPath:paths.request,requestId:request.requestId,prepare:{tool:"typesafe_eval_host",action:"prepare",run:resolve(run),requestId:request.requestId},instructions:"In the same pinned real Root session, authorize this exact frozen run using typesafe_eval_host authorize, then prepare. Execute ONLY the returned real native task parameters. After settlement call typesafe_eval_host collect with this run/requestId; then repeat this original CLI benchmark command. Never fabricate/import a native receipt or redispatch a pending episode."};
    }
    const replay = await reportRun(run,manifest,journal.episodes,journal.attempts); manifest.status = replay.decision.measurementStatus;
    await writeJson(resolve(run,"manifest.json"),manifest);
    return {status:replay.decision.measurementStatus,selection:replay.decision.selection};
  } finally { await lock.close(); await unlink(lockPath); }
}
