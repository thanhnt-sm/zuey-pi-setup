> **OMP Adaptation Note:** Ported read-only from global `~/.claude/rules/`. Map Claude `Agent(...)` -> OMP `task`, `advisorModel` -> `modelRoles.advisor`, and `ai-gate-audit` -> `typesafe-planner` extension.

# Development Rules

These principles guide every implementation: **YAGNI** (don't build for a future that may not come), **KISS** (the simplest thing that works), **DRY** (don't repeat logic).

## General

- **File naming**: kebab-case, descriptive even if long — a self-documenting name saves a Read when a tool is just Grep-ing for the right file.
- **File size**: keep code files under ~200 lines. Split by extracting utilities and dedicated service classes rather than growing one file; this doesn't apply to markdown, plain text, or config files.
- For library/framework docs, use the `docs-seeker` skill (context7) rather than guessing from training data.
- Follow the codebase structure and standards already documented in `./docs`.
- Implement the real thing — a mock or stub that quietly stands in for the actual behavior costs more later than saying it's not done yet.

## Code Quality

- Follow `./docs/code-standards.md` when it exists.
- No syntax errors, code compiles — beyond that, prioritize readability and productivity over strict style enforcement.
- Handle errors explicitly; cover the security-sensitive paths (auth, input validation, secrets).
- Route every implementation through `code-reviewer` before it's considered done.

## Pre-commit / Push

- Lint before commit; run tests before push — a failing test blocks the push, it doesn't get skipped to unblock CI.
- Keep commits focused on the actual change.
- Never commit secrets (`.env`, API keys, credentials).
- Conventional-commit messages, no AI attribution.

## Code Implementation

- Update existing files directly rather than creating a parallel "enhanced" copy.
- Handle edge cases and error scenarios as part of the implementation, not as a follow-up.

## Visual Aids

- `/ck:preview --explain` for unfamiliar code or complex logic; `--diagram` for architecture/data flow; `--slides` for walkthroughs; `--ascii` for terminal-only output; add `--html` to any of these for a self-contained page.
- Visuals save to the active plan's `visuals/` dir (from the injected `## Plan Context`), or `plans/visuals/` with no active plan.
- Use the `mermaidjs-v11` skill for current Mermaid syntax.
- See `primary-workflow.md` for where this fits in the core chain.
