---
name: office-doc-suite
description: "Cross-platform pure-Python suite for Markdown <-> Word (.docx), multi-format -> Markdown (xlsx/docx/drawio/vsdx/html/eml/msg/pdf), Markdown -> Excel (.xlsx), spatial PDF/table extraction, and KPI calculation + alerts."
---

# Office Document Suite (OMP Native Priority-100)

Cross-platform (Windows, macOS, Linux) pure-Python document & analytics suite powered by `~/.omp/tools-venv` (`python-docx`, `openpyxl`, `defusedxml`, `markdown`, `extract-msg`). Zero MS Office or Chromium dependency.

## Dual-Mode CLI Usage (`scripts/office_cli.py`)

### Interactive Menu
```bash
python3 scripts/office_cli.py
```

### Non-Interactive Agent Mode (`--json`)
```bash
python3 scripts/office_cli.py --cmd md2docx --input report.md --output report.docx --json
python3 scripts/office_cli.py --cmd docx2md --input report.docx --output roundtrip.md --json
python3 scripts/office_cli.py --cmd md2xlsx --input tables.md --output tables.xlsx --json
python3 scripts/office_cli.py --cmd to-md --input diagram.drawio --output diagram.md --json
python3 scripts/office_cli.py --cmd batch --input ./docs --output ./out --mode md2docx --recursive --json
python3 scripts/office_cli.py --cmd extract-table --input dump.txt --output structured.xlsx --json
python3 scripts/office_cli.py --cmd extract-bbox --input layout.xml [--single-column | --col-split-x 420.96] --json
python3 scripts/office_cli.py --cmd calc-kpi --input kpi.xlsx --month 2026-11 --output kpi.md [--alerts-out alerts.json] --json
python3 scripts/office_cli.py --cmd init-kpi --output kpi_template.xlsx --json
```

## Security & Portability Invariants
- **CWE-1236 Formula Injection Defense**: Cell values starting with `=`, `+`, `-`, `@`, `\t`, `\r`, `\n`, or fullwidth equivalents are neutralized with `'`.
- **XXE Guard**: BBox XML, `.drawio`, and `.vsdx` parsers enforce `defusedxml` + reject `<!DOCTYPE` / `<!ENTITY` (UTF-8 & UTF-16).
