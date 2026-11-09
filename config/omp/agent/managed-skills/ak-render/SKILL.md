---
name: ak-render
description: Biên dịch và tạo giao diện HTML tương tác declarative từ Page Spec (YAML/JSON) cho AI agent bằng AK Render (@bestagentkits/render) và MCP server.
---

# ak-render: Declarative Page Spec & HTML Artifact Compiler

## Overview
Compiles declarative Page Specs (YAML/JSON) into standalone, interactive HTML artifacts using `@bestagentkits/render` CLI and MCP server. Reduces agent token consumption by 60–73% compared to generating raw HTML/CSS/JS.

## Workflow
1. **Search Catalog & Recipes**: Use `ak-render search-catalog <terms>` or `ak-render recipes` to find relevant blocks or starter templates.
2. **Describe Contracts**: Run `ak-render describe <block-types...> --compact` to check required properties and types before writing YAML.
3. **Draft Page Spec**:
   - `version: 1`
   - `meta: { title, description }`
   - `theme: { preset }`
   - `datasets: { id: [...] }`
   - `blocks: [...]`
   - Zero raw HTML tags or script injection.
4. **Pre-flight Validate**: Always run `ak-render validate <spec> --json`. Fix any diagnostics by exact JSON path before rendering.
5. **Render**: Run `ak-render <spec> --out <path.html> --json` to generate the self-contained HTML artifact. Store output in `_output/docs/` or `_output/drafts/`.
