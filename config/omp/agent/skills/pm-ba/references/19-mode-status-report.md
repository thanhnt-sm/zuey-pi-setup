# Mode: Status Report

## 1. Trigger

- Flag: `--status [stakeholder]`
- Natural language: "báo cáo tiến độ", "status report", "progress report", "cập nhật cho bên A"

---

## 2. Stakeholder Detection

If stakeholder not specified after `--status`, call `AskUserQuestion`:
```
Báo cáo tiến độ cho đối tượng nào?

A) client   — Bên A / Khách hàng (VN, formal)
B) vendor   — Bên B / Vendor partner (VN+EN, technical)
C) dev      — Development team (EN/VN, technical detail)
D) sponsor  — Sponsor / Ban lãnh đạo (VN, executive summary)
E) internal — Internal PM/BA team (VN/EN, full detail)
```

---

## 3. Common Data Sources (Always Read First)

Before generating ANY status report, read ALL of:
1. `docs/pm-ba-document-status.md` — overall project state, active blockers
2. `docs/pm-risk-register.md` — current risk landscape (top 3 open risks)
3. Latest sprint plan (`plans/reports/pm-*-sprint-*-plan.md`) — sprint progress
4. `docs/pm-clarification-register.md` — open questions count
5. `docs/pm-signoff-log.md` — pending sign-offs
6. `docs/pm-change-request-log.md` — open CRs

---

## 4. Per-Stakeholder Workflow

### 4.1 `--status client` (Bên A / Khách hàng)
- **Language:** VN formal
- **Template:** `templates/tpl-status-client.md`
- **Tone:** Professional, reassuring, focused on business value delivered
- **Include:** Progress %, milestones, decisions pending from Party A, key risks (non-technical language), next steps
- **Exclude:** Internal team issues, technical debt, vendor relationship details
- **Presentation:** Invoke `/ck:preview --slides` to create slide deck
- **Output:** `plans/reports/pm-{date}-status-client.md`

### 4.2 `--status vendor` (Bên B / Vendor)
- **Language:** VN primary + EN for technical terms
- **Template:** `templates/tpl-status-vendor.md`
- **Tone:** Collaborative, technical, action-oriented
- **Include:** Sprint completion %, open defects, integration status, API readiness, blockers from Party A
- **Exclude:** Executive-level business context (they know it)
- **Visualization:** Mermaid timeline showing sprint milestones
- **Output:** `plans/reports/pm-{date}-status-vendor.md`

### 4.3 `--status dev` (Development Team)
- **Language:** EN/VN mixed (technical terms in EN)
- **Template:** `templates/tpl-status-dev.md`
- **Tone:** Direct, technical, no fluff
- **Include:** Sprint backlog status, blockers, upcoming deadlines, dependency alerts, technical risks, open CRs affecting dev scope
- **Format:** Markdown table format (no presentation needed)
- **Output:** `plans/reports/pm-{date}-status-dev.md`

### 4.4 `--status sponsor` (Sponsor / Ban lãnh đạo)
- **Language:** VN formal, executive summary style
- **Template:** `templates/tpl-status-sponsor.md`
- **Tone:** Concise, strategic, risk-aware, decision-focused
- **Include:** RAG status (Red/Amber/Green), key decisions needed from sponsor, budget/timeline impact, top 2 risks
- **Exclude:** Technical details, day-to-day operations
- **Presentation:** Invoke `/ck:preview --slides` for executive slide deck (≤5 slides)
- **Output:** `plans/reports/pm-{date}-status-sponsor.md`

### 4.5 `--status internal` (Internal PM/BA)
- **Language:** VN/EN mixed
- **Template:** None — use all data sources, full detail, no filter
- **Tone:** Complete, honest, include internal concerns
- **Include:** Everything — all open items, risks, blockers, decisions, CRs, sign-offs, clarifications
- **Format:** Comprehensive markdown report
- **Output:** `plans/reports/pm-{date}-status-internal.md`

---

## 5. Standard Status Sections

Adapt these sections per audience (some sections omitted or simplified for executive/client):

### Overall Progress
```
Tiến độ tổng thể: [X]% (Sprint [N]/[TOTAL], Milestone [M]/[TOTAL])
RAG Status: 🟢 Green / 🟡 Amber / 🔴 Red
Lý do RAG: [1 sentence]
```

### Milestones Completed (Since Last Report)
| Milestone | Ngày Hoàn Thành | Ghi Chú |
|-----------|-----------------|---------|

### Milestones Upcoming (Next 2 Weeks)
| Milestone | Ngày Dự Kiến | Owner | Rủi Ro |
|-----------|-------------|-------|--------|

### Decisions Pending (Requiring Stakeholder Action)
| Quyết Định Cần | Owner | Deadline | Tác Động Nếu Trễ |
|----------------|-------|---------|-----------------|

### Key Risks (Top 3)
| R-ID | Mô Tả | Mức | Mitigation |
|------|-------|-----|-----------|

### Blockers (Critical Path Items)
| Blocker | Owner | Ngày Mở | Tác Động |
|---------|-------|---------|---------|

### Next Steps (Next 2 Weeks)
| Action | Owner | Target Date |
|--------|-------|------------|

---

## 6. Progress Calculation

Calculate overall project progress as weighted average:
```
Documents signed off / Total required documents × 30%
+ US Completed / Total US × 40%
+ Milestones achieved / Total milestones × 30%
= Overall Progress %
```

If traceability matrix not available: use qualitative estimate with note.

---

## 7. Outputs

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-status-{stakeholder}.md` | Status report |
| Slide deck (client/sponsor only) | Generated via /ck:preview --slides |
| Mermaid timeline (vendor only) | Embedded in vendor report |

<!-- KPI-START -->
## KPI Augmentation (Section 3 supplement + Section 5 supplement)

### Additional Data Source (extends Section 3)
7. If `docs/kpi/` exists AND `docs/pm-ba-kpi-state-{current_period}.md` exists → load per `references/kpi-standards-loader.md` Load Sequence → read state + latest weekly snapshot from kpi-state body (Weekly Snapshots table)

### KPI Section (auto-appended when state file exists)

When `docs/pm-ba-kpi-state-{period}.md` exists, append KPI section to ALL stakeholder reports (audience-adjusted detail):

#### For `--status sponsor` / `--status client` (executive level)
```
**KPI Snapshot (Tháng {period})**:
- AP/EP: {ratio} ({signal_emoji})
- Dự báo MP_PM cuối tháng: {mp_forecast} / {target_mp_pm}
- Tình trạng: {🟢/🟡/🟠/🔴} — {one_sentence_reason}
```
Skip detailed numbers; focus on signal + decision needed.

#### For `--status dev` / `--status internal` (full detail)
Embed full Section 1 (Snapshot KPI) + Section 5 (DEV status) from latest weekly report in `plans/reports/pm-*-kpi-week*-{period}.md`.

#### For `--status vendor`
Show AP/EP + sprint completion %; omit DEV-specific MP numbers.

### Backward Compat
If `docs/pm-ba-kpi-state-{period}.md` absent → existing report behavior unchanged. NO KPI section appended.
<!-- KPI-END -->
