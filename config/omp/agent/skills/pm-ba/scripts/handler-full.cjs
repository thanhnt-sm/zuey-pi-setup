#!/usr/bin/env node
'use strict';
/**
 * handler-full.cjs — --full mode entry handler for PM-BA skill.
 *
 * Scans input_root for all .md files, groups them by mode (via subfolder
 * mapping), and produces a wave-execution plan. Does NOT execute the modes —
 * the Claude orchestrator (AI tier) executes via Task tool.
 *
 * CLI:
 *   node handler-full.cjs [--skip-locked] [--resume <state-file>]
 *                         [--dry-run] [--inputs-dir <path>] [--help]
 *
 * Options:
 *   --skip-locked        Omit inputs that have a LOCKED mapping with matching hash
 *   --resume <path>      Resume from state file — skip already-completed waves
 *   --dry-run            Produce plan only; do NOT write state file or audit
 *   --inputs-dir <path>  Override config.input_root
 *   --help               Show this message and exit 0
 *
 * Output: JSON wave plan printed to stdout.
 *
 * Exit codes:
 *   0  plan produced
 *   1  error (config missing, invalid args, scan failure)
 *
 * State file (docs/.pm-ba/full-state.json):
 *   Written on each run (unless --dry-run). Orchestrator updates
 *   completed_waves[] as each wave finishes.
 *
 * Wave definitions (protocol §6):
 *   Wave A (parallel):  contract, brd
 *   Wave B (parallel):  urd, process-map, screen, meeting-post  — depends_on: A
 *   Wave C (sequential): trace                                  — depends_on: B
 */

const fs   = require('fs');
const path = require('path');

// ── Peer-script imports ───────────────────────────────────────────────────────
const { atomicWrite }           = require('./atomic-fs.cjs');
const { appendAudit }           = require('./audit-log.cjs');
const { samePath, normalizePath, isInsideDir } = require('./path-utils.cjs');
const { normalizeAndHash }      = require('./normalize-hash.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const USAGE = `
Usage: node handler-full.cjs [options]

Options:
  --skip-locked           Omit inputs that already have a LOCKED mapping
                          with a matching input hash (idempotent re-runs)
  --resume <state-file>   Skip waves already listed in completed_waves[]
  --dry-run               Produce plan but do not write state file or audit
  --inputs-dir <path>     Override config.input_root for this run
  --help                  Show this message and exit 0

Exit codes:
  0  wave plan produced (JSON on stdout)
  1  error
`.trim();

/**
 * Subfolder key → handler mode.
 * Keys match config.input_subfolders values (the actual dir names under input_root).
 */
const SUBFOLDER_TO_MODE = {
  'brd':          'brd',
  'urd':          'urd',
  'contract':     'contract',
  'process-flow': 'process-map',
  'screen-spec':  'screen',
  'meeting':      'meeting-post',
};

/**
 * Wave definitions ordered for sequential execution.
 * @type {Array<{ wave: string, parallel: boolean, modes: string[], depends_on: string|null }>}
 */
const WAVE_DEFS = [
  { wave: 'A', parallel: true,  modes: ['contract', 'brd'],                             depends_on: null },
  { wave: 'B', parallel: true,  modes: ['urd', 'process-map', 'screen', 'meeting-post'], depends_on: 'A'  },
  { wave: 'C', parallel: false, modes: ['trace'],                                        depends_on: 'B'  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Config loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate pm-ba.config.json by searching __dirname upward then cwd upward.
 * @returns {{ config: object, configDir: string, configPath: string }}
 */
function loadConfig() {
  const candidates = [];

  // Relative to this script: scripts/ → pm-ba/ → skills/ → .claude/
  candidates.push(path.resolve(__dirname, '../../../pm-ba.config.json'));

  // Walk up from cwd
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
      const raw = fs.readFileSync(c, 'utf8');
      return { config: JSON.parse(raw), configDir: path.dirname(c), configPath: c };
    } catch (_) { /* try next */ }
  }

  throw new Error('pm-ba.config.json not found. Searched: ' + candidates.slice(0, 3).join(', ') + ' ...');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string[]} argv  process.argv
 * @returns {{ skipLocked: boolean, resumePath: string|null, dryRun: boolean, inputsDir: string|null, help: boolean }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { skipLocked: false, resumePath: null, dryRun: false, inputsDir: null, help: false };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      result.help = true;
    } else if (a === '--skip-locked') {
      result.skipLocked = true;
    } else if (a === '--dry-run') {
      result.dryRun = true;
    } else if (a === '--resume') {
      i++;
      if (!args[i]) throw new Error('--resume requires a path argument');
      result.resumePath = args[i];
    } else if (a === '--inputs-dir') {
      i++;
      if (!args[i]) throw new Error('--inputs-dir requires a path argument');
      result.inputsDir = args[i];
    } else {
      throw new Error(`Unknown flag: ${a}. Run --help for usage.`);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// IO-mapping helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load io-mapping.json (read-only).
 * Returns null if file does not exist.
 * @param {string} ioMappingPath  absolute path
 * @returns {object|null}
 */
function loadIoMapping(ioMappingPath) {
  if (!fs.existsSync(ioMappingPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(ioMappingPath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse io-mapping.json: ${e.message}`);
  }
}

/**
 * Return the current version object for a mapping.
 * @param {object} mapping
 * @returns {object|null}
 */
function currentVersion(mapping) {
  return mapping.versions.find(v => v.v === mapping.current_version) || null;
}

/**
 * Find a mapping whose current version input_path matches the given file path,
 * respecting cross-platform path equivalence.
 *
 * @param {object|null} ioMapping    parsed io-mapping.json (or null)
 * @param {string}      absFilePath  absolute path to input file
 * @returns {{ mapId: string, version: object }|null}
 */
function findMappingForInput(ioMapping, absFilePath) {
  if (!ioMapping || !Array.isArray(ioMapping.mappings)) return null;
  for (const mapping of ioMapping.mappings) {
    const ver = currentVersion(mapping);
    if (!ver) continue;
    if (ver.input_path === 'ORPHAN') continue;
    if (samePath(ver.input_path, absFilePath)) {
      return { mapId: mapping.map_id, version: ver };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input scanning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively collect all .md files under a directory.
 * Returns absolute paths.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function collectMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Compute file hash safely. Returns null on read error.
 * @param {string} absPath
 * @returns {string|null}
 */
function safeHash(absPath) {
  try {
    return normalizeAndHash(absPath);
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume state helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load resume state from a JSON file. Returns null if file missing.
 * Validates that it has completed_waves array.
 * @param {string} stateFilePath
 * @returns {{ completed_waves: string[], [k: string]: unknown }|null}
 */
function loadResumeState(stateFilePath) {
  if (!fs.existsSync(stateFilePath)) {
    throw new Error(`Resume state file not found: ${stateFilePath}`);
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse state file: ${e.message}`);
  }
  if (!Array.isArray(state.completed_waves)) {
    throw new Error(`State file missing completed_waves array: ${stateFilePath}`);
  }
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wave plan builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a wave plan from scanned inputs, applying skip-locked logic.
 *
 * @param {{
 *   inputRoot: string,
 *   config: object,
 *   ioMapping: object|null,
 *   skipLocked: boolean,
 *   completedWaves: string[],
 * }} opts
 *
 * @returns {{ waves: object[], errors: string[], totalInputsScanned: number }}
 */
function buildWavePlan(opts) {
  const { inputRoot, config, ioMapping, skipLocked, completedWaves } = opts;
  const subfolderMap = config.input_subfolders || {};

  // Build mode → [input_entry] map from scanning all subfolders
  /** @type {Map<string, Array<{ mode: string, path: string, hash: string|null, existing_map_id: string|null, skip: boolean }>>} */
  const modeInputs = new Map();
  // Initialise all known modes with empty arrays
  for (const mode of Object.values(SUBFOLDER_TO_MODE)) {
    modeInputs.set(mode, []);
  }
  // trace has no file inputs
  modeInputs.set('trace', []);

  let totalInputsScanned = 0;
  const errors = [];

  // Scan each configured subfolder
  for (const [subfolder, subfolderValue] of Object.entries(subfolderMap)) {
    const mode = SUBFOLDER_TO_MODE[subfolder];
    if (!mode) {
      // Unknown subfolder in config — skip gracefully
      continue;
    }

    const subDir = path.join(inputRoot, subfolderValue);
    let files;
    try {
      files = collectMdFiles(subDir);
    } catch (e) {
      errors.push(`Cannot scan subfolder "${subfolder}" (${subDir}): ${e.message}`);
      continue;
    }

    totalInputsScanned += files.length;

    for (const filePath of files) {
      const hash = safeHash(filePath);
      const found = findMappingForInput(ioMapping, filePath);

      let skip = false;
      let existingMapId = found ? found.mapId : null;

      if (skipLocked && found) {
        const ver = found.version;
        // Skip when LOCKED and input hash matches stored hash
        if (
          ver.status === 'LOCKED' &&
          hash !== null &&
          ver.input_hash_sha256 !== 'unavailable' &&
          ver.input_hash_sha256 === hash
        ) {
          skip = true;
        }
      }

      modeInputs.get(mode).push({
        mode,
        path: normalizePath(filePath),
        hash,
        existing_map_id: existingMapId,
        skip,
      });
    }
  }

  // Assemble waves, filtering out already-completed ones
  const waves = [];
  for (const waveDef of WAVE_DEFS) {
    if (completedWaves.includes(waveDef.wave)) continue;

    const waveInputs = [];
    for (const mode of waveDef.modes) {
      const modeList = modeInputs.get(mode) || [];
      waveInputs.push(...modeList);
    }

    const waveObj = {
      wave: waveDef.wave,
      parallel: waveDef.parallel,
      modes: waveDef.modes,
      inputs: waveInputs,
    };
    if (waveDef.depends_on !== null) {
      waveObj.depends_on = waveDef.depends_on;
    }

    waves.push(waveObj);
  }

  return { waves, errors, totalInputsScanned };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  // ── 1. Parse args ────────────────────────────────────────────────────────────
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (e) {
    process.stderr.write(`[handler-full] Argument error: ${e.message}\n`);
    process.stderr.write(USAGE + '\n');
    process.exit(1);
  }

  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  // ── 2. Load config ───────────────────────────────────────────────────────────
  let configResult;
  try {
    configResult = loadConfig();
  } catch (e) {
    process.stderr.write(`[handler-full] Config error: ${e.message}\n`);
    process.exit(1);
  }
  const { config, configDir } = configResult;

  const projectRoot = config.project_root || configDir;

  // Resolve input_root (--inputs-dir overrides)
  let inputRoot;
  if (opts.inputsDir) {
    inputRoot = path.resolve(opts.inputsDir);
  } else if (config.input_root) {
    inputRoot = path.isAbsolute(config.input_root)
      ? config.input_root
      : path.resolve(projectRoot, config.input_root);
  } else {
    process.stderr.write('[handler-full] config.input_root is not defined and --inputs-dir not given\n');
    process.exit(1);
  }

  // Resolve io-mapping path
  const ioStorePath = config.io_mapping && config.io_mapping.store_path;
  if (!ioStorePath) {
    process.stderr.write('[handler-full] config.io_mapping.store_path is missing\n');
    process.exit(1);
  }
  const ioMappingPath = path.isAbsolute(ioStorePath)
    ? ioStorePath
    : path.resolve(projectRoot, ioStorePath);

  // Resolve audit log path
  const auditLogPath = config.io_mapping && config.io_mapping.audit_log_path
    ? (path.isAbsolute(config.io_mapping.audit_log_path)
        ? config.io_mapping.audit_log_path
        : path.resolve(projectRoot, config.io_mapping.audit_log_path))
    : path.join(path.dirname(ioMappingPath), 'audit.log');

  // Resolve default state file path
  const defaultStateFilePath = path.join(path.dirname(ioMappingPath), 'full-state.json');

  // ── 3. Load io-mapping (read-only) ───────────────────────────────────────────
  let ioMapping = null;
  try {
    ioMapping = loadIoMapping(ioMappingPath);
  } catch (e) {
    process.stderr.write(`[handler-full] io-mapping load error: ${e.message}\n`);
    process.exit(1);
  }

  // ── 4. Load resume state ─────────────────────────────────────────────────────
  let resumeState = null;
  let resumedFrom = null;
  if (opts.resumePath) {
    try {
      resumeState = loadResumeState(opts.resumePath);
      resumedFrom = resumeState.current_wave || null;
    } catch (e) {
      process.stderr.write(`[handler-full] Resume state error: ${e.message}\n`);
      process.exit(1);
    }
  }

  const completedWaves = resumeState ? (resumeState.completed_waves || []) : [];

  // ── 5. Build wave plan ───────────────────────────────────────────────────────
  let wavePlanResult;
  try {
    wavePlanResult = buildWavePlan({
      inputRoot,
      config,
      ioMapping,
      skipLocked: opts.skipLocked,
      completedWaves,
    });
  } catch (e) {
    process.stderr.write(`[handler-full] Wave plan build error: ${e.message}\n`);
    process.exit(1);
  }

  const { waves, errors, totalInputsScanned } = wavePlanResult;

  // ── 6. Write state file (unless --dry-run) ───────────────────────────────────
  const stateFilePath = opts.resumePath || defaultStateFilePath;
  const now = new Date().toISOString();

  if (!opts.dryRun) {
    // Build wave_inputs summary for state file
    const waveInputsMap = {};
    for (const wave of waves) {
      waveInputsMap[wave.wave] = wave.inputs;
    }

    const newState = {
      started_at: (resumeState && resumeState.started_at) || now,
      current_wave: waves.length > 0 ? waves[0].wave : null,
      completed_waves: completedWaves,
      errors: errors,
      wave_inputs: waveInputsMap,
    };

    try {
      atomicWrite(stateFilePath, JSON.stringify(newState, null, 2));
    } catch (e) {
      process.stderr.write(`[handler-full] Failed to write state file: ${e.message}\n`);
      process.exit(1);
    }

    // ── 7. Append audit event ──────────────────────────────────────────────────
    try {
      appendAudit(auditLogPath, {
        actor: 'script',
        event_type: 'VALIDATE_OK',
        map_id: '',
        version: undefined,
        details: `full mode wave plan generated; waves=${waves.map(w => w.wave).join(',') || 'none'}; inputs_scanned=${totalInputsScanned}; resumed_from=${resumedFrom || 'null'}`,
      });
    } catch (e) {
      // Non-fatal — plan still valid even if audit fails
      process.stderr.write(`[handler-full] Audit write warning: ${e.message}\n`);
    }
  }

  // ── 8. Assemble output JSON ──────────────────────────────────────────────────
  const output = {
    handler: 'full',
    status: 'completed',
    waves,
    state_file: normalizePath(stateFilePath),
    resumed_from: resumedFrom,
    actions: [],
    user_prompts: [],
    errors,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main();
}

module.exports = { buildWavePlan, loadConfig, parseArgs, WAVE_DEFS, SUBFOLDER_TO_MODE };
