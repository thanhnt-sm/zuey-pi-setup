# Mode 53 — `--kpi-assign`

> Auto-assignment optimizer. Balance utilization + Senior load + Junior upskill (Phase 08 v1.5).
> Algorithm: `references/kpi-assignment-optimizer.md`. Weights 50/30/20 (decision 8.4).

---

## 1. Trigger

**Flag:** `--kpi-assign [--strategy balanced|minimize-load|upskill-focused|senior-first] [--confirm <file>] [--force-stretch]`

**VN triggers:** "phân công tự động", "assign tasks", "ai làm task nào", "optimizer phân công"
**EN triggers:** "auto-assign tasks", "assignment optimizer", "balance team load"

---

## 2. Required Slots

| Slot | Description | Default |
|------|-------------|---------|
| `strategy` | Optimizer strategy | `balanced` |
| Task list | From state `tasks[]` (must be locked via Mode 47 §3e --confirm) | Auto |
| Team roster | From state `team_roster[]` | Auto |

---

## 3. Workflow Steps

### 3a. Load Standards + Validate
- State `tasks_locked == true` (else: "Run --kpi-plan --confirm first")
- `team_roster` non-empty
- All tasks have P-level set

### 3b. Run Optimizer
Invoke `references/kpi-assignment-optimizer.md` §5 with strategy weights.

### 3c. Validate Result
- All hard constraints satisfied
- No Senior over-assigned (> 1.2× target) — else warn
- No Junior stretched beyond +1 level — else block unless `--force-stretch`
- Utilization variance < 15% target (else warn "imbalanced")

### 3d. Write Assignment Proposal
`plans/reports/kpi-assignment-{date}-{period}.md` per `templates/kpi-assignment-proposal-template.md`.
Format: per-task assignment + reasoning + team summary.

### 3e. Print --confirm Instruction
```
✓ Assignment proposal: {file}
✓ Strategy: {strategy}
✓ Cost: {value}
✓ Utilization σ: {value}

Review file, edit if needed, then:
  /pm-ba --kpi-assign --confirm {file}
```

### --confirm Subflow
1. Read confirmed file
2. Apply assignment to state `tasks[].owner`
3. Update Mode 47 §3.2 workload utilization table
4. Update task register

---

## 4. Outputs

| File | Purpose |
|------|---------|
| `plans/reports/kpi-assignment-{date}-{period}.md` | Assignment proposal + reasoning |
| kpi-state `tasks[].owner` | Applied after --confirm |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Eligibility violation | DEV cannot do assigned P-level | Block; explain ineligibility |
| Senior overload | Senior util > 1.2× target | Warn; if `--force` not set, block |
| Junior over-stretch | Junior at + 2 P-levels stretch | Block unless `--force-stretch` |
| Imbalanced σ > 25% | Variance high | Warn; suggest alternative strategy |
| Tasks not locked | `tasks_locked == false` | Block; require Mode 47 --confirm first |

---

## 6. End-of-Mode Hooks
- `/ck:journal`: YES on --confirm
- Suggest next: `--kpi-track` next week to monitor signal vs plan
