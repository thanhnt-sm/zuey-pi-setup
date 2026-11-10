> **OMP Adaptation Note:** Ported read-only from global `~/.claude/rules/`. Map Claude `Agent(...)` -> OMP `task`, `advisorModel` -> `modelRoles.advisor`, and `ai-gate-audit` -> `typesafe-planner` extension.

# Project Documentation Management

## Living Docs

- **Project Roadmap** (`./docs/project-roadmap.md`): phases, milestones, success metrics
- **Project Changelog** (`./docs/project-changelog.md`): chronological features, fixes, breaking changes, releases
- **System Architecture** (`./docs/system-architecture.md`): design, component diagrams, data flow, integration boundaries
- **Code Standards** (`./docs/code-standards.md`): conventions, style rules, naming patterns, anti-patterns

## Update Triggers

`docs-manager` updates these when: a phase status changes (in-progress → complete), a major feature ships, a significant bug or security issue is resolved, the timeline/scope changes, or a breaking external dependency change lands.

## Update Protocol

Read the current roadmap/changelog before editing, keep version consistency and formatting, then verify links/dates/cross-references afterward. Check updates against actual implementation progress, not intent.

## Plans

Plan folders, phase-file structure, and naming live in the `ck-plan` skill — see `ck-plan/references/plan-organization.md` for the directory layout and phase-file template, and the injected `## Naming` section for the computed path.
