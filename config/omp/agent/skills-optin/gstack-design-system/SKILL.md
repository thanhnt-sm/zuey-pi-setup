---
name: gstack-design-system
description: "[S8.4] Design consultation — tạo design system hoàn chỉnh, brand, typography, color — Trigger: design system, brand, DESIGN.md"
vi_triggers: "design system, brand, thiết kế design system, typography, color palette, visual identity, DESIGN.md"
next_skill: gstack-visual-audit
next_condition: "DESIGN.md created and approved"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# GStack Design Consultation — Complete Design System

> Ported from [garrytan/gstack](https://github.com/garrytan/gstack) `/design-consultation` (MIT License)

## Overview

Hiểu product, nghiên cứu landscape, đề xuất design system hoàn chỉnh (aesthetic, typography, color, layout, spacing, motion), và tạo font+color preview pages. Tạo `DESIGN.md` làm design source of truth cho project.

Không chỉ chọn fonts — researches what's out there, proposes safe choices AND creative risks, generates realistic mockups.

## When to Use

- Bắt đầu project mới cần UI
- Chưa có design system hoặc DESIGN.md
- Khi user nói "design system", "brand guidelines", "create DESIGN.md"
- Khi project cần visual identity cohesive


<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Process

### Step 1: Understand the Product

1. Đọc context:
   ```
   → view_file _output/docs/DESIGN-<topic>.md (nếu có)
   → grep_search cho README.md, package.json
   → Hỏi user mô tả product
   ```

2. Hỏi clarifying questions:
   - "Product này dành cho ai? (B2B enterprise? Consumer? Developer?)"
   - "Tone & feel mong muốn? (Professional? Playful? Minimal? Bold?)"
   - "Reference websites bạn thích visual? (3-5 examples)"
   - "Brand colors đã có chưa? Logo?"

### Step 2: Research the Landscape

```
→ search_web "<industry> design system examples 2025 2026"
→ search_web "best <product-type> UI design inspiration"
```

Analyze:
- What competitors look like
- Design trends in this space
- What's "safe" vs "creative risk"

### Step 3: Propose Design System

Present **2 options**: Safe Choice + Creative Risk

**For each option, define:**

**a) Color Palette**
```
Primary:    #XXXXXX — [name, usage]
Secondary:  #XXXXXX — [name, usage]
Accent:     #XXXXXX — [name, usage]
Background: #XXXXXX — [name, usage]
Surface:    #XXXXXX — [name, usage]
Text:       #XXXXXX — [name, usage]
Error:      #XXXXXX
Warning:    #XXXXXX
Success:    #XXXXXX
```

**b) Typography**
```
Heading:  [Font Family] — [weight, size scale]
Body:     [Font Family] — [weight, line-height]
Mono:     [Font Family] — [for code]
Scale:    [type scale ratio, e.g., 1.25 major third]
```

**c) Spacing System**
```
Base unit: [4px / 8px]
Scale: [xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px, 2xl: 48px]
```

**d) Border Radius**
```
Small:  [4px]
Medium: [8px]
Large:  [12px]
Full:   [9999px]
```

**e) Shadows**
```
sm: [shadow definition]
md: [shadow definition]
lg: [shadow definition]
```

**f) Motion / Animation**
```
Duration: [fast: 150ms, normal: 300ms, slow: 500ms]
Easing:   [ease-out for enters, ease-in for exits]
```

### Step 4: User Chooses

Hỏi user chọn between Safe Choice và Creative Risk (hoặc mix).

### Step 5: Generate Preview

Tạo HTML preview page để visualize:

```
→ write_to_file _output/docs/design-preview.html
```

Preview page includes:
- Color swatches
- Typography scale demo
- Button styles
- Card component
- Spacing visualization

### Step 6: Write DESIGN.md

Save to `_output/docs/DESIGN.md`:

```markdown
# Design System — [Product Name]

## Philosophy
[Design approach + reasoning]

## Colors
| Token | Hex | Usage |
|-------|-----|-------|
| primary | #XXXX | Buttons, links, key actions |
| ... | ... | ... |

## Typography
| Role | Font | Weight | Size |
|------|------|--------|------|
| h1 | ... | 700 | 2.5rem |
| ... | ... | ... | ... |

## Spacing
[Spacing scale definition]

## Components
[Key component patterns]

## Motion
[Animation guidelines]

## Dark Mode
[Dark mode color mappings if applicable]
```

Index for downstream skills:
```
→ ctx_index(path: "_output/docs/DESIGN.md", source: "GStack Design System")
```

### Step 7: Suggest Next

"Design system created. Chạy `/gstack-design-review-plan` để review design decisions trước implementation."


<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Key Principles

- **Research before proposing** — Luôn search_web cho landscape/trends trước khi đề xuất
- **Always 2 options** — Safe choice (proven, predictable) + Creative risk (bold, differentiating)
- **Show, don't tell** — Tạo preview page, không chỉ describe bằng text
- **System, not ad-hoc** — Mọi value phải có trong token system (no magic numbers)
- **Accessible** — WCAG 2.1 AA contrast ratios (4.5:1 for text, 3:1 for large text)

## Red Flags

| Issue | Fix |
|-------|-----|
| Colors don't meet WCAG contrast | Adjust until 4.5:1 minimum |
| Too many fonts (>3) | Reduce to 2: heading + body |
| No dark mode consideration | At minimum, document dark-mode palette |
| Generic/template look | Add 1 "signature" element (color, shape, animation) |

## Integration

- **Rules**: `execution-integrity-core`, `auto-continue-loop`
- **Previous skill**: `gstack-eng-review` or `gstack-office-hours`
- **Next skill**: `gstack-design-review-plan`
- **Memory**: Check `learned-rules/lessons.md`
- **Module**: GStack Imported (standalone, prefix `gstack-`)
