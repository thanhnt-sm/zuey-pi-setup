import { open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CorpusCase, FrozenBundle } from "./jev-paired-types";
import { digest } from "./jev-paired-validation";
import { writeJson, readBoundFile } from "./jev-paired-files";
interface ExposureOwner { runId:string; run:string; bundleDigest:string; admittedAt:string }
interface ExposureLedger { schemaVersion:1; exposures:Record<string,ExposureOwner> }
function provenanceKeys(c:CorpusCase):string[] {
  return [`parent:${c.parentId}`,`family:${c.familyId}`,`group:${c.independentGroup}`,...c.derivationIds.map(id => `derivation:${id}`)].map(digest);
}
/** New protocol formatting, renamed case IDs or a new seed cannot turn exposed provenance into fresh holdout. */
export async function claimUnseenHoldout(run:string,bundle:FrozenBundle,runId:string):Promise<void> {
  const root = dirname(resolve(run)),path = resolve(root,"holdout-exposures.json"),lockPath = resolve(root,"holdout-exposures.lock");
  const lock = await open(lockPath,"wx");
  try {
    await lock.writeFile(JSON.stringify({runId,pid:process.pid,bundleDigest:bundle.digest})+"\n"); await lock.sync();
    let ledger:ExposureLedger;
    try { ledger = JSON.parse((await readBoundFile(root,"holdout-exposures.json")).bytes.toString("utf8")) as ExposureLedger; }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "FILE_MISSING")) throw error; ledger = {schemaVersion:1,exposures:{}}; }
    if (ledger.schemaVersion !== 1 || !ledger.exposures || typeof ledger.exposures !== "object" || Array.isArray(ledger.exposures)) throw new Error("invalid_holdout_exposure_ledger");
    const owner:ExposureOwner = {runId,run:resolve(run),bundleDigest:bundle.digest,admittedAt:new Date().toISOString()};
    for (const c of bundle.cases) {
      if (!c.canonical || bundle.splits[c.id] !== "holdout") continue;
      for (const key of provenanceKeys(c)) {
        const prior = ledger.exposures[key];
        if (prior && (prior.runId !== owner.runId || prior.run !== owner.run || prior.bundleDigest !== owner.bundleDigest)) throw new Error(`holdout_provenance_already_exposed_new_independent_holdout_required:${c.id}`);
      }
    }
    // Every executed case (including dev/calibration and correlated variants) is exposed for later studies.
    for (const c of bundle.cases) for (const key of provenanceKeys(c)) if (!ledger.exposures[key]) ledger.exposures[key] = owner;
    await writeJson(path,ledger);
  } finally { await lock.close(); await unlink(lockPath); }
}
