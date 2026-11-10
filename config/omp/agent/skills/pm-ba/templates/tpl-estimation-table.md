---
stakeholder: sponsor
type: estimation-table
---
# Bảng Ước Tính Effort — [Tên Sprint / Feature / Phase]

**Dự án:** [Tên dự án]  **Ngày ước tính:** [YYYY-MM-DD]
**PM:** [Tên]  **Phương pháp:** T-Shirt Sizing + Story Points (Fibonacci)

---

## Quy Ước Ước Tính

| T-Shirt | Story Points | Mô Tả Độ Phức Tạp | Giờ Quy Đổi (tham khảo) |
|---------|-------------|-------------------|------------------------|
| XS | 1–2 | CRUD đơn giản, 1 màn hình, không có rule phức tạp | 2–8h |
| S | 3 | Logic vừa, 1–2 luồng, ít validation | 8–16h |
| M | 5 | Moderate, 3–4 luồng, integration nhẹ | 16–32h |
| L | 8 | Phức tạp, tích hợp bên ngoài hoặc nhiều màn hình | 32–56h |
| XL | 13 | Rất phức tạp → **cần split** | >56h |

---

## Bảng Ước Tính Chi Tiết

| US-ID | Tên User Story | T-Shirt | SP | Ghi Chú Độ Phức Tạp | Phụ Thuộc | Người Thực Hiện | Sprint |
|-------|---------------|---------|-----|---------------------|-----------|----------------|--------|
| US-[XXX] | [Mô tả ngắn] | M | 5 | [Lý do estimate] | | | Sprint [N] |
| US-[YYY] | | S | 3 | | US-[XXX] | | Sprint [N] |
| US-[ZZZ] | | L | 8 | **Split candidate nếu >8SP** | | | Sprint [N+1] |
| | **Tổng** | | **[X] SP** | | | | |

---

## Kế Hoạch Capacity

| Thành Viên | Vai Trò | Số Ngày Làm Việc | Allocation % | Capacity (SP) |
|-----------|---------|-----------------|-------------|--------------|
| [Tên] | BE Dev | [N] ngày | 100% | [X] SP |
| [Tên] | FE Dev | [N] ngày | 100% | [X] SP |
| [Tên] | QA | [N] ngày | 50% | [X] SP |
| | **Tổng team** | | | **[TOTAL] SP** |

---

## Risk Buffer & Velocity

| Chỉ Số | Giá Trị | Ghi Chú |
|--------|---------|---------|
| Tổng SP đã estimate | [X] SP | |
| Team capacity | [Y] SP | Từ bảng capacity |
| Risk buffer (20%) | [Z] SP | Cho team mới / rủi ro cao |
| SP khuyến nghị cho sprint | [X - buffer] SP | = Team capacity × 80% |
| Velocity sprint trước | [W] SP | N/A nếu sprint đầu |
| Sprint items ngoài phạm vi (defer) | [N] items | US không vừa capacity |

---

## Ghi Chú

- Items có SP ≥ 13: **bắt buộc split** trước khi commit vào sprint
- Velocity sẽ được cập nhật sau mỗi sprint hoàn thành
- Buffer mặc định: 20% (team mới), 15% (team có velocity history)
