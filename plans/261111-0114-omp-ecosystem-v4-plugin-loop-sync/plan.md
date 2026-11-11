---
title: "OMP Ecosystem V4 Native Tooling Filtered Loop and Cross OS Sync"
description: "Deliver V4 hybrid OMP Extension + Skill tools (omp_office, omp_pmo, omp_email, omp_maint, omp_harvest), noise-filtered multi-round consolidation loop, 16-dir triage & CleanPC v2.6 promotion + safe global linking, unified cross-OS bootstrap + portable mcp.json + omp-doctor."
status: pending
priority: P1
effort: "15h"
branch: main
tags: [omp, v4, extension-tools, harvester-loop, symlink, cross-os, bootstrap, doctor, mcp, tdd]
blockedBy: []
blocks: []
created: 2026-11-11
---

# OMP Ecosystem V4 Native Tooling Filtered Loop and Cross OS Sync

## Overview

Builds directly atop the completed V3 baseline (`plans/261110-1750-omp-ecosystem-v3-hardening/`, verified in `plans/reports/261110-omp-ecosystem-v3-final-audit.md`) and executes the four user-approved decisions from `plans/reports/261110-2208-omp-ecosystem-v4-architecture-brainstorm.md`:

1. **`hybrid_ext_skill`:** Keep Python/Bun cores inside `config/omp/agent/skills/<suite>/scripts/` (`SKILL.md` + `--json` CLI) and expose 5 action-multiplexed native OMP tools (`omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest`) through `config/omp/agent/extensions/omp-toolkit-hub.ts` auto-resolving `~/.omp/tools-venv` across Windows and macOS.
2. **`triage_promote_link_to_global`:** Triage all 16 unpromoted project `.omp`/`.claude`/`.agent` directories, promote custom `CleanPC` v2.6 / portable PM capabilities into `~/.omp/agent/`, keep third-party kits isolated from polluting global prompts, and harden `omp-link-local.py` for mixed-dir and Project -> Global linking.
3. **`split_public_private_bootstrap`:** Preserve the Public/Private boundary (`zuey-pi-setup` vs GPG private archive), add portable `mcp.json.example` + cross-OS `mcp.json` path rehydration, and ship unified `omp-bootstrap.{sh,ps1}` + `omp-doctor.py`.
4. **`filtered_queue_loop`:** Filter `>90%` `#edit` hunks, test runners, and scratchpads out of the actionable harvester queue and run two-phase (`pending -> staged -> promoted`) multi-session consolidation rounds with persistent dispositions.

## Architectural Invariants

1. **Public Repo Hygiene:** Never commit `.db*`, `.env`, API tokens, client identifiers, un-dereferenced symlinks, or raw workstation paths into `config/`, `scripts/`, `plans/`, `docs/`, `tests/`, or `backups/omp-setup-portable.tar.gz`.
2. **Symlink Direction Guarantee:** Global `~/.omp/agent/` owns canonical sources; local project mirrors link **Project -> Global** (`mklink /J` / `ln -s` / hardlink / hash-sync), never **Global -> Project**.
3. **No Duplicated Business Logic:** Extension tools in `omp-toolkit-hub` act strictly as thin `spawnSync` (`shell: false`) argv bridges into `skills/<suite>/scripts/*_cli.py` inside `~/.omp/tools-venv`.
4. **Mirror-Sync Before `--config-dir` Backup:** Always sync `config/omp/agent/` edits into live `~/.omp/agent/` before running `omp-setup-backup.sh --config-dir config/omp` (which wipes and re-mirrors `config/omp/`).
5. **Fail-Open Safety:** Extension handlers and dry-run defaults (`omp_maint` requires explicit `force: true` to delete) must never crash the OMP host process or mutate user Documents/Desktop/Downloads.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Harvester Noise Filter and Resumable Loop Queue](./phase-01-harvester-noise-filter-and-resumable-loop-queue.md) | Pending |
| 2 | [Project Delta Triage CleanPC Promotion and Global Linking](./phase-02-project-delta-triage-cleanpc-promotion-and-global-linking.md) | Pending |
| 3 | [OMP Toolkit Hub Native Domain Tools and Plugin Packaging](./phase-03-omp-toolkit-hub-native-domain-tools-and-plugin-packaging.md) | Pending |
| 4 | [Cross OS Unified Bootstrap MCP Portability and Doctor](./phase-04-cross-os-unified-bootstrap-mcp-portability-and-doctor.md) | Pending |
| 5 | [Docs Sync Live Workstation Cutover and E2E Verification](./phase-05-docs-sync-live-workstation-cutover-and-e2e-verification.md) | Pending |

## Validation & Red-Team Prechecks

- **Brainstorm Consensus Basis:** `plans/reports/261110-2208-omp-ecosystem-v4-architecture-brainstorm.md` (5-persona `ck:predict`, 12-dimension `ck:scenario`, `ck:problem-solving` cascades).
- **Critical Pre-Execution Mitigations Built Into Phases:**
  - Mixed project `skills/` dirs link per-skill subfolder instead of replacing parent directories (`phase-02`).
  - `resolveToolsPython()` rejects WindowsApps stub Python and uses `shell: false` argv calls (`phase-03`).
  - `omp_maint` defaults `dryRun: true` and enforces `force: true` gate for destructive actions (`phase-03`).
  - `mcp.json` uses absent-only initialization from `mcp.json.example` + explicit `{{USER_HOME}}`/`{{CLAUDE_NODE}}` rehydration in `omp-private-restore.sh` (`phase-04`).
