<#
.SYNOPSIS
    Tat "cho phep Windows tat bo dieu khien ban phim de tiet kiem dien" — fix nghi
    pham gay loi "bam phim (dac biet Ctrl) khong an, phai bam lai" tren laptop.
.DESCRIPTION
    Trong Device Manager, moi thiet bi USB co 1 tuy chon o tab "Power Management":
    "Allow the computer to turn off this device to save power". Neu bat, Windows co
    the tu dua bo dieu khien ban phim/touchpad built-in vao trang thai tiet kiem dien
    khi khong go trong vai giay — phim dau tien go lai sau do phai "danh thuc" thiet
    bi truoc, de bi bo lo. Script nay TAT tuy chon do cho dung thiet bi ban phim +
    touchpad built-in cua may nay (VID_0461&PID_4002), khong dong toi thiet bi khac.
.NOTES
    Case: loi-phim-ctrl-nghi-hook-phan-mem
    Quyen: Can Admin — tu dong xin UAC (mot hop thoai UAC se hien ra, can bam Yes).
    Hoan tac: chay 3-hoan-tac-usb-power-save.ps1
    AN TOAN: chi doi 1 flag cau hinh power cua Windows, KHONG go/sua driver, KHONG
             anh huong UniKey hay viec go tieng Viet.
#>
[CmdletBinding()]
param([switch]$_Elevated)

$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Host "[FIX] Dang xin quyen Administrator (se hien hop thoai UAC, ban bam Yes) ..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', $scriptPath, '-_Elevated'
        ) -Wait
    } catch {
        Write-Host "[FIX] UAC bi tu choi hoac loi. Can quyen Admin de tiep tuc." -ForegroundColor Red
    }
    exit
}

# Ban phim + touchpad built-in cua laptop nay, lo ra qua Win32_Keyboard nhu 1 "HID
# keyboard" du khong phai ban phim roi (xem case README de biet chi tiet).
$targetIds = @('VID_0461&PID_4002&MI_00', 'VID_0461&PID_4002&MI_01')

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " TAT 'ALLOW POWER OFF' CHO BAN PHIM/TOUCHPAD BUILT-IN" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$devices = Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction Stop
$matched = $devices | Where-Object {
    $instName = $_.InstanceName
    [bool]($targetIds | Where-Object { $instName -match [regex]::Escape($_) })
}

if (-not $matched) {
    Write-Host "[FIX] Khong tim thay thiet bi khop VID_0461&PID_4002. Co the may da khac," -ForegroundColor Yellow
    Write-Host "      hoac ten thiet bi da doi. Khong sua gi." -ForegroundColor Yellow
    Read-Host "`nNhan Enter de dong"
    exit
}

foreach ($dev in $matched) {
    $shortName = $dev.InstanceName.Substring(0, [Math]::Min(90, $dev.InstanceName.Length))
    Write-Host ("`n  Thiet bi: {0}" -f $shortName)
    Write-Host ("    Truoc : AllowPowerOff = {0}" -f $dev.Enable)
    if ($dev.Enable -eq $false) {
        Write-Host "    [OK] Da tat tu truoc, khong can doi." -ForegroundColor Green
        continue
    }
    $dev.Enable = $false
    Set-CimInstance -CimInstance $dev -ErrorAction Stop
    Write-Host "    Sau   : AllowPowerOff = False (da tat)" -ForegroundColor Green
}

Write-Host "`n[FIX] Xong. Windows se KHONG tu tat bo dieu khien ban phim/touchpad built-in" -ForegroundColor Green
Write-Host "      de tiet kiem dien nua." -ForegroundColor Green
Write-Host "[FIX] Theo doi vai ngay xem con bi 'bam Ctrl khong an' khong." -ForegroundColor Yellow
Write-Host "[FIX] Muon quay lai nhu cu: chay 3-hoan-tac-usb-power-save.ps1" -ForegroundColor Yellow
Read-Host "`nNhan Enter de dong"
