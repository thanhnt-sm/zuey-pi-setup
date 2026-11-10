# Mode: --raci — RACI Matrix + Communication Plan

## Purpose

Build a RACI assignment matrix per work package/deliverable and a full communication plan (channels, frequency, format, escalation path) from user-provided stakeholder descriptions or kickoff artifacts.

## Trigger Phrases

- Flag: `--raci`
- VN: "ma trận RACI", "phân công trách nhiệm", "kế hoạch truyền thông", "communication plan", "ai chịu trách nhiệm gì"
- EN: "RACI matrix", "responsibility matrix", "communication plan", "meeting cadence"

---

## 1. Required Input

| Source | Description |
|--------|-------------|
| Stakeholder list | Names, roles, organizations — from user input or kickoff artifacts in state file |
| Work packages | Major deliverables or project phases (from plan or user input) |
| Project type | Internal system / client-facing / multi-vendor |

If stakeholder list not available, call `AskUserQuestion`:
```
Để xây dựng RACI và Communication Plan, cần:
1. Danh sách stakeholder: tên, vai trò, tổ chức?
2. Danh sách deliverables hoặc work packages chính của dự án?
3. Dự án có vendor ngoài không (Bên B, Bên C)?
4. Tần suất báo cáo lên Ban lãnh đạo (tuần / 2 tuần / tháng)?
```

---

## 2. Workflow Steps

### Step 2.0 — Sub-flag Detection
If `--capability-map` sub-flag present OR NL matches capability-map patterns (see `references/43-mode-capability-map.md`):
→ Route to `references/43-mode-capability-map.md` — skip Steps 2a–2e below.
Otherwise: continue with normal RACI + Communication Plan flow.

### Step 2a — Read State
Read `docs/pm-ba-document-status.md` → check if kickoff artifacts or stakeholder map exists.
If `docs/pm-stakeholder-registry.md` exists, read it for stakeholder list (Bên A + Bên B tables).
Read plan overview if available for work package list.

### Step 2b — RACI Assignment via /ck:ask
Invoke `/ck:ask` with stakeholder list + work packages:
```
Stakeholders: [LIST with role and org]
Work packages / Deliverables: [LIST]

Tạo RACI matrix:
- R (Responsible): người thực hiện công việc
- A (Accountable): người chịu trách nhiệm cuối cùng — chỉ 1 người/deliverable
- C (Consulted): người được hỏi ý kiến trước khi quyết định
- I (Informed): người nhận thông báo sau khi quyết định

Lưu ý:
- Mỗi deliverable phải có đúng 1 A
- Nếu R và A là cùng 1 người: ghi "R/A"
- Tránh quá nhiều C cho 1 deliverable (bottleneck)

Output: bảng Deliverable × Stakeholder, cell = R/A/C/I/-
Sau đó: tóm tắt gánh nặng per stakeholder (số lượng R, A, C, I)
```

### Step 2c — Communication Matrix via /ck:sequential-thinking
Invoke `/ck:sequential-thinking` for communication plan:
```
Từ RACI matrix và danh sách stakeholder, xây dựng Communication Matrix:

Cuộc họp định kỳ (VN names):
- Họp đứng hàng ngày (Daily Standup): ai tham dự, giờ, kênh, thời lượng
- Họp đồng bộ PM hàng tuần (Weekly PM Sync): agenda chuẩn, người chủ trì
- Họp chỉ đạo 2 tuần / tháng (Bi-weekly Steering / Monthly Board): báo cáo cho ai
- Họp phê duyệt (Sign-off Meeting): khi nào, ai phê duyệt

Communication channels per stakeholder:
- Kênh chính (email, Teams, Slack, Zalo — từ thông tin dự án)
- Tần suất báo cáo
- Format (báo cáo văn bản / slide / dashboard)
- Ngôn ngữ (VN / EN / song ngữ)

Escalation matrix:
- Issue type → Người tiếp nhận → Thời hạn phản hồi → Leo thang tiếp theo
  Loại: Kỹ thuật | Phạm vi (scope) | Ngân sách | Nhân sự | Pháp lý/Hợp đồng
```

### Step 2d — Save Artifacts
Create `plans/reports/pm-{date}-raci-communication-plan.md` using `templates/tpl-raci.md`.

Sections: RACI Table | Stakeholder Load Summary | Communication Matrix | Meeting Cadence | Escalation Matrix.

### Step 2e — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: raci
Last Run Date: [TODAY]
RACI + Comm Plan: plans/reports/pm-{date}-raci-communication-plan.md | Draft
Stakeholder count: [N] | Work packages covered: [N]
```

---

## 3. Output Artifacts

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-raci-communication-plan.md` | RACI table + full communication plan |

Template: `templates/tpl-raci.md`

---

## 4. Stakeholder

Internal PM team, project sponsor, steering committee

## 5. Sub-Skills

| Skill | When |
|-------|------|
| `/ck:ask` | Step 2b: RACI assignment and load analysis |
| `/ck:sequential-thinking` | Step 2c: communication cadence derivation and escalation matrix |

## 6. State Update

```
Last Mode Run: raci
RACI + Comm Plan: plans/reports/pm-{date}-raci-communication-plan.md
Stakeholders mapped: [N] | Work packages: [N]
```

## 7. End-of-Mode Hook

Journal: NO
