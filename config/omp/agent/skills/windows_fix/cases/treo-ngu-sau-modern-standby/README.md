# Tìm & Fix Lỗi Windows: Máy Treo / Ngủ Sâu Không Đánh Thức

Bộ công cụ tái sử dụng để **chẩn đoán và khắc phục** lỗi máy tính Windows (nhất là
laptop) bị **treo cứng / ngủ sâu không wake được** khi để idle lâu — phải giữ nút
nguồn tắt khẩn cấp.

> Đúc kết từ ca thật: laptop **Lenovo ThinkBook 14 G5+ ARP (21HY)** treo do **driver
> WiFi MediaTek MT7921 crash trong Modern Standby (S0ix)**.

## Triệu chứng nhận biết
- Để máy lâu không dùng → treo, màn hình đen, bàn phím/chuột không phản hồi.
- **Đèn nguồn nhấp nháy** (breathing) nhưng không đánh thức được.
- Phải **giữ nút nguồn** tắt cứng rồi mở lại mới dùng được.

## Dùng nhanh (3 bước)

```powershell
# B1. CHAN DOAN (khong can admin) - tim nguyen nhan
powershell -ExecutionPolicy Bypass -File ".\scripts\1-chan-doan.ps1"

# B2. FIX BEN VUNG (tu xin UAC) -> SAU DO KHOI DONG LAI MAY
powershell -ExecutionPolicy Bypass -File ".\scripts\2-fix-tat-modern-standby.ps1"
#   (them -EnableHibernate neu muon bat ngu dong lam luoi an toan khi het pin)

# B3. (Sau reboot) KIEM CHUNG
powershell -ExecutionPolicy Bypass -File ".\scripts\4-kiem-chung-theo-doi.ps1"
```

Nếu chẩn đoán chỉ ra **driver WiFi** là thủ phạm → cập nhật driver để chữa gốc:
```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\3-cap-nhat-driver-bios.ps1"
```

Muốn quay lại như cũ:
```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\5-hoan-tac.ps1"
```

## Các file
| File | Tác dụng |
|---|---|
| `SKILL.md` | Định nghĩa skill + quy trình tổng quan |
| `scripts/1-chan-doan.ps1` | Chẩn đoán read-only (Event Viewer, powercfg, driver) + kết luận nghi vấn |
| `scripts/2-fix-tat-modern-standby.ps1` | Fix bền vững: tắt Modern Standby + không-ngủ mọi gói nguồn |
| `scripts/3-cap-nhat-driver-bios.ps1` | Cập nhật driver WiFi + BIOS (Lenovo), hỏi xác nhận từng bước |
| `scripts/4-kiem-chung-theo-doi.ps1` | Xác nhận sau fix + theo dõi tái phát |
| `scripts/5-hoan-tac.ps1` | Hoàn tác về cấu hình mặc định |
| `reference/playbook-treo-may-modern-standby.md` | Phương pháp luận đầy đủ + ca thật làm mẫu |

## Lưu ý quan trọng
- **Fix tầng nền tảng (registry)** có thể bị xóa khi **update BIOS / Windows
  feature update lớn**. Sau các lần đó chạy lại `4-kiem-chung-theo-doi.ps1`; nếu
  Modern Standby quay lại thì chạy lại script 2.
- Nếu **không bật Hibernate**, để máy 24/7 thì **cắm sạc liên tục**.
- Phần "tự động tải" của script driver/BIOS tối ưu cho **Lenovo**; máy hãng khác
  dùng phương thức "mở web" hoặc "cài từ file" trong script đó.
- Tắt Modern Standby = mất tính năng "instant on" + nhận thông báo khi ngủ. Với
  máy dùng như workstation 24/7 thì đây là đánh đổi chấp nhận được.
