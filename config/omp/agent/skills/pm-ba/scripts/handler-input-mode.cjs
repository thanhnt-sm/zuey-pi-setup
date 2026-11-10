#!/usr/bin/env node
'use strict';
/**
 * handler-input-mode.cjs
 *
 * Centralized handler for input-driven PM-BA modes.
 * Detects NEW / IDEMPOTENT / STALE_INPUT / DRAFT states and emits structured
 * JSON for Claude orchestrator to act on (via AskUserQuestion).
 *
 * READ-ONLY with respect to io-mapping.json:
 *   - NEW state: emits user_prompt, does NOT mutate io-mapping.json
 *   - STALE_INPUT: appends to audit.log only, does NOT mutate io-mapping.json
 *   - IDEMPOTENT / DRAFT: read-only, no mutations
 *
 * CLI:
 *   node handler-input-mode.cjs --mode <brd|urd|contract|process-map|screen|meeting-post> --input <path>
 *   node handler-input-mode.cjs --help
 *
 * Exit codes:
 *   0 = completed (IDEMPOTENT or DRAFT) — no user action required
 *   1 = error (invalid args, missing file, config failure)
 *   2 = needs_user_input (NEW or STALE_INPUT) — user must choose action
 */

const fs   = require('fs');
const path = require('path');

// ── Dependency imports ────────────────────────────────────────────────────────

const { appendAudit }           = require('./audit-log.cjs');
const { samePath, normalizePath } = require('./path-utils.cjs');
const { normalizeAndHash }      = require('./normalize-hash.cjs');

// ── Mode → canonical output paths ────────────────────────────────────────────

/**
 * Canonical output files produced by each mode.
 * Paths are relative to project_root (docs/ prefix is intentional).
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const MODE_OUTPUTS = Object.freeze({
  'brd':          Object.freeze(['docs/ba-brd-analysis.md', 'docs/pm-traceability-matrix.md']),
  'urd':          Object.freeze(['docs/ba-urd-analysis.md', 'docs/ba-user-stories.md']),
  'contract':     Object.freeze(['docs/ba-contract-analysis.md', 'docs/pm-contract-obligations.md']),
  'process-map':  Object.freeze(['docs/ba-process-map.md', 'docs/ba-process-flows.md']),
  'screen':       Object.freeze(['docs/ba-screen-spec.md', 'docs/ba-ui-inventory.md']),
  'meeting-post': Object.freeze(['docs/pm-meeting-decisions.md', 'docs/pm-action-items.md']),
});

const VALID_MODES = Object.keys(MODE_OUTPUTS);

// ── Config loader ─────────────────────────────────────────────────────────────

/** @type {object|null} */
let _cachedConfig = null;

/**
 * Load pm-ba.config.json. Searches from __dirname upward then from cwd.
 * @returns {object}
 * @throws {Error} if config not found
 */
function loadConfig() {
  if (_cachedConfig) return _cachedConfig;

  const candidates = [];

  // Relative to this script: scripts/ → pm-ba/ → skills/ → .claude/
  candidates.push(path.resolve(__dirname, '../../../pm-ba.config.json'));

  // Walk up from __dirname
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, '.claude', 'pm-ba.config.json'));
    candidates.push(path.join(dir, 'pm-ba.config.json'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Walk up from cwd
  dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, '.claude', 'pm-ba.config.json'));
    candidates.push(path.join(dir, 'pm-ba.config.json'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const c of candidates) {
    try {
      const raw = fs.readFileSync(c, 'utf8');
      _cachedConfig = JSON.parse(raw);
      return _cachedConfig;
    } catch (_) { /* try next */ }
  }

  throw new Error('[handler-input-mode] pm-ba.config.json not found. Searched: ' + candidates.slice(0, 5).join(', ') + ' ...');
}

// ── IO-mapping loader (read-only) ─────────────────────────────────────────────

/**
 * Load io-mapping.json from config-resolved path.
 * Returns null if file does not yet exist (first run).
 * @param {object} config
 * @returns {object|null}
 */
function loadIoMapping(config) {
  const projectRoot = config.project_root;
  const storePath   = config.io_mapping && config.io_mapping.store_path
    ? path.resolve(projectRoot, config.io_mapping.store_path)
    : path.resolve(projectRoot, 'docs/.pm-ba/io-mapping.json');

  if (!fs.existsSync(storePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch (e) {
    throw new Error('[handler-input-mode] Failed to parse io-mapping.json: ' + e.message);
  }
}

// ── Helper: resolve audit log path ───────────────────────────────────────────

/**
 * @param {object} config
 * @returns {string} absolute path to audit.log
 */
function resolveAuditLogPath(config) {
  const projectRoot = config.project_root;
  const logPath = config.io_mapping && config.io_mapping.audit_log_path
    ? config.io_mapping.audit_log_path
    : 'docs/.pm-ba/audit.log';
  return path.isAbsolute(logPath) ? logPath : path.resolve(projectRoot, logPath);
}

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Throw if mode is not a valid key of MODE_OUTPUTS.
 * @param {string} mode
 */
function validateMode(mode) {
  if (!mode) throw new Error('--mode is required. Valid modes: ' + VALID_MODES.join(', '));
  if (!VALID_MODES.includes(mode)) {
    throw new Error('Invalid --mode "' + mode + '". Valid modes: ' + VALID_MODES.join(', '));
  }
}

/**
 * Return canonical outputs array for the given mode.
 * @param {string} mode
 * @returns {readonly string[]}
 */
function expectedOutputsFor(mode) {
  return MODE_OUTPUTS[mode];
}

// ── Mapping lookup ────────────────────────────────────────────────────────────

/**
 * Find the mapping whose versions[].inputs[].path matches inputPath.
 * Handles both the legacy flat input_path field and the versioned inputs[] array.
 * Returns the mapping with the highest current_version when multiple match.
 *
 * @param {object|null} ioMapping
 * @param {string} inputPath  normalized absolute path
 * @returns {object|null}  mapping object or null
 */
function findMatchingMapping(ioMapping, inputPath) {
  if (!ioMapping || !Array.isArray(ioMapping.mappings)) return null;

  const normInput = normalizePath(inputPath);

  /** @type {object[]} */
  const candidates = [];

  for (const mapping of ioMapping.mappings) {
    let matched = false;

    // Check versioned inputs[] arrays (newer schema)
    if (Array.isArray(mapping.versions)) {
      for (const ver of mapping.versions) {
        if (Array.isArray(ver.inputs)) {
          for (const inp of ver.inputs) {
            if (inp && inp.path && samePath(inp.path, normInput)) {
              matched = true;
              break;
            }
          }
        }
        if (matched) break;
      }
    }

    // Fallback: legacy flat input_path field (pre-versioned schema)
    if (!matched && mapping.input_path && mapping.input_path !== 'ORPHAN') {
      if (samePath(mapping.input_path, normInput)) {
        matched = true;
      }
    }

    if (matched) candidates.push(mapping);
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple matches → return the one with the highest current_version
  return candidates.reduce((best, m) =>
    (m.current_version || 0) >= (best.current_version || 0) ? m : best
  );
}

// ── Current-version status extractor ─────────────────────────────────────────

/**
 * Get the status of the current (highest) version of a mapping.
 * @param {object} mapping
 * @returns {string}  e.g. 'LOCKED', 'DRAFT', 'PENDING_REVIEW'
 */
function getCurrentVersionStatus(mapping) {
  if (!Array.isArray(mapping.versions) || mapping.versions.length === 0) {
    return 'DRAFT'; // treat missing versions as DRAFT
  }
  // Find version matching current_version number
  const cv = mapping.current_version;
  const ver = mapping.versions.find((v) => v.v === cv)
    || mapping.versions[mapping.versions.length - 1]; // fallback to last
  return ver.status || 'DRAFT';
}

/**
 * Get the input_hash of the current version (for idempotency check).
 * @param {object} mapping
 * @returns {string|null}
 */
function getCurrentVersionInputHash(mapping) {
  if (!Array.isArray(mapping.versions) || mapping.versions.length === 0) return null;
  const cv = mapping.current_version;
  const ver = mapping.versions.find((v) => v.v === cv)
    || mapping.versions[mapping.versions.length - 1];
  return ver.input_hash_sha256 || null;
}

// ── Input resolution ──────────────────────────────────────────────────────────

/**
 * Resolve input path:
 *   - If absolute → use as-is
 *   - If relative → try resolve relative to config.input_root, then cwd
 * @param {string} inputArg
 * @param {object} config
 * @returns {string} absolute path
 */
function resolveInputPath(inputArg, config) {
  if (path.isAbsolute(inputArg)) return path.normalize(inputArg);

  // Try relative to input_root
  const viaInputRoot = path.resolve(config.input_root, inputArg);
  if (fs.existsSync(viaInputRoot)) return viaInputRoot;

  // Fallback to cwd
  return path.resolve(process.cwd(), inputArg);
}

// ── Output builder ────────────────────────────────────────────────────────────

/**
 * Construct the standard output envelope.
 * @param {object} params
 * @returns {object}
 */
function buildOutput({ mode, inputPath, inputHash, detectedState, matchingMapId, actions, userPrompts, errors, status }) {
  return {
    handler:        'input-mode',
    mode,
    status,
    input_path:     normalizePath(inputPath),
    input_hash:     inputHash || null,
    detected_state: detectedState,
    matching_map_id: matchingMapId || null,
    actions:        actions   || [],
    user_prompts:   userPrompts || [],
    reports:        [],
    errors:         errors    || [],
  };
}

// ── State decision tree ───────────────────────────────────────────────────────

/**
 * Core logic: determine detected state and build output JSON.
 *
 * @param {string}      mode
 * @param {string}      inputPath   absolute path (already validated exists)
 * @param {object}      config
 * @param {object|null} ioMapping   null when io-mapping.json doesn't exist yet
 * @returns {{ output: object, exitCode: number }}
 */
function handleInputMode(mode, inputPath, config, ioMapping) {
  const inputBasename = path.basename(inputPath);
  const expectedOutputs = expectedOutputsFor(mode);
  const expectedOutputsStr = expectedOutputs.join(', ');

  // Compute input hash (throws if unreadable — already validated above)
  let inputHash;
  try {
    inputHash = normalizeAndHash(inputPath);
  } catch (e) {
    const output = buildOutput({
      mode, inputPath, inputHash: null,
      detectedState: null, matchingMapId: null,
      actions: [], userPrompts: [],
      errors: ['Failed to hash input file: ' + e.message],
      status: 'completed',
    });
    return { output, exitCode: 1 };
  }

  // Lookup existing mapping
  const matchingMapping = findMatchingMapping(ioMapping, inputPath);

  // ─────────────────────────────────────────────────────────────────────────
  // CASE A — NEW (no existing mapping)
  // ─────────────────────────────────────────────────────────────────────────
  if (!matchingMapping) {
    const output = buildOutput({
      mode, inputPath, inputHash,
      detectedState: 'NEW',
      matchingMapId: null,
      actions: [],
      userPrompts: [{
        header:   'Allocate MAP for ' + mode.toUpperCase(),
        question: "Allocate new MAP-NNN for input '" + inputBasename + "'? Outputs will be: " + expectedOutputsStr + '.',
        options: [
          { label: 'Allocate',  description: 'Create new MAP-NNN, run analysis' },
          { label: 'Cancel',    description: 'No action' },
        ],
      }],
      errors:  [],
      status:  'needs_user_input',
    });
    return { output, exitCode: 2 };
  }

  const mapId         = matchingMapping.map_id;
  const currentStatus = getCurrentVersionStatus(matchingMapping);
  const storedHash    = getCurrentVersionInputHash(matchingMapping);

  // ─────────────────────────────────────────────────────────────────────────
  // CASE B — LOCKED + hash matches (IDEMPOTENT)
  // ─────────────────────────────────────────────────────────────────────────
  if (currentStatus === 'LOCKED' && storedHash && storedHash !== 'unavailable' && storedHash === inputHash) {
    const output = buildOutput({
      mode, inputPath, inputHash,
      detectedState: 'IDEMPOTENT',
      matchingMapId: mapId,
      actions:      [],
      userPrompts:  [],
      errors:       [],
      status:       'completed',
    });
    return { output, exitCode: 0 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CASE C — LOCKED + hash differs (STALE_INPUT)
  // ─────────────────────────────────────────────────────────────────────────
  if (currentStatus === 'LOCKED' && storedHash && storedHash !== inputHash) {
    // Append audit event (read-write to audit.log, NOT to io-mapping.json)
    try {
      const auditLogPath = resolveAuditLogPath(config);
      appendAudit(auditLogPath, {
        actor:      'script',
        event_type: 'STALE_INPUT_DETECTED',
        map_id:     mapId,
        version:    matchingMapping.current_version || 1,
        details:    'handler-input-mode: input hash changed for ' + inputBasename + ' (mode=' + mode + ')',
      });
    } catch (auditErr) {
      // Audit failure is non-fatal — log to stderr and continue
      process.stderr.write('[handler-input-mode] WARN: audit append failed: ' + auditErr.message + '\n');
    }

    const output = buildOutput({
      mode, inputPath, inputHash,
      detectedState: 'STALE_INPUT',
      matchingMapId: mapId,
      actions:      [],
      userPrompts:  [{
        header:   'STALE_INPUT: ' + mapId,
        question: "Input '" + inputBasename + "' changed since last lock (hash differs). Choose action:",
        options: [
          { label: 'View diff',   description: 'Display input diff (Claude renders)' },
          { label: 'Keep lock',   description: 'Skip regen, mark input as accepted-as-is' },
          { label: 'Regenerate',  description: 'Run --mode again, new version + review' },
        ],
      }],
      errors:  [],
      status:  'needs_user_input',
    });
    return { output, exitCode: 2 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CASE D — DRAFT or PENDING_REVIEW (proceed with regen)
  // ─────────────────────────────────────────────────────────────────────────
  if (currentStatus === 'DRAFT' || currentStatus === 'PENDING_REVIEW') {
    const output = buildOutput({
      mode, inputPath, inputHash,
      detectedState: 'DRAFT',
      matchingMapId: mapId,
      actions: [{
        type:             'proceed_with_regen',
        map_id:           mapId,
        expected_outputs: expectedOutputs,
      }],
      userPrompts: [],
      errors:      [],
      status:      'completed',
    });
    return { output, exitCode: 0 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FALLBACK — LOCKED but hash unavailable or "unavailable" sentinel
  // Treat as IDEMPOTENT (migration-era entries with no real hash)
  // ─────────────────────────────────────────────────────────────────────────
  if (currentStatus === 'LOCKED' && (!storedHash || storedHash === 'unavailable')) {
    const output = buildOutput({
      mode, inputPath, inputHash,
      detectedState: 'IDEMPOTENT',
      matchingMapId: mapId,
      actions:      [],
      userPrompts:  [],
      errors:       [],
      status:       'completed',
    });
    return { output, exitCode: 0 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FALLBACK — Unrecognized status (SUPERSEDED edge case, unexpected value)
  // Treat as DRAFT to allow regen
  // ─────────────────────────────────────────────────────────────────────────
  const output = buildOutput({
    mode, inputPath, inputHash,
    detectedState: 'DRAFT',
    matchingMapId: mapId,
    actions: [{
      type:             'proceed_with_regen',
      map_id:           mapId,
      expected_outputs: expectedOutputs,
    }],
    userPrompts: [],
    errors:      ['Unrecognized mapping status "' + currentStatus + '" — treating as DRAFT'],
    status:      'completed',
  });
  return { output, exitCode: 0 };
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

/**
 * Parse process.argv. Returns { mode, input } or throws on invalid args.
 * @returns {{ mode: string, input: string }}
 */
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    return null; // signals help
  }

  const modeIdx  = args.indexOf('--mode');
  const inputIdx = args.indexOf('--input');

  const mode  = modeIdx  !== -1 ? args[modeIdx  + 1] : null;
  const input = inputIdx !== -1 ? args[inputIdx + 1] : null;

  return { mode, input };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  // --help
  if (process.argv.slice(2).includes('--help') || process.argv.slice(2).includes('-h')) {
    process.stdout.write(
      'Usage:\n' +
      '  node handler-input-mode.cjs --mode <mode> --input <path>\n\n' +
      'Modes: ' + VALID_MODES.join(', ') + '\n\n' +
      'Options:\n' +
      '  --mode   <mode>   Required. One of: ' + VALID_MODES.join(', ') + '\n' +
      '  --input  <path>   Required. Path to input file (absolute or relative to input_root)\n' +
      '  --help            Show this help and exit\n\n' +
      'Exit codes:\n' +
      '  0  completed   — IDEMPOTENT or DRAFT, no user action needed\n' +
      '  1  error       — invalid args, missing file, config failure\n' +
      '  2  needs_user_input — NEW or STALE_INPUT, user must choose action\n\n' +
      'Output: JSON to stdout\n'
    );
    process.exit(0);
  }

  const parsed = parseArgs();

  // Validate --mode
  let modeErr = null;
  try {
    validateMode(parsed && parsed.mode);
  } catch (e) {
    modeErr = e.message;
  }

  if (modeErr || !parsed || !parsed.mode) {
    process.stderr.write('[handler-input-mode] Error: ' + (modeErr || '--mode is required') + '\n');
    process.stderr.write('Run with --help for usage.\n');
    process.exit(1);
  }

  const { mode, input } = parsed;

  // Validate --input present
  if (!input) {
    process.stderr.write('[handler-input-mode] Error: --input is required\n');
    process.stderr.write('Run with --help for usage.\n');
    process.exit(1);
  }

  // Load config
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    const output = buildOutput({
      mode, inputPath: input, inputHash: null,
      detectedState: null, matchingMapId: null,
      actions: [], userPrompts: [],
      errors: [e.message],
      status: 'completed',
    });
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(1);
  }

  // Resolve input absolute path
  const inputAbsolute = resolveInputPath(input, config);

  // Validate input file exists
  if (!fs.existsSync(inputAbsolute)) {
    const output = buildOutput({
      mode, inputPath: inputAbsolute, inputHash: null,
      detectedState: null, matchingMapId: null,
      actions: [], userPrompts: [],
      errors: ['Input file not found: ' + inputAbsolute],
      status: 'completed',
    });
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(1);
  }

  // Load io-mapping (read-only; null = no file yet)
  let ioMapping = null;
  try {
    ioMapping = loadIoMapping(config);
  } catch (e) {
    const output = buildOutput({
      mode, inputPath: inputAbsolute, inputHash: null,
      detectedState: null, matchingMapId: null,
      actions: [], userPrompts: [],
      errors: ['Failed to load io-mapping.json: ' + e.message],
      status: 'completed',
    });
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(1);
  }

  // Run decision tree
  let result;
  try {
    result = handleInputMode(mode, inputAbsolute, config, ioMapping);
  } catch (e) {
    const output = buildOutput({
      mode, inputPath: inputAbsolute, inputHash: null,
      detectedState: null, matchingMapId: null,
      actions: [], userPrompts: [],
      errors: ['Unexpected error in handleInputMode: ' + e.message],
      status: 'completed',
    });
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(1);
  }

  process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
  process.exit(result.exitCode);
}

// ── Module exports (for testing / orchestrator imports) ───────────────────────

module.exports = {
  MODE_OUTPUTS,
  VALID_MODES,
  validateMode,
  expectedOutputsFor,
  findMatchingMapping,
  getCurrentVersionStatus,
  getCurrentVersionInputHash,
  handleInputMode,
  loadConfig,
  loadIoMapping,
  buildOutput,
};
