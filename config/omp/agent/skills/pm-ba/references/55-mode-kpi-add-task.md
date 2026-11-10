# Mode 55 — `--kpi-add-task`

> Add task mid-sprint with eligibility check + EP bump (Phase 09 v1.5).
> Tagged `added_mid_sprint: true` for audit.

---

## 1. Trigger

**Flag:** `--kpi-add-task --p <P-level> --assignee <name> --description "..."`

**VN triggers:** "thêm task khẩn", "bổ sung task", "task mới mid-sprint"
**EN triggers:** "add urgent task", "mid-sprint task add"

---

## 2. Required Slots

| Slot | Description |
|------|-------------|
| `P` | P-level (P1..P7) |
| `assignee` | DEV name from team_roster |
| `description` | Task description (≥ 30 chars) |
| `--cr-id` (optional) | Link to CR if task is CR-driven |

---

## 3. Workflow Steps

### 3a. Load Standards + Validate
- State `protected` + whitelist
- assignee ∈ team_roster (and not on full-period vacation)
- P-level matches assignee level eligibility (per quick-reference §3)

### 3b. Compute Task Metrics
```python
TP = P_LEVEL_TABLE[P]["tp"]
mds = P_LEVEL_TABLE[P]["mds"]
task_id = f"T-{period}-MS{next_serial}"  # MS = mid-sprint
planned_finish = compute_friday_of_remaining_week()  # nearest Friday
```

### 3c. Generate Event + Task Row
```yaml
team_events[]:
  - event_id: "EVT-task-add-{hash}"
    type: task_added_mid_sprint
    target: "{task_id}"
    details: {p: P3, tp: 3, mds: 1.0, assignee: "An"}
    ep_delta: +(TP * 0.80 * 0.85)    # capacity-equivalent (Capacity_factor × Risk_buffer); matches ep_monthly_capacity delta units
    ep_delta_raw_tp: +TP             # raw TP for traceability (Pattern D inflation uses this)
    related_cr_id: "{cr_id or null}"

tasks[]:
  - id: "{task_id}"
    description: "..."
    p: "P3"
    tp: 3
    mds: 1.0
    owner: "{assignee}"
    week: "{current week}"
    planned_finish: "{friday}"
    status: "InProgress"
    added_mid_sprint: true
    cr_id: "{cr_id or null}"
```

### 3d. Bump EP
- `ep_raw += TP`
- `ep_monthly_capacity += TP × 0.80 × 0.85` (or skip 0.80×0.85 if PM specifies "added scope no risk buffer")
- Revise milestones proportionally

### 3e. Update Master Task List
Append task to `docs/pm-ba-master-task-list.md` with `Added Mid-Sprint` column = ✅

### 3f. Output Impact Report
```
Task added: {task_id} ({description})
Assignee: {name} ({level}) — eligible ✅
TP: {tp} | mds: {mds}
EP impact: +{ep_delta} (now total: {new_ep})
Milestones revised:
  ...
DEV utilization impact: {pct_before} → {pct_after}
  ⚠️ Note: utilization now {pct} — consider rebalance OR mark stretch
```

---

## 4. Outputs

| Output | Purpose |
|--------|---------|
| `tasks[]` append | New task |
| `team_events[]` append | Audit |
| `ep_history[]` append | EP delta tracked |
| `docs/pm-ba-master-task-list.md` | Updated registry |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Ineligible | DEV level can't do P-level | Block with eligibility table |
| Late add | Adding task in week 4 of period | Warn — task likely won't complete |
| > 3 mid-sprint tasks per week | Spam pattern | Warn; suggest --kpi-replan |
| Assignee on vacation | Vacation overlaps assignment | Block; reassign or wait |
| Description too short | < 30 chars | Re-prompt |
| Over-utilization | Util > 100% post-add | Warn; suggest reassign |

---

## 6. End-of-Mode Hooks
- `/ck:journal`: NO (per-task adds noisy; only journal at week-end)
- Suggest next: Update task in `--daily`; track via `--kpi-track`
