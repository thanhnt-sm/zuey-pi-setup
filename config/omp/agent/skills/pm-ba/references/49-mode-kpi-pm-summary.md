# Mode 49 — `--kpi-pm-summary`

> Cross-project MP_PM aggregator for TL02/TL03 PMs (Phase 05 v1.5).
> Reads multiple kpi-state files; computes total MP_PM vs pm_monthly_target.
> READ-ONLY against kpi-state. Authority: `references/kpi-multi-project-aggregation.md`.

---

## 1. Trigger

**Flag:** `--kpi-pm-summary [--month YYYY-MM] [--pm <name>]`

**VN triggers:** "tổng hợp KPI PM", "MP_PM nhiều dự án", "tổng MP của tôi", "dashboard PM"
**EN triggers:** "PM summary KPI", "cross-project MP_PM", "PM dashboard KPI"

---

## 2. Required Slots

| Slot | Description | Default |
|------|-------------|---------|
| `month` | Reporting period YYYY-MM | today's month |
| `pm_name` | PM identity to filter | pm_name from current state OR CLI arg |

---

## 3. Workflow Steps

### 3a. Load Standards
Invoke `references/kpi-standards-loader.md`. Activation log includes `cross-project aggregation` annotation.

### 3b. Aggregate
Invoke `references/kpi-multi-project-aggregation.md` §3 algorithm.

### 3c. Anti-Pattern Detection
Scan aggregate rows for cross-project patterns:
- Multiple projects with `Q < 1.0` → coaching gap concentrated this PM
- Two projects with `bug_fix_pct > 15%` simultaneously → quality bandwidth issue
- One project `PP > target` while another `PP < 50% target` → reallocation needed

### 3d. Output Report
Write `plans/reports/pm-{YYYYMMDD}-kpi-pm-summary-{month}.md` per `kpi-multi-project-aggregation.md §4` schema.

### 3e. Update document-status
Append `last_pm_summary_at: {today}` to `docs/pm-ba-document-status.md`.

---

## 4. Outputs

| File | Purpose |
|------|---------|
| `plans/reports/pm-{date}-kpi-pm-summary-{month}.md` | Aggregate dashboard report |

---

## 5. Anti-Pattern Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Cap exceeded | > 3 active projects for PM | Warn + still aggregate; flag for review |
| Slug collision | Two state files same project_slug | Abort; ask PM to rename |
| Missing pm_name | No state has pm_name set | Abort with "Run --kpi-plan first to set PM identity" |
| Cross-month mix | Period mismatches across states | Skip mismatched, warn |

---

## 6. End-of-Mode Hooks
- `/ck:journal`: NO (read-only report)
- Suggest next: "Per-project drill-down → `/pm-ba --kpi-track --period {month} --project-slug <slug>`"
