<#
.SYNOPSIS
    Check Tang 3: NAT / STUN — chi kiem tra va huong dan, KHONG tu sua.
.DESCRIPTION
    - Test STUN connectivity (stun.parsec.gg, stun1.parsec.gg)
    - Detect Double NAT qua tracert
    - Detect CGNAT (Carrier-Grade NAT) qua gateway IP range
    - Output huong dan fix manual (can truy cap router)
.NOTES
    Case: parsec-p2p-connection-failed
    Quyen: KHONG can Admin
#>

#Requires -Version 5.1
$ErrorActionPreference = 'Continue'

Write-Host "=========================================="  -ForegroundColor Cyan
Write-Host "  CHECK TANG 3: NAT / STUN"                 -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$issues = @()

# --- Step 1: Test STUN connectivity ---
Write-Host "[1/4] Test STUN server connectivity..." -ForegroundColor White

$stunServers = @("stun.parsec.gg", "stun1.parsec.gg")
foreach ($server in $stunServers) {
    Write-Host "  Testing $server`:3478..." -ForegroundColor Gray
    try {
        $result = Test-NetConnection -ComputerName $server -Port 3478 -WarningAction SilentlyContinue
        if ($result.TcpTestSucceeded) {
            Write-Host "    [OK] $server`:3478 — reachable (IP: $($result.RemoteAddress))" -ForegroundColor Green
        } else {
            Write-Host "    [FAIL] $server`:3478 — KHONG reachable!" -ForegroundColor Red
            $issues += "STUN server $server bi block"
        }
    } catch {
        Write-Host "    [ERROR] Khong the test $server`: $($_.Exception.Message)" -ForegroundColor Red
        $issues += "STUN server $server khong the test"
    }
}

# --- Step 2: Detect Double NAT ---
Write-Host ""
Write-Host "[2/4] Detect Double NAT (tracert)..." -ForegroundColor White
Write-Host "  Dang tracert den 1.1.1.1 (toi da 10 hops, theo huong dan Parsec)..." -ForegroundColor Gray

try {
    $tracert = tracert -d -h 10 -w 1000 1.1.1.1 2>&1
    $privateHops = @()
    $isFirstPrivate = $true

    foreach ($line in $tracert) {
        # Match lines with IP addresses (tracert output format)
        if ($line -match '(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})') {
            $ip = $Matches[1]
            # Skip destination IP
            if ($ip -eq '1.1.1.1') { continue }
            # Check if private IP (RFC 1918)
            if ($ip -match '^10\.' -or
                $ip -match '^172\.(1[6-9]|2[0-9]|3[01])\.' -or
                $ip -match '^192\.168\.') {
                if ($isFirstPrivate) {
                    # Skip first private hop — this is always local gateway
                    Write-Host "    Local gateway (skip): $ip" -ForegroundColor DarkGray
                    $isFirstPrivate = $false
                } else {
                    $privateHops += $ip
                }
            }
        }
    }

    Write-Host "  So EXTRA private IP hops (sau gateway): $($privateHops.Count)" -ForegroundColor Gray
    $privateHops | ForEach-Object { Write-Host "    Extra private hop: $_" -ForegroundColor Gray }

    if ($privateHops.Count -ge 1) {
        Write-Host "  [WARN] DOUBLE NAT detected! ($($privateHops.Count) extra private IP hops sau gateway)" -ForegroundColor Yellow
        $issues += "Double NAT detected ($($privateHops.Count) extra private hops: $($privateHops -join ', '))"
    } else {
        Write-Host "  [OK] Khong phat hien Double NAT." -ForegroundColor Green
    }
} catch {
    Write-Host "  [ERROR] Tracert that bai: $($_.Exception.Message)" -ForegroundColor Red
}

# --- Step 3: Detect CGNAT ---
Write-Host ""
Write-Host "[3/4] Detect CGNAT (Carrier-Grade NAT)..." -ForegroundColor White

# Get default gateway
try {
    $gateway = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Sort-Object -Property RouteMetric | Select-Object -First 1).NextHop

    Write-Host "  Default gateway: $gateway" -ForegroundColor Gray

    # Check if gateway is in CGNAT range (100.64.0.0/10 = 100.64.0.0 - 100.127.255.255)
    if ($null -ne $gateway -and $gateway -match '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.') {
        Write-Host "  [WARN] Gateway $gateway thuoc range CGNAT (100.64.0.0/10)!" -ForegroundColor Yellow
        $issues += "CGNAT detected — gateway $gateway thuoc range 100.64.0.0/10"
    } else {
        Write-Host "  [OK] Gateway khong thuoc CGNAT range." -ForegroundColor Green
    }
} catch {
    Write-Host "  [ERROR] Khong lay duoc gateway: $($_.Exception.Message)" -ForegroundColor Red
}

# Get external IP
Write-Host "  Dang lay external IP..." -ForegroundColor Gray
try {
    $externalIP = (Invoke-WebRequest -Uri "https://api.ipify.org" -UseBasicParsing -TimeoutSec 10).Content
    Write-Host "  External IP: $externalIP" -ForegroundColor Gray

    # Check if external IP is also private (another sign of CGNAT or VPN)
    if ($externalIP -match '^10\.' -or
        $externalIP -match '^172\.(1[6-9]|2[0-9]|3[01])\.' -or
        $externalIP -match '^192\.168\.' -or
        $externalIP -match '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.') {
        Write-Host "  [WARN] External IP la private/CGNAT! VPN dang bat hoac ISP dung CGNAT." -ForegroundColor Yellow
        $issues += "External IP ($externalIP) la private/CGNAT range"
    } else {
        Write-Host "  [OK] External IP la public: $externalIP" -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] Khong lay duoc external IP (co the bi firewall block)." -ForegroundColor Yellow
}

# --- Step 4: Check UPnP ---
Write-Host ""
Write-Host "[4/4] Kiem tra UPnP support..." -ForegroundColor White
Write-Host "  [INFO] UPnP can kiem tra tren router — khong the tu dong kiem tra tu may tinh." -ForegroundColor Gray
Write-Host "  Parsec can UPnP de tu dong mo port cho P2P streaming." -ForegroundColor Gray

# --- Summary & Guidance ---
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  KET QUA CHECK NAT / STUN" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if ($issues.Count -eq 0) {
    Write-Host ""
    Write-Host "  [OK] Khong phat hien van de NAT/STUN." -ForegroundColor Green
    Write-Host "  Neu van loi P2P, van de co the o Tang 1 (Service) hoac Tang 2 (Firewall)." -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "  Phat hien $($issues.Count) van de:" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  HUONG DAN FIX (can truy cap router)" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan

    if ($issues -match "STUN") {
        Write-Host ""
        Write-Host "  --- STUN bi block ---" -ForegroundColor White
        Write-Host "  1. Mo router admin page (thuong la 192.168.1.1 hoac 192.168.0.1)"
        Write-Host "  2. Tim Firewall / Security settings"
        Write-Host "  3. Dam bao KHONG block UDP port 3478 (outbound)"
        Write-Host "  4. Neu co 'SPI Firewall', thu TAT de test"
    }

    if ($issues -match "Double NAT") {
        Write-Host ""
        Write-Host "  --- Double NAT ---" -ForegroundColor White
        Write-Host "  Co 2+ router noi tiep nhau. Parsec P2P se THAT BAI trong hau het truong hop."
        Write-Host "  Cach fix:"
        Write-Host "    A. Chuyen router thu 2 sang BRIDGE MODE (tat DHCP + NAT)"
        Write-Host "    B. Hoac: Port forward UDP 8000-8010 tu router 1 -> router 2 -> may host"
        Write-Host "    C. Hoac: Dung 1 router duy nhat (bo router thua)"
    }

    if ($issues -match "CGNAT") {
        Write-Host ""
        Write-Host "  --- CGNAT (ISP) ---" -ForegroundColor White
        Write-Host "  ISP dang dung Carrier-Grade NAT — ban KHONG co public IP rieng."
        Write-Host "  Cach fix:"
        Write-Host "    A. Lien he ISP xin chuyen sang PUBLIC IP (co the mat phi)"
        Write-Host "    B. Su dung Parsec Relay mode (tang 1 hop, co the lag)"
        Write-Host "    C. Su dung P2P VPN: Tailscale hoac ZeroTier (last resort)"
        Write-Host "       - Tailscale: https://tailscale.com — de setup nhat"
        Write-Host "       - ZeroTier: https://zerotier.com — flexible hon"
    }

    Write-Host ""
    Write-Host "  --- UPnP (chung) ---" -ForegroundColor White
    Write-Host "  1. Mo router admin page"
    Write-Host "  2. Tim 'UPnP' (thuong trong Advanced / NAT settings)"
    Write-Host "  3. BAT UPnP"
    Write-Host "  4. Neu khong co UPnP, port forward thu cong:"
    Write-Host "     UDP 8000-8010 -> IP may host ($((Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress))"
}

Write-Host ""
Write-Host "Nhan phim bat ky de thoat..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
