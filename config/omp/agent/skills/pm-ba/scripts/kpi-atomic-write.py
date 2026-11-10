#!/usr/bin/env python3
"""
kpi-atomic-write.py — Atomic write helper for KPI state files

CLI:
  python kpi-atomic-write.py <target-file> --content-stdin \
    [--lock-session-id ID] [--mode kpi-track]

Steps:
  1. Acquire lock → write <target>.lock {session_id, started_at, pid}
  2. Snapshot prior version → move <target> → <target>.prev
  3. Read content from stdin (full new body + frontmatter)
  4. Recompute body_hash from new fenced content; replace frontmatter field
  5. Write to <target>.tmp
  6. os.replace(<target>.tmp, <target>)
  7. Release lock → delete <target>.lock
  8. Append audit-log row via kpi-state-integrity.py --validate-audit-append

Exit codes:
  0 = OK
  1 = lock conflict
  2 = integrity violation
  3 = I/O error

Failure modes:
  - Any step fails → delete <target>.tmp; preserve <target>.prev; exit non-zero.
  - Audit append (step 8) failure → rollback from .prev; exit 2.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

LOCK_TTL_SECONDS = 300  # 5 minutes
FENCE_START = "<!-- KPI-PROTECTED-START -->"
FENCE_END = "<!-- KPI-PROTECTED-END -->"
AUDIT_LOG_FILENAME = "pm-ba-kpi-audit-log.md"
GENESIS_HASH = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

SCRIPT_DIR = Path(__file__).parent
INTEGRITY_SCRIPT = SCRIPT_DIR / "kpi-state-integrity.py"

# ---------------------------------------------------------------------------
# Helpers (duplicated from integrity script to avoid import coupling)
# ---------------------------------------------------------------------------

def normalize_body(content: str) -> str:
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    content = unicodedata.normalize("NFC", content)
    lines = [line.rstrip() for line in content.split("\n")]
    return "\n".join(lines).rstrip("\n") + "\n"


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_body_hash(fenced_content: str) -> str:
    return "sha256:" + sha256_hex(normalize_body(fenced_content))


def extract_fenced_body(body: str) -> Optional[str]:
    start_idx = body.find(FENCE_START)
    end_idx = body.find(FENCE_END)
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        return None
    between = body[start_idx + len(FENCE_START):end_idx]
    if between.startswith("\n"):
        between = between[1:]
    return between


def split_frontmatter(raw: str) -> tuple[str, str]:
    """Return (frontmatter_block, body). frontmatter_block includes --- delimiters."""
    if not raw.startswith("---"):
        return "", raw
    end = raw.find("\n---", 3)
    if end == -1:
        return "", raw
    fm_block = raw[:end + 4]
    body = raw[end + 4:].lstrip("\n")
    return fm_block, body


def inject_body_hash(raw_content: str, new_hash: str) -> str:
    """Replace or insert body_hash field in frontmatter."""
    if re.search(r"^body_hash:", raw_content, flags=re.MULTILINE):
        return re.sub(
            r"^body_hash:.*$",
            f"body_hash: {new_hash}",
            raw_content,
            flags=re.MULTILINE
        )
    # Insert after opening ---
    return raw_content.replace("---\n", f"---\nbody_hash: {new_hash}\n", 1)


def current_audit_tail(audit_log: Path) -> str:
    """Compute current tail hash of audit log."""
    if not audit_log.exists():
        return GENESIS_HASH
    try:
        raw = audit_log.read_text(encoding="utf-8")
    except OSError:
        return GENESIS_HASH

    data_rows: list[str] = []
    for line in raw.split("\n"):
        stripped = line.strip()
        if stripped.startswith("|") and not re.match(r"^\|[-| ]+\|$", stripped):
            if "Timestamp" in stripped and "State File" in stripped:
                continue
            data_rows.append(stripped)

    if not data_rows:
        return GENESIS_HASH
    return "sha256:" + sha256_hex(normalize_body(data_rows[-1]))


def build_audit_row(
    target: Path,
    mode: str,
    session_id: str,
    body_hash: str,
    prev_row_hash: str,
    action: str = "write",
) -> str:
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cols = [ts, target.name, mode, session_id, action, body_hash, prev_row_hash]
    return "| " + " | ".join(cols) + " |"


# ---------------------------------------------------------------------------
# Lock management
# ---------------------------------------------------------------------------

def acquire_lock(lock_path: Path, session_id: str) -> Optional[str]:
    """
    Attempt to acquire lock. Returns None on success, error message on conflict.
    Clears stale locks (> TTL).
    """
    if lock_path.exists():
        try:
            mtime = lock_path.stat().st_mtime
            import time
            age = time.time() - mtime
        except OSError:
            age = LOCK_TTL_SECONDS + 1  # Treat as stale

        if age < LOCK_TTL_SECONDS:
            try:
                lock_data = json.loads(lock_path.read_text(encoding="utf-8"))
                if lock_data.get("session_id") != session_id:
                    started = lock_data.get("started_at", "unknown")
                    locked_by = lock_data.get("session_id", "unknown")
                    return f"State locked by session {locked_by} since {started}; retry in 5min."
            except Exception:
                pass
        else:
            # Stale lock — clear it
            try:
                lock_path.unlink()
            except OSError:
                pass

    lock_data = {
        "session_id": session_id,
        "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "pid": os.getpid()
    }
    try:
        lock_path.write_text(json.dumps(lock_data), encoding="utf-8")
    except OSError as exc:
        return f"Could not write lock file: {exc}"
    return None


def release_lock(lock_path: Path) -> None:
    try:
        if lock_path.exists():
            lock_path.unlink()
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Main write pipeline
# ---------------------------------------------------------------------------

def atomic_write(
    target: Path,
    new_content: str,
    session_id: str,
    mode: str,
) -> int:
    """
    Execute atomic write pipeline. Returns exit code (0=OK, 1=lock, 2=violation, 3=I/O).
    """
    tmp_path = Path(str(target) + ".tmp")
    prev_path = Path(str(target) + ".prev")
    lock_path = Path(str(target) + ".lock")

    # Step 1: Acquire lock
    lock_error = acquire_lock(lock_path, session_id)
    if lock_error:
        print(f"ERROR [lock-conflict]: {lock_error}", file=sys.stderr)
        return 1

    try:
        # Step 2: Snapshot prior version
        if target.exists():
            try:
                shutil.copy2(str(target), str(prev_path))
            except OSError as exc:
                print(f"ERROR [snapshot]: Could not snapshot to .prev: {exc}", file=sys.stderr)
                return 3

        # Step 3 + 4: Recompute body_hash and inject into content
        fm_block, body = split_frontmatter(new_content)
        fenced = extract_fenced_body(body)
        if fenced is not None:
            new_hash = compute_body_hash(fenced)
            new_content = inject_body_hash(new_content, new_hash)
        else:
            # No fence markers — cannot compute hash; write as-is but warn
            print(
                "WARN: No KPI fence markers found in new content. body_hash not updated.",
                file=sys.stderr
            )
            new_hash = "sha256:unfenced"

        # Step 5: Write to .tmp
        try:
            tmp_path.write_text(new_content, encoding="utf-8")
        except OSError as exc:
            print(f"ERROR [tmp-write]: {exc}", file=sys.stderr)
            return 3

        # Step 6: Atomic replace
        try:
            os.replace(str(tmp_path), str(target))
        except OSError as exc:
            print(f"ERROR [os.replace]: {exc}", file=sys.stderr)
            # Rollback: restore from .prev if available
            if prev_path.exists():
                try:
                    shutil.copy2(str(prev_path), str(target))
                except OSError:
                    pass
            return 3

        # Step 7: (RESERVED — lock held through audit-append per H2 fix)
        # H2 review: release moved to AFTER audit-append success to close concurrency window
        # between os.replace() and audit-log write. The `finally` block handles abort paths.

        # Step 8: Append audit-log row (lock still held)
        docs_dir = target.parent
        audit_log = docs_dir / AUDIT_LOG_FILENAME
        tail_hash = current_audit_tail(audit_log)
        audit_row = build_audit_row(
            target=target,
            mode=mode,
            session_id=session_id,
            body_hash=new_hash,
            prev_row_hash=tail_hash,
            action="write",
        )

        # Validate via integrity script before appending
        python = sys.executable
        try:
            result = subprocess.run(
                [python, str(INTEGRITY_SCRIPT), str(audit_log), "--validate-audit-append"],
                input=audit_row,
                capture_output=True,
                text=True,
                timeout=10
            )
        except subprocess.TimeoutExpired:
            print("ERROR [audit-append]: Integrity script timed out.", file=sys.stderr)
            # Rollback
            if prev_path.exists():
                try:
                    os.replace(str(prev_path), str(target))
                except OSError:
                    pass
            return 2

        if result.returncode != 0:
            print(f"ERROR [audit-append]: Chain validation failed:\n{result.stderr}", file=sys.stderr)
            # Rollback: restore from .prev
            if prev_path.exists():
                try:
                    os.replace(str(prev_path), str(target))
                except OSError:
                    pass
            return 2

        # Append to audit log
        try:
            with audit_log.open("a", encoding="utf-8") as f:
                f.write(audit_row + "\n")
        except OSError as exc:
            print(f"ERROR [audit-log-write]: {exc}", file=sys.stderr)
            # Rollback
            if prev_path.exists():
                try:
                    os.replace(str(prev_path), str(target))
                except OSError:
                    pass
            return 3

        # Step 9 (H2 fix): release lock AFTER audit-append success
        release_lock(lock_path)

        return 0

    except Exception as exc:
        # Unexpected failure — fail-closed
        print(f"ERROR [unexpected]: {exc}", file=sys.stderr)
        # Cleanup tmp
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        release_lock(lock_path)
        return 3

    finally:
        # Ensure lock always released on exit path (idempotent)
        release_lock(lock_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Atomic write helper for KPI state files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("target_file", help="Target state file path")
    p.add_argument("--content-stdin", action="store_true", required=True,
                   help="Read new file content from stdin")
    p.add_argument("--lock-session-id", default="default-session",
                   help="Session ID for lock acquisition (default: default-session)")
    p.add_argument("--mode", default="unknown",
                   help="KPI mode name for audit row (e.g. kpi-track)")
    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    target = Path(args.target_file)
    if not target.parent.exists():
        print(f"ERROR: Target directory does not exist: {target.parent}", file=sys.stderr)
        return 3

    new_content = sys.stdin.read()
    if not new_content.strip():
        print("ERROR: stdin content is empty.", file=sys.stderr)
        return 2

    return atomic_write(
        target=target,
        new_content=new_content,
        session_id=args.lock_session_id,
        mode=args.mode,
    )


if __name__ == "__main__":
    sys.exit(main())
