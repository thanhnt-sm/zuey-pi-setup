"""
spatial_extractor.py — Generic Spatial Multi-Column Table, PDF BBox & Record Extractor.

Fixes & enhancements over draft:
- Auto-detects single vs 2-column page layout (or respects `--single-column` / explicit `--col-split-x`),
  instead of forcing A4-Landscape 420.96pt split on all PDFs.
- Reads actual `<page height="...">` instead of hardcoding `1000.0`.
- Escapes `|` inside Markdown cells and uses occupancy-based column gaps resilient to sparse/wrapped rows.
- Optional direct `pdftotext -bbox-layout` invocation for `.pdf` files + generic regex record parser & arithmetic invariants.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from venv_bootstrap import attach_omp_tools_venv

attach_omp_tools_venv()

import openpyxl  # noqa: E402
from openpyxl.styles import Font, PatternFill  # noqa: E402

import xml.etree.ElementTree as StdET  # noqa: N812

try:
    import defusedxml.ElementTree as SafeET  # type: ignore
except ImportError:
    SafeET = StdET

XXE_FORBIDDEN_RE = re.compile(r"<!\s*(DOCTYPE|ENTITY)\b", re.IGNORECASE)
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n", "\uff1d", "\uff0b", "\uff0d")


def _sanitize_cell(val: Any) -> Any:
    if isinstance(val, str) and val and val.lstrip().startswith(FORMULA_PREFIXES) and not val.startswith("'"):
        return "'" + val
    return val


def _infer_column_slices(lines: List[str]) -> List[Tuple[int, int]]:
    non_empty = [ln for ln in lines if ln.strip() and not re.fullmatch(r"[\s\-=_+|]+", ln.strip())]
    if not non_empty:
        return []
    max_len = max(len(ln) for ln in non_empty)
    # Strict all-row space columns when <= 8 rows so narrow numeric rows never clip wide headers;
    # allow 92% occupancy on larger dumps to tolerate occasional wrapped lines.
    threshold = len(non_empty) if len(non_empty) <= 8 else max(1, int(len(non_empty) * 0.92))
    sep_cols = [
        idx for idx in range(max_len)
        if sum(1 for ln in non_empty if idx >= len(ln) or ln[idx] == " ") >= threshold
    ]
    sep_set = set(sep_cols)
    slices: List[Tuple[int, int]] = []
    start: Optional[int] = None
    for idx in range(max_len):
        if idx not in sep_set and start is None:
            start = idx
        elif idx in sep_set and start is not None:
            # Require at least 2 contiguous space columns to end a slice (protects single spaces inside cell text)
            if idx + 1 in sep_set or idx + 1 >= max_len:
                slices.append((start, idx))
                start = None
    if start is not None:
        slices.append((start, max_len))
    return slices if len(slices) >= 2 else []


def extract_spatial_tables(
    input_path: Union[str, Path],
    output_xlsx: Optional[Union[str, Path]] = None,
    output_md: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    src = Path(input_path)
    if not src.is_file():
        raise FileNotFoundError(f"Text file not found: {src}")

    raw_lines = [ln.rstrip("\r\n") for ln in src.read_text(encoding="utf-8-sig").splitlines()]
    content_lines = [ln for ln in raw_lines if ln.strip() and not re.fullmatch(r"[\s\-=_+|]+", ln.strip())]
    if not content_lines:
        return {"headers": [], "rows": [], "row_count": 0, "markdown": ""}

    slices = _infer_column_slices(content_lines)
    parsed_rows: List[List[str]] = []
    if slices:
        for ln in content_lines:
            cells = [ln[a:b].strip() for a, b in slices]
            if any(cells):
                parsed_rows.append(cells)
    else:
        for ln in content_lines:
            cells = [c.strip() for c in re.split(r"\s{2,}|\t+", ln.strip()) if c.strip()]
            if cells:
                parsed_rows.append(cells)

    headers = parsed_rows[0] if parsed_rows else []
    data_rows = parsed_rows[1:] if len(parsed_rows) > 1 else []
    md_lines = []
    if headers:
        md_lines.append("| " + " | ".join(h.replace("|", r"\|") for h in headers) + " |")
        md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for r in data_rows:
            padded = r + [""] * (len(headers) - len(r))
            md_lines.append("| " + " | ".join(c.replace("|", r"\|") for c in padded[: len(headers)]) + " |")
    md_text = "\n".join(md_lines)

    if output_md:
        Path(output_md).parent.mkdir(parents=True, exist_ok=True)
        Path(output_md).write_text(md_text + "\n", encoding="utf-8")

    if output_xlsx:
        out = Path(output_xlsx)
        out.parent.mkdir(parents=True, exist_ok=True)
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Extracted"
        fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
        font = Font(color="FFFFFF", bold=True)
        for c_idx, h in enumerate(headers, 1):
            c = ws.cell(1, c_idx, _sanitize_cell(h))
            c.fill, c.font = fill, font
        for r_idx, row in enumerate(data_rows, 2):
            for c_idx, val in enumerate(row, 1):
                ws.cell(r_idx, c_idx, _sanitize_cell(val))
        wb.save(str(out))
        wb.close()

    return {"headers": headers, "rows": data_rows, "row_count": len(data_rows), "markdown": md_text, "output_xlsx": str(output_xlsx) if output_xlsx else None, "output_md": str(output_md) if output_md else None}


def extract_bbox_layout(
    xml_or_pdf_path: Union[str, Path],
    col_split_x: Optional[float] = None,
    single_column: bool = False,
    line_tolerance: float = 3.0,
    output_txt: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    p = Path(xml_or_pdf_path)
    if not p.is_file():
        raise FileNotFoundError(f"Input file not found: {p}")

    if p.suffix.lower() == ".pdf":
        pdftotext = shutil.which("pdftotext")
        if not pdftotext:
            raise RuntimeError("pdftotext binary not found on PATH; pass pre-dumped -bbox-layout XML or install poppler.")
        raw = subprocess.check_output([pdftotext, "-bbox-layout", str(p), "-"])
    else:
        raw = p.read_bytes()

    for enc in ("utf-8", "utf-16"):
        if XXE_FORBIDDEN_RE.search(raw.decode(enc, errors="ignore")):
            raise ValueError(f"Unsafe XML rejected (DOCTYPE/ENTITY forbidden): {p}")

    root = SafeET.fromstring(raw)
    pages = [el for el in root.iter() if el.tag.endswith("page")]

    # Auto-detect 2-column split ONLY when landscape OR >=2 rows exist on both sides with clear mid-gutter
    if not single_column and col_split_x is None and pages:
        first_w = float(pages[0].attrib.get("width", "0") or "0")
        first_h = float(pages[0].attrib.get("height", "0") or "0")
        if first_w > 0:
            words_meta = [
                (float(el.attrib.get("xMin", "0")), float(el.attrib.get("yMin", "0")))
                for el in root.iter() if el.tag.endswith("word") and el.attrib.get("xMin")
            ]
            mid = first_w / 2.0
            left_ys = {round(y / line_tolerance) for x, y in words_meta if x < mid * 0.85}
            right_ys = {round(y / line_tolerance) for x, y in words_meta if x >= mid * 1.05}
            gutter_clear = not any(mid * 0.92 <= x <= mid * 1.08 for x, _ in words_meta)
            if gutter_clear and ((first_w > first_h and left_ys and right_ys) or (len(left_ys) >= 2 and len(right_ys) >= 2)):
                col_split_x = mid

    col_indices = [0] if (single_column or col_split_x is None) else [0, 1]
    columns_text: List[str] = []
    for col_idx in col_indices:
        words: List[Tuple[float, float, str]] = []
        y_offset = 0.0
        for page in pages:
            p_height = float(page.attrib.get("height", "800") or "800")
            for el in page.iter():
                if not el.tag.endswith("word"):
                    continue
                txt = (el.text or "").strip()
                if not txt:
                    continue
                x = float(el.attrib.get("xMin", "0"))
                y = float(el.attrib.get("yMin", "0"))
                if col_split_x is None or (col_idx == 0 and x < col_split_x) or (col_idx == 1 and x >= col_split_x):
                    words.append((y_offset + y, x, txt))
            y_offset += p_height

        if not words:
            continue
        words.sort(key=lambda item: (round(item[0] / line_tolerance) * line_tolerance, item[1]))
        lines: List[str] = []
        cur_y: Optional[float] = None
        cur_tokens: List[str] = []
        for gy, _x, tok in words:
            bucket = round(gy / line_tolerance) * line_tolerance
            if cur_y is None or bucket != cur_y:
                if cur_tokens:
                    lines.append(" ".join(cur_tokens))
                cur_y = bucket
                cur_tokens = [tok]
            else:
                cur_tokens.append(tok)
        if cur_tokens:
            lines.append(" ".join(cur_tokens))
        columns_text.append("\n".join(lines))

    combined = "\n\n".join(columns_text)
    if output_txt:
        Path(output_txt).parent.mkdir(parents=True, exist_ok=True)
        Path(output_txt).write_text(combined + "\n", encoding="utf-8")

    return {"input_file": str(p), "columns_extracted": len(columns_text), "col_split_x": col_split_x, "line_count": len(combined.splitlines()) if combined else 0, "text": combined, "output_txt": str(output_txt) if output_txt else None}


def clean_currency_int(raw_val: str) -> int:
    cleaned = re.sub(r"[^\d]", "", raw_val or "")
    return int(cleaned) if cleaned else 0


def parse_structured_chunks(text: str, delimiter_regex: str, field_regexes: Dict[str, str]) -> List[Dict[str, Any]]:
    chunks = re.split(delimiter_regex, text)
    compiled = {k: re.compile(v, re.MULTILINE) for k, v in field_regexes.items()}
    records = []
    for chunk in chunks[1:] if len(chunks) > 1 else chunks:
        if not chunk.strip():
            continue
        rec = {k: (m.group(1).strip() if (m := pat.search(chunk)) else "") for k, pat in compiled.items()}
        records.append(rec)
    return records
