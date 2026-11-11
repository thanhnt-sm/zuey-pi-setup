---
phase: 4
title: "OMP First Dual Client Routing Rules and Mac Parity"
status: pending
priority: P1
effort: "3h"
dependencies: [2, 3]
---

# Phase 4: OMP First Dual Client Routing Rules and Mac Parity

## Overview

Eliminate ad-hoc script rewriting across both OMP and Claude Code by replacing dead `mcp__markitdown` / `/md-convert` routing inside `config/omp/agent/rules/` and `APPEND_SYSTEM.md` with explicit OMP-first (`omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest`) and Claude CLI fallback rules, adding `--link-claude` to `omp-bootstrap.sh`, hardening Darwin diagnostics and staleness warnings in `omp-doctor.py` + `omp-toolkit-hub.ts`, and adding opt-in OS schedule sync helpers (`--tdd`).

## Requirements

- Functional:
  - Rewrite `config/omp/agent/rules/file-type-enforcement.md` to remove dead `mcp__markitdown__convert_to_markdown` and `/md-convert` calls; enforce `omp_office` / `omp_pmo` / `omp_email` FIRST in OMP and `~/.omp/tools-venv` (`*_cli.py --json`) in Claude Code for `.docx`, `.xlsx`, `.pdf`, `.drawio`, `.vsdx`, `.eml`, `.msg`, `.mpp`, `.xml`.
  - Update `config/omp/agent/rules/skill-domain-routing.md`, `skill-workflow-routing.md`, and `config/omp-upstream/agent/APPEND_SYSTEM.md` with an explicit **Document / PMO / Email / Maintenance / Harvest Tool Arbitration Matrix** instructing agents never to write throwaway scripts when a suite action covers the task.
  - Add `--link-claude` mode to `scripts/omp-bootstrap.sh` (`omp-bootstrap.ps1` forwarding intact) that safely syncs/links canonical `*-suite` skill directories and updated `file-type-enforcement.md` / `skill-domain-routing.md` into `~/.claude/` (backing up overwritten files first) so Claude Code shares the exact same tools without an extra MCP server.
  - Extend `scripts/omp-doctor.py` with: (a) Darwin runtime checks (`pinentry-mac`, `mpxj` or Java warning for `.mpp`, Homebrew vs Xcode CLT Python check), (b) repo-vs-live rules drift detection (`rules/` & `omp-toolkit-hub`), and (c) backup staleness warning (`--max-backup-age-days`, default `7`, comparing tarball mtime when `--repo-dir` is present).
  - Add non-blocking `session_start` backup/queue staleness warning in `config/omp/agent/extensions/omp-toolkit-hub.ts` (respecting `<= 200` line limit) and create opt-in `scripts/omp-schedule-sync.sh` (macOS `launchd` user agent) + `scripts/omp-schedule-sync.ps1` (Windows Task Scheduler) for periodic non-destructive harvest + drift notice.
- Non-functional:
  - `omp-doctor.py --strict` remains 100% deterministic and zero-false-positive on healthy Windows and simulated `OS_OVERRIDE=Darwin` runs.
  - Scheduled sync helpers default to read-only harvest + drift log (never auto-pushing git or writing unencrypted secrets).

## Architecture

- Dual-client parity works via **one shared Python engine (`~/.omp/agent/skills/*-suite/scripts/*_cli.py`)** invoked via `omp_*` tools in OMP and via `tools-venv` Python CLI in Claude Code, driven by synchronized `rules/`.
- `omp-doctor.py` keeps Darwin checks, `rulesDrift`, and `backupFreshness` advisory (`warnings`) by default (and skips drift under `--no-local-config`) so newly modified repo rules do not fail `--strict` before Phase 5 rebuilds the portable tarball.

## Related Code Files

- Create: `scripts/omp-schedule-sync.sh`
- Create: `scripts/omp-schedule-sync.ps1`
- Create: `docs/macos-day1-checklist.md`
- Modify: `config/omp/agent/rules/file-type-enforcement.md`
- Modify: `config/omp/agent/rules/skill-domain-routing.md`
- Modify: `config/omp/agent/rules/skill-workflow-routing.md`
- Modify: `config/omp-upstream/agent/APPEND_SYSTEM.md`
- Modify: `scripts/omp-bootstrap.sh`
- Modify: `scripts/omp-doctor.py`
- Modify: `config/omp/agent/tools/omp-doctor.py`
- Modify: `config/omp/agent/extensions/omp-toolkit-hub.ts`
- Modify: `tests/test-omp-e2e-cross-platform.sh`
- Modify: `tests/test-omp-toolkit-hub.test.ts`

## Implementation Steps

1. **Step A (TDD Tests First):**
   - Add assertions in `tests/test-omp-e2e-cross-platform.sh` verifying: (a) `config/omp/agent/rules/file-type-enforcement.md` contains `omp_office`, `omp_pmo`, `omp_email` and ZERO `mcp__markitdown` / `/md-convert` dead calls, (b) `omp-bootstrap.sh --link-claude` populates shared suite skills and routing rules into a mock `~/.claude` with backup preservation, (c) `omp-doctor.py --json` emits `darwinReadiness` and `backupAgeDays` fields cleanly under `OS_OVERRIDE=Darwin`, and (d) `omp-schedule-sync.sh --dry-run` outputs valid `launchd` plist without mutating host `~/Library/LaunchAgents`.
   - Extend `tests/test-omp-toolkit-hub.test.ts` verifying `session_start` surfaces backup/queue reminder cleanly when stale without throwing.
2. **Step B (Update Routing Rules & `APPEND_SYSTEM.md`):**
   - Rewrite `config/omp/agent/rules/file-type-enforcement.md` and update `skill-domain-routing.md`, `skill-workflow-routing.md`, and `config/omp-upstream/agent/APPEND_SYSTEM.md` to enforce OMP-first native tools (`omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest`) and `~/.omp/tools-venv` Claude Code CLI parity.
3. **Step C (Bootstrap Claude Parity, Doctor Upgrades & Sync Schedulers):**
   - Add `--link-claude` to `scripts/omp-bootstrap.sh`.
   - Update `scripts/omp-doctor.py` and immediately sync it to live `~/.omp/agent/tools/omp-doctor.py` and `config/omp/agent/tools/omp-doctor.py` before any backup command (preventing backup wipe-and-mirror from reverting improvements); add `darwinReadiness`, advisory `rulesDrift`, and `backupFreshness` checks; add subtle `session_start` drift/staleness notice in `omp-toolkit-hub.ts` (`<= 200` lines).
   - Create `scripts/omp-schedule-sync.sh` (`--install` / `--uninstall` / `--dry-run`) and `scripts/omp-schedule-sync.ps1` plus `docs/macos-day1-checklist.md` (covering `brew install gnupg pinentry-mac bun uv`, `mpxj` for `.mpp`, `omp-bootstrap.sh --mode restore --link-mirrors --link-claude`, and `omp-doctor.py --strict`).
4. **Step D (Verify):**
   - Run `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-e2e-cross-platform.sh` and `bun test tests/test-omp-toolkit-hub.test.ts`.

## Success Criteria

- [ ] Zero references to dead `mcp__markitdown` or `/md-convert` remain in `config/omp/agent/rules/`; rules explicitly arbitrate `omp_*` tools and Claude CLI parity.
- [ ] `omp-bootstrap.sh --link-claude` syncs canonical suite skills and routing rules into `~/.claude` cleanly with backups.
- [ ] `omp-doctor.py` validates Darwin readiness (`pinentry-mac`, `mpxj`/Java, Homebrew Python), rules drift, and tarball freshness across Windows and Darwin mocks.
- [ ] `scripts/omp-schedule-sync.{sh,ps1}` supports safe `--dry-run` and opt-in scheduling without auto-pushing secrets or breaking existing sessions.

## Risk Assessment

- **Breaking `omp-doctor.py --strict` when optional Darwin tools (`mpxj`) are absent on machines that only use `.xml`:** Report missing `mpxj` as an informational field inside `darwinReadiness` rather than failing `--strict` unless `pinentry-mac` / `python3` core prerequisites are missing on real Darwin.
- **Clobbering custom user edits inside `~/.claude/rules/` during `--link-claude`:** Always snapshot existing target files to `~/.omp/restore-backups/` before overwriting and only touch the explicitly managed `*-suite` and routing rule filenames.
