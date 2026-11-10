#!/usr/bin/env python3
"""Comprehensive regression tests for V2 office-doc-suite."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SUITE_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = SUITE_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import openpyxl  # noqa: E402

from doc_converter import batch_convert, docx_to_md, drawio_to_mermaid, md_to_docx, md_to_xlsx, to_md  # noqa: E402
from kpi_tracker import compute_kpi_metrics, init_kpi_workbook, run_kpi_analysis  # noqa: E402
from spatial_extractor import extract_bbox_layout, extract_spatial_tables  # noqa: E402


SAMPLE_MD = """# Quarterly Engineering Summary

Executive summary with **bold status** and *italic note* and ***both*** styles.

> Key risk: legacy batch runtime deprecated.

```python
def hello():
    return "world"
```

- Top item
  - Nested child item

## Metrics Overview

| Metric | Target | Code | Note |
|---|---:|---|---|
| Velocity | 100 | 007 | A \\| B |
| Injection Guard | 42 | Safe | =cmd\\|'calc'!A0 |

```mermaid
flowchart LR
    A[Input] --> B[Output]
```
"""

SAMPLE_SPATIAL = """ID     Item Name          Qty    Amount
-------------------------------------------
01     Widget Alpha       10     1200
02     Widget Beta        5      850
03     =SUM(A1:A2)        1      100
"""

SAMPLE_DRAWIO = """<?xml version="1.0" encoding="UTF-8"?>
<mxfile><diagram name="Flow">
  <mxGraphModel><root>
    <mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="2" value="Start" vertex="1" parent="1"/>
    <mxCell id="3" value="End" vertex="1" parent="1"/>
    <mxCell id="4" value="go" edge="1" source="2" target="3" parent="1"/>
  </root></mxGraphModel>
</diagram></mxfile>
"""

SAMPLE_BBOX_SINGLE = """<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml>
  <page width="595" height="842">
    <word xMin="50" yMin="40">Single</word>
    <word xMin="250" yMin="40">Column</word>
    <word xMin="450" yMin="40">Header</word>
  </page>
</pdf2xml>
"""

SAMPLE_BBOX_TWOCOL = """<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml>
  <page width="842" height="595">
    <word xMin="50" yMin="40">LeftCol</word>
    <word xMin="110" yMin="40">Row1</word>
    <word xMin="500" yMin="40">RightCol</word>
    <word xMin="560" yMin="40">Row1</word>
    <word xMin="50" yMin="60">LeftCol</word>
    <word xMin="110" yMin="60">Row2</word>
  </page>
</pdf2xml>
"""


class TestOfficeSuiteV2(unittest.TestCase):
    def test_md_docx_roundtrip_codeblocks_nested_lists_and_styles(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            md_in = tdir / "report.md"
            docx_out = tdir / "report.docx"
            md_back = tdir / "roundtrip.md"
            md_in.write_text(SAMPLE_MD, encoding="utf-8")

            res = md_to_docx(md_in, docx_out, render_mermaid=False)
            self.assertTrue(zipfile.is_zipfile(docx_out))
            self.assertEqual(res["tables_written"], 1)
            self.assertEqual(res["mermaid_fallback"], 1)

            rt = docx_to_md(docx_out, md_back)
            self.assertGreaterEqual(rt["headings"], 2)
            back_txt = md_back.read_text(encoding="utf-8")
            # Code block MUST NOT mutate into blockquote!
            self.assertIn("```python", back_txt)
            self.assertIn("> Key risk: legacy batch runtime deprecated.", back_txt)
            self.assertIn("  - Nested child item", back_txt)
            self.assertIn("***both***", back_txt)
            self.assertIn("```mermaid", back_txt)

    def test_md_to_xlsx_escaped_pipe_and_numeric_typing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            md_in = tdir / "tables.md"
            xlsx_out = tdir / "tables.xlsx"
            md_in.write_text(SAMPLE_MD, encoding="utf-8")
            res = md_to_xlsx(md_in, xlsx_out)
            self.assertEqual(res["sheets_created"], 1)
            wb = openpyxl.load_workbook(xlsx_out)
            ws = wb[wb.sheetnames[0]]
            self.assertEqual(ws.cell(2, 2).value, 100)  # numeric int, not str
            self.assertEqual(ws.cell(2, 3).value, "007")  # leading zero preserved
            self.assertEqual(ws.cell(2, 4).value, "A | B")  # escaped pipe unescaped
            self.assertEqual(ws.cell(3, 4).value, "'=cmd|'calc'!A0")
            wb.close()

    def test_drawio_to_md_batch_and_multi_format(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            dr = tdir / "diagram.drawio"
            dr.write_text(SAMPLE_DRAWIO, encoding="utf-8")
            res = drawio_to_mermaid(dr)
            self.assertEqual(res["edges"], 1)
            self.assertIn("N2 -->|\"go\"| N3", res["markdown"])

            xlsx = tdir / "src.xlsx"
            wb = openpyxl.Workbook()
            wb.active.append(["Col1", "Col2"])
            wb.active.append(["v1", "v2"])
            wb.save(xlsx)
            wb.close()
            md_res = to_md(xlsx)
            self.assertIn("| Col1 | Col2 |", md_res["markdown"])

            b_in = tdir / "bin"
            b_in.mkdir()
            (b_in / "a.md").write_text("# A\n", encoding="utf-8")
            b_res = batch_convert(b_in, tdir / "bout", mode="md2docx")
            self.assertEqual(b_res["converted_count"], 1)

    def test_spatial_single_and_twocol_and_xxe(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            txt = tdir / "dump.txt"
            xlsx = tdir / "dump.xlsx"
            txt.write_text(SAMPLE_SPATIAL, encoding="utf-8")
            res = extract_spatial_tables(txt, output_xlsx=xlsx)
            self.assertEqual(res["row_count"], 3)
            self.assertEqual(res["headers"], ["ID", "Item Name", "Qty", "Amount"])

            s_xml = tdir / "single.xml"
            s_xml.write_text(SAMPLE_BBOX_SINGLE, encoding="utf-8")
            s_res = extract_bbox_layout(s_xml)
            self.assertEqual(s_res["columns_extracted"], 1)
            self.assertIn("Single Column Header", s_res["text"])

            t_xml = tdir / "two.xml"
            t_xml.write_text(SAMPLE_BBOX_TWOCOL, encoding="utf-8")
            t_res = extract_bbox_layout(t_xml, col_split_x=420.96)
            self.assertEqual(t_res["columns_extracted"], 2)
            self.assertIn("LeftCol Row1\nLeftCol Row2", t_res["text"])

            xxe = tdir / "xxe.xml"
            xxe.write_text('<?xml version="1.0"?><!DOCTYPE foo><pdf2xml/>', encoding="utf-8")
            with self.assertRaises(ValueError):
                extract_bbox_layout(xxe)

    def test_kpi_month_empty_tp_alias_tq_skip_and_alerts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            kpi_xlsx = tdir / "kpi.xlsx"
            alerts_json = tdir / "alerts.json"
            init_kpi_workbook(kpi_xlsx)
            res = run_kpi_analysis(kpi_xlsx, alerts_out=alerts_json)
            self.assertEqual(res["signals"]["ap_ep"]["value"], 0.9)
            self.assertEqual(res["leading_indicators"]["ep_drift"]["value"], 0.0)  # TP (Điểm task) == Baseline TP

            # Month miss MUST return 0 tasks and empty signals, NEVER fall back to all periods
            empty_m = run_kpi_analysis(kpi_xlsx, month="1999-01")
            self.assertEqual(empty_m["task_count"], 0)
            self.assertEqual(empty_m["signals"], {})

            # Non-numeric TQ must be skipped, not coerced to 1.0
            m = compute_kpi_metrics([
                {"Assigned To": "Dev1", "Month": "2026-11", "Earned Points": 50, "TQ": "N/A", "Dev Time": 10, "Bug Fix Time": 3},
                {"Assigned To": "Dev2", "Month": "2026-11", "Earned Points": 20, "TQ": 0.8, "Dev Time": 10, "Bug Fix Time": 3},
            ], target_points=100, month="2026-11")
            self.assertEqual(m["signals"]["dev_tq_below_1"]["value"], 1)
            self.assertTrue(m["emergency_mode"])

    def test_dual_mode_cli(self) -> None:
        cli = SCRIPTS_DIR / "office_cli.py"
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            dr = tdir / "f.drawio"
            dr.write_text(SAMPLE_DRAWIO, encoding="utf-8")
            p1 = subprocess.run([sys.executable, str(cli), "--cmd", "to-md", "--input", str(dr), "--json"], capture_output=True, text=True)
            self.assertEqual(p1.returncode, 0, p1.stderr)
            self.assertEqual(json.loads(p1.stdout)["edges"], 1)
            p2 = subprocess.run([sys.executable, str(cli)], input="0\n", capture_output=True, text=True)
            self.assertEqual(p2.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
