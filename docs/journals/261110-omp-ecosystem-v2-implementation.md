---
title: "OMP Ecosystem V2 Implementation, Migration & Cross-OS Validation Journal"
date: 2026-11-10
context: "Execution of 6-phase V2 consolidation plan across harvester, backup/restore scripts, Priority-100 suites, and live sync"
---

# Technical Journal: OMP Ecosystem V2 Implementation & Validation

## What Happened
- Upgraded `scripts/omp-session-harvester.py` to scan OMP + Claude transcripts, `history.db`, and curated `.omp`/`.claude`/`.agent` directories via `config/harvest-workspaces.json`.
- Built `scripts/omp-promote-assets.py` to promote and sanitize Tier A skills/agents/commands/rules (`config/omp/agent/`) and 132 non-colliding `hide: true` Tier B skills (`config/omp/agent/skills-optin/`).
- Relocated and upgraded `pmo-project-suite` and `office-doc-suite` into Priority-100 `config/omp/agent/skills/`, fixed all audited runtime/schema bugs, added missing `pmi_pmo`/`pmo.py`/`project-excel-sync`/`md-convert`/`kpi`/spatial BBox modules, and built `email-intelligence-suite`, `system-maintenance-suite`, and `omp-session-harvester`.
- Hardened `omp-setup-backup.sh` (Node/Bun fast recursive extension deref keeping `src/` + imported `tools/jev-paired-*.ts`, `cp -rL`, symlink/DB/secret gates), `omp-setup-restore.sh` (`tools-venv` auto-hydration, safe `sed`, CRLF/chmod), `omp-private-{backup,restore}.sh` (`--claude` with `{{CLAUDE_NODE}}`/`{{USER_HOME}}` cross-OS templating, `to_gpg_path()` for MSYS2 vs Gpg4win, Python `shutil.copytree` pre-exclusion of `.venv`/marketplaces), and `omp-sync-upstream.sh` (macOS BSD `mktemp`).

## Verification & Bugs Caught During Execution
- Caught and resolved MSYS2 `cygpath -u` vs `cygpath -w` mismatch for `gpg --output`/`GNUPGHOME` (`to_gpg_path()`).
- Caught and fixed `pipefail` SIGPIPE on `echo "$TAR_LIST" | grep -q` in E2E test (`tar.list` file check).
- Caught and fixed `nodeRequire` uppercase `R` + `import(` / `new URL(` matching in recursive extension deref so `src/evaluation-host.ts`, `*.d.cts`, and `tools/jev-paired-*.ts` all pack cleanly without pulling test harnesses.
- Verified all 9 bash suites, 18 Python unittests, live `~/.omp/tools-venv` hydration, portable tarball rebuild, and live `--all` GPG + Darwin restore smoke.
