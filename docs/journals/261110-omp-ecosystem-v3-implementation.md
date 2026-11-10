---
title: "OMP Ecosystem V3 Hardening, Incremental Harvester Loop & Cross-OS Parity Journal"
date: 2026-11-10
context: "5-phase implementation of V3 hardening, incremental session harvesting, omp-toolkit-hub extension, global Claude parity, opt-in local linker, pypdf fallback, and private archive hygiene"
---

# Technical Journal: OMP Ecosystem V3 Hardening & Cross-OS Parity

## What Happened
- Repaired V2 cutover seams by merging `~/.omp/harvest-workspaces.local.json` after CLI parsing (with `--no-local-config` isolation), wiring `_PRIV_PAT` inside `scripts/omp-promote-assets.py:sanitize_content()`, scrubbing residual workstation/client strings, and scoping `ABS_LEFT` across all `agent/` subdirs while preserving `omp-plugins.lock.json`.
- Extracted `harvester_core.py` directly inside `config/omp/agent/skills/omp-session-harvester/scripts/` so `harvest_cli.py` works standalone on restored machines, and added incremental `fileWatermarks`, descriptor rehydration, `--extract <hash>`, `--include-advisors`, container-level symlink detection, and automatic `COMPLETED -> DRIFT_DETECTED` transitions.
- Built thin fail-open OMP extension `config/omp/agent/extensions/omp-toolkit-hub.ts` (+ `loop-state.ts`) registering `/harvest-loop`, `omp_harvest_status`, `omp_extract_cluster`, and `session_compact` checkpointing.
- Ported read-only 18 global Claude core agents, 6 rules (+ `pm-ba-prewrite-guards.md`), and 4 `/ck-*` workflow commands into `config/omp/agent/`, paired with manifest-driven `scripts/omp-link-local.py` (`--plan`/`--apply`/`--verify`).
- Added `pypdf>=4.0.0` pure-Python PDF extraction to `office-doc-suite` and `tools-requirements.txt`, `mpxj` CLI fallback to `pmo-project-suite`, scratch `mnemopi` pruning + opt-in `--sessions` to `omp-private-backup.sh`, and `nvm`/`fnm`/`volta`/`mise` Node probing to `omp-private-restore.sh`.

## Decisions & Engineering Lessons
- **Keeping machine-local cache out of Git:** Storing raw `fileWatermarks` (`mtime_ns`, `sessionRel`, `toolKey`) in `~/.omp/agent/omp-harvester-cache.json` whenever updating the tracked repo ledger kept `plans/omp-consolidation-ledger.json` compact (443 lines) and completely free of machine-local session coordinates while preserving in-file watermarks for standalone/test ledgers.
- **Bytecode & `pipefail` hygiene on Windows:** Setting `sys.dont_write_bytecode = True` before importing `harvester_core` prevents `__pycache__/*.pyc` creation inside `config/omp/agent/`, and capturing `tar -tzf` output into a variable before `grep -q` avoids `pipefail` SIGPIPE exit 141.
- **Mirror direction invariant:** Syncing repo edits under `config/omp/agent/` into live `~/.omp/agent/` prior to `omp-setup-backup.sh --config-dir` guarantees `--config-dir` wipe-and-mirror never discards new phase deliverables.

## Verification Summary
- All 10 bash suites, 4 Bun extension tests, 20 Python domain tests, live `--verify-ledger`, live portable tarball rebuild (`2.0 MB`, `1,275` entries), and live GPG `--all` backup + simulated Darwin restore (55 real `mnemopi` banks, 14 scratch skipped) passed with zero leaks.
