#!/usr/bin/env python3
"""Deterministic Phase 2 relational diagram generator (standard library only)."""
from __future__ import annotations
import heapq
import argparse, json, re, subprocess, sys
from pathlib import Path
from collections import Counter
from math import isqrt
from xml.etree import ElementTree as ET

ROOT_ID = "1"
ROLE_ORDER = {"PK": 0, "FK": 1, "PK/FK": 0, "ID": 2, "REF": 3}
MERMAID_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TABLE_HEADER_HEIGHT = 48
TABLE_ROW_HEIGHT = 24
TABLE_WIDTH = 440
COLUMN_GAP = 320
ROW_GAP = 64
ROUTE_TOP = 40
ROUTE_SPACING = 24
ROUTE_MARGIN = 32
EDGE_CLEARANCE = 12
ROUTE_DETOUR = 16
ROUTE_TURN_PENALTY = 120

def relation_id(r):
    return f"{r['child']}.{r['column']}_TO_{r['parent']}.{r['parentColumn']}"

def normalize_partition(tables, relations):
    rejected = []
    by_name = {}
    for table in tables:
        name = table.get("name")
        if not isinstance(name, str) or not MERMAID_IDENTIFIER.fullmatch(name):
            raise ValueError(f"invalid Mermaid identifier for table: {name}")
        if not name or name in by_name:
            raise ValueError(f"duplicate table: {name}")
        columns = []
        seen = set()
        for col in table.get("columns", table.get("fields", [])):
            if isinstance(col, str): col = {"name": col}
            name_col = col.get("name")
            if not isinstance(name_col, str) or not MERMAID_IDENTIFIER.fullmatch(name_col):
                raise ValueError(f"invalid Mermaid identifier for column: {name}.{name_col}")
            if name_col in seen:
                raise ValueError(f"duplicate column: {name}.{name_col}")
            seen.add(name_col)
            columns.append(dict(col, name=name_col))
        by_name[name] = dict(table, name=name, columns=columns)
    valid = []
    seen_relations = set()
    column_sets = {n: {c["name"] for c in t["columns"]} for n, t in by_name.items()}
    for raw in relations:
        child, parent = raw.get("child"), raw.get("parent")
        column, parent_col = raw.get("column"), raw.get("parentColumn")
        if not all(x in by_name for x in (child, parent)):
            rejected.append({"kind": "external_relation", "relation": relation_id(raw) if child and parent and column and parent_col else raw})
            continue
        if column not in column_sets[child] or parent_col not in column_sets[parent]:
            raise ValueError(f"invalid endpoint: {child}.{column} or {parent}.{parent_col} does not exist")
        item = dict(raw)
        item["id"] = relation_id(item)
        if item["id"] in seen_relations:
            rejected.append({"kind": "duplicate_relation", "relation": item["id"]})
            continue
        seen_relations.add(item["id"])
        valid.append(item)
    valid.sort(key=lambda r: r["id"])
    return [by_name[n] for n in sorted(by_name)], valid, rejected

def select_display_columns(table, relations):
    child_endpoints = {(r.get("child"), r.get("column")) for r in relations if r.get("child") and r.get("column")}
    parent_endpoints = {(r.get("parent"), r.get("parentColumn")) for r in relations if r.get("parent") and r.get("parentColumn")}
    result = []
    for col in table["columns"]:
        name = col["name"]
        endpoint = (table["name"], name)
        is_pk = bool(col.get("is_pk"))
        is_fk = endpoint in child_endpoints
        is_ref = endpoint in parent_endpoints
        is_id = name.upper().endswith("_ID")
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
        item = dict(col)
        item["role"] = role
        result.append(item)
    result.sort(
        key=lambda c: (
            ROLE_ORDER.get(c["role"], 9),
            table["columns"].index(next(x for x in table["columns"] if x["name"] == c["name"])),
        )
    )
    return result

def model_from_json(data):
    raw_relations = data.get("relations", [])
    tables, relations, rejected = normalize_partition(data.get("tables", []), raw_relations)
    key_set = {(key.get("table"), key.get("column")) for key in data.get("keys", [])}
    for table in tables:
        for column in table["columns"]:
            column["is_pk"] = (table["name"], column["name"]) in key_set
        table["display_columns"] = select_display_columns(table, raw_relations)
    return {"schemaVersion": data.get("schemaVersion", 3), "tables": tables, "relations": relations, "rejected": rejected}

def build_mermaid(stem, tables, relations):
    lines = [
        f"# {stem} Relational Model",
        "",
        "```mermaid",
        "---",
        "config:",
        "  theme: base",
        "  look: classic",
        "  securityLevel: strict",
        "  deterministicIds: true",
        "  er:",
        "    layoutDirection: LR",
        "    diagramPadding: 20",
        "    minEntityWidth: 220",
        "    entityPadding: 8",
        "    nodeSpacing: 50",
        "    rankSpacing: 80",
        "    fontSize: 14",
        "---",
        "erDiagram",
        "  accTitle: Evidence-backed relational model",
        f"  accDescr: {stem}; {len(tables)} tables; {len(relations)} verified relations.",
    ]
    for table in tables:
        desc = table.get("description", "")
        if desc and desc != table['name']:
            lines.append(f"  %% {table['name']}: {desc}")
        lines.append(f"  {table['name']} {{")
        for col in table.get("display_columns", []):
            role = col.get("role", "")
            constraint = "PK, FK" if role == "PK/FK" else role
            lines.append(f"    string {col['name']} {constraint}".rstrip())
        lines.append("  }")
    for r in relations:
        lines.append(f"  %% relation-id: {relation_id(r)} status: {r.get('status', 'unresolved')}")
        edge = "o|--o{" if r.get("cardinality") in (None, "unknown") else "||--o{"
        lines.append(f"  {r['parent']} {edge} {r['child']} : \"{relation_id(r)}\"")
    lines += ["```", ""]
    lines.append("## Danh sách bảng và mô tả")
    lines.append("| Bảng (Table) | Tên mô tả (Description) | Số cột hiển thị |")
    lines.append("| --- | --- | --- |")
    for table in tables:
        desc = table.get("description", "") or "—"
        cols_count = len(table.get("display_columns", []))
        lines.append(f"| `{table['name']}` | {desc} | {cols_count} |")
    lines.append("")
    return "\n".join(lines)
def compute_layered_layout(tables, relations):
    names = [t["name"] for t in tables]
    incoming = {n: [] for n in names}
    for relation in relations:
        parent, child = relation["parent"], relation["child"]
        if parent != child and parent in incoming and child in incoming:
            incoming[child].append(parent)
    layer = {n: 0 for n in names}
    for _ in range(len(names) + 1):
        changed = False
        for name in names:
            if not incoming[name]:
                continue
            value = max(layer[parent] + 1 for parent in incoming[name])
            if value > layer[name]:
                layer[name] = value
                changed = True
        if not changed:
            break
    grouped = {}
    for name in names:
        grouped.setdefault(layer[name], []).append(name)
    tables_by_name = {table["name"]: table for table in tables}
    positions = {}
    table_top = ROUTE_TOP + (len(relations) + 2) * ROUTE_SPACING + 40
    for rank in sorted(grouped):
        y = table_top
        for name in sorted(grouped[rank]):
            table = tables_by_name[name]
            height = TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT * max(1, len(table.get("display_columns", [])))
            positions[name] = {
                "x": 80 + rank * (TABLE_WIDTH + COLUMN_GAP),
                "y": y,
                "width": TABLE_WIDTH,
                "height": height,
            }
            y += height + ROW_GAP
    return positions


def _table_height(table):
    display_columns = table.get("display_columns")
    if display_columns is None:
        display_columns = table.get("columns", [])
    return TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT * max(1, len(display_columns))


def _core_adjacency(tables, relations):
    names = sorted(table["name"] for table in tables)
    known = set(names)
    incoming = {name: set() for name in names}
    outgoing = {name: set() for name in names}
    for relation in relations:
        parent = relation.get("parent")
        child = relation.get("child")
        if (
            parent == child
            or parent not in known
            or child not in known
        ):
            continue
        incoming[parent].add(child)
        outgoing[child].add(parent)
    neighbors = {
        name: incoming[name] | outgoing[name]
        for name in names
    }
    return names, incoming, outgoing, neighbors


def _column_height(names, tables_by_name):
    if not names:
        return 0
    return sum(_table_height(tables_by_name[name]) for name in names) + ROW_GAP * (len(names) - 1)

def _table_family(name):
    base = re.sub(r"^(?:TEMP_|ETL_|BPS_ETL_)", "", name)
    parts = base.split("_")
    if len(parts) >= 2 and parts[0] in ("PLC", "CONF", "COM", "ADM"):
        return "_".join(parts[:2])
    return base


def _barycenter_order(names, neighbors, anchor_positions, fallback_positions):
    families = {}
    for name in names:
        fam = _table_family(name)
        families.setdefault(fam, []).append(name)

    family_scores = {}
    for fam, fnames in families.items():
        all_vals = []
        for name in fnames:
            for neighbor in neighbors.get(name, []):
                if neighbor in anchor_positions:
                    all_vals.append(anchor_positions[neighbor])
        if all_vals:
            family_scores[fam] = (
                0,
                sum(all_vals) / len(all_vals),
                min(fallback_positions.get(n, 0) for n in fnames),
            )
        else:
            family_scores[fam] = (
                1,
                0,
                min(fallback_positions.get(n, 0) for n in fnames),
            )

    sorted_families = sorted(families.keys(), key=lambda fam: family_scores[fam])

    result = []
    for fam in sorted_families:
        def table_key(name):
            vals = [
                anchor_positions[neighbor]
                for neighbor in sorted(neighbors.get(name, []))
                if neighbor in anchor_positions
            ]
            if vals:
                return (0, sum(vals) / len(vals), fallback_positions.get(name, 0), name)
            return (1, fallback_positions.get(name, 0), name)

        result.extend(sorted(families[fam], key=table_key))
    return result


def compute_core_layout(tables, relations):
    tables_by_name = {table["name"]: table for table in tables}
    names, incoming, outgoing, neighbors = _core_adjacency(tables, relations)
    if not names:
        return {}

    table_top = ROUTE_TOP + (len(relations) + 2) * ROUTE_SPACING + 40
    active = [name for name in names if neighbors[name]]
    fallback_positions = {name: index for index, name in enumerate(names)}
    if not active:
        sorted_names = sorted(names, key=lambda n: (_table_family(n), fallback_positions.get(n, 0), n))
        columns = {"left": [], "center": sorted_names, "right": []}
    else:
        scores = {
            name: 4 * len(incoming[name])
            + 2 * len(outgoing[name])
            + len(neighbors[name])
            for name in active
        }
        ranking = sorted(
            active,
            key=lambda name: (
                -scores[name],
                -len(incoming[name]),
                -len(outgoing[name]),
                name,
            ),
        )
        center_limit = min(3, max(1, isqrt(len(active) - 1) + 1))
        max_score = scores[ranking[0]]
        threshold = max(2, (max_score * 55 + 99) // 100)
        center_hubs = [
            name for name in ranking if scores[name] >= threshold
        ][:center_limit]
        if not center_hubs:
            center_hubs = ranking[:1]
        # A hub's name family is its review neighborhood.  Splitting a family
        # across x-bands forces its strongest local relationships through the
        # global routing lanes and defeats visual scanning by table name.
        center_families = {_table_family(name) for name in center_hubs}
        center = [
            name
            for name in names
            if _table_family(name) in center_families
        ]
        center_set = set(center)

        left = []
        right = []
        family_column_pref = {
            family: "center" for family in center_families
        }
        remaining_families = {}
        for name in names:
            if name not in center_set:
                remaining_families.setdefault(_table_family(name), []).append(name)
        for family, members in sorted(
            remaining_families.items(),
            key=lambda item: (
                -max(scores.get(member, 0) for member in item[1]),
                item[0],
            ),
        ):
            left_affinity = sum(
                len(outgoing[name] & center_set) for name in members
            )
            right_affinity = sum(
                len(incoming[name] & center_set) for name in members
            )
            if left_affinity > right_affinity:
                column = "left"
            elif right_affinity > left_affinity:
                column = "right"
            elif _column_height(left, tables_by_name) <= _column_height(
                right, tables_by_name
            ):
                column = "left"
            else:
                column = "right"
            family_column_pref[family] = column
            if column == "left":
                left.extend(sorted(members))
            else:
                right.extend(sorted(members))

        columns = {"left": left, "center": center, "right": right}

        for _ in range(2):
            center_positions = {
                name: index for index, name in enumerate(columns["center"])
            }
            right_positions = {
                name: index for index, name in enumerate(columns["right"])
            }
            left_positions = {
                name: index for index, name in enumerate(columns["left"])
            }
            left_anchors = dict(center_positions)
            left_anchors.update(right_positions)
            columns["left"] = _barycenter_order(
                columns["left"],
                neighbors,
                left_anchors,
                fallback_positions,
            )
            left_positions = {
                name: index for index, name in enumerate(columns["left"])
            }
            right_anchors = dict(center_positions)
            right_anchors.update(left_positions)
            columns["right"] = _barycenter_order(
                columns["right"],
                neighbors,
                right_anchors,
                fallback_positions,
            )
    tallest = max(
        _column_height(column, tables_by_name)
        for column in columns.values()
    )
    positions = {}
    x_values = {
        "left": 80,
        "center": 80 + TABLE_WIDTH + COLUMN_GAP,
        "right": 80 + 2 * (TABLE_WIDTH + COLUMN_GAP),
    }
    for column_name in ("left", "center", "right"):
        column = columns[column_name]
        y = table_top + (tallest - _column_height(column, tables_by_name)) / 2
        for name in column:
            height = _table_height(tables_by_name[name])
            positions[name] = {
                "x": x_values[column_name],
                "y": y,
                "width": TABLE_WIDTH,
                "height": height,
            }
            y += height + ROW_GAP
    return positions


def compute_layout(tables, relations, layout_mode="core-three-column"):
    if layout_mode == "core-three-column":
        return compute_core_layout(tables, relations)
    if layout_mode == "layered":
        return compute_layered_layout(tables, relations)
    raise ValueError(f"unsupported Drawio layout mode: {layout_mode}")


def _format_number(value):
    number = float(value)
    return str(int(number)) if number.is_integer() else f"{number:.4f}".rstrip("0").rstrip(".")


def _append_route_point(points, x, y):
    point = (float(x), float(y))
    if not points or points[-1] != point:
        points.append(point)


def _simplify_route(points):
    simplified = []
    for point in points:
        if len(simplified) >= 2:
            previous, current = simplified[-2], simplified[-1]
            if (
                previous[0] == current[0] == point[0]
                or previous[1] == current[1] == point[1]
            ):
                simplified[-1] = point
                continue
        _append_route_point(simplified, *point)
    return simplified


def _relation_arrows(relation):
    if relation.get("cardinality") == "1:N":
        return "ERmany", "ERone"
    return "ERzeroToMany", "ERzeroToOne"


def _route_sides(source_position, target_position, source_name, target_name):
    if source_name == target_name:
        return "right", "right"
    if target_position["x"] > source_position["x"]:
        return "right", "left"
    if target_position["x"] < source_position["x"]:
        return "left", "right"
    if source_name < target_name:
        return "right", "left"
    return "left", "right"


def _lane_x(position, side, slot):
    if side == "right":
        return position["x"] + position["width"] + ROUTE_MARGIN + slot * ROUTE_SPACING
    return position["x"] - ROUTE_MARGIN - slot * ROUTE_SPACING


def _expanded_box(position):
    return (
        position["x"] - EDGE_CLEARANCE,
        position["y"] - EDGE_CLEARANCE,
        position["x"] + position["width"] + EDGE_CLEARANCE,
        position["y"] + position["height"] + EDGE_CLEARANCE,
    )


def _segment_hits_box(first, second, box):
    x1, y1 = first
    x2, y2 = second
    left, top, right, bottom = box
    if x1 == x2:
        return left < x1 < right and max(min(y1, y2), top) < min(max(y1, y2), bottom)
    if y1 == y2:
        return top < y1 < bottom and max(min(x1, x2), left) < min(max(x1, x2), right)
    return True


def _segments_conflict(first, second, other_first, other_second):
    x1, y1 = first
    x2, y2 = second
    x3, y3 = other_first
    x4, y4 = other_second
    first_horizontal = y1 == y2
    second_horizontal = y3 == y4
    if first_horizontal and second_horizontal:
        return y1 == y3 and max(min(x1, x2), min(x3, x4)) < min(max(x1, x2), max(x3, x4))
    if not first_horizontal and not second_horizontal:
        return x1 == x3 and max(min(y1, y2), min(y3, y4)) < min(max(y1, y2), max(y3, y4))
    return False


def _grid_path(start, target, obstacles, reserved, label):
    if start == target:
        return [start]
    min_x = min(box[0] for box in obstacles)
    max_x = max(box[2] for box in obstacles)
    min_y = min(box[1] for box in obstacles)
    max_y = max(box[3] for box in obstacles)

    reserved_h = {}
    reserved_v = {}
    for first, second in reserved:
        x1, y1 = first
        x2, y2 = second
        if y1 == y2:
            reserved_h.setdefault(y1, []).append((min(x1, x2), max(x1, x2)))
        elif x1 == x2:
            reserved_v.setdefault(x1, []).append((min(y1, y2), max(y1, y2)))

    def fast_conflicts(first, second):
        x1, y1 = first
        x2, y2 = second
        if y1 == y2:
            min_x_seg, max_x_seg = min(x1, x2), max(x1, x2)
            for ry, spans in reserved_h.items():
                if abs(ry - y1) <= 0.01:
                    for r_min, r_max in spans:
                        if max(min_x_seg, r_min) + 0.01 < min(max_x_seg, r_max):
                            return True
            return False
        elif x1 == x2:
            min_y_seg, max_y_seg = min(y1, y2), max(y1, y2)
            for rx, spans in reserved_v.items():
                if abs(rx - x1) <= 0.01:
                    for r_min, r_max in spans:
                        if max(min_y_seg, r_min) + 0.01 < min(max_y_seg, r_max):
                            return True
            return False
        return False

    x_values = {start[0], target[0], min_x - ROUTE_MARGIN * 4, max_x + ROUTE_MARGIN * 4}
    y_values = {start[1], target[1], min_y - ROUTE_MARGIN * 4, max_y + ROUTE_MARGIN * 4}

    sorted_by_y = sorted(obstacles, key=lambda b: b[1])
    for b1, b2 in zip(sorted_by_y, sorted_by_y[1:]):
        if b2[1] > b1[3]:
            y_values.add((b1[3] + b2[1]) / 2)

    for left, top, right, bottom in obstacles:
        x_values.update((left, right))
        y_values.update((top, bottom))

    for first, second in reserved:
        x_values.update((first[0], second[0]))
        y_values.update((first[1], second[1]))

    xs = sorted(x_values)
    ys = sorted(y_values)
    start_index = (xs.index(start[0]), ys.index(start[1]))
    target_index = (xs.index(target[0]), ys.index(target[1]))
    target_pt = target

    def point_is_open(point):
        return not any(left < point[0] < right and top < point[1] < bottom for left, top, right, bottom in obstacles)

    def segment_is_open(first, second):
        return (
            (first[0] == second[0] or first[1] == second[1])
            and point_is_open(first) and point_is_open(second)
            and not any(_segment_hits_box(first, second, box) for box in obstacles)
            and not fast_conflicts(first, second)
        )

    directions = ((1, 0), (0, 1), (-1, 0), (0, -1))
    start_state = (start_index[0], start_index[1], -1)
    h0 = abs(start[0] - target_pt[0]) + abs(start[1] - target_pt[1])
    queue = [(h0, 0.0, 0, start_index[0], start_index[1], -1)]
    best = {start_state: (0.0, 0)}
    previous = {}
    goal_state = None
    while queue:
        f_val, cost, turns, x_index, y_index, direction = heapq.heappop(queue)
        state = (x_index, y_index, direction)
        if best.get(state) != (cost, turns):
            continue
        if (x_index, y_index) == target_index:
            goal_state = state
            break
        curr_pt = (xs[x_index], ys[y_index])
        for next_direction, (delta_x, delta_y) in enumerate(directions):
            next_x = x_index + delta_x
            next_y = y_index + delta_y
            if not (0 <= next_x < len(xs) and 0 <= next_y < len(ys)):
                continue
            first = curr_pt
            second = (xs[next_x], ys[next_y])
            if not segment_is_open(first, second):
                continue
            turn = int(direction != -1 and direction != next_direction)
            next_cost = cost + abs(second[0] - first[0]) + abs(second[1] - first[1]) + turn * ROUTE_TURN_PENALTY
            next_turns = turns + turn
            next_state = (next_x, next_y, next_direction)
            candidate = (next_cost, next_turns)
            if next_state not in best or candidate < best[next_state]:
                best[next_state] = candidate
                previous[next_state] = state
                h = abs(second[0] - target_pt[0]) + abs(second[1] - target_pt[1])
                heapq.heappush(queue, (next_cost + h, next_cost, next_turns, next_x, next_y, next_direction))
    if goal_state is None:
        raise ValueError(f"unable to route Drawio relation: {label}")
    path = []
    state = goal_state
    while True:
        path.append((xs[state[0]], ys[state[1]]))
        if state == start_state:
            break
        state = previous[state]
    return _simplify_route(reversed(path))


def build_drawio(
    stem,
    tables,
    relations,
    layout_mode="core-three-column",
    routing_mode="native-editable",
):
    if routing_mode not in ("native-editable", "explicit-waypoints"):
        raise ValueError(f"unsupported Drawio routing mode: {routing_mode}")
    positions = compute_layout(tables, relations, layout_mode)
    mx = ET.Element("mxfile", {"host": "app.diagrams.net"})
    diagram = ET.SubElement(mx, "diagram", {"name": stem})
    graph = ET.SubElement(
        diagram,
        "mxGraphModel",
        {
            "page": "1",
            "grid": "1",
            "gridSize": "10",
            "guides": "1",
            "tooltips": "1",
            "connect": "1",
            "arrows": "1",
            "fold": "1",
            "math": "0",
            "shadow": "0",
            "layoutMode": layout_mode,
            "routingMode": routing_mode,
        },
    )
    root = ET.SubElement(graph, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": ROOT_ID, "parent": "0"})

    table_style = (
        "swimlane;html=1;rounded=0;startSize=48;horizontal=1;"
        "childLayout=stackLayout;horizontalStack=0;resizeParent=1;resizeLast=0;collapsible=0;"
        "fillColor=#ffffff;swimlaneFillColor=#f8fafc;strokeColor=#334155;fontColor=#0f172a;"
        "fontStyle=1;whiteSpace=wrap;align=center;verticalAlign=middle;"
    )
    row_styles = {
        "PK": "fillColor=#fef3c7;fontStyle=1;",
        "PK/FK": "fillColor=#fef3c7;fontStyle=1;",
        "FK": "fillColor=#dbeafe;",
        "ID": "fillColor=#f1f5f9;",
        "REF": "fillColor=#f1f5f9;",
    }
    row_boxes = {}
    cell_ids = {}
    for table in tables:
        name = table["name"]
        position = positions[name]
        table_id = f"table-{name}"
        desc = table.get("description", "")
        table_label = f"{name}<br/>{desc}" if desc and desc != name else name
        table_cell = ET.SubElement(
            root,
            "mxCell",
            {
                "id": table_id,
                "value": table_label,
                "style": table_style,
                "vertex": "1",
                "connectable": "1",
                "parent": ROOT_ID,
            },
        )
        ET.SubElement(
            table_cell,
            "mxGeometry",
            {
                "x": str(position["x"]),
                "y": str(position["y"]),
                "width": str(position["width"]),
                "height": str(position["height"]),
                "as": "geometry",
            },
        )
        for index, column in enumerate(table.get("display_columns", [])):
            column_name = column["name"]
            cell_id = f"{table_id}-{column_name}"
            cell_ids[(name, column_name)] = cell_id
            row_cell = ET.SubElement(
                root,
                "mxCell",
                {
                    "id": cell_id,
                    "value": f"{column['role']}  {column_name}",
                    "style": (
                        "text;html=1;align=left;verticalAlign=middle;spacingLeft=8;"
                        "whiteSpace=wrap;strokeColor=#cbd5e1;fontColor=#0f172a;"
                        + row_styles.get(column["role"], "fillColor=#ffffff;")
                    ),
                    "vertex": "1",
                    "connectable": "1",
                    "parent": table_id,
                },
            )
            row_y = TABLE_HEADER_HEIGHT + index * TABLE_ROW_HEIGHT
            ET.SubElement(
                row_cell,
                "mxGeometry",
                {
                    "x": "0",
                    "y": str(row_y),
                    "width": str(position["width"]),
                    "height": str(TABLE_ROW_HEIGHT),
                    "as": "geometry",
                },
            )
            row_boxes[(name, column_name)] = {
                "x": position["x"],
                "y": position["y"] + row_y,
                "width": position["width"],
                "height": TABLE_ROW_HEIGHT,
            }

    route_descriptors = []
    source_counts = Counter()
    target_counts = Counter()
    for relation in relations:
        source_name, target_name = relation["child"], relation["parent"]
        source_position = positions[source_name]
        target_position = positions[target_name]
        source_side, target_side = _route_sides(
            source_position, target_position, source_name, target_name
        )
        source_key = (source_name, relation["column"], source_side)
        target_key = (target_name, relation["parentColumn"], target_side)
        source_counts[source_key] += 1
        target_counts[target_key] += 1
        route_descriptors.append((source_side, target_side, source_key, target_key))

    source_seen = Counter()
    target_seen = Counter()
    source_lane_seen = Counter()
    target_lane_seen = Counter()
    obstacles = [_expanded_box(position) for position in positions.values()]
    reserved_segments = []

    stubs = []
    if routing_mode == "explicit-waypoints":
        for index, relation in enumerate(relations):
            source_name, target_name = relation["child"], relation["parent"]
            source_column, target_column = relation["column"], relation["parentColumn"]
            source_box = row_boxes[(source_name, source_column)]
            target_box = row_boxes[(target_name, target_column)]
            source_position = positions[source_name]
            target_position = positions[target_name]
            source_side, target_side, source_key, target_key = route_descriptors[index]
            source_slot = source_seen[source_key]
            target_slot = target_seen[target_key]
            source_seen[source_key] += 1
            target_seen[target_key] += 1
            source_fraction = round(
                (source_slot + 1) / (source_counts[source_key] + 1),
                4,
            )
            target_fraction = round(
                (target_slot + 1) / (target_counts[target_key] + 1),
                4,
            )
            source_y = source_box["y"] + source_box["height"] * source_fraction
            target_y = target_box["y"] + target_box["height"] * target_fraction
            source_boundary = (
                source_position["x"] + source_position["width"]
                if source_side == "right"
                else source_position["x"],
                source_side,
            )
            target_boundary = (
                target_position["x"] + target_position["width"]
                if target_side == "right"
                else target_position["x"],
                target_side,
            )
            source_lane_slot = source_lane_seen[source_boundary]
            target_lane_slot = target_lane_seen[target_boundary]
            source_lane_seen[source_boundary] += 1
            target_lane_seen[target_boundary] += 1
            if (
                source_name == target_name
                and source_column == target_column
                and source_boundary == target_boundary
                and source_lane_slot == target_lane_slot
            ):
                target_lane_slot += 1
                target_lane_seen[target_boundary] = max(
                    target_lane_seen[target_boundary],
                    target_lane_slot + 1,
                )
            source_lane_x = _lane_x(
                source_position,
                source_side,
                source_lane_slot,
            )
            target_lane_x = _lane_x(
                target_position,
                target_side,
                target_lane_slot,
            )
            s_anchor = (source_boundary[0], source_y)
            s_port = (source_lane_x, source_y)
            t_port = (target_lane_x, target_y)
            t_anchor = (target_boundary[0], target_y)
            stubs.append((s_anchor, s_port, t_port, t_anchor, source_fraction, target_fraction, source_side, target_side))
            if s_anchor != s_port:
                reserved_segments.append((s_anchor, s_port))
            if t_port != t_anchor:
                reserved_segments.append((t_port, t_anchor))

    for index, relation in enumerate(relations):
        source_name, target_name = relation["child"], relation["parent"]
        source_column, target_column = relation["column"], relation["parentColumn"]
        source_side, target_side, source_key, target_key = route_descriptors[index]
        route = []
        if routing_mode == "explicit-waypoints":
            s_anchor, s_port, t_port, t_anchor, source_fraction, target_fraction, source_side, target_side = stubs[index]
            route = _grid_path(
                s_port,
                t_port,
                obstacles,
                reserved_segments,
                relation_id(relation),
            )
            full_route = [s_anchor] + list(route) + [t_anchor]
            for first, second in zip(full_route, full_route[1:]):
                if first != second:
                    reserved_segments.append((first, second))

        start_arrow, end_arrow = _relation_arrows(relation)
        style = (
            "edgeStyle=entityRelationEdgeStyle;rounded=1;orthogonalLoop=1;"
            "jettySize=auto;html=1;portConstraint=eastwest;noLabel=1;"
            "jumpStyle=arc;jumpSize=8;strokeColor=#64748b;"
            f"startArrow={start_arrow};startFill=0;"
            f"endArrow={end_arrow};endFill=0;"
        )
        if routing_mode == "explicit-waypoints":
            style += (
                f"exitX={'1' if source_side == 'right' else '0'};"
                f"exitY={_format_number(source_fraction)};exitDx=0;exitDy=0;"
                f"entryX={'1' if target_side == 'right' else '0'};"
                f"entryY={_format_number(target_fraction)};entryDx=0;entryDy=0;"
            )
        if relation.get("status") != "confirmed":
            style += "dashed=1;"
        edge_id = f"edge-{index:04d}-{re.sub('[^A-Za-z0-9]', '-', relation_id(relation))}"
        edge = ET.SubElement(
            root,
            "mxCell",
            {
                "id": edge_id,
                "value": relation_id(relation),
                "style": style,
                "edge": "1",
                "parent": ROOT_ID,
                "source": cell_ids[(source_name, source_column)],
                "target": cell_ids[(target_name, target_column)],
            },
        )
        geometry = ET.SubElement(edge, "mxGeometry", {"relative": "1", "as": "geometry"})
        if routing_mode == "explicit-waypoints":
            point_array = ET.SubElement(geometry, "Array", {"as": "points"})
            for x, y in route:
                ET.SubElement(
                    point_array,
                    "mxPoint",
                    {"x": _format_number(x), "y": _format_number(y)},
                )
    return ET.ElementTree(mx)

def build_oracle_sqldev(stem, tables, relations):
    design = ET.Element("RelationalDesign")
    ET.SubElement(design, "Comment").text = f"GENERATED RELATIONAL MODEL FOR ORACLE SQL DEVELOPER: {stem}"
    tabs = ET.SubElement(design, "Tables")
    for table in tables:
        desc = table.get("description", "")
        t = ET.SubElement(tabs, "Table", {"name": table["name"], "comment": desc})
        cols = ET.SubElement(t, "Columns")
        for col in table.get("display_columns", []):
            is_pk = col["role"] in ("PK", "PK/FK")
            is_fk = col["role"] in ("FK", "PK/FK")
            ET.SubElement(cols, "Column", {"name": col["name"], "dataType": "UNKNOWN", "pk": str(is_pk).lower(), "fk": str(is_fk).lower(), "comment": ""})
    rels = ET.SubElement(design, "Relations")
    for r in relations:
        ET.SubElement(rels, "Relation", {"name": relation_id(r), "child": r["child"], "parent": r["parent"], "childColumn": r["column"], "parentColumn": r["parentColumn"], "type": "1-n"})
    return ET.ElementTree(design)

def write_tree(tree, path):
    ET.indent(tree, space="  "); tree.write(path, encoding="utf-8", xml_declaration=True)


def phase1_sources(root, mapped):
    design_dir = root / "db_table"
    stems = sorted(path.stem for path in design_dir.glob("*.md"))
    if not stems:
        raise SystemExit("missing db_table design inputs; run Phase 1 first")
    sources = [mapped / f"{stem}.json" for stem in stems]
    missing = [source.name for source in sources if not source.is_file()]
    if missing:
        raise SystemExit(f"missing Phase 1 partitions: {', '.join(missing)}")
    return stems, sources

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--reason", default="diagram-redraw")
    parser.add_argument(
        "--layout-mode",
        choices=("core-three-column", "layered"),
        default="core-three-column",
    )
    parser.add_argument(
        "--routing-mode",
        choices=("native-editable", "explicit-waypoints"),
        default="native-editable",
    )
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    mapped = root / "_output" / "db_table_mapped"
    if not mapped.is_dir(): raise SystemExit("missing _output/db_table_mapped; run Phase 1 first")
    backup = Path(__file__).with_name("pre-cycle-backup.py")
    subprocess.run([sys.executable, str(backup), "--project-root", str(root), "--reason", args.reason], check=True)
    diagrams = root / "_output" / "diagrams"; diagrams.mkdir(parents=True, exist_ok=True)
    stems, sources = phase1_sources(root, mapped)
    for path in diagrams.iterdir():
        if (
            path.is_file()
            and (
                path.name.startswith("plc-overview.")
                or (path.stem.startswith("table_PLC_") and path.stem not in stems)
            )
        ):
            path.unlink()
    legacy_drawio = diagrams / "drawio"
    legacy_drawio.mkdir(parents=True, exist_ok=True)
    for path in legacy_drawio.glob("*.drawio.xml"):
        if path.name.removesuffix(".drawio.xml") not in stems:
            path.unlink()
    for legacy_path in (
        diagrams / "mermaid" / "plc-overview.mermaid.md",
        diagrams / "sqldeveloper" / "plc-overview.sql",
    ):
        if legacy_path.is_file():
            legacy_path.unlink()
    total = [0, 0]
    for source in sources:
        stem = source.stem
        data = json.loads(source.read_text(encoding="utf-8")); model = model_from_json(data);
        mer = build_mermaid(stem, model["tables"], model["relations"])
        xml = build_drawio(
            stem,
            model["tables"],
            model["relations"],
            layout_mode=args.layout_mode,
            routing_mode=args.routing_mode,
        )
        sql_xml = build_oracle_sqldev(stem, model["tables"], model["relations"])
        (diagrams / f"{stem}.mermaid.md").write_text(mer, encoding="utf-8")
        drawio_path = diagrams / f"{stem}.drawio.xml"
        write_tree(xml, drawio_path)
        write_tree(xml, legacy_drawio / f"{stem}.drawio.xml")
        write_tree(sql_xml, diagrams / f"{stem}.oracle-sqldev.xml")
        report_file = mapped / f"evidence-report-{source.stem}.md"
        if report_file.exists():
            content = report_file.read_text(encoding="utf-8")
            marker = "## Sơ đồ quan hệ (ER Diagram)"
            if marker in content:
                content = content.split(marker, 1)[0] + marker + "\n\n" + mer + "\n"
                report_file.write_text(content, encoding="utf-8")
        total[0] += len(model["tables"]); total[1] += len(model["relations"])
        if model["rejected"]: print(json.dumps({"stem": stem, "rejected": model["rejected"]}))
    print(json.dumps({"tables": total[0], "relations": total[1]}))

if __name__ == "__main__": main()
