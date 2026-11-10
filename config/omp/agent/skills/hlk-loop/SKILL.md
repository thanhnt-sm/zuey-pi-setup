---
name: hlk-loop
description: Run the HLK FSM loop for one or more backlog items — interactive orchestration mode.
allowed-tools: Read, Bash, Glob, Grep
---

## Usage

Invoke this skill to run the full-chain HLK FSM loop in interactive (Claude Code) mode.

Interactive parity với headless (decision 0018): mỗi chặng của FSM ánh xạ NGANG sang cùng
một skill `ck:*` mà engine headless dùng, GIỮ NGUYÊN 2 chốt tất định — VERIFY và COMMIT
KHÔNG bao giờ do LLM phán. Các chặng phụ (PLAN_CRITIC, FIX, ROOT_CAUSE, SIMPLIFY) chỉ bật
theo điều kiện; nếu skill `ck:*` tương ứng vắng mặt thì degrade sạch (SKIP/fallback), không
làm hỏng vòng.

```
CLASSIFY → PLAN → [PLAN_CRITIC] → IMPLEMENT → VERIFY → [FIX] → [ROOT_CAUSE] → [SIMPLIFY] → REVIEW → RECORD → COMMIT
```

`[...]` = chặng có điều kiện (bật theo lane / theo số lần verify đỏ / sau khi verify xanh).

### Probe khả dụng trước khi gọi ck:*

Trước mỗi chặng có thể dùng `ck:*`, orchestrator ĐƯỢC PHÉP probe công cụ đã trang bị:
`scripts/bin/harness-cli query tools --capability <ten> --status present`. Nếu năng lực
VẮNG (absent) thì coi như một bước degrade sạch — chuyển sang fallback/SKIP ghi ở từng
chặng, KHÔNG coi là lỗi và KHÔNG dừng vòng.

**GỌI ĐÚNG BỘ KIT `ck:*` (chỉ thị human 2026-07-12, intervention #10):** `ck:*` và
`ck-*` là HAI BỘ KIT KHÁC NHAU — không phải hai cách viết. Khi orchestrator hoặc
subagent invoke Skill tool, PHẢI dùng tên chuẩn frontmatter của bộ claudekit:
`ck:plan` / `ck:cook` / `ck:fix` / `ck:test` / `ck:scout` / `ck:code-review` /
`ck:predict` / `ck:scenario` / `ck:debug` / `ck:loop` / `ck:security` / `ck:docs`.
Riêng cố vấn commit message dùng `hlk-commit-msg` (skill NỘI BỘ repo,
`.claude/skills/hlk-commit-msg/`) — bộ claudekit KHÔNG có bản `ck:smart-commits`,
gọi tên ck: sẽ thành skill ma (backlog #128, decision 0024).
KHÔNG gọi bằng tên thư mục hoặc alias trần (`ck-plan`, `cook`,
`fix`, `code-review`...) — tên đó có thể trỏ sang bộ kit khác hoặc alias deprecated.
Nghi ngờ tên nào → đọc frontmatter `name:` trong `~/.claude/skills/<dir>/SKILL.md`
trước khi gọi.

### Steps

1. **CLASSIFY** — intake prompt, chọn lane (tiny / normal / high-risk) theo `docs/FEATURE_INTAKE.md`.
   GHI lane vào intake row (`harness-cli`) — các chặng sau đọc lane từ đây (vd PLAN_CRITIC
   chỉ chạy khi lane high-risk).
   - CỐ VẤN (read-only, decision 0021): ĐƯỢC chạy THÊM `/ck:scout` để gom ngữ cảnh (định vị
     file/docs/story bị ảnh hưởng) làm đầu vào cho PLAN. `/ck:scout` CHỈ ĐỌC, KHÔNG quyết định
     phân loại — verdict lane vẫn do orchestrator/engine chốt và `harness-cli` ghi intake. Đây
     là side-call cố vấn fail-open: `/ck:scout` VẮNG hoặc lỗi → SKIP sạch, KHÔNG block vòng.

2. **PLAN** — chỉ dẫn CHÍNH: chạy skill `/ck:plan` cho work item (được fan-out `ck:researcher`
   song song khi cần). `/ck:plan` PHẢI `Write` kế hoạch ra `loop/.state/plan.current.md`
   theo đúng các nhãn hợp đồng `Files:` / `Verify:` / `Rollback:` / `Tests:` / `Risks:` /
   `Acceptance:`.
   - ADDITIVE: khi lane high-risk HOẶC acceptance đòi độ phủ edge-case (neo risk-flag của
     FEATURE_INTAKE — auth/authorization/data/audit/external/public-API, hoặc chữ
     "robustness/corrupted/atomic/race"), chạy THÊM `/ck:scenario` rồi đổ kết quả vào 2 nhãn
     `Tests:` + `Risks:`. Item gọn/ít rủi ro → BỎ QUA scenario (đừng chạy máy móc).
   - FAN-OUT SONG SONG (CHỈ khi lane high-risk HOẶC user yêu cầu — Phase 04, interactive-only):
     orchestrator ĐƯỢC phóng các subagent độc lập SONG SONG trong CÙNG MỘT message (Agent tool
     nhiều tool-use 1 lượt), vd `/ck:scenario` chạy song song với `/ck:plan` draft, rồi
     orchestrator MERGE kết quả scenario vào 2 nhãn `Tests:`/`Risks:` của plan. Trần cứng:
     tối đa 3 subagent song song/chặng (máy hạn chế tài nguyên). Item thường GIỮ tuần tự
     (token discipline B6 gộp-item vẫn áp dụng). Headless GIỮ tuần tự (YAGNI). Degrade:
     Agent tool vắng/lỗi → chạy tuần tự như trên. Chi tiết:
     `plans/260711-ckstar-max-wiring/phase-04-fanout-decisions.md`.
   - Fallback: `/ck:plan` VẮNG → delegate subagent `hlk-planner` (cùng hợp đồng nhãn).

3. **PLAN gate (fail-closed)** — trước khi rời PLAN, orchestrator BẮT BUỘC kiểm
   `loop/.state/plan.current.md` tồn tại VÀ nêu cả:
   - (a) ít nhất một file cụ thể (path có đuôi `.sh`/`.md`/`.py`/`.ts`/`.js`/`.rs`/...), và
   - (b) một lệnh verify/test cụ thể.

   Đây là **gate**, không phải gợi ý. Thiếu một trong hai → gate **fail-closed**: **không tiến
   hành** IMPLEMENT — re-plan hoặc dừng. Mirror engine headless tại
   `loop/loop-engine.sh:435-449` (`emit_event PLAN gate_fail` → `return 1` khi
   `LOOP_FAIL_MODE=closed`). Chỉ khi cả hai đạt mới sang bước tiếp.

4. **PLAN_CRITIC** (chỉ khi lane high-risk — đọc lane từ intake row ở CLASSIFY) — chạy
   `/ck:predict` (hội đồng persona: kiến trúc/bảo mật/hiệu năng/UX/vận hành) trên
   `plan.current.md`, READ-ONLY (không sửa file nào).
   - Dòng chốt máy-đọc BẮT BUỘC là DÒNG CUỐI, đúng một trong hai:
     `CRITIC: APPROVE — <lý do>` hoặc `CRITIC: REJECT — <file:line/caller=/trace#> <vấn đề>`.
     REJECT PHẢI có địa chỉ kiểm chứng được; luận điểm vô địa chỉ = APPROVE.
   - `CRITIC: REJECT` → quay lại PLAN (bước 2). `CRITIC: APPROVE` → sang IMPLEMENT.
   - FAN-OUT SONG SONG (tuỳ chọn — lane high-risk HOẶC user yêu cầu): tách 5 persona thành
     2–3 subagent song song theo nhóm lens (kiến trúc+hiệu năng / bảo mật / vận hành+UX),
     phóng trong CÙNG MỘT message, mỗi subagent chạy `/ck:predict` READ-ONLY trên
     `plan.current.md` và trả dòng chốt `CRITIC:` riêng cho nhóm lens của mình.
     Orchestrator MERGE CONSERVATIVE: BẤT KỲ lens nào `CRITIC: REJECT` có địa chỉ kiểm
     chứng được → verdict gộp là REJECT; TẤT CẢ APPROVE → APPROVE. Trần cứng: tối đa 3
     subagent song song/chặng. Degrade: Agent tool vắng/lỗi → chạy MỘT lượt `/ck:predict`
     tuần tự như trên. Headless GIỮ tuần tự (1 persona panel trong PLAN_CRITIC.fullchain).
   - Fallback: `/ck:predict` VẮNG → SKIP sạch (KHÔNG block vòng).

5. **IMPLEMENT** — TRƯỚC khi spawn cook, orchestrator GHI khoá commit-guard (#105).
   PID trong khoá phải CÒN SỐNG suốt chặng (hook `loop/hooks/pre_tool_use.sh` chỉ chặn
   `git commit`/`git push` khi PID sống). Trên Git Bash/MSYS Windows `$PPID` của Bash tool
   = 1 (không tồn tại → khoá stale tức thì, guard vô hiệu — friction trace #451), còn `$$`
   chết ngay sau lệnh. Cách ĐÚNG đã proven: tạo tiến trình nền giữ khoá:
   `nohup sleep 3600 >/dev/null 2>&1 & echo $! > loop/.state/nocommit.lock`
   (ở COMMIT: `kill "$(cat ...)"` rồi xoá khoá — kill và `git commit` phải ở 2 Bash call
   RIÊNG, hook kiểm tra trước khi lệnh chạy nên gộp chung sẽ bị chặn oan).
   Sau đó spawn 1 subagent đa năng (type `general-purpose`, có Skill tool) và chỉ dẫn nó chạy
   `/ck:cook loop/.state/plan.current.md`. Prompt spawn PHẢI kèm câu cấm tường minh:
   "KHÔNG chạy git add/commit/push — COMMIT là chặng riêng của orchestrator". Parity với headless
   (decision 0010: headless IMPLEMENT cũng là /ck:cook qua claude-wrapper, gate bằng
   CK_STAGE_NOCOMMIT=1; decision 0013). Subagent CHỈ được patch các file liệt kê trong plan.
   Fallback: nếu `/ck:cook` không khả dụng, dùng subagent `hlk-worker` thuần.

6. **VERIFY** (TẤT ĐỊNH — không LLM phán) — chạy `loop/verify.sh`. `loop/verify.sh` là
   **trọng tài** pass/fail DUY NHẤT; skill `/ck:test` chỉ CỐ VẤN — CHỈ chạy SAU khi verify
   ĐỎ và verdict đã chốt, để chẩn đoán nuôi FIX/ROOT_CAUSE; KHÔNG quyết định, KHÔNG sửa
   verify.log (parity headless: side-call `CK_VERIFY_TEST_ENABLED`, advice ghi
   `loop/.state/verify.test.advice.txt` — decision 0021). Đếm số lần verify đỏ trong-phiên (tối đa 3):
   - đỏ lần 1 → quay lại IMPLEMENT (bước 5) sửa lại;
   - đỏ lần 2 → sang FIX (bước 7 — fast-path);
   - đỏ lần ≥3 HOẶC sau FIX vẫn đỏ → sang ROOT_CAUSE (bước 8).
   Verify XANH → sang SIMPLIFY (bước 9).

7. **FIX** (chỉ khi verify đỏ lần 2 — fast-path, parity headless 0018) — chạy `/ck:fix --auto`
   (BẮT BUỘC cờ `--auto`; diff-guard tất định HOÀN TÁC toàn bộ nếu fix chạm oracle/test/
   `loop/verify.sh`), sửa HẸP đúng lỗi verifier rồi VERIFY LẠI (verify.sh phán). KHÔNG tự
   tuyên bố xong.
   - Fallback: `/ck:fix` VẮNG → SKIP sang ROOT_CAUSE (hoặc IMPLEMENT thường).
   - Lưu ý: FIX interactive ĐỘC LẬP với phép đo-rồi-gỡ headless #115 (`CK_FIX_ENABLED` chỉ
     chi phối engine headless) — không đụng phép đo đó.

8. **ROOT_CAUSE** (verify đỏ lần ≥3 hoặc sau FIX vẫn đỏ) — chạy `/ck:debug` (RCA hệ thống,
   red-team approach), READ-ONLY trừ quyền GHI ĐÈ DUY NHẤT `loop/.state/plan.current.md`.
   - Dòng chốt máy-đọc BẮT BUỘC (dòng cuối):
     `ROOT_CAUSE: <nguyên nhân gốc, 1 câu> => change approach|keep approach` → quay lại IMPLEMENT.
   - Fallback: `/ck:debug` VẮNG → SKIP sạch, quay IMPLEMENT thường.

9. **SIMPLIFY** (SAU khi verify XANH — parity headless 0018/0016) — chạy `/simplify` built-in
   (kind-gate đo worktree, decision 0016/0017) để dọn reuse/altitude, RỒI VERIFY LẠI: verify.sh
   PHẢI còn XANH; nếu đỏ → revert phần simplify. SIMPLIFY KHÔNG phải chốt xong-việc — verify.sh
   vẫn là trọng tài.
   - Fallback: `/simplify` VẮNG → SKIP sạch.

10. **REVIEW** — delegate `hlk-reviewer` (fresh context, maker≠checker) LÀM CHỖ DỰA độc lập,
    và chạy CHÍNH `/ck:code-review` trên diff (READ-ONLY).
    - ADDITIVE: khi diff chạm hard-gate (auth/authorization/data model/audit/external/public
      API) → chạy THÊM `/ck:security` (STRIDE/OWASP, READ-ONLY) trước khi kết luận.
    - Dòng chốt máy-đọc BẮT BUỘC (dòng cuối): `REVIEW: APPROVE — <lý do>` hoặc
      `REVIEW: REJECT — <vấn đề, kèm file:line>`. Verifier đỏ ⇒ REJECT NGAY (không xem diff).
      `REVIEW: REJECT` → quay lại IMPLEMENT.
    - Fallback: ck: VẮNG → chỉ dùng `hlk-reviewer`.

11. **RECORD** (TẤT ĐỊNH) — dùng `harness-cli` cập nhật intake, trace, story status.
    - Trace lane normal trở lên PHẢI đạt tier standard: gắn `--intake` (id từ CLASSIFY) /
      `--story` (khi item có story row) / `--actions` / `--read` / `--changed`; kiểm bằng
      `scripts/bin/harness-cli score-trace --id <id>`.
    - Human can thiệp/duyệt giữa vòng → ghi `harness-cli intervention add --type <loại>
      --description <mô tả> --source human [--trace <id>|--story <id>] [--impact <tác động>]`
      (cú pháp đã kiểm bằng --help, 0.1.11).
    - Lane normal PHẢI có story row (`harness-cli story add` / `story update`) trước khi
      đóng item.
    - CỐ VẤN (decision 0021): ĐƯỢC chạy THÊM `/ck:docs` để DÒ doc-drift và ĐỀ XUẤT vá (patch
      gợi ý). `/ck:docs` CHỈ ĐỌC + báo cáo — KHÔNG thay `harness-cli` ghi durable-row, KHÔNG tự
      sửa/commit docs (đề xuất ghi ra advisory để human/engine chốt). Side-call fail-open:
      `/ck:docs` VẮNG hoặc lỗi → SKIP sạch, KHÔNG block vòng.
    - DECISION RED-TEAM (chỉ item high-risk cần decision record MỚI `docs/decisions/NNNN-*.md`):
      TRƯỚC khi human chốt bản decision, chạy `/ck:predict` red-team bản DRAFT decision +
      `/ck:scenario` liệt kê edge-case hệ quả (cả hai READ-ONLY, được phóng song song — trần 3
      như trên), rồi đính TÓM TẮT phản biện vào mục Alternatives/Consequences của draft.
      ck:* CHỈ phản biện — human/harness vẫn là bên chốt và đăng ký durable row
      (`harness-cli decision add`), nhất quán decision 0021. Degrade: skill vắng/lỗi → SKIP
      sạch, decision vẫn đi tiếp theo đường thường.

12. **COMMIT** (TẤT ĐỊNH — LLM KHÔNG commit) — đầu chặng: XOÁ khoá `loop/.state/nocommit.lock`
    (#105 — chỉ xoá SAU KHI verifier xanh và reviewer approve). Chính **orchestrator** chạy
    `git commit` (KHÔNG dùng ck: để commit). `/hlk-commit-msg` chỉ CỐ VẤN soạn message đề xuất
    — KHÔNG chạy `git commit`; đề xuất chỉ được dùng khi dòng subject hợp lệ (non-rỗng, ≤72 ký
    tự, prefix conventional-commit), ngược lại giữ message tất định (parity headless: side-call
    `CK_COMMIT_MSG_ENABLED`, advice ghi `loop/.state/commit.message.advice.txt` — decision 0021).
    Commit only when verifier is green and reviewer has approved.
    - Parity #121: sau COMMIT thành công, orchestrator interactive cũng chạy `harness-cli audit`
      như headless — N>0 → `backlog add` item trả-nợ sổ sách (idempotent theo title-prefix
      `TRA-NO-SO-SACH audit entropy`), N>=60 → dừng phiên báo human.
    - #122: commit interactive cần marker `loop/.state/verify.status` dòng `green <epoch>`
      tuổi ≤45 phút (`bash loop/verify.sh` XANH tự ghi); thiếu/đỏ/quá hạn → hook chặn commit
      CODE (staged toàn docs/plans .md vẫn qua); cần vượt có chủ đích → đặt
      `HLK_COMMIT_OVERRIDE='<lý do>'` (lý do được ghi audit vào `loop/.state/harness.log`).
    - #123: gate là gác MỀM chống QUÊN-verify; miễn md-only có 3 lỗ index-timing CHẤP NHẬN
      (hook soi index tại thời điểm hook chạy): `git commit -a`, `git commit <pathspec>`,
      lệnh gộp `git add ... && git commit` — verify marker + reviewer vẫn là hàng rào chính.
      Override một-lần không cần env: ghi lý do vào file `loop/.state/commit.override`
      (bị tiêu sau đúng 1 lần dùng, kể cả khi rỗng; audit vào `harness.log`).

### Notes

- Do not modify tests to force a pass.
- Interactive KHÔNG có wrapper disallow per-stage như headless (claude-wrapper). Kỷ luật "chỉ patch
  file trong plan" dựa vào prompt + hlk-reviewer (fresh context, maker≠checker) + verify.sh (trọng
  tài) + 3 lớp commit-block. Lưu ý: /ck:cook trong subagent có thể degrade single-agent (không
  fan-out Task lồng) — chấp nhận, verify.sh vẫn gác (decision 0013).
- Khoá #105 degrade an toàn: KHÔNG có khoá / khoá stale (PID chết) → hook cho qua — không phá
  commit hợp lệ của orchestrator, post-commit-finalize, hay headless (headless không tạo khoá,
  vẫn dùng gitshim + CK_STAGE_NOCOMMIT). Residual risk: xem decision 0013.
- Mọi chặng phụ (PLAN_CRITIC/FIX/ROOT_CAUSE/SIMPLIFY) degrade sạch khi skill vắng: SKIP hoặc
  fallback ghi tại chỗ, KHÔNG bao giờ chặn vòng. Parity map đầy đủ: decision 0018.
- A health endpoint in a new scaffold is tiny lane, not a high-risk public-contract escalation.
- Run `scripts/bin/harness-cli query matrix` before starting to check equipped capabilities.
