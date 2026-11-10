import { readFile, mkdir, open, unlink, rename } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { readWorkspaceFile, type WorkspaceFileRead } from "../src/typesafe-evidence-file.cjs";
import { randomUUID } from "node:crypto";
import type { FrozenBundle, Manifest } from "./jev-paired-types";
import { digest, validateBundle, schedulePairs } from "./jev-paired-validation";
import { canonicalDigest, freezeContractValue } from "../src/task-contract-source";
import { projectProtocol, projectCase, projectLabel, projectPrice } from "./jev-paired-inputs";
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export async function readBoundFile(root: string, path: string): Promise<WorkspaceFileRead> {
  return readWorkspaceFile(resolve(root),path,{maxBytes:MAX_INPUT_BYTES});
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("json_object_required");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("json_array_required"); return value; }
function parseLines(bytes: Buffer): unknown[] { return bytes.toString("utf8").split(/\r?\n/).filter(x => x.trim()).map(x => JSON.parse(x)); }
export async function loadBundle(protocolPath: string): Promise<FrozenBundle> {
  const root = dirname(resolve(protocolPath));
  const protocolFile = await readBoundFile(root,relative(root,resolve(protocolPath)));
  const raw:unknown = JSON.parse(protocolFile.bytes.toString("utf8"));
  const protocol = projectProtocol(raw);
  const files:Record<string,string> = { [relative(root,resolve(protocolPath))]:protocolFile.sha256 };
  const read = async (path:string):Promise<Buffer> => { const file = await readBoundFile(root,path); files[path] = file.sha256; return file.bytes; };
  const cases = parseLines(await read(protocol.files.corpus)).map(projectCase);
  const labels = parseLines(await read(protocol.files.labels)).map(projectLabel);
  const prices = array(JSON.parse((await read(protocol.files.prices)).toString("utf8"))).map(projectPrice);
  const splits = object(JSON.parse((await read(protocol.files.splits)).toString("utf8"))) as FrozenBundle["splits"];
  for (const c of cases) {
    array(c.snapshots); array(c.derivationIds); array(c.scenarioIds);
    let inputBytes:Buffer | undefined;
    for (const binding of [...c.snapshots,c.input]) {
      if (!binding?.path || !/^[a-f0-9]{64}$/.test(binding.sha256)) throw new Error(`invalid_snapshot_binding:${c.id}`);
      const bytes = await read(binding.path);
      if (files[binding.path] !== binding.sha256) throw new Error(`snapshot_digest_mismatch:${c.id}:${binding.path}`);
      if (binding === c.input) inputBytes = bytes;
    }
    if (protocol.kind === "model_benchmark") {
      if (!inputBytes) throw new Error(`frozen_input_missing:${c.id}`);
      const rawInput = object(JSON.parse(inputBytes.toString("utf8")));
      const atomic = object(rawInput.atomic), macro = object(rawInput.macro), advisor = object(rawInput.advisorRequest);
      const contract = object(macro.contract), binding = object(atomic.binding), corpus = object(binding.corpus);
      const criteria = array(atomic.criteria), contractCriteria = array(contract.criteria);
      const scope = object(binding.authorizedScope);
      if (array(scope.operations).some(op => op !== "read")) throw new Error(`shadow_mutation_scope_forbidden:${c.id}`);
      const snapshot = object(atomic.snapshot);
      for (const key of ["contractDigest","evidenceDigest","treeDigest","testDigest","policyDigest","parentDigest","childDigest","integrationDigest"]) if (typeof snapshot[key] !== "string" || !/^[a-f0-9]{64}$/.test(String(snapshot[key]))) throw new Error(`incomplete_snapshot:${c.id}:${key}`);
      const packetSet = object(atomic.packetSet), manifest = object(packetSet.manifest), packets = array(packetSet.packets).map(object);
      if (manifest.contractDigest !== canonicalDigest(contract) || manifest.evidenceDigest !== snapshot.evidenceDigest
        || canonicalDigest(manifest.criteria) !== canonicalDigest(contractCriteria) || canonicalDigest(manifest.originalSource) !== canonicalDigest(contract.approvedSource)
        || canonicalDigest(manifest.parentRequirements) !== canonicalDigest(contract.parentRequirements) || atomic.packetDigest !== canonicalDigest(manifest)
        || manifest.globalCompletionEligible !== false || manifest.requiresIndependentParentReview !== true) throw new Error(`full_packet_manifest_binding_invalid:${c.id}`);
      const original = object(contract.originalUserRequest),parentSources = array(manifest.parentRequirements).map(object);
      if (typeof contract.contractId !== "string" || !contract.contractId || !["sessionId","entryId","digest"].every(key => typeof original[key] === "string" && String(original[key]).length > 0)
        || parentSources.some(parent => typeof parent.parentContractId !== "string" || !parent.parentContractId || typeof parent.criterionId !== "string" || !parent.criterionId)) throw new Error(`invalid_original_parent_reference:${c.id}`);
      const parentRequirementIds = array(manifest.parentRequirements).map(object).map(p => `parent:${String(p.parentContractId)}:${String(p.criterionId)}`);
      const parentContractIds = [...new Set(parentSources.map(parent => String(parent.parentContractId)))];
      const actualParentIds = parentContractIds.length ? parentContractIds : [String(contract.contractId)];
      const derivations = [`contract:${String(contract.contractId)}`,...parentContractIds.map(id => `contract:${id}`),`original-user:${canonicalDigest(contract.originalUserRequest)}`];
      if (!actualParentIds.includes(c.parentId) || derivations.some(id => !c.derivationIds.includes(id))) throw new Error(`complete_whole_parent_provenance_required:${c.id}`);
      if (!Array.isArray(advisor.parentRequirementIds) || canonicalDigest(advisor.parentRequirementIds) !== canonicalDigest(parentRequirementIds)) throw new Error(`independent_parent_Advisor_binding_mismatch:${c.id}`);
      const packetManifest = array(manifest.packets).map(object);
      if (packets.some(p => p.digest !== canonicalDigest(p.packet) || !packetManifest.some(m => m.digest === p.digest))) throw new Error(`selected_packet_digest_mismatch:${c.id}`);
      if (binding.purpose !== "shadow" || corpus.caseId !== c.id || corpus.contractDigest !== canonicalDigest(contract)
        || !criteria.length || canonicalDigest(criteria) !== canonicalDigest(contractCriteria) || canonicalDigest(array(advisor.criterionIds)) !== canonicalDigest(contractCriteria.map(criterion => object(criterion).id))
        || canonicalDigest(advisor.binding) !== canonicalDigest(binding) || canonicalDigest(advisor.snapshot) !== canonicalDigest(atomic.snapshot)
        || typeof macro.userRequest !== "string" || !macro.userRequest.trim() || !contract.originalUserRequest
        || typeof advisor.publicPrompt !== "string" || !advisor.publicPrompt.trim()
        || atomic.model !== (protocol.models.jevRequest ?? protocol.models.jev) || !Object.values(object(atomic.snapshot)).every(x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x))) throw new Error(`original_contract_or_equivalent_arm_input_missing:${c.id}`);
    }
  }
  for (const binding of [...Object.values(protocol.frozenConfiguration), ...(protocol.implementationInvariants ? [protocol.implementationInvariants.receipt] : [])]) {
    if (!binding?.path || !/^[a-f0-9]{64}$/.test(binding.sha256)) {
      if (protocol.state === "prerequisite_pending") continue;
      throw new Error("frozen_configuration_binding_required");
    }
    await read(binding.path);
    if (files[binding.path] !== binding.sha256) throw new Error(`configuration_digest_mismatch:${binding.path}`);
  }
  const bundle: FrozenBundle = { protocol,cases,labels,prices,splits,files,digest:"" };
  bundle.digest = digest(JSON.stringify(bundle));
  return bundle;
}
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive:true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp,"wx");
    try { await file.writeFile(JSON.stringify(value,null,2)+"\n"); await file.sync(); } finally { await file.close(); }
    await rename(temp,path);
  } catch (error) {
    try { await unlink(temp); } catch (cleanup) { if (!(cleanup && typeof cleanup === "object" && "code" in cleanup && cleanup.code === "ENOENT")) throw new AggregateError([error,cleanup],"atomic_public_metadata_write_and_cleanup_failed"); }
    throw error;
  }
}
export async function assertFrozenFiles(root: string, bundle: FrozenBundle): Promise<void> {
  for (const [path,hash] of Object.entries(bundle.files)) if ((await readBoundFile(root,path)).sha256 !== hash) throw new Error(`frozen_input_changed:${path}`);
}
export async function loadManifest(run: string): Promise<Manifest> {
  const value: unknown = JSON.parse((await readFile(resolve(run,"manifest.json"),"utf8")));
  const record = object(value); object(record.frozen); array(record.schedule);
  const manifest = record as unknown as Manifest;
  const frozen = manifest.frozen;
  if (manifest.schemaVersion !== 1 || manifest.kind !== frozen.protocol.kind || typeof manifest.runId !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("invalid_frozen_run_header");
  if (digest(JSON.stringify({ ...frozen,digest:"" })) !== frozen.digest) throw new Error("frozen_manifest_digest_mismatch");
  const validation = validateBundle(frozen);
  if (validation.errors.length) throw new Error(validation.errors.join(";"));
  if (JSON.stringify(manifest.schedule) !== JSON.stringify(schedulePairs(frozen))) throw new Error("invalid_or_changed_frozen_schedule");
  if (frozen.protocol.kind === "model_benchmark" && frozen.labels.some(l => l.provenance && Date.parse(l.provenance.labeledAt) > Date.parse(manifest.createdAt))) throw new Error("labels_must_precede_frozen_outputs");
  freezeContractValue(frozen); freezeContractValue(manifest.schedule);
  return manifest;
}
