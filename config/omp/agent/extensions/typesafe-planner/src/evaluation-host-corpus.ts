import { dirname, relative, resolve } from "node:path";
import { canonicalDigest, freezeContractValue } from "./task-contract-source";
import type { AtomicEvaluationInput } from "./atomic-evaluation";
import type { CorpusCase, Manifest } from "../tools/jev-paired-types";
import type { NativeArmRequest } from "../tools/jev-paired-host-protocol";
import { assertFrozenFiles, loadBundle, loadManifest, readBoundFile } from "../tools/jev-paired-files";
import { readOptionalHostJson } from "../tools/jev-paired-host-client";
import { readJournal } from "../tools/jev-paired-runner";
import { validateBundle } from "../tools/jev-paired-validation";
import { projectFrozenRunOwnership, projectNativePendingIndex, projectNativeArmRequest } from "../tools/jev-paired-inputs";
export interface OwnedEvaluationRun {run:string;protocolPath:string;manifest:Manifest}
export interface OwnedEvaluationCase extends OwnedEvaluationRun {request:NativeArmRequest;case:CorpusCase;input:AtomicEvaluationInput}
export async function loadOwnedEvaluationRun(workspace:string,run:string,protocolPath:string):Promise<OwnedEvaluationRun> {
  run = resolve(run); protocolPath = resolve(protocolPath);
  await readBoundFile(resolve(workspace),relative(resolve(workspace),resolve(run,"manifest.json")));
  await readBoundFile(resolve(workspace),relative(resolve(workspace),protocolPath));
  const manifest = await loadManifest(run),bundle = await loadBundle(protocolPath),validation = validateBundle(bundle);
  if (manifest.kind !== "model_benchmark" || bundle.digest !== manifest.frozen.digest || validation.errors.length || validation.pending.length) throw new Error("frozen_real_custodian_inputs_required");
  const registry = await readOptionalHostJson(dirname(run),`.frozen-${bundle.digest}.json`,projectFrozenRunOwnership);
  if (!registry || registry.runId !== manifest.runId || registry.run !== run || registry.bundleDigest !== bundle.digest) throw new Error("owned_frozen_run_registry_required");
  await assertFrozenFiles(dirname(protocolPath),bundle);
  return {run,protocolPath,manifest};
}
export async function loadOwnedEvaluationCase(workspace:string,run:string,requestId:string,knownProtocolPath?:string):Promise<OwnedEvaluationCase> {
  const pending = await readOptionalHostJson(resolve(run),"native-host/pending.json",projectNativePendingIndex);
  if (!pending || pending.requestId !== requestId || !/^[a-f0-9]{64}\.request\.json$/.test(pending.requestPath)) throw new Error("original_pending_native_request_required");
  const request = await readOptionalHostJson(resolve(run),`native-host/${pending.requestPath}`,projectNativeArmRequest);
  if (!request || request.schemaVersion !== 1 || request.requestId !== requestId || request.run !== resolve(run) || !request.nonce || knownProtocolPath && request.protocolPath !== resolve(knownProtocolPath)) throw new Error("native_request_binding_invalid");
  const owned = await loadOwnedEvaluationRun(workspace,run,request.protocolPath),manifest = owned.manifest;
  const journal = await readJournal(owned.run,manifest),first = manifest.schedule.find(s => !journal.episodes.some(e => e.id === s.id));
  const completed = journal.episodes.find(e => e.id === pending.episodeId);
  if ((!completed && (!first || first.id !== pending.episodeId)) || pending.episodeId !== `${request.caseId}:${request.arm}` || request.bundleDigest !== manifest.frozen.digest || request.runId !== manifest.runId) throw new Error("native_request_not_next_original_scheduled_arm");
  const c = manifest.frozen.cases.find(c => c.id === request.caseId),host = manifest.frozen.protocol.nativeHost;
  if (!c || request.inputDigest !== c.input.sha256 || !host || request.hostId !== host.hostId || request.hostKeyDigest !== host.publicKeyDigest) throw new Error("native_request_case_or_host_mismatch");
  const file = await readBoundFile(dirname(owned.protocolPath),c.input.path);
  if (file.sha256 !== c.input.sha256) throw new Error("frozen_case_changed");
  let raw:unknown; try { raw = JSON.parse(file.bytes.toString("utf8")); } catch { throw new Error("invalid_frozen_case_json"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("atomic" in raw) || !("macro" in raw) || !("advisorRequest" in raw)) throw new Error("real_atomic_macro_native_template_required");
  const input = freezeContractValue(raw) as AtomicEvaluationInput;
  if (canonicalDigest(input.macro.contract.criteria) !== canonicalDigest(input.atomic.criteria)) throw new Error("whole_original_criterion_manifest_required");
  return {...owned,request,case:c,input};
}
