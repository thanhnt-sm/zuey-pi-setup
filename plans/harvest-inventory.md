# OMP Harvest Inventory & Deduplication Report

- **Generated:** 2026-11-10 09:14:50 UTC
- **OMP Sessions Scanned:** 63 (44 top, 19 subagents, 58 advisors skipped)
- **Claude Sessions Scanned:** 274 (40 top, 234 subagents/journals; 127 history.jsonl entries)
- **Total Candidate Artifacts Extracted:** 2809
- **Unique Code Hashes:** 2314

## 1. Summary by Target Suite

| Target Suite | Extracted Artifacts | Target OMP Priority-100 Location |
|---|---:|---|
| **`general_utilities`** | 2225 | Triaged (Tier A promoted / Tier B opt-in / Tier C excluded) |
| **`pmo_project_suite`** | 372 | `config/omp/agent/skills/pmo-project-suite` |
| **`system_maintenance_suite`** | 110 | `config/omp/agent/skills/system-maintenance-suite` |
| **`office_doc_suite`** | 54 | `config/omp/agent/skills/office-doc-suite` |
| **`email_intelligence_suite`** | 48 | `config/omp/agent/skills/email-intelligence-suite` |

## 2. Top Duplicated Code Clusters (Repeated Utilities)

Found **482** duplicate code clusters across scanned sessions and workspaces:

| Hash | Occurrences | Suite | Sample Targets / Snippet Preview |
|---|---:|---|---|
| `de141a5181b7` | **4** | `general_utilities` | `eval_py_21_de141a51, eval_py_22_de141a51, eval_py_23_de141a51`<br>*import subprocess, sys  res = subprocess.run([sys.executable, "-X", "utf8", "tests/simulate_60_days.py"], capture_output* |
| `9da2ce48e07c` | **4** | `general_utilities` | `<local-workspace>/references/typesafe-judgments.md#edit25, <local-workspace>/references/red-team-workflow.md#edit27, <local-workspace>/references/typesafe-judgments.md#edit28`<br>*        "instructions": "Does the text in plan_context describe the failure scenario named in finding?",         "criter* |
| `b72f850f075d` | **3** | `general_utilities` | `eval_py_99_b72f850f, eval_py_104_b72f850f, eval_py_106_b72f850f`<br>*import subprocess, sys  cmd = [sys.executable, "-m", "coverage", "run", "--source=parse_notes,notes_to_tracker,pmo", "-m* |
| `3790bfac522f` | **3** | `general_utilities` | `<local-workspace>/expo-go-compat/apply-source-edits.js#edit1, <local-workspace>/expo-go-compat/apply-source-edits.js#edit4`<br>*    after: 'import { createStackNavigator } from "@react-navigation/stack";\n',   },   {     // Business bug fix, not SD* |
| `e71d5ceb5512` | **3** | `general_utilities` | `<local-workspace>/expo-go-compat/apply-source-edits.js#edit2, <local-workspace>/expo-go-compat/apply-source-edits.js#edit5`<br>*const ROUTER = path.join('src', 'Screens', 'router.js'); const FOLDER_DEFAULT = path.join('src', 'Screens', 'Folder', 'D* |
| `cf210c8f47d4` | **3** | `general_utilities` | `<local-workspace>/expo-go-compat/apply-source-edits.js#edit3, <local-workspace>/expo-go-compat/apply-source-edits.js#edit6`<br>* * (never the SVN source). Files touched: src/Screens/router.js, babel.config.js, tsconfig.json, plus two  * one-line bu* |
| `b88ccd17c0ea` | **3** | `general_utilities` | `<local-workspace>/expo-go-compat/self-test.js#edit7, <local-workspace>/expo-go-compat/self-test.js#edit10, <local-workspace>/expo-go-compat/self-test.js#edit4`<br>*  for (const e of EDITS) byFile.set(e.file, (byFile.get(e.file) \|\| '') + 'unrelated line\n' + e.before);   // Collateral* |
| `a5fee82bee3c` | **3** | `general_utilities` | `<local-workspace>/expo-go-compat/self-test.js#edit8, <local-workspace>/expo-go-compat/self-test.js#edit11, <local-workspace>/expo-go-compat/self-test.js#edit5`<br>*const { EDITS } = require('./apply-source-edits.js'); const UC_FILE = path.join('src', 'Screens', 'UserControls', 'Colla* |
| `6d091fa11881` | **3** | `general_utilities` | `<local-workspace>/expo-go-compat/self-test.js#edit9, <local-workspace>/expo-go-compat/self-test.js#edit12, <local-workspace>/expo-go-compat/self-test.js#edit6`<br>*  assert.ok(applied[2].includes('"strict": false'));   // the two business fixes: document picker takes assets[0], camer* |
| `1917c795f72a` | **3** | `general_utilities` | `<local-workspace>/expo-go-compat/self-test.js#edit13, <local-workspace>/expo-go-compat/self-test.js#edit14, <local-workspace>/expo-go-compat/self-test.js#edit7`<br>*test('apply-source-edits: camera fix is not mistaken as applied by the correctly spelled library picker condition', () =* |
| `172cf496e3ba` | **3** | `general_utilities` | `<local-workspace>/99999_Mobile_Demo/sync-svn-runtime-go.sh#edit15, <local-workspace>/99999_Mobile_Demo/sync-svn-runtime-go.sh#edit16, <local-workspace>/99999_Mobile_Demo/sync-svn-runtime-go.sh#edit8`<br>*# (DocumentUC.tsx, DropDownBoxSearch.tsx: chỉnh cho React Native 0.88, xem expo-go-compat/apply-source-edits.js. #  Fold* |
| `448b4b4ff28d` | **2** | `general_utilities` | `eval_py_7_448b4b4f, eval_py_13_448b4b4f`<br>*import subprocess, sys  res = subprocess.run([sys.executable, "-X", "utf8", "-m", "unittest", "discover", "-s", "tests",* |
| `84579660838a` | **2** | `general_utilities` | `eval_py_75_84579660, eval_py_95_84579660`<br>*import subprocess, sys  cmd = [sys.executable, "-m", "coverage", "run", "--source=parse_notes,notes_to_tracker,pmo", "-m* |
| `f87f113aafac` | **2** | `system_maintenance_suite` | `<local-workspace>/CMD/06_cleanup_ai_tools.ps1`<br>*# ============================================ # AI TOOLS CACHE CLEANUP MODULE # =======================================* |
| `1347721f0fa9` | **2** | `system_maintenance_suite` | `<local-workspace>/CMD/09_cleanup_dism_updates.ps1`<br>*# ============================================ # WINDOWS COMPONENT STORE & DISM CLEANUP MODULE # =======================* |
| `9fa441c4b4d6` | **2** | `general_utilities` | `scan_stale.ps1, <local-workspace>/CleanPC/scan_stale.ps1`<br>*$paths = @('<local-workspace>/AI_Tools', '~/Documents', '~/source') $targets = @('.venv', 'venv', '__pycache__'* |
| `4c5de1577c81` | **2** | `general_utilities` | `scan_stale2.ps1, <local-workspace>/CleanPC/scan_stale2.ps1`<br>*$paths = @('<local-workspace>/AI_Tools', '~/Documents', '~/source') $targets = @('.venv', 'venv', '__pycache__'* |
| `2e5b1702e691` | **2** | `general_utilities` | `check_c.ps1, <local-workspace>/CleanPC/check_c.ps1`<br>*$files = @("<local-workspace>/C:/hiberfil.sys", "<local-workspace>/C:/pagefile.sys", "<local-workspace>/C:/swapfile.sys"* |
| `a54df94a2059` | **2** | `general_utilities` | `check_c2.ps1, <local-workspace>/CleanPC/check_c2.ps1`<br>*$files = @("<local-workspace>/C:/hiberfil.sys", "<local-workspace>/C:/pagefile.sys", "<local-workspace>/C:/swapfile.sys"* |
| `2167df76d0d4` | **2** | `system_maintenance_suite` | `<local-workspace>/CleanPC/01_Windows/CMD/12_cleanup_omp_sessions.ps1, <local-workspace>/CMD/12_cleanup_omp_sessions.ps1`<br>*# ============================================ # OH-MY-PI (OMP) AGENT SESSIONS & CACHE CLEANUP MODULE # ================* |

## 3. Global vs Project `.omp`/`.claude`/`.agent` Delta Summary

- **Project Config Dirs Scanned (Tier C excluded):** 77
- **Dirs with Unpromoted Assets / Links:** 28

| Project Config Dir | Missing from Global OMP | Links/Junctions |
|---|---|---|
| `~/Downloads/pmi-pmo-framework/.omp` | agents:4 | - |
| `~/Downloads/pmi-pmo-framework/.agents/skills/pmi-pmo-framework/.omp` | agents:4 | - |
| `~/Downloads/pmi-pmo-framework/.claude/skills/pmi-pmo-framework/.omp` | agents:4 | - |
| `~/Downloads/pmi-pmo-framework/.omp/skills/pmi-pmo-framework/.omp` | agents:4 | - |
| `~/Downloads/pmi-pmo-framework/evals/workspace/reuse-clone-final/pmi-pmo-framework/.omp` | agents:4 | - |
| `<local-workspace>/.Backup_Tool/.claude` | skills:2, agents:14, rules:3 | - |
| `<local-workspace>/_Tool/.claude` | skills:4, agents:5, commands:2 | - |
| `<local-workspace>/_ToolBackup/.claude` | skills:4, agents:5, commands:2 | - |
| `<local-workspace>/PM_PhanTich/.claude` | skills:2, agents:14, rules:3 | - |
| `<local-workspace>/104_PM_PhanTich/.claude` | skills:2, agents:14, rules:3 | - |
| `<local-workspace>/claudekit-marketing/.claude` | skills:50, agents:31, commands:1 | - |
| `<local-workspace>/[PROJECT_NET]/.omp` | rules:1 | - |
| `<local-workspace>/[PROJECT_MAIL]/.claude` | commands:2 | - |
| `<local-workspace>/[PROJECT_MAIL]/.agent` | skills:39, agents:16, rules:1 | - |
| `<local-workspace>/Loop_harness_claudekit_Apply/.claude` | skills:4, agents:5, commands:2 | - |
| `<local-workspace>/NanoResearch-main/.claude` | commands:9 | - |
| `<local-workspace>/OpenHarness/.claude` | skills:2 | - |
| `<local-workspace>/TMP_Source/.agent` | skills:35, agents:10, rules:20 | - |
| `<local-workspace>/08_Tim_Loi_Windows/.claude` | skills:1 | - |
| `<local-workspace>/08_Bot/.claude` | skills:37, agents:23, commands:21 | - |
| `<local-workspace>/01_Setup_HOME/.claude` | skills:3 | - |
| `<local-workspace>/01_Setup_HOME/.agent` | skills:12, agents:16, rules:11 | - |
| `<local-workspace>/10_DesignDatabase_Code_To_Relation_Key_Mermaid/.agent` | skills:39, agents:10, rules:20 | - |
| `<local-workspace>/02_Emails_Export/.claude` | - | 1 |
| `<local-workspace>/rtk/.claude` | skills:11, agents:6, commands:7, rules:3 | - |
| `<local-workspace>/claude-kit-enginer_mod_2/.claude` | skills:1, agents:14, rules:3 | - |
| `<local-workspace>/CleanPC/.claude` | skills:2 | - |
| `<local-workspace>/Windows_change_device_keepDATA/.agent` | skills:31, agents:10, rules:10 | - |

## 4. Recommended Consolidation Actions

1. **PMO Project Suite (`pmo-project-suite`):** Priority-100 skill + 4 `pmo-*.md` agents + `pmo-delivery` command.
2. **Office Document Suite (`office-doc-suite`):** Priority-100 skill unifying MD<->DOCX, Mermaid SSR, XLSX, KPI & spatial extractors.
3. **Email Intelligence Suite (`email-intelligence-suite`):** Cross-OS `.eml`/`.msg` + optional Outlook COM parser & issue extractor.
4. **System Maintenance Suite (`system-maintenance-suite`):** Unified Windows `.ps1` + macOS `.sh` cleaners & uninstaller builder.
