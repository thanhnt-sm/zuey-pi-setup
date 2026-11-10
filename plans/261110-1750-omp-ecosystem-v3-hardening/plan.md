---
title: "OMP Ecosystem V3 Hardening Incremental Loop and Cross OS Parity"
description: "Repair V2 dirty-tree leaks & local-config contracts, ship standalone incremental watermark harvester + thin OMP toolkit extension, port global Claude core agents/rules/workflows + opt-in local reference linker, add pure-Python PDF + macOS .mpp guidance + private mnemopi/session hygiene, and verify cross-OS Windows/macOS E2E."
status: pending
priority: P1
effort: "16h"
branch: main
tags: [omp, claude, harvester-loop, extension, cross-platform, backup-restore, pdf, pmo, security, tdd]
blockedBy: []
blocks: []
supersedes: 261110-omp-session-tool-consolidation
created: 2026-11-10
---

# OMP Ecosystem V3 Hardening Incremental Loop and Cross OS Parity

## Overview

Hardens and extends the V2 OMP consolidation architecture based on the V3 consensus report (`plans/reports/261110-1745-omp-ecosystem-v3-brainstorm.md`). Phase 1 repairs the uncommitted V2 cutover leaks and broken local-config contracts so the baseline commits cleanly; Phases 2-5 add incremental `O(delta)` session harvesting with full source extraction, a thin native OMP extension (`omp-toolkit-hub.ts`), global `~/.claude` core agent/rule/workflow parity plus an opt-in workspace reference linker, pure-Python PDF support (`pypdf`), and private backup hygiene (`mnemopi` scratch filtering + optional `--sessions`).

## Architectural Invariants

1. **Public vs Private Boundary:** Tracked repo files (`config/`, `scripts/`, `plans/`, `tests/`, `backups/omp-setup-portable.tar.gz`) NEVER contain `.db*`, API keys/tokens, un-dereferenced symlinks, private customer identifiers, or machine-specific drive/user paths (`~/.omp/harvest-workspaces.local.json` owns local workstation roots and private redaction terms).
2. **Hybrid OMP Packaging:** Heavy file utilities stay in Priority-100 Skills (`~/.omp/agent/skills/`) backed by `~/.omp/tools-venv` pure-Python Dual-Mode CLIs (`--cmd ... --json` + interactive TTY menu); cross-session loop state and `session_compact` checkpointing live in one thin OMP native extension (`extensions/omp-toolkit-hub.ts`) with zero persistent MCP daemon.
3. **Incremental Loop Inheritance:** `scripts/omp-session-harvester.py` (bundled standalone inside the `omp-session-harvester` skill) tracks per-file `mtime_ns`/`size`/`sha256` watermarks and `promotedHashes`, supports `--extract <hash>`, and auto-reopens `COMPLETED` -> `DRIFT_DETECTED` when new sessions or local assets appear.
4. **Canonical Global + Opt-In Local Projection:** Global `~/.omp/agent/` is the single source of truth; an opt-in local linker replaces eligible shared workspace mirrors using a classification manifest (`override` vs `shared_mirror` vs `archive`), while `omp-setup-backup.sh` always materializes physical copies (`cp -rL`).
5. **No Bulk Foreign Kit Bloat:** Deliberately excludes bulk-porting third-party RuFlo/BMAD/APEX/marketing kits; scopes parity strictly to core `~/.claude` agents, rules, workflows, and PM/BA pre-write guards.
6. **Mirror Direction Guard (`--config-dir` Wipes Target):** `scripts/omp-setup-backup.sh --config-dir config/omp` wipes and re-mirrors `config/omp/` from `~/.omp/agent/`. Any edits written under `config/omp/agent/` in Phases 1-4 MUST be synced into live `~/.omp/agent/` before running `--config-dir` backup (or run `omp-setup-backup.sh` only after syncing).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Dirty-Tree Repair Leak Scrub and Standalone Harvester](./phase-01-dirty-tree-repair-leak-scrub-and-standalone-harvester.md) | Completed |
| 2 | [Incremental Watermark Loop and Thin OMP Extension](./phase-02-incremental-watermark-loop-and-thin-omp-extension.md) | Completed |
| 3 | [Global Claude Parity and Opt-In Local Reference Linker](./phase-03-global-claude-parity-and-opt-in-local-reference-linker.md) | Completed |
| 4 | [Cross-OS PDF MPP Fallback and Private Archive Hygiene](./phase-04-cross-os-pdf-mpp-fallback-and-private-archive-hygiene.md) | Completed |
| 5 | [Cross-OS E2E Validation Live Sync and Release](./phase-05-cross-os-e2e-validation-live-sync-and-release.md) | Pending |

## Red Team Review & Verification Log

- **Red Team Reviewer (`reviewer`, 2026-11-10):** 9 verified findings (`2 CRITICAL, 4 HIGH, 3 MEDIUM`, confidence `0.92-1.00`), all remediated across `phase-01`..`phase-05`:
  1. Scrubbed residual workstation/project literals from `phase-01`, `phase-03`, V3 brainstorm report/journal, and added `config/omp/agent/rules/file-type-enforcement.md:81` to Phase 1 Step C.
  2. Scoped `ABS_LEFT` in Phase 1 to exclude illustrative doc placeholders (`user`, `username`, `jesse`, `name`, `example`, `demo`, `<user>`) and test regex fixtures so `skills-optin/` and `pm-ba` docs do not false-fail.
  3. Corrected Phase 3 Claude agent conversion rules (`model: inherit`, `WebSearch->web_search`, `Agent(*)->task`, drop unsupported keys/tools, scrub `mcp-manager.md`/`planner.md` body paths, adapt `orchestration-protocol.md` hooks).
  4. Deferred `_PRIV_PAT` compilation in `omp-promote-assets.py` & `omp-session-harvester.py` until after CLI flag / `--no-local-config` parsing.
  5. Added `fileWatermarks[path].artifacts` descriptor rehydration in Phase 2 so skipped unchanged `.jsonl` scans preserve aggregate counts and clusters.
  6. Replaced cross-volume `mklink /H` in Phase 3 `omp-link-local.py` with pure-subset `mklink /J` + hash-verified copy sync fallback for mixed dirs and cross-volume `.md` files.
  7. Unified `omp-session-harvester` under canonical `harvester_core.py` inside the skill scripts dir and defaulted `--ledger`/`--report` outside repo CWD to `~/.omp/agent/`.
  8. Added `omp-plugins.lock.json` reconciliation in `omp-setup-restore.sh:274-302` and Phase 5 doc update (`docs/omp-operations-guide.md:270-274`).
  9. Hardened Phase 4 `omp-private-backup.sh --sessions` with lock-tolerant Python `*.jsonl` + `memory/**` staging helper.

## Validation Log

- **User Consensus (2026-11-10):** Confirmed `manifest_optin_link`, `hybrid_skills_plus_thin_ext`, `incremental_watermark_registry`, and 4 core hardening items while excluding bulk third-party kit porting.
- **TypeSafe Elevation Note:** Attempt 1 (`5-line` summary) scored `1.64`; Attempt 2 flagged heuristic string match on `~/.claude/` references inside plan text. Plan enforces strict **READ-ONLY export from `~/.claude/`** into `config/omp/agent/` (`omp-private-restore.sh` restores `--claude` exclusively onto target/temp homes, never live `~/.claude/`).
- **Codebase Verification Pass:** Verified `plan-cli.cjs status` = `pending` (5 phases); verified existing files & symbols (`_load_config`, `promote_all`, `_private_terms_pattern`, `sanitize_content`, `scan_global_diff`, `to_md`, `export_mpp_via_windows_com`, `ABS_LEFT`, `omp-plugins.lock.json`, `18` `~/.claude/agents/*.md`, `6` `~/.claude/rules/*.md`, `4` `~/.claude/workflows/*`).
