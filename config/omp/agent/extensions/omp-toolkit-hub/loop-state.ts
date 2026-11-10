import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
}

export function resolveHomeDir(opts?: ToolkitHubOptions): string {
  return opts?.homeDir || process.env.HOME || process.env.USERPROFILE || os.homedir();
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

export function resolvePythonBin(homeDir: string): string {
  const venvWin = path.join(homeDir, ".omp", "tools-venv", "Scripts", "python.exe");
  if (existsSync(venvWin)) return venvWin;
  const venvPosix = path.join(homeDir, ".omp", "tools-venv", "bin", "python");
  if (existsSync(venvPosix)) return venvPosix;
  return process.platform === "win32" ? "python" : "python3";
}

export function readLedgerSummary(ledgerPath: string): Record<string, unknown> {
  if (!existsSync(ledgerPath)) {
    return { status: "NO_LEDGER", ledgerPath, next: "Run --scan to initialize ledger" };
  }
  try {
    const raw = JSON.parse(readFileSync(ledgerPath, "utf8")) as Record<string, unknown>;
    const suites = (raw.suites && typeof raw.suites === "object" ? raw.suites : {}) as Record<string, Record<string, unknown>>;
    let nextUnit: Record<string, unknown> | null = null;
    if (raw.status === "DRIFT_DETECTED") {
      nextUnit = { type: "drift", status: "DRIFT_DETECTED", details: raw.driftDetails ?? {} };
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

export function runHarvesterCli(args: string[], opts?: ToolkitHubOptions, cwd?: string): { ok: boolean; stdout: string; stderr: string; exitCode: number } {
  const script = resolveHarvesterScript(opts, cwd);
  if (!script) {
    return { ok: false, stdout: "", stderr: "harvester script not found", exitCode: 127 };
  }
  const py = resolvePythonBin(resolveHomeDir(opts));
  try {
    const res = spawnSync(py, [script, ...args], {
      cwd: cwd || process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    const code = typeof res.status === "number" ? res.status : 1;
    return {
      ok: code === 0,
      stdout: (res.stdout || "").trim(),
      stderr: (res.stderr || "").trim(),
      exitCode: code,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    };
  }
}
