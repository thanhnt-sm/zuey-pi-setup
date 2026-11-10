# IO-Mapping Integration Checklist

> **Scope:** Checklist applies to every input mode (`--brd`, `--urd`, `--contract`, `--process-map`, `--screen`, `--meeting-post`).
> **Authority:** `references/io-mapping-protocol.md` (§1, §3, §8)
> **Handler Entry Point:** `.claude/skills/pm-ba/scripts/handler-input-mode.cjs`

When an input mode is invoked with a file path, the **6-step protocol** below must execute in strict order. The `handler-input-mode.cjs` script automates steps 1–3 and 6; Claude orchestrator handles steps 4–5 via subagent + AskUserQuestion.

---

## Step 1 — Compute Input Hash

```bash
node .claude/skills/pm-ba/scripts/normalize-hash.cjs <input-path>
```

**Purpose:** Establish input identity and detect changes.

**Normalization rules (before hash):**
- Strip UTF-8 BOM if present
- Convert all line endings to LF (`\r\n` → `\n`)
- Strip Unicode line/paragraph separators (`U+2028`, `U+2029`)
- Trim trailing whitespace on each line
- Remove trailing whitespace at EOF

**Hash algorithm:** SHA-256 (uppercase hex output)

**Invariant:** Same input file (after normalization) always produces identical hash. Used to detect:
- NEW mapping (no prior hash recorded)
- IDEMPOTENT state (hash matches LOCKED version → skip work)
- STALE_INPUT state (hash differs from LOCKED version → ask user)

---

## Step 2 — Lookup Existing Mapping

Read `docs/.pm-ba/io-mapping.json` and search all mappings:

```javascript
const match = ioMapping.mappings.find(m => {
  // Primary: check current version inputs
  const currentVer = m.versions[m.current_version - 1];
  for (const input of (currentVer?.inputs || [])) {
    if (samePath(input.path, normalizedInputPath)) return true;
  }
  // Fallback: check all versions (for migrated/legacy entries)
  for (const v of m.versions) {
    for (const input of (v.inputs || [])) {
      if (samePath(input.path, normalizedInputPath)) return true;
    }
  }
  // Legacy fallback: mapping.input_path (pre-multi-input schema)
  if (m.input_path && samePath(m.input_path, normalizedInputPath)) return true;
  return false;
});
```

**Critical:** Use `path-utils.samePath()` for comparison:
- Normalizes Windows drive letters (e.g., `G:` vs `g:`)
- Resolves mixed slashes (`\` vs `/`)
- Handles Google Drive spaces and URL encoding
- Canonical form: lowercase drive, forward slashes

**Output:** Returns mapping entry if found, else `null`.

---

## Step 3 — Branch on Detected State

`handler-input-mode.cjs` returns `detected_state` ∈ `{NEW, IDEMPOTENT, STALE_INPUT, DRAFT}`. **Exact branching logic:**

### NEW (no existing mapping)

**Condition:** Search from Step 2 returned `null`.

**Handler Output:**
```json
{
  "status": "needs_user_input",
  "detected_state": "NEW",
  "user_prompts": [
    {
      "question": "Allocate new MAP-NNN for input [path]?",
      "header": "IO-Mapping: New Input",
      "options": [
        { "label": "Allocate", "description": "Create new mapping and run analysis" },
        { "label": "Cancel", "description": "Skip this input" }
      ],
      "multiSelect": false
    }
  ]
}
```

**Claude Flow:**
1. Call `AskUserQuestion` with the prompt
2. If "Allocate":
   - Allocate next available `MAP-NNN` ID (auto-increment from `mappings[]` max)
   - Create new mapping entry in `io-mapping.json` with:
     ```json
     {
       "map_id": "MAP-NNN",
       "input_path": "relative/path",
       "current_version": 1,
       "versions": [
         {
           "v": 1,
           "input_hash_sha256": "<hash from Step 1>",
           "mode": "<mode flag>",
           "outputs": [],
           "status": "DRAFT",
           "locked_at": null,
           "locked_by": null,
           "lock_notes": null,
           "supersedes_version": null,
           "consistency_check_report": null
         }
       ],
       "downstream_dependencies": []
     }
     ```
   - Spawn analysis subagent (researcher / docs-manager per mode spec)
   - Subagent writes outputs (e.g., `docs/ba-brd-analysis.md`)
   - Proceed to Step 4
3. If "Cancel":
   - Exit 0, no state changes
   - No audit log entry

---

### IDEMPOTENT (LOCKED + hash matches)

**Condition:**
- Mapping found from Step 2
- `current_version` is LOCKED
- Input hash (Step 1) matches `versions[current_version-1].input_hash_sha256`

**Handler Output:**
```json
{
  "status": "no_work_needed",
  "detected_state": "IDEMPOTENT",
  "actions": []
}
```

**Claude Flow:**
- No user prompt
- No subagent spawn
- Exit 0
- **No audit entry** (state unchanged)

**Rationale:** Input is identical and output is already reviewed/locked. Regenerating would waste effort.

---

### STALE_INPUT (LOCKED + hash differs)

**Condition:**
- Mapping found from Step 2
- `current_version` is LOCKED
- Input hash (Step 1) **differs from** `versions[current_version-1].input_hash_sha256`

**Handler Output:**
```json
{
  "status": "needs_user_input",
  "detected_state": "STALE_INPUT",
  "user_prompts": [
    {
      "question": "Input file changed since last lock [MAP-NNN].\n\nOld hash: <old>\nNew hash: <new>\n\nAction?",
      "header": "IO-Mapping: Stale Input",
      "options": [
        { "label": "View diff", "description": "Show what changed in input" },
        { "label": "Keep lock", "description": "Accept change, keep output as-is" },
        { "label": "Regenerate", "description": "Re-run analysis with new input" }
      ],
      "multiSelect": false
    }
  ]
}
```

**Claude Flow:**

**Option 1: View diff**
- Use `git diff` or `diff` command to compare old vs new input (if version control available)
- Or show character-level diff via side-by-side markdown
- Render in browser via `/ck:preview --diff` if helpful
- Re-prompt user with same 3-option menu

**Option 2: Keep lock**
- Acknowledge input change without regenerating output
- Set mapping flag: `input_accepted_as_is = true` (or add to version metadata)
- Audit: `STALE_INPUT_ACCEPTED` with note: "User reviewed diff and accepted output unchanged"
- Exit 0

**Option 3: Regenerate**
- Proceed to Step 4 (subagent regenerates analysis)
- Audit: `STALE_INPUT_REGENERATE_REQUESTED`

---

### DRAFT / PENDING_REVIEW (existing mapping, not locked)

**Condition:**
- Mapping found from Step 2
- `current_version` status is `DRAFT` or `PENDING_REVIEW`

**Handler Output:**
```json
{
  "status": "ready_to_proceed",
  "detected_state": "DRAFT",
  "actions": [
    {
      "type": "proceed_with_regen",
      "map_id": "MAP-NNN",
      "expected_outputs": ["docs/ba-brd-analysis.md", "docs/pm-traceability-matrix.md"]
    }
  ]
}
```

**Claude Flow:**
- No user prompt
- Spawn analysis subagent directly
- Subagent writes outputs per mode spec
- Proceed to Step 4

---

## Step 4 — Post-Write Audit

After each output write (whether NEW, regen, or direct):

```javascript
appendAudit(auditPath, {
  actor: 'script',
  event_type: newVersionCreated ? 'CREATE' : 'UPDATE',
  map_id: mapping.map_id,
  version: newVersion.version_id,
  timestamp: new Date().toISOString(),
  details: {
    mode,
    input_basename: path.basename(inputPath),
    outputs_count: newVersion.outputs.length
  }
});
```

**Audit file location:** `docs/.pm-ba/audit.log`

**Format:** JSON Lines (one JSON object per line)

**Kept forever:** Audit entries are immutable. Used for full traceability and debugging.

---

## Step 5 — Snapshot Before Mutation

Before mutating `io-mapping.json` (Steps 3–6):

```javascript
snapshotAndRotate(ioMappingPath, `${mode}-${mapId || 'new'}`);
```

**Creates:**
- Snapshot file: `docs/.pm-ba/snapshots/io-mapping-{mode}-{mapId}-{YYMMDD-HHMM}.json.bak`
- Metadata log: `docs/.pm-ba/snapshots/_manifest.json` (tracks all snapshots with hash, size, reason)

**Rotation policy:**
- Keep max `config.io_mapping.max_snapshots` (default 5 per mode-mapId pair)
- Prune oldest when limit exceeded

**Use case:** If io-mapping.json corrupts, restore from most recent snapshot.

---

## Step 6 — Version Increment & LOCK Confirm

After outputs are written, manage versions atomically:

### NEW Mapping (from Step 3)

1. Mapping was created with `versions[0]` status `DRAFT`
2. After subagent finishes writing outputs:
   - Update `versions[0].outputs` with final file paths and hashes
   - Update `versions[0].status` to `PENDING_REVIEW`
3. Trigger LOCK confirmation prompt:
   ```json
   {
     "question": "Confirm lock outputs for [MAP-NNN]?\n\nFiles:\n  ✓ docs/ba-brd-analysis.md\n  ✓ docs/pm-traceability-matrix.md",
     "header": "IO-Mapping: Lock Outputs",
     "options": [
       { "label": "Confirm & Lock", "description": "Protect outputs with hook; mark LOCKED" },
       { "label": "Reject", "description": "Keep DRAFT; regenerate later" }
     ],
     "multiSelect": false
   }
   ```
4. On confirm:
   - Set `versions[0].status = LOCKED`
   - Set `versions[0].locked_at = ISO-8601 timestamp`
   - Set `versions[0].locked_by = "human"`
   - Audit: `LOCK` event
5. On reject:
   - Status remains `DRAFT`
   - No audit entry
   - Subagent may be re-run later

### Existing Mapping (DRAFT regen from Step 3)

1. Before subagent runs, allocate new version ID:
   ```javascript
   const newV = mapping.current_version + 1;
   const newVersion = {
     v: newV,
     input_hash_sha256: "<from Step 1>",
     mode,
     outputs: [],
     status: "DRAFT",
     locked_at: null,
     locked_by: null,
     lock_notes: null,
     supersedes_version: mapping.current_version,
     consistency_check_report: null
   };
   mapping.versions.push(newVersion);
   mapping.current_version = newV;
   ```
2. Subagent runs analysis, writes outputs
3. After outputs written:
   - Populate `versions[newV-1].outputs` with file paths and hashes
   - Set `versions[newV-1].status = PENDING_REVIEW`
4. Trigger LOCK confirmation (same as NEW path)
5. On confirm:
   - Set `versions[newV-1].status = LOCKED`
   - Set `versions[newV-1].supersedes_version = newV - 1` (auto-filled from allocation step)
   - Mark old version as `SUPERSEDED`: `versions[oldV-1].status = SUPERSEDED`
   - Audit: `SUPERSEDE` + `LOCK` events (two separate entries)

---

## Common Integration Errors

| Error | Cause | Recovery | Notes |
|-------|-------|----------|-------|
| `CrossDriveError` | Input path on different drive than `config.input_root` | Move input to correct drive, or update `config.input_root` | Rare on macOS; common on Windows multi-drive setups |
| `LockTimeoutError` | Concurrent writer holding file lock > 5s | Retry; check for hung process via `lsof` (macOS) or `handle` (Windows) | Indicates resource contention |
| `HashMismatchAfterWrite` | Output file content changes between write and hash verification | Retry write; check for antivirus/indexer interference | Indicates filesystem issue |
| `StaleInputError` | `--accept` called on STALE_INPUT mapping without regen | Run `ck:pm-ba --accept --force` or regenerate first | User must explicitly resolve stale state |
| `SchemaValidationFailed` | Hand-edited io-mapping.json with incorrect shape | Run `node io-mapping-validator.cjs --fix` | Auto-repair fixes common issues |
| `SnapshotRotationFailed` | Filesystem permission or space issue during snapshot | Check disk space, permissions on `docs/.pm-ba/snapshots/` | Blocks mutation; must resolve before proceeding |

---

## Example: Handler-Input-Mode Integration

Complete flow for `--brd` mode (representative of all input modes):

```javascript
// Step 1: Handler script runs
const { stdout, exitCode } = await sh(
  'node .claude/skills/pm-ba/scripts/handler-input-mode.cjs --mode brd --input ' + brdPath
);
const result = JSON.parse(stdout);

if (exitCode !== 0) {
  console.error('Handler failed:', result.error);
  // Render error, suggest recovery
  return;
}

// Step 2 & 3: Branching on detected_state
if (result.status === 'needs_user_input') {
  // NEW or STALE_INPUT: ask user
  for (const prompt of result.user_prompts) {
    const answer = await AskUserQuestion(prompt);
    
    if (result.detected_state === 'NEW' && answer === 'Allocate') {
      // Spawn BRD analysis subagent
      // Subagent will handle Steps 4–6 internally
      await spawnSubagent('researcher', {
        task: 'Analyze BRD for MAP-NNN',
        input_path: brdPath,
        output_files: ['docs/ba-brd-analysis.md', 'docs/pm-traceability-matrix.md'],
        mode: 'brd'
      });
      // After subagent returns, handler automatically:
      // - Appends audit (Step 4)
      // - Creates snapshot (Step 5)
      // - Updates version and prompts LOCK confirm (Step 6)
      
    } else if (result.detected_state === 'STALE_INPUT' && answer === 'Regenerate') {
      // Similar spawn to NEW path
      await spawnSubagent('researcher', { ... });
      
    } else if (answer === 'View diff' || answer === 'Keep lock') {
      // Handle diff view or keep-lock confirmation
      // Re-prompt or finalize
    }
  }
  
} else if (result.detected_state === 'IDEMPOTENT') {
  // No work
  console.log('Input unchanged, outputs already LOCKED');
  
} else if (result.detected_state === 'DRAFT') {
  // Direct regen without user prompt
  await spawnSubagent('researcher', { ... });
}
```

---

## Cross-References

| Document | Purpose |
|----------|---------|
| `references/io-mapping-protocol.md` | Full spec: schema, state machine, §8 enforcement |
| `.claude/pm-ba.config.json` | Canonical paths (`input_root`, `output_root`, `human_export_root`) |
| `.claude/skills/pm-ba/SKILL.md` | All modes, invariants (Invariant 20: two-tier LOCK enforcement) |
| `.claude/hooks/pre-write-io-mapping-check.cjs` | Hook implementation; blocks writes to LOCKED outputs |
| `references/document-ingest-protocol.md` | Tier 1–4 document reading strategy |
| `references/artifact-naming.md` | Output file naming conventions |
| Input mode docs | `02-mode-brd-analysis.md`, `03-mode-urd-analysis.md`, `38-mode-contract.md`, `24-mode-process-map.md`, `04-mode-screen-spec.md`, `09-mode-meeting.md` |

## Update Triggers

Update this checklist when:
- Handler script adds new state or transition
- Audit log format changes
- Snapshot rotation policy updates
- LOCK confirmation UI/UX changes
- New input mode added (still follows 6-step protocol)

---

**Version:** 1.0  
**Last Updated:** 2026-05-19  
**Status:** Active
