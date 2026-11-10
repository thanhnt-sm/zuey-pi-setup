#!/usr/bin/env node
'use strict';
/**
 * io-mapping-validator.cjs
 *
 * Validates structural and semantic integrity of docs/.pm-ba/io-mapping.json.
 *
 * CLI: node io-mapping-validator.cjs [--fix] [--quiet]
 *
 * Checks:
 *   1. JSON parseable
 *   2. schema_version === 1
 *   3. Unique map_ids
 *   4. current_version exists in versions[]
 *   5. version_id numbers are monotonic consecutive (1, 2, 3...)
 *   6. SUPERSEDED versions link valid supersedes_version
 *   7. LOCKED output files exist on disk
 *   8. No cycles in downstream_dependencies (max depth 10)
 *   9. mode enum valid
 *  10. output paths inside output_root; input paths inside input_root
 *
 * --fix:   attempt rollback from latest snapshot in snapshots_dir
 * --quiet: suppress non-error output
 *
 * Exit codes:
 *   0 = valid (or bootstrap — no io-mapping.json yet)
 *   1 = invalid, no fix applied (or --fix not given)
 *   2 = restored from snapshot (was invalid, fix succeeded)
 */

const fs = require('fs');
const path = require('path');

// Phase 1 utilities
const { atomicWrite } = require('./atomic-fs.cjs');
const { snapshotAndRotate } = require('./snapshot-rotator.cjs');
const { appendAudit } = require('./audit-log.cjs');
const { isInsideDir, normalizePath } = require('./path-utils.cjs');

const CONFIG_PATH = path.join(process.cwd(), '.claude', 'pm-ba.config.json');
const EXPECTED_SCHEMA_VERSION = 1;
const MAX_CYCLE_DEPTH = 10;

/** All valid mode values for a mapping entry. */
const VALID_MODES = [
  'migration', 'brd', 'urd', 'contract', 'process-map', 'screen',
  'meeting-post', 'trace', 'accept', 'unlock', 'full',
  'post-hoc-migration', 'auto-rendered',
  // Human-initiated modes
  'manual-edit',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load and parse JSON file. Throws on missing/invalid. */
function loadJson(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

/** Load pm-ba.config.json */
function loadConfig() {
  return loadJson(CONFIG_PATH);
}

/** Resolve store path from config to absolute path. */
function resolveMappingPath(config) {
  const storePath = config.io_mapping && config.io_mapping.store_path;
  if (!storePath) throw new Error('io_mapping.store_path missing in config');
  const root = config.project_root || process.cwd();
  return path.isAbsolute(storePath) ? storePath : path.join(root, storePath);
}

/** Resolve snapshots directory from config to absolute path. */
function resolveSnapshotsDir(config) {
  const snapshotsDir = config.io_mapping && config.io_mapping.snapshots_dir;
  if (!snapshotsDir) throw new Error('io_mapping.snapshots_dir missing in config');
  const root = config.project_root || process.cwd();
  return path.isAbsolute(snapshotsDir) ? snapshotsDir : path.join(root, snapshotsDir);
}

/** Resolve output_root from config to absolute path. */
function resolveOutputRoot(config) {
  const raw = config.output_root || path.join(process.cwd(), 'docs');
  const root = config.project_root || process.cwd();
  return path.isAbsolute(raw) ? raw : path.join(root, raw);
}

/** Resolve input_root from config to absolute path. */
function resolveInputRoot(config) {
  const raw = config.input_root || '';
  if (!raw) return null;
  const root = config.project_root || process.cwd();
  return path.isAbsolute(raw) ? raw : path.join(root, raw);
}

/** Resolve audit log path from config to absolute path. */
function resolveAuditLogPath(config) {
  const auditRel = (config.io_mapping && config.io_mapping.audit_log_path) || 'docs/.pm-ba/audit.log';
  const root = config.project_root || process.cwd();
  return path.isAbsolute(auditRel) ? auditRel : path.join(root, auditRel);
}

/** Print validator status line. */
function report(label, ok, detail) {
  const mark = ok ? '✓' : '✗';
  const line = detail ? `[VALIDATOR] ${label}: ${mark} ${detail}` : `[VALIDATOR] ${label}: ${mark}`;
  process.stdout.write(line + '\n');
}

// ---------------------------------------------------------------------------
// Validation checks
// ---------------------------------------------------------------------------

/** Check 2: schema_version === 1 */
function checkSchemaVersion(mapping) {
  if (mapping.schema_version !== EXPECTED_SCHEMA_VERSION) {
    return `Expected schema_version=${EXPECTED_SCHEMA_VERSION}, got ${mapping.schema_version}`;
  }
  return null;
}

/** Check 3: unique map_ids */
function checkUniqueMapIds(mappings) {
  const seen = new Set();
  const dupes = [];
  for (const entry of mappings) {
    if (seen.has(entry.map_id)) dupes.push(entry.map_id);
    seen.add(entry.map_id);
  }
  return dupes.length > 0 ? `Duplicate map_ids: ${dupes.join(', ')}` : null;
}

/** Check 4 + 5: current_version exists and versions are monotonic */
function checkVersions(entry) {
  const errors = [];
  const versions = entry.versions || [];
  // Must have versions array
  if (!Array.isArray(versions) || versions.length === 0) {
    return [`${entry.map_id}: versions array missing or empty`];
  }
  // current_version must exist
  const vNums = versions.map((v) => v.v);
  if (!vNums.includes(entry.current_version)) {
    errors.push(`${entry.map_id}: current_version=${entry.current_version} not found in versions`);
  }
  // Monotonic: sorted ascending 1,2,3...
  const sorted = [...vNums].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      errors.push(`${entry.map_id}: version numbers not monotonic (expected ${i + 1}, got ${sorted[i]})`);
      break;
    }
  }
  return errors;
}

/** Check 6: SUPERSEDED versions have valid supersedes_version */
function checkSupersededLinks(entry) {
  const errors = [];
  const versions = entry.versions || [];
  const vNums = new Set(versions.map((v) => v.v));
  for (const ver of versions) {
    if (ver.status === 'SUPERSEDED') {
      if (ver.supersedes_version === undefined || ver.supersedes_version === null) {
        errors.push(
          `${entry.map_id} v${ver.v}: status=SUPERSEDED but supersedes_version missing`
        );
      } else if (!vNums.has(ver.supersedes_version) && ver.supersedes_version !== 0) {
        errors.push(
          `${entry.map_id} v${ver.v}: supersedes_version=${ver.supersedes_version} not in versions`
        );
      }
    }
  }
  return errors;
}

/** Check 7: LOCKED output files exist on disk */
function checkOutputFilesExist(mappings, outputRoot) {
  let total = 0;
  let missing = 0;
  const missingList = [];

  for (const entry of mappings) {
    const versions = entry.versions || [];
    const currentVer = versions.find((v) => v.v === entry.current_version);
    if (!currentVer || currentVer.status !== 'LOCKED') continue;

    for (const out of (currentVer.outputs || [])) {
      total++;
      const outPath = normalizePath(out.path || '');
      // Resolve: if path starts with 'docs/', use outputRoot parent; else use project root
      let absPath;
      if (path.isAbsolute(outPath.replace(/\//g, path.sep))) {
        absPath = outPath.replace(/\//g, path.sep);
      } else {
        // Relative to project_root (parent of docs/)
        const projectRoot = path.dirname(outputRoot);
        absPath = path.join(projectRoot, outPath.replace(/\//g, path.sep));
      }
      if (!fs.existsSync(absPath)) {
        missing++;
        missingList.push(out.path);
      }
    }
  }
  return { total, missing, missingList };
}

/**
 * Check: version_id values (per-version, not to confuse with v/v-number used elsewhere)
 * Each versions[i].version_id MUST equal i+1 (consecutive ascending from 1).
 * Operates on version_id field; if absent on all versions, skips gracefully.
 */
function checkVersionIds(entry) {
  const errors = [];
  const versions = entry.versions || [];
  // If none of the versions have version_id, skip (field is optional legacy)
  const hasVersionId = versions.some((v) => v.version_id !== undefined);
  if (!hasVersionId) return errors;

  for (let i = 0; i < versions.length; i++) {
    const expected = i + 1;
    if (versions[i].version_id !== expected) {
      errors.push(
        `${entry.map_id}: versions[${i}].version_id must be ${expected}, got ${versions[i].version_id}`
      );
    }
  }
  return errors;
}

/** Check: mode enum valid — each version's mode must be in VALID_MODES. */
function checkModeEnum(entry) {
  const errors = [];
  for (const ver of (entry.versions || [])) {
    if (ver.mode !== undefined && ver.mode !== null && !VALID_MODES.includes(ver.mode)) {
      errors.push(`${entry.map_id} v${ver.v}: invalid mode '${ver.mode}'`);
    }
  }
  return errors;
}

/**
 * Check: output paths inside output_root; input paths inside input_root.
 * Uses isInsideDir (path-utils) instead of substring match.
 * @param {object[]} mappings
 * @param {string} outputRoot  absolute path
 * @param {string|null} inputRoot  absolute path, or null if not configured
 */
function checkPathScope(mappings, outputRoot, inputRoot) {
  const errors = [];
  for (const entry of mappings) {
    // Validate input_path scope (skip ORPHAN and missing)
    if (inputRoot && entry.input_path && entry.input_path !== 'ORPHAN') {
      // input_path may be relative or absolute
      const absInput = path.isAbsolute(entry.input_path)
        ? entry.input_path
        : path.join(inputRoot, entry.input_path);
      if (!isInsideDir(absInput, inputRoot)) {
        errors.push(`${entry.map_id}: input_path '${entry.input_path}' is not inside input_root`);
      }
    }

    // Validate output paths across all versions
    for (const ver of (entry.versions || [])) {
      for (const out of (ver.outputs || [])) {
        const outPathRaw = out.path || '';
        if (!outPathRaw) continue;
        // Resolve relative output paths against project root (parent of outputRoot)
        const absOut = path.isAbsolute(outPathRaw)
          ? outPathRaw
          : path.join(path.dirname(outputRoot), outPathRaw.replace(/\//g, path.sep));
        if (!isInsideDir(absOut, outputRoot)) {
          errors.push(`${entry.map_id} v${ver.v}: output '${outPathRaw}' is not inside output_root`);
        }
      }
    }
  }
  return errors;
}

/** Check 8: cycle detection in downstream_dependencies (DFS, max depth 10) */
function checkNoCycles(mappings) {
  // Build adjacency map: map_id → [downstream map_ids]
  const adj = new Map();
  for (const entry of mappings) {
    adj.set(entry.map_id, entry.downstream_dependencies || []);
  }

  const cycles = [];

  function dfs(start, current, visited, depth) {
    if (depth > MAX_CYCLE_DEPTH) {
      cycles.push(`${start}: max depth exceeded (possible cycle)`);
      return;
    }
    for (const dep of (adj.get(current) || [])) {
      if (dep === start) {
        cycles.push(`Cycle detected: ${start} → ... → ${current} → ${start}`);
        return;
      }
      if (!visited.has(dep)) {
        visited.add(dep);
        dfs(start, dep, visited, depth + 1);
      }
    }
  }

  for (const entry of mappings) {
    const visited = new Set([entry.map_id]);
    dfs(entry.map_id, entry.map_id, visited, 0);
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// Snapshot restore
// ---------------------------------------------------------------------------

/** Find the latest snapshot file in snapshotsDir. Returns abs path or null. */
function findLatestSnapshot(snapshotsDir) {
  if (!fs.existsSync(snapshotsDir)) return null;
  const files = fs.readdirSync(snapshotsDir)
    .filter((f) => f.endsWith('.json'))
    .sort() // ISO timestamp prefix → lexicographic sort = chronological
    .reverse();
  return files.length > 0 ? path.join(snapshotsDir, files[0]) : null;
}

/** Restore mapping from snapshot using atomicWrite for safety. */
function restoreFromSnapshot(snapshotPath, mappingPath) {
  const content = fs.readFileSync(snapshotPath, 'utf8');
  atomicWrite(mappingPath, content);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const fixMode = args.includes('--fix');

  // -- Load config --
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    process.stderr.write(`[VALIDATOR] Cannot load config: ${e.message}\n`);
    process.exit(1);
  }

  // -- Resolve paths --
  let mappingPath, snapshotsDir, outputRoot, inputRoot, auditLogPath;
  try {
    mappingPath = resolveMappingPath(config);
    snapshotsDir = resolveSnapshotsDir(config);
    outputRoot = resolveOutputRoot(config);
    inputRoot = resolveInputRoot(config);
    auditLogPath = resolveAuditLogPath(config);
  } catch (e) {
    process.stderr.write(`[VALIDATOR] Config path error: ${e.message}\n`);
    process.exit(1);
  }

  // -- Bootstrap guard: missing io-mapping.json is valid (not yet created) --
  if (!fs.existsSync(mappingPath)) {
    process.stderr.write('[VALIDATOR] io-mapping.json not found — bootstrap state, exiting 0\n');
    process.exit(0);
  }

  // -- Check 1: JSON parseable --
  let mapping;
  try {
    mapping = loadJson(mappingPath);
    report('JSON parseable', true);
  } catch (e) {
    report('JSON parseable', false, e.message);
    const errMsg = `JSON parse failed: ${e.message}`;
    try { appendAudit(auditLogPath, { actor: 'script', event_type: 'VALIDATE_FAIL', details: errMsg }); }
    catch (_) { /* audit failure is non-fatal */ }

    if (fixMode) {
      process.stdout.write('[VALIDATOR] Attempting restore from snapshot...\n');
      const snap = findLatestSnapshot(snapshotsDir);
      if (!snap) {
        process.stderr.write('[VALIDATOR] No snapshots found. Cannot restore.\n');
        process.exit(1);
      }
      try {
        restoreFromSnapshot(snap, mappingPath);
        process.stdout.write(`[VALIDATOR] Restored from: ${snap}\n`);
        try {
          snapshotAndRotate(mappingPath, 'post-rollback');
          appendAudit(auditLogPath, { actor: 'script', event_type: 'ROLLBACK', details: snap });
        } catch (_) { /* non-fatal */ }
        process.exit(2);
      } catch (re) {
        process.stderr.write(`[VALIDATOR] Restore failed: ${re.message}\n`);
        process.exit(1);
      }
    }
    process.exit(1);
  }

  const mappings = mapping.mappings || [];
  process.stdout.write(`[VALIDATOR] Loaded mapping with ${mappings.length} entries.\n`);

  const allErrors = [];

  // -- Check 2: schema_version --
  const schemaErr = checkSchemaVersion(mapping);
  report(`Schema version: ${mapping.schema_version}`, !schemaErr, schemaErr || '');
  if (schemaErr) allErrors.push(schemaErr);

  // -- Check 3: unique map_ids --
  const dupeErr = checkUniqueMapIds(mappings);
  report('Unique map_ids', !dupeErr, dupeErr || '');
  if (dupeErr) allErrors.push(dupeErr);

  // -- Checks 4 + 5: version integrity per entry (v-number monotonicity + current_version) --
  const versionErrors = [];
  for (const entry of mappings) {
    const errs = checkVersions(entry);
    versionErrors.push(...errs);
  }
  report('Version monotonicity (v-number)', versionErrors.length === 0,
    versionErrors.length > 0 ? versionErrors[0] : '');
  allErrors.push(...versionErrors);

  // -- Check 5b: version_id consecutive ascending (1,2,3...) --
  const versionIdErrors = [];
  for (const entry of mappings) {
    versionIdErrors.push(...checkVersionIds(entry));
  }
  report('version_id monotonic', versionIdErrors.length === 0,
    versionIdErrors.length > 0 ? versionIdErrors[0] : '');
  allErrors.push(...versionIdErrors);

  // -- Check 6: SUPERSEDED links --
  const supersededErrors = [];
  for (const entry of mappings) {
    supersededErrors.push(...checkSupersededLinks(entry));
  }
  report('SUPERSEDED links valid', supersededErrors.length === 0,
    supersededErrors.length > 0 ? supersededErrors[0] : '');
  allErrors.push(...supersededErrors);

  // -- Check 7: output files exist --
  const { total, missing, missingList } = checkOutputFilesExist(mappings, outputRoot);
  const filesOk = missing === 0;
  report(`Output files exist`, filesOk,
    filesOk ? `(${total}/${total})` : `(${total - missing}/${total}) missing: ${missingList.join(', ')}`);
  if (!filesOk) allErrors.push(`${missing} output file(s) missing from disk`);

  // -- Check 8: cycle detection --
  const cycles = checkNoCycles(mappings);
  report('No dependency cycles', cycles.length === 0,
    cycles.length > 0 ? cycles[0] : '');
  allErrors.push(...cycles);

  // -- Check 9: mode enum --
  const modeErrors = [];
  for (const entry of mappings) {
    modeErrors.push(...checkModeEnum(entry));
  }
  report('Mode enum valid', modeErrors.length === 0,
    modeErrors.length > 0 ? modeErrors[0] : '');
  allErrors.push(...modeErrors);

  // -- Check 10: path scope (output inside output_root, input inside input_root) --
  const scopeErrors = checkPathScope(mappings, outputRoot, inputRoot);
  report('Path scope valid', scopeErrors.length === 0,
    scopeErrors.length > 0 ? scopeErrors[0] : '');
  allErrors.push(...scopeErrors);

  // -- Summary --
  if (allErrors.length === 0) {
    process.stdout.write('[VALIDATOR] All checks passed.\n');
    try { appendAudit(auditLogPath, { actor: 'script', event_type: 'VALIDATE_OK', details: 'validation passed' }); }
    catch (_) { /* non-fatal */ }
    process.exit(0);
  }

  process.stderr.write(`[VALIDATOR] ${allErrors.length} error(s) found:\n`);
  for (const err of allErrors) {
    process.stderr.write(`  - ${err}\n`);
  }

  // Emit audit for first error found
  try {
    appendAudit(auditLogPath, {
      actor: 'script',
      event_type: 'VALIDATE_FAIL',
      details: `${allErrors.length} error(s): ${allErrors[0]}`,
    });
  } catch (_) { /* non-fatal */ }

  if (fixMode) {
    process.stdout.write('[VALIDATOR] --fix: attempting restore from latest snapshot...\n');
    const snap = findLatestSnapshot(snapshotsDir);
    if (!snap) {
      process.stderr.write('[VALIDATOR] No snapshots found. Cannot restore.\n');
      process.exit(1);
    }
    try {
      restoreFromSnapshot(snap, mappingPath);
      process.stdout.write(`[VALIDATOR] Restored from: ${snap}\n`);
      try {
        snapshotAndRotate(mappingPath, 'post-rollback');
        appendAudit(auditLogPath, { actor: 'script', event_type: 'ROLLBACK', details: snap });
      } catch (_) { /* non-fatal */ }
      process.exit(2);
    } catch (re) {
      process.stderr.write(`[VALIDATOR] Restore failed: ${re.message}\n`);
      process.exit(1);
    }
  }

  process.exit(1);
}

main();
