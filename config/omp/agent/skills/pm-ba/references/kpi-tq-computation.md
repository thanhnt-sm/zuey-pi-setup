# KPI TQ Computation Spec

> Shared TQ algorithm — invoked by `--kpi-track` §3d and any mode computing per-task quality.
> Source: `docs/kpi/SM_KPI.md` §2.2.4. v1.5 adds rounding guard + null handling + planned_finish.

---

## 1. Inputs

| Field | Source | Notes |
|---|---|---|
| `task.tp` | Task register, P-level table | Gross TP (no TQ pre-applied) |
| `task.mds` | Task register, P-level table | Dev-day budget per P-level |
| `task.bug_fix_days` | --kpi-track prompt; MAY be null | If null → TQ unresolved |
| `task.finished_at` | --kpi-track or --daily | Date Done |
| `task.planned_finish` | --kpi-plan §3g auto-compute (Friday of week_bucket) | Fallback if missing: Friday of assigned week |

---

## 2. Algorithm (v1.6 — source-aware cap)

```python
def compute_tq(task):
    if task.bug_fix_days is None or getattr(task, 'bug_fix_source', None) == "skipped":
        return 1.0  # fair default

    # P1 rounding guard (Phase 02): tiny bug times for tiny tasks → treat as 0
    if task.mds < 1 and task.bug_fix_days < 0.25:
        bug_fix_days = 0.0
    else:
        bug_fix_days = task.bug_fix_days

    bug_pct  = bug_fix_days / task.mds if task.mds > 0 else 0

    planned  = task.planned_finish or fallback_friday_of_week(task)
    is_late  = task.finished_at > planned
    is_early = task.finished_at < planned

    # 4-case decision per SM_KPI §2.2.4 — priority order matters
    if is_late or bug_pct >= 0.20:
        computed = 0.8
    elif is_early and bug_fix_days == 0:
        computed = 1.2
    elif (not is_late) and bug_pct < 0.10:
        computed = 1.1
    elif (not is_late) and 0.10 <= bug_pct < 0.20:
        computed = 1.0
    else:
        computed = 1.0  # default safety net

    # Source cap (Phase 02 v1.6 — D-005)
    if getattr(task, 'bug_fix_source', 'ticketing') in ("pm_estimate", "skipped"):
        return min(computed, 1.0)

    return computed  # source=ticketing → full 0.8-1.2 range
```

**Ordering note:** `0.8` checked FIRST (worst-case fast exit). `1.2` checked BEFORE `1.1` so early+zero-bugs gets premium reward even when bug_pct < 0.10.

---

## 3. Fallback for missing planned_finish (backward compat)

```python
def fallback_friday_of_week(task):
    # Legacy state files (schema 1.4) lack planned_finish.
    # Assume task was due Friday of its assigned week.
    week_num = task.week or 1
    period_start = parse(state.period + "-01")
    week_offset = (week_num - 1) * 7
    candidate = period_start + timedelta(days=week_offset)
    # Advance to Friday
    while candidate.weekday() != 4:
        candidate += timedelta(days=1)
    return candidate
```

---

## 4. Idempotency

- Re-run on same task with same inputs → same TQ
- TQ never auto-mutates after Done; only `--kpi-track` final sweep can resolve null
- Mutation event always logged to `task.tq_history[]` (audit trail)

---

## 5. Anti-Patterns

- ❌ Skip `bug_fix_days` prompt → null TQ defaults to 1.0 implicitly (LOSS for DEV who actually had 1.1/1.2)
- ❌ Use `task.deadline` instead of `task.planned_finish` (deadline is hard cutoff; planned is target)
- ❌ Apply TQ to AP or CP (gross convention A1 — TQ only at MP_DEV)
- ❌ Compute TQ before task is Done (% < 100)

---

## 6. Edge Cases

| Case | Behavior |
|------|----------|
| `mds = 0` (data error) | bug_pct = 0; return based on schedule only |
| `bug_fix_days < 0` | Clamp to 0; warn data integrity |
| `finished_at` missing | Cannot compute is_late; warn + return None |
| `planned_finish` and fallback both missing | Use period end-of-month as last resort |
| Task reopened (Done → InProgress) | TQ cleared; recompute on next Done |
| `bug_fix_source = skipped` | Return 1.0 (fair default, no reward/penalty — Phase 02 v1.6 D-005) |

---

## 7. Test Vectors (Phase 12 smoke tests)

| TP | mds | bug_fix | source | finished | planned | Expected TQ |
|---|---|---|---|---|---|---|
| 3 | 1.0 | 0 | ticketing | D-2 | D | 1.2 |
| 3 | 1.0 | 0.05 | ticketing | D | D | 1.1 |
| 3 | 1.0 | 0.15 | ticketing | D | D | 1.0 |
| 3 | 1.0 | 0.25 | ticketing | D | D | 0.8 |
| 3 | 1.0 | 0.05 | ticketing | D+1 | D | 0.8 (late) |
| 1 | 0.25 | 0.2 | ticketing | D | D | 1.1 (P1 rounding → bug_fix=0) |
| 5 | 2.0 | null | ticketing | D | D | None (unresolved) |
| 3 | 1.0 | 0 | ticketing | D-2 | D | 1.2 |
| 3 | 1.0 | 0 | pm_estimate | D-2 | D | 1.0 (capped) |
| 3 | 1.0 | 0.5 | skipped | D | D | 1.0 (default) |
