---
phase: 5
title: "Full Cutover Tarball Rebuild and V5 Verification"
status: pending
priority: P1
effort: "2.5h"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Full Cutover Tarball Rebuild and V5 Verification

## Overview

Synchronize all verified V5 assets (`rules/`, `skills/`, `extensions/`, `tools/`, `omp-upstream/`) to live `~/.omp/agent/` and `~/.claude/`, rebuild `config/omp/` and `backups/omp-setup-portable.tar.gz`, run the complete multi-OS Bash/Bun/Python/Doctor test matrix, update documentation and audit artifacts, commit & push the finished V5 release to `origin/main`, and generate a fresh encrypted private GPG backup.

## Requirements

- Functional:
  - Sync updated `config/omp/agent/` rules, skills, tools, and extensions into live `~/.omp/agent/` BEFORE invoking `omp-setup-backup.sh --config-dir config/omp` (respecting the `--config-dir` wipe-and-mirror invariant), and run `omp-bootstrap.sh --link-claude` (or targeted live sync) so `~/.claude/` reflects updated routing rules.
  - Run `scripts/omp-session-harvester.py --scan --diff-global` and verify filtered queue counts, `0` false-positive `override`/`archive`/`skills-optin` deltas, and `0` phantom `dev_ops_automation` entries.
  - Rebuild `backups/omp-setup-portable.tar.gz` and run ALL Bash test suites (`test-omp-migration.sh`, `test-omp-private-restore.sh`, `test-omp-e2e-cross-platform.sh`, `test-omp-managed-skills-integrity.sh`, `test-omp-session-harvester.sh`, `test-omp-harvest-loop-runner.sh`, `test-omp-local-linker.sh`, `test-omp-tools-venv-hydration.sh`, `test-omp-agents-backup.sh`, `test-omp-syncignore.sh`, `test-omp-sync-extraction.sh`), `bun test tests/test-omp-toolkit-hub.test.ts`, all 4 Python domain suites, and `python -B scripts/omp-doctor.py --strict --json`.
  - Update `docs/omp-operations-guide.md` and `docs/omp-setup-migration.md` with V5 routing rules, `xlsx-diff`, `omp-prune`, headless loop runner, `--include-dev-repos`, `--link-claude`, and `omp-schedule-sync` instructions.
  - Run independent final code + security review (`reviewer` + `security-reviewer`), resolve any findings, write `plans/reports/261111-omp-ecosystem-v5-final-audit.md` + `docs/journals/261111-omp-ecosystem-v5-release.md`, commit & push final V5 release to `origin/main`, and run `omp-private-backup.sh --all --include-dev-repos` (if passphrase/interactive GPG available).
- Non-functional:
  - Zero symlinks, zero `.db*`, zero `.env`, zero `.pyc`, and zero secret/workstation-path leaks in `config/`, `plans/`, `docs/`, or `backups/omp-setup-portable.tar.gz`.

## Architecture

- Final cutover strictly follows: `repo edits -> sync live ~/.omp/agent & ~/.claude -> harvester scan -> omp-setup-backup.sh --config-dir config/omp -o backups/omp-setup-portable.tar.gz -> full verification matrix -> docs & audit -> git commit & push -> private GPG export`.

## Related Code Files

- Modify: `docs/omp-operations-guide.md`
- Modify: `docs/omp-setup-migration.md`
- Modify: `plans/omp-consolidation-ledger.json`
- Modify: `plans/harvest-inventory.md`
- Modify: `backups/omp-setup-portable.tar.gz`
- Create: `plans/reports/261111-omp-ecosystem-v5-final-audit.md`
- Create: `docs/journals/261111-omp-ecosystem-v5-release.md`

## Implementation Steps

1. **Step A (Live Cutover Sync & Harvester Refresh):**
   - Copy updated `config/omp/agent/{rules,skills,extensions,tools}/` into live `~/.omp/agent/` and apply `--link-claude` so live OMP and Claude Code match repo V5 sources identically.
   - Run `python -B scripts/omp-session-harvester.py --scan --diff-global` and `python -B scripts/omp-link-local.py --verify --json`.
2. **Step B (Tarball Rebuild & Complete Test Matrix):**
   - Run `"C:/Program Files/Git/bin/bash.exe" scripts/omp-setup-backup.sh --source "$HOME/.omp" --config-dir config/omp -o backups/omp-setup-portable.tar.gz`.
   - Execute all 11 Bash test scripts, `bun test tests/test-omp-toolkit-hub.test.ts`, all 4 Python domain test suites, and `python -B scripts/omp-doctor.py --strict --json`.
3. **Step C (Docs Sync & Independent Review):**
   - Update `docs/omp-operations-guide.md` and `docs/omp-setup-migration.md`.
   - Run independent `reviewer` + `security-reviewer` verification over the V5 diff and `backups/omp-setup-portable.tar.gz`; fix any finding and re-verify if touched.
4. **Step D (Final Audit, Release Push & Private GPG Archive):**
   - Write `plans/reports/261111-omp-ecosystem-v5-final-audit.md` and `docs/journals/261111-omp-ecosystem-v5-release.md`.
   - Stage, secret-scan, commit, and push V5 release to `origin/main`, and run `omp-private-backup.sh --all --include-dev-repos` outside the repository.

## Success Criteria

- [ ] Live `~/.omp/agent/`, `~/.claude/`, `config/omp/agent/`, and `backups/omp-setup-portable.tar.gz` are synchronized with zero symlinks, zero `.db*`/`.env`/`.pyc`, and zero leaks.
- [ ] All 11 Bash suites, `bun test tests/test-omp-toolkit-hub.test.ts`, all Python domain tests, and `omp-doctor.py --strict --json` return healthy/pass 100%.
- [ ] Documentation, final V5 audit report, journal, git commit/push to `origin/main`, and private GPG backup (`--include-dev-repos`) complete cleanly.

## Risk Assessment

- **Running `omp-setup-backup.sh --config-dir config/omp` before copying Phase 2–4 repo edits to `~/.omp/agent/`:** Explicitly execute Step A (`config/omp/agent/` -> `~/.omp/agent/`) first and assert `diff` parity before running `--config-dir` backup.
- **Uncommitted V5 test artifacts (`extracted_clusters/`, `.pyc`, temp files):** Set `PYTHONDONTWRITEBYTECODE=1` and check `git status -sb` + `tar -tzf` before final commit & push.
