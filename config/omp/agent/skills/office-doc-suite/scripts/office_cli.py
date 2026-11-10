#!/usr/bin/env python3
"""
office_cli.py — Dual-Mode CLI Runner for OMP `office-doc-suite` Skill (Priority 100).

Supports:
- Interactive TTY Menu Mode (run without --cmd)
- Non-Interactive Agent Mode (--cmd <subcommand> ... --json)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, List, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from venv_bootstrap import attach_omp_tools_venv  # noqa: E402

attach_omp_tools_venv()

from doc_converter import batch_convert, docx_to_md, md_to_docx, md_to_xlsx, to_md  # noqa: E402
from kpi_tracker import init_kpi_workbook, run_kpi_analysis, send_webhook_alert  # noqa: E402
from spatial_extractor import extract_bbox_layout, extract_spatial_tables  # noqa: E402


def _emit(payload: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
    elif isinstance(payload, dict) and "markdown" in payload:
        print(payload["markdown"])
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))


def run_command(args: argparse.Namespace) -> int:
    try:
        cmd = args.cmd
        if cmd == "md2docx":
            out = args.output or str(Path(args.input).with_suffix(".docx"))
            _emit(md_to_docx(args.input, out, render_mermaid=not args.no_mermaid), args.json)
            return 0
        if cmd == "docx2md":
            out = args.output or str(Path(args.input).with_suffix(".md"))
            _emit(docx_to_md(args.input, out), args.json)
            return 0
        if cmd == "md2xlsx":
            out = args.output or str(Path(args.input).with_suffix(".xlsx"))
            _emit(md_to_xlsx(args.input, out), args.json)
            return 0
        if cmd == "to-md":
            out = args.output or str(Path(args.input).with_suffix(".md"))
            _emit(to_md(args.input, out), args.json)
            return 0
        if cmd == "batch":
            out_dir = args.output or str(Path(args.input) / "converted")
            _emit(batch_convert(args.input, out_dir, mode=args.mode, recursive=args.recursive, overwrite=args.overwrite), args.json)
            return 0
        if cmd == "extract-table":
            out_xlsx = args.output if args.output and args.output.lower().endswith(".xlsx") else None
            out_md = args.output if args.output and args.output.lower().endswith(".md") else None
            _emit(extract_spatial_tables(args.input, output_xlsx=out_xlsx, output_md=out_md), args.json)
            return 0
        if cmd == "extract-bbox":
            _emit(
                extract_bbox_layout(
                    args.input,
                    col_split_x=args.col_split_x,
                    single_column=args.single_column,
                    output_txt=args.output,
                ),
                args.json,
            )
            return 0
        if cmd == "calc-kpi":
            res = run_kpi_analysis(
                args.input,
                month=args.month,
                target_points=args.target_points,
                output_md=args.output,
                alerts_out=args.alerts_out,
            )
            if args.slack_webhook or (args.telegram_token and args.chat_id):
                send_webhook_alert(res.get("alerts", []), slack_webhook=args.slack_webhook, telegram_token=args.telegram_token, chat_id=args.chat_id)
            _emit(res, args.json)
            return 0
        if cmd == "init-kpi":
            out = init_kpi_workbook(args.output or "kpi_template.xlsx")
            _emit({"status": "initialized", "output_xlsx": str(out)}, args.json)
            return 0
        raise ValueError(f"Unknown command: {cmd}")
    except Exception as exc:
        err = {"is_valid": False, "error": str(exc)}
        if args.json:
            print(json.dumps(err, indent=2, ensure_ascii=False))
        else:
            print(f"Error: {exc}", file=sys.stderr)
        return 1


def run_interactive_menu() -> int:
    while True:
        print("\n=== OMP Office Document Suite ===")
        print("1. Markdown -> Word (.docx)")
        print("2. Word (.docx) -> Markdown")
        print("3. Markdown Tables -> Excel (.xlsx)")
        print("4. Any Format (drawio/vsdx/xlsx/html/eml) -> Markdown")
        print("5. Spatial Text Table -> Excel/Markdown")
        print("6. Calculate Project KPI Signals (.xlsx / .json)")
        print("0. Exit")
        try:
            choice = input("Select option [0-6]: ").strip()
        except EOFError:
            return 0
        if choice == "0" or not choice:
            return 0
        elif choice in ("1", "2", "3", "4"):
            cmd = {"1": "md2docx", "2": "docx2md", "3": "md2xlsx", "4": "to-md"}[choice]
            inp = input("Input path: ").strip()
            out = input("Output path (optional): ").strip() or None
            run_command(argparse.Namespace(cmd=cmd, input=inp, output=out, json=True, no_mermaid=False))
        elif choice == "5":
            inp = input("Input spatial text file: ").strip()
            out = input("Output .xlsx or .md path (optional): ").strip() or None
            run_command(argparse.Namespace(cmd="extract-table", input=inp, output=out, json=True))
        elif choice == "6":
            inp = input("Input KPI .xlsx or .json path: ").strip()
            month = input("Month filter YYYY-MM (optional): ").strip() or None
            out = input("Output Markdown report path (optional): ").strip() or None
            run_command(argparse.Namespace(cmd="calc-kpi", input=inp, output=out, month=month, target_points=None, alerts_out=None, slack_webhook=None, telegram_token=None, chat_id=None, json=True))
        else:
            print("Invalid selection.")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="OMP Office Document Suite Dual-Mode CLI")
    p.add_argument("--cmd", choices=["md2docx", "docx2md", "md2xlsx", "to-md", "batch", "extract-table", "extract-bbox", "calc-kpi", "init-kpi"])
    p.add_argument("--input", help="Input file or directory path")
    p.add_argument("--output", help="Output file or directory path")
    p.add_argument("--mode", default="md2docx", choices=["md2docx", "docx2md", "md2xlsx"], help="Batch mode")
    p.add_argument("--recursive", action="store_true", help="Recursive batch conversion")
    p.add_argument("--overwrite", action="store_true", help="Overwrite existing batch targets")
    p.add_argument("--month", help="KPI target month (YYYY-MM)")
    p.add_argument("--target-points", type=float, help="Override KPI target points")
    p.add_argument("--alerts-out", help="Write KPI alerts JSON to path")
    p.add_argument("--slack-webhook", help="Optional Slack webhook URL")
    p.add_argument("--telegram-token", help="Optional Telegram bot token")
    p.add_argument("--chat-id", help="Optional Telegram chat ID")
    p.add_argument("--col-split-x", type=float, default=None, help="Explicit X-coordinate split for 2-col BBox XML")
    p.add_argument("--single-column", action="store_true", help="Force single-column BBox extraction")
    p.add_argument("--no-mermaid", action="store_true", help="Skip mmdc rendering")
    p.add_argument("--json", action="store_true", help="Emit JSON output")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.cmd:
        return run_interactive_menu()
    return run_command(args)


if __name__ == "__main__":
    sys.exit(main())
