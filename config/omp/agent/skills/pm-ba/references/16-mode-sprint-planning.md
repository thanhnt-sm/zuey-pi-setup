# Mode: Sprint Planning

## 1. Trigger

- Flag: `--sprint`
- Natural language: "sprint planning", "kế hoạch sprint", "plan sprint", "lên sprint"

---

<!-- KPI-START -->
## 1.5 KPI Awareness Pre-Check

Before running standard sprint planning flow:

1. Check if `docs/kpi/SM_KPI.md` exists (KPI integration installed) — per `references/kpi-standards-loader.md` Activation Check
2. If YES → invoke `AskUserQuestion`:
   ```
   Phát hiện KPI integration. Chọn mode:
   A) Dùng --kpi-plan ([ORG] KPI-compliant: P-level, EP, milestones, signal track)
   B) Tiếp tục --sprint thường (legacy: T-shirt sizing)
   ```
   - If A → exit, redirect to mode 47 (`references/47-mode-kpi-plan.md`)
   - If B → continue with KPI-aware enforcement below
3. If NO → continue legacy flow unchanged

## 1.6 KPI-Lite Enforcement (khi tiếp tục với --sprint)

If `docs/kpi/` exists AND user chose to continue with `--sprint`:
- Step 3c sizing prompt MUST include P-level alongside SP (dual taxonomy)
- Load `docs/kpi/kpi-quick-reference.md` Section 2 (P-level table) into estimation context
- Output sprint plan adds optional `P-Level` column to backlog table
- DO NOT compute EP/AP — those are only for full `--kpi-plan` mode
<!-- KPI-END -->

---

## 2. Required Slots

| Slot | Description | Example |
|------|-------------|---------|
| `sprint_number` | Sprint sequence number | "3" |
| `capacity` | Team capacity | "15 person-days" or "40 story points" |
| `team` | Team composition | "2 BE devs, 1 FE dev, 1 BA, 0.5 PM" |
| `sprint_goal` | One-sentence sprint goal | "Hoàn thành module tra cứu khoản vay và API tích hợp CBS" |
| `start_date` | Sprint start date | "YYYY-MM-DD" |
| `end_date` | Sprint end date | "YYYY-MM-DD" |

### AskUserQuestion template:
```
Để lên kế hoạch Sprint [N], cần thông tin:
1. Sprint number?
2. Capacity của team (person-days hoặc story points)?
3. Thành phần team (số lượng mỗi role)?
4. Sprint goal — mục tiêu chính của sprint này?
5. Ngày bắt đầu và kết thúc sprint?
```

---

## 3. Workflow Steps

### Step 3a — Collect Required Slots
Call `AskUserQuestion` with all 6 slots. Do not proceed until all provided.

### Step 3b — Read Available User Stories
- Read `docs/pm-traceability-matrix.md` → extract US items not yet assigned to a sprint (status: Backlog / To Do)
- Read any BA reports in `plans/reports/` for US details and AC
- Check previous sprint plan for carry-over items

### Step 3b1 — Capacity Map Reality Check (Optional)
If `docs/pm-capability-map.md` exists:
- Read § 3 (Capacity Map), filter rows where `Status = BLOCKED` and sprint window overlaps (Week1–Week4)
- For each BLOCKED stakeholder assigned to sprint stories:
  ```
  ⚠️ Capacity Warning: {NAME} BLOCKED {Week N} — {N} SP may be at risk.
  Affected US: [list]. Suggest: reassign to {BACKUP from § 2 Authority Map if applicable}.
  ```
- Adjust effective capacity: subtract BLOCKED person-days from total
- If adjusted capacity < committed SP → flag for Step 3c

### Step 3c — Estimation via /ck:ask
Invoke `/ck:ask` with:
```
Sprint [SPRINT_NUMBER] Planning
Team capacity: [CAPACITY]
Team: [TEAM_COMPOSITION]
Sprint goal: [SPRINT_GOAL]

User Stories available (Backlog):
[US_LIST with IDs, titles, and AC counts]

Thực hiện:

1. T-shirt sizing cho từng US:
   - S (1-3 SP): đơn giản, AC rõ ràng, không dependency phức tạp
   - M (5 SP): moderate complexity, 1-2 dependencies
   - L (8 SP): complex, nhiều AC, cần design/architecture decision
   - XL (13 SP): epic-level, nên split

2. Story point assignment:
   S=3, M=5, L=8, XL=13

3. Technical dependencies giữa các US:
   Format: US-XXX phụ thuộc US-YYY (lý do)

4. Critical path với capacity [CAPACITY]:
   Sequence phải implement để đạt sprint goal

5. Sprint backlog recommendation:
   US nào fit trong capacity, US nào defer sang sprint sau
   Tổng SP ≤ [CAPACITY]
   Đảm bảo sprint goal đạt được

Output: VN language, table format, bao gồm rationale cho mỗi sizing decision
```

### Step 3d — Create Sprint Plan Document
Create `plans/reports/pm-{date}-sprint-{N}-plan.md` using `templates/tpl-sprint-plan.md`.

Populate with:
- Sprint goal from slot
- Sprint backlog table from estimation output
- Daily task breakdown (derive from US tasks: each US → 2-4 daily tasks)
- Definition of Done (standard + sprint-specific)
- Risks & Blockers from risk register (filter for sprint-relevant risks)

### Step 3e — Update Traceability Matrix
In `docs/pm-traceability-matrix.md`:
- For each US assigned to this sprint: update "Sprint" column to `Sprint [N]`
- For deferred US: add note "Deferred from Sprint [N] — [REASON]"

### Step 3f — Journal Entry
Invoke `/ck:journal`:
```
Sprint [N] plan created.
Goal: [SPRINT_GOAL]
Committed: [COUNT] US items, [TOTAL_SP] story points.
Capacity: [CAPACITY]. Team: [TEAM].
Deferred: [COUNT] items to Sprint [N+1].
```

---

## 4. Outputs

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-sprint-{N}-plan.md` | Sprint plan document |
| `docs/pm-traceability-matrix.md` | Updated Sprint column |

---

## 5. Post-Sprint Planning Checklist

Present to user after plan is saved:
```
Sprint [N] plan đã tạo. Checklist:

□ Share sprint plan với team (path: plans/reports/pm-{date}-sprint-{N}-plan.md)
□ Set up daily standup schedule
□ Verify all dependencies from Sprint [N-1] are resolved
□ Confirm test environment available cho sprint
□ [COUNT] US items với tổng [SP] story points committed
□ UAT plan nếu sprint có deliverables cho client: --uat
```
