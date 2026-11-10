<#
.SYNOPSIS
    Chan doan loi phim Ctrl (trai) hay bi — READ-ONLY, khong sua gi he thong.
.DESCRIPTION
    Thu thap bang chung de xac dinh xem loi phim Ctrl la do:
      - Windows Accessibility (StickyKeys/FilterKeys) bi bat nham
      - Filter driver la o tang Keyboard class (nghi hook/keylog)
      - Bo go tieng Viet (Unikey/EVKey/GoTiengViet) dang chay/xung dot
      - Phan mem hook/remap ban phim (gaming, macro, remote control, KVM)
      - Startup/driver/update gan day
    KHONG the phat hien 100% cac low-level keyboard hook (WH_KEYBOARD_LL) bang
    PowerShell thuan (Windows khong expose API doc danh sach hook dang cai qua
    PowerShell). Script chi liet ke NGHI PHAM theo ten tien trinh/startup/filter
    driver da biet. Neu can xac dinh tuyet doi tien trinh nao dang "hook" ban
    phim, dung them cong cu chuyen dung (vi du Sysinternals Autoruns hoac
    NirSoft InstalledHooksView) — script nay KHONG tu dong tai cong cu ngoai.
.NOTES
    Case: loi-phim-ctrl-nghi-hook-phan-mem
    Quyen: Chay KHONG can Admin (mot so muc registry co the thieu thong tin
           neu khong co Admin, nhung khong loi).
#>

#Requires -Version 5.1
$ErrorActionPreference = 'Continue'

# --- Setup log ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $scriptDir "logs"
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory -Force | Out-Null }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $logDir "chan-doan-ctrl-$timestamp.txt"

function Write-Log {
    param([string]$Message)
    Write-Host $Message
    Add-Content -Path $logFile -Value $Message -Encoding UTF8
}

function Write-Section {
    param([int]$Number, [string]$Title)
    Write-Log ""
    Write-Log "============================================================"
    Write-Log "[$Number] $Title"
    Write-Log "============================================================"
}

Write-Log "=========================================="
Write-Log "  CHAN DOAN LOI PHIM CTRL (TRAI)"
Write-Log "  Thoi gian: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Log "  May tinh : $env:COMPUTERNAME"
Write-Log "  User     : $env:USERNAME"
Write-Log "=========================================="

# --- 1. Thiet bi Keyboard trong Device Manager ---
Write-Section 1 "Thiet bi Keyboard trong Device Manager"
$kbDevices = Get-CimInstance Win32_Keyboard -ErrorAction SilentlyContinue
if ($kbDevices) {
    $count = @($kbDevices).Count
    Write-Log "  So thiet bi keyboard dang nhan dien: $count"
    @($kbDevices) | ForEach-Object {
        Write-Log "  - $($_.Description) | Status=$($_.Status) | DeviceID=$($_.DeviceID)"
    }
    if ($count -gt 1) {
        Write-Log "  [INFO] Co nhieu hon 1 thiet bi keyboard - BINH THUONG neu la laptop (ban phim"
        Write-Log "         built-in bao gom nhieu HID collection + ACPI) cong them 1 ban phim USB"
        Write-Log "         ngoai dang cam. Chi dang nghi neu thay ten thiet bi la/khong nhan dien duoc."
    } else {
        Write-Log "  [OK] Chi co 1 thiet bi keyboard."
    }
} else {
    Write-Log "  [INFO] Khong doc duoc danh sach qua Win32_Keyboard."
}

# --- 2. Filter driver tang Keyboard class (registry) ---
Write-Section 2 "Filter driver tang Keyboard class (registry)"
$kbClassGuid = '{4D36E96B-E325-11CE-BFC1-08002BE10318}'
$kbClassPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Class\$kbClassGuid"
$upper = (Get-ItemProperty $kbClassPath -Name UpperFilters -ErrorAction SilentlyContinue).UpperFilters
$lower = (Get-ItemProperty $kbClassPath -Name LowerFilters -ErrorAction SilentlyContinue).LowerFilters
Write-Log "  UpperFilters (class-level) = $($upper -join ', ')"
Write-Log "  LowerFilters (class-level) = $($lower -join ', ')"
# Luu y: "kbdclass" la driver CHUAN cua Windows, LUON xuat hien mac dinh o day.
# Chi dang nghi neu co gia tri KHAC ngoai kbdclass/kbdhid.
$upperSuspect = @($upper) | Where-Object { $_ -and $_ -notmatch '^(kbdclass|kbdhid)$' }
$lowerSuspect = @($lower) | Where-Object { $_ -and $_ -notmatch '^(kbdclass|kbdhid)$' }
if ($upperSuspect -or $lowerSuspect) {
    Write-Log "  [WARN] Co filter driver LA (ngoai kbdclass/kbdhid chuan) o tang CLASS keyboard -"
    Write-Log "         vi tri hiem gap, thuong do phan mem remote-control/anti-cheat/bao mat cai vao. Rat dang nghi."
} else {
    Write-Log "  [OK] Chi co driver chuan cua Windows (kbdclass) - KHONG co filter la o tang class."
}
Write-Log "  -- Kiem tra tung thiet bi keyboard cu the --"
Get-PnpDevice -Class Keyboard -ErrorAction SilentlyContinue | ForEach-Object {
    $inst = $_.InstanceId
    $devPath = "HKLM:\SYSTEM\CurrentControlSet\Enum\$inst\Device Parameters"
    $devUpper = (Get-ItemProperty $devPath -Name UpperFilters -ErrorAction SilentlyContinue).UpperFilters
    $devLower = (Get-ItemProperty $devPath -Name LowerFilters -ErrorAction SilentlyContinue).LowerFilters
    Write-Log "  - $($_.FriendlyName) [$($_.Status)]"
    if ($devUpper) { Write-Log "      UpperFilters = $($devUpper -join ', ')" }
    if ($devLower) { Write-Log "      LowerFilters = $($devLower -join ', ')" }
}

# --- 3. Windows Accessibility: StickyKeys / FilterKeys / ToggleKeys ---
Write-Section 3 "Windows Accessibility - StickyKeys / FilterKeys / ToggleKeys"
try {
    $sk = (Get-ItemProperty 'HKCU:\Control Panel\Accessibility\StickyKeys' -ErrorAction SilentlyContinue).Flags
    $fk = (Get-ItemProperty 'HKCU:\Control Panel\Accessibility\Keyboard Response' -ErrorAction SilentlyContinue).Flags
    $tk = (Get-ItemProperty 'HKCU:\Control Panel\Accessibility\ToggleKeys' -ErrorAction SilentlyContinue).Flags
    Write-Log "  StickyKeys.Flags  = $sk"
    Write-Log "  FilterKeys.Flags  = $fk"
    Write-Log "  ToggleKeys.Flags  = $tk"
    if ($sk -and ([int]$sk -band 0x1)) {
        Write-Log "  [WARN] StickyKeys DANG BAT! Trieu chung giong het: nhan Ctrl xong no 'dinh'"
        Write-Log "         (giu trang thai) den khi bam phim khac."
        Write-Log "  -> Tat: Settings > Accessibility > Keyboard > Sticky Keys = Off."
        Write-Log "     (co the bi bat nham do vo tinh bam Shift 5 lan lien tiep)"
    } else {
        Write-Log "  [OK] StickyKeys dang TAT."
    }
    if ($fk -and ([int]$fk -band 0x1)) {
        Write-Log "  [WARN] FilterKeys dang BAT - co the lam tre/bo qua phim giu (bounce/repeat delay)."
    } else {
        Write-Log "  [OK] FilterKeys dang TAT."
    }
} catch {
    Write-Log "  [INFO] Khong doc duoc registry Accessibility."
}

# --- 4. Bo go tieng Viet dang chay ---
Write-Section 4 "Bo go tieng Viet (Unikey/EVKey/GoTiengViet/VietKey)"
$imeNames = @('UniKeyNT','UniKey','EVKey','GoTiengViet','VietKeyNT','VietKey','OpenKey')
$imeRunning = Get-Process -ErrorAction SilentlyContinue | Where-Object { $imeNames -contains $_.ProcessName }
if ($imeRunning) {
    @($imeRunning) | ForEach-Object { Write-Log "  [DANG CHAY] $($_.ProcessName) (PID $($_.Id)) - $($_.Path)" }
    Write-Log "  [WARN] Co bo go tieng Viet dang chay. Day la NGHI PHAM SO 1 pho bien nhat cho"
    Write-Log "         loi 'dinh Ctrl': cac bo go nay dung low-level keyboard hook de bat macro/"
    Write-Log "         chuyen kieu go, hotkey chuyen Vietnamese/English mac dinh hay dung Ctrl"
    Write-Log "         nen de xung dot/loi khi hook bi treo."
    Write-Log "  -> Test nhanh: thoat han bo go (chuot phai icon > Exit/Thoat), theo doi vai gio."
} else {
    Write-Log "  [OK] Khong thay bo go tieng Viet nao dang chay (co the da tat hoac khong dung)."
}

# --- 5. Phan mem gaming/macro/remap ban phim ---
Write-Section 5 "Phan mem gaming/macro/remap ban phim"
$remapNames = @('LGHUB','LCore','LogiOverlay','LogiOptionsPlus','RzSynapseService','Synapse3Host',
    'iCUE','SSEngine','SteelSeriesEngine3','AutoHotkeyU64','AutoHotkeyU32','AutoHotkey','AutoHotkey64',
    'PowerToys','PowerToys.KeyboardManagerEngine','PowerToys.KeyboardManagerEditor','interception')
$remapRunning = Get-Process -ErrorAction SilentlyContinue | Where-Object { $remapNames -contains $_.ProcessName }
if ($remapRunning) {
    @($remapRunning) | ForEach-Object { Write-Log "  [DANG CHAY] $($_.ProcessName) (PID $($_.Id)) - $($_.Path)" }
    Write-Log "  [WARN] Co phan mem remap/macro ban phim dang chay - kiem tra profile co remap Ctrl khong."
} else {
    Write-Log "  [OK] Khong thay phan mem gaming/macro/remap ban phim pho bien dang chay."
}
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'AutoHotkey' } | ForEach-Object {
    Write-Log "  [AHK SCRIPT] CommandLine: $($_.CommandLine)"
}

# --- 6. Phan mem remote-control / KVM qua mang ---
Write-Section 6 "Phan mem remote-control / KVM qua mang"
$remoteNames = @('TeamViewer','TeamViewer_Service','AnyDesk','UltraViewer','UltraViewer_Service','UltraViewer_Desktop',
    'vncserver','winvnc','tvnserver','CitrixWorkspaceApp','wfica32','receiver','Synergy','synergyc','synergys',
    'MouseWithoutBorders','ShareMouse','InputDirector','rustdesk','chrome_remote_desktop_host')
$remoteRunning = Get-Process -ErrorAction SilentlyContinue | Where-Object { $remoteNames -contains $_.ProcessName }
if ($remoteRunning) {
    @($remoteRunning) | ForEach-Object { Write-Log "  [DANG CHAY] $($_.ProcessName) (PID $($_.Id)) - $($_.Path)" }
    Write-Log "  [WARN] Co phan mem dieu khien tu xa/KVM qua mang - hay 'nuot' modifier key (Ctrl/Alt)"
    Write-Log "         khi chuyen focus giua may."
} else {
    Write-Log "  [OK] Khong thay phan mem remote-control/KVM pho bien dang chay."
}
try {
    $rdpSessions = & query user 2>$null
    if ($rdpSessions) { $rdpSessions | ForEach-Object { Write-Log "  Session: $_" } }
} catch { Write-Log "  [INFO] Khong chay duoc 'query user'." }

# --- 7. Toan bo Startup (de soi them) ---
Write-Section 7 "Toan bo Startup - de doi chieu them"
Write-Log "  -- HKCU Run --"
$hkcuRun = Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
if ($hkcuRun) { $hkcuRun.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { Write-Log "  $($_.Name) = $($_.Value)" } }
Write-Log "  -- HKLM Run --"
$hklmRun = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
if ($hklmRun) { $hklmRun.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { Write-Log "  $($_.Name) = $($_.Value)" } }
Write-Log "  -- Startup folder (User) --"
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -ErrorAction SilentlyContinue | ForEach-Object { Write-Log "  $($_.Name)" }
Write-Log "  -- Scheduled Task dang Enable (khong phai cua Microsoft) --"
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $_.State -ne 'Disabled' -and $_.TaskPath -notmatch '\\Microsoft\\'
} | ForEach-Object { Write-Log "  $($_.TaskPath)$($_.TaskName)" }

# --- 8. Process dang chay - khong thuoc Microsoft ---
Write-Section 8 "Process dang chay - khong thuoc Microsoft (doi chieu them)"
Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path -notmatch '\\Windows\\' -and $_.Company -notmatch 'Microsoft'
} | Select-Object ProcessName, Id, Company -Unique | Sort-Object ProcessName | ForEach-Object {
    Write-Log ("  {0,-28} PID={1,-7} {2}" -f $_.ProcessName, $_.Id, $_.Company)
}

# --- 9. Lich su Windows Update + driver ban phim/HID ---
Write-Section 9 "Lich su Windows Update (10 gan nhat) + driver ban phim/HID"
Get-HotFix -ErrorAction SilentlyContinue | Sort-Object InstalledOn -Descending | Select-Object -First 10 | ForEach-Object {
    Write-Log "  $($_.HotFixID)  $($_.InstalledOn)  $($_.Description)"
}
Write-Log "  -- Driver ban phim / HID --"
Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Where-Object {
    $_.DeviceClass -eq 'KEYBOARD' -or $_.DeviceClass -eq 'HIDCLASS'
} | Select-Object DeviceName, DriverVersion, DriverDate, DriverProviderName -Unique | ForEach-Object {
    Write-Log "  $($_.DeviceName) | v$($_.DriverVersion) | $($_.DriverDate) | $($_.DriverProviderName)"
}

# --- 10. Event Viewer - Application errors 7 ngay ---
Write-Section 10 "Event Viewer - Application errors (7 ngay gan day, Level=Error)"
try {
    $appErr = Get-WinEvent -FilterHashtable @{ LogName='Application'; Level=2; StartTime=(Get-Date).AddDays(-7) } -ErrorAction SilentlyContinue
    if ($appErr) {
        Write-Log "  Tong so loi: $(@($appErr).Count) - liet ke 15 loi gan nhat:"
        @($appErr) | Select-Object -First 15 | ForEach-Object {
            $msg = ($_.Message -replace "`r?`n", ' ')
            if ($msg.Length -gt 150) { $msg = $msg.Substring(0,150) + '...' }
            Write-Log "  [$($_.TimeCreated)] $($_.ProviderName): $msg"
        }
    } else {
        Write-Log "  [OK] Khong co Application error nao trong 7 ngay qua."
    }
} catch {
    Write-Log "  [INFO] Khong doc duoc Application log."
}

# --- 11. Ngon ngu / hotkey chuyen input method ---
Write-Section 11 "Ngon ngu dang cai + hotkey chuyen kieu go"
try {
    $langList = Get-WinUserLanguageList -ErrorAction SilentlyContinue
    if ($langList) {
        $langList | ForEach-Object { Write-Log "  Ngon ngu: $($_.LanguageTag) - InputMethodTips: $($_.InputMethodTips -join ', ')" }
    }
    $toggleHotkey = (Get-ItemProperty 'HKCU:\Keyboard Layout\Toggle' -ErrorAction SilentlyContinue).'Hotkey'
    $langHotkey = (Get-ItemProperty 'HKCU:\Keyboard Layout\Toggle' -ErrorAction SilentlyContinue).'Language Hotkey'
    Write-Log "  Hotkey chuyen Layout = $toggleHotkey (3=khong dung phim tat, 1=Ctrl+Shift kieu cu)"
    Write-Log "  Hotkey chuyen Language = $langHotkey"
    if ($toggleHotkey -eq '1' -or $langHotkey -eq '1') {
        Write-Log "  [WARN] Dang dung Ctrl+Shift lam hotkey chuyen ngon ngu/layout - de nham voi loi 'dinh Ctrl' khi go nhanh."
    }
} catch {
    Write-Log "  [INFO] Khong doc duoc cau hinh ngon ngu."
}

# --- Summary ---
Write-Log ""
Write-Log "=========================================="
Write-Log "  KET THUC CHAN DOAN"
Write-Log "  Log luu tai: $logFile"
Write-Log "=========================================="
Write-Log ""
Write-Log "BUOC TIEP THEO (dua theo bang chung o tren):"
Write-Log "  - Neu StickyKeys/FilterKeys BAT (muc 3): Tat trong Settings > Accessibility > Keyboard."
Write-Log "  - Neu co bo go tieng Viet / phan mem remap / remote-control dang chay (muc 4-6):"
Write-Log "      thoat tung phan mem 1, theo doi xem loi Ctrl co het khong (khoanh vung dan)."
Write-Log "  - Neu co filter driver la o tang Keyboard class (muc 2): rat dang nghi, can xac dinh"
Write-Log "      phan mem nao cai filter do (thuong la remote-control/anti-cheat/bao mat)."
Write-Log "  - Neu khong ket luan duoc: test lai loi bang On-Screen Keyboard (khong dung ban phim vat ly)"
Write-Log "      va test trong Safe Mode - het loi trong Safe Mode = chac chan do phan mem/driver"
Write-Log "      thu 3, khong phai Windows loi hay ban phim."
