import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import registerToolkitHub from "../config/omp/agent/extensions/omp-toolkit-hub";
import { readLoopCheckpoint, writeLoopCheckpoint } from "../config/omp/agent/extensions/omp-toolkit-hub/loop-state";

interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute: (callId: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, ctx?: unknown) => Promise<unknown>;
}

function createMockPi() {
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void }>();
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<unknown> | unknown>>();
  const entries: Array<{ type: string; data: unknown }> = [];
  const messages: Array<unknown> = [];

  const pi = {
    zod: {
      object: (shape: Record<string, unknown>) => ({ _shape: shape }),
      string: () => ({ optional: () => ({}) }),
      number: () => ({ optional: () => ({}) }),
      boolean: () => ({ optional: () => ({}) }),
    },
    registerCommand(name: string, def: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void }) {
      commands.set(name, def);
    },
    registerTool(def: RegisteredTool) {
      tools.set(def.name, def);
    },
    on(event: string, fn: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) {
      const arr = handlers.get(event) ?? [];
      arr.push(fn);
      handlers.set(event, arr);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type, data });
    },
    async sendMessage(msg: unknown) {
      messages.push(msg);
    },
  };

  return { pi, commands, tools, handlers, entries, messages };
}

describe("omp-toolkit-hub extension", () => {
  test("registers /harvest-loop command, omp_harvest_status & omp_extract_cluster tools, and session lifecycle hooks", () => {
    const mock = createMockPi();
    registerToolkitHub(mock.pi as never);

    expect(mock.commands.has("harvest-loop")).toBe(true);
    expect(mock.tools.has("omp_harvest_status")).toBe(true);
    expect(mock.tools.has("omp_extract_cluster")).toBe(true);
    expect(mock.handlers.has("session_compact")).toBe(true);
    expect(mock.handlers.has("session_start")).toBe(true);
  });

  test("omp_harvest_status reads ledger summary and --next cleanly without crashing when missing", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "omp-hub-test-"));
    try {
      const ledgerPath = path.join(tmp, "omp-consolidation-ledger.json");
      writeFileSync(ledgerPath, JSON.stringify({
        status: "DRIFT_DETECTED",
        summary: { ompSessionsScouted: 3, harvestedArtifactsCount: 12, uniqueCodeClusters: 8 },
        suites: { pmo_project_suite: { status: "HARVESTED", targetPath: "skills/pmo-project-suite" } },
      }), "utf8");

      const mock = createMockPi();
      registerToolkitHub(mock.pi as never, {
        homeDir: tmp,
        checkpointPath: path.join(tmp, "loop-checkpoint.json"),
        ledgerPath,
      });

      const statusTool = mock.tools.get("omp_harvest_status")!;
      const res = (await statusTool.execute("c1", { runNext: false }, undefined, undefined, {})) as {
        content: Array<{ type: string; text: string }>;
        details: { status: string; next?: unknown };
      };
      expect(res.details.status).toBe("DRIFT_DETECTED");
      expect(res.content[0].text).toContain("DRIFT_DETECTED");

      // Missing ledger fails open cleanly with structured response
      rmSync(ledgerPath, { force: true });
      const emptyRes = (await statusTool.execute("c2", {}, undefined, undefined, {})) as {
        details: { status: string };
      };
      expect(emptyRes.details.status).toBe("NO_LEDGER");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("omp_extract_cluster fails cleanly on unknown hash and command runs /harvest-loop status without throwing", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "omp-hub-cmd-"));
    try {
      const notifications: string[] = [];
      const mock = createMockPi();
      registerToolkitHub(mock.pi as never, {
        homeDir: tmp,
        checkpointPath: path.join(tmp, "loop-checkpoint.json"),
        ledgerPath: path.join(tmp, "missing-ledger.json"),
      });

      const cmd = mock.commands.get("harvest-loop")!;
      await expect(
        cmd.handler("status", {
          hasUI: true,
          ui: { notify: (msg: string) => notifications.push(msg) },
        })
      ).resolves.toBeUndefined();
      expect(notifications.length).toBeGreaterThan(0);

      const extractTool = mock.tools.get("omp_extract_cluster")!;
      const res = (await extractTool.execute("c3", { hash: "nonexistent12" }, undefined, undefined, {})) as {
        details: { ok: boolean };
      };
      expect(res.details.ok).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("session_compact and session_start handlers fail open and persist checkpoint", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "omp-hub-compact-"));
    try {
      const ckptPath = path.join(tmp, "loop-checkpoint.json");
      const ledgerPath = path.join(tmp, "omp-consolidation-ledger.json");
      writeFileSync(ledgerPath, JSON.stringify({
        status: "HARVESTED",
        summary: { uniqueCodeClusters: 4 },
        suites: { office_doc_suite: { status: "HARVESTED", targetPath: "skills/office-doc-suite" } },
      }), "utf8");

      const mock = createMockPi();
      registerToolkitHub(mock.pi as never, { homeDir: tmp, checkpointPath: ckptPath, ledgerPath });

      // Simulate session_compact
      const compactHandlers = mock.handlers.get("session_compact") ?? [];
      for (const fn of compactHandlers) {
        await expect(Promise.resolve(fn({}, { hasUI: false }))).resolves.toBeUndefined();
      }
      expect(existsSync(ckptPath)).toBe(true);
      const saved = readLoopCheckpoint(ckptPath);
      expect(saved?.ledgerStatus).toBe("HARVESTED");

      // Simulate broken context object -> MUST NOT throw out of event handlers
      writeLoopCheckpoint(ckptPath, { updatedAt: "2026-11-10T00:00:00Z", ledgerStatus: "DRIFT_DETECTED", nextUnit: { name: "pmo_project_suite" } });
      const startHandlers = mock.handlers.get("session_start") ?? [];
      for (const fn of startHandlers) {
        await expect(Promise.resolve(fn({}, null))).resolves.toBeUndefined();
      }
      expect(readFileSync(ckptPath, "utf8")).toContain("DRIFT_DETECTED");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
