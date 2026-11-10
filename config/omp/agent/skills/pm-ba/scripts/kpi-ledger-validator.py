"""KPI EP Cumulative Ledger Validator — v1.6 state file integrity checker.

CLI:
    python kpi-ledger-validator.py <state-file.md> [--verbose] [--repair-pause-history]

Exit codes:
    0 — no errors (warnings/info ok)
    1 — one or more error-severity findings

Test Vectors
============

**Vector 1 — Healthy ledger (4 months, last row ap_period=null) → 0 errors**
Frontmatter:
    schema_version: "1.6"
    ep_cumulative_anchor:
      period: "2026-01"
      ep_monthly: 180
      set_at: "2026-01-01T09:00:00"
      immutable: true
    ep_cumulative_ledger:
      - {period: "2026-01", ep_monthly: 180, ap_period: 175}
      - {period: "2026-02", ep_monthly: 195, ap_period: 200}
      - {period: "2026-03", ep_monthly: 0, ap_period: 0, paused: true}
      - {period: "2026-04", ep_monthly: 175, ap_period: null}
Expected: findings=[], exit=0

**Vector 2 — Duplicate period + gap → 2 errors (A004, A006)**
Ledger: 2026-01, 2026-01 (dup), 2026-03 (gap at 2026-02)
Expected: findings contain codes A004 and A006, exit=1

**Vector 3 — Pause-history orphan → 1 warning A008; --repair-pause-history fixes it**
pause_history: [{period: "2026-03", reason: "sick"}]
Ledger: only 2026-01, 2026-02, 2026-04 (missing 2026-03 placeholder)
Expected: findings contain code A008 (warn), exit=0
With --repair-pause-history: placeholder row added for 2026-03, exit=0
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from typing import Any

import yaml  # pyyaml; only external dep


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

Finding = dict  # {severity: str, code: str, msg: str}


# ---------------------------------------------------------------------------
# Frontmatter parser
# ---------------------------------------------------------------------------

def parse_frontmatter(path: str) -> dict[str, Any]:
    """Read markdown file and parse YAML between first and second '---' delimiters.

    Raises ValueError if frontmatter block is absent or malformed.
    """
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()

    if not lines or lines[0].strip() != "---":
        raise ValueError(f"No opening '---' found in {path}")

    block_lines: list[str] = []
    found_close = False
    for line in lines[1:]:
        if line.strip() == "---":
            found_close = True
            break
        block_lines.append(line)

    if not found_close:
        raise ValueError(f"No closing '---' found in {path}")

    data = yaml.safe_load("".join(block_lines))
    if not isinstance(data, dict):
        raise ValueError("Frontmatter did not parse to a mapping")
    return data


# ---------------------------------------------------------------------------
# Period helpers
# ---------------------------------------------------------------------------

def _to_date(period: str) -> date:
    """Convert 'YYYY-MM' to date(year, month, 1). Raises ValueError on bad format."""
    parts = period.split("-")
    if len(parts) != 2:
        raise ValueError(f"Invalid period format: {period!r}")
    return date(int(parts[0]), int(parts[1]), 1)


def _next_month(d: date) -> date:
    """Return first day of month following d."""
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)


def _period_str(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


# ---------------------------------------------------------------------------
# Individual validator functions
# ---------------------------------------------------------------------------

def check_anchor_exists(fm: dict) -> list[Finding]:
    """A001 — ep_cumulative_anchor present with all required fields."""
    anchor = fm.get("ep_cumulative_anchor")
    if not isinstance(anchor, dict):
        return [{"severity": "error", "code": "A001",
                 "msg": "ep_cumulative_anchor missing or not a mapping"}]
    findings: list[Finding] = []
    for field in ("period", "ep_monthly", "set_at", "immutable"):
        if field not in anchor:
            findings.append({"severity": "error", "code": "A001",
                             "msg": f"ep_cumulative_anchor missing required field: {field!r}"})
    return findings


def check_anchor_period_matches_ledger(fm: dict) -> list[Finding]:
    """A002 — anchor.period == ledger[0].period."""
    anchor = fm.get("ep_cumulative_anchor") or {}
    ledger = fm.get("ep_cumulative_ledger") or []
    if not isinstance(anchor, dict) or not ledger:
        return []
    anchor_period = anchor.get("period")
    first_period = ledger[0].get("period") if isinstance(ledger[0], dict) else None
    if anchor_period != first_period:
        return [{"severity": "error", "code": "A002",
                 "msg": f"anchor.period {anchor_period!r} != ledger[0].period {first_period!r}"}]
    return []


def check_anchor_immutability(fm: dict) -> list[Finding]:
    """A003 — anchor.immutable must be true."""
    anchor = fm.get("ep_cumulative_anchor") or {}
    if not isinstance(anchor, dict):
        return []
    if anchor.get("immutable") is not True:
        return [{"severity": "warn", "code": "A003",
                 "msg": f"anchor.immutable is {anchor.get('immutable')!r}; should be true to lock anchor"}]
    return []


def check_no_duplicate_periods(ledger: list[dict]) -> list[Finding]:
    """A004 — no duplicate period values in ledger."""
    seen: dict[str, int] = {}
    findings: list[Finding] = []
    for i, row in enumerate(ledger):
        p = row.get("period")
        if p in seen:
            findings.append({"severity": "error", "code": "A004",
                             "msg": f"Duplicate period {p!r} at ledger indices {seen[p]} and {i}"})
        else:
            seen[p] = i
    return findings


def check_monotonic_sequence(ledger: list[dict]) -> list[Finding]:
    """A005 — periods strictly ascending by YYYY-MM lexicographic order."""
    findings: list[Finding] = []
    for i in range(1, len(ledger)):
        prev = ledger[i - 1].get("period", "")
        curr = ledger[i].get("period", "")
        if curr <= prev:
            findings.append({"severity": "error", "code": "A005",
                             "msg": f"Non-monotonic period at index {i}: {prev!r} → {curr!r}"})
    return findings


def check_no_gap_periods(ledger: list[dict]) -> list[Finding]:
    """A006 — no missing months between consecutive ledger entries."""
    findings: list[Finding] = []
    try:
        periods = [_to_date(row["period"]) for row in ledger if row.get("period")]
    except (ValueError, KeyError):
        return []  # period format errors caught elsewhere

    for i in range(1, len(periods)):
        expected = _next_month(periods[i - 1])
        while expected < periods[i]:
            findings.append({"severity": "error", "code": "A006",
                             "msg": f"Gap: missing ledger row for period {_period_str(expected)!r}"})
            expected = _next_month(expected)
    return findings


def check_ap_period_nullability(ledger: list[dict]) -> list[Finding]:
    """A007 — only the last ledger row may have ap_period: null (PM month-end fill)."""
    findings: list[Finding] = []
    for i, row in enumerate(ledger[:-1]):  # all except last
        if row.get("ap_period") is None:
            findings.append({"severity": "warn", "code": "A007",
                             "msg": f"ap_period is null on non-last row index {i} (period {row.get('period')!r}); PM may have skipped month-end fill"})
    return findings


def check_pause_idempotency(fm: dict, ledger: list[dict]) -> list[Finding]:
    """A008 — RT-14: pause idempotency + pause_history orphan detection."""
    findings: list[Finding] = []

    # Intra-ledger: paused rows must not duplicate (covered by A004; add guard)
    paused_periods: set[str] = set()
    for row in ledger:
        if row.get("paused") is True:
            p = row.get("period")
            if p in paused_periods:
                findings.append({"severity": "error", "code": "A008",
                                 "msg": f"Duplicate paused ledger row for period {p!r}"})
            paused_periods.add(p)

    # Reconcile pause_history[] → ledger placeholder rows
    pause_history = fm.get("pause_history") or []
    ledger_periods = {row.get("period") for row in ledger}
    orphans = [
        entry.get("period") for entry in pause_history
        if isinstance(entry, dict) and entry.get("period") not in ledger_periods
    ]
    if orphans:
        findings.append({"severity": "warn", "code": "A008",
                         "msg": f"pause_history entries with no ledger placeholder row: {orphans}"})
    return findings


def check_schema_version(fm: dict) -> list[Finding]:
    """A009 — schema_version must be '1.6' (string or float)."""
    sv = fm.get("schema_version")
    if sv is None:
        return [{"severity": "warn", "code": "A009",
                 "msg": "schema_version missing; expected '1.6'"}]
    try:
        if float(sv) != 1.6:
            return [{"severity": "warn", "code": "A009",
                     "msg": f"schema_version is {sv!r}; expected 1.6"}]
    except (TypeError, ValueError):
        return [{"severity": "warn", "code": "A009",
                 "msg": f"schema_version {sv!r} could not be parsed as float; expected 1.6"}]
    return []


def check_long_project(ledger: list[dict]) -> list[Finding]:
    """A010 — informational: ledger > 12 periods triggers long-project mode notice."""
    if len(ledger) > 12:
        return [{"severity": "info", "code": "A010",
                 "msg": f"Long-project mode ({len(ledger)} periods aggregated) — verify MP_PM trends with PD"}]
    return []


# ---------------------------------------------------------------------------
# Repair action
# ---------------------------------------------------------------------------

def repair_pause_history_orphans(path: str, fm: dict, ledger: list[dict]) -> int:
    """Add placeholder ledger rows for pause_history entries that lack one.

    Idempotent: re-running produces no change if rows already exist.
    Returns number of rows added.

    H8 caveat (post-impl review): this function uses ``yaml.dump`` to write back
    the full frontmatter, which strips comments and may reformat block-vs-flow
    style. Acceptable for v1.6.0 emergency repair; v1.6.1 will switch to
    ``ruamel.yaml`` round-trip mode to preserve comments + ordering. Do NOT run
    ``--repair`` on production state files without ``.bak`` backup verified.
    """
    pause_history = fm.get("pause_history") or []
    ledger_periods = {row.get("period") for row in ledger}
    added = 0
    for entry in pause_history:
        if not isinstance(entry, dict):
            continue
        p = entry.get("period")
        if p and p not in ledger_periods:
            ledger.append({
                "period": p,
                "ep_monthly": 0,
                "ap_period": 0,
                "paused": True,
                "paused_reason": entry.get("reason", "pause_history replay"),
            })
            ledger_periods.add(p)
            added += 1

    if added == 0:
        return 0

    # Re-sort ledger by period
    ledger.sort(key=lambda r: r.get("period", ""))

    # Rewrite frontmatter in-place: replace ep_cumulative_ledger block
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()

    fm["ep_cumulative_ledger"] = ledger
    # Rebuild: replace content between first and second ---
    lines = raw.splitlines(keepends=True)
    start = 1
    end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    new_fm_yaml = yaml.dump(fm, allow_unicode=True, default_flow_style=False, sort_keys=False)
    new_content = "---\n" + new_fm_yaml + "---\n" + "".join(lines[end + 1:])
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(new_content)

    return added


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

CHECKS_LABEL = {
    "A001": "Anchor exists",
    "A002": "Anchor period matches ledger[0]",
    "A003": "Anchor immutability marker",
    "A004": "No duplicate periods",
    "A005": "Monotonic period sequence",
    "A006": "No gap periods",
    "A007": "ap_period nullability",
    "A008": "Pause idempotency",
    "A009": "schema_version",
    "A010": "Long-project warning",
}


def run_all_checks(fm: dict, verbose: bool) -> list[Finding]:
    """Execute all validator functions and return aggregated findings."""
    ledger: list[dict] = fm.get("ep_cumulative_ledger") or []
    findings: list[Finding] = []

    checks = [
        ("A001–A003", lambda: (
            check_anchor_exists(fm) +
            check_anchor_period_matches_ledger(fm) +
            check_anchor_immutability(fm)
        )),
        ("A004", lambda: check_no_duplicate_periods(ledger)),
        ("A005", lambda: check_monotonic_sequence(ledger)),
        ("A006", lambda: check_no_gap_periods(ledger)),
        ("A007", lambda: check_ap_period_nullability(ledger)),
        ("A008", lambda: check_pause_idempotency(fm, ledger)),
        ("A009", lambda: check_schema_version(fm)),
        ("A010", lambda: check_long_project(ledger)),
    ]

    for label, fn in checks:
        results = fn()
        if verbose:
            status = "PASS" if not [r for r in results if r["severity"] == "error"] else "FAIL"
            print(f"  [{label}] {status} — {len(results)} finding(s)", file=sys.stderr)
        findings.extend(results)

    return findings


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate KPI EP cumulative ledger in a pm-ba state file."
    )
    parser.add_argument("state_file", help="Path to state markdown file")
    parser.add_argument("--verbose", action="store_true", help="Pretty-print + per-check status")
    parser.add_argument(
        "--repair-pause-history",
        action="store_true",
        help="Write placeholder rows for orphaned pause_history entries (idempotent)",
    )
    args = parser.parse_args()

    try:
        fm = parse_frontmatter(args.state_file)
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stdout)
        sys.exit(1)

    if args.verbose:
        print(f"Validating: {args.state_file}", file=sys.stderr)

    findings = run_all_checks(fm, verbose=args.verbose)
    has_errors = any(f["severity"] == "error" for f in findings)

    if args.repair_pause_history:
        if has_errors:
            out = {"repaired": 0, "findings": findings,
                   "repair_skipped": "Cannot repair while error-severity findings present. Fix manually first."}
            print(json.dumps(out, indent=2 if args.verbose else None))
            sys.exit(1)

        ledger: list[dict] = fm.get("ep_cumulative_ledger") or []
        added = repair_pause_history_orphans(args.state_file, fm, ledger)
        out = {"repaired": added, "findings": findings}
        print(json.dumps(out, indent=2 if args.verbose else None))
        print(f"REPAIRED {added} rows", file=sys.stderr)
        sys.exit(0)

    out = {"findings": findings, "summary": {
        "errors": sum(1 for f in findings if f["severity"] == "error"),
        "warnings": sum(1 for f in findings if f["severity"] == "warn"),
        "info": sum(1 for f in findings if f["severity"] == "info"),
    }}
    print(json.dumps(out, indent=2 if args.verbose else None))
    sys.exit(1 if has_errors else 0)


if __name__ == "__main__":
    main()
