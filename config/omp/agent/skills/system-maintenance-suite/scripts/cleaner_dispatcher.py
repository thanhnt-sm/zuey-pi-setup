"""
cleaner_dispatcher.py — Cross-Platform Windows & macOS Cache Analyzer & Safe Cleaner.

Supports `--dry-run` (zero deletions) and `--force` safe cleanup across verified dev/temp cache
targets on Windows (`win32`) and macOS (`darwin` / `OS_OVERRIDE=Darwin`) or Linux.
"""

from __future__ import annotations
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
def detect_os(os_override: Optional[str] = None) -> str:
    raw = (os_override or os.environ.get("OS_OVERRIDE") or sys.platform).lower()
    if raw.startswith(("win", "mingw", "msys")):
        return "windows"
    if raw.startswith("darwin") or "mac" in raw:
        return "darwin"
    return "linux"


def _dir_size_bytes(p: Path) -> Tuple[int, int]:
    total = files = 0
    if not p.exists():
        return 0, 0
    if p.is_file():
        try:
            return p.stat().st_size, 1
        except OSError:
            return 0, 0
    for cur, _dirs, fns in os.walk(p, followlinks=False):
        for fn in fns:
            fp = Path(cur) / fn
            try:
                if not fp.is_symlink():
                    total += fp.stat().st_size
                    files += 1
            except OSError:
                pass
    return total, files


def get_cleanup_targets(mode: str = "quick", os_kind: Optional[str] = None, home_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    kind = os_kind or detect_os()
    home = home_dir or Path.home()
    targets: List[Dict[str, Any]] = []

    def add(cat: str, path: Path, scopes: Tuple[str, ...]) -> None:
        if mode == "full" or mode in scopes:
            targets.append({"category": cat, "path": path, "os": kind})

    if kind == "windows":
        local_app = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData" / "Local"))
        roaming = Path(os.environ.get("APPDATA") or (home / "AppData" / "Roaming"))
        cache_dir = home / ".cache"
        add("temp", Path(os.environ.get("TEMP") or (local_app / "Temp")), ("quick", "system"))
        add("pip_cache", local_app / "pip" / "cache", ("quick", "dev"))
        add("uv_cache", local_app / "uv" / "cache", ("quick", "dev"))
        add("npm_cache", local_app / "npm-cache", ("quick", "dev"))
        add("pnpm_store", local_app / "pnpm" / "store", ("dev",))
        add("bun_cache", home / ".bun" / "install" / "cache", ("quick", "dev"))
        add("nuget_cache", home / ".nuget" / "packages", ("dev",))
        add("vscode_cache", roaming / "Code" / "CachedData", ("dev",))
        add("chrome_cache", local_app / "Google" / "Chrome" / "User Data" / "Default" / "Cache", ("quick", "system"))
        add("edge_cache", local_app / "Microsoft" / "Edge" / "User Data" / "Default" / "Cache", ("quick", "system"))
        add("ruff_cache", cache_dir / "ruff", ("extended",))
        add("mypy_cache", cache_dir / "mypy", ("extended",))
        add("playwright_cache", local_app / "ms-playwright", ("extended",))
        add("puppeteer_cache", cache_dir / "puppeteer", ("extended",))
        add("cargo_git_checkouts", home / ".cargo" / "git" / "checkouts", ("extended",))
        add("gradle_caches", home / ".gradle" / "caches", ("extended",))
        add("claude_old_versions", home / ".local" / "share" / "claude" / "versions", ("extended",))
    elif kind == "darwin":
        caches = home / "Library" / "Caches"
        cache_dir = home / ".cache"
        add("user_caches", caches, ("system",))
        add("homebrew_cache", caches / "Homebrew", ("quick", "dev", "system"))
        add("pip_cache", caches / "pip", ("quick", "dev"))
        add("uv_cache", caches / "uv", ("quick", "dev"))
        add("npm_cache", home / ".npm" / "_cacache", ("quick", "dev"))
        add("bun_cache", home / ".bun" / "install" / "cache", ("quick", "dev"))
        add("xcode_derived", home / "Library" / "Developer" / "Xcode" / "DerivedData", ("dev",))
        add("trash", home / ".Trash", ("system",))
        add("ruff_cache", cache_dir / "ruff", ("extended",))
        add("mypy_cache", cache_dir / "mypy", ("extended",))
        add("pipx_cache", cache_dir / "pipx", ("extended",))
        add("precommit_cache", cache_dir / "pre-commit", ("extended",))
        add("playwright_cache", caches / "ms-playwright", ("extended",))
        add("puppeteer_cache", cache_dir / "puppeteer", ("extended",))
        add("cargo_git_checkouts", home / ".cargo" / "git" / "checkouts", ("extended",))
        add("gradle_caches", home / ".gradle" / "caches", ("extended",))
        add("claude_old_versions", home / ".local" / "share" / "claude" / "versions", ("extended",))
    else:
        cache = home / ".cache"
        add("pip_cache", cache / "pip", ("quick", "dev"))
        add("uv_cache", cache / "uv", ("quick", "dev"))
        add("npm_cache", home / ".npm" / "_cacache", ("quick", "dev"))
        add("bun_cache", home / ".bun" / "install" / "cache", ("quick", "dev"))
        for tmp_sub in (Path("/tmp/omp"), Path("/tmp/claude"), Path("/tmp/uv")):
            add("tmp_cache", tmp_sub, ("system",))
        add("ruff_cache", cache / "ruff", ("extended",))
        add("mypy_cache", cache / "mypy", ("extended",))
        add("playwright_cache", cache / "ms-playwright", ("extended",))
        add("puppeteer_cache", cache / "puppeteer", ("extended",))
        add("cargo_git_checkouts", home / ".cargo" / "git" / "checkouts", ("extended",))
        add("claude_old_versions", home / ".local" / "share" / "claude" / "versions", ("extended",))
    return targets

def _delete_children_safely(target: Path) -> Tuple[int, int]:
    freed = removed = 0
    if not target.exists():
        return 0, 0
    for item in list(target.iterdir()):
        try:
            sz, _ = _dir_size_bytes(item)
            is_link = item.is_symlink() or (hasattr(os.path, "islink") and os.path.islink(str(item)))
            if is_link:
                if item.is_dir():
                    try:
                        item.rmdir()
                    except OSError:
                        item.unlink()
                else:
                    item.unlink()
            elif item.is_file():
                item.unlink()
            elif item.is_dir():
                shutil.rmtree(item, ignore_errors=False)
            freed += sz
            removed += 1
        except OSError:
            pass
    return freed, removed


def run_cleanup(
    mode: str = "quick",
    dry_run: bool = True,
    force: bool = False,
    os_override: Optional[str] = None,
    home_override: Optional[Path] = None,
    custom_targets: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    if not dry_run and not force:
        raise PermissionError("Refusing destructive cleanup without explicit `--force` (or run with `--dry-run`).")

    kind = detect_os(os_override)
    targets = custom_targets if custom_targets is not None else get_cleanup_targets(mode=mode, os_kind=kind, home_dir=home_override)

    entries: List[Dict[str, Any]] = []
    total_reclaimable = 0
    total_freed = 0
    total_items_removed = 0

    for t in targets:
        p = Path(t["path"])
        exists = p.exists()
        sz, cnt = _dir_size_bytes(p) if exists else (0, 0)
        total_reclaimable += sz
        freed_here = removed_here = 0
        if not dry_run and force and exists:
            freed_here, removed_here = _delete_children_safely(p)
            total_freed += freed_here
            total_items_removed += removed_here
        entries.append({
            "category": t["category"],
            "path": str(p),
            "exists": exists,
            "bytes": sz,
            "mb": round(sz / (1024 * 1024), 2),
            "files": cnt,
            "freed_bytes": freed_here,
            "removed_entries": removed_here,
        })

    wiztree_exe = shutil.which("wiztree64.exe") or shutil.which("WizTree64.exe")
    lines = [
        f"# System Maintenance Report ({kind.upper()} | mode={mode} | dry_run={dry_run})",
        f"- **Reclaimable:** {round(total_reclaimable / (1024 * 1024), 2)} MB | **Freed:** {round(total_freed / (1024 * 1024), 2)} MB",
        "", "| Category | Exists | Size (MB) | Files | Path |", "|---|---|---:|---:|---|",
    ]
    for e in entries:
        lines.append(f"| {e['category']} | {e['exists']} | {e['mb']} | {e['files']} | `{e['path']}` |")

    return {
        "os": kind, "mode": mode, "dry_run": dry_run, "force": force,
        "total_reclaimable_bytes": total_reclaimable, "total_freed_bytes": total_freed,
        "items_removed": total_items_removed, "wiztree_available": bool(wiztree_exe),
        "targets": entries, "markdown": "\n".join(lines) + "\n",
    }


_ARTIFACT_NAMES = {
    "node_modules", ".next", ".turbo", ".nuxt", ".svelte-kit", ".parcel-cache",
    "target", ".venv", "venv", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    ".gradle", "build", "Pods", "obj", ".dart_tool", "dist",
}


def _artifact_restore_hint(artifact_dir: Path) -> Optional[str]:
    name = artifact_dir.name
    parent = artifact_dir.parent
    if name in ("node_modules", ".next", ".turbo", ".nuxt", ".svelte-kit", ".parcel-cache", "dist"):
        if (parent / "package.json").is_file():
            return "npm ci / pnpm i / bun i"
    elif name == "target":
        if (parent / "Cargo.toml").is_file():
            return "cargo build"
        if (parent / "pom.xml").is_file():
            return "mvn package"
    elif name in (".venv", "venv"):
        if any((parent / m).is_file() for m in ("pyproject.toml", "setup.py", "Pipfile")) or list(parent.glob("requirements*.txt")):
            return "uv sync / pip install -r requirements.txt"
    elif name in (".mypy_cache", ".pytest_cache", ".ruff_cache"):
        return "auto-regenerated"
    elif name in (".gradle", "build"):
        if list(parent.glob("build.gradle*")) or list(parent.glob("settings.gradle*")):
            return "./gradlew build"
        if name == "build" and (parent / "pubspec.yaml").is_file():
            return "flutter build"
    elif name == "Pods" and (parent / "Podfile").is_file():
        return "pod install"
    elif name == "obj" and (list(parent.glob("*.csproj")) or list(parent.glob("*.fsproj"))):
        return "dotnet build"
    elif name == ".dart_tool" and (parent / "pubspec.yaml").is_file():
        return "flutter pub get"
    return None


def _latest_project_mtime(project_dir: Path) -> float:
    latest = 0.0
    skip_dirs = _ARTIFACT_NAMES | {".git"}
    for cur, dirs, files in os.walk(project_dir, followlinks=False):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for fn in files:
            try:
                mt = (Path(cur) / fn).stat().st_mtime
                if mt > latest:
                    latest = mt
            except OSError:
                pass
    return latest


def find_stale_project_artifacts(
    roots: Iterable[Path],
    stale_days: int = 90,
    max_depth: int = 6,
) -> Dict[str, Any]:
    """Read-only scan for re-creatable deps/build dirs inside inactive projects (> stale_days)."""
    now = time.time()
    cutoff = now - (stale_days * 86400)
    stale_entries: List[Dict[str, Any]] = []
    total_bytes = 0

    for raw_root in roots:
        root = Path(raw_root)
        if not root.is_dir():
            continue
        root_depth = len(root.resolve().parts)
        for cur, dirs, _files in os.walk(root, followlinks=False):
            cur_p = Path(cur)
            if len(cur_p.resolve().parts) - root_depth > max_depth:
                dirs[:] = []
                continue
            next_dirs: List[str] = []
            for d in sorted(dirs):
                if d == ".git":
                    continue
                dp = cur_p / d
                if dp.is_symlink():
                    continue
                if d in _ARTIFACT_NAMES:
                    hint = _artifact_restore_hint(dp)
                    if hint:
                        latest = _latest_project_mtime(cur_p)
                        if latest > 0 and latest < cutoff:
                            sz, cnt = _dir_size_bytes(dp)
                            age_days = int((now - latest) / 86400)
                            total_bytes += sz
                            stale_entries.append({
                                "path": str(dp),
                                "project": str(cur_p),
                                "artifact": d,
                                "bytes": sz,
                                "mb": round(sz / (1024 * 1024), 2),
                                "files": cnt,
                                "ageDays": age_days,
                                "restoreHint": hint,
                            })
                    continue
                next_dirs.append(d)
            dirs[:] = next_dirs

    return {
        "staleDays": stale_days,
        "totalReclaimableBytes": total_bytes,
        "stale": stale_entries,
    }


def find_orphan_leftovers(
    search_dirs: Optional[Iterable[Path]] = None,
    installed_names: Optional[Set[str]] = None,
    os_kind: Optional[str] = None,
    home_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Read-only leftover & orphan detector across app support/data directories."""
    kind = os_kind or detect_os()
    home = home_dir or Path.home()
    if search_dirs is None:
        if kind == "darwin":
            dirs = [home / "Library" / "HTTPStorages", home / "Library" / "Application Support"]
        elif kind == "windows":
            local_app = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData" / "Local"))
            dirs = [local_app / "CrashDumps"]
        else:
            dirs = [home / ".local" / "share" / "Trash"]
    else:
        dirs = [Path(d) for d in search_dirs]

    known_lower = {n.lower() for n in (installed_names or set())}
    findings: List[Dict[str, Any]] = []
    for base in dirs:
        if not base.is_dir():
            continue
        for item in sorted(base.iterdir()):
            if item.name.startswith("."):
                continue
            if known_lower and item.name.lower() in known_lower:
                continue
            if installed_names is None and kind == "darwin" and item.name in ("Apple", "CrashReporter", "CloudDocs"):
                continue
            sz, _ = _dir_size_bytes(item)
            findings.append({
                "path": str(item),
                "name": item.name,
                "bytes": sz,
                "reason": "uninstalled_leftover",
            })
    return findings


def quarantine_paths(
    paths: Iterable[Path],
    quarantine_root: Optional[Path] = None,
    dry_run: bool = True,
    force: bool = False,
) -> Dict[str, Any]:
    """Move non-essential orphan data into restorable quarantine with restore.sh & restore.ps1."""
    q_root = quarantine_root or (Path.home() / ".cleanup-quarantine")
    batch_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    batch_dir = q_root / batch_id
    target_list = [Path(p) for p in paths]

    if dry_run or not force:
        return {
            "dry_run": dry_run,
            "force": force,
            "quarantinedCount": 0,
            "batchDir": str(batch_dir),
            "candidates": [str(p) for p in target_list if p.exists()],
        }

    batch_dir.mkdir(parents=True, exist_ok=True)
    moved: List[Dict[str, str]] = []
    sh_lines = ["#!/usr/bin/env bash", "set -euo pipefail"]
    ps_lines = ["$ErrorActionPreference = 'Stop'"]

    for idx, src in enumerate(target_list):
        if not src.exists():
            continue
        dst = batch_dir / f"{idx:03d}_{src.name}"
        shutil.move(str(src), str(dst))
        moved.append({"original": str(src), "quarantined": str(dst)})
        sh_lines.append(f'mkdir -p "$(dirname "{src.as_posix()}")" && mv "{dst.as_posix()}" "{src.as_posix()}"')
        ps_lines.append(f'Move-Item -Force -Path "{dst}" -Destination "{src}"')

    (batch_dir / "manifest.json").write_text(json.dumps(moved, indent=2), encoding="utf-8")
    restore_sh = batch_dir / "restore.sh"
    restore_ps1 = batch_dir / "restore.ps1"
    restore_sh.write_text("\n".join(sh_lines) + "\n", encoding="utf-8", newline="\n")
    restore_ps1.write_text("\r\n".join(ps_lines) + "\r\n", encoding="ascii")
    restore_script = str(restore_ps1 if os.name == "nt" else restore_sh)
    return {
        "dry_run": False,
        "force": True,
        "quarantinedCount": len(moved),
        "batchDir": str(batch_dir),
        "restoreScript": restore_script,
        "restoreSh": str(restore_sh),
        "restorePs1": str(restore_ps1),
        "moved": moved,
    }


def prune_omp_sessions(
    days_old: int = 7,
    dry_run: bool = True,
    force: bool = False,
    home_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Safe pruner for old OMP sessions/cache older than days_old; protects active sessions & DBs."""
    if not dry_run and not force:
        raise PermissionError("Refusing live prune without explicit `--force` (defaults to `--dry-run`).")
    home = home_dir or Path.home()
    agent_dir = home / ".omp" / "agent"
    target_subdirs = [agent_dir / "sessions", agent_dir / "cache"]
    now = time.time()
    cutoff = now - (max(1, days_old) * 86400)
    stale_files: List[Dict[str, Any]] = []
    protected_count = 0
    freed_bytes = 0

    for sub in target_subdirs:
        if not sub.is_dir():
            continue
        newest_mtime = 0.0
        newest_path: Optional[Path] = None
        for p in sub.rglob("*.jsonl"):
            try:
                mt = p.stat().st_mtime
                if mt > newest_mtime:
                    newest_mtime, newest_path = mt, p
            except OSError:
                pass

        for p in sub.rglob("*"):
            low = p.name.lower()
            if low.endswith((".db", ".db-wal", ".db-shm", ".sqlite", ".sqlite3", ".json", ".lock")):
                protected_count += 1
                continue
            if newest_path and p.resolve() == newest_path.resolve():
                protected_count += 1
                continue
            try:
                st = p.stat()
                if p.is_file() and st.st_mtime < cutoff:
                    stale_files.append({"path": str(p), "bytes": st.st_size, "ageDays": int((now - st.st_mtime) / 86400)})
                    if not dry_run and force:
                        p.unlink()
                        freed_bytes += st.st_size
            except OSError:
                pass

    return {
        "is_valid": True,
        "dry_run": dry_run,
        "days_old": days_old,
        "stale_count": len(stale_files),
        "freed_bytes": freed_bytes if not dry_run else sum(x["bytes"] for x in stale_files),
        "protected_count": protected_count,
        "stale_samples": [x["path"] for x in stale_files[:10]],
    }
