---
phase: 3
title: "Queue Promotions Excel Diff CleanPC and Email Parity"
status: pending
priority: P1
effort: "3.5h"
dependencies: [2]
---

# Phase 3: Queue Promotions Excel Diff CleanPC and Email Parity

## Overview

Drain the first high-signal batches of the filtered `promotionQueue` by promoting verified missing capabilities into the canonical Priority-100 suites (`xlsx-diff` / JSON profile comparison in `pmo-project-suite`, net-new AI/DISM/OMP session cleaners in `system-maintenance-suite`, and Windows Outlook COM parity checks in `email-intelligence-suite`) and executing bounded queue triage so `promotedHashes` and `round` advance cleanly (`--tdd`).

## Requirements

- Functional:
  - **`pmo-project-suite` (`xlsx-diff` + profile parity):** Add pure-Python cross-OS `compare_schedule_workbooks()` / `xlsx-diff` subcommand in `project_sync.py` + `pmo_cli.py` + `omp-toolkit-hub/domain-tools.ts` (`omp_pmo` action `xlsx-diff`) + `pmo-project-suite/SKILL.md`, inspired by `3_so_sanh_2_file_excel.ps1` / `1_tao_plan_tu_excel.ps1` / `2_xuat_excel_tu_plan.ps1` (keyed row diff by UID/UUID/Task Name, column tolerance, CWE-1236 formula sanitization on exported diff Excel + Markdown summary).
  - **`system-maintenance-suite` (CleanPC parity audit):** Audit `06_cleanup_ai_tools.ps1` (Claude Code/Cursor/Copilot/Roocode caches), `09_cleanup_dism_updates.ps1` (DirectX shader cache + Windows-only DISM `/AnalyzeComponentStore` dry-run preview), `12_cleanup_omp_sessions.ps1` (age-gated old `~/.omp/agent/sessions` & cache pruner protecting active files & `.db*`), `check_c.ps1`, and `scan_stale.ps1`; port net-new cross-OS cache paths & `omp-session-prune` (with active-session & `.db` preservation and `--dry-run` default + `--force` gate) into `cleaner_dispatcher.py` + `maintenance_cli.py` + `domain-tools.ts`.
  - **`email-intelligence-suite` (`outlook_com.py` / `Run-Pipeline.ps1` audit):** Audit `email_parser.py` (`load_emails_from_outlook_com`) for folder/date filtering gaps vs queued scripts, enhance safely with explicit non-Windows graceful error/guidance, and mark covered clusters `promoted` / `merged_into`.
  - Run `--auto-triage-known`, `--stage`/`--commit-stage`, and `--triage` across remaining high-occurrence queue items so `plans/omp-consolidation-ledger.json` records `round >= 1`, populated `promotedHashes`, and clean top clusters without phantom `dev_ops_automation`.
- Non-functional:
  - Keep every module under `config/omp/agent/extensions/omp-toolkit-hub/` `<= 200` lines.
  - Zero customer names, Vietnamese internal banking terms, or local drive literals inside promoted code or tests.

## Architecture

- Pure Python (`openpyxl`) implements `compare_schedule_workbooks()` on both Windows and macOS (`project_sync.py`), avoiding Windows Excel COM crashes while keeping optional `--use-com` for `.mpp`.
- `cleaner_dispatcher.py` isolates Windows-only DISM / DirectX / `%LOCALAPPDATA%` targets under `detect_os() == "windows"` and macOS equivalents (`~/Library/Application Support/Claude/Cache`, etc.) under `detect_os() == "darwin"`, reusing `_delete_children_safely` + `dry_run=True` + `force=True` guard.

## Related Code Files

- Modify: `config/omp/agent/skills/pmo-project-suite/scripts/project_sync.py`
- Modify: `config/omp/agent/skills/pmo-project-suite/scripts/pmo_cli.py`
- Modify: `config/omp/agent/skills/pmo-project-suite/SKILL.md`
- Modify: `config/omp/agent/skills/pmo-project-suite/tests/test_pmo_suite.py`
- Modify: `config/omp/agent/skills/system-maintenance-suite/scripts/cleaner_dispatcher.py`
- Modify: `config/omp/agent/skills/system-maintenance-suite/scripts/maintenance_cli.py`
- Modify: `config/omp/agent/skills/system-maintenance-suite/SKILL.md`
- Modify: `config/omp/agent/skills/system-maintenance-suite/tests/test_maintenance_suite.py`
- Modify: `config/omp/agent/skills/email-intelligence-suite/scripts/email_parser.py`
- Modify: `config/omp/agent/skills/email-intelligence-suite/tests/test_email_suite.py`
- Modify: `config/omp/agent/extensions/omp-toolkit-hub/domain-tools.ts`
- Modify: `tests/test-omp-toolkit-hub.test.ts`
- Modify: `plans/omp-consolidation-ledger.json`
- Modify: `plans/harvest-inventory.md`

## Implementation Steps

1. **Step A (TDD Tests First):**
   - Add `test_xlsx_diff_added_removed_changed_and_cwe1236` in `test_pmo_suite.py` covering two `.xlsx` schedule files with added/removed/modified tasks and formula-prefix payloads (`=CMD(...)`).
   - Add `test_ai_caches_and_omp_session_prune_guards` in `test_maintenance_suite.py` verifying dry-run by default, protection of `.db*`/active sessions within `days_old`, and safe pruning of stale old sessions under `--force`.
   - Add `test_outlook_non_windows_guidance` / folder filter tests in `test_email_suite.py` and add `omp_pmo` (`xlsx-diff`) + `omp_maint` (`omp-prune`) dispatch assertions in `tests/test-omp-toolkit-hub.test.ts`.
2. **Step B (`pmo-project-suite` `xlsx-diff` & `omp_pmo` Wiring):**
   - Implement `compare_schedule_workbooks(left_xlsx, right_xlsx, key_col="UID", output_xlsx=None, profile_path=None)` in `project_sync.py` returning added/removed/changed rows, summary counts, Markdown report, and optional color-coded CWE-1236-sanitized diff `.xlsx`.
   - Wire `--cmd xlsx-diff` in `pmo_cli.py`: explicitly add `--compare` and `--right` to `build_parser()`, forward to `compare_schedule_workbooks()`, wire `omp_pmo` in `domain-tools.ts`, and update `pmo-project-suite/SKILL.md`.
3. **Step C (`system-maintenance-suite` & `email-intelligence-suite` Promotions):**
   - Extend `cleaner_dispatcher.py` `extended` targets (AI tool caches across Win/Darwin, Windows DirectX shader cache) and add `prune_omp_sessions(omp_dir, days_old=7, dry_run=True, force=False)` + `--cmd omp-prune` in `maintenance_cli.py` + `omp_maint` in `domain-tools.ts` (blocking execution without `force: true`).
   - Audit `email_parser.py` `load_emails_from_outlook_com()` for folder/limit parity and clear cross-OS error when run off Windows.
4. **Step D (Run Sieve Scan & Bounded Queue Triage):**
   - Run `"C:/Program Files/Git/bin/bash.exe" -c 'python -B scripts/omp-session-harvester.py --scan --diff-global'` and reconcile top queue clusters (`08338f8ea238`, `625d58761ee9`, `7b3bbd02c764`, `f87f113aafac`, `1347721f0fa9`, `2167df76d0d4`, `290353347605`, etc.) via `--stage` -> test -> `--commit-stage` and `--triage --disposition merged_into|ignored_noise`, clearing phantom `dev_ops_automation` entries.
5. **Step E (Verify):**
   - Run all 4 Python unit test suites (`test_pmo_suite.py`, `test_office_suite.py`, `test_email_suite.py`, `test_maintenance_suite.py`), `bun test tests/test-omp-toolkit-hub.test.ts`, and `python -B scripts/omp-session-harvester.py --round-summary`.

## Success Criteria

- [ ] `pmo_cli.py --cmd xlsx-diff` and `omp_pmo` compare two Excel workbooks cross-OS with CWE-1236 formula safety and pass new unit tests.
- [ ] `system-maintenance-suite` includes AI tool caches and `--cmd omp-prune` protecting `.db*` and recent sessions under `dry_run`/`force` invariants.
- [ ] Top duplicate queue clusters (Excel/MPP sync, CleanPC AI/DISM/OMP modules, Outlook COM) are promoted or triaged with `round >= 1` and `promotedHashes` populated.
- [ ] All Python domain tests and `bun test tests/test-omp-toolkit-hub.test.ts` pass 100% with every hub TS module `<= 200` lines.

## Risk Assessment

- **Accidental deletion of active OMP session or SQLite DB during `omp-prune`:** Enforce strict allowlist (only prune files older than `days_old` inside `sessions/` and `cache/`), explicitly skip any `*.db*` / `*.json` ledger/config files and currently-newest modified session `.jsonl`, and require `force=True` (`--force`).
- **Breaking `domain-tools.ts` 200-line ceiling:** Keep new action names compact in `PMO_ACTIONS` / `MAINT_ACTIONS` and pass `--compare` / `--days-old` cleanly via existing `pushVal` helper.
