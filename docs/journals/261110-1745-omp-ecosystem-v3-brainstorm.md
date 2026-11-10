---
title: "OMP Ecosystem V3 Brainstorm & Deep Audit Journal"
date: 2026-11-10
context: "Post-V2 dirty-tree audit, multi-scout workstation inventory, and user architectural consensus for V3 hardening"
---

# Technical Journal: OMP Ecosystem V3 Brainstorm & Audit

## What Happened
- Executed parallel read-only audit across the dirty `zuey-pi-setup` working tree, `omp v18.18.6` runtime discovery, existing 5 consolidated suites, and all configured local workstation roots.
- Verified live workstation inventory: `129` OMP `.jsonl` (`44` top, `23` subagent, `62` advisor), `274` Claude `.jsonl`, `1,426` `history.db` prompts across `489` sessions, `69` `mnemopi` banks (`~20` scratch test banks), and `~74` distinct local `.omp`/`.claude` folders (`5` junctions + `1` TS shim).
- Identified critical cutover seams in the current dirty V2 state: `config/harvest-workspaces.json` was sanitized to `~/.omp/harvest-workspaces.local.json`, but neither `omp-session-harvester.py` nor `omp-promote-assets.py` reads the local override yet; `_PRIV_PAT` in `omp-promote-assets.py` is uncalled; `omp-session-harvester` skill breaks outside the repo; harvester drops full code after 200 chars and ignores `lastHarvestTimestamp`; `office-doc-suite` needs pure-Python PDF for macOS.

## Consensus Decisions Recorded
- **Local Sync Policy:** `manifest_optin_link` — single canonical truth in `~/.omp/agent/` + opt-in manifest linker for shared local mirrors; `cp -rL` materialization on Git/tarball backup.
- **OMP Architecture:** `hybrid_skills_plus_thin_ext` — keep Priority-100 Skills (`tools-venv` dual-mode Python CLIs) + Agents (`autoloadSkills`), plus 1 thin OMP extension (`extensions/omp-toolkit-hub.ts`) for `/harvest-loop` and `session_compact` checkpointing; no redundant MCP daemon.
- **Scope Restraint:** Focus strictly on repairing V2 leaks/contracts, pure-Python PDF + `.mpp` macOS guidance, porting global `~/.claude` core agents/rules/workflows/PM-BA guards to OMP, and cleaning test `mnemopi` banks + optional `--sessions` private archive — deliberately excluding bulk-porting 200+ foreign RuFlo/BMAD/APEX/marketing kit commands/agents.
- **Loop Continuity:** `incremental_watermark_registry` — per-file watermarks, `promotedHashes`, `--extract <hash>`, and automatic `DRIFT_DETECTED` reopening.

## Next
- Present V3 consensus report (`plans/reports/261110-1745-omp-ecosystem-v3-brainstorm.md`) and ask user whether to create the detailed V3 implementation plan (`/ck:plan`) and stabilize/commit the dirty V2 baseline first.
