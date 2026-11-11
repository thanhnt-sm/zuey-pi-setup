import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolkitHubOptions } from "./loop-state";
import { runSkillCliJson } from "./python-bridge";

const OFFICE_ACTIONS: Record<string, true> = {
  md2docx: true, docx2md: true, md2xlsx: true, "to-md": true, batch: true,
  "extract-table": true, "extract-bbox": true, "calc-kpi": true, "init-kpi": true,
};
const PMO_ALIASES: Record<string, string> = { xml2xlsx: "msp2xlsx", xlsx2xml: "excel2xml", "sync-notes": "raid" };
const PMO_ACTIONS: Record<string, true> = {
  cpm: true, evm: true, "verified-delivery": true, pert: true, wbs: true, risk: true, rtm: true,
  capacity: true, "sprint-metrics": true, dates: true, obligation: true, cr: true, security: true,
  manifest: true, audit: true, report: true, "raid-init": true, raid: true, "raid-report": true,
  "note-doctor": true, "note-lint": true, "note-plan": true, "note-roll": true, "note-archive": true,
  msp2xlsx: true, xlsx2msp: true, excel2xml: true, "sprint-export": true, mpp2xml: true,
};
const EMAIL_ACTIONS: Record<string, true> = { scan: true, threads: true, issues: true };
const MAINT_ACTIONS: Record<string, true> = {
  analyze: true, clean: true, "stale-scan": true, "orphan-scan": true, "generate-uninstaller": true,
};

function reply(payload: Record<string, unknown>) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
}

function pushVal(args: string[], flag: string, val: unknown): void {
  if (val !== undefined && val !== null && String(val).trim() !== "") args.push(flag, String(val));
}

function pushBool(args: string[], flag: string, val: unknown): void {
  if (val === true) args.push(flag);
}

function makeActionSchema(pi: ExtensionAPI, props: Record<string, "string" | "boolean" | "number">): unknown {
  const z = (pi as { zod?: Record<string, () => { optional: () => unknown }> & { object?: (s: Record<string, unknown>) => unknown } }).zod;
  if (z && typeof z.object === "function" && typeof z.string === "function" && typeof z.boolean === "function") {
    const shape: Record<string, unknown> = { action: z.string() };
    for (const [k, kind] of Object.entries(props)) {
      if (kind === "boolean") shape[k] = z.boolean().optional();
      else if (kind === "number" && typeof z.number === "function") shape[k] = z.number().optional();
      else shape[k] = z.string().optional();
    }
    return z.object(shape);
  }
  const jsonProps: Record<string, unknown> = { action: { type: "string" } };
  for (const [k, kind] of Object.entries(props)) jsonProps[k] = { type: kind };
  return { type: "object", properties: jsonProps, required: ["action"] };
}

function runSuiteTool(opts: ToolkitHubOptions | undefined, skillName: string, scriptName: string, args: string[]) {
  const res = runSkillCliJson({ homeDir: opts?.homeDir, skillName, scriptName, args });
  if (!res.ok) return reply({ ok: false, exitCode: res.exitCode, error: res.error, hint: res.hint, details: res.data });
  return reply({ ok: true, data: res.data ?? res.stdout });
}

export function registerDomainTools(pi: ExtensionAPI, opts?: ToolkitHubOptions): void {
  if (typeof pi.registerTool !== "function") return;
  pi.registerTool({
    name: "omp_office",
    label: "OMP Office Document Suite",
    description: "Run office-doc-suite commands (md2docx, docx2md, md2xlsx, to-md, batch, extract-table, extract-bbox, calc-kpi, init-kpi) via ~/.omp/tools-venv.",
    parameters: makeActionSchema(pi, {
      input: "string", output: "string", mode: "string", recursive: "boolean", overwrite: "boolean",
      month: "string", targetPoints: "number", alertsOut: "string", colSplitX: "number", singleColumn: "boolean", noMermaid: "boolean",
    }) as never,
    execute: async (_id: string, params: Record<string, unknown>) => {
      const action = String(params?.action || "").trim();
      if (!Object.hasOwn(OFFICE_ACTIONS, action)) return reply({ ok: false, error: `Unsupported omp_office action: ${action}` });
      const args = ["--cmd", action, "--json"];
      pushVal(args, "--input", params.input);
      pushVal(args, "--output", params.output);
      pushVal(args, "--mode", params.mode);
      pushBool(args, "--recursive", params.recursive);
      pushBool(args, "--overwrite", params.overwrite);
      pushVal(args, "--month", params.month);
      pushVal(args, "--target-points", params.targetPoints);
      pushVal(args, "--alerts-out", params.alertsOut);
      pushVal(args, "--col-split-x", params.colSplitX);
      pushBool(args, "--single-column", params.singleColumn);
      pushBool(args, "--no-mermaid", params.noMermaid);
      return runSuiteTool(opts, "office-doc-suite", "office_cli.py", args);
    },
  });

  pi.registerTool({
    name: "omp_pmo",
    label: "OMP PMO Project Suite",
    description: "Run pmo-project-suite commands (cpm, evm, pert, wbs, risk, rtm, capacity, raid, raid-report, msp2xlsx, xlsx2msp, excel2xml, mpp2xml, audit, report) via ~/.omp/tools-venv.",
    parameters: makeActionSchema(pi, {
      input: "string", output: "string", tracker: "string", config: "string", backupDir: "string",
      baseXml: "string", baseDir: "string", profile: "string", start: "string", end: "string",
      project: "string", policy: "string", autoInit: "boolean", useCom: "boolean", dryRun: "boolean", force: "boolean",
    }) as never,
    execute: async (_id: string, params: Record<string, unknown>) => {
      const raw = String(params?.action || "").trim();
      const action = PMO_ALIASES[raw] ?? raw;
      if (!Object.hasOwn(PMO_ACTIONS, action)) return reply({ ok: false, error: `Unsupported omp_pmo action: ${raw}` });
      const args = ["--cmd", action, "--json"];
      pushVal(args, "--input", params.input);
      pushVal(args, "--output", params.output);
      pushVal(args, "--tracker", params.tracker);
      pushVal(args, "--config", params.config);
      pushVal(args, "--backup-dir", params.backupDir);
      pushVal(args, "--base-xml", params.baseXml);
      pushVal(args, "--base-dir", params.baseDir);
      pushVal(args, "--profile", params.profile);
      pushVal(args, "--start", params.start);
      pushVal(args, "--end", params.end);
      pushVal(args, "--project", params.project);
      pushVal(args, "--policy", params.policy);
      pushBool(args, "--auto-init", params.autoInit);
      pushBool(args, "--use-com", params.useCom);
      pushBool(args, "--dry-run", params.dryRun);
      pushBool(args, "--force", params.force);
      return runSuiteTool(opts, "pmo-project-suite", "pmo_cli.py", args);
    },
  });

  pi.registerTool({
    name: "omp_email",
    label: "OMP Email Intelligence Suite",
    description: "Run email-intelligence-suite commands (scan, threads, issues) on .eml/.msg/Outlook via ~/.omp/tools-venv.",
    parameters: makeActionSchema(pi, { input: "string", output: "string", format: "string", dedupe: "boolean", source: "string" }) as never,
    execute: async (_id: string, params: Record<string, unknown>) => {
      const action = String(params?.action || "").trim();
      if (!Object.hasOwn(EMAIL_ACTIONS, action)) return reply({ ok: false, error: `Unsupported omp_email action: ${action}` });
      const args = ["--cmd", action, "--json"];
      pushVal(args, "--input", params.input);
      pushVal(args, "--output", params.output);
      pushVal(args, "--format", params.format);
      pushBool(args, "--dedupe", params.dedupe);
      pushVal(args, "--source", params.source);
      return runSuiteTool(opts, "email-intelligence-suite", "email_cli.py", args);
    },
  });

  pi.registerTool({
    name: "omp_maint",
    label: "OMP System Maintenance Suite",
    description: "Run system-maintenance-suite commands (analyze, clean, stale-scan, orphan-scan, generate-uninstaller). Clean defaults dryRun:true and requires force:true.",
    parameters: makeActionSchema(pi, {
      mode: "string", dryRun: "boolean", force: "boolean", os: "string", roots: "string",
      staleDays: "number", tool: "string", package: "string", output: "string",
    }) as never,
    execute: async (_id: string, params: Record<string, unknown>) => {
      const action = String(params?.action || "").trim();
      if (!Object.hasOwn(MAINT_ACTIONS, action)) return reply({ ok: false, error: `Unsupported omp_maint action: ${action}` });
      if (action === "clean" && params.force !== true) {
        return reply({
          ok: false,
          error: "Refusing live clean without explicit force: true (defaults to dryRun: true).",
          hint: "Pass force: true and dryRun: false only after explicit user confirmation, or run action: 'analyze'.",
        });
      }
      const args = ["--cmd", action, "--json"];
      pushVal(args, "--mode", params.mode);
      if (action === "clean") {
        if (params.dryRun !== false) args.push("--dry-run");
        else pushBool(args, "--force", params.force);
      } else {
        pushBool(args, "--dry-run", params.dryRun);
      }
      pushVal(args, "--os", params.os);
      if (Array.isArray(params.roots) && params.roots.length) args.push("--roots", ...params.roots.map(String));
      else if (typeof params.roots === "string" && params.roots.trim()) args.push("--roots", ...params.roots.trim().split(/[,;]+/).filter(Boolean));
      pushVal(args, "--stale-days", params.staleDays);
      pushVal(args, "--tool", params.tool);
      pushVal(args, "--package", params.package);
      pushVal(args, "--output", params.output);
      return runSuiteTool(opts, "system-maintenance-suite", "maintenance_cli.py", args);
    },
  });
}
