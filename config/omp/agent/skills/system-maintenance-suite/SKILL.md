---
name: system-maintenance-suite
description: "Cross-platform OS cleanup & AI tool deep-uninstaller suite for Windows and macOS: dry-run reclaimable space analyzer, dev/browser/temp cache cleaner, WizTree wrapper, and 9-step 7-bit ASCII uninstaller script generator."
---

# System Maintenance Suite (OMP Native Priority-100)

Cross-platform disk hygiene and AI tool uninstaller builder for **Windows** and **macOS (Apple Silicon & Intel)** — unified from `CleanPC` and `ai-tool-uninstaller-builder`.

## Dual-Mode CLI Usage (`scripts/maintenance_cli.py`)

### Interactive Human Mode (No Flags)
```bash
python3 scripts/maintenance_cli.py
```

### Non-Interactive Agent Mode (`--json`)
```bash
# 1. Always inspect reclaimable space first (zero deletions)
python3 scripts/maintenance_cli.py --cmd analyze --mode full --dry-run --json

# 2. Clean safe dev/temp/browser caches (requires explicit --force)
python3 scripts/maintenance_cli.py --cmd clean --mode quick --force --json

# 3. Generate 3-file cross-OS 9-step AI tool uninstaller suite (.bat, .ps1, .sh)
python3 scripts/maintenance_cli.py --cmd generate-uninstaller --tool my-ai-cli --output ./uninstallers --json
```

## Safety Invariants
- **`--dry-run` Default:** `analyze` never deletes files. `clean` refuses execution without `--force` (non-interactive) or explicit confirmation (interactive).
- **Never Touches User Data:** Strictly targets OS temp/dev/package caches (`pip`, `uv`, `npm`, `pnpm`, `bun`, `cargo`, `Homebrew`, `~/Library/Caches`), never `Documents`, `Desktop`, or project source.
- **7-Bit ASCII Uninstaller Output:** Generated `.bat`/`.ps1` (`CRLF`) and `.sh` (`LF`) files use pure 7-bit ASCII (`nonAsciiCount === 0`) without UTF-8 BOM.
