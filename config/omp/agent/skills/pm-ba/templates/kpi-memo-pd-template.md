---
type: kpi-memo-pd-escalation
trigger: ""                              # signal_class or pattern_id
project_slug: ""
period: "YYYY-MM"
pm_name: ""
generated_at: "YYYY-MM-DDTHH:MM"
generated_by: "Mode 48 §3g auto-gen"
priority: HIGH                           # HIGH | MEDIUM | INFO
status: pending_pd_review                # pending_pd_review | acknowledged | actioned
schema_version: "1.5"
---

# Memo PD — Escalation — {project} — {period}

**To:** Project Director  
**From:** {pm_name}  
**Date:** {generated_at}  
**Subject:** {brief_subject — fill}

---

## 1. Triggering Signal

- **Signal class:** {signal_class — AP_EP_LOW | BUG_FIX_HIGH | DEV_TQ_LOW | PATTERN_E | etc}
- **Pattern matched:** {pattern_id or "N/A"}
- **Week:** {YYYY-MM-Wn}
- **Metrics snapshot:**
  - AP/EP signal: {value}
  - Bug Fix %: {value}
  - TQ avg: {value}
  - {Other relevant}

---

## 2. Current State (1 paragraph)

{Brief project context — fill at generation: scope, current sprint, key recent events}

---

## 3. Recommended Actions

| Action ID | Description | Owner | ETA |
|---|---|---|---|
| {action_id_1} | {desc from Action Library} | {who} | {date} |
| {action_id_2} | ... | ... | ... |

Source library: `docs/kpi/KPI_Action_Library.md`

---

## 4. Resource Ask / Decision Needed

{Specific PD decision required:}
- **Option A:** {description, cost, time}
- **Option B:** {description, cost, time}
- **Option C:** Status quo (do nothing) — risk: {description}

**Recommended:** {Option X — rationale}

---

## 5. Risk if Not Acted On

{1-2 sentences specific to this trigger:}
- Schedule risk: ...
- Quality risk: ...
- Business risk: ...

---

## 6. PD Signoff (PD fills + commits to Git)

```
Approved by:    
Date:           
Decision:       <approve / modify / decline>
Modifications:  <if "modify", describe>
Signature:      <Git commit SHA when this memo is committed>
Conditions:     <optional follow-up constraints>
```

---

## 7. Audit Trail

- Memo created: {generated_at} by Mode 48 §3g
- Linked pattern_history entry: `pattern_history[{week}]`
- State file: `docs/pm-ba-kpi-state-{slug}-{period}.md`
- Expires: {generated_at + 30 days} (auto-move to expired if no PD action)

---

## 8. Next Steps After PD Decision

| If decision is | Then PM runs |
|----------------|--------------|
| Approve | Execute actions listed §3; track in next --kpi-track |
| Modify | Update memo §3 actions; resubmit |
| Decline | Doc reason in memo; archive; consider alternative pattern |
