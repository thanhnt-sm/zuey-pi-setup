---
name: omp-extension-docs-and-oneclick-verify
description: Use when writing/updating documentation or verifying/syncing global installation in omp_extension. Enforces 100% Vietnamese prose with English technical terms in parentheses and runs 6-layer one-click verification.
---

# OMP Extension Vietnamese Docs Standard & One-Click Verification

## 1. Mandatory Documentation Language Rule
- Every markdown document in `omp_extension` (`README.md`, `AGENTS.md`, `docs/*.md`, `docs/decisions/*.md`, `docs/journals/*.md`) MUST be written **100% in Vietnamese** (`100% Vietnamese prose`).
- Immediately follow Vietnamese technical terms with the original English technical term, vocabulary, or concept in parentheses — e.g.:
  - `Đồng thuận Lưỡng viện (Bicameral Consensus)`
  - `Xác thực Nhiệm vụ theo Giai đoạn (Staged Task Verification)`
  - `Đóng băng An toàn khi Lỗi (Fail-Closed)`
  - `Lưới Chính sách Chỉ Thắt chặt (Tighten-Only Policy Lattice)`
  - `Bất biến Vàng (Golden Invariant)`
- Keep code identifiers, file paths, CLI commands, and environment variable names verbatim inside backticks.
- In Mermaid diagrams, wrap any node or edge label containing parentheses `(...)` inside double quotes `"..."` so the Mermaid parser does not fail.
- Keep `README.md` under 300 lines and each `docs/*.md` file under 800 lines.

## 2. One-Click Verification & Transactional Sync Workflow
1. **Fast 6-Layer Read-Only Verification (<5s)**:
   ```bash
   node tools/verify-omp-global.cjs --live
   ```
   Checks:
   - `[1]` Immutable 1-line proxy trampoline at `~/.omp/agent/extensions/typesafe-planner.ts`
   - `[2]` 3-Root SHA-256 `.sync-manifest.json` parity (`target`, `global_claude`, `global_omp_agents`)
   - `[3]` `node tools/sync-baseline.cjs --dry-run` (`0` pending actions)
   - `[4]` In-process `resolveTypeSafeEnabled` and `redactEvidenceState` (`TELEMETRY_COUNT_KEYS`) self-test
   - `[5]` Latest verified backup journal (`omp_extension_backup_<timestamp>/.sync-journal.json`)
   - `[6]` Live TypeSafe System One (`jev-latest`) probe and expected `runtime-origin` SHA-256 digests
2. **Smart One-Click Conditional Sync & Verification**:
   ```bash
   powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File ./tools/oneclick-omp.ps1 -Live
   ```
   Or double-click `tools\oneclick-omp.bat` / `tools\verify-omp-global.bat`.
