---
stakeholder: client
type: uat-plan
---
# Kế Hoạch Kiểm Thử Chấp Nhận (UAT) — [Project Name]

**Phiên bản:** v1.0  **Ngày:** YYYY-MM-DD  **Trạng thái:** Draft / Approved

---

## 1. Thông Tin UAT

| Trường | Nội Dung |
|--------|---------|
| Dự án | [Project Name] |
| Sprint / Phạm vi UAT | Sprint [N] — Module [X] |
| UAT Period | YYYY-MM-DD đến YYYY-MM-DD |
| UAT Coordinator | [Tên BA Lead] |
| UAT Lead (Party A) | [Tên người kiểm thử phía Bên A] |
| Test Environment | [URL / Server name] |
| Defect Tracking | [Jira project / Excel file path] |

---

## 2. Phạm Vi UAT

### Trong Phạm Vi
| STT | Module / Tính năng | US-Ref | Mô tả |
|:---:|-------------------|--------|-------|
| 1 | | | |

### Ngoài Phạm Vi
| STT | Module / Tính năng | Lý Do |
|:---:|-------------------|-------|
| 1 | | Chưa phát triển / Out of scope / Sẽ test riêng |

---

## 3. Điều Kiện Vào (Entry Criteria)

Tất cả điều kiện sau phải đạt trước khi bắt đầu UAT:

- [ ] Tất cả US trong phạm vi đã hoàn thành development
- [ ] Unit tests và integration tests đã passed (báo cáo đính kèm)
- [ ] Test environment sẵn sàng và truy cập được
- [ ] Test data đã chuẩn bị và load xong
- [ ] BA đã verify Acceptance Criteria được implement
- [ ] UAT Plan đã được PM và BA ký duyệt
- [ ] Người tham gia UAT (Bên A) đã xác nhận lịch
- [ ] Hướng dẫn sử dụng / training đã hoàn thành
- [ ] Defect tracking tool sẵn sàng cho tất cả testers
- [ ] Không còn defect Critical hoặc High từ SIT

---

## 4. Điều Kiện Ra (Exit Criteria)

UAT được coi là PASSED khi TẤT CẢ điều kiện sau đạt:

- [ ] 100% UAT scenarios P1 có kết quả PASSED
- [ ] Tối đa 5% UAT scenarios P2 có kết quả FAILED (còn lại PASSED)
- [ ] 0 defects mức Critical hoặc High còn mở
- [ ] Tất cả P3 defects đã được ghi nhận và chấp nhận defer
- [ ] Business Owner (Bên A) ký sign-off UAT
- [ ] UAT summary report được lập và ký duyệt

---

## 5. UAT Scenarios

| UAT-ID | Tên Scenario | Business Process | AC-Ref | US-Ref | Priority | Pre-condition | Steps | Expected Result | Actual Result | Status | Tested By | Ngày Test |
|:------:|------------|:---------------:|:------:|:------:|:--------:|-------------|-------|----------------|:------------:|:------:|:---------:|:---------:|
| UAT-001 | | | AC-XXX | US-XXX | P1 | | 1. ...<br>2. ... | | | Pending | | |
| UAT-002 | | | AC-XXX | US-XXX | P2 | | | | | Pending | | |

**Priority:**
- P1 — Bắt buộc pass (block go-live nếu fail)
- P2 — Nên pass (fail rate ≤5% chấp nhận được)
- P3 — Nice-to-have (có thể defer sang sprint sau)

**Status:** Pending / In Progress / Passed / Failed / Blocked / Skipped

---

## 6. Defect Management

### Quy trình xử lý defect

```
Tìm thấy → Log → Assign cho Dev → Fix → Deploy to test env → Retest → Close
```

| Severity | SLA Fix | SLA Retest |
|----------|:-------:|:----------:|
| Critical | 4h | 4h |
| High | 1 ngày | 1 ngày |
| Medium | 3 ngày | 2 ngày |
| Low | Sprint sau | Sprint sau |

### Defect Log (summary)
Xem chi tiết tại [Jira project / Excel file].

| Defect-ID | UAT-ID | Severity | Mô Tả Ngắn | Status | Ngày Tìm Thấy | Ngày Đóng |
|-----------|:------:|:--------:|-----------|:------:|:------------:|:---------:|
| | | | | | | |

---

## 7. Lịch Trình UAT

| Ngày | Hoạt Động | Người Thực Hiện | Địa Điểm / Link |
|:----:|----------|:---------------:|:---------------:|
| | Kick-off UAT + hướng dẫn | BA + Party A testers | |
| | Testing Day 1 | Party A testers | |
| | Testing Day 2 | Party A testers | |
| | Defect review session | BA + Dev + Party A | |
| | Retest session | Party A testers | |
| | UAT closure meeting | PM + BA + Party A | |

---

## 8. Roles & Responsibilities

| Vai Trò | Người | Trách Nhiệm |
|--------|-------|------------|
| UAT Coordinator (BA) | | Quản lý scenarios, hỗ trợ testers, log defects |
| UAT Lead (Party A) | | Điều phối testing phía Bên A, ký sign-off |
| Business Tester | | Thực hiện test theo scenarios |
| Developer | | Fix defects, deploy fixes |
| PM | | Track progress, escalate blockers |

---

## 9. Sign-off UAT

| Người Phê Duyệt | Tổ Chức | Vai Trò | Bên | Ngày | Chữ Ký / Xác Nhận |
|----------------|---------|--------|:---:|:----:|:----------------:|
| | | Business Owner | A | | |
| | | PM | B | | |

**Kết quả UAT tổng hợp:**
- Tổng scenarios: [N]
- Passed: [N] ([X]%)
- Failed: [N] ([X]%)
- Skipped: [N]
- Critical defects: [N] (Closed: [N])

**Kết luận:** UAT PASSED / UAT FAILED / Conditional Pass (với điều kiện: ...)
