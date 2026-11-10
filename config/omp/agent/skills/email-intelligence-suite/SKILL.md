---
name: email-intelligence-suite
description: "Cross-platform pure-Python email processing suite: parses .eml (RFC 822) and .msg (Outlook) archives plus optional Windows Outlook COM, clusters conversation threads (4-tier), scrubs quotes/signatures, deduplicates by SHA-256, extracts issues/actions, and renders Markdown & Excel reports."
---

# Email Intelligence Suite (OMP Native Priority-100)

Cross-platform (Windows, macOS, Linux) email analysis toolkit running via `~/.omp/tools-venv` Python 3 (`extract-msg`, `openpyxl`), with optional Windows Outlook MAPI COM source (`--source outlook`).

## Dual-Mode CLI Usage (`scripts/email_cli.py`)

### Interactive Human Mode (No Flags)
```bash
python3 scripts/email_cli.py
```

### Non-Interactive Agent Mode (`--json`)
```bash
# Scan folder of .eml / .msg files, deduplicate threads, extract issues, output Markdown + Excel
python3 scripts/email_cli.py --cmd scan --input ./emails --output ./out/email_report.md --format both --dedupe --json

# Parse & list grouped threads only
python3 scripts/email_cli.py --cmd threads --input ./emails --dedupe --json

# Extract action items / issues (Bug, Urgent, Todo, Action, Yêu cầu, Deadline)
python3 scripts/email_cli.py --cmd issues --input ./emails --output ./out/issues.xlsx --format xlsx --json
```

## Features & Security
- **4-Tier Thread Clustering:** `ConversationID` -> `Message-ID`/`In-Reply-To`/`References` union-find -> Ticket ID (`##1234##`, `Ticket: ...`) -> Normalized Subject (`RE:`/`FW:`/`[TAG]`) + participant overlap + 21-day gap split.
- **Order-Invariant SHA-256 Hash:** Prevents duplicate analysis across repeated exports.
- **CWE-1236 Formula Defense:** All Excel exports neutralize formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`, `\n`).
