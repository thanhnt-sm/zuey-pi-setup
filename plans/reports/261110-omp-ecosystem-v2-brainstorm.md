---
title: "OMP Ecosystem V2 Consensus Architecture: 3-Tier Curation, Native Priority-100 Hub, Multi-Source Harvester & Cross-OS Backup/Restore"
date: 2026-11-10
status: consensus-agreed
scope: zuey-pi-setup
supersedes: plans/reports/261110-omp-session-tool-consolidation-brainstorm.md
decisions:
  curation_scope: tiered_curated
  omp_architecture: omp_native_hub
  link_policy: promote_copy_keep_local
  draft_and_harvester: upgrade_and_fix_all
  private_scope: two_tier_portable_claude
---

# Consensus Design Report: OMP Ecosystem V2 Consolidation & Cross-OS Portability

## 1. Problem Statement & Verified Workstation Ground Truth

Repeated script authoring (`.xlsx`, `.docx`, `.mpp`/`.xml`, WBS/CPM/EVM/PERT, Daily Note RAID, `.eml`/`.msg` parsing, Windows/macOS cleanup) and scattered `.omp`/`.claude`/`.agent` customizations across projects caused duplication, drift, and non-portable Windows NTFS junctions.

### Verified Workstation Inventory (2026-11-10 Audit)
| Surface | Verified Count / State | Critical Findings |
|---|---|---|
| OMP Sessions (`~/.omp/agent/sessions/`) | **107** `.jsonl` across **19** dirs (**43** top, **13** subagent, **51** `__advisor.jsonl`) | Harvester overwrote multiple `eval` blocks via `eval_<lang>`, ignored `edit` calls & non-`EOF` heredocs, miscounted `__advisor` in ledger |
| Claude Sessions (`~/.claude/projects/` + `history.jsonl`) | **274** `.jsonl` across **10** dirs (**40** top, **232** subagent, **2** workflow) + **127** `history.jsonl` rows | **100% omitted** by current `omp-session-harvester.py` |
| OMP SQLite Stores | `history.db`: **1,422** prompts (**42** `cwd`), **751** titles, **429** recaps; `memories/mnemopi/banks/`: **69** banks | `history.db` omitted by harvester; `mnemopi` docs claimed 22 banks; `config/harvest-workspaces.json` absent |
| Global `~/.omp/agent/` | **10** `managed-skills`, **2** `agents` (`advisor.md`, `ck-advisor.md`), **1** TS shim (`typesafe-planner.ts` -> `~/Projects/omp_extension`), **3** npm plugins | **Zero** `agent/skills/` (priority 100), `commands/`, `hooks/`, `tools/`, `rules/`, `tools-requirements.txt`; 4 `pmo-*.md` agents absent |
| Global `~/.claude/` (`claudekit-custom v2.17.0-custom.14`) | **95** skill dirs (incl. **3** NTFS junctions -> `D:\...`), **19** agents, **5** JS workflows, **34** hooks, **6** rules, `mcp/typesafe/` | OMP ignores `.claude/agents/` (`omp://task-agent-discovery.md:161`); `settings.json` & `~/.claude.json` hardcode Windows `node.exe` paths |
| Project `.omp`/`.claude`/`.agent` | **149** folders across `C:` & `D:` | Mix of high-value custom modules (`pm-ba`, `pmo-*`, `windows_fix`, `hlk-*`, `pm-email`, `ak-render` v2, `team-coordination-rules.md`), heavy domain kits (`claudekit-marketing`, `Ruflo/08_Bot`, `rtk`), old clones, and 27+ test scratches |
| Untracked Drafts (`config/managed-skills/`) | `pmo-project-suite/`, `office-doc-suite/` | Placed outside `config/omp/` (never backed up), placed in priority-5 `managed-skills/`, missing modules & containing verified runtime bugs |

---

## 2. Evaluated Approaches & Agreed Decisions

| Dimension | Evaluated Options | Chosen Option | Rationale (KISS / YAGNI / DRY) |
|---|---|---|---|
| **1. Asset Scope across 149 dirs** | A) 3-Tier Curated<br>B) 5 Core Suites Only<br>C) Mirror All ~250+ Skills | **A (`tiered_curated`)** | Prevents system prompt token explosion & name collisions while capturing every high-value custom asset |
| **2. OMP Packaging Model** | A) OMP Native Priority 100 (`skills/` + `agents/` + `commands/` + `tools-venv`)<br>B) Single Local OMP Plugin (`package.json#omp`)<br>C) Keep `managed-skills/` (Priority 5) | **A (`omp_native_hub`)** | Author-owned skills at `~/.omp/agent/skills/` resolve at **priority 100** (never shadowed by `~/.claude/skills/` priority 80); reserves `managed-skills/` strictly for OMP `autolearn`; avoids unnecessary MCP daemons |
| **3. Link / Reference Policy** | A) Promote to Global Canonical Hub + Keep Project Copies Untouched + `cp -rL` on backup<br>B) Replace project folders with NTFS symlinks | **A (`promote_copy_keep_local`)** | OMP loads `~/.omp/agent/{skills,agents}` everywhere automatically; project symlinks break on Windows without Admin/Dev Mode and pollute git |
| **4. Drafts & Harvester Scope** | A) Relocate, upgrade full parity, fix all bugs, expand harvester<br>B) Patch critical bugs only | **A (`upgrade_and_fix_all`)** | Fixes `RAID` column shift, `PercentComplete=1 -> 100%`, `kpi_tracker` `"TP (Điểm task)"` & `--month`, `doc_converter` codeblock, spatial BBox PDF, 6 missing `pmi_pmo` modules, and `.claude`/`history.db` harvesting |
| **5. Security & Private Sync** | A) Clean Public Git + Expanded GPG `--all` (69 `mnemopi` + `history.db` + path-templated `~/.claude/`)<br>B) Narrow `--typesafe-kit` only | **A (`two_tier_portable_claude`)** | Enables true zero-manual-setup Mac/Windows parity while keeping public repo 100% free of DBs, tokens, and customer identifiers |

---

## 3. Target Architecture & 3-Tier Curation Matrix

### 3.1 Canonical Layout in `zuey-pi-setup` & Restored `~/.omp`
```text
zuey-pi-setup (Public Repo — Zero .db / Zero Secrets / Zero Customer IDs)
├── config/
│   ├── harvest-workspaces.json                 # Curated scan roots + excluded clone/scratch patterns
│   ├── omp/
│   │   ├── plugins/package.json                # npm plugins (no cross-OS lockfiles)
│   │   └── agent/
│   │       ├── config.yml                      # {{SHELL_PATH}} templated + skills.customDirectories for Tier B
│   │       ├── models.yml                      # !printenv <PROVIDER>_API_KEY
│   │       ├── .env.example                    # Keys only
│   │       ├── commandcode-models.json
│   │       ├── typesafe.json
│   │       ├── tools-requirements.txt          # Pure-Python cross-OS deps (openpyxl, python-docx, defusedxml, extract-msg, markdown)
│   │       ├── agents/                         # OMP-discovered agents (advisor, ck-advisor, pmo-{ba,planner,reporter,red-team}, promoted core roles)
│   │       ├── skills/                         # Priority 100 native skills (5 consolidated suites + Tier A promoted skills)
│   │       ├── skills-optin/                   # Tier B packs (hide: true / customDirectories opt-in)
│   │       ├── commands/                       # Promoted slash commands / flows (pm-email, hlk-loop, project-delivery, eval workpool templates)
│   │       ├── rules/                          # Shared OMP rules (incl. team-coordination-rules.md)
│   │       ├── extensions/                     # Dereferenced full tree (recursive import copy, incl. tools/jev-paired-*)
│   │       └── managed-skills/                 # Reserved for existing autolearn managed skills (de-hardcoded paths)
│   └── omp-upstream/                           # Upstream overlay (APPEND_SYSTEM.md, compaction-policy.ts, pi-footer*)
├── scripts/
│   ├── omp-session-harvester.py                # Multi-source (OMP + Claude + history.db + workspaces + .omp/.claude/.agent diff)
│   ├── omp-setup-backup.sh                     # Tier 1 snapshot (cp -rL, recursive ext deref, secret/path/DB hard gates)
│   ├── omp-setup-restore.sh                    # Tier 1 restore (Win/macOS shellPath, tools-venv auto-hydration, CRLF/chmod)
│   ├── omp-private-backup.sh                   # Tier 2 GPG (69 mnemopi + history.db + sanitized-path ~/.claude/ + ~/.claude.json mcpServers)
│   └── omp-private-restore.sh                  # Tier 2 GPG restore (macOS M1 GPG_TTY/pinentry + Win Gpg4win/tasklist + path rewrite)
└── plans/
    ├── omp-consolidation-ledger.json           # Multi-session state machine (HARVESTED -> PROMOTED -> STANDARDIZED -> TESTED -> VERIFIED)
    └── 261110-omp-session-tool-consolidation/  # Phased implementation specs
```

### 3.2 3-Tier Curation Classification Across 149 Discovered Folders
| Tier | Classification | Discovered Assets Included | Target Surface & Activation |
|---|---|---|---|
| **Tier A** | Core Daily Toolkits & Unique Project Promotions | **5 Suites**: `pmo-project-suite`, `office-doc-suite`, `email-intelligence-suite`, `system-maintenance-suite`, `omp-session-harvester`<br>**Promoted Skills/Agents/Flows**: `pm-ba` (+ rules `pm-ba-workflow.md`, `file-type-enforcement.md`), `windows_fix`, `ak-render` (167L v2), `pmo-{ba,planner,red-team,reporter}.md`, `hlk-{loop,metric,handoff,commit-msg}` + `hlk-*` agents/commands, `pm-email.md`, `team-coordination-rules.md`, `flows/project-delivery.md` -> OMP commands/`eval` templates | `config/omp/agent/skills/` (Priority 100), `agents/`, `commands/`, `rules/` -> Always available cleanly across Windows & macOS |
| **Tier B** | Heavy / Specialized Domain Kits | `claudekit-marketing` (~70 unique skills, `ckm` commands), Ruflo (`39` skills, `21` commands), `rtk` (Rust skills/rules), `NanoResearch` (`9` research commands, `OpenHarness`), local `.agent` pack (`gstack-*`, `er-diagram-builder`, `superantigravity`), `bmad` | `config/omp/agent/skills-optin/` with `hide: true` (manual `/skill:<name>` or `skill://<name>`) OR opt-in `skills.customDirectories` — **0 system-prompt bloat** |
| **Tier C** | Redundant Clones, Legacy & Scratch | 6 duplicate `claudekit-engineer` clones, legacy v1 bash CK dirs, `27` `ck-selftest-proj-*`, `14` `.claude-custom-backups`, `250+` `omp_extension_backup_*` | Registered in `config/harvest-workspaces.json` `exclude` list; **never promoted or scanned repeatedly** |

---

## 4. Risk Predictions (`ck:predict`) & Edge-Case Matrix (`ck:scenario`)

### 4.1 `ck:predict` Verdict: **GO WITH STRICT GATES**
- **Architect**: Moving authored toolkits out of `managed-skills/` (prio 5) to `agent/skills/` (prio 100) + porting `.claude/agents` / `.omp/agents` to `agent/agents/*.md` resolves OMP discovery blind spots cleanly without an MCP daemon.
- **Security**: Hard-fail gates required in `omp-setup-backup.sh` for: (1) `*.db*` files, (2) token/key regexes, (3) leaked machine paths (`C:/Users/`, `D:/`), (4) internal company identifiers (`privateKeywords` / `OMP_SENSITIVE_TERMS`). Tier 2 `--claude` backup must strip `.credentials.json`, `.logs/`, `cache/`, `.venv/`, `node_modules/`.
- **Performance**: `hide: true` / `skills-optin/` protects token budget across 250+ non-daily skills; `tools-venv` caches compiled wheels once per machine.
- **UX**: Dual-mode CLI contract (`human numbered menu` when TTY w/o flags vs `--cmd <op> --json` for agents) + automatic `venv_bootstrap.py` resolving `~/.omp/tools-venv` (`Scripts/python.exe` on Windows, `bin/python` on macOS/Linux).
- **Devil's Advocate**: Eliminates brittle per-project symlinks entirely (`promote_copy_keep_local` + `cp -rL` materialization).

### 4.2 Top Critical & High Scenarios (`ck:scenario`)
| Severity | Scenario | Required Guard / Fix |
|---|---|---|
| **Critical** | Recursive extension imports (`typesafe-planner/src/evaluation-host.ts` importing `../tools/jev-paired-*`) dropped by 1-hop `deref_extension_shim` | Recursive relative-import graph traversal (or `.sync-manifest.json`-driven bundle copy) + `tsc`/syntax check on staged extension |
| **Critical** | Windows NTFS junctions (`email-intelligence-pipeline`, `md-convert`, `pmi-pmo-framework`) copied as broken symlinks or stubs | `cp -rL` across `skills/`, `managed-skills/`, `extensions/`, `agents/`, `rules/` + post-stage symlink detector (`find -type l` -> abort) |
| **Critical** | Windows Git Bash `tar -czf C:\...` drive-colon error & native `sqlite3.exe /tmp/...` path failure | Normalize paths via `cygpath -u` (for `tar`) / `--force-local` and `cygpath -m` (for `sqlite3`/`bun`/`node`), add Python `sqlite3.backup()` fallback |
| **Critical** | Restored `~/.claude/settings.json` & `~/.claude.json` break macOS hooks/MCP due to `<USER_HOME>/.claude/runtime/node/node.exe` | Template `{{CLAUDE_NODE}}` & `{{USER_HOME}}` on private backup; substitute `$(command -v node)` & `$USER_HOME` + `chmod +x` on restore |
| **Critical** | `omp.exe` running during Windows private restore causes WAL-locked DB corruption (`pgrep` missing on Git Bash) | Fallback to `tasklist` / PowerShell `Get-Process` when `pgrep` is absent |
| **High** | Drafted `pmo-project-suite` & `office-doc-suite` runtime bugs (`RAID` col index, `PercentComplete=1 -> 100%`, `TP` column mismatch, `--month` fallback, `doc_converter` codeblock, hardcoded A4-L split) | Complete rewrite/patch of affected adapters + full regression tests against sanitized real fixtures |
| **High** | Cross-session loop stalls or re-scans scratch dirs | `plans/omp-consolidation-ledger.json` tracks per-item state (`HARVESTED` -> `PROMOTED` -> `STANDARDIZED` -> `TESTED` -> `PACKAGED` -> `VERIFIED_E2E`), exposing `--next` & `--verify-ledger` |

---

## 5. Multi-Session Continuity Engine (`plans/omp-consolidation-ledger.json`)

To execute across multiple loops and sessions without losing state or repeating work:
1. **`config/harvest-workspaces.json`** stores canonical scan roots and explicit exclusions (Tier C clones/backups/scratches).
2. **`scripts/omp-session-harvester.py`** updates `plans/omp-consolidation-ledger.json` idempotently across OMP sessions (`~/.omp/agent/sessions`), Claude sessions (`~/.claude/projects`), `history.db`, and workspace `.omp`/`.claude`/`.agent` trees.
3. **Resumable Work Queue (`--next`):** Every new session starts by querying the ledger for the highest-priority incomplete phase/suite/promoted asset, executes strictly that unit, runs its automated tests, updates status only after observed pass, and commits cleanly before continuing.

---

## 6. Success Metrics & Next Steps
1. **100% Asset Coverage:** Every Tier A skill, agent (`advisor`, `ck-advisor`, `pmo-*`, promoted specialists), flow/command, rule, dereferenced extension, and `tools-requirements.txt` tracked in `config/omp/` & `backups/omp-setup-portable.tar.gz`; Tier B safely isolated in `skills-optin/`; Tier 2 GPG archive includes all 69 `mnemopi` banks, `history.db`, and portable `~/.claude/`.
2. **Zero Regressions / Zero Leaks:** All existing tests (`test-omp-migration.sh`, `test-omp-private-restore.sh`, `test-omp-syncignore.sh`, `test-omp-sync-extraction.sh`, `test-omp-session-harvester.sh`) + new cross-OS E2E, `tools-venv` hydration, skills integrity, and anchored leak-scan suites pass `100%`.
3. **Next Step (awaiting user approval):** Update `plans/261110-omp-session-tool-consolidation/plan.md` & phase files to V2 architecture (`config/omp/agent/skills/`, recursive extension deref, Tier A/B/C promotion, full suite bug fixes, cross-OS private `~/.claude` templating) and execute phase-by-phase.
