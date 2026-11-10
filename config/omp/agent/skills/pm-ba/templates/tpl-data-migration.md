---
stakeholder: dev
type: data-migration
---
# Kế Hoạch Di Chuyển Dữ Liệu (Data Migration Plan)

**Dự án:** [Tên dự án]  **Migration scope:** [Mô tả phạm vi ngắn gọn]
**Ngày cutover dự kiến:** YYYY-MM-DD  **Migration Lead:** [Tên kỹ thuật viên phụ trách]

---

## A. Phạm Vi Di Chuyển

| Entity / Table | Hệ thống nguồn | Hệ thống đích | Số bản ghi ước tính | Ghi chú |
|---------------|:--------------:|:-------------:|:-------------------:|---------|
| [Tên bảng/entity] | [DB/API nguồn] | [DB/API đích] | ~[X] rows | |
| [Tên bảng/entity] | [DB/API nguồn] | [DB/API đích] | ~[X] rows | [Lọc theo điều kiện] |
| [Tên bảng/entity] | [DB/API nguồn] | [DB/API đích] | ~[X] rows | |

---

## B. Bảng Ánh Xạ Dữ Liệu (Field Mapping)

| Field nguồn | Kiểu DL nguồn | Field đích | Kiểu DL đích | Quy tắc chuyển đổi | Bắt buộc |
|------------|:------------:|-----------|:------------:|-------------------|:--------:|
| [field_name] | VARCHAR(100) | [dest_field] | NVARCHAR(200) | [Quy tắc transform] | Có |
| [field_name] | DATE | [dest_field] | DATETIME | [Format chuyển đổi] | Có |
| [field_name] | NUMBER | [dest_field] | DECIMAL(18,2) | [Quy tắc làm tròn] | Không |
| [field_name] | — | [dest_field] | VARCHAR(10) | Default = '[giá trị]' | Có |

---

## C. Quy Tắc Kiểm Tra Dữ Liệu (Validation Rules)

| Rule-ID | Mô tả | Câu truy vấn kiểm tra | Điều kiện pass |
|---------|-------|----------------------|---------------|
| VAL-001 | [Mô tả kiểm tra] | `SELECT COUNT(*) FROM [table] WHERE ...` | COUNT = 0 |
| VAL-002 | [Mô tả kiểm tra] | `SELECT COUNT(*) FROM [table] WHERE ...` | COUNT = [expected] |
| VAL-003 | [Mô tả kiểm tra] | `SELECT COUNT(*) FROM [src] = COUNT(*) FROM [dst]` | Hai giá trị bằng nhau |

---

## D. Checklist Trước Cutover

- [ ] Backup toàn bộ dữ liệu nguồn đã hoàn thành và xác nhận restore được?
- [ ] Backup dữ liệu đích (nếu có) đã hoàn thành?
- [ ] Validation script (Section C) đã chạy thử và cho kết quả pass?
- [ ] Rollback plan đã được review và xác nhận bởi Tech Lead?
- [ ] Stakeholder đã được thông báo về maintenance window?
- [ ] Môi trường đích đã sẵn sàng (schema, config, permissions)?
- [ ] Script migration đã được test trên môi trường staging?

---

## E. Bước Thực Hiện Cutover

| Bước | Mô tả | Người thực hiện | Thời gian ước tính |
|:----:|-------|----------------|:-----------------:|
| 1 | [Bước 1] | [Tên] | [X phút] |
| 2 | [Bước 2] | [Tên] | [X phút] |
| 3 | [Chạy migration script] | [Tên] | [X phút] |
| 4 | [Chạy validation script] | [Tên] | [X phút] |
| 5 | [Xác nhận kết quả — QA/BA spot-check] | [Tên] | [X phút] |

---

## F. Tiêu Chí Rollback & Bước Rollback

**Điều kiện kích hoạt rollback:**
- Validation script thất bại cho bất kỳ VAL-ID nào marked "Critical"
- Số bản ghi chênh lệch > [X]% so với ước tính
- [Điều kiện rollback khác]

**Bước rollback:**
1. [Dừng migration script — Người thực hiện]
2. [Restore backup đã chuẩn bị — Người thực hiện]
3. [Xác nhận hệ thống trở về trạng thái ban đầu — Tech Lead]
4. [Thông báo stakeholder về rollback — PM]

---

## G. Báo Cáo Sau Migration (Điền Sau Cutover)

| Hạng mục | Kết quả |
|----------|---------|
| Thời gian bắt đầu thực tế | YYYY-MM-DD HH:MM |
| Thời gian hoàn thành | YYYY-MM-DD HH:MM |
| Tổng bản ghi đã migrate | [X] / [X ước tính] |
| Kết quả validation | Pass / Fail |
| Có rollback không? | Có / Không |
| Vấn đề phát sinh | [Mô tả hoặc "Không có"] |
| Xác nhận hoàn thành bởi | [Tên Tech Lead] |
