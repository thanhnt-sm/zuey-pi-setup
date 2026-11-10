# =============================================================================
# SCRIPT 2: FIX BEN VUNG - TAT MODERN STANDBY (chong treo, chong dao nguoc)
# =============================================================================
# MUC DICH:
#   Khac phuc triet de loi treo do Modern Standby (S0ix) bang cach VA O TANG
#   NEN TANG (registry) - khong phu thuoc goi nguon nen khong bi dao nguoc khi
#   Windows/hang san xuat doi goi nguon.
#
# 3 LOP:
#   Lop 1 (then chot): PlatformAoAcOverride=0 -> tat han Modern Standby.
#                      => May khong vao duoc trang thai S0ix gay treo. CAN REBOOT.
#   Lop 2: "khong bao gio ngu" + "dong nap khong lam gi" cho TAT CA goi nguon.
#   Lop 3 (TUY CHON, mac dinh TAT): bat Hibernate lam luoi an toan khi het pin.
#          Dung -EnableHibernate de bat. Neu khong bat -> nen cam sac lien tuc.
#   Bo sung: WiFi=Max Performance, tat USB selective suspend + PCIe link power,
#            tat "cho phep may tat card WiFi de tiet kiem dien".
#
# CACH DUNG:
#   powershell -ExecutionPolicy Bypass -File ".\2-fix-tat-modern-standby.ps1"
#   powershell -ExecutionPolicy Bypass -File ".\2-fix-tat-modern-standby.ps1" -EnableHibernate
#
# AN TOAN: Tu xin quyen Admin (UAC). Hoan tac duoc bang 5-hoan-tac.ps1.
# =============================================================================

param([switch]$EnableHibernate)

# B0: Tu xin quyen Admin
$dangLaAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $dangLaAdmin) {
    Write-Host "Dang xin quyen Admin (UAC se hien len)..." -ForegroundColor Yellow
    $args2 = "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if($EnableHibernate){ $args2 += " -EnableHibernate" }
    Start-Process powershell -Verb RunAs -ArgumentList $args2 -Wait
    exit
}

function Log($m){ Write-Host $m }
Log "===== FIX BEN VUNG - $(Get-Date) ====="

# LOP 1: Tat Modern Standby
Log "`n[LOP 1] Tat han Modern Standby (PlatformAoAcOverride=0)..."
try {
    New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name "PlatformAoAcOverride" -Value 0 -PropertyType DWord -Force | Out-Null
    Log "  -> OK. (Can KHOI DONG LAI moi co hieu luc)"
} catch { Log "  -> LOI: $_" }

# LOP 2: Khong-ngu cho tat ca goi nguon
Log "`n[LOP 2] Cau hinh khong-ngu cho TAT CA goi nguon..."
try {
    $schemes = (powercfg /list | Select-String 'GUID:\s*([a-f0-9-]{36})').Matches | ForEach-Object { $_.Groups[1].Value }
    Log ("  Tim thay {0} goi nguon." -f $schemes.Count)
    foreach ($s in $schemes) {
        powercfg /setacvalueindex $s SUB_SLEEP STANDBYIDLE 0 2>$null
        powercfg /setdcvalueindex $s SUB_SLEEP STANDBYIDLE 0 2>$null
        powercfg /setacvalueindex $s SUB_VIDEO VIDEOIDLE 0 2>$null
        powercfg /setdcvalueindex $s SUB_VIDEO VIDEOIDLE 0 2>$null
        powercfg /setacvalueindex $s SUB_DISK DISKIDLE 0 2>$null
        powercfg /setdcvalueindex $s SUB_DISK DISKIDLE 0 2>$null
        powercfg /setacvalueindex $s sub_buttons lidaction 0 2>$null
        powercfg /setdcvalueindex $s sub_buttons lidaction 0 2>$null
    }
    Log "  -> OK."
} catch { Log "  -> LOI: $_" }

# LOP 3: Hibernate (tuy chon)
if($EnableHibernate){
    Log "`n[LOP 3] Bat Hibernate lam luoi an toan..."
    try {
        powercfg /h on
        powercfg /setacvalueindex scheme_current SUB_BATTERY BATACTIONCRIT 2 2>$null
        powercfg /setdcvalueindex scheme_current SUB_BATTERY BATACTIONCRIT 2 2>$null
        Log "  -> OK: pin can kiet se Hibernate (an toan)."
    } catch { Log "  -> LOI: $_" }
} else {
    Log "`n[LOP 3] BO QUA Hibernate (mac dinh). => Nen CAM SAC lien tuc khi de 24/7."
}

# Bo sung: WiFi/USB/PCIe khong tiet kiem dien
Log "`n[BO SUNG] WiFi=Max Performance, tat USB suspend & PCIe link power..."
try {
    powercfg /setacvalueindex scheme_current 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0
    powercfg /setdcvalueindex scheme_current 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0
    powercfg /setacvalueindex scheme_current 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
    powercfg /setdcvalueindex scheme_current 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
    powercfg /setacvalueindex scheme_current 501a4d13-42af-4429-9fd1-a8218c268e20 ee12f906-d277-404b-b6da-e5fa1a576df5 0
    powercfg /setdcvalueindex scheme_current 501a4d13-42af-4429-9fd1-a8218c268e20 ee12f906-d277-404b-b6da-e5fa1a576df5 0
    # Tat "cho phep may tat card WiFi de tiet kiem dien" (moi card WiFi vat ly)
    $cards = Get-NetAdapter -Physical -EA SilentlyContinue | Where-Object { $_.InterfaceDescription -match 'Wi-?Fi|Wireless|MediaTek|Intel.*Wireless|Realtek.*Wireless' }
    $base = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}'
    foreach($card in $cards){
        Get-ChildItem $base -EA SilentlyContinue | ForEach-Object {
            $p = Get-ItemProperty $_.PSPath -EA SilentlyContinue
            if ($p.DriverDesc -eq $card.InterfaceDescription) { Set-ItemProperty $_.PSPath -Name "PnPCapabilities" -Value 24 -Type DWord -Force }
        }
    }
    powercfg /setactive scheme_current
    Log "  -> OK."
} catch { Log "  -> LOI: $_" }

# Kiem chung
Log "`n[KIEM CHUNG] (Modern Standby chi thuc su tat SAU KHI REBOOT):"
powercfg /a

Log "`n===== HOAN TAT ====="
Log "!!! BAT BUOC KHOI DONG LAI. Sau do chay 4-kiem-chung-theo-doi.ps1 de xac nhan."
Read-Host "Nhan Enter de dong"
