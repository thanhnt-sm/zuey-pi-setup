/**
 * omp-toolkit-hub.ts — Hybrid OMP Extension bridging Priority-100 domain skills,
 * native omp_* tools, /harvest-loop, /omp-doctor, and session checkpoint continuity.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDomainTools } from "./omp-toolkit-hub/domain-tools";
import { notifyUi, registerHubCommands } from "./omp-toolkit-hub/hub-commands";
import {
  readLedgerSummary,
  readLoopCheckpoint,
  resolveCheckpointPath,
  resolveLedgerPath,
  runDoctorCli,
  runHarvesterCli,
  writeLoopCheckpoint,
  type ToolkitHubOptions,
} from "./omp-toolkit-hub/loop-state";

interface ZodBuilder {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { optional: () => unknown };
  boolean: () => { optional: () => unknown };
}

function getZod(pi: ExtensionAPI): ZodBuilder | null {
  if (typeof pi !== "object" || pi === null || !("zod" in pi)) return null;
  const z = (pi as { zod?: unknown }).zod;
  if (typeof z === "object" && z !== null && "object" in z && "string" in z && "boolean" in z) return z as ZodBuilder;
  return null;
}

// notifyUi is exported from ./omp-toolkit-hub/hub-commands

function makeParameters(pi: ExtensionAPI, mode: "status" | "extract" | "harvest"): unknown {
  const z = getZod(pi);
  if (z) {
    if (mode === "status") return z.object({ runNext: z.boolean().optional(), triggerScan: z.boolean().optional(), diffGlobal: z.boolean().optional() });
    if (mode === "extract") return z.object({ hash: z.string(), outDir: z.string().optional() });
    return z.object({ action: z.string(), hash: z.string().optional(), outDir: z.string().optional(), disposition: z.string().optional(), suite: z.string().optional(), target: z.string().optional(), diffGlobal: z.boolean().optional(), includeNoise: z.boolean().optional() });
  }
  if (mode === "status") return { type: "object", properties: { runNext: { type: "boolean" }, triggerScan: { type: "boolean" }, diffGlobal: { type: "boolean" } } };
  if (mode === "extract") return { type: "object", properties: { hash: { type: "string" }, outDir: { type: "string" } }, required: ["hash"] };
  return { type: "object", properties: { action: { type: "string" }, hash: { type: "string" }, outDir: { type: "string" }, disposition: { type: "string" }, suite: { type: "string" }, target: { type: "string" }, diffGlobal: { type: "boolean" }, includeNoise: { type: "boolean" } }, required: ["action"] };
}

function saveSnapshotCheckpoint(opts?: ToolkitHubOptions, cwd?: string): Record<string, unknown> {
  const ledgerPath = resolveLedgerPath(opts, cwd);
  const ckptPath = resolveCheckpointPath(opts);
  const info = readLedgerSummary(ledgerPath);
  const nextUnit = "nextUnit" in info && typeof info.nextUnit === "object" ? (info.nextUnit as Record<string, unknown> | null) : null;
  const summary = "summary" in info && typeof info.summary === "object" && info.summary !== null ? (info.summary as Record<string, unknown>) : {};
  writeLoopCheckpoint(ckptPath, { updatedAt: new Date().toISOString(), ledgerStatus: String(info.status ?? "UNKNOWN"), nextUnit, summary });
  return info;
}

function parseJsonOrRaw(r: { ok: boolean; stdout: string; stderr: string }, fallback: Record<string, unknown>) {
  if (!r.ok) return { ok: false, error: r.stderr || r.stdout || "command failed" };
  try {
    const parsed: unknown = JSON.parse(r.stdout);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  return { ...fallback, raw: r.stdout };
}

export default function registerToolkitHub(pi: ExtensionAPI, opts?: ToolkitHubOptions): void {
  registerHubCommands(pi, opts, saveSnapshotCheckpoint);

  registerDomainTools(pi, opts);

  if (typeof pi.registerTool === "function") {
    pi.registerTool({
      name: "omp_harvest_status",
      label: "OMP Harvest Status",
      description: "Read incremental harvester loop ledger status, summary metrics, and optionally run --scan / --next.",
      parameters: makeParameters(pi, "status") as never,
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const ledgerPath = resolveLedgerPath(opts);
          if (params?.triggerScan) {
            const cliArgs = ["--scan", "--ledger", ledgerPath];
            if (params.diffGlobal) cliArgs.push("--diff-global");
            runHarvesterCli(cliArgs, opts);
          }
          const info = saveSnapshotCheckpoint(opts);
          return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }], details: info };
        } catch (err) {
          const fallback = { status: "ERROR", error: err instanceof Error ? err.message : String(err) };
          return { content: [{ type: "text", text: JSON.stringify(fallback) }], details: fallback };
        }
      },
    });

    pi.registerTool({
      name: "omp_extract_cluster",
      label: "OMP Extract Cluster",
      description: "Recover full original code for a harvested cluster hash from indexed session transcripts.",
      parameters: makeParameters(pi, "extract") as never,
      execute: async (_id: string, params: Record<string, unknown>) => {
        const hash = String(params?.hash || "").trim();
        const outDir = String(params?.outDir || "extracted_clusters").trim();
        if (!hash) return { content: [{ type: "text", text: '{"ok":false,"error":"hash parameter is required"}' }], details: { ok: false, error: "hash parameter is required" } };
        const r = runHarvesterCli(["--extract", hash, "--out", outDir, "--ledger", resolveLedgerPath(opts)], opts);
        const out = parseJsonOrRaw(r, { ok: true, hash, outDir });
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], details: out };
      },
    });

    pi.registerTool({
      name: "omp_harvest",
      label: "OMP Harvester Loop Controller",
      description: "Unified V4 harvester loop action controller (status, scan, next, round-summary, extract, stage, commit-stage, triage).",
      parameters: makeParameters(pi, "harvest") as never,
      execute: async (_id: string, params: Record<string, unknown>) => {
        const action = String(params?.action || "status").trim();
        const ledgerPath = resolveLedgerPath(opts);
        if (action === "status") {
          const info = saveSnapshotCheckpoint(opts);
          return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }], details: info };
        }
        const args = ["--ledger", ledgerPath];
        if (action === "scan") { args.push("--scan"); if (params.diffGlobal) args.push("--diff-global"); if (params.includeNoise) args.push("--include-noise"); }
        else if (action === "next") args.push("--next");
        else if (action === "round-summary") args.push("--round-summary");
        else if (action === "extract" && params.hash) args.push("--extract", String(params.hash), "--out", String(params.outDir || "extracted_clusters"));
        else if (action === "stage" && params.hash) args.push("--stage", String(params.hash));
        else if (action === "commit-stage" && params.hash && params.suite && params.target) args.push("--commit-stage", String(params.hash), "--suite", String(params.suite), "--target", String(params.target));
        else if (action === "triage" && params.hash && params.disposition) { args.push("--triage", String(params.hash), "--disposition", String(params.disposition)); if (params.suite) args.push("--suite", String(params.suite)); if (params.target) args.push("--target", String(params.target)); }
        else return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Invalid omp_harvest parameters for action: ${action}` }) }], details: { ok: false, error: `Invalid omp_harvest parameters for action: ${action}` } };
        const r = runHarvesterCli(args, opts);
        if (action === "scan" || action === "commit-stage" || action === "triage") saveSnapshotCheckpoint(opts);
        const out = parseJsonOrRaw(r, { ok: true, action });
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], details: out };
      },
    });
  }

  if (typeof pi.on === "function") {
    pi.on("session_compact", async () => {
      try { saveSnapshotCheckpoint(opts); } catch (err) { console.error("[omp-toolkit-hub] session_compact checkpoint failed:", err); }
    });
    pi.on("session_start", async (_event: unknown, ctx: unknown) => {
      try {
        const ckpt = readLoopCheckpoint(resolveCheckpointPath(opts));
        if (!ckpt) return;
        const nu = ckpt.nextUnit as Record<string, unknown> | null | undefined;
        if (nu?.type === "staged_resume" || Number(nu?.stagedCount || 0) > 0) notifyUi(ctx, "OMP harvester loop has orphaned staged cluster(s) ready to verify/commit. Run /harvest-loop next.", "info");
        else if (ckpt.ledgerStatus === "DRIFT_DETECTED") notifyUi(ctx, "OMP harvester loop detected new session/local drift. Run /harvest-loop next.", "info");
      } catch (err) { console.error("[omp-toolkit-hub] session_start restore failed:", err); }
    });
  }
}
