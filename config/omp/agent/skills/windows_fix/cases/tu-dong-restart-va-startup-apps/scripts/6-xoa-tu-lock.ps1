# Script: Xóa task tự lock màn hình (hoàn tác script 5)
# YÊU CẦU: Chạy với quyền Admin

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Start-Process powershell "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Unregister-ScheduledTask -TaskName "TB14G5_AutoLockAfterLogon" -Confirm:$false -EA SilentlyContinue
Write-Host "Đã xóa task TB14G5_AutoLockAfterLogon — màn hình sẽ KHÔNG tự lock sau login nữa." -ForegroundColor Green
