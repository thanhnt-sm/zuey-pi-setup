# Phase 1: Backup Pipeline & Agent Hydration Upgrades

## Overview
Expand the public portable backup (`scripts/omp-setup-backup.sh`), restore script (`scripts/omp-setup-restore.sh`), and private encrypted backup (`scripts/omp-private-backup.sh` / `scripts/omp-private-restore.sh`) to ensure complete asset parity across Windows and macOS workstations.

## Requirements
- **Functional Requirements:**
  1. `omp-setup-backup.sh` must include `~/.omp/agent/agents/*.md` into `config/omp/agent/agents/` and tarball.
  2. `omp-setup-backup.sh` must include `~/.omp/agent/skills/` (if non-empty) and `~/.omp/agent/managed-skills/` including all code files (`scripts/`, `references/`, `tests/`), dereferencing symlinks.
  3. `omp-setup-backup.sh` must generate `config/omp/agent/tools-requirements.txt` listing standard dependencies for harvested tools (`openpyxl`, `python-docx`, `defusedxml`, `extract-msg`, `markdown`).
  4. `omp-setup-restore.sh` must detect whether `~/.omp/tools-venv` exists. If missing, it creates the venv (via `uv venv` or `python3 -m venv`) and installs `tools-requirements.txt` unless `--no-install` is specified.
  5. `omp-private-backup.sh` must accept `--claude` (or default with `--all`) to snapshot `~/.claude/` (skills, agents, hooks, workflows, settings sanitized) into the GPG archive.
  6. `omp-private-restore.sh` must restore `~/.claude/` components cleanly.
- **Non-Functional Requirements:**
  - Zero SQLite leaks into public repo.
  - Zero proprietary project names or internal company domain names in public portable archives.
  - Full backward compatibility with existing test suites (`test-omp-migration.sh`, `test-omp-private-restore.sh`).

## Related Code Files
- **Modify:** `scripts/omp-setup-backup.sh`
- **Modify:** `scripts/omp-setup-restore.sh`
- **Modify:** `scripts/omp-private-backup.sh`
- **Modify:** `scripts/omp-private-restore.sh`
- **Create:** `config/omp/agent/tools-requirements.txt`
- **Create:** `tests/test-omp-tools-venv-hydration.sh`
- **Create:** `tests/test-omp-agents-backup.sh`

## Implementation Steps
1. **Update `scripts/omp-setup-backup.sh`:**
   - Add extraction of `"$SOURCE_DIR/agent/agents"` to `"$STAGE_DIR/agent/agents"`.
   - Add extraction of `"$SOURCE_DIR/agent/skills"` and `"$SOURCE_DIR/agent/managed-skills"` with `cp -rL` to resolve symlinks.
   - Bundle `config/omp/agent/tools-requirements.txt` into tarball under `agent/tools-requirements.txt`.
2. **Update `scripts/omp-setup-restore.sh`:**
   - Add directory creation for `~/.omp/agent/agents` and copy agent markdown files.
   - Add tool venv creation step:
     ```bash
     if [ "$INSTALL_DEPS" = true ] && [ -f "$TARGET_DIR/agent/tools-requirements.txt" ]; then
       VENV_DIR="$TARGET_DIR/tools-venv"
       if [ ! -d "$VENV_DIR" ]; then
         echo "--> Provisioning Python tool environment: $VENV_DIR"
         python3 -m venv "$VENV_DIR" || python -m venv "$VENV_DIR"
       fi
       PYTHON_EXE="$VENV_DIR/bin/python"
       [ -f "$PYTHON_EXE" ] || PYTHON_EXE="$VENV_DIR/Scripts/python.exe"
       if [ -f "$PYTHON_EXE" ]; then
         echo "--> Hydrating tool dependencies via $PYTHON_EXE"
         "$PYTHON_EXE" -m pip install -r "$TARGET_DIR/agent/tools-requirements.txt"
       else
         echo "Warning: Python executable not found in $VENV_DIR" >&2
       fi
     fi
     ```
3. **Update `scripts/omp-private-backup.sh` and restore script:**
   - Add `--claude` flag to back up `~/.claude` (excluding `.venv/`, `cache/`, `logs/`).
   - Add restore handling for Claude ecosystem directory.
4. **Create Verification Tests:**
   - `tests/test-omp-tools-venv-hydration.sh`: Asserts venv creation and requirements hydration under `--target-dir`.
   - `tests/test-omp-agents-backup.sh`: Asserts agent `.md` files exist in backup output and are restored intact.

## Success Criteria
- [ ] `tests/test-omp-agents-backup.sh` exits `0`.
- [ ] `tests/test-omp-tools-venv-hydration.sh` exits `0`.
- [ ] `"$VENV_DIR/bin/python"` or `"$VENV_DIR/Scripts/python.exe"` can execute `-c "import openpyxl, docx, defusedxml, extract_msg"`.
- [ ] `tests/test-omp-migration.sh` and `tests/test-omp-private-restore.sh` continue to pass with `0` failures.
- [ ] `tar -tzf backups/omp-setup-portable.tar.gz` shows `agent/agents/` and `agent/tools-requirements.txt`.
