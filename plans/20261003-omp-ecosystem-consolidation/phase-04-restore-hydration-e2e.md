---
phase: 4
title: "Cross-Platform Restore & Plugin Hydration E2E Validation"
status: pending
priority: P2
effort: "2h"
dependencies: [1, 2, 3]
---

# Phase 4: Cross-Platform Restore & Plugin Hydration E2E Validation

## Overview
Perform full end-to-end verification of the portable restore pipeline across macOS M1 (Darwin), Linux, and Windows, validating automatic shellPath adaptation, plugin dependency hydration via Bun/NPM, and lockfile consistency.

## Requirements
- Functional:
  - Add preflight environment check to `scripts/omp-setup-restore.sh` validating Node.js/Bun runtime availability before attempting hydration.
  - Verify that `config/omp/plugins/` installs cleanly via `bun install` or `npm install` without resolution errors.
  - Generate an updated, verified portable bundle at `backups/omp-setup-portable.tar.gz`.
  - Provide a sanity test script `tests/test-omp-restore-e2e.sh` validating the entire lifecycle: Backup -> Sanitize -> Package -> Restore -> Hydrate -> Healthcheck.
- Non-functional:
  - Zero modifications to active host `~/.omp` during testing (all tests must operate inside isolated temp directories).
  - Secret scan verification: restored files must contain zero plain-text API secrets.

## Architecture
```
Current Working OMP Mirror (config/omp)
                   │
                   ▼ (omp-setup-backup.sh)
Staging & Secret Scrubbing (Strip .env, template shellPath)
                   │
                   ▼
Portable Bundle (backups/omp-setup-portable.tar.gz)
                   │
                   ▼ (omp-setup-restore.sh)
Target Environment (~/.omp on macOS M1 / Linux / Windows)
         ┌─────────┴─────────┐
         ▼                   ▼
    Detect OS          Hydrate Plugins
(Inject /bin/zsh)   (bun install in plugins/)
         │                   │
         └─────────┬─────────┘
                   ▼
       Operational OMP Engine
```

## Related Code Files
- Create: `tests/test-omp-restore-e2e.sh`
- Modify: `scripts/omp-setup-restore.sh`
- Modify: `backups/omp-setup-portable.tar.gz`
- Modify: `docs/omp-setup-migration.md`

## Implementation Steps
1. **3.4.T (TDD Tests First)**:
   - Create `tests/test-omp-restore-e2e.sh`.
   - Setup a simulated mock host environment.
   - Run backup script to generate portable bundle.
   - Run restore script targeting mock destination with OS overrides (`Darwin`, `Linux`).
   - Assert `config.yml` shellPath is correctly configured (`/bin/zsh` on Darwin, `/bin/bash` on Linux).
   - Assert `plugins/package.json` contains no conflicting packages.
   - Assert `.env` is initialized from `.env.example` without exposed secrets.
2. **3.4.I (Implementation)**:
   - Enhance `scripts/omp-setup-restore.sh` with a post-restore plugin verification check.
   - Regenerate `backups/omp-setup-portable.tar.gz` using `scripts/omp-setup-backup.sh`.
   - Document the verification steps in `docs/omp-setup-migration.md`.
3. **3.4.V (Verification)**:
   - Run `bash tests/test-omp-restore-e2e.sh` (Expect: 100% PASS).
   - Run full regression suite (`tests/test-omp-migration.sh`, `tests/test-omp-syncignore.sh`, `tests/test-omp-sync-extraction.sh`).

## Success Criteria
- [ ] `tests/test-omp-restore-e2e.sh` passes 100%.
- [ ] Restored directory is fully verified with proper OS-specific shell configuration.
- [ ] Updated `backups/omp-setup-portable.tar.gz` artifact is verified clean of secrets and platform binaries.

## Risk Assessment
- **Risk**: Target machine lacks `bun` runtime for plugin hydration.
  - *Mitigation*: Script gracefully falls back to `npm install`, and if neither exists, emits an explicit instruction for installing Bun on macOS (`curl -fsSL https://bun.sh/install | bash`).
