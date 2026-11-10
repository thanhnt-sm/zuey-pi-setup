---
name: pmo-project-suite
description: "Cross-platform pure-Python PMO suite for WBS, CPM, EVM, PERT, Risk, RTM, Obligation & Change Request validation, Daily Note RAID CI/CD tracker, and MS Project XML <-> Excel 2-way sync / sprint extraction / plan builder."
---

# PMO Project Management Suite (OMP Native Priority-100)

Self-contained cross-platform (Windows + macOS + Linux) PMO toolkit running via `~/.omp/tools-venv` Python 3 (`openpyxl`, `defusedxml`), with optional Windows MS Project COM automation (`--use-com`).

## Python Environment Resolution
Prefer `~/.omp/tools-venv`:
- Windows: `"$HOME/.omp/tools-venv/Scripts/python.exe"`
- macOS / Linux: `"$HOME/.omp/tools-venv/bin/python"`
(Fallback: `python3` or `python`; all scripts auto-attach `~/.omp/tools-venv` site-packages via `venv_bootstrap.py`.)

## Dual-Mode CLI Usage (`scripts/pmo_cli.py`)

### 1. Interactive Human Mode (No Flags)
```bash
python3 scripts/pmo_cli.py
```

### 2. Non-Interactive Agent Mode (`--json`)
```bash
# Schedule & PMI Analytics
python3 scripts/pmo_cli.py --cmd cpm --input tasks.json --json
python3 scripts/pmo_cli.py --cmd evm --input metrics.json --json
python3 scripts/pmo_cli.py --cmd pert --input pert.json --json
python3 scripts/pmo_cli.py --cmd obligation --input obligations.json --json
python3 scripts/pmo_cli.py --cmd cr --input cr_payload.json --json
python3 scripts/pmo_cli.py --cmd report --input status.json --output report.md --json
python3 scripts/pmo_cli.py --cmd audit --input tasks.json --json

# Daily Note & RAID Tracker CI/CD
python3 scripts/pmo_cli.py --cmd raid-init --output RAID_tracker.xlsx --json
python3 scripts/pmo_cli.py --cmd raid --input notes_20261110.pmn --tracker RAID_tracker.xlsx --dry-run --json
python3 scripts/pmo_cli.py --cmd raid --input notes_20261110.pmn --tracker RAID_tracker.xlsx --backup-dir backups --json
python3 scripts/pmo_cli.py --cmd note-doctor --config .pmo_config.json --json
python3 scripts/pmo_cli.py --cmd note-lint --input notes_20261110.pmn --config .pmo_config.json --json
python3 scripts/pmo_cli.py --cmd note-plan --tracker RAID_tracker.xlsx --output reports/pmo_plan.md --json
python3 scripts/pmo_cli.py --cmd note-roll --input notes_current.pmn --tracker RAID_tracker.xlsx --json
python3 scripts/pmo_cli.py --cmd note-archive --tracker RAID_tracker.xlsx --output archive/inbox_closed.csv --json

# MS Project XML <-> Excel 2-Way Sync, Plan Builder & Sprint Extractor
python3 scripts/pmo_cli.py --cmd mpp2xml --input plan.mpp --output plan.xml --json  # Windows COM or macOS/Linux mpxj CLI
python3 scripts/pmo_cli.py --cmd xlsx2msp --input schedule.xlsx --base-xml plan.xml --output plan_merged.xml --policy Project --json
python3 scripts/pmo_cli.py --cmd excel2xml --input schedule.xlsx --output new_plan.xml [--profile profile.json] --json
python3 scripts/pmo_cli.py --cmd sprint-export --input plan.xml --start 2026-11-01 --end 2026-11-15 --output sprint.xlsx --json
python3 scripts/pmo_cli.py --cmd mpp2xml --input plan.mpp --output plan.xml --json  # Windows COM only
```

## Subagents & Delivery Flow
- Installed OMP agents (`~/.omp/agent/agents/`): `pmo-ba`, `pmo-planner`, `pmo-reporter`, `pmo-red-team` (all configured with `autoloadSkills: [pmo-project-suite]`).
- Full delivery flow: `/pmo-delivery` (`flows/project-delivery.md`).
- Security invariants: CWE-1236 formula injection neutralization (`=`, `+`, `-`, `@`, `\t`, `\r`, `\n`, fullwidth), `defusedxml` + UTF-8/UTF-16 `DOCTYPE`/`ENTITY` blocking, Zip Slip / Tar traversal / Windows device guards.
