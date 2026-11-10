# Phase 5: Email Intelligence & System Maintenance Suites

## Overview
Package the remaining two domain toolkits:
1. `email-intelligence-suite`: Multi-thread `.eml` and `.msg` email parsing, SHA-256 deduplication, and Issue extractor ported from email export utilities.
2. `system-maintenance-suite`: Cross-platform workstation disk cleanup and AI tool uninstaller builder consolidating maintenance scripts with existing managed skills.

## Requirements
- **Functional Requirements:**
  1. **Email Intelligence Suite (`config/omp/agent/managed-skills/email-intelligence-suite/`):**
     - Parse RFC 822 `.eml` and Outlook `.msg` files using standard Python `email` module and `extract-msg`.
     - Extract metadata (From, To, Date, Subject, Message-ID, In-Reply-To).
     - Cluster threads and deduplicate via body hash (SHA-256).
     - Extract action items / issues into Markdown and Excel tables.
     - Dual-mode CLI: interactive menu vs CLI arguments (`--scan-dir`, `--format [md|xlsx]`, `--dedupe`).
  2. **System Maintenance Suite (`config/omp/agent/managed-skills/system-maintenance-suite/`):**
     - Consolidate Windows `.ps1` modules (Ollama model cache, npm cache, pip cache, browser temp) and macOS `.sh` modules into a single cross-platform runner `scripts/clean_pc.py`.
     - Inspect host OS (`sys.platform` / `uname -s`):
       - On Windows: Run PowerShell modules or native cleanup commands; integrate WizTree CLI if present.
       - On macOS: Run POSIX shell modules targeting `~/Library/Caches`, Homebrew cache, Ollama, Docker prune.
     - Always provide `--dry-run` inspection mode calculating reclaimable bytes before deleting.
     - Provide AI Tool Uninstaller builder module.
     - Dual-mode CLI: interactive menu (1. Dry-run analysis, 2. Run clean, 3. Generate uninstaller) vs agent CLI flags.
  3. Author `SKILL.md` for both managed skills.
- **Non-Functional Requirements:**
  - Zero accidental file deletion: deletions require explicit confirmation in interactive mode or `--force` flag in agent mode.
  - No secret or personal email addresses committed into public repositories.

## Related Code Files
- **Create:** `config/omp/agent/managed-skills/email-intelligence-suite/SKILL.md`
- **Create:** `config/omp/agent/managed-skills/email-intelligence-suite/scripts/email_cli.py`
- **Create:** `config/omp/agent/managed-skills/email-intelligence-suite/scripts/email_parser.py`
- **Create:** `config/omp/agent/managed-skills/email-intelligence-suite/tests/test_email_suite.py`
- **Create:** `config/omp/agent/managed-skills/system-maintenance-suite/SKILL.md`
- **Create:** `config/omp/agent/managed-skills/system-maintenance-suite/scripts/maintenance_cli.py`
- **Create:** `config/omp/agent/managed-skills/system-maintenance-suite/scripts/cleaner_dispatcher.py`
- **Create:** `config/omp/agent/managed-skills/system-maintenance-suite/tests/test_maintenance_suite.py`
- **Modify:** `plans/omp-consolidation-ledger.json`

## Implementation Steps
1. **Build `email-intelligence-suite`:**
   - Implement `email_parser.py` handling both `.eml` and `.msg`.
   - Implement issue extractor identifying keywords (Bug, Urgent, Todo, Action, Yêu cầu).
   - Wire into `email_cli.py`.
2. **Build `system-maintenance-suite`:**
   - Port modules from `D:/200_GDrive/101.AI/CleanPC`.
   - Implement OS detection in `cleaner_dispatcher.py`.
   - Wire into `maintenance_cli.py`.
3. **Write Unit Tests:**
   - Test email parsing and deduplication on mock RFC 822 email files.
   - Test maintenance suite in `--dry-run` mode verifying no files are deleted.

## Success Criteria
- [ ] `test_email_suite.py` passes with exit code `0`.
- [ ] `test_maintenance_suite.py` passes with exit code `0`.
- [ ] Both skills function on Windows and macOS.
