---
phase: 2
title: "Project Delta Triage CleanPC Promotion and Global Linking"
status: pending
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: Project Delta Triage CleanPC Promotion and Global Linking

## Overview

Complete 3-tier triage across the 16 unpromoted `.omp`/`.claude`/`.agent` project directories, promote unique personal CleanPC and PM capabilities into canonical `~/.omp/agent/` (`config/omp/agent/`), harden `scripts/omp-link-local.py` for safe mixed-directory and cross-volume linking, and populate `workspaceClassification` so local workspaces cleanly link back to Global OMP without polluting global prompt context.

## Requirements

- **Functional:**
  1. Audit and classify the 16 unpromoted project config directories into explicit manifest buckets in `~/.omp/harvest-workspaces.local.json` (and documented sample rules in `config/harvest-workspaces.json`):
     - **Promote to Priority-100 / Merge into Core Suites:** Extract portable features from `CleanPC/.claude` (`windows-cleanup` + `macos-cleanup` v2.6 features: extended lang caches, orphan leftover quarantine/restore, stale project >90d trimming, human review queue) into `config/omp/agent/skills/system-maintenance-suite/` without embedding hardcoded Google Drive `/Volumes/Data/...` workstation paths. Review `104_PM_PhanTich/.claude` (`manifests` / rules) for any missing portable BA rule deltas.
     - **Isolate / Opt-In Foreign Kits (`skills-optin` `hide: true` or `override`):** Keep multi-agent/command commercial & third-party kits (`claudekit-marketing`, `08_Bot` claude-flow, `rtk`, `OutlookOkan/.agent`, `TMP_Source/.agent`, `NanoResearch-main`) out of active global `agents/`/`commands/`/`rules/` to prevent prompt bloat and collision; place optional skills into `skills-optin` (`hide: true`) or mark repos as `override`/`archive`.
     - **Repair Stale Local Paths:** Remove or update dead workspace entries (e.g., missing `TMP_Source/01_Setup_HOME`) in `~/.omp/harvest-workspaces.local.json`.
  2. Upgrade `scripts/omp-link-local.py` to:
     - Support `--promote-missing` (explicit opt-in flag, disabled by default on `--plan` / `--apply`) or per-subdir `skills/<name>/` linking even when a project `.omp/.claude/.agent/skills/` folder holds both shared and project-custom skills.
     - On same-volume NTFS/POSIX mixed file directories (`agents/`, `commands/`, `rules/`), support `--prefer-hardlink` (using `os.link` on same device before falling back to hash-verified sync) and enforce cross-OS `os.symlink` on macOS/Linux.
     - Guarantee strict **Project -> Global** link direction only (refuse creating any symlink from `~/.omp/agent/` pointing into a project directory) and mandatory snapshot backup under `~/.omp/restore-backups/local-links/` before replacing any non-link file/dir.
  3. Apply `omp-link-local.py --apply` + `--verify` across live `shared_mirror` workspaces and re-run `harvester --scan --diff-global` so unpromoted drift count reflects zero unintended deltas.
- **Non-Functional:**
  - Zero private paths, client keywords, or third-party commercial kit bloat committed to `config/omp/agent/` or `plans/`.
  - `omp-setup-backup.sh` continues dereferencing (`cp -rL`) and refusing raw symlinks inside `backups/omp-setup-portable.tar.gz`.

## Architecture

```text
16 Unpromoted Project Config Dirs
  ├─ Custom Reusable (CleanPC v2.6, PM rules) ──▶ Merge/Sanitize into config/omp/agent/skills/
  ├─ Third-Party Kits (marketing, 08_Bot, rtk) ─▶ override OR skills-optin (hide: true)
  └─ Eligible Shared Mirrors ────────────────────▶ omp-link-local.py --apply
                                                    ├─ skills/<name>/ -> mklink /J (Win) | ln -s (Mac)
                                                    └─ mixed *.md     -> hardlink (same dev) | hash-sync
```

## Related Code Files

- Modify: `scripts/omp-link-local.py`
- Modify: `config/omp/agent/skills/system-maintenance-suite/SKILL.md`
- Modify: `config/omp/agent/skills/system-maintenance-suite/scripts/cleaner_dispatcher.py`
- Modify: `config/omp/agent/skills/system-maintenance-suite/scripts/maintenance_cli.py`
- Modify: `config/omp/agent/skills/system-maintenance-suite/tests/test_maintenance_suite.py`
- Modify: `config/harvest-workspaces.json` (documentation/schema defaults only)
- Update (local workstation outside repo): `~/.omp/harvest-workspaces.local.json`
- Modify: `tests/test-omp-local-linker.sh`

## Implementation Steps

1. **Step A (TDD Tests First):** Extend `tests/test-omp-local-linker.sh` to cover: (a) mixed `skills/` directory containing 1 global skill + 1 local custom skill links the global skill directory without deleting the local skill, (b) same-device `--prefer-hardlink` creates hardlink for mixed `.md` rules, and (c) symlink direction guard rejects any attempt to point `~/.omp/agent` into a project path. Add unit tests in `test_maintenance_suite.py` for v2.6 CleanPC capabilities (extended language cache dry-run targets, orphan/quarantine safety checks, stale artifact age threshold).
2. **Step B (Promote CleanPC v2.6 & Sanitize):** Port v2.6 `CleanPC` capabilities (`lang_caches_extended`, `orphan_leftovers` quarantine preview, `stale_project_artifacts` >90d check) cleanly into `system-maintenance-suite/scripts/cleaner_dispatcher.py` and `maintenance_cli.py` (cross-OS Windows/Darwin dry-run safe), keeping zero workstation-specific paths.
3. **Step C (Harden `omp-link-local.py`):** Enhance `process_workspace_links()` to handle mixed `skills/` per-entry linking cleanly alongside `--prefer-hardlink` for same-volume `.md` files and direction validation.
4. **Step D (Classify & Link Live Mirrors):** Update `~/.omp/harvest-workspaces.local.json` (`workspaceClassification.override` vs `shared_mirror` vs `archive`, clean dead paths), run `omp-link-local.py --plan`, inspect output, run `--apply` and `--verify`.
5. **Step E (Verify):** Run `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-local-linker.sh`, `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-managed-skills-integrity.sh`, and `python -m unittest` for `system-maintenance-suite`.

## Success Criteria

- [ ] CleanPC v2.6 extended cache, orphan, and stale-project dry-run capabilities operate cross-OS in `system-maintenance-suite` without hardcoded paths.
- [ ] `omp-link-local.py` links matching skills inside mixed project `skills/` dirs without overwriting unpromoted local skills.
- [ ] All 16 project delta directories are explicitly classified (`override`, `shared_mirror`, or `archive`) in `~/.omp/harvest-workspaces.local.json` with zero dead roots.
- [ ] `omp-link-local.py --verify` exits 0 with zero broken links across all configured `shared_mirror` paths.

## Risk Assessment

- **Third-party git repos showing dirty files after linking:** Keep active git clones (`claudekit-marketing`, `NanoResearch-main`, `rtk`, `OpenHarness`, `OutlookOkan`) classified as `override` (untouched) or in `tierBOptInSources` (`skills-optin` `hide: true`) rather than mutating their working trees.
- **Data loss on destructive cleanup modules:** Keep `--dry-run` default and require explicit `--force` for `clean` across all new CleanPC v2.6 targets; never touch user Documents/Desktop/Downloads.
