# Mode 59 — `--kpi-hire-suggest`

> Aggregate team gap analysis → hire/transfer suggestions (Phase 10 v1.5).
> Decision 10.2: PM-only output; PM forwards to HR/PD manually (no auto-send).

---

## 1. Trigger

**Flag:** `--kpi-hire-suggest [--months N]`

**VN triggers:** "có cần tuyển thêm không", "team gap analysis", "đề xuất hire"
**EN triggers:** "hire suggestion", "team gap analysis", "do I need to hire"

---

## 2. Required Slots

| Slot | Default |
|------|---------|
| `months` | 3 (lookback window) |

---

## 3. Workflow Steps

### 3a. Load Aggregate
Read state files from last N months. Collect:
- Anti-pattern warnings (over-utilization, ineligibility blocks, Senior overload, Junior under-stretch)
- Coaching ladder events (Pattern C — chronic DEV)
- Replan reasons mentioning capacity

### 3b. Compute Per-P-Level Gap
```python
for P in [P1..P7]:
    backlog_tp = Σ TP of pending tasks at P across recent history + projection
    capable_devs = team_roster.filter(eligible_for_P(level))
    capable_capacity = Σ (member.velocity × member.working_days) for member in capable_devs
    
    if backlog_tp > capable_capacity × 1.2:
        gap_tp = backlog_tp - capable_capacity
        suggested_hires = ceil(gap_tp / avg_velocity_for_level)
        record_suggestion(P, suggested_hires, level_needed)
```

### 3c. Persistent Pattern Filter (Decision 10.2 spam guard)
Only emit suggestion if pattern persists ≥ 2 of last 3 months. Single-month spikes ignored.

### 3d. Generate Suggestion Report
Per `templates/kpi-hire-suggest-template.md`. Output: `plans/reports/kpi-hire-suggest-{date}.md`.

### 3e. Print Forward Instruction
```
✓ Hire suggestion: {file}

This is a PM-only output (decision 10.2).
Review, edit if needed, then forward manually:
  - HR contact: {pm provides}
  - PD: attach with next memo (Template 5)

No auto-send. Avoid HR spam from premature suggestions.
```

---

## 4. Outputs

| Output | Purpose |
|--------|---------|
| `plans/reports/kpi-hire-suggest-{date}.md` | PM-facing recommendation; PM forwards manually |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Insufficient history | < 2 months data | Block: "Need 2+ months for reliable gap analysis" |
| Single-month spike | Pattern not persistent | Filter out (decision 10.2) |
| Already-suggested last month | Prevent repeat noise | Annotate "Repeat — confirm with HR if forwarded" |
| Suggestion exceeds 3 hires | Excessive | Warn + double-check capacity assumptions |

---

## 6. End-of-Mode Hooks
- `/ck:journal`: NO (PM-only read; journal when actioned)
- Suggest: Forward to PD via memo; HR via email
