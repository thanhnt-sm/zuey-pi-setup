<#
.SYNOPSIS
    Cai dat Scheduled Task cho Parsec Watchdog.
.DESCRIPTION
    Tao task chay moi 5 phut duoi quyen SYSTEM.
.NOTES
    Case: parsec-p2p-connection-failed
    Quyen: CAN ADMIN
#>

#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

# --- UAC Elevation ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[INFO] Dang yeu cau quyen Admin..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -ArgumentList "-ExecutionPolicy Bypass -NoProfile -File `"$scriptPath`"" -Verb RunAs
    exit
}

Write-Host "=========================================="  -ForegroundColor Cyan
Write-Host "  INSTALL WATCHDOG TASK"                    -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$taskName = "Parsec-Service-Watchdog"
$scriptPath = Join-Path $PSScriptRoot "5-watchdog-parsec-service.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Host "[FAIL] Khong tim thay script: $scriptPath" -ForegroundColor Red
    Start-Sleep -Seconds 3
    exit 1
}

Write-Host "Dang xoa task cu (neu co)..." -ForegroundColor Gray
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "Dang tao task moi..." -ForegroundColor Gray
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -NoProfile -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 9999)

$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

try {
    Register-ScheduledTask -TaskName $taskName `
      -Action $action -Trigger $trigger -Principal $principal `
      -Description "Watchdog: tu restart Parsec service neu bi stop. Case: parsec-p2p-connection-failed" `
      -Force | Out-Null
      
    Write-Host "[OK] Cai dat watchdog thanh cong. Task se chay 5 phut 1 lan." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Loi khi tao task: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Nhan phim bat ky de thoat..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
