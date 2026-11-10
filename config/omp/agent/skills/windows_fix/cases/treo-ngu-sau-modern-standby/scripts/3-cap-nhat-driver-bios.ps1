# =============================================================================
# CONG CU CAP NHAT DRIVER WIFI + BIOS - Lenovo ThinkBook 14 G5+ ARP (21HY)
# =============================================================================
# MUC DICH TONG THE:
#   Giup cap nhat driver WiFi MediaTek MT7921 (bản cu 2023 hay gay treo trong
#   che do tiet kiem dien) va BIOS cua may, theo cach AN TOAN - moi buoc deu
#   HOI nguoi dung xac nhan, va co GIA TRI MAC DINH de xuat neu chi bam Enter.
#
# CACH HOAT DONG (3 phuong thuc cho moi muc):
#   1) Tu dong tai tu Lenovo  - script thu doc danh muc (catalog) driver/BIOS
#                               cua dung model may, tai file .exe ve Downloads.
#   2) Mo trang web tai thu cong - neu tu dong khong duoc, mo trinh duyet de
#                               nguoi dung tu bam Download.
#   3) Cai tu file co san     - tim file .exe da tai trong Downloads va cai.
#
# AN TOAN:
#   - Khong tu y lam gi - moi buoc deu hoi Y/N (mac dinh de xuat san).
#   - Cai BIOS co kiem tra bat buoc: phai CAM SAC va PIN >= 50%.
#   - Co the dong script bat ky luc nao (Ctrl+C) ma khong hong gi.
#
# GHI CHU: De 1 file duy nhat cho de mang di chay - khong tach module.
# =============================================================================

# -----------------------------------------------------------------------------
# B0: Tu xin quyen Admin (UAC) neu chua co - can cho viec cai driver/BIOS.
# -----------------------------------------------------------------------------
$dangLaAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $dangLaAdmin) {
    Write-Host "Dang xin quyen Admin (hop thoai UAC se hien len)..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

# Thu muc tai ve mac dinh
$Downloads = Join-Path $env:USERPROFILE "Downloads"
# User-Agent gia lap trinh duyet de Lenovo khong chan
$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

# =============================================================================
# CAC HAM TIEN ICH
# =============================================================================

# Ham hoi xac nhan Y/N, co gia tri mac dinh (chi bam Enter = chon mac dinh).
function Hoi-XacNhan {
    param([string]$CauHoi, [string]$MacDinh = 'Y')
    $goiY = if ($MacDinh -match '^(y|Y)') { '[Y/n]' } else { '[y/N]' }
    $traLoi = Read-Host "  $CauHoi $goiY (Enter = $MacDinh)"
    if ([string]::IsNullOrWhiteSpace($traLoi)) { $traLoi = $MacDinh }
    return ($traLoi -match '^(y|Y)')
}

# Ham hoi chon 1 trong nhieu phuong thuc, co gia tri mac dinh.
function Hoi-ChonPhuongThuc {
    param([string]$TieuDe, [string[]]$LuaChon, [int]$MacDinh = 1)
    Write-Host "  $TieuDe" -ForegroundColor Cyan
    for ($i = 0; $i -lt $LuaChon.Count; $i++) {
        $danhDau = if (($i + 1) -eq $MacDinh) { " (de xuat)" } else { "" }
        Write-Host ("    [{0}] {1}{2}" -f ($i + 1), $LuaChon[$i], $danhDau)
    }
    $traLoi = Read-Host "  Chon (Enter = $MacDinh)"
    if ([string]::IsNullOrWhiteSpace($traLoi)) { return $MacDinh }
    $so = 0
    if ([int]::TryParse($traLoi, [ref]$so) -and $so -ge 1 -and $so -le $LuaChon.Count) { return $so }
    return $MacDinh
}

# Ham doc thong tin driver WiFi hien tai (tra ve version string).
function Lay-VersionWifi {
    $d = Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue |
        Where-Object { $_.DeviceName -match 'MT7921|MediaTek Wi-Fi' } | Select-Object -First 1
    if ($d) { return @{ Ver = $d.DriverVersion; Date = $d.DriverDate; Name = $d.DeviceName } }
    return $null
}

# Ham thu doc danh muc (catalog) cua Lenovo cho dung machine type, tra ve list
# cac goi {Title, Url(.exe), Category}. Tra ve mang rong neu khong doc duoc.
function Lay-DanhMucLenovo {
    param([string]$MachineType, [string]$LocCategory)  # LocCategory: 'WLAN' hoac 'BIOS'

    # Thu nhieu mau URL catalog pho bien cua Lenovo
    $mauUrl = @(
        "https://download.lenovo.com/catalog/${MachineType}_Win11.xml",
        "https://download.lenovo.com/catalog/${MachineType}_Win10.xml",
        "https://download.lenovo.com/catalog/${MachineType}_2_Win11.xml"
    )

    $catalog = $null
    foreach ($u in $mauUrl) {
        try {
            $r = Invoke-WebRequest -Uri $u -UseBasicParsing -UserAgent $UA -TimeoutSec 30 -ErrorAction Stop
            $catalog = [xml]$r.Content
            Write-Host ("    -> Doc duoc catalog: {0}" -f $u) -ForegroundColor Green
            break
        } catch { }
    }
    if ($null -eq $catalog) {
        Write-Host "    -> Khong doc duoc catalog tu Lenovo (co the bi chan mang / model rieng khu vuc)." -ForegroundColor Yellow
        return @()
    }

    # Catalog liet ke cac goi, moi goi tro toi 1 file mo ta (.xml). Phai mo file
    # mo ta de biet ten file .exe va tieu de goi.
    $ketQua = @()
    $dsGoi = @($catalog.packages.package)
    Write-Host ("    -> Co {0} goi, dang loc {1}..." -f $dsGoi.Count, $LocCategory) -ForegroundColor Cyan

    foreach ($goi in $dsGoi) {
        $locDescriptor = $goi.location
        if ([string]::IsNullOrWhiteSpace($locDescriptor)) { continue }
        try {
            $rd = Invoke-WebRequest -Uri $locDescriptor -UseBasicParsing -UserAgent $UA -TimeoutSec 20 -ErrorAction Stop
            $desc = [xml]$rd.Content
            $tieuDe = "$($desc.Package.Title.Desc.'#text')$($desc.Package.Title.Desc)"
            # Loc theo loai
            $khop = $false
            if ($LocCategory -eq 'WLAN' -and $tieuDe -match 'WLAN|Wireless|MediaTek|WiFi|Wi-Fi') { $khop = $true }
            if ($LocCategory -eq 'BIOS' -and $tieuDe -match 'BIOS|UEFI') { $khop = $true }
            if (-not $khop) { continue }

            # Ten file cai dat + tao URL .exe (cung thu muc voi file mo ta)
            $tenExe = $desc.Package.Files.Installer.File.Name
            if ([string]::IsNullOrWhiteSpace($tenExe)) { $tenExe = $desc.Package.Files.Installer.Name }
            $thuMucGoc = $locDescriptor.Substring(0, $locDescriptor.LastIndexOf('/') + 1)
            $urlExe = $thuMucGoc + $tenExe
            $ketQua += [pscustomobject]@{ Title = $tieuDe; Url = $urlExe; Version = $desc.Package.version }
        } catch { }
    }
    return $ketQua
}

# Ham tai 1 file ve Downloads, hien thi tien do don gian.
function Tai-File {
    param([string]$Url, [string]$ThuMucLuu)
    $ten = Split-Path $Url -Leaf
    $duongDan = Join-Path $ThuMucLuu $ten
    Write-Host ("    Dang tai: {0}" -f $ten) -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $Url -OutFile $duongDan -UseBasicParsing -UserAgent $UA -TimeoutSec 300 -ErrorAction Stop
        Write-Host ("    -> Da tai xong: {0}" -f $duongDan) -ForegroundColor Green
        return $duongDan
    } catch {
        Write-Host ("    -> LOI tai file: {0}" -f $_) -ForegroundColor Red
        return $null
    }
}

# Ham tim file .exe da tai trong Downloads theo tu khoa.
function Tim-FileTrongDownloads {
    param([string]$TuKhoa)
    return Get-ChildItem -Path $Downloads -Filter *.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match $TuKhoa } |
        Sort-Object LastWriteTime -Descending
}

# =============================================================================
# BAT DAU
# =============================================================================
Write-Host "`n===================================================================" -ForegroundColor Cyan
Write-Host " CONG CU CAP NHAT DRIVER WIFI + BIOS - Lenovo ThinkBook (21HY)" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# BUOC 1: Phat hien thong tin may (tu dong).
# -----------------------------------------------------------------------------
Write-Host "`n[BUOC 1] Phat hien thong tin may..." -ForegroundColor Green
$cs   = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$mt   = $cs.Model   # Machine type, vi du: 21HY
Write-Host ("  May        : {0} {1} (type {2})" -f $cs.Manufacturer, $cs.SystemFamily, $mt)
Write-Host ("  BIOS hien tai: {0}  (ngay {1})" -f $bios.SMBIOSBIOSVersion, $bios.ReleaseDate)
$wifi = Lay-VersionWifi
if ($wifi) { Write-Host ("  WiFi driver  : {0}  v{1}  (ngay {2})" -f $wifi.Name, $wifi.Ver, $wifi.Date) -ForegroundColor Yellow }

# =============================================================================
# BUOC 2: CAP NHAT DRIVER WIFI
# =============================================================================
Write-Host "`n[BUOC 2] CAP NHAT DRIVER WIFI" -ForegroundColor Green
if (Hoi-XacNhan "Ban co muon cap nhat driver WiFi khong?" 'Y') {

    $pt = Hoi-ChonPhuongThuc "Chon cach lay driver WiFi:" @(
        "Tu dong tai tu Lenovo (thu nghiem)",
        "Mo trang web de tai thu cong",
        "Cai tu file .exe co san trong Downloads"
    ) 1

    $fileDriver = $null

    switch ($pt) {
        1 {
            # Phuong thuc tu dong: doc catalog, tim goi WLAN, cho chon va tai.
            Write-Host "`n  Dang tim driver WLAN tu danh muc Lenovo..." -ForegroundColor Cyan
            $dsWlan = Lay-DanhMucLenovo -MachineType $mt -LocCategory 'WLAN'
            if ($dsWlan.Count -gt 0) {
                Write-Host "  Tim thay cac goi WLAN:" -ForegroundColor Green
                for ($i = 0; $i -lt $dsWlan.Count; $i++) { Write-Host ("    [{0}] {1} (v{2})" -f ($i+1), $dsWlan[$i].Title, $dsWlan[$i].Version) }
                $chon = Hoi-ChonPhuongThuc "Chon goi de tai:" ($dsWlan | ForEach-Object { $_.Title }) 1
                if (Hoi-XacNhan ("Tai goi '{0}' ?" -f $dsWlan[$chon-1].Title) 'Y') {
                    $fileDriver = Tai-File -Url $dsWlan[$chon-1].Url -ThuMucLuu $Downloads
                }
            } else {
                Write-Host "  Khong tu dong tim duoc. Chuyen sang mo web tai thu cong." -ForegroundColor Yellow
                $pt = 2
            }
        }
    }

    if ($pt -eq 2) {
        # Mo trang web de tai thu cong
        $url1 = "https://pcsupport.lenovo.com/products/$mt/downloads/driver-list/component?name=Networking%3A%20Wireless%20LAN"
        $url2 = "https://support.lenovo.com/us/en/downloads/ds568866"  # WLAN MT7921 (G7 ARP, cung chip - du phong)
        Write-Host "`n  Dang mo trang tai driver WiFi tren trinh duyet..." -ForegroundColor Cyan
        Write-Host ("    Trang dung model : {0}" -f $url1)
        Write-Host ("    Trang du phong   : {0}" -f $url2)
        Start-Process $url1
        Read-Host "`n  Sau khi tai xong file .exe vao Downloads, nhan Enter de tiep tuc"
        $pt = 3  # chuyen sang cai tu file vua tai
    }

    if ($pt -eq 3 -and -not $fileDriver) {
        # Cai tu file co san trong Downloads
        $uv = Tim-FileTrongDownloads 'wlan|mtk|mediatek|7921|wireless|wifi'
        if (-not $uv) {
            Write-Host "  Khong thay file driver WiFi nao trong Downloads. Bo qua buoc nay." -ForegroundColor Yellow
        } elseif ($uv.Count -gt 1) {
            $c = Hoi-ChonPhuongThuc "Chon file driver de cai:" ($uv | ForEach-Object { "$($_.Name)  ($($_.LastWriteTime))" }) 1
            $fileDriver = $uv[$c-1].FullName
        } else {
            $fileDriver = $uv[0].FullName
        }
    }

    # Tien hanh cai driver neu da co file
    if ($fileDriver) {
        if (Hoi-XacNhan ("Cai driver tu '{0}' ?" -f (Split-Path $fileDriver -Leaf)) 'Y') {
            Write-Host "  Dang chay trinh cai driver... (lam theo wizard neu hien)" -ForegroundColor Cyan
            $p = Start-Process -FilePath $fileDriver -Wait -PassThru
            Write-Host ("  Trinh cai ket thuc (ma thoat {0})." -f $p.ExitCode) -ForegroundColor Green
            Start-Sleep -Seconds 2
            $wifiMoi = Lay-VersionWifi
            if ($wifiMoi -and $wifi -and $wifiMoi.Ver -ne $wifi.Ver) {
                Write-Host ("  ===> THANH CONG: WiFi driver {0} -> {1}" -f $wifi.Ver, $wifiMoi.Ver) -ForegroundColor Green
            } elseif ($wifiMoi) {
                Write-Host ("  Version hien tai: {0} (co the can khoi dong lai de ap dung)" -f $wifiMoi.Ver) -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "  Bo qua cap nhat driver WiFi." -ForegroundColor Yellow
}

# =============================================================================
# BUOC 3: CAP NHAT BIOS
# =============================================================================
Write-Host "`n[BUOC 3] CAP NHAT BIOS" -ForegroundColor Green
Write-Host "  CANH BAO: Cap nhat BIOS co rui ro. Neu mat dien giua chung co the" -ForegroundColor Red
Write-Host "            hong may. Chi lam khi can va dam bao nguon dien on dinh." -ForegroundColor Red

# Mac dinh de xuat la KHONG (N) vi BIOS rui ro hon driver.
if (Hoi-XacNhan "Ban co muon kiem tra / cap nhat BIOS khong?" 'N') {

    # Kiem tra an toan BAT BUOC: phai cam sac va pin >= 50%.
    $pin = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
    $camSac = $false; $mucPin = 100
    if ($pin) { $camSac = ($pin.BatteryStatus -eq 2); $mucPin = [int]$pin.EstimatedChargeRemaining }
    Write-Host ("  Trang thai nguon: {0} | Pin: {1}%" -f ($(if($camSac){'DANG CAM SAC'}else{'CHAY PIN'}), $mucPin))

    if (-not $camSac -or $mucPin -lt 50) {
        Write-Host "  !! KHONG AN TOAN de flash BIOS: can CAM SAC va PIN >= 50%." -ForegroundColor Red
        Write-Host "     Hay cam sac roi chay lai. Bo qua buoc BIOS." -ForegroundColor Red
    } else {
        $ptB = Hoi-ChonPhuongThuc "Chon cach lay BIOS:" @(
            "Tu dong tai tu Lenovo (thu nghiem)",
            "Mo trang web de tai thu cong",
            "Cai tu file BIOS .exe co san trong Downloads"
        ) 2  # mac dinh de xuat 'mo web' cho BIOS de nguoi dung tu kiem tra ky

        $fileBios = $null

        if ($ptB -eq 1) {
            Write-Host "`n  Dang tim BIOS tu danh muc Lenovo..." -ForegroundColor Cyan
            $dsBios = Lay-DanhMucLenovo -MachineType $mt -LocCategory 'BIOS'
            if ($dsBios.Count -gt 0) {
                $c = Hoi-ChonPhuongThuc "Chon goi BIOS de tai:" ($dsBios | ForEach-Object { "$($_.Title) (v$($_.Version))" }) 1
                if (Hoi-XacNhan ("Tai BIOS '{0}' ?" -f $dsBios[$c-1].Title) 'Y') {
                    $fileBios = Tai-File -Url $dsBios[$c-1].Url -ThuMucLuu $Downloads
                }
            } else { Write-Host "  Khong tu dong tim duoc BIOS. Chuyen sang mo web." -ForegroundColor Yellow; $ptB = 2 }
        }

        if ($ptB -eq 2) {
            $urlB = "https://pcsupport.lenovo.com/products/$mt/downloads/driver-list/component?name=BIOS%2FUEFI"
            Write-Host "`n  Dang mo trang tai BIOS..." -ForegroundColor Cyan
            Write-Host ("    {0}" -f $urlB)
            Start-Process $urlB
            Read-Host "`n  Sau khi tai xong file BIOS .exe vao Downloads, nhan Enter de tiep tuc"
            $ptB = 3
        }

        if ($ptB -eq 3 -and -not $fileBios) {
            $uvB = Tim-FileTrongDownloads 'bios|uefi|n3.*ww|fwupdate'  # ten file BIOS Lenovo thuong la nXXww...
            if (-not $uvB) {
                Write-Host "  Khong thay file BIOS nao trong Downloads. Bo qua." -ForegroundColor Yellow
            } else {
                $c = Hoi-ChonPhuongThuc "Chon file BIOS de cai:" ($uvB | ForEach-Object { "$($_.Name)  ($($_.LastWriteTime))" }) 1
                $fileBios = $uvB[$c-1].FullName
            }
        }

        # Cai BIOS - xac nhan lan cuoi (rat quan trong)
        if ($fileBios) {
            Write-Host "`n  !! SAP CAP NHAT BIOS - May se TU KHOI DONG LAI trong qua trinh." -ForegroundColor Red
            Write-Host "     Luu het cong viec, dong cac ung dung khac TRUOC khi tiep tuc." -ForegroundColor Red
            if (Hoi-XacNhan ("Da luu het va san sang flash BIOS tu '{0}' ?" -f (Split-Path $fileBios -Leaf)) 'N') {
                Write-Host "  Dang chay trinh cap nhat BIOS... lam theo huong dan, KHONG tat may." -ForegroundColor Cyan
                Start-Process -FilePath $fileBios -Wait
                Write-Host "  Trinh BIOS da khoi chay xong. May co the yeu cau khoi dong lai de flash." -ForegroundColor Green
            } else {
                Write-Host "  Da huy cap nhat BIOS." -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "  Bo qua cap nhat BIOS." -ForegroundColor Yellow
}

# =============================================================================
# KET THUC
# =============================================================================
Write-Host "`n===================================================================" -ForegroundColor Cyan
Write-Host " HOAN TAT. Neu da cai driver/BIOS, NEN KHOI DONG LAI MAY." -ForegroundColor Green
Write-Host "===================================================================" -ForegroundColor Cyan
Read-Host "Nhan Enter de dong cua so"
