---
title: "OMP Ecosystem V5 Release Journal"
date: 2026-11-11
status: completed
---

# OMP Ecosystem V5 Release Journal

## Overview
Executed all 5 phases of `plans/261111-1046-omp-ecosystem-v5-auto-loop-and-parity/plan.md` under `--auto --tdd` to eliminate ad-hoc script rewriting across sessions, close harvester signal-to-noise inefficiencies, and unify OMP and Claude Code working environments on Windows and macOS.

## Key Changes Delivered
1. **Release Sync & Ext Repo Backup:** Released V4 baseline on `main`, initialized local git tracking in `~/Projects/omp_extension`, and added `--include-dev-repos` to private GPG backup/restore scripts.
2. **Harvester Sieve & Bounded Loop Runner:** Fixed `harvester_core.py` to recognize `skills-optin/` in global diffs, filter inert `override`/`archive` workspaces, exclude `zuey-pi-setup` internal tools from queueing, and shipped `scripts/omp-harvest-loop-runner.sh`.
3. **Queue Drainage & Promotions:** Added pure-Python `xlsx-diff` to `pmo-project-suite` and `omp-prune` to `system-maintenance-suite`, triaged top duplicate clusters to advance ledger to Round 7.
4. **Hard Routing Guards & Mac Parity:** Rewrote `file-type-enforcement.md`, `skill-domain-routing.md`, and `APPEND_SYSTEM.md` to mandate `omp_*` native tools and shared CLIs; added `--link-claude` in bootstrap and Darwin diagnostics in `omp-doctor.py`.
5. **Full Cutover & Verification:** Synced live workstation, cleaned `.pyc`, rebuilt portable tarball, passed 100% of test suites, and verified zero leaks.
