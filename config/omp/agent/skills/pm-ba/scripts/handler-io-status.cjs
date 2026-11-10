#!/usr/bin/env node
'use strict';
/**
 * handler-io-status.cjs — --io-status mode handler for PM-BA skill.
 *
 * READ-ONLY status report of all (or single) io-mapping entries.
 * NO side effects: no audit writes, no io-mapping mutations, no snapshots.
 *
 * CLI:
 *   node handler-io-status.cjs [--map MAP-NNN] [--format table|json] [--detect-stale] [--help]
 *
 * Options:
 *   --map MAP-NNN    Filter to single mapping (error on unknown map_id → exit 1)
 *   --format         Output format: 'table' (default) or 'json'
 *   --detect-stale   Recompute file hashes; flag transient stale status in output.
 *                    Flags are NOT persisted — purely informational.
 *
 * Exit codes:
 *   0  success (even if stale entries detected — just informational)
 *   1  error (io-mapping.json missing/corrupt, or unknown --map value)
 *
 * Output:
 *   --format json  → JSON object to stdout (see schema below)
 *   --format table → ASCII table to stdout
 *
 * JSON schema:
 * {
 *   "handler": "io-status",
 *   "status": "completed",
 *   "total": N,
 *   "by_status": { "LOCKED": N, "DRAFT": N, "STALE_INPUT": N, "STALE_OUTPUT": N,
 *                  "PENDING_REVIEW": N, "SUPERSEDED": N },
 *   "by_mode": { "<mode>": N, ... },
 *   "mappings": [
 *     {
 *       "map_id": "MAP-001",
 *       "mode": "migration",
 *       "current_version": 1,
 *       "status": "LOCKED",
 *       "locked_at": "2026-05-19T09:11:43Z",
 *       "age_days": 0,
 *       "outputs_count": 1,
 *       "stale_input": false,
 *       "stale_output": false
 *     }
 *   ],
 *   "errors": []
 * }
 */

const fs   = require('fs');
const path = require('path');

// ── Peer-script imports ───────────────────────────────────────────────────────
// These are used for stale detection only; no write operations.
const { samePath, normalizePath }  = require('./path-utils.cjs');
const { normalizeAndHash }         = require('./normalize-hash.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const HANDLER_NAME = 'io-status';

const USAGE = `Usage: node handler-io-status.cjs [OPTIONS]

Read-only status report of io-mapping entries. No mutations.

Options:
  --map MAP-NNN     Filter to a single mapping ID (e.g. MAP-001)
  --format          Output format: table (default) or json
  --detect-stale    Re-compute hashes; add transient stale flags (not persisted)
  --help            Show this message

Exit codes:
  0  success
  1  error (io-mapping.json missing/corrupt, or unknown --map)
`.trimEnd();

// ─────────────────────────────────────────────────────────────────────────────
// Config loader (read-only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate and parse pm-ba.config.json. Searches from script dir and CWD.
 * @returns {{ projectRoot: string, ioMappingPath: string, configPath: string }}
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
      const raw        = JSON.parse(fs.readFileSync(c, 'utf8'));
      const projectRoot = raw.project_root || path.dirname(c);
      const storePath  = (raw.io_mapping && raw.io_mapping.store_path)
        || 'docs/.pm-ba/io-mapping.json';
      return {
        projectRoot,
        configPath:    c,
        ioMappingPath: path.isAbsolute(storePath)
          ? storePath
          : path.resolve(projectRoot, storePath),
        raw,
      };
    } catch (_) { /* try next */ }
  }

  throw new Error('[handler-io-status] pm-ba.config.json not found in any candidate path.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Arg parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ mapId: string|null, format: 'table'|'json', detectStale: boolean }} Args
 */

/** @returns {Args} */
function parseArgs() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  // --map MAP-NNN
  let mapId = null;
  const mapIdx = argv.indexOf('--map');
  if (mapIdx !== -1) {
    if (!argv[mapIdx + 1]) {
      exitError('--map requires a MAP-NNN argument (e.g. --map MAP-001)');
    }
    mapId = argv[mapIdx + 1].trim().toUpperCase();
    if (!/^MAP-\d+$/.test(mapId)) {
      exitError(`Invalid map ID format: "${mapId}". Expected MAP-NNN (e.g. MAP-001).`);
    }
  }

  // --format
  let format = 'table';
  const fmtIdx = argv.indexOf('--format');
  if (fmtIdx !== -1) {
    const val = (argv[fmtIdx + 1] || '').toLowerCase();
    if (val !== 'table' && val !== 'json') {
      exitError(`Invalid --format value: "${argv[fmtIdx + 1]}". Use 'table' or 'json'.`);
    }
    format = val;
  }

  const detectStale = argv.includes('--detect-stale');

  return { mapId, format, detectStale };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error helpers (read-only — output JSON with errors array then exit 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Output error result and exit 1.
 * @param {string} message
 */
function exitError(message) {
  const result = {
    handler:  HANDLER_NAME,
    status:   'error',
    total:    0,
    by_status: {},
    by_mode:   {},
    mappings:  [],
    errors:    [message],
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Age helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute age in whole days from an ISO timestamp to now.
 * Returns null if timestamp is missing or unparseable.
 * @param {string|null|undefined} isoStr
 * @returns {number|null}
 */
function ageDays(isoStr) {
  if (!isoStr) return null;
  const ts = Date.parse(isoStr);
  if (isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale detection (read-only hash comparison)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a path stored in io-mapping (relative or absolute) against projectRoot.
 * @param {string} storedPath
 * @param {string} projectRoot
 * @returns {string} absolute path
 */
function resolveStoredPath(storedPath, projectRoot) {
  if (path.isAbsolute(storedPath)) return storedPath;
  // Stored path may be relative like "docs/foo.md" — resolve from projectRoot
  return path.resolve(projectRoot, storedPath);
}

/**
 * Check if a stored input hash matches the current file hash.
 * Returns false (not stale) when:
 *  - input_hash_sha256 is "unavailable" (migration entries — skip hash check)
 *  - input_path is "ORPHAN" (no file to compare)
 * Returns true (stale) when hashes differ.
 * Returns false on any IO error (file unreadable → assume not stale, log warning).
 *
 * @param {object} mapping   Top-level mapping object
 * @param {object} version   Current version object
 * @param {string} projectRoot
 * @param {string[]} errors  Mutable array to push warnings into
 * @returns {boolean}
 */
function detectInputStale(mapping, version, projectRoot, errors) {
  const storedHash = version.input_hash_sha256;
  if (!storedHash || storedHash === 'unavailable') return false;
  const inputPath  = mapping.input_path;
  if (!inputPath || inputPath === 'ORPHAN') return false;

  const absPath = resolveStoredPath(inputPath, projectRoot);
  try {
    const currentHash = normalizeAndHash(absPath);
    return currentHash !== storedHash;
  } catch (e) {
    errors.push(`[WARN] stale-input check failed for ${mapping.map_id} input "${absPath}": ${e.message}`);
    return false;
  }
}

/**
 * Check if any output file has changed since the stored hash.
 * Returns true if ANY output hash differs from current file hash.
 * Skips files that cannot be read (log warning, assume not stale).
 *
 * @param {object} version     Current version object (has outputs[])
 * @param {string} projectRoot
 * @param {string[]} errors    Mutable array for warnings
 * @returns {boolean}
 */
function detectOutputStale(version, projectRoot, errors) {
  if (!Array.isArray(version.outputs) || version.outputs.length === 0) return false;

  for (const out of version.outputs) {
    const storedHash = out.hash_sha256;
    if (!storedHash) continue;

    const absPath = resolveStoredPath(out.path, projectRoot);
    try {
      const currentHash = normalizeAndHash(absPath);
      if (currentHash !== storedHash) return true;
    } catch (e) {
      errors.push(`[WARN] stale-output check failed for ${out.path}: ${e.message}`);
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table renderer (no external deps)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ header: string, width: number, key: string, align?: 'left'|'right' }} Column
 */

/**
 * Render an ASCII table to a string.
 * @param {object[]} rows
 * @param {Column[]} columns
 * @returns {string}
 */
function renderTable(rows, columns) {
  const header = columns.map(c => c.header.padEnd(c.width)).join('  ');
  const sep    = columns.map(c => '-'.repeat(c.width)).join('  ');
  const body   = rows.map(r => {
    return columns.map(c => {
      const val = String(r[c.key] != null ? r[c.key] : '');
      return c.align === 'right' ? val.padStart(c.width) : val.padEnd(c.width);
    }).join('  ');
  });
  return [header, sep, ...body].join('\n');
}

/**
 * Build summary footer line.
 * @param {number} total
 * @param {object} byStatus
 * @returns {string}
 */
function renderSummary(total, byStatus) {
  const parts = Object.entries(byStatus)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(', ');
  return `\nTotal: ${total} mapping${total !== 1 ? 's' : ''}${parts ? ' (' + parts + ')' : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs();
  const { mapId, format, detectStale } = args;

  // ── 1. Load config ─────────────────────────────────────────────────────────
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    exitError(e.message);
  }

  // ── 2. Load io-mapping.json (read-only) ────────────────────────────────────
  if (!fs.existsSync(cfg.ioMappingPath)) {
    exitError(`io-mapping.json not found at: ${cfg.ioMappingPath}`);
  }

  let ioMapping;
  try {
    ioMapping = JSON.parse(fs.readFileSync(cfg.ioMappingPath, 'utf8'));
  } catch (e) {
    exitError(`Failed to parse io-mapping.json: ${e.message}`);
  }

  const allMappings = Array.isArray(ioMapping.mappings) ? ioMapping.mappings : [];

  // ── 3. Filter if --map ─────────────────────────────────────────────────────
  let targetMappings;
  if (mapId) {
    const found = allMappings.find(m => m.map_id === mapId);
    if (!found) {
      exitError(`Mapping "${mapId}" not found in io-mapping.json.`);
    }
    targetMappings = [found];
  } else {
    targetMappings = allMappings;
  }

  // ── 4. Build per-mapping rows ───────────────────────────────────────────────
  const errors = [];
  const rows   = [];

  for (const mapping of targetMappings) {
    const cvIndex = mapping.current_version;
    const version = Array.isArray(mapping.versions)
      ? mapping.versions.find(v => v.v === cvIndex)
      : null;

    const status      = version ? version.status : 'UNKNOWN';
    const mode        = version ? (version.mode || 'unknown') : 'unknown';
    const lockedAt    = version ? (version.locked_at || null) : null;
    // Use locked_at if available, else created_at, else generated_at from root
    const ageRef      = lockedAt || ioMapping.generated_at || null;
    const age         = ageDays(ageRef);
    const outputsCount = version && Array.isArray(version.outputs) ? version.outputs.length : 0;

    // Stale detection (transient — not persisted)
    let staleInput  = false;
    let staleOutput = false;
    if (detectStale && version) {
      staleInput  = detectInputStale(mapping, version, cfg.projectRoot, errors);
      staleOutput = detectOutputStale(version, cfg.projectRoot, errors);
    }

    rows.push({
      map_id:          mapping.map_id,
      mode,
      current_version: cvIndex,
      status,
      locked_at:       lockedAt || '',
      age_days:        age != null ? age : '',
      outputs_count:   outputsCount,
      stale_input:     staleInput,
      stale_output:    staleOutput,
    });
  }

  // ── 5. Aggregate counts ─────────────────────────────────────────────────────
  const BY_STATUS_KEYS = ['LOCKED', 'DRAFT', 'STALE_INPUT', 'STALE_OUTPUT', 'PENDING_REVIEW', 'SUPERSEDED'];
  const byStatus = {};
  for (const k of BY_STATUS_KEYS) byStatus[k] = 0;

  const byMode = {};

  for (const r of rows) {
    if (r.status in byStatus) {
      byStatus[r.status]++;
    } else {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    }
    byMode[r.mode] = (byMode[r.mode] || 0) + 1;
  }

  // ── 6. Output ───────────────────────────────────────────────────────────────
  if (format === 'json') {
    const result = {
      handler:   HANDLER_NAME,
      status:    'completed',
      total:     rows.length,
      by_status: byStatus,
      by_mode:   byMode,
      mappings:  rows.map(r => ({
        map_id:          r.map_id,
        mode:            r.mode,
        current_version: r.current_version,
        status:          r.status,
        locked_at:       r.locked_at || null,
        age_days:        r.age_days !== '' ? r.age_days : null,
        outputs_count:   r.outputs_count,
        stale_input:     r.stale_input,
        stale_output:    r.stale_output,
      })),
      errors,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    // Table format
    /** @type {Column[]} */
    const columns = [
      { header: 'MAP-ID',   width: 8,  key: 'map_id'          },
      { header: 'Mode',     width: 12, key: 'mode'             },
      { header: 'Status',   width: 14, key: 'status'           },
      { header: 'Ver',      width: 3,  key: 'current_version', align: 'right' },
      { header: 'Locked At',           width: 24, key: 'locked_at'       },
      { header: 'Age',      width: 4,  key: 'age_display',     align: 'right' },
      { header: 'Outputs',  width: 7,  key: 'outputs_count',   align: 'right' },
    ];

    // Only show stale columns when --detect-stale requested
    if (detectStale) {
      columns.push({ header: 'StaleI', width: 6, key: 'stale_i_display' });
      columns.push({ header: 'StaleO', width: 6, key: 'stale_o_display' });
    }

    // Build display rows (formatted values for table)
    const displayRows = rows.map(r => ({
      ...r,
      age_display:      r.age_days !== '' ? r.age_days + 'd' : '',
      stale_i_display:  r.stale_input  ? '!' : '.',
      stale_o_display:  r.stale_output ? '!' : '.',
    }));

    const table   = renderTable(displayRows, columns);
    const summary = renderSummary(rows.length, byStatus);

    process.stdout.write(table + '\n' + summary + '\n');

    // Print warnings to stderr (non-fatal)
    for (const w of errors) {
      process.stderr.write(w + '\n');
    }
  }

  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

try {
  main();
} catch (e) {
  exitError(`Unhandled error: ${e.message}`);
}
