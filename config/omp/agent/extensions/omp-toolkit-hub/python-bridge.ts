import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PythonResolution {
  ok: boolean;
  isVenv: boolean;
  pythonBin: string;
  hint?: string;
}

export interface SkillCliRequest {
  homeDir?: string;
  cwd?: string;
  skillName: string;
  scriptName: string;
  args: string[];
  timeoutMs?: number;
}

export interface SkillCliResponse {
  ok: boolean;
  exitCode: number;
  data?: unknown;
  stdout: string;
  stderr: string;
  error?: string;
  hint?: string;
}

export function resolveEffectiveHome(homeDir?: string): string {
  return homeDir || process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export function resolveToolsPython(homeDir?: string): PythonResolution {
  const home = resolveEffectiveHome(homeDir);
  const winPy = path.join(home, ".omp", "tools-venv", "Scripts", "python.exe");
  const posixPy3 = path.join(home, ".omp", "tools-venv", "bin", "python3");
  const posixPy = path.join(home, ".omp", "tools-venv", "bin", "python");

  const venvCandidates = process.platform === "win32"
    ? [winPy, posixPy3, posixPy]
    : [posixPy3, posixPy, winPy];

  for (const cand of venvCandidates) {
    if (existsSync(cand)) {
      return { ok: true, isVenv: true, pythonBin: cand };
    }
  }

  const sysCandidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const cand of sysCandidates) {
    try {
      const probe = spawnSync(cand, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"], {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 5_000,
      });
      if (probe.status === 0) {
        return { ok: true, isVenv: false, pythonBin: cand };
      }
    } catch {}
  }

  return {
    ok: false,
    isVenv: false,
    pythonBin: "",
    hint: "Python >=3.9 / ~/.omp/tools-venv not found. Run scripts/omp-setup-restore.sh or scripts/omp-bootstrap.sh to install tools-venv.",
  };
}

export function resolveSkillScript(homeDir: string | undefined, cwd: string | undefined, skillName: string, scriptName: string): string | null {
  const home = resolveEffectiveHome(homeDir);
  const baseCwd = cwd || process.cwd();
  const candidates = [
    path.join(home, ".omp", "agent", "skills", skillName, "scripts", scriptName),
    path.join(baseCwd, "config", "omp", "agent", "skills", skillName, "scripts", scriptName),
  ];
  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

export function validateCliArgs(args: string[]): string | null {
  for (const arg of args) {
    if (arg.includes("\0")) return "Invalid null byte in argument";
  }
  return null;
}

export function runSkillCliJson(req: SkillCliRequest): SkillCliResponse {
  const argErr = validateCliArgs(req.args);
  if (argErr) {
    return { ok: false, exitCode: 2, stdout: "", stderr: argErr, error: argErr };
  }

  const scriptPath = resolveSkillScript(req.homeDir, req.cwd, req.skillName, req.scriptName);
  if (!scriptPath) {
    const msg = `Skill script not found: ${req.skillName}/scripts/${req.scriptName}`;
    return {
      ok: false,
      exitCode: 127,
      stdout: "",
      stderr: msg,
      error: msg,
      hint: "Run scripts/omp-setup-restore.sh to install OMP Priority-100 skills.",
    };
  }

  const py = resolveToolsPython(req.homeDir);
  if (!py.ok) {
    return { ok: false, exitCode: 127, stdout: "", stderr: py.hint || "Python unavailable", error: "Python runtime unavailable", hint: py.hint };
  }

  try {
    const res = spawnSync(py.pythonBin, [scriptPath, ...req.args], {
      cwd: req.cwd || process.cwd(),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: req.timeoutMs ?? 60_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    const code = typeof res.status === "number" ? res.status : 1;
    const stdout = (res.stdout || "").trim();
    const stderr = (res.stderr || "").trim();
    let parsed: unknown;
    if (stdout) {
      try {
        parsed = JSON.parse(stdout);
      } catch {}
    }
    if (code !== 0) {
      const errObj = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
      return {
        ok: false,
        exitCode: code,
        data: parsed,
        stdout,
        stderr,
        error: String(errObj?.error || stderr || stdout || `Exited with code ${code}`),
      };
    }
    return { ok: true, exitCode: 0, data: parsed, stdout, stderr };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, exitCode: 1, stdout: "", stderr: msg, error: msg };
  }
}
