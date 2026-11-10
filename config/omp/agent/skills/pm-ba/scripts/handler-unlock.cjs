#!/usr/bin/env node
'use strict';
/**
 * handler-unlock.cjs — PM-BA `--unlock` mode handler.
 *
 * Transitions a LOCKED mapping → DRAFT (target) and cascades LOCKED
 * downstream mappings → STALE_INPUT.
 *
 * State-transition spec (Phase 4 correction vs v1.7.0):
 *   LOCKED (target)     --UNLOCK_SELF-->   DRAFT       (NOT STALE_INPUT)
 *   LOCKED (downstream) --UNLOCK_CASCADE-> STALE_INPUT (via cascade walk)
 *
 * Cascade discovery:
 *   1. Primary:  mapping.downstream_dependencies[] (explicit field in schema)
 *   2. Fallback: scan all mappings whose inputs[].path matches any of
 *                target's outputs[].path (path-matching — used when
 *                downstream_dependencies is empty or absent)
 *
 * Schema note (inspected 2026-05-19):
 *   - Field used: "downstream_dependencies" (array, currently all [])
 *   - No "blocks" or "blockedBy" fields present in schema v1
 *   - Fallback to output→input path matching is active for current data set
 *
 * CLI: node handler-unlock.cjs --map MAP-NNN [--reason TEXT]
 *                               [--cascade | --no-cascade] [--dry-run]
 *      node handler-unlock.cjs --help
 *
 * Exit codes: 0=ok  1=error
 */

const fs   = require('fs');
const path = require('path');

const { atomicWrite, atomicReadModifyWrite } = require('./atomic-fs.cjs');
const { snapshotAndRotate }                  = require('./snapshot-rotator.cjs');
const { appendAudit }                        = require('./audit-log.cjs');
const { samePath, normalizePath }            = require('./path-utils.cjs');

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_CASCADE_DEPTH = 10;
const HANDLER_NAME      = 'unlock';

// ── Config loader ─────────────────────────────────────────────────────────────

/**
 * Load pm-ba.config.json. Searches up from script dir and CWD.
 * @returns {{ projectRoot: string, ioMappingPath: string, configPath: string, auditLogPath: string, raw: object }}
 */
function loadConfig() {
  const candidates = [];

  // Relative to this script: scripts → pm-ba → skills → .claude
  candidates.push(path.resolve(__dirname, '../../../pm-ba.config.json'));

  // Walk up from CWD
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, '.claude', 'pm-ba.config.json'));
    candidates.push(path.join(dir, 'pm-ba.config.json'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const c of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(c, 'utf8'));
      const projectRoot   = raw.project_root || path.dirname(c);
      const storePath     = (raw.io_mapping && raw.io_mapping.store_path) || 'docs/.pm-ba/io-mapping.json';
      const auditLogPath  = (raw.io_mapping && raw.io_mapping.audit_log_path) || 'docs/.pm-ba/audit.log';
      return {
        projectRoot,
        configPath:    c,
        ioMappingPath: path.isAbsolute(storePath) ? storePath : path.resolve(projectRoot, storePath),
        auditLogPath:  path.isAbsolute(auditLogPath) ? auditLogPath : path.resolve(projectRoot, auditLogPath),
        raw,
      };
    } catch (_) { /* try next candidate */ }
  }

  throw new Error('[handler-unlock] pm-ba.config.json not found in any candidate path.');
}

// ── Arg parser ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ mapId: string, reason: string, cascade: boolean, dryRun: boolean }} Args
 */

/** Print usage and exit. */
function printHelp() {
  process.stdout.write([
    'Usage: node handler-unlock.cjs --map MAP-NNN [OPTIONS]',
    '',
    'Options:',
    '  --map MAP-NNN     REQUIRED. Mapping ID to unlock (e.g. MAP-001)',
    '  --reason TEXT     Why unlocking. Default: "manual unlock"',
    '  --cascade         Walk downstream mappings and mark STALE_INPUT (default)',
    '  --no-cascade      Skip downstream propagation',
    '  --dry-run         Show planned actions without mutating any files',
    '  --help            Show this message',
    '',
    'Exit codes: 0=ok  1=error',
  ].join('\n') + '\n');
  process.exit(0);
}

/**
 * Parse process.argv and return structured args.
 * @returns {Args}
 */
function parseArgs() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) printHelp();

  const mapIdx = argv.indexOf('--map');
  if (mapIdx === -1 || !argv[mapIdx + 1]) {
    exitError('Missing required argument: --map MAP-NNN\nRun with --help for usage.');
  }
  const mapId = argv[mapIdx + 1].trim().toUpperCase();
  if (!/^MAP-\d+$/.test(mapId)) {
    exitError(`Invalid map ID format: "${mapId}". Expected MAP-NNN (e.g. MAP-001).`);
  }

  const reasonIdx = argv.indexOf('--reason');
  const reason = (reasonIdx !== -1 && argv[reasonIdx + 1]) ? argv[reasonIdx + 1] : 'manual unlock';

  const noCascade = argv.includes('--no-cascade');
  const cascade   = !noCascade; // default: cascade enabled

  const dryRun = argv.includes('--dry-run');

  return { mapId, reason, cascade, dryRun };
}

// ── Error helpers ─────────────────────────────────────────────────────────────

/**
 * Build an error-status JSON result and exit 1.
 * @param {string} message
 * @param {object} [partial]  Partial result to merge (e.g. partial actions list)
 */
function exitError(message, partial = {}) {
  const result = Object.assign({
    handler: HANDLER_NAME,
    status:  'error',
    actions: [],
    user_prompts: [],
    reports: [],
    errors: [message],
  }, partial);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(1);
}

// ── Cascade discovery (BFS) ───────────────────────────────────────────────────

/**
 * Discover downstream mapping IDs using BFS.
 *
 * Strategy (in order):
 *   1. Use mapping.downstream_dependencies[] if non-empty.
 *   2. Fallback: scan mappings whose any input path matches any output path
 *      of the current mapping (path-suffix matching, case-insensitive on
 *      Windows). This handles the current schema where downstream_dependencies
 *      is always [].
 *
 * @param {object[]} mappings       Full mappings array from io-mapping.json
 * @param {string}   targetMapId    Starting map_id
 * @returns {string[]}              Ordered list of cascade map_ids (excl. target)
 */
function buildCascadeList(mappings, targetMapId) {
  const visited  = new Set([targetMapId]);
  const cascade  = [];
  const queue    = [targetMapId];
  let   depth    = 0;

  // Build index: map_id → mapping object
  const byId = {};
  for (const m of mappings) byId[m.map_id] = m;

  // Build path-matching index: normalised output path → map_id[]
  // Key: lowercase forward-slash normalised path
  const outputPathIndex = {};
  for (const m of mappings) {
    const cv = m.versions && m.versions.find(v => v.v === m.current_version);
    if (!cv || !cv.outputs) continue;
    for (const out of cv.outputs) {
      const norm = normalizePath(out.path);
      if (!outputPathIndex[norm]) outputPathIndex[norm] = [];
      outputPathIndex[norm].push(m.map_id);
    }
  }

  while (queue.length && depth < MAX_CASCADE_DEPTH) {
    const next = [];

    for (const id of queue) {
      const m = byId[id];
      if (!m) continue;

      let downstreamIds = [];

      // Strategy 1: explicit downstream_dependencies field
      if (Array.isArray(m.downstream_dependencies) && m.downstream_dependencies.length > 0) {
        downstreamIds = m.downstream_dependencies.filter(d => !visited.has(d));
      } else {
        // Strategy 2: output→input path matching fallback.
        // Find the current version's output paths, then find mappings whose
        // current_version inputs include any matching path.
        const cv = m.versions && m.versions.find(v => v.v === m.current_version);
        if (cv && cv.outputs) {
          const myOutputPaths = cv.outputs.map(o => o.path);

          for (const candidate of mappings) {
            if (visited.has(candidate.map_id)) continue;
            const ccv = candidate.versions && candidate.versions.find(v => v.v === candidate.current_version);
            if (!ccv) continue;

            const candidateInput = candidate.input_path || '';
            if (!candidateInput || candidateInput === 'ORPHAN') {
              continue;
            }
            const inputMatchesOutput = myOutputPaths.some(op => samePath(candidateInput, op));

            if (inputMatchesOutput) {
              downstreamIds.push(candidate.map_id);
            }
          }
        }
      }

      for (const d of downstreamIds) {
        if (!visited.has(d)) {
          visited.add(d);
          cascade.push(d);
          next.push(d);
        }
      }
    }

    queue.length = 0;
    queue.push(...next);
    depth++;
  }

  return cascade;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const { mapId, reason, cascade, dryRun } = args;

  // ── 1. Load config + io-mapping ────────────────────────────────────────────
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    exitError(e.message);
  }

  if (!fs.existsSync(cfg.ioMappingPath)) {
    exitError(`io-mapping.json not found at: ${cfg.ioMappingPath}`);
  }

  let ioMapping;
  try {
    ioMapping = JSON.parse(fs.readFileSync(cfg.ioMappingPath, 'utf8'));
  } catch (e) {
    exitError(`Failed to parse io-mapping.json: ${e.message}`);
  }

  // ── 2. Find target mapping ──────────────────────────────────────────────────
  const targetMapping = (ioMapping.mappings || []).find(m => m.map_id === mapId);
  if (!targetMapping) {
    exitError(`Mapping "${mapId}" not found in io-mapping.json.`);
  }

  // ── 3. Validate current_version status ─────────────────────────────────────
  const targetVersion = targetMapping.versions &&
    targetMapping.versions.find(v => v.v === targetMapping.current_version);

  if (!targetVersion) {
    exitError(`Mapping "${mapId}" has no current_version entry (v=${targetMapping.current_version}).`);
  }

  if (targetVersion.status === 'DRAFT') {
    exitError(`Mapping "${mapId}" is already in DRAFT status — nothing to unlock.`);
  }
  if (targetVersion.status !== 'LOCKED') {
    exitError(
      `Mapping "${mapId}" has status "${targetVersion.status}". ` +
      `Only LOCKED mappings can be unlocked.`
    );
  }

  // ── 4. Build cascade list ───────────────────────────────────────────────────
  const cascadeIds = cascade ? buildCascadeList(ioMapping.mappings || [], mapId) : [];

  // Filter cascade to only LOCKED mappings (no-op for non-LOCKED)
  const lockedCascadeIds = cascadeIds.filter(id => {
    const m = (ioMapping.mappings || []).find(x => x.map_id === id);
    if (!m) return false;
    const cv = m.versions && m.versions.find(v => v.v === m.current_version);
    return cv && cv.status === 'LOCKED';
  });

  // ── 5. Build planned actions ────────────────────────────────────────────────
  const actions = [];

  actions.push({
    type:        'unlock_self',
    map_id:      mapId,
    from_status: 'LOCKED',
    to_status:   'DRAFT',
    reason,
  });

  for (const id of lockedCascadeIds) {
    actions.push({
      type:        'unlock_cascade',
      map_id:      id,
      from_status: 'LOCKED',
      to_status:   'STALE_INPUT',
    });
  }

  actions.push({
    type:  'bypass_set',
    scope: 'per-invocation',
  });

  // ── 6. Dry-run: print and exit without mutation ─────────────────────────────
  if (dryRun) {
    const result = {
      handler:      HANDLER_NAME,
      status:       'completed',
      dry_run:      true,
      actions,
      user_prompts: [],
      reports:      [],
      errors:       [],
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  }

  // ── 7. Snapshot before mutation ─────────────────────────────────────────────
  const snapshotReason = `pre-unlock-${mapId}`;
  let snapshotPath = null;
  try {
    const snap = snapshotAndRotate(cfg.ioMappingPath, snapshotReason);
    snapshotPath = snap.snapshotPath;
  } catch (e) {
    // Non-fatal: log warning but continue. Snapshot failure should not block unlock.
    process.stderr.write(`[handler-unlock] WARNING: snapshot failed: ${e.message}\n`);
  }

  // ── 8. Mutate io-mapping atomically ─────────────────────────────────────────
  const now = new Date().toISOString();

  try {
    await atomicReadModifyWrite(cfg.ioMappingPath, (current) => {
      const data = JSON.parse(current);

      for (const m of data.mappings) {
        if (m.map_id === mapId) {
          // Target: LOCKED → DRAFT
          const cv = m.versions.find(v => v.v === m.current_version);
          if (cv) {
            cv.status        = 'DRAFT';
            cv.unlocked_at   = now;
            cv.unlocked_by   = 'human';
            cv.unlock_reason = reason;
          }
          continue;
        }

        if (lockedCascadeIds.includes(m.map_id)) {
          // Cascade: LOCKED → STALE_INPUT
          const cv = m.versions.find(v => v.v === m.current_version);
          if (cv && cv.status === 'LOCKED') {
            cv.status            = 'STALE_INPUT';
            cv.stale_detected_at = now;
            cv.stale_reason      = `cascade from unlock of ${mapId}`;
          }
        }
      }

      return JSON.stringify(data, null, 2);
    });
  } catch (e) {
    exitError(`Failed to mutate io-mapping.json: ${e.message}`, { actions: [] });
  }

  // ── 9. Set bypass_io_lock flag in config ─────────────────────────────────────
  // Per-invocation scope. Cleared by the session-start hook (Phase 5 handler).
  // This flag allows subsequent write operations in the same invocation chain
  // to bypass LOCKED checks when the unlock was intentional.
  try {
    await atomicReadModifyWrite(cfg.configPath, (current) => {
      const data = JSON.parse(current || '{}');
      data.bypass_io_lock = true;
      return JSON.stringify(data, null, 2);
    });
  } catch (e) {
    // Non-fatal: warn but do not fail the unlock. The main mutation succeeded.
    process.stderr.write(`[handler-unlock] WARNING: bypass_io_lock flag not set: ${e.message}\n`);
  }

  // ── 10. Audit log ────────────────────────────────────────────────────────────
  try {
    appendAudit(cfg.auditLogPath, {
      actor:      'script',
      event_type: 'UNLOCK',
      map_id:     mapId,
      version:    targetMapping.current_version,
      details:    `self: LOCKED→DRAFT, reason="${reason}"`,
    });
  } catch (e) {
    process.stderr.write(`[handler-unlock] WARNING: audit UNLOCK failed: ${e.message}\n`);
  }

  for (const cascadeId of lockedCascadeIds) {
    const cm = (ioMapping.mappings || []).find(x => x.map_id === cascadeId);
    const cv = cm && cm.versions && cm.versions.find(v => v.v === cm.current_version);
    try {
      appendAudit(cfg.auditLogPath, {
        actor:      'script',
        event_type: 'STALE_INPUT_DETECTED',
        map_id:     cascadeId,
        version:    cm ? cm.current_version : null,
        details:    `cascade from unlock of ${mapId}`,
      });
    } catch (e) {
      process.stderr.write(`[handler-unlock] WARNING: audit cascade (${cascadeId}) failed: ${e.message}\n`);
    }
  }

  // ── 11. Output JSON result ───────────────────────────────────────────────────
  const reports = [];
  if (snapshotPath) {
    reports.push({ type: 'snapshot', path: snapshotPath });
  }

  const result = {
    handler:      HANDLER_NAME,
    status:       'completed',
    actions,
    user_prompts: [],
    reports,
    errors:       [],
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

// ── Entry point ───────────────────────────────────────────────────────────────

main().catch((e) => {
  exitError(`Unhandled error: ${e.message}`);
});
