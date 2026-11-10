---
stakeholder: qa
type: test-case-register
---
# Danh Sách Test Case Nghiệp Vụ — [Tên Module / Sprint]

**Dự án:** [Tên dự án]  **Module:** [Tên module]  **Ngày tạo:** [YYYY-MM-DD]
**BA phụ trách:** [Tên]  **Loại kiểm thử:** SIT / UAT  **Phiên bản:** [v1.0]

---

## Tiêu Chí Đầu Vào (Entry Criteria)

- [ ] Code đã được dev sign-off và merge vào branch test
- [ ] Build ổn định trên môi trường test
- [ ] Test data đã chuẩn bị đầy đủ
- [ ] AC đã được BA xác nhận và không còn điểm mở

## Tiêu Chí Đầu Ra (Exit Criteria)

- [ ] Tất cả test case P1 passed
- [ ] Không còn bug Blocker hoặc P1 chưa giải quyết
- [ ] Defect rate ≤ [X]% của tổng test case
- [ ] BA sign-off danh sách defect còn lại

---

## Danh Sách Test Case

| TC-ID | US-ID | AC-ID | Mô Tả Kịch Bản | Given | When | Then | Loại (SIT/UAT) | Độ Ưu Tiên | Test Data Cần | Kết Quả Mong Đợi | Trạng Thái |
|-------|-------|-------|----------------|-------|------|------|----------------|------------|---------------|-------------------|------------|
| TC-001 | US-[XXX] | AC-[XXX] | [Mô tả ngắn kịch bản] | [Điều kiện ban đầu] | [Hành động người dùng] | [Kết quả hệ thống] | SIT | P1 | [Dữ liệu test cần có] | [Expected result] | To Do |
| TC-002 | US-[XXX] | AC-[XXX] | | | | | UAT | P1 | | | To Do |
| TC-003 | US-[YYY] | AC-[YYY] | | | | | SIT | P2 | | | To Do |
| | | | **Tổng** | | | | | **[N] TC** | | | |

---

## Yêu Cầu Dữ Liệu Test

| STT | Loại Dữ Liệu | Mô Tả | Số Lượng Cần | Người Chuẩn Bị | Trạng Thái |
|-----|-------------|-------|-------------|----------------|-----------|
| 1 | | | | | Chưa chuẩn bị |
| 2 | | | | | Chưa chuẩn bị |

---

## Ghi Chú BA

- **Phạm vi SIT:** [Mô tả các module/luồng được kiểm thử trong SIT]
- **Phạm vi UAT:** [Mô tả các kịch bản nghiệp vụ khách hàng sẽ kiểm thử]
- **Ngoài phạm vi:** [Gì không được kiểm thử trong giai đoạn này]
- **Rủi ro:** [Rủi ro liên quan đến kiểm thử]
