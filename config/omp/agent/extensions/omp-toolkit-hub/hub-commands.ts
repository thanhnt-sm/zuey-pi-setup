import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  readLedgerSummary,
  resolveLedgerPath,
  runDoctorCli,
  runHarvesterCli,
  type ToolkitHubOptions,
} from "./loop-state";

export function notifyUi(ctx: unknown, msg: string, level: "info" | "warning" | "error" = "info"): void {
  if (typeof ctx !== "object" || ctx === null || !("hasUI" in ctx) || !ctx.hasUI || !("ui" in ctx)) return;
  const ui = ctx.ui;
  if (typeof ui === "object" && ui !== null && "notify" in ui && typeof ui.notify === "function") ui.notify(msg, level);
}

export function registerHubCommands(
  pi: ExtensionAPI,
  opts?: ToolkitHubOptions,
  saveSnapshotFn?: (opts?: ToolkitHubOptions) => Record<string, unknown>
): void {
  if (typeof pi.registerCommand !== "function") return;

  pi.registerCommand("harvest-loop", {
    description: "Inspect, scan, advance, stage, triage, or extract utilities via omp-session-harvester",
    handler: async (rawArgs: string, ctx: unknown) => {
      try {
        const parts = (rawArgs || "status").trim().split(/\s+/).filter(Boolean);
        const sub = (parts[0] || "status").toLowerCase();
        const ledgerPath = resolveLedgerPath(opts);
        let msg = "";
        if (sub === "scan") {
          const r = runHarvesterCli(["--scan", "--diff-global", "--ledger", ledgerPath], opts);
          const info = saveSnapshotFn ? saveSnapshotFn(opts) : {};
          msg = r.ok ? `Harvest scan complete (${info.status})` : `Harvest scan unavailable: ${r.stderr || r.stdout}`;
        } else if (sub === "next") {
          const info = readLedgerSummary(ledgerPath);
          msg = `Next unit: ${JSON.stringify(info.nextUnit ?? info.status)}`;
        } else if (sub === "extract" && parts[1]) {
          const outDir = parts[2] || "extracted_clusters";
          const r = runHarvesterCli(["--extract", parts[1], "--out", outDir, "--ledger", ledgerPath], opts);
          msg = r.ok ? `Extracted ${parts[1]} -> ${outDir}` : `Extract failed: ${r.stderr || r.stdout}`;
        } else {
          const info = saveSnapshotFn ? saveSnapshotFn(opts) : {};
          msg = `Harvest loop status: ${info.status} (round=${info.round ?? 0}, staged=${info.stagedCount ?? 0}, pending=${info.pendingCount ?? 0})`;
        }
        notifyUi(ctx, msg, "info");
      } catch (err) {
        console.error("[omp-toolkit-hub] /harvest-loop error:", err);
      }
    },
  });

  pi.registerCommand("omp-doctor", {
    description: "Run cross-OS OMP environment healthcheck (tools-venv, plugins, mcp.json, local links, leak check)",
    handler: async (_rawArgs: string, ctx: unknown) => {
      try {
        const r = runDoctorCli(["--json"], opts);
        const msg = r.ok ? `OMP Doctor OK: ${r.stdout.slice(0, 240)}` : `OMP Doctor issue: ${r.stderr || r.stdout}`;
        notifyUi(ctx, msg, r.ok ? "info" : "warning");
      } catch (err) {
        console.error("[omp-toolkit-hub] /omp-doctor error:", err);
      }
    },
  });
}
