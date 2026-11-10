---
stakeholder: dev
type: release-plan
---
# Release Plan — [Release Version]

**Ngày release:** YYYY-MM-DD  **Môi trường:** [UAT / Production]
**PM:** [Tên PM]  **Tech Lead:** [Tên Tech Lead]  **QA Lead:** [Tên QA Lead]

---

## A. Phạm Vi Release (In-Scope)

| Feature / US-ID | Mô tả | Trạng thái QA | Ghi chú |
|----------------|-------|:------------:|---------|
| US-XXX | [Mô tả tính năng] | Passed | |
| US-YYY | [Mô tả tính năng] | Passed | |
| US-ZZZ | [Mô tả tính năng] | Passed | |

---

## B. Phạm Vi Loại Trừ (Deferred)

| Feature / US-ID | Mô tả | Lý do deferral | Release dự kiến |
|----------------|-------|---------------|----------------|
| US-AAA | [Mô tả] | [Lý do] | [Release tiếp theo] |

---

## C. Checklist Trước Release

- [ ] Code freeze đã hoàn thành
- [ ] Regression tests đã pass toàn bộ
- [ ] UAT sign-off đã nhận được từ khách hàng
- [ ] Backup cơ sở dữ liệu đã thực hiện và xác nhận
- [ ] Change window đã xác nhận với stakeholder
- [ ] Rollback plan đã chuẩn bị và review
- [ ] Release notes đã chuẩn bị và gửi khách hàng
- [ ] Đội vận hành đã được thông báo

---

## D. Bước Triển Khai

1. [Bước 1 — Người thực hiện — Thời gian ước tính]
2. [Bước 2 — Người thực hiện — Thời gian ước tính]
3. [Bước 3 — Người thực hiện — Thời gian ước tính]
4. [Bước 4 — Người thực hiện — Thời gian ước tính]
5. [Smoke test sau deploy — QA Lead — X phút]

---

## E. Tiêu Chí Rollback

Thực hiện rollback ngay khi xảy ra một trong các tình huống sau:
- [Điều kiện rollback 1 — ví dụ: smoke test thất bại]
- [Điều kiện rollback 2 — ví dụ: lỗi nghiêm trọng ảnh hưởng > X% giao dịch]
- [Điều kiện rollback 3 — ví dụ: không thể kết nối các hệ thống tích hợp]

---

## F. Bước Rollback

1. [Bước rollback 1 — Người thực hiện — Thời gian ước tính]
2. [Bước rollback 2 — Người thực hiện — Thời gian ước tính]
3. [Bước rollback 3 — Người thực hiện — Thời gian ước tính]
4. [Xác nhận rollback thành công — Tech Lead]

---

## G. Kế Hoạch Liên Lạc

| Giai đoạn | Thông báo tới | Nội dung | Kênh | Người gửi |
|-----------|--------------|---------|------|----------|
| T-24h | [Stakeholders] | Release sắp diễn ra | Email | [PM] |
| Bắt đầu deploy | [IT Ops, QA] | Bắt đầu deploy | Teams | [Tech Lead] |
| Deploy xong | [PM, QA, Client] | Kết quả deploy | Teams + Email | [Tech Lead] |
| Rollback (nếu có) | [PM, Sponsor] | Rollback và lý do | Hotline + Email | [PM] |

---

## H. Kết Quả (Điền Sau Deploy)

**Thời gian bắt đầu thực tế:** ___________  **Thời gian hoàn thành:** ___________
**Kết quả:** [ ] Thành công &nbsp;&nbsp; [ ] Rollback

**Vấn đề phát sinh:** [Mô tả hoặc "Không có"]
**Ghi chú sau deploy:** [Ghi chú của Tech Lead / PM]
