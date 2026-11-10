# Mode 56 — `--kpi-replan`

> Mid-period replan. Preserves weekly_snapshots; recomputes ep_monthly_capacity + milestones (Phase 09 v1.5).
> PD signoff required if `|ep_delta_pct| > 15%` (decision 9.1).

---

## 1. Trigger

**Flag:** `--kpi-replan --reason "..." [--new-ep N] [--force-no-pd]`

**VN triggers:** "replan tháng", "tính lại kế hoạch", "scope thay đổi cần replan"
**EN triggers:** "replan sprint", "recompute milestones", "scope change replan"

---

## 2. Required Slots

| Slot | Description |
|------|-------------|
| `reason` | ≥ 30 chars; specific (not "scope change") |
| `new_ep` | Optional override; else auto-compute from current realities |

---

## 3. Workflow Steps

### 3a. Load Standards + Validate
- State protected + whitelist
- Prior replan within last 7 days → warn "Recent replan; sure?" (anti-thrashing)
- `reason` ≥ 30 chars

### 3b. Compute New EP
If `--new-ep` provided: use it.
Else auto-compute:
- Subtract removed scope (cancelled tasks)
- Add scope additions (mid-sprint adds)
- Adjust for team_events (vacations, removals)

### 3c. Compute EP Delta
```
ep_delta = new_ep - old_ep_monthly_capacity
ep_delta_pct = abs(ep_delta / old_ep_monthly_capacity × 100)
```

### 3d. PD Signoff Gate (decision 9.1)
```python
if ep_delta_pct > 15 and not args.force_no_pd:
    # Auto-generate PD memo (Template 5)
    memo = generate_pd_memo(reason, ep_delta, ep_delta_pct, milestones_old, milestones_new)
    write_memo("plans/reports/kpi-memo-pd-{date}-replan-{slug}.md")
    
    # Append to ep_history_pending instead of immediate apply
    state.ep_history_pending.append({
        "cr_id": f"RPL-{date}-{hash}",
        "type": "replan",
        "delta": ep_delta,
        "reason": reason,
        "status": "pending_pd_signoff",
        "memo_path": memo_path,
        "expires_at": today + 30d,
    })
    
    print("Replan > 15% EP delta. PD signoff required. Memo generated.")
    print("Next: /pm-ba --kpi-pending-approve {memo_path} after PD signs")
    print("  (Mode 51 handles both 'coeff_delta' and 'replan' pending entry types)")
    exit
else:
    # Auto-apply (≤ 15% threshold)
    apply_replan(state, new_ep, reason, milestones_revised)
```

### 3e. Apply Replan (only if auto-approved OR after PD signoff)
- `state.ep_monthly_capacity = new_ep`
- `state.ep_history[]` append entry
- `state.replan_history[]` append per `kpi-team-event-log.md §2` schema
- Revise milestones: w1-wN based on `weeks_remaining`
- **PRESERVE** `weekly_snapshots[]` (do NOT wipe)

### 3f. Recompute Milestones
```python
weeks_total = 4
weeks_done = count_completed_weeks(weekly_snapshots)
weeks_remaining = weeks_total - weeks_done
ap_done = weekly_snapshots[-1].ap_period if weekly_snapshots else 0

# Per-remaining-week proportions of (new_ep - ap_done)
remaining_proportions = {
    1: [1.00],
    2: [0.45, 0.55],
    3: [0.30, 0.30, 0.40],
    4: [0.25, 0.25, 0.25, 0.25],
}[weeks_remaining]

ep_to_distribute = new_ep - ap_done
for idx, w in enumerate(range(weeks_done + 1, weeks_total + 1)):
    cumulative_pct = sum(remaining_proportions[:idx + 1])
    milestones[w] = {
        "target_ap": ap_done + ep_to_distribute * cumulative_pct,
        "target_ap_ep": (ap_done + ep_to_distribute * cumulative_pct) / new_ep,
    }
```

### 3g. Output Side-by-Side
```
=== REPLAN — {project} — {period} ===

Reason: {reason}
EP delta: {old_ep} → {new_ep} ({ep_delta:+d}, {ep_delta_pct:+.1f}%)

Milestones (side-by-side):
| Week | Old AP target | New AP target | Delta |
|------|--------------|---------------|-------|
| w1 (done) | 46 | 46 (preserved) | — |
| w2 (done) | 92 | 92 (preserved) | — |
| w3 | 147 | 128 | -19 |
| w4 | 184 | 160 | -24 |

PD signoff: {status}
```

### 3h. Journal

---

## 4. Outputs

| Output | Purpose |
|--------|---------|
| `replan_history[]` append | Audit |
| `ep_monthly_capacity` mutated | New target |
| `ep_history[]` append | EP delta tracked |
| `weekly_snapshots[]` PRESERVED | Historical record |
| PD memo (if > 15%) | Signoff workflow |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Reason boilerplate | "scope change" / "adjust" / < 30 chars | Re-prompt |
| Replan within 7d | Recent replan | Warn — anti-thrashing |
| > 1 replan per period | Excess churn | Warn; suggest PD review |
| Reduce EP without proportional scope-removed evidence | "Lowballing post-hoc" | Demand evidence link (CR / cancelled tasks) |
| Force-no-pd on > 15% delta | Audit bypass | Block unless PD explicitly co-signs OR --force escalated |

---

## 6. End-of-Mode Hooks
- `/ck:journal`: YES (milestone)
- Suggest next: `--kpi-track` to refresh signals with new baseline
