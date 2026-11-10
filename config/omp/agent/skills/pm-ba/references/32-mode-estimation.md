# Mode: --estimation — Effort Estimation

## Purpose

Produce dual-track effort estimates (T-shirt sizing + story points) for a US list or feature scope, including team capacity calculation, risk buffer, and velocity baseline if sprint history exists.

## Trigger Phrases

- Flag: `--estimation`
- VN: "ước lượng effort", "estimate story point", "ước tính công sức", "sizing", "estimate sprint"
- EN: "effort estimation", "story point estimation", "t-shirt sizing", "capacity planning"

---

## 1. Required Input

| Slot | Description | Example |
|------|-------------|---------|
| `us_list` | User stories to estimate | From backlog state or user-pasted list |
| `team` | Team composition | "2 BE, 1 FE, 1 BA, 0.5 PM" |
| `sprint_days` | Working days per sprint | `10` |
| `allocation` | Average allocation % per person | `80%` |
| `team_maturity` | New team or established | "new" / "established" |

If any slot missing, call `AskUserQuestion`:
```
Để ước lượng effort, cần:
1. Danh sách US cần estimate (có thể paste trực tiếp hoặc dùng backlog)?
2. Thành phần team (số lượng mỗi role)?
3. Sprint length (số ngày làm việc)?
4. Allocation trung bình mỗi người (% thời gian cho dự án)?
5. Team mới hay đã làm việc cùng nhau từ trước?
```

---

## 2. Workflow Steps

### Step 2a — Read State
Read `docs/pm-ba-document-status.md` → identify approved US source document.
Read `docs/pm-traceability-matrix.md` → extract US list with IDs, titles, AC counts, priorities.
Check `plans/reports/pm-*-sprint-*-plan.md` → if sprint history exists, extract velocity data.

### Step 2b — Complexity Analysis via /ck:sequential-thinking
Invoke `/ck:sequential-thinking` with US list:
```
Phân tích complexity cho từng US:
1. Số lượng AC (nhiều AC = phức tạp hơn)
2. Dependencies: US phụ thuộc US khác không?
3. Technical complexity: UI only / API + DB / integration với hệ thống ngoài / migration
4. Domain complexity: nghiệp vụ đơn giản / có rule phức tạp / regulatory requirement
5. Ambiguity: AC rõ ràng hay còn nhiều câu hỏi mở?

Output: complexity score (Low/Medium/High/Very High) và lý do cho mỗi US
```

### Step 2c — T-Shirt Sizing + Story Points via /ck:ask
Invoke `/ck:ask` with US list + complexity output:
```
T-shirt sizing calibration (project-standard):
- XS: ≤ 4h | AC ≤ 2, UI change only, no DB
- S: 4–8h | AC 2–4, simple CRUD, 1 table
- M: 1–2 days | AC 4–6, API + DB, moderate logic
- L: 2–4 days | AC 6+, integration, complex rules
- XL: > 4 days → should split into smaller US

Story points (Fibonacci):
- 1 = XS, 2 = XS+, 3 = S, 5 = M, 8 = L, 13 = XL (flag for splitting)

Cho từng US:
| US-ID | Title | Size | SP | Complexity Notes | Key Dependencies | Recommended Sprint |

Tổng SP, phân bổ theo module, cảnh báo US nào nên split.
Output: VN language, table format
```

<!-- KPI-START -->
### Step 2c-bis — P-Level Sizing (khi docs/kpi/ tồn tại)

If `docs/kpi/SM_KPI.md` exists (activation per `references/kpi-standards-loader.md`):
1. Load `docs/kpi/kpi-quick-reference.md` Section 2 (P-level taxonomy) + Section 3 (DEV eligibility)
2. For each US, output BOTH:
   - T-shirt + SP (existing taxonomy — keep for backward compat)
   - P-level (P1-P7) + TP + estimated mds
3. Add columns to estimation table: `| P-Level | TP | mds |`
4. Eligibility cross-check: if proposed DEV level cannot do P-level → flag in `Notes` column
5. Use P-level as PRIMARY taxonomy when output feeds into `--kpi-plan` downstream

### Step 2c-bis Output Note
Add to artifact frontmatter: `taxonomy: p-level-primary` (signals to `--kpi-plan` that TP values are pre-classified).
<!-- KPI-END -->

### Step 2d — Capacity Calculation
Calculate team capacity:
```
Capacity per sprint =
  SUM(headcount per role × sprint_days × allocation%)

Example:
  2 BE × 10 days × 80% = 16 person-days
  1 FE × 10 days × 80% = 8 person-days
  1 BA × 10 days × 60% = 6 person-days (BA allocation lower — meetings/docs)
  Total = 30 person-days

Convert to SP: use calibration reference (1 person-day = X SP from team baseline or default 1:1)
```

### Step 2d1 — Capacity Map Cross-Check (Optional)
If `docs/pm-capability-map.md` exists:
- Read § 3 (Capacity Map), calculate actual available person-days for sprint window
- Compare: `actual_PD` vs `calculated_capacity` from Step 2d
- If `actual_PD < calculated_capacity × 0.85` (>15% shortfall):
  ```
  ⚠️ Capacity shortfall: actual {N} PD available vs {N} PD calculated ({N}% gap).
  Cause: {BLOCKED/LIMITED stakeholders listed}. Adjust sprint scope or add buffer.
  ```
- Pass adjusted capacity to Step 2e risk buffer calculation

### Step 2e — Risk Buffer via /ck:brainstorm
Invoke `/ck:brainstorm` for risk buffer reasoning:
```
Đề xuất risk buffer dựa trên:
- Team maturity: new team → 20% buffer | established → 15%
- Technical unknowns: integration với legacy system, new technology
- Requirement stability: nhiều CR gần đây → tăng buffer
- Environmental risks: test environment instability

Output: buffer % được đề xuất + reasoning, total SP budget sau buffer
```

### Step 2f — Velocity Baseline (if sprint history exists)
If previous sprint plans found in state:
- Calculate average SP completed per sprint (actual vs committed)
- Calculate velocity range (min/max/average)
- Project number of sprints needed: total SP / average velocity

If no history: note "Velocity baseline will be established after Sprint 1."

### Step 2g — Save Artifact
Create `plans/reports/pm-{date}-estimation-table.md` using `templates/tpl-estimation-table.md`.

Sections: Capacity Calculation | Estimation Table | Risk Buffer | Velocity Baseline | Sprint Projection.

### Step 2h — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: estimation
Last Run Date: [TODAY]
Estimation Table: plans/reports/pm-{date}-estimation-table.md
Total SP estimated: [N] | Buffer: [N]% | Sprint projection: [N] sprints
```

---

## 3. Output Artifacts

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-estimation-table.md` | Full estimation with capacity and buffer |

Template: `templates/tpl-estimation-table.md`

---

## 4. Stakeholder

PM (sprint planning), project sponsor (timeline/budget alignment)

## 5. Sub-Skills

| Skill | When |
|-------|------|
| `/ck:sequential-thinking` | Step 2b: complexity analysis per US |
| `/ck:ask` | Step 2c: T-shirt sizing + story point assignment table |
| `/ck:brainstorm` | Step 2e: risk buffer percentage reasoning |

## 6. State Update

```
Last Mode Run: estimation
Estimation Table: plans/reports/pm-{date}-estimation-table.md
Total SP: [N] | Capacity: [N] SP/sprint | Buffer: [N]%
Sprint projection: [N] sprints to complete backlog
```

## 7. End-of-Mode Hook

Journal: NO
