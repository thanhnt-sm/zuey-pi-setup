"""
project_sync.py — Cross-platform MS Project XML (.xml) <-> Excel (.xlsx) 2-Way Sync, Plan Builder & Sprint Extractor.

Fixes & enhancements over draft:
- PercentComplete XML (0..100 integer scale) vs Excel (fraction 0..1 or 0..100%) bug fixed: XML 1 -> 0.01 (1%), never 1.0 (100%).
- `_SyncMeta` baseline & generation updated cleanly after `import_excel_to_msp_xml`.
- UTF-16 BOM / null-byte XXE check in `_assert_safe_xml_bytes`.
- `--use-com` Windows acceleration (`$app.DisplayAlerts = $false`) supported on msp2xlsx/xlsx2msp/mpp2xml.
- Configurable `profile.json` column/worksheet mapping (`load_sync_profile`), `build_msp_xml_from_excel` standalone plan builder,
  `extract_sprint_from_schedule` date-range sprint exporter, and per-conflict `resolutions` overrides.
"""

from __future__ import annotations

import datetime as dt
import shutil
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from venv_bootstrap import attach_omp_tools_venv

attach_omp_tools_venv()

import openpyxl  # noqa: E402
from openpyxl.styles import Font, PatternFill  # noqa: E402

import xml.etree.ElementTree as StdET  # noqa: N812

try:
    import defusedxml.ElementTree as SafeET  # type: ignore
    HAS_DEFUSEDXML = True
except ImportError:
    SafeET = StdET
    HAS_DEFUSEDXML = False

from core_pmo import sanitize_cell_formula_injection  # noqa: E402

MSP_NS = "http://schemas.microsoft.com/project"
XXE_FORBIDDEN_RE = re.compile(r"<!\s*(DOCTYPE|ENTITY)\b", re.IGNORECASE)

EXCEL_COLUMNS = ["UID", "UUID", "OutlineLevel", "Summary", "Task Name", "Start", "Finish", "Duration", "PercentComplete", "Notes", "Predecessors"]


class SyncConflictError(Exception):
    def __init__(self, conflicts: List[Dict[str, Any]]):
        self.conflicts = conflicts
        super().__init__(f"Sync blocked by {len(conflicts)} conflict(s)")


def _assert_safe_xml_bytes(xml_path: Path) -> bytes:
    raw = xml_path.read_bytes()
    decoded_candidates = [raw.decode("utf-8", errors="ignore")]
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")) or b"\x00<\x00" in raw[:64] or b"<\x00" in raw[:64]:
        for enc in ("utf-16", "utf-16-le", "utf-16-be"):
            try:
                decoded_candidates.append(raw.decode(enc, errors="ignore"))
            except Exception:
                pass
    for txt in decoded_candidates:
        if XXE_FORBIDDEN_RE.search(txt):
            raise ValueError(f"Unsafe XML blocked (DOCTYPE/ENTITY declarations forbidden): {xml_path}")
    return raw


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def _child_text(elem: Any, local_name: str, default: str = "") -> str:
    for child in elem:
        if _strip_ns(child.tag) == local_name:
            return (child.text or "").strip()
    return default


def _set_child_text(elem: Any, ns: str, local_name: str, value: str) -> None:
    for child in elem:
        if _strip_ns(child.tag) == local_name:
            child.text = value
            return
    sub_tag = f"{{{ns}}}{local_name}" if ns else local_name
    new_child = StdET.Element(sub_tag)
    new_child.text = value
    elem.append(new_child)


def _detect_ns(root_tag: str) -> str:
    return root_tag[1:].split("}", 1)[0] if root_tag.startswith("{") and "}" in root_tag else ""


def load_sync_profile(profile_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    if not profile_path:
        return {"worksheet": "Schedule", "firstDataRow": 2, "percentScale": "fraction", "columns": {c: c for c in EXCEL_COLUMNS}}
    data = json.loads(Path(profile_path).read_text(encoding="utf-8-sig"))
    src = data.get("sourceExcel", data)
    ws = src.get("worksheet", "Schedule")
    first_row = int(src.get("firstDataRow", 2))
    pct_scale = src.get("percentScale", "fraction")
    cols = dict(src.get("columns", {}))
    if not cols and "fields" in data:
        for fld in data["fields"]:
            src_name = fld.get("source") or fld.get("projectField")
            header_name = fld.get("header") or src_name
            if src_name:
                cols[src_name] = header_name
    return {"worksheet": ws, "firstDataRow": first_row, "percentScale": pct_scale, "columns": cols or {c: c for c in EXCEL_COLUMNS}}


def parse_msp_xml(xml_path: Union[str, Path]) -> List[Dict[str, Any]]:
    p = Path(xml_path)
    if not p.is_file():
        raise FileNotFoundError(f"MS Project XML file not found: {p}")
    _assert_safe_xml_bytes(p)
    tree = SafeET.parse(str(p))
    root = tree.getroot()
    tasks_container = next((c for c in root if _strip_ns(c.tag) == "Tasks"), None)
    if tasks_container is None:
        raise ValueError(f"Invalid MS Project XML: missing <Tasks> element in {p}")

    rows: List[Dict[str, Any]] = []
    for task_el in tasks_container:
        if _strip_ns(task_el.tag) != "Task":
            continue
        uid = _child_text(task_el, "UID")
        name = _child_text(task_el, "Name")
        if uid == "0" and not _child_text(task_el, "OutlineLevel"):
            continue
        level_raw = _child_text(task_el, "OutlineLevel", "1")
        level = int(level_raw) if level_raw.isdigit() else 1
        summary = _child_text(task_el, "Summary", "0") in ("1", "true", "True")
        guid = _child_text(task_el, "GUID") or f"uid-{uid}"
        pct_raw = _child_text(task_el, "PercentComplete", "0")
        try:
            # MS Project XML PercentComplete is ALWAYS 0..100 scale (1 -> 1% -> 0.01)
            pct = round(float(pct_raw) / 100.0, 4)
        except ValueError:
            pct = 0.0

        preds = [_child_text(sub, "PredecessorUID") for sub in task_el if _strip_ns(sub.tag) == "PredecessorLink" and _child_text(sub, "PredecessorUID")]
        rows.append({
            "UID": uid, "UUID": guid, "OutlineLevel": level, "Summary": summary, "Task Name": name,
            "Start": _child_text(task_el, "Start"), "Finish": _child_text(task_el, "Finish"),
            "Duration": _child_text(task_el, "Duration"), "PercentComplete": pct,
            "Notes": _child_text(task_el, "Notes"), "Predecessors": ",".join(preds),
        })

    if not rows:
        raise ValueError(f"No <Task> entries found in {p}")
    return rows


def export_msp_xml_to_excel(
    xml_path: Union[str, Path],
    xlsx_path: Union[str, Path],
    profile_path: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    rows = parse_msp_xml(xml_path)
    prof = load_sync_profile(profile_path)
    out = Path(xlsx_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = prof["worksheet"] if prof["worksheet"] != "_SyncMeta" else "Schedule"
    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    summary_font = Font(bold=True)

    hdr_row = max(1, prof["firstDataRow"] - 1)
    for c_idx, col_name in enumerate(EXCEL_COLUMNS, 1):
        cell = ws.cell(hdr_row, c_idx, col_name)
        cell.fill, cell.font = header_fill, header_font

    for r_idx, row in enumerate(rows, hdr_row + 1):
        for c_idx, col_name in enumerate(EXCEL_COLUMNS, 1):
            val = row.get(col_name, "")
            if isinstance(val, str):
                val = sanitize_cell_formula_injection(val)
            cell = ws.cell(r_idx, c_idx, val)
            if col_name == "PercentComplete":
                cell.number_format = "0%"
            if row["Summary"]:
                cell.font = summary_font

    meta = wb.create_sheet("_SyncMeta")
    meta.append(["schemaVersion", "sourceXml", "baselineJson", "generation"])
    meta.append([2, str(Path(xml_path).name), json.dumps(rows, ensure_ascii=False), 1])
    meta.sheet_state = "hidden"
    wb.save(out)
    wb.close()
    return {"source_xml": str(xml_path), "output_xlsx": str(out), "task_count": len(rows)}


def _parse_excel_pct(raw_val: Any, num_fmt: str = "", scale: str = "fraction") -> float:
    if raw_val is None or raw_val == "":
        return 0.0
    if isinstance(raw_val, str):
        s = raw_val.strip()
        if s.endswith("%"):
            return round(float(s[:-1].strip()) / 100.0, 4)
        val = float(s)
    else:
        val = float(raw_val)
    if scale == "0-100":
        return round(val / 100.0, 4)
    if "%" in (num_fmt or ""):
        return round(val, 4) if val <= 1.0 else round(val / 100.0, 4)
    return round(val / 100.0, 4) if val > 1.0 else round(val, 4)


def _read_excel_schedule_and_baseline(xlsx_path: Union[str, Path], worksheet_name: str = "Schedule") -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
    p = Path(xlsx_path)
    if not p.is_file():
        raise FileNotFoundError(f"Excel file not found: {p}")
    wb = openpyxl.load_workbook(p, data_only=True)
    ws_name = worksheet_name if worksheet_name in wb.sheetnames else ("Schedule" if "Schedule" in wb.sheetnames else None)
    if not ws_name:
        wb.close()
        raise ValueError("Excel workbook missing 'Schedule' sheet")
    if "_SyncMeta" not in wb.sheetnames:
        wb.close()
        raise ValueError("Excel workbook missing '_SyncMeta' baseline sheet")

    meta_ws = wb["_SyncMeta"]
    baseline_json = meta_ws.cell(2, 3).value
    gen_val = int(meta_ws.cell(2, 4).value or 1)
    if not baseline_json:
        wb.close()
        raise ValueError("Missing baseline JSON in '_SyncMeta' sheet")
    baseline_rows = json.loads(str(baseline_json))

    ws = wb[ws_name]
    hdr_row = 1
    headers = [str(ws.cell(hdr_row, c).value or "").strip() for c in range(1, ws.max_column + 1)]
    col_idx = {h: idx + 1 for idx, h in enumerate(headers) if h}
    for req in EXCEL_COLUMNS:
        if req not in col_idx:
            wb.close()
            raise ValueError(f"Schedule sheet missing required column '{req}'")

    excel_rows: List[Dict[str, Any]] = []
    for r in range(hdr_row + 1, ws.max_row + 1):
        uid = ws.cell(r, col_idx["UID"]).value
        name = ws.cell(r, col_idx["Task Name"]).value
        if uid is None and name is None:
            continue
        pct_cell = ws.cell(r, col_idx["PercentComplete"])
        pct = _parse_excel_pct(pct_cell.value, str(pct_cell.number_format or ""))
        raw_summary = ws.cell(r, col_idx["Summary"]).value
        summary = raw_summary if isinstance(raw_summary, bool) else str(raw_summary).strip().lower() in ("true", "1", "yes")
        raw_lvl = ws.cell(r, col_idx["OutlineLevel"]).value
        lvl = int(raw_lvl) if raw_lvl is not None else 1
        excel_rows.append({
            "UID": str(uid).strip(), "UUID": str(ws.cell(r, col_idx["UUID"]).value or "").strip(),
            "OutlineLevel": lvl, "Summary": summary,
            "Task Name": str(name or "").lstrip("'"),
            "Start": str(ws.cell(r, col_idx["Start"]).value or "").lstrip("'"),
            "Finish": str(ws.cell(r, col_idx["Finish"]).value or "").lstrip("'"),
            "Duration": str(ws.cell(r, col_idx["Duration"]).value or "").lstrip("'"),
            "PercentComplete": pct,
            "Notes": str(ws.cell(r, col_idx["Notes"]).value or "").lstrip("'"),
            "Predecessors": str(ws.cell(r, col_idx["Predecessors"]).value or "").lstrip("'"),
        })
    wb.close()
    return baseline_rows, excel_rows, gen_val


def _assert_structure_matches(base_rows: List[Dict[str, Any]], other_rows: List[Dict[str, Any]], label: str) -> None:
    if len(base_rows) != len(other_rows):
        raise ValueError(f"{label} row count ({len(other_rows)}) differs from baseline ({len(base_rows)}); insert/delete blocked.")
    for idx, (b, o) in enumerate(zip(base_rows, other_rows), 1):
        if str(b["UUID"]) != str(o["UUID"]) or int(b["OutlineLevel"]) != int(o["OutlineLevel"]) or bool(b["Summary"]) != bool(o["Summary"]):
            raise ValueError(f"{label} structure changed at row {idx} (UUID/OutlineLevel/Summary must match baseline).")


def import_excel_to_msp_xml(
    xlsx_path: Union[str, Path],
    project_xml_path: Union[str, Path],
    out_xml_path: Union[str, Path],
    conflict_policy: str = "Project",
    resolutions: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    if conflict_policy not in ("Project", "Excel", "Block"):
        raise ValueError(f"Invalid conflict_policy '{conflict_policy}'. Use Project, Excel, or Block.")
    res_map = resolutions or {}

    baseline_rows, excel_rows, gen_val = _read_excel_schedule_and_baseline(xlsx_path)
    project_rows = parse_msp_xml(project_xml_path)
    _assert_structure_matches(baseline_rows, project_rows, "Project")
    _assert_structure_matches(baseline_rows, excel_rows, "Excel")

    merged_rows, changes, conflicts, warnings = [], [], [], []
    for b, p, e in zip(baseline_rows, project_rows, excel_rows):
        merged = dict(p)
        for field in ("Task Name", "Start", "Finish", "PercentComplete", "Notes"):
            bv, pv, ev = b.get(field), p.get(field), e.get(field)
            if field == "PercentComplete":
                bv, pv, ev = round(float(bv or 0.0), 4), round(float(pv or 0.0), 4), round(float(ev or 0.0), 4)
            p_changed, e_changed = (pv != bv), (ev != bv)
            if p["Summary"] and field == "PercentComplete":
                if e_changed and ev != pv:
                    warnings.append({"uid": p["UID"], "field": field, "code": "SummaryProgressReadOnly"})
                continue
            if not e_changed or pv == ev:
                continue
            if not p_changed:
                merged[field] = ev
                changes.append({"uid": p["UID"], "field": field, "source": "Excel", "from": bv, "to": ev})
                continue

            # Conflict: check per-conflict override first
            ckey = f"{p['UID']}:{field}"
            override = res_map.get(ckey)
            if override == "Excel" or (override is None and conflict_policy == "Excel"):
                merged[field] = ev
                changes.append({"uid": p["UID"], "field": field, "source": "ConflictResolvedExcel", "from": pv, "to": ev})
                warnings.append({"uid": p["UID"], "field": field, "code": "ConflictResolvedExcel"})
            elif override == "Base":
                merged[field] = bv
                changes.append({"uid": p["UID"], "field": field, "source": "ConflictResolvedBase", "from": pv, "to": bv})
            elif override and override.startswith("Custom:"):
                custom_val = override[len("Custom:"):]
                merged[field] = float(custom_val) if field == "PercentComplete" else custom_val
                changes.append({"uid": p["UID"], "field": field, "source": "ConflictResolvedCustom", "from": pv, "to": merged[field]})
            elif override == "Project" or (override is None and conflict_policy == "Project"):
                warnings.append({"uid": p["UID"], "field": field, "code": "ConflictResolvedProject"})
            else:
                conflicts.append({"uid": p["UID"], "field": field, "base": bv, "project": pv, "excel": ev})
        merged_rows.append(merged)

    if conflicts:
        raise SyncConflictError(conflicts)

    _assert_safe_xml_bytes(Path(project_xml_path))
    tree = SafeET.parse(str(project_xml_path))
    root = tree.getroot()
    ns = _detect_ns(root.tag)
    if ns:
        StdET.register_namespace("", ns)

    tasks_container = next((c for c in root if _strip_ns(c.tag) == "Tasks"), None)
    by_uid = {row["UID"]: row for row in merged_rows}
    for task_el in tasks_container:
        if _strip_ns(task_el.tag) != "Task":
            continue
        uid = _child_text(task_el, "UID")
        if uid not in by_uid:
            continue
        row = by_uid[uid]
        _set_child_text(task_el, ns, "Name", str(row["Task Name"]))
        if row["Start"]:
            _set_child_text(task_el, ns, "Start", str(row["Start"]))
        if row["Finish"]:
            _set_child_text(task_el, ns, "Finish", str(row["Finish"]))
        _set_child_text(task_el, ns, "PercentComplete", str(int(round(float(row["PercentComplete"]) * 100))))
        if row["Notes"] or any(_strip_ns(c.tag) == "Notes" for c in task_el):
            _set_child_text(task_el, ns, "Notes", str(row["Notes"]))

    out = Path(out_xml_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    tree.write(str(out), encoding="utf-8", xml_declaration=True)

    # Update Excel _SyncMeta baseline & generation so subsequent merges diff against current state
    wb = openpyxl.load_workbook(xlsx_path)
    if "_SyncMeta" in wb.sheetnames:
        mws = wb["_SyncMeta"]
        mws.cell(2, 3, json.dumps(merged_rows, ensure_ascii=False))
        mws.cell(2, 4, gen_val + 1)
        wb.save(xlsx_path)
    wb.close()

    return {
        "input_xlsx": str(xlsx_path), "base_xml": str(project_xml_path), "output_xml": str(out),
        "conflict_policy": conflict_policy, "generation": gen_val + 1,
        "changes_applied": len(changes), "changes": changes, "warnings": warnings,
    }


def build_msp_xml_from_excel(xlsx_path: Union[str, Path], out_xml_path: Union[str, Path], project_name: Optional[str] = None) -> Dict[str, Any]:
    """Standalone Plan Builder: build clean MS Project MSPDI XML directly from a flat Excel schedule."""
    p = Path(xlsx_path)
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    ws = wb["Schedule"] if "Schedule" in wb.sheetnames else wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if len(rows) < 2:
        raise ValueError("Excel schedule must have header + >=1 task row")
    hdr = [str(h or "").strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(hdr) if h}
    root = StdET.Element("Project", xmlns=MSP_NS)
    StdET.SubElement(root, "Name").text = project_name or p.stem
    tasks_el = StdET.SubElement(root, "Tasks")
    built = 0
    for idx, r in enumerate(rows[1:], 1):
        name = str(r[col["Task Name"]] if "Task Name" in col and r[col["Task Name"]] is not None else (r[0] or "")).strip()
        if not name:
            continue
        t_el = StdET.SubElement(tasks_el, "Task")
        uid_val = str(r[col["UID"]] if "UID" in col and r[col["UID"]] is not None else idx)
        StdET.SubElement(t_el, "UID").text = uid_val
        StdET.SubElement(t_el, "ID").text = str(idx)
        StdET.SubElement(t_el, "Name").text = name.lstrip("'")
        lvl = str(r[col["OutlineLevel"]] if "OutlineLevel" in col and r[col["OutlineLevel"]] is not None else 1)
        StdET.SubElement(t_el, "OutlineLevel").text = lvl
        summ = r[col["Summary"]] if "Summary" in col else False
        StdET.SubElement(t_el, "Summary").text = "1" if str(summ).lower() in ("true", "1", "yes") else "0"
        if "Start" in col and r[col["Start"]]:
            StdET.SubElement(t_el, "Start").text = str(r[col["Start"]])
        if "Finish" in col and r[col["Finish"]]:
            StdET.SubElement(t_el, "Finish").text = str(r[col["Finish"]])
        pct_raw = r[col["PercentComplete"]] if "PercentComplete" in col and r[col["PercentComplete"]] is not None else 0
        pct_frac = _parse_excel_pct(pct_raw)
        StdET.SubElement(t_el, "PercentComplete").text = str(int(round(pct_frac * 100)))
        if "Predecessors" in col and r[col["Predecessors"]]:
            for pred in str(r[col["Predecessors"]]).split(","):
                if pred.strip():
                    pl = StdET.SubElement(t_el, "PredecessorLink")
                    StdET.SubElement(pl, "PredecessorUID").text = pred.strip()
        built += 1

    out = Path(out_xml_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    StdET.ElementTree(root).write(str(out), encoding="utf-8", xml_declaration=True)
    return {"input_xlsx": str(p), "output_xml": str(out), "tasks_written": built}


def extract_sprint_from_schedule(
    xml_path: Union[str, Path],
    sprint_start: str,
    sprint_end: str,
    output_xlsx: Optional[Union[str, Path]] = None,
    filter_mode: str = "overlap",
    leaves_only: bool = True,
) -> Dict[str, Any]:
    rows = parse_msp_xml(xml_path)
    s_win = dt.date.fromisoformat(sprint_start[:10])
    e_win = dt.date.fromisoformat(sprint_end[:10])
    selected: List[Dict[str, Any]] = []
    for r in rows:
        if leaves_only and r["Summary"]:
            continue
        st_s, fi_s = str(r.get("Start", ""))[:10], str(r.get("Finish", ""))[:10]
        if not st_s or not fi_s:
            continue
        try:
            ts, tf = dt.date.fromisoformat(st_s), dt.date.fromisoformat(fi_s)
        except ValueError:
            continue
        hit = (ts >= s_win and tf <= e_win) if filter_mode == "contained" else (ts <= e_win and tf >= s_win)
        if hit:
            selected.append(r)

    if output_xlsx:
        out = Path(output_xlsx)
        out.parent.mkdir(parents=True, exist_ok=True)
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Task Breakdown"
        ws.append(["Sprint Period", f"{sprint_start} .. {sprint_end}"])
        ws.append(EXCEL_COLUMNS)
        for r in selected:
            ws.append([sanitize_cell_formula_injection(r.get(c, "")) for c in EXCEL_COLUMNS])
        wb.save(out)
        wb.close()
    return {"sprint_start": sprint_start, "sprint_end": sprint_end, "filter_mode": filter_mode, "task_count": len(selected), "tasks": selected, "output_xlsx": str(output_xlsx) if output_xlsx else None}


def export_mpp_via_windows_com(mpp_path: Union[str, Path], xml_out_path: Union[str, Path]) -> Dict[str, Any]:
    mpp, xml_out = Path(mpp_path).resolve(), Path(xml_out_path).resolve()
    if not mpp.is_file():
        raise FileNotFoundError(f".mpp file not found: {mpp}")
    if sys.platform != "win32":
        mpxj_bin = shutil.which("mpxj")
        if mpxj_bin:
            xml_out.parent.mkdir(parents=True, exist_ok=True)
            res = subprocess.run([mpxj_bin, str(mpp), str(xml_out)], capture_output=True, text=True, check=False)
            if res.returncode != 0:
                raise RuntimeError(f"mpxj CLI conversion failed: {res.stderr.strip() or res.stdout.strip()}")
            return {"mpp_path": str(mpp), "xml_out": str(xml_out), "status": "exported_mpxj"}
        raise RuntimeError("Binary .mpp COM automation is Windows-only; install mpxj CLI on macOS/Linux or export .xml from MS Project.")
    xml_out.parent.mkdir(parents=True, exist_ok=True)
    ps_script = (
        "$ErrorActionPreference = 'Stop'; $app = $null; "
        "try { "
        "$app = New-Object -ComObject MSProject.Application; "
        "$app.Visible = $false; $app.DisplayAlerts = $false; "
        f"$app.FileOpenEx('{str(mpp).replace(chr(39), chr(39)*2)}', $true); "
        f"$app.FileSaveAs('{str(xml_out).replace(chr(39), chr(39)*2)}', 14); "
        "} finally { if ($app -ne $null) { try { $app.FileClose(0) } catch {}; try { $app.Quit(0) } catch {} } }"
    )
    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise RuntimeError(f"MSProject COM export failed: {res.stderr.strip() or res.stdout.strip()}")
    return {"mpp_path": str(mpp), "xml_out": str(xml_out), "status": "exported"}


def compare_schedule_workbooks(
    left_xlsx: Union[str, Path],
    right_xlsx: Union[str, Path],
    key_col: str = "UID",
    output_xlsx: Optional[Union[str, Path]] = None,
    profile_path: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    prof = load_sync_profile(profile_path)
    p_left, p_right = Path(left_xlsx), Path(right_xlsx)
    if not p_left.is_file():
        raise FileNotFoundError(f"Left schedule file not found: {p_left}")
    if not p_right.is_file():
        raise FileNotFoundError(f"Right schedule file not found: {p_right}")

    def _load_rows(p: Path) -> List[Dict[str, Any]]:
        wb = openpyxl.load_workbook(p, data_only=False)
        ws = wb[prof["worksheet"]] if prof["worksheet"] in wb.sheetnames else wb[wb.sheetnames[0]]
        first_r = prof.get("firstDataRow", 2)
        hdr_row = max(1, first_r - 1)
        headers = [str(ws.cell(hdr_row, c).value or "").strip() for c in range(1, ws.max_column + 1)]
        col_map = {h: idx + 1 for idx, h in enumerate(headers) if h}
        rows: List[Dict[str, Any]] = []
        for r in range(hdr_row + 1, ws.max_row + 1):
            item: Dict[str, Any] = {}
            for col_name, c_idx in col_map.items():
                item[col_name] = ws.cell(r, c_idx).value
            if any(v is not None and str(v).strip() != "" for v in item.values()):
                rows.append(item)
        wb.close()
        return rows

    left_rows = _load_rows(p_left)
    right_rows = _load_rows(p_right)

    left_by_key = {str(r.get(key_col, "")).strip(): r for r in left_rows if str(r.get(key_col, "")).strip()}
    right_by_key = {str(r.get(key_col, "")).strip(): r for r in right_rows if str(r.get(key_col, "")).strip()}

    added = [r for k, r in right_by_key.items() if k not in left_by_key]
    removed = [r for k, r in left_by_key.items() if k not in right_by_key]
    changed: List[Dict[str, Any]] = []
    identical = 0

    for k, l_row in left_by_key.items():
        if k in right_by_key:
            r_row = right_by_key[k]
            diff_fields: Dict[str, Dict[str, Any]] = {}
            for col in EXCEL_COLUMNS:
                if col in l_row or col in r_row:
                    lv = l_row.get(col)
                    rv = r_row.get(col)
                    if col == "PercentComplete":
                        lv_f = _parse_excel_pct(lv)
                        rv_f = _parse_excel_pct(rv)
                        if abs(lv_f - rv_f) > 0.0001:
                            diff_fields[col] = {"left": lv_f, "right": rv_f}
                    else:
                        if str(lv or "").strip() != str(rv or "").strip():
                            diff_fields[col] = {"left": lv, "right": rv}
            if diff_fields:
                changed.append({key_col: k, "name": r_row.get("Task Name") or l_row.get("Task Name", ""), "fields": diff_fields})
            else:
                identical += 1

    md_lines = [
        "# Schedule Comparison Report",
        "",
        f"- **Left (Baseline):** `{p_left.name}` ({len(left_rows)} tasks)",
        f"- **Right (Compare):** `{p_right.name}` ({len(right_rows)} tasks)",
        f"- **Summary:** Added: **{len(added)}**, Removed: **{len(removed)}**, Changed: **{len(changed)}**, Identical: **{identical}**",
        "",
    ]
    if changed:
        md_lines.extend(["## Changed Tasks", "| Key | Task Name | Changed Fields |", "|---|---|---|"])
        for c in changed:
            f_str = ", ".join(f"{k}: {v['left']} -> {v['right']}" for k, v in c["fields"].items())
            md_lines.append(f"| {c[key_col]} | {c['name']} | {f_str} |")
        md_lines.append("")
    if added:
        md_lines.extend(["## Added Tasks", f"Total: {len(added)} tasks added in right workbook.", ""])
    if removed:
        md_lines.extend(["## Removed Tasks", f"Total: {len(removed)} tasks missing from right workbook.", ""])

    if output_xlsx:
        out_p = Path(output_xlsx)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        wb = openpyxl.Workbook()
        ws_sum = wb.active
        ws_sum.title = "Summary"
        ws_sum.append(["Metric", "Value"])
        ws_sum.append(["Left Workbook", str(p_left.name)])
        ws_sum.append(["Right Workbook", str(p_right.name)])
        ws_sum.append(["Added Count", len(added)])
        ws_sum.append(["Removed Count", len(removed)])
        ws_sum.append(["Changed Count", len(changed)])
        ws_sum.append(["Identical Count", identical])

        if changed:
            ws_c = wb.create_sheet("Changed")
            ws_c.append(["Key", "Task Name", "Field", "Left Value", "Right Value"])
            for c in changed:
                for f_name, f_diff in c["fields"].items():
                    ws_c.append([
                        sanitize_cell_formula_injection(str(c[key_col])),
                        sanitize_cell_formula_injection(str(c["name"])),
                        f_name,
                        sanitize_cell_formula_injection(str(f_diff["left"])),
                        sanitize_cell_formula_injection(str(f_diff["right"])),
                    ])
        if added:
            ws_a = wb.create_sheet("Added")
            ws_a.append(EXCEL_COLUMNS)
            for r in added:
                ws_a.append([sanitize_cell_formula_injection(str(r.get(col, ""))) for col in EXCEL_COLUMNS])
        if removed:
            ws_r = wb.create_sheet("Removed")
            ws_r.append(EXCEL_COLUMNS)
            for r in removed:
                ws_r.append([sanitize_cell_formula_injection(str(r.get(col, ""))) for col in EXCEL_COLUMNS])

        wb.save(out_p)
        wb.close()

    return {
        "is_valid": True,
        "key_col": key_col,
        "left_count": len(left_rows),
        "right_count": len(right_rows),
        "added_count": len(added),
        "removed_count": len(removed),
        "changed_count": len(changed),
        "identical_count": identical,
        "markdown": "\n".join(md_lines),
        "output_xlsx": str(output_xlsx) if output_xlsx else None,
    }
