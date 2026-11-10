---
description: Khởi động full-chain harness loop cho phiên hiện tại (interactive).
---
Thực hiện vòng lặp kỹ thuật full-chain cho yêu cầu: $ARGUMENTS

Tuân thủ nghiêm ngặt FSM: CLASSIFY → PLAN → IMPLEMENT → VERIFY → REVIEW → RECORD → COMMIT.
- Dùng subagent hlk-planner để lập kế hoạch (nêu file + verify + acceptance).
- IMPLEMENT: spawn subagent general-purpose (Skill tool) chạy `/ck:cook loop/.state/plan.current.md`
  (parity headless, decision 0013); chỉ patch file trong plan, không sửa test để ép pass. Fallback
  hlk-worker nếu ck: vắng.
- Chạy `loop/verify.sh` để verify tất định; nếu đỏ, quay lại IMPLEMENT (tối đa 3 lần).
- Dùng subagent hlk-reviewer (ngữ cảnh mới) để review; REJECT → IMPLEMENT.
- Nếu repo có harness-cli: tạo intake, ghi trace, cập nhật story.
- Commit khi verifier XANH và reviewer APPROVE.
