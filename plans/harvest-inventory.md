# OMP Harvest Inventory & Deduplication Report

- **Generated:** 2026-11-10 14:16:05 UTC
- **OMP Sessions Scanned:** 68 (44 top, 24 subagents; 63 advisors skipped, 0 advisors included)
- **Claude Sessions Scanned:** 274 (40 top, 234 subagents/journals; 127 history.jsonl entries)
- **Incremental Skips (Unchanged Watermarks):** 0
- **Total Candidate Artifacts Indexed:** 2858
- **Unique Code Hashes:** 2361

## 1. Summary by Target Suite

| Target Suite | Extracted Artifacts | Target OMP Priority-100 Location |
|---|---:|---|
| **`general_utilities`** | 2276 | Triaged (Tier A promoted / Tier B opt-in / Tier C excluded) |
| **`pmo_project_suite`** | 383 | `config/omp/agent/skills/pmo-project-suite` |
| **`system_maintenance_suite`** | 115 | `config/omp/agent/skills/system-maintenance-suite` |
| **`office_doc_suite`** | 62 | `config/omp/agent/skills/office-doc-suite` |
| **`email_intelligence_suite`** | 22 | `config/omp/agent/skills/email-intelligence-suite` |

## 2. Top Duplicated Code Clusters (Repeated Utilities)

Found **483** duplicate code clusters across scanned sessions and workspaces:

| Hash | Occurrences | Suite | Sample Targets / Snippet Preview |
|---|---:|---|---|
| `de141a5181b7` | **4** | `general_utilities` | `eval_py_21_de141a51, eval_py_22_de141a51, eval_py_23_de141a51`<br>*import subprocess, sys  res = subprocess.run([sys.executable, "-X", "utf8", "tests/simulate_60_days.py"], capture_output* |
| `9da2ce48e07c` | **4** | `general_utilities` | `<local-workspace>/typesafe-judgments.md#edit25, <local-workspace>/red-team-workflow.md#edit27, <local-workspace>/typesafe-judgments.md#edit28`<br>*        "instructions": "Does the text in plan_context describe the failure scenario named in finding?",         "criter* |
| `b72f850f075d` | **3** | `general_utilities` | `eval_py_99_b72f850f, eval_py_104_b72f850f, eval_py_106_b72f850f`<br>*import subprocess, sys  cmd = [sys.executable, "-m", "coverage", "run", "--source=parse_notes,notes_to_tracker,pmo", "-m* |
| `f0b6a635de3e` | **3** | `pmo_project_suite` | `config/omp/agent/skills/pmo-project-suite/scripts/venv_bootstrap.py, config/omp/agent/skills/office-doc-suite/scripts/venv_bootstrap.py, config/omp/agent/skills/email-intelligence-suite/scripts/venv_bootstrap.py`<br>*""" venv_bootstrap.py — Attach ~/.omp/tools-venv site-packages onto sys.path if present. """  from __future__ import ann* |
| `3790bfac522f` | **3** | `general_utilities` | `<local-workspace>/apply-source-edits.js#edit1, <local-workspace>/apply-source-edits.js#edit4`<br>*    after: 'import { createStackNavigator } from "@react-navigation/stack";\n',   },   {     // Business bug fix, not SD* |
| `e71d5ceb5512` | **3** | `general_utilities` | `<local-workspace>/apply-source-edits.js#edit2, <local-workspace>/apply-source-edits.js#edit5`<br>*const ROUTER = path.join('src', 'Screens', 'router.js'); const FOLDER_DEFAULT = path.join('src', 'Screens', 'Folder', 'D* |
| `cf210c8f47d4` | **3** | `general_utilities` | `<local-workspace>/apply-source-edits.js#edit3, <local-workspace>/apply-source-edits.js#edit6`<br>* * (never the SVN source). Files touched: src/Screens/router.js, babel.config.js, tsconfig.json, plus two  * one-line bu* |
| `b88ccd17c0ea` | **3** | `general_utilities` | `<local-workspace>/self-test.js#edit7, <local-workspace>/self-test.js#edit10, <local-workspace>/self-test.js#edit4`<br>*  for (const e of EDITS) byFile.set(e.file, (byFile.get(e.file) \|\| '') + 'unrelated line\n' + e.before);   // [PROJECT_C* |
| `a5fee82bee3c` | **3** | `general_utilities` | `<local-workspace>/self-test.js#edit8, <local-workspace>/self-test.js#edit11, <local-workspace>/self-test.js#edit5`<br>*const { EDITS } = require('./apply-source-edits.js'); const UC_FILE = path.join('src', 'Screens', 'UserControls', '[PROJ* |
| `6d091fa11881` | **3** | `general_utilities` | `<local-workspace>/self-test.js#edit9, <local-workspace>/self-test.js#edit12, <local-workspace>/self-test.js#edit6`<br>*  assert.ok(applied[2].includes('"strict": false'));   // the two business fixes: document picker takes assets[0], camer* |
| `1917c795f72a` | **3** | `general_utilities` | `<local-workspace>/self-test.js#edit13, <local-workspace>/self-test.js#edit14, <local-workspace>/self-test.js#edit7`<br>*test('apply-source-edits: camera fix is not mistaken as applied by the correctly spelled library picker condition', () =* |
| `172cf496e3ba` | **3** | `general_utilities` | `<local-workspace>/sync-svn-runtime-go.sh#edit15, <local-workspace>/sync-svn-runtime-go.sh#edit16, <local-workspace>/sync-svn-runtime-go.sh#edit8`<br>*# (DocumentUC.tsx, DropDownBoxSearch.tsx: chỉnh cho React Native 0.88, xem expo-go-compat/apply-source-edits.js. #  Fold* |
| `448b4b4ff28d` | **2** | `general_utilities` | `eval_py_7_448b4b4f, eval_py_13_448b4b4f`<br>*import subprocess, sys  res = subprocess.run([sys.executable, "-X", "utf8", "-m", "unittest", "discover", "-s", "tests",* |
| `84579660838a` | **2** | `general_utilities` | `eval_py_75_84579660, eval_py_95_84579660`<br>*import subprocess, sys  cmd = [sys.executable, "-m", "coverage", "run", "--source=parse_notes,notes_to_tracker,pmo", "-m* |
| `f87f113aafac` | **2** | `system_maintenance_suite` | `<local-workspace>/06_cleanup_ai_tools.ps1`<br>*# ============================================ # AI TOOLS CACHE CLEANUP MODULE # =======================================* |
| `1347721f0fa9` | **2** | `system_maintenance_suite` | `<local-workspace>/09_cleanup_dism_updates.ps1`<br>*# ============================================ # WINDOWS COMPONENT STORE & DISM CLEANUP MODULE # =======================* |
| `9fa441c4b4d6` | **2** | `general_utilities` | `scan_stale.ps1, <local-workspace>/scan_stale.ps1`<br>*$paths = @('<local-workspace>/101.AI', '~/Documents', '~/source') $targets = @('.venv', 'venv', '__pycache__', 'node_mod* |
| `4c5de1577c81` | **2** | `general_utilities` | `scan_stale2.ps1, <local-workspace>/scan_stale2.ps1`<br>*$paths = @('<local-workspace>/101.AI', '~/Documents', '~/source') $targets = @('.venv', 'venv', '__pycache__', 'node_mod* |
| `2e5b1702e691` | **2** | `general_utilities` | `check_c.ps1, <local-workspace>/check_c.ps1`<br>*$files = @("<local-workspace>/hiberfil.sys", "<local-workspace>/pagefile.sys", "<local-workspace>/swapfile.sys") Get-Ite* |
| `a54df94a2059` | **2** | `general_utilities` | `check_c2.ps1, <local-workspace>/check_c2.ps1`<br>*$files = @("<local-workspace>/hiberfil.sys", "<local-workspace>/pagefile.sys", "<local-workspace>/swapfile.sys") Get-Ite* |

## 3. Global vs Project `.omp`/`.claude`/`.agent` Delta Summary

- **Project Config Dirs Scanned (Tier C excluded):** 84
- **Dirs with Unpromoted Assets / Links:** 18
- **Container-level Links Detected:** 1

| Project Config Dir | Missing from Global OMP | Links/Junctions |
|---|---|---|
| `<local-workspace>/.Backup_Tool/.claude` | skills:1 | - |
| `<local-workspace>/PM_PhanTich/.claude` | skills:1 | - |
| `<local-workspace>/104_PM_PhanTich/.claude` | skills:1 | - |
| `<local-workspace>/claudekit-marketing/.claude` | skills:50, agents:19, commands:1 | - |
| `<local-workspace>/eco_support_net_oracle/.omp` | - | 1 |
| `<local-workspace>/OutlookOkan/.claude` | commands:1 | - |
| `<local-workspace>/OutlookOkan/.agent` | skills:39, agents:14, rules:1 | - |
| `<local-workspace>/NanoResearch-main/.claude` | commands:9 | - |
| `<local-workspace>/OpenHarness/.claude` | skills:2 | - |
| `<local-workspace>/TMP_Source/.agent` | skills:35, agents:9, rules:20 | - |
| `<local-workspace>/08_Bot/.claude` | skills:37, agents:23, commands:21 | - |
| `<local-workspace>/01_Setup_HOME/.claude` | skills:3 | - |
| `<local-workspace>/01_Setup_HOME/.agent` | skills:12, agents:15, rules:11 | - |
| `<local-workspace>/10_DesignDatabase_Code_To_Relation_Key_Mermaid/.agent` | skills:39, agents:9, rules:20 | - |
| `<local-workspace>/02_Emails_Export/.claude` | - | 1 |
| `<local-workspace>/rtk/.claude` | skills:11, agents:4, commands:7, rules:3 | - |
| `<local-workspace>/CleanPC/.claude` | skills:2 | - |
| `<local-workspace>/Windows_change_device_keepDATA/.agent` | skills:31, agents:9, rules:10 | - |

## 4. Recommended Consolidation Actions

1. **PMO Project Suite (`pmo-project-suite`):** Priority-100 skill + 4 `pmo-*.md` agents + `pmo-delivery` command.
2. **Office Document Suite (`office-doc-suite`):** Priority-100 skill unifying MD<->DOCX, Mermaid SSR, XLSX, KPI & spatial extractors.
3. **Email Intelligence Suite (`email-intelligence-suite`):** Cross-OS `.eml`/`.msg` + optional Outlook COM parser & issue extractor.
4. **System Maintenance Suite (`system-maintenance-suite`):** Unified Windows `.ps1` + macOS `.sh` cleaners & uninstaller builder.
