> **OMP Adaptation Note:** Ported read-only from global `~/.claude/rules/`. Map Claude `Agent(...)` -> OMP `task`, `advisorModel` -> `modelRoles.advisor`, and `ai-gate-audit` -> `typesafe-planner` extension.

# Skill Domain Routing

Most skill descriptions in the catalog are specific enough to pick from directly. This file only covers the cases where two or more skills could plausibly answer the same request.

## Frontend / design (pick one)

```
Replicate a mockup/screenshot/video exactly       → frontend-design
Build React/TS components with best practices     → frontend-development
Choose colors, fonts, layout, design system        → ui-ux-pro-max
Style with Tailwind + shadcn/ui components         → ui-styling
Audit existing UI for accessibility/UX             → web-design-guidelines
Brand identity, logos, banners (not UI code)       → design
```

## Browser automation / testing (pick one)

```
Run test suites, coverage, CI                      → test
Web-specific testing (Playwright, k6, a11y)        → web-testing
Puppeteer scripts, screenshots, scraping            → chrome-devtools
AI-driven browser sessions, cloud (Browserbase)    → agent-browser
View a rendered file or generate a walkthrough      → preview
```

## Security (pick one)

```
STRIDE/OWASP audit with auto-fix loop               → security (ck-security)
One-shot secret/vulnerability scan                  → security-scan
```

## Backend / enterprise discipline (pick one)

```
Build new backend features/APIs (REST/GraphQL, DI)  → backend-development
Adopt/enforce a fixed enterprise layer & rules pack  → standards
```

## Deployment / infra (pick one)

```
Deploy to a specific host (Vercel, Fly.io, etc.)    → deploy
Docker, Kubernetes, CI/CD pipelines, GitOps          → devops
```

## Usage

- Pick one skill per distinct intent; if a task spans two domains (e.g. "build + deploy"), lead with the primary skill and mention the secondary.
- Domain skills combine with the core chain: `/ck:plan` → domain skill → `/ck:cook`.
- Everything else: match the task to the catalog description directly, or see `skill-workflow-routing.md` for the core development/bugfix/investigation sequences.
