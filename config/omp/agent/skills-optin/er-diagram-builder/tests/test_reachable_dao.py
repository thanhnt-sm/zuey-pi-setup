import importlib
import json
import runpy
import subprocess
import sys
import xml.etree.ElementTree as ET
from itertools import pairwise
from pathlib import Path

SCRIPT_DIR = Path(__file__).parents[1] / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


csharp_syntax = importlib.import_module("csharp_syntax")
source_code_analysis = importlib.import_module("source_code_analysis")
load_runtime_evidence = csharp_syntax.load_runtime_evidence
parse_methods = csharp_syntax.parse_methods
analyzer_capabilities = source_code_analysis.analyzer_capabilities


MODEL_SCRIPT = Path(__file__).parents[1] / "scripts" / "run-plc-model.py"
SCRIPT = Path(__file__).parents[1] / "scripts" / "extract-evidence.py"
VALIDATOR_SCRIPT = Path(__file__).parents[1] / "scripts" / "validate-artifacts.py"
SOURCE_VALIDATOR_SCRIPT = Path(__file__).parents[1] / "scripts" / "validate-source-analysis.py"



def test_extracts_only_dao_methods_reachable_from_biz(tmp_path):
    project = tmp_path / "project"
    design = project / "db_table" / "table_PLC.md"
    entity = tmp_path / "Entity"
    biz = tmp_path / "Biz"
    dao = tmp_path / "Dao"
    for directory in (design.parent, entity, biz, dao):
        directory.mkdir(parents=True, exist_ok=True)

    design.write_text(
        """
| STT | Tên trường | Kiểu dữ liệu | Diễn giải |
|---|---|---|---|
| 1 | PLC_SURVEY_RESULT |  |  |
|  | SURVEY_RESULT_ID | NUMBER | Identity hint |
| 2 | PLC_SURVEY_RESULT_ADDRESS |  |  |
|  | SURVEY_RESULT_ID | NUMBER |  |
| 3 | OTHER |  |  |
|  | X | NUMBER |  |
| 4 | OTHER2 |  |  |
|  | X | NUMBER |  |
""".strip(),
        encoding="utf-8",
    )
    (entity / "PLC_SURVEY_RESULT.cs").write_text(
        'const string C_SURVEY_RESULT_ID = "SURVEY_RESULT_ID";\n'
        "[PropertyEntity(C_SURVEY_RESULT_ID, true)]",
        encoding="utf-8",
    )
    (biz / "SampleBiz.cs").write_text(
        """
class SampleBiz {
    private readonly SampleDao _dao = new SampleDao();
    public (int count, string value) Use() {
        if (true) { _dao.Reachable(); }
        return (1, "ok");
    }
}
""".strip(),
        encoding="utf-8",
    )
    (dao / "SampleDao.cs").write_text(
        """
class SampleDao {
    public List<PLC_SURVEY_RESULT_ADDRESS> Reachable() {
        string q = @"FROM PLC_SURVEY_RESULT_ADDRESS address
            LEFT JOIN PLC_SURVEY_RESULT res
                ON address.SURVEY_RESULT_ID = res.SURVEY_RESULT_ID";
    }
    public List<OTHER> Unreachable() {
        string q = @"FROM OTHER a JOIN OTHER2 b ON a.X = b.X";
    }
}
""".strip(),
        encoding="utf-8",
    )

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--project-root",
            str(project),
            "--design-dir",
            str(design.parent),
            "--entity-dir",
            str(entity),
            "--biz-dir",
            str(biz),
            "--dao-dir",
            str(dao),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert json.loads(completed.stdout)["relations"] == 1
    model = json.loads(
        (project / "_output" / "db_table_mapped" / "table_PLC.json").read_text(
            encoding="utf-8"
        )
    )
    relation = model["relations"][0]
    assert len(model["relations"]) == 1
    assert relation["child"] == "PLC_SURVEY_RESULT_ADDRESS"
    assert relation["column"] == "SURVEY_RESULT_ID"
    assert relation["parent"] == "PLC_SURVEY_RESULT"
    assert relation["parentColumn"] == "SURVEY_RESULT_ID"
    assert relation["status"] == "confirmed"
    assert relation["cardinality"] == "unknown"
    evidence = relation["evidence"][0]
    assert evidence["dao"]["file"] == str(dao / "SampleDao.cs")
    assert evidence["dao"]["method"] == "Reachable"
    assert evidence["biz"]["line"] == 4
    assert evidence["biz"]["method"] == "Use"
    assert evidence["dao"]["line"] > 0
    assert evidence["biz"]["line"] > 0


def test_emits_source_method_analysis_and_matrices(tmp_path):
    project = tmp_path / "project"
    design = project / "db_table" / "table_PLC.md"
    entity, biz, dao = tmp_path / "Entity", tmp_path / "Biz", tmp_path / "Dao"
    for directory in (design.parent, entity, biz, dao):
        directory.mkdir(parents=True, exist_ok=True)

    design.write_text(
        "| 1 | PLC_PARENT |  |  |\n|  | ID | NUMBER |  |\n"
        "| 2 | PLC_CHILD |  |  |\n|  | ID | NUMBER |  |\n"
        "|  | PARENT_ID | NUMBER |  |",
        encoding="utf-8",
    )
    (entity / "ParentEntity.cs").write_text(
        """public class ParentEntity : BaseEntity {
    public ParentEntity() : base("PLC_PARENT", "ID") { }
    [PropertyEntity("ID", true)] public int ID { get; set; }
}""",
        encoding="utf-8",
    )
    (entity / "ChildEntity.cs").write_text(
        """public class ChildEntity : BaseEntity {
    public ChildEntity() : base("PLC_CHILD", "ID") { }
    [PropertyEntity("ID", true)] public int ID { get; set; }
    [PropertyEntity("PARENT_ID", false)] public int PARENT_ID { get; set; }
}""",
        encoding="utf-8",
    )
    (biz / "SampleBiz.cs").write_text(
        """public class SampleBiz {
    private readonly SampleDao _dao = new SampleDao();
    private readonly ExternalHelper _helper = new ExternalHelper();
    public void Entry() {
        if (true) { Prepare(); }
        _dao.Load();
        _helper.Missing();
    }
    private void Prepare() {
        var value = 1;
    }
}""",
        encoding="utf-8",
    )

    (biz / "MisplacedDao.cs").write_text(
        """public class MisplacedDao {
    public void Load() { }
}""",
        encoding="utf-8",
    )
    (dao / "SampleDao.cs").write_text(
        """public class SampleDao {
    public List<PLC_CHILD> Load() {
        // FROM PLC_COMMENTED ignored JOIN PLC_OTHER ignored
        string payload = "{ not a structural brace }";
        string marker = "PLC_FALSE_REFERENCE";
        string query = @"SELECT child.ID FROM PLC_CHILD child
            LEFT JOIN PLC_PARENT parent ON child.PARENT_ID = parent.ID";
        return null;
    }
}""",
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--project-root",
            str(project),
            "--design-dir",
            str(design.parent),
            "--entity-dir",
            str(entity),
            "--biz-dir",
            str(biz),
            "--dao-dir",
            str(dao),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    output = project / "_output" / "db_table_mapped"
    analysis_path = output / "source-code-analysis.json"
    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    methods = {(item["class"], item["name"]): item for item in analysis["methods"]}
    assert ("SampleBiz", "Entry") in methods
    assert ("SampleBiz", "Prepare") in methods
    assert ("SampleDao", "Load") in methods
    assert methods[("SampleDao", "Load")]["id"].startswith(
        "DAO:DAO/SampleDao.cs:SampleDao.Load:"
    )
    assert methods[("MisplacedDao", "Load")]["layer"] == "DAO"
    assert methods[("SampleBiz", "Entry")]["logic"]["branches"] == 1
    assert methods[("SampleBiz", "Prepare")]["logic"]["assignments"] == 1

    entry_id = methods[("SampleBiz", "Entry")]["id"]
    load_id = methods[("SampleDao", "Load")]["id"]
    prepare_id = methods[("SampleBiz", "Prepare")]["id"]
    edges = analysis["relationships"]
    assert any(
        edge["caller"] == entry_id
        and edge["callee"] == load_id
        and edge["kind"] == "calls"
        and edge["status"] == "extracted"
        and edge["evidence"]
        and len(edge["evidence"]) == 1
        for edge in edges
    )
    assert any(edge["caller"] == entry_id and edge["callee"] == prepare_id for edge in edges)
    assert any(
        item["caller"] == entry_id
        and item["receiver"] == "_helper"
        and item["name"] == "Missing"
        and item["status"] == "ambiguous"
        for item in analysis["unresolvedCalls"]
    )
    assert any(
        link["method"] == load_id
        and link["table"] == "PLC_CHILD"
        and link["operation"] == "read"
        for link in analysis["tableLinks"]
    )
    assert any(
        link["method"] == load_id
        and link["table"] == "PLC_PARENT"
        and link["operation"] == "join"
        for link in analysis["tableLinks"]
    )
    assert "PLC_FALSE_REFERENCE" not in {link["table"] for link in analysis["tableLinks"]}
    assert "PLC_COMMENTED" not in {link["table"] for link in analysis["tableLinks"]}

    for name in (
        "source-code-analysis.md",
        "method-relationships.md",
        "method-matrix.md",
    ):
        assert (output / name).is_file()
    analysis_text = (output / "source-code-analysis.md").read_text(encoding="utf-8")
    relationship_text = (output / "method-relationships.md").read_text(encoding="utf-8")
    matrix_text = (output / "method-matrix.md").read_text(encoding="utf-8")
    report_text = (output / "evidence-report-table_PLC.md").read_text(encoding="utf-8")
    assert "SampleBiz.Entry" in analysis_text
    assert "SampleBiz.Entry" in relationship_text
    assert "Layer-to-layer matrix" in matrix_text
    assert "source-code-analysis.md" in report_text
    assert "SELECT child.ID" not in analysis_text
    manifest = json.loads(
        (output / "source-manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["analysis"]["methodCount"] == len(analysis["methods"])
    assert set(manifest["analysis"]["files"]) == {
        "source-code-analysis.json",
        "source-code-analysis.md",
        "method-relationships.md",
        "method-matrix.md",
    }
    assert 'id="partition-table-plc"' in analysis_text
    assert "Method-to-field data-flow matrix" in matrix_text

def test_extracts_every_join_in_a_reachable_dao_method(tmp_path):
    project = tmp_path / "project"
    design = project / "db_table" / "table_PLC.md"
    entity, biz, dao = tmp_path / "Entity", tmp_path / "Biz", tmp_path / "Dao"
    for directory in (design.parent, entity, biz, dao):
        directory.mkdir(parents=True, exist_ok=True)
    design.write_text(
        "\n".join(
            f"| {index} | {table} |  |  |\n|  | ID | NUMBER |  |"
            for index, table in enumerate(("PLC_MEETING", "PLC_MEETING_PARTICIPANT", "PLC_MEETING_RECORD_FILE"), 1)
        ),
        encoding="utf-8",
    )
    (entity / "PLC_MEETING.cs").write_text(
        'const string C_ID = "ID";\n[PropertyEntity(C_ID, true)]',
        encoding="utf-8",
    )
    (biz / "MultiBiz.cs").write_text(
        """class MultiBiz {
 private readonly MultiDao _dao = new MultiDao();
 public void GetVideoCallInfo() { _dao.Load(); }
}""",
        encoding="utf-8",
    )
    (dao / "MultiDao.cs").write_text(
        """class MultiDao {
public List<PLC_MEETING> Load() {
 // string old = @"FROM PLC_MEETING meeting LEFT JOIN PLC_COMMENTED_CHILD ignored ON ignored.ID = meeting.ID";
 string q = @"FROM PLC_MEETING meeting
 LEFT JOIN PLC_MEETING_PARTICIPANT participant ON meeting.ID = participant.ID
 LEFT JOIN PLC_MEETING_RECORD_FILE recordFile ON meeting.ID = recordFile.ID";
 // LEFT JOIN PLC_COMMENTED_CHILD ignored ON ignored.ID = meeting.ID
}}""",
        encoding="utf-8",
    )
    subprocess.run(
        [
            sys.executable, str(SCRIPT), "--project-root", str(project), "--design-dir", str(design.parent),
            "--entity-dir", str(entity), "--biz-dir", str(biz), "--dao-dir", str(dao),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    model = json.loads(
        (project / "_output" / "db_table_mapped" / "table_PLC.json").read_text(encoding="utf-8")
    )
    assert {(item["child"], item["parent"]) for item in model["relations"]} == {
        ("PLC_MEETING_PARTICIPANT", "PLC_MEETING"),
        ("PLC_MEETING_RECORD_FILE", "PLC_MEETING"),
    }


def test_extracts_assignment_relations(tmp_path):
    project = tmp_path / "project"
    design = project / "db_table" / "table_PLC.md"
    entity, biz, dao = tmp_path / "Entity", tmp_path / "Biz", tmp_path / "Dao"
    for directory in (design.parent, entity, biz, dao):
        directory.mkdir(parents=True, exist_ok=True)
    design.write_text(
        "| 1 | PLC_PARENT |  |  |\n|  | ID | NUMBER |  |\n"
        "| 2 | PLC_CHILD |  |  |\n|  | ID | NUMBER |  |",
        encoding="utf-8",
    )
    (entity / "PLC_PARENT.cs").write_text(
        'const string C_ID = "ID";\n[PropertyEntity(C_ID, true)]',
        encoding="utf-8",
    )
    (biz / "AssignmentBiz.cs").write_text(
        """class AssignmentBiz {
            public void Assign() {
                child.ID = parent.ID;
            }
        }""",
        encoding="utf-8",
    )
    subprocess.run(
        [
            sys.executable, str(SCRIPT), "--project-root", str(project), "--design-dir", str(design.parent),
            "--entity-dir", str(entity), "--biz-dir", str(biz), "--dao-dir", str(dao),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    model = json.loads((project / "_output" / "db_table_mapped" / "table_PLC.json").read_text(encoding="utf-8"))
    analysis = json.loads(
        (project / "_output" / "db_table_mapped" / "source-code-analysis.json").read_text(
            encoding="utf-8"
        )
    )
    assert any(
        flow["kind"] == "assignment"
        and flow["targetColumn"] == "ID"
        and flow["sourceColumn"] == "ID"
        and flow["evidence"]
        for flow in analysis["dataFlows"]
    )
    assert len(model["relations"]) == 1
    relation = model["relations"][0]
    assert relation["status"] == "proposed"
    assert relation["tables"] == ["UNKNOWN_CHILD", "PLC_PARENT"]
    assert relation["column"] == "ID"
    assert relation["parentColumn"] == "ID"
    assert relation["reason"] == "Biz assignment via column ID"


def test_maps_nonstandard_partition_from_entity_source(tmp_path):
    project = tmp_path / "project"
    design = project / "db_table" / "table_PLC_SystemParameter.md"
    scoped_entity = tmp_path / "ScopedEntity"
    source_root = tmp_path / "Source"
    biz = tmp_path / "Biz"
    dao = tmp_path / "Dao"
    for directory in (design.parent, scoped_entity, biz, dao):
        directory.mkdir(parents=True, exist_ok=True)
    source_root.mkdir(parents=True, exist_ok=True)

    design.write_text(
        """
| Thông tin | Object Name | Kiểu dữ liệu | Ghi chú |
|---|---|---|---|
| Tiêu đề biên bản kiểm tra | FEATURE_ID = 133101 |  |  |
| FEATURE_ID | FEATURE_ID | INT | ID Feature |
| Tên | NAME | NVARCHAR2(256) |  |
| Mã | CODE | NVARCHAR2(256) |  |
""".strip(),
        encoding="utf-8",
    )
    (source_root / "adm_SystemParameter.cs").write_text(
        """
public partial class adm_SystemParameter : BaseEntity
{
    [PropertyEntity("SYSTEM_PARAMETER_ID", true)]
    public int? SYSTEM_PARAMETER_ID { get; set; }
    [PropertyEntity("FEATURE_ID", false)]
    public int? FEATURE_ID { get; set; }
    [PropertyEntity("NAME", false)]
    public string NAME { get; set; }
    [PropertyEntity("CODE", false)]
    public string CODE { get; set; }
    [PropertyEntity("PARENT_ID", false)]
    public int? PARENT_ID { get; set; }
    public adm_SystemParameter() : base("ADM_SYSTEM_PARAMETER", "SYSTEM_PARAMETER_ID") { }
}
""".strip(),
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--project-root",
            str(project),
            "--design-dir",
            str(design.parent),
            "--entity-dir",
            str(scoped_entity),
            "--biz-dir",
            str(biz),
            "--dao-dir",
            str(dao),
            "--source-root",
            str(source_root),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    model = json.loads(
        (project / "_output" / "db_table_mapped" / "table_PLC_SystemParameter.json").read_text(
            encoding="utf-8"
        )
    )
    assert [table["name"] for table in model["tables"]] == ["ADM_SYSTEM_PARAMETER"]
    assert "SYSTEM_PARAMETER_ID" in model["tables"][0]["columns"]
    assert "PARENT_ID" in model["tables"][0]["columns"]
    assert {
        (key["table"], key["column"])
        for key in model["keys"]
    } == {("ADM_SYSTEM_PARAMETER", "SYSTEM_PARAMETER_ID")}


def test_extracts_source_backed_system_parameter_relationships(tmp_path):
    project = tmp_path / "project"
    design = project / "db_table" / "table_PLC_SystemParameter.md"
    scoped_entity = tmp_path / "ScopedEntity"
    source_root = tmp_path / "Source"
    biz = tmp_path / "Biz"
    dao = tmp_path / "Dao"
    for directory in (design.parent, scoped_entity, biz, dao):
        directory.mkdir(parents=True, exist_ok=True)
    source_root.mkdir(parents=True, exist_ok=True)

    design.write_text(
        "| Thông tin | Object Name | Kiểu dữ liệu | Ghi chú |\n"
        "|---|---|---|---|\n"
        "| Tiêu đề | FEATURE_ID = 133101 |  |  |\n"
        "| FEATURE_ID | FEATURE_ID | INT |  |",
        encoding="utf-8",
    )
    (source_root / "adm_SystemParameter.cs").write_text(
        """
public partial class adm_SystemParameter : BaseEntity
{
    [PropertyEntity("SYSTEM_PARAMETER_ID", true)]
    public int? SYSTEM_PARAMETER_ID { get; set; }
    [PropertyEntity("PARENT_ID", false)]
    public int? PARENT_ID { get; set; }
    [PropertyEntity("EXT1I", false)]
    public int? EXT1I { get; set; }
    [PropertyEntity("EXT2I", false)]
    public int? EXT2I { get; set; }
    public adm_SystemParameter() : base("ADM_SYSTEM_PARAMETER", "SYSTEM_PARAMETER_ID") { }
}
""".strip(),
        encoding="utf-8",
    )
    (source_root / "MappingDao.cs").write_text(
        """
class MappingDao
{
    public List<CONF_CHECK_CRITERIA> Load()
    {
        string query = @"SELECT crit.CHECK_CRITERIA_ID
            FROM CONF_CHECK_CRITERIA crit
            JOIN ADM_SYSTEM_PARAMETER asp
                ON asp.EXT2I = crit.CHECK_CRITERIA_ID
            WHERE asp.EXT1I IN (:titleID)";
        return null;
    }
}
""".strip(),
        encoding="utf-8",
    )
    (source_root / "HierarchyBiz.cs").write_text(
        """
class HierarchyBiz
{
    public List<adm_SystemParameter> GetTop(List<adm_SystemParameter> departments)
    {
        return departments.Where(d =>
            d.PARENT_ID is null ||
            !departments.Any(p => p.SYSTEM_PARAMETER_ID == d.PARENT_ID)
        ).ToList();
    }
}
""".strip(),
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--project-root",
            str(project),
            "--design-dir",
            str(design.parent),
            "--entity-dir",
            str(scoped_entity),
            "--biz-dir",
            str(biz),
            "--dao-dir",
            str(dao),
            "--source-root",
            str(source_root),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    model = json.loads(
        (project / "_output" / "db_table_mapped" / "table_PLC_SystemParameter.json").read_text(
            encoding="utf-8"
        )
    )
    manifest = json.loads(
        (project / "_output" / "db_table_mapped" / "source-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    assert manifest["source_root"]["fileCount"] == 3

    relations = {
        (relation["child"], relation["column"], relation["parent"], relation["parentColumn"])
        for relation in model["relations"]
        if relation.get("child")
    }
    assert (
        "ADM_SYSTEM_PARAMETER",
        "PARENT_ID",
        "ADM_SYSTEM_PARAMETER",
        "SYSTEM_PARAMETER_ID",
    ) in relations
    assert (
        "ADM_SYSTEM_PARAMETER",
        "EXT2I",
        "CONF_CHECK_CRITERIA",
        "CHECK_CRITERIA_ID",
    ) in relations


def test_renderer_rejects_invalid_mermaid_table_identifier():
    renderer = runpy.run_path(str(MODEL_SCRIPT))
    try:
        renderer["model_from_json"](
            {
                "schemaVersion": 2,
                "tables": [{"name": "FEATURE_ID = 133101", "columns": []}],
                "keys": [],
                "relations": [],
            }
        )
    except ValueError as error:
        assert "invalid Mermaid identifier" in str(error)
    else:
        raise AssertionError("invalid Mermaid table identifier was accepted")

def test_renderer_keeps_mermaid_frontmatter_inside_fence():
    renderer = runpy.run_path(str(MODEL_SCRIPT))
    markdown = renderer["build_mermaid"]("table_example", [], [])
    assert markdown.startswith("# table_example Relational Model\n\n```mermaid\n---\n")
    assert not markdown.startswith("---\nconfig:")

def test_drawio_preserves_key_and_id_columns_and_uses_editable_er_edges():
    renderer = runpy.run_path(str(MODEL_SCRIPT))
    data = {
        "schemaVersion": 2,
        "tables": [
            {
                "name": "CHILD",
                "description": "Child table",
                "columns": [
                    {"name": "CHILD_ID"},
                    {"name": "PARENT_ID"},
                    {"name": "OTHER_ID"},
                    {"name": "LABEL"},
                ],
            },
            {
                "name": "PARENT",
                "description": "Parent table",
                "columns": [{"name": "PARENT_ID"}],
            },
        ],
        "keys": [
            {"table": "CHILD", "column": "CHILD_ID"},
            {"table": "PARENT", "column": "PARENT_ID"},
        ],
        "relations": [
            {
                "child": "CHILD",
                "column": "PARENT_ID",
                "parent": "PARENT",
                "parentColumn": "PARENT_ID",
                "cardinality": "1:N",
                "status": "confirmed",
            },
            {
                "child": "CHILD",
                "column": "PARENT_ID",
                "parent": "PARENT",
                "parentColumn": "PARENT_ID",
                "cardinality": "1:N",
                "status": "confirmed",
            },
        ],
    }
    model = renderer["model_from_json"](data)
    native = ET.fromstring(
        ET.tostring(
            renderer["build_drawio"](
                "sample",
                model["tables"],
                model["relations"],
                routing_mode="native-editable",
            ).getroot()
        )
    )
    graph = native.find("./diagram/mxGraphModel")
    assert graph is not None
    assert graph.get("routingMode") == "native-editable"
    assert native.find(".//mxCell[@id='table-CHILD']").get("value") == "CHILD<br/>Child table"
    assert native.find(".//mxCell[@id='table-PARENT']").get("value") == "PARENT<br/>Parent table"
    rows = [
        cell
        for cell in native.findall(".//mxCell")
        if cell.get("vertex") == "1" and cell.get("parent", "").startswith("table-")
    ]
    row_values = {cell.get("value") for cell in rows}
    assert row_values == {
        "PK  CHILD_ID",
        "FK  PARENT_ID",
        "ID  OTHER_ID",
        "PK  PARENT_ID",
    }
    edges = [cell for cell in native.findall(".//mxCell") if cell.get("edge") == "1"]
    assert len(edges) == 1
    native_edge = edges[0]
    assert native_edge.get("source") == "table-CHILD-PARENT_ID"
    assert native_edge.get("target") == "table-PARENT-PARENT_ID"
    assert "edgeStyle=entityRelationEdgeStyle;" in native_edge.get("style", "")
    assert "startArrow=ERmany;" in native_edge.get("style", "")
    assert "endArrow=ERone;" in native_edge.get("style", "")
    assert "jumpStyle=arc;" in native_edge.get("style", "")
    assert "orthogonalLoop=1;" in native_edge.get("style", "")
    assert "rounded=1;" in native_edge.get("style", "")
    assert "exitX=" not in native_edge.get("style", "")
    assert "entryX=" not in native_edge.get("style", "")
    geometry = native_edge.find("mxGeometry")
    assert geometry is not None
    assert geometry.get("relative") == "1"
    assert geometry.find("./Array[@as='points']") is None

    explicit = ET.fromstring(
        ET.tostring(
            renderer["build_drawio"](
                "sample",
                model["tables"],
                model["relations"],
                routing_mode="explicit-waypoints",
            ).getroot()
        )
    )
    explicit_edge = next(
        cell for cell in explicit.findall(".//mxCell") if cell.get("edge") == "1"
    )
    points = explicit_edge.findall("./mxGeometry/Array/mxPoint")
    assert len(points) >= 2
    assert len({(point.get("x"), point.get("y")) for point in points}) == len(points)
    assert all(
        first.get("x") == second.get("x") or first.get("y") == second.get("y")
        for first, second in pairwise(points)
    )

    for layout_mode in ("core-three-column", "layered"):
        for routing_mode in ("native-editable", "explicit-waypoints"):
            variant = renderer["build_drawio"](
                "sample",
                model["tables"],
                model["relations"],
                layout_mode=layout_mode,
                routing_mode=routing_mode,
            )
            variant_graph = variant.getroot().find("./diagram/mxGraphModel")
            assert variant_graph.get("layoutMode") == layout_mode
            assert variant_graph.get("routingMode") == routing_mode
            variant_edges = [
                cell for cell in variant.getroot().findall(".//mxCell")
                if cell.get("edge") == "1"
            ]
            variant_arrays = [
                edge.find("./mxGeometry/Array[@as='points']")
                for edge in variant_edges
            ]
            if routing_mode == "native-editable":
                assert all(point_array is None for point_array in variant_arrays)
            else:
                assert all(
                    point_array is not None
                    and len(point_array.findall("./mxPoint")) >= 2
                    for point_array in variant_arrays
                )
 

def test_generator_defaults_to_native_editable_routing(tmp_path):
    project = tmp_path / "project"
    (project / "db_table").mkdir(parents=True)
    mapped = project / "_output" / "db_table_mapped"
    mapped.mkdir(parents=True)
    (project / "db_table" / "sample.md").write_text("# sample\n", encoding="utf-8")
    model = {
        "schemaVersion": 2,
        "tables": [
            {"name": "CHILD", "columns": [{"name": "CHILD_ID"}, {"name": "PARENT_ID"}]},
            {"name": "PARENT", "columns": [{"name": "PARENT_ID"}]},
        ],
        "keys": [
            {"table": "CHILD", "column": "CHILD_ID"},
            {"table": "PARENT", "column": "PARENT_ID"},
        ],
        "relations": [{
            "child": "CHILD",
            "column": "PARENT_ID",
            "parent": "PARENT",
            "parentColumn": "PARENT_ID",
            "cardinality": "1:N",
            "status": "confirmed",
        }],
    }
    (mapped / "sample.json").write_text(json.dumps(model), encoding="utf-8")

    subprocess.run(
        [sys.executable, str(MODEL_SCRIPT), "--project-root", str(project)],
        check=True,
        capture_output=True,
        text=True,
    )

    drawio = ET.parse(project / "_output" / "diagrams" / "sample.drawio.xml").getroot()
    graph = drawio.find("./diagram/mxGraphModel")
    assert graph is not None
    assert graph.get("routingMode") == "native-editable"
    edge = next(cell for cell in drawio.findall(".//mxCell") if cell.get("edge") == "1")
    assert edge.find("./mxGeometry/Array[@as='points']") is None

def test_validator_rejects_native_fixed_endpoint_override(tmp_path):
    renderer = runpy.run_path(str(MODEL_SCRIPT))
    project = tmp_path / "project"
    (project / "db_table").mkdir(parents=True)
    mapped = project / "_output" / "db_table_mapped"
    diagrams = project / "_output" / "diagrams"
    mapped.mkdir(parents=True)
    diagrams.mkdir(parents=True)
    data = {
        "schemaVersion": 2,
        "tables": [
            {
                "name": "CHILD",
                "columns": [
                    {"name": "CHILD_ID"},
                    {"name": "PARENT_ID"},
                ],
            },
            {"name": "PARENT", "columns": [{"name": "PARENT_ID"}]},
        ],
        "keys": [
            {"table": "CHILD", "column": "CHILD_ID"},
            {"table": "PARENT", "column": "PARENT_ID"},
        ],
        "relations": [
            {
                "child": "CHILD",
                "column": "PARENT_ID",
                "parent": "PARENT",
                "parentColumn": "PARENT_ID",
                "cardinality": "1:N",
                "status": "confirmed",
            }
        ],
    }
    model = renderer["model_from_json"](data)
    (project / "db_table" / "sample.md").write_text("# sample\n", encoding="utf-8")
    (mapped / "sample.json").write_text(json.dumps(data), encoding="utf-8")
    (diagrams / "sample.mermaid.md").write_text(
        renderer["build_mermaid"]("sample", model["tables"], model["relations"]),
        encoding="utf-8",
    )
    drawio_root = renderer["build_drawio"](
        "sample",
        model["tables"],
        model["relations"],
    ).getroot()
    edge = next(cell for cell in drawio_root.findall(".//mxCell") if cell.get("edge") == "1")
    assert "exitX=" not in edge.get("style", "")
    assert "entryX=" not in edge.get("style", "")
    edge.set("style", edge.get("style", "") + "exitX=1;")
    (diagrams / "sample.drawio.xml").write_bytes(
        ET.tostring(drawio_root, encoding="utf-8", xml_declaration=True)
    )
    (diagrams / "sample.oracle-sqldev.xml").write_bytes(
        ET.tostring(
            renderer["build_oracle_sqldev"](
                "sample",
                model["tables"],
                model["relations"],
            ).getroot(),
            encoding="utf-8",
            xml_declaration=True,
        )
    )

    completed = subprocess.run(
        [sys.executable, str(VALIDATOR_SCRIPT), str(project)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode != 0
    assert "native connector has fixed endpoint overrides" in completed.stdout

def test_core_layout_centers_highly_connected_tables_and_is_deterministic():
    renderer = runpy.run_path(str(MODEL_SCRIPT))
    data = {
        "schemaVersion": 2,
        "tables": [
            {"name": "HUB", "columns": ["HUB_ID"]},
            {"name": "HUB_B", "columns": ["HUB_B_ID"]},
            {"name": "CHILD_A", "columns": ["CHILD_A_ID", "HUB_ID"]},
            {"name": "CHILD_B", "columns": ["CHILD_B_ID", "HUB_ID"]},
            {"name": "CHILD_C", "columns": ["CHILD_C_ID", "HUB_B_ID"]},
            {"name": "CHILD_D", "columns": ["CHILD_D_ID", "HUB_B_ID"]},
            {"name": "PARENT_A", "columns": ["PARENT_A_ID"]},
            {"name": "PARENT_B", "columns": ["PARENT_B_ID"]},
            {"name": "ISOLATED", "columns": ["ISOLATED_ID"]},
        ],
        "keys": [
            {"table": table, "column": f"{table}_ID"}
            for table in (
                "HUB",
                "HUB_B",
                "CHILD_A",
                "CHILD_B",
                "CHILD_C",
                "CHILD_D",
                "PARENT_A",
                "PARENT_B",
                "ISOLATED",
            )
        ],
        "relations": [
            {
                "child": child,
                "column": "HUB_ID",
                "parent": "HUB",
                "parentColumn": "HUB_ID",
                "cardinality": "1:N",
            }
            for child in ("CHILD_A", "CHILD_B")
        ]
        + [
            {
                "child": child,
                "column": "HUB_B_ID",
                "parent": "HUB_B",
                "parentColumn": "HUB_B_ID",
                "cardinality": "1:N",
            }
            for child in ("CHILD_C", "CHILD_D")
        ]
        + [
            {
                "child": "HUB",
                "column": "HUB_ID",
                "parent": "PARENT_A",
                "parentColumn": "PARENT_A_ID",
                "cardinality": "1:N",
            },
            {
                "child": "HUB_B",
                "column": "HUB_B_ID",
                "parent": "PARENT_B",
                "parentColumn": "PARENT_B_ID",
                "cardinality": "1:N",
            },
        ],
    }
    model = renderer["model_from_json"](data)
    positions = renderer["compute_layout"](
        model["tables"], model["relations"], "core-three-column"
    )
    center_x = 80 + renderer["TABLE_WIDTH"] + renderer["COLUMN_GAP"]
    assert positions["HUB"]["x"] == center_x
    assert positions["HUB_B"]["x"] == center_x
    assert positions["CHILD_A"]["x"] < center_x
    assert positions["CHILD_C"]["x"] < center_x
    assert positions["PARENT_A"]["x"] > center_x
    assert positions["PARENT_B"]["x"] > center_x
    assert positions["ISOLATED"]["x"] != center_x
    assert len({position["x"] for position in positions.values()}) == 3
    assert positions["HUB"]["y"] != positions["HUB_B"]["y"]

    reversed_model = renderer["model_from_json"](
        {**data, "tables": list(reversed(data["tables"])), "relations": list(reversed(data["relations"]))}
    )
    assert positions == renderer["compute_layout"](
        reversed_model["tables"], reversed_model["relations"], "core-three-column"
    )


def test_core_layout_keeps_selected_hub_family_in_one_neighborhood():
    renderer = runpy.run_path(str(MODEL_SCRIPT))
    data = {
        "schemaVersion": 2,
        "tables": [
            {"name": "PLC_CHECK_DOCUMENT", "columns": ["DOCUMENT_ID"]},
            {"name": "PLC_CHECK_SCHEDULE", "columns": ["SCHEDULE_ID", "DOCUMENT_ID"]},
            {"name": "PLC_CHECK_SHEET", "columns": ["SHEET_ID", "DOCUMENT_ID"]},
            {"name": "ADM_EMPLOYEE", "columns": ["EMPLOYEE_ID"]},
            {"name": "COM_CUSTOMER", "columns": ["CUSTOMER_ID"]},
        ],
        "keys": [
            {"table": "PLC_CHECK_DOCUMENT", "column": "DOCUMENT_ID"},
            {"table": "PLC_CHECK_SCHEDULE", "column": "SCHEDULE_ID"},
            {"table": "PLC_CHECK_SHEET", "column": "SHEET_ID"},
            {"table": "ADM_EMPLOYEE", "column": "EMPLOYEE_ID"},
            {"table": "COM_CUSTOMER", "column": "CUSTOMER_ID"},
        ],
        "relations": [
            {
                "child": "PLC_CHECK_SCHEDULE",
                "column": "DOCUMENT_ID",
                "parent": "PLC_CHECK_DOCUMENT",
                "parentColumn": "DOCUMENT_ID",
                "cardinality": "1:N",
            },
            {
                "child": "PLC_CHECK_SHEET",
                "column": "DOCUMENT_ID",
                "parent": "PLC_CHECK_DOCUMENT",
                "parentColumn": "DOCUMENT_ID",
                "cardinality": "1:N",
            },
            {
                "child": "PLC_CHECK_DOCUMENT",
                "column": "DOCUMENT_ID",
                "parent": "ADM_EMPLOYEE",
                "parentColumn": "EMPLOYEE_ID",
                "cardinality": "1:N",
            },
            {
                "child": "PLC_CHECK_DOCUMENT",
                "column": "DOCUMENT_ID",
                "parent": "COM_CUSTOMER",
                "parentColumn": "CUSTOMER_ID",
                "cardinality": "1:N",
            },
        ],
    }
    model = renderer["model_from_json"](data)
    positions = renderer["compute_core_layout"](model["tables"], model["relations"])
    center_x = 80 + renderer["TABLE_WIDTH"] + renderer["COLUMN_GAP"]
    assert {
        positions["PLC_CHECK_DOCUMENT"]["x"],
        positions["PLC_CHECK_SCHEDULE"]["x"],
        positions["PLC_CHECK_SHEET"]["x"],
    } == {center_x}

def test_core_layout_keeps_relation_free_partition_in_one_readable_column():
    renderer = runpy.run_path(str(MODEL_SCRIPT))
    tables = [
        {"name": "TABLE_B", "columns": [{"name": "TABLE_B_ID", "is_pk": True}]},
        {"name": "TABLE_A", "columns": [{"name": "TABLE_A_ID", "is_pk": True}]},
    ]
    positions = renderer["compute_layout"](tables, [], "core-three-column")
    assert len({position["x"] for position in positions.values()}) == 1


def test_route_sides_use_opposite_ports_for_distinct_same_column_tables():
    renderer = runpy.run_path(str(MODEL_SCRIPT))
    position = {"x": 800, "y": 100, "width": 440, "height": 80}
    assert renderer["_route_sides"](
        position,
        position,
        "TABLE_A",
        "TABLE_B",
    ) == ("right", "left")
    assert renderer["_route_sides"](
        position,
        position,
        "TABLE_B",
        "TABLE_A",
    ) == ("left", "right")
    assert renderer["_route_sides"](
        position,
        position,
        "TABLE_A",
        "TABLE_A",
    ) == ("right", "right")


def test_ast_parser_covers_constructor_expression_body_and_overload_shape():
    source = """
public class SampleBiz {
    private readonly IDep _dep;
    public SampleBiz(IDep dep) { _dep = dep; Load(); }
    public int Convert(int value) => Helper(value);
    public int Convert(string value) { return Helper(value.Length); }
    public int Optional(int value = 1) { return value; }
    public int Variadic(params int[] values) { return values.Length; }
}
""".strip()
    parsed = parse_methods(source)
    if parsed is None:
        raise AssertionError("tree-sitter C# parser is required for AST regression")
    records = {(item["name"], item["kind"], item["line"]): item for item in parsed}
    constructor = next(item for item in parsed if item["kind"] == "constructor")
    expression = next(item for item in parsed if item["name"] == "Convert" and item["expressionBodied"])
    block_overload = next(item for item in parsed if item["name"] == "Convert" and not item["expressionBodied"])
    assert constructor["name"] == "SampleBiz"
    assert constructor["parameters"][0]["type"] == "IDep"
    assert constructor["invocations"][0]["name"] == "Load"
    assert expression["body"].startswith("return ")
    assert expression["parameterCount"] == 1
    assert expression["overloadKey"] != block_overload["overloadKey"]
    optional = next(item for item in parsed if item["name"] == "Optional")
    variadic = next(item for item in parsed if item["name"] == "Variadic")
    assert optional["parameters"][0]["optional"] is True
    assert variadic["parameters"][0]["params"] is True
    assert records


def test_runtime_evidence_accepts_normalized_ids_and_rejects_binary_trace(tmp_path):
    evidence_path = tmp_path / "runtime-evidence.json"
    evidence_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "sourceHash": "source-hash",
                "events": [
                    {
                        "caller": "BIZ:Biz.cs:Biz.Entry:10",
                        "callee": "DAO:Dao.cs:Dao.Load:20",
                        "timestamp": "2026-09-15T00:00:00Z",
                        "processId": 42,
                        "source": "dotnet-trace-export",
                        "sampleCount": 2,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    loaded = load_runtime_evidence(
        evidence_path,
        {
            "BIZ:Biz.cs:Biz.Entry:10",
            "DAO:Dao.cs:Dao.Load:20",
        },
    )
    assert loaded["events"][0]["provenance"] == "RUNTIME_OBSERVED"
    assert loaded["events"][0]["status"] == "observed"
    assert loaded["events"][0]["sampleCount"] == 2

    binary_trace = tmp_path / "trace.nettrace"
    binary_trace.write_bytes(b"EventPipe")
    try:
        load_runtime_evidence(binary_trace, set())
    except ValueError as error:
        assert "normalized JSON" in str(error)
    else:
        raise AssertionError("binary EventPipe trace must not be parsed heuristically")


def test_source_analysis_marks_ast_edges_and_unsafe_resolution_reasons(tmp_path):
    project = tmp_path / "project"
    design = project / "db_table" / "table_PLC.md"
    entity = tmp_path / "Entity"
    biz = tmp_path / "Biz"
    dao = tmp_path / "Dao"
    source = tmp_path / "Source"
    for directory in (design.parent, entity, biz, dao, source):
        directory.mkdir(parents=True, exist_ok=True)
    design.write_text("| 1 | PLC_SAMPLE |  |  |\\n|  | ID | NUMBER |  |", encoding="utf-8")
    (entity / "PLC_SAMPLE.cs").write_text("class PLC_SAMPLE { }", encoding="utf-8")
    (biz / "SampleBiz.cs").write_text(
        """
public class SampleBiz {
    private readonly IDep _dep;
    public SampleBiz(IDep dep) { _dep = dep; Warm(); }
    public void Warm() { }
    public void Entry() {
        _dep.Run();
        Over(1);
        dynamic dyn = null;
        dyn.Go();
        typeof(SampleBiz).GetMethod("Entry");
        _dep.RunExt();
    }
    public void Over(int value) { }
    public void Over(string value) { }
}
""".strip(),
        encoding="utf-8",
    )
    (source / "Extensions.cs").write_text(
        """
public static class Extensions {
    public static void RunExt(this IDep dep) { }
}
""".strip(),
        encoding="utf-8",
    )
    (biz / "Generated.cs").write_text(
        """
// <auto-generated />
class Generated {
    public void Hidden() { }
}
""".strip(),
        encoding="utf-8",
    )
    runtime = tmp_path / "runtime-evidence.json"
    runtime.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "sourceHash": "fixture-source-hash",
                "events": [
                    {
                        "caller": "Biz:Biz/SampleBiz.cs:SampleBiz.Entry:5",
                        "callee": "Biz:Biz/SampleBiz.cs:SampleBiz.Warm:4",
                        "timestamp": "2026-09-15T00:00:00Z",
                        "processId": 42,
                        "source": "fixture",
                        "sampleCount": 2,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--project-root",
            str(project),
            "--design-dir",
            str(design.parent),
            "--entity-dir",
            str(entity),
            "--biz-dir",
            str(biz),
            "--dao-dir",
            str(dao),
            "--source-root",
            str(source),
            "--runtime-evidence",
            str(runtime),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    validation = subprocess.run(
        [sys.executable, str(SOURCE_VALIDATOR_SCRIPT), str(project)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(validation.stdout)["ok"] is True
    analysis = json.loads(
        (project / "_output" / "db_table_mapped" / "source-code-analysis.json").read_text(
            encoding="utf-8"
        )
    )
    assert analysis["capabilities"]["selectedEngine"] == "tree-sitter-c-sharp"
    assert analysis["statistics"]["runtimeEvidenceCount"] == 1
    assert analysis["runtimeEvidence"]["events"][0]["status"] == "observed"
    methods = {(item["class"], item["name"]): item for item in analysis["methods"]}
    assert ("SampleBiz", "SampleBiz") in methods
    assert ("Generated", "Hidden") not in methods
    assert methods[("SampleBiz", "SampleBiz")]["kind"] == "constructor"
    assert any(
        edge["caller"].endswith("SampleBiz.SampleBiz:3")
        and edge["callee"].endswith("SampleBiz.Warm:4")
        for edge in analysis["relationships"]
    )
    reasons = {
        (item["name"], item["reason"])
        for item in analysis["unresolvedCalls"]
    }
    assert ("Run", "dependency-injection") in reasons
    assert ("Over", "overload") in reasons
    assert ("Go", "dynamic") in reasons
    assert ("GetMethod", "reflection") in reasons
    assert ("RunExt", "extension-method") in reasons
    relationship_report = (
        project / "_output" / "db_table_mapped" / "method-relationships.md"
    ).read_text(encoding="utf-8")
    assert relationship_report.rstrip().endswith("```")


def test_capability_probe_never_claims_selected_compiler_or_runtime_graph(tmp_path):
    solution = tmp_path / "sample.sln"
    solution.write_text("Microsoft Visual Studio Solution File, Format Version 12.00\n", encoding="utf-8")
    capabilities = analyzer_capabilities(solution=solution)
    assert capabilities["compiler"]["selected"] is False
    assert capabilities["compiler"]["reason"]
    assert capabilities["runtime"]["selected"] is False
    assert capabilities["regexFallback"]["available"] is True