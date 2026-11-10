---
name: gstack-visual-audit
description: "[S8.6] Visual QA — live-site 80-item audit + fix loop, atomic commits, before/after — Trigger: visual audit, design QA"
vi_triggers: "visual QA, design polish, kiểm tra visual, design audit, AI slop, giao diện xấu"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# GStack Visual Audit — Live-Site Design QA + Fix Loop

> Ported from [garrytan/gstack](https://github.com/garrytan/gstack) `/design-review` (MIT License)

## Overview

Designer's eye QA: tìm visual inconsistency, spacing issues, hierarchy problems, AI slop patterns, slow interactions — rồi FIX chúng. Iteratively fix issues trong source code, commit atomic mỗi fix, re-verify với before/after screenshots.

## When to Use
- Sau implementation, khi cần polish visual
- Khi user nói "audit the design", "visual QA", "check if it looks good"
- Khi phát hiện visual inconsistencies

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Process

### Step 1: Open App in Browser
```
browser_subagent(
  Task: "Navigate to the running app URL. Take full-page screenshots of all main pages/views. Report URLs and page titles.",
  RecordingName: "visual_audit_initial"
)
```

### Step 2: Run 80-Item Visual Audit Checklist

**Typography (10 items)**
- [ ] Heading hierarchy (h1 > h2 > h3) is visually clear
- [ ] Body text is readable (16px+ on desktop, 14px+ on mobile)
- [ ] Line height is comfortable (1.4-1.6 for body)
- [ ] Font weights create clear hierarchy
- [ ] No orphaned words (single word on last line of paragraph)
- [ ] Text truncation handled (ellipsis, not overflow)
- [ ] Monospace font used only for code
- [ ] Max line width ~75 characters for readability
- [ ] Letter spacing appropriate (not too tight/loose)
- [ ] Font loading doesn't cause layout shift

**Color & Contrast (10 items)**
- [ ] All text meets WCAG AA contrast (4.5:1)
- [ ] Interactive elements distinguishable from static
- [ ] Error/warning/success colors are distinct
- [ ] Dark mode colors properly inverted (if applicable)
- [ ] Links visually distinct from body text
- [ ] Color is not the ONLY indicator (icons/text for colorblind)
- [ ] Background patterns don't interfere with readability
- [ ] Consistent brand color usage
- [ ] Hover states visible and consistent
- [ ] Focus states visible for keyboard navigation

**Spacing & Layout (15 items)**
- [ ] Consistent spacing between sections
- [ ] Cards/items have consistent padding
- [ ] No colliding elements (overlapping text/images)
- [ ] Responsive at mobile/tablet/desktop breakpoints
- [ ] No horizontal scrollbar on any viewport
- [ ] Sufficient whitespace between interactive elements
- [ ] Grid alignment is consistent
- [ ] Margins match design system values
- [ ] Content doesn't touch viewport edges
- [ ] Loading states don't cause layout shift
- [ ] Empty states have content (not blank)
- [ ] Scroll behavior is smooth
- [ ] Sticky elements don't overlap content
- [ ] Modal/overlay spacing is correct
- [ ] Footer doesn't float mid-page on short content

**Interaction (15 items)**
- [ ] All buttons have hover/active states
- [ ] Form inputs have focus states
- [ ] Loading indicators for async actions
- [ ] Disabled states are visually clear
- [ ] Toast/notification placement is consistent
- [ ] Menu animations are smooth (<300ms)
- [ ] Dropdown menus don't overflow viewport
- [ ] Click targets are >= 44px for touch
- [ ] Tab order is logical
- [ ] Escape key closes modals/dropdowns
- [ ] Back button works as expected
- [ ] No broken links
- [ ] Form validation shows inline errors
- [ ] Success states are clear
- [ ] Undo available for destructive actions

**(Additional 30 items covering components, images, performance, and AI slop detection)**

### Step 3: Fix Loop

For each issue found:
1. **Screenshot before** — `browser_subagent` capture the issue
2. **Fix in source** — `replace_file_content` to fix CSS/HTML/component
3. **Commit atomic** — `run_command: git add -A && git commit -m "fix(design): <issue>"`
4. **Screenshot after** — `browser_subagent` verify fix
5. **Next issue** — repeat until audit passes

### Step 4: Summary Report

```
→ ctx_index(content: "Visual Audit: [pass]/80 items, [N] fixes", source: "GStack Visual Audit")
```

Output format:
```
VISUAL AUDIT REPORT
═══════════════════
Typography:  [X]/10 pass
Color:       [X]/10 pass
Spacing:     [X]/15 pass
Interaction: [X]/15 pass
Other:       [X]/30 pass
────────────────────
TOTAL: [XX]/80 pass
FIXES APPLIED: [N] atomic commits
```

## Integration
- **Uses MCP**: `browser_subagent` for screenshots, `ctx_index` for progress
- **Previous skill**: Implementation done (SA `/implement`)
- **Module**: GStack Imported (standalone, prefix `gstack-`)

<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Edge Cases

| Scenario | Handling |
|----------|----------|
| Dark mode not implemented | Note "dark mode not available" in report, not a bug |
| Different OS rendering | Test on default OS, note platform-specific issues |
| App has animations | Use `browser_subagent` recordings to capture motion |
| CSS-in-JS (no separate CSS files) | Edit component files directly |
| Third-party components | Cannot fix — note "third-party limitation" |
| Content in multiple languages | Check layout doesn't break with different text lengths |

## AI Slop Detection (Extended)

| Red Flag | What It Means | Fix |
|----------|---------------|-----|
| Every section has same card layout | AI generated template | Vary layouts |
| Purple-to-blue gradients everywhere | Default AI color choice | Use brand colors |
| "Click here to learn more" buttons | Generic CTA | Specific action text |
| Stock photo placeholder feel | AI default imagery | Real product screenshots |
| Perfect symmetry everywhere | AI prefers balance | Add intentional asymmetry |

## Model Recommendation
| Task | Best Model | Why |
|------|:----------:|-----|
| Visual issue detection | Gemini Pro | Best vision capabilities + browser_subagent native |
| CSS/code fixes | Gemini Pro or Claude Sonnet | Fast edits |
| AI slop detection | Claude Opus | Better pattern recognition |

