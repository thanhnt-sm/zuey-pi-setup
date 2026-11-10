# Phase 2: Session & Workspace Harvester CLI

## Overview
Develop a dedicated harvesting CLI (`scripts/omp-session-harvester.py`) that scans the 55 OMP session transcripts (`~/.omp/agent/sessions/*.jsonl`), history database (`history.db`), and the 14 known local workspaces to extract reusable tool scripts, detect duplicated utility implementations, and register them into `plans/omp-consolidation-ledger.json`.

## Requirements
- **Functional Requirements:**
  1. Parse all `.jsonl` session files in `~/.omp/agent/sessions/` to find file-writing operations (`write`, `edit`, `eval`, python scripts, shell scripts, powershell scripts).
  2. Index all standalone scripts in the 14 scouted workspaces (PMO utilities, document converters, email exporters, system cleanup scripts).
  3. Detect sensitive strings (API keys, personal credentials, internal domain URLs, proprietary customer/project codes) and flag them for automated scrubbing.
  4. Write results into `plans/omp-consolidation-ledger.json` and generate `plans/harvest-inventory.md` with deduplication suggestions.
  5. Provide dual-mode execution:
     - `python scripts/omp-session-harvester.py --scan`: Non-interactive JSON/CLI output.
     - `python scripts/omp-session-harvester.py`: Interactive menu displaying scan summary and harvest options.
- **Non-Functional Requirements:**
  - Fast execution (< 15 seconds for all 55 sessions).
  - Safe read-only operation: does not mutate source workspaces or session JSONL files.

## Related Code Files
- **Create:** `scripts/omp-session-harvester.py`
- **Create:** `tests/test-omp-session-harvester.sh`
- **Modify:** `plans/omp-consolidation-ledger.json`
- **Generate:** `plans/harvest-inventory.md`

## Implementation Steps
1. **Build `scripts/omp-session-harvester.py`:**
   - Define session scanner iterating over `os.path.expanduser("~/.omp/agent/sessions")`.
   - Implement regex scanners for tool blocks: Python (`import openpyxl`, `import docx`, `def `), PowerShell (`New-Object -ComObject`, `param(`), Bash scripts.
   - Define keyword sanitizer checking against a list of sensitive terms.
   - Implement structured output writer updating `plans/omp-consolidation-ledger.json`.
2. **Implement Interactive CLI Menu:**
   - Display:
     1. Scan sessions and update ledger
     2. Show top duplicated utility scripts
     3. Export harvested snippets to temporary staging directory
     4. Exit
3. **Write Test Suite (`tests/test-omp-session-harvester.sh`):**
   - Creates mock session `.jsonl` containing sample tool creation.
   - Runs `python scripts/omp-session-harvester.py --scan` and asserts extracted artifact in ledger.

## Success Criteria
- [ ] `tests/test-omp-session-harvester.sh` passes with exit code `0`.
- [ ] Running scanner across live `~/.omp/agent/sessions` successfully indexes all 55 sessions.
- [ ] `plans/omp-consolidation-ledger.json` contains full session-to-tool mapping.
