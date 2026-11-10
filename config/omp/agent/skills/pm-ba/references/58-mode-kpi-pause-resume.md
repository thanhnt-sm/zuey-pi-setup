# Mode 58 — `--kpi-pause` / `--kpi-resume`

> Toggle project KPI active state. Preserve state file. (Phase 10 v1.5)
> Max 3-month pause (decision 10.3); beyond → force archive or resume.

---

## 1. Trigger

**Flags:** `--kpi-pause --reason "..."` | `--kpi-resume`

**VN triggers:** "tạm dừng KPI", "pause project", "tiếp tục KPI", "resume KPI"
**EN triggers:** "pause KPI project", "resume KPI tracking"

---

## 2. Required Slots

| Op | Required |
|----|----------|
| pause | `reason` (≥ 30 chars) |
| resume | None (auto-resume from paused state) |

---

## 3. Workflow Steps — Pause

### 3a. Validate
- State `paused != true` (else: "Already paused since {date}")
- `reason` ≥ 30 chars
- **Idempotency check (RT-14 fix):** If `ep_cumulative_ledger[-1].period == current_period AND ep_cumulative_ledger[-1].paused == true` → no-op; append audit-log entry only. Do NOT write a second placeholder row.

### 3b. Mark State
```yaml
paused: true
paused_at: {today ISO}
paused_reason: "{reason}"
paused_by: "{pm_name}"
expected_resume: "{paused_at + 3 months}"  # auto-set expiry per decision 10.3
pause_history:
  - paused_at: ..., reason: ..., resumed_at: null
```

### 3b-bis. Write Ledger Placeholder Row (Phase 03 v1.6)
```python
# Append placeholder row to ep_cumulative_ledger (preserves ledger continuity)
placeholder = {
    "period": current_period,
    "ep_monthly": 0,
    "ap_period": 0,
    "paused": True,
    "paused_reason": reason
}
kpi_state.ep_cumulative_ledger.append(placeholder)
# Row is immutable after write (ledger append-only invariant)
```
**Migration note:** Existing `pause_history[]` entries from schema v1.5 are replayed into ledger rows by the loader's Phase 03 migration block. Original `pause_history[]` is preserved until v1.7 sunset.

### 3c. Update document-status
```
KPI[{slug}]: kpi_active=false, paused=true, paused_at={date}, expected_resume={date+3mo}
```

### 3d. Output
```
✓ KPI paused for {project_slug}
✓ Reason: {reason}
✓ Max pause: 3 months → expected resume by {date}
⚠️ Beyond {date+3mo}: force resume or archive.
```

---

## 4. Workflow Steps — Resume

### 4a. Validate
- State `paused == true`
- Calendar gap detection: log pause duration

### 4b. Restore State
- `paused = false`
- `pause_history[].resumed_at = today`
- Multi-month aggregate recompute (account for gap months as 0 via paused ledger rows)
- Refresh `aggregate_cache`
- **Ledger note (Phase 03 v1.6):** Resume does NOT modify the paused placeholder row in `ep_cumulative_ledger` (it remains immutable). Next `--kpi-plan` invocation appends a new active ledger row for the resumed period.

### 4c. Output
```
✓ KPI resumed for {project_slug}
✓ Gap duration: {n} days/months
✓ Aggregate cache refreshed
⚠️ Recommend: --kpi-replan if scope changed during pause
```

---

## 5. Auto-Expiry Guard (decision 10.3)

On any `--kpi-*` invocation:
```
if state.paused AND today > state.expected_resume:
    block: "Pause expired {n} days ago. Force resume OR archive manually:
            /pm-ba --kpi-resume   (resume tracking)
            Manual archive (no dedicated mode v1.5):
              mv docs/pm-ba-kpi-state-{slug}-{YYYYMM}.md docs/kpi/archive/{YYYY}/{MM}/
              Update docs/pm-ba-document-status.md pointer (mark archived)"
```

---

## 6. Outputs

| Output | Purpose |
|--------|---------|
| `paused` toggle | State |
| `pause_history[]` append | Audit |
| document-status pointer | Visibility |

---

## 7. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Pause without reason | < 30 chars | Re-prompt |
| Pause expired | Beyond 3 months | Block until resume/archive |
| Resume without state | No paused state | Error |
| Frequent pause-resume | > 2 per quarter | Warn — operational instability |

---

## 8. End-of-Mode Hooks
- `/ck:journal`: YES
- Suggest after resume: `--kpi-track --period {current}` to recompute signals
