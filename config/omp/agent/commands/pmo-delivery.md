---
description: Run end-to-end PMO Project Delivery workflow (Intake -> Plan/CPM -> RAID CI/CD -> EVM/Audit -> Report) using pmo-project-suite and specialist agents.
---
Execute the PMO Delivery Flow for: $ARGUMENTS

1. Read `skill://pmo-project-suite` and `skill://pmo-project-suite/flows/project-delivery.md`.
2. Delegate read-only analyses to specialist agents (`pmo-ba` for obligations/CRs, `pmo-planner` for WBS/CPM/sync, `pmo-red-team` for evidence audits, `pmo-reporter` for status summaries).
3. Run deterministic calculations via `scripts/pmo_cli.py --cmd <op> ... --json` (never hand-compute CPM/EVM/RAID numbers).
4. Separate verified deliverables from unverified claims; preserve baseline and approval boundaries.
