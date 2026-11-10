# Mode: --closure — Project Closure

## 1. Trigger

- Flag: `--closure`
- Natural language: "đóng dự án", "project closure", "kết thúc dự án", "closure report", "lessons learned", "bàn giao dự án", "tổng kết dự án"

---

## 2. Required Input

| Slot | Description |
|------|-------------|
| `project_name` | Official project name |
| `go_live_date` | Actual go-live date |
| `sponsor_name` | Name of project sponsor for sign-off form |
| Final docs (optional) | Any additional deliverables outside `docs/` |

Call `AskUserQuestion` if missing:
```
1. Tên dự án chính thức?
2. Ngày go-live thực tế?
3. Tên Sponsor / người ký nghiệm thu?
4. Có tài liệu final nào ngoài docs/ không (path)?
```

---

## 3. Workflow Steps

### Step 3a — Read Full Project State
Auto-read ALL before proceeding:
- `docs/pm-ba-document-status.md` — document inventory, sign-off status
- `docs/pm-risk-register.md` — final risk status
- `docs/pm-change-request-log.md` — CR counts by status
- `docs/pm-traceability-matrix.md` — US completion status
- `docs/pm-signoff-log.md` — sign-off history
- `docs/pm-uat-plan.md` (if exists) — UAT results
- Latest sprint plan — final sprint outcomes

### Step 3b — Deliverables Checklist via /ck:ask
```
Document inventory: [DOC_LIST — ID, name, version, status, location]

Tạo Final Deliverables Checklist:
1. Phân loại: Signed Off / Approved / Draft / Missing
2. Completeness: tài liệu chuẩn nào còn thiếu?
   (BRD, URD, FR, TC, UAT Plan, Training, Deployment Guide, O&M Manual)
3. Archive location: đề xuất cấu trúc thư mục
4. Checklist: [ ] Tên | Version | Status | Location | Owner

Output: VN, markdown checklist format
```

### Step 3c — Lessons Learned via /ck:brainstorm
```
Project context:
[PROJECT_NAME] | Go-live: [DATE] | CRs: [N] | Risks: [N] | Sprints: [N] | US: [N]/[TOTAL]

Brainstorm lessons learned — 5 categories:
1. Requirements: thu thập & quản lý yêu cầu
2. Communication: stakeholder engagement, meeting effectiveness, escalation
3. Technical: architecture decisions, integration, technical debt
4. Process: change management, risk management, sprint cadence
5. Risk: prediction accuracy, surprises, mitigation effectiveness

Format: [Category] | [What happened] | [Impact] | [Recommendation for next project]
Output: VN, actionable insights
```

### Step 3d — Knowledge Transfer Plan
Build from document inventory:
```
Tài liệu → Người nhận → Deadline → Hình thức bàn giao
Training sessions: user groups, modules, owners
System access handover: admin vs read-only roles, cutover date
```

### Step 3e — Produce Closure Documents
**Closure Report** → `docs/pm-closure-report.md` using `templates/tpl-closure-report.md`:
- Executive summary (outcome vs original objectives)
- Final deliverables checklist (Step 3b)
- Sign-off log summary, CR log summary, risk final status
- KT plan (Step 3d)
- Sponsor sign-off form (name, date, signature line)

**Lessons Learned** → `docs/pm-lessons-learned.md` using `templates/tpl-lessons-learned.md`:
- Lessons by category (Step 3c)
- Top 3 recommendations for next project
- Process improvements to adopt immediately

### Step 3f — Update State File
```
Project Status: CLOSED | Closure Date: [TODAY] | Go-Live: [GO_LIVE_DATE]
Closure Report: docs/pm-closure-report.md
Lessons Learned: docs/pm-lessons-learned.md
Final Sign-off: Pending sponsor signature
```

### Step 3g — Journal Entry (mandatory)
Invoke `/ck:journal`:
```
Project [PROJECT_NAME] closure completed.
Go-live: [GO_LIVE_DATE]. Closure: [TODAY].
Deliverables: [N] produced, [N] signed off.
Lessons learned: [N] items, 5 categories.
Top recommendation: [TOP_LESSON].
KT: [N] handover items by [DATE]. Sign-off form: docs/pm-closure-report.md
```

---

## 4. Outputs

| File | Description |
|------|-------------|
| `docs/pm-closure-report.md` | Closure report + deliverables checklist + sign-off form |
| `docs/pm-lessons-learned.md` | Structured lessons by category |
| `docs/pm-ba-document-status.md` | Updated to CLOSED status |

---

## 5. Sub-Skills

| Sub-Skill | When |
|-----------|------|
| `/ck:ask` | Step 3b — deliverables checklist + completeness |
| `/ck:brainstorm` | Step 3c — lessons learned facilitation |
| `/ck:journal` | Step 3g — mandatory milestone journal entry |

---

## 6. State Update

Written at Step 3f. Sets Project Status = CLOSED (terminal state).

## 7. End-of-Mode Hook

Journal: **Yes — mandatory.** `/ck:journal` at Step 3g, triggered after both closure docs are written and state file updated.
