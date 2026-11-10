#!/usr/bin/env node
'use strict';
/**
 * handler-accept.cjs — --accept mode handler for PM-BA skill.
 *
 * Detects human-edited (STALE) outputs among LOCKED mappings, generates
 * per-mapping consistency-check report stubs, and finalises re-lock when
 * a subagent has filled the PASS verdict.
 *
 * CLI:
 *   node handler-accept.cjs [--map MAP-NNN] [--all] [--dry-run] [--auto-confirm] [--help]
 *
 * Exit codes:
 *   0  completed (no stale outputs found, OR --auto-confirm finalised all)
 *   1  error
 *   2  needs_user_input (stale outputs detected, manual subagent review needed)
 *
 * Output: JSON printed to stdout (see schema below).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Subagent contract (Claude orchestrator side):
 *   When this handler outputs actions[].type === 'consistency_check_requested',
 *   Claude must:
 *   1. Spawn code-reviewer or researcher subagent
 *   2. Pass the generated report path + input/output file paths
 *   3. Subagent fills "## Subagent Findings" + "## Verdict" sections
 *      (mark checkbox: `- [x] PASS` or `- [x] FAIL`)
 *   4. Claude re-runs:
 *        node handler-accept.cjs --map <id> --auto-confirm
 *      to finalise re-lock.
 *
 * See: .claude/skills/pm-ba/references/io-mapping-protocol.md §7
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ── Peer-script imports ───────────────────────────────────────────────────────
const { atomicWrite, atomicReadModifyWrite } = require('./atomic-fs.cjs');
const { snapshotAndRotate }                 = require('./snapshot-rotator.cjs');
const { appendAudit }                       = require('./audit-log.cjs');
const { normalizeAndHash }                  = require('./normalize-hash.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const USAGE = `
Usage: node handler-accept.cjs [options]

Options:
  --map MAP-NNN     Target a single mapping by ID
  --all             Target all LOCKED mappings (default when --map not given)
  --dry-run         Detect stale outputs but do not generate reports or mutate
  --auto-confirm    Skip review prompt; re-lock automatically on PASS verdict
  --help            Show this message

Exit codes:
  0  completed (no stale outputs found, or auto-confirm finalised all)
  1  error
  2  needs_user_input (stale outputs detected, awaiting subagent verdict)
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Config loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate and parse pm-ba.config.json.  Searches up from __dirname then cwd.
 * @returns {{ config: object, configDir: string }}
 */
function loadConfig() {
  const candidates = [];

  // Relative to this script: scripts/ → .claude/
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
      return { config: JSON.parse(raw), configDir: path.dirname(c) };
    } catch (_) { /* try next */ }
  }

  throw new Error('pm-ba.config.json not found. Searched: ' + candidates.slice(0, 3).join(', ') + ' ...');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @returns {{ mapId: string|null, all: boolean, dryRun: boolean, autoConfirm: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { mapId: null, all: false, dryRun: false, autoConfirm: false, help: false };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { result.help = true; }
    else if (a === '--all')           { result.all = true; }
    else if (a === '--dry-run')       { result.dryRun = true; }
    else if (a === '--auto-confirm')  { result.autoConfirm = true; }
    else if (a === '--map') {
      i++;
      if (!args[i]) throw new Error('--map requires a value (e.g. --map MAP-001)');
      result.mapId = args[i];
    } else {
      throw new Error(`Unknown flag: ${a}. Run --help for usage.`);
    }
  }

  // Default: --all when neither --map nor --all given
  if (!result.mapId && !result.all && !result.help) result.all = true;

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// IO-mapping helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load io-mapping.json (read-only, no locking needed for reads).
 * @param {string} ioMappingPath  absolute path
 * @returns {object}
 */
function loadIoMapping(ioMappingPath) {
  const raw = fs.readFileSync(ioMappingPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Return the current version object for a mapping.
 * @param {object} mapping
 * @returns {object|null}
 */
function currentVersion(mapping) {
  return mapping.versions.find(v => v.v === mapping.current_version) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 of a file using the same canonicalization as normalize-hash.cjs.
 * Returns null if file does not exist.
 * @param {string} absPath
 * @returns {string|null}
 */
function hashFile(absPath) {
  if (!fs.existsSync(absPath)) return null;
  return normalizeAndHash(absPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Report generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build consistency-check report content.
 * @param {{ mapId: string, version: number, outputPath: string, storedHash: string, currentHash: string, inputPath: string, mode: string }} p
 * @returns {string}
 */
function buildReportContent(p) {
  const ts = new Date().toISOString();
  const storedShort  = p.storedHash ? p.storedHash.slice(0, 12) : 'n/a';
  const currentShort = p.currentHash ? p.currentHash.slice(0, 12) : 'n/a';
  const inputLabel   = p.inputPath && p.inputPath !== 'ORPHAN' ? p.inputPath : 'ORPHAN';

  return `# Consistency Check: ${p.mapId} v${p.version}

**Date:** ${ts}
**Mapping:** ${p.mapId} version ${p.version}
**Output file:** ${p.outputPath}
**Hash diff:**
  - Stored:  ${storedShort}
  - Current: ${currentShort}
**Input:** ${inputLabel}
**Mode:** ${p.mode}

## Subagent Analysis Request

A consistency-check subagent must read the input file (if available), read the current output, and evaluate whether human edits preserve semantic alignment with input intent.

See \`io-mapping-protocol.md §7\` for subagent prompt template.

## Subagent Findings

<TO BE FILLED BY SUBAGENT>

## Verdict

- [ ] PASS — content consistent with input semantics; safe to re-lock as new version
- [ ] FAIL — content drifted from input intent; requires rework

## Recommendation

<subagent fills>
`;
}

/**
 * Derive report filename.
 * Pattern: consistency-check-260519-MAP-001.md  (date = YYMMDD)
 * @param {string} mapId
 * @returns {string}  filename only
 */
function reportFilename(mapId) {
  const d  = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `consistency-check-${yy}${mm}${dd}-${mapId}.md`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdict reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a report file and detect subagent verdict checkbox.
 * Looks for `- [x] PASS` or `- [x] FAIL` (case-insensitive on PASS/FAIL).
 * @param {string} reportPath  absolute path
 * @returns {'PASS'|'FAIL'|null}  null if file absent or no marked checkbox
 */
function readVerdict(reportPath) {
  if (!fs.existsSync(reportPath)) return null;
  const content = fs.readFileSync(reportPath, 'utf8');
  const m = content.match(/- \[x\]\s+(PASS|FAIL)/i);
  if (!m) return null;
  return m[1].toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-lock: append new version to io-mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append a new PENDING_REVIEW version to a mapping (async — uses atomicReadModifyWrite).
 * The caller must await this.
 *
 * @param {string} ioMappingPath    absolute path
 * @param {string} mapId
 * @param {string} currentHash      freshly computed hash for the output
 * @param {number} prevVersionId    version_id of the version being superseded
 * @returns {number}                new version_id
 */
async function appendNewVersion(ioMappingPath, mapId, currentHash, prevVersionId) {
  let newVersionId = -1;

  await atomicReadModifyWrite(ioMappingPath, (raw) => {
    const data = JSON.parse(raw);
    const mapping = data.mappings.find(m => m.map_id === mapId);
    if (!mapping) throw new Error(`Mapping ${mapId} not found during re-lock`);

    const prevVersion = mapping.versions.find(v => v.v === prevVersionId);
    if (!prevVersion) throw new Error(`Version ${prevVersionId} not found in ${mapId}`);

    newVersionId = mapping.versions.length + 1;

    const newVersion = {
      v:                  newVersionId,
      input_hash_sha256:  prevVersion.input_hash_sha256,
      mode:               prevVersion.mode,
      outputs:            prevVersion.outputs.map(o => ({
        ...o,
        hash_sha256: currentHash,
        locked_at:   null,
      })),
      status:             'PENDING_REVIEW',
      locked_at:          null,
      locked_by:          null,
      lock_notes:         'accept: re-locked after consistency check PASS',
      supersedes_version: prevVersionId,
    };

    mapping.versions.push(newVersion);
    mapping.current_version = newVersionId;
    data.generated_at = new Date().toISOString();

    return JSON.stringify(data, null, 2);
  });

  return newVersionId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // ── Output skeleton ─────────────────────────────────────────────────────────
  const output = {
    handler:      'accept',
    status:       'completed',
    actions:      [],
    user_prompts: [],
    reports:      [],
    errors:       [],
  };

  // ── Parse args ───────────────────────────────────────────────────────────────
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e) {
    output.status = 'error';
    output.errors.push(e.message);
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(1);
  }

  if (args.help) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  // ── Load config ──────────────────────────────────────────────────────────────
  let cfg, configDir;
  try {
    ({ config: cfg, configDir } = loadConfig());
  } catch (e) {
    output.status = 'error';
    output.errors.push('Config load failed: ' + e.message);
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(1);
  }

  const projectRoot  = cfg.project_root
    ? path.resolve(cfg.project_root)
    : path.resolve(configDir, '..');

  const ioMappingRel = cfg.io_mapping && cfg.io_mapping.store_path
    ? cfg.io_mapping.store_path
    : 'docs/.pm-ba/io-mapping.json';
  const ioMappingPath = path.isAbsolute(ioMappingRel)
    ? ioMappingRel
    : path.join(projectRoot, ioMappingRel);

  const auditLogRel  = cfg.io_mapping && cfg.io_mapping.audit_log_path
    ? cfg.io_mapping.audit_log_path
    : 'docs/.pm-ba/audit.log';
  const auditLogPath = path.isAbsolute(auditLogRel)
    ? auditLogRel
    : path.join(projectRoot, auditLogRel);

  // Reports directory: plans/reports/ under project root
  const reportsDir = path.join(projectRoot, 'plans', 'reports');

  // ── Load io-mapping ──────────────────────────────────────────────────────────
  let ioData;
  try {
    ioData = loadIoMapping(ioMappingPath);
  } catch (e) {
    output.status = 'error';
    output.errors.push('Failed to read io-mapping.json: ' + e.message);
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(1);
  }

  // ── Filter candidate mappings ────────────────────────────────────────────────
  let candidates;

  if (args.mapId) {
    const found = ioData.mappings.find(m => m.map_id === args.mapId);
    if (!found) {
      output.status = 'error';
      output.errors.push(`Mapping not found: ${args.mapId}. Available: ${ioData.mappings.map(m => m.map_id).join(', ')}`);
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      process.exit(1);
    }
    candidates = [found];
  } else {
    // --all: only LOCKED mappings
    candidates = ioData.mappings.filter(m => {
      const cv = currentVersion(m);
      return cv && cv.status === 'LOCKED';
    });
  }

  // ── Detect stale outputs ─────────────────────────────────────────────────────
  /** @type {Array<{ mapping: object, version: object, output: object, currentHash: string, reportPath: string }>} */
  const staleItems = [];

  for (const mapping of candidates) {
    const cv = currentVersion(mapping);
    if (!cv || cv.status !== 'LOCKED') continue;

    for (const outputEntry of cv.outputs) {
      const absOutputPath = path.isAbsolute(outputEntry.path)
        ? outputEntry.path
        : path.join(projectRoot, outputEntry.path);

      const currentHash = hashFile(absOutputPath);

      // File missing → treat as stale (hash will be null)
      const isStale = currentHash === null
        ? (outputEntry.hash_sha256 !== null && outputEntry.hash_sha256 !== undefined)
        : currentHash !== outputEntry.hash_sha256;

      if (!isStale) continue;

      const reportPath = path.join(reportsDir, reportFilename(mapping.map_id));

      staleItems.push({
        mapping,
        version:     cv,
        output:      outputEntry,
        currentHash: currentHash || 'file-missing',
        reportPath,
      });
    }
  }

  // ── Dry-run: just count and exit ─────────────────────────────────────────────
  if (args.dryRun) {
    output.status = staleItems.length > 0 ? 'needs_user_input' : 'completed';
    output.actions.push({
      type:         'dry_run_scan',
      stale_count:  staleItems.length,
      stale_maps:   staleItems.map(s => s.mapping.map_id),
    });
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(staleItems.length > 0 ? 2 : 0);
  }

  // ── Process each stale item ──────────────────────────────────────────────────
  let needsUserInput = false;

  for (const item of staleItems) {
    const { mapping, version, output: outputEntry, currentHash, reportPath } = item;
    const mapId       = mapping.map_id;
    const inputPath   = version.inputs
      ? (version.inputs[0] && version.inputs[0].path ? version.inputs[0].path : mapping.input_path || 'ORPHAN')
      : mapping.input_path || 'ORPHAN';

    // ── Log STALE_OUTPUT_DETECTED ──────────────────────────────────────────────
    try {
      appendAudit(auditLogPath, {
        actor:      'script',
        event_type: 'STALE_OUTPUT_DETECTED',
        map_id:     mapId,
        version:    version.v,
        details:    `output: ${outputEntry.path} stored: ${(outputEntry.hash_sha256 || '').slice(0, 12)} current: ${currentHash.slice(0, 12)}`,
      });
    } catch (auditErr) {
      output.errors.push(`Audit write failed for ${mapId}: ${auditErr.message}`);
    }

    // ── Auto-confirm: check if report already has a verdict ───────────────────
    if (args.autoConfirm && fs.existsSync(reportPath)) {
      const verdict = readVerdict(reportPath);

      if (verdict === 'PASS') {
        // Snapshot before mutating
        try {
          snapshotAndRotate(ioMappingPath, `pre-accept-${mapId}`);
        } catch (snapErr) {
          output.errors.push(`Snapshot failed for ${mapId}: ${snapErr.message}`);
        }

        // Append new version
        let newVersionId;
        try {
          newVersionId = await appendNewVersion(ioMappingPath, mapId, currentHash, version.v);
        } catch (mutErr) {
          output.status = 'error';
          output.errors.push(`Re-lock failed for ${mapId}: ${mutErr.message}`);
          continue;
        }

        // Audit events
        try {
          appendAudit(auditLogPath, {
            actor:      'script',
            event_type: 'SUPERSEDE',
            map_id:     mapId,
            version:    version.v,
            details:    `superseded by v${newVersionId} after accept PASS`,
          });
          appendAudit(auditLogPath, {
            actor:      'script',
            event_type: 'ACCEPT_PASS',
            map_id:     mapId,
            version:    newVersionId,
            details:    `consistency PASS; new version ${newVersionId} appended (PENDING_REVIEW)`,
          });
        } catch (auditErr) {
          output.errors.push(`Audit write failed for ${mapId}: ${auditErr.message}`);
        }

        output.actions.push({ type: 'version_appended', map_id: mapId, new_version: newVersionId });
        output.reports.push(reportPath);
        continue;
      }

      if (verdict === 'FAIL') {
        // Do NOT mutate; record failure
        try {
          appendAudit(auditLogPath, {
            actor:      'script',
            event_type: 'ACCEPT_FAIL',
            map_id:     mapId,
            version:    version.v,
            details:    `consistency FAIL; keeping existing LOCKED version`,
          });
        } catch (auditErr) {
          output.errors.push(`Audit write failed for ${mapId}: ${auditErr.message}`);
        }

        output.actions.push({ type: 'keep_locked', map_id: mapId, reason: 'consistency FAIL' });
        output.reports.push(reportPath);
        continue;
      }

      // verdict === null → report exists but no checkbox marked yet; fall through to prompt
    }

    // ── Generate report stub ──────────────────────────────────────────────────
    if (!fs.existsSync(reportPath)) {
      const reportContent = buildReportContent({
        mapId,
        version:     version.v,
        outputPath:  outputEntry.path,
        storedHash:  outputEntry.hash_sha256 || '',
        currentHash,
        inputPath,
        mode:        version.mode || 'unknown',
      });

      try {
        atomicWrite(reportPath, reportContent);
      } catch (writeErr) {
        output.errors.push(`Failed to write report for ${mapId}: ${writeErr.message}`);
      }
    }

    output.actions.push({
      type:        'consistency_check_requested',
      map_id:      mapId,
      report_path: reportPath,
    });
    output.reports.push(reportPath);

    output.user_prompts.push({
      header:   'Review consistency',
      question: `Subagent must analyze ${mapId} output drift. After verdict is filled in ${reportPath}, re-run with --auto-confirm to finalize.`,
      options: [
        {
          label:       'Spawn subagent now',
          description: `Spawn a code-reviewer or researcher subagent to fill the verdict in ${path.basename(reportPath)} then re-run with --auto-confirm`,
        },
        {
          label:       'Defer',
          description: 'Skip for now; re-run handler-accept.cjs --auto-confirm later',
        },
      ],
    });

    needsUserInput = true;
  }

  // ── Determine final status ───────────────────────────────────────────────────
  if (output.errors.length > 0 && output.actions.length === 0) {
    output.status = 'error';
  } else if (needsUserInput) {
    output.status = 'needs_user_input';
  } else if (output.errors.length > 0) {
    output.status = 'partial';
  } else {
    output.status = 'completed';
  }

  // ── Print JSON ────────────────────────────────────────────────────────────────
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');

  // ── Exit code ─────────────────────────────────────────────────────────────────
  if (output.status === 'error') process.exit(1);
  if (output.status === 'needs_user_input') process.exit(2);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch(e => {
    const errOut = {
      handler: 'accept',
      status:  'error',
      actions: [],
      user_prompts: [],
      reports: [],
      errors:  [e.message],
    };
    process.stdout.write(JSON.stringify(errOut, null, 2) + '\n');
    process.exit(1);
  });
}

module.exports = { main, loadConfig, parseArgs, readVerdict, buildReportContent, reportFilename };
