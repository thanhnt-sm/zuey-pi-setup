#!/usr/bin/env python3
"""
email_cli.py — Dual-Mode CLI Runner for OMP `email-intelligence-suite`.
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

from email_parser import (  # noqa: E402
    analyze_emails,
    export_email_excel,
    load_emails_from_outlook_com,
    load_emails_from_path,
)


def _emit(payload: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
    elif isinstance(payload, dict) and "markdown" in payload:
        print(payload["markdown"])
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))


def run_command(args: argparse.Namespace) -> int:
    try:
        if args.source == "outlook":
            msgs = load_emails_from_outlook_com()
        else:
            if not args.input:
                raise ValueError("--input path is required for file/archive scanning")
            msgs = load_emails_from_path(args.input)

        res = analyze_emails(msgs, dedupe=args.dedupe)
        out = args.output
        fmt = args.format
        outputs: dict[str, str] = {}
        if out:
            op = Path(out)
            if fmt in ("md", "both") or op.suffix.lower() == ".md":
                md_p = op if op.suffix.lower() == ".md" else op.with_suffix(".md")
                md_p.parent.mkdir(parents=True, exist_ok=True)
                md_p.write_text(res["markdown"], encoding="utf-8")
                outputs["markdown_path"] = str(md_p)
            if fmt in ("xlsx", "both") or op.suffix.lower() == ".xlsx":
                xl_p = op if op.suffix.lower() == ".xlsx" else op.with_suffix(".xlsx")
                export_email_excel(res, xl_p)
                outputs["excel_path"] = str(xl_p)

        if args.cmd == "threads":
            payload = {"thread_count": res["thread_count"], "duplicates_skipped": res["duplicates_skipped"], "threads": res["threads"], **outputs}
        elif args.cmd == "issues":
            payload = {"issue_count": res["issue_count"], "issues": res["issues"], **outputs}
        else:
            payload = {**res, **outputs}
        _emit(payload, args.json)
        return 0
    except Exception as exc:
        err = {"is_valid": False, "error": str(exc)}
        if args.json:
            print(json.dumps(err, indent=2, ensure_ascii=False))
        else:
            print(f"Error: {exc}", file=sys.stderr)
        return 1


def run_interactive_menu() -> int:
    while True:
        print("\n=== OMP Email Intelligence Suite ===")
        print("1. Scan .eml/.msg Folder -> Markdown + Excel Report")
        print("2. Group & Deduplicate Threads (JSON summary)")
        print("3. Extract Issues / Action Items Only")
        print("4. Scan Windows Outlook COM Inbox (Windows only)")
        print("0. Exit")
        try:
            choice = input("Select option [0-4]: ").strip()
        except EOFError:
            return 0
        if choice == "0" or not choice:
            return 0
        elif choice in ("1", "2", "3"):
            inp = input("Email file or directory path: ").strip()
            out = input("Output path (optional): ").strip() or None
            cmd = {"1": "scan", "2": "threads", "3": "issues"}[choice]
            run_command(argparse.Namespace(cmd=cmd, input=inp, output=out, format="both", dedupe=True, source="files", json=True))
        elif choice == "4":
            out = input("Output report path (optional): ").strip() or None
            run_command(argparse.Namespace(cmd="scan", input=None, output=out, format="both", dedupe=True, source="outlook", json=True))
        else:
            print("Invalid selection.")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="OMP Email Intelligence Suite Dual-Mode CLI")
    p.add_argument("--cmd", choices=["scan", "threads", "issues"])
    p.add_argument("--input", help="Input .eml/.msg file or directory")
    p.add_argument("--output", help="Output report path (.md or .xlsx)")
    p.add_argument("--format", default="md", choices=["md", "xlsx", "both"])
    p.add_argument("--dedupe", action="store_true", help="Deduplicate threads via content_hash")
    p.add_argument("--source", default="files", choices=["files", "outlook"])
    p.add_argument("--json", action="store_true")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.cmd:
        return run_interactive_menu()
    return run_command(args)


if __name__ == "__main__":
    sys.exit(main())
