---
phase: 2
title: "Harvester Signal Sieve and Headless Loop Runner"
status: pending
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: Harvester Signal Sieve and Headless Loop Runner

## Overview

Fix all remaining signal-to-noise and extraction bugs in `harvester_core.py` (omitted `skills-optin/`, ignored `workspaceClassification` in `scan_global_diff()`, repo self-indexing into phantom `dev_ops_automation`, missing workspace fallback in `extract_cluster()`, missing advisory lock) and ship a bounded unattended headless loop runner `scripts/omp-harvest-loop-runner.sh` (`--tdd`).

## Requirements
  - Scope repo self-scan filtering strictly to the absolute path of the active `zuey-pi-setup` repository during `scan_workspaces()` (keeping transcript session `dev_ops_automation` classification like `scripts/svn_migrator.py` intact for unit tests) and mark `dev_ops_automation` as `TRIAGED_3_TIER` in `plans/omp-consolidation-ledger.json` so `get_next_unit()` terminates cleanly.
  - Fix `SessionHarvester.extract_cluster()` and `update_ledger()` so workspace-origin scripts (`scan_workspaces`) store relative sanitized extraction metadata in `omp-harvester-cache.json` (`clusterIndex`) and extract cleanly with `_PRIV_PAT` + `sanitize_path` redaction, never leaking raw host drive paths into `plans/omp-consolidation-ledger.json`.
  - Prevent `zuey-pi-setup` own repository paths (`scripts/`, `tests/`, `plans/`, `docs/`, `config/omp/agent/extensions/omp-toolkit-hub*`) from entering `promotionQueue` or creating phantom `dev_ops_automation` suite targets, while keeping `config/omp/agent/skills/` hashes indexed as `already_promoted` reference signatures.
  - Fix `SessionHarvester.extract_cluster()` and `update_ledger()` so workspace-origin scripts (`scan_workspaces`) store local extraction metadata in `omp-harvester-cache.json` (`clusterIndex`) and extract cleanly with `_PRIV_PAT` + `sanitize_path` redaction without leaking host paths into `plans/omp-consolidation-ledger.json`.
  - Add `--auto-triage-known` capability/signature matcher and `scripts/omp-harvest-loop-runner.sh` (`--max-rounds`, `--batch-size`, `--dry-run`, `--headless`) wrapping `omp -p` (or mock command in tests) with mandatory `unittest` + `bun test` + `omp-doctor --strict` gate before `--commit-stage` and rollback of `staged` items on failure.
  - Guard concurrent harvester runs with a stale-safe advisory lockfile (`~/.omp/harvester.lock` with PID check / timeout cleanup).
- Non-functional:
  - Preserve full backward compatibility with all existing V2/V3/V4 tests in `tests/test-omp-session-harvester.sh`.

## Architecture

- `harvester_core.py` keeps public `plans/omp-consolidation-ledger.json` free of machine paths (`workspace` source paths live only in private `~/.omp/agent/omp-harvester-cache.json`).
- `scripts/omp-harvest-loop-runner.sh` runs bounded rounds: `harvester --scan --diff-global` -> `--next` -> check `stop` / `zeroDeltaStreak >= 2` -> `--stage` batch -> `--extract` -> run LLM synthesis command (`omp -p` or injected `HARVEST_RUNNER_CMD`) -> run `HARVEST_GATE_CMD` (`unittest` + `bun test` + `omp-doctor --strict`) -> `--commit-stage` on pass or rollback `staged` -> `pending` on fail.

## Related Code Files

- Create: `scripts/omp-harvest-loop-runner.sh`
- Create: `tests/test-omp-harvest-loop-runner.sh`
- Modify: `config/omp/agent/skills/omp-session-harvester/scripts/harvester_core.py`
   - Update `scan_workspaces()` to exclude files residing under the resolved root of `zuey-pi-setup` from `promotionQueue`, while preserving `config/omp/agent/skills/` hashes as reference-only `already_promoted` entries; update `get_next_unit()` (`harvester_core.py:1595-1598`) to treat `TRIAGED_3_TIER` as a completed/terminal suite status so loop termination does not deadlock on `dev_ops_automation`.
   - Store sanitized relative workspace file location entries in `self.cluster_index` (written only to `omp-harvester-cache.json`) and extend `extract_cluster()` to read `source == "workspace"` safely with `_PRIV_PAT` scrubbing and `sanitize_path`.
   - Extract command handling logic from `config/omp/agent/extensions/omp-toolkit-hub.ts` into a dedicated helper module (`omp-toolkit-hub/hub-commands.ts`) to maintain `omp-toolkit-hub.ts` strictly under its 200-line budget.
## Implementation Steps

1. **Step A (TDD Tests First):**
   - Extend `tests/test-omp-session-harvester.sh` with assertions covering: (a) `skills-optin/<name>` is treated as present in global during `--diff-global`, (b) dirs classified as `override` or `archive` are omitted from `unpromotedDeltaDirs` by default and shown under `--all-deltas`, (c) files inside `zuey-pi-setup/{scripts,tests,plans,docs}` do not create `dev_ops_automation` queue items, (d) `--extract <hash>` works for a `scan_workspaces`-sourced script stored in cache, and (e) `--auto-triage-known` marks matched already-consolidated hashes cleanly.
   - Create `tests/test-omp-harvest-loop-runner.sh` with mock runner/gate commands testing: (a) clean 1-round `--stage` -> gate pass -> `--commit-stage`, (b) gate failure rolls back `staged` state and exits nonzero without corrupting ledger, and (c) `stop: true` / `maxRounds` terminates cleanly.
2. **Step B (Harvester Sieve & Workspace Extraction Fixes in `harvester_core.py`):**
   - Update `scan_global_diff()` (`harvester_core.py:945`) to include `_dir_names(g_omp, "skills-optin")` in `g_skills` and skip `override`/`archive` paths from `workspaceClassification` unless `all_deltas=True`.
   - Update `scan_workspaces()` + `update_ledger()` to classify repo self-tooling as non-queue `repo_internal` (preserving `config/omp/agent/skills/` hashes as reference-only `already_promoted` entries and removing auto-generation of phantom `dev_ops_automation` suite).
   - Store sanitized workspace file location entries in `self.cluster_index` (written only to `omp-harvester-cache.json`) and extend `extract_cluster()` to read `source == "workspace"` safely with `_PRIV_PAT` scrubbing and `sanitize_path`.
   - Implement `--auto-triage-known`, `--all-deltas`, `--unstage <hash>`, and `~/.omp/harvester.lock` advisory locking.
3. **Step C (Headless Bounded Loop Driver & Hub Command Hook):**
   - Create `scripts/omp-harvest-loop-runner.sh` (cross-OS Git Bash / macOS bash compatible) supporting `--dry-run`, `--max-rounds`, `--batch-size`, `--headless` (`omp -p`), `HARVEST_RUNNER_CMD`, and `HARVEST_GATE_CMD`.
   - Expose `--unstage` / runner documentation in `omp-session-harvester/SKILL.md` and `/harvest-loop` help text in `config/omp/agent/extensions/omp-toolkit-hub.ts` (keeping `omp-toolkit-hub.ts` `<= 200` lines).
4. **Step D (Verify):**
   - Run `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-session-harvester.sh` and `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-harvest-loop-runner.sh`.

## Success Criteria

- [ ] `scan_global_diff()` recognizes `skills-optin/` and suppresses classified `override`/`archive` dirs unless `--all-deltas` is passed.
- [ ] Repo internal files under `zuey-pi-setup/{scripts,tests,plans,docs}` no longer populate `promotionQueue` or phantom `dev_ops_automation` suite entries.
- [ ] `--extract <hash>` successfully extracts workspace-origin scripts using private cache locations with `_PRIV_PAT` sanitization.
- [ ] `tests/test-omp-session-harvester.sh` and `tests/test-omp-harvest-loop-runner.sh` pass 100% including rollback on gate failure.

## Risk Assessment

- **Leaking workstation paths from workspace `clusterIndex`:** Write workspace absolute paths strictly into local `~/.omp/agent/omp-harvester-cache.json` (never into `plans/omp-consolidation-ledger.json` or repo docs) and apply `_PRIV_PAT` before writing extracted snippets.
- **Orphaned `~/.omp/harvester.lock` after crash:** Record PID + timestamp in lockfile and auto-reclaim stale locks older than 30m or dead PIDs.
