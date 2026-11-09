---
name: windows-cleanup-pipeline
description: "Chuyên gia dọn dẹp Windows — phân tích đĩa và thực thi cleanup pipeline an toàn (cache dev, temp, orphans, WizTree) từ 101.AI/CleanPC."
---

## 🚀 Chuyên gia dọn dẹp Windows (Global)

Skill này gọi hệ thống dọn dẹp được cấu hình sẵn tại:
`D:\200_GDrive\101.AI\CleanPC\01_Windows\CMD\RUN_ALL_CLEANUP.bat`

Khi user yêu cầu dọn dẹp ổ C, dọn rác, dọn bộ nhớ đệm lập trình (npm, pip, docker, venv...), hãy đề xuất các lệnh sau:

```cmd
# 1. PREVIEW / DRY RUN (Xem trước dung lượng, KHÔNG xóa):
D:\200_GDrive\101.AI\CleanPC\01_Windows\CMD\RUN_ALL_CLEANUP.bat --dry-run

# 2. QUICK CLEAN (Dọn nhanh 3-5 phút: Dev caches, Browsers, User/System Temp):
D:\200_GDrive\101.AI\CleanPC\01_Windows\CMD\RUN_ALL_CLEANUP.bat --quick

# 3. FULL CLEAN (Dọn toàn diện 12 modules):
D:\200_GDrive\101.AI\CleanPC\01_Windows\CMD\RUN_ALL_CLEANUP.bat --full
```

### 🌳 Khắc phục ổ cứng đầy bằng WizTree
Nếu user phản ánh ổ đĩa vẫn đầy sau khi chạy script, hãy yêu cầu họ chạy công cụ phân tích MFT siêu tốc:
```cmd
D:\200_GDrive\101.AI\CleanPC\01_Windows\CMD\Run_WizTree_Analysis.bat
```
Sau đó yêu cầu họ cung cấp Top 10 file/folder lớn nhất để bạn hướng dẫn xử lý (như tắt `hiberfil.sys`, nén đĩa ảo Docker `ext4.vhdx`, chuyển `pagefile.sys`).

### ⚠️ Quy tắc an toàn:
- KHÔNG BAO GIỜ tự sinh lệnh `rmdir /s /q` hay `Remove-Item` trực tiếp vào các thư mục `%APPDATA%`, `%LOCALAPPDATA%` hoặc ổ `C:\`. Mọi thao tác dọn dẹp phải đi qua `RUN_ALL_CLEANUP.bat`.
