# OMP Harvest Inventory & Deduplication Report

- **Generated:** 2026-11-10 02:19:38 UTC
- **Total Candidate Artifacts Extracted:** 234
- **Unique Code Hashes:** 233

## 1. Summary by Target Suite

| Target Suite | Extracted Artifacts | Proposed Managed Skill Location |
|---|---|---|
| **`general_utilities`** | 96 | `config/omp/agent/managed-skills/general-utilities` |
| **`pmo_project_suite`** | 63 | `config/omp/agent/managed-skills/pmo-project-suite` |
| **`email_intelligence_suite`** | 31 | `config/omp/agent/managed-skills/email-intelligence-suite` |
| **`system_maintenance_suite`** | 24 | `config/omp/agent/managed-skills/system-maintenance-suite` |
| **`office_doc_suite`** | 20 | `config/omp/agent/managed-skills/office-doc-suite` |

## 2. Top Duplicated Code Clusters (Repeated Utilities)

Found **1** duplicate code clusters across scanned sessions and workspaces:

| Hash | Occurrences | Suite | Sample Targets / Snippet Preview |
|---|---|---|---|
| `699de6b90345` | **2** | `pmo_project_suite` | `~/AppData/Local/omp/pmi-calc, ~/AppData/Local/omp/pm-calc`<br>*#!/usr/bin/env bash python "~/.claude/skills/pmi-pmo-framework/scripts/pm_calc.py" "$@" * |

## 3. Recommended Consolidation Actions

1. **PMO Project Suite (`pmo-project-suite`):** Consolidate all CPM/EVM/WBS math into pure Python `core_pmo.py` with `openpyxl` & `defusedxml`, eliminating redundant ad-hoc scripts.
2. **Office Document Suite (`office-doc-suite`):** Standardize Markdown-to-DOCX/XLSX pipeline with embedded Mermaid and table extractors into a single CLI.
3. **Email Intelligence Suite (`email-intelligence-suite`):** Unify multi-threaded `.eml`/`.msg` parser with SHA-256 deduplication and Markdown/Excel reporting.
4. **System Maintenance Suite (`system-maintenance-suite`):** Merge Windows `.ps1` and macOS `.sh` cleanup modules under an OS-adaptive dispatcher.

