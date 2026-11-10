---
title: "OMP Ecosystem V2 Brainstorm & Workstation Audit Journal"
date: 2026-11-10
context: "ck:brainstorm + ck:team/scout + ck:predict + ck:scenario + ck:problem-solving consensus"
---

# Technical Journal: OMP Ecosystem V2 Architecture Consensus

## Context
Re-evaluated the entire workstation (`.omp`, `.claude`, `.agent` directories and session stores) before continuing implementation so that consolidation covers 100% of active tooling without prompt bloat, symlink fragility, or cross-OS breakage.

## What Happened
- Dispatched 3 parallel read-only `scout` subagents (`ScoutGlobalAndProjects`, `ScoutSessionsAndBackup`, `ScoutDraftsAndExistingSuites`) plus a deterministic Python reparse-point scan across `C:` and `D:`.
- Verified exact ground truth: **107** OMP `.jsonl` (`43` top, `13` subagent, `51` `__advisor`), **274** Claude `.jsonl` + **127** `history.jsonl` entries, `history.db` (**1,422** prompts across **42** cwds, **429** recaps), **69** `mnemopi.db` banks, **149** project `.omp`/`.claude`/`.agent` dirs, and **3** global NTFS junctions in `~/.claude/skills/`.
- Audited prior untracked drafts (`config/managed-skills/{pmo-project-suite,office-doc-suite}`), `omp-session-harvester.py`, and all 4 backup/restore scripts against OMP runtime docs (`omp://skills.md`, `omp://task-agent-discovery.md`, `omp://plugin-manager-installer-plumbing.md`).

## Key Decisions (User-Confirmed)
1. **3-Tier Curation (`tiered_curated`)**: Tier A promoted to active global; Tier B (`claudekit-marketing`, `Ruflo/08_Bot`, `rtk`, `NanoResearch`, `SuperAntigravity`) isolated in `skills-optin/` with `hide: true`; Tier C old CK clones & scratches excluded via `config/harvest-workspaces.json`.
2. **OMP Native Priority 100 (`omp_native_hub`)**: Author-owned suites live in `config/omp/agent/skills/` (Priority 100) rather than `managed-skills/` (Priority 5); specialist agents move to `config/omp/agent/agents/*.md` with `autoloadSkills`; multi-step flows become `commands/` + `eval` templates.
3. **Promote & Keep Local (`promote_copy_keep_local`)**: Promote canonical copies into `zuey-pi-setup` -> `~/.omp/agent/` cleanly; leave project `.omp`/`.claude` folders untouched; materialize all junctions/symlinks via `cp -rL` during backup.
4. **Full Parity & Bug Fixes (`upgrade_and_fix_all`)**: Upgrade harvester (OMP + Claude + `history.db` + `edit` + multi-`eval`) and fix all verified bugs/missing modules across PMO & Office suites.
5. **Two-Tier Portable Private Sync (`two_tier_portable_claude`)**: Keep public git strictly free of DBs/secrets/machine paths; expand `omp-private-backup.sh --all` with full sanitized `~/.claude/` + path templating (`{{CLAUDE_NODE}}`, `{{USER_HOME}}`) for zero-friction macOS/Windows restore.

## Next
Execute V2 6-phase plan in `plans/261110-omp-session-tool-consolidation/plan.md` starting immediately with Phase 1 (Harvester V2 + `config/harvest-workspaces.json`).
