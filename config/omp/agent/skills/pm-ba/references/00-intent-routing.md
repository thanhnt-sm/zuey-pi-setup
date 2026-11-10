# Intent Routing — Natural Language to Mode Mapping

## Routing Precedence

Resolution order — stop at first match:

0. **Auto-detect pre-pass** (when no `--flag` in input) → run `references/39-mode-auto-detect.md`
   - If confidence ≥ 65%: show context summary + suggest mode → wait for confirm
   - If confidence < 65%: show context summary → fall through to step 1
1. **Explicit path argument provided** → infer mode from filename: "BRD" → `--brd`; "URD"/"Yeu-cau"/"User-Req" → `--urd`; "Bien-ban"/"BB-" → `--template`; unknown → continue to step 2
2. **Explicit flag present** (`--brd`, `--cr`, etc.) → use it directly, skip NL detection
3. **NL phrase match** → scan against Vietnamese table first, then English table; extract mode + slots
4. **None matched** → invoke `AskUserQuestion` with mode menu (see SKILL.md schema)

---

## Vietnamese Phrase Patterns

| Phrase Pattern | Mode | Example Input | Required Slots |
|---|---|---|---|
| phân tích BRD / đọc tài liệu BRD / xem BRD | `--brd` | "phân tích BRD này cho tôi" | BRD file/folder path |
| tóm tắt nhanh BRD / quick analysis BRD / xem nhanh BRD / điểm chính BRD | `--brd --quick` | "tóm tắt nhanh BRD cho tôi" | BRD file/folder path |
| phân tích URD / đọc yêu cầu người dùng / xem URD | `--urd` | "phân tích URD module thanh toán" | URD file/folder path |
| tóm tắt nhanh URD / quick analysis URD / xem nhanh URD / điểm chính URD | `--urd --quick` | "tóm tắt nhanh URD trước khi họp" | URD file/folder path |
| vừa họp xong / sau buổi họp / ghi chú họp / biên bản họp | `--meeting-post` | "vừa họp xong, đây là ghi chú" | Meeting notes text or file |
| chuẩn bị họp / trước buổi họp / agenda / lịch họp / pre-meeting / soạn giả thuyết họp / hypothesis pack | `--meeting-pre` | "chuẩn bị họp với khách hàng ngày mai" | Topic + attendees |
| câu hỏi cần làm rõ / open question / cần clarify / điểm chưa rõ | `--clarify` | "có mấy câu hỏi cần làm rõ với BA" | Document or meeting context |
| change request / thay đổi yêu cầu / CR mới / yêu cầu thay đổi | `--cr` | "khách hàng muốn thay đổi flow đăng nhập" | Change description + affected doc |
| ký duyệt / approval / phê duyệt tài liệu / ký tắt | `--signoff` | "ký duyệt URD v2" | Document name + approver |
| traceability / ma trận truy vết / liên kết yêu cầu / trace matrix | `--trace` | "cập nhật ma trận truy vết cho sprint 3" | Scope: BRD/URD/US/TC |
| cập nhật risk / risk register / rủi ro dự án / quản lý rủi ro | `--risk` | "cập nhật risk register sau họp" | Risk description or register path |
| sprint planning / kế hoạch sprint / lên sprint / lập kế hoạch sprint | `--sprint` | "sprint planning sprint 4" | Backlog items or sprint goal |
| UAT plan / kế hoạch UAT / kiểm thử chấp nhận / test chấp nhận | `--uat` | "tạo UAT plan cho module báo cáo" | Feature scope + UAT date |
| go-live / training plan / kế hoạch ra mắt / triển khai / deployment | `--go-live` | "lập go-live checklist cho phase 1" | Go-live date + modules |
| báo cáo tiến độ / tình hình dự án / status report / tiến độ | `--status` | "báo cáo tiến độ cho giám đốc" | Stakeholder audience |
| so sánh URD v1 v2 / diff tài liệu / thay đổi gì / so sánh phiên bản | `--diff` | "so sánh URD v1 và v2 xem thay đổi gì" | Two document paths |
| tình hình hiện tại / có gì rồi / đang ở đâu / tổng quan dự án | `--state` | "tình hình hiện tại dự án thế nào" | None |
| khởi tạo dự án / bắt đầu dự án mới / kickoff / setup dự án | `--kickoff` | "khởi tạo dự án [PROJECT] mới" | Project name + scope brief |
| data model / ERD / sơ đồ cơ sở dữ liệu / thiết kế DB / database schema | `--data-model` | "tạo ERD cho module hợp đồng" | Entity descriptions or DB schema |
| spec màn hình / screen URD / đặc tả giao diện / UI spec | `--screen` | "spec màn hình danh sách hồ sơ" | Screen name + functional requirements |
| biên bản / template / mẫu tài liệu / tạo mẫu | `--template` | "tạo template biên bản họp" | Template type |
| báo cáo / tổng hợp / reporting / tổng kết | `--report` | "tổng hợp báo cáo tuần" | Report type + audience |
| API contract / integration spec / đặc tả API / tích hợp hệ thống | `--api` | "viết API contract cho module thanh toán" | Endpoint list or service description |
| từ điển nghiệp vụ / glossary / thuật ngữ / định nghĩa | `--glossary` | "cập nhật từ điển nghiệp vụ" | Terms from BRD/URD or manual list |
| groom backlog / ưu tiên user story / sizing story / refinement session / tổng hợp backlog | `--backlog` | "groom backlog sprint tới" | Backlog items + priority criteria |
| triage lỗi / đánh giá bug / phân loại defect / impact lỗi / severity bug | `--defect` | "triage bug màn hình duyệt hồ sơ" | Defect list or description |
| vẽ quy trình / AS-IS / TO-BE / bản đồ quy trình / BPMN / sơ đồ nghiệp vụ | `--process-map` | "vẽ quy trình AS-IS TO-BE module giải ngân" | Process description or existing flow |
| đóng dự án / kết thúc dự án / handover / bàn giao / project close / lessons learned | `--closure` | "đóng dự án, bàn giao cho đội vận hành" | Project summary + handover details |
| hypercare / hỗ trợ sau ra mắt / stabilization / sau go-live / theo dõi sau triển khai | `--hypercare` | "hypercare tháng đầu sau go-live" | Go-live date + support scope |
| bảo trì / vận hành / SLA / maintenance / yêu cầu cải tiến / enhancement request | `--maintenance` | "báo cáo vận hành tháng 5" | Month/period + SLA targets |
| release / phiên bản mới / release notes / kế hoạch release / deployment note | `--release` | "lập kế hoạch release v2.0" | Release scope + date |
| chuyển đổi dữ liệu / migration / data cutover / di chuyển dữ liệu | `--data-migration` | "lập migration plan chuyển dữ liệu từ hệ thống cũ" | Source system + target schema |
| test case BA / kịch bản kiểm thử nghiệp vụ / SIT scenario / business test | `--test-case` | "tạo test case SIT cho module hồ sơ vay" | Feature list or AC list |
| RACI / ma trận trách nhiệm / communication plan / ai làm gì / phân công | `--raci` | "lập RACI matrix và communication plan" | Stakeholder list + roles |
| bản đồ năng lực / ai biết gì / capability map / lịch rảnh team / chuyên môn stakeholder | `--raci --capability-map` | "ai trong team biết về CBS?" | None (reads existing artifacts) |
| ước tính / estimate / story point / t-shirt size / capacity / kế hoạch năng lực | `--estimation` | "ước tính effort cho sprint 5" | User story list or feature scope |
| persona / người dùng đại diện / user journey / hành trình người dùng | `--persona` | "tạo persona cán bộ tín dụng và kiểm soát" | User groups description |
| phân tích hợp đồng / đọc hợp đồng / hop dong / điều khoản hợp đồng / hợp đồng dự án | `--contract` | "phân tích hợp đồng dự án" | Contract file/folder path |
| kết quả UAT / nghiệm thu / báo cáo chấp nhận / chứng nhận nghiệm thu / tổng hợp UAT | `--acceptance` | "nghiệm thu dự án, đây là kết quả UAT" | UAT results file or inline |
| tôi cần làm gì hôm nay / pm dashboard / tình hình PM / cockpit / tổng quan PM / sáng nay làm gì | `--pm` | "tôi cần làm gì hôm nay" | None |
| chạy full / phân tích toàn bộ / pm-ba full / đi qua hết input | `--full` | "chạy full pipeline pm-ba" | None (auto-scan input_root) |
| chốt output / human đã sửa output / lock output đã sửa / đã chỉnh, báo lại pm-ba | `--accept` | "đã chỉnh xong, chốt lại" | None (scans docs/ for diff) |
| trạng thái mapping / xem io-mapping / tình trạng lock / mapping hiện tại | `--io-status` | "xem tình trạng lock io-mapping" | None |
| mở khóa MAP-XXX / unlock output / cho phép regenerate | `--unlock` | "mở khóa MAP-001" | map_id (e.g., MAP-001) |

---

## English Phrase Patterns

| Phrase Pattern | Mode | Example Input | Required Slots |
|---|---|---|---|
| analyze BRD / parse BRD / read BRD / review BRD | `--brd` | "analyze this BRD document" | BRD file/folder path |
| quick BRD summary / fast BRD analysis / BRD highlights / quick scan BRD | `--brd --quick` | "give me a quick summary of this BRD" | BRD file/folder path |
| analyze URD / parse requirements / read URD / user requirements | `--urd` | "analyze the URD for payment module" | URD file/folder path |
| quick URD summary / fast URD analysis / URD highlights / quick scan URD | `--urd --quick` | "quick scan the URD before the meeting" | URD file/folder path |
| meeting notes / post-meeting / after meeting / action items from meeting | `--meeting-post` | "here are my meeting notes" | Meeting notes text or file |
| prepare meeting / pre-meeting / meeting agenda / before meeting / hypothesis-driven prep / pre-meeting hypotheses | `--meeting-pre` | "prepare agenda for client meeting" | Topic + attendees |
| open questions / clarification needed / unclear items / Q&A | `--clarify` | "log open questions from URD review" | Document or meeting context |
| change request / scope change / CR / requirement change | `--cr` | "new CR: client wants SSO added" | Change description + affected doc |
| sign off / approval / approve document / get sign-off | `--signoff` | "sign off URD v2 with PM" | Document name + approver |
| traceability matrix / link requirements / requirements trace | `--trace` | "update traceability matrix for sprint 3" | Scope: BRD/URD/US/TC |
| risk register / update risks / risk assessment / project risks | `--risk` | "update risk register with new items" | Risk description or register path |
| sprint planning / plan sprint / sprint scope / sprint backlog | `--sprint` | "sprint 4 planning" | Backlog items or sprint goal |
| UAT plan / acceptance testing / user acceptance test | `--uat` | "create UAT plan for reporting module" | Feature scope + UAT date |
| go-live / launch plan / deployment checklist / training plan | `--go-live` | "create go-live checklist for phase 1" | Go-live date + modules |
| status report / project status / progress report | `--status` | "status report for the director" | Stakeholder audience |
| compare documents / diff / what changed / version comparison | `--diff` | "compare URD v1 vs v2" | Two document paths |
| current state / what do we have / project overview / show state | `--state` | "what's the current state of the project?" | None |
| kickoff / new project / project setup / start project | `--kickoff` | "kick off the new [PROJECT] project" | Project name + scope brief |
| data model / ERD / database schema / entity diagram | `--data-model` | "create ERD for contract module" | Entity descriptions or DB schema |
| screen spec / screen URD / UI specification / wireframe spec | `--screen` | "spec the case list screen" | Screen name + functional requirements |
| document template / generate template / template for... | `--template` | "create meeting minutes template" | Template type |
| generate report / summary report / reporting / weekly summary | `--report` | "generate weekly summary report" | Report type + audience |
| API spec / API contract / integration spec / endpoint spec | `--api` | "write API contract for payment module" | Endpoint list or service description |
| business glossary / terminology / define terms / glossary | `--glossary` | "update the business glossary" | Terms from BRD/URD or manual list |
| backlog grooming / story prioritization / refinement / story sizing / backlog refinement | `--backlog` | "groom the backlog for next sprint" | Backlog items + priority criteria |
| defect triage / bug analysis / defect severity / bug impact / bug assessment | `--defect` | "triage the defects found in UAT" | Defect list or description |
| process mapping / AS-IS TO-BE / BPMN flow / business process / process model | `--process-map` | "map AS-IS TO-BE for disbursement module" | Process description or existing flow |
| project closure / close out / handover / lessons learned / project close | `--closure` | "close out the project and hand over to ops" | Project summary + handover details |
| hypercare / post-launch support / stabilization period / go-live support | `--hypercare` | "set up hypercare plan for month 1 post go-live" | Go-live date + support scope |
| maintenance / SLA monitoring / operations / enhancement intake / maintenance ops | `--maintenance` | "generate SLA report for May" | Month/period + SLA targets |
| release plan / release notes / version release / deployment notes | `--release` | "create release plan for v2.0" | Release scope + date |
| data migration / data cutover / migration planning / data transfer plan | `--data-migration` | "create migration plan from legacy system" | Source system + target schema |
| BA test cases / SIT scenarios / business test case / business acceptance test | `--test-case` | "generate SIT test cases for loan module" | Feature list or AC list |
| RACI matrix / responsibility assignment / communication plan / stakeholder matrix | `--raci` | "create RACI matrix and communication plan" | Stakeholder list + roles |
| capability map / skills matrix / expertise map / team capacity map / who knows what | `--raci --capability-map` | "who on the team knows CBS?" | None (reads existing artifacts) |
| estimation / story sizing / capacity planning / effort estimate / t-shirt sizing | `--estimation` | "estimate effort for sprint 5 stories" | User story list or feature scope |
| user persona / user journey mapping / persona card / customer journey | `--persona` | "create personas for credit officer and reviewer" | User groups description |
| analyze contract / contract analysis / contract clauses / contract deliverables | `--contract` | "analyze the project contract" | Contract file/folder path |
| acceptance certification / UAT results / sign-off report / acceptance report | `--acceptance` | "generate acceptance certification from UAT results" | UAT results file or inline |
| pm dashboard / what should I do today / morning brief / PM cockpit / project overview PM | `--pm` | "pm dashboard" | None |
| run full / analyze all inputs / full pipeline | `--full` | "run full pm-ba pipeline" | None (auto-scan input_root) |
| accept human edits / lock my changes / confirm edits | `--accept` | "accept my edits to the output" | None (scans docs/ for diff) |
| io mapping status / show locks / list mappings | `--io-status` | "show io mapping status" | None |
| unlock map / release lock | `--unlock` | "unlock MAP-001" | map_id (e.g., MAP-001) |

---

## IO-Mapping Specific NL Patterns

When user phrase contains both a mode AND an io-mapping concern, prioritize io-mapping flag:

| Phrase | Routes To |
|--------|-----------|
| "chạy lại brd" + (LOCKED detected) | `--brd` → warn STALE_INPUT |
| "cập nhật output urd" + (mapping exists) | `--accept` (likely human-edited) |
| "phân tích full nhưng skip lock" | `--full --skip-locked` |

---

## Ambiguity Rules

- **Two patterns match** → use `AskUserQuestion` to confirm which mode. Present both options with their descriptions. Do not guess.
- **Path provided but mode unclear** → check file extension, then check filename for BRD/URD keywords, then infer. If still unclear, ask.
- **Multiple documents provided** → infer batch mode: process all as same type if names are consistent; otherwise ask which to prioritize.
- **Meeting notes embedded in message** → if user pastes raw text (no path), infer `--meeting-post` if it contains date, attendees, or discussion items.

---

## Path Inference Rules

| Signal | Inferred Mode |
|---|---|
| Filename contains "BRD" (case-insensitive) | `--brd` |
| Filename contains "URD", "Yeu-cau", "User-Req", "User-Story" | `--urd` |
| Filename contains "Bien-ban", "BB-", "Minutes", "MOM" | `--template` (meeting minutes) |
| Filename contains "Risk", "Rui-ro" | `--risk` |
| Filename contains "Sprint" | `--sprint` |
| Filename contains "Backlog", "Refinement-Backlog", "Product-Backlog" | `--backlog` |
| Filename contains "UAT", "Test-Plan" | `--uat` |
| Folder with mixed docs | List contents → infer from majority file naming pattern |
| Single `.pdf` or `.docx` with no keyword | Ask user to confirm type |
| Multiple files, majority are BRD-named | `--brd` batch mode |
| Filename contains "Release-Notes", "Release-Plan", "Deployment-Note" | `--release` |
| Filename contains "RACI", "Comm-Plan", "Communication-Plan" | `--raci` |
| Filename contains "Persona", "Journey", "User-Journey" | `--persona` |
| Filename contains "Migration", "Cutover", "Data-Migration" | `--data-migration` |
| Filename contains "Test-Case", "TC-Register", "SIT-Scenario" | `--test-case` |
| Filename contains "Defect", "Bug-List", "Triage" | `--defect` |
| Filename contains "Closure", "Handover", "Lessons-Learned" | `--closure` |
| Filename contains "Hypercare", "Post-GoLive", "Stabilization" | `--hypercare` |
| Filename contains "Maintenance", "SLA-Report", "Ops-Report" | `--maintenance` |
| Filename contains "Estimation", "Effort-Estimate", "Story-Sizing" | `--estimation` |
| Filename contains "Process-Map", "BPMN", "AS-IS", "TO-BE" | `--process-map` |
| Filename contains "Hop-Dong", "HopDong", "Contract", "hop-dong" | `--contract` |
| Filename contains "UAT-Result", "Ket-Qua-UAT", "Acceptance-Cert" | `--acceptance` |
| Path starts with `inputs/contract/` | `--contract` |
| Path starts with `inputs/brd/` | `--brd` |
| Path starts with `inputs/urd/` | `--urd` |
| Path starts with `inputs/meeting/` | `--meeting-post` |
| No path provided + no NL match + user typed only 1-3 words (cold-start heuristic) | Try `--pm` if state file exists |

---

## 21 Routing Examples

| # | User Input (VN) | Detected Mode | Explanation |
|---|---|---|---|
| 1 | "phân tích file BRD_v2.docx này" | `--brd` | "phân tích" + "BRD" in filename |
| 2 | "vừa họp xong với khách, đây là notes" | `--meeting-post` | "vừa họp xong" + text pasted inline |
| 3 | "so sánh URD_v1.pdf và URD_v2.pdf" | `--diff` | "so sánh" + two file paths |
| 4 | "khách hàng yêu cầu thêm tính năng OTP" | `--cr` | "yêu cầu thay đổi" + new feature described |
| 5 | "tình hình dự án thế nào rồi" | `--state` | "tình hình hiện tại" phrase |
| 6 | "sprint planning cho sprint 5, đây là backlog" | `--sprint` | "sprint planning" exact match |
| 7 | "ký duyệt URD_Payment_v2.docx với anh Tuấn" | `--signoff` | "ký duyệt" + document + approver |
| 8 | "báo cáo tiến độ cho giám đốc tuần này" | `--status` | "báo cáo tiến độ" + audience = "giám đốc" |
| 9 | "cập nhật từ điển thuật ngữ nghiệp vụ ngân hàng" | `--glossary` | "từ điển nghiệp vụ" match |
| 10 | "tạo ERD cho bảng KhachHang và HopDong" | `--data-model` | "ERD" exact match |
| 11 | "có mấy điểm chưa rõ trong URD cần hỏi lại BA" | `--clarify` | "điểm chưa rõ" + "cần clarify" implied |
| 12 | "lập kế hoạch UAT cho module quản lý sau vay" | `--uat` | "kế hoạch UAT" exact match |
| 13 | "cập nhật ma trận truy vết sau khi thêm US-042" | `--trace` | "ma trận truy vết" exact match |
| 14 | "tạo go-live checklist cho ngày 30/6" | `--go-live` | "go-live" exact match + date slot extracted |
| 15 | "đọc thư mục docs/requirements/" | Infer from contents | Scan folder → check filenames → infer `--brd` or `--urd` |
| 16 | "groom backlog sprint tới, estimate story point" | `--backlog` | "groom" + "estimate" combo — not `--sprint` (which commits scope) |
| 17 | "triage bug từ UAT round 2, xem impact" | `--defect` | "triage" + "bug" + testing context |
| 18 | "vẽ quy trình phê duyệt khoản vay AS-IS hiện tại" | `--process-map` | "vẽ quy trình" + "AS-IS" exact match |
| 19 | "lập kế hoạch release v2.1, deployment ngày 30/6" | `--release` | "release" + version label — disambiguates from `--go-live` (which is checklist-focused) |
| 20 | "ước tính effort sprint 6, team 2 BE 1 FE capacity" | `--estimation` | "ước tính effort" + team composition context |
| 21 | "tạo persona cán bộ tín dụng và kiểm soát viên" | `--persona` | "persona" + user role description |
| 22 | "tôi cần làm gì hôm nay" | `--pm` | "tôi cần làm gì" exact match → PM cockpit |
| 23 | "pm dashboard" | `--pm` | "pm dashboard" keyword match |
