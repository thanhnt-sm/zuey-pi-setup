# Mode 54 — `--kpi-team-update`

> Team lifecycle ops mid-sprint (Phase 09 v1.5).
> Operations: add | remove | level-change | vacation.
> Append-only event log per `references/kpi-team-event-log.md`.

---

## 1. Trigger

**Flag:** `--kpi-team-update <name> --op {add|remove|level-change|vacation} [...details]`

**VN triggers:** "DEV nghỉ", "thêm member team", "đổi level DEV", "vacation member", "remove khỏi team"
**EN triggers:** "team member change", "DEV vacation", "level change DEV"

---

## 2. Required Slots

| Op | Required Args |
|----|---------------|
| `add` | `name`, `level` (Junior01..Senior03), `velocity_pts_per_day` |
| `remove` | `name`, `reason` (≥ 20 chars) |
| `level-change` | `name`, `new_level`, `reason` |
| `vacation` | `name`, `start_date`, `days` |

---

## 3. Workflow Steps

### 3a. Load Standards + Validate Op
- State `protected: true` AND mode in writer whitelist (Invariant 19)
- Op-specific arg validation
- For `add` + `level-change`: validate level ∈ {Fresher, Junior01..Junior03, Senior01..Senior03}

### 3b. Compute EP Delta
```python
if op == "add":
    new_capacity = working_days × velocity
    ep_delta = +new_capacity × 0.80 × 0.85
elif op == "remove" or op == "vacation":
    affected_capacity = (off_days_remaining_in_period) × member.velocity
    ep_delta = -affected_capacity × 0.80 × 0.85
elif op == "level-change":
    old = member.velocity × member.working_days
    new = lookup_velocity(new_level) × member.working_days
    ep_delta = (new - old) × 0.80 × 0.85
```

### 3c. Generate Event
```yaml
event_id: "EVT-{date}-{op}-{hash}"
timestamp: now
type: team_{op}
actor: "{pm_name}"
target: "{name}"
details: {...}
ep_delta: {value}
```

### 3d. Apply Mutation
Per `kpi-team-event-log.md §3`. Update `team_roster[]` + recompute `ep_monthly_capacity` + revise milestones.

### 3e. Append to team_events
Idempotent check + append.

### 3f. Output Delta Report
```
Team update applied:
  Op: {op}
  Member: {name}
  EP delta: {ep_delta:+d}
  EP before: {old_ep}
  EP after: {new_ep}
  Milestones revised:
    w1: {old → new}
    w2: ...

Affected tasks: {n} tasks assigned to {name}
  Recommend: --kpi-assign --strategy balanced để rebalance
```

### 3g. Update document-status + journal

---

## 4. Outputs

| Output | Purpose |
|--------|---------|
| `team_events[]` append | Audit trail |
| `team_roster[]` mutation | Working state |
| `ep_monthly_capacity` recompute | Signal correctness |
| Console delta report | PM situational awareness |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Reason too short | `reason` < 20 chars | Re-prompt |
| Member not found | `name` ∉ team_roster (except `add`) | Block with roster list |
| EP delta > 15% mid-period | Mass team change (decision 9.1 v1.5.1 symmetric) | PD signoff required: gen memo Template 5; append `ep_history_pending[]` with `type: team_update`; Mode 51 applies after signoff. PM cannot bypass via team-update routing. |
| EP delta > 30% mid-period | Catastrophic team change | Hard block; require explicit `--force` + PD pre-approval reference |
| Vacation overlaps existing | Same member dual-vacation | Block; merge or reject |
| Add level mismatch | `level` invalid | Block with valid options |

---

## 6. End-of-Mode Hooks
- `/ck:journal`: YES (team change is milestone-worthy)
- Suggest next: `--kpi-track` to refresh signals OR `--kpi-assign` to rebalance
