---
title: "OMP Ecosystem V4 Implementation & Verification Journal"
date: 2026-11-11
status: completed
---

# OMP Ecosystem V4 Implementation Journal

## What Happened
Executed all 5 phases of `plans/261111-0114-omp-ecosystem-v4-plugin-loop-sync/plan.md` using `--auto --tdd`:
1. Added deterministic noise filtering (`classify_artifact_noise()`), `dev_ops_automation` domain clustering, two-phase `--stage`/`--commit-stage`/`--triage` queue persistence, and atomic JSON writes in `harvester_core.py` (cutting `2,098` noisy `#edit`/runner/scratchpad artifacts out of the actionable queue and keeping `plans/omp-consolidation-ledger.json` at `718` lines).
2. Ported CleanPC v2.6 (`mode=extended`, `stale-scan`, `orphan-scan`, restorable `quarantine_paths`) into `system-maintenance-suite`, classified all discovered `.omp`/`.claude`/`.agent` directories in `~/.omp/harvest-workspaces.local.json`, and hardened `scripts/omp-link-local.py` with mixed `skills/` subdir linking, `--prefer-hardlink`, `--promote-missing`, Windows read-only cleanup handling, stale link target replacement, and reverse-direction refusal.
3. Expanded `omp-toolkit-hub` with `python-bridge.ts` (153 lines), `domain-tools.ts` (173 lines), `loop-state.ts` (155 lines), and `omp-toolkit-hub.ts` (197 lines), exposing `omp_office`, `omp_pmo`, `omp_email`, `omp_maint` (strict `force: true` gate), `omp_harvest`, `/harvest-loop`, and `/omp-doctor`.
4. Added `config/omp/agent/mcp.json.example`, absent-only `mcp.json` seeding and cross-OS rehydration across `omp-setup-{backup,restore}.sh` and `omp-private-{backup,restore}.sh`, `scripts/omp-doctor.py`, `scripts/omp-bootstrap.sh`, and `scripts/omp-bootstrap.ps1`.
5. Updated `docs/omp-operations-guide.md` and `docs/omp-setup-migration.md`, synced live `~/.omp/agent/`, rebuilt `backups/omp-setup-portable.tar.gz`, ran the full test matrix + strict doctor + independent `reviewer`/`security-reviewer` audits, and remediated the hostname/username leak in `windows_fix/cases/tu-dong-restart-va-startup-apps/README.md`.

## Key Decisions & Surprises
- Setting `PYTHONDONTWRITEBYTECODE: "1"` in `python-bridge.ts` and `loop-state.ts` prevents `omp_*` tool invocations inside the repo from leaving `.pyc` artifacts under `config/omp/agent/`.
- `omp-link-local.py` needed explicit realpath equality checks inside `already_linked` after discovering an existing project junction pointing to a non-global `.claude/rules` directory instead of `~/.omp/agent/rules`.
- `omp-setup-restore.sh` needed a guard (`[ ! -f "$STAGE_DIR/agent/extensions/$base_f" ]`) so modular hybrid extensions (`omp-toolkit-hub.ts` + `omp-toolkit-hub/`) are not treated as single-file shims replaced by a directory.
