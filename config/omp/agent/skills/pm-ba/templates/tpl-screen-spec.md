---
stakeholder: dev
type: screen-spec
---
# Screen Specification: SC-XXX — [Screen Name]

> **Usage:** One file per screen (or group related screens in one file if they share a module).
> Fill all tables completely. Mark unknowns with `[?]` — these become Q-XXX clarification items.

---

## Overview

| Field | Value |
|-------|-------|
| **Screen ID** | SC-XXX |
| **Vietnamese Name** | [Tên nghiệp vụ đầy đủ — e.g. "Màn hình Đăng ký Hợp đồng Vay"] |
| **English/Code Name** | [e.g. ContractRegistration] |
| **Actor / Role** | [e.g. Cán Bộ Tín Dụng (CBTD)] |
| **Access Condition** | [e.g. "Sau khi đăng nhập, role = CBTD, menu Hợp Đồng > Đăng Ký Mới"] |
| **Parent Screen** | [SC-XXX Tên màn hình cha / Màn hình chính (Dashboard)] |
| **Child Screens** | [SC-YYY, SC-ZZZ — or "None"] |
| **Linked User Story** | US-XXX |
| **Linked FR** | FR-XXX, FR-YYY |
| **Linked URD Section** | Section X.X của [tên file URD] |
| **Module** | [Module name] |
| **Created** | YYYY-MM-DD |
| **Status** | Draft / Review / Approved |

---

## Screen Layout Description

[Mô tả ngắn về layout màn hình: header/body/footer sections, tab structure, modal vs full page, etc.]

```
+------------------------------------------+
| HEADER: [Tiêu đề màn hình]               |
+------------------------------------------+
| SECTION 1: [Tên section]                 |
|   [field 1]    [field 2]    [field 3]    |
|   [field 4]    [field 5]                 |
+------------------------------------------+
| SECTION 2: [Tên section]                 |
|   [table or grid]                        |
+------------------------------------------+
| FOOTER: [Btn 1]  [Btn 2]  [Btn 3]       |
+------------------------------------------+
```

---

## Fields

| # | Field Name (VN) | Field Name (Code) | Type | Required | Validation | Default | Read-Only | Source/Notes |
|---|----------------|-------------------|------|----------|------------|---------|-----------|-------------|
| 1 | | | Text | Y/N | | | Y/N | |
| 2 | | | Number | | | | | |
| 3 | | | Date | | | Today | | |
| 4 | | | Select (Dropdown) | | | | | Values: A, B, C |
| 5 | | | Checkbox | | | | | |
| 6 | | | File Upload | | | | | Max size: XMB, types: |
| 7 | | | Textarea | | | | | Max chars: |

> **Type options:** Text / Number / Decimal / Date / DateTime / Select / Multi-Select / Checkbox / Radio / File / Textarea / Hidden / Computed (read-only calculated)

---

## Actions / Buttons

| # | Button Label (VN) | Action Type | Enabled Condition | Navigate To | Business Rule | Confirmation Dialog | Notes |
|---|------------------|-------------|------------------|-------------|---------------|--------------------|----|
| 1 | Lưu | Submit/Save | Always | — (stay) | BR-XXX | No | |
| 2 | Gửi duyệt | Submit + Workflow | Form valid + status = Draft | SC-XXX | BR-YYY | Yes: "Xác nhận gửi duyệt?" | |
| 3 | Hủy | Cancel/Navigate | Always | SC-XXX (parent) | | No | Prompt if unsaved changes |
| 4 | Tìm kiếm | Search/Filter | Always | — (reload) | | No | |
| 5 | Xuất Excel | Export | Results > 0 | — (download) | | No | |

---

## Error Messages

| Trigger (Field/Action) | Error Message (Vietnamese) | Display Type | BR / Validation |
|------------------------|---------------------------|--------------|-----------------|
| [Field Name] — empty | "[Field name] là bắt buộc" | Inline (below field) | Required |
| [Field Name] — invalid format | "[Field name] không đúng định dạng [format]" | Inline | Format |
| [Field Name] — out of range | "[Field name] phải nằm trong khoảng [min] đến [max]" | Inline | Range |
| [Button] — business rule fail | "[Thông báo lỗi nghiệp vụ đầy đủ]" | Toast / Modal | BR-XXX |
| Session timeout | "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại." | Modal | System |

---

## Business Rules

- **BR-XXX:** [Mô tả rule áp dụng trên màn hình này]
- **BR-YYY:** [Mô tả rule áp dụng trên màn hình này]
- [Rule không có BR-ID: mô tả rule chưa được đánh số]

---

## Permissions

| Role | View | Create/Edit | Delete | Export | Notes |
|------|------|-------------|--------|--------|-------|
| CBTD | Yes | Yes | No | Yes | |
| KSTT | Yes | No | No | Yes | Read-only |
| Admin | Yes | Yes | Yes | Yes | |

---

## Open Issues (Awaiting Clarification)

| Q-ID | Field/Area | Question (VN) | Impact if Unresolved | Priority |
|------|-----------|--------------|----------------------|---------|
| Q-XXX | [Field name] | [Câu hỏi] | [Không implement được field/rule] | P1/P2/P3 |

---

## Change History

| Date | Changed By | Change |
|------|-----------|--------|
| YYYY-MM-DD | [BA Name] | Initial creation |
