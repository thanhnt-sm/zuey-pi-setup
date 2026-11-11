---
phase: 4
title: "Cross OS Unified Bootstrap MCP Portability and Doctor"
status: pending
priority: P1
effort: "3h"
dependencies: [2, 3]
---

# Phase 4: Cross OS Unified Bootstrap MCP Portability and Doctor

## Overview

Unify Windows and macOS synchronization into an idempotent 2-layer bootstrap entrypoint (`omp-bootstrap.sh` + `omp-bootstrap.ps1`), add native portable `mcp.json` template & cross-OS `omp-private-restore.sh` rehydration parity, and ship `omp-doctor.py` to validate runtime, venv, plugins, MCP paths, local links, and zero leaks end to end.

## Requirements

- **Functional:**
  1. Add portable OMP MCP template `config/omp/agent/mcp.json.example` (never committing live secret env values or local user paths) and update `scripts/omp-setup-restore.sh` to initialize `~/.omp/agent/mcp.json` from `mcp.json.example` ONLY when absent and rehydrate `{{USER_HOME}}` / `{{OMP_NODE}}` placeholders cleanly across Windows and macOS (`nvm`/`fnm`/`volta`/`mise`).
  2. Update `scripts/omp-private-backup.sh` and `scripts/omp-private-restore.sh` so if `~/.omp/agent/mcp.json` exists during `--typesafe-kit` / `--all`, any machine-specific `{{USER_HOME}}` / `{{CLAUDE_NODE}}` paths inside it are templatized on backup and cleanly rehydrated alongside `~/.claude.json` on restore.
  3. Create `scripts/omp-doctor.py` (with `--json`, `--target-dir`, `--repo-dir`, `--strict` flags, also callable from `/omp-doctor` in `omp-toolkit-hub`):
     - Checks `~/.omp/tools-venv` Python binary + required imports (`openpyxl`, `docx`, `defusedxml`, `extract_msg`, `pypdf`).
     - Checks `~/.omp/plugins/node_modules` & `omp-plugins.lock.json` reconciliation status.
     - Checks `~/.omp/agent/extensions/omp-toolkit-hub.ts` + submodules + zero leftover `*.db-wal` / `*.db-shm` orphans when inactive.
     - Validates `mcp.json` / `.claude.json` server command binaries exist on current OS (no `C:\Users\...` paths left on macOS).
     - Runs `omp-link-local.py --verify` check against configured `shared_mirror` paths.
     - Scans repo `config/omp/` for forbidden `.db*`, `.env`, un-dereferenced symlinks, or hardcoded drive paths (`ABS_LEFT`).
  4. Create `scripts/omp-bootstrap.sh` (plus thin Windows PowerShell wrapper `scripts/omp-bootstrap.ps1` invoking Git Bash cleanly):
     - `--mode restore` (fresh machine or sync pull): optional `git pull --ff-only` -> `omp-setup-restore.sh` -> optional `omp-private-restore.sh <archive>` -> `omp-link-local.py --apply --verify` (if mirrors exist) -> `omp-doctor.py`.
     - `--mode backup` (active machine export): `harvester --scan --diff-global` -> `omp-setup-backup.sh --config-dir config/omp` -> optional `omp-private-backup.sh --all` -> `omp-doctor.py --strict`.
     - `--mode doctor`: diagnostics only (read-only).
- **Non-Functional:**
  - Strict Public/Private boundary: `omp-bootstrap.sh` never defaults to writing private GPG backups inside the git repo; `omp-setup-backup.sh` continues excluding live `.env` and live machine `mcp.json` paths.
  - Cross-OS compatibility verified under Git Bash (Windows) and `OS_OVERRIDE=Darwin` simulated macOS environments.

## Architecture

```text
omp-bootstrap.sh / omp-bootstrap.ps1
  ├─ --mode restore -> git pull -> omp-setup-restore.sh -> [omp-private-restore.sh] -> omp-link-local --apply -> omp-doctor
  ├─ --mode backup  -> harvester --scan --diff-global -> omp-setup-backup.sh --config-dir config/omp -> [omp-private-backup.sh] -> omp-doctor --strict
  └─ --mode doctor  -> omp-doctor.py (tools-venv + plugins + mcp.json + links + WAL/leak scan)
```

## Related Code Files

- Create: `config/omp/agent/mcp.json.example`
- Create: `scripts/omp-doctor.py`
- Create: `scripts/omp-bootstrap.sh`
- Create: `scripts/omp-bootstrap.ps1`
- Modify: `scripts/omp-setup-backup.sh`
- Modify: `scripts/omp-setup-restore.sh`
- Modify: `scripts/omp-private-backup.sh`
- Modify: `scripts/omp-private-restore.sh`
- Modify: `config/omp/agent/extensions/omp-toolkit-hub.ts` (wire `/omp-doctor` cleanly to packaged doctor helper)
- Modify: `tests/test-omp-migration.sh`
- Modify: `tests/test-omp-private-restore.sh`
- Modify: `tests/test-omp-e2e-cross-platform.sh`

## Implementation Steps

1. **Step A (TDD Tests First):** Add assertions to `tests/test-omp-migration.sh`, `tests/test-omp-private-restore.sh`, and `tests/test-omp-e2e-cross-platform.sh` verifying: (a) `mcp.json.example` initializes `mcp.json` safely with cross-OS path rehydration without overwriting existing user `mcp.json`, (b) `omp-private-restore.sh` rehydrates `{{CLAUDE_NODE}}` & `{{USER_HOME}}` inside `~/.omp/agent/mcp.json` under `OS_OVERRIDE=Darwin`, (c) `omp-doctor.py --json` catches broken links / missing `mcp.json` commands / repo leaks and passes cleanly on healthy targets, and (d) `omp-bootstrap.sh --mode restore --no-install` + `--mode doctor` work cleanly against isolated temp targets.
2. **Step B (MCP Portability):** Add `config/omp/agent/mcp.json.example` and update `omp-setup-backup.sh`, `omp-setup-restore.sh`, `omp-private-backup.sh`, and `omp-private-restore.sh` for safe `mcp.json` templatization and rehydration.
3. **Step C (Implement `omp-doctor.py`):** Implement read-only diagnostics covering Python `tools-venv`, Node/Bun plugins, extension graph, `mcp.json` binary checks, local links, WAL files, and public repo leak checks.
4. **Step D (Implement `omp-bootstrap.{sh,ps1}`):** Wire idempotent `--mode restore | backup | doctor` orchestration with explicit `--skip-pull`, `--private-archive`, `--target-dir`, `--no-install`, and `--dry-run` safety flags.
5. **Step E (Verify):** Execute `tests/test-omp-migration.sh`, `tests/test-omp-private-restore.sh`, and `tests/test-omp-e2e-cross-platform.sh`.

## Success Criteria

- [ ] `scripts/omp-doctor.py --json` validates Python venv imports, plugins, `mcp.json` binaries, local links, and zero repo leaks across Windows and Darwin mocks.
- [ ] `scripts/omp-private-restore.sh` rehydrates `{{USER_HOME}}` and `{{CLAUDE_NODE}}` inside both `~/.claude.json` and `~/.omp/agent/mcp.json` on Darwin and Windows.
- [ ] `scripts/omp-bootstrap.sh --mode restore` runs end-to-end public restore, optional private restore, local link verification, and doctor healthcheck in one command.
- [ ] `tests/test-omp-migration.sh`, `tests/test-omp-private-restore.sh`, and `tests/test-omp-e2e-cross-platform.sh` pass cleanly.

## Risk Assessment

- **Overwriting user live `mcp.json` during public restore:** Only create `~/.omp/agent/mcp.json` from `mcp.json.example` when absent, and save overwritten files to `restore-backups/<timestamp>/` when `--private-restore` updates it.
- **PowerShell execution policy / WSL bash trap on Windows:** `omp-bootstrap.ps1` explicitly locates `C:\Program Files\Git\bin\bash.exe` (rejecting `System32\bash.exe`) and forwards quoted arguments cleanly.
