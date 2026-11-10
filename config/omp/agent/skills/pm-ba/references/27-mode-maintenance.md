# Mode: --maintenance — Maintenance & Operations

## 1. Trigger

- Flag: `--maintenance [period]`
- Natural language: "báo cáo SLA", "maintenance report", "SLA tháng này", "tổng hợp incident", "enhancement request", "vận hành tháng", "bảo trì hệ thống"

---

## 2. Required Input

| Slot | Description | Example |
|------|-------------|---------|
| `period` | Reporting period | "2025-03" or "2025-Q1" |
| `sla_targets` | SLA thresholds (contract or state file) | "Uptime: 99.5%, P1: 4h, P2: 8h" |
| Incident data | File path or inline list | `plans/raw/incidents-march.md` |
| Enhancement requests | File path or inline (optional) | `plans/raw/enhancements-q1.md` |

Call `AskUserQuestion` if missing:
```
1. Kỳ báo cáo (YYYY-MM hoặc YYYY-QN)?
2. SLA targets theo hợp đồng (uptime %, response time P1/P2/P3)?
3. File incidents hoặc paste (ID, date, severity, description, response time, resolution time)?
4. File enhancement requests (nếu có)?
```

---

## 3. SLA Framework

| Metric | Default Target |
|--------|---------------|
| System Uptime | ≥ 99.5% |
| P1 Response | ≤ 4 hours |
| P1 Resolution | ≤ 8 hours |
| P2 Response | ≤ 8 hours |
| P2 Resolution | ≤ 2 business days |
| P3 Resolution | Next sprint |

```
SLA Compliance % = (Incidents meeting SLA / Total) × 100
Uptime % = (Period minutes − Downtime minutes) / Period minutes × 100
```

Override defaults if user provides contract SLA targets.

---

## 4. Workflow Steps

### Step 4a — Read Context
Auto-read:
- `docs/pm-ba-document-status.md` → phase, stored SLA targets
- `docs/pm-hypercare-plan.md` (if exists) → transition criteria, previous issue register
- `docs/pm-hypercare-issue-register.md` → carry-over open issues

### Step 4b — Incident Aggregation via /ck:sequential-thinking
```
Incidents for [PERIOD]: [INCIDENT_LIST — ID, date, severity, description, response/resolution time, module]
SLA Targets: [SLA_TARGETS]

Bước 1 — Count by severity: P1/P2/P3 + total
Bước 2 — SLA Compliance per tier:
  P1: [N met]/[N total] = [%]% | P2: [%]% | P3: [%]% | Overall: [%]%
Bước 3 — Root cause clustering:
  Categories: Config error / Code defect / Data issue / External dependency / User error / Infrastructure
  Largest category = focus area for prevention
Bước 4 — Trend vs previous period: count up/down, SLA improving/declining, recurring incidents
Bước 5 — Top 3 risks for next period based on trends

Output: VN, tables with all percentages calculated
```

### Step 4c — Enhancement Request Intake via /ck:ask
If ER data provided:
```
ERs received in [PERIOD]: [ER_LIST — source, description, requestor, date]

Per ER:
1. Assign ER-ID: ER-[PERIOD]-001, ER-[PERIOD]-002, ...
2. Source: Party A / Internal / Dev
3. Priority: P1 (critical gap) / P2 (high value) / P3 (nice-to-have)
4. Effort: Low (< 2d) / Medium (2–5d) / High (> 5d)
5. Status: New / In Queue / In Sprint / Done / Rejected
6. Notes: dependencies, related FR, rejection rationale

Recommend sprint assignment by priority + effort.
Output: VN, ER register table
```

### Step 4d — Update ER Queue
Maintain `docs/pm-maintenance-er-queue.md` (create if not exists):
```
| ER-ID | Period | Source | Description | Priority | Effort | Status | Sprint Target | Notes |
```
Append new ERs; update completed ERs to Done + sprint number.

### Step 4e — Produce SLA Report
Create `plans/reports/pm-{period}-maintenance-sla.md` using `templates/tpl-maintenance-sla.md`.

Include: period summary (date range, uptime %), SLA compliance table per tier, incident breakdown by severity × root cause, top 3 recurring issues + prevention recommendations, trend vs previous period, ER queue summary (new/in-sprint/done/pending), risks for next period, SLA penalty/credit if applicable.

### Step 4f — Present Summary
```
Maintenance Report [PERIOD]:
Uptime: [%]% (Target: [%]%)
SLA Compliance: [%]% — P1: [%]% | P2: [%]% | P3: [%]%
Incidents: [N] total — P1: [N] | P2: [N] | P3: [N]
Top root cause: [CATEGORY] ([N] incidents)
ER Queue: [N] new | [N] in sprint | [N] done
[GREEN/AMBER/RED] — [1-sentence assessment]
Report: plans/reports/pm-{period}-maintenance-sla.md
```

### Step 4g — Update State File
```
Last Mode Run: maintenance | Last Run Date: [TODAY]
Maintenance Period: [PERIOD]
SLA Report: plans/reports/pm-{period}-maintenance-sla.md
SLA Compliance: [%]% (P1: [%]%, P2: [%]%, P3: [%]%)
Open ER Queue: [N] items pending
Next Action: Review ER queue for --sprint | if SLA < 90% 2 periods → --status sponsor
```

---

## 5. Outputs

| File | Description |
|------|-------------|
| `plans/reports/pm-{period}-maintenance-sla.md` | Monthly/quarterly SLA compliance report |
| `docs/pm-maintenance-er-queue.md` | Living enhancement request queue |
| `docs/pm-ba-document-status.md` | Updated SLA metrics + ER count |

---

## 6. Sub-Skills

| Sub-Skill | When |
|-----------|------|
| `/ck:sequential-thinking` | Step 4b — incident aggregation, SLA calc, trend analysis |
| `/ck:ask` | Step 4c — ER intake and prioritization |

---

## 7. State Update

Written at Step 4g. Includes SLA compliance %, open ER count, and report path.

## 8. End-of-Mode Hook

Journal: **No.** Maintenance reporting is recurring operational, not a milestone event.
Escalation rule: SLA compliance < 90% for 2 consecutive periods → recommend `--status sponsor`.
