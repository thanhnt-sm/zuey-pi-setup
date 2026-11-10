# Mode 48 — `--kpi-track`

> Full spec for weekly KPI signal tracking + month-end final computation.
> Modifier: `--month-end` for final MP_PM / MP_DEV calculation.
> References: `references/kpi-standards-loader.md` for activation + load protocol.

---

## 1. Trigger

**Flag:** `--kpi-track [--month-end] [--week N] [--period YYYY-MM] [--no-cap] [--continue]`

- `--period YYYY-MM` — Phase 04 v1.5: override auto-detected period (retro fix for prior month). Warns if state for different period is active.
- `--no-cap` — Phase 04 v1.5: disable the AP/EP ≤ 1.5 cap on PP formula (decision Q4.1 escape hatch for legitimate scope-cut scenarios).
- `--continue` — Phase 02 v1.5: resume final sweep prompts beyond N=10 cap.

**VN triggers:** "KPI tuần này", "signal KPI", "AP/EP bao nhiêu", "báo cáo KPI tuần", "cuối tháng KPI", "tổng kết KPI tháng"

**EN triggers:** "KPI weekly track", "KPI weekly signal", "month-end KPI", "KPI week report"

---

## 2. Required Slots

| Slot | Description | Source |
|------|-------------|--------|
| `period` | Tháng KPI | Auto-derive from today (YYYY-MM) |
| `week_number` | Tuần trong tháng (1-4) | Auto: `ceil(day_of_month / 7)`; override with `--week N` |
| `task_updates` | Task status + bug_fix_days | Optional inline overrides (see §3b) |

---

## 3. Workflow Steps

### 3a. Load Standards
Invoke `references/kpi-standards-loader.md` Activation Check + Load Sequence.
- If no `docs/pm-ba-kpi-state-{project_slug}-{period}.md` → abort: "No KPI state for {period}. Run `--kpi-plan` first."
- Load state into working context.

### 3a-pre. Review Pending CRs (Phase 03 v1.5 preamble)

Before any signal computation:

```
pending = kpi_state.ep_history_pending  (filter: status == "pending_approval")

# Auto-expire stale entries (decision Q3.2 — 30 days)
for cr in pending:
  if cr.expires_at < today:
    cr.status = "expired"
    move cr → kpi_state.ep_history_expired[]
    log "⚠️ CR {cr.cr_id} auto-expired after 30 days. Moved to expired log."

# Prompt approval for remaining pending
if remaining_pending:
  AskUserQuestion (one batch per CR, max 4 options):
    "CR {cr_id} ({reason}): EP delta {delta:+d}. Approve?"
    options: [Approved] [Rejected] [Defer to next week]
  
  for each decision:
    Approved → move CR to ep_history[] (ep_monthly_capacity bumped immediately);
               recompute milestones; flag schema_dirty=true
    Rejected → drop from pending; log reason
    Defer    → leave in pending (will re-prompt next track)

# Cap: if pending count > 5 → warn "Pending CR pile-up. Resolve before next planning cycle."
```

Update `kpi_state.last_cr_review_at = today`.

### 3b. Determine Input Mode (3 options, check in order)

**Mode A — Master task list:**
Read `docs/pm-ba-master-task-list.md`. Find tasks with updated `%` or `Status` since last snapshot's `last_updated`.

**Mode B — Inline overrides:**
Parse from command args: `[T-01]=80% bug_fix=0.5d [T-02]=done bug_fix=1d`

**Mode C — Interactive:**
List all In-Progress tasks from state. For each → `AskUserQuestion`:
```
Task {ID} "{name}": tiến độ và bug fix?
Options: [Không đổi] [% hoàn thành: ___] [Xong (bug_fix=?)]
```

Input modes can combine: A as baseline, B/C as overrides.

### 3c. Prompt Bug Fix Days (MANDATORY for Done tasks) — v1.6 3-tier source flow

**Tier 1 — Ticketing auto-match:** For every task transitioning to Done, attempt to match task ID against bug-tracking system (Jira/YouTrack/etc. if configured in `docs/kpi/SOURCE.md`). If match found:
```
SET task.bug_fix_days = sum(hours of matched tickets) / 8
SET task.bug_fix_source = "ticketing"
Log: "Bug fix time auto-matched from ticketing: {task_id} → {days}d"
```

**Tier 2 — AskUserQuestion source picker (if Tier 1 miss):** For every task transitioning to Done without auto-match:
```
AskUserQuestion:
  question: "Bug fix time cho {TASK-ID} '{task_name}'? Chọn nguồn:"
  options:
    [Nhập từ ticketing system — tôi sẽ điền số] → source=ticketing, prompt days
    [Ước tính của PM (pm_estimate)] → source=pm_estimate, prompt days (cap TQ ≤ 1.0)
    [Bỏ qua / Skip] → source=skipped, bug_fix_days=null (TQ=1.0 fair default)
```
SET `task.bug_fix_source` per selection. Log source to audit.

**Tier 3 — Final sweep (v1.5 preserved, N=10 cap + --continue):** Scan task register for ALL tasks WHERE `status == Done AND bug_fix_days IS NULL AND bug_fix_source != "skipped"`. Batch prompt in chunks of 4 via `AskUserQuestion`. Cap at N=10 tasks per session (decision Q2.2); above N, suggest `--kpi-track --continue` to resume.

```
For task_chunk in chunks(unresolved_done_tasks, size=4)[:max_chunks=N/4]:
  AskUserQuestion:
    question: "Final sweep — bug fix time cho các task đã Done nhưng chưa cập nhật?"
    options per task: [0d (ticketing)] [0.25d (ticketing)] [0.5d (pm_estimate)] [Skip]
```

If PM skips → SET `bug_fix_source = "skipped"`, flag: "⚠️ TQ=1.0 (fair default) for {TASK-ID}."

**Anti-pattern guard:** DO NOT skip bug_fix_days prompt — TQ becomes unverifiable (source=ticketing → 0.8-1.2 range; source=pm_estimate/skipped → capped at 1.0).

### 3d. Compute Per-Task TQ (v1.5 — delegated to shared spec)

Use algorithm from `references/kpi-tq-computation.md` (P1 rounding guard + 4-case priority + fallback planned_finish + null handling).

```python
from kpi_tq_computation import compute_tq  # spec reference

for task in done_tasks:
    task.tq = compute_tq(task)
    if task.tq is None:
        flag(f"⚠️ TQ unresolved for {task.id} — final sweep next track")
```

Write TQ to task row in state file. Mutation appended to `task.tq_history[]` for audit.

### 3e. Compute Aggregates (v1.6 — ledger-based, EP semantic split, AP cumulative)

```
# Refresh multi-month aggregate (v1.6 — ledger replaces glob; see kpi-multi-month-aggregation.md §3)
aggregate = read_ledger(current_state)               # reads ep_cumulative_ledger from state frontmatter
ap_carry_over     = aggregate.ap_carry_over          # AP from project start through prior periods
ep_cumulative     = aggregate.ep_cumulative_through_period

# Current period AP
ap_period         = Σ(TP gross of Done tasks completed in current period)
ap_cumulative     = ap_carry_over + ap_period

# AP/EP signal — MONTHLY capacity basis (NOT cumulative)
AP_EP_signal      = ap_period / kpi_state.ep_monthly_capacity

# CP gross convention (decision A1) — TQ does NOT factor here
CP_week           = Σ(TP gross of tasks completed THIS week)
CP_month          = Σ(TP gross of tasks completed in current period)

TQ_avg            = mean(TQ for all Done tasks with TQ != null)
bug_fix_pct       = Σ(bug_fix_days) / Σ(mds of Done tasks) × 100%
```

**v1.5 convention (decision A1):** AP and CP both use **gross TP** (no TQ weighting).
TQ applies only at per-task MP_DEV computation. Document in quick-reference §1.

### 3f. Signal Classification

Load thresholds from `docs/kpi/kpi-quick-reference.md` §7. Classify each metric as 🟢/🟡/🟠/🔴.

Overall signal = worst individual signal.

### 3g. Action Recommendation (v1.5 Phase 06 — Intelligence Layer)

**Healthy-week short-circuit (v1.5.1):** If overall signal is 🟢 AND `coaching_status.current_step == 0` for all DEVs AND `ep_history_pending` count == 0 AND `feature_freeze_until` is null → skip §3g entirely; output one-line `"All clear — no patterns triggered, no coaching ladder active, no pending CRs."` Save tokens on green weeks.

**Step 1 — Per-signal Decision Tree narrative:**
For each red/orange signal, invoke `references/kpi-decision-tree-loader.md` to load the relevant Decision Tree section. Inline narrative excerpt (≤ 500 chars per signal) + action IDs.

**Step 2 — Pattern trigger (A/B/C/D/E):**
Invoke `references/kpi-pattern-trigger.md`. Evaluate all 5 patterns; resolve by priority **E > C > B > A > D**; cap output at top-2 patterns. Each triggered pattern inlines its narrative + action set.

**Step 3 — Coaching Ladder per DEV:**
For each team member, invoke `references/kpi-coaching-ladder.md` advance logic. Output per-DEV: current TQ, ladder step, action_id, consecutive weeks, reset progress. Reset condition: TQ ≥ 1.0 cho 2 weeks consecutive (decision 6.2).

**Step 4 — UAT awareness:**
Read `kpi_state.uat_date_cache.uat_date` (refresh from `docs/pm-uat-schedule.md` if cache > 24h old). Compute `days_to_uat`. If `days_to_uat ≤ 14 AND bug_fix_pct > 12%` → Pattern B trigger (UAT-FREEZE-01).

**Step 5 — Memo PD auto-gen:**
If any of the following met:
- Any signal 🔴
- Pattern E triggered
- Coefficient change pending
- CR scope inflation > 20% (Pattern D)
- UAT-2-week + bug high (Pattern B)

→ Auto-generate `plans/reports/kpi-memo-pd-{YYYYMMDD}-{trigger-slug}.md` via `templates/kpi-memo-pd-template.md` (Template 5). Dedupe: max 1 memo per pattern per week (check `pattern_history`).

**Output format:** Inline narrative under each signal. Total §3g output capped ≤ 4000 chars (token budget per `kpi-decision-tree-loader.md` §6).

Action library reference: `docs/kpi/KPI_Action_Library.md`. Action templates: `docs/kpi/templates/KPI_Action_Templates.md`.

### 3h. Month-End Computation (only if `--month-end`) — v1.6 cumulative PP + ledger update

```
# Phase 04 guards
if ep_cumulative_through_period == 0:
    PP = 0
    warn "EP_cumulative=0 → PP=0 (first period or no plan upstream)"
else:
    ratio = ap_cumulative / ep_cumulative_through_period
    if ratio > 1.5 and not args.no_cap:
        warn f"AP/EP ratio {ratio:.2f} capped at 1.5. Use --no-cap to override (decision Q4.1)."
        ratio = 1.5
    PP = CP_month × ratio

MP_PM  = PP × S × C × R × Q

# Q suggestion (v1.5 — adds customer complaint gate):
# 1. Auto-suggest Q based on bug_fix_pct + schedule
#    - bug_fix_pct >= 20% OR late overall → suggest 0.8
#    - bug_fix_pct 10-20% AND on-time → suggest 1.0
#    - bug_fix_pct < 10% AND ahead → suggest 1.2
# 2. MANDATORY customer-complaint prompt (Phase 04):
#    AskUserQuestion: "Khách hàng có phàn nàn về thái độ / chất lượng / tiến độ tháng này?"
#    options: [Không] [Có — chi tiết] [Không rõ]
#    If "Có" → force Q = 0.8 regardless of computed suggestion (per SM_KPI Q definition)
# 3. AskUserQuestion: "Q coefficient = ? (suggested: {Q})"
# 4. Use confirmed Q for final MP_PM

# Month-end ledger update (Phase 03 v1.6 — record final ap_period into current ledger row)
current_row = kpi_state.ep_cumulative_ledger[-1]
assert current_row.period == current_period, "Ledger tail period mismatch"
current_row.ap_period = ap_period  # finalize actual AP for this period
# Ledger row is now sealed; next --kpi-plan will append a new row

for each DEV in kpi_state.team_roster:
    dev_tasks = tasks where owner == DEV.name AND status == Done
    MP_DEV    = Σ(task.TP × task.TQ for task in dev_tasks)
    gap       = MP_DEV - DEV.monthly_target
    status    = "✅ đạt" if gap >= 0 else f"❌ thiếu {abs(gap)} pts"
```

### 3i. Generate Weekly Report

Output matches `docs/kpi/KPI_Weekly_Report_Template.md` 7 sections:

1. **Snapshot KPI** — AP, EP, AP/EP, CP_week, TQ_avg, Bug%, signal matrix
2. **Dự Báo Cuối Tháng** — projected MP_PM if trend holds; days remaining
3. **Vấn Đề** — blockers, risks identified this week
4. **Kết Quả Tuần** — tasks completed with TP × TQ breakdown
5. **DEV Status** — per-person: tasks done, TP earned, TQ avg, running MP_DEV; + final MP if month-end
6. **Kế Hoạch Tuần Tới** — tasks targeted, milestone target AP/EP
7. **Hệ Số** — current S/C/R/Q; prompt if any change: "Hệ số có thay đổi không?"

### 3j. Output File

```
Weekly:     plans/reports/pm-{YYYYMMDD}-kpi-week{N}-{period}.md
Month-end:  plans/reports/pm-{YYYYMMDD}-kpi-monthend-{period}.md
```

### 3k. Update State File (v1.5)

Append to `docs/pm-ba-kpi-state-{project_slug}-{period}.md`:
- `weekly_snapshots[]`: add new row {week, ap_period, ap_cumulative, CP_week, AP/EP_signal, TQ_avg, bug%, signal}
- `tasks[]`: update finished tasks (finished_at, bug_fix_days, TQ, status=Done)
- `ap_period`, `ap_cumulative` (refresh)
- `aggregate_cache.refreshed_at` = today
- `last_updated`: today's timestamp
- If `--month-end`: add `mp_pm_final` and `mp_dev_final[]` fields

**Invariant 19 reminder:** kpi-state is sole authority for EP/AP/PP/MP. Mode 48 is the only writer to these for the period.

### 3l. Update document-status.md
Update `last_kpi_track` timestamp.

### 3m. Auto-Archive at Month-End (Phase 10 v1.5)
If `--month-end` AND mode succeeds:
1. Compute `archive_path = docs/kpi/archive/{YYYY}/{MM}/`
2. Create directory if absent
3. Move (preserve mtime) `docs/pm-ba-kpi-state-{slug}-{period}.md` → `{archive_path}/`
4. Update document-status pointer to indicate `archived` for this period
5. Log archive event to journal

Next month --kpi-plan creates fresh state with `project_history_ref` referencing the archived file.

---

## 4. Outputs

| File | Purpose |
|------|---------|
| `plans/reports/pm-{date}-kpi-week{N}-{period}.md` | Weekly report (7-section template-compliant) |
| `docs/pm-ba-kpi-state-{project_slug}-{YYYYMM}.md` | Updated tasks[], snapshots[], last_updated. Slug-less form is v1.4 legacy fallback only. |

---

## 5. End-of-Mode Hooks

- `/ck:journal`: YES if `--month-end`; NO for regular weekly
- If 🔴 signals detected: suggest `"Run /pm-ba --meeting-pre để chuẩn bị PD escalation."`
- If `--month-end`: auto-archive performed by §3m moves state to `docs/kpi/archive/{YYYY}/{MM}/` (manual mv NOT needed)
