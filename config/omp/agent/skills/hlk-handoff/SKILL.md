---
name: hlk-handoff
description: Checkpoint/bàn giao phiên orchestrator — cập nhật handoff doc sau mỗi đơn vị việc (checkpoint lăn, chạy tiếp) hoặc chốt phiên khi context chạm ~40-50%. Dùng để phiên chết lúc nào cũng resume được mà không cần human theo dõi.
allowed-tools: Read, Bash, Glob, Grep, Write
---

## Vì sao tồn tại

Tri thức phiên (việc đã chốt, quyết định, việc kế tiếp) phải nằm trong FILE BỀN,
không nằm trong transcript — để phiên chết/đứt lúc nào cũng resume được, và human
KHÔNG phải canh phiên. Auto-compact của Claude nén mất kiểm soát → vẫn phải né,
nhưng bằng ngưỡng ~40–50% cửa sổ context (ngưỡng 12–15% cũ đã bỏ: overhead cố
định đầu phiên ~25–30k token đã chạm ngưỡng đó, khiến cứ 1 item là phải bàn giao).

## Hai chế độ

1. **Checkpoint lăn (mặc định, KHÔNG dừng phiên)** — sau MỖI đơn vị việc xong
   (item trọn chuỗi FSM): cập nhật handoff doc của phiên rồi CHẠY TIẾP item kế.
   Cùng MỘT file suốt phiên (`plans/{date}-session-handoff/handoff-prompt.md`,
   date = lúc tạo lần đầu trong phiên); ghi đè mục "Trạng thái đã chốt" và
   "Việc kế tiếp", giữ cấu trúc. Commit docs-only kèm commit của item hoặc riêng.
2. **Chốt phiên** — CHỈ khi: (a) context chạm ~40–50% / system-reminder báo sắp
   summarize, (b) human gõ `/hlk-handoff` yêu cầu dừng, hoặc (c) hết backlog phù
   hợp. Làm như checkpoint + in hướng dẫn mở phiên mới. Đã qua ~40% thì không
   bắt đầu item normal/high-risk mới; item tiny còn vừa thì được.

## Các bước (cả hai chế độ)

1. **Thu trạng thái sống** (đọc, không đoán):
   - `git log --oneline -8` + `git status --short`
   - `./scripts/bin/harness-cli.exe query backlog --open 2>/dev/null | head -20` (macOS: bỏ .exe)
   - `cat loop/.state/skip_items` · `tail -5 loop/.state/events.jsonl`
   - Việc đang dở + quyết định đã chốt TRONG PHIÊN (từ trí nhớ phiên — phần
     duy nhất không đọc lại được, viết kỹ nhất).
2. **Ghi handoff doc** `plans/{date}-session-handoff/handoff-prompt.md`. Cấu trúc
   BẮT BUỘC (mẫu proven plans/260710-2054-session-handoff/):
   - Trạng thái đã chốt (HEAD, verify/doctor status, gì đã vá — "KHÔNG làm lại")
   - Việc kế tiếp theo thứ tự ưu tiên (đánh số, mỗi mục 1-3 dòng, kèm lệnh định vị)
   - Luật cứng (no-push, verify.sh trọng tài, item engine làm interactive...)
   - Lệnh định vị nhanh (4-6 lệnh)
3. **Ghi nhớ bài học môi trường mới** (nếu có) vào memory (`~/.claude/projects/.../memory/`).
4. Chế độ chốt phiên: **in hướng dẫn** cho human — mở phiên mới + dán
   `Đọc plans/{date}-session-handoff/handoff-prompt.md rồi tiếp tục từ mục 1.`
   Chế độ checkpoint lăn: bỏ bước này, quay lại nhận item kế tiếp ngay.

## Ranh giới

- Commit trong skill này CHỈ cho thay đổi CỦA handoff doc (docs-only). KHÔNG push.
- Chế độ chốt phiên: không nhận việc mới sau khi chốt. Chế độ checkpoint: tiếp
  tục làm việc là hành vi ĐÚNG, đừng dừng chờ human.
