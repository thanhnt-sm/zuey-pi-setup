---
name: hlk-commit-msg
description: Soạn ĐỀ XUẤT commit message conventional CHỈ-ĐỌC cho chặng COMMIT của harness loop (decision 0021/0024). KHÔNG stage, KHÔNG commit, KHÔNG push, KHÔNG sửa file — engine chốt commit tất định.
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

## Vì sao tồn tại

Chặng COMMIT của loop cần một lượt cố vấn soạn đề xuất commit message (side-call
`loop/ck-bridge/hooks/commit-message.sh`, cờ `CK_COMMIT_MSG_ENABLED`). Bộ claudekit
không có skill thuần soạn-message (ck:git là skill hành động stage/commit/push — bị
cấm trong FSM), nên skill này sống NGAY TRONG repo: đi theo repo khi port, không phụ
thuộc plugin ngoài, không bị công cụ dọn context cất vào `.shadowed/` (decision 0024).

## Ranh giới bất biến (decision 0021)

- CHỈ ĐỌC: xem thay đổi bằng `git status` / `git diff` / `git log`. TUYỆT ĐỐI KHÔNG
  `git add`, KHÔNG `git commit`, KHÔNG `git push`, KHÔNG Write/Edit bất kỳ file nào.
- Kết quả chỉ là ĐỀ XUẤT: engine harness tự chốt commit tất định; đề xuất không hợp
  lệ thì engine dùng message tất định của nó (fail-open).

## Các bước

1. Xem thay đổi hiện tại: `git status`, `git diff` (cả đã stage lẫn chưa stage —
   engine sẽ stage toàn bộ ngay sau đó).
2. Học giọng message của repo: `git log --oneline -8` (repo này dùng conventional
   commit tiếng Việt không dấu, thường kèm scope `(hlk)` và số item `#NNN`).
3. Chọn type conventional đúng bản chất thay đổi:
   `feat|fix|docs|refactor|test|chore|perf|build|ci|style|revert`, kèm scope nếu rõ.
4. In RA DUY NHẤT nội dung message — KHÔNG lời dẫn, KHÔNG giải thích, KHÔNG markdown
   fence:
   - Dòng ĐẦU TIÊN: subject conventional, TỐI ĐA 72 ký tự.
   - Tùy chọn: 1 dòng trống + body ngắn (nêu VÌ SAO đổi, không kể lại cái gì đổi).
