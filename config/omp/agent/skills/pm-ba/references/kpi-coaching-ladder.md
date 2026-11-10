# KPI DEV Coaching Ladder — State Machine

> Per-DEV per-week TQ tracking + escalation steps (Phase 06 v1.5).
> Authority: Source SM_KPI §3.4. Action IDs: `KPI_Action_Library.md` §7 DEV-TQ-XX.
> Reset condition (decision 6.2): TQ ≥ 1.0 cho 2 weeks consecutive → reset to step 0.

---

## 1. Ladder Steps

| Step | Trigger Week | Action ID | Touch Level | Description |
|------|--------------|-----------|-------------|-------------|
| 0 | TQ ≥ 1.0 baseline | — | none | Healthy |
| 1 | Week 1 with TQ < 1.0 | DEV-TQ-04 | lightest | Pre-task walkthrough |
| 2 | Week 2 consecutive TQ < 1.0 | DEV-TQ-01 | medium | 1:1 coaching (Template 1) |
| 3 | Week 3 consecutive TQ < 1.0 | DEV-TQ-02 | hands-on | Pair programming Senior |
| 4 | Week 4 consecutive TQ < 1.0 | DEV-TQ-03 + DEV-TQ-06 | structural | Level reduction + training plan |

---

## 2. State Schema (in kpi-state per DEV)

```yaml
dev_tq_history:
  - dev: "Nguyễn An"
    weekly:
      - week: "2026-06-W1"
        tq_avg: 1.05
        tasks_done: 3
      - week: "2026-06-W2"
        tq_avg: 0.90              # < 1.0 → ladder step 1
        tasks_done: 2
      - week: "2026-06-W3"
        tq_avg: 0.95              # < 1.0 consecutive → step 2
        tasks_done: 2
    coaching_status:
      current_step: 2
      action_id: "DEV-TQ-01"
      started_at: "2026-06-W2"
      consecutive_low_weeks: 2
      reset_consecutive_high_weeks: 0
      last_review_at: "2026-06-15"
      notes: "Coaching scheduled 2026-06-16"
```

---

## 3. Advance Logic (per weekly --kpi-track)

```python
def advance_ladder(dev, current_week_tq):
    status = dev.coaching_status

    if current_week_tq >= 1.0:
        status.reset_consecutive_high_weeks += 1
        status.consecutive_low_weeks = 0
        # Reset check (decision 6.2): 2 consecutive ≥ 1.0 → reset
        if status.reset_consecutive_high_weeks >= 2:
            status.current_step = 0
            status.action_id = None
            status.started_at = None
            status.reset_consecutive_high_weeks = 0
            log(f"✅ {dev.name} coaching ladder RESET — 2 weeks ≥ 1.0")
    else:
        status.consecutive_low_weeks += 1
        status.reset_consecutive_high_weeks = 0
        # Advance one step (cap at 4)
        new_step = min(status.current_step + 1, 4)
        if new_step != status.current_step:
            status.current_step = new_step
            status.action_id = step_to_action(new_step)
            status.started_at = status.started_at or current_week
            log(f"⚠️ {dev.name} ladder advanced → step {new_step} ({status.action_id})")

def step_to_action(step):
    return {1: "DEV-TQ-04", 2: "DEV-TQ-01", 3: "DEV-TQ-02", 4: "DEV-TQ-03+DEV-TQ-06"}[step]
```

---

## 4. Anti-Patterns

- ❌ Skip ladder step because "DEV is busy this week" — defer trigger but still log
- ❌ Apply DEV-TQ-03 (level reduction) without HR notification — sensitive structural change
- ❌ Reset ladder after 1 good week — requires 2 consecutive (decision 6.2)
- ❌ Multiple DEVs same ladder step without checking Pattern E (systemic vs individual)

---

## 5. Edge Cases

| Case | Behavior |
|------|----------|
| DEV new to team (no history) | Start at step 0; need 2 weeks data before advance |
| DEV on vacation that week | Skip week; don't advance, don't reset |
| DEV tasks all 0 TP that week | Insufficient data — don't advance |
| Multi-DEV same step → Pattern E candidate | Flag for systemic review |
| Reset triggered + same DEV regresses again | Re-enter ladder at step 1, NOT continue prior step |

---

## 6. Audit / HR Trail

All ladder advances logged to:
- State file `dev_tq_history[].coaching_status` (in-flight)
- After step 3+, additional log to `docs/pm-coaching-log.md` (HR audit retention)
- Step 4 (DEV-TQ-03 level reduction) → mandatory memo to HR

---

## 6.1 Weekly[] Pruning (v1.5.1)

`dev_tq_history[].weekly[]` is append-only one row per week per DEV. Cap to last 12 weeks in-state; on Phase 10 month-end auto-archive, move rows older than 12 weeks to `docs/kpi/archive/{slug}/dev-tq-history-{dev_slug}-{YYYY}.md`. Recent 12 weeks sufficient for ladder advance/reset logic; archive available for retrospectives.

---

## 7. Reporting

Mode 48 §3g §coaching subsection outputs per DEV:
```
{dev_name}: TQ this week = {tq}; ladder step = {step} ({action_id})
            Recommended action: {action_description}
            Consecutive weeks at this signal: {n}
```
