# Technical Journal: OMP Session Tool Harvesting, Standardization & Cross-OS Backup Ecosystem

- **Date:** 2026-11-10
- **Author:** omp
- **Context:** Architecture & Planning Session (`/ck:brainstorm` -> `/ck:plan`)
- **Repository:** `zuey-pi-setup` (Public fork, `origin` thanhnt-sm)

---

## 1. Context & Motivation
Across 55 OMP sessions and 14 local project workspaces, high-value utility code (Excel, Word, MS Project, PMO scheduling, Daily Note RAID tracking, Email processing, and OS disk cleanup) had been repeatedly created and stranded in ad-hoc workspaces. The user requested a systematic, automated, multi-session loop to:
- Scout and harvest all reusable scripts and domain tools.
- Standardize them into native, self-contained OMP Managed Skills (`~/.omp/agent/managed-skills/`).
- Enable dual-mode interaction: interactive menus for humans and deterministic CLI flags for OMP subagents.
- Ensure 100% backup and restore fidelity across both Windows (Git Bash/PowerShell) and macOS (POSIX/Apple Silicon).
- Establish a multi-session continuity mechanism so subsequent sessions resume seamlessly from an immutable ledger.

---

## 2. Key Decisions & Architectural Choices

### D1: Self-Contained Managed Skills vs. Monolithic Local MCP Server
- **Decision:** Adopted Self-Contained Managed Skills (`SKILL.md` + `scripts/` + `references/` + `tests/`) backed by a shared Python virtual environment (`~/.omp/tools-venv`).
- **Rationale:** MCP servers introduce continuous background memory overhead, process monitoring complexity, and pipe hangs on Windows/macOS. OMP Managed Skills operate on-demand via standard shell/eval calls, provide natural progressive disclosure, and remain directly runnable by humans in terminal.

### D2: Cross-Platform Parity via Dual-Adapter Pattern
- **Decision:** Core processing for `.xlsx`, `.docx`, `.xml`, and `.eml`/`.msg` is written in pure Python (`openpyxl`, `python-docx`, `defusedxml`, `extract-msg`). Windows-only COM objects (`MSProject.Application`, `Outlook.Application`) are encapsulated as optional acceleration adapters on Windows with automatic fallback on macOS.
- **Rationale:** Ensures tools run flawlessly on macOS without Windows dependencies, while still taking advantage of installed Office COM on Windows when available.

### D3: Two-Tier Security & Backup Boundary
- **Decision:**
  - **Tier 1 (Public Portable):** `omp-setup-backup.sh` captures sanitized configs, dereferenced extensions, `agent/agents/`, `managed-skills/`, and `tools-requirements.txt`. Zero `.db` or `.env` files.
  - **Tier 2 (Private GPG):** `omp-private-backup.sh` captures `mnemopi.db`, `history.db`, and the complete `~/.claude/` ecosystem (`skills/`, `agents/`, `hooks/`, `workflows/`, `settings.json` sanitized).

### D4: Multi-Session Continuity Engine
- **Decision:** Created `plans/omp-consolidation-ledger.json` to track the lifecycle of each target suite across sessions.

---

## 3. Artifacts Created & Next Steps
- **Agreed Brainstorm Report:** `plans/reports/261110-omp-session-tool-consolidation-brainstorm.md`
- **Multi-Session Ledger:** `plans/omp-consolidation-ledger.json` (State: `HARVESTED`)
- **Master Plan & Phases:** `plans/261110-omp-session-tool-consolidation/plan.md` (6 phase specifications)
- **Session & Workspace Harvester CLI:** `scripts/omp-session-harvester.py` & `tests/test-omp-session-harvester.sh` (PASSED)
- **Harvest Inventory & Workstation Discovery:** `plans/harvest-inventory.md` (440 candidate artifacts across 76 OMP sessions and local workspaces, with 34 hash-match clusters primarily representing session-to-workspace mirrors; discovered 33 project `.omp` and 56 project `.claude` folders across workstation roots).
- **Next Step:** Execute Phase 1 (`phase-01-backup-pipeline-agent-hydration-upgrades.md`) via `/ck:cook` to upgrade the backup/restore scripts, bundle managed-skills/agents, and provision cross-OS tools-venv.
