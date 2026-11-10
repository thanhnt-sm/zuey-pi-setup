---
phase: 5
title: "Email Intelligence, System Maintenance & Harvester Skill Packaging"
status: pending
priority: P2
effort: "3.5h"
dependencies: [2]
---

# Phase 5: Email Intelligence, System Maintenance & Harvester Skill Packaging

## Overview
Build and package the remaining 3 OMP-native Priority-100 skills under `config/omp/agent/skills/`:
1. `email-intelligence-suite` (portable dual-source `.eml`/`.msg` + optional Windows Outlook COM, 4-tier thread clustering, SHA-256 deduplication, issue extraction, profile system, Markdown/Excel reports).
2. `system-maintenance-suite` (cross-OS cleanup orchestrator unifying Windows `.ps1`/WizTree + macOS `.sh`/quarantine + 9-step AI tool deep-uninstaller generator with strict `--dry-run` safety).
3. `omp-session-harvester` skill pack (`SKILL.md` + `scripts/` wrapper around `scripts/omp-session-harvester.py` + multi-session `--next` continuation guide).

## Related Code Files
- Create: `config/omp/agent/skills/email-intelligence-suite/{SKILL.md,scripts/{venv_bootstrap.py,email_parser.py,email_cli.py},tests/test_email_suite.py}`
- Create: `config/omp/agent/skills/system-maintenance-suite/{SKILL.md,scripts/{cleaner_dispatcher.py,uninstaller_builder.py,maintenance_cli.py},tests/test_maintenance_suite.py}`
- Create: `config/omp/agent/skills/omp-session-harvester/{SKILL.md,scripts/harvest_cli.py}`

## Implementation Steps
1. Port & sanitize `email-intelligence-pipeline` core into `email_parser.py` & `email_cli.py` (no hardcoded `D:\...` junction or internal emails).
2. Unify `CleanPC` Windows/macOS cleaners + `ai-tool-uninstaller-builder` into `cleaner_dispatcher.py`, `uninstaller_builder.py`, and `maintenance_cli.py` (`--dry-run` default; deletion requires interactive confirmation or `--force`).
3. Create `omp-session-harvester` skill wrapper & author unit tests for Email & Maintenance suites.

## Success Criteria
- [ ] `test_email_suite.py` and `test_maintenance_suite.py` exit 0 on Git Bash / Python 3.
- [ ] Zero files deleted by `maintenance_cli.py` in `--dry-run` or without explicit confirmation/`--force`.
- [ ] Zero absolute `D:/` paths or customer identifiers inside any packaged skill.
