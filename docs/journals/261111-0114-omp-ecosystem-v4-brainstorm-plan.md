---
title: "OMP Ecosystem V4 Brainstorm & Plan Journal"
date: 2026-11-11
context: "Live workstation audit against V3 baseline, V4 architecture brainstorm consensus, and 5-phase implementation plan creation"
---

# Technical Journal: OMP Ecosystem V4 Brainstorm & Plan

## What Happened
- Audited live workstation state (`~/.omp/agent/`, `~/.claude/`, `omp v18.18.6` native docs, `omp-harvester-cache.json`) against V3 deliverables (`plans/reports/261110-omp-ecosystem-v3-final-audit.md`).
- Identified 5 concrete V3->V4 gaps:
  1. The 4 domain suites (`office-doc`, `pmo-project`, `email-intelligence`, `system-maintenance`) remained passive `SKILL.md` + Python CLIs while `omp-toolkit-hub.ts` registered only 2 harvester tools.
  2. `1,758` of `1,896` harvester clusters (`2,243` / `2,858` artifacts) sat in `general_utilities` with `>90%` ephemeral noise (`1,019` `#edit` hunks, `596` TypeSafe internal edits, `478` test/runner snippets) and `promotedHashes: 0`.
  3. `workspaceClassification.shared_mirror` was empty `[]`, leaving `16` project `.claude`/`.agent` directories unlinked/untriaged (`CleanPC`, `OutlookOkan/.agent`, `TMP_Source/.agent`, `08_Bot/.claude`, `rtk/.claude`, `claudekit-marketing/.claude`, `NanoResearch-main/.claude`, etc.).
  4. `mcp.json` did not exist natively in `~/.omp/agent/`, relying on `~/.claude.json` via Tier-2 GPG restore; no single 2-stage bootstrap + health doctor command existed.
  5. `/harvest-loop` stored checkpoints without a domain-filtered promotion queue or two-phase `staged -> promoted` gates.

## Consensus Decisions Locked
- **`hybrid_ext_skill`**: Keep Python/Bun CLIs inside `skills/<suite>/scripts/` + expose 5 grouped native OMP tools (`omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest`) in `omp-toolkit-hub.ts` resolving `~/.omp/tools-venv` cross-OS.
- **`triage_promote_link_to_global`**: Triage the 16 project delta dirs into custom Priority-100 (`CleanPC` v2.6 into `system-maintenance-suite`), opt-in (`skills-optin` `hide: true`), or `override`/`archive`, linking Project -> Global via `omp-link-local.py`.
- **`split_public_private_bootstrap`**: Preserve Public/Private separation; add `mcp.json.example`, cross-OS `mcp.json` path rehydration in `omp-private-restore.sh`, and unified `omp-bootstrap.{sh,ps1}` + `omp-doctor.py`.
- **`filtered_queue_loop`**: Pre-filter `#edit`/test/scratchpad noise and drive resumable multi-round consolidation queues.

## Outputs & Next
- Design report: `plans/reports/261110-2208-omp-ecosystem-v4-architecture-brainstorm.md`
- 5-phase plan: `plans/261111-0114-omp-ecosystem-v4-plugin-loop-sync/plan.md`
- Next step: Execute `/ck:cook` against `D:\100.Software\Github\zuey-pi-setup\plans\261111-0114-omp-ecosystem-v4-plugin-loop-sync\plan.md` (starting Phase 1).
