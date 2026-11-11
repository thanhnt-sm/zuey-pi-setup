#!/usr/bin/env python3
"""
harvester_core.py — Canonical Multi-Source OMP & Claude Harvester + Incremental Loop Engine

Sources covered (read-only):
1. OMP transcripts (~/.omp/agent/sessions/**/*.jsonl) — write, edit, indexed eval, bash heredocs/inline
2. Claude transcripts (~/.claude/projects/**/*.jsonl & history.jsonl) — Write, Edit, Bash, Workflow
3. OMP history SQLite (~/.omp/agent/history.db) — distinct cwds & recap counts (no raw prompt export)
4. Local workspaces + .omp/.claude/.agent directories via config/harvest-workspaces.json + ~/.omp/harvest-workspaces.local.json
"""

from __future__ import annotations

import argparse
import fnmatch
import glob
import hashlib
import json
import os
import re
import sqlite3
import stat
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

SUITE_PATTERNS: Dict[str, List[str]] = {
    "pmo_project_suite": [
        r"\bwbs\b", r"\bcpm\b", r"\bevm\b", r"\bpert\b", r"critical_path", r"float_calc",
        r"earned_value", r"msproject", r"\bmpp\b", r"\braid\b", r"\bpmo\.py\b",
        r"MSProject\.Application", r"schedule_calc", r"pmi[-_]pmo", r"obligation", r"change_request",
    ],
    "office_doc_suite": [
        r"\bopenpyxl\b", r"python-docx", r"\bdocx\b", r"\bxlsxwriter\b", r"\bmermaid\b",
        r"spatial_extract", r"receipt_extract", r"md-convert", r"markitdown",
        r"table_extract", r"pdfplumber", r"\bpypdf\b", r"export_excel", r"\bkpi_",
    ],
    "email_intelligence_suite": [
        r"extract_msg", r"email\.parser", r"Outlook\.Application",
        r"\.eml\b", r"\.msg\b", r"email_export", r"msg_parser",
        r"thread_parser", r"email_extract", r"thread_hash", r"email_source",
        r"\bmailbox\b", r"\bemails\b", r"email-intelligence",
    ],
    "system_maintenance_suite": [
        r"cleanpc", r"wiztree", r"uninstaller", r"disk_usage",
        r"windows-cleanup", r"macos-cleanup", r"clean_temp", r"dev_cache",
        r"ai-tool-uninstaller", r"macos[-_]clean", r"windows_fix",
        r"Test-VpnConnection", r"\bdism\b", r"scan_stale", r"quarantine",
        r"orphan", r"brew\s+cleanup", r"cleanup_",
    ],
    "dev_ops_automation": [
        r"\bsvn\b", r"react[-_]?native", r"\bmetro\b", r"\bpodfile\b", r"\bgradle\b",
        r"sync[-_]svn", r"apply[-_]source[-_]edits", r"git[-_ ]worktree",
        r"omp[-_]link", r"omp[-_]bootstrap", r"omp[-_]doctor", r"harvester",
        r"sqlite_master", r"db_schema", r"postgres", r"migration",
    ],
}

PATH_AFFINITIES = [
    (re.compile(r"(email[-_]export|email[-_]intelligence)", re.IGNORECASE), "email_intelligence_suite", 10),
    (re.compile(r"(project[-_]excel[-_]sync|pmi[-_]pmo|pmo|note[-_]multiline|schedule_calc)", re.IGNORECASE), "pmo_project_suite", 10),
    (re.compile(r"(cleanpc|wiztree|uninstaller|cleanup|windows_fix|vpn|stale)", re.IGNORECASE), "system_maintenance_suite", 10),
    (re.compile(r"(document[-_]analysis|spatial|md[-_]convert|docx|pdf|kpi[-_]|bbox|drawio|mermaid)", re.IGNORECASE), "office_doc_suite", 10),
    (re.compile(r"(svn|react[-_]?native|harvester|bootstrap|doctor|link-local|migration)", re.IGNORECASE), "dev_ops_automation", 10),
]

CODE_EXTS = (".py", ".ps1", ".sh", ".ts", ".js", ".cjs", ".mjs", ".bat", ".cmd", ".psm1")
SKILL_DOC_HINTS = ("/skills/", "/agents/", "/commands/", "/rules/", "/workflows/", "skill.md")

EVAL_CODE_INDICATORS = (
    "def ", "class ", "function ", "async ", "import ", "from ", "require(",
    "openpyxl", "docx", "defusedxml", "extract_msg", "email", "pdfplumber",
    "pypdf", "sqlite3", "subprocess", "shutil", "wbs", "cpm", "evm", "raid",
    "ConvertFrom-", "New-Object",
)

_TEST_RUNNER_BASENAME_RE = re.compile(
    r"^(?:self-test\.[^/]+|simulate_[^/]+|[^/]+\.(?:test|spec)\.[^/]+|test_[^/]+\.(?:py|ts|js|cjs|mjs|sh))$",
    re.IGNORECASE,
)
_SCRATCHPAD_PATH_RE = re.compile(r"(?:^|[\\/])scratchpad(?:[\\/]|$)", re.IGNORECASE)
_INLINE_TEMP_RE = re.compile(r"^(?:inline_(?:node|bun|python3?|pwsh|powershell)_[0-9a-f]{6,})", re.IGNORECASE)
_EVAL_TEST_KEYWORDS_RE = re.compile(
    r"(?:\bunittest\b|\bpytest\b|bun:test|\bassertEqual\b|\bassertTrue\b|\bdescribe\s*\(|\bsimulate_[A-Za-z0-9_]+)"
)
_DEF_OR_CLASS_RE = re.compile(r"\b(?:def |class |function |export )\b")


def classify_artifact_noise(target_or_desc: Any, code: str = "") -> Optional[str]:
    """Classify ephemeral edit hunks, one-off test runners, and scratchpad snippets."""
    if isinstance(target_or_desc, dict):
        tool = str(target_or_desc.get("tool", ""))
        target = str(target_or_desc.get("toolKey") or target_or_desc.get("target") or "")
        body = code or str(target_or_desc.get("snippet_preview") or "")
    else:
        tool = ""
        target = str(target_or_desc or "")
        body = code or ""

    norm_target = target.replace("\\", "/")
    if tool in ("edit", "Edit") or re.search(r"#edit\d+$", norm_target):
        return "edit_hunk"
    if _SCRATCHPAD_PATH_RE.search(norm_target):
        return "scratchpad"

    clean_path = norm_target.split("#", 1)[0]
    base = clean_path.rsplit("/", 1)[-1]
    if _TEST_RUNNER_BASENAME_RE.search(base):
        return "test_runner"
    if _INLINE_TEMP_RE.search(base):
        non_empty = [ln for ln in body.splitlines() if ln.strip()]
        if len(non_empty) < 20 or not re.search(r"\b(?:function |class )\b", body):
            return "inline_temp"
    if base.startswith("eval_") or tool == "eval":
        if _EVAL_TEST_KEYWORDS_RE.search(body):
            return "eval_test_runner"
        non_empty = [ln for ln in body.splitlines() if ln.strip()]
        if body and len(non_empty) < 10 and not _DEF_OR_CLASS_RE.search(body):
            return "eval_short_snippet"
    return None


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
        f.flush()
    os.replace(tmp, path)


def _atomic_write_json(path: Path, payload: Any) -> None:
    _atomic_write_text(path, json.dumps(payload, indent=2, ensure_ascii=False))

SENSITIVE_PATTERNS: List[Tuple[re.Pattern[str], Any]] = [
    (re.compile(r"(sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|tvly-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]+)"), "[REDACTED_API_KEY]"),
    (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "[REDACTED_JWT]"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{20,}", re.IGNORECASE), "Bearer [REDACTED_TOKEN]"),
    (re.compile(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.(?:internal|corp|local)", re.IGNORECASE), "[REDACTED_INTERNAL_EMAIL]"),
]

_WIN_DRIVE_RE = re.compile(r"[A-Za-z]:[\\/][^\"'\s`<>|]+")
_POSIX_SYS_PREFIXES = ("/tmp/", "/var/", "/usr/", "/opt/", "/etc/", "/bin/", "/home/", "/users/", "/mnt/", "/dev/", "/proc/", "/sys/")


def _private_terms_pattern(config: Optional[Dict[str, Any]] = None, allow_local: bool = True) -> Optional[re.Pattern[str]]:
    terms: List[str] = [t.strip() for t in os.environ.get("OMP_SENSITIVE_TERMS", "").split(",") if t.strip()]
    if config and isinstance(config.get("privateKeywords"), list):
        terms.extend(str(t).strip() for t in config["privateKeywords"] if str(t).strip())
    if allow_local:
        local_cfg = Path.home() / ".omp" / "harvest-workspaces.local.json"
        if local_cfg.is_file():
            try:
                data = json.loads(local_cfg.read_text(encoding="utf-8"))
                terms.extend(str(t).strip() for t in data.get("privateKeywords", []) if str(t).strip())
            except Exception:
                pass
    if not terms:
        return None
    return re.compile("|".join(re.escape(t) for t in sorted(set(terms), key=len, reverse=True)), re.IGNORECASE)


def sanitize_path(path_str: str, priv_pat: Optional[re.Pattern[str]] = None) -> str:
    norm = str(path_str).replace("\\", "/")
    home = os.path.expanduser("~").replace("\\", "/")
    if home and norm.lower().startswith(home.lower()):
        norm = "~" + norm[len(home):]
    elif re.match(r"^[A-Za-z]:/", norm):
        parts = [p for p in norm.split("/") if p]
        tail = parts[-2:] if (len(parts) >= 2 and parts[-1] in (".omp", ".claude", ".agent")) else (parts[-1:] if parts else [])
        norm = "<local-workspace>/" + "/".join(tail)
    elif norm.startswith(("/Users/", "/home/")):
        parts = [p for p in norm.split("/") if p]
        if len(parts) >= 2:
            norm = "~/" + "/".join(parts[2:])
    elif norm.startswith("/") and not norm.lower().startswith(_POSIX_SYS_PREFIXES):
        parts = [p for p in norm.split("/") if p]
        if len(parts) >= 3:
            norm = "<local-workspace>/" + "/".join(parts[-1:])
    if priv_pat is not None:
        norm = priv_pat.sub("[PROJECT_CODE]", norm)
    return norm


def sanitize_text(text: str, priv_pat: Optional[re.Pattern[str]] = None) -> str:
    res = text
    for pat, repl in SENSITIVE_PATTERNS:
        res = pat.sub(repl, res)
    if priv_pat is not None:
        res = priv_pat.sub("[PROJECT_CODE]", res)
    res = _WIN_DRIVE_RE.sub(lambda m: sanitize_path(m.group(0), priv_pat=priv_pat), res)
    return res


def classify_snippet(code: str, file_path: str = "") -> str:
    haystack = (file_path + " " + code).lower()
    scores: Dict[str, int] = {}
    for pat, suite, weight in PATH_AFFINITIES:
        if pat.search(file_path):
            scores[suite] = scores.get(suite, 0) + weight
    for suite, patterns in SUITE_PATTERNS.items():
        score = sum(1 for p in patterns if re.search(p, haystack, re.IGNORECASE))
        if score > 0:
            scores[suite] = scores.get(suite, 0) + score
    if scores:
        return max(scores.items(), key=lambda x: x[1])[0]
    return "general_utilities"


def compute_code_hash(code: str) -> str:
    lines = [ln.strip() for ln in code.splitlines() if ln.strip() and not ln.strip().startswith(("#", "//"))]
    if not lines:
        lines = [ln.strip() for ln in code.splitlines() if ln.strip()]
    normalized = "\n".join(lines)
    return hashlib.sha256(normalized.encode("utf-8", errors="ignore")).hexdigest()[:12]


def is_reparse_or_symlink(p: str) -> Tuple[bool, Optional[str]]:
    try:
        st = os.lstat(p)
        if stat.S_ISLNK(st.st_mode):
            return True, os.readlink(p)
        attrs = getattr(st, "st_file_attributes", 0)
        if attrs & 0x400:
            return True, os.path.realpath(p)
    except OSError:
        pass
    return False, None


def _is_code_or_skill_path(path_str: str) -> bool:
    low = path_str.replace("\\", "/").lower()
    if low.endswith(CODE_EXTS):
        return True
    if any(h in low for h in SKILL_DOC_HINTS):
        return True
    return False


def _extract_bash_scripts(cmd: str) -> List[Tuple[str, str]]:
    found: List[Tuple[str, str]] = []
    heredoc_pats = [
        re.compile(r"cat\s+<<-?\s*['\"]?([A-Za-z0-9_]+)['\"]?\s*>>?\s*([^\s\n;|&]+)\s*\n(.*?)\n\1(?:\s|$)", re.DOTALL),
        re.compile(r"tee\s+(?:-a\s+)?([^\s\n;|&]+)\s+<<-?\s*['\"]?([A-Za-z0-9_]+)['\"]?\s*\n(.*?)\n\2(?:\s|$)", re.DOTALL),
    ]
    for idx, pat in enumerate(heredoc_pats):
        for m in pat.finditer(cmd):
            if idx == 0:
                target, body = m.group(2).strip("'\""), m.group(3)
            else:
                target, body = m.group(1).strip("'\""), m.group(3)
            if len(body.strip()) > 80:
                found.append((target, body))
    inline_pat = re.compile(r"\b(python3?|node|bun|pwsh|powershell)(?:\.exe)?\s+(?:-[cCe]|-Command)\s+(['\"])(.*?)\2", re.DOTALL)
    for m in inline_pat.finditer(cmd):
        runtime, body = m.group(1), m.group(3)
        if len(body) > 120:
            found.append((f"inline_{runtime}_{compute_code_hash(body)[:8]}", body))
    return found


def _read_bytes_with_retry(path: str, retries: int = 3, backoff_sec: float = 0.05) -> Tuple[bool, bytes]:
    for attempt in range(retries):
        try:
            with open(path, "rb") as f:
                return True, f.read()
        except (PermissionError, OSError) as exc:
            if attempt + 1 < retries:
                time.sleep(backoff_sec)
            else:
                print(f"[!] Warning reading locked/unreadable file {path}: {exc}", file=sys.stderr)
    return False, b""


def find_repo_root(start: Optional[Path] = None) -> Optional[Path]:
    env_repo = os.environ.get("ZUEY_PI_REPO", "").strip()
    if env_repo:
        ep = Path(env_repo)
        if (ep / "config" / "harvest-workspaces.json").is_file() or (ep / "scripts" / "omp-session-harvester.py").is_file():
            return ep
    candidates: List[Path] = []
    cur = (start or Path.cwd()).resolve()
    candidates.extend([cur, *cur.parents])
    here = Path(__file__).resolve()
    candidates.extend(here.parents)
    for cand in candidates:
        if (cand / "config" / "harvest-workspaces.json").is_file() and (cand / "scripts" / "omp-session-harvester.py").is_file():
            return cand
    return None


def resolve_default_paths() -> Tuple[Optional[str], str, str]:
    cwd = Path.cwd().resolve()
    env_repo = os.environ.get("ZUEY_PI_REPO", "").strip()
    in_repo = False
    repo_root: Optional[Path] = None
    if env_repo:
        ep = Path(env_repo)
        if (ep / "config" / "harvest-workspaces.json").is_file():
            repo_root = ep
            in_repo = True
    else:
        for cand in (cwd, *cwd.parents):
            if (cand / "config" / "harvest-workspaces.json").is_file() and (cand / "scripts" / "omp-session-harvester.py").is_file():
                repo_root = cand
                in_repo = True
                break
        if not in_repo:
            here = Path(__file__).resolve()
            if len(here.parents) > 5:
                maybe_repo = here.parents[5]
                if (maybe_repo / "config" / "harvest-workspaces.json").is_file() and (maybe_repo / "scripts" / "omp-session-harvester.py").is_file():
                    repo_root = maybe_repo
                    in_repo = True

    if in_repo and repo_root is not None:
        return (
            str(repo_root / "config" / "harvest-workspaces.json"),
            str(repo_root / "plans" / "omp-consolidation-ledger.json"),
            str(repo_root / "plans" / "harvest-inventory.md"),
        )
    omp_agent = Path.home() / ".omp" / "agent"
    return (
        None,
        str(omp_agent / "omp-consolidation-ledger.json"),
        str(omp_agent / "harvest-inventory.md"),
    )


def _merge_configs(base: Dict[str, Any], local: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    list_keys = ("scanRoots", "additionalWorkspaces", "excludeDirNames", "tierCExcludeGlobs", "privateKeywords")
    for k in list_keys:
        combined: List[str] = []
        seen: Set[str] = set()
        for src_dict in (base, local):
            vals = src_dict.get(k, [])
            if not isinstance(vals, list):
                continue
            for v in vals:
                sv = str(v)
                if sv not in seen:
                    seen.add(sv)
                    combined.append(sv)
        if combined or k in base or k in local:
            merged[k] = combined

    if "tierBOptInSources" in base or "tierBOptInSources" in local:
        b_out: List[Any] = []
        seen_src: Set[str] = set()
        for src_dict in (base, local):
            vals = src_dict.get("tierBOptInSources", [])
            if not isinstance(vals, list):
                continue
            for item in vals:
                key = str(item.get("source")) if isinstance(item, dict) else str(item)
                if key not in seen_src:
                    seen_src.add(key)
                    b_out.append(item)
        merged["tierBOptInSources"] = b_out

    if "tierAPromoteSources" in base or "tierAPromoteSources" in local:
        base_ta = base.get("tierAPromoteSources") or {}
        loc_ta = local.get("tierAPromoteSources") or {}
        ta_out: Dict[str, List[Any]] = {}
        for sub in set(base_ta.keys()) | set(loc_ta.keys()):
            by_name: Dict[str, Any] = {}
            unnamed: List[Any] = []
            for src_ta in (base_ta, loc_ta):
                for entry in src_ta.get(sub, []) or []:
                    if isinstance(entry, dict) and entry.get("name"):
                        by_name[str(entry["name"])] = entry
                    else:
                        unnamed.append(entry)
            ta_out[sub] = list(by_name.values()) + unnamed
        merged["tierAPromoteSources"] = ta_out

    for k, v in local.items():
        if k not in (*list_keys, "tierBOptInSources", "tierAPromoteSources"):
            merged[k] = v
    return merged


def _extract_omp_code_entries(lines: List[str]) -> Tuple[int, Dict[str, Tuple[str, str, int, str]]]:
    """Return (tool_call_count, {tool_key: (tool_kind, body, entry_index, target_path)})."""
    captured: Dict[str, Tuple[str, str, int, str]] = {}
    tool_calls = 0
    eval_counter = 0
    edit_counter = 0
    for entry_idx, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = entry.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "toolCall":
                continue
            tool_calls += 1
            name = block.get("name", "")
            args = block.get("arguments", {})
            if not isinstance(args, dict):
                continue
            if name == "write":
                tp = str(args.get("path", "")).strip()
                body = str(args.get("content", ""))
                if tp and len(body) > 100 and _is_code_or_skill_path(tp):
                    captured[tp] = ("write", body, entry_idx, tp)
            elif name == "edit":
                tp = str(args.get("path", "")).strip()
                new_txt = str(args.get("newText") or args.get("new_string") or args.get("input") or "")
                if tp and len(new_txt) > 80 and _is_code_or_skill_path(tp):
                    edit_counter += 1
                    tk = f"{tp}#edit{edit_counter}"
                    captured[tk] = ("edit", new_txt, entry_idx, tk)
            elif name == "eval":
                lang = str(args.get("language", "py") or "py")
                body = str(args.get("code", ""))
                if len(body) > 100 and any(kw in body for kw in EVAL_CODE_INDICATORS):
                    eval_counter += 1
                    h8 = compute_code_hash(body)[:8]
                    tk = f"eval_{lang}_{eval_counter}_{h8}"
                    captured[tk] = ("eval", body, entry_idx, tk)
            elif name == "bash":
                cmd = str(args.get("command", ""))
                for tp, body in _extract_bash_scripts(cmd):
                    captured[tp] = ("bash", body, entry_idx, tp)
    return tool_calls, captured


def _extract_claude_code_entries(lines: List[str]) -> Tuple[int, Dict[str, Tuple[str, str, int, str]]]:
    captured: Dict[str, Tuple[str, str, int, str]] = {}
    tool_calls = 0
    edit_counter = 0
    for entry_idx, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = entry.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            tool_calls += 1
            name = block.get("name", "")
            inp = block.get("input", {})
            if not isinstance(inp, dict):
                continue
            if name == "Write":
                tp = str(inp.get("file_path", "")).strip()
                body = str(inp.get("content", ""))
                if tp and len(body) > 100 and _is_code_or_skill_path(tp):
                    captured[tp] = ("Write", body, entry_idx, tp)
            elif name == "Edit":
                tp = str(inp.get("file_path", "")).strip()
                new_txt = str(inp.get("new_string", ""))
                if tp and len(new_txt) > 80 and _is_code_or_skill_path(tp):
                    edit_counter += 1
                    tk = f"{tp}#edit{edit_counter}"
                    captured[tk] = ("Edit", new_txt, entry_idx, tk)
            elif name == "Bash":
                cmd = str(inp.get("command", ""))
                for tp, body in _extract_bash_scripts(cmd):
                    captured[tp] = ("Bash", body, entry_idx, tp)
    return tool_calls, captured


class SessionHarvester:
    def __init__(
        self,
        sessions_dir: Optional[str] = None,
        claude_projects_dir: Optional[str] = None,
        claude_history_path: Optional[str] = None,
        history_db_path: Optional[str] = None,
        config_path: Optional[str] = None,
        ledger_path: Optional[str] = None,
        no_local_config: bool = False,
        full_rescan: bool = False,
        include_advisors: bool = False,
        include_noise: bool = False,
    ):
        self.sessions_dir = (
            os.path.expanduser("~/.omp/agent/sessions")
            if sessions_dir is None
            else sessions_dir
        )
        self.claude_projects_dir = (
            os.path.expanduser("~/.claude/projects")
            if claude_projects_dir is None
            else claude_projects_dir
        )
        self.claude_history_path = (
            os.path.expanduser("~/.claude/history.jsonl")
            if claude_history_path is None
            else claude_history_path
        )
        self.history_db_path = (
            os.path.expanduser("~/.omp/agent/history.db")
            if history_db_path is None
            else history_db_path
        )
        def_cfg, def_ledger, _ = resolve_default_paths()
        self.config_path = config_path if config_path is not None else def_cfg
        self.no_local_config = no_local_config
        self.full_rescan = full_rescan
        self.include_advisors = include_advisors
        self.include_noise = include_noise
        self.config = self._load_config()
        self.priv_pat = _private_terms_pattern(self.config, allow_local=not self.no_local_config)
        self.ledger_path = ledger_path if ledger_path is not None else def_ledger
        self.harvested_artifacts: List[Dict[str, Any]] = []
        self.duplicate_groups: Dict[str, List[Dict[str, Any]]] = {}
        self.cluster_index: Dict[str, List[Dict[str, Any]]] = {}
        self.file_watermarks: Dict[str, Dict[str, Any]] = {}
        self._existing_watermarks: Dict[str, Dict[str, Any]] = self._load_existing_watermarks()
        self.history_summary: Dict[str, Any] = {}
        self.global_diff_report: Dict[str, Any] = {}
        self.session_stats: Dict[str, int] = {
            "omp_sessions": 0,
            "omp_top_level": 0,
            "omp_subagents": 0,
            "omp_advisors_skipped": 0,
            "omp_advisors_included": 0,
            "claude_sessions": 0,
            "claude_top_level": 0,
            "claude_subagents": 0,
            "claude_history_entries": 0,
            "total_tool_calls": 0,
            "extracted_scripts": 0,
            "skipped_unchanged": 0,
        }

    def _watermark_cache_path(self) -> Optional[Path]:
        repo_root = find_repo_root()
        if repo_root is None or not self.ledger_path:
            return None
        try:
            lp = Path(self.ledger_path).resolve()
            plans_dir = (repo_root / "plans").resolve()
            if lp == plans_dir or plans_dir in lp.parents:
                return Path.home() / ".omp" / "agent" / "omp-harvester-cache.json"
        except OSError:
            pass
        return None

    def _load_existing_watermarks(self) -> Dict[str, Dict[str, Any]]:
        cache_p = self._watermark_cache_path()
        for cand in ([cache_p] if cache_p else []) + ([Path(self.ledger_path)] if self.ledger_path else []):
            if cand and cand.is_file():
                try:
                    data = json.loads(cand.read_text(encoding="utf-8"))
                    wms = data.get("fileWatermarks", {})
                    if isinstance(wms, dict) and wms:
                        return wms
                except Exception:
                    pass
        return {}
    def _load_config(self) -> Dict[str, Any]:
        base: Dict[str, Any] = {}
        if self.config_path and os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    if isinstance(loaded, dict):
                        base = loaded
            except Exception as e:
                print(f"[!] Warning reading config {self.config_path}: {e}", file=sys.stderr)
        if not self.no_local_config:
            local_cfg = Path.home() / ".omp" / "harvest-workspaces.local.json"
            if local_cfg.is_file():
                try:
                    loaded_local = json.loads(local_cfg.read_text(encoding="utf-8"))
                    if isinstance(loaded_local, dict):
                        base = _merge_configs(base, loaded_local)
                except Exception as e:
                    print(f"[!] Warning reading local config {local_cfg}: {e}", file=sys.stderr)
        return base

    def _build_descriptor(
        self,
        session_rel: str,
        tool_kind: str,
        target_path: str,
        code_content: str,
        source_kind: str,
        entry_idx: Optional[int],
        tool_key: str,
    ) -> Dict[str, Any]:
        c_hash = compute_code_hash(code_content)
        suite = classify_snippet(code_content, target_path)
        sanitized = sanitize_text(code_content, priv_pat=self.priv_pat)
        noise_reason = classify_artifact_noise({"tool": tool_kind, "toolKey": tool_key, "target": target_path}, code_content)
        norm_rel = session_rel.replace("\\", "/")
        return {
            "source": source_kind,
            "session": sanitize_path(session_rel, priv_pat=self.priv_pat),
            "sessionRel": norm_rel,
            "tool": tool_kind,
            "toolKey": tool_key,
            "entryIndex": entry_idx,
            "target": sanitize_path(target_path, priv_pat=self.priv_pat),
            "suite": suite,
            "hash": c_hash,
            "lines": len(code_content.splitlines()),
            "bytes": len(code_content),
            "isNoise": bool(noise_reason),
            "noiseCategory": "ephemeral_noise" if noise_reason else "signal",
            "noiseReason": noise_reason,
            "snippet_preview": sanitized[:200].replace("\n", " ") + ("..." if len(sanitized) > 200 else ""),
        }

    def _register_artifact(self, artifact: Dict[str, Any]) -> None:
        c_hash = artifact["hash"]
        self.harvested_artifacts.append(artifact)
        self.duplicate_groups.setdefault(c_hash, []).append(artifact)
        if artifact.get("entryIndex") is not None and artifact.get("sessionRel"):
            loc = {
                "source": artifact.get("source", "omp"),
                "session": artifact.get("session", ""),
                "sessionRel": artifact.get("sessionRel", ""),
                "entryIndex": artifact.get("entryIndex"),
                "toolKey": artifact.get("toolKey", ""),
                "target": artifact.get("target", ""),
                "suite": artifact.get("suite", "general_utilities"),
            }
            bucket = self.cluster_index.setdefault(c_hash, [])
            if len(bucket) < 5:
                bucket.append(loc)
        self.session_stats["extracted_scripts"] += 1

    def _rehydrate_watermark(self, wm_key: str, wm: Dict[str, Any]) -> None:
        self.session_stats["skipped_unchanged"] += 1
        self.session_stats["total_tool_calls"] += int(wm.get("tool_calls", 0))
        arts = wm.get("artifacts", [])
        for art in arts:
            if isinstance(art, dict) and art.get("hash"):
                item = dict(art)
                if "isNoise" not in item:
                    nr = classify_artifact_noise(item)
                    item["isNoise"] = bool(nr)
                    item["noiseCategory"] = "ephemeral_noise" if nr else "signal"
                    item["noiseReason"] = nr
                self._register_artifact(item)
        self.file_watermarks[wm_key] = wm

    def scan_omp_sessions(self) -> None:
        if not self.sessions_dir or not os.path.exists(self.sessions_dir):
            return
        all_jsonl = sorted(glob.glob(os.path.join(self.sessions_dir, "**", "*.jsonl"), recursive=True))
        primary_files = [
            sf for sf in all_jsonl
            if not os.path.basename(sf).startswith(("__advisor", ".__advisor"))
        ]
        advisor_files = [
            sf for sf in all_jsonl
            if os.path.basename(sf).startswith(("__advisor", ".__advisor"))
        ]
        advisors_skipped = 0 if self.include_advisors else len(advisor_files)
        advisors_included = len(advisor_files) if self.include_advisors else 0

        top_level_count = 0
        for sf in primary_files:
            rel = os.path.relpath(sf, self.sessions_dir).replace("\\", "/")
            if rel.count("/") <= 1:
                top_level_count += 1
        subagent_count = len(primary_files) - top_level_count
        self.session_stats["omp_sessions"] = len(primary_files)
        self.session_stats["omp_top_level"] = top_level_count
        self.session_stats["omp_subagents"] = subagent_count
        self.session_stats["omp_advisors_skipped"] = advisors_skipped
        self.session_stats["omp_advisors_included"] = advisors_included
        print(
            f"[*] OMP sessions: {len(primary_files)} transcripts "
            f"({top_level_count} top-level, {subagent_count} subagents; "
            f"{advisors_skipped} advisors skipped, {advisors_included} advisors included)"
        )

        scan_queue: List[Tuple[str, str]] = [(sf, "omp") for sf in primary_files]
        if self.include_advisors:
            scan_queue.extend((sf, "omp-advisor") for sf in advisor_files)

        for sf, source_kind in scan_queue:
            rel_session = os.path.relpath(sf, self.sessions_dir).replace("\\", "/")
            wm_key = f"{source_kind}://{rel_session}"
            try:
                st = os.stat(sf)
            except OSError:
                continue

            existing_wm = self._existing_watermarks.get(wm_key)
            if (
                not self.full_rescan
                and isinstance(existing_wm, dict)
                and existing_wm.get("mtime_ns") == st.st_mtime_ns
                and existing_wm.get("size") == st.st_size
                and isinstance(existing_wm.get("artifacts"), list)
            ):
                self._rehydrate_watermark(wm_key, existing_wm)
                continue

            ok, raw_bytes = _read_bytes_with_retry(sf)
            if not ok:
                if isinstance(existing_wm, dict):
                    self.file_watermarks[wm_key] = existing_wm
                continue

            file_sha = hashlib.sha256(raw_bytes).hexdigest()[:16]
            lines = raw_bytes.decode("utf-8", errors="ignore").splitlines()
            tool_calls, captured = _extract_omp_code_entries(lines)
            self.session_stats["total_tool_calls"] += tool_calls

            file_arts: List[Dict[str, Any]] = []
            for _tk, (tool_kind, body, entry_idx, tool_key) in captured.items():
                desc = self._build_descriptor(rel_session, tool_kind, tool_key, body, source_kind, entry_idx, tool_key)
                self._register_artifact(desc)
                file_arts.append(desc)

            self.file_watermarks[wm_key] = {
                "mtime_ns": st.st_mtime_ns,
                "size": st.st_size,
                "sha256": file_sha,
                "tool_calls": tool_calls,
                "artifacts": file_arts,
            }

    def scan_claude_sessions(self) -> None:
        if self.claude_history_path and os.path.exists(self.claude_history_path):
            try:
                with open(self.claude_history_path, "r", encoding="utf-8", errors="ignore") as f:
                    self.session_stats["claude_history_entries"] = sum(1 for ln in f if ln.strip())
            except Exception:
                pass

        if not self.claude_projects_dir or not os.path.exists(self.claude_projects_dir):
            return
        all_jsonl = sorted(glob.glob(os.path.join(self.claude_projects_dir, "**", "*.jsonl"), recursive=True))
        top_level = 0
        for sf in all_jsonl:
            rel = os.path.relpath(sf, self.claude_projects_dir).replace("\\", "/")
            if "/subagents/" not in f"/{rel}" and os.path.basename(sf) != "journal.jsonl" and rel.count("/") <= 1:
                top_level += 1
        sub_count = len(all_jsonl) - top_level
        self.session_stats["claude_sessions"] = len(all_jsonl)
        self.session_stats["claude_top_level"] = top_level
        self.session_stats["claude_subagents"] = sub_count
        print(
            f"[*] Claude sessions: {len(all_jsonl)} transcripts "
            f"({top_level} top-level, {sub_count} subagents/journals; "
            f"{self.session_stats['claude_history_entries']} history.jsonl entries)"
        )

        for sf in all_jsonl:
            rel_session = os.path.relpath(sf, self.claude_projects_dir).replace("\\", "/")
            wm_key = f"claude://{rel_session}"
            try:
                st = os.stat(sf)
            except OSError:
                continue

            existing_wm = self._existing_watermarks.get(wm_key)
            if (
                not self.full_rescan
                and isinstance(existing_wm, dict)
                and existing_wm.get("mtime_ns") == st.st_mtime_ns
                and existing_wm.get("size") == st.st_size
                and isinstance(existing_wm.get("artifacts"), list)
            ):
                self._rehydrate_watermark(wm_key, existing_wm)
                continue

            ok, raw_bytes = _read_bytes_with_retry(sf)
            if not ok:
                if isinstance(existing_wm, dict):
                    self.file_watermarks[wm_key] = existing_wm
                continue

            file_sha = hashlib.sha256(raw_bytes).hexdigest()[:16]
            lines = raw_bytes.decode("utf-8", errors="ignore").splitlines()
            tool_calls, captured = _extract_claude_code_entries(lines)
            self.session_stats["total_tool_calls"] += tool_calls

            file_arts: List[Dict[str, Any]] = []
            for _tk, (tool_kind, body, entry_idx, tool_key) in captured.items():
                desc = self._build_descriptor(rel_session, tool_kind, tool_key, body, "claude", entry_idx, tool_key)
                self._register_artifact(desc)
                file_arts.append(desc)

            self.file_watermarks[wm_key] = {
                "mtime_ns": st.st_mtime_ns,
                "size": st.st_size,
                "sha256": file_sha,
                "tool_calls": tool_calls,
                "artifacts": file_arts,
            }

    def scan_history_db(self) -> Dict[str, Any]:
        if not self.history_db_path or not os.path.exists(self.history_db_path):
            return {}
        summary: Dict[str, Any] = {"prompts": 0, "titles": 0, "recaps": 0, "distinctCwds": []}
        try:
            db_uri = Path(self.history_db_path).resolve().as_uri() + "?mode=ro&immutable=1"
            conn = sqlite3.connect(db_uri, uri=True, timeout=2.0)
            cur = conn.cursor()
            tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            cwds: Set[str] = set()
            if "history" in tables:
                summary["prompts"] = int(cur.execute("SELECT COUNT(*) FROM history").fetchone()[0])
                for (c,) in cur.execute("SELECT DISTINCT cwd FROM history WHERE cwd IS NOT NULL AND cwd != ''"):
                    cwds.add(sanitize_path(c, priv_pat=self.priv_pat))
            if "session_titles" in tables:
                summary["titles"] = int(cur.execute("SELECT COUNT(*) FROM session_titles").fetchone()[0])
            if "session_recaps" in tables:
                summary["recaps"] = int(cur.execute("SELECT COUNT(*) FROM session_recaps").fetchone()[0])
                for (c,) in cur.execute("SELECT DISTINCT cwd FROM session_recaps WHERE cwd IS NOT NULL AND cwd != ''"):
                    cwds.add(sanitize_path(c, priv_pat=self.priv_pat))
            conn.close()
            summary["distinctCwds"] = sorted(cwds)
            print(
                f"[*] history.db: {summary['prompts']} prompts, {summary['titles']} titles, "
                f"{summary['recaps']} recaps across {len(cwds)} sanitized cwds"
            )
        except Exception as e:
            print(f"[!] Warning reading history.db {self.history_db_path}: {e}", file=sys.stderr)
        self.history_summary = summary
        return summary

    def scan_sessions(self) -> Dict[str, Any]:
        self.scan_omp_sessions()
        self.scan_claude_sessions()
        self.scan_history_db()
        print(
            f"[v] Parsed {self.session_stats['total_tool_calls']} tool calls "
            f"(skipped {self.session_stats['skipped_unchanged']} unchanged files); "
            f"indexed {self.session_stats['extracted_scripts']} candidate code artifacts."
        )
        return {
            **self.session_stats,
            "total_sessions": self.session_stats["omp_sessions"] + self.session_stats["claude_sessions"],
            "unique_hashes": len(self.duplicate_groups),
        }

    def _is_tier_c_excluded(self, path_str: str) -> bool:
        norm = path_str.replace("\\", "/")
        for pat in self.config.get("tierCExcludeGlobs", []):
            if fnmatch.fnmatch(norm, pat) or fnmatch.fnmatch(norm.lower(), pat.lower()):
                return True
        return False

    def scan_workspaces(self, workspace_paths: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        if workspace_paths is None:
            env_paths = os.environ.get("OMP_HARVEST_WORKSPACES", "").strip()
            if env_paths:
                ws_list = [os.path.expanduser(p.strip()) for p in env_paths.replace(";", ",").split(",") if p.strip()]
            else:
                ws_list = [os.path.expanduser(str(p)) for p in self.config.get("additionalWorkspaces", [])]
        else:
            ws_list = [os.path.expanduser(p) for p in workspace_paths if p and p.strip()]

        prune_dirs = set(self.config.get("excludeDirNames", ["node_modules", ".git", ".venv", "__pycache__", "venv"]))
        found_files: List[Dict[str, Any]] = []
        scan_exts = (".py", ".ps1", ".sh", ".ts", ".js", ".cjs", ".mjs", ".bat", ".psm1")

        for ws in ws_list:
            if not os.path.exists(ws):
                continue
            for root_dir, dirs, files in os.walk(ws):
                dirs[:] = [d for d in dirs if d not in prune_dirs and not self._is_tier_c_excluded(os.path.join(root_dir, d))]
                for fname in files:
                    if not fname.lower().endswith(scan_exts):
                        continue
                    fp = os.path.join(root_dir, fname)
                    if self._is_tier_c_excluded(fp):
                        continue
                    try:
                        sz = os.path.getsize(fp)
                        if sz <= 150:
                            continue
                        with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                        c_hash = compute_code_hash(content)
                        suite = classify_snippet(content, fp)
                        norm_target = sanitize_path(fp, priv_pat=self.priv_pat)
                        noise_reason = classify_artifact_noise({"tool": "file", "target": norm_target}, content)
                        artifact = {
                            "source": "workspace",
                            "session": "local_workspace",
                            "tool": "file",
                            "target": norm_target,
                            "suite": suite,
                            "hash": c_hash,
                            "lines": len(content.splitlines()),
                            "bytes": sz,
                            "isNoise": bool(noise_reason),
                            "noiseCategory": "ephemeral_noise" if noise_reason else "signal",
                            "noiseReason": noise_reason,
                            "snippet_preview": sanitize_text(content[:200].replace("\n", " "), priv_pat=self.priv_pat) + "...",
                        }
                        self.harvested_artifacts.append(artifact)
                        self.duplicate_groups.setdefault(c_hash, []).append(artifact)
                        found_files.append(artifact)
                    except Exception:
                        pass
        print(f"[v] Scanned {len(ws_list)} local workspace roots: extracted {len(found_files)} script files.")
        return found_files

    def scan_global_diff(
        self,
        scan_roots: Optional[List[str]] = None,
        global_omp_dir: Optional[str] = None,
        global_claude_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        g_omp = global_omp_dir or os.path.expanduser("~/.omp/agent")
        g_claude = global_claude_dir or os.path.expanduser("~/.claude")
        roots = [
            os.path.expanduser(str(r))
            for r in (scan_roots if scan_roots is not None else list(self.config.get("scanRoots", [])))
        ]
        prune = set(self.config.get("excludeDirNames", ["node_modules", ".git", "__pycache__", "venv", ".venv"]))

        def _dir_names(base: str, sub: str) -> Set[str]:
            p = os.path.join(base, sub)
            if not os.path.isdir(p):
                return set()
            return {e for e in os.listdir(p) if not e.startswith(".")}

        g_skills = _dir_names(g_omp, "skills") | _dir_names(g_omp, "managed-skills") | _dir_names(g_claude, "skills")
        g_omp_agents = _dir_names(g_omp, "agents")
        g_claude_agents = _dir_names(g_claude, "agents")
        g_commands = _dir_names(g_omp, "commands") | _dir_names(g_claude, "commands")
        g_rules = _dir_names(g_omp, "rules") | _dir_names(g_claude, "rules")

        discovered_dirs: List[str] = []
        deltas: List[Dict[str, Any]] = []
        container_links_count = 0

        for root in roots:
            if not os.path.exists(root):
                continue
            for cur, dirs, _ in os.walk(root):
                dirs[:] = [
                    d for d in dirs
                    if d not in prune and not self._is_tier_c_excluded(os.path.join(cur, d))
                ]
                for target in (".omp", ".claude", ".agent"):
                    if target in dirs:
                        cfg_path = os.path.join(cur, target).replace("\\", "/")
                        if self._is_tier_c_excluded(cfg_path):
                            continue
                        discovered_dirs.append(cfg_path)
                        item: Dict[str, Any] = {"dir": sanitize_path(cfg_path, priv_pat=self.priv_pat), "links": [], "missingFromOmpGlobal": {}}
                        for sub, ref_set in (
                            ("skills", g_skills),
                            ("agents", g_omp_agents),
                            ("commands", g_commands),
                            ("rules", g_rules),
                        ):
                            sp = os.path.join(cfg_path, sub)
                            c_lnk, c_tgt = is_reparse_or_symlink(sp)
                            if c_lnk:
                                container_links_count += 1
                                item["links"].append({
                                    "sub": sub,
                                    "entry": "<container>",
                                    "container": True,
                                    "target": sanitize_path(c_tgt or "", priv_pat=self.priv_pat),
                                })
                            if not os.path.isdir(sp):
                                continue
                            entries = sorted(e for e in os.listdir(sp) if not e.startswith("."))
                            missing = [e for e in entries if e not in ref_set]
                            for e in entries:
                                lnk, tgt = is_reparse_or_symlink(os.path.join(sp, e))
                                if lnk:
                                    item["links"].append({"sub": sub, "entry": e, "container": False, "target": sanitize_path(tgt or "", priv_pat=self.priv_pat)})
                            if missing:
                                item["missingFromOmpGlobal"][sub] = missing
                        if item["missingFromOmpGlobal"] or item["links"]:
                            deltas.append(item)

        self.global_diff_report = {
            "globalOmpSkillsCount": len(_dir_names(g_omp, "skills") | _dir_names(g_omp, "managed-skills")),
            "globalOmpAgentsCount": len(g_omp_agents),
            "globalClaudeSkillsCount": len(_dir_names(g_claude, "skills")),
            "globalClaudeAgentsCount": len(g_claude_agents),
            "projectConfigDirsScanned": len(discovered_dirs),
            "projectDeltasCount": len(deltas),
            "containerLinksCount": container_links_count,
            "deltas": deltas,
        }
        print(
            f"[v] Global diff: scanned {len(discovered_dirs)} non-excluded .omp/.claude/.agent dirs; "
            f"{len(deltas)} carry unpromoted items or symlinks ({container_links_count} container links)."
        )
        return self.global_diff_report

    def extract_cluster(self, cluster_hash: str, out_dir: str) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            raise FileNotFoundError(f"Ledger missing: {self.ledger_path}")
        ledger = json.loads(Path(self.ledger_path).read_text(encoding="utf-8"))
        locs = ledger.get("clusterIndex", {}).get(cluster_hash)
        if not locs:
            cache_p = self._watermark_cache_path()
            if cache_p and cache_p.is_file():
                locs = json.loads(cache_p.read_text(encoding="utf-8")).get("clusterIndex", {}).get(cluster_hash)
        if not locs:
            raise KeyError(f"Cluster hash not found in ledger clusterIndex: {cluster_hash}")
        if isinstance(locs, dict):
            locs = [locs]
        written: List[str] = []
        out_root = Path(out_dir)
        out_root.mkdir(parents=True, exist_ok=True)

        for loc in locs:
            source_kind = loc.get("source", "omp")
            rel_session = loc.get("sessionRel", "")
            entry_idx = loc.get("entryIndex")
            tool_key = loc.get("toolKey", "")
            base_dir = self.claude_projects_dir if source_kind == "claude" else self.sessions_dir
            if not base_dir or not rel_session:
                continue
            sf = os.path.join(base_dir, rel_session)
            if not os.path.isfile(sf):
                continue
            ok, raw_bytes = _read_bytes_with_retry(sf)
            if not ok:
                continue
            lines = raw_bytes.decode("utf-8", errors="ignore").splitlines()
            if entry_idx is None or not (0 <= int(entry_idx) < len(lines)):
                continue
            slice_lines = [lines[int(entry_idx)]]
            if source_kind == "claude":
                _, captured = _extract_claude_code_entries(slice_lines)
            else:
                _, captured = _extract_omp_code_entries(slice_lines)

            matched_body: Optional[str] = None
            for tk, (_kind, body, _idx, _tp) in captured.items():
                if tk == tool_key or compute_code_hash(body) == cluster_hash:
                    matched_body = body
                    break
            if matched_body is None:
                continue

            raw_name = Path(str(tool_key).split("#", 1)[0]).name or f"cluster_{cluster_hash}.txt"
            safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)
            if not Path(safe_name).suffix:
                safe_name += ".py"
            dest = out_root / f"{cluster_hash}_{safe_name}"
            dest.write_text(matched_body.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
            written.append(str(dest))
            break

        if not written:
            raise RuntimeError(f"Unable to extract source body for hash {cluster_hash}")
        return {"ok": True, "hash": cluster_hash, "written": written}

    def _load_ledger_doc(self) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            return {
                "version": "2.2.0",
                "suites": {},
                "summary": {},
                "promotedHashes": {},
                "clusterDispositions": {},
                "promotionQueue": [],
                "loopMeta": {"round": 0, "lastRoundAt": None, "maxRounds": 20, "zeroDeltaStreak": 0},
            }
        with open(self.ledger_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _save_ledger_doc(self, ledger: Dict[str, Any]) -> None:
        _atomic_write_json(Path(self.ledger_path), ledger)

    def _lookup_cluster_meta(self, ledger: Dict[str, Any], cluster_hash: str) -> Dict[str, Any]:
        for q_item in ledger.get("promotionQueue", []) or []:
            if isinstance(q_item, dict) and q_item.get("hash") == cluster_hash:
                return dict(q_item)
        locs = (ledger.get("clusterIndex", {}) or {}).get(cluster_hash)
        if not locs:
            cache_p = self._watermark_cache_path()
            if cache_p and cache_p.is_file():
                try:
                    locs = json.loads(cache_p.read_text(encoding="utf-8")).get("clusterIndex", {}).get(cluster_hash)
                except Exception:
                    locs = None
        if isinstance(locs, list) and locs:
            first = locs[0]
            return {
                "hash": cluster_hash,
                "suite": first.get("suite", "general_utilities"),
                "targetSample": first.get("target", ""),
                "occurrences": len(locs),
                "isNoise": False,
                "noiseReason": None,
            }
        for dup in ledger.get("topDuplicateClusters", []) or []:
            if isinstance(dup, dict) and dup.get("hash") == cluster_hash:
                return {
                    "hash": cluster_hash,
                    "suite": dup.get("suite", "general_utilities"),
                    "targetSample": (dup.get("targets") or [""])[0],
                    "occurrences": int(dup.get("occurrences", 1)),
                    "isNoise": False,
                    "noiseReason": None,
                }
        raise KeyError(f"Cluster hash not found in ledger or clusterIndex: {cluster_hash}")

    def stage_cluster(self, cluster_hash: str) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            raise FileNotFoundError(f"Ledger missing: {self.ledger_path}")
        ledger = self._load_ledger_doc()
        now = datetime.now(timezone.utc).isoformat()
        queue: List[Dict[str, Any]] = [dict(x) for x in (ledger.get("promotionQueue") or []) if isinstance(x, dict)]
        target_item: Optional[Dict[str, Any]] = None
        for idx, item in enumerate(queue):
            if item.get("hash") == cluster_hash:
                target_item = item
                queue.pop(idx)
                break
        if target_item is None:
            target_item = self._lookup_cluster_meta(ledger, cluster_hash)
        target_item["state"] = "staged"
        target_item["disposition"] = "staged"
        target_item["stagedAt"] = now
        target_item["updatedAt"] = now
        queue.insert(0, target_item)
        ledger["promotionQueue"] = queue
        ledger.setdefault("loopMeta", {"round": 0, "lastRoundAt": None, "maxRounds": 20, "zeroDeltaStreak": 0})
        self._save_ledger_doc(ledger)
        return {"ok": True, "hash": cluster_hash, "state": "staged", "entry": target_item}

    def commit_stage(self, cluster_hash: str, suite: str, target: str) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            raise FileNotFoundError(f"Ledger missing: {self.ledger_path}")
        ledger = self._load_ledger_doc()
        now = datetime.now(timezone.utc).isoformat()
        promoted = ledger.setdefault("promotedHashes", {})
        promoted[cluster_hash] = {
            "suite": suite,
            "target": target,
            "promotedAt": now,
            "disposition": "promoted",
        }
        dispositions = ledger.setdefault("clusterDispositions", {})
        dispositions[cluster_hash] = {
            "disposition": "promoted",
            "suite": suite,
            "target": target,
            "updatedAt": now,
        }
        queue: List[Dict[str, Any]] = []
        found_in_queue = False
        for item in ledger.get("promotionQueue") or []:
            if not isinstance(item, dict):
                continue
            if item.get("hash") == cluster_hash:
                item = dict(item)
                item["state"] = "promoted"
                item["disposition"] = "promoted"
                item["suite"] = suite
                item["targetSample"] = target
                item["updatedAt"] = now
                found_in_queue = True
            queue.append(item)
        if not found_in_queue:
            queue.append({
                "hash": cluster_hash,
                "suite": suite,
                "targetSample": target,
                "occurrences": 1,
                "state": "promoted",
                "disposition": "promoted",
                "updatedAt": now,
            })
        ledger["promotionQueue"] = queue
        loop_meta = ledger.setdefault("loopMeta", {"round": 0, "lastRoundAt": None, "maxRounds": 20, "zeroDeltaStreak": 0})
        loop_meta["round"] = int(loop_meta.get("round", 0)) + 1
        loop_meta["lastRoundAt"] = now
        loop_meta["zeroDeltaStreak"] = 0
        drift = ledger.get("driftDetails")
        if isinstance(drift, dict) and isinstance(drift.get("unpromotedHashes"), list):
            drift["unpromotedHashes"] = [h for h in drift["unpromotedHashes"] if h != cluster_hash]
        self._save_ledger_doc(ledger)
        return {
            "ok": True,
            "hash": cluster_hash,
            "state": "promoted",
            "round": loop_meta["round"],
            "suite": suite,
            "target": target,
        }

    def triage_cluster(
        self,
        cluster_hash: str,
        disposition: str,
        suite: Optional[str] = None,
        target: Optional[str] = None,
    ) -> Dict[str, Any]:
        valid_dispositions = ("promoted", "merged_into", "deferred", "ignored_noise")
        if disposition not in valid_dispositions:
            raise ValueError(f"Unsupported disposition '{disposition}'; expected one of {valid_dispositions}")
        if not os.path.exists(self.ledger_path):
            raise FileNotFoundError(f"Ledger missing: {self.ledger_path}")
        ledger = self._load_ledger_doc()
        now = datetime.now(timezone.utc).isoformat()
        dispositions = ledger.setdefault("clusterDispositions", {})
        dispositions[cluster_hash] = {
            "disposition": disposition,
            "suite": suite,
            "target": target,
            "updatedAt": now,
        }
        if disposition == "promoted":
            ledger.setdefault("promotedHashes", {})[cluster_hash] = {
                "suite": suite or "general_utilities",
                "target": target or "",
                "promotedAt": now,
                "disposition": "promoted",
            }
        queue: List[Dict[str, Any]] = []
        for item in ledger.get("promotionQueue") or []:
            if not isinstance(item, dict):
                continue
            if item.get("hash") == cluster_hash:
                item = dict(item)
                item["state"] = disposition
                item["disposition"] = disposition
                if suite:
                    item["suite"] = suite
                if target:
                    item["targetSample"] = target
                item["updatedAt"] = now
            queue.append(item)
        ledger["promotionQueue"] = queue
        drift = ledger.get("driftDetails")
        if isinstance(drift, dict) and isinstance(drift.get("unpromotedHashes"), list):
            drift["unpromotedHashes"] = [h for h in drift["unpromotedHashes"] if h != cluster_hash]
        self._save_ledger_doc(ledger)
        return {"ok": True, "hash": cluster_hash, "disposition": disposition}

    def update_ledger(self) -> None:
        ledger = self._load_ledger_doc()
        ledger["version"] = "2.2.0"
        ledger.setdefault("summary", {})
        promoted_hashes = ledger.setdefault("promotedHashes", {})
        dispositions = ledger.setdefault("clusterDispositions", {})
        loop_meta = ledger.setdefault("loopMeta", {"round": 0, "lastRoundAt": None, "maxRounds": 20, "zeroDeltaStreak": 0})

        prev_queue = {
            item["hash"]: item
            for item in (ledger.get("promotionQueue") or [])
            if isinstance(item, dict) and item.get("hash")
        }

        noise_artifacts_count = 0
        noise_clusters_count = 0
        actionable_clusters_count = 0
        next_queue: List[Dict[str, Any]] = []
        actionable_unpromoted_hashes: List[str] = []
        actionable_dupes: List[Tuple[str, List[Dict[str, Any]]]] = []

        for c_hash, items in self.duplicate_groups.items():
            noise_in_cluster = sum(1 for x in items if x.get("isNoise"))
            noise_artifacts_count += noise_in_cluster
            cluster_is_noise = bool(items) and all(bool(x.get("isNoise")) for x in items)
            if cluster_is_noise:
                noise_clusters_count += 1
            else:
                actionable_clusters_count += 1
                if len(items) > 1:
                    actionable_dupes.append((c_hash, items))

            disp_meta = dispositions.get(c_hash) if isinstance(dispositions.get(c_hash), dict) else None
            is_resolved = (c_hash in promoted_hashes) or (
                disp_meta is not None
                and disp_meta.get("disposition") in ("promoted", "merged_into", "deferred", "ignored_noise")
            )
            if is_resolved:
                continue

            prev_entry = prev_queue.get(c_hash)
            is_staged = prev_entry is not None and prev_entry.get("state") == "staged"
            if not cluster_is_noise:
                actionable_unpromoted_hashes.append(c_hash)
            if not is_staged and cluster_is_noise and not self.include_noise:
                continue

            rep = items[0]
            entry: Dict[str, Any] = {
                "hash": c_hash,
                "suite": rep.get("suite", "general_utilities"),
                "targetSample": rep.get("target", ""),
                "occurrences": len(items),
                "state": "staged" if is_staged else "pending",
                "disposition": "staged" if is_staged else "pending",
                "isNoise": cluster_is_noise,
                "noiseReason": rep.get("noiseReason") if cluster_is_noise else None,
            }
            if is_staged and prev_entry and prev_entry.get("stagedAt"):
                entry["stagedAt"] = prev_entry["stagedAt"]
            next_queue.append(entry)

        next_queue.sort(key=lambda x: (0 if x.get("state") == "staged" else 1, -int(x.get("occurrences", 0)), str(x.get("suite", "")), str(x.get("hash", ""))))
        ledger["promotionQueue"] = next_queue[:35]
        ledger["summary"].update({
            "ompSessionsScouted": self.session_stats["omp_sessions"],
            "ompAdvisorsSkipped": self.session_stats["omp_advisors_skipped"],
            "ompAdvisorsIncluded": self.session_stats["omp_advisors_included"],
            "claudeSessionsScouted": self.session_stats["claude_sessions"],
            "totalSessionsScouted": self.session_stats["omp_sessions"] + self.session_stats["claude_sessions"],
            "historyDbPrompts": self.history_summary.get("prompts", 0),
            "historyDbRecaps": self.history_summary.get("recaps", 0),
            "harvestedArtifactsCount": len(self.harvested_artifacts),
            "uniqueCodeClusters": len(self.duplicate_groups),
            "ephemeralNoiseArtifactsCount": noise_artifacts_count,
            "ephemeralNoiseClustersCount": noise_clusters_count,
            "actionableClustersCount": actionable_clusters_count,
            "actionableQueueTotal": len(next_queue),
            "promotionQueueCount": len(ledger["promotionQueue"]),
            "skippedUnchanged": self.session_stats["skipped_unchanged"],
            "lastHarvestTimestamp": datetime.now(timezone.utc).isoformat(),
        })
        if self.global_diff_report:
            ledger["summary"]["projectConfigDirsScanned"] = self.global_diff_report["projectConfigDirsScanned"]
            ledger["summary"]["projectDeltasCount"] = self.global_diff_report["projectDeltasCount"]
            ledger["globalDiffSummary"] = {
                k: v for k, v in self.global_diff_report.items() if k != "deltas"
            }

        unpromoted_hashes = sorted(set(actionable_unpromoted_hashes) & set(self.cluster_index.keys()))
        if not unpromoted_hashes:
            unpromoted_hashes = sorted(
                h for h in (set(self.cluster_index.keys()) - set(promoted_hashes.keys()))
                if not (isinstance(dispositions.get(h), dict) and dispositions[h].get("disposition") in ("promoted", "merged_into", "deferred", "ignored_noise"))
                and not all(bool(x.get("isNoise")) for x in self.duplicate_groups.get(h, []) if x)
            )
        unpromoted_delta_dirs = [
            d.get("dir") for d in self.global_diff_report.get("deltas", []) if d.get("missingFromOmpGlobal")
        ]

        cur_status = ledger.get("status", "")
        if cur_status in ("COMPLETED", "VERIFIED_E2E"):
            if unpromoted_hashes or unpromoted_delta_dirs:
                ledger["status"] = "DRIFT_DETECTED"
                ledger["driftDetails"] = {
                    "unpromotedHashes": unpromoted_hashes[:50],
                    "unpromotedDeltaDirs": unpromoted_delta_dirs[:30],
                }
        elif cur_status != "DRIFT_DETECTED":
            ledger["status"] = "HARVESTED"
        elif not unpromoted_hashes and not unpromoted_delta_dirs:
            ledger.pop("driftDetails", None)

        if not ledger["promotionQueue"] and not unpromoted_delta_dirs:
            loop_meta["zeroDeltaStreak"] = int(loop_meta.get("zeroDeltaStreak", 0)) + 1

        cache_p = self._watermark_cache_path()
        if cache_p is not None:
            _atomic_write_json(cache_p, {"fileWatermarks": self.file_watermarks, "clusterIndex": self.cluster_index})
            ledger.pop("fileWatermarks", None)
            ledger.pop("clusterIndex", None)
            ledger["cacheLocation"] = "~/.omp/agent/omp-harvester-cache.json"
            ledger["summary"]["watermarkedFilesCount"] = len(self.file_watermarks)
            ledger["summary"]["clusterIndexCount"] = len(self.cluster_index)
        else:
            ledger["fileWatermarks"] = self.file_watermarks
            ledger["clusterIndex"] = self.cluster_index

        suite_counts: Dict[str, int] = {}
        for a in self.harvested_artifacts:
            s = a.get("suite", "general_utilities")
            suite_counts[s] = suite_counts.get(s, 0) + 1

        ledger.setdefault("suites", {})
        for s_name, count in suite_counts.items():
            entry = ledger["suites"].setdefault(s_name, {
                "targetPath": f"config/omp/agent/skills/{s_name.replace('_', '-')}",
                "status": "HARVESTED",
            })
            entry["harvestedCount"] = count

        dupe_source = (
            [(h, items) for h, items in self.duplicate_groups.items() if len(items) > 1]
            if self.include_noise
            else actionable_dupes
        )
        top_dupes = []
        for c_hash, items in sorted(dupe_source, key=lambda x: len(x[1]), reverse=True):
            top_dupes.append({
                "hash": c_hash,
                "suite": items[0]["suite"],
                "occurrences": len(items),
                "targets": [x["target"] for x in items[:5]],
            })
        ledger["topDuplicateClusters"] = top_dupes[:20]

        self._save_ledger_doc(ledger)
        print(f"[v] Updated ledger at {self.ledger_path}")

    def generate_inventory_report(self, output_path: Optional[str] = None) -> None:
        if output_path is None:
            _, _, output_path = resolve_default_paths()
        suite_groups: Dict[str, List[Dict[str, Any]]] = {}
        noise_count = 0
        for art in self.harvested_artifacts:
            if art.get("isNoise"):
                noise_count += 1
            suite_groups.setdefault(art.get("suite", "general_utilities"), []).append(art)

        lines = [
            "# OMP Harvest Inventory & Deduplication Report",
            "",
            f"- **Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
            f"- **OMP Sessions Scanned:** {self.session_stats['omp_sessions']} ({self.session_stats['omp_top_level']} top, {self.session_stats['omp_subagents']} subagents; {self.session_stats['omp_advisors_skipped']} advisors skipped, {self.session_stats['omp_advisors_included']} advisors included)",
            f"- **Claude Sessions Scanned:** {self.session_stats['claude_sessions']} ({self.session_stats['claude_top_level']} top, {self.session_stats['claude_subagents']} subagents/journals; {self.session_stats['claude_history_entries']} history.jsonl entries)",
            f"- **Incremental Skips (Unchanged Watermarks):** {self.session_stats['skipped_unchanged']}",
            f"- **Total Candidate Artifacts Indexed:** {len(self.harvested_artifacts)} (Actionable: {len(self.harvested_artifacts) - noise_count}, Ephemeral Noise Filtered: {noise_count})",
            f"- **Unique Code Hashes:** {len(self.duplicate_groups)}",
            "",
            "## 1. Summary by Target Suite",
            "",
            "| Target Suite | Extracted Artifacts | Target OMP Priority-100 Location |",
            "|---|---:|---|",
        ]
        target_paths = {
            "pmo_project_suite": "`config/omp/agent/skills/pmo-project-suite`",
            "office_doc_suite": "`config/omp/agent/skills/office-doc-suite`",
            "email_intelligence_suite": "`config/omp/agent/skills/email-intelligence-suite`",
            "system_maintenance_suite": "`config/omp/agent/skills/system-maintenance-suite`",
            "omp_session_harvester": "`config/omp/agent/skills/omp-session-harvester`",
            "dev_ops_automation": "Classified dev/ops automation helpers (promotionQueue candidates)",
            "general_utilities": "Triaged (Tier A promoted / Tier B opt-in / Tier C excluded)",
        }
        for s_name, items in sorted(suite_groups.items(), key=lambda x: len(x[1]), reverse=True):
            loc = target_paths.get(s_name, f"`config/omp/agent/skills/{s_name.replace('_', '-')}`")
            lines.append(f"| **`{s_name}`** | {len(items)} | {loc} |")

        sorted_clusters = sorted(self.duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True)
        dup_clusters = [
            (h, items) for h, items in sorted_clusters
            if len(items) > 1 and (self.include_noise or not all(bool(x.get("isNoise")) for x in items))
        ]
        lines.extend([
            "",
            "## 2. Top Duplicated Code Clusters (Repeated Utilities)",
            "",
            f"Found **{len(dup_clusters)}** actionable duplicate code clusters across scanned sessions and workspaces:",
            "",
            "| Hash | Occurrences | Suite | Sample Targets / Snippet Preview |",
            "|---|---:|---|---|",
        ])
        if not dup_clusters:
            lines.append("| - | 0 | - | No verbatim duplicate scripts detected across workspaces. |")
        else:
            for c_hash, items in dup_clusters[:20]:
                rep = items[0]
                targets_sample = ", ".join(list(dict.fromkeys(x["target"] for x in items))[:3])
                preview = rep["snippet_preview"][:120].replace("|", "\\|")
                lines.append(f"| `{c_hash}` | **{len(items)}** | `{rep['suite']}` | `{targets_sample}`<br>*{preview}* |")

        if self.global_diff_report:
            lines.extend([
                "",
                "## 3. Global vs Project `.omp`/`.claude`/`.agent` Delta Summary",
                "",
                f"- **Project Config Dirs Scanned (Tier C excluded):** {self.global_diff_report['projectConfigDirsScanned']}",
                f"- **Dirs with Unpromoted Assets / Links:** {self.global_diff_report['projectDeltasCount']}",
                f"- **Container-level Links Detected:** {self.global_diff_report.get('containerLinksCount', 0)}",
                "",
                "| Project Config Dir | Missing from Global OMP | Links/Junctions |",
                "|---|---|---|",
            ])
            for d in self.global_diff_report.get("deltas", [])[:30]:
                miss_str = ", ".join(f"{k}:{len(v)}" for k, v in d["missingFromOmpGlobal"].items()) or "-"
                lnk_str = str(len(d["links"])) if d["links"] else "-"
                lines.append(f"| `{d['dir']}` | {miss_str} | {lnk_str} |")

        lines.extend([
            "",
            "## 4. Recommended Consolidation Actions",
            "",
            "1. **PMO Project Suite (`pmo-project-suite`):** Priority-100 skill + 4 `pmo-*.md` agents + `pmo-delivery` command.",
            "2. **Office Document Suite (`office-doc-suite`):** Priority-100 skill unifying MD<->DOCX, Mermaid SSR, XLSX, KPI & spatial extractors.",
            "3. **Email Intelligence Suite (`email-intelligence-suite`):** Cross-OS `.eml`/`.msg` + optional Outlook COM parser & issue extractor.",
            "4. **System Maintenance Suite (`system-maintenance-suite`):** Unified Windows `.ps1` + macOS `.sh` cleaners & uninstaller builder.",
            "",
        ])

        _atomic_write_text(Path(output_path), "\n".join(lines))
        print(f"[v] Generated inventory report at {output_path}")

    def get_round_summary(self) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            return {"status": "NO_LEDGER", "round": 0, "pendingCount": 0, "stagedCount": 0, "stop": True, "stopReason": "no_ledger"}
        ledger = self._load_ledger_doc()
        loop_meta = ledger.get("loopMeta", {})
        round_num = int(loop_meta.get("round", 0))
        max_rounds = int(loop_meta.get("maxRounds", 20))
        queue = [x for x in (ledger.get("promotionQueue") or []) if isinstance(x, dict)]
        staged = [x for x in queue if x.get("state") == "staged"]
        pending = [x for x in queue if x.get("state") == "pending"]
        stop_reason = None
        if not staged and not pending:
            stop_reason = "actionable_queue_empty"
        elif round_num >= max_rounds:
            stop_reason = "max_rounds_reached"
        return {
            "status": ledger.get("status", "READY"),
            "round": round_num,
            "maxRounds": max_rounds,
            "stagedCount": len(staged),
            "pendingCount": len(pending),
            "stagedBatch": staged[:5],
            "nextBatch": pending[:5],
            "promotedCount": len(ledger.get("promotedHashes", {})),
            "dispositionsCount": len(ledger.get("clusterDispositions", {})),
            "stop": stop_reason is not None,
            "stopReason": stop_reason,
        }

    def get_next_unit(self) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            return {"type": "none", "status": "NO_LEDGER", "stop": True, "next": "Run --scan to initialize ledger"}
        ledger = self._load_ledger_doc()
        loop_meta = ledger.get("loopMeta", {})
        round_num = int(loop_meta.get("round", 0))
        max_rounds = int(loop_meta.get("maxRounds", 20))
        queue = [x for x in (ledger.get("promotionQueue") or []) if isinstance(x, dict)]
        staged = [x for x in queue if x.get("state") == "staged"]
        pending = [x for x in queue if x.get("state") == "pending"]
        drift = ledger.get("driftDetails", {})

        if staged:
            return {
                "type": "drift" if ledger.get("status") == "DRIFT_DETECTED" else "staged_resume",
                "status": ledger.get("status", "HARVESTED"),
                "round": round_num,
                "stagedBatch": staged[:5],
                "batch": staged[:5],
                "pendingCount": len(pending),
                "stop": False,
                "unpromotedHashes": drift.get("unpromotedHashes", []),
                "unpromotedDeltaDirs": drift.get("unpromotedDeltaDirs", []),
                "next": "Resume staged cluster verification via pytest/bun test then run --commit-stage",
            }

        if pending and round_num < max_rounds:
            return {
                "type": "drift" if ledger.get("status") == "DRIFT_DETECTED" else "promotion_batch",
                "status": ledger.get("status", "HARVESTED"),
                "round": round_num,
                "stagedBatch": [],
                "batch": pending[:5],
                "pendingCount": len(pending),
                "stop": False,
                "unpromotedHashes": drift.get("unpromotedHashes", []),
                "unpromotedDeltaDirs": drift.get("unpromotedDeltaDirs", []),
                "next": "Run --stage <hash> and --extract <hash>, promote into target skill, test, then --commit-stage",
            }

        if ledger.get("status") == "DRIFT_DETECTED":
            return {
                "type": "drift",
                "status": "DRIFT_DETECTED",
                "round": round_num,
                "stagedBatch": [],
                "batch": [],
                "pendingCount": 0,
                "stop": len(drift.get("unpromotedDeltaDirs", [])) == 0 and len(drift.get("unpromotedHashes", [])) == 0,
                "unpromotedHashes": drift.get("unpromotedHashes", []),
                "unpromotedDeltaDirs": drift.get("unpromotedDeltaDirs", []),
                "next": "Inspect unpromoted clusters via --extract <hash> or triage remaining delta dirs",
            }

        for name, meta in ledger.get("suites", {}).items():
            st = meta.get("status", "PENDING")
            if st not in ("PACKAGED", "VERIFIED", "VERIFIED_E2E"):
                return {"type": "suite", "name": name, "status": st, "targetPath": meta.get("targetPath"), "round": round_num, "stop": False}
        for gap_name, meta in ledger.get("backupParityGaps", {}).items():
            st = meta.get("status", "PENDING")
            if st not in ("VERIFIED", "VERIFIED_E2E", "DONE"):
                return {"type": "backupGap", "name": gap_name, "status": st, "round": round_num, "stop": False}
        return {
            "type": "complete",
            "status": ledger.get("status", "READY"),
            "round": round_num,
            "pendingCount": 0,
            "stop": True,
            "stopReason": "actionable_queue_empty" if round_num < max_rounds else "max_rounds_reached",
            "next": "All tracked units completed",
        }

    def verify_ledger(self) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            return {"valid": False, "error": f"Ledger missing: {self.ledger_path}"}
        ledger = self._load_ledger_doc()
        base_root = find_repo_root() or Path.cwd()
        missing_targets = []
        for name, meta in ledger.get("suites", {}).items():
            tp = meta.get("targetPath")
            st = meta.get("status", "")
            if tp and st in ("PACKAGED", "VERIFIED", "VERIFIED_E2E"):
                if not os.path.exists(tp) and not (base_root / tp).exists():
                    missing_targets.append({"suite": name, "targetPath": tp})
        return {"valid": len(missing_targets) == 0, "missingTargets": missing_targets}

def run_interactive_menu(harvester: SessionHarvester) -> None:
    while True:
        print("\n" + "=" * 54)
        print(" OMP & Claude Multi-Source Harvester CLI (V3)")
        print("=" * 54)
        print("1. Scan OMP + Claude sessions, history.db & workspaces (incremental)")
        print("2. Scan + Global .omp/.claude/.agent diff")
        print("3. Update ledger and generate Markdown report")
        print("4. Show next pending loop unit (--next)")
        print("5. View top duplicated code clusters / extract by hash")
        print("6. Exit")
        try:
            choice = input("\nSelect option [1-6]: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break

        if choice == "1":
            harvester.scan_sessions()
            harvester.scan_workspaces()
        elif choice == "2":
            harvester.scan_sessions()
            harvester.scan_workspaces()
            harvester.scan_global_diff()
        elif choice == "3":
            if not harvester.harvested_artifacts:
                harvester.scan_sessions()
                harvester.scan_workspaces()
            harvester.update_ledger()
            harvester.generate_inventory_report()
        elif choice == "4":
            print(json.dumps(harvester.get_next_unit(), indent=2, ensure_ascii=False))
        elif choice == "5":
            if not harvester.duplicate_groups:
                harvester.scan_sessions()
                harvester.scan_workspaces()
            print("\n--- Top Duplicated Clusters ---")
            for h, items in sorted(harvester.duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True)[:10]:
                print(f"[{h}] {len(items)} times ({items[0]['suite']}): {items[0]['target']}")
        elif choice == "6" or not choice:
            print("Done.")
            break
        else:
            print("[!] Invalid selection.")


def main(argv: Optional[List[str]] = None) -> int:
    _, def_ledger, def_report = resolve_default_paths()
    parser = argparse.ArgumentParser(description="Harvest reusable OMP & Claude tools across sessions and workspaces.")
    parser.add_argument("--scan", action="store_true", help="Run non-interactive scan & update ledger/report.")
    parser.add_argument("--diff-global", action="store_true", help="Scan project .omp/.claude/.agent dirs against global.")
    parser.add_argument("--next", action="store_true", help="Print next pending loop unit from ledger.")
    parser.add_argument("--round-summary", action="store_true", help="Print current V4 loop round summary and stop status.")
    parser.add_argument("--verify-ledger", action="store_true", help="Verify claimed packaged paths in ledger.")
    parser.add_argument("--extract", type=str, default=None, help="Extract full original script for cluster hash.")
    parser.add_argument("--out", type=str, default="extracted_clusters", help="Output directory for --extract.")
    parser.add_argument("--stage", type=str, default=None, help="Mark cluster hash as staged prior to verification.")
    parser.add_argument("--commit-stage", type=str, default=None, help="Commit staged cluster hash into promotedHashes.")
    parser.add_argument("--triage", type=str, default=None, help="Record cluster disposition without promoting.")
    parser.add_argument("--disposition", type=str, choices=["promoted", "merged_into", "deferred", "ignored_noise"], default=None, help="Disposition for --triage.")
    parser.add_argument("--suite", type=str, default=None, help="Target suite for --commit-stage or --triage.")
    parser.add_argument("--target", type=str, default=None, help="Target file/skill path for --commit-stage or --triage.")
    parser.add_argument("--full-rescan", action="store_true", help="Ignore fileWatermarks and re-parse all transcripts.")
    parser.add_argument("--include-advisors", action="store_true", help="Include __advisor*.jsonl files in scan.")
    parser.add_argument("--include-noise", action="store_true", help="Include ephemeral noise clusters in promotionQueue.")
    parser.add_argument("--no-local-config", action="store_true", help="Ignore ~/.omp/harvest-workspaces.local.json.")
    parser.add_argument("--sessions-dir", type=str, default=None, help="Custom OMP sessions directory.")
    parser.add_argument("--claude-projects-dir", type=str, default=None, help="Custom Claude projects directory.")
    parser.add_argument("--claude-history", type=str, default=None, help="Custom Claude history.jsonl path.")
    parser.add_argument("--history-db", type=str, default=None, help="Custom OMP history.db path.")
    parser.add_argument("--config", type=str, default=None, help="Path to harvest-workspaces.json.")
    parser.add_argument("--ledger", type=str, default=def_ledger, help="Path to consolidation ledger.")
    parser.add_argument("--report", type=str, default=def_report, help="Path to markdown inventory report.")
    parser.add_argument("--workspaces", nargs="*", default=None, help="Explicit workspace directories to scan.")

    args = parser.parse_args(argv)
    harvester = SessionHarvester(
        sessions_dir=args.sessions_dir,
        claude_projects_dir=args.claude_projects_dir,
        claude_history_path=args.claude_history,
        history_db_path=args.history_db,
        config_path=args.config,
        ledger_path=args.ledger,
        no_local_config=args.no_local_config,
        full_rescan=args.full_rescan,
        include_advisors=args.include_advisors,
        include_noise=args.include_noise,
    )

    if args.extract:
        res = harvester.extract_cluster(args.extract, args.out)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0
    if args.stage:
        res = harvester.stage_cluster(args.stage)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0
    if args.commit_stage:
        if not args.suite or not args.target:
            parser.error("--commit-stage requires --suite and --target")
        res = harvester.commit_stage(args.commit_stage, args.suite, args.target)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0
    if args.triage:
        if not args.disposition:
            parser.error("--triage requires --disposition")
        res = harvester.triage_cluster(args.triage, args.disposition, suite=args.suite, target=args.target)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0
    if args.round_summary and not args.scan:
        print(json.dumps(harvester.get_round_summary(), indent=2, ensure_ascii=False))
        return 0
    if args.next and not args.scan:
        print(json.dumps(harvester.get_next_unit(), indent=2, ensure_ascii=False))
        return 0
    if args.verify_ledger and not args.scan:
        res = harvester.verify_ledger()
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0 if res.get("valid") else 1
    if args.scan or args.diff_global:
        harvester.scan_sessions()
        harvester.scan_workspaces(workspace_paths=args.workspaces)
        if args.diff_global:
            harvester.scan_global_diff()
        harvester.update_ledger()
        harvester.generate_inventory_report(output_path=args.report)
        return 0

    if sys.stdin.isatty():
        run_interactive_menu(harvester)
    else:
        harvester.scan_sessions()
        harvester.scan_workspaces(workspace_paths=args.workspaces)
        harvester.update_ledger()
        harvester.generate_inventory_report(output_path=args.report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
