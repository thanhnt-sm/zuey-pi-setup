#!/usr/bin/env python3
"""
harvest_cli.py — Standalone skill entrypoint delegating directly to canonical harvester_core.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.dont_write_bytecode = True
_SCRIPT_DIR = str(Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from harvester_core import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
