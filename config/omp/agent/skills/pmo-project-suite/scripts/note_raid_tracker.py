"""
note_raid_tracker.py — Daily Meeting Note (.pmn/.txt) Parser, RAID Excel Tracker & 7-Stage CI/CD.

Cross-platform (Windows, macOS, Linux) consolidated implementation of Note_multiline (`pmo.py` + `notes_to_tracker.py`).
Fixes:
- Per-sheet column indexing in `generate_raid_markdown_report` (`Decisions`/`QnA`/`CR_candidates`/`Risks`).
- English + Vietnamese closed status recognition (`đã đóng`, `hủy`, `đã chốt`, `hoàn thành`).
- `check_excel_locked()` deferred until write (`dry_run=True` works while Excel is open).
- Safe `auto_init=False` default against path typos + Dashboard COUNTIF formulas & dropdowns.
- Full CWE-1236 defense imported from `core_pmo` + backup rotation + 7-stage CI/CD helpers.
"""

from __future__ import annotations

import csv
import datetime as dt
import difflib
import hashlib
import json
import os
import platform
import re
import shutil
import unicodedata
from copy import copy
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from venv_bootstrap import attach_omp_tools_venv

attach_omp_tools_venv()

import openpyxl  # noqa: E402
from openpyxl.styles import Font, PatternFill  # noqa: E402
from openpyxl.worksheet.datavalidation import DataValidation  # noqa: E402

from core_pmo import sanitize_cell_formula_injection  # noqa: E402

HDR = re.compile(r"^##\s*(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\s*(.*)$")
HDR_NODATE = re.compile(r"^##\s*\?\?\s*(.*)$")
TAGLINE = re.compile(r"^([ADIRQCWN])\s*[:：]\s*(.*)$", re.I)
CONT_MARK = re.compile(r"^[+>*-]\s")
OWN = re.compile(r"(?<![\w.])@([\wÀ-ỹ.\-]+)")
DUE = re.compile(r"!(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?")

ROUTES = {"I": "Issues", "R": "Risks", "W": "Waiting_on", "D": "Decisions", "Q": "QnA", "C": "CR_candidates"}
PREFIX = {"Issues": "I", "Risks": "R", "Waiting_on": "W", "Decisions": "DEC", "QnA": "Q", "CR_candidates": "CR"}
MAX_ROW = {s: 300 for s in PREFIX}
INBOX, INBOX_FIRST, INBOX_LAST = "Inbox", 5, 504
NO_OWNER, NO_DECIDER, PICK = "<assign-owner>", "<assign-decider>", "<select>"

CLOSED_STATUSES = {"closed", "dropped", "done", "resolved", "approved", "đã đóng", "hủy", "đã chốt", "hoàn thành"}

# Explicit (description_col_idx, status_col_idx, owner_col_idx, due_col_idx) 0-indexed per sheet
SHEET_COL_MAP: Dict[str, Tuple[int, int, int, Optional[int]]] = {
    "Issues": (3, 12, 8, 9),
    "Risks": (1, 8, 7, None),
    "Waiting_on": (2, 5, 1, 4),
    "Decisions": (2, 5, 3, None),
    "QnA": (2, 5, 3, None),
    "CR_candidates": (1, 5, 6, None),
}

CSV_HEADERS = ["Date", "Meeting / Source", "Tag", "Content", "Owner", "Due Date", "Status", "Warnings / Notes"]

SHEET_HEADERS = {
    "Issues": ["ID", "Module", "Severity", "Issue Description", "Source", "Impact", "Proposed Support", "Recipient", "Owner", "Due Date", "Escalate Client?", "Channel", "Status"],
    "Risks": ["ID", "Risk Statement", "Category", "Probability", "Impact", "Mitigation", "Contingency", "Owner", "Status"],
    "Waiting_on": ["ID", "Waiting On", "Topic / Dependency", "Source", "Due Date", "Status", "Notes", "Days Overdue"],
    "Decisions": ["ID", "Date", "Decision", "Decided By", "Impact", "Status", "Source"],
    "QnA": ["ID", "Date", "Question", "Owner", "Answer", "Status", "Notes"],
    "CR_candidates": ["ID", "CR Description", "Source", "In Scope?", "Effort Impact", "Decision Status", "Owner"],
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def _is_closed(status_val: Any) -> bool:
    return str(status_val or "").strip().lower() in CLOSED_STATUSES


def key_of(entry: Dict[str, Any]) -> str:
    d = entry.get("date_raw") or ("?" + entry.get("mtg", ""))
    raw = f"{d}|{entry['tag']}|{_norm(entry['text'])}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _src_label(entry: Dict[str, Any]) -> str:
    d = entry["date"].strftime("%d/%m") if entry.get("date") else ""
    return (d + " " + entry.get("mtg", "")).strip()


def _as_date(val: Any) -> Optional[dt.date]:
    if isinstance(val, dt.datetime):
        return val.date()
    if isinstance(val, dt.date):
        return val
    if isinstance(val, str):
        s = val.strip()
        for pat, rev in ((r"^(\d{1,2})/(\d{1,2})/(\d{4})$", False), (r"^(\d{4})-(\d{1,2})-(\d{1,2})$", True)):
            m = re.match(pat, s)
            if m:
                try:
                    y, mo, d = (int(m[1]), int(m[2]), int(m[3])) if rev else (int(m[3]), int(m[2]), int(m[1]))
                    return dt.date(y, mo, d)
                except ValueError:
                    return None
    return None


def parse_notes_file(path: Union[str, Path], year: Optional[int] = None, warn_cb: Optional[Callable[[str], None]] = None) -> List[Dict[str, Any]]:
    year = year or dt.date.today().year
    say = warn_cb or (lambda _m: None)

    def _mk_date(d: str, m: str, y: Optional[str]) -> Optional[dt.date]:
        yr = int(y) if y else year
        yr += 2000 if yr < 100 else 0
        try:
            return dt.date(yr, int(m), int(d))
        except ValueError:
            return None

    out: List[Dict[str, Any]] = []

    def _emit(e: Dict[str, Any]) -> None:
        body = " | ".join(e["parts"])
        owners = list(dict.fromkeys(o.rstrip(".-") for o in OWN.findall(body) if o.rstrip(".-")))
        dues = list(DUE.finditer(body))
        due_d: Optional[dt.date] = None
        warn: List[str] = []
        if dues:
            due_d = _mk_date(dues[0][1], dues[0][2], dues[0][3])
            if not due_d:
                warn.append(f"INVALID_DATE {dues[0][0]}")
            if len(dues) > 1:
                warn.append("MULTIPLE_DUE_DATES")
        text = DUE.sub("", OWN.sub("", body))
        text = re.sub(r"(?<!\S)[@!](?!\S)", "", text)
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"(\|\s*)+\|", "|", text).strip(" -|")
        if not text:
            return
        if e["tag"] in "AW":
            if not owners:
                warn.append("MISSING_OWNER")
            if not dues:
                warn.append("MISSING_DUE_DATE")
        if len(owners) > 1:
            warn.append("MULTIPLE_OWNERS")
        out.append({
            "tag": e["tag"], "text": text, "owner": owners[0] if owners else "",
            "due": due_d.isoformat() if due_d else None, "due_date_obj": due_d,
            "due_raw": dues[0][0] if dues else "", "date": e["date"].isoformat() if e["date"] else None,
            "date_obj": e["date"], "date_raw": e["date_raw"], "mtg": e["mtg"], "warn": warn, "line": e["line"],
        })

    cur_date: Optional[dt.date] = None
    cur_raw, cur_mtg, cur = "", "", None

    def _flush() -> None:
        nonlocal cur
        if cur is not None:
            _emit(cur)
            cur = None

    with open(path, "r", encoding="utf-8-sig") as f:
        for line_no, raw in enumerate(f, 1):
            norm_line = unicodedata.normalize("NFC", raw.rstrip("\r\n")).expandtabs(4)
            s = norm_line.strip()
            if not s:
                _flush()
                continue
            ind = len(norm_line) - len(norm_line.lstrip())
            if s.startswith("//") or (s.startswith("#") and not s.startswith("##")):
                continue
            if cur is not None and not s.startswith("##") and (ind > cur["ind"] or CONT_MARK.match(s)):
                part = CONT_MARK.sub("", s, count=1).strip() if CONT_MARK.match(s) else s
                cur["parts"].append(part)
                continue
            if s.startswith("##"):
                _flush()
                n = HDR_NODATE.match(s)
                if n:
                    cur_date, cur_raw, cur_mtg = None, "", n[1].strip()
                    continue
                h = HDR.match(s)
                if h:
                    cur_date = _mk_date(h[1], h[2], h[3])
                    cur_raw = cur_date.strftime("%d/%m/%Y") if cur_date else f"!!INVALID_DATE {h[1]}/{h[2]}"
                    cur_mtg = h[4].strip()
                    continue
                say(f"[line {line_no}] Missing header date, use '## dd/mm Title' or '## ?? Title': {s[:50]}")
                cur_date, cur_raw, cur_mtg = None, "", s.lstrip("# ").strip()
                continue
            m = TAGLINE.match(s)
            if m:
                _flush()
                if m[2].strip():
                    cur = {"tag": m[1].upper(), "parts": [m[2].strip()], "date": cur_date, "date_raw": cur_raw, "mtg": cur_mtg, "ind": ind, "line": line_no}
                continue
            _flush()
            say(f"[line {line_no}] Ignored line: {s[:50]}")
        _flush()
    return out


def write_inbox_csv(entries: List[Dict[str, Any]], dest: Union[str, Path]) -> Tuple[Dict[str, int], int]:
    stats: Dict[str, int] = {}
    n_warn = 0
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADERS)
        for e in entries:
            stats[e["tag"]] = stats.get(e["tag"], 0) + 1
            n_warn += int(bool(e["warn"]))
            due_str = e["due_date_obj"].strftime("%d/%m/%Y") if e.get("due_date_obj") else ""
            writer.writerow([e["date_raw"], e["mtg"], e["tag"], e["text"], e["owner"], due_str, "Open" if e["tag"] in "AWIRQC" else "", "; ".join(e["warn"])])
    return stats, n_warn


def check_excel_locked(book_path: Union[str, Path]) -> bool:
    p = Path(book_path)
    if not p.exists():
        return False
    try:
        with open(p, "r+b") as f:
            if platform.system() == "Windows":
                import msvcrt
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            return False
    except (PermissionError, BlockingIOError):
        return True
    except OSError as exc:
        return getattr(exc, "winerror", None) in (32, 33)


def init_tracker_workbook(book_path: Union[str, Path], project_name: str = "Default Project") -> Path:
    p = Path(book_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)

    dash = wb.active
    dash.title = "Dashboard"
    dash["A1"], dash["B1"] = "Project", project_name
    dash["A2"], dash["B2"] = "Status Date", dt.date.today()
    dash["B2"].number_format = "dd/mm/yyyy"
    dash["A4"], dash["B4"], dash["C4"] = "Register", "Total", "Open"
    for idx, sname in enumerate(PREFIX, 5):
        dash.cell(idx, 1, sname)
        dash.cell(idx, 2, f'=COUNTA({sname}!A2:A300)')
        status_col_letter = openpyxl.utils.get_column_letter(SHEET_COL_MAP[sname][1] + 1)
        dash.cell(idx, 3, f'=COUNTIF({sname}!{status_col_letter}2:{status_col_letter}300,"Open")')

    inbox = wb.create_sheet(INBOX)
    inbox["A1"] = f"{project_name} - Daily Note Inbox"
    for c_idx, h in enumerate(CSV_HEADERS, 1):
        c = inbox.cell(4, c_idx, h)
        c.fill, c.font = header_fill, header_font

    sev_dv = DataValidation(type="list", formula1='"Critical,Major,Minor"', allow_blank=True)
    st_dv = DataValidation(type="list", formula1='"Open,In Progress,Closed,Dropped"', allow_blank=True)

    for sheet_name, cols in SHEET_HEADERS.items():
        ws = wb.create_sheet(sheet_name)
        for c_idx, h in enumerate(cols, 1):
            c = ws.cell(1, c_idx, h)
            c.fill, c.font = header_fill, header_font
        if sheet_name == "Issues":
            ws.add_data_validation(sev_dv)
            sev_dv.add("C2:C300")
        ws.add_data_validation(st_dv)
        st_col = openpyxl.utils.get_column_letter(SHEET_COL_MAP[sheet_name][1] + 1)
        st_dv.add(f"{st_col}2:{st_col}300")

    led = wb.create_sheet("_Loaded")
    led.append(["key", "loaded_at", "source_file", "target"])
    led.sheet_state = "hidden"
    wb.save(p)
    wb.close()
    return p


def _last_row(ws: Any, col: int) -> int:
    for r in range(ws.max_row, 0, -1):
        if ws.cell(r, col).value not in (None, ""):
            return r
    return 1


def _next_id(ws: Any, prefix: str, pending: List[int]) -> Tuple[int, str]:
    pat = re.compile(rf"^{prefix}-(\d+)$")
    nums = [int(m[1]) for (v,) in ws.iter_rows(min_col=1, max_col=1, values_only=True) if isinstance(v, str) and (m := pat.match(v))]
    n = max(nums + pending, default=0) + 1
    return n, f"{prefix}-{n:02d}"


def _build_row(sheet: str, e: Dict[str, Any], rid: str, row_num: int) -> List[Any]:
    owner, due_d, date_d = e["owner"], e.get("due_date_obj"), e.get("date_obj")
    src = _src_label({"date": date_d, "mtg": e.get("mtg", "")})
    txt_due = e["text"] + (f" (due {due_d:%d/%m/%Y})" if due_d else "")
    if sheet == "Issues":
        return [rid, "", PICK, e["text"], src, "", "", "", owner or NO_OWNER, due_d, "N", "Direct", "Open"]
    if sheet == "Risks":
        return [rid, txt_due, "", "", "", "", "", owner or NO_OWNER, "Open"]
    if sheet == "Waiting_on":
        formula = f'=IF(AND(E{row_num}<>"",F{row_num}<>"Closed",E{row_num}<Dashboard!$B$2),Dashboard!$B$2-E{row_num},0)'
        return [rid, owner or NO_OWNER, e["text"], src, due_d, "Open", "", formula]
    if sheet == "Decisions":
        return [rid, date_d, txt_due, owner or NO_DECIDER, "", "Approved", src]
    if sheet == "QnA":
        return [rid, date_d, txt_due, owner, "", "Open", ""]
    if sheet == "CR_candidates":
        return [rid, txt_due, src, "?", "?", "Pending Review", owner]
    raise KeyError(sheet)


def _put_row(ws: Any, r: int, values: List[Any], style_row: Optional[int], sheet_name: str) -> None:
    for c, v in enumerate(values, 1):
        cell = ws.cell(r, c)
        if not (sheet_name == "Waiting_on" and c == 8 and isinstance(v, str) and v.startswith("=IF(")):
            v = sanitize_cell_formula_injection(v)
        cell.value = v
        if isinstance(v, str) and v.startswith("'"):
            cell.data_type = "s"
        if style_row and style_row != r:
            cell._style = copy(ws.cell(style_row, c)._style)
        if isinstance(v, (dt.date, dt.datetime)):
            cell.number_format = "dd/mm/yyyy"


def _rotate_backups(backup_dir: Union[str, Path], stem: str, suffix: str = ".xlsx", max_backups: int = 30) -> None:
    bdir = Path(backup_dir)
    if not bdir.exists() or max_backups <= 0:
        return
    baks = sorted(bdir.glob(f"{stem}.bak_*{suffix}"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in baks[max_backups:]:
        try:
            old.unlink()
        except OSError:
            pass


def sync_notes_to_tracker(
    note_files: Union[str, Path, List[Union[str, Path]]],
    book_path: Union[str, Path],
    year: Optional[int] = None,
    dry_run: bool = False,
    backup_dir: Optional[Union[str, Path]] = None,
    max_backups: int = 30,
    owner_aliases: Optional[Dict[str, str]] = None,
    auto_init: bool = False,
    update_dashboard_date: Optional[dt.date] = None,
) -> Dict[str, Any]:
    year = year or dt.date.today().year
    note_list = [Path(note_files)] if isinstance(note_files, (str, Path)) else [Path(p) for p in note_files]
    book = Path(book_path)
    alias_map = {k.casefold(): v for k, v in (owner_aliases or {}).items()}

    if not book.exists():
        if auto_init and not dry_run:
            init_tracker_workbook(book)
        elif not dry_run:
            raise FileNotFoundError(f"Tracker workbook not found: {book}")

    all_entries: List[Dict[str, Any]] = []
    syntax_warnings: List[str] = []
    for np in note_list:
        for e in parse_notes_file(np, year=year, warn_cb=lambda m, fn=np.name: syntax_warnings.append(f"[{fn}] {m}")):
            e["source_file"] = np.name
            if e["owner"] and alias_map:
                e["owner"] = alias_map.get(e["owner"].casefold(), e["owner"])
            all_entries.append(e)

    if dry_run and not book.exists():
        preview_counts: Dict[str, int] = {}
        for e in all_entries:
            s = ROUTES.get(e["tag"], INBOX)
            preview_counts[s] = preview_counts.get(s, 0) + 1
        return {"dry_run": True, "parsed_count": len(all_entries), "added_count": len(all_entries), "skipped_dup": 0, "sheet_counts": preview_counts, "syntax_warnings": syntax_warnings, "backup_path": None}

    if not dry_run and check_excel_locked(book):
        raise PermissionError(f"Workbook is currently locked in Excel: {book}")

    wb = openpyxl.load_workbook(book, read_only=dry_run)
    missing = [s for s in list(PREFIX) + [INBOX] if s not in wb.sheetnames]
    if missing:
        wb.close()
        raise ValueError(f"Tracker missing required sheets: {missing}")

    if "_Loaded" in wb.sheetnames:
        led = wb["_Loaded"]
        seen = {row[0] for row in led.iter_rows(min_row=2, max_col=1, values_only=True) if row and row[0]}
    elif dry_run:
        led, seen = None, set()
    else:
        led = wb.create_sheet("_Loaded")
        led.append(["key", "loaded_at", "source_file", "target"])
        led.sheet_state = "hidden"
        seen = set()

    pend_ids: Dict[str, List[int]] = {s: [] for s in PREFIX}
    nxt = {s: _last_row(wb[s], 1) + 1 for s in PREFIX}
    nxt[INBOX] = max(_last_row(wb[INBOX], 4) + 1, INBOX_FIRST)

    added_by_sheet: Dict[str, int] = {}
    skipped_dup, skipped_full = 0, []
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M")

    for e in all_entries:
        k = key_of(e)
        if k in seen:
            skipped_dup += 1
            continue
        sheet = ROUTES.get(e["tag"], INBOX)
        ws = wb[sheet]
        r = nxt[sheet]
        if r > (INBOX_LAST if sheet == INBOX else MAX_ROW[sheet]):
            skipped_full.append((sheet, e["line"], e["text"][:40]))
            continue
        style_row = r - 1 if r - 1 >= (INBOX_FIRST if sheet == INBOX else 2) else None
        if sheet == INBOX:
            warn = list(e["warn"]) + (["INVALID_HEADER_DATE"] if e["date_raw"].startswith("!!") else [])
            vals = [e.get("date_obj"), e["mtg"], e["tag"], e["text"], e["owner"], e.get("due_date_obj"), "Open" if e["tag"] == "A" else "", "; ".join(warn)]
            rid = f"Inbox!{r}"
        else:
            n, rid = _next_id(ws, PREFIX[sheet], pend_ids[sheet])
            pend_ids[sheet].append(n)
            vals = _build_row(sheet, e, rid, r)
        if not dry_run:
            _put_row(ws, r, vals, style_row, sheet_name=sheet)
            if led is not None:
                led.append([k, now, e.get("source_file", note_list[0].name), rid])
        seen.add(k)
        nxt[sheet] = r + 1
        added_by_sheet[sheet] = added_by_sheet.get(sheet, 0) + 1

    added_total = sum(added_by_sheet.values())
    backup_path: Optional[str] = None
    if not dry_run and added_total > 0:
        if update_dashboard_date and "Dashboard" in wb.sheetnames:
            wb["Dashboard"]["B2"] = update_dashboard_date
            wb["Dashboard"]["B2"].number_format = "dd/mm/yyyy"
        ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        bdir = Path(backup_dir) if backup_dir else (book.parent / "backups")
        bdir.mkdir(parents=True, exist_ok=True)
        bak = bdir / f"{book.stem}.bak_{ts}{book.suffix}"
        shutil.copy2(book, bak)
        _rotate_backups(bdir, book.stem, book.suffix, max_backups=max_backups)
        backup_path = str(bak)
        wb.save(book)

    wb.close()
    return {
        "dry_run": dry_run, "parsed_count": len(all_entries), "added_count": added_total,
        "skipped_dup": skipped_dup, "skipped_full": skipped_full, "sheet_counts": added_by_sheet,
        "syntax_warnings": syntax_warnings, "backup_path": backup_path,
        "inbox_free": max(0, INBOX_LAST - nxt[INBOX] + 1), "entries": all_entries,
    }


def inspect_tracker_state(book_path: Union[str, Path], ref_date: Optional[dt.date] = None, upcoming_days: int = 7) -> Dict[str, Any]:
    ref_d = ref_date or dt.date.today()
    wb = openpyxl.load_workbook(book_path, read_only=True, data_only=True)
    try:
        summary: Dict[str, Dict[str, int]] = {}
        overdue_items, upcoming_items, open_waiting, pending_human = [], [], [], []

        for sname, (d_col, st_col, ow_col, due_col) in SHEET_COL_MAP.items():
            if sname not in wb.sheetnames:
                continue
            ws = wb[sname]
            tot = op = cl = ov = hum = 0
            for row in ws.iter_rows(min_row=2, values_only=True):
                if not row or not row[0]:
                    continue
                tot += 1
                rid = str(row[0])
                desc = str(row[d_col] if len(row) > d_col and row[d_col] is not None else "").strip()
                st = str(row[st_col] if len(row) > st_col and row[st_col] is not None else "Open").strip()
                own = str(row[ow_col] if len(row) > ow_col and row[ow_col] is not None else "").strip()
                due = _as_date(row[due_col]) if due_col is not None and len(row) > due_col else None
                if _is_closed(st):
                    cl += 1
                    continue
                op += 1
                if own in ("", NO_OWNER, NO_DECIDER):
                    hum += 1
                    pending_human.append({"sheet": sname, "id": rid, "owner": own, "text": desc[:100]})
                if sname == "Waiting_on":
                    diff = (due - ref_d).days if due else None
                    open_waiting.append({"sheet": sname, "id": rid, "owner": own or NO_OWNER, "text": desc, "due": due, "days_overdue": -diff if (diff is not None and diff < 0) else 0, "days_left": diff if (diff is not None and diff >= 0) else None})
                if due:
                    diff = (due - ref_d).days
                    if diff < 0:
                        ov += 1
                        overdue_items.append({"sheet": sname, "id": rid, "owner": own, "due": due, "days_overdue": -diff, "text": desc[:100]})
                    elif diff <= upcoming_days:
                        upcoming_items.append({"sheet": sname, "id": rid, "owner": own, "due": due, "days_left": diff, "text": desc[:100]})
            summary[sname] = {"total": tot, "open": op, "closed": cl, "overdue": ov, "needs_human": hum}

        if INBOX in wb.sheetnames:
            ws = wb[INBOX]
            in_tot = in_open = in_closed = in_over = in_no_own = 0
            last_used = INBOX_FIRST - 1
            for r_idx, row in enumerate(ws.iter_rows(min_row=INBOX_FIRST, max_row=INBOX_LAST, max_col=8, values_only=True), INBOX_FIRST):
                if not row or not row[3]:
                    continue
                last_used = r_idx
                in_tot += 1
                tag = str(row[2] or "").strip().upper()
                own = str(row[4] or "").strip()
                due = _as_date(row[5])
                st = str(row[6] or "").strip()
                if _is_closed(st):
                    in_closed += 1
                    continue
                if tag == "A":
                    in_open += 1
                if not own and tag == "A":
                    in_no_own += 1
                if due and tag == "A":
                    diff = (due - ref_d).days
                    if diff < 0:
                        in_over += 1
                        overdue_items.append({"sheet": INBOX, "id": f"Inbox!{r_idx}", "owner": own or "<unassigned>", "due": due, "days_overdue": -diff, "text": str(row[3])[:100]})
                    elif diff <= upcoming_days:
                        upcoming_items.append({"sheet": INBOX, "id": f"Inbox!{r_idx}", "owner": own or "<unassigned>", "due": due, "days_left": diff, "text": str(row[3])[:100]})
            summary[INBOX] = {"total": in_tot, "open": in_open, "closed": in_closed, "overdue": in_over, "needs_human": in_no_own}
            inbox_free = max(0, INBOX_LAST - last_used)
        else:
            inbox_free = 0

        return {
            "report_date": ref_d.isoformat(), "sheets_summary": summary,
            "raid_pending": pending_human, "overdue_items": sorted(overdue_items, key=lambda x: (-x["days_overdue"], x["id"])),
            "upcoming_items": sorted(upcoming_items, key=lambda x: (x["days_left"], x["id"])),
            "open_waiting": open_waiting, "inbox_free": inbox_free,
        }
    finally:
        wb.close()


def generate_raid_markdown_report(book_path: Union[str, Path], output_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    state = inspect_tracker_state(book_path)
    summary = state["sheets_summary"]
    wb = openpyxl.load_workbook(book_path, read_only=True, data_only=True)
    open_items: List[str] = []
    for sname, (d_col, st_col, _ow, _due) in SHEET_COL_MAP.items():
        if sname not in wb.sheetnames:
            continue
        for row in wb[sname].iter_rows(min_row=2, values_only=True):
            if not row or not row[0]:
                continue
            st_val = str(row[st_col] if len(row) > st_col and row[st_col] is not None else "Open").strip()
            if not _is_closed(st_val):
                desc = str(row[d_col] if len(row) > d_col and row[d_col] is not None else "").strip()
                open_items.append(f"- **[{sname}] {row[0]}**: {desc[:120]} *(Status: {st_val})*")
    wb.close()

    lines = [
        f"# RAID Tracker Report ({Path(book_path).name})",
        f"Generated: {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "", "## Summary by Register", "| Sheet | Total | Open | Closed |", "|---|---:|---:|---:|",
    ]
    for s, counts in summary.items():
        lines.append(f"| {s} | {counts['total']} | {counts['open']} | {counts['closed']} |")
    lines.extend(["", "## Open Items"])
    lines.extend(open_items if open_items else ["- *No open items.*"])
    md = "\n".join(lines)
    if output_path:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(md + "\n", encoding="utf-8")
    return {"tracker": str(book_path), "summary": summary, "open_count": len(open_items), "markdown": md}


# ==============================================================================
# 7-STAGE NOTE CI/CD WORKFLOW (PORTED FROM pmo.py — GENERIC & CROSS-OS)
# ==============================================================================

def load_pmo_config(cfg_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    if cfg_path and Path(cfg_path).is_file():
        return json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    return {
        "version": "2.0.0", "project_name": "Default Project", "tracker_path": "RAID_tracker.xlsx",
        "notes_dir": "notes", "backup_dir": "backups", "max_backups": 30, "reports_dir": "reports",
        "archive_notes_dir": "archive/notes", "archive_inbox_dir": "archive/inbox",
        "note_retention_days": 30, "inbox_warn_free_rows": 50, "default_year": None,
        "owner_aliases": {}, "known_members": [],
    }


def stage_doctor(cfg: Dict[str, Any]) -> Dict[str, Any]:
    tracker = Path(cfg.get("tracker_path", "RAID_tracker.xlsx"))
    issues: List[str] = []
    if not tracker.exists():
        issues.append(f"Missing tracker: {tracker}")
    elif check_excel_locked(tracker):
        issues.append(f"Tracker locked in Excel: {tracker}")
    return {"ok": len(issues) == 0, "tracker": str(tracker), "issues": issues}


def stage_lint(note_files: List[Union[str, Path]], cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = cfg or {}
    year = cfg.get("default_year") or dt.date.today().year
    alias_map = {k.casefold(): v for k, v in cfg.get("owner_aliases", {}).items()}
    known = set(cfg.get("known_members", []))
    warnings: List[Dict[str, Any]] = []
    suggestions: List[Dict[str, str]] = []
    total_entries = 0

    for nf in note_files:
        entries = parse_notes_file(nf, year=year)
        total_entries += len(entries)
        for e in entries:
            if e["warn"]:
                warnings.append({"file": Path(nf).name, "line": e["line"], "tag": e["tag"], "warn": e["warn"]})
            own = e["owner"]
            if own:
                norm_own = alias_map.get(own.casefold(), own)
                if norm_own != own:
                    suggestions.append({"file": Path(nf).name, "line": str(e["line"]), "from": own, "to": norm_own})
                elif known and own not in known:
                    m = difflib.get_close_matches(own, known, n=1, cutoff=0.6)
                    if m:
                        suggestions.append({"file": Path(nf).name, "line": str(e["line"]), "from": own, "to": m[0]})
    return {"ok": len(warnings) == 0, "total_entries": total_entries, "warnings": warnings, "owner_suggestions": suggestions}


def stage_action_plan(book_path: Union[str, Path], note_files: Optional[List[Union[str, Path]]] = None, output_path: Optional[Union[str, Path]] = None, ref_date: Optional[dt.date] = None) -> Dict[str, Any]:
    ref_d = ref_date or dt.date.today()
    state = inspect_tracker_state(book_path, ref_date=ref_d, upcoming_days=7)
    today_entries: List[Dict[str, Any]] = []
    seen_texts = set()
    for nf in (note_files or []):
        for e in parse_notes_file(nf, year=ref_d.year):
            if e["date"] is None or e["date"] == ref_d.isoformat():
                today_entries.append(e)
                seen_texts.add(re.sub(r"\s+", " ", e["text"].strip().lower()))

    raid_items = [it for it in state["overdue_items"] if not it["id"].startswith("Inbox!")] + state["open_waiting"]
    stop = {"the", "and", "for", "with", "cho", "của", "và", "các", "để"}

    def _jaccard_link(txt: str, due: Optional[dt.date]) -> Optional[str]:
        w1 = set(re.findall(r"[\wÀ-ỹ]+", txt.lower())) - stop
        if not w1:
            return None
        for r in raid_items:
            if r.get("due") == due:
                w2 = set(re.findall(r"[\wÀ-ỹ]+", str(r.get("text", "")).lower())) - stop
                if w2 and (len(w1 & w2) / len(w1 | w2)) >= 0.4:
                    return str(r["id"])
        return None

    recent_overdue = []
    for it in state["overdue_items"]:
        norm_t = re.sub(r"\s+", " ", it["text"].strip().lower())
        if it["days_overdue"] <= 30 and norm_t not in seen_texts:
            linked = _jaccard_link(it["text"], it.get("due")) if it["id"].startswith("Inbox!") else None
            recent_overdue.append({**it, "linked_id": linked})

    stale_overdue = [it for it in state["overdue_items"] if it["days_overdue"] > 30]
    lines = [
        f"# PMO Action Plan ({ref_d.isoformat()})",
        "", f"## 1. Today's Note Tasks ({len(today_entries)})",
    ]
    lines.extend(f"- [ ] [{e['tag']}] @{e['owner'] or 'unassigned'}: {e['text']}" for e in today_entries or [{"tag": "-", "owner": "", "text": "*None*"}][:0])
    if not today_entries:
        lines.append("*No new tasks recorded today.*")
    lines.extend(["", f"## 2. Recent Overdue <= 30d ({len(recent_overdue)})"])
    for it in recent_overdue:
        link = f" (≈ {it['linked_id']})" if it.get("linked_id") else ""
        lines.append(f"- [ ] **[{it['id']}]** @{it['owner'] or 'unassigned'} (-{it['days_overdue']}d): {it['text']}{link}")
    lines.extend(["", f"## 3. Upcoming <= 7d ({len(state['upcoming_items'])})"])
    for it in state["upcoming_items"]:
        lines.append(f"- [ ] **[{it['id']}]** @{it['owner'] or 'unassigned'} (+{it['days_left']}d): {it['text']}")
    lines.extend(["", f"## 4. Open Waiting On ({len(state['open_waiting'])})"])
    for it in state["open_waiting"]:
        lines.append(f"- [ ] **[{it['id']}]** @{it['owner']}: {it['text']}")
    lines.extend(["", f"## 5. Stale Overdue > 30d ({len(stale_overdue)})"])
    for it in stale_overdue[:15]:
        lines.append(f"- [ ] **[{it['id']}]** (-{it['days_overdue']}d): {it['text']}")
    md = "\n".join(lines) + "\n"
    if output_path:
        p = Path(output_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(md, encoding="utf-8")
    return {"today_count": len(today_entries), "recent_overdue": len(recent_overdue), "upcoming": len(state["upcoming_items"]), "waiting": len(state["open_waiting"]), "stale": len(stale_overdue), "markdown": md}


def archive_inbox_rows(book_path: Union[str, Path], archive_csv_path: Union[str, Path], include_notes: bool = False, backup_dir: Optional[Union[str, Path]] = None, max_backups: int = 30) -> Dict[str, Any]:
    book = Path(book_path)
    if check_excel_locked(book):
        raise PermissionError(f"Workbook is locked: {book}")
    wb = openpyxl.load_workbook(book)
    ws = wb[INBOX]
    last_in = max(_last_row(ws, 4), INBOX_FIRST - 1)
    to_archive, to_keep = [], []
    for r in range(INBOX_FIRST, min(last_in, INBOX_LAST) + 1):
        vals = [ws.cell(r, c).value for c in range(1, 9)]
        if all(v in (None, "") for v in vals):
            continue
        tag = str(vals[2] or "").strip().upper()
        st = str(vals[6] or "").strip().lower()
        if _is_closed(st) or (include_notes and tag == "N" and st not in ("open", "in progress")):
            to_archive.append((r, vals))
        else:
            to_keep.append((r, vals))
    if not to_archive:
        wb.close()
        return {"archived_count": 0, "kept_count": len(to_keep), "free_rows": INBOX_LAST - max(last_in, INBOX_FIRST - 1)}

    csv_p = Path(archive_csv_path)
    csv_p.parent.mkdir(parents=True, exist_ok=True)
    hdr_needed = not csv_p.exists()
    with open(csv_p, "a", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        if hdr_needed:
            w.writerow(CSV_HEADERS + ["Archived_At", "Original_Row"])
        now_s = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for orig_r, vals in to_archive:
            w.writerow([sanitize_cell_formula_injection(v) for v in vals] + [now_s, orig_r])

    for idx, (_, vals) in enumerate(to_keep):
        _put_row(ws, INBOX_FIRST + idx, vals, None, INBOX)
    for r in range(INBOX_FIRST + len(to_keep), last_in + 1):
        for c in range(1, 9):
            ws.cell(r, c).value = None

    bdir = Path(backup_dir) if backup_dir else (book.parent / "backups")
    bdir.mkdir(parents=True, exist_ok=True)
    bak = bdir / f"{book.stem}.bak_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}{book.suffix}"
    shutil.copy2(book, bak)
    _rotate_backups(bdir, book.stem, book.suffix, max_backups=max_backups)
    wb.save(book)
    wb.close()
    free_after = INBOX_LAST - (INBOX_FIRST + len(to_keep) - 1)
    return {"archived_count": len(to_archive), "kept_count": len(to_keep), "free_rows": free_after, "archive_csv": str(csv_p), "backup_path": str(bak)}


def stage_roll_note(note_path: Union[str, Path], book_path: Union[str, Path], archive_notes_dir: Union[str, Path] = "archive/notes", force: bool = False) -> Dict[str, Any]:
    np = Path(note_path)
    if not np.is_file():
        raise FileNotFoundError(f"Note file not found: {np}")
    entries = parse_notes_file(np)
    loaded: Set[str] = set()
    if Path(book_path).is_file():
        wb = openpyxl.load_workbook(book_path, read_only=True, data_only=True)
        if "_Loaded" in wb.sheetnames:
            loaded = {row[0] for row in wb["_Loaded"].iter_rows(min_row=2, max_col=1, values_only=True) if row and row[0]}
        wb.close()
    unloaded = [e for e in entries if key_of(e) not in loaded]
    if unloaded and not force:
        return {"rolled": False, "reason": "UNLOADED_ENTRIES", "unloaded_count": len(unloaded)}
    sub = Path(archive_notes_dir) / dt.date.today().strftime("%Y-%m")
    sub.mkdir(parents=True, exist_ok=True)
    dest = sub / f"{np.stem}_archived_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}{np.suffix}"
    shutil.copy2(np, dest)
    tpl = f"## {dt.date.today():%d/%m/%Y} Project Sync\n\tA: @ !\n\tW: @ !\n\tI: \n\tR: \n\tD: \n\tQ: @ !\n\tC: \n\tN: \n"
    np.write_text(tpl, encoding="utf-8")
    return {"rolled": True, "archived_to": str(dest), "reset_file": str(np)}
