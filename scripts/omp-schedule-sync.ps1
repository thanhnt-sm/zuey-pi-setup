<#
.SYNOPSIS
    scripts/omp-schedule-sync.ps1 — Windows Task Scheduler helper for periodic non-destructive OMP sync & drift watch
.DESCRIPTION
    Creates or removes an unprivileged Windows Scheduled Task running periodic non-destructive
    harvest scans and drift reports via Git Bash.
.PARAMETER Action
    DryRun (default), Install, or Uninstall.
.PARAMETER IntervalHours
    Interval between runs in hours (default: 24).
#>
[CmdletBinding()]
param(
    [ValidateSet("DryRun", "Install", "Uninstall")]
    [string]$Action = "DryRun",
    [int]$IntervalHours = 24
)

$TaskName = "OMP_Consolidation_Sync"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Split-Path -Parent $ScriptDir
$GitBash = "C:\Program Files\Git\bin\bash.exe"

if (-not (Test-Path $GitBash)) {
    Write-Warning "Git Bash not found at default path: $GitBash"
}

if ($Action -eq "Uninstall") {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "v Unregistered task: $TaskName" -ForegroundColor Green
    exit 0
}

if ($Action -eq "DryRun") {
    Write-Host "=== [DRY-RUN] Windows Scheduled Task Configuration ===" -ForegroundColor Cyan
    Write-Host "TaskName:  $TaskName"
    Write-Host "Interval:  Every $IntervalHours hours"
    Write-Host "Action:    $GitBash $RepoDir/scripts/omp-bootstrap.sh --mode backup --dry-run"
    exit 0
}

# Action = Install
$ActionCmd = New-ScheduledTaskAction -Execute $GitBash -Argument "$RepoDir/scripts/omp-bootstrap.sh --mode backup --dry-run"
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Action $ActionCmd -Trigger $Trigger -Settings $Settings -Force | Out-Null
Write-Host "v Installed and scheduled Windows task: $TaskName (interval: ${IntervalHours}h)" -ForegroundColor Green
