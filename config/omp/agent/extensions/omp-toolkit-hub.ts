/**
 * omp-toolkit-hub.ts — Thin native OMP extension bridging standalone skills with session loop continuity.
 * Fail-open design: event handlers catch all errors and never block or crash the host process.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  readLedgerSummary,
  readLoopCheckpoint,
  resolveCheckpointPath,
  resolveLedgerPath,
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
  if (typeof z !== "object" || z === null) return null;
  if ("object" in z && "string" in z && "boolean" in z && typeof z.object === "function" && typeof z.string === "function" && typeof z.boolean === "function") {
    return z as ZodBuilder;
  }
  return null;
}

function notifyUi(ctx: unknown, msg: string, level: "info" | "warning" | "error" = "info"): void {
  if (typeof ctx !== "object" || ctx === null) return;
  if (!("hasUI" in ctx) || !ctx.hasUI || !("ui" in ctx)) return;
  const ui = ctx.ui;
  if (typeof ui === "object" && ui !== null && "notify" in ui && typeof ui.notify === "function") {
    ui.notify(msg, level);
  }
}

function makeParameters(pi: ExtensionAPI, mode: "status" | "extract"): unknown {
  const z = getZod(pi);
  if (z) {
    if (mode === "status") {
      return z.object({
        runNext: z.boolean().optional(),
        triggerScan: z.boolean().optional(),
        diffGlobal: z.boolean().optional(),
      });
    }
    return z.object({
      hash: z.string(),
      outDir: z.string().optional(),
    });
  }
  return mode === "status"
    ? { type: "object", properties: { runNext: { type: "boolean" }, triggerScan: { type: "boolean" }, diffGlobal: { type: "boolean" } } }
    : { type: "object", properties: { hash: { type: "string" }, outDir: { type: "string" } }, required: ["hash"] };
}

function saveSnapshotCheckpoint(opts?: ToolkitHubOptions, cwd?: string): Record<string, unknown> {
  const ledgerPath = resolveLedgerPath(opts, cwd);
  const ckptPath = resolveCheckpointPath(opts);
  const info = readLedgerSummary(ledgerPath);
  const nextUnit = "nextUnit" in info && typeof info.nextUnit === "object" ? (info.nextUnit as Record<string, unknown> | null) : null;
  const summary = "summary" in info && typeof info.summary === "object" && info.summary !== null ? (info.summary as Record<string, unknown>) : {};
  writeLoopCheckpoint(ckptPath, {
    updatedAt: new Date().toISOString(),
    ledgerStatus: String(info.status ?? "UNKNOWN"),
    nextUnit,
    summary,
  });
  return info;
}

export default function registerToolkitHub(pi: ExtensionAPI, opts?: ToolkitHubOptions): void {
  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("harvest-loop", {
      description: "Inspect, scan, advance, or extract reusable utilities via omp-session-harvester",
      handler: async (rawArgs: string, ctx: unknown) => {
        try {
          const parts = (rawArgs || "status").trim().split(/\s+/).filter(Boolean);
          const sub = (parts[0] || "status").toLowerCase();
          let msg = "";

          if (sub === "scan") {
            const r = runHarvesterCli(["--scan", "--diff-global", "--ledger", resolveLedgerPath(opts)], opts);
            const info = saveSnapshotCheckpoint(opts);
            msg = r.ok ? `Harvest scan complete (${info.status})` : `Harvest scan unavailable: ${r.stderr || r.stdout}`;
          } else if (sub === "next") {
            const info = readLedgerSummary(resolveLedgerPath(opts));
            msg = `Next unit: ${JSON.stringify(info.nextUnit ?? info.status)}`;
          } else if (sub === "extract" && parts[1]) {
            const outDir = parts[2] || "extracted_clusters";
            const r = runHarvesterCli(["--extract", parts[1], "--out", outDir, "--ledger", resolveLedgerPath(opts)], opts);
            msg = r.ok ? `Extracted ${parts[1]} -> ${outDir}` : `Extract failed: ${r.stderr || r.stdout}`;
          } else {
            const info = saveSnapshotCheckpoint(opts);
            msg = `Harvest loop status: ${info.status}`;
          }

          notifyUi(ctx, msg, "info");
        } catch (err) {
          console.error("[omp-toolkit-hub] /harvest-loop error:", err);
        }
      },
    });
  }

  if (typeof pi.registerTool === "function") {
    pi.registerTool({
      name: "omp_harvest_status",
      label: "OMP Harvest Status",
      description: "Read incremental harvester loop ledger status, summary metrics, and optionally run --scan / --next.",
      parameters: makeParameters(pi, "status") as never,
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const ledgerPath = resolveLedgerPath(opts);
          if (params?.triggerScan) {
            const cliArgs = ["--scan", "--ledger", ledgerPath];
            if (params.diffGlobal) cliArgs.push("--diff-global");
            runHarvesterCli(cliArgs, opts);
          }
          const info = saveSnapshotCheckpoint(opts);
          return {
            content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
            details: info,
          };
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
      execute: async (_callId: string, params: Record<string, unknown>) => {
        const hash = String(params?.hash || "").trim();
        const outDir = String(params?.outDir || "extracted_clusters").trim();
        const ledgerPath = resolveLedgerPath(opts);
        if (!hash) {
          const errRes = { ok: false, error: "hash parameter is required" };
          return { content: [{ type: "text", text: JSON.stringify(errRes) }], details: errRes };
        }
        const r = runHarvesterCli(["--extract", hash, "--out", outDir, "--ledger", ledgerPath], opts);
        if (!r.ok) {
          const failRes = { ok: false, hash, error: r.stderr || r.stdout || "extract failed" };
          return { content: [{ type: "text", text: JSON.stringify(failRes) }], details: failRes };
        }
        let parsed: Record<string, unknown> = { ok: true, hash, outDir, raw: r.stdout };
        try {
          const candidate: unknown = JSON.parse(r.stdout);
          if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
            parsed = candidate as Record<string, unknown>;
          }
        } catch {}
        return { content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }], details: parsed };
      },
    });
  }

  if (typeof pi.on === "function") {
    pi.on("session_compact", async () => {
      try {
        saveSnapshotCheckpoint(opts);
      } catch (err) {
        console.error("[omp-toolkit-hub] session_compact checkpoint failed:", err);
      }
    });

    pi.on("session_start", async (_event: unknown, ctx: unknown) => {
      try {
        const ckpt = readLoopCheckpoint(resolveCheckpointPath(opts));
        if (!ckpt) return;
        if (ckpt.ledgerStatus === "DRIFT_DETECTED") {
          notifyUi(ctx, "OMP harvester loop detected new session/local drift. Run /harvest-loop next.", "info");
        }
      } catch (err) {
        console.error("[omp-toolkit-hub] session_start restore failed:", err);
      }
    });
  }
}
