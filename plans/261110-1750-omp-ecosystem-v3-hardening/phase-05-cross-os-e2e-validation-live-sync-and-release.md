---
phase: 5
title: "Cross-OS E2E Validation Live Sync and Release"
status: pending
priority: P1
effort: "2.5h"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Cross-OS E2E Validation Live Sync and Release

## Overview

Synchronize all verified V3 assets (`skills/`, `agents/`, `commands/`, `rules/`, `extensions/omp-toolkit-hub.ts`, `tools-requirements.txt`) to live `~/.omp/agent/`, hydrate `pypdf` into `~/.omp/tools-venv`, rebuild `config/omp/` and `backups/omp-setup-portable.tar.gz`, execute the full Windows + simulated Darwin E2E test matrix, run a private GPG `--all` backup/restore smoke test, update documentation, and commit/push via `ck:git`.

## Requirements

- **Functional:**
  1. Hydrate `~/.omp/tools-venv` with updated `tools-requirements.txt` (`pypdf>=4.0.0`) and sync `config/omp/agent/` -> `~/.omp/agent/` safely without touching live `.env`, `*.db*`, `sessions/`, `memories/`, or `extensions/typesafe-planner.ts`.
  2. Run `scripts/omp-setup-backup.sh --source "$HOME/.omp" --config-dir config/omp -o backups/omp-setup-portable.tar.gz`.
  3. Update `tests/test-omp-e2e-cross-platform.sh` and `tests/test-omp-managed-skills-integrity.sh` to verify V3 deliverables (`omp-toolkit-hub.ts`, ported Claude core agents/rules, standalone `omp-session-harvester`, `pypdf` PDF conversion on simulated Darwin target, `omp-plugins.lock.json`, zero symlinks, zero `.db*`, zero secrets, zero machine/client paths).
  4. Verify `scripts/omp-private-backup.sh --all` (confirming scratch `mnemopi` filtering) + isolated temp restore under `OS_OVERRIDE=Darwin` and Windows.
  5. Update `docs/omp-setup-migration.md`, `docs/omp-operations-guide.md`, and `plans/omp-consolidation-ledger.json` (`--scan --diff-global --verify-ledger`) reflecting V3 architecture and opt-in local linker usage.
- **Non-Functional:**
  - Zero skipped tests, zero test relaxation, and clean public-repo secret/path/symlink audit before push.

## Related Files

- Modify: `tests/test-omp-e2e-cross-platform.sh`
- Modify: `tests/test-omp-managed-skills-integrity.sh`
- Modify: `docs/omp-setup-migration.md`
- Modify: `docs/omp-operations-guide.md`
- Update: `backups/omp-setup-portable.tar.gz`
- Update: `plans/omp-consolidation-ledger.json`, `plans/harvest-inventory.md`
- Create: `plans/reports/261110-omp-ecosystem-v3-final-audit.md`

## Implementation Steps

1. **Step A (Live Hydration & Sync):** Install `pypdf>=4.0.0` into `~/.omp/tools-venv`, copy verified `config/omp/agent/{skills,agents,commands,rules,tools-requirements.txt}` and `extensions/omp-toolkit-hub*` to live `~/.omp/agent/`, preserving live `extensions/typesafe-planner.ts`, `.env`, and DBs.
2. **Step B (Rebuild Portable Snapshot):** Run `"C:/Program Files/Git/bin/bash.exe" scripts/omp-setup-backup.sh --source "$HOME/.omp" --config-dir config/omp -o backups/omp-setup-portable.tar.gz`.
3. **Step C (Full Cross-OS Verification Matrix):** Execute ALL bash suites (`tests/test-omp-*.sh`), ALL 4 Python domain suites (`pmo`, `office`, `email`, `maintenance`), extension unit tests (`tests/test-omp-toolkit-hub.test.ts`), live `harvest_cli.py --scan --diff-global --verify-ledger`, and isolated GPG `--all` backup + simulated Darwin restore smoke check.
4. **Step D (Docs & Ledger Finalization):** Update `docs/omp-setup-migration.md` & `docs/omp-operations-guide.md` (including lines `270-274` reconciling `omp-plugins.lock.json` policy) with V3 commands (`/harvest-loop`, `omp-link-local.py`, `--sessions`, `pypdf`), update `plans/261110-omp-session-tool-consolidation/plan.md` status cleanly, and record `plans/reports/261110-omp-ecosystem-v3-final-audit.md`.
5. **Step E (Security Audit, Commit & Push):** Run anchored secret/path/DB/symlink scans across `git diff --cached` and `backups/omp-setup-portable.tar.gz`, commit cleanly with conventional commits, and push to `origin/main`.

## Success Criteria

- [ ] All bash test scripts under `tests/test-omp-*.sh`, Python domain suites, and extension unit tests exit 0 on Windows and simulated Darwin.
- [ ] Restored simulated Darwin target executes `pmo_cli.py`, `office_cli.py --cmd to-md` on a PDF, `maintenance_cli.py`, and standalone `harvest_cli.py --next` cleanly.
- [ ] `scripts/omp-setup-backup.sh` and `backups/omp-setup-portable.tar.gz` contain zero symlinks, zero `.db*`, zero tokens, and zero machine paths across all directories.
- [ ] `omp-private-backup.sh --all` excludes scratch `mnemopi` banks by default and restores cleanly under `OS_OVERRIDE=Darwin` in an isolated temp home.
- [ ] `git status` is clean after pushing verified V3 snapshot and documentation to `origin/main`.

## Risk Assessment

- **Large binary tarball diff in Git:** Confirm `backups/omp-setup-portable.tar.gz` size remains reasonable (no `.venv/`, `__pycache__/`, `node_modules/`, or `*.db*` inside) before pushing.
- **Unintentional edit to `typesafe-planner.ts` shim:** Verify `~/.omp/agent/extensions/typesafe-planner.ts` stays an untouched 1-line re-export shim while `config/omp/agent/extensions/typesafe-planner/` holds the dereferenced portable copy.
