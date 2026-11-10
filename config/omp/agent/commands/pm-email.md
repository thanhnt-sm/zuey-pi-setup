---
name: 'pm-email'
description: 'PM Email v3 (PMI Edition) — menu nhóm, full chain, cover toàn bộ công việc PM, chuẩn PMI/PMBOK 7, bảo toàn context đa session'
---

## KHỞI ĐỘNG — LOAD SESSION CONTEXT

### Bước 1: Đọc config.toml để lấy email của mình
Đọc file `${OUTLOOK_MCP_CONFIG:-~/.config/outlook-mcp/config.toml}`.
Lấy giá trị `account_name` trong section `[outlook]` — đây là địa chỉ email của user.
Lưu vào biến `MY_EMAIL` để dùng xuyên suốt session.

### Bước 2: Kiểm tra session state từ phiên trước
Kiểm tra xem file `.omp/pm-email-state.md` có tồn tại không.
Nếu có: đọc và hiển thị tóm tắt ngắn "💾 Phiên trước: [nội dung tóm tắt]" trước menu.
Nếu không có: bỏ qua, tiếp tục hiển thị menu.

### Bước 3: Tính days_back thông minh theo ngày trong tuần
- Thứ Hai (Monday): days_back_daily = 3  (cover cả thứ 7 + chủ nhật)
- Thứ Sáu (Friday): days_back_daily = 1
- Ngày khác: days_back_daily = 1
- Sau kỳ nghỉ lễ > 2 ngày: days_back_daily = nghỉ + 1

### Bước 4: Xử lý args
Đọc $ARGUMENTS.
Nếu không có args hoặc args là "menu": hiển thị MENU rồi hỏi chọn số.
Nếu đang trong menu và user chọn [0]: kết thúc session, không làm gì thêm.
Nếu args là "0": hiển thị MENU (vì user có thể muốn xem menu, không phải exit).
Nếu có args rõ ràng: nhận diện intent, chạy workflow ngay, bỏ qua menu.

---

## MENU v3 — Hiển thị khi cần

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📬  PM EMAIL v3 (PMI Edition) — Chọn workflow
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ── HÀNG NGÀY ──────────────────────────────────────────────
  [1]  📋 DAILY BRIEF       Briefing đầy đủ + ưu tiên theo tác động
  [8]  ⚡ QUICK TRIAGE      Phân loại nhanh inbox + action ngay

  ── HỌP & STAKEHOLDER ──────────────────────────────────────
  [2]  🤝 PRE-MEETING       Chuẩn bị họp: context, timeline, câu hỏi
  [C]  📅 CALENDAR CHECK    Lịch họp sắp tới + email liên quan cần chuẩn bị
  [S]  🌡️  STAKEHOLDER TEMP  Ai đang im lặng? Ai đang leo thang?

  ── THEO DÕI ───────────────────────────────────────────────
  [3]  🔔 PENDING + SLA     Pending + email tôi gửi chưa được reply
  [4]  📊 DASHBOARD         Health check tất cả projects

  ── SOẠN THẢO ──────────────────────────────────────────────
  [5]  ✍️  SMART DRAFT       Reply/soạn đúng tone + xác nhận trước gửi
  [T]  📝 TEMPLATE DRAFT    Chọn template PM chuẩn → điền context

  ── PHÂN TÍCH ──────────────────────────────────────────────
  [6]  🔍 DEEP SEARCH       Tìm kiếm đa folder, đa filter, drill-down
  [7]  📈 COMM REPORT       Báo cáo giao tiếp + cross-project
  [9]  🧵 THREAD DEEP DIVE  Đọc sâu 1 thread, trích decisions

  ── PMI / CHUẨN NGHỀ ───────────────────────────────────────
  [P]  📄 PROJECT STATUS    Status report chuẩn PMI + EVM indicators
  [R]  ⚠️  RISK COMM         Soạn email thông báo risk/issue chuẩn PMI

  ── TOÀN DIỆN ──────────────────────────────────────────────
  [A]  🔄 FULL AUDIT        Kiểm tra toàn diện mọi folder, mọi metric
  [0]  ← EXIT / BACK

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Gõ [1-9], [C/S/T/P/R/A] hoặc mô tả tự nhiên
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## NHẬN DIỆN INTENT TỪ ARGS

- 1 / "brief" / "sáng" / "morning" / "daily"     → WORKFLOW 1
- 2 / "họp" / "meeting" / "prep" / "chuẩn bị"    → WORKFLOW 2
- 3 / "pending" / "flag" / "chờ" / "nợ" / "sla"  → WORKFLOW 3
- 4 / "dashboard" / "health" / "all"             → WORKFLOW 4
- "status" đứng một mình (không có "project")    → Hỏi: "[4] Dashboard tổng thể hay [P] PMI Status Report cho 1 project?"
- "project status" / "status report" / "báo cáo tiến độ" → WORKFLOW P
- 5 / "draft" / "soạn" / "reply" / "viết"        → WORKFLOW 5
- 6 / "tìm" / "search" / "find" / "kiếm"         → WORKFLOW 6
- 7 / "report" / "báo cáo" / "tuần" / "tháng"    → WORKFLOW 7
- 8 / "triage" / "nhanh" / "quick" / "inbox"     → WORKFLOW 8
- 9 / "thread" / "chain" / "luồng" / "hội thoại" → WORKFLOW 9
- c / "calendar" / "lịch họp" / "meeting sắp tới" / "họp tuần này" → WORKFLOW C
- s / "stakeholder" / "nhiệt" / "im lặng"        → WORKFLOW S
- t / "template" / "mẫu" / "format"              → WORKFLOW T
- p / "pmi" / "evm" / "project status"           → WORKFLOW P
- r / "risk" / "rủi ro" / "issue" / "vấn đề"     → WORKFLOW R
- a / "audit" / "full" / "toàn diện"             → WORKFLOW A

**Intent nhanh vào template (bỏ qua menu [T]):**
- "nhắc nhở" / "nhắc reply" / "follow up" / "chưa reply"  → WORKFLOW T, template [11]
- "sự cố" / "incident" / "lỗi đang xảy ra" / "outage"     → WORKFLOW T, template [12]
- "nghiệm thu" / "uat" / "sign off" / "ký nghiệm thu"     → WORKFLOW T, template [13]
- "triển khai" / "go-live" / "deploy" / "bảo trì"         → WORKFLOW T, template [14]
- "xin thông tin" / "cần tài liệu" / "rfi" / "request info" → WORKFLOW T, template [15]
- "mời họp" / "lịch họp" / "meeting invite" / "agenda"    → WORKFLOW T, template [16]
- "vendor" / "nhà cung cấp" / "bàn giao" / "sla vendor" / "nhà thầu" → WORKFLOW T, template [17]

---

## [1] DAILY BRIEF — Briefing đầy đủ + Priority thông minh

Mục tiêu: 5 phút nắm toàn bộ, biết ưu tiên đúng theo tác động thực tế (không chỉ theo tuổi email).

### Chuỗi tool calls:

BƯỚC 1 — Tổng quan:
Gọi email_stats → lấy unread count và total cho mỗi folder.
Ghi nhận danh sách folders có unread > 0.

BƯỚC 2 — Snapshot folders có hoạt động (chỉ load folders thực sự có data):
Với MỖI folder có unread > 0 HOẶC trong active project list:
Gọi get_project_snapshot(folder_name, days_back=days_back_daily).
KHÔNG gọi snapshot cho folder có unread = 0 và không trong active list.

BƯỚC 3 — Pending items:
Gọi get_flagged_emails cho từng project folder:
[CLIENT_A.PROJ], [CLIENT_B.PROJ], [CLIENT_C.PROJ], [ORG], [CLIENT_A.OPS].

BƯỚC 4 — Priority Scoring thông minh (PMI Stakeholder Domain):
Áp dụng scoring cho từng email/item:
- +3 điểm: sender là C-level / Director / Giám đốc / CTO / CEO
- +2 điểm: subject chứa "urgent" / "ASAP" / "khẩn" / "deadline" / "approve" / "phê duyệt"
- +2 điểm: email flagged > 7 ngày
- +1 điểm: email chưa đọc > 3 ngày
- +1 điểm: sender đã gửi > 3 email trong 7 ngày (escalating frequency)
Sắp xếp theo tổng điểm, không phải theo tuổi.
LƯU Ý: Priority score là phỏng đoán tốt nhất (heuristic) từ email subject và sender address patterns.
Điểm C-level (+3) chỉ áp dụng khi email address chứa rõ "ceo", "cto", "director", "giamdoc" hoặc subject/body chứa chức danh. Không chính xác tuyệt đối.

### Output format:

---
📋 DAILY BRIEF — [Ngày đầy đủ, thứ trong tuần]
Coverage: [days_back_daily] ngày qua
---

TỔNG QUAN
  Chưa đọc: X email | Folders active: Y | Việc cần làm: Z

THEO PROJECT (chỉ hiện folder có hoạt động)
  📁 [Tên folder]
     • [N] ngày: X nhận, Y chưa đọc, Z flagged
     • Top sender: [Tên/email]: X email
     • [Cảnh báo nếu có: unread > 5 ngày, flagged > 7 ngày]

PRIORITY LIST (xếp theo tác động, không theo tuổi)
  🔴 PHẢI LÀM NGAY (score ≥ 4):
     [score] [ ] [Subject] — [Sender] — [Folder] — [Ngày nhận]
             → Vì: [lý do score cao]
  🟡 CẦN LÀM HÔM NAY (score 2-3):
     [score] [ ] [Subject] — [Sender] — [Folder]
  🟢 CÓ THỂ DỜI (score 0-1):
     [ ] ...

ĐỀ XUẤT 3 VIỆC ĐẦU TIÊN:
  1. [Việc cụ thể — ai — folder — action gợi ý]
  2. ...
  3. ...
---

---

## [2] PRE-MEETING PREP — Chuẩn bị họp

Mục tiêu: 10 phút trước họp, nắm đủ context, có câu hỏi sắc bén.

Nếu chưa có trong args: hỏi "Họp về project nào? (tên folder)" và "Tên/email người tham gia chính?"

### Chuỗi tool calls:

BƯỚC 1: get_project_snapshot(folder_name, days_back=30).
BƯỚC 2: Nếu có tên khách: search_emails(query=tên_khách, folder_path=folder_name, date_from=30_ngày_trước).
         Nếu không: list_emails(folder_path=folder_name, limit=20).
BƯỚC 3: get_flagged_emails(folder_name=folder_name) → open items.
BƯỚC 4: Lấy entry_id email gần nhất → get_email_thread(entry_id, max_emails=10).
BƯỚC 5: read_email cho email gốc thread + email mới nhất.
BƯỚC 6 (PMI): Phân tích stakeholder engagement level:
  - Không reply > 7 ngày: Resistant/Unaware
  - Reply nhanh, nhiều câu hỏi: Engaged/Leading
  - Reply ngắn, ít cam kết: Neutral/Supportive

### Output format:

---
🤝 PRE-MEETING BRIEF — [Folder/Project] — [Ngày]
---

TỔNG QUAN 30 NGÀY
  Nhận: X | Chưa đọc: Y | Flagged: Z
  Top liên lạc: [Tên]: X email (reply avg: Y ngày)

STAKEHOLDER ENGAGEMENT (PMI)
  [Tên]: [Engaged/Neutral/Resistant] — [bằng chứng từ email pattern]

TIMELINE TÀO ĐỔI QUAN TRỌNG
  [DD/MM] [Subject] — [Sender] → [quyết định / yêu cầu / kết quả]

VẤN ĐỀ CÒN MỞ
  • [Vấn đề] — chờ từ [ngày] — [ai cần làm gì]

CÂU HỎI NÊN HỎI TRONG HỌP
  1. [Câu hỏi từ gap phát hiện qua email — có dẫn chứng]
  2. ...

CONTEXT THÊM: [thông tin quan trọng từ thread]
---

---

## [3] PENDING + SLA — Toàn bộ việc chờ + email chưa được reply

Mục tiêu: Không chỉ flagged emails — còn cả email tôi đã gửi mà chưa có ai reply lại.

### Chuỗi tool calls:

PHẦN A — Flagged items (việc cần làm):
Gọi get_flagged_emails cho: Inbox, [CLIENT_A.PROJ], [CLIENT_B.PROJ], [CLIENT_C.PROJ], [ORG], [CLIENT_A.OPS].

PHẦN B — SLA Monitor (email tôi gửi chưa có reply > 48h):
Gọi list_emails(folder_path="Sent Items", limit=30).
Lọc: email sent > 48 giờ trước, subject KHÔNG bắt đầu bằng "Re:" (tức là email tôi gửi chủ động).
Với mỗi email này:
BƯỚC B2 — Check reply trong Inbox trước, sau đó project folders:
search_emails(query=subject_gốc, folder_path="Inbox", limit=5).
Nếu không tìm thấy: search_emails(query=subject_gốc, folder_path=[CLIENT_A.PROJ], limit=3) và các project folders.
Nếu tất cả đều không có reply: đây là SLA breach.
Giới hạn: chỉ check tối đa 10 sent emails để tránh quá nhiều COM calls.

PHẦN C — Approval Tracking:
Từ kết quả Phần B, lọc subject có "approve" / "phê duyệt" / "confirm" / "xác nhận" / "sign-off" → nhóm riêng.

BƯỚC cuối: email_stats để bổ sung unread lâu ngày.

### Output format:

---
🔔 PENDING + SLA — [Ngày]
   Flagged: X | SLA Breach (chưa reply): Y | Approval waiting: Z
---

🔴 APPROVAL ĐANG CHỜ (cần reply của người khác):
  [ ] [Subject] — gửi ngày [DD/MM] — chờ [X] ngày
      Gửi đến: [Tên/email] | Folder: [Folder]
      → Đề xuất: [nhắc lại / escalate / đóng]

🟠 SLA BREACH — Email tôi gửi > 48h chưa có reply:
  [ ] [Subject] — [Tên người nhận] — gửi [DD/MM] — [X] ngày
      → Đề xuất: [nhắc lại / forward / gặp trực tiếp]

🔴 FLAGGED URGENT (> 7 ngày):
  [ ] [Subject] — [Sender] — [Folder] — [DD/MM] — [X] ngày
      → [reply ngắn / escalate / đóng]

🟡 FLAGGED SOON (3-7 ngày):
  [ ] ...

🟢 FLAGGED NEW (< 3 ngày):
  [ ] ...

---
Tổng: X items | Ước tính: ~Y phút | Thứ tự đề xuất: [1,2,3]
---

---

## [4] DASHBOARD — Health check tất cả projects + Stakeholder Alert

Mục tiêu: Một cái nhìn tổng thể — projects, contacts, cảnh báo.

### Chuỗi tool calls:

BƯỚC 1: get_project_snapshot × 5 project folders (days_back=30). Tuần tự.
BƯỚC 2: get_flagged_emails × 5 project folders.
BƯỚC 3 (Stakeholder Temperature — không gọi thêm snapshot):
Dùng dữ liệu từ Bước 1 (snapshot 30d) đã có.
Từ danh sách top senders: gọi get_contact_stats(email=contact) cho top 2 contacts/project.
Phân tích trend: email count 30 ngày / 4 tuần = avg/tuần.
So sánh với contact_stats.recent_week_count nếu có trong response.

### Output format:

---
📊 DASHBOARD — 30 ngày qua — [Ngày]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
---

TỔNG QUAN PROJECTS:

  Project          │ Email │ Unread │ Flagged │ Status
  ─────────────────┼───────┼────────┼─────────┼──────────────────
  [CLIENT_A.PROJ]  │  X    │  Y     │  Z      │ 🟢 Active
  [CLIENT_B.PROJ]  │  X    │  Y     │  Z      │ 🟡 Cần chú ý
  [CLIENT_C.PROJ]  │  X    │  Y     │  Z      │ 🔴 Urgent
  [ORG]            │  X    │  Y     │  Z      │ ⚪ Quiet
  [CLIENT_A.OPS]   │  X    │  Y     │  Z      │ 🟢 Active

STAKEHOLDER TEMPERATURE (PMI — 7 ngày qua):
  🔥 Escalating:   [Tên] ([Project]) — X email/tuần này vs Y tuần trước
  🧊 Going Silent: [Tên] ([Project]) — không email từ [ngày]
  ✅ Normal:        [Danh sách contacts ổn định]

CẦN CHÚ Ý (Projects có vấn đề):
  📁 [Project]: [Mô tả vấn đề — flagged cũ, unread nhiều, stakeholder silent]
     → Đề xuất action cụ thể

ĐỀ XUẤT TUẦN NÀY:
  1. [Project ưu tiên nhất] — lý do + action
  2. ...
---

Muốn làm gì tiếp? (reply email nào đó / xem chi tiết project X / [5] soạn thư / số hoặc mô tả)

---

## [5] SMART DRAFT — Soạn/reply thông minh

Mục tiêu: Draft đúng tone, đúng context, xác nhận trước khi mở Outlook.

Nếu chưa có: hỏi "Subject hoặc entry_id email cần reply/soạn?"

### Chuỗi tool calls:

BƯỚC 1: Nếu có subject: search_emails(query=subject, limit=5) → chọn email đúng.
BƯỚC 2: read_email(entry_id) → nội dung đầy đủ.
BƯỚC 3: get_email_thread(entry_id, max_emails=15) → full context.
BƯỚC 4: search_emails(query=domain_người_nhận, search_in="sender", folder_path="Sent Items", limit=3).
  Dùng MY_EMAIL từ config.toml đã load ở KHỞI ĐỘNG.
  Học văn phong từ Sent Items để match tone.
BƯỚC 5 — Soạn với R.A.G.E. (PMI Communication Management):
  - Role: vai trò PM trong context project này
  - Audience: cấp bậc người nhận (từ email patterns + chức danh)
  - Goal: xác nhận / làm rõ / escalate / đóng vấn đề
  - Essentials: thông tin cần thiết từ thread + project context

BƯỚC 6 — Quyết định CC/BCC và Reply vs Forward:

CC (Gửi thêm để biết thông tin):
- Thêm CC khi: email liên quan đến quyết định mà cấp trên/bên liên quan cần nắm
- Bắt buộc CC khi: đây là email cam kết (deadline, ngân sách, scope) — tạo paper trail
- Không CC khi: nội dung chỉ cần 2 bên biết, hoặc đang xử lý vấn đề nhạy cảm

BCC (Gửi kín — người nhận chính không thấy):
- Dùng BCC khi: báo cáo nội bộ lên cấp trên mà không muốn tạo áp lực với đối phương
- Dùng BCC khi: gửi cùng nội dung cho nhiều người, mỗi người không cần thấy list của nhau
- Không lạm dụng BCC — nếu bị phát hiện, tạo mất tin tưởng

Reply vs Forward:
- Reply: khi trả lời đúng người đang hỏi
- Forward: khi cần chuyển toàn bộ thread cho người thứ ba để họ nắm đầy đủ context
- Forward + FYI: khi chỉ cần người đó biết, không cần hành động

→ Gợi ý CC/BCC cụ thể cho draft này dựa trên R.A.G.E. analysis: [Ai nên được CC/BCC và lý do]

BƯỚC 7 — Trình bày draft:

---
✍️ SMART DRAFT PROPOSAL
---
Gửi: [Tên người nhận]
CC: [Gợi ý nếu cần — VD: "Manager dự án — để tạo paper trail về cam kết này"]
Subject: Re: [Subject gốc]
Tone: [Formal/Professional/Friendly] — học từ [X email trong Sent Items]
Goal: [mục tiêu của email này theo R.A.G.E.]

---DRAFT---
[Nội dung — ngôn ngữ theo thread (Việt/Anh), tự nhiên, không rườm rà]
---END DRAFT---

BƯỚC 7B — Tone Coaching (pre-send check — tự động ngay sau BƯỚC 7, TRƯỚC khi hỏi xác nhận):
Kiểm tra 3 điểm và ghi chú inline ngay sau ---END DRAFT---:
  - Tông thư: [Quá thân mật / Phù hợp / Quá cứng nhắc] — so với cấp bậc người nhận từ R.A.G.E.
  - Độ rõ ràng: Action item có rõ không? Deadline có explicit không?
  - Subject line: Dưới 60 ký tự? Có tên project không?
Nếu phát hiện vấn đề: hiển thị gợi ý sửa nhỏ, KHÔNG tự động sửa vào draft.
Ví dụ hiển thị:
  ⚠️ Tone coaching: Subject "[[PROJECT]] Xin phê duyệt điều chỉnh deadline giai đoạn 2 tháng 7" (72 ký tự)
      → Gợi ý: "[[PROJECT]] Cần phê duyệt — điều chỉnh deadline phase 2" (55 ký tự)
  ✅ Tông thư: Phù hợp — Professional, không quá thân mật
  ✅ Action item: Rõ ràng — deadline và người chịu trách nhiệm đã nêu

Sau khi hiển thị kết quả Tone Coaching: Chỉnh sửa hay xác nhận? (có / sửa [điểm cụ thể] / hủy)
---

BƯỚC 8 — CHỈ gọi reply_draft(entry_id, body=nội_dung) SAU KHI người dùng xác nhận.
Sau khi mở: "Outlook đã mở draft. Kiểm tra và nhấn Send khi sẵn sàng."
KHÔNG BAO GIỜ tự động gửi — chỉ .Display().

---

## [T] TEMPLATE DRAFT — Soạn từ template chuẩn PM

Mục tiêu: Dùng template có sẵn, điền context thực tế, tạo email chuẩn nghề.

### Templates có sẵn (hiển thị để chọn):

```
[1]  Báo cáo tiến độ tuần      — Cập nhật tiến độ tuần cho stakeholders
[2]  Thông báo chậm tiến độ    — Thông báo delay + nguyên nhân + kế hoạch xử lý
[3]  Khởi động dự án           — Email khai mạc dự án/giai đoạn mới
[4]  Yêu cầu phê duyệt         — Xin phê duyệt tài liệu/quyết định
[5]  Tóm tắt cuộc họp          — Tóm tắt họp + việc cần làm
[6]  Leo thang vấn đề          — Leo thang vấn đề lên cấp trên
[7]  Thông báo rủi ro (ngắn)   — Cảnh báo nhanh cho stakeholders (*khác [R])
[8]  Thông báo hoàn thành dự án — Email kết thúc dự án/giai đoạn
[9]  Yêu cầu thay đổi          — Thay đổi scope/timeline — xin phê duyệt CCR
[10] Giới thiệu stakeholder    — Giới thiệu thành viên mới + tóm tắt dự án
[11] Nhắc nhở lịch sự          — Nhắc reply email: lần 1 (nhẹ) hoặc lần 2+ (kiên quyết)
[12] Thông báo sự cố           — Sự cố đang xảy ra: mô tả, tác động, xử lý
[13] Đề nghị nghiệm thu / UAT  — Xin ký kết nghiệm thu giai đoạn / toàn dự án
[14] Thông báo triển khai      — Lịch go-live, bảo trì, rollback plan
[15] Yêu cầu cung cấp TT/TL   — Xin thông tin hoặc tài liệu từ các bên (có bảng)
[16] Mời họp                   — Gửi lịch họp kèm agenda + mục tiêu rõ ràng
[17] Vendor / nhà cung cấp     — Yêu cầu bàn giao / đánh giá hiệu suất / nhắc vi phạm SLA
```
*[7] Thông báo nhanh 1 trang cho stakeholders | [R] Báo cáo PMI đầy đủ có Risk ID, ĐÁNH GIÁ, KẾ HOẠCH ỨNG PHÓ chi tiết
*[11] chọn variant: [11a] lần 1 — nhẹ nhàng sau 3 ngày | [11b] lần 2+ — kiên quyết sau 7+ ngày
*[17] chọn variant: [17a] Yêu cầu bàn giao | [17b] Đánh giá hiệu suất vendor | [17c] Nhắc vi phạm SLA

Sau khi chọn template:
BƯỚC 0 — Xác định context:
Nếu args chứa tên project/folder rõ ràng: dùng ngay.
Nếu không: hỏi "Template này cho project nào? Gửi cho ai?" (tên folder trong allowed folders).
Lưu vào biến project_folder, recipient_hint để dùng trong các bước sau.

BƯỚC 1 — Thu thập context thực tế (smart context gathering):
a) Gọi search_emails(folder_path=project_folder, limit=10) → lấy emails gần nhất.
b) Nếu template là [2][6][9][12][13][16][17]: search_emails thêm với query phù hợp template:
   - [2] delay: query="delay chậm"
   - [6] escalation: query="vấn đề chặn block"
   - [9] change: query="thay đổi change request"
   - [12] incident: query="lỗi sự cố incident"
   - [13] UAT: query="nghiệm thu uat test"
   - [16] meeting: query="họp meeting agenda lịch"
   - [17] vendor: query="bàn giao vendor sla hợp đồng"
c) Nếu recipient_hint có tên/email: search_emails(query=recipient_hint, folder_path=project_folder, limit=5) để lấy lịch sử giao tiếp với người đó.

BƯỚC 2 — Điền template thông minh:
Từ data emails: tự động điền tên project, tên người liên quan, ngày tháng, số liệu thực tế.
Đánh dấu [CẦN ĐIỀN] cho các ô PM phải nhập tay (VD: con số ngân sách, quyết định cụ thể).
Ưu tiên lấy context từ email gần nhất có liên quan nhất — không đoán mò.

BƯỚC 3 — Hiển thị để confirm:
Trình bày email đã điền. Liệt kê rõ các mục [CẦN ĐIỀN] còn lại.
Hỏi: "Email trên có đúng không? Có mục nào cần điều chỉnh?"

BƯỚC 4 — Tạo draft sau xác nhận:
Chỉ sau khi PM xác nhận → compose_draft(subject=subject, body=body, to=recipient).
Hiển thị: "✅ Draft đã tạo trong Outlook — kiểm tra trước khi gửi."

### TEMPLATE NỘI DUNG:

**[1] Báo cáo tiến độ tuần:**
Subject: [Tên dự án] — Báo cáo tiến độ — Tuần [N], [Tháng/Năm]

Kính gửi [Tên / Ban quản lý dự án],

TIẾN ĐỘ TUẦN [N]:
• Trạng thái tổng thể: [🟢 Đúng tiến độ / 🟡 Có rủi ro / 🔴 Chậm tiến độ]
• Hoàn thành tuần này:
  ✅ [Công việc 1 — VD: "Hoàn thiện thiết kế màn hình login" — Nguyễn A]
  ✅ [Công việc 2 — VD: "Ký kết biên bản yêu cầu với [CLIENT_B]" — PM]
• Đang thực hiện:
  🔄 [Công việc — VD: "Phát triển module báo cáo" — Team dev — xong [DD/MM]]
  🔄 [Công việc — VD: "Review API với vendor [ORG]" — Trần B — xong [DD/MM]]

ĐIỂM NỔI BẬT:
• [Thành tựu / tín hiệu tích cực — VD: "Client [CLIENT_B] phản hồi tích cực về prototype"]
• [Thách thức đang vượt qua — VD: "Đã giải quyết lỗi timeout sau 2 ngày debug"]

ĐIỂM CHÚ Ý / ĐIỂM CHẶN:
• [Vướng mắc đang ảnh hưởng tiến độ — VD: "Đang chờ phê duyệt ngân sách bổ sung từ Ban GĐ"]
• Cần hỗ trợ: [Ai cần làm gì để tháo gỡ — hạn chót — VD: "Anh Minh xác nhận trước 15/07"]
(Nếu không có điểm chặn: ghi "Không có — tiến độ thuận lợi")

MỤC CẦN QUYẾT ĐỊNH:
• [Quyết định — ai quyết — hạn — hậu quả nếu trễ — VD: "Chọn vendor backup: anh Hùng — trước 20/07 — ảnh hưởng timeline go-live"]

KẾ HOẠCH TUẦN TỚI:
• [Công việc chính 1 — ai phụ trách — dự kiến hoàn thành]
• [Công việc chính 2 — ai phụ trách — dự kiến hoàn thành]
• [Công việc chính 3 — ai phụ trách — dự kiến hoàn thành]

Trân trọng,
[Tên PM]

---

**[2] Thông báo chậm tiến độ:**
Subject: [Tên dự án] — Cập nhật tiến độ — [DD/MM/YYYY]

Kính gửi [Tên],

Tôi xin thông báo [cột mốc/deliverable] dự kiến [ngày gốc] sẽ được điều chỉnh sang [ngày mới].

NGUYÊN NHÂN: [1-2 câu rõ ràng, thực tế]

TÁC ĐỘNG: [Ảnh hưởng đến gì / ai]

LỊCH TRÌNH ĐIỀU CHỈNH:
┌──────────────────────────────┬────────────────────┬────────────────────┐
│ Cột mốc / Deliverable        │ Ngày kế hoạch gốc  │ Ngày điều chỉnh    │
├──────────────────────────────┼────────────────────┼────────────────────┤
│ [Tên cột mốc bị ảnh hưởng]  │ [DD/MM/YYYY]       │ [DD/MM/YYYY] +X ng │
│ [Cột mốc phụ thuộc tiếp]    │ [DD/MM/YYYY]       │ [DD/MM/YYYY] +X ng │
└──────────────────────────────┴────────────────────┴────────────────────┘

KẾ HOẠCH XỬ LÝ:
• [Việc 1]: [Ai] hoàn thành trước [ngày] — VD: "Team dev hoàn thiện module X trước 25/07"
• [Việc 2]: [Ai] hoàn thành trước [ngày]
• Biện pháp giảm thiểu delay: [VD: "Tăng cường nhân sự / ưu tiên task quan trọng nhất"]

Tôi sẽ cập nhật tiến độ vào [ngày check-in tiếp theo].

Trân trọng,
[Tên PM]

---

**[3] Email khởi động dự án:**
Subject: [Tên dự án] — Khởi động dự án — [DD/MM/YYYY]

Kính gửi [Tên team/các bên liên quan],

Tôi xin thông báo dự án [tên] chính thức bắt đầu từ [ngày].

NHÓM DỰ ÁN:
• Quản lý dự án: [Tên] — [email]
• [Vai trò khác]: [Tên] — [email]

MỤC TIÊU DỰ ÁN:
[1-2 câu mô tả kết quả kinh doanh kỳ vọng — VD: "Triển khai hệ thống quản lý tín dụng, giảm thời gian xử lý hồ sơ từ 3 ngày xuống còn 4 giờ"]

PHẠM VI DỰ ÁN:
[Mô tả các hạng mục bàn giao chính — VD: "Gồm 3 module: Tiếp nhận, Phê duyệt, Giải ngân"]

ĐIỀU KIỆN THÀNH CÔNG:
• [Tiêu chí đo lường được — VD: "Go-live đúng hạn 30/09/2026"]
• [Tiêu chí đo lường được — VD: "100% nghiệp vụ critical được kiểm thử và ký nghiệm thu"]

LỊCH TRÌNH:
• Khởi động: [Ngày]
• [Cột mốc 1]: [Ngày]
• [Cột mốc 2]: [Ngày]
• Hoàn thành / Go-live: [Ngày]

KẾ HOẠCH LIÊN LẠC:
• Họp định kỳ: [Ngày trong tuần, giờ]
• Báo cáo tuần: [Ngày gửi]
• Kênh liên lạc chính: [Email / Teams / Zalo]

VIỆC CẦN LÀM NGAY:
• [Ai]: [Làm gì] — trước [Ngày]
• ...

Mọi câu hỏi xin liên hệ tôi trực tiếp.

Trân trọng,
[Tên PM]

---

**[4] Yêu cầu phê duyệt:**
Subject: [CẦN PHÊ DUYỆT] [Dự án] — [Tên tài liệu/quyết định] — Hạn [DD/MM]

Kính gửi [Tên người có thẩm quyền],

MỨC ĐỘ ƯU TIÊN: [🟢 Bình thường | 🟡 Cần sớm — ảnh hưởng đến kế hoạch | 🔴 Khẩn — chặn tiến độ team]

NỘI DUNG CẦN PHÊ DUYỆT:
[Mô tả rõ: tài liệu gì / quyết định gì — VD: "Bản thiết kế giao diện module Tiếp nhận v1.2"]

BỐI CẢNH:
[1-2 câu giải thích tại sao cần phê duyệt lúc này — VD: "Team dev cần xác nhận để bắt đầu coding sprint 3"]

CÁC PHƯƠNG ÁN (nếu có):
• Phương án A: [Mô tả] — Ưu: [điểm mạnh] | Rủi ro: [điểm yếu]
• Phương án B: [Mô tả] — Ưu: [điểm mạnh] | Rủi ro: [điểm yếu]
→ Tôi đề xuất: [Phương án X] vì [lý do ngắn, dựa trên tiêu chí gì]

THỜI HẠN PHÊ DUYỆT: [DD/MM/YYYY HH:mm]
Hậu quả nếu trễ: [VD: "Sprint 3 bị delay, dời go-live tối thiểu 1 tuần"]

TÀI LIỆU ĐÍNH KÈM: [Tên file / link]

Anh/chị vui lòng reply một trong ba: "✅ Đồng ý" / "💬 Cần thảo luận — đề xuất lịch [DD/MM]" / "❌ Từ chối — lý do: ...".

Trân trọng,
[Tên PM]

---

**[5] Tóm tắt cuộc họp:**
Subject: [Dự án] — Tóm tắt cuộc họp [DD/MM] — [X] action items

Xin chào,

Tóm tắt cuộc họp [loại họp — VD: Họp sprint review / Họp báo cáo tiến độ tháng] ngày [DD/MM/YYYY], [HH:mm]–[HH:mm].

NGƯỜI THAM DỰ: [Tên] ([Công ty/Vai trò]), [Tên] ([Vai trò]), ...
Vắng mặt: [Tên] — [Lý do nếu có]

MỤC ĐÍCH CUỘC HỌP: [1 câu — VD: "Review tiến độ sprint 2 và chốt kế hoạch sprint 3"]

QUYẾT ĐỊNH ĐÃ CHỐT:
✅ [Quyết định 1 — VD: "Chốt ngày go-live: 15/08/2026"]
✅ [Quyết định 2 — VD: "Bỏ tính năng export PDF khỏi phạm vi giai đoạn 1"]
(Nếu không có quyết định nào: ghi "Chưa có quyết định mới — tiếp tục theo kế hoạch")

ĐIỂM CHƯA THỐNG NHẤT / CẦN QUYẾT ĐỊNH SAU:
⚠️ [Vấn đề chưa chốt 1] — Ai quyết: [Tên] — Hạn: [DD/MM]
⚠️ [Vấn đề chưa chốt 2] — Ai quyết: [Tên] — Hạn: [DD/MM]
(Nếu không có: bỏ mục này)

VIỆC CẦN LÀM:
┌────┬──────────────────────────────────┬──────────────────┬────────────┐
│ #  │ Nội dung                         │ Người phụ trách  │ Hạn chót   │
├────┼──────────────────────────────────┼──────────────────┼────────────┤
│ 1  │ [VD: Cập nhật tài liệu API v2]   │ [Tên]            │ [DD/MM]    │
│ 2  │ [VD: Setup môi trường UAT]       │ [Tên]            │ [DD/MM]    │
│ 3  │ [Việc cần làm 3]                 │ [Tên]            │ [DD/MM]    │
└────┴──────────────────────────────────┴──────────────────┴────────────┘

VẤN ĐỀ CÒN MỞ:
❓ [Câu hỏi chưa có câu trả lời] — Chờ phản hồi từ [Ai] — Hạn [DD/MM]
(Nếu không có: bỏ mục này)

CUỘC HỌP TIẾP THEO: [Ngày / Giờ / Link / Chủ đề dự kiến]

Vui lòng xác nhận action item của mình trong vòng 24h. Nếu có vấn đề với deadline, phản hồi ngay để điều chỉnh.

Trân trọng,
[Tên PM]

---

**[6] Leo thang vấn đề:**
Subject: [LEO THANG] [Tên dự án] — [Vấn đề ngắn gọn]

Kính gửi [Tên cấp trên],

Tôi cần sự hỗ trợ của anh/chị để giải quyết vấn đề sau:

MỨC ĐỘ LEO THANG: [🟡 Cần hỗ trợ / 🔴 Khẩn cấp — ảnh hưởng đến go-live / 🆘 Nghiêm trọng — dừng dự án]

VẤN ĐỀ: [Mô tả rõ ràng — VD: "Vendor [ORG] chưa bàn giao tài liệu API sau 3 tuần, team dev không thể tích hợp"]
THỜI GIAN PHÁT SINH: [DD/MM/YYYY]
TÁC ĐỘNG NẾU KHÔNG GIẢI QUYẾT TRƯỚC [DD/MM]:
• Tiến độ: [VD: "Trễ go-live tối thiểu 2 tuần"]
• Hậu quả: [VD: "Vi phạm điều khoản SLA hợp đồng với [CLIENT_B]"]

LỊCH SỬ XỬ LÝ:
• [DD/MM]: [Hành động đã làm] → Kết quả: [VD: "Gửi email nhắc nhở — không có phản hồi"]
• [DD/MM]: [Hành động tiếp theo] → Kết quả: [VD: "Gọi điện trực tiếp — được hứa sẽ gửi trong tuần nhưng chưa nhận"]
• [DD/MM]: [Hành động gần nhất] → Kết quả: [VD: "Vẫn chưa có tài liệu — vượt quá khả năng PM xử lý"]

CẦN HỖ TRỢ: [Cụ thể — VD: "Anh/chị liên hệ trực tiếp với Ban GĐ vendor để yêu cầu bàn giao trước [ngày]"]

Tôi sẵn sàng trao đổi thêm bất cứ lúc nào.

Trân trọng,
[Tên PM]

---

**[7] Thông báo rủi ro:**
Subject: [Dự án] — ⚠️ Cảnh báo rủi ro: [Tên rủi ro] — [Cao/Trung bình/Thấp]

Kính gửi [Tên các bên liên quan],

Tôi muốn thông báo một rủi ro mới vừa được nhận diện trong dự án.

RỦI RO: [Mô tả ngắn gọn 1-2 câu]
MỨC ĐỘ: [🔴 Cao / 🟡 Trung bình / 🟢 Thấp]
KHẢ NĂNG XẢY RA: [Cao / Trung bình / Thấp]

TÁC ĐỘNG NẾU XẢY RA:
• Lịch trình: [ảnh hưởng thế nào]
• Chi phí: [ảnh hưởng thế nào nếu có]

HÀNH ĐỘNG ĐÃ TRIỂN KHAI:
• [Hành động 1 — ai chịu trách nhiệm]
• [Hành động 2]

CẦN HỖ TRỢ TỪ ANH/CHỊ: [Cụ thể hoặc "Không — chỉ thông báo để nắm thông tin"]

Tôi sẽ cập nhật tình trạng vào [ngày check-in tiếp theo].

Trân trọng,
[Tên PM]

---

**[8] Thông báo hoàn thành dự án:**
Subject: [Dự án] — Thông báo hoàn thành — [Giai đoạn / Toàn bộ dự án]

Kính gửi [Tên team/các bên liên quan],

Tôi xin thông báo [dự án / giai đoạn] [tên] đã chính thức hoàn thành vào [ngày].

KẾT QUẢ ĐẠT ĐƯỢC:
• [Sản phẩm bàn giao 1] — hoàn thành [ngày]
• [Sản phẩm bàn giao 2] — hoàn thành [ngày]
• ...

SO VỚI KẾ HOẠCH BAN ĐẦU:
• Lịch trình: [Đúng hạn / Trễ X ngày — lý do]
• Ngân sách: [Trong kế hoạch / Vượt X% — lý do]

BÀI HỌC KINH NGHIỆM:
• Làm tốt: [1-2 điểm]
• Cần cải thiện lần sau: [1-2 điểm]

BƯỚC TIẾP THEO: [Giai đoạn bảo trì / Dự án mới / Không có]

Cảm ơn tất cả các bên đã phối hợp trong suốt thời gian vừa qua.
Tôi luôn sẵn sàng hỗ trợ nếu có câu hỏi về tài liệu dự án.

Trân trọng,
[Tên PM]

---

**[9] Yêu cầu thay đổi:**
Subject: [Dự án] — Yêu cầu thay đổi — [Mã CCR] — [DD/MM/YYYY]

Kính gửi [Tên ban phê duyệt / các bên liên quan],

Tôi xin trình bày yêu cầu thay đổi cho dự án [tên] như sau:

THÔNG TIN THAY ĐỔI:
• Mã yêu cầu: [CCR-DDMM-NN]
• Loại thay đổi: [Phạm vi / Lịch trình / Ngân sách / Yêu cầu kỹ thuật]

MÔ TẢ THAY ĐỔI:
[Mô tả rõ ràng: thay đổi gì, từ trạng thái hiện tại sang trạng thái mới]

NGUYÊN NHÂN:
[Lý do cần thay đổi — yêu cầu từ khách hàng / phát sinh kỹ thuật / thay đổi nghiệp vụ]

PHÂN TÍCH TÁC ĐỘNG:
┌──────────────┬──────────────────────────┬──────────────────────────┐
│ Hạng mục     │ Kế hoạch ban đầu         │ Sau khi thay đổi         │
├──────────────┼──────────────────────────┼──────────────────────────┤
│ Phạm vi      │ [Mô tả hiện tại]         │ [Mô tả sau khi đổi]      │
│ Lịch trình   │ [DD/MM baseline]         │ [DD/MM mới / ±X ngày]    │
│ Ngân sách    │ [Số tiền / % baseline]   │ [Số mới / ±X%]           │
│ Chất lượng   │ [Tiêu chí hiện tại]      │ [Ảnh hưởng — nếu có]     │
└──────────────┴──────────────────────────┴──────────────────────────┘
Rủi ro nếu KHÔNG thay đổi: [VD: "Vi phạm yêu cầu nghiệp vụ mới của khách hàng"]
Rủi ro nếu thay đổi: [VD: "Tăng phạm vi có thể dẫn đến scope creep về sau"]

CÁC PHƯƠNG ÁN:
Phương án A (Đề xuất): [Mô tả] — Chi phí: ... | Thời gian: ...
Phương án B (Dự phòng): [Mô tả] — Chi phí: ... | Thời gian: ...

QUYẾT ĐỊNH ĐỀ NGHỊ: Phê duyệt [Phương án X]
THỜI HẠN QUYẾT ĐỊNH: [DD/MM/YYYY]
Lý do: [Nếu không quyết định trước ngày này, sẽ ảnh hưởng đến...]

Vui lòng reply "Phê duyệt" / "Từ chối" / "Cần thảo luận thêm".

Trân trọng,
[Tên PM]

---

**[10] Giới thiệu stakeholder mới:**
Subject: [Dự án] — Cập nhật nhóm dự án — Thành viên mới: [Tên]

Kính gửi [Tên team / các bên liên quan],

Tôi xin thông báo [Tên người mới] vừa tham gia dự án [tên] từ ngày [DD/MM/YYYY].

THÔNG TIN THÀNH VIÊN MỚI:
• Họ tên: [Tên đầy đủ]
• Vai trò trong dự án: [Vai trò cụ thể]
• Đơn vị / Công ty: [Tên đơn vị]
• Email liên hệ: [email]
• Phạm vi trách nhiệm: [Mô tả ngắn gọn sẽ phụ trách gì]

TÓM TẮT TÌNH TRẠNG DỰ ÁN (để [Tên] nắm bắt nhanh):
• Giai đoạn hiện tại: [Tên giai đoạn]
• Trạng thái: [🟢 Đúng tiến độ / 🟡 Có rủi ro / 🔴 Chậm tiến độ]
• Vấn đề đang xử lý: [1-2 vấn đề chính nếu có]
• Cột mốc tiếp theo: [Tên cột mốc] — [DD/MM/YYYY]

TÀI LIỆU CẦN ĐỌC:
• [Tên tài liệu 1] — [đường dẫn / đính kèm]
• [Tên tài liệu 2] — [đường dẫn / đính kèm]

Đề nghị các bên hỗ trợ [Tên] trong quá trình làm quen với dự án.

Trân trọng,
[Tên PM]

---

**[11a] Nhắc nhở lịch sự — Lần 1 (sau 3 ngày):**
Subject: Re: [Subject email gốc] — Xin xác nhận

Kính gửi [Tên],

Tôi xin phép nhắc lại email ngày [DD/MM] về [chủ đề ngắn gọn — VD: "phê duyệt bản thiết kế module Tiếp nhận"].

Tôi hiểu anh/chị có thể đang bận — xin hỏi anh/chị có cần thêm thông tin gì không, hay tôi có thể hỗ trợ gì để tiện cho việc phản hồi?

THỜI HẠN: [DD/MM/YYYY]
Lý do: [VD: "Team dev cần xác nhận trước ngày này để tiếp tục phát triển đúng hướng"]

Trân trọng,
[Tên PM]

---

**[11b] Nhắc nhở kiên quyết — Lần 2+ (sau 7+ ngày, không có phản hồi):**
Subject: [NHẮC LẦN 2] [Subject email gốc] — Cần phản hồi trước [DD/MM]

Kính gửi [Tên],

Tôi đã gửi yêu cầu ngày [DD/MM] và nhắc lại ngày [DD/MM], tuy nhiên tôi chưa nhận được phản hồi.

NỘI DUNG CẦN PHẢN HỒI:
[Tóm tắt 2-3 dòng yêu cầu từ email gốc]

TÁC ĐỘNG NẾU KHÔNG NHẬN PHẢN HỒI TRƯỚC [DD/MM]:
[VD: "Dự án sẽ bị trễ ít nhất 1 tuần, ảnh hưởng đến cam kết go-live với khách hàng"]

Nếu anh/chị không thể xử lý trong thời gian này, tôi cần biết để chủ động tìm hướng giải quyết khác.

Trân trọng,
[Tên PM]

---

**[12] Thông báo sự cố đang xảy ra:**
Subject: [SỰ CỐ] [Dự án] — [Tên sự cố] — Đang xử lý — [DD/MM HH:mm]

Kính gửi [Tên các bên liên quan],

Tôi xin thông báo sự cố đang xảy ra trong dự án:

SỰ CỐ: [Mô tả rõ ràng — VD: "Hệ thống UAT không truy cập được từ 14:30 hôm nay"]
THỜI ĐIỂM PHÁT HIỆN: [DD/MM/YYYY HH:mm]
NGUỒN PHÁT HIỆN: [Ai phát hiện — VD: "Đội test [CLIENT_B] báo cáo"]

TÁC ĐỘNG HIỆN TẠI:
• Phạm vi ảnh hưởng: [VD: "Toàn bộ team test [CLIENT_B] — 5 người — không thể tiếp tục"]
• Ước tính tác động tiến độ: [VD: "Trễ kiểm thử ít nhất 1 ngày nếu không khắc phục trước 17:00"]

NGUYÊN NHÂN: [Đã xác định: ... / Đang điều tra — sẽ có kết quả lúc [HH:mm]]

HÀNH ĐỘNG ĐANG THỰC HIỆN:
• [HH:mm] [Ai] đang làm gì — VD: "14:35 — Dev Nguyễn A đang kiểm tra server logs"
• [HH:mm] [Hành động tiếp theo] — dự kiến xong [HH:mm]

TRẠNG THÁI: [🔴 Đang xử lý / 🟡 Đã có giải pháp tạm thời / 🟢 Đã khắc phục]

Cập nhật tiếp theo: [HH:mm] hoặc ngay khi có kết quả.

Trân trọng,
[Tên PM]

---

**[13] Đề nghị nghiệm thu / UAT:**
Subject: [Dự án] — Đề nghị nghiệm thu — [Tên hạng mục] — Sẵn sàng từ [DD/MM]

Kính gửi [Tên người nghiệm thu / Ban nghiệm thu],

Chúng tôi đã hoàn thành [tên hạng mục / giai đoạn] và sẵn sàng cho quá trình nghiệm thu.

HẠNG MỤC ĐỀ NGHỊ NGHIỆM THU:
• [Hạng mục 1] — hoàn thành [DD/MM] — VD: "Module Tiếp nhận hồ sơ"
• [Hạng mục 2] — hoàn thành [DD/MM]

TIÊU CHÍ NGHIỆM THU (theo yêu cầu ban đầu):
• [Tiêu chí 1 — VD: "Thời gian xử lý tiếp nhận ≤ 30 giây/hồ sơ"]
• [Tiêu chí 2 — VD: "Không có lỗi nghiêm trọng (Critical) trong quá trình test"]

KẾT QUẢ KIỂM THỬ NỘI BỘ:
• Số test case: [X] | Đã pass: [Y] ([Z]%) | Còn lỗi: [N lỗi Minor — đã log]
• Báo cáo kiểm thử: [đính kèm / link]

THỜI GIAN NGHIỆM THU ĐỀ XUẤT: [DD/MM] — [DD/MM] ([X] ngày làm việc)
Môi trường: [Link UAT / Demo server]
Hỗ trợ kỹ thuật: [Tên] — [SĐT] — [email]

Vui lòng xác nhận lịch hoặc đề xuất thời gian phù hợp.

Trân trọng,
[Tên PM]

---

**[14] Thông báo triển khai / bảo trì hệ thống:**
Subject: [Dự án] — Thông báo triển khai — [DD/MM/YYYY] [HH:mm]–[HH:mm]

Kính gửi [Tên các bên liên quan / người dùng],

Chúng tôi sẽ thực hiện triển khai / bảo trì hệ thống theo lịch sau:

THÔNG TIN TRIỂN KHAI:
• Thời gian bắt đầu: [DD/MM/YYYY HH:mm]
• Thời gian dự kiến hoàn thành: [DD/MM/YYYY HH:mm]
• Thời gian hệ thống tạm ngừng: khoảng [X giờ X phút]

PHẠM VI ẢNH HƯỞNG:
• Hệ thống: [Tên module / toàn bộ hệ thống]
• Người dùng bị ảnh hưởng: [Nhóm / bộ phận]

NỘI DUNG TRIỂN KHAI:
• [Tính năng mới / cải tiến 1 — VD: "Thêm tính năng xuất báo cáo PDF"]
• [Tính năng mới / cải tiến 2]
• [Bug fix quan trọng — VD: "Khắc phục lỗi timeout khi upload file > 10MB"]

PHƯƠNG ÁN DỰ PHÒNG: Nếu triển khai không thành công → rollback về [version cũ] trong vòng [X phút].

LIÊN HỆ TRONG VÀ SAU TRIỂN KHAI:
• Kỹ thuật: [Tên] — [SĐT] (trực 24/7 trong ngày triển khai)
• PM: [Tên] — [SĐT]

Vui lòng sắp xếp công việc và lưu dữ liệu trước [HH:mm] ngày [DD/MM].

Trân trọng,
[Tên PM]

---

**[15] Yêu cầu cung cấp thông tin / tài liệu:**
Subject: [Dự án] — Yêu cầu cung cấp thông tin — [Chủ đề] — Hạn [DD/MM]

Kính gửi [Tên],

Để tiến hành [mục đích — VD: "phân tích nghiệp vụ giai đoạn 2"], tôi cần anh/chị cung cấp các thông tin sau:

THÔNG TIN / TÀI LIỆU CẦN:
┌────┬─────────────────────────────────────┬──────────────────┬────────────┐
│ #  │ Nội dung cần                        │ Người cung cấp   │ Hạn chót   │
├────┼─────────────────────────────────────┼──────────────────┼────────────┤
│ 1  │ [VD: Quy trình xử lý hồ sơ hiện tại]│ [Tên]           │ [DD/MM]    │
│ 2  │ [VD: Số lượng hồ sơ/tháng (6 tháng)]│ [Tên]           │ [DD/MM]    │
│ 3  │ [Tài liệu / thông tin khác]         │ [Tên]            │ [DD/MM]    │
└────┴─────────────────────────────────────┴──────────────────┴────────────┘

MỤC ĐÍCH SỬ DỤNG: [VD: "Làm cơ sở thiết kế luồng nghiệp vụ trong hệ thống mới"]
ĐỊNH DẠNG YÊU CẦU: [Excel / Word / Email reply / Khác — nếu không có yêu cầu: bất kỳ định dạng nào]

Nếu có phần nào chưa sẵn sàng hoặc cần thêm thời gian, vui lòng báo sớm để tôi có kế hoạch phù hợp.

Trân trọng,
[Tên PM]

---

**[16] Mời họp:**
Subject: [Dự án] — Mời họp: [Chủ đề cuộc họp] — [DD/MM/YYYY HH:mm]

Kính gửi [Danh sách người tham dự],

Tôi xin mời anh/chị tham dự cuộc họp sau:

THÔNG TIN CUỘC HỌP:
• Chủ đề: [VD: "Review thiết kế module Tiếp nhận — Sprint 2"]
• Thời gian: [DD/MM/YYYY] [HH:mm]–[HH:mm] ([X phút])
• Hình thức: [Trực tiếp tại [Địa điểm] / Online qua [Teams/Zoom] — [Link]]
• Chủ trì: [Tên PM]
• Thư ký: [Tên — nếu có]

MỤC TIÊU CUỘC HỌP (cần đạt được khi kết thúc):
• [Mục tiêu 1 — VD: "Chốt thiết kế giao diện — đủ để team dev bắt đầu coding"]
• [Mục tiêu 2 — VD: "Xác nhận timeline sprint 3"]
• [Mục tiêu 3 nếu có]

AGENDA:
[HH:mm] – [HH:mm] | [Chủ đề 1] | Người trình bày: [Tên]
[HH:mm] – [HH:mm] | [Chủ đề 2] | Người trình bày: [Tên]
[HH:mm] – [HH:mm] | Q&A + chốt quyết định
[HH:mm] – [HH:mm] | Tổng kết action items

TÀI LIỆU ĐỌC TRƯỚC (nếu có):
• [Tên tài liệu] — [link / đính kèm] — *đọc trước để tiết kiệm thời gian họp*

Vui lòng xác nhận tham dự trước [DD/MM]. Nếu không thể tham dự, đề nghị cử người thay hoặc báo để tôi điều chỉnh lịch.

Trân trọng,
[Tên PM]

---

**[17a] Yêu cầu bàn giao từ vendor:**
Subject: [Dự án] — Yêu cầu bàn giao: [Tên deliverable] — Hạn [DD/MM]

Kính gửi [Tên đầu mối vendor],

Theo hợp đồng / kế hoạch đã thống nhất, [Tên vendor] cần bàn giao các hạng mục sau:

HẠNG MỤC CẦN BÀN GIAO:
┌────┬────────────────────────────────┬─────────────────┬────────────┬──────────────┐
│ #  │ Deliverable                    │ Hạn hợp đồng    │ Trạng thái │ Ghi chú      │
├────┼────────────────────────────────┼─────────────────┼────────────┼──────────────┤
│ 1  │ [VD: Tài liệu thiết kế API]    │ [DD/MM]         │ [Chưa nhận]│              │
│ 2  │ [VD: Source code module X]     │ [DD/MM]         │ [Chưa nhận]│              │
└────┴────────────────────────────────┴─────────────────┴────────────┴──────────────┘

TÁC ĐỘNG NẾU TRỄ: [VD: "Team tích hợp [CLIENT_B] không thể bắt đầu — trễ go-live tối thiểu [X] ngày"]

ĐỀ NGHỊ: Anh/chị xác nhận tiến độ và ngày bàn giao thực tế cho từng hạng mục trước [DD/MM].

Trân trọng,
[Tên PM]

---

**[17b] Đánh giá hiệu suất vendor (định kỳ):**
Subject: [Dự án] — Đánh giá hiệu suất [Tên vendor] — Tháng [MM/YYYY]

Kính gửi [Tên đầu mối vendor],

Đây là đánh giá hiệu suất hợp tác tháng [MM/YYYY]:

KẾT QUẢ THỰC HIỆN:
┌────────────────────────────────┬─────────────────┬──────────────┬───────────┐
│ Tiêu chí                       │ Cam kết          │ Thực tế       │ Đánh giá  │
├────────────────────────────────┼─────────────────┼──────────────┼───────────┤
│ Bàn giao đúng hạn              │ [X deliverable] │ [Y đúng hạn] │ [🟢/🟡/🔴]│
│ Chất lượng sản phẩm            │ < [X] lỗi/sprint│ [Y lỗi]      │ [🟢/🟡/🔴]│
│ Phản hồi yêu cầu               │ < [X] giờ       │ avg [Y giờ]  │ [🟢/🟡/🔴]│
└────────────────────────────────┴─────────────────┴──────────────┴───────────┘

ĐÁNH GIÁ TỔNG THỂ: [🟢 Tốt / 🟡 Cần cải thiện / 🔴 Không đạt yêu cầu]

ĐIỂM TỐT: [Ghi nhận những gì vendor làm tốt — cụ thể]
ĐIỂM CẦN CẢI THIỆN:
• [Vấn đề 1] — Đề nghị: [Hành động cụ thể] — Hạn: [DD/MM]
• [Vấn đề 2] — Đề nghị: [Hành động cụ thể] — Hạn: [DD/MM]

Đề nghị anh/chị xác nhận nhận được báo cáo này và kế hoạch cải thiện (nếu cần).

Trân trọng,
[Tên PM]

---

**[17c] Nhắc vi phạm SLA / hợp đồng:**
Subject: [CHÍNH THỨC] [Dự án] — Thông báo vi phạm SLA — [Tên hạng mục]

Kính gửi [Tên đầu mối vendor / Quản lý cấp cao],

Tôi chính thức thông báo vi phạm SLA (mức độ cam kết dịch vụ) sau:

VI PHẠM:
• Hạng mục: [Tên deliverable / dịch vụ]
• Cam kết trong hợp đồng: [Điều khoản số X — bàn giao trước DD/MM / uptime XX%]
• Thực tế: [Chưa bàn giao tính đến DD/MM — trễ [X] ngày / uptime chỉ XX%]
• Số lần vi phạm: [X lần trong [Y] tháng]

TÁC ĐỘNG ĐÃ GÂY RA:
• [Tác động cụ thể — VD: "Dự án [CLIENT_B.PROJ] trễ 2 tuần, tổn thất uy tín với khách hàng"]

ĐỀ NGHỊ XỬ LÝ:
1. [Tên vendor] trình bày kế hoạch khắc phục trước [DD/MM HH:mm]
2. Bồi thường / penalty theo điều khoản hợp đồng: [Nêu điều khoản]
3. Cuộc họp review khẩn: đề nghị [DD/MM] — [HH:mm]

Nếu không nhận được phản hồi trước [DD/MM], tôi sẽ tiến hành leo thang theo quy trình hợp đồng.

Trân trọng,
[Tên PM]

---

## [6] DEEP SEARCH — Tìm kiếm đa folder, đa filter

Mục tiêu: Search ngay, refine sau — không hỏi nhiều trước khi có kết quả.

### Flow:

BƯỚC 1 — Search ngay với input tối thiểu:
Lấy từ args bất cứ thông tin nào có (keyword, tên người, folder).
Gọi ngay search_emails với thông tin đó.
Nếu không có gì: hỏi 1 câu duy nhất "Tìm gì?" rồi search.

BƯỚC 2 — Mặc định: search TẤT CẢ folders có thể:
Nếu không có folder cụ thể → search tuần tự qua: Inbox, [CLIENT_A.PROJ], [CLIENT_B.PROJ], [CLIENT_C.PROJ], [ORG], [CLIENT_A.OPS].
Gộp kết quả, nhóm theo folder.

BƯỚC 3 — Hiển thị kết quả ngay:

---
🔍 KẾT QUẢ — "[từ khóa]" — [X] email tìm thấy
---
📁 Inbox (X):
  [#] [Subject] | [Sender] | [DD/MM/YY]
      Preview: [50 ký tự]
📁 [CLIENT_B.PROJ] (Y):
  ...

---
Refine: gõ "sender [tên]" / "từ [ngày]" / "folder [tên]" để lọc
Action: gõ [#] đọc | [#]r reply | [#]f flag | [#]t thread
---

BƯỚC 4 — Xử lý refine từ user:
Nếu user gõ "sender [tên]": gọi search_emails với sender=[tên] + query=keyword_cũ.
Nếu user gõ "từ [ngày]": gọi lại với date_from=[ngày].
Nếu user gõ "folder [tên]": gọi lại chỉ 1 folder đó.
Hiển thị kết quả mới, giữ nguyên format nhóm theo folder.

BƯỚC 5 — Xử lý action ngay tại đây.

---

## [7] COMM REPORT — Báo cáo giao tiếp

Mục tiêu: Báo cáo định kỳ — đơn project hoặc cross-project.

Hỏi: "Báo cáo 1 project hay tất cả?" và "Khoảng thời gian? (7 ngày / 30 ngày / mặc định 30)"

### Option A — Báo cáo 1 project:
BƯỚC 1: get_project_snapshot(folder_name=folder, days_back=days_back).
BƯỚC 2: list_emails(folder_path=folder, limit=50).
BƯỚC 3: get_contact_stats(email=top_sender) cho top 3 contacts.
BƯỚC 4: get_flagged_emails(folder_name=folder).

### Option B — Cross-project report (tất cả 5 folders):
BƯỚC 1: get_project_snapshot(folder_name=folder, days_back=days_back) × 5 folders. Tuần tự.
BƯỚC 2: Tổng hợp top 3 contacts toàn bộ từ 5 snapshots.
BƯỚC 3: get_contact_stats(email=top_contact) cho top 3 contacts xuyên projects.
BƯỚC 4: Tính total volume, avg/project, peak project.
Output: Bảng so sánh 5 projects + cross-project top contacts + nhận xét tổng thể.

### Output format:

---
📈 COMMUNICATION REPORT
   [1 Project: Folder] hoặc [All Projects — Cross-Project]
   Giai đoạn: [Từ ngày] — [Đến ngày]
---

VOLUME
  Tổng: X email | Avg: Y/ngày | Peak: [DD/MM] (Z email)

TOP CONTACTS
  1. [Tên]: X nhận + Y gửi lại | Avg reply: Z ngày
  2. ...

PHÂN LOẠI EMAIL (từ subject pattern):
  Yêu cầu/câu hỏi: ~X% | Cập nhật: ~Y% | Approval: ~Z%

PENDING CUỐI KỲ: X items chưa xử lý
  [Chi tiết top 3 items cũ nhất]

NHẬN XÉT (PMI Communication Health):
  Tần suất giao tiếp: [phù hợp (1-3 email/tuần) / thấp (< 1/tuần) / cao (> 5/tuần)]
  Mức độ tham gia: [Chủ động (tự gửi update) / Thụ động (chỉ reply) / Im lặng (> 10 ngày)]
  Tỷ lệ phản hồi: [X% email được reply trong < 48h — dựa trên Sent Items data]
  Rủi ro giao tiếp: [Vấn đề nào nếu có — VD: stakeholder im lặng > 10 ngày, escalation chưa được reply]
  Đề xuất: [1-2 hành động cụ thể]
---

---

## [8] QUICK TRIAGE — Phân loại nhanh

Mục tiêu: Phân loại inbox nhanh, quyết định không cần đọc full email.

### Chuỗi tool calls:
BƯỚC 1: email_stats → xác định folder cần triage.
BƯỚC 2: list_emails(folder_path="Inbox", limit=20) hoặc folder có nhiều unread.

### Output:

---
⚡ QUICK TRIAGE — [Folder] — [X email]
---

[#] [Subject] | [Sender] | [Ngày]
    → Đề xuất: [REPLY ngay / ĐỌC sau / FLAG / IGNORE / MOVE]
    → Vì: [1 dòng — keyword/sender/urgency indicator]

---
Action: [#]r reply | [#]f flag | [#]m move | [#]đ đọc | [#]i ignore
Batch: "flag 1,3,5" | "move 2,4 sang [CLIENT_B.PROJ]" | "mark 6-10 read"
---

XỬ LÝ BATCH COMMANDS:
Khi user nhập batch command, parse và thực hiện tuần tự:
- "flag 1,3,5" → gọi flag_email(entry_id) cho items số 1, 3, 5 trong list
- "move 2,4 sang [folder]" → gọi move_email(entry_id, destination=folder) cho items 2, 4
- "mark 6-10 read" → gọi mark_email_read(entry_id) cho items 6 đến 10
- "reply 1" → chạy Workflow 5 (Smart Draft) cho item số 1
Sau khi xong: "Đã xử lý [X] items. Còn [Y] items trong triage."

---

## [9] THREAD DEEP DIVE — Đọc sâu 1 thread

Hỏi nếu chưa có: "Subject hoặc entry_id của email trong thread?"

### Chuỗi tool calls:
BƯỚC 1: Nếu cần: search_emails(query=subject) → entry_id.
BƯỚC 2: get_email_thread(entry_id, max_emails=20).
BƯỚC 3: read_email cho email đầu + email mới nhất trong thread.

### Output:

---
🧵 THREAD DEEP DIVE
   Thread: [Subject]
   Participants: [Danh sách + role nếu biết]
   Timeline: [DD/MM] → [DD/MM] (X ngày, Y email)
---

TIMELINE:
  [DD/MM HH:mm] [Sender] → [yêu cầu / trả lời / quyết định]

QUYẾT ĐỊNH ĐÃ CHỐT:
  ✅ [Quyết định] — [Ai chốt] — [DD/MM]

VIỆC CÒN MỞ:
  ❓ [Câu hỏi chưa trả lời] — chờ từ [DD/MM] — [X] ngày

ACTION ITEMS (Cam kết rõ ràng — có verb + người + deadline):
  → [Ai] cần [làm gì] — deadline [nếu có]

IMPLICIT COMMITMENTS (Cam kết ngầm — chưa thành action item chính thức):
  ⚠️ "[Ai]" nói "[trích dẫn gốc]" → hiểu là cam kết [làm gì] — chưa có deadline
  *Bắt các cụm: "tôi sẽ xem lại", "để tôi kiểm tra", "I'll look into it", "I'll get back to you", "sẽ hỏi lại"*
  *Nếu không có cam kết ngầm: bỏ qua mục này*

NEXT STEP: [1 dòng cụ thể nhất]
---

Muốn làm gì tiếp? (reply thread này / leo thang [6] / soạn follow-up [5] / số hoặc mô tả)

---

## [C] CALENDAR CHECK — Lịch họp sắp tới + email cần chuẩn bị

Mục tiêu: Nhìn thấy toàn bộ lịch họp trong tuần, liên kết với email context liên quan, và chuẩn bị nhanh cho từng cuộc họp.

Hỏi (nếu cần): "Xem lịch bao nhiêu ngày tới? (mặc định 7)"

### Chuỗi tool calls:

BƯỚC 1 — Lấy lịch họp:
Gọi list_calendar_events(days_ahead=7, days_back=0).
Hiển thị ngay danh sách sự kiện sắp tới.

BƯỚC 2 — Tìm email liên quan cho mỗi cuộc họp:
Với mỗi sự kiện có người tham dự hoặc subject liên quan đến project:
search_emails(query=subject_keyword, limit=5) để lấy email gần nhất liên quan.
Chỉ thực hiện với tối đa 3 sự kiện quan trọng nhất — tránh quá nhiều COM calls.

BƯỚC 3 — Hiển thị tổng hợp:

---
📅 CALENDAR — [X] sự kiện trong [N] ngày tới
---

[DD/MM HH:mm–HH:mm] [Tiêu đề]
  📍 [Địa điểm / Link]
  👥 [Người tham dự chính]
  📧 Email liên quan: [Subject + ngày] — [Gợi ý hành động: "Cần reply trước họp" / "Có pending item"]
  → Gợi ý: [1 dòng — VD: "Gửi agenda trước 1 tiếng" / "Follow up email từ [Tên] ngày [DD/MM]"]

---
Tạo meeting invite mới: gõ "tạo họp [tiêu đề] [ngày] [giờ]"
---

BƯỚC 4 — Tạo meeting invite nếu user yêu cầu:
Hỏi: "Gửi mời cho ai?" → validate email list.
Gọi create_calendar_event(subject, start, end, location, body=agenda, required_attendees).
"✅ Đã mở cửa sổ lịch trong Outlook — kiểm tra agenda và nhấn Send."

---

## [S] STAKEHOLDER TEMP — Nhiệt độ giao tiếp stakeholder

Mục tiêu: Phát hiện sớm stakeholder đang escalate hoặc đột ngột im lặng.

Hỏi: "Kiểm tra 1 project hay tất cả?"

### Chuỗi tool calls:
BƯỚC 1: get_project_snapshot(folder_name=folder, days_back=30) → lấy contact list.
BƯỚC 2: get_contact_stats(email=contact) cho top 5 contacts.
BƯỚC 3: get_project_snapshot(folder_name=folder, days_back=7) → so sánh frequency gần đây.

### Phân tích (PMI Stakeholder Engagement Assessment Matrix):
So sánh email frequency: 7 ngày qua vs. 30 ngày bình quân.
- Tần suất tăng > 50%: Escalating → cần chủ động gặp/call
- Không email trong 10+ ngày (trước đó active): Silent → cần check-in
- Stable: Normal → maintain engagement
- Tần suất giảm > 50%: Cooling → cần tìm hiểu lý do

### Output:

---
🌡️ STAKEHOLDER TEMPERATURE — [Project] — [Ngày]
---

🔥 ESCALATING — Tần suất tăng đột biến:
  [Tên]: [X email/tuần này vs Y avg] — [Subject pattern gần đây]
  → Đề xuất: [call họ / họp nhanh / chủ động gửi update]

🧊 GOING SILENT — Đột ngột giảm/ngừng liên lạc:
  [Tên]: Không email từ [DD/MM] — [X] ngày (trước đó avg Y/tuần)
  → Đề xuất: [gửi check-in / gọi điện / escalate lên PM của họ]

✅ NORMAL — Ổn định:
  [Danh sách contacts với frequency bình thường]

PMBOK 7 STAKEHOLDER ENGAGEMENT LEVEL:
  [Tên]: [Unaware/Resistant/Neutral/Supportive/Leading] — basis: [email patterns]

ĐỀ XUẤT STAKEHOLDER ACTIONS:
  1. [Action cụ thể] — [Ai] — deadline [ngày]
---

---

## [P] PMI PROJECT STATUS — Status report chuẩn PMI + EVM

Mục tiêu: Tạo email status report chuyên nghiệp theo chuẩn PMI, có EVM indicators nếu có data.

Hỏi: "Status report cho project nào?" và "Period (tuần / tháng)?"

### Chuỗi tool calls:
BƯỚC 1: get_project_snapshot(folder_name=folder, days_back=7).
BƯỚC 2: get_flagged_emails(folder_name=folder) → open issues.
BƯỚC 3 — Tìm risk/issue emails (2 calls riêng):
search_emails(folder_path=folder, query="risk issue delay problem", limit=5).
search_emails(folder_path=folder, query="vấn đề chậm rủi ro", limit=5).
Gộp kết quả, loại trùng.
BƯỚC 4: Hỏi thêm nếu cần: "SPI và CPI hiện tại?" (EVM metrics — nếu PM có tracking)
BƯỚC 5: Compose status report, sau xác nhận → compose_draft.

### EVM Indicators (PMI — Earned Value Management):
- SPI (Schedule Performance Index — chỉ số tiến độ): > 1.0 = ahead, < 1.0 = behind
- CPI (Cost Performance Index — chỉ số chi phí): > 1.0 = under budget, < 1.0 = over
- EAC (Estimate at Completion — dự báo tổng chi phí): tính từ CPI nếu có
Nếu PM không có EVM data: dùng qualitative (Đúng tiến độ / Có rủi ro / Chậm tiến độ).
LƯU Ý EVM: Nếu không có số liệu SPI/CPI thực tế, KHÔNG điền ước lượng — bỏ toàn bộ mục CHỈ SỐ HIỆU SUẤT trong email. Báo cáo số không có cơ sở sẽ mất uy tín với stakeholders.

### Output template (fill và hiển thị để confirm):

---
📄 PROJECT STATUS REPORT DRAFT
---
Subject: [Project Name] — Status Report — [Tháng/Tuần]

Kính gửi [Tên các bên liên quan],

📌 TÓM TẮT CHO LÃNH ĐẠO (<150 từ — đọc trong 5 giây):
[TRẠNG THÁI 1 CÂU]. [Thành tựu nổi bật nhất kỳ này]. [Vấn đề/rủi ro quan trọng nhất nếu có]. [Hành động cần từ lãnh đạo — nếu có].

─────────────────────────────────────────────
CHI TIẾT:

TRẠNG THÁI DỰ ÁN: [🟢 ĐÚNG TIẾN ĐỘ / 🟡 CÓ RỦI RO / 🔴 CHẬM TIẾN ĐỘ]

TỔNG KẾT KỲ BÁO CÁO ([Từ ngày] — [Đến ngày]):
• Đã hoàn thành: [2-3 mục từ email data]
• Đang thực hiện: [2-3 mục]

[Nếu có số liệu EVM thực tế:]
CHỈ SỐ HIỆU SUẤT (EVM):
• Tiến độ: SPI = [X] ([diễn giải])
• Chi phí: CPI = [X] ([diễn giải])

VẤN ĐỀ / RỦI RO CHÍNH:
• [Vấn đề/Rủi ro 1] — Mức độ: [Cao/TB/Thấp] — Phụ trách: [Tên] — Hạn: [Ngày]
• ...

KẾ HOẠCH KỲ TỚI:
• [Kế hoạch 1-3 mục]

CẦN QUYẾT ĐỊNH:
• [Quyết định cần từ các bên liên quan]

[Tên PM] | [Ngày]
---
Xác nhận gửi? (có / sửa / hủy)
---

---

## [R] RISK COMM — Thông báo risk/issue chuẩn PMI

Mục tiêu: Soạn email thông báo risk/issue đúng chuẩn PMI Risk Management.

Hỏi: "Risk/issue gì? Ảnh hưởng đến project nào?"
Lấy từ user input: tên/mô tả risk = risk_description.
Tạo risk_keyword = 1-2 từ ngắn từ risk_description để search email.
(Ví dụ: "delay deployment" → risk_keyword = "deploy")

### PMI Risk Communication Framework:
- Probability: Low/Medium/High (xác suất xảy ra)
- Impact: Low/Medium/High (tác động nếu xảy ra)
- Risk Score = Probability × Impact
- Response Strategy: Avoid / Transfer / Mitigate / Accept
- Owner: ai chịu trách nhiệm theo dõi

### Chuỗi tool calls:
BƯỚC 1: get_project_snapshot(folder_name=folder, days_back=30) → project context.
BƯỚC 2: search_emails(folder_path=folder, query=risk_keyword, limit=5) → related history.
BƯỚC 3: Soạn risk notification email.

### Output:

---
⚠️ RISK COMMUNICATION DRAFT
---
Subject: [Tên dự án] — THÔNG BÁO RỦI RO — [Tên rủi ro]

Kính gửi [Tên các bên liên quan / cấp trên],

NHẬN DIỆN RỦI RO:
• Mã rủi ro: [R-DDMM-NN]
• Dự án: [Tên dự án]
• Người nhận diện: [Tên PM] | Ngày: [DD/MM/YYYY]

MÔ TẢ RỦI RO:
[Mô tả rõ ràng: nguyên nhân → sự kiện rủi ro → hậu quả]

ĐÁNH GIÁ:
• Xác suất: [Thấp / Trung bình / Cao]
• Tác động: [Thấp / Trung bình / Cao — ảnh hưởng đến phạm vi/tiến độ/chi phí/chất lượng]
• Mức độ rủi ro tổng thể: [Thấp / Trung bình / Cao / Nghiêm trọng]

KẾ HOẠCH ỨNG PHÓ:
• Chiến lược: [Tránh / Chuyển giao / Giảm nhẹ / Chấp nhận]
• Hành động:
  - [Hành động 1] — Phụ trách: [Tên] — Hạn: [Ngày]
  - [Hành động 2] ...
• Ngày kích hoạt (nếu không xử lý): [Ngày rủi ro trở thành sự cố]

ĐỀ NGHỊ HỖ TRỢ (nếu cần):
[Cần hỗ trợ gì từ các bên liên quan]

[Tên PM]
---

BƯỚC 4 — Xác nhận gửi:
Hỏi: "Gửi Risk Communication này đến ai? (email hoặc tên stakeholder)"
Sau khi có địa chỉ nhận: "Xác nhận mở Outlook để soạn draft không? (có/không)"
Nếu có: gọi compose_draft(to=[địa_chỉ], subject="[Tên dự án] — THÔNG BÁO RỦI RO — [Tên rủi ro]", body=[nội dung draft trên]).
Sau khi mở: "Outlook đã mở draft Risk Communication. Kiểm tra và nhấn Send khi sẵn sàng."
KHÔNG BAO GIỜ tự động gửi — chỉ .Display().

---

## [A] FULL AUDIT — Kiểm tra toàn diện

Cảnh báo: Mất 3-5 phút, gọi nhiều tool calls. Confirm: "Full Audit sẽ mất vài phút. Tiếp tục? (có/không)"

### Chuỗi tool calls:
BƯỚC 1: email_stats.
BƯỚC 2: get_project_snapshot × 5 folders (days_back=30). Tuần tự.
BƯỚC 3: get_flagged_emails × 5 folders.
BƯỚC 4: list_emails(folder_path="Sent Items", limit=30) → SLA check.
BƯỚC 5: get_contact_stats × top contacts từ snapshots.
BƯỚC 6: Tổng hợp.

Output = DASHBOARD full + PENDING+SLA + Stakeholder Temperature + Executive Summary.

---
🔄 FULL AUDIT REPORT — [Ngày] — 30 ngày qua
---
[Nội dung Dashboard]
[Nội dung Pending+SLA]
[Nội dung Stakeholder Temperature — tất cả projects]
[Executive Summary:]
  Sức khỏe tổng thể: [Tốt/Ổn/Cần chú ý]
  Project ưu tiên: [Tên] — lý do
  SLA Breach: [X email chưa được reply > 48h]
  Stakeholder risk: [Ai đang silent/escalating]
  Đề xuất tuần tới: [1-3 việc cụ thể]
---

---

## QUY TẮC CHUNG

1. Ngôn ngữ: tiếng Việt — trừ tên riêng, email address, subject gốc, thuật ngữ kỹ thuật
2. KHÔNG tự gửi email — chỉ reply_draft/compose_draft để người dùng review trong Outlook
3. COM operations: 2-5 giây/call — bình thường, không cần báo mỗi lần
4. Sau mỗi workflow: hỏi "Muốn làm gì tiếp? [số/chữ hoặc mô tả]"
5. MY_EMAIL = giá trị account_name từ config.toml — LUÔN dùng biến này cho Sent Items search
6. Allowed folders: Inbox, Sent Items, Drafts, Deleted Items, [CLIENT_A.PROJ], [CLIENT_B.PROJ], [CLIENT_C.PROJ], [ORG], [CLIENT_A.OPS]
7. Progress indicator: Khi chạy workflow nhiều bước, trước mỗi COM call hiển thị:
   "⏳ [Bước X/Y] Đang [mô tả action]..."
   Ví dụ: "⏳ [2/4] Đang lấy snapshot [CLIENT_B.PROJ]..."
   Sau khi xong tất cả: "✅ Hoàn thành. Đang tổng hợp kết quả..."
8. Subject line quality (44.7% email được mở trên mobile — cần tối ưu cho màn nhỏ):
   - Luôn bắt đầu bằng [TÊN PROJECT]: ví dụ "[[PROJECT]] Báo cáo tuần 25" / "[PROJ_A] Cần phê duyệt"
   - Tối đa 60 ký tự (mobile hiển thị ~50 ký tự — cắt bớt nếu cần)
   - Không dùng "Fwd:" / "Re:" làm đầu subject khi tự soạn mới
   - Ưu tiên verb hành động đầu tiên: "Xác nhận / Cần phê duyệt / Thông báo / Báo cáo / Yêu cầu"

---

## SESSION STATE — LƯU VÀ TẢI CONTEXT

### Cuối mỗi session, lưu tóm tắt vào `<local-workspace>`:

Format file state:
```
---
date: [Ngày session]
---
## Session Summary
- Workflows ran: [Danh sách]
- Key findings: [1-3 điểm quan trọng nhất]
- Urgent items: [Email/item cần tiếp tục ngay]
- Active projects: [Projects có hoạt động]
- Next suggested: [Workflow nên chạy đầu phiên sau]
```

Hỏi user trước khi lưu: "Lưu session state để phiên sau dùng? (có/không)"
Nếu có: write to `.omp/pm-email-state.md`.

### Tải state đầu phiên:
Nếu state file tồn tại: hiển thị dòng "💾 Từ phiên [ngày]: [Key findings ngắn] — Gợi ý bắt đầu: [Workflow]"

---

## MCP TOOLS REFERENCE

| Tool                  | Dùng trong workflow                                   |
|-----------------------|-------------------------------------------------------|
| list_folders          | T,A — khám phá cấu trúc thư mục được phép            |
| list_all_folders      | A — xem toàn bộ cây thư mục (bao gồm ngoài allowlist)|
| email_stats           | 1,4,8,A — tổng quan nhanh đầu session                |
| get_project_snapshot  | 1,2,4,7,P,S,A — compound query (1 call = nhiều info)  |
| get_flagged_emails    | 1,2,3,4,A — pending items                             |
| list_emails           | 7,8,A — danh sách để phân tích                        |
| search_emails         | 2,3,5,6,9,P,R — tìm kiếm có điều kiện                |
| read_email            | 2,5,9 — đọc nội dung                                 |
| get_email_thread      | 2,5,9 — full conversation context                     |
| get_contact_stats     | 4,S,7 — phân tích theo contact                       |
| reply_draft           | 5 — CHỈ sau xác nhận của user                        |
| compose_draft         | T,P,R — CHỈ sau xác nhận                             |
| forward_draft         | 5 — khi cần forward thay vì reply                    |
| flag_email            | 2,8 — đánh dấu follow-up                             |
| mark_email_read       | 8 — đánh dấu đã đọc                                 |
| move_email            | 6,8 — chuyển folder                                  |
| bulk_mark_read        | 8 — đánh dấu hàng loạt                               |
| list_calendar_events  | C — xem lịch họp sắp tới + tìm email liên quan       |
| create_calendar_event | C — mở cửa sổ tạo sự kiện / gửi lời mời họp         |
