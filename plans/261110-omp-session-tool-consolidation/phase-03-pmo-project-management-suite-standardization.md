---
phase: 3
title: "PMO Project Suite Relocation, Full Parity & Bug Fixes"
status: pending
priority: P1
effort: "4h"
dependencies: [2]
---

# Phase 3: PMO Project Suite Relocation, Full Parity & Bug Fixes

## Overview
Move drafted `pmo-project-suite` from `config/managed-skills/` to OMP-native Priority-100 `config/omp/agent/skills/pmo-project-suite/`, install all 4 `pmo-*.md` agents (`autoloadSkills: [pmo-project-suite]`) and `pmo-delivery` command, port all missing `pmi_pmo` / `pmo.py` / `project-excel-sync-toolkit` subsystems, and fix every verified bug.

## Requirements
- **Functional:**
  1. Relocate `config/managed-skills/pmo-project-suite/` -> `config/omp/agent/skills/pmo-project-suite/` and remove obsolete `config/managed-skills/pmo-project-suite/`.
  2. Install `pmo-ba.md`, `pmo-planner.md`, `pmo-reporter.md`, `pmo-red-team.md` in `config/omp/agent/agents/` with `autoloadSkills: [pmo-project-suite]`, and port `flows/project-delivery.md` to `config/omp/agent/commands/pmo-delivery.md`.
  3. Complete `core_pmo.py` parity with `pmi_pmo`:
     - Add `obligation.py`, `cr.py`, `security.py` (Zip Slip / Tar traversal / zip bomb / injection scanner), `manifest.py`, `state.py` (`anti_rework`), `excel.py` (`safe_load_workbook` + `=hyperlink(`/pipe checks), `dates.py` (working days/milestones), `rtm.py` (circular dependency & topo sort), `capacity.py` (`calculate_sprint_metrics`), `reports.py` (Check 3 + `risk_level`).
     - Fix `weight == 0.0` `continue`, `scope_state` exclusion, whitespace evidence, and CPM `_find_paths` `abs(ef - dur) < 1e-4` filter.
  4. Complete `note_raid_tracker.py` parity & fixes:
     - Fix `generate_raid_markdown_report` column mappings (`Decisions`/`QnA`/`CR_candidates` status vs notes/source; `Risks` description column).
     - Defer `check_excel_locked()` until write (`dry_run=True` works when workbook is open in Excel); wire CLI backup rotation; add `auto_init=False` typo safety; support Vietnamese statuses (`đã đóng`, `hủy`, `đã chốt`); restore Dashboard `COUNTIF` & dropdowns.
     - Port `pmo.py` 7-stage CI/CD (`doctor`, `new`, `lint` fuzzy member check, capacity guard, Jaccard dedupe `stage_action_plan`, `cmd_roll`, `archive_inbox_rows`) and `.pmo_config.json` config support.
  5. Complete `project_sync.py` parity & fixes:
     - Fix `PercentComplete` `0..100` vs `0..1` normalization (`1` -> `0.01`, not `1.0`).
     - Update `_SyncMeta` baseline/generation on `xlsx2msp`; add `--use-com` CLI flag with `$app.DisplayAlerts = $false`; harden `_assert_safe_xml_bytes` for UTF-16 BOM.
     - Add `profile.json` configurable column/WBS/indentation mapping, sprint date-range extractor, standalone Excel->XML plan builder, and conflict resolution policies (`Project`/`Excel`/`Base`/`Custom`).
- **Non-Functional:**
  - Zero internal customer names or hardcoded Windows `D:/` paths; runs via `~/.omp/tools-venv` on Windows & macOS.

## Related Code Files
- Move/Upgrade: `config/omp/agent/skills/pmo-project-suite/**` (and delete `config/managed-skills/pmo-project-suite/`)
- Create: `config/omp/agent/agents/pmo-{ba,planner,reporter,red-team}.md`, `config/omp/agent/commands/pmo-delivery.md`

## Implementation Steps
1. Relocate suite to `config/omp/agent/skills/pmo-project-suite/` and install agents/flow command.
2. Port missing `pmi_pmo` modules and fix `core_pmo.py` bugs.
3. Port `pmo.py` 7-stage CI/CD and fix all `note_raid_tracker.py` column/lock/Vietnamese-status bugs.
4. Add `profile.json` / sprint / plan-builder / conflict-policy and fix `project_sync.py` bugs.
5. Expand `tests/test_pmo_suite.py` and run with `~/.omp/tools-venv` (or Python 3 env).

## Success Criteria
- [ ] `python3 config/omp/agent/skills/pmo-project-suite/tests/test_pmo_suite.py` exits 0 covering all fixed bugs and ported modules.
- [ ] `pmo_cli.py --cmd cpm|evm|obligation|cr|raid|sync|sprint|report --json` and interactive TTY exit cleanly.
