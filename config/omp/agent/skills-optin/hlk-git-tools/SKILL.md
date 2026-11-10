---
name: hlk-git-tools
description: Bộ git tools an toàn cho workspace Ruflo — doctor kiểm tra repo, commit chặn secrets, push không force, safe-sync một lệnh. Dùng khi cần commit/push an toàn, kiểm tra sức khỏe repo, hoặc sync đầy đủ doctor→commit→push.
keywords:
  - git
  - commit
  - push
  - doctor
  - safe-sync
  - secrets
  - security
hide: true
---

# Skill: hlk-git-tools

## Khi nào dùng

Kích hoạt khi người dùng muốn:

- Commit/push code an toàn (chặn secrets, file nhạy cảm)
- Kiểm tra sức khỏe repo (branch, remote, sensitive files, secrets)
- Sync đầy đủ: doctor → commit → push trong một lệnh
- Force push (sẽ bị từ chối — script không hỗ trợ)

## Các script

| Script | Lệnh | Mục đích |
|--------|------|----------|
| `hlk-git-doctor` | `node HLK/git-tools/hlk-git-doctor.mjs` | Kiểm tra sức khỏe repo |
| `hlk-git-commit` | `node HLK/git-tools/hlk-git-commit.mjs -m "msg"` | Commit an toàn |
| `hlk-git-push` | `node HLK/git-tools/hlk-git-push.mjs` | Push an toàn, không force |
| `hlk-git-safe-sync` | `node HLK/git-tools/hlk-git-safe-sync.mjs -m "msg"` | Doctor → Commit → Push |

## Ví dụ

```bash
# Kiểm tra repo + tự fix
node HLK/git-tools/hlk-git-doctor.mjs --fix --yes

# Commit an toàn
node HLK/git-tools/hlk-git-commit.mjs -m "feat: update HLK" --yes

# Push an toàn
node HLK/git-tools/hlk-git-push.mjs --yes

# Sync đầy đủ
node HLK/git-tools/hlk-git-safe-sync.mjs -m "feat: update HLK" --yes
```

## Các vấn đề doctor xử lý

| Vấn đề | Hành động khi `--fix --yes` |
|--------|---------------------------|
| Branch `master` | Đổi thành `main` |
| Không track remote | Set upstream `origin/main` |
| Detached HEAD | Checkout `main` |
| Sensitive file staged | Unstage |
| Secret trong staged | Unstage |
| Tarball HLK bị staged | Unstage |
| Merge conflict | Offer abort (không tự abort) |
| Divergent branch | Offer pull --rebase |
| Embedded git repo | Đổi tên `.git` thành `.git-embedded-backup` |
| File >100MB | Báo lỗi, không tự xử lý |

## Lưu ý

- Các script **không force push** — sẽ báo lỗi nếu truyền `-f`/`--force`
- Không tự động xóa file nhạy cảm đã track trong history
- Các thao tác nguy hiểm cần xác nhận (trừ khi `--yes`)
