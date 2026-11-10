# Ca: Cửa Sổ Terminal/PowerShell Nhấp Nháy Liên Tục

## Triệu chứng
Cửa sổ Terminal/CMD/PowerShell tự nhấp nháy bật lên rồi tắt liên tục (vài giây/lần),
gây gián đoạn khi dùng máy.

## Nguyên nhân gốc (đã tìm ra)
Một **Scheduled Task** tên `SuperAntigravity-Watchdog` chạy lặp **mỗi 5 phút**, gọi
`PowerShell.exe -WindowStyle Hidden -File ...\watchdog.ps1`. Dù có cờ ẩn cửa sổ,
Task Scheduler chạy ở chế độ Interactive nên cửa sổ vẫn lóe 1-2 giây mỗi lần.

## Cách khắc phục
Đã vô hiệu hóa (Disable) task `SuperAntigravity-Watchdog` → hết nhấp nháy.
Script: `Disable_Watchdog_Task.ps1`.

Nếu cần bật lại watchdog mà không lóe cửa sổ: bọc lệnh PowerShell bằng 1 file `.vbs`
chạy ngầm 100% (CreateObject WScript.Shell, Run với cờ ẩn = 0).

## File trong ca
| File | Nội dung |
|---|---|
| `RootCause_Report.txt` | Báo cáo điều tra đầy đủ |
| `Disable_Watchdog_Task.ps1` | Script vô hiệu hóa task gây nhấp nháy |
| `Suspect_ScheduledTasks.csv` | Các task gọi cmd/powershell (nghi vấn) |
| `StartupItems.csv` | Chương trình khởi động cùng Windows |
| `System_Errors.csv`, `Application_Errors.csv` | Lỗi từ Event Log |
| `TaskScheduler_Recent.csv` | Lịch sử chạy Task Scheduler gần đây |

## Cách điều tra lại (nếu tái phát hoặc task khác tương tự)
```powershell
# Liet ke cac task chay cmd/powershell
Get-ScheduledTask | Where-Object { $_.Actions.Execute -match 'cmd|powershell' } |
    Select-Object TaskName, TaskPath, State

# Vo hieu hoa 1 task cu the
Disable-ScheduledTask -TaskName "<TenTask>"
```
