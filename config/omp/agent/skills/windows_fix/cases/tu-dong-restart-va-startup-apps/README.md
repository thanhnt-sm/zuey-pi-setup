# Ca: Tự Động Restart & Startup Apps Không Chạy

## Triệu chứng nhận biết
- Windows tự restart lúc 4:00 AM mỗi Chủ Nhật
- Sau khi khởi động lại, các app cấu hình startup không tự chạy
- Event Viewer ghi: `Kernel-Power 41` (unexpected restart) xuất hiện rải rác
- Event 1074 ghi comment: `TB14G5 weekly maintenance restart`

## Máy ảnh hưởng
- Lenovo ThinkBook 14 G5 (DESKTOP-MTR8FIH), user: thant

## Nguyên nhân gốc rễ

### Nguyên nhân A — Scheduled Task TB14G5_WeeklyRestart (restart có chủ ý)
- **Script gốc**: `02_WindowsOptimize_Thinkbook14G5/01_optimize_all.ps1` tạo task
- **Task**: `TB14G5_WeeklyRestart` — chạy mỗi CN 4:00 AM — `shutdown.exe /r /f /t 60`
- **Trạng thái hiện tại**: Task ĐÃ BỊ XÓA bởi `02_restore_all.ps1`
- Task đã chạy vào: 5/31/2026 và 6/28/2026 trước khi bị xóa

### Nguyên nhân B — Kernel-Power 41 (crash không kiểm soát)
- 3 lần crash trong 30 ngày: 6/4, 6/19, 6/20 (~23:52)
- Không có BugCheck code → không phải BSOD → mất nguồn đột ngột / quá nhiệt
- Cần kiểm tra pin, nhiệt độ, nguồn điện

### Nguyên nhân C — AutoAdminLogon KHÔNG được cấu hình (startup apps)
- Sau restart, Windows dừng ở màn hình đăng nhập, chờ user nhập mật khẩu
- Tất cả HKCU startup apps chỉ chạy SAU KHI user đăng nhập thủ công
- Nếu restart lúc 4AM unattended → sáng dậy apps chưa chạy là ĐÚNG, không phải lỗi

### Nguyên nhân D — Nhiều app bị DISABLE trong StartupApproved
Apps có `StartupApproved byte = 3` (bị TẮT thủ công qua Task Manager):
- LenovoVantage, Edge AutoLaunch, Copilot, Firefox, Docker Desktop, AMDNoiseSuppression

## Trạng thái app startup sau khi đăng nhập

| App | Trạng thái | Ghi chú |
|-----|-----------|---------|
| GoogleDriveFS | ✅ Chạy | |
| OneDrive | ✅ Chạy | |
| UniKey | ✅ Chạy | |
| Teams | ✅ Chạy | |
| Viber | ✅ Chạy | |
| OpenVPN | ✅ Chạy | |
| Parsec | ✅ Chạy | |
| Opera Browser Assistant | ✅ Chạy | |
| AnyDesk | ✅ Chạy | từ Startup Folder |
| Notepad++ | ✅ Chạy | từ Startup Folder |
| Outlook classic | ✅ Chạy | từ Startup Folder |
| Tailscale | ✅ Chạy | từ Common Startup |
| **LenovoVantage** | ❌ Bị tắt | Disable trong Task Manager |
| **Docker Desktop** | ❌ Bị tắt | Disable trong Task Manager |
| **AMDNoiseSuppression** | ❌ Bị tắt | Disable trong Task Manager |
| **Edge AutoLaunch** | ❌ Bị tắt | Disable trong Task Manager |
| **Copilot AutoLaunch** | ❌ Bị tắt | Disable trong Task Manager |
| **Firefox AutoLaunch** | ❌ Bị tắt | Disable trong Task Manager |

## Cách dùng nhanh

### Muốn tắt hoàn toàn weekly restart:
Task đã bị xóa rồi. Không cần làm gì thêm.

### Muốn bật lại weekly restart:
Chạy `01_optimize_all.ps1` (trong `02_WindowsOptimize_Thinkbook14G5`).

### Setup remote work: restart → Parsec chạy → lock → remote vào unlock thủ công:
1. Chạy `scripts/3-bat-autologon.ps1` → bật AutoAdminLogon *(đã làm)*
2. Chạy `scripts/5-tu-lock-sau-autologon.ps1` → tạo task tự lock sau 90 giây *(đã làm)*
3. Luồng: **Restart → AutoLogin → Parsec + Internet khởi động → 90s → Lock → Remote qua Parsec → Nhập password Windows**
- Parsec hoạt động được ngay cả khi màn hình đang lock
- Internet kết nối ở cấp SYSTEM, không phụ thuộc user session
- Hoàn tác auto-lock: `scripts/6-xoa-tu-lock.ps1`
- Hoàn tác AutoAdminLogon: `scripts/4-tat-autologon.ps1`

### Muốn bật lại Docker / LenovoVantage khi đăng nhập:
Mở Task Manager → tab Startup → Enable app muốn bật.

### Điều tra crash Kernel-Power 41:
Chạy `scripts/2-chan-doan-crash.ps1` để thu thập thêm thông tin.
