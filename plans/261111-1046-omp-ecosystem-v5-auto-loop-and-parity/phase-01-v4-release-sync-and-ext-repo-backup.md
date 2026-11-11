---
phase: 1
title: "V4 Release Sync and Ext Repo Backup"
status: pending
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: V4 Release Sync and Ext Repo Backup

## Overview

Commit and push the already-verified V4 changes on `main`, synchronize live `~/.omp/agent/` with `config/omp-upstream/` and initialized `mcp.json`, initialize version control for the external extension source directory (`~/Projects/omp_extension`), and extend `omp-private-backup.sh` / `omp-private-restore.sh` with `--include-dev-repos` (`--tdd`).

## Requirements

- Functional:
  - Stage, secret-scan, commit, and push the verified V4 changes on `zuey-pi-setup` `main` to `origin/main`, and run `omp-private-backup.sh --all` outside the git tree.
  - Initialize a clean `git` repository inside `~/Projects/omp_extension` (`C:/Users/thant/Projects/omp_extension`) with `.gitignore` excluding `.bak*`, `node_modules`, `.venv`, and temp artifacts.
  - Add `--include-dev-repos` (`--dev-repo <path>` repeatable or default `~/Projects/omp_extension`) to `scripts/omp-private-backup.sh` and matching cross-OS restoration into `$USER_HOME/Projects/` in `scripts/omp-private-restore.sh` (without placing external repos inside public `zuey-pi-setup`).
  - Reconcile live `~/.omp/agent/` split-brain by seeding `~/.omp/agent/mcp.json` from `mcp.json.example` (only when absent) and applying `config/omp-upstream/` overlay (`compaction-policy.ts`, `pi-footer-cache-tps.ts`, `APPEND_SYSTEM.md`, upstream plugins) cleanly.
- Non-functional:
  - Never overwrite an existing customized `~/.omp/agent/mcp.json` or live `.env`.
  - Keep `tests/test-omp-private-restore.sh` 100% green across Windows & `OS_OVERRIDE=Darwin`.

## Architecture

- Public repo (`zuey-pi-setup`) continues holding only the dereferenced `config/omp/agent/extensions/typesafe-planner/` snapshot.
- Private encrypted GPG archive (`--include-dev-repos`) optionally packages `~/Projects/<repo>` relative to `$USER_HOME` (pruning `node_modules`, `.bak*`, `*.db*`), restoring editable source + `.git` history onto any secondary macOS or Windows workstation while keeping `omp-private-backup.sh` strictly outside any git worktree.

## Related Code Files

- Modify: `scripts/omp-private-backup.sh`
- Modify: `scripts/omp-private-restore.sh`
- Modify: `tests/test-omp-private-restore.sh`
- External init (outside repo): `~/Projects/omp_extension/.gitignore` (local git init + baseline commit)

## Implementation Steps

1. **Step A (Baseline V4 Release Hygiene):**
   - Run `git status -sb` and verify secret scan across staged V4 files (`grep -iE` for keys/tokens/DBs), then commit and push the verified V4 baseline cleanly to `origin/main`.
   - Run `"C:/Program Files/Git/bin/bash.exe" scripts/omp-private-backup.sh --all` (if passphrase/non-interactive key is provided or prompt user when interactive) to capture a fresh V4 baseline GPG archive outside the repo.
2. **Step B (TDD Tests First for `--include-dev-repos`):**
   - Extend `tests/test-omp-private-restore.sh` with a mock `Projects/omp_extension` directory containing `typesafe-planner.ts`, `.git/HEAD`, and `node_modules/dummy.js`; verify `omp-private-backup.sh --typesafe-kit --include-dev-repos --no-encrypt` archives `Projects/omp_extension` while pruning `node_modules`, and `omp-private-restore.sh` restores it under `--home "$TMP_HOME"` on both Windows and `OS_OVERRIDE=Darwin`.
   - Confirm failure before script changes ("red" step).
3. **Step C (Implement `--include-dev-repos` in `omp-private-{backup,restore}.sh`):**
   - Add `--include-dev-repos` and `--dev-repo <name-or-path>` flags to `scripts/omp-private-backup.sh` (default target `Projects/omp_extension` under `$USER_HOME` when present, pruning `node_modules`, `__pycache__`, `.venv`, `*.bak*`, `*.db*`) and update the empty-selection guard (`WANT_MEMORY$WANT_HISTORY$WANT_KIT$WANT_CLAUDE$WANT_SESSIONS$WANT_DEV_REPOS`).
   - Update `scripts/omp-private-restore.sh` to report restored `Projects/*` dev repos and preserve permissions without mutating existing git configs outside `$USER_HOME`.
4. **Step D (External Repo Git Init & Live Workstation Split-Brain Sync):**
   - Run `"C:/Program Files/Git/bin/bash.exe" scripts/omp-setup-restore.sh --source-tar backups/omp-setup-portable.tar.gz --target-dir "$HOME/.omp" --no-install` (or targeted upstream/mcp sync preserving existing `.env` & extensions) so `~/.omp/agent/mcp.json`, `APPEND_SYSTEM.md`, `compaction-policy.ts`, and `pi-footer-cache-tps.ts` are active live, then verify `python -B scripts/omp-doctor.py --strict --json`.
   - Run `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-private-restore.sh` and `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-migration.sh`.

## Success Criteria

- [ ] Verified V4 baseline is committed and pushed cleanly to `origin/main` with zero secret or database leaks.
- [ ] `~/Projects/omp_extension` is initialized as a clean local git repository with `.gitignore` and baseline commit.
- [ ] `omp-private-backup.sh --include-dev-repos` archives `Projects/omp_extension` (excluding `node_modules`/caches) and restores cleanly under `tests/test-omp-private-restore.sh`.
- [ ] Live `~/.omp/agent/mcp.json` and `config/omp-upstream/` overlay (`compaction-policy.ts`, `pi-footer-cache-tps.ts`, `APPEND_SYSTEM.md`) exist and pass `omp-doctor.py --strict --json`.

## Risk Assessment

- **Overwriting live custom `.omp` files during restore:** `omp-setup-restore.sh` backs up replaced files to `~/.omp/restore-backups/` and initializes `.env` and `mcp.json` strictly when absent; run with `--no-install` first so `tools-venv` and `plugins/node_modules` remain untouched unless plugins changed.
- **GPG interactive passphrase prompt blocking unattended run:** Use `--no-encrypt` in isolated temp unit tests and keep `OMP_BACKUP_PASSPHRASE_FILE` optional for real host GPG exports.
