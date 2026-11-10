#!/usr/bin/env python3
"""Unit & integration tests for email-intelligence-suite."""

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

from email_parser import analyze_emails, export_email_excel, load_emails_from_path  # noqa: E402


def _make_eml(subject: str, frm: str, to: str, date_s: str, msg_id: str, body: str, irt: str = "") -> str:
    hdrs = [
        f"Subject: {subject}",
        f"From: {frm}",
        f"To: {to}",
        f"Date: {date_s}",
        f"Message-ID: {msg_id}",
    ]
    if irt:
        hdrs.append(f"In-Reply-To: {irt}")
    hdrs.extend(["Content-Type: text/plain; charset=utf-8", "", body])
    return "\n".join(hdrs)


class TestEmailSuite(unittest.TestCase):
    def test_eml_threading_scrubbing_dedupe_and_excel(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            e1 = tdir / "01.eml"
            e2 = tdir / "02.eml"
            e3 = tdir / "03_dup.eml"
            e1.write_text(_make_eml(
                "[URGENT] API Outage ##9012##", "alice@example.com", "bob@example.com",
                "Mon, 02 Nov 2026 09:00:00 +0700", "<m1@example.com>",
                "Critical bug in auth gateway.\nPlease deploy fix today.\n\nBest regards,\nAlice\nMobile: 0901234567",
            ), encoding="utf-8")
            e2.write_text(_make_eml(
                "RE: [URGENT] API Outage ##9012##", "bob@example.com", "alice@example.com",
                "Mon, 02 Nov 2026 10:30:00 +0700", "<m2@example.com>",
                "Action item: hotfix scheduled for 14:00.\n\nOn Mon, Alice wrote:\n> Critical bug in auth gateway.",
                irt="<m1@example.com>",
            ), encoding="utf-8")
            # Duplicate export of thread 1
            e3.write_text(_make_eml(
                "=cmd|'calc'!A0", "alice@example.com", "bob@example.com",
                "Tue, 03 Nov 2026 09:00:00 +0700", "<m3@example.com>",
                "Urgent: verify formula injection neutralization.",
            ), encoding="utf-8")

            msgs = load_emails_from_path(tdir)
            self.assertEqual(len(msgs), 3)
            # Duplicate thread check on exact duplicate set
            msgs_with_dup = msgs + [msgs[0]]
            res = analyze_emails(msgs_with_dup, dedupe=True)
            self.assertEqual(res["thread_count"], 2)
            self.assertGreaterEqual(res["issue_count"], 2)
            # Quote scrubbing removed "On Mon, Alice wrote:" and signature "Mobile:"
            first_msgs = res["threads"][0]["messages"]
            self.assertNotIn("Mobile: 0901234567", first_msgs[0]["text"])
            self.assertNotIn("On Mon, Alice wrote", first_msgs[1]["text"])

            xlsx_out = tdir / "report.xlsx"
            export_email_excel(res, xlsx_out)
            wb = openpyxl.load_workbook(xlsx_out)
            ws = wb["Threads"]
            # Formula injection sanitized
            subjects = [ws.cell(r, 5).value for r in range(2, ws.max_row + 1)]
            self.assertTrue(any(str(s).startswith("'=") for s in subjects))
            wb.close()

    def test_dual_mode_cli(self) -> None:
        cli = SCRIPTS_DIR / "email_cli.py"
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            (tdir / "a.eml").write_text(_make_eml(
                "Todo: Check logs", "a@example.com", "b@example.com",
                "Mon, 02 Nov 2026 08:00:00 +0000", "<a@ex>", "Urgent blocker on staging.",
            ), encoding="utf-8")
            out_md = tdir / "out.md"
            p1 = subprocess.run([sys.executable, str(cli), "--cmd", "scan", "--input", str(tdir), "--output", str(out_md), "--format", "md", "--dedupe", "--json"], capture_output=True, text=True)
            self.assertEqual(p1.returncode, 0, p1.stderr)
            self.assertEqual(json.loads(p1.stdout)["thread_count"], 1)
            self.assertTrue(out_md.is_file())

            p2 = subprocess.run([sys.executable, str(cli)], input="0\n", capture_output=True, text=True)
            self.assertEqual(p2.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
