"""
parse-ticketing-source.py — Load bug-fix-days data from a ticketing export.

CLI:
    python parse-ticketing-source.py --period YYYY-MM \
        --config docs/kpi/ticketing-source.yaml \
        [--inputs-root docs/kpi/inputs]

Output (stdout): JSON mapping task_id → {bug_fix_days, classification, source}

Exit codes:
    0  success
    2  config error (bad YAML, missing required keys)
    3  file not found
    4  validation error (size / row count / path traversal / forbidden extension)
    5  parse error (CSV decode / field mapping failure)

Dependencies: pyyaml (stdlib only otherwise).

Example inputs → expected outputs
----------------------------------
1. Normal ticketing match
   Input row:  Issue Key=PVKPI-42, Time Spent (d)=0.5, Custom Field=bug
   Output:     {"PVKPI-42": {"bug_fix_days": 0.5, "classification": "bug", "source": "ticketing"}}

2. Exclude classification (scope_change in exclude_classifications)
   Input row:  Issue Key=PVKPI-99, Time Spent (d)=1.0, Custom Field=scope_change
   Output:     {"PVKPI-99": {"bug_fix_days": 0.0, "classification": "scope_change",
                              "source": "ticketing_excluded"}}

3. Deduplicate with sum
   Input rows: Issue Key=PVKPI-10 / 0.25 / bug  AND  Issue Key=PVKPI-10 / 0.5 / bug
   Stderr:     WARN: duplicate task_id PVKPI-10 — summing fix_time_days (0.25 + 0.5)
   Output:     {"PVKPI-10": {"bug_fix_days": 0.75, "classification": "bug", "source": "ticketing"}}
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MAX_FILE_BYTES: int = 10 * 1024 * 1024          # 10 MB
MAX_ROWS: int = 50_000
FORBIDDEN_EXTENSIONS: frozenset[str] = frozenset({".xlsm", ".xlsb"})
ALLOWED_CLASSIFICATIONS: frozenset[str] = frozenset({"bug", "rework", "scope_change"})
FORMULA_CHARS: str = "=+-@\t"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    """Write a structured error line to stderr."""
    print(f"ERROR: {msg}", file=sys.stderr)


def _warn(msg: str) -> None:
    """Write a structured warning line to stderr."""
    print(f"WARN: {msg}", file=sys.stderr)


def _sanitize(value: str) -> str:
    """Prefix formula-injection chars with a single quote so Excel won't execute them."""
    if value and value[0] in FORMULA_CHARS:
        return "'" + value
    return value


def _sanitize_row(row: dict[str, str]) -> dict[str, str]:
    """Apply _sanitize to every cell value in a CSV row dict."""
    return {k: _sanitize(v) for k, v in row.items()}


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def load_config(config_path: str) -> dict[str, Any]:
    """Load and validate ticketing-source.yaml; exit 2 on error."""
    try:
        import yaml  # noqa: PLC0415 — lazy import for clear missing-dep message
    except ImportError:
        _err("pyyaml not installed. Run: pip install pyyaml")
        sys.exit(2)

    cfg_file = Path(config_path)
    if not cfg_file.is_file():
        _err(f"Config file not found: {config_path}")
        sys.exit(3)

    try:
        with cfg_file.open("r", encoding="utf-8") as fh:
            cfg: dict[str, Any] = yaml.safe_load(fh)  # RT-12: NEVER yaml.load()
    except Exception as exc:  # noqa: BLE001
        _err(f"Failed to parse config YAML: {exc}")
        sys.exit(2)

    required_keys = ("source_type", "path", "columns")
    for key in required_keys:
        if key not in cfg:
            _err(f"Config missing required key: '{key}'")
            sys.exit(2)

    required_cols = ("task_id", "fix_time_days", "classification")
    for col in required_cols:
        if col not in cfg.get("columns", {}):
            _err(f"Config columns missing required sub-key: '{col}'")
            sys.exit(2)

    return cfg


# ---------------------------------------------------------------------------
# Path validation (RT-12)
# ---------------------------------------------------------------------------

def resolve_and_validate_path(
    raw_path: str,
    inputs_root: Path,
    period: str,
) -> Path:
    """
    Substitute {period}, resolve against inputs_root, enforce containment.
    Exits 4 on traversal or forbidden extension.
    """
    substituted = raw_path.replace("{period}", period)
    # Resolve relative to inputs_root so relative paths stay contained
    candidate = (inputs_root / substituted).resolve()

    # RT-12: containment check — rejects ../ UNC and drive-letter escapes
    try:
        candidate.relative_to(inputs_root.resolve())
    except ValueError:
        _err(
            f"Path traversal rejected: '{substituted}' resolves outside "
            f"inputs-root '{inputs_root}'"
        )
        sys.exit(4)

    # RT-12: forbid macro-enabled Excel formats
    if candidate.suffix.lower() in FORBIDDEN_EXTENSIONS:
        _err(
            f"Forbidden file extension '{candidate.suffix}': "
            f".xlsm and .xlsb are rejected (macro risk)."
        )
        sys.exit(4)

    return candidate


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------

def _read_jira_csv(
    filepath: Path,
    cfg: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """
    Read a Jira CSV export and return normalized task records.
    Applies RT-12 size cap, row cap, CSV formula sanitization, dedup, and
    classification filtering.
    """
    # RT-12: file size cap
    file_size = filepath.stat().st_size
    if file_size > MAX_FILE_BYTES:
        _err(
            f"File too large: {file_size} bytes > {MAX_FILE_BYTES} byte limit (10 MB)."
        )
        sys.exit(4)

    cols = cfg["columns"]
    col_task_id: str = cols["task_id"]
    col_fix_days: str = cols["fix_time_days"]
    col_class: str = cols["classification"]
    exclude_set: frozenset[str] = frozenset(cfg.get("exclude_classifications", []))

    results: dict[str, dict[str, Any]] = {}
    row_count = 0

    try:
        with filepath.open(newline="", encoding="utf-8-sig") as fh:  # BOM-safe
            reader = csv.DictReader(fh)
            for raw_row in reader:
                row_count += 1

                # RT-12: row count cap
                if row_count > MAX_ROWS:
                    _err(f"Row count exceeds limit of {MAX_ROWS}. Aborting.")
                    sys.exit(4)

                row = _sanitize_row(raw_row)

                # --- Extract fields ---
                task_id = row.get(col_task_id, "").strip()
                if not task_id:
                    _warn(f"Row {row_count}: empty task_id — skipping.")
                    continue

                raw_class = row.get(col_class, "").strip().lstrip("'")  # undo sanitize for validation
                if raw_class not in ALLOWED_CLASSIFICATIONS:
                    _warn(
                        f"Row {row_count}: unknown classification '{raw_class}' "
                        f"for task '{task_id}' — skipping."
                    )
                    continue

                raw_days_str = row.get(col_fix_days, "0").strip().lstrip("'")
                try:
                    fix_days = float(raw_days_str) if raw_days_str else 0.0
                except ValueError:
                    _warn(
                        f"Row {row_count}: cannot parse fix_time_days "
                        f"'{raw_days_str}' for task '{task_id}' — skipping."
                    )
                    continue

                # --- Exclusion logic ---
                if raw_class in exclude_set:
                    if task_id in results:
                        _warn(
                            f"Duplicate task_id '{task_id}' in excluded set — keeping first."
                        )
                    else:
                        results[task_id] = {
                            "bug_fix_days": 0.0,
                            "classification": raw_class,
                            "source": "ticketing_excluded",
                        }
                    continue

                # --- Deduplication: sum fix_time_days ---
                if task_id in results:
                    existing = results[task_id]
                    old_days = existing["bug_fix_days"]
                    _warn(
                        f"Duplicate task_id '{task_id}' — summing fix_time_days "
                        f"({old_days} + {fix_days})"
                    )
                    existing["bug_fix_days"] = round(old_days + fix_days, 4)
                else:
                    results[task_id] = {
                        "bug_fix_days": fix_days,
                        "classification": raw_class,
                        "source": "ticketing",
                    }

    except FileNotFoundError:
        _err(f"Data file not found: {filepath}")
        sys.exit(3)
    except UnicodeDecodeError as exc:
        _err(f"CSV encoding error (expected UTF-8 with BOM): {exc}")
        sys.exit(5)
    except csv.Error as exc:
        _err(f"CSV parse error: {exc}")
        sys.exit(5)

    return results


def _dispatch(
    source_type: str,
    filepath: Path,
    cfg: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Dispatch to the correct adapter based on source_type."""
    if source_type == "jira_csv":
        return _read_jira_csv(filepath, cfg)
    if source_type in ("excel", "google_sheet"):
        raise NotImplementedError(
            f"source_type='{source_type}' is deferred to v1.7+. "
            "Use jira_csv export for now."
        )
    _err(f"Unknown source_type: '{source_type}'. Allowed: jira_csv, excel, google_sheet.")
    sys.exit(2)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    p = argparse.ArgumentParser(
        description="Parse ticketing export → bug_fix_days JSON for KPI TQ computation."
    )
    p.add_argument("--period", required=True, metavar="YYYY-MM",
                   help="Reporting period, e.g. 2026-05")
    p.add_argument("--config", default="docs/kpi/ticketing-source.yaml",
                   metavar="PATH", help="Path to ticketing-source.yaml")
    p.add_argument("--inputs-root", default="docs/kpi/inputs",
                   metavar="DIR", help="Root directory for data files (traversal guard)")
    return p


def main() -> None:
    """Main entry point: parse args, load config, resolve path, dispatch adapter, emit JSON."""
    parser = _build_parser()
    args = parser.parse_args()

    # Validate period format loosely
    parts = args.period.split("-")
    if len(parts) != 2 or not (len(parts[0]) == 4 and len(parts[1]) == 2):
        _err(f"--period must be YYYY-MM, got: '{args.period}'")
        sys.exit(2)

    cfg = load_config(args.config)
    inputs_root = Path(args.inputs_root)

    data_path = resolve_and_validate_path(cfg["path"], inputs_root, args.period)

    try:
        records = _dispatch(cfg["source_type"], data_path, cfg)
    except NotImplementedError as exc:
        _err(str(exc))
        sys.exit(2)

    json.dump(records, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
