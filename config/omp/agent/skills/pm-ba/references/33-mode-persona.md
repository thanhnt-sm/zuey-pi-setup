# Mode: --persona — User Persona + Journey Map

## Purpose

Build persona cards and Mermaid journey maps from user-provided user group descriptions (BRD, URD, or direct input). Identifies pain points, system touch-points, and maps each persona to relevant US/features for traceability.

## Trigger Phrases

- Flag: `--persona`
- VN: "xây dựng persona", "chân dung người dùng", "user persona", "hành trình người dùng", "journey map"
- EN: "user persona", "persona card", "user journey map", "pain points analysis"

---

## 1. Required Input

| Source | Description |
|--------|-------------|
| User group descriptions | From BRD Section "Stakeholders/Users", URD, or user-pasted description |
| Key scenarios | 1–3 main business scenarios to map in journey (optional, derived if not provided) |

If user group docs not available, call `AskUserQuestion`:
```
Để xây dựng User Persona và Journey Map, cần:
1. Mô tả các nhóm người dùng của hệ thống (vai trò, phòng ban, nhiệm vụ chính)?
2. Kịch bản nghiệp vụ chính nào cần vẽ journey map (e.g. "tra cứu khoản vay", "phê duyệt hồ sơ")?
3. Đặc điểm kỹ thuật của người dùng (thành thạo công nghệ hay không)?
```

---

## 2. Workflow Steps

### Step 2a — Read State
Read `docs/pm-ba-document-status.md` → identify BRD/URD documents and their approval status.
Read BRD/URD raw extracts if available in `plans/reports/` → pull user group sections.
Read `docs/pm-traceability-matrix.md` → pull US list for persona-to-US mapping.

### Step 2b — Pain Point Analysis via /ck:brainstorm
Invoke `/ck:brainstorm` for each user group identified:
```
Nhóm người dùng: [GROUP_NAME] — [ROLE_DESCRIPTION]

Brainstorm:
1. Frustrations hiện tại (trước khi có hệ thống mới): quy trình thủ công, chờ đợi, tra cứu khó
2. Kỳ vọng với hệ thống mới: tiết kiệm thời gian, giảm lỗi, dễ tra cứu
3. Rủi ro adoption: ngại thay đổi, thiếu kỹ năng IT, kháng cự quy trình mới
4. Điểm chạm với hệ thống (touch-points): màn hình nào, chức năng nào họ dùng nhiều nhất

Output: bullet list cho từng category, dùng ngôn ngữ thực tế (không generic)
```

### Step 2c — Persona Card Generation via /ck:ask
Invoke `/ck:ask` for each user group with brainstorm output:
```
Tạo Persona Card cho nhóm người dùng [GROUP_NAME]:

Format:
- Tên (fictional VN name, phù hợp với ngữ cảnh ngân hàng/tổ chức VN)
- Vai trò (Role): [exact job title from user docs]
- Đơn vị (Organization Unit): [department/branch]
- Mục tiêu (Goals — 3–5 items): điều họ muốn đạt được trong công việc
- Khó khăn (Frustrations — 3–5 items): pain points hiện tại
- Hành động chính trong hệ thống (Key System Actions — 3–5): chức năng họ dùng thường xuyên nhất
- Mức độ thành thạo công nghệ (Tech Savviness): Thấp / Trung bình / Cao + mô tả ngắn
- Quote (1 câu minh họa tư duy của họ — tiếng Việt, tự nhiên)

Giữ ngôn ngữ cụ thể với ngữ cảnh nghiệp vụ — không dùng template chung chung.
```

### Step 2d — Journey Map via /ck:mermaidjs-v11
For each key scenario (1–3), invoke `/ck:mermaidjs-v11` to generate journey diagram:

Use `sequenceDiagram` for linear flows (step-by-step process):
```
Kịch bản: [SCENARIO_NAME]
Persona: [PERSONA_NAME]

Vẽ sequenceDiagram cho hành trình:
Pre-system: hành động trước khi dùng hệ thống (giấy tờ, gọi điện, hỏi đồng nghiệp)
Using system: các bước tương tác với hệ thống (login → navigate → action → result)
Post-system: hành động sau khi dùng hệ thống (in ấn, báo cáo, chuyển tiếp)

Highlight pain points (note box) và touch-points chính
```

Use `stateDiagram-v2` for status-based flows (approval workflows, document states).

### Step 2e — Persona-to-US Mapping
For each persona, list US items they are the primary user of:
```
| Persona | US-ID | US Title | Touch-point |
```
Cross-reference `docs/pm-traceability-matrix.md` — update "Primary Persona" column if not present.

### Step 2f — Save Artifacts
Create `plans/reports/pm-{date}-persona-journey.md` using `templates/tpl-persona-card.md`.

Sections: Persona Cards (one per user group) | Journey Maps (Mermaid embedded) | Pain Point Summary | Persona-to-US Mapping.

### Step 2g — Update Traceability (Invariant)
In `docs/pm-traceability-matrix.md`:
- Add "Primary Persona" column if not present
- Link each US to its primary persona name

### Step 2h — Update State File
Update `docs/pm-ba-document-status.md`:
```
Last Mode Run: persona
Last Run Date: [TODAY]
Persona Report: plans/reports/pm-{date}-persona-journey.md
Personas created: [N] | Journey maps: [N] scenarios
Traceability: Primary Persona column updated
```

---

## 3. Output Artifacts

| File | Description |
|------|-------------|
| `plans/reports/pm-{date}-persona-journey.md` | Persona cards + journey maps + mapping |
| `docs/pm-traceability-matrix.md` | Primary Persona column updated |

Template: `templates/tpl-persona-card.md`

---

## 4. Stakeholder

Internal BA/PM team (empathy building), dev team (UX context), product owner

## 5. Sub-Skills

| Skill | When |
|-------|------|
| `/ck:brainstorm` | Step 2b: pain points, frustrations, touch-points per user group |
| `/ck:ask` | Step 2c: persona card structured generation |
| `/ck:mermaidjs-v11` | Step 2d: journey map diagram (sequenceDiagram or stateDiagram-v2) |

## 6. State Update

```
Last Mode Run: persona
Persona Report: plans/reports/pm-{date}-persona-journey.md
Personas: [N] cards | Journeys: [N] maps
Traceability: Primary Persona column linked in pm-traceability-matrix.md
```

## 7. End-of-Mode Hook

Journal: NO
