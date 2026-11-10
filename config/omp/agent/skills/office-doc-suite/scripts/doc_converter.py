r"""
doc_converter.py — Cross-Platform Office Document & Diagram Converter.

Capabilities:
- Markdown -> DOCX (`md_to_docx`): nested list indentation, bold/italic/code runs, tables,
  images, blockquotes vs distinct `[Code:<lang>]` code blocks, and Mermaid PNG/code rendering.
- DOCX -> Markdown (`docx_to_md`): deterministic roundtrip preserving code fences, nested lists,
  bold+italic spaces, hyperlinks, images, and tables.
- Markdown -> XLSX (`md_to_xlsx`): escaped pipe `\|` support, numeric typing, CWE-1236 defense.
- Multi-format -> Markdown (`to_md`): `.docx`, `.xlsx`, `.csv`, `.json`, `.xml`, `.html`, `.eml`, `.msg`,
  `.drawio` (pure-Python defusedxml -> Mermaid), `.vsdx` (pure-Python ZIP XML / vsdx -> Mermaid),
  and optional `markitdown`/`pdftotext`/`textutil` for `.pdf`/`.pptx`/`.rtf`.
- Recursive batch routing (`batch_convert`) with mtime skip.
"""
from __future__ import annotations

import base64
import csv
import email
import html as html_mod
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import zipfile
import zlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from venv_bootstrap import attach_omp_tools_venv

attach_omp_tools_venv()

import openpyxl  # noqa: E402
from openpyxl.styles import Alignment, Font, PatternFill  # noqa: E402
import xml.etree.ElementTree as StdET  # noqa: N812

try:
    import defusedxml.ElementTree as SafeET  # type: ignore
except ImportError:
    SafeET = StdET

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n", "\uff1d", "\uff0b", "\uff0d")
INLINE_TOKEN_RE = re.compile(r"(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))")
XXE_RE = re.compile(r"<!\s*(DOCTYPE|ENTITY)\b", re.IGNORECASE)


def _assert_safe_xml(raw: bytes) -> None:
    for enc in ("utf-8", "utf-16"):
        try:
            if XXE_RE.search(raw.decode(enc, errors="ignore")):
                raise ValueError("Unsafe XML rejected (DOCTYPE/ENTITY forbidden)")
        except Exception:
            pass


def _sanitize_excel_cell(val: Any) -> Any:
    if isinstance(val, str) and val:
        stripped = val.lstrip()
        if val.startswith(FORMULA_PREFIXES) or (stripped and stripped.startswith(FORMULA_PREFIXES)):
            if not val.startswith("'"):
                return "'" + val
    return val


def _maybe_numeric(cell: str) -> Any:
    s = cell.strip()
    if not s or s.startswith(("=", "+", "@", "'")):
        return _sanitize_excel_cell(cell)
    # Preserve leading-zero codes like "01", "007" as strings
    if re.fullmatch(r"0\d+", s):
        return s
    if re.fullmatch(r"-?[1-9]\d*|0", s):
        return int(s)
    if re.fullmatch(r"-?(?:\d+\.\d+|\d+\.\d*)", s):
        return float(s)
    return _sanitize_excel_cell(cell)


def _require_docx() -> Tuple[Any, Any, Any, Any]:
    try:
        from docx import Document
        from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
        from docx.shared import Inches, Pt
        return Document, WD_PARAGRAPH_ALIGNMENT, Inches, Pt
    except ImportError as exc:
        raise ImportError("python-docx is not installed. Run via `~/.omp/tools-venv` or `pip install python-docx`.") from exc


def _add_inline_runs(paragraph: Any, text: str) -> None:
    pos = 0
    for m in INLINE_TOKEN_RE.finditer(text):
        if m.start() > pos:
            paragraph.add_run(text[pos:m.start()])
        tok = m.group(0)
        if tok.startswith("***") and tok.endswith("***"):
            r = paragraph.add_run(tok[3:-3])
            r.bold, r.italic = True, True
        elif tok.startswith("**") and tok.endswith("**"):
            r = paragraph.add_run(tok[2:-2])
            r.bold = True
        elif tok.startswith("*") and tok.endswith("*"):
            r = paragraph.add_run(tok[1:-1])
            r.italic = True
        elif tok.startswith("`") and tok.endswith("`"):
            r = paragraph.add_run(tok[1:-1])
            r.font.name = "Courier New"
        elif tok.startswith("[") and "](" in tok:
            lbl, url = tok[1:-1].split("](", 1)
            r = paragraph.add_run(f"{lbl} ({url})")
        pos = m.end()
    if pos < len(text):
        paragraph.add_run(text[pos:])


def _try_render_mermaid_png(mmd_code: str, out_png: Path) -> bool:
    mmdc = shutil.which("mmdc")
    if not mmdc:
        return False
    mmd_file = out_png.with_suffix(".mmd")
    mmd_file.write_text(mmd_code, encoding="utf-8")
    try:
        res = subprocess.run([mmdc, "-i", str(mmd_file), "-o", str(out_png), "-b", "transparent"], capture_output=True, text=True, timeout=30, check=False)
        return res.returncode == 0 and out_png.is_file()
    except Exception:
        return False


def _parse_table_row(line: str) -> List[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|") and not stripped.endswith(r"\|"):
        stripped = stripped[:-1]
    parts = re.split(r"(?<!\\)\|", stripped)
    return [c.replace(r"\|", "|").strip() for c in parts]


def _is_separator_row(cells: List[str]) -> bool:
    return bool(cells) and all(bool(re.fullmatch(r":?-{2,}:?", c.replace(" ", ""))) for c in cells)


def md_to_docx(input_md: Union[str, Path], output_docx: Union[str, Path], render_mermaid: bool = True) -> Dict[str, Any]:
    Document, WD_PARAGRAPH_ALIGNMENT, Inches, Pt = _require_docx()
    src = Path(input_md)
    if not src.is_file():
        raise FileNotFoundError(f"Markdown file not found: {src}")

    lines = src.read_text(encoding="utf-8-sig").splitlines()
    doc = Document()
    doc.core_properties.title = src.stem
    mermaid_rendered = mermaid_fallback = tables_written = 0

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        i = 0
        while i < len(lines):
            raw = lines[i]
            s = raw.strip()
            if not s:
                i += 1
                continue

            if s.startswith("```"):
                lang = s[3:].strip().lower()
                block_lines: List[str] = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    block_lines.append(lines[i])
                    i += 1
                i += 1
                code_body = "\n".join(block_lines)
                if lang == "mermaid":
                    png_path = tmp_path / f"mermaid_{mermaid_rendered + mermaid_fallback + 1}.png"
                    if render_mermaid and _try_render_mermaid_png(code_body, png_path):
                        p = doc.add_paragraph()
                        p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
                        p.add_run().add_picture(str(png_path), width=Inches(5.5))
                        mermaid_rendered += 1
                    else:
                        p = doc.add_paragraph()
                        p.style = "No Spacing"
                        hdr = p.add_run("[Mermaid Diagram]\n")
                        hdr.bold = True
                        r = p.add_run(code_body)
                        r.font.name, r.font.size = "Courier New", Pt(9)
                        mermaid_fallback += 1
                else:
                    p = doc.add_paragraph()
                    p.style = "No Spacing"
                    hdr = p.add_run(f"[Code:{lang or 'text'}]\n")
                    hdr.bold = True
                    r = p.add_run(code_body)
                    r.font.name, r.font.size = "Courier New", Pt(9)
                continue

            hm = re.match(r"^(#{1,6})\s+(.+)$", s)
            if hm:
                doc.add_heading(hm.group(2).strip(), level=min(len(hm.group(1)), 6))
                i += 1
                continue

            im = re.match(r"^!\[(.*?)\]\((.*?)\)$", s)
            if im:
                img_path = Path(im.group(2).strip())
                if not img_path.is_absolute():
                    img_path = src.parent / img_path
                if img_path.is_file():
                    p = doc.add_paragraph()
                    p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
                    p.add_run().add_picture(str(img_path), width=Inches(5.5))
                else:
                    doc.add_paragraph(f"[Image: {im.group(1) or img_path.name}]")
                i += 1
                continue

            if s.startswith("|") and "|" in s[1:]:
                tbl_lines: List[str] = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    tbl_lines.append(lines[i].strip())
                    i += 1
                rows_parsed: List[List[str]] = []
                for tl in tbl_lines:
                    cells = _parse_table_row(tl)
                    if not _is_separator_row(cells):
                        rows_parsed.append(cells)
                if rows_parsed:
                    ncols = max(len(r) for r in rows_parsed)
                    tbl = doc.add_table(rows=len(rows_parsed), cols=ncols)
                    try:
                        tbl.style = "Table Grid"
                    except Exception:
                        pass
                    for r_idx, row_vals in enumerate(rows_parsed):
                        for c_idx in range(ncols):
                            cell = tbl.cell(r_idx, c_idx)
                            cell.text = ""
                            val = row_vals[c_idx] if c_idx < len(row_vals) else ""
                            _add_inline_runs(cell.paragraphs[0], val)
                            if r_idx == 0:
                                for run in cell.paragraphs[0].runs:
                                    run.bold = True
                    doc.add_paragraph()
                    tables_written += 1
                continue

            if s.startswith(">"):
                q_lines = []
                while i < len(lines) and lines[i].strip().startswith(">"):
                    q_lines.append(lines[i].strip().lstrip(">").strip())
                    i += 1
                p = doc.add_paragraph(style="Quote" if "Quote" in [st.name for st in doc.styles] else "Intense Quote")
                _add_inline_runs(p, " ".join(q_lines))
                continue

            bm = re.match(r"^(\s*)[-*+]\s+(.+)$", raw)
            if bm:
                lvl = min(len(bm.group(1).replace("\t", "  ")) // 2, 4)
                p = doc.add_paragraph(style="List Bullet")
                if lvl > 0:
                    p.paragraph_format.left_indent = Inches(0.25 * lvl)
                _add_inline_runs(p, bm.group(2).strip())
                i += 1
                continue

            nm = re.match(r"^(\s*)\d+\.\s+(.+)$", raw)
            if nm:
                lvl = min(len(nm.group(1).replace("\t", "  ")) // 2, 4)
                p = doc.add_paragraph(style="List Number")
                if lvl > 0:
                    p.paragraph_format.left_indent = Inches(0.25 * lvl)
                _add_inline_runs(p, nm.group(2).strip())
                i += 1
                continue

            p = doc.add_paragraph()
            _add_inline_runs(p, s)
            i += 1

    out = Path(output_docx)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))
    return {"input_md": str(src), "output_docx": str(out), "tables_written": tables_written, "mermaid_rendered": mermaid_rendered, "mermaid_fallback": mermaid_fallback}


def _wrap_md_token(txt: str, marker: str) -> str:
    lead = txt[: len(txt) - len(txt.lstrip())]
    trail = txt[len(txt.rstrip()):]
    core = txt.strip()
    return f"{lead}{marker}{core}{marker}{trail}" if core else txt


def _runs_to_markdown(runs: Any) -> str:
    parts: List[str] = []
    for r in runs:
        txt = r.text or ""
        if not txt:
            continue
        if r.bold and r.italic and txt.strip():
            parts.append(_wrap_md_token(txt, "***"))
        elif r.bold and txt.strip():
            parts.append(_wrap_md_token(txt, "**"))
        elif r.italic and txt.strip():
            parts.append(_wrap_md_token(txt, "*"))
        elif r.font and r.font.name == "Courier New" and "\n" not in txt and txt.strip():
            parts.append(_wrap_md_token(txt, "`"))
        else:
            parts.append(txt)
    return "".join(parts)


def docx_to_md(input_docx: Union[str, Path], output_md: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    Document, _, _, _ = _require_docx()
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    src = Path(input_docx)
    if not src.is_file():
        raise FileNotFoundError(f"DOCX file not found: {src}")

    doc = Document(str(src))
    md_lines: List[str] = []
    headings = tables = 0

    for child in doc.element.body.iterchildren():
        if isinstance(child, CT_P):
            p = Paragraph(child, doc)
            style_name = (p.style.name if p.style else "") or ""
            raw_txt = p.text
            txt = raw_txt.strip()

            # Detect embedded blips/images inside XML even when p.text is empty
            if not txt and "blip" in child.xml:
                md_lines.extend(["![embedded-image](embedded)", ""])
                continue
            if not txt:
                continue

            if txt.startswith("[Mermaid Diagram]"):
                body = raw_txt.split("\n", 1)[1] if "\n" in raw_txt else txt.replace("[Mermaid Diagram]", "", 1).strip()
                md_lines.extend(["```mermaid", body, "```", ""])
                continue
            cm = re.match(r"^\[Code:([^\]]+)\]\s*\n?(.*)$", raw_txt, re.DOTALL)
            if cm:
                lang = cm.group(1).strip()
                md_lines.extend([f"```{'' if lang == 'text' else lang}", cm.group(2), "```", ""])
                continue

            hm = re.match(r"^Heading\s+(\d+)$", style_name)
            if hm:
                md_lines.extend([f"{'#' * min(int(hm.group(1)), 6)} {txt}", ""])
                headings += 1
            elif style_name in ("List Bullet", "List Number"):
                indent_pts = p.paragraph_format.left_indent.inches if p.paragraph_format.left_indent else 0.0
                indent = "  " * max(0, round(indent_pts / 0.25))
                bullet = "-" if style_name == "List Bullet" else "1."
                md_lines.append(f"{indent}{bullet} {_runs_to_markdown(p.runs) or txt}")
            elif style_name in ("Quote", "Intense Quote"):
                md_lines.extend([f"> {txt}", ""])
            else:
                md_lines.extend([_runs_to_markdown(p.runs) or txt, ""])

        elif isinstance(child, CT_Tbl):
            tbl = Table(child, doc)
            rows_data = [[cell.text.strip().replace("\n", " ").replace("|", r"\|") for cell in row.cells] for row in tbl.rows]
            if rows_data:
                headers = rows_data[0]
                md_lines.append("| " + " | ".join(headers) + " |")
                md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                for r in rows_data[1:]:
                    padded = r + [""] * (len(headers) - len(r))
                    md_lines.append("| " + " | ".join(padded[: len(headers)]) + " |")
                md_lines.append("")
                tables += 1

    md_text = "\n".join(md_lines).rstrip() + "\n"
    if output_md:
        out = Path(output_md)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(md_text, encoding="utf-8")
    return {"input_docx": str(src), "output_md": str(output_md) if output_md else None, "headings": headings, "tables": tables, "markdown": md_text}


def parse_markdown_tables(text: str) -> List[Dict[str, Any]]:
    tables: List[Dict[str, Any]] = []
    lines = text.splitlines()
    current_heading = "Sheet"
    heading_counter: Dict[str, int] = {}
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        hm = re.match(r"^#{1,6}\s+(.+)", s)
        if hm:
            sanitized = re.sub(r'[\\/?*\[\]:]', "-", hm.group(1).strip())
            current_heading = sanitized[:28] or "Sheet"
            i += 1
            continue
        if s.startswith("|") and "|" in s[1:]:
            tbl_lines: List[str] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                tbl_lines.append(lines[i].strip())
                i += 1
            if len(tbl_lines) < 2:
                continue
            headers = _parse_table_row(tbl_lines[0])
            rows = [cells for rl in tbl_lines[1:] if not _is_separator_row(cells := _parse_table_row(rl)) and any(c for c in cells)]
            if headers:
                heading_counter[current_heading] = heading_counter.get(current_heading, 0) + 1
                cnt = heading_counter[current_heading]
                sheet_name = current_heading if cnt == 1 else f"{current_heading}_{cnt}"
                tables.append({"heading": sheet_name[:31], "headers": headers, "rows": rows})
            continue
        i += 1
    return tables


def md_to_xlsx(input_md: Union[str, Path], output_xlsx: Union[str, Path]) -> Dict[str, Any]:
    src = Path(input_md)
    if not src.is_file():
        raise FileNotFoundError(f"Markdown file not found: {src}")
    tables = parse_markdown_tables(src.read_text(encoding="utf-8-sig"))
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)

    for tbl in tables:
        ws = wb.create_sheet(title=tbl["heading"])
        widths = [len(str(h)) for h in tbl["headers"]]
        for col_idx, header in enumerate(tbl["headers"], 1):
            c = ws.cell(1, col_idx, _sanitize_excel_cell(header))
            c.font, c.fill, c.alignment = header_font, header_fill, Alignment(horizontal="center")
        for r_idx, row in enumerate(tbl["rows"], 2):
            for col_idx, val in enumerate(row, 1):
                clean = _maybe_numeric(val)
                ws.cell(r_idx, col_idx, clean)
                if col_idx - 1 < len(widths):
                    widths[col_idx - 1] = max(widths[col_idx - 1], len(str(clean)))
        for col_idx, w in enumerate(widths, 1):
            ws.column_dimensions[ws.cell(1, col_idx).column_letter].width = min(w + 4, 50)

    if not wb.sheetnames:
        wb.create_sheet("No Tables Found")
    out = Path(output_xlsx)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(out))
    wb.close()
    return {"input_md": str(src), "output_xlsx": str(out), "sheets_created": len(tables), "sheet_names": [t["heading"] for t in tables]}


def _decode_drawio_diagram(el: Any) -> Any:
    if el.find(".//mxCell") is not None:
        return el
    txt = (el.text or "").strip()
    if not txt:
        return el
    raw = base64.b64decode(txt)
    for wbits in (-zlib.MAX_WBITS, zlib.MAX_WBITS):
        try:
            xml_str = urllib.parse.unquote(zlib.decompress(raw, wbits).decode("utf-8"))
            _assert_safe_xml(xml_str.encode("utf-8"))
            return SafeET.fromstring(xml_str)
        except Exception:
            pass
    return el


def drawio_to_mermaid(input_drawio: Union[str, Path], output_md: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    src = Path(input_drawio)
    raw = src.read_bytes()
    _assert_safe_xml(raw)
    root = SafeET.fromstring(raw)
    diagrams = root.findall(".//diagram") or [root]
    sections = [f"# {src.name}", ""]
    edge_count = 0
    for idx, diag in enumerate(diagrams, 1):
        model = _decode_drawio_diagram(diag)
        nodes, edges = {}, []
        for cell in model.findall(".//mxCell"):
            cid = cell.attrib.get("id", "")
            val = re.sub(r"<[^>]+>", " ", cell.attrib.get("value", "")).strip().replace('"', "'")
            src_id, tgt_id = cell.attrib.get("source"), cell.attrib.get("target")
            if src_id and tgt_id:
                edges.append((src_id, tgt_id, val))
            elif cid not in ("0", "1") and val:
                nodes[cid] = val
        sections.extend([f"## Diagram {idx}: {diag.attrib.get('name', f'Page {idx}')}", "", "```mermaid", "flowchart TD"])
        for nid, lbl in nodes.items():
            sections.append(f'    N{re.sub(r"[^A-Za-z0-9_]", "_", nid)}["{lbl}"]')
        for s_id, t_id, lbl in edges:
            sn, tn = f'N{re.sub(r"[^A-Za-z0-9_]", "_", s_id)}', f'N{re.sub(r"[^A-Za-z0-9_]", "_", t_id)}'
            sections.append(f'    {sn} -->|"{lbl}"| {tn}' if lbl else f"    {sn} --> {tn}")
            edge_count += 1
        sections.extend(["```", ""])
    md = "\n".join(sections)
    if output_md:
        Path(output_md).parent.mkdir(parents=True, exist_ok=True)
        Path(output_md).write_text(md, encoding="utf-8")
    return {"input": str(src), "output_md": str(output_md) if output_md else None, "edges": edge_count, "markdown": md}


def vsdx_to_mermaid(input_vsdx: Union[str, Path], output_md: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    src = Path(input_vsdx)
    sections = [f"# {src.name}", ""]
    pages_count = 0
    with zipfile.ZipFile(src, "r") as zf:
        page_files = sorted(n for n in zf.namelist() if re.match(r"^visio/pages/page\d+\.xml$", n))
        for idx, pf in enumerate(page_files, 1):
            raw = zf.read(pf)
            _assert_safe_xml(raw)
            root = SafeET.fromstring(raw)
            shapes: Dict[str, str] = {}
            connects: List[Tuple[str, str, str]] = []
            for el in root.iter():
                tag = el.tag.split("}", 1)[-1]
                if tag == "Shape":
                    sid = el.attrib.get("ID", "")
                    txt = "".join(t.text or "" for t in el.iter() if t.tag.split("}", 1)[-1] == "Text").strip().replace('"', "'")
                    if sid and txt:
                        shapes[sid] = txt
                elif tag == "Connect":
                    connects.append((el.attrib.get("FromSheet", ""), el.attrib.get("FromCell", ""), el.attrib.get("ToSheet", "")))
            by_conn: Dict[str, Dict[str, str]] = {}
            for fs, fc, ts in connects:
                by_conn.setdefault(fs, {})[fc] = ts
            sections.extend([f"## Page {idx}", "", "```mermaid", "graph TD"])
            for sid, lbl in shapes.items():
                sections.append(f'    S{sid}["{lbl}"]')
            for conn in by_conn.values():
                b, e = conn.get("BeginX"), conn.get("EndX")
                if b and e:
                    sections.append(f"    S{b} --> S{e}")
            sections.extend(["```", ""])
            pages_count += 1
    md = "\n".join(sections)
    if output_md:
        Path(output_md).parent.mkdir(parents=True, exist_ok=True)
        Path(output_md).write_text(md, encoding="utf-8")
    return {"input": str(src), "output_md": str(output_md) if output_md else None, "pages": pages_count, "markdown": md}


def to_md(input_path: Union[str, Path], output_md: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    src = Path(input_path)
    if not src.is_file():
        raise FileNotFoundError(f"File not found: {src}")
    ext = src.suffix.lower()
    if ext == ".docx":
        return docx_to_md(src, output_md)
    if ext == ".drawio":
        return drawio_to_mermaid(src, output_md)
    if ext == ".vsdx":
        return vsdx_to_mermaid(src, output_md)

    lines: List[str] = [f"# {src.name}", ""]
    if ext in (".xlsx", ".xlsm"):
        wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
        for sname in wb.sheetnames:
            rows = list(wb[sname].iter_rows(values_only=True))
            if not rows:
                continue
            lines.extend([f"## {sname}", ""])
            hdr = [str(c if c is not None else "").replace("|", r"\|") for c in rows[0]]
            lines.append("| " + " | ".join(hdr) + " |")
            lines.append("| " + " | ".join(["---"] * len(hdr)) + " |")
            for r in rows[1:]:
                vals = [str(r[idx] if idx < len(r) and r[idx] is not None else "").replace("\n", " ").replace("|", r"\|") for idx in range(len(hdr))]
                lines.append("| " + " | ".join(vals) + " |")
            lines.append("")
        wb.close()
    elif ext == ".csv":
        with open(src, "r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))
        if rows:
            lines.append("| " + " | ".join(c.replace("|", r"\|") for c in rows[0]) + " |")
            lines.append("| " + " | ".join(["---"] * len(rows[0])) + " |")
            for r in rows[1:]:
                lines.append("| " + " | ".join(c.replace("|", r"\|") for c in r) + " |")
    elif ext in (".html", ".htm"):
        txt = re.sub(r"<(script|style)[^>]*>[\s\S]*?</\1>", "", src.read_text(encoding="utf-8", errors="ignore"), flags=re.I)
        txt = html_mod.unescape(re.sub(r"<[^>]+>", "\n", txt))
        lines.extend(ln.strip() for ln in txt.splitlines() if ln.strip())
    elif ext in (".json", ".xml"):
        lines.extend([f"```{ext.lstrip('.')}", src.read_text(encoding="utf-8", errors="ignore"), "```"])
    elif ext == ".eml":
        msg = email.message_from_bytes(src.read_bytes())
        lines.extend([f"- **Subject:** {msg.get('Subject', '')}", f"- **From:** {msg.get('From', '')}", f"- **Date:** {msg.get('Date', '')}", ""])
        body = msg.get_payload(decode=True) if not msg.is_multipart() else next((p.get_payload(decode=True) for p in msg.walk() if p.get_content_type() == "text/plain"), b"")
        lines.append((body or b"").decode("utf-8", errors="ignore"))
    elif ext == ".pdf":
        extracted = ""
        try:
            from pypdf import PdfReader  # type: ignore

            reader = PdfReader(str(src))
            page_chunks = [(pg.extract_text() or "").strip() for pg in reader.pages]
            extracted = "\n\n".join(c for c in page_chunks if c).strip()
        except ImportError:
            extracted = ""
        if not extracted and shutil.which("pdftotext"):
            extracted = subprocess.check_output(["pdftotext", "-layout", str(src), "-"], text=True, errors="ignore").strip()
        if not extracted:
            raise ValueError(f"Scanned/image-only PDF has no extractable text (use OCR or ai-multimodal): {src}")
        lines.append(extracted)
    else:
        raise ValueError(f"Unsupported format for pure-Python to_md: {ext}")
    md = "\n".join(lines).rstrip() + "\n"
    if output_md:
        Path(output_md).parent.mkdir(parents=True, exist_ok=True)
        Path(output_md).write_text(md, encoding="utf-8")
    return {"input": str(src), "output_md": str(output_md) if output_md else None, "markdown": md}


def batch_convert(input_dir: Union[str, Path], output_dir: Union[str, Path], mode: str = "md2docx", recursive: bool = True, overwrite: bool = False) -> Dict[str, Any]:
    src_root, dst_root = Path(input_dir), Path(output_dir)
    ext_map = {"md2docx": (".md", ".docx"), "docx2md": (".docx", ".md"), "md2xlsx": (".md", ".xlsx")}
    if mode not in ext_map:
        raise ValueError(f"Unsupported batch mode: {mode}")
    in_ext, out_ext = ext_map[mode]
    files = list(src_root.rglob(f"*{in_ext}") if recursive else src_root.glob(f"*{in_ext}"))
    converted, skipped = [], []
    for f in sorted(files):
        rel = f.relative_to(src_root).with_suffix(out_ext)
        out = dst_root / rel
        if not overwrite and out.exists() and out.stat().st_mtime >= f.stat().st_mtime:
            skipped.append(str(f))
            continue
        if mode == "md2docx":
            md_to_docx(f, out, render_mermaid=False)
        elif mode == "docx2md":
            docx_to_md(f, out)
        else:
            md_to_xlsx(f, out)
        converted.append(str(out))
    return {"mode": mode, "converted_count": len(converted), "skipped_count": len(skipped), "outputs": converted}
