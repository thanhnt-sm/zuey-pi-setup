"""
cleaner_dispatcher.py — Cross-Platform Windows & macOS Cache Analyzer & Safe Cleaner.

Supports `--dry-run` (zero deletions) and `--force` safe cleanup across verified dev/temp cache
targets on Windows (`win32`) and macOS (`darwin` / `OS_OVERRIDE=Darwin`) or Linux.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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
    elif kind == "darwin":
        caches = home / "Library" / "Caches"
        add("user_caches", caches, ("system",))
        add("homebrew_cache", caches / "Homebrew", ("quick", "dev", "system"))
        add("pip_cache", caches / "pip", ("quick", "dev"))
        add("uv_cache", caches / "uv", ("quick", "dev"))
        add("npm_cache", home / ".npm" / "_cacache", ("quick", "dev"))
        add("bun_cache", home / ".bun" / "install" / "cache", ("quick", "dev"))
        add("xcode_derived", home / "Library" / "Developer" / "Xcode" / "DerivedData", ("dev",))
        add("trash", home / ".Trash", ("system",))
    else:
        cache = home / ".cache"
        add("pip_cache", cache / "pip", ("quick", "dev"))
        add("uv_cache", cache / "uv", ("quick", "dev"))
        add("npm_cache", home / ".npm" / "_cacache", ("quick", "dev"))
        add("bun_cache", home / ".bun" / "install" / "cache", ("quick", "dev"))
        add("tmp_cache", Path("/tmp"), ("system",))
    return targets


def _delete_children_safely(target: Path) -> Tuple[int, int]:
    freed = removed = 0
    if not target.exists():
        return 0, 0
    for item in list(target.iterdir()):
        try:
            sz, _ = _dir_size_bytes(item)
            if item.is_symlink() or item.is_file():
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
