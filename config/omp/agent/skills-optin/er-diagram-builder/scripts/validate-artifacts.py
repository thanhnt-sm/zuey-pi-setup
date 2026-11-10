#!/usr/bin/env python3
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

COORDINATE_EPSILON = 0.01

ROLE_PATTERN = re.compile(r"^(PK/FK|PK|FK|ID|REF)\s+([A-Za-z_][A-Za-z0-9_]*)$")


def _same_coordinate(first, second):
    return abs(first - second) <= COORDINATE_EPSILON

def _column_name(column):
    return column if isinstance(column, str) else column.get("name")


def _expected_contract(model):
    table_columns = {}
    for table in model.get("tables", []):
        table_name = table["name"]
        table_columns[table_name] = {
            name
            for name in (_column_name(column) for column in table.get("columns", table.get("fields", [])))
            if name
        }
    key_set = {
        (key.get("table"), key.get("column"))
        for key in model.get("keys", [])
        if key.get("table") and key.get("column")
    }
    child_endpoints = {
        (relation.get("child"), relation.get("column"))
        for relation in model.get("relations", [])
        if relation.get("child") and relation.get("column")
    }
    parent_endpoints = {
        (relation.get("parent"), relation.get("parentColumn"))
        for relation in model.get("relations", [])
        if relation.get("parent") and relation.get("parentColumn")
    }
    expected_columns = defaultdict(set)
    expected_roles = {}
    for table_name, columns in table_columns.items():
        for column in columns:
            endpoint = (table_name, column)
            is_pk = endpoint in key_set
            is_fk = endpoint in child_endpoints
            is_ref = endpoint in parent_endpoints
            is_id = column.upper().endswith("_ID")
            if not (is_pk or is_fk or is_id or is_ref):
                continue
            if is_pk and is_fk:
                role = "PK/FK"
            elif is_pk:
                role = "PK"
            elif is_fk:
                role = "FK"
            elif is_id:
                role = "ID"
            else:
                role = "REF"
            expected_columns[table_name].add(column)
            expected_roles[(table_name, column)] = role
    return table_columns, expected_columns, expected_roles


def _parse_role_value(value):
    match = ROLE_PATTERN.fullmatch((value or "").strip())
    return (match.group(1), match.group(2)) if match else None


def _style_number(style, name):
    match = re.search(rf"(?:^|;){re.escape(name)}=([^;]+)", style)
    return float(match.group(1)) if match else None
def _style_has_property(style, name):
    return re.search(rf"(?:^|;){re.escape(name)}=", style) is not None


def _segment_hits_box(first, second, box):
    x1, y1 = first
    x2, y2 = second
    left, top, right, bottom = box
    if _same_coordinate(x1, x2):
        return (
            left + COORDINATE_EPSILON < x1 < right - COORDINATE_EPSILON
            and max(min(y1, y2), top) + COORDINATE_EPSILON
            < min(max(y1, y2), bottom)
        )
    if _same_coordinate(y1, y2):
        return (
            top + COORDINATE_EPSILON < y1 < bottom - COORDINATE_EPSILON
            and max(min(x1, x2), left) + COORDINATE_EPSILON
            < min(max(x1, x2), right)
        )
    return True


def _segments_conflict(first, second, other_first, other_second):
    x1, y1 = first
    x2, y2 = second
    x3, y3 = other_first
    x4, y4 = other_second
    first_horizontal = _same_coordinate(y1, y2)
    second_horizontal = _same_coordinate(y3, y4)
    if first_horizontal and second_horizontal:
        return (
            _same_coordinate(y1, y3)
            and max(min(x1, x2), min(x3, x4)) + COORDINATE_EPSILON
            < min(max(x1, x2), max(x3, x4))
        )
    if not first_horizontal and not second_horizontal:
        return (
            _same_coordinate(x1, x3)
            and max(min(y1, y2), min(y3, y4)) + COORDINATE_EPSILON
            < min(max(y1, y2), max(y3, y4))
        )
    return False


def _segments_cross(first, second, other_first, other_second):
    x1, y1 = first
    x2, y2 = second
    x3, y3 = other_first
    x4, y4 = other_second
    first_horizontal = _same_coordinate(y1, y2)
    second_horizontal = _same_coordinate(y3, y4)
    if first_horizontal == second_horizontal:
        return False
    if first_horizontal:
        return (
            min(x1, x2) + COORDINATE_EPSILON < x3 < max(x1, x2) - COORDINATE_EPSILON
            and min(y3, y4) + COORDINATE_EPSILON
            < y1 < max(y3, y4) - COORDINATE_EPSILON
        )
    return (
        min(x3, x4) + COORDINATE_EPSILON < x1 < max(x3, x4) - COORDINATE_EPSILON
        and min(y1, y2) + COORDINATE_EPSILON
        < y3 < max(y1, y2) - COORDINATE_EPSILON
    )


root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
design_dir = root / "db_table"
mapped_dir = root / "_output" / "db_table_mapped"
diagram_dir = root / "_output" / "diagrams"
stems = sorted(path.stem for path in design_dir.glob("*.md"))
errors = []
total_tables = 0
total_relations = 0
bridged_crossings = 0
dynamic_edges = 0
manual_waypoint_edges = 0

if not stems:
    errors.append("no design partitions")

for stem in stems:
    model_path = mapped_dir / f"{stem}.json"
    mermaid_path = diagram_dir / f"{stem}.mermaid.md"
    drawio_path = diagram_dir / f"{stem}.drawio.xml"
    oracle_path = diagram_dir / f"{stem}.oracle-sqldev.xml"
    missing = [
        str(path.relative_to(root))
        for path in (model_path, mermaid_path, drawio_path, oracle_path)
        if not path.is_file()
    ]
    if missing:
        errors.append(f"{stem}: missing {', '.join(missing)}")
        continue

    try:
        model = json.loads(model_path.read_text(encoding="utf-8"))
        drawio = ET.parse(drawio_path).getroot()
        oracle = ET.parse(oracle_path).getroot()
    except (OSError, ValueError, ET.ParseError) as exc:
        errors.append(f"{stem}: invalid artifact: {exc}")
        continue
    graph = drawio.find("./diagram/mxGraphModel")
    routing_mode = graph.get("routingMode") if graph is not None else None
    if routing_mode not in ("native-editable", "explicit-waypoints"):
        errors.append(f"{stem}: missing or unsupported Drawio routing mode")
    layout_mode = graph.get("layoutMode") if graph is not None else None
    if layout_mode not in ("core-three-column", "layered"):
        errors.append(f"{stem}: missing or unsupported Drawio layout mode")

    if model.get("schemaVersion") != 2:
        errors.append(f"{stem}: unsupported schemaVersion")
    table_columns, expected_display_columns, expected_roles = _expected_contract(model)
    expected_relation_id_list = [
        f"{relation.get('child')}.{relation.get('column')}_TO_{relation.get('parent')}.{relation.get('parentColumn')}"
        for relation in model.get("relations", [])
        if relation.get("child") in table_columns
        and relation.get("parent") in table_columns
        and relation.get("column") in table_columns[relation["child"]]
        and relation.get("parentColumn") in table_columns[relation["parent"]]
    ]
    expected_relation_ids = set(expected_relation_id_list)
    total_tables += len(table_columns)
    total_relations += len(expected_relation_ids)

    mermaid = mermaid_path.read_text(encoding="utf-8")
    if re.search(r"(?i)\b(TODO|TBD|FIXME)\b|\?\?\?", mermaid):
        errors.append(f"{stem}: placeholder in Mermaid")
    mermaid_relation_ids = Counter(
        re.findall(r"^\s*%% relation-id: ([^ ]+)", mermaid, re.MULTILINE)
    )
    if mermaid_relation_ids != Counter(expected_relation_id_list):
        errors.append(f"{stem}: Mermaid relation parity mismatch")
    in_mermaid_code = False
    for line in mermaid.splitlines():
        if line.strip() == "```mermaid":
            in_mermaid_code = True
            continue
        if in_mermaid_code and line.strip() == "```":
            in_mermaid_code = False
            continue
        field_match = re.match(r"^\s+string\s+[A-Za-z_][A-Za-z0-9_]*\s+", line)
        if in_mermaid_code and field_match and not re.search(r"\b(PK|FK|ID)\b", line):
            errors.append(f"{stem}: ordinary Mermaid field: {line.strip()}")

    cells = drawio.findall(".//mxCell")
    cell_ids = [cell.get("id") for cell in cells]
    if len(cell_ids) != len(set(cell_ids)):
        errors.append(f"{stem}: duplicate Drawio cell IDs")
    drawio_text = ET.tostring(drawio, encoding="unicode")
    if re.search(r"(?i)\b(TODO|TBD|FIXME|HACK)\b|\?\?\?", drawio_text):
        errors.append(f"{stem}: placeholder in Drawio")

    table_boxes = {}
    table_cells = []
    for cell in cells:
        if cell.get("vertex") != "1" or cell.get("parent") != "1":
            continue
        table_id = cell.get("id", "")
        if not table_id.startswith("table-"):
            continue
        geometry = cell.find("mxGeometry")
        if geometry is None:
            errors.append(f"{stem}: table without geometry: {table_id}")
            continue
        try:
            box = (
                float(geometry.get("x", 0)),
                float(geometry.get("y", 0)),
                float(geometry.get("width", 0)),
                float(geometry.get("height", 0)),
            )
        except (TypeError, ValueError) as exc:
            errors.append(f"{stem}: invalid table geometry: {table_id}: {exc}")
            continue
        table_boxes[table_id] = box
        table_cells.append((table_id, *box))

    actual_table_names = {table_id.removeprefix("table-") for table_id in table_boxes}
    if actual_table_names != set(table_columns):
        errors.append(f"{stem}: Drawio table parity mismatch")

    row_boxes = {}
    actual_columns = defaultdict(dict)
    for cell in cells:
        table_id = cell.get("parent")
        if cell.get("vertex") != "1" or table_id not in table_boxes:
            continue
        row_id = cell.get("id", "")
        geometry = cell.find("mxGeometry")
        parsed_value = _parse_role_value(cell.get("value"))
        if geometry is None or parsed_value is None:
            errors.append(f"{stem}: invalid Drawio row: {row_id}")
            continue
        try:
            row_box = (
                table_boxes[table_id][0] + float(geometry.get("x", 0)),
                table_boxes[table_id][1] + float(geometry.get("y", 0)),
                float(geometry.get("width", table_boxes[table_id][2])),
                float(geometry.get("height", 0)),
            )
        except (TypeError, ValueError) as exc:
            errors.append(f"{stem}: invalid row geometry: {row_id}: {exc}")
            continue
        role, column = parsed_value
        table_name = table_id.removeprefix("table-")
        if column in actual_columns[table_name]:
            errors.append(f"{stem}: duplicate Drawio row: {table_name}.{column}")
        actual_columns[table_name][column] = role
        row_boxes[row_id] = (row_box, table_id)

    for table_name in set(table_columns) | set(actual_columns):
        expected = expected_display_columns.get(table_name, set())
        actual = set(actual_columns.get(table_name, {}))
        missing_columns = sorted(expected - actual)
        extra_columns = sorted(actual - expected)
        if missing_columns:
            errors.append(f"{stem}: missing Drawio key/ID columns in {table_name}: {', '.join(missing_columns)}")
        if extra_columns:
            errors.append(f"{stem}: unexpected Drawio columns in {table_name}: {', '.join(extra_columns)}")
        for column in sorted(expected & actual):
            expected_role = expected_roles[(table_name, column)]
            actual_role = actual_columns[table_name][column]
            if actual_role != expected_role:
                errors.append(
                    f"{stem}: wrong Drawio role for {table_name}.{column}: "
                    f"expected {expected_role}, got {actual_role}"
                )

    edges = [cell for cell in cells if cell.get("edge") == "1"]
    edge_pairs = Counter((edge.get("source"), edge.get("target")) for edge in edges)
    duplicate_pairs = [pair for pair, count in edge_pairs.items() if count > 1]
    if duplicate_pairs:
        errors.append(f"{stem}: duplicate Drawio connector endpoints: {duplicate_pairs}")
    edge_paths = []
    for edge in edges:
        edge_id = edge.get("id")
        source_id, target_id = edge.get("source"), edge.get("target")
        style = edge.get("style", "")
        if source_id not in row_boxes or target_id not in row_boxes:
            errors.append(f"{stem}: dangling Drawio connector: {edge_id}")
            continue
        if (
            "entityRelationEdgeStyle" not in style
            and "orthogonalEdgeStyle" not in style
        ):
            errors.append(f"{stem}: non-orthogonal Drawio connector: {edge_id}")
        if routing_mode == "native-editable" and "entityRelationEdgeStyle" not in style:
            errors.append(f"{stem}: native connector is not Entity Relation style: {edge_id}")
        if "portConstraint=eastwest;" not in style or "jettySize=auto;" not in style:
            errors.append(f"{stem}: connector missing native routing controls: {edge_id}")
        if routing_mode == "native-editable" and (
            "orthogonalLoop=1;" not in style or "rounded=1;" not in style
        ):
            errors.append(
                f"{stem}: native connector lacks orthogonal routing controls: {edge_id}"
            )
        if routing_mode == "native-editable":
            fixed_endpoint_overrides = [
                name
                for name in (
                    "exitX",
                    "exitY",
                    "exitDx",
                    "exitDy",
                    "entryX",
                    "entryY",
                    "entryDx",
                    "entryDy",
                )
                if _style_has_property(style, name)
            ]
            if fixed_endpoint_overrides:
                errors.append(
                    f"{stem}: native connector has fixed endpoint overrides: "
                    f"{edge_id} ({', '.join(fixed_endpoint_overrides)})"
                )

        if not re.search(r"(?:^|;)startArrow=ER[^;]*;", style) or not re.search(r"(?:^|;)endArrow=ER[^;]*;", style):
            errors.append(f"{stem}: connector without ER cardinality markers: {edge_id}")
        geometry = edge.find("mxGeometry")
        if geometry is None or geometry.get("relative") != "1":
            errors.append(f"{stem}: connector without relative geometry: {edge_id}")
            continue
        point_array = geometry.find("./Array[@as='points']")
        if point_array is None:
            if routing_mode == "explicit-waypoints":
                errors.append(f"{stem}: explicit connector without route points: {edge_id}")
            else:
                dynamic_edges += 1
            continue
        exit_x = _style_number(style, "exitX")
        exit_y = _style_number(style, "exitY")
        entry_x = _style_number(style, "entryX")
        entry_y = _style_number(style, "entryY")
        try:
            points = [
                (float(point.get("x")), float(point.get("y")))
                for point in point_array.findall("./mxPoint")
            ]
        except (TypeError, ValueError) as exc:
            errors.append(f"{stem}: invalid connector route point: {edge_id}: {exc}")
            continue
        if len(points) < 2:
            if routing_mode == "explicit-waypoints":
                errors.append(f"{stem}: connector needs at least two route points: {edge_id}")
            else:
                manual_waypoint_edges += 1
            continue
        if None in (exit_x, exit_y, entry_x, entry_y):
            if routing_mode == "explicit-waypoints":
                errors.append(f"{stem}: connector without explicit anchors: {edge_id}")
            else:
                manual_waypoint_edges += 1
            continue
        source_box, source_table_id = row_boxes[source_id]
        target_box, target_table_id = row_boxes[target_id]
        path = [
            (source_box[0] + source_box[2] * exit_x, source_box[1] + source_box[3] * exit_y),
            *points,
            (target_box[0] + target_box[2] * entry_x, target_box[1] + target_box[3] * entry_y),
        ]
        segments = []
        for first, second in zip(path, path[1:]):
            if _same_coordinate(first[0], second[0]) and _same_coordinate(first[1], second[1]):
                errors.append(f"{stem}: zero-length connector segment: {edge_id}")
                continue
            if not _same_coordinate(first[0], second[0]) and not _same_coordinate(first[1], second[1]):
                errors.append(f"{stem}: diagonal connector segment: {edge_id}")
                continue
            segments.append((first, second))
            for table_id, table_box in table_boxes.items():
                if _segment_hits_box(first, second, table_box):
                    errors.append(f"{stem}: connector crosses table {table_id}: {edge_id}")
        edge_paths.append((edge_id, segments, style))

    for index, (first_id, first_segments, first_style) in enumerate(edge_paths):
        for second_id, second_segments, second_style in edge_paths[index + 1:]:
            if any(
                _segments_conflict(first_segment[0], first_segment[1], second_segment[0], second_segment[1])
                for first_segment in first_segments
                for second_segment in second_segments
            ):
                errors.append(f"{stem}: overlapping connectors: {first_id}, {second_id}")
                continue
            if any(
                _segments_cross(first_segment[0], first_segment[1], second_segment[0], second_segment[1])
                for first_segment in first_segments
                for second_segment in second_segments
            ):
                if "jumpStyle=arc;" not in first_style or "jumpStyle=arc;" not in second_style:
                    errors.append(f"{stem}: unbridged connector crossing: {first_id}, {second_id}")
                else:
                    bridged_crossings += 1

    if Counter(edge.get("value") for edge in edges) != Counter(expected_relation_id_list):
        errors.append(f"{stem}: Drawio relation parity mismatch")

    for index, first in enumerate(table_cells):
        for second in table_cells[index + 1:]:
            if (
                first[1] < second[1] + second[3]
                and second[1] < first[1] + first[3]
                and first[2] < second[2] + second[4]
                and second[2] < first[2] + first[4]
            ):
                errors.append(f"{stem}: overlapping tables: {first[0]}, {second[0]}")

    oracle_table_names = {table.get("name") for table in oracle.findall("./Tables/Table")}
    if oracle_table_names != set(table_columns):
        errors.append(f"{stem}: Oracle table parity mismatch")
    for oracle_table in oracle.findall("./Tables/Table"):
        oracle_name = oracle_table.get("name")
        oracle_columns = {column.get("name") for column in oracle_table.findall("./Columns/Column")}
        if oracle_columns != expected_display_columns.get(oracle_name, set()):
            errors.append(f"{stem}: Oracle display-column parity mismatch: {oracle_name}")
    oracle_relation_ids = Counter(
        relation.get("name") for relation in oracle.findall("./Relations/Relation")
    )
    if oracle_relation_ids != Counter(expected_relation_id_list):
        errors.append(f"{stem}: Oracle relation parity mismatch")
    if re.search(r"(?i)\b(TODO|TBD|FIXME|HACK)\b|\?\?\?", ET.tostring(oracle, encoding="unicode")):
        errors.append(f"{stem}: placeholder in Oracle XML")

if errors:
    print(json.dumps({"ok": False, "errors": errors}))
    raise SystemExit(1)
print(
    json.dumps(
        {
            "ok": True,
            "partitions": len(stems),
            "tables": total_tables,
            "relations": total_relations,
            "bridgedCrossings": bridged_crossings,
            "dynamicEdges": dynamic_edges,
            "manualWaypointEdges": manual_waypoint_edges,
        }
    )
)
