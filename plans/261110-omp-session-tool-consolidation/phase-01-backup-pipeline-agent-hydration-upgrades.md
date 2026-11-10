---
phase: 2
title: "Backup Pipeline, Recursive Deref, Tier A/B Promotion & Cross-OS Hydration"
status: pending
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Backup Pipeline, Recursive Deref, Tier A/B Promotion & Cross-OS Hydration

## Overview
Upgrade `omp-setup-backup.sh`, `omp-setup-restore.sh`, `omp-private-backup.sh`, `omp-private-restore.sh`, and `omp-sync-upstream.sh` for full Windows + macOS cross-OS parity, promote curated Tier A/B non-suite assets into `config/omp/agent/`, and verify with automated bash tests.

## Requirements
- **Functional:**
  1. Add `.gitattributes` enforcing LF line endings for `*.sh`, `*.yml`, `*.example`, `*.py`, `*.ts`, `*.md`, `*.json`.
  2. Upgrade `scripts/omp-setup-backup.sh`:
     - Recursive relative-import closure in `deref_extension_shim()` (fixes missed `../tools/jev-paired-*` imported by `src/evaluation-host.ts`).
     - Stage & `cp -rL` dereference `agent/skills/`, `agent/skills-optin/`, `agent/agents/`, `agent/commands/`, `agent/rules/`, `agent/hooks/`, `agent/tools/`, `agent/managed-skills/`, `agent/typesafe.json`, `agent/tools-requirements.txt`, excluding `__pycache__/`, `*.pyc`, `.venv/`, `node_modules/`.
     - Enforce hard-fail gates for leftover symlinks (`find -type l`), SQLite `*.db*`, secrets, and hardcoded `C:/Users/`/`D:/` paths inside portable skill/agent/extension code.
     - Normalize `-o` Windows drive colons via `cygpath -u` / `--force-local` before `tar`.
  3. Upgrade `scripts/omp-setup-restore.sh`:
     - Restore all new `agent/` subdirectories cleanly; escape `TARGET_SHELL` safely in `sed` (`&`, `|`, `\`).
     - Strip `\r` on restored `.sh`/`.env*` and `chmod +x` executable scripts.
     - Auto-create & hydrate `~/.omp/tools-venv` from `agent/tools-requirements.txt` (skipping Microsoft Store `WindowsApps` stub; supporting `uv venv` or `python3`/`python -m venv`, disabled only with `--no-install`).
     - Probe `~/.bun/bin/bun` & `/opt/homebrew/bin` for macOS plugin install.
  4. Upgrade `scripts/omp-private-backup.sh` & `scripts/omp-private-restore.sh`:
     - Add `--claude` (included in `--all`) capturing `~/.claude/` (excluding `runtime/`, `.logs/`, `cache/`, `.venv/`, `node_modules/`, `.credentials.json`, `backups/`, `shell-snapshots/`, `file-history/`, `session-env/`, `paste-cache/`, `projects/`) and `~/.claude.json` `.mcpServers`!
     - Template `C:/Users/<user>/.claude/runtime/node/node.exe` -> `{{CLAUDE_NODE}}` and `$USER_HOME` -> `{{USER_HOME}}` on backup; rewrite dynamically to target OS `node` + `$USER_HOME` + `chmod +x` on restore.
     - Fix Windows `sqlite3` path via `native_path` + Python `sqlite3.backup()` fallback; fix `tty` stdout `"not a tty"` bug; add Windows `tasklist`/PowerShell `omp` stop-check when `pgrep` is absent; handle Windows Gpg4win `GNUPGHOME` + `--pinentry-mode loopback`.
  5. Fix `scripts/omp-sync-upstream.sh` macOS BSD `mktemp` `.json` template suffix.
  6. Promote Tier A non-suite assets (`pm-ba` + rules, `windows_fix`, `ak-render` v2, `hlk-*`, `pm-email`, `team-coordination-rules.md`, existing `advisor.md`/`ck-advisor.md`), de-hardcode `windows-cleanup-pipeline`/`wiztree-cli-analyzer` `SKILL.md` paths, and package Tier B opt-in skills (`hide: true` in `skills-optin/` + `config.yml` `skills.customDirectories`).
- **Non-Functional:**
  - Zero changes to existing project `.omp`/`.claude` dirs on `D:`.
  - Backward compatibility with existing migration, syncignore, sync-extraction, and private-restore tests.

## Related Code Files
- Create: `.gitattributes`, `config/omp/agent/tools-requirements.txt`, `tests/test-omp-agents-backup.sh`, `tests/test-omp-tools-venv-hydration.sh`
- Create/Populate: `config/omp/agent/{skills,skills-optin,agents,commands,rules}/`
- Modify: `scripts/omp-setup-backup.sh`, `scripts/omp-setup-restore.sh`, `scripts/omp-private-backup.sh`, `scripts/omp-private-restore.sh`, `scripts/omp-sync-upstream.sh`, `config/omp/agent/config.yml`, `config/omp/agent/managed-skills/{windows-cleanup-pipeline,wiztree-cli-analyzer}/SKILL.md`

## Implementation Steps
1. Create `.gitattributes` and `config/omp/agent/tools-requirements.txt` (`openpyxl`, `python-docx`, `defusedxml`, `extract-msg`, `markdown`).
2. Promote curated Tier A/B non-suite assets into `config/omp/agent/` and de-hardcode existing `managed-skills` paths.
3. Upgrade all 4 backup/restore scripts + `omp-sync-upstream.sh` BSD `mktemp`.
4. Add `tests/test-omp-agents-backup.sh` and `tests/test-omp-tools-venv-hydration.sh` and extend `test-omp-migration.sh` & `test-omp-private-restore.sh` (without weakening existing assertions).

## Success Criteria
- [ ] `tests/test-omp-migration.sh`, `tests/test-omp-private-restore.sh`, `tests/test-omp-agents-backup.sh`, and `tests/test-omp-tools-venv-hydration.sh` exit 0.
- [ ] Public staging rejects symlinks, `.db*`, tokens, and `C:/Users/`/`D:/` paths inside skills/extensions.
- [ ] Private GPG `--all` backup + restore rewrites Windows `node.exe` paths cleanly under simulated macOS `OS_OVERRIDE=Darwin`.
