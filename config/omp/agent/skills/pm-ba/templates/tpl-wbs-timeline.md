---
stakeholder: internal
type: wbs-timeline
---
# WBS & Timeline — [Project Name]

**Phiên bản:** v1.0  **Ngày:** YYYY-MM-DD

---

## 1. Work Breakdown Structure (WBS)

| WBS-ID | Task / Deliverable | Parent | Duration (ngày) | Dependencies | Owner | Status |
|--------|-------------------|--------|:--------------:|-------------|-------|--------|
| 1 | **Phase 1: Phân tích & Thiết kế** | — | | | | |
| 1.1 | Kickoff meeting | 1 | 1 | — | PM | |
| 1.2 | Thu thập yêu cầu (BRD review) | 1 | 5 | 1.1 | BA | |
| 1.3 | Phân tích & Viết URD/SRS | 1 | 10 | 1.2 | BA | |
| 1.4 | Review & Sign-off URD | 1 | 3 | 1.3 | PM + Party A | |
| 2 | **Phase 2: Thiết kế kỹ thuật** | — | | | | |
| 2.1 | System architecture design | 2 | 7 | 1.4 | Tech Lead | |
| 2.2 | Database schema design | 2 | 5 | 2.1 | Dev | |
| 2.3 | API specification | 2 | 5 | 2.1 | Dev | |
| 3 | **Phase 3: Phát triển** | — | | | | |
| 3.1 | Sprint 1 — [Module name] | 3 | 14 | 2.3 | Dev Team | |
| 3.2 | Sprint 2 — [Module name] | 3 | 14 | 3.1 | Dev Team | |
| 3.3 | Sprint N — [Module name] | 3 | 14 | 3.2 | Dev Team | |
| 4 | **Phase 4: Kiểm thử** | — | | | | |
| 4.1 | SIT (System Integration Testing) | 4 | 7 | 3.3 | QA | |
| 4.2 | UAT | 4 | 10 | 4.1 | Party A + BA | |
| 4.3 | UAT Sign-off | 4 | 2 | 4.2 | PM + Party A | |
| 5 | **Phase 5: Triển khai** | — | | | | |
| 5.1 | Training | 5 | 3 | 4.3 | PM + BA | |
| 5.2 | Production deployment | 5 | 1 | 5.1 | Dev + Ops | |
| 5.3 | Hypercare support | 5 | 5 | 5.2 | Dev + BA | |

---

## 2. Timeline (Gantt — Text Format)

```
Phase/Task                    Week: 01 02 03 04 05 06 07 08 09 10 11 12
Phase 1: Phân tích & TK            [===]
  1.1 Kickoff                       [=]
  1.2 Thu thập yêu cầu                [==]
  1.3 Viết URD/SRS                       [====]
  1.4 Sign-off URD                           [=]
Phase 2: Thiết kế kỹ thuật                    [==]
Phase 3: Phát triển                             [=============]
  Sprint 1                                      [===]
  Sprint 2                                          [===]
  Sprint N                                              [===]
Phase 4: Kiểm thử                                           [====]
  SIT                                                       [=]
  UAT                                                          [==]
Phase 5: Triển khai                                                 [==]
```

*(Điều chỉnh timeline theo ngày thực tế của dự án)*

---

## 3. Milestones

| M-ID | Milestone | Ngày Dự Kiến | Ngày Thực Tế | Deliverables | Điều Kiện Hoàn Thành | Trạng Thái |
|------|-----------|:------------:|:------------:|-------------|---------------------|-----------|
| M-01 | Kickoff hoàn tất | | | Charter signed | Charter ký duyệt bởi cả 2 bên | Pending |
| M-02 | URD/SRS Approved | | | URD v1.0 | Sign-off từ Party A | Pending |
| M-03 | Development Complete | | | Code freeze | All US Done, SIT passed | Pending |
| M-04 | UAT Sign-off | | | UAT report | Party A ký UAT | Pending |
| M-05 | Go-Live | | | Production | System live, users trained | Pending |

---

## 4. Critical Path

```
M-01 (Kickoff)
  → 1.2 (BRD review)
    → 1.3 (URD/SRS)
      → M-02 (URD Approved)
        → 2.1 (Architecture)
          → 3.x (Development Sprints)
            → 4.1 (SIT)
              → 4.2 (UAT)
                → M-04 (UAT Sign-off)
                  → 5.2 (Go-Live) = M-05
```

**Total critical path duration:** [X] ngày = [Y] tuần

**Float available (non-critical tasks):**
| Task | Float (ngày) |
|------|-------------|
| 2.2 Database design | 3 |
| 5.1 Training | 2 |

---

## 5. Lịch Sử Thay Đổi

| Phiên bản | Ngày | Mô tả | Người cập nhật |
|----------|------|-------|---------------|
| v1.0 | | Tạo mới | |
