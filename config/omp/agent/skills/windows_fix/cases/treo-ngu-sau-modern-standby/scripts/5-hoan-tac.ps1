# =============================================================================
# SCRIPT 5: HOAN TAC FIX (tra cau hinh ve mac dinh)
# =============================================================================
# MUC DICH: Dao nguoc cac thay doi do 2-fix-tat-modern-standby.ps1 gay ra:
#   - Bat lai Modern Standby (xoa PlatformAoAcOverride).
#   - Tra timeout ngu ve mac dinh (ngu sau 30 phut AC / 15 phut DC).
#   - Tra hanh dong dong nap ve "Sleep".
#   (Khong dung den driver - neu muon ha driver dung Device Manager > Roll Back.)
#
# AN TOAN: Tu xin quyen Admin. Can KHOI DONG LAI de Modern Standby bat lai.
# =============================================================================

$dangLaAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $dangLaAdmin) {
    Write-Host "Dang xin quyen Admin (UAC se hien len)..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Wait
    exit
}

Write-Host "===== HOAN TAC FIX - $(Get-Date) =====" -ForegroundColor Yellow

# 1. Bat lai Modern Standby (xoa override)
Write-Host "`n[1] Bat lai Modern Standby (xoa PlatformAoAcOverride)..."
try {
    Remove-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name "PlatformAoAcOverride" -Force -EA SilentlyContinue
    Write-Host "  -> OK (can reboot de co hieu luc)."
} catch { Write-Host "  -> $_" }

# 2. Tra timeout ngu ve mac dinh
Write-Host "`n[2] Tra timeout ngu/man hinh ve mac dinh..."
try {
    powercfg /change standby-timeout-ac 30
    powercfg /change standby-timeout-dc 15
    powercfg /change monitor-timeout-ac 10
    powercfg /change monitor-timeout-dc 5
    powercfg /change disk-timeout-ac 20
    powercfg /change disk-timeout-dc 10
    # Dong nap = Sleep (1) cho goi dang dung
    powercfg /setacvalueindex scheme_current sub_buttons lidaction 1
    powercfg /setdcvalueindex scheme_current sub_buttons lidaction 1
    powercfg /setactive scheme_current
    Write-Host "  -> OK."
} catch { Write-Host "  -> $_" }

Write-Host "`n===== HOAN TAT HOAN TAC ====="
Write-Host "Luu y: cau hinh nay tra ve gan mac dinh Windows. Neu loi treo tai phat thi chay lai 2-fix-tat-modern-standby.ps1."
Read-Host "Nhan Enter de dong"
