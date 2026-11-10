#!/usr/bin/env python3
"""
maintenance_cli.py — Dual-Mode CLI Runner for OMP `system-maintenance-suite`.
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

from cleaner_dispatcher import run_cleanup  # noqa: E402
from uninstaller_builder import generate_uninstaller_suite  # noqa: E402


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
        if cmd == "analyze":
            res = run_cleanup(mode=args.mode, dry_run=True, force=False, os_override=args.os)
            _emit(res, args.json)
            return 0
        if cmd == "clean":
            res = run_cleanup(mode=args.mode, dry_run=args.dry_run, force=args.force, os_override=args.os)
            _emit(res, args.json)
            return 0
        if cmd == "generate-uninstaller":
            if not args.tool:
                raise ValueError("--tool <name> is required for generate-uninstaller")
            out_dir = args.output or f"./uninstall_{args.tool.strip().lower()}"
            res = generate_uninstaller_suite(args.tool, out_dir, package_id=args.package or "")
            _emit(res, args.json)
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
        print("\n=== OMP System Maintenance Suite ===")
        print("1. Analyze Reclaimable Disk Space (Dry-Run)")
        print("2. Clean Safe Dev/Temp Caches (Requires Confirmation)")
        print("3. Generate 9-Step Cross-OS AI Tool Uninstaller Suite")
        print("0. Exit")
        try:
            choice = input("Select option [0-3]: ").strip()
        except EOFError:
            return 0
        if choice == "0" or not choice:
            return 0
        elif choice == "1":
            mode = input("Mode [quick|dev|system|full] (default quick): ").strip() or "quick"
            run_command(argparse.Namespace(cmd="analyze", mode=mode, dry_run=True, force=False, os=None, json=False))
        elif choice == "2":
            mode = input("Mode [quick|dev|system|full] (default quick): ").strip() or "quick"
            preview = run_cleanup(mode=mode, dry_run=True)
            print(preview["markdown"])
            ans = input("Type YES to confirm cache deletion: ").strip()
            if ans == "YES":
                run_command(argparse.Namespace(cmd="clean", mode=mode, dry_run=False, force=True, os=None, json=True))
            else:
                print("Cancelled.")
        elif choice == "3":
            tool = input("Tool slug (e.g. my-cli): ").strip()
            out = input("Output dir (default ./uninstallers): ").strip() or "./uninstallers"
            run_command(argparse.Namespace(cmd="generate-uninstaller", tool=tool, output=out, package="", json=True))
        else:
            print("Invalid selection.")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="OMP System Maintenance Suite Dual-Mode CLI")
    p.add_argument("--cmd", choices=["analyze", "clean", "generate-uninstaller"])
    p.add_argument("--mode", default="quick", choices=["quick", "dev", "system", "full"])
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true", help="Explicit authorization for cache deletion")
    p.add_argument("--os", default=None, help="Override OS detection (windows|darwin|linux)")
    p.add_argument("--tool", help="Target tool name for uninstaller generation")
    p.add_argument("--package", default="", help="npm/brew/winget package id")
    p.add_argument("--output", help="Output directory for generated uninstallers")
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
