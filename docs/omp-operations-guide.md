# Cẩm Nang Vận Hành & Hướng Dẫn Sử Dụng Toàn Diện Oh-My-Pi (omp)

> **Mục tiêu**: Tài liệu chuẩn hóa toàn bộ quy trình vận hành, sao lưu, khôi phục, đồng bộ và xử lý mọi sự cố ngoại lệ của hệ thống **Oh-My-Pi (omp)** kết hợp tiện ích từ **zuey-pi** trên đa nền tảng (**macOS Apple Silicon M1/M2/M3/M4**, **Linux**, **Windows Git Bash**).

---

## MỤC LỤC
1. [Kiến trúc & Bản đồ Dữ liệu 3 Tầng](#1-kiến-trúc--bản-đồ-dữ-liệu-3-tầng)
2. [Quy trình Vận hành Chuẩn (SOP)](#2-quy-trình-vận-hành-chuẩn-sop)
   - [SOP-01: Tạo bản sao lưu định kỳ trên máy nguồn](#sop-01-tạo-bản-sao-lưu-định-kỳ-trên-máy-nguồn)
   - [SOP-02: Khôi phục toàn diện trên máy mới (macOS Apple Silicon)](#sop-02-khôi-phục-toàn-diện-trên-máy-mới-macos-apple-silicon)
   - [SOP-03: Khôi phục trên máy Linux hoặc Windows mới](#sop-03-khôi-phục-trên-máy-linux-hoặc-windows-mới)
   - [SOP-04: Đồng bộ an toàn từ Upstream zuey-pi](#sop-04-đồng-bộ-an-toàn-từ-upstream-zuey-pi)
   - [SOP-05: Kiểm thử TDD trước khi đẩy code](#sop-05-kiểm-thử-tdd-trước-khi-đẩy-code)
3. [Cẩm nang Xử lý Mọi Sự Cố & Tình Huống Ngoại Lệ](#3-cẩm-nang-xử-lý-mọi-sự-cố--tình-huống-ngoại-lệ)
   - [Tình huống 1: GPG bị treo / freeze khi restore trên macOS M1](#tình-huống-1-gpg-bị-treo--freeze-khi-restore-trên-macos-m1)
   - [Tình huống 2: Bun / npm lỗi lockfile hoặc giải nén tarball plugin](#tình-huống-2-bun--npm-lỗi-lockfile-hoặc-giải-nén-tarball-plugin)
   - [Tình huống 3: Mất file mật khẩu hoặc quên passphrase GPG](#tình-huống-3-mất-file-mật-khẩu-hoặc-quên-passphrase-gpg)
   - [Tình huống 4: SQLite Database Locked hoặc xung đột WAL/SHM](#tình-huống-4-sqlite-database-locked-hoặc-xung-đột-walshm)
   - [Tình huống 5: Khôi phục trong môi trường Headless / SSH / Không có GUI](#tình-huống-5-khôi-phục-trong-môi-trường-headless--ssh--không-có-gui)
   - [Tình huống 6: Xung đột đường dẫn Shell giữa các HĐH](#tình-huống-6-xung-đột-đường-dẫn-shell-giữa-các-hđh)
   - [Tình huống 7: Nguyên tắc đồng bộ 1 chiều (Tránh mất cấu hình mới)](#tình-huống-7-nguyên-tắc-đồng-bộ-1-chiều-tránh-mất-cấu-hình-mới)
4. [Bảng Tra Cứu Lệnh Vận Hành Tức Thì (Cheat Sheet)](#4-bảng-tra-cứu-lệnh-vận-hành-tức-thì-cheat-sheet)

---

## 1. Kiến trúc & Bản đồ Dữ liệu 3 Tầng

Hệ thống phân tách rạch ròi 3 nhóm dữ liệu để đảm bảo **tính di động cao**, **bảo mật 100% không lộ secret lên GitHub**, và **không làm rách cơ sở dữ liệu SQLite**:

```
                       ┌────────────────────────────────────────────────────────┐
                       │                   HỆ THỐNG DỮ LIỆU                     │
                       └────────────────────────────────────────────────────────┘
                                 │                           │
          ┌──────────────────────┴───────────┐      ┌────────┴───────────────────┐
          │                                  │      │                            │
   [TẦNG 1: PUBLIC PORTABLE]      [TẦNG 2: PRIVATE ENCRYPTED]             [TẦNG 3: EPHEMERAL HOST]
   - Tracked trên GitHub          - Lưu NGOÀI git worktree                - KHÔNG backup / Local only
   - config.yml (templated)       - Mã hóa AES-256 (GPG)                  - OAuth tokens (agent.db)
   - models.yml (!printenv)       - 22 Mnemopi memory banks               - SQLite WAL/SHM caches
   - extensions/ (dereferenced)   - history.db (prompt & recaps)          - Node modules / Binaries
   - managed-skills/              - TypeSafe Kit files                    - Lock files (*.lock)
   - package.json (no lockfile)   (omp-private-backup.sh)                 (Sinh lại trên máy mới)
   (omp-setup-backup.sh)
```

> **Lưu ý về Extensions Backup:** Thư mục `extensions/` được sao lưu dưới dạng snapshot vật lý (dereferenced symlink) để đảm bảo tính di động (portable). Trên máy mới, đây là bản Read-Only. Không nên phát triển trực tiếp mã nguồn extension (như `typesafe-planner`) trong thư mục phục hồi này vì nó sẽ không liên kết với repository quản lý gốc của extension đó.

| Tầng dữ liệu | Mục đích | Công cụ quản lý | Nơi lưu trữ | Tiêu chí an toàn |
| :--- | :--- | :--- | :--- | :--- |
| **Tầng 1: Public Portable Snapshot** | Tái tạo bộ khung cấu hình, tiện ích, extension trên máy mới | `./scripts/omp-setup-backup.sh` | `config/omp/` & `backups/omp-setup-portable.tar.gz` | Đã khử sạch secret (chuyển sang `!printenv`), không chứa file `.db`, không chứa lockfile chéo OS |
| **Tầng 2: Private Encrypted Archive** | Bảo toàn ký ức AI (mnemopi), lịch sử prompt, ClaudeKit code | `./scripts/omp-private-backup.sh` | `~/omp-private-backups/omp-private-<ts>.tar.gz.gpg` | Mã hóa đối xứng AES256, từ chối ghi vào thư mục git, dùng `VACUUM INTO` để snapshot DB an toàn |
| **Tầng 3: Ephemeral Host State** | Trạng thái máy tại runtime (OAuth, cache, logs) | Tự sinh khi chạy | Máy cục bộ (`~/.omp/`) | Không bao giờ export; OAuth xoay vòng theo máy; DB WAL tự dọn khi dừng |

---

## 2. Quy trình Vận hành Chuẩn (SOP)

### SOP-01: Tạo bản sao lưu định kỳ trên máy nguồn

Thực hiện khi bạn có cấu hình mới, vừa học thêm skill, hoặc muốn đồng bộ ký ức AI sang máy khác:

#### Bước 1: Chạy kiểm thử an toàn
```bash
# Đảm bảo Git Bash (Windows) hoặc Terminal (macOS/Linux)
./tests/test-omp-migration.sh
./tests/test-omp-private-restore.sh
```

#### Bước 2: Tạo bản Snapshot Portable (Đưa lên Git)
```bash
./scripts/omp-setup-backup.sh --source ~/.omp --config-dir config/omp -o backups/omp-setup-portable.tar.gz
```
*Script sẽ tự động dereference các extension shim, khử API key trong `models.yml`, sinh `.env.example`, và loại trừ lockfile.*

#### Bước 3: Tạo bản sao lưu riêng tư (Private Backup - Mã hóa GPG)
```bash
# Cách 1: Tự động dùng file passphrase (khuyến nghị cho CI / script)
OMP_BACKUP_PASSPHRASE_FILE=~/.omp-backup-pass ./scripts/omp-private-backup.sh --all

# Cách 2: Nhập mật khẩu thủ công trực tiếp từ bàn phím
./scripts/omp-private-backup.sh --all
```
*File nén mã hóa sẽ được lưu ngoài thư mục Git tại `~/omp-private-backups/omp-private-<timestamp>.tar.gz.gpg`.*

#### Bước 4: Commit và đẩy lên GitHub
```bash
git add config/omp/ backups/omp-setup-portable.tar.gz
git commit -m "chore(backup): update omp portable snapshot"
git push origin main
```

---

### SOP-02: Khôi phục toàn diện trên máy mới (macOS Apple Silicon)

#### Bước 1: Cài đặt công cụ nền tảng qua Homebrew
```bash
# Cài công cụ runtime và pinentry native cho chip M1/M2/M3/M4
brew install gnupg pinentry-mac bun git
```

#### Bước 2: Clone repository
```bash
git clone https://github.com/thanhnt-sm/zuey-pi-setup.git
cd zuey-pi-setup
```

#### Bước 3: Chạy Restore Setup Portable
```bash
./scripts/omp-setup-restore.sh
```
*Script sẽ tự động:*
- Đặt `shellPath: /bin/zsh`.
- Giải nén cấu hình sạch vào `~/.omp/`.
- Áp dụng các tiện ích bổ sung từ upstream overlay (`compaction-policy.ts`, `pi-footer`...).
- Chạy `bun install` để cài đặt plugin sạch.
- Tạo sẵn file mẫu `~/.omp/agent/.env`.

#### Bước 4: Khai báo API Key
Mở file môi trường và điền các khóa API của bạn:
```bash
nano ~/.omp/agent/.env
```
*(Điền `TYPESAFE_API_KEY`, `ZAI_API_KEY`, `CODEX_3RD_API_KEY`...)*.

#### Bước 5: Khôi phục Dữ liệu Riêng tư (Ký ức AI & Lịch sử)
Chuyển file `omp-private-<timestamp>.tar.gz.gpg` sang máy Mac (ví dụ để ở `~/Downloads/`):
```bash
# Đảm bảo omp đang tắt trước khi restore!
./scripts/omp-private-restore.sh ~/Downloads/omp-private-<timestamp>.tar.gz.gpg
```
*Nhập mật khẩu đã đặt ở Bước 3 của SOP-01. Script sẽ tự động gắn kết `GPG_TTY`, kích hoạt `pinentry-mac`, dọn dẹp lock cũ, và xóa file WAL tạm sau khi hoàn tất.*

#### Bước 6: Đăng nhập OAuth & Khởi chạy Oh-My-Pi
```bash
omp
```
Gõ `/login` trong omp để kích hoạt phiên làm việc cho từng provider (`google-antigravity`, `openai-codex`...).

---

### SOP-03: Khôi phục trên máy Linux hoặc Windows mới

#### Trên Linux (Ubuntu/Debian):
```bash
sudo apt update && sudo apt install -y gnupg tar curl git
# Cài đặt Bun:
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

git clone https://github.com/thanhnt-sm/zuey-pi-setup.git
cd zuey-pi-setup
./scripts/omp-setup-restore.sh
./scripts/omp-private-restore.sh /path/to/omp-private-<ts>.tar.gz.gpg
```

#### Trên Windows mới:
Yêu cầu bắt buộc cài đặt **Git for Windows** và mở **Git Bash**:
```bash
git clone https://github.com/thanhnt-sm/zuey-pi-setup.git
cd zuey-pi-setup
./scripts/omp-setup-restore.sh
./scripts/omp-private-restore.sh /c/Users/<user>/omp-private-<ts>.tar.gz.gpg
```

---

### SOP-04: Đồng bộ an toàn từ Upstream zuey-pi

Khi repository gốc (`mrgoonie/zuey-pi-setup`) có cải tiến giao diện hoặc logic mới, đồng bộ mà **không làm bẩn git HEAD hay đè mất cấu hình riêng**:

```bash
# 1. Chạy orchestrator trích xuất an toàn (zero git merge)
./scripts/omp-sync-upstream.sh

# 2. Chạy test xác nhận không kéo về plugin xung đột
./tests/test-omp-syncignore.sh
./tests/test-omp-sync-extraction.sh

# 3. Đóng gói lại tarball kèm overlay mới
./scripts/omp-setup-backup.sh --source ~/.omp --config-dir config/omp -o backups/omp-setup-portable.tar.gz

# 4. Commit kết quả
git add config/omp-upstream/ backups/omp-setup-portable.tar.gz
git commit -m "feat(sync): port latest upstream overlay"
git push origin main
```

---

### SOP-05: Kiểm thử TDD trước khi đẩy code

Bộ 4 bài test bảo vệ an toàn toàn diện:
```bash
# 1. Kiểm tra toàn diện backup/restore & bảo vệ secret/db:
./tests/test-omp-migration.sh

# 2. Kiểm tra bộ giải mã khôi phục riêng tư & bẫy lỗi macOS M1:
./tests/test-omp-private-restore.sh

# 3. Kiểm tra danh sách đen chống xung đột plugin:
./tests/test-omp-syncignore.sh

# 4. Kiểm tra khả năng trích xuất cô lập không bẩn Git HEAD:
./tests/test-omp-sync-extraction.sh
```

---

## 3. Cẩm nang Xử lý Mọi Sự Cố & Tình Huống Ngoại Lệ

---

### Tình huống 1: GPG bị treo / freeze khi restore trên macOS M1

#### Hiện tượng:
Lệnh restore dừng vô thời hạn ngay sau dòng:
```
gpg: directory '/Users/<user>/.gnupg' created
```
Hoặc terminal không phản hồi, không hiện bảng nhập mật khẩu.

#### Cơ chế nguyên nhân sâu xa:
1. **Thiếu TTY Binding**: Khi gpg chạy trong đường ống pipe (`gpg -d | tar`), `gpg-agent` không gắn kết được với terminal điều khiển do biến `GPG_TTY` chưa được export.
2. **Apple Silicon Path Mismatch**: Trên chip Apple Silicon, Homebrew cài tại `/opt/homebrew/bin/pinentry-mac`. Nếu config gpg trỏ về đường dẫn Intel cũ (`/usr/local/bin/pinentry-mac`) hoặc không tìm thấy binary GUI prompt, daemon sẽ stall.
3. **Deadlock Agent**: Một tiến trình `gpg-agent` cũ đang chạy ngầm bị treo, giữ file `*.lock` trong `~/.gnupg/`.

#### Cách khắc phục tự động:
Chỉ cần dùng script chính thức:
```bash
./scripts/omp-private-restore.sh /path/to/archive.tar.gz.gpg
```

#### Cách khắc phục thủ công nếu không dùng script:
```bash
# 1. Hủy toàn bộ agent treo và xóa lock cũ
killall gpg-agent 2>/dev/null || true
rm -f ~/.gnupg/*.lock

# 2. Khai báo TTY hiện tại cho terminal
export GPG_TTY=$(tty 2>/dev/null || echo /dev/tty)

# 3. Bật loopback pinentry trong cấu hình agent
echo "allow-loopback-pinentry" >> ~/.gnupg/gpg-agent.conf
gpgconf --kill gpg-agent

# 4. Giải mã với cờ ép buộc loopback
gpg --pinentry-mode loopback -d archive.tar.gz.gpg | tar -xzf - -C ~

# 5. Dọn dẹp WAL để tránh xung đột SQLite
find ~/.omp/agent \( -name "*.db-wal" -o -name "*.db-shm" \) -delete
```

---

### Tình huống 2: Bun / npm lỗi lockfile hoặc giải nén tarball plugin

#### Hiện tượng:
Khi chạy `./scripts/omp-setup-restore.sh`, terminal báo lỗi:
```
error: Unknown lockfile version at bun.lock:2:22
warn: Ignoring lockfile
error: Fail extracting tarball for "@mariozechner/pi-coding-agent"
```

#### Cơ chế nguyên nhân:
File `bun.lock` được sinh trên Windows với `lockfileVersion: 2` không tương thích với phiên bản Bun hoặc môi trường macOS M1. Khi Bun cố gắng bỏ qua lockfile và kéo lại tarball từ npm registry, bộ đệm cache cục bộ bị hỏng hoặc timeout mạng.

#### Cách khắc phục triệt để:
1. **Xóa sạch cache và lockfile cũ**:
   ```bash
   rm -rf ~/.omp/plugins/bun.lock ~/.omp/plugins/omp-plugins.lock.json ~/.omp/plugins/node_modules
   bun pm cache rm
   ```
2. **Cập nhật repo mới nhất** (bản snapshot mới nhất đã loại bỏ hoàn toàn lockfile rác):
   ```bash
   git pull origin main
   ./scripts/omp-setup-restore.sh
   ```
3. **Phương án dự phòng qua npm**:
   Nếu Bun tiếp tục gặp lỗi mạng từ máy chủ npm:
   ```bash
   ./scripts/omp-setup-restore.sh --no-install
   cd ~/.omp/plugins && npm install
   ```

---

### Tình huống 3: Mất file mật khẩu hoặc quên passphrase GPG

#### Hiện tượng:
Không thể giải mã file `omp-private-*.tar.gz.gpg` do quên mật khẩu hoặc file `~/.omp-backup-pass` bị xóa.

#### Biện pháp & Quy tắc phòng ngừa:
- Dữ liệu private được mã hóa bằng thuật toán đối xứng AES-256 tiêu chuẩn quân sự. Nếu mất hoàn toàn passphrase, **về mặt toán học không thể phục hồi dữ liệu**.
- **Quy tắc an toàn**:
  - File mật khẩu mặc định được đặt tại `~/.omp-backup-pass` với quyền truy cập bảo mật `chmod 600`.
  - Khi lưu trữ file mã hóa trên Google Drive / USB để mang sang máy Mac, luôn lưu mật khẩu vào một trình quản lý mật khẩu an toàn (1Password, Bitwarden, Apple Keychain) hoặc ghi chú bảo mật riêng.
  - Không bao giờ commit file `~/.omp-backup-pass` lên Git.

---

### Tình huống 4: SQLite Database Locked hoặc xung đột WAL/SHM

#### Hiện tượng:
Khi khởi động `omp` sau khi restore, gặp lỗi `database is locked`, `disk I/O error` hoặc memory banks không hiển thị dữ liệu cũ.

#### Cơ chế nguyên nhân:
1. Bạn đã chạy restore trong khi tiến trình `omp` vẫn đang chạy ngầm.
2. File `mnemopi.db-wal` hoặc `history.db-wal` cũ chưa được dọn dẹp, khiến SQLite cố gắng replay lại transaction log cũ không khớp với file database vừa được giải nén đè lên.

#### Cách khắc phục:
```bash
# 1. Tắt hoàn toàn tiến trình omp
killall omp 2>/dev/null || pkill -x omp 2>/dev/null || true

# 2. Xóa sạch mọi file log tạm WAL và SHM (lệnh chuẩn nhóm dấu ngoặc)
find ~/.omp/agent \( -name "*.db-wal" -o -name "*.db-shm" \) -delete

# 3. Khởi động lại omp
omp
```

---

### Tình huống 5: Khôi phục trong môi trường Headless / SSH / Không có GUI

#### Hiện tượng:
Restore trên server Linux, Docker container hoặc qua SSH không có màn hình hiển thị để bật hộp thoại `pinentry-mac` hay `pinentry-gtk`.

#### Cách khắc phục:
Sử dụng cờ `--pinentry-mode loopback` kết hợp `OMP_BACKUP_PASSPHRASE_FILE`:
```bash
# Tự động 100% không tương tác
OMP_BACKUP_PASSPHRASE_FILE=/path/to/passphrase.txt ./scripts/omp-private-restore.sh /path/to/archive.tar.gz.gpg
```
Script sẽ tự động nhận diện môi trường không có display GUI và chuyển hoàn toàn sang xử lý dòng lệnh (in-terminal loopback).

---

### Tình huống 6: Xung đột đường dẫn Shell giữa các HĐH

#### Hiện tượng:
Mang cấu hình từ Windows sang Mac nhưng omp cố gọi `C:\Program Files\Git\bin\bash.exe`, hoặc mang từ Mac sang Linux nhưng omp cố gọi `/bin/zsh` (trong khi Linux chỉ có `/bin/bash`).

#### Cơ chế tự sửa lỗi:
- `omp-setup-backup.sh` đã thay thế đường dẫn shell thành token mẫu `shellPath: {{SHELL_PATH}}`.
- Khi restore, `omp-setup-restore.sh` tự động dò tìm:
  - **macOS**: Tự điền `/bin/zsh`.
  - **Linux**: Tự điền `/bin/bash`.
  - **Windows**: Tự tìm `$GIT_BASH_BIN` hoặc `C:\Program Files\Git\bin\bash.exe`.
- Nếu muốn ép buộc thủ công, bạn chỉ cần sửa 1 dòng trong `~/.omp/agent/config.yml`:
  ```yaml
  shellPath: /bin/zsh
  ```

---

### Tình huống 7: Nguyên tắc đồng bộ 1 chiều (Tránh mất cấu hình mới)

#### CẢNH BÁO QUAN TRỌNG:
> **TUYỆT ĐỐI KHÔNG** chạy `./scripts/omp-setup-restore.sh` trên chính máy bạn đang làm việc để "đồng bộ"!

#### Lý do:
Cấu hình thật trong `~/.omp/agent/config.yml` và `models.yml` của bạn luôn là phiên bản mới nhất. Bản trong repo chỉ là snapshot lưu trữ. Hướng đồng bộ đúng chuẩn là:
$$\text{Máy đang dùng} \xrightarrow{\text{Backup}} \text{Repo GitHub} \xrightarrow{\text{Restore}} \text{Máy mới}$$

Nếu lỡ chạy restore trên máy đang dùng:
Toàn bộ file cũ của bạn đã được lưu an toàn tại `~/.omp/restore-backups/<timestamp>/`. Bạn chỉ cần copy ngược lại:
```bash
cp -r ~/.omp/restore-backups/<latest_timestamp>/* ~/.omp/
```

---

## 4. Bảng Tra Cứu Lệnh Vận Hành Tức Thì (Cheat Sheet)

| Tác vụ | Lệnh thực thi | Ghi chú |
| :--- | :--- | :--- |
| **Backup cấu hình lên Git** | `./scripts/omp-setup-backup.sh --source ~/.omp --config-dir config/omp -o backups/omp-setup-portable.tar.gz` | Tạo snapshot sạch, an toàn |
| **Backup dữ liệu riêng tư** | `OMP_BACKUP_PASSPHRASE_FILE=~/.omp-backup-pass ./scripts/omp-private-backup.sh --all` | Mã hóa memory, history |
| **Restore máy mới (Setup)** | `./scripts/omp-setup-restore.sh` | Chạy trên macOS/Linux/Windows mới |
| **Restore ký ức & history** | `./scripts/omp-private-restore.sh ~/Downloads/omp-private-<ts>.tar.gz.gpg` | Chống treo M1, tự dọn WAL |
| **Đồng bộ từ zuey gốc** | `./scripts/omp-sync-upstream.sh` | Zero git merge, giữ nguyên version |
| **Chạy toàn bộ bài test** | `./tests/test-omp-migration.sh && ./tests/test-omp-private-restore.sh` | Xác minh an toàn trước khi push |
| **Hủy tiến trình GPG treo** | `killall gpg-agent 2>/dev/null; rm -f ~/.gnupg/*.lock` | Cứu nguy khi gpg bị đứng |
| **Dọn sạch SQLite WAL** | `find ~/.omp/agent \( -name "*.db-wal" -o -name "*.db-shm" \) -delete` | Tránh lock database |
| **Xóa sạch cache Bun** | `rm -rf ~/.omp/plugins/node_modules ~/.omp/plugins/bun.lock && bun pm cache rm` | Xử lý lỗi cài đặt plugin |
