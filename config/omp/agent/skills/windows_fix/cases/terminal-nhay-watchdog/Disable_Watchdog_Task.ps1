# Script: Disable_Watchdog_Task.ps1
# Mục đích: Vô hiệu hóa (Disable) Scheduled Task "SuperAntigravity-Watchdog" để khắc phục lỗi nháy màn hình Terminal.

$TaskName = "SuperAntigravity-Watchdog"

try {
    Write-Host "Đang vô hiệu hóa tác vụ '$TaskName' ..." -ForegroundColor Cyan
    Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
    Write-Host "[OK] Đã tắt (Disable) tác vụ '$TaskName' thành công!" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Không thể tắt tác vụ '$TaskName'." -ForegroundColor Red
    Write-Host "Chi tiết lỗi: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Ghi chú: Đảm bảo tác vụ vẫn đang tồn tại trong hệ thống." -ForegroundColor Yellow
}

Write-Host "`nNhấn phím bất kỳ để thoát..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
