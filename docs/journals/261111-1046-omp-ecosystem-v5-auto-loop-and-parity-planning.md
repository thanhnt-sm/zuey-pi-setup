---
title: "OMP Ecosystem V5 Brainstorming & Planning Journal"
date: 2026-11-11
status: completed
---

# OMP Ecosystem V5 Brainstorming & Planning Journal

## Context & Motivation
User invoked `/skill:ck:brainstorm /skill:ck:team /skill:ck:predict /skill:ck:scenario /skill:ck:problem-solving /skill:ck:scout` to solve repeated ad-hoc script rewriting (Excel, Word, MS Project, util tools) across sessions and unify OMP and Claude Code working environments on both Windows and macOS through complete backup and restore.

## What Was Discovered (Ground-Truth Scouting)
1. **V4 Baseline:** 5 phases of V4 (`plans/261111-0114-omp-ecosystem-v4-plugin-loop-sync/plan.md`) were implemented and verified locally (`plans/reports/261111-omp-ecosystem-v4-final-audit.md`), but remained uncommitted on `main`.
2. **Root Cause of Script Rewriting:** `config/omp/agent/rules/file-type-enforcement.md` commanded agents to call non-existent `mcp__markitdown__convert_to_markdown` and `/md-convert`, with zero mention of `omp_office`, `omp_pmo`, `omp_email`, `omp_maint`. Live `~/.omp/agent/mcp.json` was absent, and upstream overlays (`APPEND_SYSTEM.md`, `pi-smart-fetch`, `compaction-policy.ts`) were not merged into live `~/.omp/agent/`.
3. **Queue Sieve Inefficiencies:** `plans/omp-consolidation-ledger.json` showed `round: 0` and 771 actionable clusters because `harvester_core.py:945` omitted `skills-optin/` in global diff, ignored `workspaceClassification` (`override`/`archive`), self-scanned `zuey-pi-setup` into a phantom `dev_ops_automation` suite, and skipped workspace scripts in `extract_cluster()`.
4. **External Repo Risk:** `C:/Users/thant/Projects/omp_extension` was uninitialized in git and excluded from private GPG backups.

## Key Architectural Decisions
- **Packaging:** Keep Hybrid `omp-toolkit-hub.ts` extension for OMP and pure-Python `~/.omp/tools-venv` CLIs for Claude Code, driven by synchronized rules (zero extra MCP daemon bloat).
- **Loop Strategy:** Pre-triage sieve in `harvester_core.py` cuts queue down to genuine missing tools, driven by a bounded headless runner (`scripts/omp-harvest-loop-runner.sh` with strict test/doctor gates).
- **Single Master Plan:** Created `plans/261111-1046-omp-ecosystem-v5-auto-loop-and-parity/` covering all 4 streams + V4 baseline commit so all subsequent sessions run strictly `/ck:cook --auto --tdd` without needing further plans.

## Red Team & Codebase Verification
- Verified 32/32 existing paths and symbols cited across all 5 phases (`Failed: 0`).
- Incorporated 8 architectural fixes from `V5PlanRedTeamArch` into `phase-01` through `phase-04` (argument syntax, loop termination deadlocks, 200-line TS limits, doctor advisory flags).
