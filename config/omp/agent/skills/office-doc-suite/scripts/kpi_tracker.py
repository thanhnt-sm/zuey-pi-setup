"""
kpi_tracker.py — Pure-Python + OpenPyXL Project KPI Signals, Leading Indicators & Alerts Engine.

Fixes over draft:
- `--month` matching 0 rows NEVER silently falls back to all periods (returns empty/zero task set).
- Supports `"TP (Điểm task)"` header alias alongside `"TP"` and `"Baseline TP"`.
- Non-numeric `TQ` strings are skipped rather than coerced to `1.0`.
- Reads `Config` sheet coefficients (`pm_level` B4, `target_points` B5, `s_coeff` B8, `c_coeff` B10, `r_coeff` B11).
- Emits `alerts_YYYYMMDD.json`, Section 3 Action Required + `>=2` Emergency Mode rule, and Slack/Telegram webhooks.
"""

from __future__ import annotations

import datetime as dt
import json
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from venv_bootstrap import attach_omp_tools_venv

attach_omp_tools_venv()

import openpyxl  # noqa: E402
from openpyxl.styles import Font, PatternFill  # noqa: E402

SEVERITY: Dict[str, Dict[str, float]] = {
    "ap_ep": {"green": 0.95, "yellow": 0.85, "orange": 0.75},
    "cp_velocity": {"green": 1.00, "yellow": 0.80, "orange": 0.60},
    "tq_avg": {"green": 1.10, "yellow": 1.00, "orange": 0.90},
    "bug_fix_pct": {"green": 0.08, "yellow": 0.12, "orange": 0.18},
    "wip_per_dev": {"green": 2.0, "yellow": 3.0, "orange": 4.0},
    "blocked_pct": {"green": 0.05, "yellow": 0.10, "orange": 0.20},
    "bug_age_days": {"green": 3.0, "yellow": 5.0, "orange": 7.0},
    "ep_drift": {"green": 0.05, "yellow": 0.15, "orange": 0.25},
    "task_age_ratio": {"green": 0.80, "yellow": 1.00, "orange": 1.30},
}

REVERSE_KEYS = frozenset(("bug_fix_pct", "wip_per_dev", "blocked_pct", "bug_age_days", "ep_drift", "task_age_ratio"))


def classify_severity(key: str, value: float) -> str:
    t = SEVERITY.get(key)
    if not t:
        return "GRAY"
    reverse = key in REVERSE_KEYS
    for threshold, label in ((t["green"], "GREEN"), (t["yellow"], "YELLOW"), (t["orange"], "ORANGE")):
        if (value <= threshold) if reverse else (value >= threshold):
            return label
    return "RED"


def _count_severity(count: int) -> str:
    return {0: "GREEN", 1: "YELLOW", 2: "ORANGE"}.get(count, "RED")


def _to_float(val: Any, default: Optional[float] = 0.0) -> Optional[float]:
    if val is None or str(val).strip() == "":
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _to_date(val: Any) -> Optional[dt.date]:
    if isinstance(val, dt.datetime):
        return val.date()
    if isinstance(val, dt.date):
        return val
    if isinstance(val, str):
        s = val.strip()[:10]
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
            try:
                return dt.datetime.strptime(s, fmt).date()
            except ValueError:
                pass
    return None


def compute_kpi_metrics(
    tasks: List[Dict[str, Any]],
    target_points: float = 100.0,
    month: Optional[str] = None,
    ref_date: Optional[dt.date] = None,
    config_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    today = ref_date or dt.date.today()
    cfg = config_meta or {}

    if month:
        filtered = [t for t in tasks if str(t.get("Month", "")).startswith(month)]
    else:
        filtered = list(tasks)

    if month and not filtered:
        return {
            "month": month, "target_points": target_points, "task_count": 0,
            "config": cfg, "signals": {}, "leading_indicators": {}, "alerts": [],
            "emergency_mode": False,
            "markdown": f"# KPI Weekly Summary ({month})\n\n*No tasks found for month `{month}`.*\n",
        }

    earned = sum((_to_float(t.get("Earned Points"), 0.0) or 0.0) for t in filtered)
    ap_ep = earned / target_points if target_points > 0 else 0.0
    cp_velocity = ap_ep

    tq_valid: List[float] = []
    dev_tq_map: Dict[str, List[float]] = {}
    for t in filtered:
        tq_f = _to_float(t.get("TQ"), default=None)
        if tq_f is not None:
            tq_valid.append(tq_f)
            owner = str(t.get("Assigned To") or "").strip()
            if owner:
                dev_tq_map.setdefault(owner, []).append(tq_f)

    tq_avg = sum(tq_valid) / len(tq_valid) if tq_valid else 1.0
    dev_tq_below_1 = sum(1 for vals in dev_tq_map.values() if vals and (sum(vals) / len(vals)) < 1.0)

    dev_time = sum((_to_float(t.get("Dev Time"), 0.0) or 0.0) for t in filtered)
    bug_time = sum((_to_float(t.get("Bug Fix Time"), 0.0) or 0.0) for t in filtered)
    tot_time = dev_time + bug_time
    bug_fix_pct = bug_time / tot_time if tot_time > 0 else 0.0

    signals = {
        "ap_ep": {"value": round(ap_ep, 3), "severity": classify_severity("ap_ep", ap_ep)},
        "cp_velocity": {"value": round(cp_velocity, 3), "severity": classify_severity("cp_velocity", cp_velocity)},
        "tq_avg": {"value": round(tq_avg, 3), "severity": classify_severity("tq_avg", tq_avg)},
        "bug_fix_pct": {"value": round(bug_fix_pct, 3), "severity": classify_severity("bug_fix_pct", bug_fix_pct)},
        "dev_tq_below_1": {"value": dev_tq_below_1, "severity": _count_severity(dev_tq_below_1)},
    }

    active = [t for t in tasks if str(t.get("Status", "")).strip() in ("In Progress", "Blocked")]
    in_prog = [t for t in active if str(t.get("Status", "")).strip() == "In Progress"]
    blocked = [t for t in active if str(t.get("Status", "")).strip() == "Blocked"]
    done = [t for t in tasks if str(t.get("Status", "")).strip() == "Done"]

    devs = {str(t.get("Assigned To")).strip() for t in active if t.get("Assigned To")}
    wip_per_dev = len(in_prog) / len(devs) if devs else 0.0

    age_ratios: List[float] = []
    for t in active:
        st = _to_date(t.get("Estimate Start"))
        dur_days = max((_to_float(t.get("Estimate Duration"), 1.0) or 1.0), 0.1)
        age = max((today - st).days, 0) if st else 0
        age_ratios.append(age / (dur_days * 8.0))
    task_age_ratio = sum(age_ratios) / len(age_ratios) if age_ratios else 0.0

    denom_blk = len(active) + len(done)
    blocked_pct = len(blocked) / denom_blk if denom_blk > 0 else 0.0

    bug_ages: List[int] = []
    for t in tasks:
        if (_to_float(t.get("Bug Fix Time"), 0.0) or 0.0) > 0 and str(t.get("Status", "")).strip() != "Done":
            st = _to_date(t.get("Estimate Start"))
            bug_ages.append(max((today - st).days, 0) if st else 0)
    bug_backlog_age = sum(bug_ages) / len(bug_ages) if bug_ages else 0.0

    baseline_tp = sum((_to_float(t.get("Baseline TP"), 0.0) or 0.0) for t in tasks)
    current_tp = sum((_to_float(t.get("TP (Điểm task)") if t.get("TP (Điểm task)") is not None else t.get("TP"), 0.0) or 0.0) for t in tasks)
    ep_drift = (current_tp - baseline_tp) / baseline_tp if baseline_tp > 0 else 0.0

    checkpoint_miss = sum(
        1 for t in tasks
        if (ed := _to_date(t.get("Estimate End"))) and ed < today and str(t.get("Status", "")).strip() != "Done"
    )

    leading_indicators = {
        "wip_per_dev": {"value": round(wip_per_dev, 2), "severity": classify_severity("wip_per_dev", wip_per_dev)},
        "task_age_ratio": {"value": round(task_age_ratio, 2), "severity": classify_severity("task_age_ratio", task_age_ratio)},
        "blocked_pct": {"value": round(blocked_pct, 3), "severity": classify_severity("blocked_pct", blocked_pct)},
        "bug_backlog_age": {"value": round(bug_backlog_age, 1), "severity": classify_severity("bug_age_days", bug_backlog_age)},
        "ep_drift": {"value": round(ep_drift, 3), "severity": classify_severity("ep_drift", abs(ep_drift))},
        "checkpoint_miss": {"value": checkpoint_miss, "severity": _count_severity(checkpoint_miss)},
    }

    alerts = [
        {"key": k, "value": v["value"], "severity": v["severity"]}
        for k, v in {**signals, **leading_indicators}.items()
        if v["severity"] in ("RED", "ORANGE")
    ]
    emergency = len(alerts) >= 2

    lines = [
        f"# KPI Weekly Summary ({month or 'All Periods'})",
        f"**Target**: {target_points} pts | **PM Level**: {cfg.get('pm_level', 'N/A')} | **S/C/R**: {cfg.get('s_coeff', 'N/A')}/{cfg.get('c_coeff', 'N/A')}/{cfg.get('r_coeff', 'N/A')}",
        "", "## Section 1: 5 Signals", "| Metric | Value | Severity |", "|---|---:|---|",
    ]
    for k, v in signals.items():
        val_str = f"{v['value'] * 100:.1f}%" if k in ("bug_fix_pct", "cp_velocity") else str(v["value"])
        lines.append(f"| {k} | {val_str} | {v['severity']} |")
    lines.extend(["", "## Section 2: 6 Leading Indicators", "| Indicator | Value | Severity |", "|---|---:|---|"])
    for k, v in leading_indicators.items():
        val_str = f"{v['value'] * 100:.1f}%" if k in ("blocked_pct", "ep_drift") else str(v["value"])
        lines.append(f"| {k} | {val_str} | {v['severity']} |")
    lines.extend(["", "## Section 3: Action Required"])
    if alerts:
        for a in alerts:
            lines.append(f"- **{a['severity']}** `{a['key']}` = {a['value']}")
        if emergency:
            lines.append("\n> **Rule:** >=2 ORANGE/RED signals -> Activate Emergency Mode.")
    else:
        lines.append("All signals healthy or watch-level.")

    return {
        "month": month or "ALL", "target_points": target_points, "task_count": len(filtered),
        "config": cfg, "signals": signals, "leading_indicators": leading_indicators,
        "alerts": alerts, "emergency_mode": emergency, "markdown": "\n".join(lines),
    }


def load_tasks_from_workbook(xlsx_path: Union[str, Path]) -> Tuple[List[Dict[str, Any]], float, Dict[str, Any]]:
    p = Path(xlsx_path)
    if not p.is_file():
        raise FileNotFoundError(f"KPI workbook not found: {p}")

    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    target_points = 100.0
    cfg_meta: Dict[str, Any] = {}
    if "Config" in wb.sheetnames:
        cfg_ws = wb["Config"]
        rows_cfg = list(cfg_ws.iter_rows(min_row=1, max_row=15, max_col=3, values_only=True))
        for row in rows_cfg:
            if not row or not row[0] or len(row) < 2:
                continue
            k = str(row[0]).strip().lower()
            v = row[1]
            if "target" in k and v is not None:
                target_points = _to_float(v, 100.0) or 100.0
            elif "pm" in k and "level" in k:
                cfg_meta["pm_level"] = v
            elif k.startswith("s") and "coeff" in k:
                cfg_meta["s_coeff"] = v
            elif k.startswith("c") and "coeff" in k:
                cfg_meta["c_coeff"] = v
            elif k.startswith("r") and "coeff" in k:
                cfg_meta["r_coeff"] = v

    sheet_name = "TaskList" if "TaskList" in wb.sheetnames else wb.sheetnames[0]
    rows = list(wb[sheet_name].iter_rows(values_only=True))
    wb.close()
    if not rows:
        return [], target_points, cfg_meta
    headers = [str(h or "").strip() for h in rows[0]]
    tasks = [{headers[i]: r[i] for i in range(min(len(headers), len(r))) if headers[i]} for r in rows[1:] if r and any(v not in (None, "") for v in r)]
    return tasks, target_points, cfg_meta


def init_kpi_workbook(output_xlsx: Union[str, Path]) -> Path:
    out = Path(output_xlsx)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    cfg = wb.active
    cfg.title = "Config"
    cfg.append(["Parameter", "Value"])
    cfg.append(["Target Points", 100])
    cfg.append(["PM Level", "P2"])
    cfg.append(["S Coeff", 1.0])
    cfg.append(["C Coeff", 1.0])
    cfg.append(["R Coeff", 1.0])

    ws = wb.create_sheet("TaskList")
    headers = ["Task ID", "Assigned To", "Month", "Status", "Estimate Start", "Estimate End", "Estimate Duration", "Baseline TP", "TP (Điểm task)", "Earned Points", "TQ", "Dev Time", "Bug Fix Time"]
    fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    font = Font(color="FFFFFF", bold=True)
    for c_idx, h in enumerate(headers, 1):
        c = ws.cell(1, c_idx, h)
        c.fill, c.font = fill, font

    today = dt.date.today()
    month_str = today.strftime("%Y-%m")
    ws.append(["T-01", "Alice", month_str, "Done", today - dt.timedelta(days=5), today - dt.timedelta(days=1), 2, 40, 40, 40, 1.15, 16, 1])
    ws.append(["T-02", "Bob", month_str, "Done", today - dt.timedelta(days=4), today, 2, 50, 50, 50, 1.05, 18, 1])
    ws.append(["T-03", "Alice", month_str, "In Progress", today - dt.timedelta(days=2), today + dt.timedelta(days=3), 3, 20, 20, 0, 1.0, 8, 0])
    wb.save(str(out))
    wb.close()
    return out


def send_webhook_alert(alerts: List[Dict[str, Any]], slack_webhook: Optional[str] = None, telegram_token: Optional[str] = None, chat_id: Optional[str] = None) -> None:
    if not alerts:
        return
    msg = "KPI Alerts:\n" + "\n".join(f"- [{a['severity']}] {a['key']}: {a['value']}" for a in alerts)
    if slack_webhook:
        req = urllib.request.Request(slack_webhook, data=json.dumps({"text": msg}).encode("utf-8"), headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).close()
    if telegram_token and chat_id:
        url = f"https://api.telegram.org/bot{telegram_token}/sendMessage"
        req = urllib.request.Request(url, data=json.dumps({"chat_id": chat_id, "text": msg}).encode("utf-8"), headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).close()


def run_kpi_analysis(
    input_path: Union[str, Path],
    month: Optional[str] = None,
    target_points: Optional[float] = None,
    output_md: Optional[Union[str, Path]] = None,
    alerts_out: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    p = Path(input_path)
    cfg_meta: Dict[str, Any] = {}
    if p.suffix.lower() == ".json":
        raw = json.loads(p.read_text(encoding="utf-8-sig"))
        tasks = raw.get("tasks", []) if isinstance(raw, dict) else raw
        tp = target_points if target_points is not None else float(raw.get("target_points", 100.0) if isinstance(raw, dict) else 100.0)
    else:
        tasks, wb_tp, cfg_meta = load_tasks_from_workbook(p)
        tp = target_points if target_points is not None else wb_tp

    res = compute_kpi_metrics(tasks, target_points=tp, month=month, config_meta=cfg_meta)
    if output_md:
        mp = Path(output_md)
        mp.parent.mkdir(parents=True, exist_ok=True)
        mp.write_text(res["markdown"] + "\n", encoding="utf-8")
    if alerts_out and res.get("alerts"):
        ap = Path(alerts_out)
        ap.parent.mkdir(parents=True, exist_ok=True)
        ap.write_text(json.dumps({"month": res["month"], "alerts": res["alerts"], "emergency_mode": res["emergency_mode"]}, indent=2), encoding="utf-8")
    return res
