# Script: Tạo task TỰ LOCK MÀN HÌNH sau khi AutoAdminLogon đăng nhập xong
# Mục đích: máy tự login để chạy startup apps (Parsec, Internet) → tự lock → user remote vào unlock thủ công
# YÊU CẦU: Chạy với quyền Admin
# HOÀN TÁC: chạy 6-xoa-tu-lock.ps1

param(
    [int]$DelaySeconds = 90   # Thời gian chờ sau login trước khi lock (giây)
)

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Start-Process powershell "-ExecutionPolicy Bypass -File `"$PSCommandPath`" -DelaySeconds $DelaySeconds" -Verb RunAs
    exit
}

$taskName = "TB14G5_AutoLockAfterLogon"

# Xóa task cũ nếu có
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -EA SilentlyContinue

# Hành động: chờ DelaySeconds giây rồi lock màn hình
$lockCmd  = "Start-Sleep -Seconds $DelaySeconds; rundll32.exe user32.dll,LockWorkStation"
$action   = New-ScheduledTaskAction `
    -Execute "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"$lockCmd`""

# Trigger: mỗi lần user đăng nhập
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Cài đặt: chạy dù pin hay điện, không restart nếu thất bại
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

# Chạy trong ngữ cảnh user hiện tại (cần để lock được màn hình đúng session)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host "Task '$taskName' ĐÃ TẠO." -ForegroundColor Green
Write-Host "Sau mỗi lần đăng nhập (kể cả AutoAdminLogon), máy sẽ tự lock sau $DelaySeconds giây." -ForegroundColor Cyan
Write-Host ""
Write-Host "Luồng hoạt động sau khi cài đặt xong:" -ForegroundColor Yellow
Write-Host "  [Restart] → [AutoAdminLogon tự login] → [Startup apps chạy: Parsec, Internet...] → [$DelaySeconds giây] → [Màn hình tự lock]"
Write-Host "  [Bạn remote qua Parsec] → [Thấy lock screen] → [Nhập mật khẩu Windows] → [Vào desktop]"
Write-Host ""
Write-Host "Dùng '6-xoa-tu-lock.ps1' nếu muốn bỏ auto-lock." -ForegroundColor DarkYellow
