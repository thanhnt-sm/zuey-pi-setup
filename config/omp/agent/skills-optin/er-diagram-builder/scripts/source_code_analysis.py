"""Deterministic, evidence-backed C# source analysis for ER Diagram Builder Phase 1.

Tree-sitter syntax extraction is optional; the conservative regex parser remains the
fallback.  This module emits navigation evidence and uncertainty, never compiler or
runtime completeness, and never promotes method links into database constraints.
"""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from csharp_syntax import analyzer_capabilities, load_runtime_evidence

ANALYSIS_SCHEMA_VERSION = 1
CLASS_DECLARATION = re.compile(
    r"\b(?:class|struct|record)\s+(?P<name>[A-Za-z_]\w*)"
    r"(?P<inherit>[^{};]*)\{"
)
FIELD_DECLARATION = re.compile(
    r"\b(?P<type>[A-Za-z_]\w*(?:\s*<[^;={}()]+>)?(?:\[\])?)\s+"
    r"(?P<field>_?[A-Za-z_]\w*)\s*(?:=|;)"
)
LOCAL_DECLARATION = re.compile(
    r"\b(?P<type>[A-Za-z_]\w*(?:\s*<[^;={}()]+>)?(?:\[\])?)\s+"
    r"(?P<variable>[A-Za-z_]\w*)\s*=\s*"
)
VAR_NEW_DECLARATION = re.compile(
    r"\bvar\s+(?P<variable>[A-Za-z_]\w*)\s*=\s*new\s+"
    r"(?P<type>[A-Za-z_]\w*(?:\s*<[^;={}()]+>)?)\s*\("
)
CALL = re.compile(
    r"(?<![\w])(?:(?P<receiver>this|base|[A-Za-z_]\w*)\s*\.\s*)?"
    r"(?P<name>[A-Za-z_]\w*)\s*(?:<[^(){};]*>\s*)?\("
)
TABLE_TOKEN = re.compile(r"\b(?:PLC|ADM|CONF|COM|ETL)_[A-Z0-9_]+\b")
SQL_TABLE_REFERENCE = re.compile(
    r"\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+"
    r"(?:[A-Za-z_]\w*\.)?\[?(?P<table>[A-Za-z_]\w*)\]?",
    re.IGNORECASE,
)
ASSIGNMENT = re.compile(r"(?<![=!<>])=(?!=|>)")
CONTROL_CALLS = {
    "if",
    "else",
    "for",
    "foreach",
    "while",
    "switch",
    "catch",
    "lock",
    "using",
    "return",
    "nameof",
    "typeof",
    "sizeof",
    "checked",
    "unchecked",
    "when",
    "where",
    "from",
    "select",
    "join",
    "orderby",
    "group",
    "into",
    "await",
    "default",
    "get",
    "set",
}
REFLECTION_CALLS = {
    "Activator.CreateInstance",
    "CreateInstance",
    "GetConstructor",
    "GetMethod",
    "GetProperty",
    "Invoke",
    "InvokeMember",
    "Type.GetType",
}
LAYER_ORDER = ("Entity", "Biz", "DAO", "Source")


def _mask_csharp_code(text):
    """Mask comments and literals while preserving offsets and newlines."""
    result = list(text)
    state = "code"
    index = 0
    while index < len(text):
        pair = text[index : index + 2]
        if state == "code" and pair == "//":
            result[index] = result[index + 1] = " "
            index += 2
            while index < len(text) and text[index] != "\n":
                result[index] = " "
                index += 1
            continue
        if state == "code" and pair == "/*":
            result[index] = result[index + 1] = " "
            index += 2
            while index < len(text):
                if text[index : index + 2] == "*/":
                    result[index] = result[index + 1] = " "
                    index += 2
                    break
                if text[index] != "\n":
                    result[index] = " "
                index += 1
            continue
        if state == "code" and text[index] == '"':
            state = "verbatim" if index and text[index - 1] == "@" else "string"
            result[index] = " "
            index += 1
            continue
        if state == "code" and text[index] == "'":
            state = "char"
            result[index] = " "
            index += 1
            continue
        if state == "string":
            if text[index] == "\\":
                result[index] = " "
                if index + 1 < len(text) and text[index + 1] != "\n":
                    result[index + 1] = " "
                index += 2
            elif text[index] == '"':
                result[index] = " "
                state = "code"
                index += 1
            else:
                if text[index] != "\n":
                    result[index] = " "
                index += 1
            continue
        if state == "verbatim":
            if text[index : index + 2] == '""':
                result[index] = result[index + 1] = " "
                index += 2
            elif text[index] == '"':
                result[index] = " "
                state = "code"
                index += 1
            else:
                if text[index] != "\n":
                    result[index] = " "
                index += 1
            continue
        if state == "char":
            if text[index] == "\\":
                result[index] = " "
                if index + 1 < len(text) and text[index + 1] != "\n":
                    result[index + 1] = " "
                index += 2
            elif text[index] == "'":
                result[index] = " "
                state = "code"
                index += 1
            else:
                if text[index] != "\n":
                    result[index] = " "
                index += 1
            continue
        index += 1
    return "".join(result)


def _matching_brace(masked, opening):
    depth = 1
    index = opening + 1
    while index < len(masked) and depth:
        if masked[index] == "{":
            depth += 1
        elif masked[index] == "}":
            depth -= 1
        index += 1
    return index if depth == 0 else len(masked)


def _class_contexts(text):
    masked = _mask_csharp_code(text)
    contexts = []
    for match in CLASS_DECLARATION.finditer(masked):
        opening = masked.find("{", match.start(), match.end())
        if opening == -1:
            continue
        inheritance = match.group("inherit") or ""
        base = ""
        if ":" in inheritance:
            base = inheritance.split(":", 1)[1].split(",", 1)[0].strip()
            base = re.split(r"[\s<.]", base, maxsplit=1)[0]
        contexts.append(
            {
                "name": match.group("name"),
                "start": match.start(),
                "end": _matching_brace(masked, opening),
                "base": base,
            }
        )
    return contexts


def _context_for(contexts, offset, fallback):
    matches = [item for item in contexts if item["start"] <= offset < item["end"]]
    if not matches:
        return {"name": fallback, "base": "", "start": 0, "end": 0}
    return max(matches, key=lambda item: item["start"])


def _named_roots(entity, biz, dao, source_root):
    roots = [("Entity", entity), ("Biz", biz), ("DAO", dao)]
    if source_root:
        roots.append(("Source", source_root))
    return tuple((label, Path(root).resolve()) for label, root in roots if root)


def _display_path(path, project_root, named_roots=()):
    path = Path(path)
    for label, root in named_roots:
        try:
            relative = path.resolve().relative_to(Path(root).resolve())
        except ValueError:
            continue
        return f"{label}/{relative.as_posix()}"
    try:
        relative = path.resolve().relative_to(Path(project_root).resolve())
    except ValueError:
        return path.as_posix()
    return relative.as_posix()


def _path_key(path):
    return str(Path(path).resolve()).lower()


def _layer_for(path, direct_layer):
    stem = Path(path).stem.lower()
    if stem.endswith("dao") or "repository" in stem:
        return "DAO"
    if stem.endswith("biz") or "service" in stem:
        return "Biz"
    if direct_layer != "Source":
        return direct_layer
    if stem.endswith("entity") or "model" in stem or "dto" in stem:
        return "Entity"
    return "Source"


def _collect_source_files(entity, biz, dao, source_root, source_files):
    entries = {}
    for root, direct_layer in ((entity, "Entity"), (biz, "Biz"), (dao, "DAO")):
        for file in source_files(root):
            resolved = Path(file).resolve()
            entries.setdefault(_path_key(resolved), (resolved, direct_layer))
    if source_root:
        for file in source_files(source_root):
            resolved = Path(file).resolve()
            entries.setdefault(_path_key(resolved), (resolved, "Source"))
    return sorted(entries.values(), key=lambda item: item[0].as_posix().lower())


def _base_type(type_name):
    return re.split(r"[\s<.,\[\]]", type_name.strip(), maxsplit=1)[0]


def _declared_types(text):
    masked = _mask_csharp_code(text)
    fields = {}
    for match in FIELD_DECLARATION.finditer(masked):
        type_name = _base_type(match.group("type"))
        if type_name.lower() in {"class", "struct", "interface", "enum", "var"}:
            continue
        fields[match.group("field")] = type_name
    return fields


def _local_types(body):
    masked = _mask_csharp_code(body)
    types = {
        match.group("variable"): _base_type(match.group("type"))
        for match in LOCAL_DECLARATION.finditer(masked)
    }
    for match in VAR_NEW_DECLARATION.finditer(masked):
        types[match.group("variable")] = _base_type(match.group("type"))
    return types


def _method_records(
    entity,
    biz,
    dao,
    source_root,
    project_root,
    source_files,
    method_parser,
):
    records = []
    path_roots = _named_roots(entity, biz, dao, source_root)
    for file, direct_layer in _collect_source_files(entity, biz, dao, source_root, source_files):
        text = file.read_text(encoding="utf-8", errors="ignore")
        contexts = _class_contexts(text)
        layer = _layer_for(file, direct_layer)
        if layer == "Source" and any(
            context["base"].lower().endswith("entity")
            or context["base"].lower().endswith("model")
            for context in contexts
        ):
            layer = "Entity"
        display_file = _display_path(file, project_root, path_roots)
        for parsed in method_parser(text, path=file):
            start = parsed.get("startOffset", parsed.get("bodyOffset", 0))
            context = _context_for(contexts, start, file.stem)
            if parsed.get("class"):
                context = {
                    "name": parsed["class"],
                    "base": parsed.get("base", context.get("base", "")),
                }
            name = parsed["name"]
            line = parsed["line"]
            method_id = f"{layer}:{display_file}:{context['name']}.{name}:{line}"
            records.append(
                {
                    "id": method_id,
                    "layer": layer,
                    "class": context["name"],
                    "name": name,
                    "file": display_file,
                    "line": line,
                    "returnType": parsed.get("return", "") or "void",
                    "signature": parsed.get("signature")
                    or f"{parsed.get('return', '') or 'void'} {name}(...)".strip(),
                    "kind": parsed.get("kind", "method"),
                    "provenance": parsed.get("provenance", "REGEX_EXTRACTED"),
                    "parameters": parsed.get("parameters", []),
                    "parameterCount": parsed.get("parameterCount"),
                    "overloadKey": parsed.get("overloadKey", f"{name}/?"),
                    "expressionBodied": bool(parsed.get("expressionBodied", False)),
                    "riskFlags": sorted(set(parsed.get("riskFlags", []))),
                    "sourceSpan": parsed.get("sourceSpan", {}),
                    "logic": {},
                    "_path": file,
                    "_text": text,
                    "_body": parsed.get("body", ""),
                    "_body_offset": parsed.get("bodyOffset", 0),
                    "_base": context.get("base", ""),
                    "_field_types": _declared_types(text),
                    "_invocations": parsed.get("invocations")
                    if "invocations" in parsed
                    else None,
                    "_is_extension": bool(parsed.get("isExtension", False)),
                }
            )
    records.sort(key=lambda item: item["id"].lower())
    return records


def _same_path(value, path):
    try:
        return Path(value).resolve() == Path(path).resolve()
    except OSError:
        return str(value).lower() == str(path).lower()


def _record_evidence(caller, line, symbol, column=None):
    evidence = {"file": caller["file"], "line": line, "symbol": symbol}
    if column is not None:
        evidence["column"] = column
    return evidence


def _receiver_type(caller, receiver, local_types):
    if receiver in (None, ""):
        return ""
    if receiver == "this":
        return caller["class"]
    if receiver == "base":
        return caller["_base"]
    return local_types.get(receiver) or caller["_field_types"].get(receiver) or (
        receiver if receiver in caller.get("_class_names", set()) else ""
    )


def _resolve_method(
    caller,
    receiver,
    name,
    by_class_method,
    class_names,
    local_types,
    argument_count=None,
):
    if receiver in (None, "", "this"):
        candidates = by_class_method.get((caller["class"], name), [])
    elif receiver == "base":
        candidates = by_class_method.get((caller["_base"], name), [])
    else:
        type_name = local_types.get(receiver) or caller["_field_types"].get(receiver)
        type_name = type_name or (receiver if receiver in class_names else "")
        candidates = by_class_method.get((type_name, name), []) if type_name else []
    if len(candidates) == 1:
        return candidates
    if argument_count is None:
        return []
    exact = [
        candidate
        for candidate in candidates
        if candidate.get("parameterCount") == argument_count
    ]
    if len(exact) != 1:
        return []
    if any(
        parameter.get("optional") or parameter.get("params")
        for candidate in candidates
        for parameter in candidate.get("parameters", [])
    ):
        return []
    return exact


def _add_relationship(relationships, caller, callee, line, symbol, column=None, provenance=None):
    key = (caller["id"], callee["id"], "calls")
    edge = relationships.get(key)
    if edge is None:
        edge = {
            "id": f"{caller['id']}->{callee['id']}:calls",
            "caller": caller["id"],
            "callee": callee["id"],
            "kind": "calls",
            "status": "extracted",
            "provenance": provenance or caller.get("provenance", "REGEX_EXTRACTED"),
            "evidence": [],
        }
        relationships[key] = edge
    evidence = _record_evidence(caller, line, symbol, column)
    for item in edge["evidence"]:
        if item["file"] != evidence["file"] or item["line"] != evidence["line"]:
            continue
        existing_column = item.get("column")
        if existing_column is None or column is None or existing_column == column:
            return
    edge["evidence"].append(evidence)


def _resolve_existing_biz_calls(records, existing_calls, relationships):
    by_dao_method = defaultdict(list)
    for record in records:
        by_dao_method[(record["class"], record["name"])].append(record)
    for call in existing_calls:
        biz = call.get("biz", {})
        caller_candidates = [
            record
            for record in records
            if record["layer"] == "Biz"
            and record["name"] == biz.get("method")
            and _same_path(biz.get("file", ""), record["_path"])
        ]
        callee_candidates = by_dao_method.get((call.get("daoType"), call.get("daoMethod"),), [])
        if len(caller_candidates) != 1 or len(callee_candidates) != 1:
            continue
        _add_relationship(
            relationships,
            caller_candidates[0],
            callee_candidates[0],
            int(biz.get("line", caller_candidates[0]["line"])),
            f"{call.get('daoType', '')}.{call.get('daoMethod', '')}()",
            provenance=call.get("provenance") or caller_candidates[0].get("provenance"),
        )


def _call_reason(caller, receiver, name, candidates, local_types, extension_names):
    receiver_type = _receiver_type(caller, receiver, local_types)
    reflection_names = {item.rsplit(".", 1)[-1] for item in REFLECTION_CALLS}
    if name in reflection_names:
        return "reflection"
    if receiver_type == "dynamic":
        return "dynamic"
    if name in extension_names:
        return "extension-method"
    if len(candidates) > 1:
        return "overload"
    if re.fullmatch(r"I[A-Z][A-Za-z0-9_]*", receiver_type or ""):
        return "dependency-injection"
    return "unresolved-receiver"


def _regex_invocations(masked_body):
    for match in CALL.finditer(masked_body):
        prefix = masked_body[max(0, match.start() - 8) : match.start()]
        if re.search(r"\bnew\s*$", prefix):
            continue
        line_start = masked_body.rfind("\n", 0, match.start()) + 1
        yield {
            "name": match.group("name"),
            "receiver": match.group("receiver"),
            "argumentCount": None,
            "lineOffset": masked_body[: match.start()].count("\n"),
            "column": match.start() - line_start + 1,
            "symbol": f"{match.group('receiver') + '.' if match.group('receiver') else ''}{match.group('name')}()",
        }


def _extract_relationships(records, existing_calls):
    by_class_method = defaultdict(list)
    class_names = set()
    extension_names = {
        record["name"] for record in records if record.get("_is_extension")
    }
    for record in records:
        by_class_method[(record["class"], record["name"])].append(record)
        class_names.add(record["class"])
    for record in records:
        record["_class_names"] = class_names

    relationships = {}
    unresolved = []
    _resolve_existing_biz_calls(records, existing_calls, relationships)
    for caller in records:
        masked_body = _mask_csharp_code(caller["_body"])
        local_types = _local_types(caller["_body"])
        invocations = caller.get("_invocations")
        source_invocations = invocations is not None
        if invocations is None:
            invocations = _regex_invocations(masked_body)
        for invocation in invocations:
            name = invocation["name"]
            receiver = invocation.get("receiver")
            if name in CONTROL_CALLS:
                continue
            argument_count = invocation.get("argumentCount")
            candidates = _resolve_method(
                caller,
                receiver,
                name,
                by_class_method,
                class_names,
                local_types,
                argument_count,
            )
            if source_invocations:
                line = int(invocation.get("line", caller["line"]))
                column = int(invocation.get("column", 1))
                symbol = invocation.get("symbol", name)
            else:
                line = caller["line"] + invocation["lineOffset"]
                column = invocation["column"]
                symbol = invocation["symbol"]
            if len(candidates) == 1:
                _add_relationship(
                    relationships,
                    caller,
                    candidates[0],
                    line,
                    symbol,
                    column,
                )
                continue
            reason = _call_reason(
                caller,
                receiver,
                name,
                by_class_method.get((caller["class"], name), [])
                if receiver in (None, "", "this")
                else by_class_method.get(
                    (_receiver_type(caller, receiver, local_types), name), []
                ),
                local_types,
                extension_names,
            )
            known_receiver = bool(
                receiver
                and (
                    receiver in caller["_field_types"]
                    or receiver in local_types
                    or receiver in class_names
                    or receiver in {"this", "base"}
                )
            )
            if known_receiver or reason in {
                "dynamic",
                "reflection",
                "extension-method",
                "overload",
                "dependency-injection",
            }:
                unresolved.append(
                    {
                        "caller": caller["id"],
                        "receiver": receiver or "",
                        "name": name,
                        "file": caller["file"],
                        "line": line,
                        "status": "ambiguous",
                        "provenance": "AMBIGUOUS",
                        "reason": reason,
                        "argumentCount": argument_count,
                    }
                )
    for edge in relationships.values():
        edge["evidence"].sort(key=lambda item: (item["file"].lower(), item["line"], item["symbol"]))
    return relationships, unresolved


def _add_table_link(links, method, table, operation, line):
    key = (method["id"], table, operation)
    link = links.get(key)
    if link is None:
        link = {
            "method": method["id"],
            "table": table,
            "operation": operation,
            "provenance": "REGEX_EXTRACTED",
            "evidence": [],
        }
        links[key] = link
    evidence = {"file": method["file"], "line": line, "symbol": table}
    if evidence not in link["evidence"]:
        link["evidence"].append(evidence)


def _table_candidates(body, known_tables):
    known_lookup = {str(table).upper(): str(table) for table in known_tables}
    candidates = set()
    for match in SQL_TABLE_REFERENCE.finditer(body):
        table = match.group("table").upper()
        if table in known_lookup:
            candidates.add(known_lookup[table])
        elif TABLE_TOKEN.fullmatch(table):
            candidates.add(table)
    return candidates


def _extract_table_links(records, known_tables, line_of, strip_comments):
    links = {}
    for method in records:
        body = strip_comments(method["_body"])
        candidates = sorted(_table_candidates(body, known_tables))
        matched = set()
        patterns = (
            (
                "write",
                r"\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+{table}\b",
            ),
            ("read", r"\bFROM\s+{table}\b"),
            (
                "join",
                r"\b(?:LEFT\s+|RIGHT\s+|FULL\s+|INNER\s+|CROSS\s+)?JOIN\s+{table}\b",
            ),
        )
        for operation, template in patterns:
            for table in candidates:
                expression = re.compile(template.format(table=re.escape(table)), re.IGNORECASE)
                for match in expression.finditer(body):
                    line = method["line"] + line_of(body, match.start()) - 1
                    _add_table_link(links, method, table, operation, line)
                    matched.add((table, operation))
        for table in candidates:
            if any(item[0] == table for item in matched):
                continue
            for match in re.finditer(rf"\b{re.escape(table)}\b", body, re.IGNORECASE):
                line = method["line"] + line_of(body, match.start()) - 1
                _add_table_link(links, method, table, "reference", line)
                break
    for link in links.values():
        link["evidence"].sort(key=lambda item: (item["file"].lower(), item["line"]))
    return links


def _logic_facts(method, table_links):
    body = _mask_csharp_code(method["_body"])
    method_links = [link for link in table_links if link["method"] == method["id"]]
    reads = sorted({link["table"] for link in method_links if link["operation"] in {"read", "join"}})
    writes = sorted({link["table"] for link in method_links if link["operation"] == "write"})
    references = sorted({link["table"] for link in method_links})
    branches = len(re.findall(r"\bif\b|\belse\s+if\b|\bswitch\b|\bcase\b", body))
    loops = len(re.findall(r"\bfor\b|\bforeach\b|\bwhile\b", body))
    try_catch = len(re.findall(r"\btry\b|\bcatch\b", body))
    facts = {
        "branches": branches,
        "loops": loops,
        "returns": len(re.findall(r"\breturn\b", body)),
        "tryCatch": try_catch,
        "awaits": len(re.findall(r"\bawait\b", body)),
        "assignments": len(ASSIGNMENT.findall(body)),
        "nullChecks": len(re.findall(r"\bnull\b", body)),
        "throws": len(re.findall(r"\bthrow\b", body)),
        "sqlReads": reads,
        "sqlWrites": writes,
        "tableReferences": references,
    }
    operations = []
    if branches:
        operations.append("branch")
    if loops:
        operations.append("loop")
    if facts["assignments"]:
        operations.append("assignment")
    if facts["returns"]:
        operations.append("return")
    if facts["tryCatch"]:
        operations.append("exception-handling")
    if facts["awaits"]:
        operations.append("async")
    if reads:
        operations.append("sql-read")
    if writes:
        operations.append("sql-write")
    facts["operations"] = operations
    return facts


def _entity_mappings(entity, project_root, entity_metadata, path_roots=()):
    mappings = []
    for file in sorted(Path(entity).rglob("*.cs"), key=lambda path: path.as_posix().lower()):
        metadata = entity_metadata(file)
        if not metadata:
            continue
        mapping = {
            "class": metadata["class"],
            "table": metadata["table"],
            "key": metadata["key"],
            "columns": metadata.get("columns", []),
            "evidence": dict(metadata.get("mappingEvidence", {})),
        }
        if mapping["evidence"].get("file"):
            mapping["evidence"]["file"] = _display_path(
                mapping["evidence"]["file"], project_root, path_roots
            )
        mappings.append(mapping)
    return sorted(mappings, key=lambda item: (item["table"], item["class"]))
def _assignment_flows(records, assignments, project_root, path_roots=()):
    flows = {}
    for assignment in assignments:
        candidates = [
            record
            for record in records
            if record["layer"] == "Biz"
            and record["name"] == assignment.get("method")
            and _same_path(assignment.get("file", ""), record["_path"])
        ]
        if len(candidates) != 1:
            continue
        method = candidates[0]
        target_column = assignment.get("target_col", "")
        source_column = assignment.get("source_col", "")
        if not target_column or not source_column:
            continue
        key = (method["id"], target_column, source_column)
        flow = flows.setdefault(
            key,
            {
                "method": method["id"],
                "kind": "assignment",
                "targetColumn": target_column,
                "sourceColumn": source_column,
                "provenance": "EXTRACTED",
                "evidence": [],
            },
        )
        evidence = {
            "file": _display_path(assignment["file"], project_root, path_roots),
            "line": assignment["line"],
        }
        if evidence not in flow["evidence"]:
            flow["evidence"].append(evidence)
    for flow in flows.values():
        flow["evidence"].sort(key=lambda item: (item["file"].lower(), item["line"]))
    return sorted(flows.values(), key=lambda item: (item["method"], item["targetColumn"], item["sourceColumn"]))






def _matrix_payload(methods, relationships, table_links, data_flows):
    method_index = {method["id"]: method for method in methods}
    layer_counts = Counter()
    method_rows = []
    for edge in relationships:
        caller = method_index[edge["caller"]]
        callee = method_index[edge["callee"]]
        layer_counts[(caller["layer"], callee["layer"])] += 1
        method_rows.append(
            {
                "caller": edge["caller"],
                "callee": edge["callee"],
                "kind": edge["kind"],
                "uniqueEdgeCount": 1,
                "evidenceCount": len(edge["evidence"]),
            }
        )
    table_rows = []
    grouped = defaultdict(list)
    for link in table_links:
        grouped[(link["method"], link["table"])].append(link)
    for (method_id, table), links in sorted(grouped.items()):
        table_rows.append(
            {
                "method": method_id,
                "table": table,
                "operations": sorted(item["operation"] for item in links),
                "evidenceCount": sum(len(item["evidence"]) for item in links),
            }
        )
    field_rows = []
    grouped_fields = defaultdict(list)
    for flow in data_flows:
        grouped_fields[
            (flow["method"], flow["targetColumn"], flow["sourceColumn"])
        ].append(flow)
    for (method_id, target_column, source_column), flows in sorted(grouped_fields.items()):
        field_rows.append(
            {
                "method": method_id,
                "targetColumn": target_column,
                "sourceColumn": source_column,
                "evidenceCount": sum(len(flow["evidence"]) for flow in flows),
            }
        )

    layer_rows = [
        {
            "callerLayer": caller,
            "calleeLayer": callee,
            "uniqueEdgeCount": layer_counts[(caller, callee)],
        }
        for caller in LAYER_ORDER
        for callee in LAYER_ORDER
        if layer_counts[(caller, callee)]
    ]
    return {
        "layer": layer_rows,
        "method": sorted(method_rows, key=lambda item: (item["caller"], item["callee"])),
        "methodTable": table_rows,
        "field": field_rows,
    }


def _empty_runtime_evidence():
    return {"schemaVersion": 1, "sourceHash": "", "events": [], "unmatched": []}


def build_analysis(
    *,
    project_root,
    design_dir,
    entity,
    biz,
    dao,
    source_root,
    known_tables,
    source_files,
    method_parser,
    entity_metadata,
    line_of,
    existing_calls,
    assignments,
    strip_comments,
    solution=None,
    project=None,
    runtime_evidence_path=None,
):
    path_roots = _named_roots(entity, biz, dao, source_root)
    records = _method_records(
        entity,
        biz,
        dao,
        source_root,
        project_root,
        source_files,
        method_parser,
    )
    relationship_map, unresolved = _extract_relationships(records, existing_calls)
    table_link_map = _extract_table_links(records, known_tables, line_of, strip_comments)
    data_flows = _assignment_flows(records, assignments, project_root, path_roots)
    relationships = sorted(
        relationship_map.values(),
        key=lambda edge: (edge["caller"], edge["callee"], edge["kind"]),
    )
    table_links = sorted(
        table_link_map.values(),
        key=lambda link: (link["method"], link["table"], link["operation"]),
    )
    method_ids = {record["id"] for record in records}
    runtime_evidence = (
        load_runtime_evidence(runtime_evidence_path, method_ids)
        if runtime_evidence_path
        else _empty_runtime_evidence()
    )
    capabilities = analyzer_capabilities(solution, project, runtime_evidence_path)
    called_by = defaultdict(list)
    calls = defaultdict(list)
    for edge in relationships:
        calls[edge["caller"]].append(edge["callee"])
        called_by[edge["callee"]].append(edge["caller"])
    methods = []
    for record in records:
        public = {
            key: value
            for key, value in record.items()
            if not key.startswith("_")
        }
        public["logic"] = _logic_facts(record, table_links)
        public["calledMethods"] = sorted(set(calls[record["id"]]))
        public["calledBy"] = sorted(set(called_by[record["id"]]))
        methods.append(public)
    by_layer = Counter(method["layer"] for method in methods)
    by_provenance = Counter(method["provenance"] for method in methods)
    unresolved_reasons = Counter(item.get("reason", "unresolved-receiver") for item in unresolved)
    edge_kinds = Counter(edge["kind"] for edge in relationships)
    analysis = {
        "schemaVersion": ANALYSIS_SCHEMA_VERSION,
        "inputs": {
            "designDir": str(design_dir),
            "projectRoot": str(project_root),
            "entity": str(entity),
            "biz": str(biz),
            "dao": str(dao),
            "sourceRoot": str(source_root) if source_root else "",
            "solution": str(solution) if solution else "",
            "project": str(project) if project else "",
            "runtimeEvidence": str(runtime_evidence_path) if runtime_evidence_path else "",
        },
        "capabilities": capabilities,
        "methods": methods,
        "relationships": relationships,
        "runtimeEvidence": runtime_evidence,
        "tableLinks": table_links,
        "dataFlows": data_flows,
        "entityMappings": _entity_mappings(entity, project_root, entity_metadata, path_roots),
        "unresolvedCalls": sorted(
            unresolved,
            key=lambda item: (item["caller"], item["file"], item["line"], item["name"]),
        ),
        "statistics": {
            "methodCount": len(methods),
            "relationshipCount": len(relationships),
            "tableLinkCount": len(table_links),
            "dataFlowCount": len(data_flows),
            "unresolvedCallCount": len(unresolved),
            "runtimeEvidenceCount": len(runtime_evidence["events"]),
            "runtimeUnmatchedCount": len(runtime_evidence["unmatched"]),
            "methodsByLayer": {layer: by_layer[layer] for layer in LAYER_ORDER if by_layer[layer]},
            "methodsByProvenance": dict(sorted(by_provenance.items())),
            "unresolvedCallsByReason": dict(sorted(unresolved_reasons.items())),
            "relationshipsByKind": dict(sorted(edge_kinds.items())),
        },
        "matrices": _matrix_payload(methods, relationships, table_links, data_flows),
        "partitionScopes": {},
    }
    return analysis


def _anchor(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def method_anchor(method_id):
    return f"method-{_anchor(method_id)}"


def partition_anchor(stem):
    return f"partition-{_anchor(stem)}"


def build_partition_scopes(analysis, partition_models):
    method_index = {method["id"]: method for method in analysis["methods"]}
    links_by_table = defaultdict(set)
    for link in analysis["tableLinks"]:
        links_by_table[link["table"]].add(link["method"])
    scopes = {}
    for stem, model in sorted(partition_models.items()):
        tables = sorted({table["name"] for table in model.get("tables", [])})
        selected = set().union(*(links_by_table[table] for table in tables)) if tables else set()
        changed = True
        while changed:
            changed = False
            for edge in analysis["relationships"]:
                if edge["caller"] in selected or edge["callee"] in selected:
                    before = len(selected)
                    selected.update((edge["caller"], edge["callee"]))
                    changed = changed or len(selected) != before
        relationship_ids = [
            edge["id"]
            for edge in analysis["relationships"]
            if edge["caller"] in selected or edge["callee"] in selected
        ]
        scopes[stem] = {
            "anchor": partition_anchor(stem),
            "tables": tables,
            "methodIds": sorted(method_id for method_id in selected if method_id in method_index),
            "relationshipIds": sorted(relationship_ids),
        }
    return scopes


def _md(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def _method_label(method_id, method_index):
    method = method_index.get(method_id)
    if not method:
        return method_id
    return f"{method['class']}.{method['name']}"


def _logic_summary(logic):
    return "; ".join(
        (
            f"branches={logic['branches']}",
            f"loops={logic['loops']}",
            f"returns={logic['returns']}",
            f"try/catch={logic['tryCatch']}",
            f"await={logic['awaits']}",
            f"assignments={logic['assignments']}",
            f"tables={','.join(logic['tableReferences']) or '-'}",
        )
    )


def render_source_analysis(analysis):
    methods = analysis["methods"]
    method_index = {method["id"]: method for method in methods}
    links_by_method = defaultdict(list)
    for link in analysis["tableLinks"]:
        links_by_method[link["method"]].append(link)
    flows_by_method = defaultdict(list)
    for flow in analysis["dataFlows"]:
        flows_by_method[flow["method"]].append(flow)
    capabilities = analysis.get("capabilities", {})
    compiler = capabilities.get("compiler", {})
    runtime = capabilities.get("runtime", {})
    statistics = analysis["statistics"]
    compiler_state = (
        "assemblies-detected; overlay-not-selected"
        if compiler.get("available")
        else "unavailable"
    )
    lines = [
        "# Source Code Analysis (Phase 1)",
        "",
        "> Static, evidence-backed navigation aid. `EXTRACTED` means the source pattern resolved unambiguously; `AMBIGUOUS` remains review work. This report does not claim Oracle constraints.",
        "",
        "## Review gate",
        "",
        "- Review method links, table links, and uncertainty before approving the relational model.",
        "- Method/table links are source navigation evidence, not PK/FK proof.",
        "- Tree-sitter, when available, supplies syntax structure only; regex remains the fallback.",
        "- Roslyn semantic binding is opt-in and is not claimed unless a validated compiler overlay is supplied.",
        "- Runtime observations are sampled evidence, not a complete call graph.",
        (
            "- Overloads, DI, dynamic/reflection, extension, generated, expression-bodied, and constructor patterns "
            "remain explicitly classified rather than guessed."
        ),
        "- Full method bodies and raw SQL are intentionally omitted; use the recorded file and line to inspect source safely.",
        "",
        "## Capabilities",
        "",
        f"- Selected parser: **{_md(capabilities.get('selectedEngine', 'unknown'))}**",
        (
            f"- AST parser: **{_md(capabilities.get('ast', {}).get('engine', 'unknown'))}** "
            f"({_md(capabilities.get('ast', {}).get('reason', ''))})"
        ),
        (
            f"- Roslyn semantic overlay: **{compiler_state}** "
            f"({_md(compiler.get('reason', 'not requested'))})"
        ),
        (
            f"- Runtime evidence: **{'selected' if runtime.get('selected') else 'not selected'}** "
            f"({_md(runtime.get('reason', ''))})"
        ),
        "",
        "## Statistics",
        "",
        f"- Methods: **{statistics['methodCount']}**",
        f"- Resolved method relationships: **{statistics['relationshipCount']}**",
        f"- Method/table links: **{statistics['tableLinkCount']}**",
        f"- Ambiguous receiver calls: **{statistics['unresolvedCallCount']}**",
        f"- Field data-flow records: **{statistics['dataFlowCount']}**",
        f"- Runtime-observed method events: **{statistics.get('runtimeEvidenceCount', 0)}**",
        "",
        "| Layer | Method count |",
        "| --- | ---: |",
    ]
    for layer in LAYER_ORDER:
        count = analysis["statistics"]["methodsByLayer"].get(layer, 0)
        if count:
            lines.append(f"| `{layer}` | {count} |")
    lines.extend(("", "## Method inventory", "", "| Method | Layer | Engine | Kind | Source | Return | Logic facts | Table links |", "| --- | --- | --- | --- | --- | --- | --- | --- |"))
    for method in methods:
        links = ", ".join(
            f"{link['table']} ({link['operation']})" for link in links_by_method[method["id"]]
        ) or "-"
        lines.append(
            f"| [{_md(method['class'] + '.' + method['name'])}](#{method_anchor(method['id'])}) | "
            f"`{method['layer']}` | `{_md(method.get('provenance', 'unknown'))}` | "
            f"`{method.get('kind', 'method')}` | `{_md(method['file'])}:{method['line']}` | "
            f"`{_md(method['returnType'])}` | {_md(_logic_summary(method['logic']))} | {_md(links)} |"
        )
    lines.extend(("", "## Entity-to-table mappings", "", "| Entity class | Table | Key | Source |", "| --- | --- | --- | --- |"))
    for mapping in analysis["entityMappings"]:
        evidence = mapping.get("evidence", {})
        lines.append(
            f"| `{mapping['class']}` | `{mapping['table']}` | `{mapping['key']}` | "
            f"`{_md(evidence.get('file', ''))}:{evidence.get('line', '')}` |"
        )
    lines.extend(("", "## Partition scopes", ""))
    for stem, scope in sorted(analysis.get("partitionScopes", {}).items()):
        lines.append(f'<a id="{scope["anchor"]}"></a>')
        lines.append(f"### `{stem}`")
        lines.append("")
        lines.append(f"- Tables: {', '.join(f'`{table}`' for table in scope['tables']) or '—'}")
        lines.append(f"- Related methods: {len(scope['methodIds'])}")
        lines.append(f"- Related method edges: {len(scope['relationshipIds'])}")
        lines.append("")
    lines.extend(("", "## Method logic details", ""))
    for method in methods:
        lines.append(f'<a id="{method_anchor(method["id"])}"></a>')
        lines.append(f"### `{method['class']}.{method['name']}`")
        lines.append("")
        lines.append(f"- Method ID: `{_md(method['id'])}`")
        lines.append(f"- Layer: `{method['layer']}`")
        lines.append(f"- Engine/provenance: `{_md(method.get('provenance', 'unknown'))}`")
        lines.append(f"- Kind: `{method.get('kind', 'method')}`; overload key: `{_md(method.get('overloadKey', ''))}`")
        lines.append(f"- Source: `{_md(method['file'])}:{method['line']}`")
        lines.append(f"- Signature pattern: `{_md(method['signature'])}`")
        lines.append(f"- Risk flags: `{', '.join(method.get('riskFlags', [])) or '—'}`")
        lines.append(f"- Logic: {_md(_logic_summary(method['logic']))}")
        flows = flows_by_method[method["id"]]
        flow_summary = ", ".join(
            f"{flow['targetColumn']} <- {flow['sourceColumn']}" for flow in flows
        )
        lines.append(f"- Field data flow: {_md(flow_summary) or '—'}")
        called = [_method_label(item, method_index) for item in method.get("calledMethods", [])]
        callers = [_method_label(item, method_index) for item in method.get("calledBy", [])]
        lines.append(f"- Calls: {', '.join(f'`{_md(item)}`' for item in called) or '—'}")
        lines.append(f"- Called by: {', '.join(f'`{_md(item)}`' for item in callers) or '—'}")
        lines.append("")
    return "\n".join(lines) + "\n"


def _relationship_layer(relationship, method_index):
    caller = method_index[relationship["caller"]]
    callee = method_index[relationship["callee"]]
    return f"{caller['layer']} → {callee['layer']}"


def render_relationships(analysis):
    methods = analysis["methods"]
    method_index = {method["id"]: method for method in methods}
    relationships = analysis["relationships"]
    lines = [
        "# Method Relationships (Phase 1)",
        "",
        "> Only unambiguous static call resolution is listed as `EXTRACTED`. Evidence counts are call-site observations, not execution counts.",
        "",
        "## Resolved method links",
        "",
        "| Caller | Kind | Callee | Layer path | Evidence |",
        "| --- | --- | --- | --- | --- |",
    ]
    for relationship in relationships:
        evidence = "; ".join(
            f"{item['file']}:{item['line']} ({item['symbol']})"
            for item in relationship["evidence"]
        )
        caller = relationship["caller"]
        callee = relationship["callee"]
        lines.append(
            f"| [{_md(_method_label(caller, method_index))}](source-code-analysis.md#{method_anchor(caller)}) | "
            f"`{relationship['kind']}` / `{relationship['status']}` | "
            f"[{_md(_method_label(callee, method_index))}](source-code-analysis.md#{method_anchor(callee)}) | "
            f"`{_relationship_layer(relationship, method_index)}` | `{_md(evidence)}` |"
        )
    if not relationships:
        lines.append("| — | — | — | — | No resolved method links |")
    lines.extend(("", "## Ambiguous or unresolved receiver calls", ""))
    if analysis["unresolvedCalls"]:
        lines.extend(
            (
                "| Caller | Receiver | Method | Source | Status | Reason | Args |",
                "| --- | --- | --- | --- | --- | --- | ---: |",
            )
        )
        for item in analysis["unresolvedCalls"]:
            argument_count = item.get("argumentCount")
            lines.append(
                f"| `{_md(_method_label(item['caller'], method_index))}` | `{_md(item['receiver'])}` | "
                f"`{item['name']}` | `{_md(item['file'])}:{item['line']}` | `{item['status']}` | "
                f"`{item.get('reason', 'unresolved-receiver')}` | "
                f"{argument_count if argument_count is not None else '—'} |"
            )
    else:
        lines.append("No ambiguous receiver calls were detected.")
    runtime_events = analysis.get("runtimeEvidence", {}).get("events", [])
    lines.extend(("", "## Runtime-observed method links", ""))
    lines.append("> `RUNTIME_OBSERVED` records normalized sampled evidence only; it is not a complete call graph.")
    if runtime_events:
        lines.extend(("", "| Caller | Callee | Samples | Source |", "| --- | --- | ---: | --- |"))
        for event in runtime_events:
            lines.append(
                f"| `{_md(_method_label(event['caller'], method_index))}` | "
                f"`{_md(_method_label(event['callee'], method_index))}` | "
                f"{event.get('sampleCount', 1)} | `{_md(event.get('source', ''))}` |"
            )
    else:
        lines.append("No normalized runtime-observed links were supplied.")
    lines.extend(("", "## Mermaid call graph", ""))
    nodes = sorted({node for edge in relationships for node in (edge["caller"], edge["callee"])})
    if len(relationships) <= 120 and len(nodes) <= 120:
        node_ids = {node: f"M{index}" for index, node in enumerate(nodes)}
        lines.extend(("```mermaid", "flowchart LR"))
        for node in nodes:
            label = _method_label(node, method_index).replace('"', "'")
            lines.append(f'  {node_ids[node]}["{label}"]')
        for relationship in relationships:
            lines.append(
                f"  {node_ids[relationship['caller']]} -->|{relationship['kind']}| "
                f"{node_ids[relationship['callee']]}"
            )
        lines.append("```")
    else:
        lines.append(
            f"Graph omitted because it has {len(nodes)} nodes and {len(relationships)} edges; "
            "the complete sparse edge list above remains the canonical navigation output."
        )
        lines.append("")
    return "\n".join(lines) + "\n"


def render_matrix(analysis):
    methods = analysis["methods"]
    method_index = {method["id"]: method for method in methods}
    matrices = analysis["matrices"]
    lines = [
        "# Method Matrices (Phase 1)",
        "",
        "> Matrices are sparse by design. `uniqueEdgeCount` counts one resolved caller/callee pair; `evidenceCount` counts distinct source call sites; method/table rows count static source references, not runtime frequency.",
        "",
        "## Layer-to-layer matrix",
        "",
        "| Caller \\ Callee | Entity | Biz | DAO | Source |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    layer_counts = {(row["callerLayer"], row["calleeLayer"]): row["uniqueEdgeCount"] for row in matrices["layer"]}
    for caller in LAYER_ORDER:
        values = [str(layer_counts.get((caller, callee), 0)) for callee in LAYER_ORDER]
        lines.append(f"| `{caller}` | " + " | ".join(values) + " |")
    lines.extend(("", "## Method-to-method sparse adjacency matrix", "", "| Caller | Callee | Kind | Unique edges | Evidence call sites |", "| --- | --- | --- | ---: | ---: |"))
    for row in matrices["method"]:
        lines.append(
            f"| [{_md(_method_label(row['caller'], method_index))}](source-code-analysis.md#{method_anchor(row['caller'])}) | "
            f"[{_md(_method_label(row['callee'], method_index))}](source-code-analysis.md#{method_anchor(row['callee'])}) | "
            f"`{row['kind']}` | {row['uniqueEdgeCount']} | {row['evidenceCount']} |"
        )
    if not matrices["method"]:
        lines.append("| — | — | — | 0 | 0 |")
    lines.extend(("", "## Method-to-table operation matrix", "", "| Method | Table | Operations | Evidence references |", "| --- | --- | --- | ---: |"))
    for row in matrices["methodTable"]:
        lines.append(
            f"| [{_md(_method_label(row['method'], method_index))}](source-code-analysis.md#{method_anchor(row['method'])}) | "
            f"`{row['table']}` | `{', '.join(row['operations'])}` | {row['evidenceCount']} |"
        )
    if not matrices["methodTable"]:
        lines.append("| — | — | — | 0 |")
    lines.extend(("", "## Method-to-field data-flow matrix", "", "| Method | Target column | Source column | Evidence references |", "| --- | --- | --- | ---: |"))
    for row in matrices["field"]:
        lines.append(
            f"| [{_md(_method_label(row['method'], method_index))}](source-code-analysis.md#{method_anchor(row['method'])}) | "
            f"`{row['targetColumn']}` | `{row['sourceColumn']}` | {row['evidenceCount']} |"
        )
    if not matrices["field"]:
        lines.append("| — | — | — | 0 |")
    lines.extend(("", "## Partition scopes", ""))
    for stem, scope in sorted(analysis.get("partitionScopes", {}).items()):
        lines.append(f"### `{stem}`")
        lines.append("")
        lines.append(f"- Anchor: [`{scope['anchor']}`](source-code-analysis.md#{scope['anchor']})")
        lines.append(f"- Tables: {', '.join(f'`{table}`' for table in scope['tables']) or '—'}")
        lines.append(f"- Related methods: {len(scope['methodIds'])}")
        lines.append(f"- Related method edges: {len(scope['relationshipIds'])}")
        lines.append("")
    return "\n".join(lines) + "\n"


def write_analysis_artifacts(output_dir, analysis):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "source-code-analysis.json": json.dumps(analysis, ensure_ascii=False, indent=2) + "\n",
        "source-code-analysis.md": render_source_analysis(analysis),
        "method-relationships.md": render_relationships(analysis),
        "method-matrix.md": render_matrix(analysis),
    }
    for name, content in files.items():
        (output_dir / name).write_text(content, encoding="utf-8")
    return tuple(output_dir / name for name in files)
