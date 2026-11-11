# OMP Harvest Inventory & Deduplication Report

- **Generated:** 2026-11-11 03:11:41 UTC
- **OMP Sessions Scanned:** 70 (44 top, 26 subagents; 65 advisors skipped, 0 advisors included)
- **Claude Sessions Scanned:** 280 (40 top, 240 subagents/journals; 129 history.jsonl entries)
- **Incremental Skips (Unchanged Watermarks):** 342
- **Total Candidate Artifacts Indexed:** 2884 (Actionable: 783, Ephemeral Noise Filtered: 2101)
- **Unique Code Hashes:** 2382

## 1. Summary by Target Suite

| Target Suite | Extracted Artifacts | Target OMP Priority-100 Location |
|---|---:|---|
| **`general_utilities`** | 2284 | Triaged (Tier A promoted / Tier B opt-in / Tier C excluded) |
| **`pmo_project_suite`** | 383 | `config/omp/agent/skills/pmo-project-suite` |
| **`system_maintenance_suite`** | 119 | `config/omp/agent/skills/system-maintenance-suite` |
| **`office_doc_suite`** | 61 | `config/omp/agent/skills/office-doc-suite` |
| **`email_intelligence_suite`** | 22 | `config/omp/agent/skills/email-intelligence-suite` |
| **`dev_ops_automation`** | 15 | Classified dev/ops automation helpers (promotionQueue candidates) |

## 2. Top Duplicated Code Clusters (Repeated Utilities)

Found **11** actionable duplicate code clusters across scanned sessions and workspaces:

| Hash | Occurrences | Suite | Sample Targets / Snippet Preview |
|---|---:|---|---|
| `f0b6a635de3e` | **3** | `pmo_project_suite` | `config/omp/agent/skills/pmo-project-suite/scripts/venv_bootstrap.py, config/omp/agent/skills/office-doc-suite/scripts/venv_bootstrap.py, config/omp/agent/skills/email-intelligence-suite/scripts/venv_bootstrap.py`<br>*""" venv_bootstrap.py — Attach ~/.omp/tools-venv site-packages onto sys.path if present. """  from __future__ import ann* |
| `f87f113aafac` | **2** | `system_maintenance_suite` | `<local-workspace>/06_cleanup_ai_tools.ps1`<br>*# ============================================ # AI TOOLS CACHE CLEANUP MODULE # =======================================* |
| `1347721f0fa9` | **2** | `system_maintenance_suite` | `<local-workspace>/09_cleanup_dism_updates.ps1`<br>*# ============================================ # WINDOWS COMPONENT STORE & DISM CLEANUP MODULE # =======================* |
| `9fa441c4b4d6` | **2** | `general_utilities` | `scan_stale.ps1, <local-workspace>/scan_stale.ps1`<br>*$paths = @('<local-workspace>/101.AI', '~/Documents', '~/source') $targets = @('.venv', 'venv', '__pycache__', 'node_mod* |
| `4c5de1577c81` | **2** | `general_utilities` | `scan_stale2.ps1, <local-workspace>/scan_stale2.ps1`<br>*$paths = @('<local-workspace>/101.AI', '~/Documents', '~/source') $targets = @('.venv', 'venv', '__pycache__', 'node_mod* |
| `2e5b1702e691` | **2** | `general_utilities` | `check_c.ps1, <local-workspace>/check_c.ps1`<br>*$files = @("<local-workspace>/hiberfil.sys", "<local-workspace>/pagefile.sys", "<local-workspace>/swapfile.sys") Get-Ite* |
| `a54df94a2059` | **2** | `general_utilities` | `check_c2.ps1, <local-workspace>/check_c2.ps1`<br>*$files = @("<local-workspace>/hiberfil.sys", "<local-workspace>/pagefile.sys", "<local-workspace>/swapfile.sys") Get-Ite* |
| `2167df76d0d4` | **2** | `system_maintenance_suite` | `<local-workspace>/12_cleanup_omp_sessions.ps1`<br>*# ============================================ # OH-MY-PI (OMP) AGENT SESSIONS & CACHE CLEANUP MODULE # ================* |
| `08338f8ea238` | **2** | `pmo_project_suite` | `<local-workspace>/1_tao_plan_tu_excel.ps1`<br>*# 1_tao_plan_tu_excel.ps1 # Tự động nạp toàn bộ dữ liệu Excel vào MS Project Plan (ĐỘNG 100% THEO PROFILE JSON)  [Cmdlet* |
| `7b3bbd02c764` | **2** | `pmo_project_suite` | `<local-workspace>/2_xuat_excel_tu_plan.ps1`<br>*# 2_xuat_excel_tu_plan.ps1 # Xuất dữ liệu từ MS Project Plan ra file Excel mới (ĐỘNG 100% THEO PROFILE JSON)  [CmdletBin* |
| `625d58761ee9` | **2** | `pmo_project_suite` | `<local-workspace>/3_so_sanh_2_file_excel.ps1`<br>*# 3_so_sanh_2_file_excel.ps1 # Script so sánh đối chiếu 2 chiều giữa File Excel Gốc và File Excel Mới xuất từ MS Project* |

## 3. Global vs Project `.omp`/`.claude`/`.agent` Delta Summary

- **Project Config Dirs Scanned (Tier C excluded):** 87
- **Dirs with Unpromoted Assets / Links:** 19
- **Container-level Links Detected:** 3

| Project Config Dir | Missing from Global OMP | Links/Junctions |
|---|---|---|
| `<local-workspace>/.Backup_Tool/.claude` | skills:1 | - |
| `<local-workspace>/_Tool/.claude` | - | 6 |
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
