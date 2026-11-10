# Mode: --hypercare — Post-Launch Hypercare Management

## 1. Trigger

- Flag: `--hypercare`
- Natural language: "hypercare", "sau go-live", "post-launch support", "theo dõi sau go-live", "giám sát sau triển khai", "hỗ trợ vận hành"

---

## 2. Required Input

| Slot | Description | Example |
|------|-------------|---------|
| `go_live_date` | Actual go-live date | "2025-03-01" |
| `modules` | Modules in hypercare scope | "Module tra cứu khoản vay, Module phê duyệt" |
| `hypercare_duration` | Total period (default 4 weeks) | "4 weeks" |
| `escalation_contacts` | Names/roles per tier | "Tier 1: Ops; Tier 2: Dev lead; Tier 3: Vendor PM + IT Director" |

Call `AskUserQuestion` if missing:
```
1. Ngày go-live thực tế (YYYY-MM-DD)?
2. Modules/chức năng trong phạm vi hypercare?
3. Thời gian hypercare (mặc định 4 tuần)?
4. Escalation contacts cho 3 tiers?
```

---

## 3. Default Monitoring Schedule

| Period | Frequency | Mode |
|--------|-----------|------|
| Week 1 (D+1–D+7) | Daily | Active monitoring |
| Week 2–4 (D+8–D+28) | Every 2 business days | Stabilization |
| Month 2+ | Weekly | Wind-down |
| Exit | When criteria met | → `--maintenance` |

---

## 4. Workflow Steps

### Step 4a — Read Context
Auto-read:
- `docs/pm-ba-document-status.md` → go-live status, modules in scope
- `docs/pm-uat-plan.md` → P1/P2 scenarios as production monitoring baseline
- `docs/pm-risk-register.md` → transfer post-launch risks to watch list

### Step 4b — Build Hypercare Schedule via /ck:plan
```
Go-live: [GO_LIVE_DATE] | Modules: [MODULES] | Duration: [DURATION]

Tạo lịch hypercare với checkpoint dates:

Week 1 Daily (D+1 to D+7):
  09:00: check error logs, issue count, transaction volume
  17:00: end-of-day summary to stakeholders
  Threshold: error rate > 1% → escalate Tier 2 immediately

Week 2-4 Every-2-days:
  Check: cumulative issues, SLA compliance, adoption rate

Month 2+ Weekly:
  Adoption metrics + ER queue review + exit criteria assessment

Output: VN, calendar table tính từ [GO_LIVE_DATE]
```

### Step 4c — Escalation Protocol via /ck:ask
```
Contacts: [ESCALATION_CONTACTS] | Modules: [MODULES]

Tier 1 — Operations (tự xử lý):
  Scope: user error, data entry, UI questions
  SLA: < 30 min response | Escalate if: not resolved in 2h, or multiple users affected

Tier 2 — Development Team:
  Scope: bug fix, config error, data correction
  SLA: P1 < 4h, P2 < 1 business day | Escalate if: system down > 2h, data integrity issue

Tier 3 — Vendor + Management:
  Scope: critical failure, vendor SLA breach, security incident
  SLA: immediate < 1h

Output: VN, decision tree + contact matrix
```

### Step 4d — Issue Triage Register
Create `docs/pm-hypercare-issue-register.md` (living document):
```
| Issue-ID | Date | Reporter | Module | Description | Severity | Status | Tier | Resolution | Closed |
```
Severity: P1 (production down/data error/security) / P2 (degraded, workaround) / P3 (minor UX/ER)

### Step 4e — Adoption Metrics Table

| Metric | Target | Source |
|--------|--------|--------|
| Active users/day | ≥ [N] by D+7 | System log |
| Transaction volume | ≥ baseline | System report |
| Error rate | < 1% | Error log |
| Support tickets/day | Declining trend | Issue register |

Targets populated from user-provided data or left as `[TBD — fill from contract/baseline]`.

### Step 4f — Transition-Out Criteria
Hypercare ends when ALL met (5 consecutive business days):
- [ ] Error rate < 0.5%
- [ ] No P1 issues in last 7 days
- [ ] Active users meet adoption target
- [ ] Open P2 queue < 3 items
- [ ] Tier 1 can handle all issues independently
- [ ] Stakeholders confirm transition to `--maintenance`

### Step 4g — Produce Hypercare Plan
Create `docs/pm-hypercare-plan.md` using `templates/tpl-hypercare-plan.md`.
Include: schedule, escalation protocol + contact matrix, issue register link, adoption metrics + targets, transition-out criteria, communication cadence.

### Step 4h — Update State File
```
Last Mode Run: hypercare | Last Run Date: [TODAY]
Project Phase: Hypercare | Hypercare Start: [GO_LIVE_DATE]
Hypercare Plan: docs/pm-hypercare-plan.md
Issue Register: docs/pm-hypercare-issue-register.md
Next Action: Daily check D+1 to D+7 → --maintenance when criteria met
```

---

## 5. Outputs

| File | Description |
|------|-------------|
| `docs/pm-hypercare-plan.md` | Full hypercare plan |
| `docs/pm-hypercare-issue-register.md` | Living issue triage register |
| `docs/pm-ba-document-status.md` | Updated to Hypercare phase |

---

## 6. Sub-Skills

| Sub-Skill | When |
|-----------|------|
| `/ck:plan` | Step 4b — hypercare schedule with checkpoint dates |
| `/ck:ask` | Step 4c — escalation protocol design |

---

## 7. State Update

Written at Step 4h. Sets phase = Hypercare, links plan and issue register.

## 8. End-of-Mode Hook

Journal: **No.** Hypercare setup is operational, not a deliverable milestone.
Note: when transition-out criteria met → user runs `--maintenance` to change phase.
