---
name: notebooklm-integration
description: "[S8.15] Nghiên cứu với NotebookLM — tạo notebook, thêm sources, query Q&A — Trigger: cần citation-backed research"
vi_triggers: "nghiên cứu NotebookLM, tạo notebook, query research"
hide: true
---

<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->

# NotebookLM MCP Integration Skill

<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->

## Overview

Integrates Google NotebookLM via `notebooklm-mcp` MCP server for citation-backed research, Q&A with sources, and content generation.

## When to Use

- Research tasks needing citations and source validation
- Building knowledge base from multiple documents/URLs
- Generating synthesized content (summaries, Q&A, audio overviews)
- During `/research` workflow when deep source analysis is needed

## Prerequisites

- `notebooklm-mcp` must be configured in `.gemini/settings.json`
- Google account authentication for NotebookLM

## Core Workflow

### 1. Create & Populate Notebook

```
# Create notebook for research topic
nlm notebook create "<topic name>"

# Add sources (URLs, text, files)
nlm sources add --notebook "<name>" --url "<doc URL>"
nlm sources add --notebook "<name>" --text "<content>"
```

### 2. Query for Answers

```
# Ask questions with citations
nlm notebook query "<name>" "What is the best practice for X?"
# → Returns answer with inline citations from sources
```

### 3. Generate Content

```
# Generate audio overview (podcast-style)
nlm generate audio --notebook "<name>"

# Generate structured summary
nlm generate summary --notebook "<name>"
```

## Integration Points

| Workflow | Usage |
|----------|-------|
| `/research` | Create notebook per research question, add sources, query for synthesis |
| `/full-team` | Feed expert findings into notebook for cross-reference and citations |
| `/document` | Generate documentation with source citations |
| `/brainstorm` | Import prior art, query for ideas grounded in sources |

## Graceful Degradation

If notebooklm-mcp unavailable:
- Use `search_web` + `ctx_fetch_and_index` for web research
- Use `ctx_index` + `ctx_search` for local knowledge management
- Never fail the workflow — NotebookLM is enhancement, not requirement

## Anti-Patterns

- ❌ Using notebooklm for questions answerable from codebase
- ❌ Creating notebooks without specific research questions
- ❌ Skipping citation verification on critical claims
