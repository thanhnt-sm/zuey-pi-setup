#!/usr/bin/env python3
"""Validate the frozen Phase 1 source-analysis sidecar contract only."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SENSITIVE = re.compile(
    r"(?i)(?:['\"])?\b(?:password|accountkey|user\s*id|initial\s+catalog|data\s+source)\b"
    r"(?:['\"])?\s*[:=]\s*['\"]?[^,;\s'\"]+"
    r"|\b(?:select|insert|update|delete)\s+[\w*\[\]]+"
)

def validate(root):
    root = Path(root).resolve()
    path = root / "_output" / "db_table_mapped" / "source-code-analysis.json"
    errors = []
    if not path.is_file():
        return [f"missing {path.relative_to(root)}"]
    try:
        analysis = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return [f"invalid source-analysis JSON: {error}"]
    if not isinstance(analysis, dict):
        return ["source-analysis root must be an object"]

    collections = {}
    for field in ("methods", "relationships", "tableLinks", "dataFlows", "unresolvedCalls"):
        value = analysis.get(field)
        if not isinstance(value, list):
            errors.append(f"{field} must be an array")
            value = []
        collections[field] = value
    methods = collections["methods"]
    relationships = collections["relationships"]
    table_links = collections["tableLinks"]
    unresolved_calls = collections["unresolvedCalls"]

    capabilities = analysis.get("capabilities")
    if not isinstance(capabilities, dict) or not capabilities.get("selectedEngine"):
        errors.append("capabilities.selectedEngine is required")

    method_set = set()
    for method in methods:
        if not isinstance(method, dict) or not isinstance(method.get("id"), str):
            errors.append("method entry has no string id")
            continue
        method_id = method["id"]
        if method_id in method_set:
            errors.append(f"duplicate method ID: {method_id}")
        method_set.add(method_id)
        if method.get("provenance") not in {
            "AST_EXTRACTED",
            "REGEX_EXTRACTED",
            "COMPILER_EXTRACTED",
        }:
            errors.append(f"invalid method provenance: {method_id}")
        span = method.get("sourceSpan", {})
        if not isinstance(span, dict) or (
            span
            and any(
                not isinstance(span.get(field), int)
                or isinstance(span.get(field), bool)
                or span.get(field) < 1
                for field in ("startLine", "startColumn", "endLine", "endColumn")
                if field in span
            )
        ):
            errors.append(f"invalid method sourceSpan: {method_id}")

    relationship_ids = set()
    for relationship in relationships:
        if not isinstance(relationship, dict):
            errors.append("relationship entry must be an object")
            continue
        relationship_id = relationship.get("id")
        if relationship_id in relationship_ids:
            errors.append(f"duplicate relationship ID: {relationship_id}")
        relationship_ids.add(relationship_id)
        if relationship.get("caller") not in method_set or relationship.get("callee") not in method_set:
            errors.append(f"relationship endpoint missing: {relationship_id}")
        if relationship.get("status") != "extracted":
            errors.append(f"static relationship must be extracted: {relationship_id}")
        if relationship.get("provenance") not in {
            "AST_EXTRACTED",
            "REGEX_EXTRACTED",
            "COMPILER_EXTRACTED",
        }:
            errors.append(f"invalid relationship provenance: {relationship_id}")
        if not relationship.get("evidence"):
            errors.append(f"relationship has no evidence: {relationship_id}")

    for link in table_links:
        if not isinstance(link, dict):
            errors.append("table link entry must be an object")
            continue
        if link.get("method") not in method_set:
            errors.append(f"table link method missing: {link.get('method')}")
        if link.get("operation") not in {"read", "join", "write", "reference"}:
            errors.append(f"invalid table link operation: {link.get('operation')}")
        if link.get("provenance") not in {
            "REGEX_EXTRACTED",
            "AST_EXTRACTED",
            "COMPILER_EXTRACTED",
        }:
            errors.append(f"invalid table link provenance: {link.get('method')}")
        if not link.get("evidence"):
            errors.append(f"table link has no evidence: {link.get('method')}")

    for item in unresolved_calls:
        if not isinstance(item, dict):
            errors.append("unresolved call entry must be an object")
            continue
        if item.get("caller") not in method_set:
            errors.append(f"unresolved caller missing: {item.get('caller')}")
        if item.get("status") != "ambiguous" or not item.get("reason"):
            errors.append(f"unresolved call lacks reason: {item.get('caller')}:{item.get('name')}")
        if item.get("provenance") != "AMBIGUOUS":
            errors.append(f"unresolved call provenance invalid: {item.get('caller')}:{item.get('name')}")

    runtime = analysis.get("runtimeEvidence", {})
    if not isinstance(runtime, dict) or runtime.get("schemaVersion") != 1:
        errors.append("runtimeEvidence.schemaVersion must be 1")
    else:
        runtime_events = runtime.get("events")
        runtime_unmatched = runtime.get("unmatched")
        if not isinstance(runtime_events, list):
            errors.append("runtimeEvidence.events must be an array")
            runtime_events = []
        if not isinstance(runtime_unmatched, list):
            errors.append("runtimeEvidence.unmatched must be an array")
            runtime_unmatched = []
        if (runtime_events or runtime_unmatched) and not isinstance(runtime.get("sourceHash"), str):
            errors.append("runtimeEvidence.sourceHash is required when events exist")
        for event in runtime_events:
            if not isinstance(event, dict):
                errors.append("runtime event entry must be an object")
                continue
            if event.get("caller") not in method_set:
                errors.append(f"runtime caller missing: {event.get('caller')}")
            if event.get("callee") not in method_set:
                errors.append(f"runtime callee missing: {event.get('callee')}")
            if event.get("status") != "observed" or event.get("provenance") != "RUNTIME_OBSERVED":
                errors.append(f"runtime provenance invalid: {event.get('id')}")
            if not isinstance(event.get("sampleCount"), int) or isinstance(event.get("sampleCount"), bool) or event.get("sampleCount") < 1:
                errors.append(f"runtime sampleCount invalid: {event.get('id')}")
        for event in runtime_unmatched:
            if not isinstance(event, dict):
                errors.append("unmatched runtime event entry must be an object")
                continue
            if event.get("status") != "observed" or event.get("provenance") != "RUNTIME_OBSERVED":
                errors.append(f"unmatched runtime provenance invalid: {event.get('id')}")
            if not event.get("reason"):
                errors.append(f"unmatched runtime reason missing: {event.get('id')}")
            if not isinstance(event.get("sampleCount"), int) or isinstance(event.get("sampleCount"), bool) or event.get("sampleCount") < 1:
                errors.append(f"unmatched runtime sampleCount invalid: {event.get('id')}")

    serialized = json.dumps(analysis, ensure_ascii=False)
    if SENSITIVE.search(serialized):
        errors.append("source-analysis sidecar contains sensitive/raw SQL-like content")
    scopes = analysis.get("partitionScopes", {})
    if not isinstance(scopes, dict):
        errors.append("partitionScopes must be an object")
        scopes = {}
    for stem, scope in scopes.items():
        if not isinstance(scope, dict):
            errors.append(f"invalid partition scope: {stem}")
            continue
        method_scope = scope.get("methodIds", [])
        relationship_scope = scope.get("relationshipIds", [])
        if not isinstance(method_scope, list) or any(item not in method_set for item in method_scope):
            errors.append(f"partition scope has unknown method: {stem}")
        if not isinstance(relationship_scope, list) or any(item not in relationship_ids for item in relationship_scope):
            errors.append(f"partition scope has unknown relationship: {stem}")
    return errors


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    errors = validate(root)
    if errors:
        print(json.dumps({"ok": False, "errors": errors}, ensure_ascii=False))
        raise SystemExit(1)
    print(json.dumps({"ok": True, "artifact": "source-code-analysis.json"}))


if __name__ == "__main__":
    main()
