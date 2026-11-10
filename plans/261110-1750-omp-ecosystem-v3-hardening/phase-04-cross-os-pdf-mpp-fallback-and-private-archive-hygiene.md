---
phase: 4
title: "Cross-OS PDF MPP Fallback and Private Archive Hygiene"
status: pending
priority: P2
effort: "3h"
dependencies: [1]
---

# Phase 4: Cross-OS PDF MPP Fallback and Private Archive Hygiene

## Overview

Eliminate the macOS `pdftotext` external binary dependency in `office-doc-suite` by adding pure-Python `pypdf` extraction, document `.mpp` binary cross-OS workflows in `pmo-project-suite`, filter ephemeral test `mnemopi` banks by default in `omp-private-backup.sh`, add opt-in `--sessions` transcript archiving outside Git, and harden `nvm`/`fnm`/`volta`/Bun Node discovery in `omp-private-restore.sh`.

## Requirements

- **Functional:**
  1. Add `pypdf>=4.0.0` (pure Python, zero C extensions) to `config/omp/agent/tools-requirements.txt` and update `config/omp/agent/skills/office-doc-suite/scripts/doc_converter.py:to_md` `.pdf` branch to extract text via `pypdf` first, falling back to `pdftotext` if available, and raising a clear actionable error when encountering image-only scanned PDFs.
  2. Update `config/omp/agent/skills/pmo-project-suite/scripts/project_sync.py` and `SKILL.md` so `mpp2xml` detects optional `mpxj` CLI (`shutil.which("mpxj")`) on macOS/Linux before emitting clear `.xml` export guidance (`RuntimeError` fallback).
  3. Update `scripts/omp-private-backup.sh`:
     - Filter ephemeral test `mnemopi` banks by default (`omp-verify-workspace-*`, `scratch-*`, `ck-smoke-*`, `broken-*`, `[a-c]-*` short test hashes matching `^[a-z]-[a-z0-9]+$`), with `--include-scratch-banks` flag to override.
     - Add `--sessions` opt-in flag (outside Git!) backed by a selective Python staging helper copying only `*.jsonl` (from `~/.omp/agent/sessions` and `~/.claude/projects`) and `memory/**` (from `~/.claude/projects/*/memory`), skipping `.lock`/temp files and retrying transient `PermissionError`/`FileNotFoundError` (3x, 50ms) with warning rather than aborting under `set -euo pipefail`.
- **Non-Functional:**
  - `pypdf` extraction unit test must build a deterministic multi-page synthetic PDF fixture in-memory or pure Python (no external PDF binary fixture required).
  - Existing `--memory`, `--history`, `--typesafe-kit`, `--claude`, `--all` flags remain backward-compatible (`--all` includes core private state; `--sessions` stays explicit opt-in so multi-GB session transcripts don't bloat routine memory backups).

## Related Files

- Modify: `config/omp/agent/tools-requirements.txt`
- Modify: `config/omp/agent/skills/office-doc-suite/scripts/doc_converter.py`
- Modify: `config/omp/agent/skills/office-doc-suite/SKILL.md`
- Modify: `config/omp/agent/skills/office-doc-suite/tests/test_office_suite.py`
- Modify: `config/omp/agent/skills/pmo-project-suite/scripts/project_sync.py`
- Modify: `config/omp/agent/skills/pmo-project-suite/SKILL.md`
- Modify: `scripts/omp-private-backup.sh`
- Modify: `scripts/omp-private-restore.sh`
- Modify: `tests/test-omp-private-restore.sh`
- Modify: `tests/test-omp-tools-venv-hydration.sh`

## Implementation Steps

3. **Step C (Private Backup Hygiene & Node Probe):** Implement `is_scratch_mnemopi_bank()` filter, `--include-scratch-banks`, and lock-tolerant Python `--sessions` staging helper in `scripts/omp-private-backup.sh`, and expand macOS/Linux Node binary probe in `scripts/omp-private-restore.sh` (`~/.nvm/versions/node/*/bin/node`, `~/.fnm/node-versions/*/installation/bin/node`, `~/.volta/bin/node`, `~/.local/share/mise/installs/node/*/bin/node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `command -v node`).
4. **Step D (Verify):** Execute `test_office_suite.py`, `test_pmo_suite.py`, `test-omp-private-restore.sh`, and `test-omp-tools-venv-hydration.sh`.

## Success Criteria

- [ ] `office_cli.py --cmd to-md` extracts text from valid PDF files using pure-Python `pypdf` even when `pdftotext` is absent from PATH.
- [ ] `pmo-project-suite` uses `mpxj` CLI when available on non-Windows hosts or raises an actionable `.xml` conversion message.
- [ ] `omp-private-backup.sh --memory` skips ephemeral scratch `mnemopi` banks by default while preserving all real workspace banks.
- [ ] `omp-private-backup.sh --sessions` archives and restores OMP and Claude `.jsonl` transcripts cleanly inside the encrypted archive.
- [ ] `omp-private-restore.sh` on simulated Darwin locates `node` inside `nvm`/`fnm`/`volta`/`mise` paths when Homebrew `node` is absent.

## Risk Assessment

- **False-positive exclusion of real `mnemopi` banks:** Restrict default skip regex strictly to known ephemeral harness prefixes (`^omp-verify-`, `^scratch-cwd-`, `^ck-smoke-`, `^broken-`, `^demo-`, `^[abc]-[a-z0-9]{6,}$`) and log skipped bank count clearly to stdout so the user can override with `--include-scratch-banks`.
- **Image-only scanned PDFs:** Pure-Python `pypdf` returns empty text on scanned PDFs; return structured diagnostic advising OCR / `ai-multimodal` rather than silent empty output.
