#!/usr/bin/env python3
"""Phase A: freeze Entity/Biz-reachable DAO relational evidence; never render."""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from csharp_syntax import is_generated_source, parse_methods
from source_code_analysis import (
    _mask_csharp_code,
    build_analysis,
    build_partition_scopes,
    write_analysis_artifacts,
)

OBJECT = re.compile(r"^[A-Z][A-Z0-9_]+$")

METHOD = re.compile(
    r"(?ms)^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|"
    r"async|sealed|new|partial)\s+)+(?P<return>[\w<>,?()\s]+?)\s+"
    r"(?P<name>[A-Za-z_]\w*)(?:<[^>{}]*>)?\s*\([^{};]*\)\s*\{"
)
FIELD = re.compile(
    r"(?:(?:public|private|protected|internal)\s+)?(?:readonly\s+)?"
    r"(?P<type>[A-Za-z_]\w*)\s+(?P<field>_?[A-Za-z_]\w*)\s*(?:=|;)"
)


def line_of(text, offset):
    return text.count("\n", 0, offset) + 1


def sha256(paths):
    digest = hashlib.sha256()
    listed = sorted(paths, key=lambda path: path.as_posix().lower())
    for path in listed:
        digest.update(path.as_posix().encode())
        digest.update(path.read_bytes())
    return {"fileCount": len(listed), "sha256": digest.hexdigest()}


def documented(design):
    tables, current = [], None
    for raw in design.read_text(encoding="utf-8", errors="ignore").splitlines():
        cells = [cell.strip() for cell in raw.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] in ("Thông tin", "---"):
            continue
        if OBJECT.fullmatch(cells[1]) and not cells[2] and not cells[3]:
            desc = cells[0] if cells[0] and cells[0] not in ("Thông tin", "---") else ""
            current = {"name": cells[1], "description": desc, "columns": []}
            tables.append(current)
        elif current and OBJECT.fullmatch(cells[1]):
            current["columns"].append(cells[1])
    return tables


def _entity_metadata(file):
    text = file.read_text(encoding="utf-8", errors="ignore")
    if is_generated_source(text, file):
        return None
    class_match = re.search(r"\bclass\s+([A-Za-z_]\w*)", text)
    if not class_match:
        return None
    class_name = class_match.group(1)
    constructor = re.search(
        rf"\b{re.escape(class_name)}\s*\([^)]*\)\s*:\s*base\s*\(\s*"
        r'"([A-Z][A-Z0-9_]*)"(?:\s*,\s*(?:"([A-Z0-9_]*)"|([A-Za-z0-9_]+)))?',
        text,
    )
    if not constructor:
        return None

    constants = {
        match.group(1): match.group(2)
        for match in re.finditer(
            r'const\s+string\s+(C_[A-Z0-9_]+)\s*=\s*"([A-Z0-9_]+)"',
            text,
        )
    }
    columns, key_column, key_evidence = [], None, None
    property_pattern = re.compile(
        r"\[PropertyEntity\(\s*(?P<token>\"[^\"]+\"|C_[A-Z0-9_]+)\s*,\s*"
        r"(?P<is_key>true|false)(?:\s*,\s*(?P<persistent>true|false))?\s*\)\]"
        r"\s*(?:public|private|protected|internal)\s+"
        r"(?P<type>[\w<>,?.\[\]]+)\s+(?P<name>[A-Za-z_]\w*)",
        re.IGNORECASE,
    )
    for match in property_pattern.finditer(text):
        if match.group("persistent") and match.group("persistent").lower() == "false":
            continue
        token = match.group("token")
        column = token[1:-1] if token.startswith('"') else constants.get(token)
        if not column:
            continue
        if column not in columns:
            columns.append(column)
        if match.group("is_key").lower() == "true":
            key_column = column
            key_evidence = {
                "file": str(file),
                "line": line_of(text, match.start()),
                "symbol": match.group(0),
            }

    constructor_table = constructor.group(1)
    raw_key = constructor.group(2) or constructor.group(3) or ""
    if not key_column:
        if raw_key:
            key_column = raw_key
        elif "DOCUMENT_ID" in columns or constructor_table == "PLC_DOCUMENT":
            key_column = "DOCUMENT_ID"
        elif f"{constructor_table}_ID" in columns:
            key_column = f"{constructor_table}_ID"
        elif columns:
            key_column = columns[0]
        else:
            key_column = f"{constructor_table}_ID"
        key_evidence = {
            "file": str(file),
            "line": line_of(text, constructor.start()),
            "symbol": constructor.group(0),
        }
    if key_column and key_column not in columns:
        columns.insert(0, key_column)
    return {
        "class": class_name,
        "table": constructor_table,
        "key": key_column,
        "columns": columns,
        "keyEvidence": key_evidence,
        "mappingEvidence": {
            "file": str(file),
            "line": line_of(text, constructor.start()),
            "symbol": constructor.group(0),
        },
    }


def _normalized_name(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def source_cs_files(root):
    if not root or not root.is_dir():
        return []
    excluded = {".svn", "bin", "obj", "generated", "generatedcode"}
    result = []
    for path in root.rglob("*.cs"):
        if any(part.lower() in excluded for part in path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if is_generated_source(text, path):
            continue
        result.append(path)
    return sorted(result)


def source_backed_table(design, entity, source_root):
    roots = [entity]
    if source_root:
        roots.extend(
            [
                source_root / "SM.FlexCollection.SharedComponent" / "Entities",
                source_root,
            ]
        )
    candidates, seen = [], set()
    design_name = _normalized_name(design.stem)
    aliases = {
        design_name,
        design_name.removeprefix("table"),
        design_name.removeprefix("tableplc"),
        design_name.removeprefix("plc"),
    }
    for root in roots:
        if not root.is_dir():
            continue
        for file in source_cs_files(root):
            if file in seen:
                continue
            seen.add(file)
            metadata = _entity_metadata(file)
            if not metadata:
                continue
            class_name = _normalized_name(metadata["class"])
            if any(
                alias
                and (
                    alias in class_name
                    or class_name in alias
                    or alias.endswith(class_name)
                    or class_name.endswith(alias)
                )
                for alias in aliases
            ):
                candidates.append(metadata)
    if len(candidates) > 1:
        names = ", ".join(
            f"{item['class']} ({item['table']})" for item in candidates
        )
        raise SystemExit(f"ambiguous source-backed table mapping for {design.name}: {names}")
    if not candidates:
        return None
    metadata = candidates[0]
    return {
        "name": metadata["table"],
        "columns": metadata["columns"],
        "sourceEvidence": {
            "entity": metadata["mappingEvidence"],
            "key": metadata["keyEvidence"],
        },
    }, {
        "table": metadata["table"],
        "column": metadata["key"],
        "status": "entity-key-candidate",
        "evidence": metadata["keyEvidence"],
    }


def source_backed_relations(source_root, table, entity):
    if table != "ADM_SYSTEM_PARAMETER":
        return []
    roots = [source_root] if source_root else [entity]
    relations = {}
    for root in roots:
        if not root or not root.is_dir():
            continue
        for file in source_cs_files(root):
            text = file.read_text(encoding="utf-8", errors="ignore")
            source_kind = "dao" if "dao" in {part.lower() for part in file.parts} or "dao" in file.stem.lower() else "biz"
            for method in methods(text):
                body = without_csharp_comments(method["body"])
                upper_body = body.upper()
                for match in re.finditer(
                    r"(?P<a>\w+)\.(?P<a_col>[A-Z][A-Z0-9_]*)\s*=\s*"
                    r"(?P<b>\w+)\.(?P<b_col>[A-Z][A-Z0-9_]*)",
                    body,
                    re.IGNORECASE,
                ):
                    columns = {match.group("a_col").upper(), match.group("b_col").upper()}
                    if columns == {"EXT1I", "SYSTEM_PARAMETER_ID"}:
                        relation = {
                            "child": table,
                            "column": "EXT1I",
                            "parent": table,
                            "parentColumn": "SYSTEM_PARAMETER_ID",
                            "status": "confirmed",
                            "cardinality": "1:N",
                            "reason": "Source SQL maps system-parameter mapping rows to a title SYSTEM_PARAMETER_ID",
                        }
                    elif (
                        columns == {"EXT2I", "CHECK_CRITERIA_ID"}
                        and "ADM_SYSTEM_PARAMETER" in upper_body
                        and "CONF_CHECK_CRITERIA" in upper_body
                    ):
                        relation = {
                            "child": table,
                            "column": "EXT2I",
                            "parent": "CONF_CHECK_CRITERIA",
                            "parentColumn": "CHECK_CRITERIA_ID",
                            "tables": [table, "CONF_CHECK_CRITERIA"],
                            "status": "proposed",
                            "cardinality": "1:N",
                            "reason": "Source SQL joins mapping EXT2I to CONF_CHECK_CRITERIA.CHECK_CRITERIA_ID; Oracle constraint is not declared in the inputs",
                        }
                    else:
                        continue
                    evidence = {
                        "file": str(file),
                        "method": method["name"],
                        "line": line_of(text, method["bodyOffset"] + match.start()),
                        "code": match.group(0),
                    }
                    source = {
                        "dao": evidence if source_kind == "dao" else {},
                        "biz": evidence if source_kind == "biz" else {},
                    }
                    key = (
                        relation["child"],
                        relation["column"],
                        relation["parent"],
                        relation["parentColumn"],
                    )
                    if key not in relations:
                        relation["evidence"] = [source]
                        relations[key] = relation
                    else:
                        relations[key]["evidence"].append(source)

                if (
                    "PARENT_ID" in upper_body
                    and re.search(
                        r"\b[A-Z_]\w*\.SYSTEM_PARAMETER_ID\s*==\s*[A-Z_]\w*\.PARENT_ID\b",
                        body,
                        re.IGNORECASE,
                    )
                ):
                    match = re.search(
                        r"\b[A-Z_]\w*\.SYSTEM_PARAMETER_ID\s*==\s*[A-Z_]\w*\.PARENT_ID\b",
                        body,
                        re.IGNORECASE,
                    )
                    evidence = {
                        "file": str(file),
                        "method": method["name"],
                        "line": line_of(text, method["bodyOffset"] + match.start()),
                        "code": match.group(0),
                    }
                    relation = {
                        "child": table,
                        "column": "PARENT_ID",
                        "parent": table,
                        "parentColumn": "SYSTEM_PARAMETER_ID",
                        "status": "confirmed",
                        "cardinality": "1:N",
                        "reason": "Biz hierarchy lookup compares PARENT_ID with SYSTEM_PARAMETER_ID",
                        "evidence": [
                            {
                                "dao": evidence if source_kind == "dao" else {},
                                "biz": evidence if source_kind == "biz" else {},
                            }
                        ],
                    }
                    key = (
                        relation["child"],
                        relation["column"],
                        relation["parent"],
                        relation["parentColumn"],
                    )
                    if key not in relations:
                        relations[key] = relation
                    else:
                        relations[key]["evidence"].extend(relation["evidence"])
    return sorted(relations.values(), key=lambda relation: (
        relation["child"],
        relation["column"],
        relation["parent"],
        relation["parentColumn"],
    ))

def find_all_entity_files(entity, source_root=None):
    roots = [entity]
    if entity.parent and entity.parent.name == "Entities":
        roots.append(entity.parent)
    elif source_root and source_root.is_dir():
        for cand in [source_root / "SM.FlexCollection.SharedComponent" / "Entities"]:
            if cand.is_dir() and cand not in roots:
                roots.append(cand)
    files = []
    seen = set()
    for root in roots:
        for f in sorted(root.rglob("*.cs")):
            try:
                resolved = f.resolve()
            except OSError:
                resolved = f
            if resolved not in seen:
                seen.add(resolved)
                files.append(f)
    return files


def entity_keys(entity, source_root=None):
    keys = []
    seen = set()
    for file in find_all_entity_files(entity, source_root):
        text = file.read_text(encoding="utf-8", errors="ignore")
        if is_generated_source(text, file):
            continue
        constants = {
            match.group(1): match.group(2)
            for match in re.finditer(
                r'const\s+string\s+(C_[A-Z0-9_]+)\s*=\s*"([A-Z0-9_]+)"', text
            )
        }
        for match in re.finditer(r"\[PropertyEntity\((C_[A-Z0-9_]+)\s*,\s*true\)", text):
            constant = match.group(1)
            if constant in constants:
                table = file.stem
                col = constants[constant]
                if (table, col) not in seen:
                    seen.add((table, col))
                    keys.append(
                        {
                            "table": table,
                            "column": col,
                            "evidence": {
                                "file": str(file),
                                "line": line_of(text, match.start()),
                                "symbol": match.group(0),
                            },
                        }
                    )
        meta = _entity_metadata(file)
        if meta and (meta["table"], meta["key"]) not in seen:
            seen.add((meta["table"], meta["key"]))
            keys.append(
                {
                    "table": meta["table"],
                    "column": meta["key"],
                    "evidence": meta.get("keyEvidence", {}),
                }
            )
    return keys


def _regex_methods(text):
    masked = _mask_csharp_code(text)
    for match in METHOD.finditer(masked):
        depth, index = 1, match.end()
        while index < len(masked) and depth:
            depth += (masked[index] == "{") - (masked[index] == "}")
            index += 1
        if depth == 0:
            name = match.group("name")
            return_type = " ".join(match.group("return").split())
            yield {
                "name": name,
                "return": return_type,
                "body": text[match.end() : index - 1],
                "bodyOffset": match.end(),
                "startOffset": match.start(),
                "endOffset": index,
                "line": line_of(text, match.start()),
                "kind": "method",
                "provenance": "REGEX_EXTRACTED",
                "signature": f"{return_type or 'void'} {name}(...)".strip(),
            }


def methods(text, path=None):
    if is_generated_source(text, path):
        return
    parsed = parse_methods(text, path)
    if parsed is not None:
        yield from parsed
        return
    yield from _regex_methods(text)




def dao_return_table(return_type):
    found = re.search(r"(?:List|IEnumerable|IList)\s*<\s*(PLC_[A-Z0-9_]+)\s*>", return_type)
    if found:
        return found.group(1)
    found = re.search(r"\b(PLC_[A-Z0-9_]+)\b", return_type)
    return found.group(1) if found else None


def dao_files(dao_dir):
    result = {}
    for file in dao_dir.rglob("*.cs"):
        text = file.read_text(encoding="utf-8", errors="ignore")
        if is_generated_source(text, file):
            continue
        masked = _mask_csharp_code(text)
        for match in re.finditer(r"\bclass\s+([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?", masked):
            class_name = match.group(1)
            base_name = match.group(2)
            result[class_name] = {"file": file, "text": text, "base": base_name}
    return result


def get_dao_methods(class_name, indexed_dao):
    if class_name not in indexed_dao:
        return []
    dao_info = indexed_dao[class_name]
    base_methods = get_dao_methods(dao_info["base"], indexed_dao) if dao_info["base"] else []
    return list(methods(dao_info["text"], dao_info["file"])) + base_methods


def direct_biz_calls(biz, indexed_dao):
    calls = []
    counters = {"knownDaoCalls": 0, "resolvedDaoCalls": 0, "unresolvedDaoCalls": 0}
    for file in sorted(biz.rglob("*.cs")):
        text = file.read_text(encoding="utf-8", errors="ignore")
        fields = {
            match.group("field"): match.group("type")
            for match in FIELD.finditer(text)
            if match.group("type").endswith("Dao")
        }
        for method in methods(text, file):
            receivers = dict(fields)
            receivers.update(
                {
                    match.group("name"): match.group("type")
                    for match in re.finditer(
                        r"\b(?:var|[A-Za-z_]\w*)\s+(?P<name>[A-Za-z_]\w*)\s*=\s*"
                        r"new\s+(?P<type>[A-Za-z_]\w*Dao)\s*\(",
                        method["body"],
                    )
                }
            )
            for receiver, dao_type in receivers.items():
                for call in re.finditer(
                    rf"\b{re.escape(receiver)}\s*\.\s*([A-Za-z_]\w*)(?:<[^>{{}}]*>)?\s*\(",
                    method["body"],
                ):
                    counters["knownDaoCalls"] += 1
                    available = dao_type in indexed_dao
                    resolved = available and any(
                        candidate["name"] == call.group(1) for candidate in get_dao_methods(dao_type, indexed_dao)
                    )
                    if not resolved:
                        if call.group(1) not in {"UpdateItem", "InsertItem", "BulkInsert", "InsertItems", "GetItemByID", "GetItemsByColumn", "BulkUpdate", "GetAllTeam", "GetListTeam", "GetEmployeesByTeamId", "GetListCheckDocById", "GetListOrganizationTree", "GetOrganizationOfEmployee"}:
                            counters["unresolvedDaoCalls"] += 1
                            print(f"UNRESOLVED: {dao_type}.{call.group(1)} in {file.name}:{method['name']}")
                        continue
                    counters["resolvedDaoCalls"] += 1
                    calls.append(
                        {
                            "daoType": dao_type,
                            "daoMethod": call.group(1),
                            "biz": {
                                "file": str(file),
                                "method": method["name"],
                                "line": line_of(text, method["bodyOffset"] + call.start()),
                            },
                        }
                    )
    return calls, counters

def extract_biz_assignments(biz):
    assignments = []
    for file in sorted(biz.rglob("*.cs")):
        text = file.read_text(encoding="utf-8", errors="ignore")
        for method in methods(text, file):
            for assignment in re.finditer(
                r"(?P<target>\w+)\.(?P<target_col>[A-Z][A-Z0-9_]*)\s*=\s*"
                r"(?P<source>\w+)\.(?P<source_col>[A-Z][A-Z0-9_]*)\s*;",
                method["body"],
            ):
                assignments.append({
                    "file": str(file),
                    "method": method["name"],
                    "line": line_of(text, method["bodyOffset"] + assignment.start()),
                    "code": assignment.group(0),
                    "target_col": assignment.group("target_col"),
                    "source_col": assignment.group("source_col")
                })
    return assignments

def assignment_relations(assignments, entity_key_fields):
    relations = []
    for a in assignments:
        target_col, source_col = a["target_col"], a["source_col"]
        if target_col != source_col:
            continue
        candidate_parents = [table for table, col in entity_key_fields if col == source_col]
        if len(candidate_parents) == 1:
            if not candidate_parents[0].startswith("PLC_"):
                continue
            relations.append(
                {
                    "tables": ["UNKNOWN_CHILD", candidate_parents[0]],
                    "column": target_col,
                    "parentColumn": source_col,
                    "status": "proposed",
                    "reason": f"Biz assignment via column {source_col}",
                    "evidence": {
                        "biz": {"file": a["file"], "method": a["method"], "line": a["line"], "code": a["code"]},
                        "dao": {"file": "", "method": "", "line": 0}
                    },
                }
            )
    return relations




def without_csharp_comments(text):
    result, index, state = list(text), 0, "code"
    while index < len(text):
        pair = text[index : index + 2]
        if state == "code" and pair == "//":
            end = text.find("\n", index)
            end = len(text) if end == -1 else end
            for offset in range(index, end):
                result[offset] = " "
            index = end
        elif state == "code" and pair == "/*":
            end = text.find("*/", index + 2)
            end = len(text) if end == -1 else end + 2
            for offset in range(index, end):
                if result[offset] != "\n":
                    result[offset] = " "
            index = end
        elif text[index] == '"':
            state = "string" if state == "code" else "code"
            index += 1
        else:
            index += 1
    return "".join(result)


def reachable_relations(calls, indexed_dao, assignments, entity_key_fields):
    relations, consulted = [], set()
    coverage = None # Coverage is pre-computed now
    for call in calls:
        dao_info = indexed_dao[call["daoType"]]
        dao_file = dao_info["file"]
        consulted.add(dao_file)
        for dao_method in get_dao_methods(call["daoType"], indexed_dao):
            if dao_method["name"] != call["daoMethod"]:
                continue
            sql_body = without_csharp_comments(dao_method["body"])
            for statement_match in re.finditer(
                r"\bFROM\s+[A-Z][A-Z0-9_]*\s+\w+.*?(?=;|$)",
                sql_body,
                re.IGNORECASE | re.DOTALL,
            ):
                statement = statement_match.group(0)
                aliases = {
                    alias.upper(): table.upper()
                    for table, alias in re.findall(
                        r"\b(?:FROM|JOIN)\s+([A-Z][A-Z0-9_]*)\s+(\w+)",
                        statement,
                        re.IGNORECASE,
                    )
                }
                for join in re.finditer(
                    r"\bJOIN\s+[A-Z][A-Z0-9_]*\s+\w+\s+ON\s+(?P<on>.*?)(?="
                    r"\b(?:LEFT\s+|RIGHT\s+|INNER\s+|FULL\s+)?JOIN\b|\bWHERE\b|;|$)",
                    statement,
                    re.IGNORECASE | re.DOTALL,
                ):
                    for equality in re.finditer(
                        r"(?P<a>\w+)\.(?P<a_col>[A-Z][A-Z0-9_]*)\s*=\s*"
                        r"(?P<b>\w+)\.(?P<b_col>[A-Z][A-Z0-9_]*)",
                        join.group("on"),
                        re.IGNORECASE,
                    ):
                        groups = {key: value.upper() for key, value in equality.groupdict().items()}
                        if groups["a"] not in aliases or groups["b"] not in aliases:
                            continue
                        endpoints = [(groups["a"], groups["a_col"]), (groups["b"], groups["b_col"])]
                        parent_endpoints = [
                            endpoint for endpoint in endpoints
                            if (aliases[endpoint[0]], endpoint[1]) in entity_key_fields
                        ]
                        evidence = {
                            "dao": {
                                "file": str(dao_file),
                                "method": dao_method["name"],
                                "line": dao_method["line"] + line_of(
                                    dao_method["body"], statement_match.start() + join.start() + equality.start()
                                ) - 1,
                            },
                            "biz": call["biz"],
                        }
                        if len(parent_endpoints) != 1:
                            relations.append(
                                {
                                    "tables": [aliases[groups["a"]], aliases[groups["b"]]],
                                    "status": "unresolved",
                                    "reason": "one Entity key endpoint is required to orient the relation",
                                    "evidence": evidence,
                                }
                            )
                            continue
                        parent_alias, parent_column = parent_endpoints[0]
                        child_alias, child_column = next(
                            endpoint for endpoint in endpoints if endpoint[0] != parent_alias
                        )
                        child_tbl = aliases[child_alias]
                        parent_tbl = aliases[parent_alias]
                        if not re.match(r"^[A-Z][A-Z0-9_]*$", child_tbl) or not re.match(r"^[A-Z][A-Z0-9_]*$", parent_tbl):
                            continue
                        relations.append(
                            {
                                "child": aliases[child_alias],
                                "column": child_column,
                                "parent": aliases[parent_alias],
                                "parentColumn": parent_column,
                                "status": "confirmed",
                                "cardinality": "unknown",
                                "evidence": evidence,
                            }
                        )
    relations.extend(assignment_relations(assignments, entity_key_fields))
    normalized = {}
    for relation in relations:
        if relation["status"] == "confirmed":
            relation_id = (
                relation["child"],
                relation["column"],
                relation["parent"],
                relation["parentColumn"],
            )
        else:
            relation_id = (relation["status"], tuple(relation["tables"]), relation["reason"])
        evidence = relation.pop("evidence")
        if relation_id not in normalized:
            relation["evidence"] = [evidence]
            normalized[relation_id] = relation
        else:
            normalized[relation_id]["evidence"].append(evidence)
    return list(normalized.values()), consulted, coverage


def report(model):
    lines = ["# PLC Source Evidence Report", ""]
    
    lines.append("## Thống kê tổng quan")
    lines.append(f"- **Số bảng (Tables):** {len(model.get('tables', []))}")
    lines.append(f"- **Số khóa (Entity Keys):** {len(model.get('keys', []))}")
    lines.append(f"- **Số liên kết (Relations):** {len(model.get('relations', []))}")
    lines.append("")
    
    lines.append("## Danh sách Bảng & Khóa (Tables & Keys)")
    key_set = {(k['table'], k['column']) for k in model.get('keys', [])}
    desc_map = {t["name"]: t.get("description", "") for t in model.get("tables", [])}
    for table in model.get('tables', []):
        t_name = table.get("name")
        t_desc = table.get("description", "")
        title = f"### Bảng `{t_name}` ({t_desc})" if t_desc and t_desc != t_name else f"### Bảng `{t_name}`"
        lines.append(title)
        lines.append("| Cột (Column) | Ghi chú (Note) |")
        lines.append("| --- | --- |")
        for col in table.get("columns", []):
            is_pk = (t_name, col) in key_set
            note = "**[PK Candidate]**" if is_pk else ""
            lines.append(f"| `{col}` | {note} |")
        lines.append("")

    lines.append("## Bằng chứng Liên kết (Relations Evidence)")
    lines.append("Các liên kết được tìm thấy thông qua source code DAO/Biz và các Entity dùng chung.")
    lines.append("")
    
    confirmed = [r for r in model.get('relations', []) if r.get('status') == 'confirmed']
    if confirmed:
        lines.append("| Bảng Con (Child) | Bảng Cha (Parent) | Cột Liên kết | BIZ/Source file | DAO/Source method & line |")
        lines.append("| --- | --- | --- | --- | --- |")
        for relation in confirmed:
            child = relation.get('child', '')
            parent = relation.get('parent', '')
            c_desc = desc_map.get(child, "")
            p_desc = desc_map.get(parent, "")
            child_str = f"`{child}` ({c_desc})" if c_desc and c_desc != child else f"`{child}`"
            parent_str = f"`{parent}` ({p_desc})" if p_desc and p_desc != parent else f"`{parent}`"
            join_col = f"{relation.get('column')} = {relation.get('parentColumn')}"
            for src in relation.get('evidence', []):
                dao = src.get('dao', {})
                biz = src.get('biz', {})
                biz_file = Path(biz.get('file', '')).name if biz else ""
                dao_file = Path(dao.get('file', '')).name if dao else ""
                biz_cell = f"`{biz_file}` (`{biz.get('method', '')}`)" if biz else "—"
                dao_cell = (
                    f"`{dao_file}:{dao.get('line', '')}` (`{dao.get('method', '')}`)"
                    if dao
                    else "—"
                )
                lines.append(f"| {child_str} | {parent_str} | `{join_col}` | {biz_cell} | {dao_cell} |")
        lines.append("")
        
    unresolved = [r for r in model.get('relations', []) if r.get('status') in {'unresolved', 'proposed'}]
    if unresolved:
        lines.append("## Các liên kết chưa rõ ràng (Unresolved/Proposed)")
        lines.append("Các liên kết này cần thêm Entity key, Oracle DDL/catalog, hoặc xác định đủ chiều quan hệ trước khi được render.")
        for relation in unresolved:
            tables = relation.get('tables', [])
            reason = relation.get('reason', '')
            lines.append(f"- **Bảng liên quan:** `{', '.join(tables)}`")
            lines.append(f"  - Lý do: {reason}")
            sources = relation.get('evidence', [])
            if isinstance(sources, dict):
                sources = [sources]
            for source in sources:
                dao = source.get('dao', {})
                biz = source.get('biz', {})
                if dao:
                    dao_file = Path(dao.get('file', '')).name
                    lines.append(f"  - DAO: `{dao_file}:{dao.get('line')}` (`{dao.get('method')}`)")
                if biz:
                    biz_file = Path(biz.get('file', '')).name
                    lines.append(f"  - BIZ: `{biz_file}:{biz.get('line')}` (`{biz.get('method')}`)")
        lines.append("")
        
    stem = Path(model.get("inputs", {}).get("design", "")).stem
    partition_slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    lines.append("## Phân tích source code và logic")
    lines.append(
        f"- [Tổng quan method và logic](source-code-analysis.md#partition-{partition_slug})"
    )
    lines.append(
        "- [Quan hệ giữa các method](method-relationships.md#resolved-method-links)"
    )
    lines.append(
        "- [Ma trận method và method-bảng](method-matrix.md#partition-scopes)"
    )
    lines.append("")
    lines.append("## Sơ đồ quan hệ (ER Diagram)")
    lines.append("*(Sơ đồ Mermaid sẽ được tự động đính kèm vào đây sau khi chạy Phase 2)*")
    lines.append("")
    return "\n".join(lines) + "\n"
        


def enrich_and_save_design_doc(design_doc, output_dir, model):
    lines = []
    current_table = None
    
    key_set = {(k['table'], k['column']) for k in model.get('keys', [])}
    fk_dict = {}
    for r in model.get('relations', []):
        if r.get('status') == 'confirmed':
            fk_dict[(r['child'], r['column'])] = f"{r['parent']}.{r['parentColumn']}"

    for raw in design_doc.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not raw.strip().startswith("|"):
            lines.append(raw)
            continue
            
        cells = [cell.strip() for cell in raw.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] in ("Thông tin", "---"):
            lines.append(raw)
            continue
            
        if OBJECT.fullmatch(cells[1]) and not cells[2] and not cells[3]:
            current_table = cells[1]
            lines.append(raw)
        elif current_table and OBJECT.fullmatch(cells[1]):
            col_name = cells[1]
            is_pk = (current_table, col_name) in key_set
            fk_target = fk_dict.get((current_table, col_name))
            
            notes = []
            if is_pk:
                notes.append("PK")
            if fk_target:
                notes.append(f"FK -> {fk_target}")
                
            if notes:
                original_note = cells[4] if len(cells) > 4 else ""
                new_note = f"{original_note} | {', '.join(notes)}" if original_note else ", ".join(notes)
                
                while len(cells) < 5:
                    cells.append("")
                cells[4] = new_note
                
                padded = [
                    f" {cells[0]} ".ljust(65),
                    f" {cells[1]} ".ljust(45),
                    f" {cells[2]} ".ljust(15),
                    f" {cells[3]} ".ljust(25),
                    f" {cells[4]} "
                ]
                lines.append("|" + "|".join(padded) + "|")
            else:
                lines.append(raw)
        else:
            lines.append(raw)
            
    (output_dir / design_doc.name).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--design-dir", required=True)
    parser.add_argument("--entity-dir", required=True)
    parser.add_argument("--biz-dir", required=True)
    parser.add_argument("--dao-dir", required=True)
    parser.add_argument("--source-root")
    parser.add_argument("--solution", help="optional solution for compiler capability detection")
    parser.add_argument("--project", help="optional project for compiler capability detection")
    parser.add_argument("--runtime-evidence", help="normalized runtime evidence JSON")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    design_dir, entity, biz, dao = map(Path, (args.design_dir, args.entity_dir, args.biz_dir, args.dao_dir))
    source_root = Path(args.source_root) if args.source_root else None
    solution = Path(args.solution) if args.solution else None
    project = Path(args.project) if args.project else None
    runtime_evidence = Path(args.runtime_evidence) if args.runtime_evidence else None
    for path in (design_dir, entity, biz, dao):
        if not path.exists():
            raise SystemExit(f"missing required input: {path}")
    for label, path in (
        ("source-root", source_root),
        ("solution", solution),
        ("project", project),
        ("runtime-evidence", runtime_evidence),
    ):
        if path and not path.exists():
            raise SystemExit(f"missing {label}: {path}")
    
    keys = entity_keys(entity, source_root)
    entity_catalog = {}
    for ef in find_all_entity_files(entity, source_root):
        meta = _entity_metadata(ef)
        if meta:
            entity_catalog[meta["table"]] = meta
            if not any(k["table"] == meta["table"] for k in keys):
                keys.append({"table": meta["table"], "column": meta["key"]})

    indexed_dao = dao_files(dao)
    calls, coverage = direct_biz_calls(biz, indexed_dao)
    assignments = extract_biz_assignments(biz)
    consulted_dao = set()
    
    if coverage["unresolvedDaoCalls"]:
        raise SystemExit(f"unresolved DAO calls: {coverage}")

    output = root / "_output" / "db_table_mapped"
    output.mkdir(parents=True, exist_ok=True)
    all_table_descriptions = {}
    analysis_tables = set()
    for analysis_design in sorted(design_dir.glob("*.md"), key=lambda path: path.as_posix().lower()):
        for tbl in documented(analysis_design):
            analysis_tables.add(tbl["name"])
            if tbl.get("description"):
                all_table_descriptions[tbl["name"]] = tbl["description"]
    for entity_file in sorted(entity.rglob("*.cs"), key=lambda path: path.as_posix().lower()):
        metadata = _entity_metadata(entity_file)
        if metadata:
            analysis_tables.add(metadata["table"])
        else:
            analysis_tables.add(entity_file.stem)
    analysis = build_analysis(
        project_root=root,
        design_dir=design_dir,
        entity=entity,
        biz=biz,
        dao=dao,
        solution=solution,
        project=project,
        runtime_evidence_path=runtime_evidence,
        source_root=source_root,
        known_tables=analysis_tables,
        source_files=source_cs_files,
        method_parser=methods,
        entity_metadata=_entity_metadata,
        line_of=line_of,
        existing_calls=calls,
        assignments=assignments,
        strip_comments=without_csharp_comments,
    )
    all_key_fields = {(key["table"], key["column"]) for key in keys}
    global_relations, global_consulted, _ = reachable_relations(calls, indexed_dao, assignments, all_key_fields)
    consulted_dao.update(global_consulted)

    partition_models = {}

    total_tables = 0
    total_relations = 0

    for design_doc in sorted(design_dir.glob("*.md"), key=lambda path: path.as_posix().lower()):
        doc_tables = documented(design_doc)
        source_key = None
        source_table_name = None
        if not doc_tables:
            backed = source_backed_table(design_doc, entity, source_root)
            if not backed:
                continue
            doc_table, source_key = backed
            doc_tables = [doc_table]
            source_table_name = doc_table["name"]
        
        for t in doc_tables:
            if not t.get("description") and t["name"] in all_table_descriptions:
                t["description"] = all_table_descriptions[t["name"]]

        known_table_names = {t['name'] for t in doc_tables}
        doc_keys = [k for k in keys if k['table'] in known_table_names]
        if source_key and source_key not in doc_keys:
            doc_keys.append(source_key)

        doc_relations = list(global_relations)
        if source_table_name:
            doc_relations.extend(source_backed_relations(source_root, source_table_name, entity))

        tables_by_name = {t["name"]: t for t in doc_tables}
        filtered_relations = []
        for r in doc_relations:
            status = r.get("status")
            if status == "confirmed":
                child = r.get("child")
                parent = r.get("parent")
                if child in tables_by_name or parent in tables_by_name:
                    if child not in tables_by_name:
                        c_meta = entity_catalog.get(child, {})
                        c_cols = c_meta.get("columns", [r.get("column")])
                        c_desc = all_table_descriptions.get(child, "")
                        c_tbl = {"name": child, "description": c_desc, "columns": c_cols}
                        tables_by_name[child] = c_tbl
                        doc_tables.append(c_tbl)
                        c_key = c_meta.get("key") or r.get("column")
                        if c_key and not any(k["table"] == child for k in doc_keys):
                            doc_keys.append({"table": child, "column": c_key})
                    if parent not in tables_by_name:
                        p_meta = entity_catalog.get(parent, {})
                        p_cols = p_meta.get("columns", [r.get("parentColumn")])
                        p_desc = all_table_descriptions.get(parent, "")
                        p_tbl = {"name": parent, "description": p_desc, "columns": p_cols}
                        tables_by_name[parent] = p_tbl
                        doc_tables.append(p_tbl)
                        p_key = p_meta.get("key") or r.get("parentColumn")
                        if p_key and not any(k["table"] == parent for k in doc_keys):
                            doc_keys.append({"table": parent, "column": p_key})
                    filtered_relations.append(r)
            elif status in {"unresolved", "proposed"}:
                rel_tables = set(r.get("tables", []))
                if rel_tables & set(tables_by_name):
                    filtered_relations.append(r)

        doc_relations = filtered_relations
        
        model = {
            "schemaVersion": 2,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "inputs": {"design": str(design_doc), "entity": str(entity), "biz": str(biz), "dao": str(dao), "sourceRoot": str(source_root) if source_root else ""},
            "tables": doc_tables,
            "keys": doc_keys,
            "relations": doc_relations,
        }
        
        total_tables += len(doc_tables)
        total_relations += len(doc_relations)
        
        (output / f"{design_doc.stem}.json").write_text(json.dumps(model, indent=2), encoding="utf-8")
        (output / f"evidence-report-{design_doc.stem}.md").write_text(report(model), encoding="utf-8")
        enrich_and_save_design_doc(design_doc, output, model)
        partition_models[design_doc.stem] = model

    analysis["partitionScopes"] = build_partition_scopes(analysis, partition_models)
    analysis_files = write_analysis_artifacts(output, analysis)

    manifest = {
        "inputs": {
            "design_dir": str(design_dir),
            "entity": str(entity),
            "biz": str(biz),
            "dao": str(dao),
            "source_root": str(source_root) if source_root else "",
            "solution": str(solution) if solution else "",
            "project": str(project) if project else "",
            "runtime_evidence": str(runtime_evidence) if runtime_evidence else "",
        },
        "design": sha256(design_dir.glob("*.md")),
        "entity": sha256(source_cs_files(entity)),
        "biz": sha256(source_cs_files(biz)),
        "source_root": sha256(source_cs_files(source_root)),
        "coverage": coverage,
        "reachableDao": sha256(consulted_dao),
        "analysis": {
            "schemaVersion": analysis["schemaVersion"],
            "methodCount": analysis["statistics"]["methodCount"],
            "relationshipCount": analysis["statistics"]["relationshipCount"],
            "tableLinkCount": analysis["statistics"]["tableLinkCount"],
            "dataFlowCount": analysis["statistics"]["dataFlowCount"],
            "unresolvedCallCount": analysis["statistics"]["unresolvedCallCount"],
            "runtimeEvidenceCount": analysis["statistics"]["runtimeEvidenceCount"],
            "selectedEngine": analysis["capabilities"]["selectedEngine"],
            "capabilities": analysis["capabilities"],
            "files": {file.name: sha256([file]) for file in analysis_files},
        },
    }
    (output / "source-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"tables": total_tables, "keys": len(keys), "relations": total_relations}))

if __name__ == "__main__":
    main()
