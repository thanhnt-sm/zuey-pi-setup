---
phase: 6
title: "Cross-OS E2E Validation, Live ~/.omp Sync & Ledger Seal"
status: pending
priority: P1
effort: "2.5h"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: Cross-OS E2E Validation, Live ~/.omp Sync & Ledger Seal

## Overview
Synchronize verified `config/omp/agent/` assets to live `~/.omp/agent/` safely, rebuild `backups/omp-setup-portable.tar.gz`, pass full Windows + simulated Darwin/macOS E2E restore and leak-scan suites, update docs, seal `plans/omp-consolidation-ledger.json`, and commit/push cleanly.

## Related Code Files
- Create: `tests/test-omp-managed-skills-integrity.sh`, `tests/test-omp-e2e-cross-platform.sh`
- Update: `docs/omp-operations-guide.md`, `docs/omp-setup-migration.md`, `plans/omp-consolidation-ledger.json`, `plans/harvest-inventory.md`
- Generate: `plans/reports/261110-omp-consolidation-final-audit.md`

## Implementation Steps
1. Sync `config/omp/agent/{skills,skills-optin,agents,commands,rules,managed-skills,tools-requirements.txt,config.yml}` to live `~/.omp/agent/` (preserving live `.env`, `*.db*`, `memories/`, `sessions/`).
2. Run `scripts/omp-setup-backup.sh --source "$HOME/.omp" --config-dir config/omp -o backups/omp-setup-portable.tar.gz`.
3. Create and execute `tests/test-omp-managed-skills-integrity.sh` and `tests/test-omp-e2e-cross-platform.sh` (testing Windows + `OS_OVERRIDE=Darwin` restore, `tools-venv` hydration, CLI smoke checks across all 5 suites, recursive `typesafe-planner/tools/` presence, and anchored secret/path/DB leak audit).
4. Run full regression suite (all 8 bash test files + 4 Python test suites).
5. Run `omp-private-backup.sh --all` + isolated temp `--home` restore verification (Windows + simulated macOS `~/.claude` path rewrite).
6. Update docs (`69` mnemopi banks, Priority-100 `skills/`, V2 restore guide), seal ledger (`VERIFIED_E2E`), commit & push via `ck:git`.

## Success Criteria
- [ ] 100% pass across all bash and Python test suites.
- [ ] Zero symlinks, zero `.db*`, zero secrets, zero `C:/Users`/`D:/` paths in `config/omp/` & `backups/omp-setup-portable.tar.gz`.
- [ ] `plans/omp-consolidation-ledger.json` sealed at `COMPLETED` / `VERIFIED_E2E` and clean git push to `origin/main`.
