# Script chẩn đoán: Tự động restart & startup apps — READ ONLY, không thay đổi hệ thống
# Chạy: PowerShell -ExecutionPolicy Bypass -File "1-chan-doan-tong-hop.ps1"

$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item $logDir -ItemType Directory -Force | Out-Null }
$report = Join-Path $logDir ("chan-doan-restart_{0}.txt" -f (Get-Date -Format 'yyyy-MM-dd_HH-mm'))

function W($section, $msg) {
    $line = "[$section] $msg"
    Write-Host $line
    Add-Content $report $line
}

Add-Content $report "=== BÁO CÁO CHẨN ĐOÁN: TỰ ĐỘNG RESTART & STARTUP APPS ==="
Add-Content $report "Thời gian: $(Get-Date)"
Add-Content $report ""

# 1. Restart events 30 ngày
W "RESTART" "--- Sự kiện restart/shutdown 30 ngày gần nhất ---"
$events = Get-WinEvent -FilterHashtable @{
    LogName = 'System'; Id = @(41, 1074, 6008, 6005, 6006)
    StartTime = (Get-Date).AddDays(-30)
} -EA SilentlyContinue

foreach ($e in ($events | Sort-Object TimeCreated -Descending)) {
    $msg = $e.Message -replace '\r?\n',' ' | ForEach-Object { $_.Substring(0, [Math]::Min($_.Length, 120)) }
    W "RESTART" "[$($e.TimeCreated)] ID=$($e.Id) :: $msg"
}

# 2. Task TB14G5_WeeklyRestart
W "TASK" "--- Trạng thái task TB14G5_WeeklyRestart ---"
$task = Get-ScheduledTask -TaskName "TB14G5_WeeklyRestart" -EA SilentlyContinue
if ($task) {
    W "TASK" "CÒN TỒN TẠI - State: $($task.State)"
} else {
    W "TASK" "ĐÃ BỊ XÓA (không tìm thấy trong Task Scheduler)"
}

# 3. AutoLogon
W "STARTUP" "--- AutoAdminLogon ---"
$al = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -EA SilentlyContinue).AutoAdminLogon
W "STARTUP" "AutoAdminLogon = $al (1=tự đăng nhập, empty=không)"

# 4. StartupApproved
W "STARTUP" "--- Trạng thái từng startup app ---"
$key = Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" -EA SilentlyContinue
$key.PSObject.Properties | Where-Object { $_.Name -notlike "PS*" } | ForEach-Object {
    $byte = $_.Value[0]
    $status = if ($byte -eq 2 -or $byte -eq 6) { "BẬT" } elseif ($byte -eq 3) { "TẮT" } else { "Không rõ($byte)" }
    W "STARTUP" "$($_.Name): $status"
}

W "DONE" "Báo cáo đã lưu tại: $report"
Write-Host "`nBáo cáo: $report" -ForegroundColor Green
