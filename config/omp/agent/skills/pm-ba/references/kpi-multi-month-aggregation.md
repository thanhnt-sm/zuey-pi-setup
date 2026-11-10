# KPI Multi-Month Aggregation Protocol

> Shared aggregation algorithm for AP cumulative + EP cumulative across periods.
> Invoked by: `--kpi-plan` (compute initial cumulative), `--kpi-track` (refresh aggregate cache).
> Invariant 19 honored — kpi-state is sole authority; aggregation is read-only over historical states.

---

## 1. Purpose

`SM_KPI.md §2.1.3` defines AP as **cumulative-month-to-date AND cumulative-project-from-start**. From month 2 onward, ignoring carry-over makes PP/MP_PM signals diverge from spec. This protocol restores correct cumulative semantics.

**Two distinct EP values must coexist** (Phase 01 decision):

| Field | Semantics | Used By |
|---|---|---|
| `ep_monthly_capacity` | Capacity × 0.80 × 0.85, THIS month only | AP/EP signal (Mode 48 §3e); milestone targets |
| `ep_cumulative_through_period` | Σ ep_monthly_capacity over project history | PP formula (Mode 48 §3h); MP_PM |

---

## 2. Glob + Filter

```
project_slug = current slug (from CWD or --project-slug)
current_period = today's YYYY-MM

pattern = docs/pm-ba-kpi-state-{project_slug}-*.md
candidates = glob(pattern)
filtered = [c for c in candidates if period_of(c) <= current_period]
filtered.sort(by=period_ascending)
# v1.6 removes 12-month cap; ledger replaces glob for cumulative aggregation (Phase 03)
```

**Strict equality on slug — never prefix match.**
If project_slug = `pvcom-[PROJECT]`, MUST NOT match `pvcom-[PROJECT]-v2`.

**Legacy file handling:**
- Files matching `pm-ba-kpi-state-{YYYYMM}.md` (no slug) → treat as belonging to current project IF no slugged file exists for that period
- On first read, suggest migration: PM rename to slugged form

---

## 3. Aggregate Function (v1.6 — ledger-based)

```python
def read_ledger(state):
    ledger = state.frontmatter.ep_cumulative_ledger
    anchor = state.frontmatter.ep_cumulative_anchor
    assert ledger[0].period == anchor.period, "Anchor mismatch"

    periods_seen = set()
    for row in ledger:
        assert row.period not in periods_seen, "Duplicate period"
        periods_seen.add(row.period)

    current = state.frontmatter.period
    ap_carry_over = sum(r.ap_period or 0 for r in ledger if r.period < current)
    ep_cumulative = sum(r.ep_monthly for r in ledger if r.period <= current)

    if len(ledger) > 12:
        warn(f"Long-project mode: {len(ledger)} periods. Verify MP_PM trends with PD.")

    return {"ap_carry_over": ap_carry_over, "ep_cumulative_through_period": ep_cumulative}
```

---

## 4. Cache Write-Back

After aggregate, write to current state file frontmatter:

```yaml
aggregate_cache:
  refreshed_at: <today ISO>
  ap_carry_over: 183
  ep_cumulative: 367
  source_periods: ["2026-04", "2026-05"]
project_history_ref:
  - period: "2026-04"
    ep_monthly: 183
    ap_period: 183
  - period: "2026-05"
    ep_monthly: 0
    ap_period: 0
```

**Idempotency:** if `aggregate_cache.refreshed_at` < 6h old AND no new state files added → reuse cache, skip recompute.

---

## 5. Downstream Usage

| Mode | EP field | AP field | Formula |
|------|----------|----------|---------|
| `--kpi-plan` weekly milestones | `ep_monthly_capacity` | (target only) | milestone.target_ap = ep_monthly × week_pct |
| `--kpi-track` AP/EP signal | `ep_monthly_capacity` | `ap_period` | signal = ap_period / ep_monthly_capacity |
| `--kpi-track` PP (Mode 48 §3h) | `ep_cumulative_through_period` | `ap_cumulative` | PP = CP × (ap_cumulative / ep_cumulative) |
| `--kpi-track` MP_PM | (uses PP above) | — | MP_PM = PP × S × C × R × Q |

---

## 6. Performance Soft Limits

| Metric | Target |
|--------|--------|
| Glob + read 12 state files | ≤ 3s |
| Aggregate compute | ≤ 1s |
| Cache write-back | ≤ 0.5s |
| Total overhead per --kpi-plan/--kpi-track | ≤ 5s |

Warn (do not fail) when > 5s; v2 may add binary cache.

---

## 7. Test Scenarios (referenced by Phase 12 smoke tests)

1. **3-month happy path:** month 1 plan → AP 100; month 2 plan → ep_cumulative = ep_m1+ep_m2, ap_carry_over=100
2. **Legacy migration:** old `pm-ba-kpi-state-202604.md` (no slug, no new fields) → auto-migrate on read
3. **Cross-project guard:** project slugs A and B both have month-04 files → A read only A, B read only B
4. **12-month cap:** project with 15 months history → only last 12 aggregated
5. **Missing intermediate month:** months 1, 3, 4 (skip 2) → aggregate over present files only, log gap
6. **Stale cache:** cache.refreshed_at > 6h → recompute regardless

---

## 8. Pause Edge Cases (Phase 03 v1.6)

- **Pause action:** Writes a placeholder ledger row `{period, ep_monthly: 0, ap_period: 0, paused: true, paused_reason: "{reason}"}` into `ep_cumulative_ledger`. This preserves ledger continuity without inflating EP/AP.
- **Idempotency (RT-14 fix):** Re-pause for the same period (period already has a paused row in ledger) → no-op; append audit-log entry only. Do NOT write a second placeholder row.
- **Migration:** Existing `pause_history[]` entries are replayed into ledger rows by the loader's Phase 03 migration block (see kpi-standards-loader.md §Legacy Migration). Original `pause_history[]` is preserved until schema_version "1.7" sunset.
- **Resume:** Next `--kpi-plan` invocation appends a new active ledger row for the resumed period; paused placeholder row remains immutable.
- **Project archive:** archived state files moved to `docs/kpi/archive/` → glob excludes archive/
- **First month (no history):** `ap_carry_over=0`, `ep_cumulative=ep_monthly_capacity`, ledger=[]
- **Schema mismatch:** historical state has v1.4 schema → trigger migration before aggregate

---

## 9. Anti-Patterns

- ❌ Cross-project aggregate without slug filter → leak risk
- ❌ Re-aggregate inside loop per task → use cached result
- ❌ Mutate historical state files during aggregate → READ-ONLY over history
- ❌ Skip cache invalidation when state file mutated → set `cache.refreshed_at: null` on every state write
