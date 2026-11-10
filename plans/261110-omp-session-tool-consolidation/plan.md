---
title: "OMP Session Tool Harvesting, Standardization & Cross-OS Backup Ecosystem"
description: "Harvest reusable tools, scripts, and workflows across 55 OMP sessions & 14 workspaces; standardize into 5 self-contained OMP Managed Skills; achieve 100% backup/restore parity on Windows & macOS via multi-session ledger loop."
status: pending
priority: P1
effort: "16h"
branch: main
tags: [omp, session-harvesting, managed-skills, cross-platform, backup-restore, macos, windows, pmo, office-suite, email-intel, system-maintenance]
blockedBy: []
blocks: []
created: 2026-11-10
---

# OMP Session Tool Harvesting, Standardization & Cross-OS Backup Ecosystem

## Executive Summary & Core Objectives

Over 55 OMP sessions and 14 local project workspaces, high-value utilities for Excel (`.xlsx`), Word (`.docx`), MS Project (`.mpp`/`.xml`), PMO analytics (WBS, CPM, EVM, PERT, Daily Note RAID tracking), Email processing (`.eml`/`.msg`), and System Maintenance (cross-platform disk cleanup and AI tool uninstallers) were developed repeatedly as ad-hoc scripts.

This plan executes a rigorous, multi-session loop to:
1. **Harvest & Deduplicate:** Scan transcripts and workspaces to extract and catalog all tools into a persistent ledger (`plans/omp-consolidation-ledger.json`).
2. **Standardize into 5 OMP-Native Managed Skills:** Convert harvested logic into self-contained managed skills (`SKILL.md` + `scripts/` + `references/` + `tests/`) supporting dual-mode UX (interactive numbered menus for humans, deterministic CLI flags for agents).
3. **Ensure 100% Backup & Restore Parity on Windows & macOS:**
   - **Public Tier:** Package `agent/agents/`, `agent/managed-skills/`, dereferenced `typesafe-planner`, and `agent/tools-requirements.txt` into `config/omp/` and `backups/omp-setup-portable.tar.gz`.
   - **Private Tier:** Expand `scripts/omp-private-backup.sh` to capture SQLite databases (`mnemopi.db`, `history.db`) and the complete `~/.claude/` ecosystem (`skills/`, `agents/`, `hooks/`, `workflows/`, `mcp/`).
   - **Tool Venv Hydration:** Automatically bootstrap and hydrate `~/.omp/tools-venv` on both Windows and macOS upon restore.

---

## Architectural Principles & Isolation Invariants

1. **Self-Contained OMP Managed Skills**: Each tool suite resides under `~/.omp/agent/managed-skills/<suite>/`. It carries its own Python/Node CLI, test suite, and operational instructions. Zero background memory footprint when idle.
2. **Dual-Adapter Pattern (Cross-OS Parity)**: Core processing for `.xlsx`, `.docx`, `.xml`, and email parsing is implemented in pure Python (`openpyxl`, `python-docx`, `defusedxml`, `email`, `extract-msg`). Windows-only COM objects (`MSProject.Application`, `Outlook.Application`) are encapsulated as optional performance accelerators on Windows with automated fallback on macOS.
3. **Strict Two-Tier Security Boundary**:
   - **Public Repository (`zuey-pi-setup`)**: STRICTLY ZERO SQLite databases (`*.db`), zero auth tokens, zero personal emails, zero internal project code names or customer identifiers. Sanitization gates enforce placeholder patterns (`YOUR_..._HERE`).
   - **Private GPG Archive (`omp-private-backup.sh`)**: AES-256 encrypted archive stored strictly outside git work trees, containing mnemopi memories, prompt history, and proprietary Claude workflows.
4. **Multi-Session Continuity Ledger**: All cross-session progress is recorded in `plans/omp-consolidation-ledger.json` and `loop-results.tsv`. Each session starts by checking the ledger, executing the next pending unit, and running verification before committing.

---

## Phases Overview

| Phase | Name | Scope & Deliverables | Priority | Effort | Status |
|:---:|---|---|:---:|:---:|:---:|
| **1** | [Backup Pipeline & Agent Hydration Upgrades](./phase-01-backup-pipeline-agent-hydration-upgrades.md) | Upgrade `omp-setup-backup.sh`, `omp-setup-restore.sh`, and `omp-private-backup.sh` to include `agent/agents/`, `managed-skills/`, `~/.claude/` ecosystem, and `tools-venv` auto-hydration | P1 | 3h | Pending |
| **2** | [Session & Workspace Harvester CLI](./phase-02-session-workspace-harvester-cli.md) | Build autonomous harvester (`scripts/omp-session-harvester.py`) scanning 55 sessions and 14 workspaces; index code into `omp-consolidation-ledger.json` | P1 | 2.5h | Pending |
| **3** | [PMO & Project Management Suite Standardization](./phase-03-pmo-project-management-suite-standardization.md) | Generalize PMI-PMO framework + Note RAID CI/CD (`pmo.py`) + MS Project/Excel sync into `pmo-project-suite` managed skill with cross-OS Python CLI | P1 | 3h | Pending |
| **4** | [Office & Document Processing Suite Standardization](./phase-04-office-document-processing-suite-standardization.md) | Unify Markdown ↔ Word (`.docx`), Excel KPI generator, and spatial table/receipt extractors into `office-doc-suite` managed skill | P2 | 2.5h | Pending |
| **5** | [Email Intelligence & System Maintenance Suites](./phase-05-email-intelligence-system-maintenance-suites.md) | Package `.eml`/`.msg` pipeline into `email-intelligence-suite` and cross-platform cleanup (.ps1 + .sh) into `system-maintenance-suite` | P2 | 2.5h | Pending |
| **6** | [Cross-OS End-to-End Validation & Ledger Finalization](./phase-06-cross-os-end-to-end-validation-ledger-finalization.md) | Run full migration test suite, simulated Darwin/macOS restore, verify dual-mode CLIs, and seal consolidation ledger | P1 | 2.5h | Pending |

---

## Full Regression Acceptance Gate

Before closing this multi-session roadmap, the following test suite must pass with 0 failures:
```bash
"C:/Program Files/Git/bin/bash.exe" tests/test-omp-migration.sh
"C:/Program Files/Git/bin/bash.exe" tests/test-omp-private-restore.sh
"C:/Program Files/Git/bin/bash.exe" tests/test-omp-syncignore.sh
"C:/Program Files/Git/bin/bash.exe" tests/test-omp-sync-extraction.sh
"C:/Program Files/Git/bin/bash.exe" tests/test-omp-tools-venv-hydration.sh
"C:/Program Files/Git/bin/bash.exe" tests/test-omp-managed-skills-integrity.sh
```
