#!/usr/bin/env python3
"""
scripts/omp-doctor.py — Cross-OS OMP Workstation & Repository Healthcheck.

Validates tools-venv imports, plugin manifests, extension graph, mcp.json / .claude.json
command portability, local reference links, orphaned WAL residues, and public repo leaks.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.dont_write_bytecode = True

_REQUIRED_IMPORTS = ("openpyxl", "docx", "defusedxml", "extract_msg", "pypdf")
_PLACEHOLDER_RE = re.compile(r"\{\{(?:USER_HOME|OMP_NODE|CLAUDE_NODE)\}\}")
_WIN_ABS_RE = re.compile(r"^[A-Za-z]:[/\\]")
_SCAN_EXTS = {".ts", ".tsx", ".js", ".cjs", ".mjs", ".py", ".sh", ".ps1", ".yml", ".yaml", ".json", ".md"}
_DOC_PLACEHOLDERS = {"user", "username", "jesse", "name", "example", "demo", "<user>", "...", "path", "foo", "x"}
_ALLOW_ABS_FILES = {"path-utils.cjs", "typesafe-redact-patterns.cjs", "typesafe-enabled-resolver.cjs"}
_WIN_PATH_RE = re.compile(r"(?:^|(?<=[\s\"'`(=,;\[{<]))([A-Za-z]):(/+|\\+(?![sSwWdDbBnrtvf0-9.*+?\[({\\$]))([^\s\"'`<>)\]]*)")
_POSIX_HOME_RE = re.compile(r"(?:/Users/|/home/)([A-Za-z0-9._<>-]+)")


def _detect_os() -> str:
    raw = (os.environ.get("OS_OVERRIDE") or sys.platform).lower()
    if raw.startswith(("win", "mingw", "msys")):
        return "windows"
    if raw.startswith("darwin") or "mac" in raw:
        return "darwin"
    return "linux"
def _resolve_repo_dir(explicit: Optional[str]) -> Optional[Path]:
    if explicit:
        p = Path(explicit)
        return p if p.is_dir() else None
    for cand in (Path(__file__).resolve().parent.parent, Path.cwd().resolve(), *Path.cwd().resolve().parents):
        if (cand / "config" / "omp").is_dir() and (cand / "scripts").is_dir():
            return cand
    return None


def _check_tools_venv(target_dir: Path, strict: bool, errors: List[str], warnings: List[str]) -> Dict[str, Any]:
    venv_dir = target_dir / "tools-venv"
    py_cands = [
        venv_dir / "Scripts" / "python.exe",
        venv_dir / "bin" / "python3",
        venv_dir / "bin" / "python",
    ]
    py_bin = next((c for c in py_cands if c.is_file()), None)
    if not venv_dir.is_dir() or py_bin is None:
        msg = f"tools-venv missing or incomplete at {venv_dir}"
        (errors if strict else warnings).append(msg)
        return {"ok": not strict, "present": False, "python": None, "missingModules": list(_REQUIRED_IMPORTS)}

    probe_code = (
        "import importlib.util, json, sys; "
        f"mods = {list(_REQUIRED_IMPORTS)!r}; "
        "missing = [m for m in mods if importlib.util.find_spec(m) is None]; "
        "print(json.dumps(missing))"
    )
    try:
        res = subprocess.run([str(py_bin), "-c", probe_code], capture_output=True, text=True, timeout=15, check=False)
        if res.returncode != 0:
            errors.append(f"tools-venv python probe failed: {res.stderr.strip() or res.stdout.strip()}")
            return {"ok": False, "present": True, "python": str(py_bin), "missingModules": list(_REQUIRED_IMPORTS)}
        missing = json.loads(res.stdout.strip() or "[]")
        if missing:
            (errors if strict else warnings).append(f"tools-venv missing packages: {', '.join(missing)}")
        return {"ok": not missing or not strict, "present": True, "python": str(py_bin), "missingModules": missing}
    except Exception as exc:
        errors.append(f"tools-venv check error: {exc}")
        return {"ok": False, "present": True, "python": str(py_bin), "missingModules": list(_REQUIRED_IMPORTS)}


def _check_plugins(target_dir: Path, strict: bool, errors: List[str], warnings: List[str]) -> Dict[str, Any]:
    p_dir = target_dir / "plugins"
    pkg = p_dir / "package.json"
    lock = p_dir / "omp-plugins.lock.json"
    nm = p_dir / "node_modules"
    has_pkg = pkg.is_file()
    has_lock = lock.is_file()
    has_nm = nm.is_dir()
    if has_pkg and not has_nm:
        msg = f"plugins/node_modules missing at {nm} (run bun install in plugins/)"
        (errors if strict else warnings).append(msg)
    return {"ok": (not strict or (has_pkg and has_nm)), "packageJson": has_pkg, "lockfile": has_lock, "nodeModules": has_nm}


def _check_extensions_and_wal(target_dir: Path, errors: List[str], warnings: List[str]) -> Dict[str, Any]:
    ext_dir = target_dir / "agent" / "extensions"
    hub = ext_dir / "omp-toolkit-hub.ts"
    sub_dir = ext_dir / "omp-toolkit-hub"
    subs = [sub_dir / f for f in ("python-bridge.ts", "domain-tools.ts", "loop-state.ts")]
    missing = [str(p.relative_to(target_dir)) for p in [hub, *subs] if not p.is_file()]
    if missing:
        warnings.append(f"Missing omp-toolkit-hub files: {', '.join(missing)}")

    wal_files: List[str] = []
    agent_dir = target_dir / "agent"
    if agent_dir.is_dir():
        for p in agent_dir.glob("*.db-*"):
            if p.name.endswith(("-wal", "-shm")):
                wal_files.append(p.name)
    return {"ok": True, "hubReady": len(missing) == 0, "missingExtensionFiles": missing, "walFiles": wal_files}


def _check_mcp_configs(
    target_dir: Path,
    home_dir: Path,
    os_kind: str,
    strict: bool,
    errors: List[str],
    warnings: List[str],
) -> Dict[str, Any]:
    checked: List[Dict[str, Any]] = []
    files_to_check = [target_dir / "agent" / "mcp.json", home_dir / ".claude.json"]
    had_error = False

    for fp in files_to_check:
        if not fp.is_file():
            continue
        try:
            raw_text = fp.read_text(encoding="utf-8", errors="ignore")
            if _PLACEHOLDER_RE.search(raw_text):
                errors.append(f"Unexpanded placeholder in {fp}")
                had_error = True
            data = json.loads(raw_text)
        except Exception as exc:
            errors.append(f"Invalid JSON in {fp}: {exc}")
            had_error = True
            continue

        servers = data.get("mcpServers") if isinstance(data, dict) else None
        if not isinstance(servers, dict):
            continue
        for srv_name, srv in servers.items():
            if not isinstance(srv, dict):
                continue
            cmd = str(srv.get("command") or "").strip()
            args_list = [str(a) for a in (srv.get("args") or []) if isinstance(a, (str, int, float))]
            tokens = [cmd, *args_list]
            if os_kind in ("darwin", "linux"):
                if any(_WIN_ABS_RE.match(t) or t.lower().endswith(".exe") for t in tokens if t):
                    errors.append(f"MCP '{srv_name}' in {fp} contains Windows path/binary on {os_kind}: {cmd}")
                    had_error = True
            elif os_kind == "windows":
                if any(t.startswith(("/opt/homebrew/", "/Users/")) for t in tokens if t):
                    errors.append(f"MCP '{srv_name}' in {fp} contains macOS path on Windows: {cmd}")
                    had_error = True
            if cmd:
                is_path = ("/" in cmd or "\\" in cmd)
                cmd_ok = Path(cmd).exists() if is_path else bool(shutil.which(cmd))
                if not cmd_ok and is_path:
                    msg = f"MCP '{srv_name}' command missing on disk: {cmd}"
                    (errors if strict else warnings).append(msg)
                    if strict:
                        had_error = True
            checked.append({"file": str(fp), "server": srv_name, "command": cmd})

    return {"ok": not had_error, "checkedServers": checked}


def _check_local_links(repo_dir: Optional[Path], target_dir: Path, no_local: bool, errors: List[str]) -> Dict[str, Any]:
    if repo_dir is None:
        return {"ok": True, "skipped": True}
    linker_path = repo_dir / "scripts" / "omp-link-local.py"
    cfg_path = repo_dir / "config" / "harvest-workspaces.json"
    if not linker_path.is_file() or not cfg_path.is_file():
        return {"ok": True, "skipped": True}

    spec = importlib.util.spec_from_file_location("omp_link_local", str(linker_path))
    if spec is None or spec.loader is None:
        return {"ok": True, "skipped": True}
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cls = mod._load_classification(cfg_path, no_local=no_local)
    res = mod.verify_links(cls, target_dir / "agent")
    if not res.get("valid", True):
        errors.append(f"Broken local links ({res.get('brokenLinks', 0)}): {', '.join(res.get('brokenPaths', []))}")
    return {"ok": bool(res.get("valid", True)), **res}


def _check_repo_leaks(repo_dir: Optional[Path], errors: List[str]) -> Dict[str, Any]:
    if repo_dir is None:
        return {"ok": True, "skipped": True}
    cfg_omp = repo_dir / "config" / "omp"
    if not cfg_omp.is_dir():
        return {"ok": True, "skipped": True}

    symlinks: List[str] = []
    forbidden_files: List[str] = []
    path_leaks: List[str] = []

    for cur, dirs, files in os.walk(cfg_omp, followlinks=False):
        for d in dirs:
            dp = Path(cur) / d
            if dp.is_symlink():
                symlinks.append(str(dp.relative_to(repo_dir)))
        for fn in files:
            fp = Path(cur) / fn
            rel = fp.relative_to(repo_dir).as_posix()
            if fp.is_symlink():
                symlinks.append(rel)
                continue
            low = fn.lower()
            if low == ".env" or low.endswith((".db", ".db-wal", ".db-shm", ".sqlite", ".sqlite3", ".pyc", ".pyo")):
                forbidden_files.append(rel)
                continue
            if fp.suffix.lower() in _SCAN_EXTS and "/__tests__/" not in f"/{rel}" and fn not in _ALLOW_ABS_FILES:
                txt = fp.read_text(encoding="utf-8", errors="ignore")
                for lno, line in enumerate(txt.splitlines(), 1):
                    for m in _WIN_PATH_RE.finditer(line):
                        drv = m.group(1).upper()
                        rest = m.group(3).replace("\\", "/")
                        first = rest.split("/", 1)[0].lower()
                        if drv == "C" and (first.startswith("windows") or first.startswith("program") or first == "programdata"):
                            continue
                        if rest.lower().startswith("users/"):
                            parts = rest.split("/")
                            uname = parts[1].lower() if len(parts) > 1 else ""
                            if uname in _DOC_PLACEHOLDERS or uname.startswith("<"):
                                continue
                        if first in ("path", "foo", "x", "...", "demo", "example") or rest.startswith("\\\\") or not rest:
                            continue
                        if drv == "G" and (first in ("...", "x") or rest.lower().startswith("my")):
                            continue
                        path_leaks.append(f"{rel}:{lno}")
                    for m in _POSIX_HOME_RE.finditer(line):
                        uname = m.group(1).lower()
                        if uname in _DOC_PLACEHOLDERS or uname.startswith("<"):
                            continue
                        path_leaks.append(f"{rel}:{lno}")

    if symlinks:
        errors.append(f"Symlinks in config/omp: {', '.join(symlinks[:10])}")
    if forbidden_files:
        errors.append(f"Forbidden files in config/omp: {', '.join(forbidden_files[:10])}")
    if path_leaks:
        errors.append(f"Raw workstation path leaks in config/omp: {', '.join(path_leaks[:10])}")
    return {
        "ok": not (symlinks or forbidden_files or path_leaks),
        "symlinks": symlinks,
        "forbiddenFiles": forbidden_files,
        "pathLeaks": path_leaks[:20],
    }


def run_doctor(
    target_dir: Path,
    home_dir: Path,
    repo_dir: Optional[Path] = None,
    no_local_config: bool = False,
    strict: bool = False,
) -> Dict[str, Any]:
    os_kind = _detect_os()
    errors: List[str] = []
    warnings: List[str] = []

    checks = {
        "toolsVenv": _check_tools_venv(target_dir, strict, errors, warnings),
        "plugins": _check_plugins(target_dir, strict, errors, warnings),
        "extensions": _check_extensions_and_wal(target_dir, errors, warnings),
        "mcpConfigs": _check_mcp_configs(target_dir, home_dir, os_kind, strict, errors, warnings),
        "localLinks": _check_local_links(repo_dir, target_dir, no_local_config, errors),
        "repoLeaks": _check_repo_leaks(repo_dir, errors),
    }

    ok = len(errors) == 0 and (not strict or len(warnings) == 0)
    return {
        "ok": ok,
        "status": "HEALTHY" if ok else "UNHEALTHY",
        "os": os_kind,
        "targetDir": str(target_dir),
        "strict": strict,
        "checks": checks,
        "warnings": warnings,
        "errors": errors,
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Cross-OS OMP environment & repository healthcheck.")
    parser.add_argument("--target-dir", default=str(Path.home() / ".omp"), help="Target OMP directory (default: ~/.omp)")
    parser.add_argument("--home", default=str(Path.home()), help="Target user home directory (default: ~)")
    parser.add_argument("--repo-dir", default=None, help="zuey-pi-setup repository directory")
    parser.add_argument("--no-local-config", action="store_true", help="Ignore ~/.omp/harvest-workspaces.local.json")
    parser.add_argument("--strict", action="store_true", help="Treat warnings (missing venv/node_modules) as failures")
    parser.add_argument("--json", action="store_true", help="Output JSON diagnostics")
    args = parser.parse_args(argv)

    repo_dir = _resolve_repo_dir(args.repo_dir)
    res = run_doctor(
        target_dir=Path(os.path.expanduser(args.target_dir)),
        home_dir=Path(os.path.expanduser(args.home)),
        repo_dir=repo_dir,
        no_local_config=bool(args.no_local_config),
        strict=bool(args.strict),
    )
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
