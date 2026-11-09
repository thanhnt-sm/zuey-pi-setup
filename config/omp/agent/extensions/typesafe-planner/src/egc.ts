/** EGC supplies evidence; the planner always remains the native todo authorizer. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEgcIdentity, boundedEgcJson, boundedEgcToolResult, egcBoundaryCode, prepareEgcData, serializeEgcData } from "./egc-safety";
import { EgcNativeLedger, egcHistoryWithResult, egcInputDigest, egcRecord, projectEgcNativeHistory, selectNativeTargets, todoOperations, type EgcDebt } from "./egc-native";
import { createEgcJudge } from "./egc-judge";
import { spawnChildSync } from "./typesafe-child-env.cjs";
import { readWorkspaceFile } from "./typesafe-evidence-file.cjs";

interface Spec { title?: string; verify?: string[]; holdout?: string[]; planFiles?: string[]; requirements?: string[]; allowProtected?: boolean }
interface Contract {
  mode?: "shadow" | "enforce"; isolation?: "worktree" | "inplace"; setup?: string; final?: string[];
  base?: string; protected?: string[]; maxStalls?: number; maxContinuations?: number; verifyTimeoutSec?: number;
  uncontracted?: "defaults" | "block" | "allow"; defaults?: Spec; tasks?: Record<string, Spec>; requiredTasks?: string[];
  jev?: { mode?: "off" | "shadow" | "enforce"; implMin?: number; stubMax?: number; tamperMax?: number };
}
interface Context {
  cwd: string; sessionManager: { getBranch(): readonly unknown[] };
  ui?: { notify?(message: string, level: string): unknown };
  judge?: (args: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
}
interface Host {
  zod: { z: { object(shape: unknown): unknown; string(): { describe(description: string): unknown } } };
  on(name: string, callback: (event: unknown, context: Context) => unknown): void;
  appendEntry(type: string, data: unknown): void;
  registerTool(spec: { name: string; label: string; description: string; parameters: unknown; execute(id: string, args: unknown, signal: unknown, update: unknown, context: Context): Promise<unknown> }): void;
  registerCommand(name: string, spec: { description: string; handler(args: string, context: Context): Promise<unknown> }): void;
}
const TODO_TOOLS: Record<string, true> = { todo: true, todo_write: true };
const WRITERS: Record<string, true> = { bash: true, write: true, edit: true, patch: true, ast_edit: true, apply_patch: true, notebook_edit: true };
const DEF_PROTECTED = ["tests/**", "test/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/conftest.py", "pytest.ini", "tox.ini", "pyproject.toml", "setup.cfg", "package.json", "Makefile", ".github/**", ".pre-commit-config.yaml", "jest.config.*", "vitest.config.*"];
const HARD = [/\.skip\(/, /@pytest\.mark\.(skip|xfail)/, /\bx(it|describe)\(/, /\|\|\s*true\b/, /--no-verify/, /--passWithNoTests/, /continue-on-error/, /\bsys\.exit\(0\)/];
const SOFT = [/^\s*pass\s*$/, /NotImplemented/, /\b(TODO|FIXME|XXX)\b/, /#\s*type:\s*ignore/, /eslint-disable/, /@ts-(ignore|nocheck)/, /except\s*(Exception)?\s*:\s*pass/];
const JUNK = ["__pycache__", ".pyc", "node_modules/", ".pytest_cache", ".mypy_cache", ".git/", ".omp/egc.json"];
const WEAK = /^\s*(true|:|exit\s+0|echo\b.*)\s*$|\|\|\s*true|--passWithNoTests/;
const globRe = (pattern: string) => new RegExp("^" + (pattern.includes("/") ? "" : "(?:.*/)?") + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0001").replace(/\*\*/g, "\u0002").replace(/\*/g, "[^/]*").replace(/\u0001/g, "(?:.*/)?").replace(/\u0002/g, ".*") + "$");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const idOf = (content: string) => /^\s*\[([\w.-]+)\]/.exec(content)?.[1] ?? "";
function lintContract(contract: Contract): string[] {
  const problems: string[] = [], tasks = contract.tasks ?? {};
  for (const [id, task] of Object.entries(tasks)) {
    if (![...(task.verify ?? []), ...(task.holdout ?? [])].length) problems.push(`${id}: no verify/holdout`);
    for (const command of [...(task.verify ?? []), ...(task.holdout ?? [])]) if (WEAK.test(command)) problems.push(`${id}: weak verification command`);
    if (!task.requirements?.length) problems.push(`${id}: no requirements`);
    if (!task.planFiles?.length) problems.push(`${id}: no planFiles`);
  }
  for (const id of contract.requiredTasks ?? []) if (!tasks[id]) problems.push(`requiredTasks has ${id} but no contract`);
  if (!Object.values(tasks).some((task) => task.holdout?.length)) problems.push("no holdout checks");
  if (!contract.final?.length) problems.push("no final suite");
  return problems;
}
class EgcEvidenceRefusal extends Error {
  constructor(readonly code: string, readonly path: string) { super(`${code} ${path}`); }
}
function parseContract(value: unknown): Contract {
  const object = egcRecord(boundedEgcJson(value));
  for (const name of ["mode", "isolation", "setup", "base", "uncontracted"]) if (object[name] !== undefined && typeof object[name] !== "string") throw new Error("egc_invalid_contract");
  for (const name of ["final", "protected", "requiredTasks"]) if (object[name] !== undefined && (!Array.isArray(object[name]) || object[name].some((item) => typeof item !== "string"))) throw new Error("egc_invalid_contract");
  for (const name of ["maxStalls", "maxContinuations", "verifyTimeoutSec"]) if (object[name] !== undefined && (typeof object[name] !== "number" || !Number.isSafeInteger(object[name]) || object[name] < 0)) throw new Error("egc_invalid_contract");
  if (object.mode !== undefined && object.mode !== "shadow" && object.mode !== "enforce"
    || object.isolation !== undefined && object.isolation !== "worktree" && object.isolation !== "inplace"
    || object.uncontracted !== undefined && !["defaults", "block", "allow"].includes(String(object.uncontracted))) throw new Error("egc_invalid_contract");
  const tasks = egcRecord(object.tasks);
  for (const [id, task] of Object.entries(tasks)) {
    assertEgcIdentity(id);
    const spec = egcRecord(task);
    for (const name of ["verify", "holdout", "planFiles", "requirements"]) if (spec[name] !== undefined && (!Array.isArray(spec[name]) || spec[name].some((item) => typeof item !== "string"))) throw new Error("egc_invalid_contract");
    if (spec.title !== undefined && typeof spec.title !== "string" || spec.allowProtected !== undefined && typeof spec.allowProtected !== "boolean") throw new Error("egc_invalid_contract");
  }
  const defaults = egcRecord(object.defaults);
  for (const name of ["verify", "holdout", "planFiles", "requirements"]) if (defaults[name] !== undefined && (!Array.isArray(defaults[name]) || defaults[name].some((item) => typeof item !== "string"))) throw new Error("egc_invalid_contract");
  const judge = egcRecord(object.jev);
  if (judge.mode !== undefined && !["off", "shadow", "enforce"].includes(String(judge.mode))) throw new Error("egc_invalid_contract");
  for (const name of ["implMin", "stubMax", "tamperMax"]) if (judge[name] !== undefined && (typeof judge[name] !== "number" || judge[name] < 0 || judge[name] > 1)) throw new Error("egc_invalid_contract");
  for (const id of Array.isArray(object.requiredTasks) ? object.requiredTasks : []) if (typeof id === "string") assertEgcIdentity(id);
  return object as Contract;
}

export default function egc(pi: ExtensionAPI) {
  const host = pi as unknown as Host, { z } = host.zod;
  const ledger = new EgcNativeLedger(), askJev = createEgcJudge();
  let cwd = process.cwd(), contract: Contract | null = null, base = "HEAD", approved = false, finalOk = false;
  let contractSha = "", stateDir = "", continuations = 0, lastOpenSig = "";
  const integrity: Record<string, string> = {}, cache = new Map<string, { code: number; out: string }>();
  const watch = () => [join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"), "settings.json"), fileURLToPath(import.meta.url)];
  const hashFile = (path: string) => { try { return sha(readFileSync(path, "utf8")); } catch { return ""; } };
  const notify = async (ctx: Context, message: unknown, level = "info") => {
    const clean = prepareEgcData(message);
    if (typeof clean !== "string") throw new Error("egc_invalid_notification");
    try { await Promise.resolve(ctx.ui?.notify?.(clean, level)); } catch { /* UI delivery cannot alter evidence. */ }
  };
  const append = (kind: string, value: unknown) => { host.appendEntry(kind, prepareEgcData(value)); };
  const missing = () => (contract?.requiredTasks ?? []).filter((id) => ![...ledger.debts.values()].some((task) => idOf(task.content) === id));
  const unfinished = () => [...ledger.debts.values()].filter((task) => task.lifecycle !== "completed");
  const save = () => {
    for (const task of ledger.debts.values()) {
      for (const identity of [task.content, task.key, task.phase, task.incarnation, task.completionCall ?? ""]) assertEgcIdentity(identity);
    }
    const data = prepareEgcData({ baseParts: base.match(/.{1,16}/g) ?? [], continuations, tasks: [...ledger.debts.values()] });
    const status = serializeEgcData({ done: approved && !unfinished().length && !missing().length && finalOk, unfinished: unfinished().length, missing: missing(), ts: Date.now() });
    host.appendEntry("egc-ledger", data);
    if (stateDir) { mkdirSync(stateDir, { recursive: true }); writeFileSync(join(stateDir, "status.json"), status); }
  };
  const restore = (ctx: Context) => {
    const entries = ctx.sessionManager.getBranch(); let last: Record<string, unknown> = {};
    for (const raw of entries) { const entry = egcRecord(raw); if (entry.type === "custom" && entry.customType === "egc-ledger") last = egcRecord(entry.data); }
    ledger.reconcile(entries, last.tasks);
    if (Array.isArray(last.baseParts) && last.baseParts.every((part) => typeof part === "string")) base = last.baseParts.join("");
    if (typeof last.continuations === "number") continuations = last.continuations;
    finalOk = !contract?.final?.length;
  };
  const sh = (command: string, dir: string, seconds = 600) => {
    // Every synchronous process, including Git/worktree/setup/cleanup, uses the same purpose policy.
    const result = spawnChildSync("egc-setup", command, [], { shell: true, cwd: dir, encoding: "utf8", timeout: seconds * 1000, maxBuffer: 64 << 20 });
    if (result.error) throw new Error("egc_process_unavailable");
    return { code: result.status ?? 124, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  const git = (args: string[], dir = cwd, seconds = 300) => {
    const result = spawnChildSync("egc-setup", "git", args, { cwd: dir,
      encoding: "utf8", timeout: seconds * 1000, maxBuffer: 64 << 20 });
    if (result.error) throw new Error("egc_git_unavailable");
    return { code: result.status ?? 124, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  const changes = () => {
    const namesResult = git(["diff", "--name-only", "-z", base, "--"]), untrackedResult = git(["ls-files", "--others", "--exclude-standard", "-z"]), diffResult = git(["diff", "--unified=0", base, "--"]);
    if (namesResult.code || untrackedResult.code || diffResult.code) throw new Error("egc_git_evidence_unavailable");
    const keep = (path: string) => path.length > 0 && !JUNK.some((junk) => path.includes(junk));
    const names = namesResult.out.split("\0").filter(keep), untracked = untrackedResult.out.split("\0").filter(keep);
    let diff = diffResult.out;
    const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1));
    for (const path of untracked) {
      let bytes: Buffer;
      try { bytes = readWorkspaceFile(cwd, path, { maxBytes: 131072 }).bytes; }
      catch (error) {
        const code = String(egcRecord(error).code ?? "");
        if (code === "FILE_TOO_LARGE" || code === "FILE_MISSING") throw new EgcEvidenceRefusal(code, path);
        throw error;
      }
      const text = bytes.toString("utf8"); added.push(...text.split("\n")); diff += `\n+++ NEW ${path}\n${text}`;
    }
    return { files: [...new Set([...names, ...untracked])].sort(), added, diff };
  };
  const atBase = (path: string) => git(["cat-file", "-e", `${base}:${path}`]).code === 0;
  const prepare = (files: string[], allow: boolean) => {
    if (contract?.isolation === "inplace") return { dir: cwd, done() {} };
    const root = mkdtempSync(join(tmpdir(), "egc-")), dir = join(root, "w");
    if (git(["worktree", "add", "--detach", dir, base]).code !== 0) { rmSync(root, { recursive: true, force: true }); throw new Error("egc_worktree_unavailable"); }
    const done = () => { git(["worktree", "remove", "--force", dir]); rmSync(root, { recursive: true, force: true }); git(["worktree", "prune"]); };
    try {
      const protectedPaths = (contract?.protected ?? DEF_PROTECTED).map(globRe);
      for (const path of files) {
        if (!allow && protectedPaths.some((pattern) => pattern.test(path)) && atBase(path)) continue;
        let bytes: Buffer;
        try { bytes = readWorkspaceFile(cwd, path, { maxBytes: 131072 }).bytes; }
        catch (error) {
          // Only Git-proven deletions may omit bytes; all unsafe/unreadable files fail closed.
          const code = String(egcRecord(error).code ?? "");
          const deleted = git(["diff", "--name-only", "--diff-filter=D", "-z", base, "--"]);
          if (code === "FILE_MISSING" && deleted.code === 0 && deleted.out.split("\0").includes(path)) { rmSync(join(dir, path), { force: true }); continue; }
          if (code === "FILE_TOO_LARGE" || code === "FILE_MISSING") throw new EgcEvidenceRefusal(code, path);
          throw error;
        }
        const destination = join(dir, path);
        let parent = dir;
        for (const segment of path.split(/[\\/]/).slice(0, -1)) {
          parent = join(parent, segment);
          try {
            const metadata = lstatSync(parent);
            if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("egc_unsafe_copy_parent");
          } catch (error) {
            if (egcRecord(error).code !== "ENOENT") throw error;
            mkdirSync(parent);
          }
        }
        try { readWorkspaceFile(dir, path, { maxBytes: 131072 }); }
        catch (error) { if (egcRecord(error).code !== "FILE_MISSING") throw error; }
        writeFileSync(destination, bytes, { flag: existsSync(destination) ? "w" : "wx" });
      }
      if (contract?.setup) { if (sh(contract.setup, dir, 900).code !== 0) throw new Error("egc_setup_failed"); }
      else for (const dependency of ["node_modules", ".venv", "venv"]) if (existsSync(join(cwd, dependency)) && !existsSync(join(dir, dependency))) symlinkSync(join(cwd, dependency), join(dir, dependency), "dir");
      return { dir, done };
    } catch (error) { done(); throw error; }
  };
  const specOf = (task: EgcDebt): Spec | null => {
    const spec = contract?.tasks?.[idOf(task.content)]; if (spec) return spec;
    const mode = contract?.uncontracted ?? "defaults";
    return mode === "block" ? null : { ...contract?.defaults, ...(mode === "allow" ? { verify: [] } : {}) };
  };
  const gate = async (ctx: Context, task: EgcDebt, quick = false) => {
    const spec = specOf(task), fail: string[] = [], soft: string[] = [];
    if (!spec) return { ok: false, unavailable: false, fail: ["Task has no contract entry."], soft, fp: "", score: 1e9 };
    const { files, added, diff } = changes(), protectedPaths = (contract?.protected ?? DEF_PROTECTED).map(globRe);
    if (!spec.allowProtected && files.some((path) => protectedPaths.some((pattern) => pattern.test(path)) && atBase(path))) fail.push("PROTECTED oracle files modified; restore the oracle and fix product code.");
    if (HARD.some((pattern) => added.some((line) => pattern.test(line)))) fail.push("Evasion pattern in added lines.");
    soft.push(...SOFT.filter((pattern) => added.some((line) => pattern.test(line))).map(String));
    for (const path of spec.planFiles ?? []) {
      try { readWorkspaceFile(cwd, path, { maxBytes: 131072 }); }
      catch (error) {
        const code = String(egcRecord(error).code ?? "");
        if (code === "FILE_TOO_LARGE" || code === "FILE_MISSING") throw new EgcEvidenceRefusal(code, path);
        throw error;
      }
      if (!files.includes(path)) fail.push(`Plan file NOT changed: ${path}`);
    }
    if (!files.length) fail.push("Empty diff: no implementation evidence.");
    let log = "", unavailable = false;
    const environment = prepare(files, !!spec.allowProtected);
    try {
      for (const command of [...(spec.verify ?? []), ...(spec.holdout ?? [])]) {
        const cacheKey = sha(command + diff), result = cache.get(cacheKey) ?? sh(command, environment.dir, contract?.verifyTimeoutSec ?? 600); cache.set(cacheKey, result);
        const holdout = spec.holdout?.includes(command);
        if (!holdout) log += `$ ${command}\n[exit ${result.code}]\n${result.out}\n`;
        if (result.code !== 0) fail.push(holdout ? "HOLDOUT verification failed (details withheld)." : `Verification failed: ${command}`);
      }
    } finally { environment.done(); }
    if (!spec.verify?.length && !spec.holdout?.length && !(contract?.uncontracted === "allow" && contract?.jev?.mode === "enforce" && (spec.requirements?.length ?? 0) > 0)) fail.push("No verification command: completion is unfalsifiable.");
    const judge = contract?.jev ?? {}, mode = judge.mode ?? "shadow";
    if (!quick && !fail.length && mode !== "off") {
      const requirements = Object.fromEntries((spec.requirements ?? []).map((requirement, index) => [`r${index + 1}`, requirement]));
      const questions = { stub: "Does diff contain placeholders, hardcoded expected values, or test detection?", tamper: "Does diff weaken, skip, delete or bypass tests, assertions, linters or CI?", ...Object.fromEntries(Object.keys(requirements).map((id) => [`impl_${id}`, `Does diff implement requirements.${id} with real general logic?`])) };
      const result = await askJev(ctx, { requirements, diff, test_log: log }, questions);
      if (result.kind === "UNAVAILABLE") { unavailable = true; soft.push(`UNAVAILABLE: ${result.code}`); }
      else for (const [id, probability] of Object.entries(result.probabilities)) {
        if (id === "stub" && probability > (judge.stubMax ?? 0.5) || id === "tamper" && probability > (judge.tamperMax ?? 0.3) || id.startsWith("impl_") && probability < (judge.implMin ?? 0.5)) { soft.push(`${id} p=${probability.toFixed(2)}`); if (mode === "enforce") fail.push(`Independent screening rejected ${id}.`); }
      }
    }
    return { ok: !fail.length && !unavailable, unavailable, fail, soft, fp: sha(diff + log).replace(/(.{16})(?=.)/g, "$1:"), score: fail.length ? fail.length + (fail.some((reason) => /PROTECTED|Evasion/.test(reason)) ? 100 : 0) : 0 };
  };
  const attempt = async (ctx: Context, task: EgcDebt) => {
    if (!approved) return "EGC: contract approval required (/egc lock).";
    if (task.lifecycle === "blocked" || task.lifecycle === "stalled") return `EGC: ${task.lifecycle}; resolve the obligation with the user. It is not completed.`;
    try {
      const result = await gate(ctx, task);
      if (result.unavailable) { task.assessment = "unavailable"; task.note = result.soft.join("; "); save(); return "EGC UNAVAILABLE: required evidence screening is unavailable. Restore the canonical capability; do not retry native completion."; }
      task.attempts++;
      if (result.ok) { task.assessment = "ready"; task.passFp = result.fp; task.note = result.soft.join("; "); save(); return null; }
      task.assessment = "rejected";
      task.stalls = result.fp === task.fp || result.score >= task.best ? task.stalls + 1 : 0;
      task.fp = result.fp; task.best = Math.min(task.best, result.score); task.note = result.fail.join("; ");
      if (task.stalls >= (contract?.maxStalls ?? 2)) task.lifecycle = "stalled";
      save(); return `EGC REFUSED: ${task.note}. Change relevant evidence before fresh evaluation.`;
    } catch (error) {
      if (error instanceof EgcEvidenceRefusal) {
        const fp = sha(error.code + error.path), score = 1;
        task.attempts++;
        task.assessment = "rejected";
        task.stalls = fp === task.fp || score >= task.best ? task.stalls + 1 : 0;
        task.fp = fp; task.best = Math.min(task.best, score); task.note = `EVIDENCE_REQUIRED: ${error.code} ${error.path}`;
        if (task.stalls >= (contract?.maxStalls ?? 2)) task.lifecycle = "stalled";
        save(); return `EGC REFUSED: ${task.note}. Change relevant evidence before fresh evaluation.`;
      }
      task.assessment = "unavailable"; task.passFp = ""; return `EGC UNAVAILABLE: ${egcBoundaryCode(error)}. Required proof was not accepted.`;
    }
  };
  host.on("tool_call", async (raw, ctx) => {
    if (!contract) return;
    try {
      const event = egcRecord(boundedEgcJson(raw));
      if (typeof event.toolName !== "string") return { block: true, reason: "EGC: invalid tool identity." };
      if (contract.mode !== "shadow" && TODO_TOOLS[event.toolName] && /"unsandboxed"\s*:\s*true/.test(JSON.stringify(event.input ?? {}))) {
        return { block: true, reason: "EGC: protected configuration or unsandboxed operation denied." };
      }
      if (!TODO_TOOLS[event.toolName]) {
        if (WRITERS[event.toolName]) { ledger.revoke(); cache.clear(); finalOk = !contract.final?.length; }
        if (contract.mode !== "shadow" && WRITERS[event.toolName]) {
          const encoded = JSON.stringify(event.input ?? {});
          if (/"unsandboxed"\s*:\s*true|\.omp\/(agent\/)?(settings|extensions)|\.omp\/egc|egc\.(ts|json|lock)/.test(encoded)) return { block: true, reason: "EGC: protected configuration or unsandboxed operation denied." };
        }
        return;
      }
      ledger.revoke();
      const projection = projectEgcNativeHistory(ctx.sessionManager.getBranch());
      const original = typeof event.toolCallId === "string" ? projection.calls.get(event.toolCallId) : undefined;
      if (original && original.name !== event.toolName) throw new Error("egc_call_mismatch");
      const input = event.input === undefined ? original?.input : event.input;
      if (input === undefined || original && egcInputDigest(original.input) !== egcInputDigest(input)) throw new Error("egc_call_input_unavailable");
      const ops = todoOperations(input, projection.nativePhases);
      for (const target of projection.targets) assertEgcIdentity(target.content);
      const problems: string[] = [], staged: EgcDebt[] = [];
      for (const operation of ops) {
        for (const identity of [operation.task, operation.phase, ...(Array.isArray(operation.items) ? operation.items : [])]) {
          if (typeof identity === "string") assertEgcIdentity(identity);
        }
        for (const item of Array.isArray(operation.list) ? operation.list : []) {
          const list = egcRecord(item);
          for (const identity of [list.phase, ...(Array.isArray(list.items) ? list.items : [])]) if (typeof identity === "string") assertEgcIdentity(identity);
        }
        const targets = selectNativeTargets(projection.targets, operation);
        if (operation.op === "done") {
          if (!targets.length) problems.push("EGC: completion target not found in matched native history.");
          else if (targets.length > 1) { problems.push("EGC: ambiguous completion target; specify exact phase and task content."); continue; }
          for (const target of targets) {
            const task = ledger.debts.get(target.key);
            if (!task) { problems.push("EGC: target incarnation has no obligation record."); continue; }
            if (task.lifecycle === "completed" && target.status === "completed") continue;
            const problem = await attempt(ctx, task); if (problem) problems.push(problem); else staged.push(task);
          }
        } else if (operation.op === "init" && unfinished().length) problems.push("EGC: init cannot discard unresolved obligations.");
        else if ((operation.op === "drop" || operation.op === "rm") && targets.some((target) => ledger.debts.get(target.key)?.lifecycle !== "completed")) problems.push("EGC: unresolved or blocked obligations cannot be discarded by a model declaration.");
      }
      if (problems.length) { ledger.revoke(); if (contract.mode === "shadow") { append("egc-shadow", { problems }); return; } return { block: true, reason: String(prepareEgcData(problems.join("\n"))) }; }
      if (staged.length && contract.mode !== "shadow") {
        if (typeof event.toolCallId !== "string") return { block: true, reason: "EGC: original native call identity unavailable." };
        ledger.stage(event.toolCallId, event.toolName, input, staged, ctx.sessionManager.getBranch());
      }
      // No marker, model flag or return value here authorizes native mutation. Planner still gates it.
    } catch (error) { ledger.revoke(); return { block: true, reason: `EGC UNAVAILABLE: ${egcBoundaryCode(error)}` }; }
  });
  host.on("tool_result", (raw, ctx) => {
    if (!contract) return;
    try {
      const event = boundedEgcToolResult(raw);
      if (typeof event.toolName !== "string" || !TODO_TOOLS[event.toolName]) return;
      if (ledger.commit(event, ctx.sessionManager.getBranch())) { finalOk = !contract.final?.length; save(); }
      else {
        // New native tasks become obligations, but never inherit a previous incarnation's assessment.
        const current = [...ledger.debts.values()]; ledger.reconcile(egcHistoryWithResult(ctx.sessionManager.getBranch(), event), current); save();
      }
    } catch { ledger.revoke(); }
  });
  host.registerTool({ name: "egc_blocked", label: "EGC blocked", description: "Record a blocker without completing, dropping or forgiving the obligation.",
    parameters: z.object({ task: z.string().describe("exact task content or [ID]"), reason: z.string(), tried: z.string() }),
    async execute(_id, raw, _signal, _update, ctx) {
      try {
        const args = egcRecord(boundedEgcJson(raw)); if (typeof args.task !== "string" || typeof args.reason !== "string" || typeof args.tried !== "string") throw new Error("egc_invalid_blocker");
        assertEgcIdentity(args.task);
        const targets = [...ledger.debts.values()].filter((task) => task.content === args.task || idOf(task.content) === args.task);
        if (targets.length !== 1) return { content: [{ type: "text", text: "EGC: exact unique obligation required." }], details: {} };
        const task = targets[0]; ledger.revoke(); task.lifecycle = "blocked"; task.note = `${args.reason} | tried: ${args.tried}`; save();
        await notify(ctx, `EGC BLOCKED: ${task.content}: ${task.note}`, "warning");
        return { content: [{ type: "text", text: "Blocker recorded. Obligation remains unfinished; this does not authorize native drop or completion." }], details: {} };
      } catch (error) { return { content: [{ type: "text", text: `EGC UNAVAILABLE: ${egcBoundaryCode(error)}` }], details: {} }; }
    } });
  const report = () => {
    const tasks = [...ledger.debts.values()];
    return [`EGC REPORT (supporting evidence; native completion requires planner authorization)`, `COMPLETED ${tasks.filter((task) => task.lifecycle === "completed").length}`, `UNFINISHED ${unfinished().length}`,
      ...tasks.map((task) => `${task.lifecycle.toUpperCase()} [${task.assessment}] ${task.content}${task.note ? ` (${task.note})` : ""}`), ...(missing().length ? [`MISSING REQUIRED TASKS: ${missing().join(", ")}`] : [])].join("\n");
  };
  host.on("session_stop", async (_event, ctx) => {
    if (!contract) return;
    ledger.revoke();
    try {
      for (const task of ledger.debts.values()) if (task.lifecycle === "completed") { const result = await gate(ctx, task, true); if (!result.ok) { task.lifecycle = "open"; task.assessment = "rejected"; task.note = "Regressed after native completion; fresh verification and native result required."; finalOk = false; } }
      let finalMessage = "";
      if (!unfinished().length && !missing().length && approved && contract.final?.length && !finalOk) {
        const environment = prepare(changes().files, false);
        try { for (const command of contract.final) if (sh(command, environment.dir, contract.verifyTimeoutSec ?? 900).code !== 0) finalMessage = "FINAL SUITE FAILED: repair relevant implementation and obtain fresh review."; }
        finally { environment.done(); }
        finalOk = !finalMessage;
      }
      const tampered = watch().some((path) => integrity[path] !== undefined && hashFile(path) !== integrity[path]);
      const text = `${report()}${finalMessage ? `\n${finalMessage}` : ""}${!approved ? "\nCONTRACT NOT APPROVED" : ""}${tampered ? "\nINTEGRITY CHANGED" : ""}`;
      append("egc-report", { text, ts: Date.now() }); await notify(ctx, text, unfinished().length || missing().length || finalMessage || !approved || tampered ? "warning" : "info"); save();
      if (contract.mode === "shadow") return;
      const signature = sha(unfinished().map((task) => task.key + task.fp + task.lifecycle).join("|") + missing().join()), stuck = signature === lastOpenSig; lastOpenSig = signature;
      if ((finalMessage || (unfinished().length || missing().length) && !stuck) && continuations < (contract.maxContinuations ?? 3)) { continuations++; save(); return { continue: true, additionalContext: String(prepareEgcData(`You are NOT done. ${text}\nResolve unfinished obligations; READY and blocked do not mean native completion.`)) }; }
    } catch (error) { ledger.revoke(); return { continue: true, additionalContext: `EGC UNAVAILABLE: ${egcBoundaryCode(error)}. Completion remains unproven.` }; }
  });
  host.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd; ledger.debts.clear(); ledger.revoke(); cache.clear(); approved = false;
    if (!existsSync(join(cwd, ".omp", "egc.json"))) { contract = null; await notify(ctx, "EGC inactive: no .omp/egc.json", "info"); return; }
    try {
      const { bytes } = readWorkspaceFile(cwd, ".omp/egc.json", { maxBytes: 131072 });
      contract = parseContract(JSON.parse(bytes.toString("utf8"))); contractSha = sha(bytes.toString("utf8"));
      stateDir = join(homedir(), ".omp", "egc", `${basename(cwd)}-${sha(cwd).slice(0, 8)}`); base = contract.base ?? "HEAD";
      // Model-controlled environment flags cannot approve a contract or native mutation.
      approved = existsSync(join(stateDir, "contract.lock")) && readFileSync(join(stateDir, "contract.lock"), "utf8").trim() === contractSha;
      restore(ctx); for (const path of watch()) integrity[path] = hashFile(path);
      await notify(ctx, `EGC ${contract.mode === "shadow" ? "SHADOW" : "active"}: ${ledger.debts.size} obligations; ${approved ? "contract locked" : "contract approval required (/egc lock)"}\n${lintContract(contract).join("\n")}`);
    } catch (error) { contract = null; await notify(ctx, `EGC UNAVAILABLE: ${egcBoundaryCode(error)}`, "error"); }
  });
  for (const event of ["session_branch", "session_tree", "session_resume", "session_shutdown"]) host.on(event, (_raw, ctx) => { if (contract) { ledger.revoke(); if (event !== "session_shutdown") restore(ctx); } });
  const template = { protected: DEF_PROTECTED, maxStalls: 2, maxContinuations: 3, uncontracted: "defaults", defaults: { verify: ["npm test"] }, requiredTasks: ["T1"], tasks: { T1: { title: "Example: add feature X", verify: ["npm test -- x.test.ts"], holdout: [], planFiles: ["src/x.ts"], requirements: ["X returns Y for Z"] } }, jev: { mode: "shadow", implMin: 0.5, stubMax: 0.5, tamperMax: 0.3 } };
  host.registerCommand("egc", { description: "EGC: status | init | lint | lock | approve <id> | reset <id> | selftest", async handler(args, ctx) {
    try {
      const [command = "status", ...rest] = args.trim().split(/\s+/), target = rest.join(" ");
      if (command === "init") {
        const path = join(ctx.cwd, ".omp", "egc.json"); if (existsSync(path)) return notify(ctx, "EGC: contract already exists", "warning");
        assertEgcIdentity("T1");
        const bytes = serializeEgcData(template);
        mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); return notify(ctx, "EGC: wrote .omp/egc.json; review and restart before /egc lock.");
      }
      if (!contract) return notify(ctx, "EGC inactive", "warning");
      if (command === "lock") { mkdirSync(stateDir, { recursive: true }); writeFileSync(join(stateDir, "contract.lock"), contractSha); approved = true; save(); return notify(ctx, "EGC: reviewed contract locked; native planner policy is unchanged."); }
      if (command === "approve") return notify(ctx, "EGC: assessment cannot be converted into native completion. Resolve evidence and use a fresh planner-authorized native operation.", "warning");
      if (command === "reset") {
        assertEgcIdentity(target); const tasks = [...ledger.debts.values()].filter((task) => task.content === target || idOf(task.content) === target);
        if (tasks.length !== 1) return notify(ctx, "EGC: exact unique obligation required.", "error");
        ledger.revoke(); tasks[0].lifecycle = "open"; tasks[0].stalls = 0; tasks[0].best = 1e9; save(); return notify(ctx, "EGC: obligation reopened; rejection history retained and fresh evidence required.");
      }
      if (command === "lint") return notify(ctx, lintContract(contract).join("\n") || "EGC contract lint: clean");
      if (command === "selftest") { const result = await askJev(ctx, { diff: "+ def add(a,b): return 3", requirements: { r1: "add returns a+b" } }, { q: "Does diff implement requirements.r1 with real general logic?" }); return notify(ctx, JSON.stringify(result)); }
      return notify(ctx, report());
    } catch (error) { return notify(ctx, `EGC UNAVAILABLE: ${egcBoundaryCode(error)}`, "error"); }
  } });
}
