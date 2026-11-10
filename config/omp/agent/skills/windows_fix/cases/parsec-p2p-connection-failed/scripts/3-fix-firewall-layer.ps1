<#
.SYNOPSIS
    Fix Tang 2: Firewall Layer cho Parsec
.DESCRIPTION
    - Tim duong dan parsecd.exe (Per-Computer hoac Per-User)
    - Xoa rules cu neu dang BLOCK
    - Tao 3 firewall rules: TCP Inbound, UDP Inbound (STUN+P2P), Outbound
    - Apply cho tat ca profiles (Domain, Private, Public)
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
Write-Host "  FIX TANG 2: FIREWALL LAYER"               -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Find parsecd.exe ---
Write-Host "[1/4] Tim duong dan parsecd.exe..." -ForegroundColor White

$parsecPaths = @(
    "$env:ProgramFiles\Parsec\parsecd.exe",
    "${env:ProgramFiles(x86)}\Parsec\parsecd.exe",
    "$env:LOCALAPPDATA\Parsec\parsecd.exe"
)

$parsecExe = $null
foreach ($p in $parsecPaths) {
    if (Test-Path $p) {
        $parsecExe = $p
        break
    }
}

# Fallback: search running process
if ($null -eq $parsecExe) {
    $proc = Get-Process -Name "parsecd" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $proc) {
        $parsecExe = $proc.Path
    }
}

# Fallback: search common install dirs
if ($null -eq $parsecExe) {
    $search = Get-ChildItem -Path "$env:ProgramFiles", "${env:ProgramFiles(x86)}", "$env:LOCALAPPDATA" `
        -Filter "parsecd.exe" -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $search) {
        $parsecExe = $search.FullName
    }
}

if ($null -eq $parsecExe) {
    Write-Host "  [FAIL] Khong tim thay parsecd.exe!" -ForegroundColor Red
    Write-Host "  Can cai dat Parsec truoc khi chay script nay." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Nhan phim bat ky de thoat..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host "  [OK] Tim thay: $parsecExe" -ForegroundColor Green

# --- Step 2: Check existing rules ---
Write-Host "[2/4] Kiem tra firewall rules hien co..." -ForegroundColor White

$existingRules = Get-NetFirewallRule -DisplayName "*Parsec*" -ErrorAction SilentlyContinue
if ($null -ne $existingRules) {
    Write-Host "  Tim thay $($existingRules.Count) rule(s) hien co:" -ForegroundColor Gray
    foreach ($rule in $existingRules) {
        Write-Host "    $($rule.DisplayName) | Direction=$($rule.Direction) | Action=$($rule.Action) | Enabled=$($rule.Enabled)" -ForegroundColor Gray
    }

    # Remove blocking rules
    $blockingRules = $existingRules | Where-Object { $_.Action -eq 'Block' }
    if ($null -ne $blockingRules) {
        Write-Host "  [WARN] Phat hien $($blockingRules.Count) rule BLOCK! Dang xoa..." -ForegroundColor Yellow
        $blockingRules | Remove-NetFirewallRule
        Write-Host "  [OK] Da xoa cac rule BLOCK." -ForegroundColor Green
    }
} else {
    Write-Host "  [INFO] Khong co rule Parsec nao hien co." -ForegroundColor Gray
}

# --- Step 3: Create/Update firewall rules ---
Write-Host "[3/4] Tao firewall rules moi..." -ForegroundColor White

# Rule names (dung ten co prefix de de quan ly)
$rules = @(
    @{
        DisplayName = "Parsec - TCP Inbound (API/Auth)"
        Direction   = "Inbound"
        Protocol    = "TCP"
        LocalPort   = @("443")
        Description = "Parsec: API authentication va signaling qua TCP 443"
    },
    @{
        DisplayName = "Parsec - UDP Inbound (STUN)"
        Direction   = "Inbound"
        Protocol    = "UDP"
        LocalPort   = @("3478")
        Description = "Parsec: STUN NAT traversal (UDP 3478)"
    },
    @{
        DisplayName = "Parsec - UDP Inbound (P2P Streaming)"
        Direction   = "Inbound"
        Protocol    = "UDP"
        LocalPort   = @("8000-8010")
        Description = "Parsec: P2P streaming traffic (UDP 8000-8010)"
    },
    @{
        DisplayName = "Parsec - All Outbound"
        Direction   = "Outbound"
        Protocol    = "Any"
        LocalPort   = $null
        Description = "Parsec: cho phep tat ca outbound traffic"
    }
)

foreach ($r in $rules) {
    Write-Host "  Tao rule: $($r.DisplayName)..." -ForegroundColor Gray

    # Remove existing rule with same name (to avoid duplicates)
    $existing = Get-NetFirewallRule -DisplayName $r.DisplayName -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
        $existing | Remove-NetFirewallRule
        Write-Host "    (Da xoa rule cu cung ten)" -ForegroundColor DarkGray
    }

    $params = @{
        DisplayName = $r.DisplayName
        Direction   = $r.Direction
        Action      = "Allow"
        Program     = $parsecExe
        Profile     = "Any"
        Enabled     = "True"
        Description = $r.Description
    }

    if ($r.Protocol -ne "Any") {
        $params.Protocol = $r.Protocol
    }

    if ($null -ne $r.LocalPort -and $r.Protocol -ne "Any") {
        $params.LocalPort = $r.LocalPort
    }

    try {
        New-NetFirewallRule @params | Out-Null
        Write-Host "    [OK] Da tao." -ForegroundColor Green
    } catch {
        Write-Host "    [ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
}

# --- Step 4: Verify ---
Write-Host "[4/4] Verify firewall rules..." -ForegroundColor White

$finalRules = Get-NetFirewallRule -DisplayName "Parsec -*" -ErrorAction SilentlyContinue
$allPass = $true

if ($null -ne $finalRules) {
    foreach ($rule in $finalRules) {
        $isGood = ($rule.Action -eq 'Allow') -and ($rule.Enabled -eq $true -or $rule.Enabled -eq 'True')
        if ($isGood) {
            Write-Host "  [PASS] $($rule.DisplayName) | Action=$($rule.Action) | Enabled=$($rule.Enabled)" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] $($rule.DisplayName) | Action=$($rule.Action) | Enabled=$($rule.Enabled)" -ForegroundColor Red
            $allPass = $false
        }

        # Show profile info
        $profiles = $rule.Profile
        if ($profiles -match "Any") {
            Write-Host "    Profiles: All (Domain, Private, Public)" -ForegroundColor Gray
        } else {
            Write-Host "    Profiles: $profiles" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  [FAIL] Khong tim thay rule nao sau khi tao!" -ForegroundColor Red
    $allPass = $false
}

# --- Summary ---
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  KET QUA FIX FIREWALL LAYER" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if ($allPass) {
    Write-Host "  >>> TANG 2 (FIREWALL) DA FIX THANH CONG <<<" -ForegroundColor Green
} else {
    Write-Host "  >>> CON VAN DE CAN XU LY — xem chi tiet o tren <<<" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Nhan phim bat ky de thoat..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
