"""Regression tests for ER diagram generator without third-party dependencies."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

# Add scripts directory to sys.path
SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Import run-plc-model.py via importlib.util (hyphen in filename)
MODEL_SCRIPT = SCRIPTS_DIR / "run-plc-model.py"
spec = importlib.util.spec_from_file_location("run_plc_model", str(MODEL_SCRIPT))
run_plc_model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_plc_model)

BACKUP_SCRIPT = SCRIPTS_DIR / "pre-cycle-backup.py"
EXTRACT_SCRIPT = SCRIPTS_DIR / "extract-evidence.py"


FIXTURE_GRAPH = {
    "schemaVersion": 2,
    "tables": [
        {
            "name": "TABLE_ROOT",
            "columns": [
                {"name": "ROOT_ID", "is_pk": True},
                {"name": "CODE_ID", "is_pk": False},
                {"name": "NAME", "is_pk": False},
            ],
        },
        {
            "name": "TABLE_MID",
            "columns": [
                {"name": "MID_ID", "is_pk": True},
                {"name": "ROOT_ID", "is_pk": False},
                {"name": "ALT_ROOT_ID", "is_pk": False},
                {"name": "REF_ID", "is_pk": False},
                {"name": "NOTE", "is_pk": False},
            ],
        },
        {
            "name": "TABLE_LEAF",
            "columns": [
                {"name": "LEAF_ID", "is_pk": True},
                {"name": "MID_ID", "is_pk": False},
                {"name": "DESCRIPTION", "is_pk": False},
            ],
        },
        {
            "name": "TABLE_BRANCH",
            "columns": [
                {"name": "BRANCH_ID", "is_pk": True},
                {"name": "ROOT_ID", "is_pk": False},
            ],
        },
        {
            "name": "TABLE_CYCLE_A",
            "columns": [
                {"name": "CYCLE_A_ID", "is_pk": True},
                {"name": "CYCLE_B_ID", "is_pk": False},
            ],
        },
        {
            "name": "TABLE_CYCLE_B",
            "columns": [
                {"name": "CYCLE_B_ID", "is_pk": True},
                {"name": "CYCLE_A_ID", "is_pk": False},
            ],
        },
        {
            "name": "TABLE_ISOLATED",
            "columns": [
                {"name": "ISO_ID", "is_pk": True},
                {"name": "EXT_ID", "is_pk": False},
                {"name": "STATUS", "is_pk": False},
            ],
        },
    ],
    "keys": [
        {"table": "TABLE_ROOT", "column": "ROOT_ID"},
        {"table": "TABLE_MID", "column": "MID_ID"},
        {"table": "TABLE_LEAF", "column": "LEAF_ID"},
        {"table": "TABLE_BRANCH", "column": "BRANCH_ID"},
        {"table": "TABLE_CYCLE_A", "column": "CYCLE_A_ID"},
        {"table": "TABLE_CYCLE_B", "column": "CYCLE_B_ID"},
        {"table": "TABLE_ISOLATED", "column": "ISO_ID"},
    ],
    "relations": [
        {
            "parent": "TABLE_ROOT",
            "parentColumn": "ROOT_ID",
            "child": "TABLE_MID",
            "column": "ROOT_ID",
            "cardinality": "1:N",
            "status": "confirmed",
        },
        {
            "parent": "TABLE_ROOT",
            "parentColumn": "ROOT_ID",
            "child": "TABLE_MID",
            "column": "ALT_ROOT_ID",
            "cardinality": "1:N",
            "status": "confirmed",
        },
        {
            "parent": "TABLE_MID",
            "parentColumn": "MID_ID",
            "child": "TABLE_LEAF",
            "column": "MID_ID",
            "cardinality": "1:N",
            "status": "proposed",
        },
        {
            "parent": "TABLE_ROOT",
            "parentColumn": "ROOT_ID",
            "child": "TABLE_BRANCH",
            "column": "ROOT_ID",
            "cardinality": "1:N",
            "status": "confirmed",
        },
        {
            "parent": "TABLE_CYCLE_B",
            "parentColumn": "CYCLE_B_ID",
            "child": "TABLE_CYCLE_A",
            "column": "CYCLE_B_ID",
            "cardinality": "1:1",
            "status": "confirmed",
        },
        {
            "parent": "TABLE_CYCLE_A",
            "parentColumn": "CYCLE_A_ID",
            "child": "TABLE_CYCLE_B",
            "column": "CYCLE_A_ID",
            "cardinality": "1:1",
            "status": "confirmed",
        },
        {
            "parent": "EXTERNAL_TABLE",
            "parentColumn": "OTHER_ID",
            "child": "TABLE_MID",
            "column": "OTHER_ID",
            "cardinality": "1:N",
            "status": "unresolved",
        },
    ],
}


class TestDiagramGeneration(unittest.TestCase):
    """Regression test suite for ER diagram generation, layout, and validation."""

    def test_import_generator(self):
        """Generator must expose pure functional builders and normalization routines."""
        self.assertTrue(callable(run_plc_model.model_from_json))
        self.assertTrue(callable(run_plc_model.normalize_partition))
        self.assertTrue(callable(run_plc_model.select_display_columns))
        self.assertTrue(callable(run_plc_model.build_mermaid))
        self.assertTrue(callable(run_plc_model.build_drawio))
        self.assertTrue(callable(run_plc_model.build_oracle_sqldev))
        self.assertTrue(callable(run_plc_model.compute_layered_layout))
        self.assertTrue(callable(run_plc_model.compute_core_layout))

    def test_filtered_rows_and_roles(self):
        """Only PK, FK, PK/FK, and candidate _ID columns are displayed; ordinary columns are omitted."""
        model = run_plc_model.model_from_json(FIXTURE_GRAPH)
        tables_by_name = {t["name"]: t for t in model["tables"]}

        # TABLE_ROOT: ROOT_ID is PK, CODE_ID is candidate ID, NAME is ordinary (omitted)
        root_cols = [(c["name"], c["role"]) for c in tables_by_name["TABLE_ROOT"]["display_columns"]]
        self.assertEqual(root_cols, [("ROOT_ID", "PK"), ("CODE_ID", "ID")])

        # TABLE_MID: MID_ID is PK, ROOT_ID & ALT_ROOT_ID are FK, REF_ID is candidate ID, NOTE is omitted
        mid_cols = [(c["name"], c["role"]) for c in tables_by_name["TABLE_MID"]["display_columns"]]
        self.assertEqual(
            mid_cols,
            [("MID_ID", "PK"), ("ROOT_ID", "FK"), ("ALT_ROOT_ID", "FK"), ("REF_ID", "ID")],
        )

        # TABLE_LEAF: LEAF_ID is PK, MID_ID is FK, DESCRIPTION is omitted
        leaf_cols = [(c["name"], c["role"]) for c in tables_by_name["TABLE_LEAF"]["display_columns"]]
        self.assertEqual(leaf_cols, [("LEAF_ID", "PK"), ("MID_ID", "FK")])

        # TABLE_ISOLATED: ISO_ID is PK, EXT_ID is candidate ID, STATUS is omitted
        iso_cols = [(c["name"], c["role"]) for c in tables_by_name["TABLE_ISOLATED"]["display_columns"]]
        self.assertEqual(iso_cols, [("ISO_ID", "PK"), ("EXT_ID", "ID")])

        # Composite PK/FK check
        composite_table = {
            "name": "TABLE_COMPOSITE",
            "columns": [{"name": "COMP_ID", "is_pk": True}, {"name": "REGULAR", "is_pk": False}],
        }
        composite_rel = [{"parent": "TABLE_ROOT", "parentColumn": "ROOT_ID", "child": "TABLE_COMPOSITE", "column": "COMP_ID"}]
        comp_cols = run_plc_model.select_display_columns(composite_table, composite_rel)
        self.assertEqual([(c["name"], c["role"]) for c in comp_cols], [("COMP_ID", "PK/FK")])

    def test_normalize_partition_and_boundary_checks(self):
        """Partition normalizer must reject external tables, invalid endpoints, and duplicates."""
        model = run_plc_model.model_from_json(FIXTURE_GRAPH)
        tables = model["tables"]
        relations = model["relations"]
        rejected = model["rejected"]

        # 7 valid tables; EXTERNAL_TABLE was NOT added as an implicit table
        self.assertEqual(len(tables), 7)
        self.assertNotIn("EXTERNAL_TABLE", {t["name"] for t in tables})

        # 6 valid internal relations; external relation was rejected
        self.assertEqual(len(relations), 6)
        external_rejections = [r for r in rejected if r.get("kind") == "external_relation"]
        self.assertEqual(len(external_rejections), 1)

        # Duplicate table rejection
        dup_tables_input = [
            {"name": "TABLE_DUP", "columns": [{"name": "ID", "is_pk": True}]},
            {"name": "TABLE_DUP", "columns": [{"name": "ID", "is_pk": True}]},
        ]
        with self.assertRaises(ValueError):
            run_plc_model.normalize_partition(dup_tables_input, [])

        # Duplicate column rejection
        dup_cols_input = [
            {
                "name": "TABLE_COL_DUP",
                "columns": [{"name": "COL_A", "is_pk": True}, {"name": "COL_A", "is_pk": False}],
            }
        ]
        with self.assertRaises(ValueError):
            run_plc_model.normalize_partition(dup_cols_input, [])

        # Invalid endpoint rejection
        invalid_rel = [
            {
                "parent": "TABLE_ROOT",
                "parentColumn": "NONEXISTENT",
                "child": "TABLE_MID",
            }
        ]
        with self.assertRaises(ValueError):
            run_plc_model.normalize_partition(FIXTURE_GRAPH["tables"][:2], invalid_rel)

        # Invalid identifier check (raises ValueError)
        with self.assertRaises(ValueError):
            run_plc_model.normalize_partition(
                [{"name": "INVALID-IDENTIFIER", "columns": [{"name": "ID", "is_pk": True}]}], []
            )

    def test_deterministic_mermaid_v11(self):
        """Mermaid generator must emit valid Mermaid v11 config, determinism, and no physical types."""
        model = run_plc_model.model_from_json(FIXTURE_GRAPH)
        tables = model["tables"]
        relations = model["relations"]

        mermaid_1 = run_plc_model.build_mermaid("fixture_stem", tables, relations)
        mermaid_2 = run_plc_model.build_mermaid("fixture_stem", tables, relations)

        # Byte-identical determinism
        self.assertEqual(mermaid_1, mermaid_2)

        # Frontmatter config
        self.assertIn("```mermaid\n---\nconfig:\n  theme: base\n  look: classic", mermaid_1)
        self.assertIn("securityLevel: strict", mermaid_1)
        self.assertIn("deterministicIds: true", mermaid_1)

        # Accessibility title and description
        self.assertIn("accTitle: Evidence-backed relational model", mermaid_1)
        self.assertIn("accDescr: fixture_stem; 7 tables; 6 verified relations.", mermaid_1)

        # Clean types without Oracle physical type information
        self.assertNotIn("NUMBER(", mermaid_1)
        self.assertNotIn("VARCHAR2(", mermaid_1)

        # Isolated table preserved
        self.assertIn("TABLE_ISOLATED {", mermaid_1)
        self.assertIn("string ISO_ID PK", mermaid_1)
        self.assertIn("string EXT_ID ID", mermaid_1)

    def test_drawio_layout_and_geometry(self):
        """Draw.io XML must be parseable, enforce equal widths, auto-fit heights, and have zero table overlaps."""
        model = run_plc_model.model_from_json(FIXTURE_GRAPH)
        tables = model["tables"]
        relations = model["relations"]

        tree = run_plc_model.build_drawio("fixture_stem", tables, relations)
        root = tree.getroot()
        self.assertEqual(root.tag, "mxfile")

        table_cells = []
        for cell in root.findall(".//mxCell"):
            if cell.get("vertex") == "1" and cell.get("parent") == "1":
                geom = cell.find("mxGeometry")
                if geom is not None:
                    box = (
                        float(geom.get("x", 0)),
                        float(geom.get("y", 0)),
                        float(geom.get("width", 0)),
                        float(geom.get("height", 0)),
                    )
                    table_cells.append((cell.get("id"), *box))

        # All 7 tables present
        self.assertEqual(len(table_cells), 7)

        # Equal widths within partition
        widths = {box[3] for box in table_cells}
        self.assertEqual(len(widths), 1, f"Expected uniform table width, got {widths}")

        # Auto-fit heights based on column count (48 startSize + 24 * columns)
        tables_by_id = {f"table-{t['name']}": t for t in tables}
        for table_id, x, y, w, h in table_cells:
            t = tables_by_id[table_id]
            expected_h = 48 + 24 * len(t["display_columns"])
            self.assertEqual(h, expected_h, f"Height mismatch for {table_id}")

        # Zero table rectangle overlap
        for i, first in enumerate(table_cells):
            for second in table_cells[i + 1 :]:
                overlap = (
                    first[1] < second[1] + second[3]
                    and second[1] < first[1] + first[3]
                    and first[2] < second[2] + second[4]
                    and second[2] < first[2] + first[4]
                )
                self.assertFalse(
                    overlap, f"Overlap detected between {first[0]} and {second[0]}"
                )

        # Edges present and valid
        edges = [c for c in root.findall(".//mxCell") if c.get("edge") == "1"]
        self.assertEqual(len(edges), 6)
        for edge in edges:
            self.assertTrue(edge.get("source", "").startswith("table-"))
            self.assertTrue(edge.get("target", "").startswith("table-"))

    def test_layered_and_core_layouts_execute_without_crash(self):
        """Both core-three-column and layered layout engines handle chains, cycles, and isolated tables."""
        model = run_plc_model.model_from_json(FIXTURE_GRAPH)
        tables = model["tables"]
        relations = model["relations"]

        core_positions = run_plc_model.compute_core_layout(tables, relations)
        self.assertEqual(len(core_positions), 7)
        layered_positions = run_plc_model.compute_layered_layout(tables, relations)
        self.assertEqual(len(layered_positions), 7)

    def test_isolated_id_not_fk_in_extraction(self):
        """Extract evidence must not mark an _ID column as FK if it lacks confirmed relations."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project = Path(tmpdir) / "project"
            design = project / "db_table" / "table_PLC.md"
            entity = project / "Entity"
            biz = project / "Biz"
            dao = project / "Dao"
            for d in (design.parent, entity, biz, dao):
                d.mkdir(parents=True, exist_ok=True)
            design.write_text(
                "| STT | Tên trường | Kiểu dữ liệu | Diễn giải |\n"
                "|---|---|---|---|\n"
                "| 1 | TABLE_ROOT |  |  |\n"
                "|  | ROOT_ID | NUMBER | Identity hint |\n"
                "|  | ISOLATED_ID | NUMBER |  |\n"
                "| 2 | OTHER |  |  |\n"
                "|  | X | NUMBER |  |\n",
                encoding="utf-8"
            )
            (entity / "TABLE_ROOT.cs").write_text(
                'const string C_ROOT_ID = "ROOT_ID";\n'
                "[PropertyEntity(C_ROOT_ID, true)]",
                encoding="utf-8"
            )
            (biz / "SampleBiz.cs").write_text(
                "class SampleBiz { private readonly SampleDao _dao = new SampleDao(); public void Use() { _dao.Call(); } }",
                encoding="utf-8"
            )
            (dao / "SampleDao.cs").write_text(
                "class SampleDao { public void Call() { string sql = \"SELECT * FROM TABLE_ROOT\"; } }",
                encoding="utf-8"
            )
            res = subprocess.run(
                [
                    sys.executable,
                    str(EXTRACT_SCRIPT),
                    "--project-root", str(project),
                    "--design-dir", str(design.parent),
                    "--entity-dir", str(entity),
                    "--biz-dir", str(biz),
                    "--dao-dir", str(dao)
                ],
                capture_output=True, text=True
            )
            self.assertEqual(res.returncode, 0, f"Extraction failed: {res.stderr}")
            json_path = project / "_output" / "db_table_mapped" / "table_PLC.json"
            model = json.loads(json_path.read_text(encoding="utf-8"))
            table_root = next(t for t in model["tables"] if t["name"] == "TABLE_ROOT")
            # In schema v2, columns are just strings in the raw extraction output
            self.assertIn("ISOLATED_ID", table_root["columns"])
            self.assertEqual(len(model["relations"]), 0, "No relations should be extracted since there are no joins.")

    def test_pre_cycle_backup_manifest_integrity(self):
        """Backup script must archive directories and verify SHA-256 integrity."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmproot = Path(tmpdir)
            out_dir = tmproot / "_output"
            diagrams_dir = out_dir / "diagrams"
            mapped_dir = out_dir / "db_table_mapped"
            diagrams_dir.mkdir(parents=True)
            mapped_dir.mkdir(parents=True)

            (diagrams_dir / "sample.mermaid.md").write_text("# Test Mermaid", encoding="utf-8")
            (mapped_dir / "sample.json").write_text('{"test": true}', encoding="utf-8")

            res = subprocess.run(
                [
                    sys.executable,
                    str(BACKUP_SCRIPT),
                    "--project-root",
                    str(tmproot),
                    "--reason",
                    "test-backup",
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            archive_path = Path(res.stdout.strip())
            self.assertTrue(archive_path.is_dir())

            manifest_file = archive_path / "manifest.json"
            self.assertTrue(manifest_file.is_file())

            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            self.assertEqual(manifest["reason"], "test-backup")
            self.assertEqual(len(manifest["entries"]), 2)

            for entry in manifest["entries"]:
                self.assertTrue(entry["present"])
                self.assertEqual(entry["sourceFileCount"], entry["archiveFileCount"])
                self.assertEqual(entry["sourceSha256"], entry["archiveSha256"])


if __name__ == "__main__":
    unittest.main()
