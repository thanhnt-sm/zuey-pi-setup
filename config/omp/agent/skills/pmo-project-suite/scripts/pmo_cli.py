#!/usr/bin/env python3
"""
pmo_cli.py — Dual-Mode CLI Runner for OMP `pmo-project-suite` Skill (Priority 100).

Supports:
- Interactive TTY Menu Mode (run without --cmd)
- Non-Interactive Agent Mode (--cmd <subcommand> ... --json)
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any, List, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from venv_bootstrap import attach_omp_tools_venv  # noqa: E402

attach_omp_tools_venv()

from core_pmo import (  # noqa: E402
    analyze_risk_register,
    audit_report_evidence,
    build_obligation_deliverable_matrix,
    calculate_cpm_schedule,
    calculate_evm_metrics,
    calculate_owner_capacity_allocation,
    calculate_project_pert,
    calculate_sprint_metrics,
    calculate_verified_delivery,
    detect_schedule_date_anomalies,
    evaluate_change_request,
    flag_weekend_deliveries,
    generate_pmo_status_report,
    safe_inspect_archive_members,
    safe_load_workbook,
    validate_obligation_register,
    validate_rtm_matrix,
    validate_wbs_hierarchy,
    verify_atomic_revision_set,
)
from note_raid_tracker import (  # noqa: E402
    archive_inbox_rows,
    generate_raid_markdown_report,
    init_tracker_workbook,
    load_pmo_config,
    stage_action_plan,
    stage_doctor,
    stage_lint,
    stage_roll_note,
    sync_notes_to_tracker,
)
from project_sync import (  # noqa: E402
    SyncConflictError,
    build_msp_xml_from_excel,
    export_mpp_via_windows_com,
    export_msp_xml_to_excel,
    extract_sprint_from_schedule,
    import_excel_to_msp_xml,
)


def _read_json(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def _emit(payload: Any, as_json: bool, output_path: Optional[str] = None) -> None:
    if output_path and isinstance(payload, dict) and "markdown" in payload and not as_json:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_text(str(payload["markdown"]) + "\n", encoding="utf-8")
    if as_json:
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
    else:
        if isinstance(payload, dict) and "markdown" in payload:
            print(payload["markdown"])
        else:
            print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))


def run_command(args: argparse.Namespace) -> int:
    cmd = args.cmd
    try:
        if cmd == "cpm":
            data = _read_json(args.input)
            tasks = data.get("tasks", data) if isinstance(data, dict) else data
            _emit(calculate_cpm_schedule(tasks), args.json)
            return 0

        if cmd == "evm":
            data = _read_json(args.input)
            res = calculate_evm_metrics(data["pv"], data["ev"], data["ac"], bac=data.get("bac"), unit=data.get("unit", "currency"))
            _emit(res, args.json)
            return 0 if res.get("is_valid") else 2

        if cmd == "verified-delivery":
            data = _read_json(args.input)
            tasks = data.get("tasks", data) if isinstance(data, dict) else data
            _emit(calculate_verified_delivery(tasks), args.json)
            return 0

        if cmd == "pert":
            data = _read_json(args.input)
            tasks = data.get("tasks", data) if isinstance(data, dict) else data
            target = data.get("target_duration") if isinstance(data, dict) else None
            _emit(calculate_project_pert(tasks, target_duration=target), args.json)
            return 0

        if cmd == "wbs":
            data = _read_json(args.input)
            nodes = data.get("nodes", data) if isinstance(data, dict) else data
            _emit(validate_wbs_hierarchy(nodes), args.json)
            return 0

        if cmd == "risk":
            data = _read_json(args.input)
            risks = data.get("risks", data) if isinstance(data, dict) else data
            _emit(analyze_risk_register(risks), args.json)
            return 0

        if cmd == "rtm":
            data = _read_json(args.input)
            rows = data.get("requirements", data) if isinstance(data, dict) else data
            known = data.get("known_tasks") if isinstance(data, dict) else None
            _emit(validate_rtm_matrix(rows, all_known_tasks=known), args.json)
            return 0

        if cmd == "capacity":
            data = _read_json(args.input)
            res = calculate_owner_capacity_allocation(data.get("tasks", []), data.get("capacities", {}), default_capacity=data.get("default_capacity"))
            _emit(res, args.json)
            return 0

        if cmd == "sprint-metrics":
            data = _read_json(args.input)
            tasks = data.get("tasks", data) if isinstance(data, dict) else data
            _emit(calculate_sprint_metrics(tasks), args.json)
            return 0

        if cmd == "dates":
            data = _read_json(args.input)
            tasks = data.get("tasks", data) if isinstance(data, dict) else data
            anoms = detect_schedule_date_anomalies(tasks)
            wknd = flag_weekend_deliveries(tasks)
            _emit({"is_valid": len(anoms) == 0, "anomalies": anoms, "weekend_deliveries": wknd}, args.json)
            return 0

        if cmd == "obligation":
            data = _read_json(args.input)
            obs = data.get("obligations", data) if isinstance(data, dict) else data
            delivs = data.get("deliverables", []) if isinstance(data, dict) else []
            reg = validate_obligation_register(obs, all_known_deliverables=delivs or None)
            if delivs:
                reg["matrix"] = build_obligation_deliverable_matrix(obs, delivs)
            _emit(reg, args.json)
            return 0

        if cmd == "cr":
            data = _read_json(args.input)
            cr_obj = data.get("cr", data)
            _emit(evaluate_change_request(cr_obj, data.get("baseline_requirements"), data.get("baseline_tasks")), args.json)
            return 0

        if cmd == "security":
            if str(args.input).lower().endswith((".xlsx", ".xlsm")):
                res = safe_load_workbook(args.input, read_only=True)
                if res.get("workbook"):
                    res["workbook"].close()
                res["workbook"] = None
                _emit(res, args.json)
            else:
                ok, violations, members = safe_inspect_archive_members(args.input)
                _emit({"is_safe": ok, "violations": violations, "member_count": len(members)}, args.json)
            return 0

        if cmd == "manifest":
            manifest = _read_json(args.input)
            cand_dir = args.base_dir or str(Path(args.input).parent)
            ok, violations = verify_atomic_revision_set(manifest, cand_dir)
            _emit({"is_valid": ok, "violations": violations}, args.json)
            return 0 if ok else 2

        if cmd == "audit":
            data = _read_json(args.input)
            tasks = data.get("tasks", data) if isinstance(data, dict) else data
            cutoff = data.get("cutoff_date") if isinstance(data, dict) else None
            _emit(audit_report_evidence(tasks, cutoff_date=cutoff), args.json)
            return 0

        if cmd == "report":
            data = _read_json(args.input)
            res = generate_pmo_status_report(
                project_name=data.get("project_name", "Project"),
                reporting_period=data.get("reporting_period", "Current"),
                cutoff_date=data.get("cutoff_date", ""),
                baseline_version=data.get("baseline_version", "v1.0"),
                audience=data.get("audience", "internal"),
                verified_delivery_data=data.get("verified_delivery_data"),
                evm_data=data.get("evm_data"),
                capacity_data=data.get("capacity_data"),
                raid_items=data.get("raid_items"),
            )
            _emit(res, args.json, output_path=args.output)
            return 0

        if cmd == "raid-init":
            out = init_tracker_workbook(args.output or "RAID_tracker.xlsx", project_name=args.project or "Default Project")
            _emit({"status": "initialized", "tracker": str(out)}, args.json)
            return 0

        if cmd == "raid":
            cfg = load_pmo_config(args.config)
            tracker = args.tracker or args.output or cfg.get("tracker_path", "RAID_tracker.xlsx")
            res = sync_notes_to_tracker(
                note_files=args.input, book_path=tracker, dry_run=args.dry_run,
                backup_dir=args.backup_dir or cfg.get("backup_dir"),
                owner_aliases=cfg.get("owner_aliases"), auto_init=args.auto_init,
            )
            res.pop("entries", None)
            _emit(res, args.json)
            return 0

        if cmd == "raid-report":
            tracker = args.input or args.tracker or "RAID_tracker.xlsx"
            res = generate_raid_markdown_report(tracker, output_path=args.output)
            _emit(res, args.json)
            return 0

        if cmd == "note-doctor":
            cfg = load_pmo_config(args.config)
            _emit(stage_doctor(cfg), args.json)
            return 0

        if cmd == "note-lint":
            cfg = load_pmo_config(args.config)
            _emit(stage_lint([args.input], cfg), args.json)
            return 0

        if cmd == "note-plan":
            tracker = args.tracker or "RAID_tracker.xlsx"
            notes = [args.input] if args.input else None
            _emit(stage_action_plan(tracker, note_files=notes, output_path=args.output), args.json)
            return 0

        if cmd == "note-roll":
            tracker = args.tracker or "RAID_tracker.xlsx"
            _emit(stage_roll_note(args.input, tracker, force=args.force), args.json)
            return 0

        if cmd == "note-archive":
            tracker = args.tracker or args.input or "RAID_tracker.xlsx"
            _emit(archive_inbox_rows(tracker, args.output or "archive/inbox_closed.csv", backup_dir=args.backup_dir), args.json)
            return 0

        if cmd == "msp2xlsx":
            src_xml = args.input
            with tempfile.TemporaryDirectory() as tmp:
                if args.use_com and str(src_xml).lower().endswith(".mpp"):
                    tmp_xml = str(Path(tmp) / "exported.xml")
                    export_mpp_via_windows_com(src_xml, tmp_xml)
                    src_xml = tmp_xml
                out_xlsx = args.output or str(Path(args.input).with_suffix(".xlsx"))
                _emit(export_msp_xml_to_excel(src_xml, out_xlsx, profile_path=args.profile), args.json)
            return 0

        if cmd == "xlsx2msp":
            if not args.base_xml:
                raise ValueError("--base-xml is required for xlsx2msp")
            out_xml = args.output or str(Path(args.base_xml).with_name(Path(args.base_xml).stem + "_merged.xml"))
            _emit(import_excel_to_msp_xml(args.input, args.base_xml, out_xml, conflict_policy=args.policy), args.json)
            return 0

        if cmd == "excel2xml":
            out_xml = args.output or str(Path(args.input).with_suffix(".xml"))
            _emit(build_msp_xml_from_excel(args.input, out_xml, project_name=args.project), args.json)
            return 0

        if cmd == "sprint-export":
            if not args.start or not args.end:
                raise ValueError("--start and --end (YYYY-MM-DD) are required for sprint-export")
            _emit(extract_sprint_from_schedule(args.input, args.start, args.end, output_xlsx=args.output), args.json)
            return 0

        if cmd == "mpp2xml":
            out_xml = args.output or str(Path(args.input).with_suffix(".xml"))
            _emit(export_mpp_via_windows_com(args.input, out_xml), args.json)
            return 0

        raise ValueError(f"Unknown command: {cmd}")
    except SyncConflictError as exc:
        err = {"is_valid": False, "error": str(exc), "conflicts": exc.conflicts}
        print(json.dumps(err, indent=2, ensure_ascii=False))
        return 2
    except Exception as exc:
        err = {"is_valid": False, "error": str(exc)}
        if args.json:
            print(json.dumps(err, indent=2, ensure_ascii=False))
        else:
            print(f"Error: {exc}", file=sys.stderr)
        return 1


def run_interactive_menu() -> int:
    while True:
        print("\n=== OMP PMO Project Suite ===")
        print("1. Run CPM Critical Path / EVM Analysis (JSON)")
        print("2. Parse Daily Note (.pmn) & Sync RAID Tracker (.xlsx)")
        print("3. Export MS Project XML -> Excel (.xlsx)")
        print("4. Merge Excel -> MS Project XML (3-way sync)")
        print("5. Build MS Project XML from Excel / Extract Sprint")
        print("6. Generate RAID / PM Status Markdown Report")
        print("0. Exit")
        try:
            choice = input("Select option [0-6]: ").strip()
        except EOFError:
            return 0
        if choice == "0" or not choice:
            return 0
        elif choice == "1":
            sub = input("Analysis type [cpm|evm|pert|wbs|risk|obligation|cr|audit]: ").strip().lower() or "cpm"
            inp = input("Input JSON file path: ").strip()
            run_command(argparse.Namespace(cmd=sub, input=inp, json=True, output=None, base_dir=None))
        elif choice == "2":
            note_p = input("Daily note path (.pmn/.txt): ").strip()
            book_p = input("RAID tracker workbook path (.xlsx): ").strip()
            dry = input("Dry-run only? [y/N]: ").strip().lower().startswith("y")
            run_command(argparse.Namespace(cmd="raid", input=note_p, tracker=book_p, output=None, dry_run=dry, config=None, backup_dir=None, auto_init=False, json=True))
        elif choice == "3":
            xml_p = input("Source MS Project XML path: ").strip()
            xlsx_p = input("Output Excel path: ").strip() or None
            run_command(argparse.Namespace(cmd="msp2xlsx", input=xml_p, output=xlsx_p, profile=None, use_com=False, json=True))
        elif choice == "4":
            xlsx_p = input("Edited Excel path: ").strip()
            base_p = input("Base MS Project XML path: ").strip()
            out_p = input("Output XML path: ").strip() or None
            pol = input("Conflict policy [Project|Excel|Block] (default Project): ").strip() or "Project"
            run_command(argparse.Namespace(cmd="xlsx2msp", input=xlsx_p, base_xml=base_p, output=out_p, policy=pol, json=True))
        elif choice == "5":
            mode = input("Mode [excel2xml|sprint-export]: ").strip() or "sprint-export"
            inp = input("Input path: ").strip()
            out = input("Output path: ").strip() or None
            if mode == "sprint-export":
                st = input("Start date (YYYY-MM-DD): ").strip()
                en = input("End date (YYYY-MM-DD): ").strip()
                run_command(argparse.Namespace(cmd="sprint-export", input=inp, output=out, start=st, end=en, json=True))
            else:
                run_command(argparse.Namespace(cmd="excel2xml", input=inp, output=out, project=None, json=True))
        elif choice == "6":
            book_p = input("RAID tracker workbook path (.xlsx): ").strip()
            out_p = input("Output Markdown path (optional): ").strip() or None
            run_command(argparse.Namespace(cmd="raid-report", input=book_p, tracker=book_p, output=out_p, json=False))
        else:
            print("Invalid selection.")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="OMP PMO Project Suite Dual-Mode CLI")
    p.add_argument("--cmd", choices=[
        "cpm", "evm", "verified-delivery", "pert", "wbs", "risk", "rtm", "capacity", "sprint-metrics",
        "dates", "obligation", "cr", "security", "manifest", "audit", "report",
        "raid-init", "raid", "raid-report", "note-doctor", "note-lint", "note-plan", "note-roll", "note-archive",
        "msp2xlsx", "xlsx2msp", "excel2xml", "sprint-export", "mpp2xml",
    ])
    p.add_argument("--input", help="Input JSON / .pmn / .xml / .xlsx / archive path")
    p.add_argument("--output", help="Output path")
    p.add_argument("--tracker", help="RAID tracker .xlsx path")
    p.add_argument("--config", help="Optional .pmo_config.json path")
    p.add_argument("--backup-dir", help="Backup directory for RAID tracker")
    p.add_argument("--auto-init", action="store_true", help="Auto-initialize missing RAID tracker")
    p.add_argument("--force", action="store_true", help="Force note-roll even with unloaded entries")
    p.add_argument("--base-xml", help="Base MS Project XML path for xlsx2msp")
    p.add_argument("--base-dir", help="Candidate directory for manifest verification")
    p.add_argument("--profile", help="Optional sync profile.json path")
    p.add_argument("--use-com", action="store_true", help="Use Windows MS Project COM if input is .mpp")
    p.add_argument("--start", help="Sprint start date YYYY-MM-DD")
    p.add_argument("--end", help="Sprint end date YYYY-MM-DD")
    p.add_argument("--project", help="Project title")
    p.add_argument("--policy", default="Project", choices=["Project", "Excel", "Block"])
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--json", action="store_true")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.cmd:
        return run_interactive_menu()
    return run_command(args)


if __name__ == "__main__":
    sys.exit(main())
