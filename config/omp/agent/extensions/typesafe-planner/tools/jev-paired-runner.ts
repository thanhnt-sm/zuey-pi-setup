import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { Attempt, Episode, EvaluationDriver, EvaluationDriverResult, FrozenBundle, Manifest } from "./jev-paired-types";
import { digest, validateBundle, schedulePairs } from "./jev-paired-validation";
import { assertFrozenFiles, readBoundFile, writeJson, loadManifest } from "./jev-paired-files";
import { decide } from "./jev-paired-metrics";
import { priceAttempt } from "./jev-paired-accounting";
import { freezeContractValue } from "../src/task-contract-source";
import { projectAttempt, projectEpisode } from "./jev-paired-inputs";
import { readNativeReceiptJournal } from "./jev-paired-host-journal";
export async function freezeBundle(bundle: FrozenBundle, runId: string, run: string): Promise<Manifest> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(runId)) throw new Error("invalid_run_id");
  const frozen = freezeContractValue(structuredClone(bundle));
  if (digest(JSON.stringify({...frozen,digest:""})) !== frozen.digest) throw new Error("unfrozen_or_changed_input_bundle");
  const validation = validateBundle(frozen);
  if (validation.errors.length) throw new Error(validation.errors.join(";"));
  const registryPath = resolve(dirname(run),`.frozen-${frozen.digest}.json`);
  try {
    const registry = await open(registryPath,"wx");
    try { await registry.writeFile(JSON.stringify({runId,run:resolve(run),bundleDigest:frozen.digest})+"\n"); await registry.sync(); } finally { await registry.close(); }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    const existing = JSON.parse(await readFile(registryPath,"utf8")) as { runId:string; run:string; bundleDigest:string };
    if (existing.runId !== runId || existing.run !== resolve(run) || existing.bundleDigest !== frozen.digest) throw new Error("frozen_cohort_already_owned_by_another_run_no_resampling");
    return loadManifest(run);
  }
  await mkdir(run,{ recursive:false });
  const manifest:Manifest = {schemaVersion:1,runId,kind:frozen.protocol.kind,frozen,schedule:freezeContractValue(schedulePairs(frozen)),createdAt:new Date().toISOString(),status:validation.pending.length ? "prerequisite_pending" : "inconclusive",pendingInputs:structuredClone(frozen.protocol.pendingInputs),interrupted:false};
  await writeJson(resolve(run,"manifest.json"),manifest);
  return manifest;
}
interface JournalEvent { episode: Episode; attempts: Attempt[] }
export interface EvaluationJournal {episodes:Episode[];attempts:Attempt[]}
export async function readJournal(run:string,manifest?:Manifest):Promise<EvaluationJournal> {
  const source = manifest ?? await loadManifest(run);
  if (source.kind === "model_benchmark") return readNativeReceiptJournal(run,source);
  let text: string;
  try { text = await readFile(resolve(run,"receipts.jsonl"),"utf8"); } catch (e) { if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return { episodes:[],attempts:[] }; throw e; }
  // A torn final write is not silently discarded: dispatch ownership would become uncertain.
  const events = text.split("\n").filter(Boolean).map(line => {
    const raw:unknown = JSON.parse(line);
    if (!raw || typeof raw !== "object" || !("episode" in raw) || !("attempts" in raw) || !Array.isArray(raw.attempts)) throw new Error("invalid_original_receipt_journal");
    return {episode:projectEpisode(raw.episode),attempts:raw.attempts.map(projectAttempt)};
  });
  const ids = new Set<string>(), attempts = new Map<string,Attempt>(), episodes: Episode[] = [];
  for (const event of events) {
    if (ids.has(event.episode.id)) throw new Error(`duplicate_terminal_journal_receipt:${event.episode.id}`);
    ids.add(event.episode.id); episodes.push(event.episode);
    for (const a of event.attempts) { if (attempts.has(a.receiptId)) throw new Error(`duplicate_attempt_journal_receipt:${a.receiptId}`); attempts.set(a.receiptId,a); }
  }
  return { episodes,attempts:[...attempts.values()] };
}
export async function reportRun(run: string, manifest: Manifest, episodes: Episode[], attempts: Attempt[]) {
  const result = decide(manifest,episodes,attempts);
  await writeJson(resolve(run,"attempts.json"),attempts);
  await writeJson(resolve(run,"case-results.json"),episodes);
  await writeJson(resolve(run,"coverage.json"),{ modelBenchmark:manifest.kind === "model_benchmark",scenarioCoverage:manifest.frozen.protocol.scenarioCoverage,scheduled:manifest.schedule.length,terminal:episodes.filter(e => e.status === "terminal").length });
  await writeJson(resolve(run,"metrics.json"),result.metrics);
  await writeJson(resolve(run,"decision.json"),result.decision);
  await writeJson(resolve(run,"report.json"),{ ...result,notice:manifest.kind === "deterministic_fixture" ? "Deterministic fixtures only; not a model benchmark; zero model-benchmark observations." : episodes.length ? "Actual frozen shadow execution receipts only; not deployment authority or production completed-task economics." : "No model benchmark has run. This is an unfinished prerequisite/incomplete lane, not observed superiority or completed-task economics.",pendingInputs:manifest.pendingInputs,resume:{ command:`bun tools/jev-paired-eval.ts benchmark --protocol <frozen-protocol-path> --run-id ${manifest.runId}`,requirements:"Exact frozen files, trusted spend/data authorization, genuine native Advisor host, original all-attempt receipts and known resume timing (or explicit missing timing). Never rerun terminal receipts." } });
  return result;
}
export interface BenchmarkAuthority {
  readonly authorize:(bundle:FrozenBundle) => Promise<{ allowed:boolean; reason:string }>; readonly driver:EvaluationDriver;
}
async function withCancellation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("cancelled_unsettled_dispatch_requires_exact_receipt_recovery");
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([work,new Promise<never>((_,reject) => {
      cancel = () => reject(new Error("cancelled_unsettled_dispatch_requires_exact_receipt_recovery"));
      signal.addEventListener("abort",cancel,{ once:true });
    })]);
  } finally { if (cancel) signal.removeEventListener("abort",cancel); }
}
export async function benchmarkRun(run: string, root: string, manifest: Manifest, authority: BenchmarkAuthority, signal?: AbortSignal) {
  if (manifest.kind === "model_benchmark") throw new Error("actual_model_runs_require_resumable_protected_native_host_bridge");
  const validation = validateBundle(manifest.frozen);
  if (validation.errors.length || validation.pending.length) {
    const old = await readJournal(run); return reportRun(run,manifest,old.episodes,old.attempts);
  }
  const ownership = JSON.parse(await readFile(resolve(dirname(run),`.frozen-${manifest.frozen.digest}.json`),"utf8")) as {runId:string;run:string;bundleDigest:string};
  if (ownership.runId !== manifest.runId || ownership.run !== resolve(run) || ownership.bundleDigest !== manifest.frozen.digest) throw new Error("inference_requires_original_owned_frozen_run_no_resampling");
  const approval = await authority.authorize(manifest.frozen);
  if (!approval.allowed) {
    manifest.pendingInputs.push({ owner:"trusted spend/data authority",action:approval.reason,releaseCondition:"Host independently verifies exact frozen scope and bounded paid dispatch authorization." });
    manifest.status = "prerequisite_pending";
    await writeJson(resolve(run,"manifest.json"),manifest);
    const old = await readJournal(run); return reportRun(run,manifest,old.episodes,old.attempts);
  }
  await assertFrozenFiles(root,manifest.frozen);
  const expected = schedulePairs(manifest.frozen);
  if (JSON.stringify(expected) !== JSON.stringify(manifest.schedule)) throw new Error("frozen_schedule_changed");
  const {maxEpisodes,maxRunMs,deadlineAt} = manifest.frozen.protocol.limits;
  if (maxEpisodes === null || maxRunMs === null || deadlineAt === null) throw new Error("custodian_experiment_quota_and_deadline_required");
  if (manifest.schedule.length > maxEpisodes) throw new Error("custodian_scheduled_episode_quota_exceeded");
  const old = await readJournal(run), episodes = old.episodes, attempts = old.attempts;
  const lockPath = resolve(run,"benchmark.lock"), lock = await open(lockPath,"wx");
  let releaseLock:(() => void) | undefined;
  const lockReleased = new Promise<void>(resolve => { releaseLock = resolve; });
  const controller = new AbortController(), cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort",cancel,{ once:true }); if (signal?.aborted) cancel();
  const priorActive = manifest.runtime?.activeElapsedMs ?? 0, admittedClock = performance.now();
  const remaining = Math.min(maxRunMs-priorActive,Date.parse(deadlineAt)-Date.now());
  function expireRun():void {
    const left = remaining-(performance.now()-admittedClock);
    if (left <= 0) controller.abort(new Error("custodian_run_deadline"));
    else timer = setTimeout(expireRun,Math.min(left,2147483647));
  }
  let timer = setTimeout(expireRun,Math.max(1,Math.min(remaining,2147483647)));
  let admittedEpisodeId:string|null = null;
  try {
    await lock.writeFile(JSON.stringify({runId:manifest.runId,pid:process.pid,bundleDigest:manifest.frozen.digest,createdAt:new Date().toISOString()})+"\n");
    await lock.sync();
    // An admitted episode without a durable terminal receipt cannot be resampled safely.
    const admissionPath = resolve(run,"admitted.json");
    try { const pending = JSON.parse(await readFile(admissionPath,"utf8")) as { id:string }; if (!episodes.some(e => e.id === pending.id)) { admittedEpisodeId = pending.id; throw new Error(`unsettled_dispatch_requires_exact_receipt_recovery:${pending.id}`); } } catch (e) { if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e; }
    manifest.interrupted = false;
    if (priorActive >= maxRunMs || remaining <= 0) throw new Error("custodian_experiment_runtime_or_absolute_deadline_exhausted");
    manifest.runtime = {activeElapsedMs:priorActive,startedAt:manifest.runtime?.startedAt ?? new Date().toISOString()};
    await writeJson(resolve(run,"manifest.json"),manifest);
    for (const s of manifest.schedule) {
      if (episodes.some(e => e.id === s.id)) continue;
      if (controller.signal.aborted) { manifest.interrupted = true; break; }
      const priced = attempts.map(a => priceAttempt(a,manifest.frozen.prices)),unknownCost = episodes.some(e => !e.accountingComplete) || priced.some(p => p.value === null);
      if (unknownCost || priced.reduce((sum,p) => sum+(p.value ?? 0),0) >= (manifest.frozen.protocol.spend?.maximumUsd ?? Infinity)) {
        manifest.interrupted = true;
        manifest.pendingInputs.push({owner:"trusted accounting/spend custodian",action:unknownCost ? "Original paid attempt usage/model/price accounting is unavailable; no further paid admissions." : "The frozen approved spend budget is exhausted; no further paid admissions.",releaseCondition:"Reconcile only original authoritative receipts without replacing outcomes; exhausted approval cannot be enlarged after observed outputs. Report this cohort, or preregister a new independent cohort."});
        break;
      }
      const episodeAdmittedAt = new Date().toISOString(),episodeClock = performance.now();
      const c = manifest.frozen.cases.find(c => c.id === s.caseId);
      if (!c) throw new Error("scheduled_case_missing");
      const inputFile = await readBoundFile(root,c.input.path);
      if (inputFile.sha256 !== c.input.sha256) throw new Error(`frozen_input_changed_before_dispatch:${c.id}`);
      const input = freezeContractValue(JSON.parse(inputFile.bytes.toString("utf8")));
      if (controller.signal.aborted) { manifest.interrupted = true; break; }
      await writeJson(admissionPath,{id:s.id,admittedAt:episodeAdmittedAt,bundleDigest:manifest.frozen.digest});
      admittedEpisodeId = s.id;
      const finalizeEpisode = (result:EvaluationDriverResult):Episode => {
        const terminal = new Date().toISOString(),elapsed = performance.now()-episodeClock;
        return projectEpisode({...result.episode,id:s.id,caseId:c.id,arm:s.arm,admittedAt:episodeAdmittedAt,terminalAt:terminal,latencyMs:elapsed,timingSegments:[{start:episodeAdmittedAt,end:terminal,elapsedMs:elapsed}],completionEvent:null});
      };
      const evaluation = authority.driver.evaluate(s.arm,input,{mode:"shadow",allowMutation:false,allowAuthorityReuse:false,signal:controller.signal,runId:manifest.runId,caseId:c.id,parentId:c.parentId});
      let result:EvaluationDriverResult;
      try { result = await withCancellation(evaluation,controller.signal); }
      catch (error) {
        // Preserve only the already-admitted result if it settles after cancellation; never dispatch a replacement.
        void evaluation.then(async original => {
          const receipt = {episode:finalizeEpisode(original),attempts:original.attempts.map(projectAttempt)};
          if (manifest.runtime) manifest.runtime.activeElapsedMs = Math.max(manifest.runtime.activeElapsedMs,priorActive+performance.now()-admittedClock);
          await writeJson(resolve(run,`original-${digest(s.id)}.json`),receipt);
          await lockReleased;
          await recoverAdmittedEpisode(run,manifest,receipt,async original => JSON.stringify(original) === JSON.stringify(receipt));
        }).catch(async lateError => {
          try { await writeJson(resolve(run,"recovery-status.json"),{status:"original_receipt_recovery_required",episodeId:s.id,error:lateError instanceof SyntaxError ? "invalid_json_document" : lateError instanceof Error ? lateError.message : String(lateError)}); }
          catch (persistenceError) { console.error("Original paid receipt persistence unavailable; retain repaired M and recover the original provider/native receipts.",persistenceError); }
        });
        throw error;
      }
      const episode = finalizeEpisode(result);
      const event: JournalEvent = { episode,attempts:result.attempts.map(projectAttempt) };
      const journal = await open(resolve(run,"receipts.jsonl"),"a");
      try { await journal.writeFile(JSON.stringify(event)+"\n"); await journal.sync(); } finally { await journal.close(); }
      episodes.push(episode); attempts.push(...event.attempts); admittedEpisodeId = null;
      manifest.runtime.activeElapsedMs = priorActive+performance.now()-admittedClock;
      await writeJson(resolve(run,"manifest.json"),manifest);
    }
  } catch (error) {
    manifest.interrupted = true;
    const reason = error instanceof SyntaxError ? "invalid_json_document" : error instanceof Error ? error.message : String(error);
    manifest.pendingInputs.push(admittedEpisodeId
      ? {owner:"trusted original native/provider receipt custodian",action:reason,releaseCondition:"Recover the exact original admitted episode and every paid attempt through recoverAdmittedEpisode; no replacement inference for that episode."}
      : {owner:"trusted experiment custodian",action:reason,releaseCondition:"Inspect the original run and restore exact frozen inputs if needed. Resume that same run only while its frozen deadline, quota and spend remain valid; exhausted bounds require reporting, not resampling observed provenance."});
  }
  finally {
    clearTimeout(timer); signal?.removeEventListener("abort",cancel);
    if (manifest.runtime) manifest.runtime.activeElapsedMs = priorActive+performance.now()-admittedClock;
    manifest.status = "inconclusive";
    manifest.status = decide(manifest,episodes,attempts).decision.measurementStatus;
    try { await writeJson(resolve(run,"manifest.json"),manifest); await reportRun(run,manifest,episodes,attempts); }
    finally { try { await lock.close(); await unlink(lockPath); } finally { releaseLock?.(); } }
  }
  return reportRun(run,manifest,episodes,attempts);
}

/** Recovery consumes the exact original host receipt, including any known pause timing; unknown elapsed time stays null. It never invokes an arm or samples a replacement. */
export interface RecoveredEpisodeReceipt { episode:Episode; attempts:Attempt[] }
export async function recoverAdmittedEpisode(
  run: string, manifest: Manifest, original: RecoveredEpisodeReceipt,
  verifyOriginal: (receipt: RecoveredEpisodeReceipt, bundleDigest: string) => Promise<boolean>,
): Promise<void> {
  original = {episode:projectEpisode(original.episode),attempts:original.attempts.map(projectAttempt)};
  const admitted = JSON.parse(await readFile(resolve(run,"admitted.json"),"utf8")) as { id:string; bundleDigest:string; admittedAt:string };
  const s = manifest.schedule.find(s => s.id === admitted.id);
  if (!s || admitted.bundleDigest !== manifest.frozen.digest || original.episode.id !== s.id || original.episode.caseId !== s.caseId || original.episode.arm !== s.arm
    || original.episode.admittedAt !== admitted.admittedAt || !await verifyOriginal(original,manifest.frozen.digest)) throw new Error("original_admitted_receipt_verification_required");
  const lockPath = resolve(run,"benchmark.lock"), lock = await open(lockPath,"wx");
  try {
    const old = await readJournal(run), existing = old.episodes.find(e => e.id === s.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(original.episode)) throw new Error("completed_receipt_cannot_be_replaced");
      return;
    }
    const ids = new Set(old.attempts.map(a => a.receiptId));
    if (original.attempts.some(a => ids.has(a.receiptId))) throw new Error("recovered_attempt_already_owned");
    const recoveredIds = new Set(original.attempts.map(a => a.receiptId));
    if (recoveredIds.size !== original.attempts.length || new Set(original.episode.attemptIds).size !== original.episode.attemptIds.length
      || original.episode.attemptIds.length !== recoveredIds.size || original.episode.attemptIds.some(id => !recoveredIds.has(id))
      || original.attempts.some(a => a.runId !== manifest.runId || a.caseId !== s.caseId || a.arm !== s.arm)) throw new Error("recovered_attempt_ownership_mismatch");
    const journal = await open(resolve(run,"receipts.jsonl"),"a");
    try { await journal.writeFile(JSON.stringify(original)+"\n"); await journal.sync(); } finally { await journal.close(); }
    manifest.interrupted = false;
    manifest.pendingInputs = manifest.pendingInputs.filter(p => p.owner !== "trusted original native/provider receipt custodian");
    await writeJson(resolve(run,"manifest.json"),manifest);
    await reportRun(run,manifest,[...old.episodes,original.episode],[...old.attempts,...original.attempts]);
  } finally { await lock.close(); await unlink(lockPath); }
}
