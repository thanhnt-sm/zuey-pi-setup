# KPI Pattern Trigger Logic — A/B/C/D/E

> State machine triggering pre-defined response patterns (Phase 06 v1.5).
> Priority (decision 6.3): **E > C > B > A > D** when multiple patterns match.
> Output: top-2 patterns max per --kpi-track run (avoid noise).

---

## 1. Pattern Definitions

| Pattern | Name | Trigger Logic | Action Set |
|---------|------|---------------|------------|
| **A** | AP Recovery (schedule slip) | AP/EP < 0.85 AND ≥ 3 weeks remaining in period | PM-AP-01 + PM-AP-03 + (PM-AP-02 if w1 missed) |
| **B** | UAT Feature Freeze | `days_to_uat ≤ 14` AND `bug_fix_pct > 12%` | UAT-FREEZE-01 + Q-WARN-04 |
| **C** | Chronic DEV Underperformance | Same DEV TQ avg < 1.0 across ≥ 3 months (or coaching ladder step ≥ 3) | DEV-TQ-02 + DEV-TQ-06 + escalate Memo HR |
| **D** | CR Scope Inflation | EP delta from CRs > 20% of original ep_monthly_capacity AND PM-AP < 1.0 | PM-AP-07 (renegotiate) + Q-CR-02 (postmortem next cycle) |
| **E** | Multi-Red Emergency | ≥ 2 signals 🔴 in same week OR Pattern A + B concurrent | All-hands: Memo PD (Template 5) + daily check-in + activate adjacent patterns |

---

## 2. Priority Resolution

When multiple patterns match simultaneously, apply ordering **E > C > B > A > D**:

```python
def resolve_patterns(matched_patterns):
    order = ["E", "C", "B", "A", "D"]
    sorted_patterns = sorted(matched_patterns, key=lambda p: order.index(p))
    return sorted_patterns[:2]  # cap at 2 (avoid noise)
```

**Rationale (decision 6.3):**
- E first: multi-red is most severe; addresses systemic
- C before B: chronic individual issues harder to fix late; need early intervention
- B before A: UAT-bound + quality crisis tightly time-bound
- A standalone: schedule signal addressable with replan
- D last: operational/process, no immediate threat

---

## 3. Trigger Conditions Detail

### Pattern A — AP Recovery

```python
weeks_remaining = (period_end - today).days // 7
if signal.AP_EP < 0.85 and weeks_remaining >= 3:
    trigger("A", actions=["PM-AP-01", "PM-AP-03"])
    if signal.w1_milestone_missed:
        actions.append("PM-AP-02")
```

### Pattern B — UAT Feature Freeze

```python
uat = kpi_state.uat_date_cache.uat_date
days_to_uat = (uat - today).days
if days_to_uat <= 14 and signal.bug_fix_pct > 12:
    trigger("B", actions=["UAT-FREEZE-01", "Q-WARN-04"])
```

### Pattern C — Chronic DEV

```python
for dev in team_roster:
    history = dev.coaching_status
    if history.current_step >= 3 or months_consecutive_low(dev) >= 3:
        trigger("C", actions=["DEV-TQ-02", "DEV-TQ-06"], hr_memo=True, dev=dev.name)
```

### Pattern D — CR Scope Inflation

`ep_monthly_capacity_original` is set ONCE in Mode 47 §3j at sprint lock (immutable thereafter; survives Mode 56 replans). Used as denominator for inflation %.

```python
cr_delta_raw = sum(entry.delta for entry in state.ep_history if entry.cr_id)
inflation_pct = cr_delta_raw / state.ep_monthly_capacity_original
if inflation_pct > 0.20 and signal.AP_EP < 1.0:
    trigger("D", actions=["PM-AP-07"], followup=["Q-CR-02"])
```

**Fallback:** if `state.ep_monthly_capacity_original` missing (legacy state files pre-v1.5 patch), compute as `state.ep_monthly_capacity - Σ(positive ep_history.delta)` and warn migration needed.

### Pattern E — Multi-Red Emergency

```python
red_signals = count_red(signal_matrix)
if red_signals >= 2:
    trigger("E", actions=["Memo-PD-Template-5", "daily_checkin"],
            adjacent=identify_adjacent_patterns(signals))
```

---

## 4. Output Format (Mode 48 §3g)

When pattern triggered, inline narrative:

```markdown
### Pattern {ID} — {Name}

**Triggered by:** {trigger_evidence}
**Severity:** {🔴|🟠|🟡}
**Time-box:** {urgency description}

**Required Actions:**
1. **{action_id}** — {action_description} ({owner}, {ETA})
2. **{action_id}** — ...

**Auto-generated memo:** {memo_file_path} (Template 5)

**Tracking:**
- Next checkpoint: {date}
- Resolution criteria: {specific_metric}
```

---

## 5. Anti-Patterns

- ❌ Output ALL matched patterns → noise; cap at 2 highest priority
- ❌ Re-trigger same pattern next week without progress check → check `pattern_history`
- ❌ Activate Pattern C silently → HR coordination always required for level reduction
- ❌ Skip Pattern E memo because "PM already aware" → audit trail required

---

## 6. State Tracking

```yaml
pattern_history:
  - week: "2026-06-W3"
    patterns_active: ["E", "B"]
    actions_issued: ["UAT-FREEZE-01", "Memo PD"]
    memo_path: "plans/reports/kpi-memo-pd-260612-pattern-e.md"
    resolved_at: null
  - week: "2026-06-W2"
    patterns_active: ["A"]
    actions_issued: ["PM-AP-01", "PM-AP-03"]
    resolved_at: "2026-06-W3"
```

Mode 48 §3g consults `pattern_history` to avoid duplicate memo generation (1 memo per week max per pattern).
