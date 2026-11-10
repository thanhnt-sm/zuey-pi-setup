---
name: gstack-cross-model
description: "[S8.13] Cross-model second opinion — review từ góc khác, adversarial testing — Trigger: second opinion, cross-model"
vi_triggers: "second opinion, đối chiếu model, đánh giá khác, cross-model review, adversarial"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# GStack Cross-Model — Second Opinion Review

> Adapted from [garrytan/gstack](https://github.com/garrytan/gstack) `/codex` concept (MIT License)

## Overview

Cross-model second opinion — 3 modes. **Review**: independent diff review. **Challenge**: adversarial mode tìm cách break code. **Consult**: hỏi ý kiến khác.

**Adaptation:** GStack gốc dùng OpenAI Codex CLI. Port này adapt concept thành self-adversarial review hoặc tích hợp Gemini CLI nếu có.

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## Three Modes

### Mode 1: REVIEW (Independent Diff Review)

1. Gather diff:
```
ctx_execute(language: "shell", code: """
BASE=$(git merge-base HEAD main 2>/dev/null || echo HEAD~5)
git diff "$BASE"..HEAD
""", intent: "full diff for cross-model review")
```

2. Review independently — pretend you haven't seen the code before
3. Focus on: logic errors, off-by-one, missing null checks, race conditions
4. Verdict: PASS ✅ / FAIL ❌ with specifics

### Mode 2: CHALLENGE (Adversarial)

"Tôi là adversary. Mục tiêu: break code này."

1. **Input fuzzing** — What inputs cause crashes?
2. **State corruption** — Can state become inconsistent?
3. **Concurrency** — What if 2 requests hit simultaneously?
4. **Security** — Can I escalate privileges? Inject code?
5. **Scale** — What if 10x data? 100x users?

Present attacks:
```
ADVERSARIAL REPORT
═══════════════════
Attack #1: [description] → [impact] → [mitigation]
Attack #2: [description] → [impact] → [mitigation]
... (minimum 5 attacks)
```

### Mode 3: CONSULT (Ask Anything)

User hỏi question → answer from "fresh perspective":
1. Explicitly forget previous conversation context
2. Analyze from first principles
3. State assumptions clearly
4. Compare with industry best practices (`search_web`)

## Multi-Model Strategy in Antigravity IDE

Antigravity IDE hỗ trợ chọn model từ dropdown. Leverage khả năng này:

**Strategy 1: Model Switch (recommended)**
1. User đang dùng Gemini → review code
2. Chuyển sang Claude Opus từ dropdown → chạy `/gstack-cross-model` → Claude review cùng code từ góc Claude
3. So sánh kết quả

**Strategy 2: Self-Adversarial (any model)**
AI tự đặt mình vào vị trí adversary — không cần chuyển model:
1. Đọc code bình thường
2. Switch mindset: "Tôi là hacker. Tìm cách break code này."
3. Present findings from adversary perspective

**Strategy 3: Gemini CLI External (if available)**

Nếu `gemini` CLI installed:
```
ctx_execute(language: "shell", code: """
which gemini 2>/dev/null && echo 'CLI_AVAILABLE' || echo 'CLI_NOT_AVAILABLE'
""")
```

Nếu available → truly independent review:
```
ctx_execute(language: "shell", code: """
BASE=$(git merge-base HEAD main 2>/dev/null || echo HEAD~5)
DIFF=$(git diff "$BASE"..HEAD)
echo "Review this diff for bugs, security issues, and logic errors. Be critical:" | cat - <(echo "$DIFF") | gemini --model gemini-2.5-pro 2>&1 | head -100
""", intent: "external Gemini CLI review")
```

<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Edge Cases

| Scenario | Handling |
|----------|----------|
| No other model available | Self-adversarial mode (Strategy 2) |
| Diff too large for CLI | Split by file, review each separately |
| Both models agree | High confidence — likely correct |
| Both models disagree | Flag as "needs human review" |
| Gemini CLI not installed | Skip Strategy 3, use Strategy 1 or 2 |

## Model Recommendation

| Task | Best Model | Why |
|------|:----------:|-----|
| Logic review | Claude Opus | Deep reasoning, catches subtle bugs |
| Security review | Claude Opus | Strong at security analysis |
| Performance review | Gemini Pro | Good at identifying N+1 and bottlenecks |
| Quick sanity check | Gemini Flash | Fast, catches obvious issues |
| Adversarial testing | Claude Opus | Better at thinking like an attacker |

## Integration
- **Uses MCP**: `ctx_execute` for diff analysis and CLI invocation
- **AI Model**: Best run on a DIFFERENT model than the one that wrote the code
- **Module**: GStack Imported (standalone, prefix `gstack-`)

