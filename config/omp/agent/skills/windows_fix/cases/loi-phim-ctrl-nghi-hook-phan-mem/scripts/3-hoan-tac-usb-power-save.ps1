<#
.SYNOPSIS
    Hoan tac 2-fix-tat-usb-power-save-ban-phim.ps1 — bat lai "Allow the computer to
    turn off this device to save power" cho ban phim/touchpad built-in (ve mac dinh).
.NOTES
    Case: loi-phim-ctrl-nghi-hook-phan-mem
    Quyen: Can Admin — tu dong xin UAC.
#>
[CmdletBinding()]
param([switch]$_Elevated)

$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Host "[HOAN TAC] Dang xin quyen Administrator (se hien hop thoai UAC) ..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', $scriptPath, '-_Elevated'
        ) -Wait
    } catch {
        Write-Host "[HOAN TAC] UAC bi tu choi hoac loi." -ForegroundColor Red
    }
    exit
}

$targetIds = @('VID_0461&PID_4002&MI_00', 'VID_0461&PID_4002&MI_01')

Write-Host "=== BAT LAI 'ALLOW POWER OFF' (ve mac dinh cua Windows) ===" -ForegroundColor Cyan

$devices = Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction Stop
$matched = $devices | Where-Object {
    $instName = $_.InstanceName
    [bool]($targetIds | Where-Object { $instName -match [regex]::Escape($_) })
}

foreach ($dev in $matched) {
    $shortName = $dev.InstanceName.Substring(0, [Math]::Min(90, $dev.InstanceName.Length))
    Write-Host ("`n  Thiet bi: {0} | Truoc: AllowPowerOff = {1}" -f $shortName, $dev.Enable)
    $dev.Enable = $true
    Set-CimInstance -CimInstance $dev -ErrorAction Stop
    Write-Host "    Sau   : AllowPowerOff = True (ve mac dinh)" -ForegroundColor Green
}

Write-Host "`n[HOAN TAC] Xong. Da tra ve trang thai mac dinh cua Windows." -ForegroundColor Green
Read-Host "`nNhan Enter de dong"
