---
name: hlk-upstream-pull
description: Pull source code mới nhất từ upstream ruflo (https://github.com/ruvnet/ruflo) vào workspace và tự động cài lại HLK layer. Dùng khi cần update Ruflo từ git upstream, đồng bộ code mới, hoặc test phản ứng của HLK khi upstream thay đổi.
keywords:
  - upstream
  - pull
  - sync
  - ruflo
  - update
  - clone
  - reinstall
  - hlk
hide: true
---

# Skill: hlk-upstream-pull

## Khi nào dùng

Kích hoạt skill này khi người dùng muốn:

- Pull / sync / update source code từ `https://github.com/ruvnet/ruflo` vào workspace
- Cập nhật Ruflo lên bản mới nhất từ git upstream (không qua npm registry)
- Test xem HLK phản ứng ra sao khi upstream ruflo có update
- Khôi phục HLK layer sau khi vô tình pull upstream và mất cấu hình bảo vệ

## Script chính

```bash
node HLK/upstream/hlk-upstream-pull.mjs [options]
```

File: `HLK/upstream/hlk-upstream-pull.mjs`

## Options

| Option | Mặc định | Mô tả |
|--------|----------|-------|
| `--upstream <url>` | `https://github.com/ruvnet/ruflo.git` | URL git upstream |
| `--branch <name>` | `main` | Branch upstream cần pull |
| `--yes` | false | Không hỏi xác nhận |
| `--dry-run` | false | Chỉ clone + list, không copy/reinstall |
| `--keep-backup` | false | Giữ backup trong `HLK/backups/` sau khi xong |
| `--skip-clone` | false | Bỏ qua clone, dùng thư mục tạm đã có (debug) |

## Luồng xử lý

1. **Clone upstream** ruflo về thư mục tạm (`%TEMP%/hlk-upstream-<timestamp>`) bằng `git clone --depth 1 --branch main`.
2. **Backup** các file cấu hình quan trọng vào `HLK/backups/upstream-pull-<timestamp>/`:
   - `.claude/settings.json`
   - `.gitignore`
   - `.gitattributes`
3. **Copy source upstream** vào workspace, **BỎ QUA**:
   - `HLK/` — giữ nguyên HLK layer của user
   - `.git/` — giữ git history local
   - `node_modules/` — giữ dependencies đã cài
   - `.gitignore`, `.gitattributes` — sẽ patch lại qua `hlk-install.mjs`
   - `agentdb.rvf`, `agentdb.rvf.lock` — file nhạy cảm
4. **Patch trực tiếp HLK layer** (không gọi install/update để tránh lỗi src=dest
   khi chạy từ chính HLK_ROOT):
   - Patch `.claude/settings.json` — thêm lại HLK PreToolUse hook và MCP wrapper
   - Patch `.gitattributes` — thêm `merge=ours` cho HLK files
   - Patch `.gitignore` — thêm rule bảo vệ `*.rvf`, `.env`, `HLK/config/secrets.*`
   - Copy skills HLK sang `.claude/skills/` và `.devin/skills/`
   - Cài `.githooks/post-merge` — git tự chạy verify sau mỗi pull/merge
5. **Run HLK integrity verify** — kiểm tra toàn vẹn HLK layer sau update.
6. **Cleanup** — xóa thư mục tạm clone. Xóa backup (trừ khi `--keep-backup`).

## Ví dụ dùng

### Pull upstream + reinstall HLK (mặc định)

```bash
node HLK/upstream/hlk-upstream-pull.mjs
```

### Không hỏi xác nhận (CI/CD)

```bash
node HLK/upstream/hlk-upstream-pull.mjs --yes
```

### Dry-run: chỉ clone + xem diff, không thay đổi workspace

```bash
node HLK/upstream/hlk-upstream-pull.mjs --dry-run
```

### Giữ backup để rollback nếu cần

```bash
node HLK/upstream/hlk-upstream-pull.mjs --keep-backup
```

### Pull từ branch khác

```bash
node HLK/upstream/hlk-upstream-pull.mjs --branch dev
```

## Kết quả mong đợi

Sau khi chạy thành công:

- Source code upstream ruflo mới nhất đã có trong workspace
- HLK layer nguyên vẹn: PreToolUse hook, MCP wrapper, .gitignore rules
- `hlk-verify-integrity.js` PASS
- Git history local không bị đụng

## Rollback

Nếu sau pull thấy lỗi và cần rollback:

```bash
# Backup nằm tại (nếu dùng --keep-backup):
ls HLK/backups/upstream-pull-*/

# Copy lại file backup
cp HLK/backups/upstream-pull-<timestamp>/.claude__settings.json .claude/settings.json
cp HLK/backups/upstream-pull-<timestamp>/.gitignore .gitignore
cp HLK/backups/upstream-pull-<timestamp>/.gitattributes .gitattributes

# Hoặc dùng git checkout để revert file đã track
git checkout -- .claude/settings.json .gitignore .gitattributes
```

## So sánh với `hlk-lifecycle --update`

| Tiêu chí | `hlk-lifecycle --update` | `hlk-upstream-pull` |
|----------|---------------------------|---------------------|
| Nguồn update | npm registry (`npx ruflo@<ver>`) | git upstream (clone) |
| Bản update | Stable release | Bản dev mới nhất |
| Backup trước update | Không | Có (3 file cấu hình) |
| Dry-run | Không | Có |
| Reinstall HLK sau update | Có | Có |
| Phù hợp khi | Production, cần stable | Dev, test, cần bản mới nhất |

## Tích hợp

- Script: `HLK/upstream/hlk-upstream-pull.mjs`
- Package bin: `hlk-upstream-pull` (sau khi `npm install -g hlk-ruflo`)
- npm script: `npm run upstream-pull` (trong `HLK/package.json`)
- Self-test: `hlk-status --self-test` kiểm tra script tồn tại
- Pack: `hlk-pack` kiểm tra script tồn tại trước khi đóng gói
