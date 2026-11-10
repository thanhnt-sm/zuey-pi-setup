---
name: windows-cleanup-pipeline
description: "Chuyên gia dọn dẹp Windows — phân tích đĩa và thực thi cleanup pipeline an toàn (cache dev, temp, orphans, WizTree) từ 101.AI/CleanPC."
---

## 🚀 Chuyên gia dọn dẹp Windows (Global)

Skill này phối hợp với bộ công cụ đa nền tảng `skill://system-maintenance-suite` (hoặc script CleanPC cục bộ nếu `$CLEANPC_DIR` được cấu hình).

Khi user yêu cầu dọn dẹp ổ đĩa, dọn rác, dọn bộ nhớ đệm lập trình (npm, pip, docker, venv...), luôn chạy preview/dry-run trước qua `system-maintenance-suite`:

```bash
# 1. PREVIEW / DRY RUN (Xem trước dung lượng, KHÔNG xóa):
python3 ~/.omp/agent/skills/system-maintenance-suite/scripts/maintenance_cli.py --cmd analyze --dry-run

# 2. QUICK / FULL CLEAN (Chỉ chạy sau khi user xác nhận danh sách từ dry-run):
python3 ~/.omp/agent/skills/system-maintenance-suite/scripts/maintenance_cli.py --cmd clean --mode quick --force
python3 ~/.omp/agent/skills/system-maintenance-suite/scripts/maintenance_cli.py --cmd clean --mode full --force
```

### 🌳 Khắc phục ổ cứng đầy bằng WizTree / Disk Analyzer
Nếu user phản ánh ổ đĩa vẫn đầy sau khi dọn cache, chạy analyzer để tìm file/folder lớn nhất (`hiberfil.sys`, Docker `ext4.vhdx`, `pagefile.sys`, `~/Library/Caches` trên macOS) — ưu tiên `skill://wiztree-cli-analyzer` trên Windows hoặc `du`/`ncdu` trên macOS.

### ⚠️ Quy tắc an toàn:
- KHÔNG BAO GIỜ tự sinh lệnh `rmdir /s /q` hay `Remove-Item` trực tiếp vào `%APPDATA%`, `%LOCALAPPDATA%`, `~/Library` hoặc root ổ đĩa mà chưa chạy `--dry-run`. Mọi thao tác dọn dẹp phải đi qua `maintenance_cli.py` hoặc script có xác nhận rõ ràng.
