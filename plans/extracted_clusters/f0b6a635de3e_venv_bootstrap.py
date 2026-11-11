"""
venv_bootstrap.py — Attach ~/.omp/tools-venv site-packages onto sys.path if present.
"""

from __future__ import annotations

import glob
import os
import sys
from pathlib import Path


def attach_omp_tools_venv() -> str | None:
    omp_dir = Path(os.environ.get("OMP_DIR") or os.path.expanduser("~/.omp"))
    venv_dir = omp_dir / "tools-venv"
    if not venv_dir.is_dir():
        return None

    candidates = [str(venv_dir / "Lib" / "site-packages")]
    candidates.extend(glob.glob(str(venv_dir / "lib" / "python*" / "site-packages")))

    attached = None
    for path_str in candidates:
        p = Path(path_str)
        if p.is_dir() and path_str not in sys.path:
            sys.path.append(path_str)
            attached = attached or path_str
    return attached
