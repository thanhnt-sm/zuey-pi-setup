<#
.SYNOPSIS
    Fix Tang 1: Parsec Service Layer
.DESCRIPTION
    - Set Startup Type = Automatic
    - Set Recovery Options (tu restart khi crash: 5s / 10s / 30s)
    - Start service neu dang Stopped
    - Verify pservice.exe chay duoi SYSTEM
.NOTES
    Case: parsec-p2p-connection-failed
    Quyen: CAN ADMIN — script tu request UAC elevation
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
Write-Host "  FIX TANG 1: PARSEC SERVICE LAYER"         -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Check service exists ---
Write-Host "[1/5] Kiem tra Parsec service ton tai..." -ForegroundColor White
$svc = Get-Service -Name "Parsec" -ErrorAction SilentlyContinue

if ($null -eq $svc) {
    Write-Host ""
    Write-Host "[FAIL] Service 'Parsec' KHONG TON TAI!" -ForegroundColor Red
    Write-Host ""
    Write-Host "HUONG DAN REINSTALL:" -ForegroundColor Yellow
    Write-Host "  1. Go bo Parsec hien tai (neu co): Settings > Apps > Parsec > Uninstall"
    Write-Host "  2. Tai Parsec moi nhat: https://parsec.app/downloads"
    Write-Host "  3. Khi cai dat, CHON CHE DO 'Per-Computer' (Shared) — KHONG chon Per-User"
    Write-Host "  4. Sau khi cai xong, chay lai script nay."
    Write-Host ""
    Write-Host "Nhan phim bat ky de thoat..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host "  [OK] Service 'Parsec' ton tai." -ForegroundColor Green

# --- Step 2: Set Startup Type = Automatic ---
Write-Host "[2/5] Set Startup Type = Automatic..." -ForegroundColor White
$scOutput = sc.exe config Parsec start= auto 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Startup Type = Automatic." -ForegroundColor Green
} else {
    Write-Host "  [ERROR] sc.exe config failed (exit code $LASTEXITCODE):" -ForegroundColor Red
    $scOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
}

# --- Step 3: Set Recovery Options ---
Write-Host "[3/5] Set Recovery Options (tu restart khi crash)..." -ForegroundColor White
# Reset fail count after 1 day (86400 seconds)
# Actions: restart after 5000ms / restart after 10000ms / restart after 30000ms
$scOutput = sc.exe failure Parsec reset= 86400 actions= restart/5000/restart/10000/restart/30000 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Recovery set: Restart sau 5s (lan 1), 10s (lan 2), 30s (lan 3+)." -ForegroundColor Green
} else {
    Write-Host "  [ERROR] sc.exe failure failed (exit code $LASTEXITCODE):" -ForegroundColor Red
    $scOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
}

# Verify
Write-Host "  Kiem tra Recovery options:" -ForegroundColor Gray
$failureInfo = sc.exe qfailure Parsec 2>&1
$failureInfo | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

# --- Step 4: Start service if Stopped ---
Write-Host "[4/5] Kiem tra va start service..." -ForegroundColor White
$svc = Get-Service -Name "Parsec"
if ($svc.Status -ne 'Running') {
    Write-Host "  Service dang: $($svc.Status). Dang start..." -ForegroundColor Yellow
    try {
        Start-Service -Name "Parsec"
        Start-Sleep -Seconds 3
        $svc = Get-Service -Name "Parsec"
        if ($svc.Status -eq 'Running') {
            Write-Host "  [OK] Service da start thanh cong." -ForegroundColor Green
        } else {
            Write-Host "  [WARN] Service status sau start: $($svc.Status)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [ERROR] Khong the start service: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "  [OK] Service da dang Running." -ForegroundColor Green
}

# --- Step 5: Verify processes ---
Write-Host "[5/5] Verify Parsec processes..." -ForegroundColor White

# Check pservice.exe
$pservice = Get-Process -Name "pservice" -ErrorAction SilentlyContinue
if ($null -ne $pservice) {
    Write-Host "  [OK] pservice.exe dang chay (PID: $($pservice.Id), Session: $($pservice.SessionId))." -ForegroundColor Green
    if ($pservice.SessionId -eq 0) {
        Write-Host "  [OK] pservice.exe chay duoi Session 0 (SYSTEM) — dung." -ForegroundColor Green
    } else {
        Write-Host "  [WARN] pservice.exe chay o Session $($pservice.SessionId) — nen la Session 0." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [WARN] pservice.exe KHONG chay! Service co the chua khoi dong hoan tat." -ForegroundColor Yellow
    Write-Host "  -> Thu doi them 5 giay..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
    $pservice = Get-Process -Name "pservice" -ErrorAction SilentlyContinue
    if ($null -ne $pservice) {
        Write-Host "  [OK] pservice.exe da xuat hien sau khi doi." -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] pservice.exe van khong chay. Can kiem tra cai dat." -ForegroundColor Red
    }
}

# Check parsecd.exe
$parsecd = Get-Process -Name "parsecd" -ErrorAction SilentlyContinue
if ($null -ne $parsecd) {
    $parsecd | ForEach-Object {
        Write-Host "  [OK] parsecd.exe dang chay (PID: $($_.Id), Session: $($_.SessionId))." -ForegroundColor Green
    }
} else {
    Write-Host "  [INFO] parsecd.exe chua chay — binh thuong neu chua mo Parsec app." -ForegroundColor Gray
}

# --- Summary ---
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  KET QUA FIX SERVICE LAYER" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$finalSvc = Get-Service -Name "Parsec"
$finalFailure = sc.exe qfailure Parsec 2>&1
$hasRestart = ($finalFailure | Out-String) -match "RESTART"

$allPass = $true

if ($finalSvc.Status -eq 'Running') {
    Write-Host "  [PASS] Service Status = Running" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Service Status = $($finalSvc.Status)" -ForegroundColor Red
    $allPass = $false
}

if ($hasRestart) {
    Write-Host "  [PASS] Recovery Options = RESTART configured" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Recovery Options CHUA set RESTART" -ForegroundColor Red
    $allPass = $false
}

$finalPservice = Get-Process -Name "pservice" -ErrorAction SilentlyContinue
if ($null -ne $finalPservice -and $finalPservice.SessionId -eq 0) {
    Write-Host "  [PASS] pservice.exe chay duoi SYSTEM (Session 0)" -ForegroundColor Green
} else {
    Write-Host "  [WARN] pservice.exe chua verify duoc" -ForegroundColor Yellow
}

Write-Host ""
if ($allPass) {
    Write-Host "  >>> TANG 1 (SERVICE) DA FIX THANH CONG <<<" -ForegroundColor Green
} else {
    Write-Host "  >>> CON VAN DE CAN XU LY — xem chi tiet o tren <<<" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Nhan phim bat ky de thoat..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
