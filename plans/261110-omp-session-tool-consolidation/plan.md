---
title: "OMP Ecosystem V2: 3-Tier Consolidation, Native Priority-100 Hub, Multi-Source Harvester & Cross-OS Backup/Restore"
description: "V2 consensus plan: multi-source harvester (107 OMP + 274 Claude + history.db + 149 dirs), 3-tier curation into OMP-native config/omp/agent/skills (Priority 100) + agents + commands, full parity/bug fixes for PMO & Office suites, Email & Maintenance suites, and Windows/macOS cross-OS backup/restore."
status: in-progress
priority: P1
effort: "20h"
branch: main
tags: [omp, claude, session-harvesting, native-skills, cross-platform, backup-restore, macos, windows, pmo, office-suite, email-intel, system-maintenance]
blockedBy: []
blocks: []
created: 2026-11-10
updated: 2026-11-10
---

# OMP Ecosystem V2 Consolidation & Cross-OS Backup Plan

> **Consensus Basis:** `plans/reports/261110-omp-ecosystem-v2-brainstorm.md` (5 user-approved decisions: `tiered_curated`, `omp_native_hub`, `promote_copy_keep_local`, `upgrade_and_fix_all`, `two_tier_portable_claude`).

## Architectural Invariants
1. **OMP Native Priority-100 Layout:** Core consolidated suites & Tier A promoted skills live in `config/omp/agent/skills/` (Priority 100); Tier B heavy kits live in `config/omp/agent/skills-optin/` (`hide: true` / `skills.customDirectories`); `managed-skills/` remains reserved for `autolearn` skills (de-hardcoded); all specialist agents live in `config/omp/agent/agents/*.md` with `autoloadSkills` (because OMP ignores `.claude/agents`).
2. **Keep Local Copies Untouched + Dereference on Backup:** Promote canonical Tier A/B assets into `zuey-pi-setup` -> `~/.omp/agent/` without altering project `.omp`/`.claude` folders on `D:`. Backup runs `cp -rL` and verifies zero symlinks/junctions and zero `C:/Users`/`D:/` hardcoded paths in staged public assets.
3. **Cross-OS Pure-Python First + Windows COM Optional:** `.xlsx`, `.docx`, `.xml`, `.eml`/`.msg`, spatial PDF/table parsing, and cleanup dispatch run in pure Python 3 inside `~/.omp/tools-venv` on Windows and macOS; Windows COM (`MSProject.Application`, `Outlook.Application`) and `WizTree64.exe` act solely as optional local accelerators.
4. **Dual-Mode CLI Contract:** Every suite CLI provides both a human TTY numbered menu (no flags) and deterministic JSON agent flags (`--cmd <op> ... --json`).
5. **Strict Two-Tier Security Boundary:** Public Git (`config/omp/`, `backups/omp-setup-portable.tar.gz`) contains ZERO `.db*`, zero tokens/secrets, zero machine paths, zero internal customer identifiers. Private GPG archive (`omp-private-backup.sh --all`) lives outside git, encrypting all `mnemopi` banks, `history.db`, and path-templated `~/.claude/` + `~/.claude.json` `mcpServers`.
6. **Multi-Session Continuity:** `plans/omp-consolidation-ledger.json` + `config/harvest-workspaces.json` drive idempotent `--next` loops across sessions.

## Phases Overview (Dependency-Ordered V2)

| Phase | Name | Scope & Deliverables | Priority | Status |
|:---:|---|---|:---:|:---:|
| **1** | [Multi-Source Harvester & `.omp`/`.claude` Global Diff Engine](./phase-02-session-workspace-harvester-cli.md) | Upgrade `scripts/omp-session-harvester.py` (OMP + Claude `.jsonl` + `history.db` + `edit` + multi-`eval` + `.omp`/`.claude`/`.agent` diff + `--next`) & `config/harvest-workspaces.json` | P1 | In Progress |
| **2** | [Backup Pipeline, Recursive Deref, Tier A/B Promotion & Cross-OS Hydration](./phase-01-backup-pipeline-agent-hydration-upgrades.md) | `.gitattributes`, upgrade `omp-setup-{backup,restore}.sh`, `omp-private-{backup,restore}.sh` (`--claude` path templating, Windows `tar`/`sqlite3`/`gpg`/`tasklist`), `omp-sync-upstream.sh` BSD `mktemp`, promote Tier A/B non-suite assets, `tools-requirements.txt` & `tools-venv` tests | P1 | Pending |
| **3** | [PMO Project Suite Relocation, Full Parity & Bug Fixes](./phase-03-pmo-project-management-suite-standardization.md) | Relocate & upgrade `config/omp/agent/skills/pmo-project-suite/`, install 4 `pmo-*.md` agents & `pmo-delivery` command, port 6 missing `pmi_pmo` modules + `pmo.py` 7-stage CI/CD + `project-excel-sync` profiles/sprints, fix all verified bugs | P1 | Pending |
| **4** | [Office Document Suite Relocation, Full Parity & Bug Fixes](./phase-04-office-document-processing-suite-standardization.md) | Relocate & upgrade `config/omp/agent/skills/office-doc-suite/`, add `to-md`/VSDX/DrawIO/`jsdom` Mermaid SSR/spatial BBox enrichment/KPI alerts, fix all verified bugs | P2 | Pending |
| **5** | [Email Intelligence, System Maintenance & Harvester Skill Packaging](./phase-05-email-intelligence-system-maintenance-suites.md) | Build `config/omp/agent/skills/email-intelligence-suite/`, `system-maintenance-suite/`, and `omp-session-harvester/` with unit tests | P2 | Pending |
| **6** | [Cross-OS E2E Validation, Live `~/.omp` Sync & Ledger Seal](./phase-06-cross-os-end-to-end-validation-ledger-finalization.md) | Sync live `~/.omp`, rebuild `config/omp/` & portable tarball, pass all bash & Python suites (Windows + simulated Darwin), audit leaks, seal ledger & push | P1 | Pending |
