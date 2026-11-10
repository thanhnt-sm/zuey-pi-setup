# Tìm & Fix Lỗi Windows: Phím Ctrl (trái) không ăn / bị dính

Bộ công cụ điều tra lỗi phím **Ctrl** hoạt động bất thường (bấm không ăn, phải bấm lại
nhiều lần — hoặc ở dạng khác: cảm giác như bị "dính") trên máy **không phải do bàn
phím vật lý** (đã tự kiểm chứng bằng cách đổi bàn phím khác vẫn bị).

> 🔍 **Trạng thái: đang xác minh** — đã loại trừ được nhiều nguyên nhân, tìm và sửa 1
> bug thật trong 1 công cụ tự viết (nhưng bug đó KHÔNG phải nguyên nhân hiện tại theo
> xác nhận của người dùng), nghi phạm còn lại là **UniKey**. Cập nhật README này +
> đổi trạng thái thành "Đã giải quyết" sau khi có xác nhận cuối cùng.

## Triệu chứng nhận biết
- Bấm `Ctrl` (hoặc tổ hợp `Ctrl+C`, `Ctrl+V`, `Ctrl+Z`...) không có tác dụng ngay,
  phải bấm lại nhiều lần mới ăn.
- Xảy ra thường xuyên, không theo quy luật rõ ràng.
- **Không phải do bàn phím vật lý** — đổi bàn phím khác vẫn bị.

## Đã loại trừ (không phải nguyên nhân)
| Nguyên nhân khả nghi | Kết quả kiểm tra |
|---|---|
| Bàn phím/driver vật lý | Chỉ có driver chuẩn Microsoft, không có driver lạ |
| StickyKeys / FilterKeys (Windows Accessibility) | Đang TẮT |
| Filter driver lạ ở tầng Keyboard class | Chỉ có `kbdclass` chuẩn của Windows |
| Phần mềm gaming/macro/remap (Logitech, Razer, AutoHotkey...) | Không thấy chạy |
| Phần mềm remote-control (TeamViewer, AnyDesk...) | Không thấy đang hoạt động |
| Mã độc/keylogger lạ | Không thấy tiến trình/startup bất thường (nhưng **chưa quét AV đầy đủ**) |
| **`SwapInsHome`** (công cụ tự viết remap Insert→Home, xem `cases/../06_swap_ins_keyboard`) | Có 2 bug thật (đã sửa, xem bên dưới) nhưng task auto-start đã Disabled ~2 tuần và lỗi Ctrl vẫn xảy ra bình thường trong lúc đó → **không phải nguyên nhân hiện tại** |
| Công cụ tự viết khác có hook bàn phím | Đã grep toàn bộ `<local-workspace>` cho `SetWindowsHookEx`/`WH_KEYBOARD_LL` — không có công cụ nào khác ngoài SwapInsHome |

## Nghi phạm mạnh nhất hiện tại: USB Power Management (đã áp dụng fix)
- Cài đặt Windows **"Allow the computer to turn off this device to save power"**
  (Device Manager > thiết bị > tab Power Management) đang **BẬT** cho bộ điều khiển
  bàn phím + touchpad built-in (`VID_0461&PID_4002`, cả MI_00 và MI_01).
- Khác với "USB selective suspend" (cài đặt toàn cục trong Power Plan — đã kiểm tra,
  đang TẮT, ổn) — đây là cờ tiết kiệm điện **riêng từng thiết bị**, vẫn có thể khiến
  Windows tự "ngủ" bộ điều khiển bàn phím khi idle vài giây, và **phím bấm đầu tiên
  sau đó bị bỏ lỡ** khi thiết bị "thức dậy" — khớp rất chính xác với triệu chứng
  "bấm Ctrl không ăn, phải bấm lại" (Ctrl thường là phím đầu tiên trong tổ hợp, bấm
  ngay sau khi ngừng gõ để nghĩ).
- Đây là nguyên nhân kinh điển trên laptop, **không cần lỗi phần mềm nào** để xảy ra.
- **Đã áp dụng fix**: `scripts/2-fix-tat-usb-power-save-ban-phim.ps1` — tắt cờ này cho
  2 thiết bị liên quan, xác nhận `AllowPowerOff=False` sau khi chạy. Hoàn tác bằng
  `scripts/3-hoan-tac-usb-power-save.ps1` nếu cần.
- **Đang theo dõi**: cần vài ngày sử dụng để xác nhận lỗi Ctrl có hết hẳn không.

## Nghi phạm phụ: UniKey
- Đang chạy (`<local-workspace>`), tự khởi động cùng Windows, bản 4.6 RC2.
- Cơ chế: dùng low-level keyboard hook để "chặn" mọi phím rồi chuyển đổi ký tự tiếng Việt.
  Phím tắt chuyển Việt/Anh đang là mặc định **Ctrl+Shift**.
- Máy cũng có "Tiếng Việt" cài như 1 ngôn ngữ riêng của Windows (`Get-WinUserLanguageList`)
  — cần kiểm tra xem có bộ gõ Windows nào chạy song song UniKey không.
- **Chưa xác nhận 100%** — Windows không có cách liệt kê chính xác hook nào đang cài qua
  PowerShell thuần. Cách xác nhận: tắt UniKey hẳn 1 thời gian và theo dõi.

## Bug đã tìm và SỬA trong `SwapInsHome` (dù không phải nguyên nhân hiện tại, vẫn là bug thật)
Xem chi tiết: `../../../06_swap_ins_keyboard/README.md` (mục Changelog).
1. **Không debounce `WM_DEVICECHANGE`** → bật/tắt hook bàn phím dồn dập trong vài chục ms
   mỗi khi có thiết bị USB thay đổi → có thể làm rớt/trễ phím đang gõ đúng lúc đó.
2. **Nhận nhầm bàn phím built-in của laptop là "bàn phím rời"** → hook gần như luôn kích
   hoạt bất kể có cắm bàn phím ngoài hay không, làm bug #1 dễ xảy ra hơn.

Đã sửa cả 2 (debounce 400ms + loại trừ VID/PID bàn phím built-in), build lại
`SwapInsHome.exe`, đã test xác nhận `hasUsbKb=False` đúng khi không có bàn phím rời
thật. **Không** bật lại task auto-start (đang giữ Disabled theo yêu cầu).

## Cách dùng lại
```powershell
cd "<local-workspace>"
powershell -ExecutionPolicy Bypass -File ".\scripts\1-chan-doan.ps1"   # chan doan tong hop, chi doc
```

## Các file
| File | Tác dụng |
|---|---|
| `scripts/1-chan-doan.ps1` | Chẩn đoán read-only: Device Manager, filter driver, Accessibility, IME, phần mềm hook, startup, Windows Update, Event Viewer, ngôn ngữ gõ |
| `scripts/logs/` | Log kết quả mỗi lần chạy (có timestamp) |
