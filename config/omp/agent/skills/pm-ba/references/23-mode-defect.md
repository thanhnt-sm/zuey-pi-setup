# Mode: --defect — Defect Triage (Business/BA Perspective)

## 1. Trigger

- Flag: `--defect`
- Natural language: "triage defect", "phân loại lỗi", "BA review defect", "lỗi có phải bug không", "defect triage"

---

## 2. Required Input

| Source | Description |
|--------|-------------|
| File path OR inline description | Defect list (QA export, Jira, or manual) |

If no input, call `AskUserQuestion`:
```
1. File defect list hoặc paste danh sách (ID, mô tả, bước reproduce)?
2. Version/sprint nào phát sinh lỗi?
3. Nguồn: QA nội bộ, UAT Party A, hay production?
```

---

## 3. Defect Classification Schema

| Severity | Definition | SLA Fix |
|----------|-----------|---------|
| P1 Critical | System down, data loss, security | < 4h |
| P2 Major | Core function broken, no workaround | < 1 business day |
| P3 Minor | Non-critical, workaround exists | Next sprint |

| Type | Definition |
|------|-----------|
| Blocker | Prevents testing/go-live entirely |
| Major | Significant impact, degraded function |
| Minor | Edge-case or cosmetic impact |
| Trivial | UI inconsistency, text typo |

---

## 4. Workflow Steps

### Step 4a — Ingest
- Read defect file or parse inline list
- Read `docs/pm-ba-document-status.md` → current phase (UAT/production/regression)
- Read `docs/pm-traceability-matrix.md` → FR/AC register for traceability lookup
- Read `docs/pm-change-request-log.md` → check if any defect is an unregistered CR

### Step 4b — BA Classification via /ck:sequential-thinking
```
Defects: [DEFECT_LIST — ID, description, steps, environment]

Per defect, analyze:

Bước 1 — Real Bug vs Misunderstood Requirement:
  REAL BUG: sai theo AC đã ký duyệt
  NOT A BUG: đúng AC, Party A hiểu sai — document rejection
  SCOPE GAP: chức năng chưa đặc tả → cần CR
  ENVIRONMENT: chỉ xảy ra trên test env

Bước 2 — Traceability: Defect [ID] → AC-XXX (FR-YYY)
Bước 3 — Severity: P1/P2/P3 + Type + rationale (1 câu)
Bước 4 — Workaround (mô tả cụ thể hoặc "No workaround — fix required")
Bước 5 — Recommendation: Fix ngay / Next sprint / Reject (lý do) / CR required

Output: VN, 1 row per defect
```

### Step 4c — Ambiguous Cases via /ck:ask
For edge cases only:
```
Defect [ID]: [DESCRIPTION] | AC reference: [AC-XXX]
Current vs expected behavior: [DETAIL]
→ Bug thật hay misunderstood? Severity? Recommendation?
```

### Step 4d — Produce Triage Report
Create `plans/reports/pm-{date}-defect-triage.md` using `templates/tpl-defect-triage.md`.

Include: per-defect decision table, summary by severity × BA decision, P1 items highlighted with SLA, CR-candidate items listed separately, rejected items with AC reference (traceability protection).

### Step 4e — Present Summary
```
Defect Triage — [DATE]: [N] total
P1: [N] | P2: [N] | P3: [N]
Rejected (Not a Bug): [N] | Scope Gap → CR: [N]
Report: plans/reports/pm-{date}-defect-triage.md
```

---

## 5. BA Decision Rules

| Scenario | Decision |
|----------|---------|
| Contradicts signed-off AC | Real Bug — fix |
| Matches AC, user misunderstood | Not a Bug — document with AC ref |
| Feature not in any FR/AC | Scope Gap → raise CR |
| Only on test env, not reproducible | Environment issue — dev investigate |
| Same as existing defect | Duplicate — reference original ID |

---

## 6. Outputs

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-defect-triage.md` | Triage report with BA decisions |

---

## 7. Sub-Skills

| Sub-Skill | When |
|-----------|------|
| `/ck:sequential-thinking` | Step 4b — per-defect classification |
| `/ck:ask` | Step 4c — ambiguous severity edge cases |

---

## 8. State Update

No state file update. If Scope Gap defects found, note: "CR required — use `--cr` next."

## 9. End-of-Mode Hook

Journal: **No.** Defect triage is recurring operational, not a milestone.
