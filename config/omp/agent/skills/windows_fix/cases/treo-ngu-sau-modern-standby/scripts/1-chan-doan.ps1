# =============================================================================
# SCRIPT 1: CHAN DOAN LOI TREO / NGU SAU (CHI DOC - khong thay doi gi he thong)
# =============================================================================
# MUC DICH:
#   Quet Event Viewer + cau hinh nguon + driver de xac dinh NGUYEN NHAN may bi
#   treo cung / ngu sau khong danh thuc duoc. In ra ket luan nghi van o cuoi.
#
# AN TOAN: Hoan toan CHI DOC. Khong can quyen Admin (mot vai muc co the thieu
#   thong tin neu khong co admin, nhung khong loi).
#
# CACH DOC KET QUA (giai thuat suy luan):
#   - Kernel-Power 41 = may tat khong sach (treo/mat dien). Dem so lan.
#   - Khong co MEMORY.DMP/minidump + khoang lang dai trong log = HANG (treo cung).
#   - Co WHEA-Logger = nghi LOI PHAN CUNG (CPU/RAM/PCIe).
#   - Event 10002 WLAN-AutoConfig (mtkihvx/driver WiFi stopped) lap lai truoc
#     khi treo = nghi DRIVER WIFI crash trong Modern Standby.
#   - powercfg /a chi co "S0 Low Power Idle" = may dung Modern Standby (de dinh loi).
# =============================================================================

$ErrorActionPreference = 'SilentlyContinue'
function Tieu-De($t){ Write-Host "`n===== $t =====" -ForegroundColor Cyan }

Write-Host "============================================================" -ForegroundColor Green
Write-Host " CHAN DOAN LOI TREO / NGU SAU - $(Get-Date)" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 1. Thong tin may
# -----------------------------------------------------------------------------
Tieu-De "1. THONG TIN MAY"
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
Write-Host ("May      : {0} {1} (type/model {2})" -f $cs.Manufacturer, $cs.SystemFamily, $cs.Model)
Write-Host ("BIOS     : {0}  ngay {1}" -f $bios.SMBIOSBIOSVersion, $bios.ReleaseDate)
Write-Host ("OS       : {0}  build {1}" -f (Get-CimInstance Win32_OperatingSystem).Caption, [Environment]::OSVersion.Version)
$bat = Get-CimInstance Win32_Battery
if($bat){ Write-Host ("Pin      : LAPTOP - {0}% (BatteryStatus={1}: 1=xa pin,2=cam dien)" -f $bat.EstimatedChargeRemaining, $bat.BatteryStatus) }
else { Write-Host "Pin      : DESKTOP (khong co pin)" }

# -----------------------------------------------------------------------------
# 2. Trang thai sleep & cau hinh nguon
# -----------------------------------------------------------------------------
Tieu-De "2. TRANG THAI SLEEP (powercfg /a)"
powercfg /a
Tieu-De "2b. GOI NGUON DANG DUNG + TIMEOUT NGU"
powercfg /getactivescheme
$q = powercfg /query scheme_current SUB_SLEEP
($q | Select-String 'Sleep after|Hibernate after|Current AC|Current DC' | Out-String).Trim()
Tieu-De "2c. MODERN STANDBY OVERRIDE (registry PlatformAoAcOverride)"
$ov = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -Name PlatformAoAcOverride).PlatformAoAcOverride
if($ov -eq $null){ Write-Host "PlatformAoAcOverride: CHUA dat (Modern Standby dang bat neu firmware ho tro)" }
else { Write-Host "PlatformAoAcOverride = $ov  (0 = da TAT Modern Standby)" }

# -----------------------------------------------------------------------------
# 3. Kernel-Power 41 (tat khong sach / treo)
# -----------------------------------------------------------------------------
Tieu-De "3. KERNEL-POWER 41 (tat cung / treo) - 30 ngay qua"
$e41 = Get-WinEvent -FilterHashtable @{LogName='System'; Id=41; ProviderName='Microsoft-Windows-Kernel-Power'; StartTime=(Get-Date).AddDays(-30)}
if($e41){ Write-Host ("So lan: {0}" -f $e41.Count) -ForegroundColor Yellow; $e41 | Select-Object TimeCreated | Format-Table -AutoSize }
else { Write-Host "Khong co (tot)" -ForegroundColor Green }

# -----------------------------------------------------------------------------
# 4. WHEA (loi phan cung) - neu co thi nghi phan cung
# -----------------------------------------------------------------------------
Tieu-De "4. WHEA-LOGGER (loi phan cung) - 30 ngay"
$whea = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=(Get-Date).AddDays(-30)}
if($whea){ Write-Host ("!! Co {0} su kien WHEA -> NGHI LOI PHAN CUNG" -f $whea.Count) -ForegroundColor Red; $whea | Select-Object TimeCreated, Id, LevelDisplayName | Format-Table -AutoSize }
else { Write-Host "Khong co WHEA -> LOAI TRU loi phan cung CPU/RAM/PCIe" -ForegroundColor Green }

# -----------------------------------------------------------------------------
# 5. BSOD / BugCheck + minidump
# -----------------------------------------------------------------------------
Tieu-De "5. BSOD / BUGCHECK + DUMP"
$bc = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1001; ProviderName='Microsoft-Windows-WER-SystemErrorReporting'; StartTime=(Get-Date).AddDays(-30)}
if($bc){ Write-Host ("Co {0} BSOD:" -f $bc.Count) -ForegroundColor Yellow; $bc | Select-Object TimeCreated, @{N='M';E={$_.Message.Substring(0,[Math]::Min(120,$_.Message.Length))}} | Format-List }
else { Write-Host "Khong co BSOD gan day" -ForegroundColor Green }
$dump = Test-Path C:\WINDOWS\MEMORY.DMP
$mini = (Get-ChildItem C:\WINDOWS\Minidump\*.dmp).Count
Write-Host ("MEMORY.DMP: {0} | So minidump: {1}" -f $(if($dump){'CO'}else{'KHONG'}), $mini)
if(-not $dump -and $mini -eq 0 -and $e41){ Write-Host "  -> Khong co dump + co Kernel-Power 41 = HANG (treo cung, khong kip ghi dump)" -ForegroundColor Yellow }

# -----------------------------------------------------------------------------
# 6. WLAN module crash (thu pham pho bien tren laptop Modern Standby)
# -----------------------------------------------------------------------------
Tieu-De "6. WLAN MODULE STOPPED (Event 10002) - 14 ngay"
$wlan = Get-WinEvent -FilterHashtable @{LogName='System'; Id=10002; ProviderName='Microsoft-Windows-WLAN-AutoConfig'; StartTime=(Get-Date).AddDays(-14)}
if($wlan){
    Write-Host ("Co {0} lan WLAN module stopped:" -f $wlan.Count) -ForegroundColor Yellow
    $wlan | Select-Object -First 15 TimeCreated, @{N='Module';E={if($_.Message -match 'Module Path:\s*(\S+)'){$Matches[1]}}} | Format-Table -AutoSize
    Write-Host "  -> Neu cac lan nay DON DAP truoc moc Kernel-Power 41 = NGHI DRIVER WIFI crash trong Modern Standby" -ForegroundColor Yellow
} else { Write-Host "Khong co loi WLAN module" -ForegroundColor Green }

# -----------------------------------------------------------------------------
# 7. Su kien CUOI truoc moc treo gan nhat (phat hien khoang lang = hang)
# -----------------------------------------------------------------------------
Tieu-De "7. SU KIEN TRUOC MOC TREO GAN NHAT"
if($e41){
    $moc = $e41[0].TimeCreated
    Write-Host ("Moc Kernel-Power 41 gan nhat: {0}" -f $moc)
    Write-Host "10 su kien cuoi TRUOC moc do (xem co 'khoang lang' dai = treo):"
    Get-WinEvent -FilterHashtable @{LogName='System'; EndTime=$moc} -MaxEvents 10 |
        Sort-Object TimeCreated | Select-Object TimeCreated, Id, ProviderName | Format-Table -AutoSize
}

# -----------------------------------------------------------------------------
# 8. Driver WiFi
# -----------------------------------------------------------------------------
Tieu-De "8. DRIVER WIFI"
Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -match 'Wi-?Fi|Wireless|MediaTek|MT79|Intel.*Wireless|Realtek.*Wireless' -and $_.DriverProviderName -notmatch 'Microsoft' } |
    Select-Object DeviceName, DriverVersion, DriverDate, DriverProviderName | Format-List

# -----------------------------------------------------------------------------
# KET LUAN NGHI VAN
# -----------------------------------------------------------------------------
Tieu-De "KET LUAN NGHI VAN (tu dong)"
if($whea){ Write-Host "-> Co WHEA: NGHI LOI PHAN CUNG. Kiem tra RAM (memtest), nhiet do, SSD." -ForegroundColor Red }
elseif($wlan -and $e41){ Write-Host "-> NGHI CAO: Driver WiFi crash trong Modern Standby gay treo. Chay 2-fix-tat-modern-standby.ps1 + cap nhat driver." -ForegroundColor Yellow }
elseif($e41){ Write-Host "-> Co treo (Kernel-Power 41) nhung chua ro thu pham. Xem muc 6,7 ky hon; can nhac tat Modern Standby." -ForegroundColor Yellow }
else { Write-Host "-> Khong phat hien treo bat thuong trong 30 ngay." -ForegroundColor Green }
Write-Host "`nXong chan doan. (Khong thay doi gi he thong.)" -ForegroundColor Green
Read-Host "Nhan Enter de dong"
