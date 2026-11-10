---
phase: 1
title: "Multi-Source Harvester & .omp/.claude Global Diff Engine"
status: in-progress
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Multi-Source Harvester & `.omp`/`.claude` Global Diff Engine

## Overview
Upgrade `scripts/omp-session-harvester.py` from an OMP-only prototype into an exhaustive, idempotent workstation harvester & global-promotion analyzer covering OMP transcripts (`107` `.jsonl`), Claude transcripts (`274` `.jsonl` + `history.jsonl`), `history.db` (`1,422` prompts / `429` recaps), and all `149` project `.omp`/`.claude`/`.agent` directories via `config/harvest-workspaces.json`.

## Requirements
- **Functional:**
  1. Create `config/harvest-workspaces.json` encoding canonical scan roots (`~/Projects`, `~/Downloads`, `~/tmp`) plus local overrides in `~/.omp/harvest-workspaces.local.json`, Tier A promotion sources, Tier B opt-in pack sources, and Tier C exclusion globs (`claudekit-engineer` clones, legacy v1 kits, `ck-selftest-proj-*`, `omp_extension_backup_*`, `.worktrees`, `restore-backups`).
  2. Fix `scan_sessions()` in `scripts/omp-session-harvester.py`:
     - Index every `eval` call uniquely (`eval_<lang>_<idx>_<hash>`) instead of overwriting `eval_<lang>`.
     - Capture `edit` tool mutations (`oldText`/`newText` or `old_string`/`new_string`), all `bash` heredocs (`<< 'PY'`, `<< 'END'`, `<<-EOF`, `tee`, inline `python -c`/`node -e`/`bun -e`/`pwsh -Command`), and filter out non-code docs unless under `skills/`.
     - Parse `~/.claude/projects/**/*.jsonl` (`type == "tool_use"`, `input` schema) and `~/.claude/history.jsonl`.
     - Query `~/.omp/agent/history.db` (`history`, `session_recaps`, `session_titles`) read-only (via SQLite `uri=True` immutable/ro or safe read snapshot) to discover active tool `cwd`s and session context.
     - Exclude `__advisor*.jsonl` consistently from both `scan_sessions()` and `totalSessionsScouted`.
  3. Add `.omp`/`.claude`/`.agent` project-vs-global inventory & diff mode (`--diff-global`) detecting missing skills, agents, workflows, commands, hooks, and rules plus symlink/junction status.
  4. Add `--next` (prints next pending ledger unit for multi-session loop resumption) and `--verify-ledger` flags; fix `os.makedirs(os.path.dirname(path) or ".", exist_ok=True)`.
  5. Strengthen `SENSITIVE_PATTERNS` (`sk-ant-`, `github_pat_`, `ya29.`, JWT `eyJ...`, `xox...`, private keys, internal customer keywords via `privateKeywords` / `OMP_SENSITIVE_TERMS`, machine paths).
- **Non-Functional:**
  - Read-only against source transcripts, `history.db`, and project dirs.
  - Zero sensitive tokens or customer names written to `plans/omp-consolidation-ledger.json` or `plans/harvest-inventory.md`.

## Related Code Files
- Create: `config/harvest-workspaces.json`
- Modify: `scripts/omp-session-harvester.py`
- Modify: `tests/test-omp-session-harvester.sh`
- Update: `plans/omp-consolidation-ledger.json`
- Update: `plans/harvest-inventory.md`

## Implementation Steps
1. Author `config/harvest-workspaces.json` with verified roots, Tier A/B manifests, and Tier C ignore patterns.
2. Refactor `scripts/omp-session-harvester.py` with multi-source parsers (OMP JSONL, Claude JSONL, `history.db`, config-dir scanner), unique `eval` keys, hardened sanitizer, `--diff-global`, `--next`, `--verify-ledger`, and interactive menu options.
3. Expand `tests/test-omp-session-harvester.sh` to cover multi-`eval`, `edit`, Claude `tool_use`, mock `history.db`, project `.omp`/`.claude` diffing, secret scrubbing, and bare-filename `--ledger`/`--report` paths.
4. Run live `--scan --diff-global` and update `plans/omp-consolidation-ledger.json` & `plans/harvest-inventory.md`.

## Success Criteria
- [ ] `"C:/Program Files/Git/bin/bash.exe" tests/test-omp-session-harvester.sh` exits 0 with all assertions passing.
- [ ] Live `python scripts/omp-session-harvester.py --scan --diff-global` indexes OMP, Claude, `history.db`, and curated workspaces with zero leaked tokens or customer identifiers.
- [ ] `python scripts/omp-session-harvester.py --next` outputs deterministic multi-session continuation state.
