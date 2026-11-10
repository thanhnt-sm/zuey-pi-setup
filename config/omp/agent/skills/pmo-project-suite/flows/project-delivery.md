# Shared PMO Project Delivery Flow

1. **Workspace Isolation:** Keep project inputs/templates/outputs inside dedicated `<project-workspace>/{inputs,templates,ledger,outputs,decisions}` directories; never store client files inside the skill package.
2. **Contract & Obligation Intake (`pmo-ba`):** Extract obligation register (`pmo_cli.py --cmd obligation`) and CR deltas (`--cmd cr`); flag uncontracted deliverables and unfulfilled obligations.
3. **Planning & Schedule Validation (`pmo-planner`):** Run WBS/CPM (`--cmd cpm`) and MS Project <-> Excel profile sync (`msp2xlsx` / `xlsx2msp` / `sprint-export`).
4. **Daily Execution & RAID Tracking:** Lint `.pmn` notes (`note-lint`), dry-run preview (`raid --dry-run`), atomic sync (`raid`), and generate 6-bucket action plans (`note-plan`).
5. **Verified Progress & Red-Team Audit (`pmo-reporter` + `pmo-red-team`):** Run `--cmd evm` and `--cmd audit` before publishing `--cmd report`. Reject future-dated or zero-evidence completions.
