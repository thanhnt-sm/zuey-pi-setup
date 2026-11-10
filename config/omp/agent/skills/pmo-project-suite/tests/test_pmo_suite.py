#!/usr/bin/env python3
"""Comprehensive regression tests for V2 pmo-project-suite (covering all fixes & ported modules)."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SUITE_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = SUITE_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import openpyxl  # noqa: E402

from core_pmo import (  # noqa: E402
    audit_report_evidence,
    build_obligation_deliverable_matrix,
    calculate_cpm_schedule,
    calculate_evm_metrics,
    calculate_sprint_metrics,
    calculate_verified_delivery,
    calculate_working_days,
    detect_circular_dependencies,
    evaluate_change_request,
    is_dangerous_formula,
    safe_load_workbook,
    validate_obligation_register,
)
from note_raid_tracker import (  # noqa: E402
    archive_inbox_rows,
    generate_raid_markdown_report,
    init_tracker_workbook,
    stage_action_plan,
    stage_lint,
    stage_roll_note,
    sync_notes_to_tracker,
)
from project_sync import (  # noqa: E402
    SyncConflictError,
    build_msp_xml_from_excel,
    export_msp_xml_to_excel,
    extract_sprint_from_schedule,
    import_excel_to_msp_xml,
    parse_msp_xml,
)


SAMPLE_MSP_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Sample Project</Name>
  <Tasks>
    <Task>
      <UID>1</UID>
      <GUID>guid-1</GUID>
      <Name>Phase 1</Name>
      <OutlineLevel>1</OutlineLevel>
      <Summary>1</Summary>
      <Start>2026-11-01T08:00:00</Start>
      <Finish>2026-11-10T17:00:00</Finish>
      <Duration>PT80H0M0S</Duration>
      <PercentComplete>50</PercentComplete>
    </Task>
    <Task>
      <UID>2</UID>
      <GUID>guid-2</GUID>
      <Name>1% Starter Task</Name>
      <OutlineLevel>2</OutlineLevel>
      <Summary>0</Summary>
      <Start>2026-11-01T08:00:00</Start>
      <Finish>2026-11-05T17:00:00</Finish>
      <Duration>PT40H0M0S</Duration>
      <PercentComplete>1</PercentComplete>
      <Notes>Initial setup</Notes>
    </Task>
    <Task>
      <UID>3</UID>
      <GUID>guid-3</GUID>
      <Name>=cmd|'calc'!A0</Name>
      <OutlineLevel>2</OutlineLevel>
      <Summary>0</Summary>
      <Start>2026-11-06T08:00:00</Start>
      <Finish>2026-11-10T17:00:00</Finish>
      <Duration>PT40H0M0S</Duration>
      <PercentComplete>0</PercentComplete>
      <PredecessorLink><PredecessorUID>2</PredecessorUID></PredecessorLink>
    </Task>
  </Tasks>
</Project>
"""


class TestPmoSuiteV2(unittest.TestCase):
    def test_cpm_end_filter_and_depends_on_alias(self) -> None:
        # B is critical duration 10; D->C has zero total float only if same end, but dead-end subchain C (dur 4, starts 0, ends 4) must not emit full critical path
        tasks = [
            {"id": "A", "duration": 4},
            {"id": "B", "duration": 6, "depends_on": ["A"]},
            {"id": "C", "duration": 10},  # equal duration 10 (critical end)
        ]
        res = calculate_cpm_schedule(tasks)
        self.assertTrue(res["is_valid"])
        self.assertEqual(res["project_duration"], 10.0)
        self.assertEqual(res["errors"], [])
        self.assertEqual(len(res["all_critical_paths"]), 2)

    def test_evm_zero_weight_not_unverified_and_scope_state(self) -> None:
        tasks = [
            {"id": "T1", "effort": 10, "status": "Done", "evidence": "ok"},
            {"id": "T2", "effort": 0, "status": "Done"},  # missing estimate, must NOT be in unverified_tasks
            {"id": "T3", "effort": 50, "status": "Open", "scope_state": "proposed"},  # excluded
            {"id": "T4", "effort": 10, "status": "Done", "evidence": "   "},  # whitespace -> unverified
        ]
        res = calculate_verified_delivery(tasks)
        self.assertEqual(res["missing_estimates"], ["T2"])
        self.assertEqual(res["unverified_tasks"], ["T4"])
        self.assertEqual(res["verified_delivery"], 0.5)

        evm = calculate_evm_metrics(100, 90, 100, bac=200)
        self.assertTrue(evm["is_valid"])
        self.assertEqual(evm["spi"], 0.9)

    def test_obligation_cr_dates_rtm_sprint_audit(self) -> None:
        obs = [{
            "Obligation ID": "OB-1", "Source Reference": "Contract §2", "Obligor": "contractor",
            "Deliverable": "DEL-1", "Due Date / Trigger": "2026-11-30",
            "Acceptance Criteria": "All integration tests green", "Authorized Role": "Sponsor", "Category": "product",
        }]
        self.assertTrue(validate_obligation_register(obs, ["DEL-1"])["is_valid"])
        mat = build_obligation_deliverable_matrix(obs, ["DEL-1", "DEL-CREEP"])
        self.assertEqual(mat["uncontracted_deliverables"], ["DEL-CREEP"])

        cr = evaluate_change_request({"cr_id": "CR-1", "authority": "Project Sponsor", "status": "approved", "added_tasks": [{"effort": 16}]})
        self.assertTrue(cr["is_valid"])
        self.assertEqual(cr["net_effort_delta"], 16.0)

        self.assertEqual(calculate_working_days("2026-11-02", "2026-11-08"), 5)  # Mon..Fri = 5 days
        has_cyc, _ = detect_circular_dependencies({"A": ["B"], "B": ["A"]})
        self.assertTrue(has_cyc)
        self.assertTrue(is_dangerous_formula('=HYPERLINK("http://evil.example","x")'))
        self.assertEqual(calculate_sprint_metrics([{"effort": 10, "status": "Done"}, {"effort": 10, "status": "Open"}])["completion_rate"], 0.5)

        aud = audit_report_evidence([{"id": "T1", "percent_complete": 95, "effort": 5}])
        self.assertEqual(aud["findings"][0]["code"], "SELF_REPORTED_PROGRESS")

    def test_raid_column_fix_vietnamese_dryrun_and_cicd(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            note = tdir / "notes_20261110.pmn"
            tracker = tdir / "RAID_tracker.xlsx"
            note.write_text(
                "## 10/11/2026 Daily Sync\n"
                "\tI: API timeout on sync @Alice !12/11/2026\n"
                "\tD: Adopt pure Python engine @Bob\n"
                "\tQ: Confirm cutoff time @Charlie\n"
                "\tC: Add sprint filter @Alice\n"
                "\tA: Update baseline @Alice !11/11/2026\n",
                encoding="utf-8",
            )
            init_tracker_workbook(tracker, "Test Project")
            # Dry-run succeeds even without locking errors
            dry = sync_notes_to_tracker(note, tracker, dry_run=True)
            self.assertGreaterEqual(dry["added_count"], 5)

            res = sync_notes_to_tracker(note, tracker, backup_dir=tdir / "baks")
            self.assertEqual(res["added_count"], 5)
            self.assertIsNotNone(res["backup_path"])

            # Mark Q-01 closed in Vietnamese ("Đã đóng") and verify Decisions (Approved) isn't marked open by Source column
            wb = openpyxl.load_workbook(tracker)
            wb["QnA"].cell(2, 6, "Đã đóng")
            wb.save(tracker)
            wb.close()

            rep = generate_raid_markdown_report(tracker)
            self.assertEqual(rep["summary"]["Decisions"]["closed"], 1)
            self.assertEqual(rep["summary"]["QnA"]["closed"], 1)
            self.assertEqual(rep["summary"]["CR_candidates"]["open"], 1)

            lint = stage_lint([note])
            self.assertTrue(lint["ok"])
            plan = stage_action_plan(tracker, [note])
            self.assertIn("PMO Action Plan", plan["markdown"])
            roll = stage_roll_note(note, tracker, archive_notes_dir=tdir / "arc")
            self.assertTrue(roll["rolled"])
            arc = archive_inbox_rows(tracker, tdir / "inbox.csv")
            self.assertEqual(arc["archived_count"], 0)

    def test_msp_percent_1_fix_syncmeta_utf16_xxe_and_sprint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            xml_in = tdir / "plan.xml"
            xlsx = tdir / "schedule.xlsx"
            xml_out = tdir / "merged.xml"
            xml_in.write_text(SAMPLE_MSP_XML, encoding="utf-8")

            parsed = parse_msp_xml(xml_in)
            # CRITICAL FIX: XML PercentComplete=1 MUST be 0.01 (1%), NOT 1.0 (100%)
            self.assertEqual(parsed[1]["PercentComplete"], 0.01)

            export_msp_xml_to_excel(xml_in, xlsx)
            wb = openpyxl.load_workbook(xlsx)
            self.assertEqual(wb["Schedule"].cell(4, 5).value, "'=cmd|'calc'!A0")
            wb["Schedule"].cell(3, 9, 0.25)  # Update task UID 2 to 25%
            wb.save(xlsx)
            wb.close()

            mres = import_excel_to_msp_xml(xlsx, xml_in, xml_out)
            self.assertEqual(mres["changes_applied"], 1)
            self.assertEqual(mres["generation"], 2)
            self.assertIn("<PercentComplete>25</PercentComplete>", xml_out.read_text(encoding="utf-8"))

            # Verify _SyncMeta bumped to gen 2
            wb2 = openpyxl.load_workbook(xlsx)
            self.assertEqual(wb2["_SyncMeta"].cell(2, 4).value, 2)
            wb2.close()

            # UTF-16 XXE blocked
            xxe16 = tdir / "xxe16.xml"
            xxe16.write_bytes('<?xml version="1.0"?><!DOCTYPE foo><Project/>'.encode("utf-16"))
            with self.assertRaises(ValueError):
                parse_msp_xml(xxe16)

            # Conflict policy Block
            wb3 = openpyxl.load_workbook(xlsx)
            wb3["Schedule"].cell(3, 5, "Excel Edit")
            wb3.save(xlsx)
            wb3.close()
            xml_mod = tdir / "mod.xml"
            xml_mod.write_text(SAMPLE_MSP_XML.replace("1% Starter Task", "Project Edit"), encoding="utf-8")
            with self.assertRaises(SyncConflictError):
                import_excel_to_msp_xml(xlsx, xml_mod, xml_out, conflict_policy="Block")

            # Standalone plan builder & sprint exporter
            built = build_msp_xml_from_excel(xlsx, tdir / "built.xml")
            self.assertEqual(built["tasks_written"], 3)
            sp = extract_sprint_from_schedule(xml_in, "2026-11-01", "2026-11-05", output_xlsx=tdir / "sprint.xlsx")
            self.assertEqual(sp["task_count"], 1)

            # Safe workbook 0-byte trap
            empty_xlsx = tdir / "empty.xlsx"
            empty_xlsx.write_bytes(b"")
            self.assertEqual(safe_load_workbook(empty_xlsx)["error_category"], "ZERO_BYTE_FILE")

    def test_cli_json_and_interactive_exit(self) -> None:
        cli = SCRIPTS_DIR / "pmo_cli.py"
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            inp = tdir / "cpm.json"
            inp.write_text(json.dumps({"tasks": [{"id": "A", "duration": 3}, {"id": "B", "duration": 2, "depends_on": ["A"]}]}), encoding="utf-8")
            p1 = subprocess.run([sys.executable, str(cli), "--cmd", "cpm", "--input", str(inp), "--json"], capture_output=True, text=True)
            self.assertEqual(p1.returncode, 0, p1.stderr)
            self.assertEqual(json.loads(p1.stdout)["project_duration"], 5.0)
            p2 = subprocess.run([sys.executable, str(cli)], input="0\n", capture_output=True, text=True)
            self.assertEqual(p2.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
