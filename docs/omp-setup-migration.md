# Hướng dẫn Backup & Restore Oh-My-Pi (omp) sang macOS M1 / Máy mới

Tài liệu hướng dẫn quy trình đóng gói toàn bộ cấu hình **Oh-My-Pi (omp)** kết hợp cùng setup giao diện/tiện ích từ **zuey-pi**, khử toàn bộ secret/token nhạy cảm, đưa lên Git fork để có thể khôi phục 100% trên **macOS M1 (Apple Silicon)** hoặc bất kỳ máy nào khi cần dựng lại.

> 📘 **Cẩm nang nâng cao**: Để tra cứu quy trình vận hành định kỳ và xử lý toàn bộ các sự cố ngoại lệ (GPG freeze, Bun cache/lockfile, SQLite WAL lock, headless restore, shell path...), xem ngay **[`docs/omp-operations-guide.md`](./omp-operations-guide.md)**.

---

## 1. Cấu trúc sau khi hợp nhất trong Workspace

```
zuey-pi-setup/
├── config/
│   ├── pi/                             # Setup gốc của zuey-pi
│   ├── omp/                            # Snapshot máy thật (omp-setup-backup.sh sở hữu, mỗi lần --config-dir là XÓA rồi ghi lại)
│   │   ├── agent/
│   │   │   ├── config.yml              # Đã template hóa shellPath: {{SHELL_PATH}}
│   │   │   ├── models.yml              # apiKey literal → !printenv <PROVIDER>_API_KEY (mỗi provider 1 biến)
│   │   │   ├── .env.example            # Tên biến môi trường (không có giá trị)
│   │   │   ├── commandcode-models.json
│   │   │   ├── extensions/             # Extension tự viết; shim `export … from "C:/…"` được thay bằng source thật → typesafe-planner/{index.ts,src/}. KHÔNG có orca-*, *.disabled, *.bak*
│   │   │   └── managed-skills/         # Managed skills do agent tự học
│   │   └── plugins/
│   │       ├── package.json            # Plugin đang cài trên máy thật
│   │       ├── omp-plugins.lock.json
│   │       └── bun.lock
│   └── omp-upstream/                   # Overlay port từ upstream zuey-pi (omp-sync-upstream.sh sở hữu)
│       ├── .omp-syncignore             # Danh sách chặn plugin xung đột (pi-lens, pi-advisor-flow,...)
│       ├── agent/
│       │   ├── APPEND_SYSTEM.md        # System prompt mở rộng từ zuey
│       │   └── extensions/             # compaction-policy.ts, pi-footer.json, pi-footer-cache-tps.ts
│       └── plugins/package.json        # Plugin bổ sung từ upstream (pi-footer, pi-smart-fetch, computer-use,...)
├── scripts/
│   ├── omp-sync-upstream.sh        # Script đồng bộ an toàn từ upstream (zero-merge, pinned versions)
│   ├── omp-setup-backup.sh         # Snapshot máy thật → config/omp + tarball (kèm overlay ở upstream/)
│   ├── omp-setup-restore.sh        # Restore đa nền tảng: snapshot + overlay (chỉ thêm file còn thiếu)
│   ├── omp-private-backup.sh       # Backup mã hóa (gpg) memory/history/TypeSafe kit RA NGOÀI repo
│   ├── pi-setup-backup.sh          # Script backup gốc của pi
│   └── pi-setup-restore.sh         # Script restore gốc của pi
├── tests/
│   ├── test-omp-syncignore.sh      # TDD test kiểm tra lọc plugin & giữ nguyên version pinned
│   ├── test-omp-sync-extraction.sh # TDD test kiểm tra cô lập git show (không gây bẩn git HEAD)
│   └── test-omp-migration.sh       # Bộ kiểm thử TDD xác minh an toàn dữ liệu
└── backups/
    ├── omp-setup-portable.tar.gz       # Bundle sạch của omp: snapshot ở gốc, overlay ở upstream/
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
# 1. Snapshot máy thật: lọc secret, chặn mọi file SQLite, nén tarball (kèm config/omp-upstream) và mirror vào config/omp
./scripts/omp-setup-backup.sh --source ~/.omp --config-dir config/omp -o backups/omp-setup-portable.tar.gz

# 2. Kiểm tra git status xem có thay đổi mới không
git status

# 3. Commit và đẩy lên fork của bạn
git add config/omp config/omp-upstream scripts/ tests/ backups/omp-setup-portable.tar.gz docs/
git commit -m "feat(omp): update portable omp snapshot with sanitized secrets"
git push origin main
```

`config/omp` và `config/omp-upstream` có chủ sở hữu khác nhau, nên backup và sync không ghi đè nhau:

| Thư mục | Ai ghi | Nguồn |
| :--- | :--- | :--- |
| `config/omp/` | `omp-setup-backup.sh --config-dir` (xóa sạch rồi ghi lại) | `~/.omp` của máy thật |
| `config/omp-upstream/` | `omp-sync-upstream.sh` | `git show upstream/main:<path>` |

Repo này **public**. Tarball được track trong git nên `.gitignore` không bảo vệ được nội dung bên trong; backup sẽ **dừng (exit 2)** nếu stage có `*.db`/`*.db-wal`/`*.sqlite`, hoặc nếu bắt được token (`sk-…`, `sk-ant-…`, `AIza…`, `ya29.…`, JWT `eyJ…`, `Bearer …`, `ghp_…`, private key, `apiKey:`/`password:` có giá trị literal kể cả YAML không ngoặc kép).

### Backup dữ liệu riêng tư (memory, history, TypeSafe kit)

Những thứ không tạo lại được nhưng **không bao giờ được vào repo public** đi qua script riêng. Output được mã hóa gpg (AES256) và script từ chối ghi vào bất kỳ git work tree nào:

```bash
./scripts/omp-private-backup.sh --all                     # hỏi passphrase, ghi ~/omp-private-backups/omp-private-<ts>.tar.gz.gpg
OMP_BACKUP_PASSPHRASE_FILE=~/.omp-backup-pass ./scripts/omp-private-backup.sh --memory --history   # không tương tác
```

| Cờ | Nội dung | Ghi chú |
| :--- | :--- | :--- |
| `--memory` | `~/.omp/agent/memories/mnemopi/banks/*/mnemopi.db` | Long-term memory theo workspace (máy hiện tại: 22 bank, 76 MB kể cả WAL) |
| `--history` | `~/.omp/agent/history.db` | Lịch sử prompt, tiêu đề/recap session |
| `--typesafe-kit` | `~/.claude/mcp/typesafe/`, `~/.claude/hooks/lib/typesafe-enabled-resolver.cjs`, `~/.claude/.ck.json` | Code ClaudeKit mà `typesafe-planner.ts` `require()`; có license nên không public |
| `--all` | Cả ba | |

SQLite được chụp bằng `sqlite3 .backup` hoặc `VACUUM INTO` (qua bun/node), không dùng `cp`, vì omp mở các DB này ở chế độ WAL. Copy thô có thể bị rách hoặc thiếu dữ liệu nằm trong WAL.

**Cố ý KHÔNG backup:** `sessions/` (~40 GB), `blobs/`, `stats.db`, `models.db`, `skill-descriptions.db`, `cache/`, `natives/`, `run/`, `logs/`, `webcache/`, `terminal-sessions/`, `auth-broker.token`, `install-id`, `secret-placeholder.key`, và OAuth trong `agent.db` (đăng nhập lại, xem Bước 5).

---

## 4. Cách Khôi phục trên máy mới (macOS M1 / Apple Silicon)

Trên máy Mac M1 mới:

### Bước 1: Cài omp, bun và các phụ thuộc
Mở **Terminal** (zsh mặc định trên macOS):
```bash
curl -fsSL https://bun.sh/install | bash
curl -fsSL https://omp.sh/install | sh          # omp (https://github.com/can1357/oh-my-pi)
# hoặc: bun install -g @oh-my-pi/pi-coding-agent
# Windows (PowerShell): irm https://omp.sh/install.ps1 | iex   → C:\Users\<user>\AppData\Local\omp\omp.exe
omp --version
```

**TypeSafe planner cần ClaudeKit.** `extensions/typesafe-planner.ts` gọi `require()` các file trong `~/.claude/mcp/typesafe/` và `~/.claude/hooks/lib/typesafe-enabled-resolver.cjs`. Repo này không chứa `~/.claude` (trong `~/.claude/hooks` có `.env`; kit có license). Hãy cài ClaudeKit trước, hoặc giải nén backup riêng tư `--typesafe-kit` (Bước 6). Nếu thiếu các file đó, TypeSafe sẽ tắt.

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
1. Phát hiện hệ điều hành và thay `shellPath: {{SHELL_PATH}}` (macOS → `/bin/zsh`; Windows → `$GIT_BASH_BIN`, `C:\Program Files\Git\bin\bash.exe`, hoặc bash của Git qua `cygpath`; không bao giờ chọn WSL `System32\bash.exe`).
2. Copy mọi file trong `~/.omp` sắp bị ghi đè vào `~/.omp/restore-backups/<timestamp>/`.
3. Copy snapshot (kể cả dotfile như `.env.example`) vào `~/.omp/`.
4. Áp overlay upstream: chỉ **thêm** `APPEND_SYSTEM.md`/extension/plugin dep còn thiếu, không ghi đè file đã có. Bỏ qua bằng `--no-upstream`.
5. Sinh `~/.omp/agent/.env` từ `.env.example` nếu chưa có.
6. Chạy `bun install` trong `~/.omp/plugins` (bỏ qua bằng `--no-install`).

> Trên máy đang dùng, **không** chạy restore để "đồng bộ": `config.yml`/`models.yml` của máy thật thường mới hơn snapshot. Hướng đúng là máy thật → repo (backup).

### Bước 4: Khai báo API Key (chỉ 1 lần duy nhất)
Mở file `~/.omp/agent/.env` vừa được tạo và điền giá trị cho từng biến:
```bash
nano ~/.omp/agent/.env
```
Nội dung mẫu:
```env
TYPESAFE_API_KEY=your_typesafe_key_here
ZAI_API_KEY=your_zai_key_here
CODEX_3RD_API_KEY=your_codex_3rd_key_here   # sinh ra từ apiKey literal của provider codex-3rd trong models.yml
```
Mỗi provider có `apiKey` literal trên máy cũ sẽ được đổi thành `!printenv <TÊN_PROVIDER>_API_KEY` và thêm vào `.env.example`. Trên Windows, máy cũ còn đặt các biến sau ở mức user (`HKCU\Environment`), không nằm trong `.env`: `TYPESAFE_API_KEY`, `GIT_BASH_BIN`. Trên máy mới cần đặt lại chúng (hoặc điền vào `.env`).

### Bước 5: Đăng nhập lại OAuth
OAuth nằm trong `~/.omp/agent/agent.db` (bảng `auth_credentials`) và không được export, vì token gắn với máy và tự xoay vòng. Máy cũ có 5 phiên: 1 `google-antigravity`, 4 `openai-codex`. Khởi động `omp` và dùng `/login` cho từng provider.

### Bước 6 (tùy chọn): Khôi phục dữ liệu riêng tư
Tắt omp trước, rồi chạy script khôi phục tự động (khuyến nghị trên mọi hệ điều hành):
```bash
./scripts/omp-private-restore.sh ~/omp-private-backups/omp-private-<ts>.tar.gz.gpg
```
Script sẽ tự động gán `GPG_TTY=$(tty)`, dọn lock cũ, cấu hình `pinentry-mac` trên Apple Silicon nếu có (hoặc tự động fallback sang `allow-loopback-pinentry` / `--pinentry-mode loopback`), và xóa sạch file SQLite WAL/SHM tạm sau khi giải nén.

#### Cách cấu hình thủ công hoặc xử lý khi bị treo trên macOS M1 / Headless
Nếu restore thủ công hoặc gặp hiện tượng GPG treo không hiện hộp thoại nhập mật khẩu trên Apple Silicon:

1. **Cấu hình GUI Prompt chính thức (macOS M1 / Apple Silicon)**:
   ```bash
   brew install pinentry-mac
   echo "pinentry-program /opt/homebrew/bin/pinentry-mac" >> ~/.gnupg/gpg-agent.conf
   gpgconf --kill gpg-agent
   ```
   *(Lưu ý: Trên macOS Intel, đường dẫn là `/usr/local/bin/pinentry-mac`)*.

2. **Cấu hình Terminal / Headless Fallback**:
   ```bash
   echo "allow-loopback-pinentry" >> ~/.gnupg/gpg-agent.conf
   gpgconf --kill gpg-agent
   export GPG_TTY=$(tty 2>/dev/null || echo /dev/tty)
   gpg --pinentry-mode loopback -d omp-private-<ts>.tar.gz.gpg | tar -xzf - -C ~
   find ~/.omp/agent \( -name "*.db-wal" -o -name "*.db-shm" \) -delete
   ```

3. **Thoát khỏi trạng thái bị treo**:
   Nếu GPG bị treo ở tiến trình trước đó, hủy tiến trình agent và xóa lock:
   ```bash
   killall gpg-agent 2>/dev/null || true
   rm -f ~/.gnupg/*.lock
   ```

Đường dẫn trong archive tương đối với `$HOME` (`.omp/agent/memories/...`, `.omp/agent/history.db`, `.claude/mcp/typesafe/...`).

### Bước 7: Khởi động Oh-My-Pi
```bash
omp
```

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
4. **Overlay riêng**: Ghi vào `config/omp-upstream/` (không phải `config/omp/`), sau đó dựng lại tarball để tarball mang overlay mới. Trước đây sync ghi vào `config/omp/` rồi gọi backup `--config-dir config/omp`, và backup xóa luôn những file vừa trích xuất.

Chạy kiểm thử cho bộ đồng bộ:
```bash
./tests/test-omp-syncignore.sh
./tests/test-omp-sync-extraction.sh
```
