# Mode: UAT Plan

## 1. Trigger

- Flag: `--uat`
- Natural language: "UAT plan", "kế hoạch UAT", "lên UAT", "chuẩn bị UAT"

---

## 2. Required Context (Auto-read)

Before generating UAT plan, read:
- `docs/pm-traceability-matrix.md` → all US + AC items
- Latest sprint plan from `plans/reports/pm-*-sprint-*-plan.md` → scope of what will be tested
- `docs/pm-ba-document-status.md` → check if BRD/URD/FR docs are approved (UAT requires approved docs)

**Pre-check:** If BRD/URD not yet approved, warn user:
```
Cảnh báo: UAT plan được tạo khi tài liệu yêu cầu chưa được ký duyệt.
UAT scenarios có thể cần update sau khi BRD/URD được phê duyệt.
Tiếp tục không?
```

---

## 3. Workflow Steps

### Step 3a — Extract AC List
From traceability matrix, collect all Acceptance Criteria with:
- AC-ID
- Parent US-ID
- AC description
- Priority (P1/P2/P3)
- Business process grouping

### Step 3b — Generate UAT Scenarios via /ck:ask
Invoke `/ck:ask` with:
```
Từ danh sách Acceptance Criteria sau:
[AC_LIST with IDs, descriptions, US parent, priority]

Thực hiện:

1. Group AC theo business process:
   Nhóm các AC liên quan thành test scenarios có ý nghĩa nghiệp vụ

2. Tạo UAT scenarios với format Given-When-Then:
   Given: [precondition / trạng thái hệ thống ban đầu]
   When: [hành động người dùng thực hiện]
   Then: [kết quả mong đợi — measurable, observable]

3. Assign UAT-ID cho mỗi scenario:
   Format: UAT-001, UAT-002, ...

4. Set priority (kế thừa từ US priority):
   P1: Must-pass (block go-live nếu fail)
   P2: Should-pass (acceptable failure rate ≤5%)
   P3: Nice-to-have (can defer to next sprint)

5. Identify entry/exit criteria:
   Entry: điều kiện cần trước khi bắt đầu UAT
   Exit: điều kiện chứng minh UAT passed

6. Estimate test effort (người-giờ) cho mỗi scenario

Output: VN language, table format, sẵn sàng điền vào UAT plan template
```

### Step 3c — Create UAT Plan Document
Create `docs/pm-uat-plan.md` using `templates/tpl-uat-plan.md`.

Populate:
- Scope: from sprint plan (what is in scope for this UAT cycle)
- Entry/Exit criteria from /ck:ask output
- UAT Scenarios table: all UAT-XXX items from /ck:ask
- UAT Schedule: derive from sprint end date (UAT typically starts D+1 after sprint ends)
- Defect management: use project's specified tool

### Step 3d — Update Traceability Matrix
In `docs/pm-traceability-matrix.md`:
- Add UAT column if not present
- Link UAT-XXX → AC-XXX → US-XXX in each row

### Step 3e — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: uat-plan
Last Run Date: [TODAY]
BA-XX | UAT Plan | docs/pm-uat-plan.md | v1.0 | Draft | [TODAY]
Next Recommended Action: Get BA sign-off on UAT plan before sharing with Party A
```

### Step 3f — Journal Entry
Invoke `/ck:journal`:
```
UAT plan created: [COUNT] scenarios across [COUNT] business processes.
P1: [N] | P2: [N] | P3: [N] scenarios.
Entry criteria defined. Exit criteria: 100% P1 pass, <5% P2 fail.
```

---

## 4. UAT Entry Criteria (Standard — customize per project)

All of the following must be true before UAT begins:
- [ ] All US items in scope have development completed
- [ ] Unit tests and integration tests passed
- [ ] Test environment is stable and accessible
- [ ] Test data prepared and loaded
- [ ] BA has verified all Acceptance Criteria are implemented
- [ ] UAT plan signed off by BA and PM
- [ ] UAT participants identified and confirmed (Party A testers)
- [ ] Defect tracking tool accessible to all testers

---

## 5. UAT Exit Criteria (Standard — customize per project)

UAT passes when ALL of the following are true:
- [ ] 100% of P1 scenarios have status PASSED
- [ ] No more than 5% of P2 scenarios have status FAILED
- [ ] No P3 scenarios have CRITICAL defects
- [ ] All Critical and High severity defects resolved or deferred with approval
- [ ] Business Owner (Party A) sign-off received
- [ ] UAT sign-off recorded in `docs/pm-signoff-log.md`

---

## 6. Outputs

| File | Description |
|------|-------------|
| `docs/pm-uat-plan.md` | Full UAT plan with scenarios |
| `docs/pm-traceability-matrix.md` | Updated UAT linkage |
