---
phase: 2
title: "Incremental Watermark Loop and Thin OMP Extension"
status: pending
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Incremental Watermark Loop and Thin OMP Extension

## Overview

Upgrade the harvester engine into a true incremental `O(delta)` multi-round loop with per-file watermarks, full code extraction (`--extract <hash>`), advisor inclusion toggle, locked-file retry, container-level symlink detection, and automatic `DRIFT_DETECTED` state transitions, paired with one thin native OMP extension (`omp-toolkit-hub.ts`) for `/harvest-loop` and compaction checkpointing.

## Requirements

- **Functional:**
  1. Add `fileWatermarks` (`{path: {mtime_ns, size, sha256, artifacts: [...]}}`) and `promotedHashes` (`{hash: {suite, promotedAt, targetFile}}`) to `omp-consolidation-ledger.json` so `--scan` skips re-parsing unchanged `.jsonl` files (`--full-rescan` overrides), **rehydrates** cached compact artifact descriptors from `fileWatermarks[path].artifacts` into `self.harvested_artifacts` / `self.duplicate_groups` / `self.cluster_index` so aggregate counts stay accurate, and retries transient Windows locks (`PermissionError` / `WinError 32`, 3x 50ms) without advancing failed watermarks.
  2. Persist compact cluster source pointers (`sessionPath`, `entryIndex`, `toolKey`) in `ledger["clusterIndex"][hash]` and add `--extract <hash> [--out <dir>]` to materialize full runnable scripts from `.jsonl` transcripts onto disk (removing the 200-char preview dead end).
  3. Add `--include-advisors` flag to index `__advisor*.jsonl` verification scripts alongside top-level/subagent sessions while reporting counts separately.
  4. Fix `scan_global_diff()` in `harvester_core.py` to test `is_reparse_or_symlink(sp)` on subdirectory containers (`skills`, `agents`, `commands`, `rules`) themselves in addition to child entries.
  5. Automatically flip `status` from `COMPLETED` / `VERIFIED_E2E` -> `DRIFT_DETECTED` whenever `--scan --diff-global` detects new unpromoted clusters or unpromoted local config deltas, surfacing them via `--next`.
  6. Create modular OMP extension `config/omp/agent/extensions/omp-toolkit-hub.ts` (with helper module under `extensions/omp-toolkit-hub/` keeping each TS file <=200 lines) using `ExtensionAPI`: `pi.registerCommand("harvest-loop", ...)`, `pi.registerTool(...)` (`omp_harvest_status`, `omp_extract_cluster`), and `pi.on("session_compact", ...)` / `pi.on("session_start", ...)` to persist and restore loop checkpoint context across compaction and fresh sessions.
- **Non-Functional:**
  - Extension MUST fail open cleanly when `tools-venv` or ledger is absent (never throw uncaught errors out of OMP event handlers, matching `compaction-policy.ts` invariants).
  - Zero persistent background MCP daemon spawned; extension invokes standalone skill CLI on demand.

## Related Files

- Modify: `config/omp/agent/skills/omp-session-harvester/scripts/harvester_core.py`
- Modify: `config/omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py`
- Modify: `scripts/omp-session-harvester.py`
- Create: `config/omp/agent/extensions/omp-toolkit-hub.ts`
- Create: `config/omp/agent/extensions/omp-toolkit-hub/loop-state.ts`
- Create: `tests/test-omp-toolkit-hub.test.ts` (Bun/Node unit test mocking `ExtensionAPI`)
- Modify: `tests/test-omp-session-harvester.sh`

## Implementation Steps

1. **Step A (Tests First):** Add TDD assertions in `tests/test-omp-session-harvester.sh` covering: (a) second `--scan` skips unchanged `.jsonl` via `fileWatermarks` (`skippedUnchanged >= 1`) while retaining identical `harvestedArtifactsCount`, `uniqueCodeClusters`, and `suites[*].harvestedCount` via descriptor rehydration, (b) new session modifying/adding a script flips `COMPLETED` -> `DRIFT_DETECTED`, (c) `--extract <hash> --out <dir>` writes complete unclipped Python/TS code to disk, (d) `--include-advisors` captures `__advisor*.jsonl`, and (e) directory-level junction at `.omp/rules` is detected by `scan_global_diff`. Create `tests/test-omp-toolkit-hub.test.ts` testing command registration, tool execution, and non-throwing `session_compact` handler with a mock `ExtensionAPI`.
2. **Step B (Incremental Watermark & Cluster Rehydration):** Refactor `SessionHarvester.scan_sessions()` in `harvester_core.py` to check `(mtime_ns, size)` against `ledger["fileWatermarks"]`, retry transient `PermissionError` reads (3x, 50ms backoff), persist compact artifact descriptors under `fileWatermarks[path]["artifacts"]` (rehydrating `harvested_artifacts` and `duplicate_groups` on cache hit), index source coordinates in `clusterIndex`, and implement `extract_cluster(cluster_hash, out_dir)` reading the indexed `.jsonl` entry cleanly.
3. **Step C (Container Symlink & Auto-Drift):** Update `scan_global_diff()` to check `is_reparse_or_symlink(sp)` before iterating children, and update `update_ledger()` to compare active cluster hashes against `promotedHashes` and transition `COMPLETED` -> `DRIFT_DETECTED` when new actionable clusters or unpromoted deltas appear.
4. **Step D (Thin OMP Extension):** Implement `config/omp/agent/extensions/omp-toolkit-hub/loop-state.ts` (checkpoint read/write to `~/.omp/agent/loop-checkpoint.json` + safe subprocess runner calling standalone `omp-session-harvester` skill) and `config/omp/agent/extensions/omp-toolkit-hub.ts` registering `/harvest-loop [status|scan|next|extract <hash>]`, `omp_harvest_status`, `omp_extract_cluster`, and `session_compact` checkpoint persistence.
5. **Step E (Verify):** Run `tests/test-omp-session-harvester.sh` and `bun test tests/test-omp-toolkit-hub.test.ts` (or `node --test`).

## Success Criteria

- [ ] Second `omp-session-harvester.py --scan` skips unchanged `.jsonl` files using `fileWatermarks` unless `--full-rescan` is passed.
- [ ] Running `--extract <hash> --out <dir>` recovers the full original script from JSONL transcripts rather than a 200-character preview.
- [ ] New unpromoted code clusters or container-level `.omp/rules` symlinks transition ledger status from `COMPLETED` to `DRIFT_DETECTED`.
- [ ] Passing `--include-advisors` indexes `__advisor*.jsonl` files and reports advisor counts separately from primary/subagent sessions.
- [ ] Extension `omp-toolkit-hub.ts` registers `/harvest-loop`, `omp_harvest_status`, and `omp_extract_cluster` and passes unit tests with fail-open handlers.

## Risk Assessment

- **Ledger bloat if storing full scripts in JSON:** Store only compact locator metadata (`session`, `entryIdx`, `toolKey`, `sha256`, 200-char preview) in `omp-consolidation-ledger.json` and hydrate full source lazily from `.jsonl` during `--extract`.
- **OMP extension API compatibility:** Verify `pi.registerCommand`, `pi.registerTool`, `pi.appendEntry`, `pi.on("session_compact")` against live `omp v18.18.6` behavior; guard optional methods with `typeof pi.registerCommand === "function"` exactly like `typesafe-planner.ts`.
