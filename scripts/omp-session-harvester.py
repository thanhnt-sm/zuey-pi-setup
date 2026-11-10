#!/usr/bin/env python3
"""
scripts/omp-session-harvester.py — Repository wrapper delegating to canonical harvester_core.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.dont_write_bytecode = True
_CORE_DIR = str(
    Path(__file__).resolve().parent.parent
    / "config"
    / "omp"
    / "agent"
    / "skills"
    / "omp-session-harvester"
    / "scripts"
)
if _CORE_DIR not in sys.path:
    sys.path.insert(0, _CORE_DIR)

from harvester_core import *  # noqa: F401, F403, E402
from harvester_core import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
