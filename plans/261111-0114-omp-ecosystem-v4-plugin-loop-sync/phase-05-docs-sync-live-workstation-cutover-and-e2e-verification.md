---
phase: 5
title: "Docs Sync Live Workstation Cutover and E2E Verification"
status: pending
priority: P2
effort: "2h"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Docs Sync Live Workstation Cutover and E2E Verification

## Overview

Update operational documentation to reflect V4 workflows (`omp_*` native extension tools, filtered `/harvest-loop` rounds, 16-dir triage rules, `omp-bootstrap`, and `omp-doctor`), synchronize verified V4 assets cleanly between `config/omp/agent/` and live `~/.omp/agent/`, rebuild `backups/omp-setup-portable.tar.gz`, run the complete multi-OS test matrix, and produce the V4 final audit report.

## Requirements

- **Functional:**
  1. Update `docs/omp-operations-guide.md` and `docs/omp-setup-migration.md` with V4 workflows:
     - Using native `omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest` extension tools vs CLI fallback.
     - Running noise-filtered multi-session `/harvest-loop` rounds (`--stage` -> test -> `--commit-stage` / `--triage`).
     - Managing the 3-tier project directory manifest (`override` vs `shared_mirror` vs `archive`) and `omp-link-local.py`.
     - One-command cross-OS restore & sync via `omp-bootstrap.sh` / `omp-bootstrap.ps1` and health verification via `omp-doctor.py` / `/omp-doctor`.
  2. Synchronize `config/omp/agent/` changes cleanly to live `~/.omp/agent/` before running `scripts/omp-setup-backup.sh --source "$HOME/.omp" --config-dir config/omp -o backups/omp-setup-portable.tar.gz` (preserving `--config-dir` mirror-direction safety!).
  3. Refresh `plans/harvest-inventory.md` and `plans/omp-consolidation-ledger.json` via `scripts/omp-session-harvester.py --scan --diff-global` verifying `promotionQueue` signal quality and `shared_mirror` link coverage.
  4. Execute the entire test suite (all Bash scripts under `tests/`, `bun test tests/test-omp-toolkit-hub.test.ts`, all 4 Python domain `unittest` suites), run `omp-doctor.py --strict`, and perform a security/tarball leak audit (`0` symlinks, `0` `.db*`, `0` `.env`, `0` token/drive leaks).
  5. Write final V4 verification audit report under `plans/reports/`.
- **Non-Functional:**
  - Never modify or weaken existing tests to force green results.
  - Do not commit or push automatically unless explicitly instructed at execution time; report exact git diff & verification evidence cleanly.

## Architecture

```text
config/omp/agent/ (Phases 1-4) ──▶ sync to ~/.omp/agent/
                                       │
                                       ▼
                        omp-setup-backup.sh --config-dir config/omp
                                       │
                                       ▼
                     backups/omp-setup-portable.tar.gz + docs/ + ledger
                                       │
                                       ▼
                 Full E2E Test Matrix + omp-doctor --strict + Leak Audit
```

## Related Code Files

- Modify: `docs/omp-operations-guide.md`
- Modify: `docs/omp-setup-migration.md`
- Regenerate: `config/omp/agent/**` & `backups/omp-setup-portable.tar.gz`
- Regenerate: `plans/harvest-inventory.md` & `plans/omp-consolidation-ledger.json`
- Create: `plans/reports/261111-omp-ecosystem-v4-final-audit.md`

## Implementation Steps

1. **Step A (Update Documentation):** Update `docs/omp-operations-guide.md` and `docs/omp-setup-migration.md` with V4 command cheat sheets, architecture table, `omp-bootstrap` Windows/macOS workflow, and `omp-doctor` troubleshooting steps.
2. **Step B (Sync Live & Rebuild Tarball):** Copy updated V4 skills/extensions/templates from `config/omp/agent/` into `~/.omp/agent/`, run `scripts/omp-setup-backup.sh --source "$HOME/.omp" --config-dir config/omp -o backups/omp-setup-portable.tar.gz`, and verify `backups/omp-setup-portable.tar.gz` contents (`tar -tzf`).
3. **Step C (Refresh Harvester & Run Doctor):** Run `python scripts/omp-session-harvester.py --scan --diff-global` and `python scripts/omp-doctor.py --strict --json`.
4. **Step D (Full Verification Matrix):** Run all Bash tests (`tests/test-omp-*.sh`), `bun test tests/test-omp-toolkit-hub.test.ts`, and all 4 Python domain test suites, plus regex secret/path leak scan on staged repo diffs and portable tarball.
5. **Step E (Audit Report & Plan Status):** Update V4 phase statuses via `plan-cli.cjs check` and write `plans/reports/261111-omp-ecosystem-v4-final-audit.md`.

## Success Criteria

- [ ] `docs/omp-operations-guide.md` and `docs/omp-setup-migration.md` document V4 tools, filtered loop commands, bootstrap, and doctor usage accurately.
- [ ] `backups/omp-setup-portable.tar.gz` rebuilds cleanly with zero symlinks, zero `.db*` files, zero `.env` files, and zero credential/path leaks.
- [ ] All Bash tests, `bun test tests/test-omp-toolkit-hub.test.ts`, Python domain test suites, and `omp-doctor.py --strict` pass 100%.
- [ ] Updated `plans/omp-consolidation-ledger.json` and `plans/harvest-inventory.md` reflect filtered actionable queue counts and verified mirror links.

## Risk Assessment

- **`--config-dir` overwriting un-synced repo edits:** Explicitly sync `config/omp/agent/` -> `~/.omp/agent/` *before* invoking `omp-setup-backup.sh --config-dir config/omp`.
- **Stale `.pyc` or `node_modules` inside snapshot:** Rely on `omp-setup-backup.sh` exclusions and verify tarball entries via `tar -tzf`.
