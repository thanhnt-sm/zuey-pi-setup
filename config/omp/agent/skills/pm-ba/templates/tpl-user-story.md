---
stakeholder: dev
type: user-story
---
# User Story: US-XXX — [Title]

**Actor:** [Role name — e.g. Cán Bộ Tín Dụng, Kiểm Soát Viên, Khách Hàng]
**Story:** As a [role], I want [action], so that [benefit].
**Priority:** [P1 — Must Have / P2 — Should Have / P3 — Could Have]
**Story Points:** [1 / 2 / 3 / 5 / 8 / 13]
**Module:** [System module name — e.g. Quản Lý Hợp Đồng]
**Linked FR:** [FR-XXX — tên FR ngắn gọn]
**Linked BR:** [BR-XXX — tên BR ngắn gọn; N/A nếu không có]
**Sprint / Iteration:** [Sprint XX / TBD]
**Created:** YYYY-MM-DD

---

## Acceptance Criteria

| AC-ID | Given (Điều kiện) | When (Hành động) | Then (Kết quả mong đợi) | Type | Status |
|-------|------------------|-----------------|------------------------|------|--------|
| AC-XXX | | | | Positive | Open |
| AC-YYY | | | | Negative | Open |
| AC-ZZZ | | | | Edge Case | Open |

> **Hướng dẫn:** Mỗi US cần tối thiểu 2 AC: 1 happy path (Positive) + 1 negative/edge case.
> AC-ID tuần tự và global (không reset theo US).

---

## Screen / UI Reference

| SC-ID | Tên Màn Hình | Phần liên quan |
|-------|-------------|----------------|
| SC-XXX | | |

---

## Notes / Assumptions

- [Ghi chú hoặc assumption quan trọng về US này]
- [Assumption về data, system behavior, hoặc business context]

---

## Out of Scope

- [Điều gì KHÔNG nằm trong phạm vi của US này — rõ ràng để tránh scope creep]
- [Ví dụ: "Không bao gồm export PDF — xem US-YYY"]

---

## Test Hints (for QA)

- [Gợi ý test case quan trọng cần cover]
- [Edge cases đặc biệt cần chú ý]
- [Data setup cần thiết để test]

---

## Dependencies

| Type | ID | Description |
|------|----|-------------|
| Blocked by | US-XXX | [Tại sao bị block] |
| Depends on API | API-XXX | [API cần cho feature này] |
| Depends on data | BR-XXX | [Business rule cần được confirm] |

---

## Change History

| Date | Changed By | Change |
|------|-----------|--------|
| YYYY-MM-DD | [BA Name] | Initial creation |
