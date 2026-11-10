#!/usr/bin/env python3
"""
harvester_core.py — Canonical Multi-Source OMP & Claude Harvester + Global Diff Engine

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
    ],
}

PATH_AFFINITIES = [
    (re.compile(r"(email[-_]export|email[-_]intelligence)", re.IGNORECASE), "email_intelligence_suite", 10),
    (re.compile(r"(project[-_]excel[-_]sync|pmi[-_]pmo|pmo|note[-_]multiline|schedule_calc)", re.IGNORECASE), "pmo_project_suite", 10),
    (re.compile(r"(cleanpc|wiztree|uninstaller|cleanup|windows_fix)", re.IGNORECASE), "system_maintenance_suite", 10),
    (re.compile(r"(document[-_]analysis|spatial|md[-_]convert|docx|pdf|kpi[-_]|bbox)", re.IGNORECASE), "office_doc_suite", 10),
]

CODE_EXTS = (".py", ".ps1", ".sh", ".ts", ".js", ".cjs", ".mjs", ".bat", ".cmd", ".psm1")
SKILL_DOC_HINTS = ("/skills/", "/agents/", "/commands/", "/rules/", "/workflows/", "skill.md")

EVAL_CODE_INDICATORS = (
    "def ", "class ", "function ", "async ", "import ", "from ", "require(",
    "openpyxl", "docx", "defusedxml", "extract_msg", "email", "pdfplumber",
    "pypdf", "sqlite3", "subprocess", "shutil", "wbs", "cpm", "evm", "raid",
    "ConvertFrom-", "New-Object",
)

SENSITIVE_PATTERNS: List[Tuple[re.Pattern[str], Any]] = [
    (re.compile(r"(sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|tvly-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]+)"), "[REDACTED_API_KEY]"),
    (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "[REDACTED_JWT]"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{20,}", re.IGNORECASE), "Bearer [REDACTED_TOKEN]"),
    (re.compile(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.(?:internal|corp|local)", re.IGNORECASE), "[REDACTED_INTERNAL_EMAIL]"),
]

_WIN_DRIVE_RE = re.compile(r"[A-Za-z]:[\\/][^\"'\s`<>|]+")


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
        tail = parts[-2:] if len(parts) >= 2 else parts
        norm = "<local-workspace>/" + "/".join(tail)
    elif norm.startswith(("/Users/", "/home/")):
        parts = [p for p in norm.split("/") if p]
        if len(parts) >= 2:
            norm = "~/" + "/".join(parts[2:])
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
        self.config = self._load_config()
        self.priv_pat = _private_terms_pattern(self.config, allow_local=not self.no_local_config)
        self.ledger_path = ledger_path if ledger_path is not None else def_ledger
        self.harvested_artifacts: List[Dict[str, Any]] = []
        self.duplicate_groups: Dict[str, List[Dict[str, Any]]] = {}
        self.history_summary: Dict[str, Any] = {}
        self.global_diff_report: Dict[str, Any] = {}
        self.session_stats: Dict[str, int] = {
            "omp_sessions": 0,
            "omp_top_level": 0,
            "omp_subagents": 0,
            "omp_advisors_skipped": 0,
            "claude_sessions": 0,
            "claude_top_level": 0,
            "claude_subagents": 0,
            "claude_history_entries": 0,
            "total_tool_calls": 0,
            "extracted_scripts": 0,
        }

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

    def _record_artifact(self, session_rel: str, tool_kind: str, target_path: str, code_content: str, source_kind: str = "omp") -> None:
        c_hash = compute_code_hash(code_content)
        suite = classify_snippet(code_content, target_path)
        sanitized = sanitize_text(code_content, priv_pat=self.priv_pat)
        artifact = {
            "source": source_kind,
            "session": sanitize_path(session_rel, priv_pat=self.priv_pat),
            "tool": tool_kind,
            "target": sanitize_path(target_path, priv_pat=self.priv_pat),
            "suite": suite,
            "hash": c_hash,
            "lines": len(code_content.splitlines()),
            "bytes": len(code_content),
            "snippet_preview": sanitized[:200].replace("\n", " ") + ("..." if len(sanitized) > 200 else ""),
        }
        self.harvested_artifacts.append(artifact)
        self.duplicate_groups.setdefault(c_hash, []).append(artifact)
        self.session_stats["extracted_scripts"] += 1

    def scan_omp_sessions(self) -> None:
        if not self.sessions_dir or not os.path.exists(self.sessions_dir):
            return
        all_jsonl = glob.glob(os.path.join(self.sessions_dir, "**", "*.jsonl"), recursive=True)
        session_files = [
            sf for sf in all_jsonl
            if not os.path.basename(sf).startswith(("__advisor", ".__advisor"))
        ]
        advisors_skipped = len(all_jsonl) - len(session_files)
        top_level_count = 0
        for sf in session_files:
            rel = os.path.relpath(sf, self.sessions_dir).replace("\\", "/")
            if rel.count("/") <= 1:
                top_level_count += 1
        subagent_count = len(session_files) - top_level_count
        self.session_stats["omp_sessions"] = len(session_files)
        self.session_stats["omp_top_level"] = top_level_count
        self.session_stats["omp_subagents"] = subagent_count
        self.session_stats["omp_advisors_skipped"] = advisors_skipped
        print(
            f"[*] OMP sessions: {len(session_files)} transcripts "
            f"({top_level_count} top-level, {subagent_count} subagents; {advisors_skipped} advisors skipped)"
        )

        for sf in session_files:
            rel_session = os.path.relpath(sf, self.sessions_dir)
            captured: Dict[str, Tuple[str, str]] = {}
            eval_counter = 0
            edit_counter = 0
            try:
                with open(sf, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
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
                            self.session_stats["total_tool_calls"] += 1
                            name = block.get("name", "")
                            args = block.get("arguments", {})
                            if not isinstance(args, dict):
                                continue

                            if name == "write":
                                tp = str(args.get("path", "")).strip()
                                body = str(args.get("content", ""))
                                if tp and len(body) > 100 and _is_code_or_skill_path(tp):
                                    captured[tp] = ("write", body)
                            elif name == "edit":
                                tp = str(args.get("path", "")).strip()
                                new_txt = str(args.get("newText") or args.get("new_string") or args.get("input") or "")
                                if tp and len(new_txt) > 80 and _is_code_or_skill_path(tp):
                                    edit_counter += 1
                                    captured[f"{tp}#edit{edit_counter}"] = ("edit", new_txt)
                            elif name == "eval":
                                lang = str(args.get("language", "py") or "py")
                                body = str(args.get("code", ""))
                                if len(body) > 100 and any(kw in body for kw in EVAL_CODE_INDICATORS):
                                    eval_counter += 1
                                    h8 = compute_code_hash(body)[:8]
                                    captured[f"eval_{lang}_{eval_counter}_{h8}"] = ("eval", body)
                            elif name == "bash":
                                cmd = str(args.get("command", ""))
                                for tp, body in _extract_bash_scripts(cmd):
                                    captured[tp] = ("bash", body)

                for tp, (tool_kind, body) in captured.items():
                    self._record_artifact(rel_session, tool_kind, tp, body, source_kind="omp")
            except Exception as e:
                print(f"[!] Warning reading OMP session {sf}: {e}", file=sys.stderr)

    def scan_claude_sessions(self) -> None:
        if self.claude_history_path and os.path.exists(self.claude_history_path):
            try:
                with open(self.claude_history_path, "r", encoding="utf-8", errors="ignore") as f:
                    self.session_stats["claude_history_entries"] = sum(1 for ln in f if ln.strip())
            except Exception:
                pass

        if not self.claude_projects_dir or not os.path.exists(self.claude_projects_dir):
            return
        all_jsonl = glob.glob(os.path.join(self.claude_projects_dir, "**", "*.jsonl"), recursive=True)
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
            rel_session = os.path.relpath(sf, self.claude_projects_dir)
            captured: Dict[str, Tuple[str, str]] = {}
            edit_counter = 0
            try:
                with open(sf, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
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
                            self.session_stats["total_tool_calls"] += 1
                            name = block.get("name", "")
                            inp = block.get("input", {})
                            if not isinstance(inp, dict):
                                continue

                            if name == "Write":
                                tp = str(inp.get("file_path", "")).strip()
                                body = str(inp.get("content", ""))
                                if tp and len(body) > 100 and _is_code_or_skill_path(tp):
                                    captured[tp] = ("Write", body)
                            elif name == "Edit":
                                tp = str(inp.get("file_path", "")).strip()
                                new_txt = str(inp.get("new_string", ""))
                                if tp and len(new_txt) > 80 and _is_code_or_skill_path(tp):
                                    edit_counter += 1
                                    captured[f"{tp}#edit{edit_counter}"] = ("Edit", new_txt)
                            elif name == "Bash":
                                cmd = str(inp.get("command", ""))
                                for tp, body in _extract_bash_scripts(cmd):
                                    captured[tp] = ("Bash", body)

                for tp, (tool_kind, body) in captured.items():
                    self._record_artifact(rel_session, tool_kind, tp, body, source_kind="claude")
            except Exception as e:
                print(f"[!] Warning reading Claude session {sf}: {e}", file=sys.stderr)

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
            f"[v] Parsed {self.session_stats['total_tool_calls']} tool calls; "
            f"extracted {self.session_stats['extracted_scripts']} candidate code artifacts from sessions."
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
                        artifact = {
                            "source": "workspace",
                            "session": "local_workspace",
                            "tool": "file",
                            "target": sanitize_path(fp, priv_pat=self.priv_pat),
                            "suite": suite,
                            "hash": c_hash,
                            "lines": len(content.splitlines()),
                            "bytes": sz,
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
                            if not os.path.isdir(sp):
                                continue
                            entries = sorted(e for e in os.listdir(sp) if not e.startswith("."))
                            missing = [e for e in entries if e not in ref_set]
                            for e in entries:
                                lnk, tgt = is_reparse_or_symlink(os.path.join(sp, e))
                                if lnk:
                                    item["links"].append({"sub": sub, "entry": e, "target": sanitize_path(tgt or "", priv_pat=self.priv_pat)})
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
            "deltas": deltas,
        }
        print(
            f"[v] Global diff: scanned {len(discovered_dirs)} non-excluded .omp/.claude/.agent dirs; "
            f"{len(deltas)} carry unpromoted items or symlinks."
        )
        return self.global_diff_report

    def update_ledger(self) -> None:
        if not os.path.exists(self.ledger_path):
            ledger: Dict[str, Any] = {"version": "2.0.0", "suites": {}, "summary": {}}
        else:
            with open(self.ledger_path, "r", encoding="utf-8") as f:
                ledger = json.load(f)

        ledger["version"] = "2.0.0"
        ledger.setdefault("summary", {})
        ledger["summary"].update({
            "ompSessionsScouted": self.session_stats["omp_sessions"],
            "claudeSessionsScouted": self.session_stats["claude_sessions"],
            "totalSessionsScouted": self.session_stats["omp_sessions"] + self.session_stats["claude_sessions"],
            "historyDbPrompts": self.history_summary.get("prompts", 0),
            "historyDbRecaps": self.history_summary.get("recaps", 0),
            "harvestedArtifactsCount": len(self.harvested_artifacts),
            "uniqueCodeClusters": len(self.duplicate_groups),
            "lastHarvestTimestamp": datetime.now(timezone.utc).isoformat(),
        })
        if self.global_diff_report:
            ledger["summary"]["projectConfigDirsScanned"] = self.global_diff_report["projectConfigDirsScanned"]
            ledger["summary"]["projectDeltasCount"] = self.global_diff_report["projectDeltasCount"]
            ledger["globalDiffSummary"] = {
                k: v for k, v in self.global_diff_report.items() if k != "deltas"
            }

        if ledger.get("status") not in ("COMPLETED", "VERIFIED_E2E"):
            ledger["status"] = "HARVESTED"

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

        top_dupes = []
        for c_hash, items in sorted(self.duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True):
            if len(items) > 1:
                top_dupes.append({
                    "hash": c_hash,
                    "suite": items[0]["suite"],
                    "occurrences": len(items),
                    "targets": [x["target"] for x in items[:5]],
                })
        ledger["topDuplicateClusters"] = top_dupes[:20]

        parent = os.path.dirname(self.ledger_path) or "."
        os.makedirs(parent, exist_ok=True)
        with open(self.ledger_path, "w", encoding="utf-8") as f:
            json.dump(ledger, f, indent=2, ensure_ascii=False)
        print(f"[v] Updated ledger at {self.ledger_path}")

    def generate_inventory_report(self, output_path: Optional[str] = None) -> None:
        if output_path is None:
            _, _, output_path = resolve_default_paths()
        suite_groups: Dict[str, List[Dict[str, Any]]] = {}
        for art in self.harvested_artifacts:
            suite_groups.setdefault(art.get("suite", "general_utilities"), []).append(art)

        lines = [
            "# OMP Harvest Inventory & Deduplication Report",
            "",
            f"- **Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
            f"- **OMP Sessions Scanned:** {self.session_stats['omp_sessions']} ({self.session_stats['omp_top_level']} top, {self.session_stats['omp_subagents']} subagents, {self.session_stats['omp_advisors_skipped']} advisors skipped)",
            f"- **Claude Sessions Scanned:** {self.session_stats['claude_sessions']} ({self.session_stats['claude_top_level']} top, {self.session_stats['claude_subagents']} subagents/journals; {self.session_stats['claude_history_entries']} history.jsonl entries)",
            f"- **Total Candidate Artifacts Extracted:** {len(self.harvested_artifacts)}",
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
            "general_utilities": "Triaged (Tier A promoted / Tier B opt-in / Tier C excluded)",
        }
        for s_name, items in sorted(suite_groups.items(), key=lambda x: len(x[1]), reverse=True):
            loc = target_paths.get(s_name, f"`config/omp/agent/skills/{s_name.replace('_', '-')}`")
            lines.append(f"| **`{s_name}`** | {len(items)} | {loc} |")

        sorted_clusters = sorted(self.duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True)
        dup_clusters = [(h, items) for h, items in sorted_clusters if len(items) > 1]
        lines.extend([
            "",
            "## 2. Top Duplicated Code Clusters (Repeated Utilities)",
            "",
            f"Found **{len(dup_clusters)}** duplicate code clusters across scanned sessions and workspaces:",
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

        parent = os.path.dirname(output_path) or "."
        os.makedirs(parent, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"[v] Generated inventory report at {output_path}")

    def get_next_unit(self) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            return {"status": "NO_LEDGER", "next": "Run --scan to initialize ledger"}
        with open(self.ledger_path, "r", encoding="utf-8") as f:
            ledger = json.load(f)
        for name, meta in ledger.get("suites", {}).items():
            st = meta.get("status", "PENDING")
            if st not in ("PACKAGED", "VERIFIED", "VERIFIED_E2E"):
                return {"type": "suite", "name": name, "status": st, "targetPath": meta.get("targetPath")}
        for gap_name, meta in ledger.get("backupParityGaps", {}).items():
            st = meta.get("status", "PENDING")
            if st not in ("VERIFIED", "VERIFIED_E2E", "DONE"):
                return {"type": "backupGap", "name": gap_name, "status": st}
        return {"status": ledger.get("status", "READY"), "next": "All tracked units completed"}

    def verify_ledger(self) -> Dict[str, Any]:
        if not os.path.exists(self.ledger_path):
            return {"valid": False, "error": f"Ledger missing: {self.ledger_path}"}
        with open(self.ledger_path, "r", encoding="utf-8") as f:
            ledger = json.load(f)
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
        print(" OMP & Claude Multi-Source Harvester CLI (V2)")
        print("=" * 54)
        print("1. Scan OMP + Claude sessions, history.db & workspaces")
        print("2. Scan + Global .omp/.claude/.agent diff")
        print("3. Update ledger and generate Markdown report")
        print("4. Show next pending loop unit (--next)")
        print("5. View top duplicated code clusters")
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
    parser.add_argument("--verify-ledger", action="store_true", help="Verify claimed packaged paths in ledger.")
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
    )

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
