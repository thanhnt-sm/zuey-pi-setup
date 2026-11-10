---
stakeholder: internal
type: hypercare-plan
---
# Kế Hoạch Hypercare Sau Go-Live

**Dự án:** [Tên dự án]  **Ngày go-live:** YYYY-MM-DD
**Kết thúc hypercare:** YYYY-MM-DD  **PM:** [Tên PM]  **Trưởng nhóm kỹ thuật:** [Tên Tech Lead]

---

## A. Lịch Trình Hypercare

| Tuần | Tần suất kiểm tra | Người thực hiện | Kênh báo cáo | Ghi chú |
|:----:|:----------------:|----------------|-------------|---------|
| Tuần 1 | Hàng ngày | [Tên — Dev/BA] | [Teams/Email] | Giám sát chặt |
| Tuần 2 | Hàng ngày | [Tên — Dev/BA] | [Teams/Email] | |
| Tuần 3 | 2 lần/tuần | [Tên] | [Teams/Email] | |
| Tuần 4 | 1 lần/tuần | [Tên] | [Teams/Email] | Chuyển sang BAU |

---

## B. Ma Trận Leo Thang Sự Cố

| Mức độ | Thời gian phản hồi | Người tiếp nhận đầu tiên | Leo thang tới | Kênh liên hệ |
|:------:|:-----------------:|------------------------|--------------|-------------|
| P1 — Critical | 15 phút | [Tên On-call Dev] | [Tech Lead → PM → Sponsor] | Hotline + Teams |
| P2 — Major | 2 giờ | [Tên Support] | [Dev Lead → PM] | Teams + Email |
| P3 — Minor | 1 ngày làm việc | [Tên Support] | [Dev Lead] | Email/Ticket |

---

## C. Danh Sách Theo Dõi Sự Cố

| Incident-ID | Ngày | Mô tả | Mức độ | Trạng thái | Giải pháp | Thời gian giải quyết |
|-------------|------|-------|:------:|:----------:|----------|:-------------------:|
| INC-001 | YYYY-MM-DD | [Mô tả sự cố] | P1 | Đã xử lý | [Giải pháp] | [X giờ] |
| INC-002 | YYYY-MM-DD | [Mô tả sự cố] | P2 | Đang xử lý | — | — |

---

## D. Chỉ Số Theo Dõi Hàng Ngày

| Chỉ số | Mục tiêu | [Ngày 1] | [Ngày 2] | [Ngày 3] | Ghi chú |
|--------|:--------:|:--------:|:--------:|:--------:|---------|
| Số người dùng hoạt động | [X users] | | | | |
| Số giao dịch/ngày | [X TXN] | | | | |
| Tỉ lệ lỗi (error rate) | < [X]% | | | | |
| SLA uptime | >= [X]% | | | | |
| Thời gian phản hồi TB | < [X]ms | | | | |

---

## E. Tiêu Chí Kết Thúc Hypercare

- [ ] Không có sự cố P1/P2 trong 5 ngày làm việc liên tiếp
- [ ] Error rate dưới ngưỡng cho phép ([X]%) trong 1 tuần
- [ ] Uptime đạt SLA cam kết ([X]%) trong toàn bộ kỳ hypercare
- [ ] Tất cả sự cố mở đã được giải quyết hoặc có workaround chính thức
- [ ] Đội vận hành (BAU) đã tiếp nhận tài liệu và quy trình xử lý
- [ ] Khách hàng ký xác nhận kết thúc hypercare
