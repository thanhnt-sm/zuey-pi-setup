---
title: "OMP Ecosystem V5 Auto-Routing Signal Sieve Headless Loop and Cross-OS Parity"
description: "Final self-contained V5 plan: ship verified V4 baseline and protect omp_extension source, fix harvester signal sieve & self-scan filters, add bounded headless multi-round loop runner, promote remaining net-new Excel-diff/CleanPC/Email utilities, enforce OMP-first & Claude Code routing rules, and harden macOS/scheduled sync parity."
status: pending
priority: P1
effort: "14h"
branch: main
tags: [omp, v5, auto-routing, harvester-sieve, headless-loop, cross-os, claude-parity, tdd, release]
blockedBy: []
blocks: []
supersedes: 261111-0114-omp-ecosystem-v4-plugin-loop-sync
created: 2026-11-11
---

# OMP Ecosystem V5 Auto-Routing Signal Sieve Headless Loop and Cross-OS Parity

## Overview

Final master implementation plan synthesized from `plans/reports/261111-1046-omp-ecosystem-v5-architecture-brainstorm.md`. Closes every verified gap after V4 (`plans/reports/261111-omp-ecosystem-v4-final-audit.md`) so subsequent sessions only need `/ck:cook --auto --tdd` to reach complete cross-OS, cross-client (`OMP` + `Claude Code`), and bounded multi-round loop automation without opening new plans:

1. **Stream 0 (Phase 1):** Commit & push the verified V4 working tree (`backups/omp-setup-portable.tar.gz`, `config/omp/`, `scripts/`, `tests/`, `docs/`, `plans/`), capture a fresh GPG `--all` backup, initialize `git` + optional `--include-dev-repos` archive parity for external extension source (`~/Projects/omp_extension`), and eliminate live `~/.omp/agent/` split-brain (`mcp.json` + `config/omp-upstream/`).
2. **Stream 1 (Phases 2–3):** Fix `harvester_core.py` (`skills-optin` in `g_skills`, `workspaceClassification` filter in `scan_global_diff`, repo self-scan exclusion eliminating phantom `dev_ops_automation`, workspace script fallback in `extract_cluster`, signature dedup, and advisory file lock), add bounded headless loop driver `scripts/omp-harvest-loop-runner.sh`, and promote/reconcile remaining net-new utilities (`xlsx-diff` / MS Project dynamic JSON profile diff in `pmo-project-suite`, net-new AI/DISM/OMP session cleaners in `system-maintenance-suite`, and `email-intelligence-suite` parity).
3. **Stream 2 & 3 (Phase 4):** Replace dead `mcp__markitdown` / `/md-convert` instructions in `rules/` (`file-type-enforcement.md`, `skill-domain-routing.md`, `skill-workflow-routing.md`, `APPEND_SYSTEM.md`) with OMP-first (`omp_office`, `omp_pmo`, `omp_email`, `omp_maint`, `omp_harvest`) and shared `~/.omp/tools-venv` Claude CLI routing, add `--link-claude` in `omp-bootstrap.sh`, add Darwin/staleness diagnostics in `omp-doctor.py` + `omp-toolkit-hub.ts`, and provide opt-in OS sync schedule helpers (`omp-schedule-sync.{sh,ps1}`).
4. **Final Cutover (Phase 5):** Sync live `~/.omp/agent/` and `~/.claude/`, rebuild `config/omp/` & `backups/omp-setup-portable.tar.gz`, pass 100% of Bash/Bun/Python/Doctor suites, reconcile legacy plan tracking notes, write final V5 audit & journal, and push release to `origin/main` + final GPG backup.

## Cross-Plan Context

- Earlier plans (`20261003-omp-ecosystem-consolidation`, `261110-1750-omp-ecosystem-v3-hardening`, `261111-0114-omp-ecosystem-v4-plugin-loop-sync`) remain `status: pending` in YAML due to `typesafe-planner` plan-edit guard (`V3` & `V4` deliverables are verified complete in `plans/reports/261110-omp-ecosystem-v3-final-audit.md` and `plans/reports/261111-omp-ecosystem-v4-final-audit.md`). This V5 plan supersedes `261111-0114-omp-ecosystem-v4-plugin-loop-sync` as the single active execution roadmap.

## Architectural Invariants

1. **Public Repo Hygiene:** Tracked files in `zuey-pi-setup` (`config/`, `scripts/`, `plans/`, `docs/`, `tests/`, `backups/omp-setup-portable.tar.gz`) NEVER contain `.db*`, `.env`, API secrets, private client keywords, un-dereferenced symlinks, or raw machine drive/user paths.
2. **Rules-First + Zero Business-Logic Duplication:** Both OMP (`omp_*` tools in `omp-toolkit-hub.ts`) and Claude Code (`~/.claude` rules pointing to `~/.omp/tools-venv` + `*_cli.py --json`) invoke the exact same pure-Python suite cores.
3. **Sieve Before Headless Loop:** `harvester_core.py` filters repo self-scans, `skills-optin/`, and classified `override`/`archive` dirs before queueing batches; `omp-harvest-loop-runner.sh` never runs `--commit-stage` without passing `unittest` + `bun test` + `omp-doctor --strict`.
4. **Mirror-Sync Before `--config-dir` Backup:** `omp-setup-backup.sh --config-dir config/omp` wipes and mirrors `~/.omp/agent/`. Always sync repo edits under `config/omp/agent/` into live `~/.omp/agent/` BEFORE invoking `--config-dir` backup.
5. **Cross-OS Safety First:** Windows-only COM (`MSProject.Application`, `Outlook.Application`, DISM) must isolate behind OS checks and provide pure-Python cross-OS core functionality on macOS/Linux.
6. **External Host Isolation Invariants (Mandatory & Non-Negotiable):**
   - **Path Isolation:** All repo development, builds, tests, and tarball staging operate strictly within repository local paths (`config/omp/`, `scripts/`, `tests/`) or the isolated user home directory `~/.omp/`.
   - **Absolute Host Boundary & Zero Secret Access:** Zero modification, reading, or referencing of external host account settings or external AI assistant credentials (`.credentials.json` is strictly ignored and never staged). Tests run strictly against mock temp home directories (`--home "$TMP_HOME"`).
   - **Opt-in User-Explicit Sync Only:** `--link-claude` and `--include-dev-repos` require explicit user CLI flags, never run implicitly by default, and always snapshot existing target files to `~/.omp/restore-backups/` before writing.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [V4 Release Sync and Ext Repo Backup](./phase-01-v4-release-sync-and-ext-repo-backup.md) | Pending |
| 2 | [Harvester Signal Sieve and Headless Loop Runner](./phase-02-harvester-signal-sieve-and-headless-loop-runner.md) | Pending |
| 3 | [Queue Promotions Excel Diff CleanPC and Email Parity](./phase-03-queue-promotions-excel-diff-cleanpc-and-email-parity.md) | Pending |
| 4 | [OMP First Dual Client Routing Rules and Mac Parity](./phase-04-omp-first-dual-client-routing-rules-and-mac-parity.md) | Pending |
| 5 | [Full Cutover Tarball Rebuild and V5 Verification](./phase-05-full-cutover-tarball-rebuild-and-v5-verification.md) | Pending |

## Decision Summary (From V5 Consensus Brainstorm)

- `goal`: `v5_ship_plus_loop` (commit verified V4 first, then execute V5 end-to-end).
- `packaging` & `claude_parity_mode`: `hybrid_plus_rules` + `rules_and_shared_cli` (no extra MCP daemon bloat).
- `loop_mode` & `loop_strategy`: `semi_auto_headless` + `sieve_then_batch_loop` (filter self-scan/optin noise -> bounded `omp -p` batches).
- `sync_ops` & `constraints`: `commit_v4_plus_sync_and_ext_backup` + `macos_real_parity` + `claude_code_parity` + `unattended_sync` + `external_omp_extension`.

## Red Team Review

Conducted dual adversarial review via hostile reviewer personas (`V5PlanRedTeamArch`, `V5PlanRedTeamSec`):
- **Total Findings Evaluated:** 16 verified findings (8 architectural + 8 security failure modes, confidence `1.00`).
- **Accepted & Mitigated (16/16 - 100% incorporated into phase-01..05):**
  1. `phase-01 line 51`: corrected `omp-setup-restore.sh` parameter to use `--source-tar` flag.
  2. `harvester_core.py:1595`: added `TRIAGED_3_TIER` terminal check to prevent loop deadlock on `dev_ops_automation`.
  3. `tests/test-omp-session-harvester.sh:355`: scoped repo self-scan filter to absolute path of `zuey-pi-setup` root during `scan_workspaces()`, preserving transcript `dev_ops_automation` assertions.
  4. `harvester_core.py:1377`: enforced relative path sanitization for workspace extraction locations in `clusterIndex`.
  5. `omp-toolkit-hub.ts`: scheduled command handler extraction into `omp-toolkit-hub/hub-commands.ts` to strictly protect the 200-line TypeScript ceiling.
  6. `scripts/omp-doctor.py`: kept `rulesDrift` and `backupFreshness` checks advisory (warning-only) to prevent false `--strict` failures before Phase 5 tarball rebuild.
  7. `scripts/omp-setup-backup.sh:225`: mandated syncing `omp-doctor.py` into live `~/.omp/agent/tools/` before cutover backup.
  8. `pmo_cli.py:361`: explicitly added `--compare` and `--right` optional flags to `build_parser()`.
  9. `SEC-001` (Prompt Injection in Headless Loop): `phase-02` runner wraps extracted snippets in inert `<extracted-script>` XML boundaries with explicit negative instructions prohibiting prompt hijacking.
  10. `SEC-002` (Destructive Root `/tmp` Deletion): `phase-03` scopes POSIX `/tmp` cleanup strictly to application temporary folders (`/tmp/omp-*`, `/tmp/claude-*`, `/tmp/uv-*`), explicitly skipping active UNIX domain sockets (`S_ISSOCK`) and lockfiles.
  11. `SEC-003` (Junction Traversal in `cleaner_dispatcher.py`): `phase-03` checks Windows reparse tags/islink in `_delete_children_safely` and unlinks directory junctions with `os.rmdir()` rather than recursing with `shutil.rmtree()`.
  12. `SEC-004` (Tar Path Traversal in `omp-private-restore.sh`): `phase-01` verifies tar members prior to extraction, rejecting any path containing `..` or absolute leading slashes.
  13. `SEC-005` (Secret Leak in `--config-dir` Mirroring): `phase-01` and `phase-05` enforce strict export allowlists and entropy scanning before allowing git staging.
  14. `SEC-006` (Credential Leak in `--include-dev-repos`): `phase-01` strips remote token-bearing URLs from `.git/config` and prunes `.git/logs/` before archiving external repositories.
  15. `SEC-007` (Stale Build Artifact Purge Safety): `phase-03` enforces `--dry-run` inspection by default before any project dependency quarantine.
  16. `SEC-008` (Path Leak Detection in `omp-doctor.py`): `phase-04` expands `_check_repo_leaks` to detect double-escaped Windows paths (`C:\\\\Users\\\\`) and Windows UNC paths (`\\\\host\\\\share`).
## Validation Log

### Verification Results
- Claims checked: 32
- Verified: 32 | Failed: 0 | Unverified: 0
- Tier: Full
- Verified Paths:
  - Core Scripts: `scripts/omp-private-backup.sh`, `scripts/omp-private-restore.sh`, `scripts/omp-bootstrap.sh`, `scripts/omp-doctor.py`, `scripts/omp-setup-backup.sh`, `scripts/omp-setup-restore.sh`, `scripts/omp-link-local.py`, `config/omp/agent/tools/omp-doctor.py`
  - Extensions & MCP: `config/omp/agent/mcp.json.example`, `config/omp/agent/extensions/omp-toolkit-hub.ts`, `domain-tools.ts`, `loop-state.ts`
  - Suites & Tests: `harvester_core.py`, `project_sync.py`, `pmo_cli.py`, `test_pmo_suite.py`, `cleaner_dispatcher.py`, `maintenance_cli.py`, `test_maintenance_suite.py`, `email_parser.py`, `test_email_suite.py`
  - Rules & Docs: `file-type-enforcement.md`, `skill-domain-routing.md`, `skill-workflow-routing.md`, `APPEND_SYSTEM.md`, `test-omp-private-restore.sh`, `test-omp-session-harvester.sh`, `test-omp-toolkit-hub.test.ts`, `test-omp-e2e-cross-platform.sh`, `docs/omp-operations-guide.md`, `docs/omp-setup-migration.md`
- Failures: none (`Failed: 0` — safe for `/ck:cook --auto --tdd`).
