# Hướng dẫn Backup & Restore Oh-My-Pi (omp) sang macOS M1 / Máy mới

Tài liệu hướng dẫn quy trình đóng gói toàn bộ cấu hình **Oh-My-Pi (omp)** kết hợp cùng setup giao diện/tiện ích từ **zuey-pi**, khử toàn bộ secret/token nhạy cảm, đưa lên Git fork để có thể khôi phục 100% trên **macOS M1 (Apple Silicon)** hoặc bất kỳ máy nào khi cần dựng lại.

---

## 1. Cấu trúc sau khi hợp nhất trong Workspace

```
zuey-pi-setup/
├── config/
│   ├── pi/                             # Setup gốc của zuey-pi
│   └── omp/                            # Setup Oh-My-Pi (đã làm sạch bí mật)
│       ├── agent/
│       │   ├── config.yml              # Đã template hóa shellPath: {{SHELL_PATH}}
│       │   ├── models.yml              # Đã chuyển toàn bộ apiKey sang !printenv
│       │   ├── .env.example            # Mẫu biến môi trường (TYPESAFE_API_KEY,...)
│       │   ├── commandcode-models.json
│       │   ├── APPEND_SYSTEM.md        # System prompt mở rộng từ zuey
│       │   ├── extensions/             # Local TS extensions (orca, compaction-policy, pi-footer, typesafe-planner)
│       │   └── managed-skills/         # Bộ kỹ năng tự động học (Mnemopi/Managed skills)
│       ├── .omp-syncignore         # Danh sách chặn plugin xung đột (pi-lens, pi-advisor-flow,...)
│       └── plugins/
│           ├── package.json            # Plugin hợp nhất (pi-footer, pi-smart-fetch, computer-use,...)
│           ├── omp-plugins.lock.json
│           └── bun.lock
├── scripts/
│   ├── omp-sync-upstream.sh        # Script đồng bộ an toàn từ upstream (zero-merge, pinned versions)
│   ├── omp-setup-backup.sh         # Script đóng gói & lọc sạch secret
│   ├── omp-setup-restore.sh        # Script phục hồi đa nền tảng (tự nhận diện macOS M1)
│   ├── pi-setup-backup.sh          # Script backup gốc của pi
│   └── pi-setup-restore.sh         # Script restore gốc của pi
├── tests/
│   ├── test-omp-syncignore.sh      # TDD test kiểm tra lọc plugin & giữ nguyên version pinned
│   ├── test-omp-sync-extraction.sh # TDD test kiểm tra cô lập git show (không gây bẩn git HEAD)
│   └── test-omp-migration.sh       # Bộ kiểm thử TDD xác minh an toàn dữ liệu
└── backups/
    ├── omp-setup-portable.tar.gz       # Bundle nén sạch của omp
    └── pi-setup-portable.tar.gz        # Bundle nén gốc của pi
```

---

## 2. Vì sao có giải pháp này & Khử trùng lặp (Deduplication)

Khi kết hợp `zuey-pi` và `omp`, hai hệ thống có một số thành phần chồng lấn. Workspace này đã giải quyết xung đột bằng nguyên tắc:

| Thành phần | zuey-pi | omp (Hiện tại) | Giải pháp hợp nhất |
| :--- | :--- | :--- | :--- |
| **Advisor Model** | `pi-advisor-flow` | Native trong `config.yml` | **Dùng omp native** (tránh gọi model 2 lần gây tốn token và lag). |
| **Model Fallback** | `pi-model-fallback` | `retry.fallbackChains` | **Dùng omp native** (cấu hình chuỗi fallback chuẩn hóa trong YAML). |
| **LSP** | `pi-lens` | `task.enableLsp: true` | **Dùng omp native**. |
| **Statusline** | `pi-footer` (3 hàng) | `orca-*` | **Kết hợp:** Dùng `pi-footer` làm thanh trạng thái 3 hàng hiển thị context bar, TPS, và dùng `orca` spinner/titlebar. |
| **Compaction** | `compaction-policy.ts` | Mặc định | **Kế thừa `compaction-policy.ts`** từ zuey-pi đưa vào `extensions/` của omp. |

---

## 3. Cách tạo Backup trên máy hiện tại (Windows)

Mỗi khi bạn thay đổi cấu hình, thêm skill hoặc cài thêm plugin trên máy hiện tại, chỉ cần chạy lệnh sau trong **Git Bash**:

```bash
# 1. Chạy script backup: tự lọc secret, loại trừ file DB SQLite, nén tarball và mirror vào config/omp
./scripts/omp-setup-backup.sh --source ~/.omp --config-dir config/omp -o backups/omp-setup-portable.tar.gz

# 2. Kiểm tra git status xem có thay đổi mới không
git status

# 3. Commit và đẩy lên fork của bạn
git add config/omp scripts/ tests/ backups/omp-setup-portable.tar.gz docs/
git commit -m "feat(omp): update portable omp snapshot with sanitized secrets"
git push origin main
```

---

## 4. Cách Khôi phục trên máy mới (macOS M1 / Apple Silicon)

Trên máy Mac M1 mới:

### Bước 1: Chuẩn bị môi trường trên macOS
Mở **Terminal** (zsh mặc định trên macOS) và cài đặt `bun` nếu chưa có:
```bash
curl -fsSL https://bun.sh/install | bash
```

### Bước 2: Clone fork về máy
```bash
git clone https://github.com/thanhnt-sm/zuey-pi-setup.git
cd zuey-pi-setup
```

### Bước 3: Chạy Restore Script
Chỉ cần chạy một lệnh duy nhất:
```bash
./scripts/omp-setup-restore.sh
```

**Script sẽ tự động:**
1. Phát hiện hệ điều hành là **Darwin (macOS M1)**.
2. Tự động chuyển đổi `shellPath: {{SHELL_PATH}}` trong `config.yml` thành `/bin/zsh`.
3. Giải nén toàn bộ extensions, managed skills, models, và plugins vào `~/.omp/`.
4. Sinh file `~/.omp/agent/.env` từ `.env.example`.
5. Tự động chạy `bun install` trong `~/.omp/plugins` để cài đặt tương thích với kiến trúc ARM64 của chip Apple Silicon.

### Bước 4: Khai báo API Key (chỉ 1 lần duy nhất)
Mở file `~/.omp/agent/.env` vừa được tạo và điền các API key của bạn:
```bash
nano ~/.omp/agent/.env
```
Nội dung mẫu:
```env
TYPESAFE_API_KEY=your_typesafe_key_here
ZAI_API_KEY=your_zai_key_here
```

### Bước 5: Khởi động Oh-My-Pi
```bash
omp
```
Toàn bộ giao diện 3 hàng, các model cấu hình sẵn, managed skills và bộ planner của bạn đã sẵn sàng hoạt động y như máy cũ!

---

## 5. Kiểm thử TDD (Automated Tests)

Để bảo đảm an toàn trước khi đẩy lên Git (không rò rỉ secret, không dính binary Windows, không dính DB cache), bạn có thể chạy bộ test bất kỳ lúc nào:

```bash
./tests/test-omp-migration.sh
```

Nếu tất cả các tiêu chí bảo mật và tính tương thích được thỏa mãn, terminal sẽ xuất:
```
=== ALL TDD TESTS PASSED ===
```

---

## 6. Đồng bộ an toàn từ Upstream (Upstream Synchronization)

Khi repository gốc `zuey-pi` có cập nhật mới (như thay đổi prompt, giao diện footer, hoặc update compaction policy), bạn **không nên** dùng `git merge` vì sẽ gây xung đột lịch sử Git và kéo về các plugin không tương thích (`pi-lens`, `pi-advisor-flow`, `pi-model-fallback`).

Thay vào đó, sử dụng orchestrator an toàn:

```bash
./scripts/omp-sync-upstream.sh
```

### Cơ chế hoạt động:
1. **Zero Git Merge Pollution**: Dùng `git fetch upstream` kết hợp `git show upstream/main:<path>` để trích xuất file cấu hình an toàn mà không làm thay đổi hay phân nhánh `HEAD` của bạn.
2. **Declarative Blocklist (`.omp-syncignore`)**: Tự động loại bỏ các plugin upstream gây xung đột với nhân OMP.
3. **Supply-Chain Security & Version Pinning**: Bảo toàn tuyệt đối version được ghim (pinned versions); từ chối toàn bộ wildcard `*` hoặc `latest` từ upstream.
4. **Conditional Backup**: Tự động phát hiện thay đổi và kích hoạt backup snapshot nếu có cập nhật mới.

Chạy kiểm thử cho bộ đồng bộ:
```bash
./tests/test-omp-syncignore.sh
./tests/test-omp-sync-extraction.sh
```
