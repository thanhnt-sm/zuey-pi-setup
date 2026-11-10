# Mode: --raci --capability-map — Capability Map

## Trigger

- Sub-flag: `--raci --capability-map`
- VN: "bản đồ năng lực", "ai biết gì", "capability map", "lịch rảnh team", "chuyên môn stakeholder"
- EN: "capability map", "skills matrix", "expertise map", "team capacity map", "who knows what"

Routing: detected via `--capability-map` sub-flag OR NL match → skip normal `--raci` flow, enter this mode.

---

## Activation Logic

```
IF --capability-map sub-flag present OR NL matches capability-map patterns:
  IF docs/pm-capability-map.md does NOT exist → CREATE mode (Steps 4a–4g full)
  IF docs/pm-capability-map.md exists → REFRESH mode (diff-only on Steps 4c, 4d, 4e)
```

---

## Required Input

| Slot | Source | If Missing |
|------|--------|------------|
| Stakeholder list | `docs/pm-stakeholder-registry.md` or user input | Call `AskUserQuestion` |
| Domain taxonomy | BRD modules or user input | Infer from BRD analysis if exists |
| Capacity blocks | User input (AskUserQuestion Step 4e) | Default: UNKNOWN |

---

## Workflow Steps

### Step 4a — Read State + Existing Artifacts
Read `docs/pm-ba-document-status.md` and `docs/pm-stakeholder-registry.md` (if exists).
If `docs/pm-capability-map.md` exists: read it → REFRESH mode (show diff at end).

### Step 4b — Domain Taxonomy
Derive domain list from BRD analysis (`docs/ba-brd-analysis.md`) if available.
Otherwise call `AskUserQuestion`:
```
Danh sách domain/chuyên môn cần map (vd: Tín dụng, CBS, API, Pháp lý, Vận hành)?
```

### Step 4c — Expertise Authoring (PARALLEL per stakeholder)
Invoke `/ck:ask` in parallel batch (see `references/44-parallel-protocol.md`):
```
Với stakeholder [NAME] ([ROLE], [ORG]):
Đánh giá expertise theo các domains: [DOMAIN_LIST]
Depth scale: 1=Aware | 2=Familiar | 3=Working | 4=Expert | 5=Authoritative
evidence-tier: FACT (confirmed in writing) | INFERRED (role-based) | ASSUMED (no evidence)
Output: row for Expertise Map table
```
Merge results after batch.

### Step 4d — Authority Authoring
Invoke `/ck:sequential-thinking`:
```
Từ RACI matrix (nếu có) và mô tả stakeholder, xác định:
- Decision Types phù hợp với dự án (scope, budget, architecture, sign-off, vendor)
- Authority holder cho mỗi Decision Type (từ RACI R/A columns)
- Backup authority khi primary unavailable
- Scope Limit (VD: "CR ≤ 200M VND", "không cần Board approval")
evidence-tier: FACT nếu từ hợp đồng/ký kết | INFERRED từ RACI | ASSUMED nếu chưa xác nhận
```

### Step 4e — Capacity Authoring
Call `AskUserQuestion` for each stakeholder:
```
Availability của [NAME] trong 4 tuần tới (Week 1–4)?
Options: AVAILABLE | LIMITED (ghi rõ %) | BLOCKED (ghi lý do) | UNKNOWN
```

### Step 4f — Diff & Save
Check for existing map → apply Invariant #9 (collision protocol).
Save `docs/pm-capability-map.md` with schema:

```markdown
---
artifact-type: capability-map
Last-Updated: {YYYY-MM-DD}
maintained-by: PM+BA
project: {project}
staleness-threshold: 30
---

## 1. Expertise Map
| Stakeholder | Role | Org | Domains | Depth (1-5) | evidence-tier | Source |
|-------------|------|-----|---------|-------------|---------------|--------|

## 2. Authority Map
| Decision Type | Authority | Backup | Scope Limit | evidence-tier | Source |
|---------------|-----------|--------|-------------|---------------|--------|

## 3. Capacity Map (rolling 4-week from {date})
| Stakeholder | Week 1 | Week 2 | Week 3 | Week 4 | Status | Notes |
|-------------|--------|--------|--------|--------|--------|-------|

## 4. Change Log
| Date | Editor | Change |
|------|--------|--------|
| {date} | {editor} | Initial creation |
```

### Step 4g — State Update
Update `docs/pm-ba-document-status.md`: capability map path, last updated, stakeholder count.

---

## Read Protocol (Consuming Modes)

Consuming modes read `docs/pm-capability-map.md` **read-only** (NEVER write).
Pattern (same as `42-stakeholder-registry.md`):
```
IF docs/pm-capability-map.md exists:
  Read → extract relevant section (§1 for expertise, §2 for authority, §3 for capacity)
  ELSE skip silently — consuming mode continues without capability data
```

Staleness check: if `Last-Updated` > 30 days → warn (non-blocking):
```
⚠️ Capability map last updated {N} days ago. Consider refreshing: --raci --capability-map
```

---

## Integration Points

| Mode | Section Used | What It Gets |
|------|-------------|--------------|
| `--meeting-pre` | Step 0.4 | Expertise: flag attendees with topic expertise |
| `--cr` | Step 4b1 | Authority: match CR scope → correct approver; flag ASSUMED |
| `--sprint` | Step 3b1 | Capacity: filter BLOCKED stakeholders, adjust capacity |
| `--estimation` | Step 2d1 | Capacity: actual available PD vs calculated |
| `--pm` | Step 6 | Capacity: BLOCKED next 7d → dashboard `Capacity Alert` |
| `--clarify` | Optional | Expertise: suggest who to route Q-XXX to |

---

## Sub-Skills

| Skill | When |
|-------|------|
| `/ck:ask` | Step 4c: parallel expertise authoring per stakeholder |
| `/ck:sequential-thinking` | Step 4d: authority derivation from RACI + contract |

## End-of-Mode Hook

Journal: NO
