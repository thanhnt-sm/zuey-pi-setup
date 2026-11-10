# Script TẮT AutoAdminLogon (hoàn tác script 3)
# YÊU CẦU: Chạy với quyền Admin

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Start-Process powershell "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$regPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty $regPath -Name "AutoAdminLogon" -Value "0"
Remove-ItemProperty $regPath -Name "DefaultPassword" -EA SilentlyContinue

Write-Host "AutoAdminLogon ĐÃ TẮT — màn hình đăng nhập sẽ hiện lại sau restart." -ForegroundColor Green
