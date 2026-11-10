---
phase: 4
title: "Office Document Suite Relocation, Full Parity & Bug Fixes"
status: pending
priority: P2
effort: "3.5h"
dependencies: [2]
---

# Phase 4: Office Document Suite Relocation, Full Parity & Bug Fixes

## Overview
Move drafted `office-doc-suite` to OMP-native Priority-100 `config/omp/agent/skills/office-doc-suite/`, restore all missing capabilities from `md-convert`, `kpi_*`, and spatial BBox pipeline, and fix all verified bugs.

## Requirements
- **Functional:**
  1. Relocate `config/managed-skills/office-doc-suite/` -> `config/omp/agent/skills/office-doc-suite/` and clean obsolete `config/managed-skills/`.
  2. Upgrade `doc_converter.py`:
     - Distinct style/markers for fenced code blocks vs blockquotes so roundtrip never mutates code into `> quotes`.
     - Preserve nested list indentation, combined bold+italic runs, embedded images/hyperlinks on `docx_to_md`, and escaped `\|` + numeric cell typing on `md_to_xlsx`.
     - Integrate portable headless Mermaid SSR (`render-mermaid-blocks.mjs` via `node` + `mermaid`/`jsdom` if installed, or `mmdc`, with clean fallback) + `patch-mermaid-in-markdown`.
     - Port multi-format `to-md` ingestion (`.pdf`, `.pptx`, `.xlsx`, `.html`, `.csv`, `.json`, `.xml`, `.eml`, `.msg`, `.rtf` via `markitdown`/`textutil`/pure-Python), `.vsdx -> Mermaid`, `.drawio -> Mermaid`, and `--batch-export` recursive directory routing.
  3. Upgrade `kpi_tracker.py`:
     - Fix `--month` filter empty-match bug (never silently fall back to all months!).
     - Support `"TP (Điểm task)"` header alias and skip non-numeric `TQ` strings instead of coercing to `1.0`.
     - Read `Config` cells (`pm_level`, `s_coeff`, `c_coeff`, `r_coeff`), emit `alerts_YYYYMMDD.json` + Emergency Mode (`>=2`) Section 3, and optional Slack/Telegram webhook dispatch.
  4. Upgrade `spatial_extractor.py`:
     - Replace forced `col_split_x=420.96` & `1000.0` page height with `--single-column` / dynamic `<page width height>` detection.
     - Robust whitespace gap clustering for wrapped descriptions + escaped `\|` in Markdown output.
     - Add optional direct `pdftotext -bbox-layout` invocation, generic multi-record chunk parser, currency/name normalization, arithmetic invariant checks, and summary report generation.
- **Non-Functional:**
  - Pure Python core (zero MS Office / Chromium requirement), Windows & macOS compatible.

## Related Code Files
- Move/Upgrade: `config/omp/agent/skills/office-doc-suite/**` (and delete `config/managed-skills/office-doc-suite/`)

## Implementation Steps
1. Relocate `office-doc-suite` to `config/omp/agent/skills/office-doc-suite/`.
2. Fix all bugs and port missing `md-convert`, `kpi_*`, and spatial BBox modules across `doc_converter.py`, `kpi_tracker.py`, `spatial_extractor.py`, and `office_cli.py`.
3. Expand `tests/test_office_suite.py` and run full unittest suite.

## Success Criteria
- [ ] `python3 config/omp/agent/skills/office-doc-suite/tests/test_office_suite.py` exits 0 covering roundtrip code-blocks, `to-md`, `.vsdx`/`.drawio`, KPI `--month` & `"TP (Điểm task)"`, and single/multi-column BBox extraction.
