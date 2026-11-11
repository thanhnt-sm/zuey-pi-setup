---
phase: 3
title: "OMP Toolkit Hub Native Domain Tools and Plugin Packaging"
status: pending
priority: P1
effort: "4h"
dependencies: [1, 2]
---

# Phase 3: OMP Toolkit Hub Native Domain Tools and Plugin Packaging

## Overview

Upgrade `omp-toolkit-hub` from a harvester-only shim into the unified OMP-native Hybrid Extension (`pi.registerTool` + `skills/` + Dual CLI) exposing 5 cohesive, cross-OS tools (`omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest`) backed by `~/.omp/tools-venv`, with clean plugin packaging and automated orphan-stage recovery across compaction/sessions.

## Requirements

- **Functional:**
  1. Create `config/omp/agent/extensions/omp-toolkit-hub/python-bridge.ts` (`<=200` lines) providing:
     - `resolveToolsPython(homeDir)`: resolves `~/.omp/tools-venv/Scripts/python.exe` (Windows) or `~/.omp/tools-venv/bin/python3` (POSIX), falling back to verified non-stub `python3`/`python` >=3.9.
     - `resolveSkillScript(homeDir, cwd, skillName, scriptName)`: resolves scripts under `~/.omp/agent/skills/<skill>/scripts/` (or repo `config/omp/agent/skills/...` when running inside `zuey-pi-setup`).
     - `runSkillCliJson(...)`: executes `spawnSync` strictly with argv arrays (zero shell interpolation, timeout guard, path-traversal validation rejecting `..` escape outside allowed workspace/tmp when validating target paths) and parses JSON output cleanly.
  2. Create `config/omp/agent/extensions/omp-toolkit-hub/domain-tools.ts` (`<=200` lines) registering 4 action-multiplexed OMP native tools via `pi.registerTool()`:
     - `omp_office`: actions `md2docx | docx2md | md2xlsx | to-md | batch | extract-table | extract-bbox | calc-kpi | init-kpi` -> `office_cli.py --cmd <action> ... --json`
     - `omp_pmo`: actions `cpm | evm | pert | wbs | risk | rtm | capacity | verified-delivery | sync-notes | raid-report | mpp2xml | xml2xlsx | xlsx2xml` -> `pmo_cli.py --cmd <action> ... --json`
     - `omp_email`: actions `scan | threads | issues` -> `email_cli.py --cmd <action> ... --json`
     - `omp_maint`: actions `analyze | clean | generate-uninstaller` -> `maintenance_cli.py --cmd <action> ... --json` (defaults `dryRun: true`; refuses live `clean` unless `force: true` is explicitly passed)
  3. Upgrade `config/omp/agent/extensions/omp-toolkit-hub.ts` and `loop-state.ts` (`<=200` lines each):
     - Register `domain-tools.ts` tools alongside `omp_harvest_status` and `omp_extract_cluster` (or unified `omp_harvest` actions `status | scan | next | extract | stage | commit_stage | triage`).
     - Add `/omp-doctor` slash command delegating to `scripts/omp-doctor.py` (or `~/.omp/agent/skills/omp-session-harvester/scripts/` / bundled check).
     - Enhance `session_start` and `session_compact` to detect orphaned `staged` entries in `promotionQueue` / `loop-checkpoint.json` and notify cleanly.
  4. Package `config/omp/agent/extensions/omp-toolkit-hub/` cleanly for OMP plugin/extension discovery (`package.json` with `omp.extensions` or compatible directory layout verified against `omp-setup-backup.sh` and `omp-setup-restore.sh` so backup dereferencing and single-file->dir migration work seamlessly).
- **Non-Functional:**
  - Every TS file under `config/omp/agent/extensions/omp-toolkit-hub*` MUST stay <=200 lines.
  - All extension event handlers and tool executors MUST fail open cleanly with structured actionable JSON errors (`{ ok: false, error, hint }`) when `tools-venv` or input files are missing.
  - Zero persistent background daemon / MCP server spawned for these 4 suites.

## Architecture

```text
OMP LLM Turn -> omp_office / omp_pmo / omp_email / omp_maint / omp_harvest
                    │
                    ▼ (Extension in-process, 0 bash path guessing)
             python-bridge.ts
              ├─ resolveToolsPython(~/.omp/tools-venv/{Scripts/python.exe,bin/python3})
              ├─ resolveSkillScript(skillName, cliFile)
              └─ spawnSync(py, [cli, "--cmd", action, ..., "--json"], { shell: false })
                    │
                    ▼
             skills/<suite>/scripts/*_cli.py -> structured JSON + details
```

## Related Code Files

- Create: `config/omp/agent/extensions/omp-toolkit-hub/python-bridge.ts`
- Create: `config/omp/agent/extensions/omp-toolkit-hub/domain-tools.ts`
- Modify: `config/omp/agent/extensions/omp-toolkit-hub/loop-state.ts`
- Modify: `config/omp/agent/extensions/omp-toolkit-hub.ts`
- Modify: `tests/test-omp-toolkit-hub.test.ts`
- Modify: `scripts/omp-setup-backup.sh` (verify relative import resolution & bundle inclusion if `package.json` added)

## Implementation Steps

1. **Step A (TDD Tests First):** Expand `tests/test-omp-toolkit-hub.test.ts` to assert: (a) registration of `omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest_status`, `omp_extract_cluster`, `/harvest-loop`, and `/omp-doctor`, (b) `resolveToolsPython()` prefers Windows `Scripts/python.exe` and POSIX `bin/python3` cleanly, (c) `omp_maint` blocks `clean` without explicit `force: true`, (d) missing `tools-venv` or invalid action returns structured `{ ok: false }` without throwing, and (e) `omp_office` / `omp_pmo` successfully execute a smoke round-trip against mock/real Python CLI in temp dir.
2. **Step B (Implement `python-bridge.ts`):** Build OS-agnostic venv/script resolution and `spawnSync` JSON wrapper with strict argv construction (`shell: false`) and size/timeout bounds.
3. **Step C (Implement `domain-tools.ts` & Upgrade Hub):** Implement the 4 action-multiplexed tools cleanly with concise Zod schemas (`pi.zod` fallback to plain JSON Schema), update `loop-state.ts` for `staged` orphan detection and `omp_harvest` loop actions, and wire `/omp-doctor` in `omp-toolkit-hub.ts`.
4. **Step D (Verify Backup Deref & Tests):** Run `bun test tests/test-omp-toolkit-hub.test.ts` and `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-migration.sh` to confirm `omp-setup-backup.sh` bundles all TS submodules cleanly without `ABS_LEFT` or unresolved import errors.

## Success Criteria

- [ ] `omp-toolkit-hub` registers `omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest_status`, `omp_extract_cluster`, `/harvest-loop`, and `/omp-doctor`.
- [ ] `resolveToolsPython()` resolves `~/.omp/tools-venv` executables accurately on both Windows and POSIX layouts without bash interpolation.
- [ ] `omp_maint` refuses destructive `clean` execution unless `force: true` is passed and returns structured JSON on dry-run or missing venv.
- [ ] `bun test tests/test-omp-toolkit-hub.test.ts` passes all assertions and every TS module under `omp-toolkit-hub` remains <=200 lines.

## Risk Assessment

- **Zod schema mismatch across OMP versions:** Mirror `getZod(pi)` pattern with plain JSON Schema fallback and validate required enum/string fields defensively inside `execute()`.
- **Relative import failure during `omp-setup-backup.sh`:** Verify all imports inside `omp-toolkit-hub/*.ts` remain strictly relative within `extensions/` (`./omp-toolkit-hub/...`) so `resolve_rel_module()` passes without `CRITICAL` aborts.
