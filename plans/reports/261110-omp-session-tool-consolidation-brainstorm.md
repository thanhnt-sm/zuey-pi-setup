---
title: "OMP Session Harvesting, Cross-Platform Tool Standardization & Full Environment Backup/Restore"
date: 2026-11-10
status: agreed
scope: zuey-pi-setup
decisions:
  packaging_arch: self_contained_skills
  security_tier: clean_public_plus_gpg_claude
  target_suites:
    - pmo_project_suite
    - office_doc_suite
    - email_intelligence_suite
    - system_maintenance_suite
    - omp_session_harvester
  loop_mechanism: ledger_plus_phased_plan
---

# Brainstorm Report: OMP Session Harvesting, Tool Standardization & Cross-OS Backup/Restore

## 1. Problem Statement & Requirements

Across **76 OMP session transcripts**, **10 Claude session files**, **33 project-level `.omp` directories**, and **56 project-level `.claude` directories** on this Windows workstation, high-value utility code and domain workflows (Excel `.xlsx`, Word `.docx`, MS Project `.mpp`/`.xml`, PMO WBS/CPM/EVM calculators, Daily PM Notes/RAID trackers, Outlook/`.eml`/`.msg` email pipelines, spatial PDF/table extractors, and Windows/macOS disk cleanup scripts) have been repeatedly built or isolated inside project folders.

### Core Objectives
1. **Harvest & Deduplicate:** Scan all 76 OMP sessions, 10 Claude sessions, and project workspaces to extract reusable scripts, tools, agents, and flows without losing domain logic.
2. **Standardize to OMP-Native Architecture:** Package utilities into self-contained, reusable OMP artifacts that run both interactively (menu-driven for humans) and non-interactively (CLI flags for agents).
3. **Ingestion & Dereference over Symlinks:** Explicitly avoid local absolute symlinks (which break across machines and risk leaking proprietary project code into public repos). Ingest reusable assets into self-contained OMP Managed Skills (`~/.omp/agent/managed-skills/`).
4. **Cross-Platform Parity (Windows + macOS):** Ensure tools and backup/restore scripts operate reliably on both Windows (Git Bash / PowerShell) and macOS (Apple Silicon / POSIX), with automatic dependency hydration (`~/.omp/tools-venv`).
5. **Full Environment Backup & Restore (Two-Tier):** Close all backup gaps (`~/.omp/agent/agents/`, `~/.omp/agent/managed-skills/`, `~/.claude/{skills,agents,hooks,workflows}`, Python tool dependencies) while maintaining strict separation between Public Git (`zuey-pi-setup`) and GPG Private Archives (`omp-private-backup.sh`).
6. **Multi-Session Continuity Loop:** Enable long-running harvesting and standardization across multiple sessions via a persistent state ledger (`plans/omp-consolidation-ledger.json`), allowing each new session to resume deterministically from the prior checkpoint.
---

## 2. Scout Inventory Summary (55 Sessions / 14 Workspaces)

| Suite Target | Discovered Source Locations | Key Assets Found | Cross-OS Strategy |
|---|---|---|---|
| **`pmo-project-suite`** | `~/<workspace>/pmi-pmo-framework`, `note-daily-tracker` (`pmo.py`), `project-excel-sync-toolkit` | 15 Python PMO modules (WBS, CPM, EVM, PERT, Risk, RTM, Excel), 4 PMO agents, Daily Note RAID CI/CD pipeline (`pmo.py`), 33 PowerShell MS Project ↔ Excel sync scripts | Core `.xlsx` + MS Project `.xml` + RAID/WBS/CPM/EVM in pure Python (`openpyxl`, `defusedxml`) for Windows + macOS; Windows COM adapter (`MSProject.Application`) optional on Windows |
| **`office-doc-suite`** | `<workspace>/document-analysis-suite`, `schedule-cpm-analysis`, `spatial-file-processing`, `~/.claude/skills/md-convert` | MD ↔ DOCX/XLSX converters with embedded Mermaid diagrams, weekly KPI calculators, spatial table/receipt extractors (`spatial_extractor.py`, `report_generator.py`) | Pure Python (`python-docx`, `openpyxl`, `markdown`) + Mermaid CLI/SVG fallback across Windows & macOS |
| **`email-intelligence-suite`** | `<workspace>/email-export-tools` (`core/engine/*.py`, `scripts/*.ps1`) | `.eml`/`.msg` parser, thread splitter, SHA-256 deduplicator, Excel/Markdown issue aggregator, Outlook COM exporter | Pure Python `.eml`/`.msg`/MBOX parser & Excel/MD builder (Windows + macOS) + optional Windows PowerShell Outlook COM extractor |
| **`system-maintenance-suite`** | `<workspace>/system-clean-pc`, managed skills `windows-cleanup-pipeline`, `wiztree-cli-analyzer`, `ai-tool-uninstaller-builder` | 13 Windows `.ps1` cleanup modules + WizTree analyzer, 13 macOS `.sh` cleanup modules, cross-OS AI tool uninstaller builder | Unified dispatcher detecting `uname -s`: runs `.ps1`/WizTree on Windows and `.sh`/`du`/`find` modules on macOS |
| **`omp-session-harvester`** | `~/.omp/agent/sessions/*.jsonl`, `~/.omp/agent/history.db`, `xd://eval/archive` | 55 session JSONL transcripts & prompt history | Python/Bun scanner indexing sessions, extracting code artifacts, scrubbing project-specific paths/secrets, and updating `omp-consolidation-ledger.json` |

---

## 3. Evaluated Approaches

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Self-Contained OMP Managed Skills + Dual-Mode CLI + Shared Python Venv (`~/.omp/tools-venv`)** | Native to OMP (`skill://<name>`); zero background RAM overhead; progressive disclosure (`SKILL.md` + `scripts/` + `tests/`); single shared venv hydrated on restore | Requires generalizing project-specific paths during harvesting | **SELECTED** |
| **B. Monolithic Local MCP Server** | Exposes tools as JSON-RPC | High idle memory; stdio pipe hangs on Windows/macOS; harder for human CLI use | Rejected (violates KISS/YAGNI) |
| **C. Raw Project Directory Copy into Repo** | Zero refactoring effort | Leaks internal project names/credentials, bloated repo, broken hardcoded paths on macOS | Rejected (security & portability failure) |

---

## 4. Final Agreed Architecture & Security Boundaries

### 4.1 Two-Tier Backup & Restore Boundary
1. **Tier 1 — Public Portable Snapshot (`scripts/omp-setup-backup.sh` → `config/omp/` & `backups/omp-setup-portable.tar.gz`):**
   - `agent/config.yml` (templated `{{SHELL_PATH}}`), `agent/models.yml` (`!printenv`), `agent/.env.example`, `agent/commandcode-models.json`.
   - `agent/extensions/` (dereferenced `typesafe-planner` source).
   - **NEW:** `agent/agents/*.md` (`advisor.md`, `ck-advisor.md`, `pmo-ba.md`, `pmo-planner.md`, `pmo-red-team.md`, `pmo-reporter.md`).
   - **NEW:** `agent/skills/` (if present) and `agent/managed-skills/` containing all 5 generalized cross-platform tool suites (`SKILL.md` + `scripts/` + `references/` + `tests/`).
   - **NEW:** `agent/tools-requirements.txt` — automatically hydrated by `omp-setup-restore.sh` into `~/.omp/tools-venv` (via `uv venv` or `python3 -m venv`) on both Windows and macOS unless `--no-install` is passed.
2. **Tier 2 — Private Encrypted Archive (`scripts/omp-private-backup.sh` → `~/omp-private-backups/*.tar.gz.gpg`):**
   - `mnemopi.db` memory banks + `history.db` (via SQLite `VACUUM INTO`).
   - **NEW:** Full `~/.claude/` ecosystem snapshot (`skills/`, `agents/`, `hooks/`, `workflows/`, `mcp/typesafe/`, `.ck.json`, `settings.json` sanitized) and `~/.agents/skills/` links so a second workstation gets 100% of ClaudeKit + custom workflows in one `omp-private-restore.sh` run.

### 4.2 Dual-Mode CLI Contract for All Harvested Tool Suites
Every harvested Python CLI in `~/.omp/agent/managed-skills/<suite>/scripts/` MUST support:
- **Interactive Human Mode:** Running `python cli.py` in a TTY without flags opens a numbered interactive menu (matching the `pmo.py` UX preference so the user never has to memorize flags).
- **Autonomous Agent Mode:** Running `python cli.py <subcommand> --input ... --output ... --non-interactive` executes deterministically with structured JSON/Markdown output and exit codes (`0` = success, `1` = validation error, `2` = environment/dependency error).

### 4.3 Multi-Session Continuity Engine (`plans/omp-consolidation-ledger.json`)
To execute across multiple sessions without losing context:
- `plans/omp-consolidation-ledger.json` tracks every session ID (`55` sessions), every source workspace (`14` workspaces), and the lifecycle state of each target suite (`PENDING` → `HARVESTED` → `SANITIZED` → `PACKAGED` → `VERIFIED_WIN` → `VERIFIED_POSIX` → `BACKED_UP`).
- Each phase in the implementation plan updates the ledger and runs a deterministic verification gate before committing.

---

## 5. Risks & Mitigations (`ck:predict` & `ck:scenario`)

| Risk | Severity | Mitigation |
|---|---|---|
| Proprietary project names/URLs leaking from project scripts into public repo | **Critical** | Automated regex sanitization gate in `omp-setup-backup.sh` and `tests/test-omp-migration.sh` rejecting internal domain/project markers before staging |
| Windows-only COM scripts (`MSProject.Application`, `Outlook.Application`) failing on macOS | **High** | Dual-Adapter pattern: pure Python (`openpyxl`, `python-docx`, `email`/`extract-msg`, MS Project XML) is the default cross-OS engine; Windows COM is an optional `--use-com` / Windows-detected adapter |
| Missing Python libraries on fresh macOS/Windows machine | **High** | `omp-setup-restore.sh` provisions `~/.omp/tools-venv` from `agent/tools-requirements.txt` and generates cross-OS wrapper shims |
| Context window exhaustion during multi-suite migration | **Medium** | Decompose into 6 independent phases; each phase processes at most 1–2 suites and records state in `plans/omp-consolidation-ledger.json` |

---

## 6. Success Metrics & Validation Criteria
- **100% Asset Coverage:** `agent/agents/`, `agent/managed-skills/` (with bundled `scripts/`), `agent/tools-requirements.txt` in portable backup; full `~/.claude/` in private GPG backup.
- **Zero Secret / Internal-Name Leakage:** Anchored regex scan passes with 0 hits on both `git diff` and `backups/omp-setup-portable.tar.gz`.
- **Cross-OS Test Suite Pass:** All existing + new TDD suites pass on Windows Git Bash and simulated Darwin/macOS restore paths.
- **Resumability:** Any new session can run `python scripts/omp-consolidation-status.py` (or read `plans/omp-consolidation-ledger.json`) to immediately identify and execute the next uncompleted phase.

---

## 7. Consensus & Next Steps
- **Consensus Date:** 2026-11-10
- **Chosen Architecture:** **OMP Self-Contained Managed Skills + Tools-Venv** (`managed_skills_venv`). No resident MCP daemon; pure Python cross-platform core with Windows COM as optional accelerator.
- **Selected Immediate Phase:** **Phase 1: Backup Pipeline & Agent Hydration Upgrades** (`phase1_upgrade_backup`).
- **Execution Contract:** Proceed via `/ck:cook` with `plans/261110-omp-session-tool-consolidation/phase-01-backup-pipeline-agent-hydration-upgrades.md`.
