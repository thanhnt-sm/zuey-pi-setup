# Mode 47 — `--kpi-plan`

> Full spec for KPI-compliant monthly sprint planning.
> References: `references/kpi-standards-loader.md` for activation + load protocol.

---

## 1. Trigger

**Flag:** `--kpi-plan` (creates plan) | `--kpi-plan --confirm <proposal-file>` (locks tasks per edited proposal — Phase 03 v1.5)

**VN triggers:** "plan tháng theo KPI", "tasklist KPI", "kế hoạch KPI tháng X", "sprint KPI", "lập kế hoạch KPI"

**EN triggers:** "KPI sprint plan", "KPI monthly plan", "plan with KPI"

**Additional flags (Phase 04 v1.5):**
- `--period YYYY-MM` — override auto-detected period (retro plan for prior month). Warns if state for different period exists and is active.
- `--project-slug <slug>` — override CWD-derived project slug (Phase 05 multi-project; required when working from non-canonical CWD).

**Subflow `--confirm <file>`:**
- Reads PM-edited proposal file from `plans/reports/kpi-plevel-proposal-{period}.md`
- Validates rules (§3e validation)
- Locks tasks_locked=true in state
- Idempotent: re-edit + re-confirm allowed; refuses if `status: confirmed` already and proposal mtime older than state's tasks_locked timestamp (use `--force` to override)

---

## 2. Required Slots

| Slot | Description | Example |
|------|-------------|---------|
| `period` | Tháng KPI (YYYY-MM) | "2026-06" |
| `project` | Tên dự án | "<Project>" |
| `project_slug` | Slug viết thường (Phase 05 v1.5) | "pvcom-[PROJECT]" (derive from CWD or --project-slug arg) |
| `pm_name` | Tên PM | "Nguyễn Văn PM" |
| `pm_level` | TL01 \| TL02 \| TL03 (Phase 05 v1.5) | "TL02" (decision A8: PM solo = TL) |
| `team_roster` | List {name, level} | "An:Junior02, Bình:Senior01" |
| `working_days` | Số ngày làm việc thực tế | 22 |
| `coefficients` | S, C, R, Q_target | "S=1.1, C=1.2, R=1.0, Q=1.0" |
| `backlog_source` | Đường dẫn backlog | "docs/pm-ba-master-task-list.md" |

If any slot missing → `AskUserQuestion` batch for missing slots before proceeding.

---

## 3. Workflow Steps

### 3a. Load Standards
Invoke `references/kpi-standards-loader.md` Activation Check + Load Sequence.
- If KPI not installed → abort with install instructions.
- If state file for `period` already exists → block: "State for {period} already exists. Use `--force` to overwrite."

### 3b. Validate Slots
Validate all Required Slots via `AskUserQuestion`. Confirm coefficients against quick-reference §5 bounds.

### 3c. Compute Capacity per DEV (v1.6 — EP semantic split + ledger init)

```
for each member in team_roster:
  velocity = lookup velocity from kpi-standards-loader.md Velocity Reference
             (or PM override if provided)
  capacity_pts = working_days × velocity
  capacity_mds = working_days

total_capacity_pts = Σ(capacity_pts)
EP_raw                = total_capacity_pts
ep_monthly_capacity   = EP_raw × 0.80 × 0.85   # current month only — for AP/EP signal
ep_final              = ep_monthly_capacity     # legacy alias, deprecated

# Multi-month aggregate — see kpi-multi-month-aggregation.md §3 (v1.6 ledger-based)
IF NOT state.ep_cumulative_anchor:
    # First month for this project
    set ep_cumulative_anchor = { period, ep_monthly: ep_monthly_capacity, set_at: now, set_by: pm_name, immutable: true }
    init ep_cumulative_ledger = [{period, ep_monthly: ep_monthly_capacity, ap_period: null}]
ELSE:
    # Subsequent month — append ledger
    Validate prior row's ap_period filled (warn if null — PM skipped month-end)
    append ep_cumulative_ledger += [{period, ep_monthly: ep_monthly_capacity, ap_period: null}]

aggregate = read_ledger(current_state)  # Phase 03 v1.6 — replaces glob-based aggregate_history
ep_cumulative_through_period = aggregate.ep_cumulative_through_period
ap_carry_over                = aggregate.ap_carry_over

bug_fix_budget_days = Σ(working_days per member) × 0.08
```

Both `ep_monthly_capacity` and `ep_cumulative_through_period` MUST be written to state.
Reference: `kpi-multi-month-aggregation.md`. No 12-month cap in v1.6 (ledger is authoritative).

### 3d. Load Backlog
Read `docs/pm-ba-master-task-list.md`. Also scan `plans/reports/` for any recent extract files.
Build candidate task list: tasks in Pending/Backlog state.

**Phase 08 hint:** For each candidate where `mds > 3 AND P-level ≥ 5 AND AC count ≥ 5` → emit hint: "Task {id} large + complex. Consider `/pm-ba --kpi-decompose {id}` before locking sprint."

**Post-§3e hint:** After tasks locked, suggest: "Run `/pm-ba --kpi-assign --strategy balanced` for optimizer-based assignment, or proceed with manual assignment."

### 3e. P-Level Classification — File-Based Proposal (v1.5 Phase 03)

**Problem solved:** AskUserQuestion quota cứng (4 questions × 4 options) không khả thi cho 50+ task batch confirm.

**New flow:**

1. **Heuristics per task:**
   - Table count: count distinct table/entity names in description
   - Complexity keywords: CRUD, report, integration, ETL, API, luồng, quy trình, phức tạp
   - AC count (number of Acceptance Criteria)
   - Dependencies count
2. **Output:** Top-3 P-levels with confidence % + rationale per task
3. **DEV eligibility check:** If proposed assignee's level cannot handle P-level → flag DEV Level OK = ❌
4. **Generate proposal file:** Write `plans/reports/kpi-plevel-proposal-{period}.md` per `templates/kpi-plevel-proposal-template.md` format with one row per candidate task.
5. **Print instruction + EXIT:**
   ```
   ✓ Proposal generated: plans/reports/kpi-plevel-proposal-{period}.md
   
   Tiếp theo:
   1. Mở file proposal, review & edit cột "P-level CONFIRMED" + "Assignee CONFIRMED"
   2. Save file
   3. Chạy: /pm-ba --kpi-plan --confirm plans/reports/kpi-plevel-proposal-{period}.md
   ```
   Mode 47 exits — tasks NOT locked yet. State file holds tasks[] in `pending_lock` block.

**--confirm subflow (separate invocation):**

1. Read proposal file `--confirm <path>`
2. Validate (proposal-template §Validation Rules):
   - Every `P-level CONFIRMED` ∈ {P1..P7}; no `[?]` remaining
   - Every `Assignee CONFIRMED` ∈ team_roster names
   - DEV Level OK = ✅ or has Notes justification
   - No duplicate Task IDs
   - Σ(TP) within `ep_monthly_capacity ± 20%`
3. On validation pass: write confirmed tasks to state `tasks[]` block; set `tasks_locked: true`; set proposal file frontmatter `status: confirmed`
4. On validation fail: list errors per row; do NOT mutate state; PM re-edit + retry
5. Idempotency: re-confirm allowed; refresh tasks_locked timestamp

**Race guard:** Compare proposal mtime against `tasks_locked` timestamp in state. If proposal older → warn "Proposal stale, re-edit recommended" (allow `--force` override).

### 3f. Generate Task Assignment Matrix
Per `docs/kpi/KPI_Sprint_Planning_Template.md` Part 3 structure:
- Task ID, description, P-level, TP, mds, Assignee, Week target, Dependencies

### 3g. Generate Weekly Sequencing (v1.5 — auto-compute planned_finish)
4 buckets w1–w4 with AP/EP milestones (uses `ep_monthly_capacity`, NOT cumulative):
- w1: 25% ep_monthly_capacity
- w2: 50% ep_monthly_capacity
- w3: 80% ep_monthly_capacity
- w4: 100% ep_monthly_capacity

Assign tasks to weeks prioritizing: blockers first, high-TP items early, balance per DEV capacity.

**Auto-compute `planned_finish` per task (v1.5, Phase 02):**
```
for each task assigned to week W (1..4):
  bucket_start = first_day_of_period + (W-1) * 7 days
  planned_finish = advance bucket_start forward to next Friday
                   (skip [ORG] non-working days from docs/kpi/calendar-2026.md if present)
  write task.planned_finish to task register
```
PM may override per task during §3e confirm. Required for TQ=1.2 reachability.

### 3h. Compute Bug Fix Budget

```
total_dev_mds = Σ(task.mds for all planned tasks)
bug_fix_budget_days = total_dev_mds × 0.08   # target <10% per SM_KPI
```

Warn if `bug_fix_budget_days < 3` (suspiciously low) or `> 15` (plan may be over-loaded).

### 3i. Output Sprint Plan (v1.5 Phase 07 — 8 sections complete)

Write `plans/reports/sprint_plan_{period}.md` using `docs/kpi/KPI_Sprint_Planning_Template.md` structure expanded with 5 new sections:

**§1 Project info + coefficients** (existing)
**§2 Capacity per DEV + EP formula** (existing, v1.5 split monthly vs cumulative)
**§3.1 Task Assignment Matrix** (existing)

**§3.2 Workload Utilization Table** (NEW v1.5):
- Per `templates/kpi-workload-utilization-template.md`
- Compute `tp_assigned`, `utilization_pct`, status (🟢/🟡/🟠/🔴)
- Anti-pattern: > 100% blocks lock; < 80% warn; Senior < 70% while Junior > 95% warn

**§4 Weekly Sequencing** (existing)

**§5.1 Quality Gates** (NEW v1.5):
- Per `templates/kpi-quality-gates-template.md`
- Gate 1-4: DEV self-test → Peer review → Tester → Pre-UAT T-7d
- Gate 2 default assignee: highest-level Senior ≠ task assignee (decision Q7.1); PM may override per task

**§5.2 Bug Fix Budget** (existing)

**§6 Risk Register** (NEW v1.5):
- Invoke existing `--risk` mode programmatically
- Embed top-5 risks (likelihood × impact prioritized)
- Fallback if `--risk` produces nothing: use template "Schedule risk / Scope CR risk / DEV capacity risk / UAT date slip / External dep risk" placeholders

**§7 Pre-Start Checklist** (NEW v1.5):
- Per `templates/kpi-pre-start-checklist-template.md`
- 4 sub-sections: KPI / Technical / Quality / Communication
- Block sprint start if < 80% checked per section

**§8 KPI Forecast at Plan Time** (NEW v1.5):
- Compute `forecast_mp_pm = ep_monthly_capacity × S × C × R × Q_target`
- Label "At-plan forecast (assume on-track)"; distinct from Mode 48 live forecast
- Compare vs `pm_monthly_target` → display projected gap

### 3j. Save State File (v1.5)
Resolve `project_slug` per kpi-standards-loader.md §Load Sequence step 3a.
Write `docs/pm-ba-kpi-state-{project_slug}-{YYYYMM}.md` per kpi-standards-loader.md schema with:
- `schema_version: "1.5"`
- `ep_monthly_capacity`, `ep_monthly_capacity_original` (immutable, set ONCE here at lock — Pattern D inflation denominator), `ep_cumulative_through_period`
- `ap_period`, `ap_cumulative`
- `project_history_ref[]`, `aggregate_cache{}`
- `project_slug` echo for self-documentation
- DO NOT emit `ep_final` (v1.5.1 — deprecated; read-path only for v1.4 fallback)

### 3k. Update Document Status
Write/update `docs/pm-ba-document-status.md`:
```
KPI[{project_slug}]: kpi_active=true, project_slug={slug}, period={period},
                    state_file=docs/pm-ba-kpi-state-{slug}-{YYYYMM}.md,
                    schema_version=1.5
```

### 3l. Add Bug Fix Days Column
Check `docs/pm-ba-master-task-list.md` for `Bug Fix Days` column.
- If absent: append column header to table; fill existing rows with `0`.
- If present: skip (idempotent).

### 3l-bis. Master Task-List KPI Lock (Phase 10 v1.5 / RT-3 correction v1.6)
After `--confirm` lock, set `docs/pm-ba-master-task-list.md` frontmatter:
```yaml
kpi_locked: {period}
kpi_locked_slug: {project_slug}
kpi_locked_at: {today}
```

**Lock enforcement (RT-3):** The pre-mutation lock check applies ONLY to `09-mode-meeting` (`--meeting-post` action routing that writes to master-task-list). No other mode currently mutates the master-task-list in a way that requires the smart prompt (modes 11, 12, 16, 22 do not apply). The lock check in `09-mode-meeting` is:
```
Read master-task-list frontmatter.kpi_locked
IF kpi_locked == current_period:
  AskUserQuestion:
    question: "Task list locked for KPI sprint {period}. Action?"
    options:
      [Skip mutation, log warning]
      [Unlock via --kpi-unlock + retry]
      [Open --cr for scope change]
```

### 3m. Journal Entry
Invoke `/ck:journal` after successful completion.

---

## 4. Outputs

| File | Purpose |
|------|---------|
| `plans/reports/sprint_plan_{period}.md` | Sprint planning document (KPI_Sprint_Planning_Template-compliant) |
| `docs/pm-ba-kpi-state-{project_slug}-{YYYYMM}.md` | Authoritative period state (v1.5 — slug-prefixed). Slug-less form is v1.4 legacy fallback only. |
| `docs/pm-ba-document-status.md` | Updated KPI pointer |
| `docs/pm-ba-master-task-list.md` | `Bug Fix Days` column appended (if absent) |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Lowballing EP | ep_monthly_capacity / monthly_target_sum < 0.50 | Block: "Likely lowballing — EP ({val}) << total team target ({val}). Review." |
| Ineligible P-level | Assignee DEV level cannot do assigned P | Block row until PM overrides with justification |
| Over-utilization (per DEV) | DEV's assigned TP / capacity > 100% | **Block** sprint lock; PM must rebalance OR --force with justification (Phase 07) |
| Under-utilization (per DEV) | DEV's assigned TP / capacity < 80% | Warn: "{name} under-assigned at {pct}% of capacity" (Phase 07) |
| Senior idle imbalance | Senior util < 70% AND any Junior util > 95% | Warn — likely poor assignment (Phase 07) |
| Re-run same period | State file exists without `--force` | Block: "State for {period} exists. Use --force to overwrite." |
| Pending CRs unresolved | ep_history_pending count > 0 at sprint lock | Warn: "{n} pending CRs unresolved. Recommend --kpi-track to review first." (Phase 03) |

---

## 6. End-of-Mode Hooks

- `/ck:journal`: YES — entry includes period, EP_final, team size, task count
- Suggest next: `"Run /pm-ba --daily mỗi ngày để track AP delta. /pm-ba --kpi-track mỗi cuối tuần."`
