# KPI Standards Loader

> Shared activation + load protocol for ALL KPI-aware modes (47, 48, 16, 19, 32, 36).
> Invoke at mode startup before any KPI logic.

---

## Activation Check

```
Is docs/kpi/ directory present AND docs/kpi/SM_KPI.md exists?
  YES → KPI features available — proceed with Load Sequence below
  NO  → Skip all KPI logic; behave per legacy mode (no error)
```

If KPI absent, print once and continue:
```
ℹ️ KPI integration not installed. Skip with /pm-ba --sprint instead, or install:
   copy .docs_plan_kpi/ files to docs/kpi/ per docs/kpi/SOURCE.md
```

> **Drift check scope:** SOURCE.md contains two sections — `## Tracked Files` and `## Intentionally Local`. Drift check iterates `## Tracked Files` rows ONLY; Intentionally Local files are PM-owned and NOT subject to drift detection.

## Activation Log (Phase 04 v1.5 — once per mode invocation)

After Load Sequence completes, print exactly one line:

```
KPI: active period={period} | project={slug} | schema_version={v} | state={file}
```

OR if no active state:
```
KPI: installed | no active period for {project_slug} | run --kpi-plan to start
```

OR if installed-but-no-state and current mode requires state:
```
KPI: installed | no state | mode {mode} requires --kpi-plan first → aborting
```

---

## Load Sequence (v1.5.1 — tiered)

Modes declare which tier they require. **Tier 1** for read-only / view-path; **Tier 2** for writers + signal-computers.

- **Tier 1 (always):** Activation Check, step 2 (quick-reference), step 3 (period), step 3a (slug), step 4 (state file).
- **Tier 2 (writers + --kpi-track/--kpi-plan/--kpi-pm-summary):** Add steps 1 (SOURCE drift), 3b (calendar), 4a (multi-month aggregate), 5 (document-status), 6 (multi-project boundary).
- Read-only viewer modes (`--meeting-*`, `--risk` view, `--daily` no-write path) → Tier 1 only.

```
1. Read docs/kpi/SOURCE.md → drift check
   - Iterate ONLY rows in `## Tracked Files` section; skip `## Intentionally Local` section entirely.
   - For each tracked row: sha256sum source_path, compare to manifest hash
   - Mismatch → print "⚠️ KPI source drift detected for {file}. Manual resync recommended."
   - NEVER auto-overwrite. Continue regardless.

2. Read docs/kpi/kpi-quick-reference.md → primary context
   - Contains: formulas, P-level table, DEV eligibility, TQ table, signal thresholds
   - This is the AI's working KPI reference (not the full SM_KPI.md)

3. Identify current period: YYYY-MM derived from today's date

3a. Resolve project namespace (multi-project support)
    - Default slug: derive from CWD directory name → lowercase kebab-case
    - Override: --project-slug arg if provided
    - All state file globs use this slug

3b. Resolve working_days for period (Phase 10 v1.5 calendar integration)
    - Read docs/kpi/calendar-{year}.md (silently skip if absent)
    - Filter holidays to current period
    - working_days = base_business_days(period) - len(holidays_in_period)
    - Warn if working_days < 18 or > 24 (unusual)
    - PM may override per-member in team_roster (vacation_days take precedence)

4. Read docs/pm-ba-kpi-state-{project_slug}-{period}.md if exists → load state
   - Legacy fallback: also try docs/pm-ba-kpi-state-{period}.md (no slug) → migrate on first read
   - If missing: mark new_period=true, state=null
   - Modes that require state (47=create, 48=read) handle missing state per their own spec

4a. Multi-month aggregate (PHASE 01 v1.5 — see kpi-multi-month-aggregation.md)
    - Glob docs/pm-ba-kpi-state-{project_slug}-*.md (project-scoped, cap last 12 months)
    - Sort by period ascending
    - Aggregate: ap_carry_over = Σ ap_period for periods < current
    - ep_cumulative_through_period = Σ ep_monthly_capacity for periods ≤ current
    - ap_cumulative = ap_carry_over + ap_period (current)
    - Cache aggregate in current state under `aggregate_cache:` (refresh on each --kpi-plan/--kpi-track)

4b. State integrity check (PHASE 04 v1.6)
    - Spawn `python kpi-state-integrity.py {state_file}` → exit 0 OK, exit 1 violation
    - Body hash mismatch → BLOCK with "State integrity violated. Manual edit detected. Run --kpi-unlock or restore from backup."
    - Chain validation failure → BLOCK with "Audit-log chain diverged from prior tail. Escalate to PD."
    - During unlocked window (`unlocked_until > now`) → allow hash drift but log to audit
    - If `quarantined: true` → BLOCK all modes except --kpi-lock --confirm

5. Read docs/pm-ba-document-status.md → check kpi_active flag
   - kpi_active=false or missing → KPI is installed but no active period

6. Project boundary guard
   - Multi-project cap N=3 per PM. Warn if > 3 distinct project slugs glob-matched in last 12 months.
   - NEVER cross-project leak: filename slug filter strict equality, not prefix-match.

7. Read docs/kpi/POLICY_DECISIONS.md → check signoff statuses (v1.6 NEW)
   - Parse §2 Decision Register table rows; read `loader_posture` field from frontmatter
   - For each row with status != "signed":
     IF loader_posture == "WARN" (v1.6.0 default):
       Print: "⚠️ KPI Policy {D-XXX} ({title}) unsigned. v1.6.1 will require signature." (once per session)
       Continue
     IF loader_posture == "BLOCK" (v1.6.1+):
       Critical-only escalation list: {D-004}
       IF decision in critical list AND status != "signed":
         ABORT: "⛔ KPI Policy D-004 (Task Done definition) unsigned. Cannot compute AP credit. Run PD review per docs/kpi/templates/pd-signoff-memo-template.md."
       ELSE:
         Print WARN, continue
   - File missing → log "ℹ️ POLICY_DECISIONS.md not present; legacy v1.5 behavior" (no abort)
```

---

## State File Schema (`docs/pm-ba-kpi-state-{project_slug}-{YYYYMM}.md`)

### YAML Frontmatter

```yaml
---
period: "2026-06"
project: "<Project>"
project_slug: "pvcom-[PROJECT]"        # NEW v1.5 — filename slug + de-dup guard
schema_version: "1.5"                    # NEW v1.5 — migration trigger
protected: true                          # NEW Phase 04 — Invariant 19 enforce; non-whitelisted modes Write-blocked
tasks_locked: true

# EP semantic split (PHASE 01 v1.5) — DO NOT conflate
ep_raw: 271
ep_monthly_capacity: 184                 # capacity × 0.80 × 0.85, THIS month only (for AP/EP signal)
ep_monthly_capacity_original: 184        # IMMUTABLE — set ONCE at Mode 47 sprint lock; Pattern D inflation denominator
ep_cumulative_through_period: 367        # Σ ep_monthly historical + current (for PP formula)
ep_final: 184                            # DEPRECATED v1.5 — alias of ep_monthly_capacity for READ-PATH backward compat only; NOT emitted by new writes (v1.6 will sunset). Sunset: v1.7 read-path removal; see MIGRATION_v1.5.md §ep_final Sunset Roadmap

# AP semantic split (PHASE 01 v1.5)
ap_period: 92                            # AP completed THIS month only
ap_cumulative: 275                       # AP completed from project start (= carry_over + ap_period)

ep_history:
  - timestamp: 2026-06-01T09:00
    value: 184
    reason: "Initial lock"

# Pending CR queue (PHASE 03 v1.5) — append-only by --cr; reviewed by --kpi-track preamble
ep_history_pending:
  - cr_id: "CR-005"
    timestamp: 2026-06-15T14:00
    reason: "Thêm 2 features hồ sơ rủi ro"
    delta: +12
    status: pending_approval         # pending_approval | approved | rejected | expired
    created_by: "PM Nguyễn"
    expires_at: 2026-07-15           # 30-day auto-expire (decision Q3.2)
ep_history_expired: []               # archive expired entries

# Multi-month history (PHASE 01 v1.5) — capped 12 months back
project_history_ref:
  - period: "2026-04"
    ep_monthly: 183
    ap_period: 183
  - period: "2026-05"
    ep_monthly: 0
    ap_period: 0                        # placeholder if missing

# Aggregate cache — refreshed on each --kpi-plan/--kpi-track (PHASE 01 v1.5)
aggregate_cache:
  refreshed_at: 2026-06-01T09:00
  ap_carry_over: 183
  ep_cumulative: 367
  source_periods: ["2026-04", "2026-05"]

coefficients:
  S: 1.1
  C: 1.2
  R: 1.0
  Q_target: 1.0
milestones:
  w1: { target_ap: 46, target_ap_ep: 0.25 }
  w2: { target_ap: 92, target_ap_ep: 0.50 }
  w3: { target_ap: 147, target_ap_ep: 0.80 }
  w4: { target_ap: 184, target_ap_ep: 1.00 }
# PM / TL identity (Phase 05 v1.5)
pm_name: "Nguyễn Văn PM"
pm_level: "TL02"                         # TL01 | TL02 | TL03 (decision A8: PM solo = TL)
pm_monthly_target: 120                   # 100 (TL01), 120 (TL02), 150 (TL03) per quick-ref §4
pm_active_projects: 2                    # cap N=3 per decision A2

team_roster:
  - name: "Nguyễn An"
    level: "Junior02"
    velocity_pts_per_day: 2.25
    monthly_target: 50
    working_days: 22
  - name: "Trần Bình"
    level: "Senior01"
    velocity_pts_per_day: 2.0
    monthly_target: 60
    working_days: 22
bug_fix_budget_days: 8
bug_fix_actual_days: 0

# UAT date cache (PHASE 06 v1.5) — refreshed from docs/pm-uat-schedule.md
uat_date_cache:
  uat_date: 2026-08-15
  uat_end: 2026-08-29
  refreshed_at: 2026-06-01T09:00
  source: "docs/pm-uat-schedule.md"
  status: confirmed                       # confirmed | tentative | slipped | completed

# DEV Coaching Ladder state (PHASE 06 v1.5) — see kpi-coaching-ladder.md
dev_tq_history:
  - dev: "Nguyễn An"
    weekly:
      - week: "2026-06-W1"
        tq_avg: 1.05
        tasks_done: 3
    coaching_status:
      current_step: 0                     # 0..4 (0=healthy)
      action_id: null
      started_at: null
      consecutive_low_weeks: 0
      reset_consecutive_high_weeks: 0
      last_review_at: null

# Pattern trigger history (PHASE 06 v1.5) — see kpi-pattern-trigger.md
pattern_history: []                       # cap at last 12 weeks; older auto-pruned

# Feature Freeze status (Pattern B → UAT-FREEZE-01)
feature_freeze_until: null                # YYYY-MM-DD if active

# Team event log (PHASE 09 v1.5) — append-only, see kpi-team-event-log.md
team_events: []                           # add/remove/level-change/vacation/task-added-mid-sprint

# Replan history (PHASE 09 v1.5)
replan_history: []                        # entries from --kpi-replan; cap last 12 entries, archive older
# Pruning rule (v1.5.1 — review fix): single policy across all history arrays
#   On Phase 10 month-end auto-archive, prune any history array > 52 entries:
#   move oldest entries to docs/kpi/archive/{slug}/history-{YYYY}.md
#   Applies to: team_events, replan_history, pause_history, dev_tq_history[].weekly,
#               weekly_snapshots, task.tq_history. pattern_history capped at 12 weeks.

# Pause state (PHASE 10 v1.5) — see 58-mode-kpi-pause-resume.md
paused: false
paused_at: null
paused_reason: null
paused_by: null
expected_resume: null                     # auto: paused_at + 3 months (decision 10.3)
pause_history: []                         # list of {paused_at, reason, resumed_at}

# Working days resolution (PHASE 10 v1.5) — calendar applied per period
working_days_calendar_source: "docs/kpi/calendar-2026.md"
working_days_holidays_subtracted: 0       # echoed for transparency

last_updated: 2026-06-01T09:00

# v1.6 — State protection (Phase 04)
body_hash: null                          # sha256:{hex} of normalized fenced body; recomputed every atomic write
chain_version: 1                         # audit-log chain version
unlocked_until: null                     # ISO timestamp; set by --kpi-unlock
quarantined: false                       # true if auto-relock detected immutable-field drift

# v1.6 — EP cumulative ledger (Phase 03)
ep_cumulative_anchor:                    # IMMUTABLE — set ONCE at project start
  period: null                           # "YYYY-MM"
  ep_monthly: null
  set_at: null                           # ISO timestamp
  set_by: null                           # PM name
  immutable: true
ep_cumulative_ledger: []                 # append-only [{period, ep_monthly, ap_period, paused?, paused_reason?}]
---
```

### Legacy Migration (auto-applied on first read)

```
IF state file frontmatter has `ep_final` BUT NOT `ep_monthly_capacity`:
  → schema_version: 1.4 detected
  → SET ep_monthly_capacity = ep_final
  → SET ep_cumulative_through_period = ep_final  (single-month assumption)
  → SET ap_period = (current ap from prior weekly_snapshots[-1].AP)
  → SET ap_cumulative = ap_period
  → SET schema_version: "1.5"
  → Log: "Migrated state file {path} from schema 1.4 → 1.5. Backup at {path}.bak"
  → Write .bak before mutating

IF schema_version == "1.5" AND not ep_cumulative_anchor:
  → Apply Phase 03 migration (defensive glob raw state files; see kpi-multi-month-aggregation.md §3)
  → Replay pause_history[] into ledger rows
  → Backup project_history_ref to .deprecated.project_history_ref
  → schema_version: "1.6"

IF schema_version == "1.5" AND tasks[].bug_fix_source missing:
  → SET task.bug_fix_source = "pm_estimate" for all tasks (Phase 02 default)
  → schema_version: "1.6"
```

### Body Markdown

```markdown
## Task Register (v1.5 schema — adds Week, Planned_Finish)

| ID | Task | P | TP | Owner | Week | Planned_Finish | Status | % | Started | Finished | Bug_Fix_Days | TQ |
|----|------|---|----|----|------|---------------|--------|---|---------|----------|--------------|----|
| T-01 | Setup ETL pipeline | P4 | 5 | An | W1 | 2026-06-06 | ✅ Done | 100 | 06-02 | 06-08 | 0.5 | 1.0 |
| T-02 | Tra cứu khoản vay UI | P3 | 3 | Bình | W2 | 2026-06-13 | 🔄 InProgress | 60 | 06-09 | | | |

## Weekly Snapshots (v1.5 — split ap_period vs ap_cumulative)

| Week | AP_period | AP_cumulative | CP_week | AP/EP_signal | TQ_avg | Bug% | Signal |
|------|-----------|---------------|---------|--------------|--------|------|--------|
| W1 | 46 | 229 | 46 | 0.25 | 1.10 | 5% | 🟢 |
```

**Schema notes (v1.5):**
- `Week` column (W1-W4) added — drives planned_finish auto-compute (Friday of bucket)
- `Planned_Finish` column — auto-set by --kpi-plan §3g; PM may override
- `AP_period` (this month) vs `AP_cumulative` (project start) — see kpi-multi-month-aggregation.md
- TQ uses `kpi-tq-computation.md` algorithm (P1 rounding guard + 4-case decision)

---

## Write Protocol (v1.6)

| Mode | Allowed Writes | Cache Invalidation (set null on write) |
|------|---------------|----------------------------------------|
| `--kpi-plan` | Creates new state file. FAIL if exists without `--force`. Writes EP fields, `ep_monthly_capacity_original` (immutable), milestones, team_roster, tasks[] initial. | N/A (new file) |
| `--kpi-plan --confirm <proposal-file>` | Reads proposal → locks tasks[]; sets `tasks_locked: true`. | `aggregate_cache.refreshed_at` |
| `--kpi-track` | Appends `weekly_snapshots[]`; updates tasks[] rows; refreshes `aggregate_cache` (writes new values); preamble reviews `ep_history_pending[]`. | Refreshes cache as part of operation |
| `--daily` | Updates task `pct` and `status` only (Phase 02 v1.5 — finished_at/bug_fix_days/TQ deferred to --kpi-track sweep). | `aggregate_cache.refreshed_at` only if actual diff |
| `--cr` | Appends to `ep_history_pending[]` (Phase 03 v1.5 — append-only). | None (pending, not applied) |
| `--kpi-replan` | Phase 09. Modifies `ep_monthly_capacity` + writes `ep_history[]` + `replan_history[]` (PD signoff if `|delta_pct| > 15%`). NEVER mutates `ep_monthly_capacity_original`. | `aggregate_cache.refreshed_at` |
| `--kpi-team-update` | Phase 09. Modifies `team_roster[]` + `team_events[]`. PD signoff if `|ep_delta_pct| > 15%` (symmetric with replan, decision 9.1 v1.5.1). | `aggregate_cache.refreshed_at` |
| `--kpi-add-task` | Phase 09. Appends `tasks[]` + bumps `ep_monthly_capacity` (NOT original) + `ep_history[]`. | `aggregate_cache.refreshed_at` |
| `--kpi-pause`, `--kpi-resume` | Phase 10. Toggle `paused` + `pause_history[]`. | None |
| `--kpi-coeff-change` | Phase 05. Appends `ep_history_pending[]` only. | None (pending) |
| `--kpi-coeff-approve` | Phase 05/v1.5.1. Unified approver — branches by entry.type (`coeff_delta` → mutate coefficients; `replan` → mutate ep_monthly_capacity + milestones). | `aggregate_cache.refreshed_at` |
| `--kpi-resync` | Phase 10. Updates SOURCE.md sha256 entries (does not touch kpi-state). | N/A |
| `--kpi-decompose --confirm` | Phase 08. Appends subtasks to master-task-list. | N/A (master list, not state) |
| `--kpi-assign --confirm` | Phase 08. Mutates `tasks[].owner`. | None (assignment only) |
| `--kpi-unlock` | Phase 04 v1.6. Sets `unlocked_until` + appends chain audit row. Requires `--tail-anchor sha256:{hex}`. | None |
| `--kpi-lock --confirm` | Phase 04 v1.6. Recomputes body_hash + writes new chain row + clears `quarantined` (if set). | None |
| All other modes | READ-ONLY |  |

**Idempotency rule (Invariant 11):** `--kpi-plan` blocks re-creation of same period state unless `--force` passed.

**Pending CR auto-expire (decision Q3.2):** entries in `ep_history_pending[]` with `expires_at < today` → auto-moved to `ep_history_expired[]` on next `--kpi-track`. Warning printed before expiry.

## Write Protection Enforcement (Phase 04 v1.6 — content-invariant)

Layer-2 enforcement is performed by `pre-write-kpi-state-check.cjs` (content-invariant validator) — NOT a mode-whitelist at write time. The mode-whitelist in the Write Protocol table above is ADVISORY at loader level only.

Content-invariant validator fires on every Write attempt to a kpi-state file:

```
on_write_attempt(state_file, proposed_content):
    1. Body hash check: sha256(normalize(proposed_content.body)) != state.body_hash?
       → If mismatch AND NOT in unlocked window → BLOCK "State integrity violated. Manual edit detected."
       → If mismatch AND in unlocked window → allow, append audit log entry
    2. Ledger append-only: any prior row mutated?
       → BLOCK "Ledger mutation detected. ep_cumulative_ledger is append-only."
    3. Anchor immutability: ep_cumulative_anchor fields changed?
       → BLOCK "ep_cumulative_anchor is immutable after first set."
    4. Chain continuity: new chain_row.prev_hash != current tail hash?
       → BLOCK "Audit-log chain diverged. Escalate to PD."
    5. schema_version monotonic: proposed version < current version?
       → BLOCK "schema_version must not decrease."
    6. If quarantined: true → BLOCK all writes except --kpi-lock --confirm
```

Full spec: `references/kpi-state-protection.md`. Unlock via `--kpi-unlock --tail-anchor sha256:{hex}` (Mode 60).

---

## Pointer in document-status.md

After `--kpi-plan` creates state, write to `docs/pm-ba-document-status.md`:

```
KPI: kpi_active=true, project_slug=pvcom-[PROJECT], period=2026-06,
     state_file=docs/pm-ba-kpi-state-pvcom-[PROJECT]-202606.md,
     schema_version=1.5
```

Multi-project pointer (one row per active project, cap N=3):

```
KPI[pvcom-[PROJECT]]: kpi_active=true, period=2026-06, state_file=...
KPI[pvcom-thaiquoc-loan]: kpi_active=true, period=2026-06, state_file=...
```

---

## Velocity Reference (for EP computation)

Default velocity by DEV level (pts/day). PM can override per member in `--kpi-plan`:

| Level     | Default Velocity (pts/day) |
|-----------|---------------------------|
| Fresher   | 1.75 |
| Junior 01 | 2.00 |
| Junior 02 | 2.25 |
| Junior 03 | 2.50 |
| Senior 01 | 2.00 |
| Senior 02 | 2.25 |
| Senior 03 | 2.50 |

---

## Multi-Month + Multi-Project Rollover (v1.5)

- State file is project-slug + period suffixed: `pm-ba-kpi-state-{project_slug}-{YYYYMM}.md`
  - Example: `pm-ba-kpi-state-pvcom-[PROJECT]-202606.md`
- **Carry-over MANDATORY v1.5** — per SM_KPI §2.1.3 (AP is cumulative-from-start)
- New month = new file; loader auto-aggregates AP across prior periods (cap 12 months)
- Previous month files preserved as historical record + participate in cumulative compute
- `document-status.md` pointer updated to new period on `--kpi-plan`
- See `kpi-multi-month-aggregation.md` for glob + aggregate algorithm
- Multi-project cap N=3 per PM (decision A2); each project = distinct slug
- Project boundary guard: filename slug strict equality, never prefix-match
