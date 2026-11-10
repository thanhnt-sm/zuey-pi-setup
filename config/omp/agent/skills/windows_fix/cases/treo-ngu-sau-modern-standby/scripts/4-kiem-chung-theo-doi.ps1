# =============================================================================
# SCRIPT 4: KIEM CHUNG SAU FIX + THEO DOI (CHI DOC)
# =============================================================================
# MUC DICH: Chay SAU KHI da fix va KHOI DONG LAI. Xac nhan Modern Standby da tat
#   va dem cac lan treo moi de biet loi con tai phat khong.
# AN TOAN: Chi doc, khong can Admin.
# =============================================================================

$ErrorActionPreference = 'SilentlyContinue'
Write-Host "===== KIEM CHUNG SAU FIX - $(Get-Date) =====" -ForegroundColor Green

# 1. Modern Standby da tat chua?
Write-Host "`n[1] Trang thai Modern Standby:" -ForegroundColor Cyan
$a = powercfg /a | Out-String
# Tach phan "available" (truoc cum 'are not available') de tranh nham lan voi S1/S2/S3
$availPart = ($a -split 'are not available')[0]
if($availPart -match 'S0 Low Power Idle'){
    Write-Host "  CANH BAO: S0 Low Power Idle VAN KHA DUNG -> fix chua an / chua reboot. Chay lai 2-fix-tat-modern-standby.ps1 roi REBOOT." -ForegroundColor Red
} elseif($a -match 'S0 Low Power Idle'){
    Write-Host "  THANH CONG: S0 Low Power Idle o muc 'not available' -> Modern Standby DA TAT." -ForegroundColor Green
} else {
    Write-Host "  Khong thay S0ix (may co the khong dung Modern Standby) - kiem tra chi tiet ben duoi." -ForegroundColor Green
}
powercfg /a

# 2. PlatformAoAcOverride
Write-Host "`n[2] Registry PlatformAoAcOverride:" -ForegroundColor Cyan
$ov = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -Name PlatformAoAcOverride).PlatformAoAcOverride
Write-Host ("  PlatformAoAcOverride = {0}  (0 = da tat Modern Standby)" -f $(if($ov -eq $null){'CHUA dat'}else{$ov}))

# 3. Kernel-Power 41 moi (sau khi fix)
Write-Host "`n[3] Kernel-Power 41 (tat cung) - 7 ngay qua:" -ForegroundColor Cyan
$e41 = Get-WinEvent -FilterHashtable @{LogName='System'; Id=41; ProviderName='Microsoft-Windows-Kernel-Power'; StartTime=(Get-Date).AddDays(-7)}
if($e41){ Write-Host ("  Co {0} lan (xem moc co SAU thoi diem fix khong):" -f $e41.Count) -ForegroundColor Yellow; $e41 | Select-Object TimeCreated | Format-Table -AutoSize }
else { Write-Host "  Khong co lan treo nao trong 7 ngay -> TOT" -ForegroundColor Green }

# 4. WLAN module crash moi
Write-Host "`n[4] WLAN module stopped (Event 10002) - 7 ngay:" -ForegroundColor Cyan
$wlan = Get-WinEvent -FilterHashtable @{LogName='System'; Id=10002; ProviderName='Microsoft-Windows-WLAN-AutoConfig'; StartTime=(Get-Date).AddDays(-7)}
if($wlan){ Write-Host ("  Co {0} lan (luu y: vai lan ngay sau khi cai driver la binh thuong):" -f $wlan.Count) -ForegroundColor Yellow; $wlan | Select-Object -First 10 TimeCreated | Format-Table -AutoSize }
else { Write-Host "  Khong co -> TOT" -ForegroundColor Green }

# 5. Driver WiFi hien tai
Write-Host "`n[5] Driver WiFi hien tai:" -ForegroundColor Cyan
Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -match 'Wi-?Fi|Wireless|MediaTek|MT79' -and $_.DriverProviderName -notmatch 'Microsoft' } |
    Select-Object DeviceName, DriverVersion, DriverDate | Format-List

Write-Host "`nTIEU CHI THANH CONG: Modern Standby 'not available' + khong co Kernel-Power 41 moi sau khi de may idle." -ForegroundColor Green
Read-Host "Nhan Enter de dong"
