#!/usr/bin/env python3
"""
scripts/omp-link-local.py — Opt-in Manifest-Driven Local Reference Linker
Links shared local .omp/.claude/.agent mirrors to ~/.omp/agent/ without touching Git or override repos.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _load_classification(config_path: Path, no_local: bool = False) -> Dict[str, List[str]]:
    cls: Dict[str, List[str]] = {"override": [], "shared_mirror": [], "archive": []}
    paths_to_read = [config_path]
    if not no_local:
        local_cfg = Path.home() / ".omp" / "harvest-workspaces.local.json"
        if local_cfg.is_file():
            paths_to_read.append(local_cfg)
    for p in paths_to_read:
        if not p.is_file():
            continue
        try:
            raw = json.loads(p.read_text(encoding="utf-8")).get("workspaceClassification", {})
            for k in cls:
                for item in raw.get(k, []) or []:
                    s = os.path.expanduser(str(item))
                    if s not in cls[k]:
                        cls[k].append(s)
        except Exception:
            pass
    return cls


def _is_link(p: Path) -> bool:
    try:
        st = os.lstat(p)
        if stat.S_ISLNK(st.st_mode):
            return True
        if getattr(st, "st_file_attributes", 0) & 0x400:
            return True
    except OSError:
        pass
    return False


def _sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def _make_dir_link(link_path: Path, target_path: Path) -> None:
    if os.name == "nt":
        res = subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(link_path), str(target_path)], capture_output=True, text=True, check=False)
        if res.returncode != 0:
            raise OSError(res.stderr.strip() or res.stdout.strip() or "mklink /J failed")
    else:
        os.symlink(str(target_path), str(link_path), target_is_directory=True)


def _snapshot_backup(target: Path, backup_root: Path, ts: str) -> None:
    if not target.exists() and not _is_link(target):
        return
    if _is_link(target):
        if os.name == "nt" and target.is_dir():
            target.rmdir()
        else:
            target.unlink()
        return
    dest = backup_root / ts / target.parent.parent.name / target.parent.name / target.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if target.is_dir():
        shutil.copytree(target, dest, dirs_exist_ok=True)
        shutil.rmtree(target)
    else:
        shutil.copy2(target, dest)
        target.unlink()


def process_workspace_links(
    cls: Dict[str, List[str]],
    global_agent: Path,
    backup_root: Path,
    apply: bool = False,
) -> Dict[str, Any]:
    actions: List[Dict[str, Any]] = []
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    for ov in cls.get("override", []) + cls.get("archive", []):
        actions.append({"target": ov, "action": "skip_override", "reason": "Classified override/archive; untouched."})

    for mirror in cls.get("shared_mirror", []):
        mp = Path(mirror)
        if not mp.is_dir():
            actions.append({"target": mirror, "action": "skip_missing", "reason": "Directory absent."})
            continue
        for sub in ("skills", "agents", "commands", "rules"):
            sp = mp / sub
            gp = global_agent / sub
            if not sp.is_dir() or not gp.is_dir():
                continue
            local_entries = [e.name for e in sorted(sp.iterdir()) if not e.name.startswith(".")]
            global_names = {e.name for e in gp.iterdir() if not e.name.startswith(".")}
            unpromoted = [n for n in local_entries if n not in global_names]

            if sub == "skills":
                for ename in local_entries:
                    ep = sp / ename
                    gep = gp / ename
                    if ename not in global_names:
                        actions.append({"target": str(ep), "action": "refuse_unpromoted", "missing": [ename]})
                        continue
                    if not ep.is_dir() or not gep.is_dir():
                        continue
                    if _is_link(ep):
                        actions.append({"target": str(ep), "action": "already_linked", "globalTarget": str(gep)})
                        continue
                    actions.append({"target": str(ep), "action": "link_dir", "globalTarget": str(gep), "applied": apply})
                    if apply:
                        _snapshot_backup(ep, backup_root, ts)
                        _make_dir_link(ep, gep)
            else:
                if unpromoted and not set(local_entries).issubset(global_names):
                    synced = [n for n in local_entries if n in global_names]
                    actions.append({"target": str(sp), "action": "hash_sync_fallback", "entries": synced, "keptLocal": unpromoted, "applied": apply})
                    if apply:
                        for n in synced:
                            lf, gf = sp / n, gp / n
                            if gf.is_file() and (not lf.is_file() or _sha256_file(lf) != _sha256_file(gf)):
                                _snapshot_backup(lf, backup_root, ts)
                                shutil.copy2(gf, lf)
                elif local_entries:
                    if _is_link(sp):
                        actions.append({"target": str(sp), "action": "already_linked", "globalTarget": str(gp)})
                    else:
                        actions.append({"target": str(sp), "action": "link_dir", "globalTarget": str(gp), "applied": apply})
                        if apply:
                            _snapshot_backup(sp, backup_root, ts)
                            _make_dir_link(sp, gp)

    return {"mode": "apply" if apply else "plan", "actions": actions}


def verify_links(cls: Dict[str, List[str]], global_agent: Path) -> Dict[str, Any]:
    broken: List[str] = []
    verified = 0
    for mirror in cls.get("shared_mirror", []):
        mp = Path(mirror)
        if not mp.is_dir():
            continue
        for sub in ("skills", "agents", "commands", "rules"):
            sp = mp / sub
            gp = global_agent / sub
            if _is_link(sp):
                if os.path.exists(os.path.realpath(sp)):
                    verified += 1
                else:
                    broken.append(str(sp))
                continue
            if not sp.is_dir() or not gp.is_dir():
                continue
            for ep in sp.iterdir():
                if _is_link(ep):
                    if os.path.exists(os.path.realpath(ep)):
                        verified += 1
                    else:
                        broken.append(str(ep))
                elif ep.is_file() and (gp / ep.name).is_file():
                    if _sha256_file(ep) == _sha256_file(gp / ep.name):
                        verified += 1
                    else:
                        broken.append(str(ep))
    return {"valid": len(broken) == 0, "verifiedCount": verified, "brokenLinks": len(broken), "brokenPaths": broken}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Opt-in local reference linker pointing shared mirrors to ~/.omp/agent/.")
    parser.add_argument("--plan", action="store_true", help="Dry-run plan (default).")
    parser.add_argument("--apply", action="store_true", help="Apply snapshots and junction/symlink or hash-sync updates.")
    parser.add_argument("--verify", action="store_true", help="Verify all linked and hash-synced mirrors.")
    parser.add_argument("--json", action="store_true", help="Emit structured JSON output.")
    parser.add_argument("--no-local-config", action="store_true")
    parser.add_argument("--config", default=str(Path(__file__).resolve().parent.parent / "config" / "harvest-workspaces.json"))
    parser.add_argument("--global-agent-dir", default=str(Path.home() / ".omp" / "agent"))
    parser.add_argument("--backup-dir", default=str(Path.home() / ".omp" / "restore-backups" / "local-links"))
    args = parser.parse_args(argv)

    cls = _load_classification(Path(args.config), no_local=args.no_local_config)
    g_agent = Path(os.path.expanduser(args.global_agent_dir))
    res = verify_links(cls, g_agent) if args.verify else process_workspace_links(cls, g_agent, Path(args.backup_dir), apply=bool(args.apply))

    if args.json:
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0 if (res.get("valid", True)) else 1


if __name__ == "__main__":
    sys.exit(main())
