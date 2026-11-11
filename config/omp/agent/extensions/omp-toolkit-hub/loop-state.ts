import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveEffectiveHome, resolveToolsPython } from "./python-bridge";

export interface LoopCheckpoint {
  updatedAt: string;
  ledgerStatus: string;
  nextUnit?: Record<string, unknown> | null;
  summary?: Record<string, unknown>;
}

export interface ToolkitHubOptions {
  homeDir?: string;
  ledgerPath?: string;
  checkpointPath?: string;
  harvesterScript?: string;
  doctorScript?: string;
}

export function resolveHomeDir(opts?: ToolkitHubOptions): string {
  return resolveEffectiveHome(opts?.homeDir);
}

export function resolveLedgerPath(opts?: ToolkitHubOptions, cwd?: string): string {
  if (opts?.ledgerPath) return opts.ledgerPath;
  const baseCwd = cwd || process.cwd();
  const repoLedger = path.join(baseCwd, "plans", "omp-consolidation-ledger.json");
  if (existsSync(repoLedger)) return repoLedger;
  return path.join(resolveHomeDir(opts), ".omp", "agent", "omp-consolidation-ledger.json");
}

export function resolveCheckpointPath(opts?: ToolkitHubOptions): string {
  if (opts?.checkpointPath) return opts.checkpointPath;
  return path.join(resolveHomeDir(opts), ".omp", "agent", "loop-checkpoint.json");
}

export function resolveHarvesterScript(opts?: ToolkitHubOptions, cwd?: string): string | null {
  if (opts?.harvesterScript && existsSync(opts.harvesterScript)) return opts.harvesterScript;
  const home = resolveHomeDir(opts);
  const candidates = [
    path.join(cwd || process.cwd(), "scripts", "omp-session-harvester.py"),
    path.join(home, ".omp", "agent", "skills", "omp-session-harvester", "scripts", "harvest_cli.py"),
  ];
  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

export function resolveDoctorScript(opts?: ToolkitHubOptions, cwd?: string): string | null {
  if (opts?.doctorScript && existsSync(opts.doctorScript)) return opts.doctorScript;
  const home = resolveHomeDir(opts);
  const candidates = [
    path.join(cwd || process.cwd(), "scripts", "omp-doctor.py"),
    path.join(home, ".omp", "agent", "tools", "omp-doctor.py"),
    path.join(home, ".omp", "agent", "skills", "omp-session-harvester", "scripts", "omp_doctor.py"),
  ];
  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

export function resolvePythonBin(homeDir: string): string {
  const res = resolveToolsPython(homeDir);
  return res.ok ? res.pythonBin : (process.platform === "win32" ? "python" : "python3");
}

export function readLedgerSummary(ledgerPath: string): Record<string, unknown> {
  if (!existsSync(ledgerPath)) {
    return { status: "NO_LEDGER", ledgerPath, next: "Run --scan to initialize ledger" };
  }
  try {
    const raw = JSON.parse(readFileSync(ledgerPath, "utf8")) as Record<string, unknown>;
    const suites = (raw.suites && typeof raw.suites === "object" ? raw.suites : {}) as Record<string, Record<string, unknown>>;
    const queue = Array.isArray(raw.promotionQueue) ? (raw.promotionQueue as Array<Record<string, unknown>>) : [];
    const staged = queue.filter((x) => x?.state === "staged");
    const pending = queue.filter((x) => x?.state === "pending");
    const loopMeta = (raw.loopMeta && typeof raw.loopMeta === "object" ? raw.loopMeta : {}) as Record<string, unknown>;
    let nextUnit: Record<string, unknown> | null = null;
    if (staged.length > 0) {
      nextUnit = { type: "staged_resume", status: raw.status, round: loopMeta.round ?? 0, stagedCount: staged.length, stagedBatch: staged.slice(0, 5) };
    } else if (raw.status === "DRIFT_DETECTED") {
      nextUnit = { type: "drift", status: "DRIFT_DETECTED", round: loopMeta.round ?? 0, pendingCount: pending.length, details: raw.driftDetails ?? {} };
    } else if (pending.length > 0) {
      nextUnit = { type: "promotion_batch", status: raw.status, round: loopMeta.round ?? 0, pendingCount: pending.length, batch: pending.slice(0, 5) };
    } else {
      for (const [name, meta] of Object.entries(suites)) {
        const st = String(meta?.status ?? "PENDING");
        if (!["PACKAGED", "VERIFIED", "VERIFIED_E2E"].includes(st)) {
          nextUnit = { type: "suite", name, status: st, targetPath: meta?.targetPath };
          break;
        }
      }
    }
    return {
      status: String(raw.status ?? "UNKNOWN"),
      ledgerPath,
      round: Number(loopMeta.round ?? 0),
      stagedCount: staged.length,
      pendingCount: pending.length,
      summary: (raw.summary as Record<string, unknown>) ?? {},
      nextUnit,
    };
  } catch (err) {
    return { status: "ERROR", ledgerPath, error: err instanceof Error ? err.message : String(err) };
  }
}

export function readLoopCheckpoint(checkpointPath: string): LoopCheckpoint | null {
  try {
    if (!existsSync(checkpointPath)) return null;
    return JSON.parse(readFileSync(checkpointPath, "utf8")) as LoopCheckpoint;
  } catch {
    return null;
  }
}

export function writeLoopCheckpoint(checkpointPath: string, data: LoopCheckpoint): boolean {
  try {
    mkdirSync(path.dirname(checkpointPath), { recursive: true });
    writeFileSync(checkpointPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function execPythonScript(script: string | null, missingErr: string, args: string[], opts?: ToolkitHubOptions, cwd?: string) {
  if (!script) return { ok: false, stdout: "", stderr: missingErr, exitCode: 127 };
  const py = resolvePythonBin(resolveHomeDir(opts));
  try {
    const res = spawnSync(py, [script, ...args], {
      cwd: cwd || process.cwd(),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 60_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    const code = typeof res.status === "number" ? res.status : 1;
    return { ok: code === 0, stdout: (res.stdout || "").trim(), stderr: (res.stderr || "").trim(), exitCode: code };
  } catch (err) {
    return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: 1 };
  }
}

export function runHarvesterCli(args: string[], opts?: ToolkitHubOptions, cwd?: string) {
  return execPythonScript(resolveHarvesterScript(opts, cwd), "harvester script not found", args, opts, cwd);
}

export function runDoctorCli(args: string[], opts?: ToolkitHubOptions, cwd?: string) {
  return execPythonScript(resolveDoctorScript(opts, cwd), "omp-doctor script not found", args, opts, cwd);
}
