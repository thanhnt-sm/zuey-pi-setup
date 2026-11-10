# Script BẬT AutoAdminLogon — máy tự đăng nhập sau restart
# YÊU CẦU: Chạy với quyền Admin (UAC)
# CẢNH BÁO: Bỏ qua màn hình mật khẩu — chỉ dùng ở môi trường an toàn (nhà riêng, phòng khóa)
# HOÀN TÁC: chạy 4-tat-autologon.ps1

param(
    [string]$Username = $env:USERNAME,
    [string]$Password = ""  # Để trống nếu không có mật khẩu
)

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "Cần chạy với quyền Admin!" -ForegroundColor Red
    Start-Process powershell "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$regPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"

if ($Password -eq "") {
    $secPwd = Read-Host "Nhập mật khẩu Windows (để trống nếu không có)" -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd)
    )
}

Set-ItemProperty $regPath -Name "AutoAdminLogon"  -Value "1"
Set-ItemProperty $regPath -Name "DefaultUserName"  -Value $Username
Set-ItemProperty $regPath -Name "DefaultPassword"  -Value $Password
Set-ItemProperty $regPath -Name "DefaultDomainName" -Value $env:COMPUTERNAME

Write-Host "AutoAdminLogon ĐÃ BẬT cho user: $Username" -ForegroundColor Green
Write-Host "Sau khi restart, Windows sẽ tự đăng nhập và chạy tất cả startup apps." -ForegroundColor Cyan
Write-Host "Dùng '4-tat-autologon.ps1' để tắt lại." -ForegroundColor Yellow
