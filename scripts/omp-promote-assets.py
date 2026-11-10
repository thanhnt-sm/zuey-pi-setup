#!/usr/bin/env python3
"""
scripts/omp-promote-assets.py — Promote & Sanitize Tier A/B Assets and Global Claude Core into config/omp/agent/
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

IGNORE_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", ".shadowed", ".claude", "logs"}
SKIP_EXTS = {".pyc", ".pyo", ".mp4", ".mp3", ".wav", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".csv", ".db", ".sqlite"}

SANITIZE_RULES = [
    (re.compile(r"(sk-ant-[A-Za-z0-9_-]{8,}|sk-proj-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{24,}|AIza[0-9A-Za-z_-]{16,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})"), "<API_TOKEN>"),
    (re.compile(r'["\x27](?:YOUR_API_KEY|your_api_key(?:_here)?|secure_password|your_password|new_secure_password|SecurePass123!)["\x27]'), '"<PLACEHOLDER>"'),
    (re.compile(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]*\.(?:internal|corp|local)", re.IGNORECASE), "user@example.com"),
    (re.compile(r"[A-Za-z]:[/\\\\]+Users[/\\\\]+[A-Za-z0-9._-]+", re.IGNORECASE), "~"),
    (re.compile(r"[A-Za-z]:[/\\\\]+(?:Projects|Work|Repos|My\sDrive|Google\sDrive)[^\"'\s`<>)\]]*", re.IGNORECASE), "<local-workspace>"),
    (re.compile(r"[D-Z]:[/\\\\]+(?![A-Za-z]?[/\\\\]*$)[^\"'\s`<>)\]]+"), "<local-workspace>"),
]

TEXT_EXTS = {".md", ".txt", ".py", ".ps1", ".sh", ".bat", ".cmd", ".ts", ".js", ".cjs", ".mjs", ".json", ".yml", ".yaml", ".toml"}

_CLAUDE_TOOL_MAP = {
    "read": "read",
    "grep": "grep",
    "glob": "glob",
    "bash": "bash",
    "edit": "edit",
    "write": "write",
    "websearch": "web_search",
    "askuserquestion": "ask",
    "agent": "task",
    "task": "task",
}
_CLAUDE_DROP_FM = {"memory", "omitclaudemd", "maxturns", "effort", "disallowedtools"}
_MODEL_MAP = {"opus": '"@slow"', "sonnet": '"@default"', "haiku": '"@smol"'}
_PROTECTED_AGENTS = {"advisor.md", "ck-advisor.md"}


def _private_terms_pattern(config: Optional[Dict[str, Any]] = None, allow_local: bool = True) -> Optional[re.Pattern[str]]:
    terms: List[str] = [t.strip() for t in os.environ.get("OMP_SENSITIVE_TERMS", "").split(",") if t.strip()]
    if config and isinstance(config.get("privateKeywords"), list):
        terms.extend(str(t).strip() for t in config["privateKeywords"] if str(t).strip())
    if allow_local:
        local_cfg = Path.home() / ".omp" / "harvest-workspaces.local.json"
        if local_cfg.is_file():
            try:
                terms.extend(str(t).strip() for t in json.loads(local_cfg.read_text(encoding="utf-8")).get("privateKeywords", []) if str(t).strip())
            except Exception:
                pass
    if not terms:
        return None
    return re.compile("|".join(re.escape(t) for t in sorted(set(terms), key=len, reverse=True)), re.IGNORECASE)


def _merge_configs(base: Dict[str, Any], local: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for k in ("scanRoots", "additionalWorkspaces", "excludeDirNames", "tierCExcludeGlobs", "privateKeywords"):
        combined: List[str] = []
        seen: Set[str] = set()
        for src in (base, local):
            for v in src.get(k, []) or []:
                sv = str(v)
                if sv not in seen:
                    seen.add(sv)
                    combined.append(sv)
        if combined or k in base or k in local:
            merged[k] = combined

    if "tierBOptInSources" in base or "tierBOptInSources" in local:
        b_out: List[Any] = []
        seen_src: Set[str] = set()
        for src in (base, local):
            for item in src.get("tierBOptInSources", []) or []:
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
    return merged


def sanitize_content(text: str, priv_pat: Optional[re.Pattern[str]] = None) -> str:
    res = text
    for pat, repl in SANITIZE_RULES:
        res = pat.sub(repl, res)
    if priv_pat is not None:
        res = priv_pat.sub("[PROJECT_CODE]", res)
    return res


def ensure_hide_true(md_text: str) -> str:
    if not md_text.startswith("---"):
        return "---\nhide: true\n---\n\n" + md_text
    end = md_text.find("\n---", 3)
    if end == -1:
        return md_text
    fm = md_text[3:end]
    if re.search(r"^\s*hide\s*:", fm, re.MULTILINE):
        fm = re.sub(r"^\s*hide\s*:.*$", "hide: true", fm, flags=re.MULTILINE)
    else:
        fm = fm.rstrip() + "\nhide: true"
    return "---" + fm + md_text[end:]


def inject_autoload_skills(md_text: str, skills: List[str]) -> str:
    if not md_text.startswith("---"):
        return md_text
    end = md_text.find("\n---", 3)
    if end == -1:
        return md_text
    fm = md_text[3:end]
    if "autoloadSkills" in fm:
        return md_text
    fm = fm.rstrip() + "\nautoloadSkills: [" + ", ".join(skills) + "]"
    return "---" + fm + md_text[end:]


def convert_claude_agent_to_omp(md_text: str, priv_pat: Optional[re.Pattern[str]] = None) -> str:
    if not md_text.startswith("---"):
        return sanitize_content(md_text, priv_pat=priv_pat)
    end = md_text.find("\n---", 3)
    if end == -1:
        return sanitize_content(md_text, priv_pat=priv_pat)

    fm_lines = md_text[3:end].strip("\r\n").splitlines()
    out_lines: List[str] = []
    for raw_ln in fm_lines:
        if ":" not in raw_ln or raw_ln.startswith(" "):
            out_lines.append(raw_ln)
            continue
        key, val = raw_ln.split(":", 1)
        k_low = key.strip().lower()
        v_str = val.strip()

        if k_low in _CLAUDE_DROP_FM:
            continue
        if k_low == "model":
            m_low = v_str.strip("'\"").lower()
            if m_low == "inherit":
                continue
            out_lines.append(f"model: {_MODEL_MAP.get(m_low, v_str)}")
        elif k_low == "skills":
            items = [s.strip() for s in v_str.strip("[]").split(",") if s.strip()]
            if items:
                out_lines.append("autoloadSkills: [" + ", ".join(items) + "]")
        elif k_low == "tools":
            mapped: List[str] = []
            seen_t: Set[str] = set()
            for raw_tok in v_str.split(","):
                tok = raw_tok.strip()
                if not tok:
                    continue
                base = tok.split("(", 1)[0].strip().lower()
                if base.startswith("mcp__"):
                    continue
                omp_tool = _CLAUDE_TOOL_MAP.get(base)
                if omp_tool and omp_tool not in seen_t:
                    seen_t.add(omp_tool)
                    mapped.append(omp_tool)
            if mapped:
                out_lines.append("tools: " + ", ".join(mapped))
        else:
            out_lines.append(raw_ln)

    body = md_text[end:]
    rebuilt = "---\n" + "\n".join(out_lines) + body
    return sanitize_content(rebuilt, priv_pat=priv_pat)


def export_claude_core(
    claude_dir: Path,
    target_agent: Path,
    dry_run: bool = False,
    priv_pat: Optional[re.Pattern[str]] = None,
) -> Dict[str, int]:
    stats = {"core_agents": 0, "core_rules": 0}
    agents_src = claude_dir / "agents"
    rules_src = claude_dir / "rules"
    agents_dst = target_agent / "agents"
    rules_dst = target_agent / "rules"
    if not dry_run:
        agents_dst.mkdir(parents=True, exist_ok=True)
        rules_dst.mkdir(parents=True, exist_ok=True)

    if agents_src.is_dir():
        for md in sorted(agents_src.glob("*.md")):
            if md.name in _PROTECTED_AGENTS or md.name.startswith(("pmo-", "hlk-")):
                continue
            converted = convert_claude_agent_to_omp(md.read_text(encoding="utf-8", errors="ignore"), priv_pat=priv_pat)
            if not dry_run:
                (agents_dst / md.name).write_text(converted.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
            stats["core_agents"] += 1

    rule_banner = (
        "> **OMP Adaptation Note:** Ported read-only from global `~/.claude/rules/`. "
        "Map Claude `Agent(...)` -> OMP `task`, `advisorModel` -> `modelRoles.advisor`, and `ai-gate-audit` -> `typesafe-planner` extension.\n\n"
    )
    if rules_src.is_dir():
        for md in sorted(rules_src.glob("*.md")):
            txt = sanitize_content(md.read_text(encoding="utf-8", errors="ignore"), priv_pat=priv_pat)
            txt = txt.replace("~/.claude/logs/ai-gates/", "~/.omp/agent/logs/ai-gates/")
            if "OMP Adaptation Note:" not in txt:
                txt = rule_banner + txt
            if not dry_run:
                (rules_dst / md.name).write_text(txt.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
            stats["core_rules"] += 1

    return stats


def copy_skill_dir(
    src: Path,
    dst: Path,
    hide: bool = False,
    skip_big_bytes: int = 256 * 1024,
    priv_pat: Optional[re.Pattern[str]] = None,
) -> int:
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True, exist_ok=True)
    count = 0
    for cur, dirs, files in os.walk(src, followlinks=True):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith("demo-")]
        rel_cur = Path(cur).relative_to(src)
        (dst / rel_cur).mkdir(parents=True, exist_ok=True)
        for fn in files:
            ext = Path(fn).suffix.lower()
            if ext in SKIP_EXTS:
                continue
            sp = Path(cur) / fn
            try:
                if sp.stat().st_size > skip_big_bytes:
                    continue
            except OSError:
                continue
            dp = dst / rel_cur / fn
            if ext in TEXT_EXTS:
                txt = sp.read_text(encoding="utf-8", errors="ignore")
                txt = sanitize_content(txt, priv_pat=priv_pat)
                if hide and fn == "SKILL.md" and rel_cur == Path("."):
                    txt = ensure_hide_true(txt)
                dp.write_text(txt.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
            else:
                shutil.copy2(sp, dp)
            count += 1
    return count


def promote_all(
    config_path: Path,
    target_agent: Path,
    dry_run: bool = False,
    no_local_config: bool = False,
) -> Dict[str, int]:
    cfg: Dict[str, Any] = json.loads(config_path.read_text(encoding="utf-8"))
    if not no_local_config:
        local_cfg_path = Path.home() / ".omp" / "harvest-workspaces.local.json"
        if local_cfg_path.is_file():
            try:
                local_cfg = json.loads(local_cfg_path.read_text(encoding="utf-8"))
                if isinstance(local_cfg, dict):
                    cfg = _merge_configs(cfg, local_cfg)
            except Exception:
                pass

    priv_pat = _private_terms_pattern(cfg, allow_local=not no_local_config)
    tier_a = cfg.get("tierAPromoteSources", {})
    tier_b = cfg.get("tierBOptInSources", [])
    stats = {"tierA_skills": 0, "tierA_agents": 0, "tierA_commands": 0, "tierA_rules": 0, "tierB_skills": 0}

    skills_dir = target_agent / "skills"
    optin_dir = target_agent / "skills-optin"
    agents_dir = target_agent / "agents"
    commands_dir = target_agent / "commands"
    rules_dir = target_agent / "rules"

    if not dry_run:
        for d in (skills_dir, optin_dir, agents_dir, commands_dir, rules_dir):
            d.mkdir(parents=True, exist_ok=True)

    home_agents = Path.home() / ".omp" / "agent" / "agents"
    if home_agents.is_dir():
        for md in home_agents.glob("*.md"):
            if not dry_run:
                (agents_dir / md.name).write_text(
                    sanitize_content(md.read_text(encoding="utf-8"), priv_pat=priv_pat).replace("\r\n", "\n"),
                    encoding="utf-8",
                    newline="\n",
                )
            stats["tierA_agents"] += 1

    for item in tier_a.get("agents", []):
        sp = Path(os.path.expanduser(str(item["source"])))
        if not sp.is_file():
            continue
        txt = sp.read_text(encoding="utf-8", errors="ignore")
        if item["name"].startswith("pmo-"):
            txt = sanitize_content(inject_autoload_skills(txt, ["pmo-project-suite"]), priv_pat=priv_pat)
        elif item["name"].startswith("hlk-"):
            txt = convert_claude_agent_to_omp(txt, priv_pat=priv_pat)
        else:
            txt = sanitize_content(txt, priv_pat=priv_pat)
        if not dry_run:
            (agents_dir / item["name"]).write_text(txt.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
        stats["tierA_agents"] += 1

    for item in tier_a.get("skills", []):
        sp = Path(os.path.expanduser(str(item["source"])))
        if not sp.is_dir():
            continue
        if not dry_run:
            copy_skill_dir(sp, skills_dir / item["name"], hide=False, priv_pat=priv_pat)
        stats["tierA_skills"] += 1

    legacy_ak = target_agent / "managed-skills" / "ak-render"
    if not dry_run and legacy_ak.is_dir() and (skills_dir / "ak-render" / "SKILL.md").is_file():
        shutil.rmtree(legacy_ak)

    for item in tier_a.get("commands", []):
        sp = Path(os.path.expanduser(str(item["source"])))
        if not sp.is_file():
            continue
        txt = sanitize_content(sp.read_text(encoding="utf-8", errors="ignore"), priv_pat=priv_pat)
        txt = txt.replace(".claude/pm-email-state.md", ".omp/pm-email-state.md")
        if not dry_run:
            (commands_dir / item["name"]).write_text(txt.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
        stats["tierA_commands"] += 1

    for item in tier_a.get("rules", []):
        sp = Path(os.path.expanduser(str(item["source"])))
        if not sp.is_file():
            continue
        txt = sanitize_content(sp.read_text(encoding="utf-8", errors="ignore"), priv_pat=priv_pat)
        if not dry_run:
            (rules_dir / item["name"]).write_text(txt.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
        stats["tierA_rules"] += 1

    ts_json = Path.home() / ".omp" / "agent" / "typesafe.json"
    if ts_json.is_file() and not dry_run:
        (target_agent / "typesafe.json").write_text(ts_json.read_text(encoding="utf-8").replace("\r\n", "\n"), encoding="utf-8", newline="\n")

    reserved: Set[str] = set()
    for base in (skills_dir, target_agent / "managed-skills", Path.home() / ".claude" / "skills"):
        if base.is_dir():
            reserved.update(d.name for d in base.iterdir() if d.is_dir() and not d.name.startswith("."))

    for pack in tier_b:
        src_root = Path(os.path.expanduser(str(pack["source"])))
        if not src_root.is_dir():
            continue
        excludes = set(pack.get("exclude", []))
        for sub in sorted(src_root.iterdir()):
            if not sub.is_dir() or sub.name.startswith(".") or sub.name in excludes or sub.name in reserved:
                continue
            if not (sub / "SKILL.md").is_file():
                continue
            reserved.add(sub.name)
            if not dry_run:
                copy_skill_dir(sub, optin_dir / sub.name, hide=True, priv_pat=priv_pat)
            stats["tierB_skills"] += 1

    return stats


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Promote and sanitize curated Tier A/B assets into config/omp/agent/")
    parser.add_argument("--config", default=str(Path(__file__).resolve().parent.parent / "config" / "harvest-workspaces.json"))
    parser.add_argument("--target", default=str(Path(__file__).resolve().parent.parent / "config" / "omp" / "agent"))
    parser.add_argument("--claude-dir", default=str(Path.home() / ".claude"))
    parser.add_argument("--export-claude-core", action="store_true", help="Read-only export 18 core Claude agents and 6 rules to OMP layout.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-local-config", action="store_true", help="Ignore ~/.omp/harvest-workspaces.local.json.")
    args = parser.parse_args(argv)

    if args.export_claude_core:
        core_res = export_claude_core(Path(args.claude_dir), Path(args.target), dry_run=args.dry_run)
        print(json.dumps({"dryRun": args.dry_run, "claudeCore": core_res}, indent=2))
        return 0

    res = promote_all(Path(args.config), Path(args.target), dry_run=args.dry_run, no_local_config=args.no_local_config)
    print(json.dumps({"dryRun": args.dry_run, "promoted": res}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
