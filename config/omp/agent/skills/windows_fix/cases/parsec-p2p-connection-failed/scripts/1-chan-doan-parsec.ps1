<#
.SYNOPSIS
    Chan doan Parsec P2P Connection — READ-ONLY, khong sua gi.
.DESCRIPTION
    Thu thap 15 muc bang chung de xac dinh nguyen nhan loi [-6023 / -6024 / -11010].
    Output ra console + file log trong scripts/logs/.
.NOTES
    Case: parsec-p2p-connection-failed
    Quyen: Chay KHONG can Admin (co Admin se thu them Recovery options)
#>

#Requires -Version 5.1
$ErrorActionPreference = 'Continue'

# --- Setup log ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $scriptDir "logs"
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory -Force | Out-Null }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $logDir "chan-doan-parsec-$timestamp.txt"

function Write-Log {
    param([string]$Message)
    $line = $Message
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Write-Section {
    param([int]$Number, [string]$Title)
    Write-Log ""
    Write-Log "============================================================"
    Write-Log "[$Number] $Title"
    Write-Log "============================================================"
}

Write-Log "=========================================="
Write-Log "  CHAN DOAN PARSEC P2P CONNECTION"
Write-Log "  Thoi gian: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Log "  May tinh: $env:COMPUTERNAME"
Write-Log "  User: $env:USERNAME"
Write-Log "=========================================="

# --- 1. Parsec service ton tai? ---
Write-Section 1 "Parsec service ton tai?"
$svc = Get-Service -Name "Parsec" -ErrorAction SilentlyContinue
if ($null -eq $svc) {
    Write-Log "  [FAIL] Service 'Parsec' KHONG TON TAI!"
    Write-Log "  -> Can cai dat Parsec che do Per-Computer (Shared)."
} else {
    Write-Log "  [OK] Service 'Parsec' ton tai."
}

# --- 2. Service status ---
Write-Section 2 "Service status"
if ($null -ne $svc) {
    Write-Log "  Status: $($svc.Status)"
    if ($svc.Status -ne 'Running') {
        Write-Log "  [WARN] Service KHONG dang Running!"
    } else {
        Write-Log "  [OK] Service dang Running."
    }
} else {
    Write-Log "  [SKIP] Service khong ton tai."
}

# --- 3. Startup Type ---
Write-Section 3 "Service Startup Type"
if ($null -ne $svc) {
    $svcWmi = Get-CimInstance Win32_Service -Filter "Name='Parsec'" -ErrorAction SilentlyContinue
    if ($null -ne $svcWmi) {
        Write-Log "  StartMode: $($svcWmi.StartMode)"
        Write-Log "  PathName:  $($svcWmi.PathName)"
        if ($svcWmi.StartMode -ne 'Auto') {
            Write-Log "  [WARN] StartMode nen la 'Auto' de tu khoi dong khi boot."
        } else {
            Write-Log "  [OK] StartMode = Auto."
        }
    }
} else {
    Write-Log "  [SKIP] Service khong ton tai."
}

# --- 4. Recovery options ---
Write-Section 4 "Recovery options (can Admin de xem)"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin -and $null -ne $svc) {
    $failureInfo = sc.exe qfailure Parsec 2>&1
    $failureInfo | ForEach-Object { Write-Log "  $_" }
    if ($failureInfo -match "RESTART") {
        Write-Log "  [OK] Co Recovery action = RESTART."
    } else {
        Write-Log "  [WARN] Recovery CHUA set RESTART! Service crash se khong tu khoi lai."
    }
} elseif (-not $isAdmin) {
    Write-Log "  [INFO] Can chay voi quyen Admin de xem Recovery options."
    Write-Log "  Goi y: sc.exe qfailure Parsec"
} else {
    Write-Log "  [SKIP] Service khong ton tai."
}

# --- 5. Parsec processes dang chay ---
Write-Section 5 "Parsec processes dang chay"
$procs = Get-Process -Name pservice, parsecd -ErrorAction SilentlyContinue
if ($null -ne $procs) {
    $procs | ForEach-Object {
        Write-Log "  Process: $($_.ProcessName) | PID: $($_.Id) | SessionId: $($_.SessionId)"
    }
    $pservice = $procs | Where-Object { $_.ProcessName -eq 'pservice' }
    if ($null -eq $pservice) {
        Write-Log "  [WARN] pservice.exe KHONG chay! Service co the da stop."
    } else {
        Write-Log "  [OK] pservice.exe dang chay."
    }
} else {
    Write-Log "  [FAIL] KHONG co process Parsec nao dang chay!"
}

# --- 6. Parsec install path (Per-Computer) ---
Write-Section 6 "Parsec install path — HKLM (Per-Computer)"
$hklm = Get-ItemProperty "HKLM:\SOFTWARE\Parsec" -ErrorAction SilentlyContinue
if ($null -ne $hklm) {
    Write-Log "  [OK] Tim thay registry HKLM:\SOFTWARE\Parsec"
    $hklm.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
        Write-Log "  $($_.Name) = $($_.Value)"
    }
} else {
    Write-Log "  [INFO] Khong tim thay HKLM:\SOFTWARE\Parsec"
}

# --- 7. Parsec install path (Per-User) ---
Write-Section 7 "Parsec install path — HKCU (Per-User)"
$hkcu = Get-ItemProperty "HKCU:\SOFTWARE\Parsec" -ErrorAction SilentlyContinue
if ($null -ne $hkcu) {
    Write-Log "  [WARN] Tim thay registry HKCU:\SOFTWARE\Parsec — co the la cai dat Per-User!"
    $hkcu.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
        Write-Log "  $($_.Name) = $($_.Value)"
    }
    Write-Log "  -> Neu service khong ton tai, can REINSTALL che do Per-Computer."
} else {
    Write-Log "  [OK] Khong co registry Per-User (tot)."
}

# --- 8. Firewall rules cho Parsec ---
Write-Section 8 "Firewall rules cho Parsec"
$fwRules = Get-NetFirewallRule -DisplayName "*Parsec*" -ErrorAction SilentlyContinue
if ($null -ne $fwRules) {
    $fwRules | ForEach-Object {
        Write-Log "  Rule: $($_.DisplayName) | Direction: $($_.Direction) | Action: $($_.Action) | Enabled: $($_.Enabled)"
    }
    $blocked = $fwRules | Where-Object { $_.Action -eq 'Block' }
    if ($null -ne $blocked) {
        Write-Log "  [WARN] Co rule dang BLOCK Parsec!"
    } else {
        Write-Log "  [OK] Tat ca rules deu Allow."
    }
} else {
    Write-Log "  [WARN] KHONG co firewall rule nao cho Parsec!"
    Write-Log "  -> Can tao rules allow cho parsecd.exe."
}

# --- 9. Firewall rule chi tiet — application filter ---
Write-Section 9 "Firewall — Application filter chi tiet"
if ($null -ne $fwRules) {
    foreach ($rule in $fwRules) {
        $appFilter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue
        $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue
        Write-Log "  Rule: $($rule.DisplayName)"
        if ($null -ne $appFilter) {
            Write-Log "    Program: $($appFilter.Program)"
        }
        if ($null -ne $portFilter) {
            Write-Log "    Protocol: $($portFilter.Protocol) | LocalPort: $($portFilter.LocalPort) | RemotePort: $($portFilter.RemotePort)"
        }
    }
} else {
    Write-Log "  [SKIP] Khong co rule de kiem tra."
}

# --- 10. STUN connectivity ---
Write-Section 10 "STUN connectivity (UDP 3478)"
Write-Log "  Dang test ket noi den stun.parsec.gg:3478..."
try {
    $stun = Test-NetConnection -ComputerName "stun.parsec.gg" -Port 3478 -WarningAction SilentlyContinue
    Write-Log "  RemoteAddress: $($stun.RemoteAddress)"
    Write-Log "  TcpTestSucceeded: $($stun.TcpTestSucceeded)"
    if ($stun.TcpTestSucceeded) {
        Write-Log "  [OK] STUN server reachable."
    } else {
        Write-Log "  [WARN] STUN server KHONG reachable! Co the bi firewall/ISP block."
    }
} catch {
    Write-Log "  [ERROR] Khong the test: $($_.Exception.Message)"
}

# --- 11. Event Log — Parsec events 7 ngay ---
Write-Section 11 "Event Log — Parsec events (7 ngay gan day)"
try {
    $events = Get-WinEvent -FilterHashtable @{
        LogName = 'Application'
        StartTime = (Get-Date).AddDays(-7)
    } -ErrorAction SilentlyContinue | Where-Object { $_.ProviderName -match 'Parsec' }
    if ($null -ne $events -and @($events).Count -gt 0) {
        Write-Log "  Tim thay $(@($events).Count) event(s):"
        @($events) | Select-Object -First 10 | ForEach-Object {
            $msg = ($_.Message -replace "`r?`n", ' ')
            if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) + '...' }
            Write-Log "  [$($_.TimeCreated)] Level=$($_.LevelDisplayName) ID=$($_.Id): $msg"
        }
    } else {
        Write-Log "  [INFO] Khong co event Parsec nao trong 7 ngay qua."
    }
} catch {
    Write-Log "  [INFO] Khong doc duoc event log hoac khong co event Parsec."
}

# --- 12. Service crash events ---
Write-Section 12 "Service crash/stop events (7 ngay)"
try {
    $crashEvents = Get-WinEvent -FilterHashtable @{
        LogName   = 'System'
        Id        = 7034, 7031, 7036
        StartTime = (Get-Date).AddDays(-7)
    } -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'Parsec' }
    if ($null -ne $crashEvents -and @($crashEvents).Count -gt 0) {
        Write-Log "  Tim thay $(@($crashEvents).Count) service event(s) lien quan Parsec:"
        @($crashEvents) | Select-Object -First 10 | ForEach-Object {
            $msg = ($_.Message -replace "`r?`n", ' ')
            if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) + '...' }
            Write-Log "  [$($_.TimeCreated)] EventID=$($_.Id): $msg"
        }
    } else {
        Write-Log "  [INFO] Khong co service crash/stop event lien quan Parsec."
    }
} catch {
    Write-Log "  [INFO] Khong doc duoc System event log."
}

# --- 13. VPN / Game Booster dang chay ---
Write-Section 13 "VPN / Game Booster / Network Optimizer dang chay"
$interferingPatterns = @('openvpn', 'wireguard', 'nordvpn', 'expressvpn', 'surfshark',
    'uu\.exe', 'gearup', 'exitlag', 'wtfast', 'mudfish', 'pingzapper',
    'netlimiter', 'cfos', 'cfosspeed', 'zerotier', 'tailscale')
$combinedPattern = ($interferingPatterns -join '|')
$found = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match $combinedPattern
}
if ($null -ne $found -and @($found).Count -gt 0) {
    Write-Log "  [WARN] Phan mem can thiep network dang chay:"
    @($found) | ForEach-Object { Write-Log "    $($_.ProcessName) (PID: $($_.Id))" }
    Write-Log "  -> Co the can thiep traffic P2P cua Parsec."
} else {
    Write-Log "  [OK] Khong phat hien VPN/Game Booster/Network Optimizer."
}

# --- 14. Parsec config ---
Write-Section 14 "Parsec config file"
$configPaths = @(
    "$env:APPDATA\Parsec\config.txt",
    "$env:APPDATA\Parsec\config.json",
    "$env:ProgramData\Parsec\config.txt"
)
$configFound = $false
foreach ($cp in $configPaths) {
    if (Test-Path $cp) {
        Write-Log "  Tim thay: $cp"
        $content = Get-Content $cp -ErrorAction SilentlyContinue
        $content | ForEach-Object { Write-Log "    $_" }
        $configFound = $true
    }
}
if (-not $configFound) {
    Write-Log "  [INFO] Khong tim thay file config Parsec."
    Write-Log "  Parsec dang dung config mac dinh."
}

# --- 15. Parsec UPnP setting (error -11011 khi UPnP bi tat trong app) ---
Write-Section 15 "Parsec UPnP setting trong config"
$upnpChecked = $false
foreach ($cp in $configPaths) {
    if (Test-Path $cp) {
        $cfgContent = Get-Content $cp -Raw -ErrorAction SilentlyContinue
        if ($cfgContent -match 'app_host_upnp\s*=\s*(\d)') {
            $upnpVal = $Matches[1]
            if ($upnpVal -eq '0') {
                Write-Log "  [WARN] UPnP bi TAT trong Parsec config (app_host_upnp=0)!"
                Write-Log "  -> Error -11011: Mo Parsec Settings > Host > bat UPnP."
            } else {
                Write-Log "  [OK] UPnP dang BAT trong Parsec config (app_host_upnp=$upnpVal)."
            }
            $upnpChecked = $true
        }
    }
}
if (-not $upnpChecked) {
    Write-Log "  [INFO] Khong tim thay setting app_host_upnp — mac dinh la BAT."
}

# --- Summary ---
Write-Log ""
Write-Log "=========================================="
Write-Log "  KET THUC CHAN DOAN"
Write-Log "  Log luu tai: $logFile"
Write-Log "=========================================="
Write-Log ""
Write-Log "BUOC TIEP THEO:"
Write-Log "  - Neu Service KHONG ton tai: Reinstall Parsec che do Per-Computer"
Write-Log "  - Neu Service STOPPED:       Chay 2-fix-service-layer.ps1 (Admin)"
Write-Log "  - Neu Firewall BLOCK/THIEU:  Chay 3-fix-firewall-layer.ps1 (Admin)"
Write-Log "  - Neu STUN FAIL:             Chay 4-fix-nat-stun-check.ps1"
