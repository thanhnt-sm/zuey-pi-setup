# Phase 3: PMO & Project Management Suite Standardization

## Overview
Package and standardize the Project Management (PMO) domain utilities harvested from `pmi-pmo-framework`, `Note_multiline` (`pmo.py`), and `project-excel-sync-toolkit-2.3.0` into a unified, self-contained OMP Managed Skill at `config/omp/agent/managed-skills/pmo-project-suite/`.

## Requirements
- **Functional Requirements:**
  1. Consolidate WBS, CPM, EVM, PERT, and Risk calculation modules into a single cross-platform Python core (`scripts/core_pmo.py`) using `openpyxl` and `defusedxml`.
  2. Integrate the Daily Note parsing and RAID CI/CD tracker (`pmo.py` from `Note_multiline`) into `scripts/note_raid_tracker.py`.
  3. Generalize the 33 PowerShell MS Project ↔ Excel sync scripts into a cross-platform Python engine (`scripts/project_sync.py`) supporting MS Project XML format natively on Windows & macOS, with optional Windows COM acceleration (`MSProject.Application`) when available.
  4. Create a unified CLI (`scripts/pmo_cli.py`) with:
     - **Interactive Menu Mode:** TTY execution without flags presents numbered options:
       1. Run WBS / CPM / EVM Schedule Analysis
       2. Parse Daily Notes & Update RAID Register
       3. Sync MS Project (XML/MPP) and Excel Schedule
       4. Generate PM Status Report (Markdown / Excel)
     - **Non-Interactive Agent Mode:** CLI flags `--cmd [cpm|evm|raid|sync|report] --input ... --output ... --json` for autonomous execution by OMP agents.
  5. Author `SKILL.md` with comprehensive usage instructions, prompt triggers, argument hints, and subagent descriptions (`pmo-planner`, `pmo-reporter`, `pmo-red-team`, `pmo-ba`).
  6. Author unit tests covering WBS calculation, EVM metrics, and note parsing.
- **Non-Functional Requirements:**
  - Zero hardcoded internal customer or project references.
  - 100% executable on macOS (no dependency on Windows PowerShell or COM).

## Related Code Files
- **Create:** `config/omp/agent/managed-skills/pmo-project-suite/SKILL.md`
- **Create:** `config/omp/agent/managed-skills/pmo-project-suite/scripts/pmo_cli.py`
- **Create:** `config/omp/agent/managed-skills/pmo-project-suite/scripts/core_pmo.py`
- **Create:** `config/omp/agent/managed-skills/pmo-project-suite/scripts/note_raid_tracker.py`
- **Create:** `config/omp/agent/managed-skills/pmo-project-suite/scripts/project_sync.py`
- **Create:** `config/omp/agent/managed-skills/pmo-project-suite/tests/test_pmo_suite.py`
- **Modify:** `plans/omp-consolidation-ledger.json` (mark `pmo_project_suite` as `PACKAGED`)

## Implementation Steps
1. **Scaffold Managed Skill Directory:**
   - Create `config/omp/agent/managed-skills/pmo-project-suite/{scripts,references,tests}`.
2. **Port & Sanitize Core Modules:**
   - Extract mathematical CPM / EVM calculation from `pmi-pmo-framework`.
   - Port `pmo.py` note parsing logic from `Note_multiline`.
   - Generalize MS Project XML parser using `xml.etree.ElementTree` / `defusedxml`.
3. **Build `pmo_cli.py` Dual-Mode Runner:**
   - Implement `argparse` with fallback to interactive terminal prompt if no arguments are provided.
4. **Write Tests:**
   - Test CPM critical path calculation on a sample 5-task project.
   - Test EVM metrics calculation (CV, SV, CPI, SPI).
   - Test note parsing on a sample multiline Markdown note.

## Success Criteria
- [ ] `python config/omp/agent/managed-skills/pmo-project-suite/tests/test_pmo_suite.py` runs and passes all assertions.
- [ ] Running `pmo_cli.py --cmd cpm` produces valid critical path analysis.
- [ ] `SKILL.md` contains clear trigger instructions for OMP agents.
