# KPI Decision Tree Loader

> Inline narrative loader for Decision Trees 1-3 from `docs/kpi/KPI_Action_Playbook.md` (Phase 06 v1.5).
> Loads only the section relevant to current signal — avoids token bloat.
> Used by Mode 48 §3g Action Recommendation.

---

## 1. Trigger → Tree Mapping

| Signal Class | Tree | Playbook Section | Action Set |
|--------------|------|------------------|------------|
| AP/EP < 0.85 (schedule slip) | Decision Tree 1 | §3 | PM-AP-01..07 |
| Bug Fix % > 12% (quality degradation) | Decision Tree 2 | §4 | Q-WARN, Q-DGR, Q-CR |
| DEV TQ < 1.0 (individual coaching) | Decision Tree 3 | §5 | DEV-TQ-01..06, PM-R-02 |

---

## 2. Load Protocol

```python
def load_decision_tree(signal_class):
    """
    Returns narrative block (≤ 500 chars) + action_ids list.
    Lazy load: only the section matching the signal.
    """
    section_anchor = {
        "AP_EP_LOW": "§3 Decision Tree 1",
        "BUG_FIX_HIGH": "§4 Decision Tree 2",
        "DEV_TQ_LOW": "§5 Decision Tree 3",
    }[signal_class]

    # v1.5.1 — STREAMING SCAN (do NOT load full 436-line file):
    #   1. Open file; advance line-by-line until match `^## {section_anchor}`
    #   2. Collect lines until next `^## ` heading (sibling section)
    #   3. Close file
    #   4. Cache extracted section in-memory for this invocation (key = signal_class)
    # Implementation hint: Read tool with offset+limit when anchor line known via Grep -n;
    #                      or Bash `awk` snippet. NEVER read entire file into context.
    content = stream_read_section("docs/kpi/KPI_Action_Playbook.md", section_anchor)

    # Truncate if > 500 chars; keep first paragraph + bullet actions
    if len(content) > 500:
        content = truncate_to_actionable(content)

    return {
        "narrative": content,
        "action_ids": parse_action_ids(content),
        "source_link": f"docs/kpi/KPI_Action_Playbook.md {section_anchor}",
    }
```

---

## 3. Output Format (inline in Mode 48 §3g)

```markdown
### Signal: AP/EP = {value} → Decision Tree 1

{narrative_excerpt}

**Recommended actions (from Library):**
- **PM-AP-01** — Re-prioritize task order ({owner}, {ETA})
- **PM-AP-03** — Daily tracking tightened (preventive)

**Full library:** `docs/kpi/KPI_Action_Library.md` §1
**Source:** `docs/kpi/KPI_Action_Playbook.md` §3
```

---

## 4. Caching

- Cache decision tree sections in-memory per `--kpi-track` invocation
- Invalidate on `--kpi-resync` (when source files change)
- No persistent cache (sections small enough)

---

## 5. Anti-Patterns

- ❌ Load full Playbook (~436 lines) inline → token bloat
- ❌ Render action narrative without link to Library detail → PM can't drill down
- ❌ Mix multiple decision trees in one output → confuses PM. Output separately per signal.

---

## 6. Token Budget

| Component | Max chars |
|-----------|-----------|
| Per signal narrative excerpt | 500 |
| Per signal action list | 300 |
| Per pattern narrative | 600 |
| Total Mode 48 §3g output | ≤ 4000 (= 2-3 signals + 1-2 patterns max) |
