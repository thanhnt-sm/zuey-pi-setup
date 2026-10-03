---
phase: 1
title: "Baseline Synthesis & Documentation Reconciliation"
status: pending
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Baseline Synthesis & Documentation Reconciliation

## Overview
Synthesize all architecture documentation, reconcile discrepancies between legacy Pi docs and OMP implementation, and establish an automated TDD parity test verifying that documentation matches codebase ground truth.

## Requirements
- Functional:
  - Consolidate feature matrix comparing Pi upstream (`zuey-pi`) and OMP downstream (`omp`) across HookAPI, ExtensionAPI, Model routing, and Plugin subsystems.
  - Update root `README.md` and `README.vi.md` to document the OMP setup, synchronization engine, and portable backup tools.
  - Create `docs/omp-architecture-matrix.md` with explicit component boundaries.
- Non-functional:
  - TDD tests must run deterministically offline without network access.
  - Maintain strict zero-secret leakage rules across all docs and example configs.

## Architecture
```
Documentation Sources:
├── docs/omp-setup-migration.md      (Backup/restore guide)
├── docs/pi-setup-migration.md       (Legacy Pi reference)
├── OMP_UPSTREAM_SYNC_PLAN.md        (Sync engine specification)
└── OMP_SYNC_REDTEAM_PLAN.md         (Red team vulnerability audit)
         │
         ▼ (Consolidation & Verification)
├── docs/omp-architecture-matrix.md   (Authoritative parity reference)
├── README.md / README.vi.md         (Public documentation)
└── tests/test-doc-parity.sh         (TDD automated parity test)
```

## Related Code Files
- Create: `docs/omp-architecture-matrix.md`
- Create: `tests/test-doc-parity.sh`
- Modify: `README.md`
- Modify: `README.vi.md`
- Modify: `docs/omp-setup-migration.md`

## Implementation Steps
1. **3.1.T (TDD Tests First)**:
   - Create `tests/test-doc-parity.sh`.
   - Assert all script references in `README.md` and `docs/omp-setup-migration.md` point to existing, executable files in `scripts/`.
   - Assert all blocklist entries in `config/omp/.omp-syncignore` match verified conflicting plugins (`pi-advisor-flow`, `pi-model-fallback`, `pi-lens`).
   - Assert `.env.example` contains necessary placeholders (`TYPESAFE_API_KEY`, `ZAI_API_KEY`) with zero unmasked secrets.
2. **3.1.I (Implementation)**:
   - Author `docs/omp-architecture-matrix.md` documenting component boundaries:
     - HookAPI vs ExtensionAPI wrapping in OMP.
     - Centralized `@oh-my-pi/pi-ai` model registry vs Pi inline inference providers.
     - Statusline architecture (3-row `pi-footer` + `orca` titlebar/spinner).
   - Update `README.md` and `README.vi.md` to prominently introduce OMP integration and sync commands.
3. **3.1.V (Verification)**:
   - Run `bash tests/test-doc-parity.sh` (Expect: 100% PASS).

## Success Criteria
- [ ] `tests/test-doc-parity.sh` passes cleanly with exit code 0.
- [ ] `docs/omp-architecture-matrix.md` is complete and cross-referenced in `README.md`.
- [ ] Zero broken links or phantom script references across all markdown files.

## Risk Assessment
- **Risk**: Documentation drift between Vietnamese and English READMEs.
  - *Mitigation*: Run automated line and heading parity checks in `test-doc-parity.sh`.
- **Risk**: Secret leakage in example code snippets.
  - *Mitigation*: Reuse regex credential scanner from `omp-setup-backup.sh`.
