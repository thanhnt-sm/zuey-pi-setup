#!/usr/bin/env python3
"""Unit & integration tests for system-maintenance-suite."""

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

from cleaner_dispatcher import get_cleanup_targets, run_cleanup  # noqa: E402
from uninstaller_builder import generate_uninstaller_suite  # noqa: E402


class TestMaintenanceSuite(unittest.TestCase):
    def test_dry_run_preserves_files_and_force_cleans_only_safe_targets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            cache = tdir / "pip-cache"
            cache.mkdir()
            f1 = cache / "wheel.whl"
            f1.write_bytes(b"x" * 2048)

            # Dry-run MUST NOT delete anything
            dry = run_cleanup(dry_run=True, force=False, custom_targets=[{"category": "pip", "path": cache}])
            self.assertEqual(dry["total_reclaimable_bytes"], 2048)
            self.assertEqual(dry["total_freed_bytes"], 0)
            self.assertTrue(f1.is_file())

            # Non-dry-run WITHOUT --force MUST raise PermissionError
            with self.assertRaises(PermissionError):
                run_cleanup(dry_run=False, force=False, custom_targets=[{"category": "pip", "path": cache}])
            self.assertTrue(f1.is_file())

            # Non-dry-run WITH --force deletes cache contents safely
            res = run_cleanup(dry_run=False, force=True, custom_targets=[{"category": "pip", "path": cache}])
            self.assertEqual(res["total_freed_bytes"], 2048)
            self.assertFalse(f1.exists())

    def test_cross_os_target_enumeration(self) -> None:
        win = get_cleanup_targets(mode="full", os_kind="windows", home_dir=Path("/mock/win"))
        mac = get_cleanup_targets(mode="full", os_kind="darwin", home_dir=Path("/mock/mac"))
        self.assertTrue(any("pip" in t["category"] for t in win))
        self.assertTrue(any("homebrew" in t["category"] for t in mac))

    def test_uninstaller_7bit_ascii_line_endings_and_no_bom(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            res = generate_uninstaller_suite("Demo AI CLI", tmp, package_id="@demo/ai-cli")
            for k in ("bat", "ps1", "sh"):
                raw = Path(res[k]).read_bytes()
                self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), f"BOM found in {k}")
                self.assertTrue(raw.decode("ascii").isascii())
            self.assertIn(b"\r\n", Path(res["bat"]).read_bytes())
            self.assertIn(b"\r\n", Path(res["ps1"]).read_bytes())
            self.assertNotIn(b"\r\n", Path(res["sh"]).read_bytes())
            self.assertIn(b'cd /d "%~dp0"', Path(res["bat"]).read_bytes())

    def test_dual_mode_cli(self) -> None:
        cli = SCRIPTS_DIR / "maintenance_cli.py"
        with tempfile.TemporaryDirectory() as tmp:
            p1 = subprocess.run([sys.executable, str(cli), "--cmd", "generate-uninstaller", "--tool", "probe", "--output", tmp, "--json"], capture_output=True, text=True)
            self.assertEqual(p1.returncode, 0, p1.stderr)
            self.assertEqual(json.loads(p1.stdout)["tool"], "probe")

            p2 = subprocess.run([sys.executable, str(cli)], input="0\n", capture_output=True, text=True)
            self.assertEqual(p2.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
