---
stakeholder: internal
type: raci
---
# Ma Trận RACI & Kế Hoạch Giao Tiếp

**Dự án:** [Tên dự án]  **Ngày tạo:** YYYY-MM-DD  **PM:** [Tên PM]  **Phiên bản:** v1.0

---

## A. Ma Trận RACI

> **Legend:** R = Responsible (Thực hiện) | A = Accountable (Chịu trách nhiệm) | C = Consulted (Tham vấn) | I = Informed (Được thông báo)

| Work Package / Deliverable | [Stakeholder 1] | [Stakeholder 2] | [Stakeholder 3] | [Stakeholder 4] | [Stakeholder 5] |
|---------------------------|:---------------:|:---------------:|:---------------:|:---------------:|:---------------:|
| [Kickoff & Planning] | A | R | C | I | I |
| [Business Requirements] | C | A/R | R | C | I |
| [System Design] | I | C | A/R | R | I |
| [Development / Build] | I | I | A | R | I |
| [Testing / QA] | I | C | A | C | R |
| [UAT] | C | A/R | C | I | R |
| [Deployment] | A | C | R | R | I |
| [Training & Handover] | C | R | I | I | A/R |
| [Project Closure] | A | R | C | I | I |

> Thay thế tên cột `[Stakeholder X]` bằng tên thực tế (ví dụ: PM, BA, Dev Lead, QA Lead, Client Rep).

---

## B. Ma Trận Giao Tiếp

| Bên liên quan | Thông tin cần nhận | Kênh liên lạc | Tần suất | Người gửi | Định dạng |
|--------------|------------------|:------------:|:--------:|----------|----------|
| [Sponsor] | Tiến độ tổng thể, rủi ro, ngân sách | Email | Hàng tháng | [PM] | Báo cáo trạng thái |
| [Client Rep] | Tiến độ, vấn đề cần quyết định | Teams + Email | Hàng tuần | [PM/BA] | Báo cáo tuần |
| [Dev Team] | Yêu cầu mới, thay đổi, blocker | Jira + Teams | Hàng ngày | [BA] | US + AC |
| [QA Team] | Phiên bản build, test scope | Teams + Jira | Mỗi sprint | [Tech Lead] | Test plan |
| [PM] | Tiến độ technical, rủi ro kỹ thuật | Daily standup | Hàng ngày | [Dev Lead] | Standup notes |

---

## C. Lịch Họp Định Kỳ

| Loại họp | Tần suất | Thành phần | Thời lượng | Chủ trì |
|---------|:--------:|-----------|:---------:|--------|
| Daily Standup | Hàng ngày | Dev, BA, QA | 15 phút | [Scrum Master / PM] |
| Sprint Planning | Mỗi sprint | PO, Dev, BA, QA | 2 giờ | [PM / SM] |
| Sprint Review | Mỗi sprint | Tất cả + Client | 1 giờ | [PM] |
| Retrospective | Mỗi sprint | Dev, BA, QA, PM | 1 giờ | [SM] |
| Steering Committee | Hàng tháng | PM, Sponsor, Client | 1 giờ | [PM] |
| Technical Sync | Hàng tuần | Dev Lead, BA, Arch | 1 giờ | [Tech Lead] |

---

## D. Ma Trận Leo Thang

| Loại vấn đề | Mức độ | Leo thang cấp 1 | Leo thang cấp 2 | Leo thang cấp 3 | SLA phản hồi |
|------------|:------:|----------------|----------------|----------------|:-----------:|
| Thay đổi scope | Major | BA → PM | PM → Client Rep | PM → Sponsor | 1 ngày |
| Blocker kỹ thuật | Critical | Dev → Tech Lead | Tech Lead → PM | PM → Vendor | 4 giờ |
| Trễ timeline | Major | PM → Sponsor | PM → Client | — | 1 ngày |
| Sự cố production | P1 | On-call Dev → Tech Lead | Tech Lead → PM | PM → Sponsor + Client | 15 phút |
| Tranh chấp yêu cầu | Normal | BA → PM | PM → Client Rep | PM → Sponsor | 2 ngày |
