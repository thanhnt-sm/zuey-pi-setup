# Mode: --io-status (Inspection #65)

## Trigger

Flag: `--io-status` [optional: `--map MAP-NNN`]

Natural language (VN): "kiểm tra trạng thái io-mapping", "xem mapping nào lock", "trạng thái mappings", "io-mapping status"

Natural language (EN): "io-status", "check mapping state", "what's locked?"

---

## Purpose

**READ-ONLY inspection** of all (or single) io-mapping entries. No side effects — safe to run repeatedly.

Used for:
- **Status dashboards**: See which outputs are LOCKED (stable) vs DRAFT (updating)
- **Drift detection**: Transient detection of hash mismatch between stored and current file (informational only)
- **Pre-flight checks**: Before bulk operations like `--accept --all` or `--full`
- **Audit trails**: Verify when outputs were locked, by whom, and how many versions exist

---

## Input Parameters

| Flag | Default | Type | Description |
|------|---------|------|-------------|
| `--map MAP-NNN` | (all) | string | Filter to single mapping (e.g., `--map MAP-001`) |
| `--format` | `table` | `table\|json` | Output format |
| `--detect-stale` | off | flag | Recompute hashes; report transient STALE flags (slow) |

---

## Output: Table Format (Default)

```
MAP-ID    Mode         Status   Ver  Locked At              Age   Outputs  Stale
--------  -----------  -------  ---  ---------------------  ----  -------  ------
MAP-001   migration    LOCKED   1    2026-05-19T09:11:43Z   0d    1        .
MAP-002   migration    LOCKED   2    2026-05-19T17:05:00Z   0d    1        .
MAP-003   migration    DRAFT    1    —                      —     1        !
...
Total: 19 mappings — LOCKED=18 DRAFT=1
```

**Columns:**
- **MAP-ID**: Unique mapping identifier
- **Mode**: Analysis mode that created this mapping (migration, brd, urd, contract, etc.)
- **Status**: Current version's status (LOCKED / DRAFT / PENDING_REVIEW)
- **Ver**: Version counter of current entry
- **Locked At**: ISO 8601 timestamp from `locked_at` field (or creation time if not locked)
- **Age**: Days since locked/created
- **Outputs**: Count of output files in current version
- **Stale**: `.` = clean, `!` = stale (only with `--detect-stale`, expensive operation)

---

## Output: JSON Format

When `--format json` is specified:

```json
{
  "handler": "io-status",
  "exit_code": 0,
  "total": 19,
  "by_status": {
    "LOCKED": 18,
    "DRAFT": 1,
    "PENDING_REVIEW": 0
  },
  "by_mode": {
    "migration": 19
  },
  "mappings": [
    {
      "map_id": "MAP-001",
      "mode": "migration",
      "current_version": 1,
      "status": "LOCKED",
      "locked_at": "2026-05-19T09:11:43Z",
      "locked_by": "human",
      "age_days": 0,
      "outputs_count": 1,
      "outputs": ["docs/ba-traceability-migration.md"],
      "stale_input": false,
      "stale_output": false
    }
  ],
  "errors": []
}
```

---

## Side Effects

**ABSOLUTELY NONE.** This mode is strictly read-only:
- Does NOT modify `io-mapping.json`
- Does NOT append to audit logs
- Does NOT create snapshots or versions
- Does NOT update state files

Implementation enforces this: `handler-io-status.cjs` imports ONLY read-only modules (`fs.readFileSync`, JSON parsing). No `atomic-fs` or `audit-log` imports.

---

## Exit Codes

| Code | Meaning | Notes |
|------|---------|-------|
| 0 | Success | Status report generated and printed |
| 1 | Error | io-mapping.json missing, malformed, or `--map MAP-NNN` not found |

---

## Examples

### Example 1: Show All Mappings (Table)

```bash
ck:pm-ba --io-status
```

Output: Table showing all mappings with lock status.

### Example 2: Single Mapping as JSON

```bash
ck:pm-ba --io-status --map MAP-001 --format json
```

Output: Single entry as JSON for programmatic consumption.

### Example 3: Detect Transient Drift (Slow)

```bash
ck:pm-ba --io-status --detect-stale
```

Output: Table with `Stale` column populated. Recomputes SHA-256 hashes of all input and output files—expensive operation. Flags are transient (not persisted).

### Example 4: Filter via jq

```bash
ck:pm-ba --io-status --format json | \
  jq '.mappings[] | select(.status == "LOCKED") | .map_id'
```

Output: List of all LOCKED map IDs.

---

## Recommended Workflows

### Before Accepting Human Edits
```bash
# 1. Check for stale outputs
ck:pm-ba --io-status --detect-stale

# 2. Process stale outputs
ck:pm-ba --accept --all

# 3. Verify all clean
ck:pm-ba --io-status
```

### Integration with CI/CD
```bash
# Fail pipeline if mappings have drifted
if ck:pm-ba --io-status --detect-stale | grep -q '!'; then
  exit 1
fi
```

### Dashboard / Monitoring
```bash
# Export status as JSON for display in external tools
ck:pm-ba --io-status --format json > pm-ba-status.json
```

---

## Cross-References

| Reference | Purpose |
|-----------|---------|
| `references/io-mapping-protocol.md` §3 | State machine; mode #65 entry |
| `references/io-mapping-protocol.md` §8 | Full handler specs |
| `.claude/skills/pm-ba/scripts/handler-io-status.cjs` | Implementation |
| `SKILL.md` changelog | v1.8.0+ — when mode added |

---

## Relationship to Other Modes

- **Pairs with `--unlock`**: Use `--io-status` to identify which mapping to unlock
- **Pairs with `--accept`**: Run `--io-status --detect-stale` before `--accept` to find drift
- **Pairs with input modes** (`--brd`, `--urd`, etc.): Run `--io-status` before batch operations to understand baseline
- **Inverse of mutating modes**: While `--unlock`, `--accept`, input modes change state, `--io-status` only reports
