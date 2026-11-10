<#
.SYNOPSIS
    Watchdog cho Parsec service.
.DESCRIPTION
    Kiem tra Parsec service, neu stopped thi start lai. Ghi log vao thu muc logs.
.NOTES
    Case: parsec-p2p-connection-failed
    Quyen: Chay bang SYSTEM thong qua Task Scheduler
#>

#Requires -Version 5.1
$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $scriptDir "logs"
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory -Force | Out-Null }
$logPath = Join-Path $logDir "watchdog-parsec.log"

$svc = Get-Service -Name "Parsec" -ErrorAction SilentlyContinue
if ($null -eq $svc) {
    # Service chua duoc cai dat, khong lam gi ca
    exit 0
}

if ($svc.Status -ne 'Running') {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logPath -Value "[$timestamp] Parsec service was $($svc.Status). Restarting..." -Encoding UTF8
    
    try {
        Start-Service -Name "Parsec" -ErrorAction Stop
        Start-Sleep -Seconds 3
        $newStatus = (Get-Service -Name "Parsec").Status
        Add-Content -Path $logPath -Value "[$timestamp] After restart: $newStatus" -Encoding UTF8
    } catch {
        Add-Content -Path $logPath -Value "[$timestamp] Failed to restart: $($_.Exception.Message)" -Encoding UTF8
    }
}
