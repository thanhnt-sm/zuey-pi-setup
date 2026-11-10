<#
.SYNOPSIS
    Go bo Scheduled Task cho Parsec Watchdog.
.DESCRIPTION
    Xoa task khoi Task Scheduler.
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
Write-Host "  UNINSTALL WATCHDOG TASK"                  -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$taskName = "Parsec-Service-Watchdog"

try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "[OK] Da go bo task $taskName thanh cong." -ForegroundColor Green
    } else {
        Write-Host "[INFO] Task $taskName khong ton tai." -ForegroundColor Yellow
    }
} catch {
    Write-Host "[ERROR] Loi khi xoa task: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Nhan phim bat ky de thoat..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
