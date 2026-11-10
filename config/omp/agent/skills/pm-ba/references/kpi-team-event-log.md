# KPI Team Event Log — Append-Only Protocol

> Shared by `--kpi-team-update`, `--kpi-add-task`, `--kpi-replan` (Phase 09 v1.5).
> Append-only. Idempotent. Audit-friendly. Honors Invariant 19 spirit.

---

## 1. Event Types

| Type | Triggered By | Mutates |
|------|--------------|---------|
| `team_add` | --kpi-team-update --op add | team_roster[] append |
| `team_remove` | --kpi-team-update --op remove | team_roster[] entry marked `paused=true` (soft) |
| `team_level_change` | --kpi-team-update --op level-change | team_roster[name].level + recompute capacity |
| `team_vacation` | --kpi-team-update --op vacation | team_roster[name].vacation_days[] append |
| `task_added_mid_sprint` | --kpi-add-task | tasks[] append + ep_raw bump |
| `replan` | --kpi-replan | replan_history[] append + ep_monthly_capacity adjust |

---

## 2. Schema

```yaml
team_events:
  - event_id: "EVT-001"
    timestamp: 2026-06-15T10:00
    type: team_vacation
    actor: "PM Nguyễn"
    target: "Nguyễn An"           # team member or task ID
    details:
      off_days: 5
      reason: "Personal"
    ep_delta: -10                  # signed capacity change (pts)
    related_cr_id: null            # link to CR if scope change

replan_history:
  - event_id: "RPL-001"
    timestamp: 2026-06-20T16:00
    reason: "Khách hàng hủy CR-003 → giảm scope"
    old_ep_monthly_capacity: 184
    new_ep_monthly_capacity: 160
    ep_delta: -24
    ep_delta_pct: -13.0            # decision 9.1: PD gate at > 15%
    pd_signoff_required: false     # auto if ≤ 15%; required if > 15%
    pd_signoff_status: null        # null | pending | approved | rejected
    milestones_old: {w1:46, w2:92, w3:147, w4:184}
    milestones_new: {w1:46, w2:92, w3:128, w4:160}
    weekly_snapshots_preserved: true
```

---

## 3. Append Protocol

```python
def append_event(state, event):
    # Idempotency check
    if any(e.event_id == event.event_id for e in state.team_events):
        log(f"Idempotent: event {event.event_id} already logged.")
        return
    
    # Validate
    assert event.type in VALID_TYPES
    assert state.protected == True  # write through whitelisted mode only
    
    # Apply mutation per event.type
    apply_mutation(state, event)
    
    # Append (NEVER modify prior entries)
    state.team_events.append(event)
    state.last_updated = now()

def apply_mutation(state, event):
    if event.type == "team_vacation":
        member = find(state.team_roster, event.target)
        member.vacation_days.append({"start": ..., "days": event.details.off_days})
        member.working_days -= event.details.off_days
        recompute_capacity(member)
    # ... etc per type
```

---

## 4. Idempotency

- Each event has unique `event_id` (timestamp + actor + type hash)
- Re-run with same `event_id` → no-op + log
- PM can rollback by deleting last event (manual edit) + re-running --kpi-track to recompute aggregates

---

## 5. Rollback Procedure (v1.5.1 — protection-aware)

State file has `protected: true` (Invariant 19 writer whitelist). No KPI mode has a rollback path. Rollback is therefore an **out-of-band manual operation**:

```
1. PM identifies event to rollback (last team_events[] entry)
2. PM closes any active /pm-ba session (loader Write Protection cannot detect rollback intent)
3. PM directly edits the state file:
   - Remove entry from team_events[]
   - Reverse mutation (e.g., restore team_roster entry for team_remove)
   - Set `aggregate_cache.refreshed_at = null` (force recompute)
4. PM commits to Git (audit trail mandatory)
5. PM re-opens session; runs --kpi-track to recompute aggregates
6. Journal entry documents the rollback + Git SHA reference
```

**Note:** This intentionally bypasses Invariant 19. Mark rollback events as `tamper: true` in journal so auditors can flag for review. No automatic --kpi-rollback mode v1.5 — too easy to abuse.

---

## 6. PD Audit Trail

PD review of replan_history can detect abuse patterns:
- Frequent replans (> 1 per period) → suspicious
- All replans reduce EP → "lowballing post-hoc"
- replan_history.reason boilerplate (e.g., "scope change") → demand specificity

PM expected to provide concrete reason ≥ 30 chars per event.

---

## 7. Concurrency

- `last_updated` mtime check before write
- If state mtime newer than working memory → abort + warn "State changed concurrently. Re-load."
- Single-PM-per-project assumption (multi-PM concurrency = future)
