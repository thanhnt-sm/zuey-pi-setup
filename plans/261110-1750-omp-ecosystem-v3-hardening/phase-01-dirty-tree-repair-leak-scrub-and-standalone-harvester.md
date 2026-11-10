---
phase: 1
title: "Dirty-Tree Repair Leak Scrub and Standalone Harvester"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Dirty-Tree Repair Leak Scrub and Standalone Harvester

## Overview

Fix the broken cutover seams left in the uncommitted V2 working tree, eliminate every remaining internal customer/path literal from tracked repo files, enforce absolute-path gates across all staged `agent/` directories, package `omp-session-harvester` standalone without repo path reliance, and commit the stabilized V2 baseline cleanly.

## Requirements

- **Functional:**
  1. Refactor `scripts/omp-session-harvester.py` (`_load_config`, `SessionHarvester.__init__`) and `scripts/omp-promote-assets.py` (`promote_all`, `_private_terms_pattern`) to defer private-keyword regex compilation until AFTER CLI flags (`--config`, `--no-local-config`) are parsed, deep-merge `~/.omp/harvest-workspaces.local.json` by default, and support `--no-local-config` for deterministic isolated test runs.
  2. Wire the dynamically compiled `priv_pat` inside `scripts/omp-promote-assets.py:sanitize_content(text, priv_pat=...)` and `scripts/omp-session-harvester.py` (`sanitize_text`, `sanitize_path`) so `privateKeywords` from `~/.omp/harvest-workspaces.local.json` or `OMP_SENSITIVE_TERMS` are scrubbed across all promoted files and harvest outputs.
  3. Remove all remaining hardcoded internal client/project literals and personal workstation paths from `scripts/omp-session-harvester.py`, `tests/test-omp-session-harvester.sh`, `config/omp/agent/managed-skills/zuey-omp-backup-workflow/SKILL.md`, `config/omp/agent/rules/file-type-enforcement.md:81` (`file:///Users/<user>/.../document.pdf`), `plans/261110-omp-session-tool-consolidation/*.md`, and `plans/reports/261110-omp-ecosystem-v2-brainstorm.md`.
  4. Extend `scripts/omp-setup-backup.sh` `ABS_LEFT` scan from `extensions/` across ALL `agent/` subdirs (`skills/`, `skills-optin/`, `agents/`, `commands/`, `rules/`, `managed-skills/`, `tools/`): check executable code/config files (`*.ts`, `*.js`, `*.cjs`, `*.mjs`, `*.py`, `*.sh`, `*.ps1`, `*.yml`, `*.json`, excluding explicit unit-test fixtures/regex comments) and markdown docs for real personal home/drive paths while excluding illustrative placeholders (`user`, `username`, `jesse`, `name`, `example`, `demo`, `<user>`). Also copy `omp-plugins.lock.json` alongside `plugins/package.json`, and reconcile `omp-plugins.lock.json` inside `scripts/omp-setup-restore.sh:274-302` whenever `upstream/plugins/package.json` merges additional plugin deps.
  5. Make `config/omp/agent/skills/omp-session-harvester/scripts/harvester_core.py` the single canonical engine imported directly by `harvest_cli.py` and delegated to by `scripts/omp-session-harvester.py` (parity verified by test, zero dual-copy drift), defaulting `--ledger` and `--report` to `~/.omp/agent/omp-consolidation-ledger.json` and `~/.omp/agent/harvest-inventory.md` whenever CWD is outside the `zuey-pi-setup` repository.
- **Non-Functional:**
  - TDD-first: add failing tests for local-config merge, `_PRIV_PAT` redaction, standalone `harvest_cli.py` outside repo, and `agent/skills/` absolute-path rejection before fixing code.
  - Maintain full backward compatibility across all 9 existing bash suites and 4 Python domain test suites.

## Related Files

- Create: `config/omp/agent/skills/omp-session-harvester/scripts/harvester_core.py`
- Modify: `scripts/omp-session-harvester.py` (thin repo wrapper delegating to `harvester_core.py`)
- Modify: `scripts/omp-promote-assets.py`
- Modify: `scripts/omp-setup-backup.sh`
- Modify: `scripts/omp-setup-restore.sh`
- Modify: `config/omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py`
- Modify: `tests/test-omp-session-harvester.sh`
- Modify: `tests/test-omp-migration.sh`
- Modify: `tests/test-omp-e2e-cross-platform.sh`
- Modify (scrub literals): `config/omp/agent/managed-skills/zuey-omp-backup-workflow/SKILL.md`, `config/omp/agent/rules/file-type-enforcement.md`, `plans/261110-omp-session-tool-consolidation/plan.md`, `plans/261110-omp-session-tool-consolidation/phase-02-session-workspace-harvester-cli.md`, `plans/261110-omp-session-tool-consolidation/phase-04-office-document-processing-suite-standardization.md`, `plans/reports/261110-omp-ecosystem-v2-brainstorm.md`

## Implementation Steps

1. **Step A (Tests First):** Extend `tests/test-omp-session-harvester.sh` to assert: (a) local `~/.omp/harvest-workspaces.local.json` overrides merge with `config/harvest-workspaces.json`, (b) `--no-local-config` isolates test fixtures (even after runtime config switches), (c) `omp-promote-assets.py` scrubs `OMP_SENSITIVE_TERMS`, (d) `harvest_cli.py --next` runs outside repo (`cd /tmp`) using `~/.omp/agent/omp-consolidation-ledger.json` without creating `./plans/` in `/tmp`, and (e) `scripts/omp-session-harvester.py` delegates cleanly to `harvester_core.py`. Extend `tests/test-omp-migration.sh` to assert `omp-setup-backup.sh` exits `2` on raw personal paths in `skills/` while allowing `/Users/user/...` doc examples, and preserves/reconciles `omp-plugins.lock.json` on upstream plugin merge.
2. **Step B (Config Merge & Deferred Scrub):** Move `_private_terms_pattern()` into `promote_all()` and `SessionHarvester.__init__()` after CLI flag parsing (`--config`, `--no-local-config`), merge `scanRoots`, `additionalWorkspaces`, `tierCExcludeGlobs`, `privateKeywords`, and Tier A/B dicts from `~/.omp/harvest-workspaces.local.json`, and pass compiled `priv_pat` to `sanitize_content()` / `sanitize_text()` / `sanitize_path()`.
3. **Step C (Repo Literal Scrub):** Replace remaining internal customer names and personal paths in `tests/test-omp-session-harvester.sh`, `zuey-omp-backup-workflow/SKILL.md`, `config/omp/agent/rules/file-type-enforcement.md:81`, and the V2 plan/report markdown files with sanitized placeholders.
4. **Step D (Standalone Harvester & Backup Guard):** Extract canonical engine into `config/omp/agent/skills/omp-session-harvester/scripts/harvester_core.py` with smart default ledger/report path resolution (repo `plans/` inside `zuey-pi-setup` vs `~/.omp/agent/` outside repo), convert `scripts/omp-session-harvester.py` to a thin delegator, add placeholder-aware `ABS_LEFT` guard in `scripts/omp-setup-backup.sh`, and sync `omp-plugins.lock.json` during `omp-setup-restore.sh` upstream plugin merges.
5. **Step E (Verify & Commit Baseline):** Run full test suite + anchored secret/path/symlink/DB grep across `git diff --cached` and `tar -tzf backups/omp-setup-portable.tar.gz`, sync ALL updated `config/omp/agent/` files (`skills/omp-session-harvester/`, `rules/file-type-enforcement.md`, `managed-skills/zuey-omp-backup-workflow/`) into live `~/.omp/agent/` BEFORE running `omp-setup-backup.sh --config-dir config/omp` (preventing `--config-dir` wipe from erasing Phase 1 edits), rebuild portable snapshot, and commit + push clean V2 baseline.

## Success Criteria

- [ ] Both `omp-session-harvester.py` and `omp-promote-assets.py` deep-merge `~/.omp/harvest-workspaces.local.json` when present and support `--no-local-config` isolation.
- [ ] Calling `omp-promote-assets.py` scrubs `OMP_SENSITIVE_TERMS` and `privateKeywords` inside promoted files before writing output.
- [ ] Running `harvest_cli.py --next` from an isolated temporary directory without `zuey-pi-setup` on disk or `ZUEY_PI_REPO` set exits 0.
- [ ] `omp-setup-backup.sh` rejects raw machine paths across all `agent/` subdirs with exit 2 and preserves `plugins/omp-plugins.lock.json`.
- [ ] Anchored grep on `git diff --cached` and restored tarball finds zero private customer literals, zero hardcoded workstation paths, zero `.db*`, and zero symlinks.

## Risk Assessment

- **False positives in `ABS_LEFT` across `skills-optin/` markdown docs:** Exclude illustrative placeholder names (`user`, `username`, `jesse`, `name`, `example`, `demo`, `<user>`) and test assertions/regex comments (`typesafe-redact-patterns.cjs`, `path-utils.cjs`), while hard-failing on real personal usernames/drive roots across code and docs.
- **Single source of truth for standalone harvester:** Keeping `harvester_core.py` inside the skill scripts directory and having `scripts/omp-session-harvester.py` delegate eliminates dual-copy drift cleanly.
