# Phase 6: Cross-OS End-to-End Validation & Ledger Finalization

## Overview
Perform end-to-end integration testing of the entire consolidated OMP tool ecosystem, validate automated restore on both Windows and simulated Darwin/macOS environments, verify secret scanning gates, and finalize the multi-session ledger (`plans/omp-consolidation-ledger.json`).

## Requirements
- **Functional Requirements:**
  1. Run `scripts/omp-setup-backup.sh` to produce a fresh `backups/omp-setup-portable.tar.gz` and verify it contains:
     - All 5 managed skills (`pmo-project-suite`, `office-doc-suite`, `email-intelligence-suite`, `system-maintenance-suite`, `omp-session-harvester`).
     - Dereferenced `typesafe-planner` extension.
     - `agent/agents/*.md` definitions.
     - `agent/tools-requirements.txt`.
     - Zero SQLite `.db` or `.env` files.
  2. Run `scripts/omp-setup-restore.sh` to a temporary directory on Windows, asserting:
     - `tools-venv` provisioning.
     - Managed skills restoration.
     - Config and models template substitution.
  3. Run simulated Darwin/macOS restore test:
     - Overriding `OSTYPE=darwin` and asserting POSIX `shellPath: /bin/bash` configuration.
  4. Run `scripts/omp-private-backup.sh --all` and `scripts/omp-private-restore.sh` to verify full ClaudeKit and Mnemopi private state restoration without GPG hangs.
  5. Mark all suites as `VERIFIED` in `plans/omp-consolidation-ledger.json` and generate summary report.
- **Non-Functional Requirements:**
  - Zero regression across all existing test suites.
  - Zero sensitive keywords (customer names, internal domain URLs, API tokens) in git history or tarballs.

## Related Code Files
- **Modify:** `plans/omp-consolidation-ledger.json`
- **Create:** `tests/test-omp-e2e-cross-platform.sh`
- **Generate:** `plans/reports/261110-omp-consolidation-final-audit.md`

## Implementation Steps
1. **Execute Backup Pipeline:**
   - Run `scripts/omp-setup-backup.sh --source "$HOME/.omp" --config-dir config/omp -o backups/omp-setup-portable.tar.gz`.
2. **Run All Test Suites:**
   ```bash
   tests/test-omp-migration.sh
   tests/test-omp-private-restore.sh
   tests/test-omp-syncignore.sh
   tests/test-omp-sync-extraction.sh
   tests/test-omp-tools-venv-hydration.sh
   tests/test-omp-managed-skills-integrity.sh
   tests/test-omp-e2e-cross-platform.sh
   ```
3. **Run Anchored Secret & Proprietary Keyword Scan:**
   - Scan `backups/omp-setup-portable.tar.gz` and `config/omp/` for tokens and internal project codes.
4. **Update Ledger & Plan Status:**
   - Update `plans/omp-consolidation-ledger.json` status to `COMPLETED`.
   - Update `plans/261110-omp-session-tool-consolidation/plan.md` status to `ready_for_execution`.

## Success Criteria
- [ ] 100% test pass across all test suites.
- [ ] Clean secret and proprietary keyword audit.
- [ ] Portable tarball successfully extracts and restores in < 30 seconds.
