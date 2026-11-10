---
name: hlk-integrity-check
description: Kiểm tra tính toàn vẹn của HLK layer sau khi merge upstream hoặc pull update. Phát hiện mất PreToolUse hook, MCP wrapper, .gitignore rules, file nhạy cảm bị track. Dùng khi nghi ngờ upstream đã ghi đè cấu hình HLK, hoặc sau mỗi git pull/merge.
keywords:
  - integrity
  - verify
  - check
  - health
  - hlk
  - merge
  - pull
  - upstream
hide: true
---

# Skill: hlk-integrity-check

## Khi nào dùng

Kích hoạt khi:

- Sau `git pull` hoặc `git merge` từ upstream
- Nghi ngờ cấu hình HLK bị ghi đè
- Kiểm tra định kỳ sức khỏe HLK layer
- Trước khi commit để đảm bảo không có file nhạy cảm bị track

## Lệnh

```bash
node HLK/wrappers/hlk-verify-integrity.js
```

## Các kiểm tra

| # | Kiểm tra | FAIL khi |
|---|----------|----------|
| 1 | Required files | Thiếu file bắt buộc trong HLK/ |
| 2 | Config validation | `hlk.config.json` không phải JSON hợp lệ |
| 3 | Gitignore protection | `.gitignore` thiếu rule bảo vệ secrets, *.rvf |
| 4 | Prompts | Ít hơn 4 prompt files |
| 5 | Git tracking safety | `agentdb.rvf` bị git track |

## Output mẫu

```
[HLK Integrity Check] Verifying HLK layer...

📂 Required files:
  ✅ config/hlk.config.json
  ✅ wrappers/hlk-loader.js
  ...

🔒 Gitignore protection:
  ✅ HLK/config/secrets.* trong .gitignore
  ❌ *.rvf trong .gitignore    ← FAIL

🛡️ Git tracking safety:
  ✅ agentdb.rvf KHÔNG bị git track

──────────────────────────────────────────────────
⚠️ 1 check(s) FAILED — review HLK layer
```

## Khi FAIL

1. Đọc thông báo lỗi để biết check nào fail
2. Nếu `.gitignore` thiếu rule → chạy `node HLK/bin/hlk-install.mjs` để patch lại
3. Nếu file nhạy cảm bị track → `git rm --cached <file>` rồi thêm vào `.gitignore`
4. Nếu HLK files bị thiếu → chạy `node HLK/upstream/hlk-upstream-pull.mjs` để pull + reinstall

## Tích hợp git hook

HLK install sẽ tạo `.githooks/post-merge` tự chạy integrity check sau mỗi `git pull`/`git merge`. Để kích hoạt:

```bash
git config core.hooksPath .githooks
```
