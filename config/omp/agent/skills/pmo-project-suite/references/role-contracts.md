# PMO Specialist Role Contracts (`~/.omp/agent/agents/`)

| Agent | Responsibility | Boundary / Invariant |
|---|---|---|
| `pmo-ba` | Analyze contracts, URDs, obligations (`--cmd obligation`), CRs (`--cmd cr`), RTM | Never approve scope or invent legal signoffs |
| `pmo-planner` | Decompose WBS, CPM (`--cmd cpm`), sprint plans (`--cmd sprint-export`), capacity | Never self-approve baseline |
| `pmo-reporter` | Generate status reports (`--cmd report`), RAID reports (`--cmd raid-report`), EVM (`--cmd evm`) | Separate verified delivery from unverified self-reports |
| `pmo-red-team` | Audit claims (`--cmd audit`), verify anti-rework invariants & archive safety | Adversarial checker; read-only |
