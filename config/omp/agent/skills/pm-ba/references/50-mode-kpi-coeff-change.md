# Mode 50 — `--kpi-coeff-change`

> Initiate coefficient (S/C/R) change with PD-in-loop signoff (Phase 05 v1.5).
> Decision A5: file-based signoff + Git SHA audit.
> Writes to `ep_history_pending` workflow; PM later invokes Mode 51 to apply after PD signs.

---

## 1. Trigger

**Flag:** `--kpi-coeff-change [S=val] [C=val] [R=val] [--reason "..."]`

**VN triggers:** "đổi hệ số S", "cập nhật C dự án", "PD duyệt đổi R", "thay coefficient KPI"
**EN triggers:** "change S coefficient", "update KPI coefficient", "coefficient signoff"

---

## 2. Required Slots

| Slot | Description |
|------|-------------|
| Target coefficient(s) | At least one of S, C, R (Q is per-month, not signoff-routed) |
| New value | Must be in quick-reference §5 allowed range |
| Reason | Free text justification (≥ 30 chars) |

---

## 3. Workflow Steps

### 3a. Load Standards + Validate
- Load kpi-state
- Validate new value within quick-ref §5 range (S ∈ {1.0, 1.1, 1.2}, C ∈ {1.0, 1.2, 1.4}, R ∈ {1.0, 1.2})
- Compute delta vs current coefficient → EP-equivalent estimate (for ep_history_pending entry)

### 3b. Generate PD Memo
Write `plans/reports/kpi-memo-pd-coeff-{date}-{project_slug}.md` per `templates/kpi-memo-pd-coeff-change.md`.

Memo content:
- Project context (slug, period, current state)
- Current coefficients vs proposed
- Justification (reason argument)
- Impact analysis (MP_PM delta projection)
- **PD Signoff section** (initially empty for PD to fill)

### 3c. Append to ep_history_pending
Per Phase 03 schema:
```yaml
- cr_id: "COEFF-{date}-{short_hash}"
  timestamp: "{now}"
  reason: "Coefficient change: {S→S', C→C', R→R'} — {reason}"
  delta: 0                        # No EP delta directly; coefficient delta logged separately
  coeff_delta: {S: ..., C: ..., R: ...}
  status: pending_pd_signoff
  memo_path: "plans/reports/kpi-memo-pd-coeff-{date}-{slug}.md"
  created_by: "{pm_name}"
  expires_at: "{today + 30d}"
```

### 3d. Print Next Steps
```
✓ Memo PD generated: {path}
✓ Pending entry: COEFF-{date}-{hash}

Next:
1. Gửi memo cho PD (email / file share)
2. PD edit memo, fill section "PD Signoff" + commit to Git
3. Chạy: /pm-ba --kpi-pending-approve {memo_path}
```

### 3e. Exit
Do NOT mutate `coefficients` in state. Mutation deferred to Mode 51.

---

## 4. Outputs

| File | Purpose |
|------|---------|
| `plans/reports/kpi-memo-pd-coeff-{date}-{slug}.md` | PD-readable memo with signoff section |
| kpi-state `ep_history_pending[]` | Append-only entry |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Out-of-range value | New S/C/R not in quick-ref §5 | Abort with allowed values |
| Reason too short | < 30 chars | Re-prompt for justification |
| Pending coeff-change already exists | Same coefficient pending | Block: "Resolve existing pending first" |
| > 30 days since last signoff | Compliance check | Warn but allow |

---

## 6. End-of-Mode Hooks
- `/ck:journal`: NO (intermediate step; journal at Mode 51 approval)
- Suggest next: Mode 51 (`--kpi-pending-approve`)
