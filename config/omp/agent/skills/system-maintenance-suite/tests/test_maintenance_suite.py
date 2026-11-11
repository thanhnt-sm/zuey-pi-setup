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

from cleaner_dispatcher import (  # noqa: E402
    find_orphan_leftovers,
    find_stale_project_artifacts,
    get_cleanup_targets,
    quarantine_paths,
    run_cleanup,
)
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

    def test_cleanpc_v26_extended_caches_stale_artifacts_and_quarantine(self) -> None:
        import os
        import time

        win_ext = get_cleanup_targets(mode="extended", os_kind="windows", home_dir=Path("/mock/win"))
        mac_ext = get_cleanup_targets(mode="extended", os_kind="darwin", home_dir=Path("/mock/mac"))
        self.assertTrue(any("ruff" in t["category"] or "playwright" in t["category"] for t in win_ext))
        self.assertTrue(any("playwright" in t["category"] or "claude_old_versions" in t["category"] for t in mac_ext))

        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            stale_proj = tdir / "old_app"
            stale_nm = stale_proj / "node_modules"
            stale_nm.mkdir(parents=True)
            (stale_proj / "package.json").write_text('{"name":"old"}', encoding="utf-8")
            (stale_nm / "pkg.js").write_bytes(b"a" * 1024)
            old_ts = time.time() - (120 * 86400)
            os.utime(stale_proj / "package.json", (old_ts, old_ts))
            os.utime(stale_nm / "pkg.js", (old_ts, old_ts))

            active_proj = tdir / "active_app"
            active_nm = active_proj / "node_modules"
            active_nm.mkdir(parents=True)
            (active_proj / "package.json").write_text('{"name":"active"}', encoding="utf-8")
            (active_nm / "pkg.js").write_bytes(b"b" * 1024)

            stale_res = find_stale_project_artifacts([tdir], stale_days=90)
            self.assertEqual(len(stale_res["stale"]), 1)
            self.assertIn("old_app", stale_res["stale"][0]["path"])
            self.assertTrue(stale_nm.exists())

            q_root = tdir / "quarantine"
            orphan_dir = tdir / "orphaned_app_data"
            orphan_dir.mkdir()
            (orphan_dir / "state.json").write_text("{}", encoding="utf-8")
            leftovers = find_orphan_leftovers([tdir], installed_names={"active_app", "old_app", "quarantine"})
            self.assertTrue(any("orphaned_app_data" in x["path"] for x in leftovers))

            dry_q = quarantine_paths([orphan_dir], quarantine_root=q_root, dry_run=True, force=False)
            self.assertTrue(orphan_dir.exists())
            self.assertEqual(dry_q["quarantinedCount"], 0)

            res_q = quarantine_paths([orphan_dir], quarantine_root=q_root, dry_run=False, force=True)
            self.assertFalse(orphan_dir.exists())
            self.assertEqual(res_q["quarantinedCount"], 1)
            self.assertTrue(Path(res_q["restoreScript"]).is_file())

            cli = SCRIPTS_DIR / "maintenance_cli.py"
            p_stale = subprocess.run(
                [sys.executable, str(cli), "--cmd", "stale-scan", "--roots", str(tdir), "--stale-days", "90", "--json"],
                capture_output=True, text=True,
            )
            self.assertEqual(p_stale.returncode, 0, p_stale.stderr)
            self.assertEqual(len(json.loads(p_stale.stdout)["stale"]), 1)

if __name__ == "__main__":
    unittest.main(verbosity=2)
