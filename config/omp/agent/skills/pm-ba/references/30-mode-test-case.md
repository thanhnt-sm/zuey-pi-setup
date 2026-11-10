# Mode: --test-case — SIT/Business Test Cases

## Purpose

Derive structured test cases from Acceptance Criteria using Given/When/Then format. Distinguishes SIT scope (technical integration) from UAT scope (business validation). Maintains full traceability: TC-ID → AC-ID → US-ID.

## Trigger Phrases

- Flag: `--test-case`
- VN: "tạo test case", "viết test case", "kịch bản kiểm thử", "SIT test case", "test case nghiệp vụ"
- EN: "test cases", "SIT test cases", "generate test cases", "test case register"

---

## 1. Required Input

| Source | Description |
|--------|-------------|
| Acceptance Criteria list | From `docs/pm-traceability-matrix.md` OR user-provided US/AC list |
| Test scope | SIT only / UAT only / both |
| SIT entry criteria | What dev sign-off or build stability condition applies |

If AC list not available in state file, call `AskUserQuestion`:
```
Để tạo test case, cần:
1. Danh sách US và AC cần viết test case (có thể paste trực tiếp)?
2. Phạm vi kiểm thử: SIT / UAT / cả hai?
3. Điều kiện đầu vào cho SIT (dev sign-off? build stable? test env ready?)?
```

---

## 2. Workflow Steps

### Step 2a — Read State
Read `docs/pm-ba-document-status.md` → confirm AC source documents.
Read `docs/pm-traceability-matrix.md` → extract all US + AC items with IDs.
Note existing TC-IDs if any (to avoid duplication).

### Step 2b — AC Extraction + Coverage Analysis via /ck:sequential-thinking
Invoke `/ck:sequential-thinking` with full AC list:
```
Phân tích coverage:
1. Group AC theo business process / module
2. Identify AC có thể combine thành 1 TC vs AC cần nhiều TC (positive + negative)
3. Identify AC không rõ ràng (cần clarification trước khi viết TC)
4. Phân loại: AC nào thuộc SIT scope (kiểm thử tích hợp kỹ thuật) vs UAT scope (nghiệp vụ)
   SIT: API response, data persistence, system integration, error codes
   UAT: business flow completion, data correctness từ góc nhìn người dùng
```

### Step 2c — Edge Case Generation via /ck:brainstorm
Invoke `/ck:brainstorm` for each business process group:
```
Với nhóm AC [GROUP_NAME], brainstorm edge cases:
- Boundary values (giá trị biên)
- Negative scenarios (input sai, quyền không đủ, trạng thái không hợp lệ)
- Concurrency scenarios (nếu áp dụng)
- Data dependency scenarios (record chưa tồn tại, đã bị xóa, trạng thái trung gian)
Output: danh sách kịch bản bổ sung cần cover trong TC
```

### Step 2d — TC Generation via /ck:ask
Invoke `/ck:ask` with AC list + edge cases:
```
Từ danh sách AC và edge cases sau, tạo test case register:

Format mỗi TC:
- TC-ID: TC-[module]-[sequence] (e.g. TC-LOAN-001)
- US-ID: [linked US]
- AC-ID: [linked AC]
- Scenario: [mô tả ngắn kịch bản]
- Given: [precondition — trạng thái hệ thống và dữ liệu ban đầu]
- When: [hành động thực hiện — ai làm gì]
- Then: [kết quả mong đợi — cụ thể, có thể đo lường]
- Test Data: [dữ liệu cụ thể cần chuẩn bị]
- Expected Result: [output rõ ràng — message, status, data change]
- Scope: SIT hoặc UAT
- Priority: P1 / P2 / P3

Lưu ý:
- Mỗi AC phải có ít nhất 1 positive TC
- AC P1 phải có ít nhất 1 negative TC
- TC phải đủ cụ thể để người kiểm thử không cần đọc thêm tài liệu khác

Output: VN language, table format
```

### Step 2e — SIT Entry Criteria Definition
Document SIT entry criteria:
- Development of all in-scope US completed (dev sign-off required)
- Unit tests pass with coverage >= X% (fill from project standard)
- Build deployed to test environment successfully
- Test data prepared and loaded
- API documentation available for SIT team

### Step 2f — Save Artifact
Create `plans/reports/pm-{date}-test-case-register.md` using `templates/tpl-test-case-register.md`.

Include sections: SIT Entry Criteria | TC Register table | Coverage Summary | Test Data Requirements.

### Step 2g — Update Traceability Matrix (Invariant)
In `docs/pm-traceability-matrix.md`:
- Add "TC-ID" column if not present
- For each new TC: link TC-ID → AC-ID → US-ID row
- Add "SIT/UAT" flag column
This step is MANDATORY — traceability invariant 7.

### Step 2h — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: test-case
Last Run Date: [TODAY]
Test Case Register: plans/reports/pm-{date}-test-case-register.md | [TC_COUNT] TCs
Traceability: TC-ID column updated in pm-traceability-matrix.md
```

---

## 3. Output Artifacts

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-test-case-register.md` | Full TC register with SIT/UAT scope |
| `docs/pm-traceability-matrix.md` | TC-ID column linked (invariant update) |

Template: `templates/tpl-test-case-register.md`

---

## 4. Stakeholder

QA team (SIT execution), dev team (test data prep), client/Party A (UAT scope review)

## 5. Sub-Skills

| Skill | When |
|-------|------|
| `/ck:sequential-thinking` | Step 2b: coverage analysis, SIT vs UAT classification |
| `/ck:brainstorm` | Step 2c: edge cases and negative scenarios per business process |
| `/ck:ask` | Step 2d: TC generation in Given/When/Then format |

## 6. State Update

```
Last Mode Run: test-case
Test Case Register: plans/reports/pm-{date}-test-case-register.md
TC count: [N] SIT + [N] UAT
Traceability updated: TC-ID column in pm-traceability-matrix.md
```

## 7. End-of-Mode Hook

Journal: NO
