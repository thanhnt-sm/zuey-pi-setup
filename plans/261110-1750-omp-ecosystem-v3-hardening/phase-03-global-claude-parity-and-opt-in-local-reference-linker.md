---
phase: 3
title: "Global Claude Parity and Opt-In Local Reference Linker"
status: pending
priority: P1
effort: "3.5h"
dependencies: [1]
---

# Phase 3: Global Claude Parity and Opt-In Local Reference Linker

## Overview

Port the 18 missing global `~/.claude/agents/`, 6 rules, 4 workflow docs/commands, and domain PM/BA `pre-write` rules/guards into OMP-native Priority-100 layout (`config/omp/agent/`) so fresh `omp-setup-restore.sh` installs work without Tier-2 `--claude`, and implement a manifest-driven opt-in local reference linker (`scripts/omp-link-local.py`) separating project overrides from linkable shared mirrors.

## Requirements

- **Functional:**
  1. Read-only export from `~/.claude/agents/*.md` (18 agents: `Explore`, `brainstormer`, `code-reviewer`, `code-simplifier`, `council-adjudicator`, `council-expert`, `debugger`, `docs-manager`, `fullstack-developer`, `git-manager`, `journal-writer`, `mcp-manager`, `orchestrator`, `planner`, `project-manager`, `researcher`, `tester`, `ui-ux-designer`) into `config/omp/agent/agents/*.md` without modifying `~/.claude/`. Upgrade `convert_claude_agent_to_omp()`: map `opus`->`@slow`, `sonnet`->`@default`, `haiku`->`@smol`, `inherit`->omit `model:`; map `tools:` (`Read->read`, `Grep->grep`, `Glob->glob`, `Bash->bash`, `Edit->edit`, `Write->write`, `WebSearch->web_search`, `Agent(*)->task`, `AskUserQuestion->ask`) while dropping Claude-only tools (`WebFetch`, `SendMessage`, `NotebookEdit`, `Skill`, `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`, `mcp__typesafe__*`); rename `skills:`->`autoloadSkills:`; strip unsupported frontmatter keys (`memory:`, `omitClaudeMd:`, `maxTurns:`, `disallowedTools:`); sanitize hardcoded user paths in agent bodies (such as `mcp-manager.md` & `planner.md` `~/.claude/...` references); preserve existing `advisor.md` / `ck-advisor.md` untouched.
  2. Read-only export of the 6 global `~/.claude/rules/*.md` (`development-rules.md`, `documentation-management.md`, `orchestration-protocol.md`, `primary-workflow.md`, `skill-domain-routing.md`, `skill-workflow-routing.md`) into `config/omp/agent/rules/`, adapting Claude-specific hook/plugin names (`Agent(...)`, `ai-gate-audit`, `~/.claude/logs/ai-gates/`) to OMP native equivalents (`task`, `advisor`, `modelRoles`).
  3. Convert `~/.claude/workflows/` patterns (`README.md`, `council.js`, `parallel-phases.js`, `red-team.js`, `scout-fanout.js`) into concise OMP slash-command markdown guides under `config/omp/agent/commands/` (`/ck-council`, `/ck-parallel`, `/ck-red-team`, `/ck-scout-fanout`) referencing OMP native `task` / `eval` primitives.
  4. Port PM/BA pre-write IO-mapping & KPI-state protection logic (`pre-write-io-mapping-check.cjs`, `pre-write-kpi-state-check.cjs`) as an opt-in guard module inside `omp-toolkit-hub` or `pm-ba` rules + `config/omp/agent/hooks/` without interfering with unrelated repos.
  5. Add workspace classification schema (`workspaceClassification`: `override`, `shared_mirror`, `archive`) to `~/.omp/harvest-workspaces.local.json` (template documented in `config/harvest-workspaces.json`) and create `scripts/omp-link-local.py` (+ thin bash wrapper) supporting `--plan`, `--apply`, and `--verify`: restricts Windows `mklink /J` strictly to pure-subset directories (`<proj>/.omp/skills/<name>`, or `<proj>/.omp/{agents,rules}` containing only global files) and uses hash-verified copy sync (never cross-volume `mklink /H` hardlinks or privileged file symlinks) for mixed directories or cross-volume individual `.md` files; never modifies `override` repos (`omp_extension/.omp`, `<project-override>/.claude`, etc.) or global `~/.claude/` and never commits symlinks to git.
- **Non-Functional:**
  - Dry-run (`--plan`) is default for `omp-link-local.py`; `--apply` requires explicit flag and automatically snapshots target before replacing with a link.
  - All ported agents/rules must pass leak, symlink, and absolute-path checks in `omp-setup-backup.sh`.

## Related Files

- Create/Update: `config/omp/agent/agents/*.md` (18 ported Claude core agents)
- Create: `config/omp/agent/rules/*.md` (6 ported Claude core rules)
- Create: `config/omp/agent/commands/ck-{council,parallel,red-team,scout-fanout}.md`
- Create: `scripts/omp-link-local.py`
- Modify: `config/harvest-workspaces.json` (document `workspaceClassification` schema with empty portable default)
- Create: `tests/test-omp-local-linker.sh`
- Modify: `tests/test-omp-agents-backup.sh`

## Implementation Steps

1. **Step A (Tests First):** Write `tests/test-omp-local-linker.sh` testing `--plan` (zero FS writes), `--apply` creating junction/symlink from mock project `.omp/skills/<name>` -> mock global `~/.omp/agent/skills/<name>`, refusal to overwrite an unclassified or `override` directory, automatic backup before linking, and `--verify` confirming valid targets. Extend `tests/test-omp-agents-backup.sh` to validate all ported core `agents/*.md` frontmatter (`tools:` lowercase, no Claude-only `SendMessage`/`WebFetch` tools, no raw workstation paths).
2. **Step B (Core Agent/Rule/Command Port):** Write a deterministic converter or perform clean conversion of the 18 `~/.claude/agents/*.md` and 6 `~/.claude/rules/*.md` into `config/omp/agent/{agents,rules}/`, plus the 4 `/ck-*` workflow commands under `config/omp/agent/commands/`. Add PM/BA pre-write guard documentation and hook reference.
3. **Step C (Opt-In Local Linker CLI):** Implement `scripts/omp-link-local.py` (`<=200` lines; dual-mode `--json` + human summary) reading `workspaceClassification` from `~/.omp/harvest-workspaces.local.json`, promoting any missing unique asset first (refusing `--apply` if local contains unpromoted files not yet in global), backing up replaced mirrors to `~/.omp/restore-backups/local-links/`, and creating Windows junctions via `cmd /c mklink /J` or POSIX symlinks via `os.symlink`.
4. **Step D (Verify):** Run `tests/test-omp-local-linker.sh` and `tests/test-omp-agents-backup.sh`. Run `python scripts/omp-link-local.py --plan --json` read-only on local workstation config to verify accurate classification (`override` vs `shared_mirror`).

## Success Criteria

- [ ] All 18 core Claude agents, 6 rules, and 4 workflow commands are present in `config/omp/agent/` with valid OMP frontmatter and zero hardcoded user paths.
- [ ] `tests/test-omp-agents-backup.sh` passes schema and leak assertions across all ported agents, rules, and commands.
- [ ] `scripts/omp-link-local.py --plan` makes zero filesystem mutations and classifies `override` workspaces separately from `shared_mirror` targets.
- [ ] `scripts/omp-link-local.py --apply` refuses to delete unpromoted local assets and creates verified junctions/symlinks pointing to `~/.omp/agent/`.

## Risk Assessment

- **Windows cross-volume & mixed-directory linking (`C:` vs `D:`):** Cross-volume NTFS hardlinks (`mklink /H`) fail with `EXDEV` (`WinError 17`) and file symlinks require elevation (`WinError 1314`), while whole-directory `mklink /J` clobbers mixed local+shared directories. `omp-link-local.py` MUST restrict `mklink /J` to pure-subset directories and use hash-verified copy sync for mixed dirs or cross-volume `.md` files.
- **Name collisions with `pmo-*` / `hlk-*` / `advisor.md`:** Never overwrite existing `advisor.md`, `ck-advisor.md`, `pmo-*.md`, or `hlk-*.md` in `config/omp/agent/agents/`.
