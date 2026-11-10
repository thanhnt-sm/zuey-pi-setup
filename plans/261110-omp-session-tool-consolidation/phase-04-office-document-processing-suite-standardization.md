# Phase 4: Office & Document Processing Suite Standardization

## Overview
Standardize and unify the disparate document and file processing utilities (Markdown to DOCX with Mermaid diagrams, DOCX to Markdown, Excel KPI tracking, and spatial unstructured table/receipt extraction) into a single cross-platform OMP Managed Skill at `config/omp/agent/managed-skills/office-doc-suite/`.

## Requirements
- **Functional Requirements:**
  1. Build a robust Markdown ↔ Word (.docx) converter (`scripts/doc_converter.py`) based on `python-docx` and `markdown`:
     - Markdown headings, tables, blockquotes, and bold/italic formatting preserved.
     - Detect embedded Mermaid code blocks and convert to high-resolution raster images or clean SVG embeds.
     - Reverse conversion: Word (`.docx`) to clean, deterministic Markdown.
  2. Implement spatial unstructured table & receipt extractor (`scripts/spatial_extractor.py`) ported from `01_1A6`:
     - Reads raw multi-line text files or OCR dumps with varying whitespace.
     - Clusters lines by vertical coordinates and column delimiters into structured Excel (`.xlsx`) or Markdown tables.
  3. Implement KPI calculation engine (`scripts/kpi_tracker.py`) ported from `104_PM_PhanTich`:
     - Computes completion percentages, velocity, and variance.
  4. Build a unified CLI (`scripts/office_cli.py`) with:
     - **Interactive Menu:** Numbered selection for format conversion, table extraction, and KPI generation.
     - **Non-Interactive Mode:** `--convert [md2docx|docx2md]`, `--extract-table`, `--calc-kpi`.
  5. Author `SKILL.md` detailing parameters and agent examples.
- **Non-Functional Requirements:**
  - Pure Python solution: no dependency on local Microsoft Office or Pandoc installation.
  - Cross-platform compatible on Windows, macOS (Intel & Apple Silicon), and Linux.

## Related Code Files
- **Create:** `config/omp/agent/managed-skills/office-doc-suite/SKILL.md`
- **Create:** `config/omp/agent/managed-skills/office-doc-suite/scripts/office_cli.py`
- **Create:** `config/omp/agent/managed-skills/office-doc-suite/scripts/doc_converter.py`
- **Create:** `config/omp/agent/managed-skills/office-doc-suite/scripts/spatial_extractor.py`
- **Create:** `config/omp/agent/managed-skills/office-doc-suite/scripts/kpi_tracker.py`
- **Create:** `config/omp/agent/managed-skills/office-doc-suite/tests/test_office_suite.py`
- **Modify:** `plans/omp-consolidation-ledger.json` (mark `office_doc_suite` as `PACKAGED`)

## Implementation Steps
1. **Scaffold Managed Skill Directory Structure:**
   - Create directories under `config/omp/agent/managed-skills/office-doc-suite/`.
2. **Implement Core Converters:**
   - Implement `doc_converter.py` with custom styles and table formatting.
   - Implement `spatial_extractor.py` using regex and coordinate clustering.
   - Implement `kpi_tracker.py` using `openpyxl`.
3. **Build CLI Runner:**
   - Wire all sub-tools into `office_cli.py` with dual interactive/flag support.
4. **Write Test Suite (`test_office_suite.py`):**
   - Test Markdown to DOCX conversion and verify output file exists and is valid zip/docx.
   - Test spatial table extraction on multi-column whitespace text.

## Success Criteria
- [ ] `python config/omp/agent/managed-skills/office-doc-suite/tests/test_office_suite.py` passes all tests.
- [ ] Roundtrip Markdown → DOCX → Markdown maintains headings and table content.
- [ ] Works without requiring MS Office installed.
