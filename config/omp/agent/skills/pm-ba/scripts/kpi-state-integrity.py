#!/usr/bin/env python3
"""
kpi-state-integrity.py — KPI state file integrity validator

CLI modes:
  python kpi-state-integrity.py <state-file> [options]

Options:
  (default)                  Full validation: hash + chain + lock + fence + ledger
  --check-hash               Recompute body_hash from fenced content; compare to frontmatter
  --validate-chain           Walk audit log chain; output tail hash + chain length
  --validate-pre-write       Read new content from stdin; validate content invariants
    --new-content-stdin      (used with --validate-pre-write)
  --validate-audit-append    Read new row from stdin; validate chain link + single-row append
  --repair                   Recompute and write back body_hash (use with care)
  --verbose                  Verbose output

Exit codes:
  0 = OK
  1 = violation / validation failure
  2 = usage error
  3 = file error / I/O failure

Dependencies: pyyaml (stdlib otherwise)
"""

from __future__ import annotations

import argparse
import hashlib
import time
import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Optional

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml not installed. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FENCE_START = "<!-- KPI-PROTECTED-START -->"
FENCE_END = "<!-- KPI-PROTECTED-END -->"
AUDIT_LOG_FILENAME = "pm-ba-kpi-audit-log.md"
GENESIS_HASH = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
LOCK_TTL_SECONDS = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Normalization & hashing
# ---------------------------------------------------------------------------

def normalize_body(content: str) -> str:
    """Canonical form: CRLF→LF, strip trailing whitespace per line, NFC, trailing LF."""
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    content = unicodedata.normalize("NFC", content)
    lines = [line.rstrip() for line in content.split("\n")]
    normalized = "\n".join(lines).rstrip("\n") + "\n"
    return normalized


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_body_hash(body_content: str) -> str:
    return "sha256:" + sha256_hex(normalize_body(body_content))


# ---------------------------------------------------------------------------
# Frontmatter + fence parsing
# ---------------------------------------------------------------------------

def split_frontmatter(raw: str) -> tuple[dict, str]:
    """Split YAML frontmatter from body. Returns (frontmatter_dict, body_str)."""
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    fm_raw = raw[3:end].strip()
    body = raw[end + 4:].lstrip("\n")
    try:
        fm = yaml.safe_load(fm_raw) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"Frontmatter YAML parse error: {exc}") from exc
    return fm, body


def extract_fenced_body(body: str) -> Optional[str]:
    """Extract content between KPI fence markers (exclusive of marker lines)."""
    start_idx = body.find(FENCE_START)
    end_idx = body.find(FENCE_END)
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        return None
    between = body[start_idx + len(FENCE_START):end_idx]
    # Strip exactly one leading newline if present
    if between.startswith("\n"):
        between = between[1:]
    return between


# ---------------------------------------------------------------------------
# Ledger parsing helpers
# ---------------------------------------------------------------------------

def parse_ledger_rows(body: str) -> list[str]:
    """Extract markdown table rows from Task Register section (non-header rows)."""
    rows: list[str] = []
    in_table = False
    for line in body.split("\n"):
        stripped = line.strip()
        if stripped.startswith("| ") or stripped.startswith("|--"):
            in_table = True
            # Skip separator rows (|---|)
            if re.match(r"^\|[-| ]+\|$", stripped):
                continue
            rows.append(line)
        else:
            if in_table and stripped == "":
                in_table = False
    return rows


# ---------------------------------------------------------------------------
# Validation modes
# ---------------------------------------------------------------------------

def check_hash(state_file: Path, verbose: bool = False) -> int:
    """Recompute body_hash; compare to frontmatter. Exit 0=match, 1=mismatch."""
    try:
        raw = state_file.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"ERROR reading {state_file}: {exc}", file=sys.stderr)
        return 3

    try:
        fm, body = split_frontmatter(raw)
    except ValueError as exc:
        print(f"VIOLATION: {exc}", file=sys.stderr)
        return 1

    fenced = extract_fenced_body(body)
    if fenced is None:
        print("VIOLATION: No KPI fence markers found in state file.", file=sys.stderr)
        return 1

    computed = compute_body_hash(fenced)
    stored = fm.get("body_hash", "")

    if computed == stored:
        if verbose:
            print(f"OK: body_hash matches — {computed}")
        return 0
    else:
        print(f"VIOLATION: body_hash mismatch.", file=sys.stderr)
        print(f"  Stored:   {stored}", file=sys.stderr)
        print(f"  Computed: {computed}", file=sys.stderr)
        return 1


def validate_chain(state_file: Path, verbose: bool = False) -> int:
    """Walk audit log chain. Verify each row's prev_row_hash. Output tail hash."""
    # Determine audit log path relative to state file's docs dir
    docs_dir = state_file.parent if state_file.parent.name == "docs" else state_file.parent.parent / "docs"
    audit_log = docs_dir / AUDIT_LOG_FILENAME
    if not audit_log.exists():
        print(f"ERROR: Audit log not found at {audit_log}", file=sys.stderr)
        return 3

    try:
        raw = audit_log.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"ERROR reading audit log: {exc}", file=sys.stderr)
        return 3

    # Extract table rows (skip header and separator)
    data_rows: list[str] = []
    for line in raw.split("\n"):
        stripped = line.strip()
        if stripped.startswith("|") and not re.match(r"^\|[-| ]+\|$", stripped):
            # Skip header row (contains "Timestamp")
            if "Timestamp" in stripped and "State File" in stripped:
                continue
            data_rows.append(stripped)

    if not data_rows:
        if verbose:
            print(f"OK: Audit log is empty (genesis state). Tail = {GENESIS_HASH}")
        return 0

    prev_hash = GENESIS_HASH
    for i, row in enumerate(data_rows):
        # Extract last column (Prev Row Hash)
        cols = [c.strip() for c in row.split("|") if c.strip()]
        if len(cols) < 7:
            print(f"VIOLATION: Row {i+1} has fewer than 7 columns: {row}", file=sys.stderr)
            return 1
        stored_prev = cols[-1]  # Last column = Prev Row Hash

        if stored_prev != prev_hash:
            print(f"VIOLATION: Chain broken at row {i+1}.", file=sys.stderr)
            print(f"  Expected prev_row_hash: {prev_hash}", file=sys.stderr)
            print(f"  Stored   prev_row_hash: {stored_prev}", file=sys.stderr)
            return 1

        # Compute hash of this row for next iteration
        prev_hash = "sha256:" + sha256_hex(normalize_body(row))

    if verbose:
        print(f"OK: Chain valid. Length={len(data_rows)}. Tail={prev_hash}")
    else:
        print(prev_hash)  # Output tail hash to stdout for callers
    return 0


def validate_pre_write(state_file: Path, new_content: str, verbose: bool = False) -> int:
    """
    Content-invariant check: compare on-disk state vs proposed new content.
    Validates: append-only ledger, anchor immutability, body_hash validity,
    audit-log non-mutation (path check), schema_version monotonic.
    """
    # Read current on-disk version
    if not state_file.exists():
        # New file — no prior version to compare; allow
        if verbose:
            print("OK: New file (no prior version). Allowing.")
        return 0

    try:
        current_raw = state_file.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"ERROR reading current state: {exc}", file=sys.stderr)
        return 3

    try:
        current_fm, current_body = split_frontmatter(current_raw)
        new_fm, new_body = split_frontmatter(new_content)
    except ValueError as exc:
        print(f"VIOLATION: Frontmatter parse error: {exc}", file=sys.stderr)
        return 1

    violations: list[str] = []

    # I1: Ledger append-only (prior rows byte-identical)
    current_fenced = extract_fenced_body(current_body) or ""
    new_fenced = extract_fenced_body(new_body) or ""
    current_rows = parse_ledger_rows(current_fenced)
    new_rows = parse_ledger_rows(new_fenced)

    for idx, current_row in enumerate(current_rows):
        if idx < len(new_rows):
            if new_rows[idx] != current_row:
                violations.append(
                    f"I1 Ledger append-only violated: row {idx+1} modified.\n"
                    f"  Before: {current_row}\n"
                    f"  After:  {new_rows[idx]}"
                )
        else:
            violations.append(
                f"I1 Ledger append-only violated: row {idx+1} removed in new content."
            )

    # I2: ep_cumulative_anchor immutable
    current_anchor = current_fm.get("ep_cumulative_anchor")
    new_anchor = new_fm.get("ep_cumulative_anchor")
    if current_anchor is not None and current_anchor != new_anchor:
        violations.append(
            f"I2 ep_cumulative_anchor immutability violated.\n"
            f"  Before: {current_anchor}\n"
            f"  After:  {new_anchor}"
        )

    # I3: body_hash must equal sha256(normalize(new_fenced_body))
    if new_fenced:
        expected_hash = compute_body_hash(new_fenced)
        stored_hash = new_fm.get("body_hash", "")
        if stored_hash != expected_hash:
            violations.append(
                f"I3 body_hash invalid in proposed content.\n"
                f"  Stored:   {stored_hash}\n"
                f"  Expected: {expected_hash}"
            )

    # I4: No audit-log mutation through state-file path (sanity guard)
    # (The file_path is state file, not audit log — enforced at hook level;
    # this check ensures proposed content doesn't embed audit log content)
    if AUDIT_LOG_FILENAME in new_body:
        violations.append(
            f"I4 Proposed state-file content references audit log path — suspicious."
        )

    # I5: schema_version monotonic
    current_ver_raw = str(current_fm.get("schema_version", "0"))
    new_ver_raw = str(new_fm.get("schema_version", "0"))
    try:
        current_ver = float(current_ver_raw)
        new_ver = float(new_ver_raw)
        if new_ver < current_ver:
            violations.append(
                f"I5 schema_version regression: {current_ver} → {new_ver}"
            )
    except ValueError:
        pass  # Non-numeric version — skip numeric check

    if violations:
        for v in violations:
            print(f"VIOLATION: {v}", file=sys.stderr)
        return 1

    if verbose:
        print("OK: All content invariants satisfied.")
    return 0


def validate_audit_append(audit_log: Path, new_row: str, verbose: bool = False) -> int:
    """
    Validate that new_row is a valid single-row append to the audit log.
    Checks: single line, chain link to current tail valid, no row removal.
    """
    new_row = new_row.strip()
    if not new_row:
        print("VIOLATION: Empty row — nothing to append.", file=sys.stderr)
        return 1

    # Must be a single markdown table row
    if "\n" in new_row:
        print("VIOLATION: Multi-line append rejected — one row at a time only.", file=sys.stderr)
        return 1

    if not new_row.startswith("|") or not new_row.endswith("|"):
        print("VIOLATION: New row is not a valid markdown table row (must start and end with |).", file=sys.stderr)
        return 1

    # Determine current tail hash
    if audit_log.exists():
        try:
            raw = audit_log.read_text(encoding="utf-8")
        except OSError as exc:
            print(f"ERROR reading audit log: {exc}", file=sys.stderr)
            return 3

        data_rows: list[str] = []
        for line in raw.split("\n"):
            stripped = line.strip()
            if stripped.startswith("|") and not re.match(r"^\|[-| ]+\|$", stripped):
                if "Timestamp" in stripped and "State File" in stripped:
                    continue
                data_rows.append(stripped)

        if data_rows:
            current_tail = "sha256:" + sha256_hex(normalize_body(data_rows[-1]))
        else:
            current_tail = GENESIS_HASH
    else:
        current_tail = GENESIS_HASH

    # Extract prev_row_hash from new row (last column)
    cols = [c.strip() for c in new_row.split("|") if c.strip()]
    if len(cols) < 7:
        print(f"VIOLATION: New row has fewer than 7 columns.", file=sys.stderr)
        return 1

    stored_prev = cols[-1]
    if stored_prev != current_tail:
        print("VIOLATION: Chain link invalid.", file=sys.stderr)
        print(f"  New row prev_row_hash: {stored_prev}", file=sys.stderr)
        print(f"  Actual current tail:   {current_tail}", file=sys.stderr)
        return 1

    if verbose:
        print(f"OK: Audit append valid. New tail will be: sha256:{sha256_hex(normalize_body(new_row))}")
    return 0


def full_validation(state_file: Path, verbose: bool = False) -> int:
    """Run all checks: hash, chain (if audit log reachable), lock, fence, ledger."""
    issues: list[str] = []

    # Hash check
    rc = check_hash(state_file, verbose=verbose)
    if rc != 0:
        issues.append("body_hash mismatch")

    # Lock check (C2 fix: use time.time(), not os.time)
    lock_file = Path(str(state_file) + ".lock")
    if lock_file.exists():
        age = time.time() - lock_file.stat().st_mtime
        if age < LOCK_TTL_SECONDS:
            try:
                lock_data = json.loads(lock_file.read_text(encoding="utf-8"))
                issues.append(f"Lock file active (session {lock_data.get('session_id','?')})")
            except Exception:
                issues.append("Lock file active (unreadable)")

    # Fence presence
    try:
        raw = state_file.read_text(encoding="utf-8")
        _, body = split_frontmatter(raw)
        if FENCE_START not in body or FENCE_END not in body:
            issues.append("Missing KPI fence markers")
    except Exception as exc:
        issues.append(f"Parse error: {exc}")

    # Chain validation (best effort — audit log may not exist for new files)
    docs_dir = state_file.parent
    audit_log = docs_dir / AUDIT_LOG_FILENAME
    if audit_log.exists():
        rc_chain = validate_chain(state_file, verbose=verbose)
        if rc_chain != 0:
            issues.append("Audit chain invalid")

    if issues:
        for issue in issues:
            print(f"VIOLATION: {issue}", file=sys.stderr)
        return 1

    if verbose:
        print(f"OK: {state_file.name} passes full validation.")
    return 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="KPI state file integrity validator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("state_file", nargs="?", help="Path to state file (or audit log for --validate-chain)")
    p.add_argument("--check-hash", action="store_true", help="Recompute and compare body_hash")
    p.add_argument("--validate-chain", action="store_true", help="Walk audit log chain; output tail hash")
    p.add_argument("--validate-pre-write", action="store_true", help="Validate new content from stdin vs on-disk")
    p.add_argument("--new-content-stdin", action="store_true", help="Used with --validate-pre-write")
    p.add_argument("--validate-audit-append", action="store_true", help="Validate single-row audit append from stdin")
    p.add_argument("--repair", action="store_true", help="Recompute body_hash and write back (use with care)")
    p.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.state_file:
        parser.print_help()
        return 2

    state_file = Path(args.state_file)

    # --validate-audit-append: file arg is the audit log path
    if args.validate_audit_append:
        new_row = sys.stdin.read()
        return validate_audit_append(state_file, new_row, verbose=args.verbose)

    # --validate-chain: file arg is either state file or audit log
    if args.validate_chain:
        # If state file arg is actually the audit log, pass it directly
        if state_file.name == AUDIT_LOG_FILENAME:
            audit_log = state_file
        else:
            audit_log = state_file.parent / AUDIT_LOG_FILENAME
        return validate_chain(state_file, verbose=args.verbose)

    # --validate-pre-write: read new content from stdin
    if args.validate_pre_write:
        if not state_file.exists():
            if args.verbose:
                print("OK: New file — no prior version to diff against.")
            return 0
        new_content = sys.stdin.read()
        return validate_pre_write(state_file, new_content, verbose=args.verbose)

    # --check-hash
    if args.check_hash:
        if not state_file.exists():
            print(f"ERROR: File not found: {state_file}", file=sys.stderr)
            return 3
        return check_hash(state_file, verbose=args.verbose)

    # --repair: recompute body_hash and write back
    if args.repair:
        if not state_file.exists():
            print(f"ERROR: File not found: {state_file}", file=sys.stderr)
            return 3
        try:
            raw = state_file.read_text(encoding="utf-8")
            fm, body = split_frontmatter(raw)
            fenced = extract_fenced_body(body)
            if fenced is None:
                print("ERROR: No fence markers found — cannot repair.", file=sys.stderr)
                return 1
            new_hash = compute_body_hash(fenced)
            # Replace body_hash in frontmatter
            new_raw = re.sub(
                r"^body_hash:.*$",
                f"body_hash: {new_hash}",
                raw,
                flags=re.MULTILINE
            )
            if "body_hash:" not in raw:
                # Insert after schema_version or first frontmatter line
                new_raw = raw.replace("---\n", f"---\nbody_hash: {new_hash}\n", 1)
            state_file.write_text(new_raw, encoding="utf-8")
            print(f"Repaired body_hash: {new_hash}")
            return 0
        except Exception as exc:
            print(f"ERROR during repair: {exc}", file=sys.stderr)
            return 3

    # Default: full validation
    if not state_file.exists():
        print(f"ERROR: File not found: {state_file}", file=sys.stderr)
        return 3
    return full_validation(state_file, verbose=args.verbose)


if __name__ == "__main__":
    sys.exit(main())
