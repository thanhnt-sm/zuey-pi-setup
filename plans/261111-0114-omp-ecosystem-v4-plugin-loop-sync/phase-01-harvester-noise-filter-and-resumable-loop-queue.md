---
phase: 1
title: "Harvester Noise Filter and Resumable Loop Queue"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Harvester Noise Filter and Resumable Loop Queue

## Overview

Eliminate the >90% ephemeral noise (`#edit` patch hunks, inline test runners, and scratchpads) drowning `general_utilities` inside `omp-session-harvester`, expand domain clustering for workstation ops and code-migration scripts, and introduce a two-phase resumable `promotionQueue` + disposition registry in `omp-consolidation-ledger.json` for deterministic multi-session loops.

## Requirements

- **Functional:**
  1. Add deterministic `classify_artifact_noise()` pre-filter in `config/omp/agent/skills/omp-session-harvester/scripts/harvester_core.py` classifying `#edit\d+` single-file patch hunks, `*.test.*` / `self-test.*` / `simulate_*` test invocations, `eval_py_*` / `eval_js_*` pure test runners, and `/scratchpad/` / `inline_node_*` temp files as `ephemeral_noise` (retained in `clusterIndex` for audit, excluded from actionable `promotionQueue` unless `--include-noise` is passed).
  2. Expand `SUITE_PATTERNS` and `PATH_AFFINITIES` in `harvester_core.py` to classify uncovered high-signal standalone utilities into existing suites or a dedicated `dev_ops_automation` bucket (`CleanPC`, `Test-VpnConnection`, DISM/stale scanners, SVN/React Native migration scripts, DB/Mermaid extractors) without forcing noise into Priority-100 skills.
  3. Add explicit `promotionQueue` (`[{hash, suite, targetSample, occurrences, state, disposition}]`) and `loopMeta` (`{round, lastRoundAt, maxRounds, zeroDeltaStreak}`) to `omp-consolidation-ledger.json` alongside `promotedHashes`.
  4. Implement two-phase promotion states (`pending -> staged -> promoted | merged_into | deferred | ignored_noise`) and new CLI flags in `harvester_core.py` / `harvest_cli.py`:
     - `--include-noise`: include filtered ephemeral entries in queue output
     - `--triage <hash> --disposition <promoted|merged_into|deferred|ignored_noise> [--suite <suite>] [--target <path>]`
     - `--stage <hash>` (marks `staged` prior to test gate) and `--commit-stage <hash> --suite <suite> --target <path>` (promotes only after tests pass)
     - `--round-summary` / upgraded `--next`: returns the next highest-occurrence actionable batch (`pending` or orphaned `staged`), current `round`, and explicit stop condition when actionable queue length reaches `0`.
- **Non-Functional:**
  - Preserve backwards compatibility for all existing `tests/test-omp-session-harvester.sh` assertions (`--scan`, `--diff-global`, `--extract`, `--include-advisors`, `--no-local-config`, `_PRIV_PAT`).
  - Keep `omp-consolidation-ledger.json` compact (<800 lines) by keeping heavy raw watermarks in `~/.omp/agent/omp-harvester-cache.json`.
  - Enforce atomic temp-file + `os.replace()` writes when persisting ledger and cache JSON files.

## Architecture

```text
.jsonl + DB + workspaces
   │
   ▼ (watermarks O(delta))
harvester_core.py
   ├─ is_ephemeral_noise() ─▶ retained in clusterIndex (noiseCount tracked)
   └─ actionable standalone ─▶ domain classifier ─▶ promotionQueue (pending)
                                                      │
        /harvest-loop / harvest_cli --next ◀──────────┘
           ├─ --stage <hash>       -> state = "staged"
           ├─ run pytest / bun test -> pass gate
           └─ --commit-stage <hash> -> promotedHashes[hash] + state = "promoted"
```

## Related Code Files

- Modify: `config/omp/agent/skills/omp-session-harvester/scripts/harvester_core.py`
- Modify: `config/omp/agent/skills/omp-session-harvester/scripts/harvest_cli.py`
- Modify: `config/omp/agent/skills/omp-session-harvester/SKILL.md`
- Modify: `tests/test-omp-session-harvester.sh`

## Implementation Steps

1. **Step A (TDD Tests First):** Extend `tests/test-omp-session-harvester.sh` with V4 assertions covering: (a) `#edit` hunks, `*.test.*`, and scratchpad files are tagged `ephemeral_noise` and excluded from `promotionQueue` by default while standalone scripts appear, (b) `--include-noise` surfaces them, (c) `--stage <hash>` creates a resumable `staged` entry surfaced first by `--next`, (d) `--commit-stage <hash> --suite ... --target ...` moves it to `promotedHashes` and advances `loopMeta.round`, and (e) `--triage <hash> --disposition ignored_noise` persists across subsequent `--scan --diff-global` runs.
2. **Step B (Noise Filter & Domain Classifier):** Add `classify_artifact_noise(descriptor, code)` in `harvester_core.py` with explicit rules for edit diffs (`#edit`), unit test/runner targets, and scratchpad/inline temp snippets. Extend `SUITE_PATTERNS` / `PATH_AFFINITIES` for Windows/macOS CleanPC/PowerShell ops and structured migration helpers.
3. **Step C (Queue Schema, Atomic Persistence & CLI Flags):** Implement `promotionQueue` reconciliation inside `Harvester.update_ledger()` preserving prior dispositions and `promotedHashes`, add atomic JSON writer helper, and wire `--include-noise`, `--triage`, `--stage`, `--commit-stage`, and `--round-summary` into `build_parser()` / `main()`.
4. **Step D (Verify & Refresh Baseline):** Run `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-session-harvester.sh` and verify zero private term leaks and compact ledger size.

## Success Criteria

- [ ] Ephemeral `#edit` hunks, test runners, and scratchpad artifacts are excluded from default `promotionQueue` while `--include-noise` restores them.
- [ ] Running `--stage` followed by `--commit-stage` transitions a cluster through `staged` to `promoted` and records it under `promotedHashes`.
- [ ] Cluster dispositions (`merged_into`, `deferred`, `ignored_noise`) persist across repeated `--scan --diff-global` invocations.
- [ ] `tests/test-omp-session-harvester.sh` passes 100% after all edits with zero regressions to V3 watermark and `--extract` assertions.

## Risk Assessment

- **Over-filtering genuine tools inside `eval_py_*`:** Restrict `eval_inline_block` noise filtering to scripts matching test runner / one-off harness patterns (`unittest`, `pytest`, `simulate_`, `<10` lines without `def `), keeping real multi-function `eval` scripts queued.
- **Interrupted round leaving stuck `staged` item:** Surface `staged` items at the top of `--next` so the following session resumes or rolls back cleanly.
