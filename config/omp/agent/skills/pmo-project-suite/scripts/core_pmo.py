"""
core_pmo.py — Unified Pure-Python PMI/PMO Calculation & Validation Engine.

Consolidates all modules from pmi-pmo-framework:
- Safe Excel loading & CWE-1236 formula injection defense (safe_load_workbook, is_dangerous_formula)
- Archive & untrusted input security (safe_inspect_archive_members, scan_untrusted_input_for_injection_markers)
- Atomic SHA-256 revision manifest verification (verify_atomic_revision_set, generate_revision_manifest)
- Contractual Obligation & Deliverable matrix (validate_obligation_row/register, build_obligation_deliverable_matrix)
- Change Request impact & authority validation (evaluate_change_request)
- WBS 100% Rule, CPM Critical Path (strict end-reach + depends_on), EVM & Verified Delivery, PERT
- Risk PxI/EMV, RTM + circular dependency / topological sort, Sprint & Capacity allocation
- Strict dates + working days + weekend/milestone anomalies, Report Evidence Audit (Checks 1-3) & Anti-Rework state
Zero hardcoded client names; 100% cross-platform Windows/macOS/Linux.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import tarfile
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple, Union

from venv_bootstrap import attach_omp_tools_venv

attach_omp_tools_venv()

try:
    import openpyxl  # type: ignore
    from openpyxl.utils.exceptions import InvalidFileException  # type: ignore
except ImportError:  # pragma: no cover
    openpyxl = None
    InvalidFileException = Exception


# ==============================================================================
# 1. CWE-1236 FORMULA DEFENSE & SAFE EXCEL TOOLCHAIN
# ==============================================================================

FORMULA_INJECTION_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n", "\uff1d", "\uff0b", "\uff0d")
DANGEROUS_DDE_PATTERNS = (
    "cmd|", "powershell|", "mshta|", "wscript|", "cscript|",
    "rundll32|", "regsvr32|", "certutil|", "curl|", "wget|",
    "!a0", "|'/c", "|' /c", "=exec(", "=system(", "=shell(",
)


def is_dangerous_formula(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    lowered = value.strip().lower()
    if any(pat in lowered for pat in DANGEROUS_DDE_PATTERNS):
        return True
    if "=hyperlink(" in lowered and ("http://" in lowered or "https://" in lowered or "file://" in lowered):
        return True
    if lowered.startswith(("=cmd", "+cmd", "-cmd", "@cmd")):
        return True
    return False


def sanitize_cell_formula_injection(value: Any) -> Any:
    if not isinstance(value, str) or not value:
        return value
    stripped = value.lstrip()
    if value.startswith(FORMULA_INJECTION_PREFIXES) or (stripped and stripped.startswith(FORMULA_INJECTION_PREFIXES)):
        if value.startswith("'"):
            return value
        return "'" + value
    return value


def sanitize_record_formulas(record: Dict[str, Any]) -> Dict[str, Any]:
    return {k: sanitize_cell_formula_injection(v) for k, v in record.items()}


def sanitize_rows_formulas(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [sanitize_record_formulas(r) for r in rows]


# ==============================================================================
# 2. ARCHIVE SECURITY, PROMPT INJECTION & ATOMIC MANIFESTS
# ==============================================================================

SUSPICIOUS_INJECTION_PATTERNS = (
    "ignore previous instructions", "ignore all prior instructions",
    "system prompt:", "grant customer signoff", "customer approval granted",
    "grant full acceptance", "<script", "javascript:", "eval(", "bypass review",
    "admin_override", "role: system", "role: assistant", "<|im_start|>",
    "<|im_end|>", "[inst]", "[/inst]", "<<sys>>", "<</sys>>",
    "new system instruction", "disregard all earlier prompts",
    "override safety protocols", "exfiltrate data", "developer mode enabled",
)

WINDOWS_RESERVED_DEVICE_NAMES: Set[str] = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}


def is_windows_device_name(filename_part: str) -> bool:
    base = filename_part.split(".")[0].strip().upper()
    return base in WINDOWS_RESERVED_DEVICE_NAMES


def scan_untrusted_input_for_injection_markers(text: Any) -> Dict[str, Any]:
    if not isinstance(text, str):
        return {"is_clean": True, "findings": []}
    lower = text.lower()
    hits = [pat for pat in SUSPICIOUS_INJECTION_PATTERNS if pat in lower]
    return {"is_clean": len(hits) == 0, "findings": hits}


def safe_inspect_archive_members(
    archive_path: Union[str, Path],
    max_uncompressed_bytes: int = 100 * 1024 * 1024,
    max_ratio: float = 100.0,
    max_files: int = 10000,
) -> Tuple[bool, List[str], List[str]]:
    ap = str(archive_path)
    violations: List[str] = []
    all_members: List[str] = []
    if not os.path.exists(ap):
        return False, [f"Archive does not exist: {ap}"], []

    is_zip = zipfile.is_zipfile(ap)
    is_tar = False if is_zip else tarfile.is_tarfile(ap)
    if not is_zip and not is_tar:
        return False, [f"Corrupted, invalid, or unsupported archive format: '{ap}'"], []

    def _check_name(name: str) -> None:
        if "\x00" in name:
            violations.append(f"Null byte in member: '{name}'")
        if name.startswith(("/", "\\")) or (len(name) >= 2 and name[1] == ":" and name[0].isalpha()):
            violations.append(f"Absolute/drive path traversal: '{name}'")
        parts = [p for p in name.replace("\\", "/").split("/") if p]
        if ".." in parts:
            violations.append(f"Parent traversal ('..') in member: '{name}'")
        for part in parts:
            if is_windows_device_name(part):
                violations.append(f"Windows reserved device name in path: '{name}'")

    if is_tar:
        try:
            with tarfile.open(ap, "r:*") as tf:
                members = tf.getmembers()
                if len(members) > max_files:
                    violations.append(f"Member count {len(members)} exceeds {max_files}")
                total_uncompressed = 0
                for m in members:
                    all_members.append(m.name)
                    _check_name(m.name)
                    if m.issym() or m.islnk():
                        violations.append(f"Symlink/hardlink disallowed: '{m.name}' -> '{m.linkname}'")
                    if m.isdev() or m.ischr() or m.isblk() or m.isfifo():
                        violations.append(f"Device/FIFO disallowed: '{m.name}'")
                    total_uncompressed += max(0, m.size)
                comp_sz = os.path.getsize(ap)
                if comp_sz > 0 and total_uncompressed > 1024 * 1024 and (total_uncompressed / comp_sz) > max_ratio:
                    violations.append("Archive compression ratio exceeds bomb threshold")
                if total_uncompressed > max_uncompressed_bytes:
                    violations.append(f"Uncompressed size {total_uncompressed} exceeds limit {max_uncompressed_bytes}")
        except Exception as exc:
            return False, [f"Tar inspection error: {exc}"], []
        return len(violations) == 0, violations, all_members

    try:
        with zipfile.ZipFile(ap, "r") as zf:
            infos = zf.infolist()
            if len(infos) > max_files:
                violations.append(f"Member count {len(infos)} exceeds {max_files}")
            total_uncompressed = 0
            total_compressed = 0
            for info in infos:
                all_members.append(info.filename)
                _check_name(info.filename)
                # Unix symlink bit check (0120000 in upper 16 bits of external_attr)
                if ((info.external_attr >> 16) & 0o170000) == 0o120000:
                    violations.append(f"ZIP symlink member disallowed: '{info.filename}'")
                total_uncompressed += max(0, info.file_size)
                total_compressed += max(0, info.compress_size)
            if total_compressed > 0 and total_uncompressed > 1024 * 1024 and (total_uncompressed / total_compressed) > max_ratio:
                violations.append("ZIP compression ratio exceeds bomb threshold")
            if total_uncompressed > max_uncompressed_bytes:
                violations.append(f"Uncompressed size {total_uncompressed} exceeds limit {max_uncompressed_bytes}")
    except Exception as exc:
        return False, [f"ZIP inspection error: {exc}"], []
    return len(violations) == 0, violations, all_members


def safe_load_workbook(
    filepath: Union[str, Path],
    data_only: bool = False,
    read_only: bool = False,
    max_uncompressed_bytes: int = 100 * 1024 * 1024,
    max_ratio: float = 100.0,
) -> Dict[str, Any]:
    fp = str(filepath)
    if not os.path.exists(fp):
        return {"success": False, "filepath": fp, "workbook": None, "error": f"File not found: {fp}", "error_category": "FILE_NOT_FOUND"}
    if os.path.getsize(fp) == 0:
        return {"success": False, "filepath": fp, "workbook": None, "error": f"Empty 0-byte file: {fp}", "error_category": "ZERO_BYTE_FILE"}
    if not zipfile.is_zipfile(fp):
        return {"success": False, "filepath": fp, "workbook": None, "error": "Corrupted or non-ZIP archive", "error_category": "CORRUPTED_OR_NON_ZIP"}

    is_safe, violations, _ = safe_inspect_archive_members(fp, max_uncompressed_bytes=max_uncompressed_bytes, max_ratio=max_ratio)
    if not is_safe:
        return {"success": False, "filepath": fp, "workbook": None, "error": f"Security preflight failed: {'; '.join(violations)}", "error_category": "SECURITY_VIOLATION"}
    if openpyxl is None:
        return {"success": False, "filepath": fp, "workbook": None, "error": "openpyxl not installed", "error_category": "UNEXPECTED_ERROR"}

    try:
        wb = openpyxl.load_workbook(fp, data_only=data_only, read_only=read_only)
        return {"success": True, "filepath": fp, "workbook": wb, "error": None, "error_category": None}
    except zipfile.BadZipFile as exc:
        return {"success": False, "filepath": fp, "workbook": None, "error": str(exc), "error_category": "CORRUPTED_OR_NON_ZIP"}
    except InvalidFileException as exc:
        return {"success": False, "filepath": fp, "workbook": None, "error": str(exc), "error_category": "INVALID_EXCEL_FORMAT"}
    except Exception as exc:
        return {"success": False, "filepath": fp, "workbook": None, "error": str(exc), "error_category": "UNEXPECTED_ERROR"}


def safe_verify_sheet_structure(workbook: Any, required_sheets: List[str], case_sensitive: bool = True) -> Tuple[bool, List[str]]:
    if workbook is None:
        return False, list(required_sheets)
    existing = list(workbook.sheetnames)
    if case_sensitive:
        missing = [s for s in required_sheets if s not in existing]
    else:
        low = {e.lower() for e in existing}
        missing = [s for s in required_sheets if s.lower() not in low]
    return len(missing) == 0, missing


def safe_inspect_sheet_details(workbook: Any) -> Dict[str, Any]:
    if workbook is None:
        return {"sheet_count": 0, "sheets": {}}
    details = {}
    for name in workbook.sheetnames:
        ws = workbook[name]
        details[name] = {"max_row": ws.max_row, "max_column": ws.max_column, "sheet_state": ws.sheet_state}
    return {"sheet_count": len(details), "sheets": details}


def sha256_file(filepath: Union[str, Path]) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def normalize_manifest_path(path_str: str) -> str:
    cleaned = path_str.replace("\\", "/").strip()
    while cleaned.startswith(("./", "/")):
        cleaned = cleaned[2:] if cleaned.startswith("./") else cleaned[1:]
    cleaned = cleaned.rstrip("/") or "."
    parts = [p for p in cleaned.split("/") if p]
    if ".." in parts:
        raise ValueError(f"Traversal ('..') disallowed in manifest path: '{path_str}'")
    for part in parts:
        if is_windows_device_name(part):
            raise ValueError(f"Windows device name disallowed in manifest path: '{path_str}'")
    return cleaned


def verify_atomic_revision_set(revision_manifest: Dict[str, Any], candidate_dir: Union[str, Path]) -> Tuple[bool, List[str]]:
    violations: List[str] = []
    artifacts = revision_manifest.get("artifacts", {})
    items: List[Tuple[str, str]] = []
    if isinstance(artifacts, dict):
        items = [(str(k), str(v)) for k, v in artifacts.items()]
    elif isinstance(artifacts, list):
        for a in artifacts:
            if isinstance(a, dict) and a.get("path") and a.get("sha256"):
                items.append((str(a["path"]), str(a["sha256"])))
    if not items:
        return False, ["Manifest contains no valid artifacts"]

    base = os.path.abspath(str(candidate_dir))
    for rel_path, expected_hash in items:
        try:
            norm = normalize_manifest_path(rel_path)
            target = os.path.abspath(os.path.join(base, norm))
            if not target.startswith(base + os.sep) and target != base:
                violations.append(f"Escaped target directory: '{rel_path}'")
                continue
            if not os.path.isfile(target):
                violations.append(f"Missing artifact: '{norm}'")
                continue
            actual = sha256_file(target)
            if actual.lower() != expected_hash.strip().lower():
                violations.append(f"SHA-256 mismatch for '{norm}': expected {expected_hash[:12]}, got {actual[:12]}")
        except Exception as exc:
            violations.append(f"Error verifying '{rel_path}': {exc}")
    return len(violations) == 0, violations


def generate_revision_manifest(candidate_dir: Union[str, Path], rel_paths: List[str], version: str = "1.0.0") -> Dict[str, Any]:
    base = Path(candidate_dir).resolve()
    artifacts: Dict[str, str] = {}
    for rp in rel_paths:
        norm = normalize_manifest_path(rp)
        full = (base / norm).resolve()
        if not full.is_file():
            raise FileNotFoundError(f"Cannot hash missing artifact: {full}")
        artifacts[norm] = sha256_file(full)
    return {"version": version, "generated_at": datetime.now().isoformat(), "artifacts": artifacts}


# ==============================================================================
# 3. CONTRACTUAL OBLIGATION & CHANGE REQUEST ENGINES
# ==============================================================================

VALID_OBLIGATION_CATEGORIES = {"product", "documentation", "training", "warranty_sla", "security", "payment", "governance"}
VALID_OBLIGORS = {"contractor", "client", "joint", "subcontractor"}
OBLIGATION_REQUIRED_COLUMNS = [
    "Obligation ID", "Source Reference", "Obligor", "Deliverable",
    "Due Date / Trigger", "Acceptance Criteria", "Authorized Role", "Category",
]


def validate_obligation_row(row: Union[Dict[str, Any], Any]) -> Tuple[bool, List[str]]:
    if not isinstance(row, dict):
        return False, ["Obligation row must be a dictionary"]
    errors: List[str] = []
    for col in OBLIGATION_REQUIRED_COLUMNS:
        if col not in row or row[col] is None or str(row[col]).strip() == "":
            errors.append(f"Missing or empty mandatory obligation column: '{col}'")
    if errors:
        return False, errors

    cat = str(row["Category"]).strip().lower()
    if cat not in VALID_OBLIGATION_CATEGORIES:
        errors.append(f"Invalid Category '{row['Category']}'. Allowed: {sorted(VALID_OBLIGATION_CATEGORIES)}")
    obligor = str(row["Obligor"]).strip().lower()
    if obligor not in VALID_OBLIGORS:
        errors.append(f"Invalid Obligor '{row['Obligor']}'. Allowed: {sorted(VALID_OBLIGORS)}")
    ac = str(row["Acceptance Criteria"]).strip().lower()
    if ac in {"ok", "done", "tbd", "yes", "true", "none"}:
        errors.append(f"Non-verifiable Acceptance Criteria '{row['Acceptance Criteria']}'")
    return len(errors) == 0, errors


def validate_obligation_register(
    obligations: Union[List[Dict[str, Any]], Any],
    all_known_deliverables: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    if not isinstance(obligations, list):
        return {"is_valid": False, "total_obligations": 0, "error": "obligations must be a list"}
    row_errors: List[Tuple[int, List[str]]] = []
    valid_rows: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()
    dup_ids: List[str] = []
    orphans: List[str] = []
    by_cat = {c: 0 for c in VALID_OBLIGATION_CATEGORIES}
    by_ob = {o: 0 for o in VALID_OBLIGORS}
    known_set = set(all_known_deliverables) if all_known_deliverables is not None else None

    for idx, row in enumerate(obligations):
        ok, errs = validate_obligation_row(row)
        if not ok:
            row_errors.append((idx, errs))
            continue
        oid = str(row["Obligation ID"]).strip()
        if oid in seen_ids:
            dup_ids.append(oid)
        seen_ids.add(oid)
        by_cat[str(row["Category"]).strip().lower()] += 1
        by_ob[str(row["Obligor"]).strip().lower()] += 1
        deliv = str(row["Deliverable"]).strip()
        if known_set is not None and deliv not in known_set:
            orphans.append(f"{oid} -> {deliv}")
        valid_rows.append(row)

    return {
        "is_valid": not row_errors and not dup_ids and not orphans,
        "total_obligations": len(obligations),
        "valid_obligations_count": len(valid_rows),
        "row_errors": row_errors,
        "duplicate_ids": dup_ids,
        "orphan_deliverables": orphans,
        "by_category": by_cat,
        "by_obligor": by_ob,
    }


def build_obligation_deliverable_matrix(
    obligations: Sequence[Dict[str, Any]],
    deliverables: Sequence[Union[str, Dict[str, Any]]],
) -> Dict[str, Any]:
    deliv_ids: List[str] = []
    for d in deliverables:
        did = str(d.get("id") or d.get("Deliverable ID") or d.get("name") or "").strip() if isinstance(d, dict) else str(d).strip()
        if did:
            deliv_ids.append(did)
    ob_to_deliv: Dict[str, str] = {}
    deliv_to_obs: Dict[str, List[str]] = {did: [] for did in deliv_ids}
    for ob in obligations:
        if not isinstance(ob, dict):
            continue
        oid = str(ob.get("Obligation ID", "")).strip()
        did = str(ob.get("Deliverable", "")).strip()
        if oid and did:
            ob_to_deliv[oid] = did
            deliv_to_obs.setdefault(did, []).append(oid)
    uncontracted = [did for did in deliv_ids if not deliv_to_obs.get(did)]
    unfulfilled = [oid for oid, did in ob_to_deliv.items() if did not in deliv_ids]
    return {
        "obligation_to_deliverable": ob_to_deliv,
        "deliverable_to_obligations": deliv_to_obs,
        "uncontracted_deliverables": uncontracted,
        "unfulfilled_obligations": unfulfilled,
        "is_complete_alignment": not uncontracted and not unfulfilled,
    }


AUTHORIZED_CR_AUTHORITIES = {
    "customer sponsor", "project sponsor", "lead operator",
    "pmo steering committee", "change control board", "ccb", "authorized customer",
}
DISALLOWED_APPROVAL_MARKERS = {"pending", "self", "unverified", "automatic", "draft", "rejected", "unauthorized"}


def evaluate_change_request(
    cr_data: Union[Dict[str, Any], Any],
    baseline_requirements: Any = None,
    baseline_tasks: Any = None,
) -> Dict[str, Any]:
    if not isinstance(cr_data, dict):
        return {"is_valid": False, "cr_id": "UNKNOWN", "is_authorized": False, "net_effort_delta": 0.0, "errors": ["cr_data must be a dict"]}
    cr_id = str(cr_data.get("cr_id") or cr_data.get("id") or "CR-UNKNOWN").strip()
    title = str(cr_data.get("title") or "Untitled Change Request").strip()
    authority = str(cr_data.get("authority") or cr_data.get("approved_by") or "").strip()
    status = str(cr_data.get("status") or "pending").strip().lower()
    errors: List[str] = []
    auth_low = authority.lower()
    is_authorized = False
    if not authority:
        errors.append("Missing approval authority or 'approved_by' field.")
    elif any(dis in auth_low for dis in DISALLOWED_APPROVAL_MARKERS):
        errors.append(f"Disallowed or unverified approval marker in authority: '{authority}'.")
    elif any(auth in auth_low for auth in AUTHORIZED_CR_AUTHORITIES):
        is_authorized = True
    else:
        errors.append(f"Authority '{authority}' is not in authorized CCB/Sponsor list.")
    if status == "approved" and not is_authorized:
        errors.append("Status claims 'approved' without recognized authorized authority.")

    base_tasks: Dict[str, Dict[str, Any]] = {}
    if isinstance(baseline_tasks, list):
        for t in baseline_tasks:
            if isinstance(t, dict):
                tid = str(t.get("id") or t.get("task_id") or "").strip()
                if tid:
                    base_tasks[tid] = t

    added_reqs = cr_data.get("added_requirements") or []
    removed_req_ids = [str(r).strip() for r in (cr_data.get("removed_requirements") or [])]
    modified_reqs = cr_data.get("modified_requirements") or []
    added_tasks = cr_data.get("added_tasks") or []
    removed_task_ids = [str(t).strip() for t in (cr_data.get("removed_tasks") or [])]
    modified_tasks = cr_data.get("modified_tasks") or []

    effort_added = sum(float(t.get("effort", 0)) for t in added_tasks if isinstance(t, dict))
    effort_removed = sum(float(base_tasks[tid].get("effort", 0)) for tid in removed_task_ids if tid in base_tasks)
    effort_mod = 0.0
    for mod in modified_tasks:
        if isinstance(mod, dict):
            tid = str(mod.get("id") or mod.get("task_id") or "").strip()
            if tid in base_tasks:
                effort_mod += float(mod.get("effort", base_tasks[tid].get("effort", 0))) - float(base_tasks[tid].get("effort", 0))

    affected_by_req = sorted(
        tid for tid, t in base_tasks.items()
        if str(t.get("requirement_id") or t.get("Requirement ID") or "") in removed_req_ids
    )
    broken_deps: List[str] = []
    for tid, t in base_tasks.items():
        if tid not in removed_task_ids:
            preds = t.get("predecessors") or t.get("depends_on") or []
            if isinstance(preds, list):
                for p in preds:
                    if str(p).strip() in removed_task_ids:
                        broken_deps.append(f"Task '{tid}' depends on removed task '{p}'.")

    return {
        "is_valid": not errors and not broken_deps,
        "cr_id": cr_id,
        "title": title,
        "authority": authority,
        "is_authorized": is_authorized,
        "net_effort_delta": round(effort_added - effort_removed + effort_mod, 2),
        "scope_deltas": {
            "added_requirements_count": len(added_reqs),
            "removed_requirements_count": len(removed_req_ids),
            "modified_requirements_count": len(modified_reqs),
            "added_tasks_count": len(added_tasks),
            "removed_tasks_count": len(removed_task_ids),
            "modified_tasks_count": len(modified_tasks),
        },
        "impact_radius": {"affected_tasks_by_req_removal": affected_by_req, "broken_dependencies": broken_deps},
        "errors": errors,
    }


# ==============================================================================
# 4. CRITICAL PATH METHOD (CPM) — FIXED `depends_on` & FULL-END CRITICAL PATHS
# ==============================================================================

def calculate_cpm_schedule(tasks: Union[List[Dict[str, Any]], Any]) -> Dict[str, Any]:
    if not isinstance(tasks, list):
        return {"is_valid": False, "error": "tasks must be a list of task dictionaries", "project_duration": 0.0, "critical_path": [], "schedule": {}}
    if len(tasks) == 0:
        return {"is_valid": True, "total_tasks": 0, "project_duration": 0.0, "critical_path": [], "all_critical_paths": [], "errors": [], "schedule": {}}

    task_map: Dict[str, Dict[str, Any]] = {}
    predecessors_map: Dict[str, List[str]] = {}
    successors_map: Dict[str, List[str]] = {}
    durations: Dict[str, float] = {}
    errors: List[str] = []

    for idx, t in enumerate(tasks):
        if not isinstance(t, dict):
            errors.append(f"Task at index {idx} is not a dictionary")
            continue
        tid = t.get("id") or t.get("task_id") or t.get("ID")
        if not tid or str(tid).strip() == "":
            errors.append(f"Task at index {idx} is missing a valid 'id'")
            continue
        tid = str(tid).strip()
        if tid in task_map:
            errors.append(f"Duplicate task id detected: '{tid}'")
            continue

        raw_dur = t.get("duration") if t.get("duration") is not None else t.get("duration_days", 1.0)
        try:
            dur = float(raw_dur)
            if dur < 0.0:
                errors.append(f"Task '{tid}' has negative duration ({dur})")
                continue
        except (ValueError, TypeError):
            errors.append(f"Task '{tid}' has invalid duration '{raw_dur}'")
            continue

        raw_preds = t.get("predecessors") if t.get("predecessors") is not None else t.get("depends_on", [])
        if isinstance(raw_preds, str):
            preds = [p.strip() for p in raw_preds.split(",") if p.strip() and p.strip().lower() != "none"]
        elif isinstance(raw_preds, (list, tuple, set)):
            preds = [str(p).strip() for p in raw_preds if str(p).strip()]
        else:
            preds = []

        task_map[tid] = t
        durations[tid] = dur
        predecessors_map[tid] = preds
        successors_map[tid] = []

    if errors:
        return {"is_valid": False, "errors": errors, "project_duration": 0.0, "critical_path": [], "schedule": {}}

    for tid, preds in predecessors_map.items():
        for p in preds:
            if p not in task_map:
                errors.append(f"Task '{tid}' depends on unknown predecessor '{p}'")
            elif p == tid:
                errors.append(f"Task '{tid}' cannot depend on itself")
            else:
                successors_map[p].append(tid)
    if errors:
        return {"is_valid": False, "errors": errors, "project_duration": 0.0, "critical_path": [], "schedule": {}}

    in_degree = {tid: len(preds) for tid, preds in predecessors_map.items()}
    queue = [tid for tid, deg in in_degree.items() if deg == 0]
    topological_order: List[str] = []
    while queue:
        curr = queue.pop(0)
        topological_order.append(curr)
        for succ in successors_map[curr]:
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    if len(topological_order) < len(task_map):
        cycle_nodes = [tid for tid, deg in in_degree.items() if deg > 0]
        return {"is_valid": False, "errors": [f"Circular dependency detected involving tasks: {', '.join(sorted(cycle_nodes))}"], "project_duration": 0.0, "critical_path": [], "schedule": {}}

    es: Dict[str, float] = {}
    ef: Dict[str, float] = {}
    for tid in topological_order:
        preds = predecessors_map[tid]
        es[tid] = max((ef[p] for p in preds), default=0.0)
        ef[tid] = round(es[tid] + durations[tid], 4)

    project_duration = round(max((ef[tid] for tid in topological_order), default=0.0), 4)
    ls: Dict[str, float] = {}
    lf: Dict[str, float] = {}
    for tid in reversed(topological_order):
        succs = successors_map[tid]
        lf[tid] = min((ls[s] for s in succs), default=project_duration)
        ls[tid] = round(lf[tid] - durations[tid], 4)

    critical_path: List[str] = []
    schedule_out: Dict[str, Dict[str, Any]] = {}
    for tid in topological_order:
        tf = round(ls[tid] - es[tid], 4)
        if abs(tf) < 1e-6:
            tf = 0.0
        succs = successors_map[tid]
        ff = round((min(es[s] for s in succs) - ef[tid]) if succs else (project_duration - ef[tid]), 4)
        if abs(ff) < 1e-6:
            ff = 0.0
        is_crit = abs(tf) < 1e-4
        if is_crit:
            critical_path.append(tid)
        schedule_out[tid] = {
            "id": tid, "name": task_map[tid].get("name", tid), "duration": durations[tid],
            "es": round(es[tid], 4), "ef": round(ef[tid], 4), "ls": round(ls[tid], 4), "lf": round(lf[tid], 4),
            "total_float": tf, "free_float": ff, "is_critical": is_crit,
            "predecessors": predecessors_map[tid], "successors": successors_map[tid],
        }

    critical_starts = [tid for tid in critical_path if not predecessors_map[tid] or all(not schedule_out[p]["is_critical"] for p in predecessors_map[tid])]
    all_critical_paths: List[List[str]] = []

    def _find_paths(current_node: str, current_path: List[str]) -> None:
        crit_succs = [s for s in successors_map[current_node] if schedule_out[s]["is_critical"] and abs(es[s] - ef[current_node]) < 1e-4]
        if not crit_succs:
            if abs(ef[current_node] - project_duration) < 1e-4:
                all_critical_paths.append(current_path)
            return
        for s in crit_succs:
            _find_paths(s, current_path + [s])

    for start_node in critical_starts:
        _find_paths(start_node, [start_node])

    return {
        "is_valid": True, "total_tasks": len(task_map), "project_duration": project_duration,
        "critical_path": critical_path, "all_critical_paths": all_critical_paths,
        "topological_order": topological_order, "errors": [], "schedule": schedule_out,
    }


# ==============================================================================
# 5. EARNED VALUE MANAGEMENT (EVM) & VERIFIED DELIVERY (FIXED ZERO-WEIGHT & SCOPE)
# ==============================================================================

def calculate_verified_delivery(baseline_tasks: Union[List[Dict[str, Any]], Any], weight_key: str = "effort") -> Dict[str, Any]:
    if not isinstance(baseline_tasks, list):
        return {
            "is_valid": False, "error": "baseline_tasks must be a list of task dictionaries",
            "verified_delivery": None, "numerator": 0.0, "denominator": 0.0, "denominator_zero": True,
            "missing_estimates": [], "unverified_tasks": [],
        }

    total_weight = 0.0
    verified_done_weight = 0.0
    missing_estimates: List[str] = []
    unverified_tasks: List[str] = []
    done_count = 0
    seen_task_ids: Set[str] = set()

    for idx, task in enumerate(baseline_tasks):
        if not isinstance(task, dict):
            continue
        scope_state = str(task.get("scope_state", "")).strip().lower()
        if scope_state in ("proposed", "unapproved", "draft"):
            continue
        task_id = str(task.get("id") or task.get("task_id") or f"TASK_{idx}")
        if task_id in seen_task_ids:
            continue
        seen_task_ids.add(task_id)

        raw_weight = task.get(weight_key)
        if raw_weight is None:
            raw_weight = task.get("baseline_effort", task.get("weight"))
        if raw_weight is None:
            missing_estimates.append(task_id)
            continue
        try:
            weight = float(raw_weight)
            if weight <= 0.0:
                missing_estimates.append(task_id)
                continue
        except (ValueError, TypeError):
            missing_estimates.append(task_id)
            continue

        total_weight += weight
        status = str(task.get("status") or task.get("state") or "").strip().lower()
        is_done = bool(task.get("is_done")) or status in ("done", "completed", "verified", "closed", "accepted")
        ev_raw = task.get("evidence") or task.get("verification_evidence")
        has_evidence = bool(str(ev_raw).strip()) if ev_raw is not None else False
        if is_done:
            if has_evidence:
                verified_done_weight += weight
                done_count += 1
            else:
                unverified_tasks.append(task_id)

    denominator_zero = total_weight <= 0.0
    verified_delivery = round(verified_done_weight / total_weight, 4) if not denominator_zero else None
    is_valid = (not denominator_zero) and (not missing_estimates)
    return {
        "is_valid": is_valid, "verified_delivery": verified_delivery,
        "numerator": round(verified_done_weight, 2), "denominator": round(total_weight, 2),
        "denominator_zero": denominator_zero, "total_tasks": len(seen_task_ids),
        "verified_done_tasks": done_count, "missing_estimates": missing_estimates,
        "unverified_tasks": unverified_tasks,
    }


def calculate_evm_metrics(pv: float, ev: float, ac: float, bac: Optional[float] = None, unit: str = "currency") -> Dict[str, Any]:
    unit_normalized = str(unit).lower().strip()
    if unit_normalized in ("points", "point", "pts", "sp", "story_points"):
        return {
            "is_valid": False, "error": "STORY_POINTS_EVM_MISMATCH: Story points cannot be used as monetary currency in EVM.",
            "pv": pv, "ev": ev, "ac": ac, "sv": None, "cv": None, "spi": None, "cpi": None,
            "eac": None, "etc": None, "cost_status": "UNKNOWN", "schedule_status": "UNKNOWN", "rag": "UNKNOWN",
        }
    try:
        pv_f, ev_f, ac_f = float(pv), float(ev), float(ac)
    except (ValueError, TypeError) as exc:
        return {"is_valid": False, "error": f"INVALID_NUMERIC_INPUT: {exc}", "pv": pv, "ev": ev, "ac": ac}

    sv, cv = round(ev_f - pv_f, 2), round(ev_f - ac_f, 2)
    spi = round(ev_f / pv_f, 4) if pv_f > 0.0 else None
    cpi = round(ev_f / ac_f, 4) if ac_f > 0.0 else None
    eac = etc = None
    if bac is not None:
        try:
            bac_f = float(bac)
            if cpi and cpi > 0.0:
                eac = round(bac_f / cpi, 2)
                etc = round(eac - ac_f, 2)
        except (ValueError, TypeError):
            pass
    cost_status = "UNDER_BUDGET" if cv > 0 else ("OVER_BUDGET" if cv < 0 else "ON_BUDGET")
    schedule_status = "AHEAD_OF_SCHEDULE" if sv > 0 else ("BEHIND_SCHEDULE" if sv < 0 else "ON_SCHEDULE")
    eff_spi = spi if spi is not None else 1.0
    eff_cpi = cpi if cpi is not None else 1.0
    rag = "RED" if (eff_spi < 0.85 or eff_cpi < 0.85) else ("AMBER" if (eff_spi < 0.95 or eff_cpi < 0.95) else "GREEN")
    return {
        "is_valid": True, "pv": pv_f, "ev": ev_f, "ac": ac_f,
        "bac": float(bac) if bac is not None else None,
        "sv": sv, "cv": cv, "spi": spi, "cpi": cpi, "eac": eac, "etc": etc,
        "cost_status": cost_status, "schedule_status": schedule_status, "rag": rag,
    }


def detect_denominator_drift(previous_baseline: List[Dict[str, Any]], current_baseline: List[Dict[str, Any]], weight_key: str = "effort") -> Dict[str, Any]:
    def _extract_weights(tasks: List[Dict[str, Any]]) -> Dict[str, float]:
        weights: Dict[str, float] = {}
        for idx, t in enumerate(tasks):
            if not isinstance(t, dict):
                continue
            tid = str(t.get("id") or t.get("task_id") or f"T_{idx}")
            raw = t.get(weight_key) if t.get(weight_key) is not None else t.get("baseline_effort", t.get("weight"))
            try:
                if raw is not None:
                    weights[tid] = float(raw)
            except (ValueError, TypeError):
                pass
        return weights

    prev_map, curr_map = _extract_weights(previous_baseline), _extract_weights(current_baseline)
    prev_denom, curr_denom = sum(prev_map.values()), sum(curr_map.values())
    modified = [
        {"task_id": tid, "previous_weight": prev_map[tid], "current_weight": curr_map[tid], "delta": round(curr_map[tid] - prev_map[tid], 2)}
        for tid in prev_map if tid in curr_map and prev_map[tid] != curr_map[tid]
    ]
    return {
        "drift_detected": prev_denom != curr_denom,
        "previous_denominator": round(prev_denom, 2), "current_denominator": round(curr_denom, 2),
        "denominator_delta": round(curr_denom - prev_denom, 2),
        "drift_ratio": round((curr_denom - prev_denom) / prev_denom, 4) if prev_denom > 0.0 else None,
        "added_tasks": sorted(tid for tid in curr_map if tid not in prev_map),
        "removed_tasks": sorted(tid for tid in prev_map if tid not in curr_map),
        "modified_weight_tasks": modified,
    }


# ==============================================================================
# 6. PERT, WBS, RISK, RTM (+ CYCLES/TOPO), SPRINT CAPACITY, DATES & REPORTS
# ==============================================================================

def normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def calculate_pert_estimate(optimistic: float, most_likely: float, pessimistic: float, distribution: str = "beta") -> Dict[str, Any]:
    try:
        o, m, p = float(optimistic), float(most_likely), float(pessimistic)
    except (ValueError, TypeError) as exc:
        return {"is_valid": False, "error": f"Invalid numeric O, M, P: {exc}"}
    if o < 0 or m < 0 or p < 0 or not (o <= m <= p):
        return {"is_valid": False, "error": f"Must satisfy 0 <= O <= M <= P (got {o}, {m}, {p})"}
    dist = distribution.strip().lower()
    if dist == "triangular":
        te = (o + m + p) / 3.0
        var = (o**2 + m**2 + p**2 - o * m - o * p - m * p) / 18.0
        sigma = math.sqrt(max(0.0, var))
    elif dist in {"beta", "pert"}:
        te = (o + 4.0 * m + p) / 6.0
        sigma = (p - o) / 6.0
        var = sigma**2
    else:
        return {"is_valid": False, "error": f"Unsupported distribution '{distribution}'"}
    return {"is_valid": True, "distribution": dist, "optimistic": o, "most_likely": m, "pessimistic": p, "expected_duration": round(te, 4), "standard_deviation": round(sigma, 4), "variance": round(var, 4)}


def calculate_project_pert(critical_path_tasks: Union[List[Dict[str, Any]], Any], target_duration: Optional[float] = None, distribution: str = "beta") -> Dict[str, Any]:
    if not isinstance(critical_path_tasks, list):
        return {"is_valid": False, "error": "critical_path_tasks must be a list", "total_expected_duration": 0.0, "project_variance": 0.0, "project_standard_deviation": 0.0}
    if not critical_path_tasks:
        return {"is_valid": True, "total_tasks": 0, "total_expected_duration": 0.0, "project_variance": 0.0, "project_standard_deviation": 0.0, "confidence_intervals": {"68.27%": [0.0, 0.0], "95.45%": [0.0, 0.0], "99.73%": [0.0, 0.0]}, "target_duration": target_duration, "target_probability": None}
    task_results, total_te, total_var, errors = [], 0.0, 0.0, []
    for idx, t in enumerate(critical_path_tasks):
        if not isinstance(t, dict):
            errors.append(f"Task {idx} is not a dict")
            continue
        tid = t.get("id") or t.get("task_id") or f"Task_{idx + 1}"
        o = t.get("optimistic") if t.get("optimistic") is not None else t.get("o")
        m = t.get("most_likely") if t.get("most_likely") is not None else t.get("m")
        p = t.get("pessimistic") if t.get("pessimistic") is not None else t.get("p")
        if o is None or m is None or p is None:
            errors.append(f"Task '{tid}' missing o/m/p")
            continue
        res = calculate_pert_estimate(o, m, p, distribution=distribution)
        if not res["is_valid"]:
            errors.append(f"Task '{tid}': {res['error']}")
            continue
        total_te += res["expected_duration"]
        total_var += res["variance"]
        task_results.append({"id": tid, **res})
    if errors:
        return {"is_valid": False, "errors": errors, "total_expected_duration": 0.0, "project_variance": 0.0, "project_standard_deviation": 0.0}
    sigma = math.sqrt(total_var)
    z_score = target_prob = None
    if target_duration is not None:
        td = float(target_duration)
        if sigma > 0:
            z_score = round((td - total_te) / sigma, 4)
            target_prob = round(normal_cdf(z_score), 4)
        else:
            z_score, target_prob = 0.0, (1.0 if td >= total_te else 0.0)
    return {
        "is_valid": True, "total_tasks": len(task_results), "total_expected_duration": round(total_te, 4),
        "project_variance": round(total_var, 4), "project_standard_deviation": round(sigma, 4),
        "confidence_intervals": {
            "68.27%": [round(max(0.0, total_te - sigma), 2), round(total_te + sigma, 2)],
            "95.45%": [round(max(0.0, total_te - 2.0 * sigma), 2), round(total_te + 2.0 * sigma, 2)],
            "99.73%": [round(max(0.0, total_te - 3.0 * sigma), 2), round(total_te + 3.0 * sigma, 2)],
        },
        "target_duration": target_duration, "z_score": z_score, "target_probability": target_prob, "task_estimates": task_results,
    }


WBS_CODE_PATTERN = re.compile(r"^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$")


def validate_wbs_hierarchy(wbs_nodes: Union[List[Dict[str, Any]], Any]) -> Dict[str, Any]:
    if not isinstance(wbs_nodes, list):
        return {"is_valid": False, "error": "wbs_nodes must be a list", "total_project_effort": 0.0, "rollups": {}}
    if not wbs_nodes:
        return {"is_valid": True, "total_nodes": 0, "root_nodes": [], "leaf_nodes": [], "total_project_effort": 0.0, "rollups": {}, "warnings": []}
    errors, warnings, node_map, children_map, declared = [], [], {}, {}, {}
    for idx, node in enumerate(wbs_nodes):
        if not isinstance(node, dict):
            errors.append(f"Node {idx} not a dict")
            continue
        code = str(node.get("code") or node.get("wbs_code") or "").strip()
        if not code or not WBS_CODE_PATTERN.match(code) or code in node_map:
            errors.append(f"Invalid or duplicate WBS code '{code}' at {idx}")
            continue
        if not str(node.get("name") or "").strip():
            warnings.append(f"WBS node '{code}' has empty name")
        raw_eff = node.get("effort") if node.get("effort") is not None else node.get("cost", node.get("budget"))
        eff_val = None
        if raw_eff is not None:
            eff_val = float(raw_eff)
            if eff_val < 0.0:
                errors.append(f"Negative effort at '{code}'")
                continue
        node_map[code], declared[code], children_map[code] = node, eff_val, []
    if errors:
        return {"is_valid": False, "errors": errors, "warnings": warnings, "total_project_effort": 0.0, "rollups": {}}
    roots = []
    for code in node_map:
        parts = code.split(".")
        if len(parts) == 1:
            roots.append(code)
        else:
            parent = ".".join(parts[:-1])
            if parent not in node_map:
                errors.append(f"Orphan WBS node '{code}': missing parent '{parent}'")
            else:
                children_map[parent].append(code)
    if errors:
        return {"is_valid": False, "errors": errors, "warnings": warnings, "total_project_effort": 0.0, "rollups": {}}
    leaves = [c for c, ch in children_map.items() if not ch]
    rollups: Dict[str, float] = {}

    def _rollup(code: str) -> float:
        ch = children_map[code]
        if not ch:
            rollups[code] = round(declared[code] or 0.0, 4)
            return rollups[code]
        s = round(sum(_rollup(c) for c in ch), 4)
        if declared[code] is not None and abs(declared[code] - s) > 1e-4:
            errors.append(f"WBS 100% Rule Violation at '{code}': declared={declared[code]}, children_sum={s}")
        rollups[code] = s
        return s

    for r in roots:
        _rollup(r)
    return {
        "is_valid": not errors, "total_nodes": len(node_map), "root_nodes": roots, "leaf_nodes": leaves,
        "total_project_effort": round(sum(rollups[r] for r in roots), 4),
        "rollups": rollups, "errors": errors, "warnings": warnings,
    }


VALID_RISK_STRATEGIES = {"avoid", "mitigate", "transfer", "accept"}
VALID_RISK_STATUSES = {"identified", "analyzed", "mitigating", "closed", "transferred_to_issue"}
RISK_REGISTER_REQUIRED_COLUMNS = ["Risk ID", "Category", "Event", "Cause", "Impact", "Probability", "Impact Rating", "Owner", "Mitigation Strategy"]


def classify_risk_level(score: float) -> str:
    return "CRITICAL" if score >= 0.70 else ("HIGH" if score >= 0.40 else ("MEDIUM" if score >= 0.15 else "LOW"))


def validate_risk_row(row: Union[Dict[str, Any], Any]) -> Tuple[bool, List[str]]:
    if not isinstance(row, dict):
        return False, ["Risk row must be a dict"]
    errors = [f"Missing mandatory risk column: '{col}'" for col in RISK_REGISTER_REQUIRED_COLUMNS if row.get(col) is None or str(row.get(col)).strip() == ""]
    try:
        p = float(row.get("Probability", 0))
        if 1.0 < p <= 100.0:
            p /= 100.0
        if not (0.0 <= p <= 1.0):
            errors.append("Probability must be in [0,1] or [0,100]")
    except (ValueError, TypeError):
        errors.append("Invalid numeric Probability")
    try:
        imp = float(row.get("Impact Rating", 0))
        if not (0.0 <= imp <= 5.0):
            errors.append("Impact Rating must be in [0,5]")
    except (ValueError, TypeError):
        errors.append("Invalid numeric Impact Rating")
    strat = str(row.get("Mitigation Strategy", "")).strip().lower()
    if strat and strat not in VALID_RISK_STRATEGIES:
        errors.append(f"Invalid Mitigation Strategy '{strat}'")
    status = str(row.get("Status", "identified")).strip().lower()
    if status and status not in VALID_RISK_STATUSES:
        errors.append(f"Invalid Status '{status}'")
    return not errors, errors


def analyze_risk_register(risks: Union[List[Dict[str, Any]], Any], default_currency: str = "USD") -> Dict[str, Any]:
    if not isinstance(risks, list):
        return {"is_valid": False, "total_risks": 0, "error": "risks must be a list"}
    row_errors, analyzed, seen, dup_ids, occ_incons = [], [], set(), [], []
    crit, high, med, low = [], [], [], []
    total_emv = reserve = 0.0
    for idx, r in enumerate(risks):
        ok, errs = validate_risk_row(r)
        if not ok:
            row_errors.append((idx, errs))
            continue
        rid = str(r["Risk ID"]).strip()
        if rid in seen:
            dup_ids.append(rid)
        seen.add(rid)
        p = float(r["Probability"])
        if 1.0 < p <= 100.0:
            p /= 100.0
        imp = float(r["Impact Rating"])
        score = p * (imp / 5.0 if imp > 1.0 else imp)
        lvl = classify_risk_level(score)
        m_val = float(r.get("Monetary Impact") or r.get("Cost Impact") or 0.0)
        emv = round(p * m_val, 2)
        total_emv += emv
        status = str(r.get("Status", "identified")).strip().lower()
        if (bool(r.get("Has Occurred", False)) or status == "transferred_to_issue") and status not in {"transferred_to_issue", "closed"}:
            occ_incons.append({"risk_id": rid, "error": "Occurred risk must transition to Issue Log"})
        if status not in {"closed", "transferred_to_issue"}:
            reserve += emv
        analyzed.append({"risk_id": rid, "score": round(score, 4), "level": lvl, "emv": emv, "status": status})
        ({"CRITICAL": crit, "HIGH": high, "MEDIUM": med, "LOW": low})[lvl].append(rid)
    return {
        "is_valid": not row_errors and not dup_ids and not occ_incons,
        "total_risks": len(risks), "valid_risks": len(analyzed), "row_errors": row_errors,
        "duplicate_ids": dup_ids, "critical_risks": crit, "high_risks": high, "medium_risks": med, "low_risks": low,
        "total_emv": round(total_emv, 2), "contingency_reserve": round(reserve, 2),
        "currency": default_currency, "occurred_risk_inconsistencies": occ_incons, "analyzed_risks": analyzed,
    }


RTM_REQUIRED_COLUMNS = ["Requirement ID", "Kind", "Deliverable / WBS", "Implementing Tasks", "Verification Evidence", "Customer Acceptance"]
VALID_RTM_KINDS = {"BUS", "FR", "NFR", "TR", "Functional", "Transition", "PM-Ops"}


def validate_rtm_row(row: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errors: List[str] = []
    if not str(row.get("Requirement ID", row.get("ID", ""))).strip():
        errors.append("Missing mandatory column: 'Requirement ID'")
    for col in RTM_REQUIRED_COLUMNS[1:]:
        if col not in row or (col != "Implementing Tasks" and not str(row[col]).strip()):
            errors.append(f"Missing or empty column: '{col}'")
    kind = str(row.get("Kind", "")).strip()
    if kind and kind not in VALID_RTM_KINDS:
        errors.append(f"Invalid Kind '{kind}'")
    if kind in VALID_RTM_KINDS and kind not in {"Transition", "PM-Ops"}:
        if not str(row.get("Implementing Tasks", "")).strip() or str(row.get("Implementing Tasks", "")).strip().lower() == "none":
            errors.append(f"Kind '{kind}' requires Implementing Task")
    return not errors, errors


def validate_rtm_matrix(rows: List[Dict[str, Any]], all_known_tasks: Optional[Any] = None) -> Dict[str, Any]:
    row_errors, orphans, seen, dups, all_rtm_tasks = [], [], set(), [], set()
    for idx, row in enumerate(rows):
        ok, errs = validate_rtm_row(row)
        if not ok:
            row_errors.append({"row": idx, "errors": errs})
        rid = str(row.get("Requirement ID", row.get("ID", f"ROW_{idx}"))).strip()
        if rid in seen:
            dups.append(rid)
        seen.add(rid)
        parsed = [t.strip() for t in str(row.get("Implementing Tasks", "")).split(",") if t.strip() and t.strip().lower() != "none"]
        all_rtm_tasks.update(parsed)
        if not parsed:
            orphans.append(rid)
    orphan_tasks: List[str] = []
    if all_known_tasks:
        cands = list(all_known_tasks.keys()) if isinstance(all_known_tasks, dict) else [
            str(x.get("task_id", x.get("id", x.get("ID"))) if isinstance(x, dict) else x).strip() for x in all_known_tasks
        ]
        orphan_tasks = [t for t in cands if t and t not in all_rtm_tasks]
    return {
        "is_valid": not row_errors and not orphans and not orphan_tasks and not dups,
        "total_requirements": len(rows), "orphan_requirements": orphans,
        "orphan_tasks": orphan_tasks, "duplicate_requirements": dups, "row_errors": row_errors,
    }


def detect_circular_dependencies(dependencies: Dict[str, Sequence[str]]) -> Tuple[bool, List[List[str]]]:
    visited: Set[str] = set()
    stack: Set[str] = set()
    cycles: List[List[str]] = []

    def _dfs(node: str, path: List[str]) -> None:
        visited.add(node)
        stack.add(node)
        for dep in dependencies.get(node, []):
            if dep not in visited:
                _dfs(dep, path + [dep])
            elif dep in stack:
                idx = path.index(dep) if dep in path else 0
                cycles.append(path[idx:] + [dep])
        stack.remove(node)

    for n in dependencies:
        if n not in visited:
            _dfs(n, [n])
    return len(cycles) > 0, cycles


def topological_sort_tasks(dependencies: Dict[str, Sequence[str]]) -> Tuple[bool, List[str]]:
    has_cycle, _ = detect_circular_dependencies(dependencies)
    if has_cycle:
        return False, []
    in_deg = {n: 0 for n in dependencies}
    rev: Dict[str, List[str]] = {n: [] for n in dependencies}
    for n, preds in dependencies.items():
        for p in preds:
            if p in dependencies:
                in_deg[n] += 1
                rev[p].append(n)
    q = [n for n, d in in_deg.items() if d == 0]
    order: List[str] = []
    while q:
        c = q.pop(0)
        order.append(c)
        for nxt in rev[c]:
            in_deg[nxt] -= 1
            if in_deg[nxt] == 0:
                q.append(nxt)
    return len(order) == len(dependencies), order


def validate_dependency_integrity(tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
    deps: Dict[str, List[str]] = {}
    unknown: List[str] = []
    tids = {str(t.get("id") or t.get("task_id")).strip() for t in tasks if t.get("id") or t.get("task_id")}
    for t in tasks:
        tid = str(t.get("id") or t.get("task_id") or "").strip()
        if not tid:
            continue
        raw = t.get("predecessors") if t.get("predecessors") is not None else t.get("depends_on", [])
        plist = [p.strip() for p in raw.split(",")] if isinstance(raw, str) else [str(p).strip() for p in (raw or [])]
        for p in plist:
            if p and p not in tids:
                unknown.append(f"{tid}->{p}")
        deps[tid] = [p for p in plist if p in tids]
    has_cycle, cycles = detect_circular_dependencies(deps)
    ok_topo, order = topological_sort_tasks(deps)
    return {"is_valid": not unknown and not has_cycle and ok_topo, "unknown_dependencies": unknown, "cycles": cycles, "topological_order": order}


def calculate_owner_capacity_allocation(
    tasks: Union[List[Dict[str, Any]], Any],
    owner_capacities: Dict[str, float],
    default_capacity: Optional[float] = None,
    effort_key: str = "effort",
) -> Dict[str, Any]:
    if not isinstance(tasks, list):
        return {"is_valid": False, "error": "tasks must be a list", "allocations": {}, "overflow_owners": [], "unassigned_tasks": [], "unestimated_tasks": []}
    capacities = dict(owner_capacities or {})
    allocs: Dict[str, Dict[str, Any]] = {}
    unassigned, unestimated, tot_eff = [], [], 0.0
    for idx, t in enumerate(tasks):
        if not isinstance(t, dict):
            continue
        tid = str(t.get("id") or t.get("task_id") or f"TASK_{idx}")
        owner = str(t.get("owner") or t.get("assignee") or "").strip()
        if not owner:
            unassigned.append(tid)
            continue
        raw = t.get(effort_key) if t.get(effort_key) is not None else t.get("remaining_effort", t.get("weight"))
        try:
            eff = float(raw)
            if eff < 0:
                raise ValueError
        except (ValueError, TypeError):
            unestimated.append(tid)
            continue
        if owner not in allocs:
            av = capacities.get(owner, default_capacity)
            allocs[owner] = {"allocated_effort": 0.0, "available_capacity": float(av) if av is not None else 0.0, "task_ids": [], "is_overflow": False, "overflow_hours": 0.0, "utilization": None}
        allocs[owner]["allocated_effort"] += eff
        allocs[owner]["task_ids"].append(tid)
        tot_eff += eff
    overflow, tot_cap = [], 0.0
    for owner, a in allocs.items():
        av, ae = a["available_capacity"], round(a["allocated_effort"], 2)
        a["allocated_effort"] = ae
        tot_cap += av
        if av > 0:
            a["utilization"] = round(ae / av, 4)
            if ae > av:
                a["is_overflow"], a["overflow_hours"] = True, round(ae - av, 2)
                overflow.append(owner)
        else:
            a["is_overflow"], a["overflow_hours"] = True, ae
            overflow.append(owner)
    return {
        "is_valid": not overflow and not unassigned and not unestimated,
        "allocations": allocs, "overflow_owners": overflow, "unassigned_tasks": unassigned,
        "unestimated_tasks": unestimated, "total_allocated_effort": round(tot_eff, 2),
        "total_capacity": round(tot_cap, 2), "team_utilization": round(tot_eff / tot_cap, 4) if tot_cap > 0 else None,
    }


def calculate_sprint_metrics(sprint_tasks: List[Dict[str, Any]], weight_key: str = "effort") -> Dict[str, Any]:
    planned = completed = carryover = scope_added = 0.0
    for t in sprint_tasks:
        w = float(t.get(weight_key) or 0.0)
        st = str(t.get("status", "")).strip().lower()
        if t.get("added_mid_sprint"):
            scope_added += w
        else:
            planned += w
        if st in ("done", "completed", "verified", "closed", "accepted"):
            completed += w
        else:
            carryover += w
    return {
        "planned_effort": round(planned, 2), "completed_velocity": round(completed, 2),
        "carryover_effort": round(carryover, 2), "scope_added_effort": round(scope_added, 2),
        "completion_rate": round(completed / planned, 4) if planned > 0 else 0.0,
        "carryover_rate": round(carryover / (planned + scope_added), 4) if (planned + scope_added) > 0 else 0.0,
    }


def parse_and_validate_date(raw_date_val: Any) -> Dict[str, Any]:
    if raw_date_val is None:
        return {"raw": None, "parsed": None, "is_valid": False, "anomaly": "EMPTY_DATE_VALUE", "parse_error": "None"}
    raw_str = str(raw_date_val).strip()
    if not raw_str:
        return {"raw": raw_str, "parsed": None, "is_valid": False, "anomaly": "EMPTY_DATE_STRING", "parse_error": "Empty"}
    formats = [
        ("%Y-%m-%d", "ISO-8601"), ("%d/%m/%Y", "DD/MM/YYYY"), ("%Y/%m/%d", "YYYY/MM/DD"),
        ("%d-%m-%Y", "DD-MM-YYYY"), ("%b %d, %Y", "MON-D-YYYY"), ("%B %d, %Y", "MONTH-D-YYYY"),
        ("%Y-%m-%dT%H:%M:%S", "ISO-8601-TIMESTAMP"), ("%Y-%m-%dT%H:%M:%SZ", "ISO-8601-UTC"),
    ]
    parsed_dt = matched_fmt = last_err = None
    for fmt, fmt_name in formats:
        try:
            parsed_dt = datetime.strptime(raw_str, fmt)
            matched_fmt = fmt_name
            break
        except ValueError as exc:
            last_err = str(exc)
    if parsed_dt is None:
        note = "IMPOSSIBLE_CALENDAR_DATE_SLIDE_ATTEMPT" if "day is out of range for month" in (last_err or "") else "UNPARSEABLE_FORMAT"
        return {"raw": raw_str, "parsed": None, "is_valid": False, "anomaly": note, "parse_error": last_err}
    anomaly = "EXTREME_PAST_DATE" if parsed_dt.year < 1990 else ("EXTREME_FUTURE_DATE" if parsed_dt.year > 2050 else None)
    return {"raw": raw_str, "parsed": parsed_dt.date().isoformat(), "format": matched_fmt, "is_valid": True, "anomaly": anomaly, "parse_error": None}


def is_weekend_date(date_iso: str) -> bool:
    return datetime.strptime(date_iso[:10], "%Y-%m-%d").weekday() >= 5


def calculate_working_days(start_iso: str, end_iso: str, holidays: Optional[Set[str]] = None) -> int:
    s = datetime.strptime(start_iso[:10], "%Y-%m-%d").date()
    e = datetime.strptime(end_iso[:10], "%Y-%m-%d").date()
    if e < s:
        return 0
    hols = holidays or set()
    cur, cnt = s, 0
    while cur <= e:
        if cur.weekday() < 5 and cur.isoformat() not in hols:
            cnt += 1
        cur += timedelta(days=1)
    return cnt


def detect_schedule_date_anomalies(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    anomalies: List[Dict[str, Any]] = []
    for t in tasks:
        tid = str(t.get("task_id", t.get("id", t.get("ID", "Unknown"))))
        start_res = parse_and_validate_date(t.get("start_date", t.get("start")))
        end_res = parse_and_validate_date(t.get("end_date", t.get("end", t.get("finish"))))
        if not start_res["is_valid"]:
            anomalies.append({"task_id": tid, "field": "start_date", "anomaly": start_res["anomaly"], "raw": start_res["raw"]})
            continue
        if not end_res["is_valid"]:
            anomalies.append({"task_id": tid, "field": "end_date", "anomaly": end_res["anomaly"], "raw": end_res["raw"]})
            continue
        if start_res["anomaly"]:
            anomalies.append({"task_id": tid, "field": "start_date", "anomaly": start_res["anomaly"], "raw": start_res["raw"]})
        if end_res["anomaly"]:
            anomalies.append({"task_id": tid, "field": "end_date", "anomaly": end_res["anomaly"], "raw": end_res["raw"]})
        if end_res["parsed"] < start_res["parsed"]:
            anomalies.append({"task_id": tid, "field": "range", "anomaly": "DATE_INVERSION", "start": start_res["parsed"], "end": end_res["parsed"]})
        if t.get("is_milestone"):
            if start_res["parsed"] != end_res["parsed"]:
                anomalies.append({"task_id": tid, "field": "milestone", "anomaly": "MILESTONE_DATE_MISMATCH"})
            if float(t.get("duration") or 0) > 0:
                anomalies.append({"task_id": tid, "field": "milestone", "anomaly": "MILESTONE_NONZERO_DURATION"})
    return anomalies


def flag_weekend_deliveries(tasks: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    hits = []
    for t in tasks:
        tid = str(t.get("task_id", t.get("id", "Unknown")))
        res = parse_and_validate_date(t.get("end_date", t.get("end", t.get("finish"))))
        if res["is_valid"] and is_weekend_date(res["parsed"]):
            hits.append({"task_id": tid, "end_date": res["parsed"]})
    return hits


def generate_pmo_status_report(
    project_name: str, reporting_period: str, cutoff_date: str, baseline_version: str,
    audience: str = "internal", verified_delivery_data: Optional[Dict[str, Any]] = None,
    evm_data: Optional[Dict[str, Any]] = None, capacity_data: Optional[Dict[str, Any]] = None,
    raid_items: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    v_data, e_data, c_data, r_items = verified_delivery_data or {}, evm_data or {}, capacity_data or {}, raid_items or []
    vd_pct = v_data.get("verified_delivery")
    pct_str = f"{vd_pct * 100:.1f}%" if isinstance(vd_pct, (int, float)) else "N/A"
    rag = e_data.get("rag", "GREEN" if vd_pct and vd_pct >= 0.9 else "AMBER")
    lines = [
        f"# PMO Status Report — {project_name}",
        f"- **Reporting Period:** {reporting_period} | **Cutoff:** {cutoff_date} | **Baseline:** {baseline_version}",
        f"- **Audience:** {audience} | **Overall RAG:** **{rag}**",
        "", "## 1. Verified Delivery & EVM Summary",
        f"- **Verified Delivery:** {pct_str} (Numerator: {v_data.get('numerator', 0)} / Denominator: {v_data.get('denominator', 0)})",
        f"- **EVM:** PV={e_data.get('pv', 'N/A')}, EV={e_data.get('ev', 'N/A')}, AC={e_data.get('ac', 'N/A')}, SPI={e_data.get('spi', 'N/A')}, CPI={e_data.get('cpi', 'N/A')}",
        f"- **Team Utilization:** {c_data.get('team_utilization', 'N/A')} | **Overflow Owners:** {c_data.get('overflow_owners', [])}",
        "", "## 2. Open Risks / Issues / Decisions",
    ]
    if r_items:
        for idx, item in enumerate(r_items, 1):
            lines.append(f"- [{str(item.get('category', 'RISK')).upper()}] **{item.get('title', f'Item {idx}')}** — Owner: {item.get('owner', 'Unassigned')}, Due: {item.get('due_date', 'TBD')}")
    else:
        lines.append("- *No open RAID items registered.*")
    return {"project_name": project_name, "reporting_period": reporting_period, "cutoff_date": cutoff_date, "baseline_version": baseline_version, "audience": audience, "rag": rag, "verified_delivery_percentage": pct_str, "markdown": "\n".join(lines)}


def audit_report_evidence(tasks: Union[List[Dict[str, Any]], Any], cutoff_date: Optional[str] = None) -> Dict[str, Any]:
    if not isinstance(tasks, list):
        return {"is_valid": False, "is_clean": False, "error": "tasks must be a list", "findings": [], "audit_findings": [], "risk_level": "HIGH"}
    findings: List[Dict[str, Any]] = []
    for idx, task in enumerate(tasks):
        if not isinstance(task, dict):
            continue
        tid = str(task.get("id") or task.get("task_id") or f"TASK_{idx}")
        status = str(task.get("status") or task.get("state") or "").strip().lower()
        is_done = bool(task.get("is_done")) or status in ("done", "completed", "verified", "accepted")
        ev_raw = task.get("evidence") or task.get("verification_evidence")
        has_ev = bool(str(ev_raw).strip()) if ev_raw is not None else False
        ev_date = task.get("evidence_date")
        est = task.get("effort") if task.get("effort") is not None else task.get("weight")
        pct = task.get("reported_pct", task.get("percent_complete"))
        if is_done and not has_ev:
            findings.append({"task_id": tid, "code": "MISSING_VERIFICATION_EVIDENCE", "severity": "HIGH"})
        if cutoff_date and ev_date and str(ev_date) > str(cutoff_date):
            findings.append({"task_id": tid, "code": "FUTURE_DATED_EVIDENCE", "severity": "HIGH", "evidence_date": ev_date})
        if pct is not None and float(pct) >= 90 and not has_ev:
            findings.append({"task_id": tid, "code": "SELF_REPORTED_PROGRESS", "severity": "HIGH", "reported_pct": pct})
        if est is None or (isinstance(est, (int, float)) and est <= 0):
            findings.append({"task_id": tid, "code": "ZERO_OR_MISSING_ESTIMATE", "severity": "MEDIUM"})
    highs = sum(1 for f in findings if f["severity"] == "HIGH")
    risk_level = "CRITICAL" if highs >= 2 else ("HIGH" if highs == 1 else ("MEDIUM" if findings else "LOW"))
    return {"is_valid": not findings, "is_clean": not findings, "risk_level": risk_level, "total_findings": len(findings), "findings": findings, "audit_findings": findings}
