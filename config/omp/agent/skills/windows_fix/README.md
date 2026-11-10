# Thư Viện Tìm & Fix Lỗi Windows

Nơi tích lũy **mọi ca điều tra và khắc phục lỗi Windows** (laptop/desktop) để tái sử
dụng. Mỗi sự cố được đóng gói thành 1 thư mục trong `cases/` gồm script chẩn đoán,
script fix và báo cáo nguyên nhân.

## Khi gặp lỗi mới → bắt đầu ở đâu
1. Đọc `SKILL.md` (chỉ mục + phương pháp luận chung).
2. Xem `cases/` có ca nào trùng triệu chứng chưa → dùng lại script ca đó.
3. Nếu là lỗi mới → điều tra theo phương pháp luận, rồi đóng gói thành ca mới.

## Danh mục ca hiện có
| Ca | Triệu chứng |
|---|---|
| `cases/treo-ngu-sau-modern-standby/` | Máy treo/ngủ sâu khi idle, đèn nguồn nhấp nháy, không đánh thức, phải giữ nút nguồn tắt |
| `cases/terminal-nhay-watchdog/` | Cửa sổ Terminal/PowerShell nhấp nháy bật-tắt liên tục (do scheduled task) |

## Dùng nhanh ca treo/ngủ sâu (phổ biến nhất)
```powershell
cd "<local-workspace>"
powershell -ExecutionPolicy Bypass -File ".\scripts\1-chan-doan.ps1"        # chẩn đoán
powershell -ExecutionPolicy Bypass -File ".\scripts\2-fix-tat-modern-standby.ps1"  # fix -> reboot
powershell -ExecutionPolicy Bypass -File ".\scripts\4-kiem-chung-theo-doi.ps1"     # kiểm chứng
```

## An toàn
- Script **chẩn đoán** chỉ đọc, không đổi gì.
- Script **fix/hoàn tác** tự xin quyền Admin (UAC) và có đường lùi.
- Không tự ý commit/đổi cấu hình hệ thống ngoài phạm vi script.
