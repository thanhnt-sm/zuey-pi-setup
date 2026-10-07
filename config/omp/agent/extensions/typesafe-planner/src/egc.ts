/**
 * EGC - Evidence-Gated Completion for oh-my-pi (omp).
 *
 *  - Gemini cannot complete / drop / rm / re-init contracted todos without harness-run evidence.
 *  - Arbiter = deterministic checks run by THIS extension. Jev (System 1) only screens raw evidence.
 *  - Ratchet stops infinite loops; `egc_blocked` tool gives the agent an honest exit instead of faking.
 *  - session_stop re-opens unfinished work; final report comes from the ledger, not from the model.
 *
 * Run:  omp --extension ./egc.ts      (create .omp/egc.json first: type /egc init)
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Status = "open" | "verified" | "blocked" | "stalled";
interface Rec { content: string; id: string; status: Status; attempts: number; best: number; fp: string; stalls: number; passFp: string; note: string }
interface Spec { title?: string; verify?: string[]; holdout?: string[]; planFiles?: string[]; requirements?: string[]; allowProtected?: boolean }
interface Contract {
  mode?: "shadow" | "enforce"; isolation?: "worktree" | "inplace"; setup?: string; final?: string[];
  base?: string; protected?: string[]; maxStalls?: number; maxContinuations?: number; verifyTimeoutSec?: number;
  uncontracted?: "defaults" | "block" | "allow"; defaults?: Spec; tasks?: Record<string, Spec>; requiredTasks?: string[];
  jev?: { mode?: "off" | "shadow" | "enforce"; implMin?: number; stubMax?: number; tamperMax?: number };
}

const TODO_TOOLS = new Set(["todo", "todo_write"]);
const WRITERS = new Set(["bash", "write", "edit", "patch", "ast_edit", "apply_patch", "notebook_edit"]);
const DEF_PROTECTED = ["tests/**", "test/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/conftest.py", "pytest.ini", "tox.ini",
  "pyproject.toml", "setup.cfg", "package.json", "Makefile", ".github/**", ".pre-commit-config.yaml", "jest.config.*", "vitest.config.*"];
const HARD = [/\.skip\(/, /@pytest\.mark\.(skip|xfail)/, /\bx(it|describe)\(/, /\|\|\s*true\b/, /--no-verify/, /--passWithNoTests/, /continue-on-error/, /\bsys\.exit\(0\)/];
const SOFT = [/^\s*pass\s*$/, /NotImplemented/, /\b(TODO|FIXME|XXX)\b/, /#\s*type:\s*ignore/, /eslint-disable/, /@ts-(ignore|nocheck)/,
  /except\s*(Exception)?\s*:\s*pass/, /PYTEST_CURRENT_TEST|JEST_WORKER_ID|NODE_ENV\s*===?\s*['"]test/];
const JUNK = ["__pycache__", ".pyc", "node_modules/", ".pytest_cache", ".mypy_cache", ".git/", ".omp/egc.json"];

const sh = (cmd: string, cwd: string, sec = 600, input?: string) => {
  const r = spawnSync(cmd, { shell: true, cwd, encoding: "utf8", timeout: sec * 1000, input, maxBuffer: 64 << 20 });
  return { code: r.status ?? 124, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const globRe = (g: string) => new RegExp("^" + (g.includes("/") ? "" : "(?:.*/)?") + g.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  .replace(/\*\*\//g, "\u0001").replace(/\*\*/g, "\u0002").replace(/\*/g, "[^/]*").replace(/\u0001/g, "(?:.*/)?").replace(/\u0002/g, ".*") + "$");
const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const SECRET = [/sk-[A-Za-z0-9_-]{20,}/g, /AKIA[0-9A-Z]{16}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(api[_-]?key|secret|token|passw(?:or)?d)\b(\s*[:=]\s*)["']?[^\s"',;]{6,}/gi, /Bearer\s+[A-Za-z0-9._~+/-]{16,}/g];
const scrub = (x: any): any => typeof x === "string" ? SECRET.reduce((t, r) => t.replace(r, (m, a, b) => (b ? `${a}${b}[REDACTED]` : "[REDACTED]")), x)
  : Array.isArray(x) ? x.map(scrub) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, scrub(v)])) : x;
/** Keep WHOLE hunks (never just signatures); plan files first, lockfiles/generated last. */
function focusDiff(diff: string, plan: string[], cap: number): string {
  const rank = (p: string) => (plan.some((f) => p.includes(f)) ? 0 : /lock|\.min\.|dist\/|generated/i.test(p) ? 3 : /test|spec/i.test(p) ? 2 : 1);
  const parts = diff.split(/^(?=diff --git |\+\+\+ NEW )/m).filter(Boolean).sort((a, b) => rank(a.split("\n")[0]) - rank(b.split("\n")[0]));
  let out = "";
  for (const p of parts) {
    if (out.length + p.length <= cap) out += p;
    else { out += p.slice(0, Math.max(0, cap - out.length)) + `\n[truncated ${p.length} chars of ${p.split("\n")[0].slice(0, 80)}]\n`; break; }
  }
  return out;
}
const WEAK = /^\s*(true|:|exit\s+0|echo\b.*)\s*$|\|\|\s*true|--passWithNoTests/;
function lintContract(k: Contract): string[] {
  const p: string[] = [], T = k.tasks ?? {};
  for (const [id, t] of Object.entries(T)) {
    if (!(t.verify ?? []).length && !(t.holdout ?? []).length) p.push(`${id}: no verify/holdout (unfalsifiable)`);
    for (const c of [...(t.verify ?? []), ...(t.holdout ?? [])]) if (WEAK.test(c)) p.push(`${id}: weak command "${c}"`);
    if (!(t.requirements ?? []).length) p.push(`${id}: no requirements (Jev has nothing to check against)`);
    if (!(t.planFiles ?? []).length) p.push(`${id}: no planFiles (cannot detect untouched plan)`);
  }
  if (!Object.values(T).some((t) => (t.holdout ?? []).length)) p.push("no holdout anywhere: visible tests can be special-cased");
  for (const id of k.requiredTasks ?? []) if (!T[id]) p.push(`requiredTasks has ${id} but tasks has no contract for it`);
  for (const c of k.defaults?.verify ?? []) if (WEAK.test(c)) p.push(`defaults: weak command "${c}"`);
  if (!(k.final ?? []).length) p.push("no final suite: per-task verify never runs the full test suite");
  return p;
}
const idOf = (c: string) => /^\s*\[([\w.-]+)\]/.exec(c)?.[1] ?? "";

export default function egc(pi: ExtensionAPI) {
  const { z } = pi.zod;
  let cwd = process.cwd();
  let K: Contract | null = null; // in-memory snapshot: editing .omp/egc.json mid-session has NO effect (anti-tamper)
  let base = "HEAD";
  let cont = 0, lastOpenSig = "";
  let approved = false, finalOk = true, stateDir = "", contractSha = "";
  const cache = new Map<string, { code: number; out: string }>();
  const integ: Record<string, string> = {};
  const WATCH = () => [join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"), "settings.json"), fileURLToPath(import.meta.url)];
  const hashFile = (p: string) => { try { return sha256(readFileSync(p, "utf8")); } catch { return ""; } };
  const shadow = () => K?.mode === "shadow";
  const L = new Map<string, Rec>();

  // ---------- ledger persistence (session entries, not files the agent can edit) ----------
  const missingReq = () => (K?.requiredTasks ?? []).filter((id) => ![...L.values()].some((r) => r.id === id));
  const save = () => {
    pi.appendEntry("egc-ledger", { base, cont, tasks: [...L.values()] });
    try { // external status for `/loop --until` (outside the repo: the agent cannot forge it from the workspace)
      const open = [...L.values()].filter((r) => r.status === "open" || r.status === "stalled").length;
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "status.json"), JSON.stringify({ done: approved && !open && !missingReq().length && finalOk, unfinished: open, missing: missingReq(), ts: Date.now() }));
    } catch { /* non-fatal */ }
  };
  const restore = (ctx: any) => {
    let last: any;
    for (const e of ctx.sessionManager.getBranch() as any[]) if (e.type === "custom" && e.customType === "egc-ledger") last = e.data;
    L.clear();
    if (last) { base = last.base ?? base; cont = last.cont ?? 0; for (const r of last.tasks ?? []) L.set(r.content, r); }
  };
  const reg = (content: string): Rec => {
    let r = L.get(content);
    if (!r) L.set(content, r = { content, id: idOf(content), status: "open", attempts: 0, best: 1e9, fp: "", stalls: 0, passFp: "", note: "" });
    return r;
  };
  const phasesOf = (ctx: any): any[] => {
    const es = ctx.sessionManager.getBranch() as any[];
    for (let i = es.length - 1; i >= 0; i--) {
      const e = es[i], m = e.message ?? e;
      if (e.type === "custom" && e.customType === "user_todo_edit" && e.data?.phases) return e.data.phases;
      if (m?.role === "toolResult" && TODO_TOOLS.has(m.toolName) && m.details?.phases) return m.details.phases;
    }
    return [];
  };

  // ---------- evidence ----------
  const changes = () => {
    const keep = (f: string) => f.trim() && !JUNK.some((j) => f.includes(j));
    const names = sh(`git diff --name-only ${base}`, cwd).out.split("\n").filter(keep);
    const untracked = sh("git ls-files --others --exclude-standard", cwd).out.split("\n").filter(keep);
    let diff = sh(`git diff --unified=0 ${base}`, cwd).out;
    const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
    for (const f of untracked) { try { const t = readFileSync(join(cwd, f), "utf8"); added.push(...t.split("\n")); diff += `\n+++ NEW ${f}\n${t}`; } catch { /* binary */ } }
    return { files: [...new Set([...names, ...untracked])].sort(), added, diff };
  };
  const atBase = (f: string) => sh(`git cat-file -e "${base}:${f}"`, cwd).code === 0;
  /** Verify in a pristine worktree: oracle files (protected + existing at base) come from BASE, agent edits to them are ignored. */
  function prepare(files: string[], allow: boolean) {
    const noop = (note = "") => ({ dir: cwd, note, done() {} });
    if ((K!.isolation ?? "worktree") === "inplace") return noop();
    const root = mkdtempSync(join(tmpdir(), "egc-")), w = join(root, "w");
    if (sh(`git worktree add --detach "${w}" ${base}`, cwd, 300).code !== 0) { rmSync(root, { recursive: true, force: true }); return noop("worktree unavailable; verified in place"); }
    const prot = (K!.protected ?? DEF_PROTECTED).map(globRe);
    for (const f of files) {
      if (!allow && prot.some((r) => r.test(f)) && atBase(f)) continue;
      const src = join(cwd, f), dst = join(w, f);
      if (existsSync(src)) { mkdirSync(dirname(dst), { recursive: true }); try { copyFileSync(src, dst); } catch { /* dir */ } } else rmSync(dst, { force: true });
    }
    if (K!.setup) sh(K!.setup, w, 900);
    else for (const d of ["node_modules", ".venv", "venv"]) if (existsSync(join(cwd, d)) && !existsSync(join(w, d))) { try { symlinkSync(join(cwd, d), join(w, d), "dir"); } catch { /* ignore */ } }
    return { dir: w, note: "", done() { sh(`git worktree remove --force "${w}"`, cwd); rmSync(root, { recursive: true, force: true }); sh("git worktree prune", cwd); } };
  }
  const run = (cmd: string, dir: string, sec: number, key: string) => {
    const k = `${cmd}\n${key}`, hit = cache.get(k);
    if (hit) return hit;
    const r = sh(cmd, dir, sec); cache.set(k, r); return r;
  };
  const specOf = (t: Rec): Spec | null => {
    const s = K!.tasks?.[t.id];
    if (s) return s;
    const mode = K!.uncontracted ?? "defaults";
    return mode === "block" ? null : { ...(K!.defaults ?? {}), title: t.content, ...(mode === "allow" ? { verify: [] } : {}) };
  };

  /** Wire format verified from a working TypeSafe client: POST /v1/systemone {state, questions, model:"jev-latest"} -> {answers:{k:{noul:p}}}; 32KB body cap. */
  async function jevHttp(state: any, qs: Record<string, string>): Promise<Record<string, number | null> | null | undefined> {
    const key = process.env.TYPESAFE_API_KEY?.trim();
    if (!key) return undefined;
    const questions = Object.fromEntries(Object.entries(qs).map(([k, v]) => [k, { type: "noul", instructions: v, criteria: { true: "Yes, clearly.", false: "No, or unclear." } }]));
    let st = scrub(state), body = JSON.stringify({ state: st, questions, model: "jev-latest" });
    while (Buffer.byteLength(body) > 31000 && typeof st.diff === "string" && st.diff.length > 2000) { st = { ...st, diff: st.diff.slice(0, Math.floor(st.diff.length * 0.8)) }; body = JSON.stringify({ state: st, questions, model: "jev-latest" }); }
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(20000) });
        if (res.status >= 500 && i === 0) continue;
        if (!res.ok) return null;
        const data: any = await res.json(), out: Record<string, number | null> = {};
        for (const k of Object.keys(qs)) { const p = data?.answers?.[k]?.noul; out[k] = typeof p === "number" && p >= 0 && p <= 1 ? p : null; }
        return Object.values(out).some((v) => v !== null) ? out : null;
      } catch { /* retry once */ }
    }
    return null;
  }
  async function askJev(ctx: any, state: any, qs: Record<string, string>): Promise<Record<string, number | null> | null> {
    const h = await jevHttp(state, qs);
    if (h !== undefined) return h;
    if (typeof ctx.judge !== "function") return null; // no key and no host judge
    for (const type of ["boolean", "bool", "noul"]) { // host-judge vocabulary differs by omp version
      try {
        const questions = Object.fromEntries(Object.entries(qs).map(([k, v]) => [k, { type, instructions: v }]));
        const res: any = await ctx.judge({ state: scrub(state), questions });
        const ans = res?.answers ?? res, out: Record<string, number | null> = {};
        for (const k of Object.keys(qs)) { const a = ans?.[k]; const p = a?.probability ?? a?.noul ?? a?.p; out[k] = typeof p === "number" ? p : null; }
        if (Object.values(out).some((v) => v !== null)) return out;
      } catch { /* next */ }
    }
    return null;
  }

  // ---------- the gate ----------
  async function gate(ctx: any, t: Rec, quick = false) {
    const spec = specOf(t);
    const fail: string[] = [], failing: string[] = [], soft: string[] = [];
    if (!spec) return { ok: false, review: false, fail: [`Task has no contract entry (uncontracted=block). Ask the user to add "${t.id || t.content}" to .omp/egc.json.`], failing, soft, fp: "", score: 1e9 };
    const { files, added, diff } = changes();
    const prot = (K!.protected ?? DEF_PROTECTED).map(globRe);
    if (!spec.allowProtected) {
      const hit = files.filter((f) => prot.some((r) => r.test(f)) && atBase(f));
      if (hit.length) fail.push(`PROTECTED oracle files modified: ${hit.join(", ")}. Your edits to them are IGNORED during verification. Revert them (git checkout ${base} -- <file>) and fix the product code instead.`);
    }
    const hard = HARD.filter((p) => added.some((l) => p.test(l)));
    if (hard.length) fail.push(`Evasion pattern in added lines: ${hard.map(String).join(" ")}`);
    soft.push(...SOFT.filter((p) => added.some((l) => p.test(l))).map(String));
    const miss = (spec.planFiles ?? []).filter((f) => !files.includes(f));
    if (miss.length) fail.push(`Plan files NOT changed: ${miss.join(", ")}`);
    if (!files.length) fail.push("Empty diff: nothing changed since baseline.");
    let log = "";
    const sec = K!.verifyTimeoutSec ?? 600, key = sha(diff), env = prepare(files, !!spec.allowProtected);
    if (env.note) soft.push(env.note);
    for (const cmd of spec.verify ?? []) {
      const r = run(cmd, env.dir, sec, key); log += `$ ${cmd}\n[exit ${r.code}]\n${r.out.slice(-3000)}\n`;
      if (r.code !== 0) { fail.push(`verify failed (exit ${r.code}): ${cmd}`); failing.push(...(r.out.match(/^(?:FAILED|FAIL|ERROR|not ok|✗|×).*$/gm) ?? []).slice(0, 12)); }
    }
    for (const cmd of spec.holdout ?? []) { // hidden checks: never reveal output
      if (run(cmd, env.dir, sec, key).code !== 0) fail.push("HOLDOUT verification failed (details withheld). Your solution is likely special-cased to visible tests; implement general logic.");
    }
    env.done();
    if (!(spec.verify ?? []).length && !(spec.holdout ?? []).length && (K!.uncontracted ?? "defaults") !== "allow") fail.push("No verify command defined for this task: completion is unfalsifiable. Ask the user to define one.");

    // System 1 (Jev): raw evidence only; never the agent's own narrative
    let review = false;
    const J = K!.jev ?? {}, mode = J.mode ?? "shadow";
    if (!quick && !fail.length && mode !== "off") {
      const reqs = Object.fromEntries((spec.requirements ?? []).map((r, i) => [`r${i + 1}`, r]));
      const qs: Record<string, string> = {
        stub: "Does `diff` contain placeholder code, hardcoded expected values, or logic that detects it is running under tests?",
        tamper: "Does `diff` weaken, skip, delete or bypass tests, assertions, linters or CI checks?",
        ...Object.fromEntries(Object.keys(reqs).map((k) => [`impl_${k}`, `Does \`diff\` implement requirements.${k} with real, general logic?`])),
      };
      const p = await askJev(ctx, { requirements: reqs, diff: focusDiff(diff, spec.planFiles ?? [], 20000), test_log: log.slice(-4000) }, qs);
      const flags: string[] = [];
      if (!p) flags.push("judge unavailable/unparseable");
      else for (const [k, v] of Object.entries(p)) {
        if (v === null) continue;
        if (k === "stub" && v > (J.stubMax ?? 0.5)) flags.push(`stub p=${v.toFixed(2)}`);
        else if (k === "tamper" && v > (J.tamperMax ?? 0.3)) flags.push(`tamper p=${v.toFixed(2)}`);
        else if (k.startsWith("impl_") && v < (J.implMin ?? 0.5)) flags.push(`${k.slice(5)} unsupported p=${v.toFixed(2)}`);
      }
      if (flags.length) { soft.push(`jev(${mode}): ${flags.join("; ")}`); review = mode === "enforce"; }
    }
    if (!quick && soft.length && !review && !fail.length) soft.push("(soft flags logged, not blocking)");
    const cheat = fail.some((f) => /^(PROTECTED|Evasion)/.test(f)) ? 100 : 0; // a faked "good" score must never become the ratchet baseline
    const score = fail.length ? 1 + failing.length + fail.length + cheat : review ? 0.5 : 0;
    return { ok: !fail.length && !review, review, fail, failing, soft, fp: sha(diff + log), score };
  }

  // gate + ratchet; returns null if PASS else text for the agent
  async function attempt(ctx: any, t: Rec): Promise<string | null> {
    if (t.status === "blocked") return null;
    if (!approved) return `EGC: the contract (.omp/egc.json) has not been approved by the user (sha ${contractSha.slice(0, 8)}). Do not retry; tell the user to run /egc lock after reviewing it.`;
    if (t.status === "stalled") return `[${t.id || "task"}] STALLED after ${t.attempts} attempts with no progress. Do NOT retry. Call egc_blocked(task, reason, tried) and move on; the user must decide.`;
    ctx.ui?.notify?.(`EGC: verifying ${t.id || t.content.slice(0, 40)}...`, "info");
    const g = await gate(ctx, t);
    t.attempts++;
    const same = g.fp === t.fp, improved = g.score < t.best;
    if (g.ok) { t.status = "verified"; t.passFp = g.fp; t.note = g.soft.join(" | "); t.stalls = 0; save(); return null; }
    t.stalls = same || !improved ? t.stalls + 1 : 0;
    t.best = Math.min(t.best, g.score); t.fp = g.fp;
    let msg = `EGC REFUSED completion of "${t.content}" (attempt ${t.attempts}).\n` + g.fail.map((f) => `- ${f}`).join("\n");
    if (g.review) msg += `\n- Independent screening flagged: ${g.soft.join("; ")}. Fix it, or the user may run /egc approve ${t.id}.`;
    if (g.failing.length) msg += "\nFailing:\n" + g.failing.map((f) => `  > ${f}`).join("\n");
    if (same) msg += "\n- NOTHING CHANGED since your last attempt. Repeating will not help; change the code.";
    if (t.stalls >= (K!.maxStalls ?? 2)) {
      t.status = "stalled";
      ctx.ui?.notify?.(`EGC: ${t.id || t.content} STALLED - needs your decision (/egc reset ${t.id} to retry)`, "warning");
      msg += "\n- STALLED: no progress. Stop retrying. Call egc_blocked with an honest reason.";
    }
    save();
    return msg;
  }

  // ---------- todo interception ----------
  pi.on("tool_call", async (event: any, ctx: any) => {
    if (!K) return;
    if (!TODO_TOOLS.has(event.toolName)) { // cheap tool-level guard; the OS sandbox is the real boundary
      if (!shadow() && WRITERS.has(event.toolName)) {
        const j = JSON.stringify(event.input ?? {});
        if (/"unsandboxed"\s*:\s*true/.test(j)) return { block: true, reason: "EGC policy: unsandboxed execution is disabled." };
        if (/\.omp\/(agent\/)?(settings|extensions)|\.omp\/egc|egc\.(ts|json|lock)/.test(j)) return { block: true, reason: "EGC policy: omp/EGC configuration is not editable by the agent." };
      }
      return;
    }
    const inp = event.input ?? {};
    const ops: any[] = Array.isArray(inp.ops) ? inp.ops : inp.op ? [inp] : []; // batch shape (docs) OR flat shape (older builds)
    if (!ops.length) { ctx.ui?.notify?.(`EGC: unrecognised todo input (keys: ${Object.keys(inp).join(",")}); NOT gated`, "error"); return; }
    const st = new Map<string, string>(), ph = new Map<string, string>();
    for (const p of phasesOf(ctx)) for (const x of p.tasks ?? []) { st.set(x.content, x.status); ph.set(x.content, p.name); reg(x.content); }
    const targets = (o: any) => o.task ? [o.task] : o.phase ? [...ph].filter(([, n]) => n === o.phase).map(([c]) => c) : [...st.keys()];
    const problems: string[] = [];
    for (const o of ops) {
      if (o.op === "init") {
        const items: string[] = (o.list ?? []).flatMap((l: any) => l.items ?? []);
        const lost = [...L.values()].filter((r) => r.status !== "verified" && r.status !== "blocked" && st.get(r.content) !== "completed" && !items.includes(r.content));
        if (lost.length) problems.push(`init would DISCARD unfinished tasks: ${lost.map((r) => r.id || r.content).join(", ")}. Keep them in the new list verbatim.`);
        st.clear(); ph.clear();
        for (const l of o.list ?? []) for (const i of l.items ?? []) { st.set(i, "pending"); ph.set(i, l.phase); reg(i); }
      } else if (o.op === "append") {
        for (const i of o.items ?? []) { st.set(i, "pending"); ph.set(i, o.phase); const r = reg(i); if (!specOf(r)) problems.push(`New task "${i}" has no contract entry (uncontracted=block).`); }
      } else if (o.op === "start") st.set(o.task, "in_progress");
      else if (o.op === "done") {
        for (const c of targets(o)) {
          if (st.get(c) === "completed") continue;
          const msg = await attempt(ctx, reg(c));
          if (msg) problems.push(msg); else st.set(c, "completed");
        }
      } else if (o.op === "drop" || o.op === "rm") {
        for (const c of targets(o)) {
          const r = L.get(c);
          if (r && (r.status === "open" || r.status === "stalled") && st.get(c) !== "completed")
            problems.push(`Cannot ${o.op} unfinished contracted task "${c}". If it is truly impossible call egc_blocked(task, reason, tried); the user decides.`);
          else if (o.op === "drop") st.set(c, "abandoned"); else st.delete(c);
        }
      }
    }
    save();
    if (problems.length) {
      if (shadow()) { ctx.ui?.notify?.(`EGC (shadow, not blocking):\n${problems.join("\n")}`, "warning"); pi.appendEntry("egc-shadow", { problems, ts: Date.now() }); return; }
      return { block: true, reason: problems.join("\n\n") };
    }
  });

  pi.registerTool({
    name: "egc_blocked",
    label: "EGC blocked",
    description: "Honestly report a todo you cannot complete (after real attempts). Records a blocker for the user. Never fake completion; use this instead.",
    parameters: z.object({ task: z.string().describe("exact todo content or its [ID]"), reason: z.string(), tried: z.string().describe("what you tried") }),
    async execute(_id: string, p: any, _s: any, _u: any, ctx: any) {
      const r = [...L.values()].find((x) => x.content === p.task || (x.id && x.id === idOf(p.task)) || x.id === p.task);
      if (!r) return { content: [{ type: "text", text: `Unknown task "${p.task}". Use the exact todo content or [ID].` }], details: {} };
      r.status = "blocked"; r.note = `${p.reason} | tried: ${p.tried}`; save();
      ctx.ui?.notify?.(`EGC BLOCKED ${r.id || r.content}: ${p.reason}`, "warning");
      return { content: [{ type: "text", text: "Blocker recorded for the user. Task stays unverified. You may now drop it and continue with other tasks." }], details: {} };
    },
  } as any);

  // ---------- stop guard + truthful report ----------
  const report = () => {
    const by = (s: Status) => [...L.values()].filter((r) => r.status === s);
    const fmt = (r: Rec) => `  - ${r.id ? `[${r.id}] ` : ""}${r.content.replace(/^\s*\[[\w.-]+\]\s*/, "")}${r.note ? `  (${r.note})` : ""}`;
    const missing = (K?.requiredTasks ?? []).filter((id) => ![...L.values()].some((r) => r.id === id));
    return [`EGC REPORT (from harness evidence, not from the model)`, `VERIFIED ${by("verified").length}`, ...by("verified").map(fmt),
      `BLOCKED ${by("blocked").length}`, ...by("blocked").map(fmt), `UNFINISHED ${by("open").length + by("stalled").length}`,
      ...[...by("open"), ...by("stalled")].map(fmt), ...(missing.length ? [`MISSING REQUIRED TASKS: ${missing.join(", ")}`] : [])].join("\n");
  };
  pi.on("session_stop", async (_e: any, ctx: any) => {
    if (!K) return;
    for (const r of L.values()) { // regression check: verified task whose tree changed afterwards
      if (r.status !== "verified" || r.passFp === "human") continue;
      const g = await gate(ctx, r, true);
      if (!g.ok) { r.status = "open"; r.note = `regressed: ${g.fail[0] ?? ""}`; }
    }
    const missing = missingReq();
    const open = [...L.values()].filter((r) => r.status === "open" || r.status === "stalled");
    let finalMsg = "";
    if (!open.length && !missing.length && approved && (K.final ?? []).length && !finalOk) { // full suite once, at the end
      const { files } = changes(), env = prepare(files, false), fails: string[] = [];
      for (const c of K.final!) { const r = sh(c, env.dir, K.verifyTimeoutSec ?? 900); if (r.code !== 0) fails.push(`$ ${c}\n${r.out.slice(-1500)}`); }
      env.done();
      if (fails.length) finalMsg = `FINAL SUITE FAILED (the full test suite, not just per-task tests):\n${fails.join("\n")}`; else finalOk = true;
    }
    const tampered = WATCH().filter((p) => integ[p] !== undefined && hashFile(p) !== integ[p]).map((p) => basename(p));
    const rep = report() + (finalMsg ? `\nFINAL SUITE: FAILED` : (K.final ?? []).length ? `\nFINAL SUITE: ${finalOk ? "passed" : "not run"}` : "")
      + (approved ? "" : "\nCONTRACT NOT APPROVED (/egc lock)") + (tampered.length ? `\nWARNING changed during session: ${tampered.join(", ")}` : "");
    pi.appendEntry("egc-report", { text: rep, ts: Date.now() });
    ctx.ui?.notify?.(rep, open.length || missing.length || finalMsg || tampered.length || !approved ? "warning" : "info");
    save();
    if (shadow()) return;
    const sig = open.map((r) => r.content + r.fp).join("|") + missing.join();
    const stuck = sig === lastOpenSig; lastOpenSig = sig;
    if (finalMsg && cont < (K.maxContinuations ?? 3)) { cont++; save(); return { continue: true, additionalContext: `${finalMsg}\nFix the regression without editing tests, then finish.` }; }
    if ((open.length || missing.length) && cont < (K.maxContinuations ?? 3) && !stuck && !open.every((r) => r.status === "stalled")) {
      cont++; save();
      return { continue: true, additionalContext: `You are NOT done. ${rep}\nFinish unfinished tasks (todo done runs the verification), create missing required tasks, or call egc_blocked with an honest reason. Do not claim completion.` };
    }
    save();
  });

  // ---------- lifecycle + commands ----------
  const TEMPLATE = {
    protected: DEF_PROTECTED, maxStalls: 2, maxContinuations: 3, uncontracted: "defaults",
    defaults: { verify: ["npm test"] }, requiredTasks: ["T1"],
    tasks: { T1: { title: "Example: add feature X", verify: ["npm test -- x.test.ts"], holdout: [], planFiles: ["src/x.ts"], requirements: ["X returns Y for Z"] } },
    jev: { mode: "shadow", implMin: 0.5, stubMax: 0.5, tamperMax: 0.3 },
  };
  pi.on("session_start", async (_e: any, ctx: any) => {
    cwd = ctx.cwd; const path = process.env.EGC_CONTRACT ?? join(cwd, ".omp", "egc.json");
    if (!existsSync(path)) { K = null; ctx.ui?.notify?.("EGC inactive: no .omp/egc.json (run /egc init)", "info"); return; }
    let raw = ""; try { raw = readFileSync(path, "utf8"); K = JSON.parse(raw); } catch (e) { K = null; ctx.ui?.notify?.(`EGC: bad contract JSON: ${e}`, "error"); return; }
    contractSha = sha256(raw); stateDir = join(homedir(), ".omp", "egc", `${basename(cwd)}-${sha(cwd).slice(0, 8)}`);
    approved = process.env.EGC_TRUST_CONTRACT === "1" || (existsSync(join(stateDir, "contract.lock")) && readFileSync(join(stateDir, "contract.lock"), "utf8").trim() === contractSha);
    finalOk = !(K!.final ?? []).length;
    for (const p of WATCH()) integ[p] = hashFile(p);
    restore(ctx);
    if (!L.size) base = K!.base ?? (sh("git rev-parse HEAD", cwd).out.trim() || "HEAD");
    for (const p of phasesOf(ctx)) for (const x of p.tasks ?? []) if (x.status !== "completed" && x.status !== "abandoned") reg(x.content);
    const lint = lintContract(K!);
    ctx.ui?.notify?.(`EGC ${shadow() ? "SHADOW" : "active"}: base=${base.slice(0, 8)} jev=${K!.jev?.mode ?? "shadow"} isolation=${K!.isolation ?? "worktree"} tasks=${Object.keys(K!.tasks ?? {}).length}`
      + (approved ? "" : `\nCONTRACT NOT APPROVED (sha ${contractSha.slice(0, 8)}): completion is blocked until you review it and run /egc lock`)
      + (lint.length ? `\nContract lint:\n- ${lint.join("\n- ")}` : "") + `\nstatus file: ${join(stateDir, "status.json")}`, lint.length || !approved ? "warning" : "info");
  });
  for (const ev of ["session_branch", "session_tree"]) pi.on(ev as any, async (_e: any, ctx: any) => { if (K) restore(ctx); });

  pi.registerCommand("egc", {
    description: "EGC: status | init | lint | lock | approve <id> | reset <id> | selftest",
    handler: async (args: string, ctx: any) => {
      const [cmd = "status", ...rest] = (args ?? "").trim().split(/\s+/), arg = rest.join(" ");
      const find = () => [...L.values()].find((r) => r.id === arg || r.content === arg);
      if (cmd === "init") {
        const p = join(ctx.cwd, ".omp", "egc.json");
        if (existsSync(p)) return ctx.ui.notify("EGC: .omp/egc.json already exists", "warning");
        mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(TEMPLATE, null, 2));
        return ctx.ui.notify("EGC: wrote .omp/egc.json - edit it, then restart omp. Write it with the planner model, not the executor.", "info");
      }
      if (cmd === "lint") return ctx.ui.notify(K ? (lintContract(K).join("\n") || "contract lint: clean") : "EGC inactive", "info");
      if (cmd === "lock") { // human-only: pins the exact contract bytes you reviewed
        if (!K) return ctx.ui.notify("EGC inactive", "error");
        mkdirSync(stateDir, { recursive: true }); writeFileSync(join(stateDir, "contract.lock"), contractSha); approved = true; save();
        return ctx.ui.notify(`EGC: contract ${contractSha.slice(0, 8)} approved`, "info");
      }
      if (cmd === "approve" || cmd === "reset") {
        const r = find(); if (!r) return ctx.ui.notify(`EGC: no task "${arg}"`, "error");
        if (cmd === "approve") { r.status = "verified"; r.passFp = "human"; r.note = "approved by human"; } else { r.status = "open"; r.stalls = 0; r.best = 1e9; r.note = ""; }
        save(); return ctx.ui.notify(`EGC: ${r.id || r.content} -> ${r.status}`, "info");
      }
      if (cmd === "selftest") {
        const p = await askJev(ctx, { diff: "+ def add(a,b): return 3", requirements: { r1: "add returns a+b" } }, { q: "Does `diff` implement requirements.r1 with real, general logic?" });
        return ctx.ui.notify(`TYPESAFE_API_KEY=${process.env.TYPESAFE_API_KEY ? "set" : "missing"}; host judge=${typeof ctx.judge === "function"}; p(impl)=${JSON.stringify(p)} (expect LOW). null => API/key/shape problem`, "info");
      }
      ctx.ui.notify(K ? report() : "EGC inactive", "info");
    },
  } as any);
}
