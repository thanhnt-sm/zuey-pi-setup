"""
email_parser.py — Cross-Platform .eml/.msg Email Threading, Deduplication & Issue Extraction Engine.

Pure Python (stdlib `email` + optional `extract_msg` + `openpyxl`) for Windows/macOS/Linux,
with optional Windows-only Outlook MAPI COM ingestion adapter.
"""

from __future__ import annotations

import email
import email.policy
import email.utils
import hashlib
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from venv_bootstrap import attach_omp_tools_venv

attach_omp_tools_venv()

import openpyxl  # noqa: E402
from openpyxl.styles import Alignment, Font, PatternFill  # noqa: E402

PREFIX_RE = re.compile(
    r"^\s*(?:(?:RE|FW|FWD|TR|Trả lời|Tra loi)\s*:\s*|\[[^\]]+\]\s*:?\s*)",
    re.IGNORECASE,
)
INLINE_LOGO_RE = re.compile(r"^(?:image\d+|logo|icon|banner|footer)\.(?:png|jpe?g|gif|bmp|webp)$", re.IGNORECASE)
EMAIL_RE = re.compile(r"[\w.\-]+@[\w.\-]+\.\w+")
TICKET_RE = re.compile(r"#{2}(\d{4,})#{2}|(?:ID|Ticket|Mã ticket)\s*(?:là|:)\s*#*(\d{4,})", re.IGNORECASE)

QUOTE_BOUNDARIES = (
    re.compile(r"^_{5,}\s*$"),
    re.compile(r"^-{5,}\s*$"),
    re.compile(r"^\s*(?:From|Từ|Sent|Đã gửi|To|Đến|Cc)\s*:", re.IGNORECASE),
    re.compile(r"^\s*On .+ wrote:\s*$", re.IGNORECASE),
    re.compile(r"^\s*Vào .+ đã viết:\s*$", re.IGNORECASE),
    re.compile(r"^\s*(?:Trân trọng|Thanks (?:and|&) (?:best )?regards|Best regards|Regards|Kind regards|BR,|Thân ái|Kính thư)[,\s]*$", re.IGNORECASE),
    re.compile(r"^>"),
)
SIGNATURE_LINE_RE = re.compile(
    r"^\s*(?:Mobile|Tel|Fax|Ext|Hotline|Website|Web|Phone|Điện thoại|Đ/c|Địa chỉ|Add|Address)\s*:\s*.*$",
    re.IGNORECASE,
)
DISCLAIMER_PATTERNS = (
    re.compile(r"This e-?mail and any files? transmitted with it are confidential", re.IGNORECASE),
    re.compile(r"If you have received this (?:email|message) in error", re.IGNORECASE),
    re.compile(r"Email này và các tệp đính kèm chứa thông tin bảo mật", re.IGNORECASE),
)

ISSUE_KEYWORDS_RE = re.compile(
    r"\b(bug|urgent|khẩn|todo|action\s*item|action|yêu\s*cầu|blocker|blocked|blocking|deadline|hạn|issue|lỗi|cần\s+xử\s+lý)\b",
    re.IGNORECASE,
)
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n", "\uff1d", "\uff0b", "\uff0d")
GAP_DAYS = 21


def _sanitize_excel_cell(val: Any) -> Any:
    if isinstance(val, str) and val and val.lstrip().startswith(FORMULA_PREFIXES) and not val.startswith("'"):
        return "'" + val
    return val


def normalize_subject(subj: str) -> str:
    if not subj:
        return ""
    prev = None
    s = subj.strip()
    while prev != s:
        prev = s
        s = PREFIX_RE.sub("", s, count=1).strip()
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[-\s]*\d{6,8}$", "", s).strip()
    return s.lower()


def clean_body(body: str) -> List[str]:
    if not body:
        return []
    cleaned: List[str] = []
    for raw in body.replace("\x00", "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if any(rx.search(line) for rx in QUOTE_BOUNDARIES) or any(rx.search(line) for rx in DISCLAIMER_PATTERNS):
            break
        if SIGNATURE_LINE_RE.match(line):
            continue
        cleaned.append(line)
    return cleaned


def filter_attachments(attachments: Union[str, List[str], None]) -> List[str]:
    if isinstance(attachments, str):
        raw_list = [a.strip() for a in attachments.split(",") if a.strip()]
    elif isinstance(attachments, list):
        raw_list = [str(a).strip() for a in attachments if str(a).strip()]
    else:
        raw_list = []
    return [a for a in raw_list if a and not INLINE_LOGO_RE.match(a)]


def extract_ticket_id(text: str) -> Optional[str]:
    m = TICKET_RE.search(text or "")
    if m:
        for g in m.groups():
            if g:
                return g
    return None


def extract_participants(m: Dict[str, Any]) -> frozenset[str]:
    raw = " ".join([str(m.get("from", "")), str(m.get("to", "")), str(m.get("cc", ""))])
    return frozenset(e.lower() for e in EMAIL_RE.findall(raw))


def _parse_date_val(raw_date: Any) -> Optional[datetime]:
    if isinstance(raw_date, datetime):
        return raw_date.replace(tzinfo=None)
    if isinstance(raw_date, str) and raw_date.strip():
        try:
            dt_parsed = email.utils.parsedate_to_datetime(raw_date)
            return dt_parsed.replace(tzinfo=None)
        except Exception:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y-%m-%d"):
                try:
                    return datetime.strptime(raw_date.strip()[:19], fmt)
                except ValueError:
                    pass
    return None


def parse_eml_file(eml_path: Union[str, Path]) -> Dict[str, Any]:
    p = Path(eml_path)
    msg = email.message_from_bytes(p.read_bytes(), policy=email.policy.default)
    body_text = ""
    attachments: List[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            disp = str(part.get_content_disposition() or "").lower()
            fname = part.get_filename()
            if fname or disp == "attachment":
                if fname:
                    attachments.append(fname)
                continue
            if part.get_content_type() == "text/plain" and not body_text:
                try:
                    body_text = part.get_content()
                except Exception:
                    payload = part.get_payload(decode=True)
                    if payload:
                        body_text = payload.decode("utf-8", errors="ignore")
        if not body_text:
            for part in msg.walk():
                if part.get_content_type() == "text/html":
                    raw_html = part.get_content()
                    body_text = re.sub(r"<[^>]+>", "\n", str(raw_html))
                    break
    else:
        try:
            body_text = str(msg.get_content())
        except Exception:
            payload = msg.get_payload(decode=True)
            body_text = payload.decode("utf-8", errors="ignore") if payload else ""

    return {
        "source_file": str(p),
        "subject": str(msg.get("Subject", "") or ""),
        "from": str(msg.get("From", "") or ""),
        "to": str(msg.get("To", "") or ""),
        "cc": str(msg.get("Cc", "") or ""),
        "date": _parse_date_val(msg.get("Date")),
        "message_id": str(msg.get("Message-ID", "") or "").strip(),
        "in_reply_to": str(msg.get("In-Reply-To", "") or "").strip(),
        "references": str(msg.get("References", "") or "").strip(),
        "conversation_id": str(msg.get("Thread-Index", "") or msg.get("Thread-Topic", "") or "").strip(),
        "attachments": attachments,
        "body": body_text,
    }


def parse_msg_file(msg_path: Union[str, Path]) -> Dict[str, Any]:
    try:
        import extract_msg  # type: ignore
    except ImportError as exc:
        raise ImportError("extract-msg is required for .msg files. Run via `~/.omp/tools-venv` or `pip install extract-msg`.") from exc
    m = extract_msg.Message(str(msg_path))
    try:
        attachments = [getattr(a, "longFilename", None) or getattr(a, "shortFilename", None) or "" for a in (m.attachments or [])]
        return {
            "source_file": str(msg_path),
            "subject": str(m.subject or ""),
            "from": str(m.sender or ""),
            "to": str(m.to or ""),
            "cc": str(m.cc or ""),
            "date": _parse_date_val(m.date),
            "message_id": str(getattr(m, "messageId", "") or "").strip(),
            "in_reply_to": "",
            "references": "",
            "conversation_id": "",
            "attachments": [a for a in attachments if a],
            "body": str(m.body or ""),
        }
    finally:
        m.close()


def load_emails_from_path(input_path: Union[str, Path]) -> List[Dict[str, Any]]:
    p = Path(input_path)
    if not p.exists():
        raise FileNotFoundError(f"Email input path not found: {p}")
    files = [p] if p.is_file() else sorted(list(p.rglob("*.eml")) + list(p.rglob("*.msg")))
    emails: List[Dict[str, Any]] = []
    for f in files:
        if f.suffix.lower() == ".eml":
            emails.append(parse_eml_file(f))
        elif f.suffix.lower() == ".msg":
            emails.append(parse_msg_file(f))
    return emails


def load_emails_from_outlook_com(folder_limit: int = 50) -> List[Dict[str, Any]]:
    if sys.platform != "win32":
        raise RuntimeError("Outlook COM is Windows-only. Export .eml/.msg files and pass `--source files` on macOS/Linux.")
    ps = (
        "$ErrorActionPreference='Stop'; "
        "$ol = New-Object -ComObject Outlook.Application; "
        "$ns = $ol.GetNamespace('MAPI'); "
        "$inbox = $ns.GetDefaultFolder(6); "
        f"$items = $inbox.Items | Select-Object -First {int(folder_limit)}; "
        "$out = @(); "
        "foreach ($it in $items) { "
        "  $out += [PSCustomObject]@{ "
        "    subject=[string]$it.Subject; from=[string]$it.SenderEmailAddress; to=[string]$it.To; "
        "    cc=[string]$it.CC; date=$it.ReceivedTime.ToString('yyyy-MM-dd HH:mm:ss'); "
        "    conversation_id=[string]$it.ConversationID; body=[string]$it.Body "
        "  } "
        "}; $out | ConvertTo-Json -Depth 3"
    )
    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise RuntimeError(f"Outlook COM read failed: {res.stderr.strip()}")
    import json
    raw = json.loads(res.stdout or "[]")
    if isinstance(raw, dict):
        raw = [raw]
    for r in raw:
        r["date"] = _parse_date_val(r.get("date"))
        r.setdefault("attachments", [])
    return raw


def compute_thread_hash(record: Dict[str, Any]) -> str:
    conv_id = str(record.get("conversation_id", "")).strip()
    if conv_id:
        basis = f"conv:{conv_id}"
    else:
        msg_sigs = sorted(
            f"{m.get('from', '')}|{m.get('date', '')}|{m.get('text', '')[:300]}"
            for m in record.get("messages", [])
        )
        basis = f"{record.get('normalized_subject', '')}::" + "||".join(msg_sigs)
    return hashlib.sha256(basis.encode("utf-8", errors="ignore")).hexdigest()[:16]


def build_threads(msgs: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    if not msgs:
        return []
    normalized = []
    for m in msgs:
        it = dict(m)
        it.setdefault("participants", extract_participants(it))
        it["ticket"] = it.get("ticket") or extract_ticket_id(f"{it.get('subject', '')} {str(it.get('body', ''))[:200]}")
        if not isinstance(it.get("date"), datetime):
            it["date"] = _parse_date_val(it.get("date"))
        normalized.append(it)

    msg_id_map: Dict[str, int] = {}
    parent = list(range(len(normalized)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i, m in enumerate(normalized):
        mid = str(m.get("message_id", "")).strip()
        if mid:
            if mid in msg_id_map:
                union(i, msg_id_map[mid])
            else:
                msg_id_map[mid] = i
    for i, m in enumerate(normalized):
        if m.get("conversation_id"):
            continue
        irt = str(m.get("in_reply_to", "")).strip()
        if irt and irt in msg_id_map:
            union(i, msg_id_map[irt])
        for ref in re.findall(r"<[^>]+>", str(m.get("references", ""))):
            if ref in msg_id_map:
                union(i, msg_id_map[ref])

    by_key: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for i, m in enumerate(normalized):
        root = find(i)
        if m.get("conversation_id"):
            key = ("conv", str(m["conversation_id"]).strip())
        elif root != i or any(find(j) == root and j != i for j in range(len(normalized))):
            key = ("tree", str(root))
        elif m.get("ticket"):
            key = ("ticket", str(m["ticket"]))
        else:
            key = ("subj", normalize_subject(str(m.get("subject", ""))))
        by_key[key].append(m)

    threads: List[List[Dict[str, Any]]] = []
    for key, grp in by_key.items():
        grp.sort(key=lambda x: x["date"] or datetime.min)
        if key[0] in ("conv", "ticket", "tree"):
            threads.append(grp)
            continue
        cur = [grp[0]]
        for prev, nxt in zip(grp, grp[1:]):
            gap = ((nxt["date"] - prev["date"]).days if (prev["date"] and nxt["date"]) else 0)
            overlap = bool(nxt["participants"] & prev["participants"])
            if gap > GAP_DAYS and not overlap:
                threads.append(cur)
                cur = [nxt]
            else:
                cur.append(nxt)
        threads.append(cur)

    threads.sort(key=lambda t: t[0]["date"] or datetime.min)
    return threads


def analyze_emails(
    msgs: List[Dict[str, Any]],
    dedupe: bool = True,
) -> Dict[str, Any]:
    threads = build_threads(msgs)
    records: List[Dict[str, Any]] = []
    seen_hashes: Set[str] = set()
    dupes_skipped = 0
    issues: List[Dict[str, Any]] = []

    for idx, grp in enumerate(threads, 1):
        cleaned_msgs = []
        attachments: List[str] = []
        senders: List[str] = []
        for m in grp:
            blines = clean_body(str(m.get("body", "")))
            atts = filter_attachments(m.get("attachments"))
            for a in atts:
                if a not in attachments:
                    attachments.append(a)
            f_addr = str(m.get("from", "")).strip()
            if f_addr and f_addr not in senders:
                senders.append(f_addr)
            d_str = m["date"].isoformat() if isinstance(m.get("date"), datetime) else ""
            cleaned_msgs.append({"date": d_str, "from": f_addr, "attachments": atts, "text": " ".join(blines)})

        subject = str(grp[0].get("subject", ""))
        conv_id = next((str(m.get("conversation_id", "")).strip() for m in grp if m.get("conversation_id")), "")
        rec = {
            "thread_id": idx,
            "conversation_id": conv_id,
            "subject": subject,
            "normalized_subject": normalize_subject(subject),
            "n_mails": len(grp),
            "senders": senders,
            "attachments": attachments,
            "start": cleaned_msgs[0]["date"][:10],
            "end": cleaned_msgs[-1]["date"][:10],
            "messages": cleaned_msgs,
        }
        rec["content_hash"] = compute_thread_hash(rec)
        if dedupe and rec["content_hash"] in seen_hashes:
            dupes_skipped += 1
            continue
        seen_hashes.add(rec["content_hash"])

        matched_lines: List[str] = []
        for cm in cleaned_msgs:
            for seg in re.split(r"(?<=[.!?])\s+|\s*\n\s*", cm["text"]):
                if ISSUE_KEYWORDS_RE.search(seg):
                    matched_lines.append(seg.strip())
        if matched_lines:
            issues.append({
                "thread_id": rec["thread_id"],
                "subject": subject,
                "owner": senders[-1] if senders else "",
                "date": rec["end"],
                "summary": " | ".join(matched_lines)[:300],
                "content_hash": rec["content_hash"],
            })
        rec["issues_detected"] = matched_lines
        records.append(rec)

    md_lines = [
        "# Email Intelligence Report",
        f"- **Raw Emails:** {len(msgs)} | **Unique Threads:** {len(records)} | **Duplicates Skipped:** {dupes_skipped} | **Issues Extracted:** {len(issues)}",
        "", "## Threads Summary", "| # | Start | End | Mails | Subject | Senders | Hash |", "|---:|---|---|---:|---|---|---|",
    ]
    for r in records:
        snd = ", ".join(r["senders"][:2]).replace("|", r"\|")
        sub = r["subject"].replace("|", r"\|")
        md_lines.append(f"| {r['thread_id']} | {r['start']} | {r['end']} | {r['n_mails']} | {sub} | {snd} | `{r['content_hash']}` |")
    md_lines.extend(["", "## Extracted Issues / Action Items", "| Thread | Date | Owner | Action / Issue Summary |", "|---:|---|---|---|"])
    for it in issues:
        md_lines.append(f"| {it['thread_id']} | {it['date']} | {it['owner'].replace('|', r'\|')} | {it['summary'].replace('|', r'\|')} |")
    if not issues:
        md_lines.append("| - | - | - | *No actionable issues detected* |")

    return {
        "raw_emails": len(msgs), "thread_count": len(records), "duplicates_skipped": dupes_skipped,
        "issue_count": len(issues), "threads": records, "issues": issues, "markdown": "\n".join(md_lines) + "\n",
    }


def export_email_excel(result: Dict[str, Any], output_xlsx: Union[str, Path]) -> Path:
    out = Path(output_xlsx)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    font = Font(color="FFFFFF", bold=True)

    ws = wb.active
    ws.title = "Threads"
    hdrs = ["Thread ID", "Start", "End", "Mails", "Subject", "Senders", "Attachments", "Hash"]
    for ci, h in enumerate(hdrs, 1):
        c = ws.cell(1, ci, h)
        c.fill, c.font, c.alignment = fill, font, Alignment(horizontal="center")
    for ri, r in enumerate(result.get("threads", []), 2):
        vals = [r["thread_id"], r["start"], r["end"], r["n_mails"], r["subject"], ", ".join(r["senders"]), ", ".join(r["attachments"]), r["content_hash"]]
        for ci, v in enumerate(vals, 1):
            ws.cell(ri, ci, _sanitize_excel_cell(v))

    wi = wb.create_sheet("Issues")
    ihdrs = ["Thread ID", "Date", "Subject", "Owner", "Action / Issue Summary", "Hash"]
    for ci, h in enumerate(ihdrs, 1):
        c = wi.cell(1, ci, h)
        c.fill, c.font = fill, font
    for ri, it in enumerate(result.get("issues", []), 2):
        vals = [it["thread_id"], it["date"], it["subject"], it["owner"], it["summary"], it["content_hash"]]
        for ci, v in enumerate(vals, 1):
            wi.cell(ri, ci, _sanitize_excel_cell(v))

    wb.save(str(out))
    wb.close()
    return out
