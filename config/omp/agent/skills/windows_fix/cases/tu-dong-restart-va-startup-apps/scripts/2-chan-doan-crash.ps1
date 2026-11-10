# Script chẩn đoán crash Kernel-Power 41 — READ ONLY
# Chạy với quyền Admin để đọc đầy đủ event log

$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item $logDir -ItemType Directory -Force | Out-Null }
$report = Join-Path $logDir ("chan-doan-crash_{0}.txt" -f (Get-Date -Format 'yyyy-MM-dd_HH-mm'))

function W($m) { Write-Host $m; Add-Content $report $m }

W "=== CHẨN ĐOÁN CRASH KERNEL-POWER 41 ==="
W "Thời gian: $(Get-Date)"

# 1. Chi tiết Kernel-Power 41 (BugCheck code)
W "`n--- Kernel-Power 41 events (chi tiết) ---"
Get-WinEvent -FilterHashtable @{ LogName='System'; Id=41; StartTime=(Get-Date).AddDays(-60) } -EA SilentlyContinue |
    ForEach-Object {
        W "[$($_.TimeCreated)]"
        # Trích BugCheckCode từ event data
        try {
            $xml = [xml]$_.ToXml()
            $data = $xml.Event.EventData.Data
            W "  BugCheckCode : $($data | Where-Object {$_.Name -eq 'BugCheckCode'} | Select-Object -Expand '#text')"
            W "  PowerButtonTimestamp: $($data | Where-Object {$_.Name -eq 'PowerButtonTimestamp'} | Select-Object -Expand '#text')"
            W "  SleepInProgress: $($data | Where-Object {$_.Name -eq 'SleepInProgress'} | Select-Object -Expand '#text')"
        } catch { W "  (không đọc được data)" }
        W "---"
    }

# 2. WHEA errors (phần cứng)
W "`n--- WHEA Hardware Errors ---"
Get-WinEvent -FilterHashtable @{ LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=(Get-Date).AddDays(-60) } -EA SilentlyContinue |
    Select-Object TimeCreated, Id, Message | Format-Table -AutoSize -Wrap | Out-String -Width 200 | ForEach-Object { W $_ }

# 3. Nhiệt độ (nếu có WMI sensor)
W "`n--- Thông tin pin/nguồn ---"
try {
    $battery = Get-CimInstance Win32_Battery -EA Stop
    W "EstimatedChargeRemaining : $($battery.EstimatedChargeRemaining)%"
    W "BatteryStatus : $($battery.BatteryStatus) (2=AC, 1=Discharging)"
    W "DesignCapacity : $($battery.DesignCapacity)"
    W "FullChargeCapacity : $($battery.FullChargeCapacity)"
} catch { W "(Không lấy được thông tin pin)" }

# 4. powercfg battery report
W "`n--- Tạo báo cáo pin (powercfg /batteryreport) ---"
$battReport = "$env:TEMP\battery-report.html"
try {
    & powercfg /batteryreport /output $battReport 2>&1 | Out-Null
    W "Báo cáo pin: $battReport"
} catch { W "(Lỗi khi chạy powercfg)" }

W "`nBáo cáo đã lưu: $report"
Write-Host "Báo cáo: $report" -ForegroundColor Green
if (Test-Path $battReport) {
    Write-Host "Báo cáo pin: $battReport" -ForegroundColor Cyan
    Start-Process $battReport
}
