# KPI Multi-Project Aggregation

> Cross-project aggregator for TL02/TL03 PMs managing multiple projects.
> Cap N=3 projects per PM (decision A2). Strict slug isolation; no cross-leak.

---

## 1. Purpose

`SM_KPI.md §2.1.3` MP_PM definition: `Σ_i (PP_i × S_i × C_i × R_i × Q_i)` where `i` ranges over projects. Single-project mode under-reports for TL02/TL03 PMs.

This protocol aggregates per-project MP_PM into a PM-level dashboard for `--kpi-pm-summary`.

---

## 2. Inputs

| Field | Source | Notes |
|---|---|---|
| `pm_name` | Loader pm-identity OR CLI `--pm <name>` | Identity to filter on |
| `month` | `--month YYYY-MM` OR auto today | Target reporting period |
| state files | Glob `docs/pm-ba-kpi-state-*-{YYYYMM}.md` | Filter to pm_name match |

---

## 3. Algorithm (v1.5.1 — slug-index efficiency fix)

```python
def aggregate_pm_summary(pm_name, month):
    # Preferred: read slug index from docs/pm-ba-document-status.md
    #   (per loader §"Multi-project pointer in document-status.md")
    # Falls back to wildcard glob if index missing.
    status = read("docs/pm-ba-document-status.md")
    pm_slugs = status.kpi_pointers.filter(pm_name=pm_name).slugs
    
    if pm_slugs:
        # O(this_PM_projects) — slug-strict open
        pm_states = [
            load_state(f"docs/pm-ba-kpi-state-{slug}-{month.replace('-', '')}.md")
            for slug in pm_slugs
            if exists(...)
        ]
    else:
        # Fallback wildcard glob + frontmatter filter
        pattern = f"docs/pm-ba-kpi-state-*-{month.replace('-', '')}.md"
        candidates = glob(pattern)
        pm_states = [s for s in candidates if read_pm_name(s) == pm_name]
        warn("Slug index missing in document-status.md; consider --kpi-track to rebuild pointers.")
    
    if len(pm_states) > 3:
        warn f"Multi-project cap exceeded: PM={pm_name} has {len(pm_states)} active projects (cap=3, decision A2). Aggregating all but flagging."
    
    rows = []
    total_mp_pm = 0
    for state in pm_states:
        pp = compute_pp(state)            # PP per Phase 04 §3h (cumulative)
        s, c, r, q = state.coefficients
        mp_pm_i = pp * s * c * r * q
        rows.append({
            "project": state.project,
            "project_slug": state.project_slug,
            "pp": pp, "s": s, "c": c, "r": r, "q": q,
            "mp_pm": mp_pm_i,
        })
        total_mp_pm += mp_pm_i
    
    pm_target = pm_states[0].pm_monthly_target if pm_states else None
    gap = total_mp_pm - pm_target if pm_target else None
    
    return {
        "pm_name": pm_name, "month": month,
        "projects": rows,
        "total_mp_pm": total_mp_pm,
        "pm_monthly_target": pm_target,
        "gap": gap,
        "status": "✅ đạt" if gap and gap >= 0 else (f"❌ thiếu {abs(gap)} pts" if gap is not None else "—"),
    }
```

---

## 4. Output Schema (--kpi-pm-summary report)

```markdown
# PM Summary — {pm_name} — {month}

## Aggregate
- Total MP_PM: {total_mp_pm}
- pm_monthly_target ({pm_level}): {pm_target}
- Gap: {gap} → {status}

## Per-Project Breakdown

| Project | PP | S | C | R | Q | MP_PM |
|---------|----|---|---|---|---|-------|
| {slug1} | ... | ... | ... | ... | ... | ... |
| {slug2} | ... | ... | ... | ... | ... | ... |

## Anti-Patterns Detected
- Project A and B both Q < 1.0 → coaching gap concentrated this PM
- Project C scope unchanged but PP up 30% → review velocity assumption
```

---

## 5. Performance Soft Limits

| Metric | Target |
|--------|--------|
| Glob + read up to 3 projects × 1 month | ≤ 3s |
| Compute PP per project | ≤ 1s each |
| Render dashboard | ≤ 1s |
| Total --kpi-pm-summary | ≤ 10s |

---

## 6. Slug Isolation Guard

- Each project = distinct slug
- Slug collision (two state files claim same slug) → abort: "Slug collision detected: {slug}. Rename one project."
- Strict equality on slug; never prefix-match (prevents `pvcom-[PROJECT]` matching `pvcom-[PROJECT]-v2`)
- Cap N=3: 4+ projects per PM → warn, still aggregate but flag

---

## 7. Edge Cases

- **PM owns 0 projects** in month → return empty rows, total=0, gap=−target
- **PM owns 1 project** → equivalent to single-project month-end (just routed through aggregator)
- **Project paused** (Phase 10) → skip from aggregate, log "paused projects excluded"
- **Project archived** → exclude from glob (archive dir filtered)
- **Schema mismatch** between projects → migrate each per loader; warn if any still v1.4 after migrate
