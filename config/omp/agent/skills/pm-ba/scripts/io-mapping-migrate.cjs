#!/usr/bin/env node
'use strict';
/**
 * io-mapping-migrate.cjs
 *
 * One-time migration: scans output_root for existing pm-*.md / ba-*.md files,
 * infers input sources, computes SHA-256 hashes, and writes the initial
 * docs/.pm-ba/io-mapping.json. Existing human work is preserved as LOCKED v1.
 *
 * CLI: node io-mapping-migrate.cjs [--dry-run] [--auto-lock]
 *
 * --dry-run  : print migration plan without writing any files
 * --auto-lock: skip interactive prompts; auto-link single candidates,
 *              mark multi-candidate as orphan with placeholder
 *
 * Exit codes:
 *   0 = success (or dry-run complete)
 *   1 = fatal error
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { normalizeAndHash } = require('./normalize-hash.cjs');
const { atomicWrite, atomicReadModifyWrite } = require('./atomic-fs.cjs');
const { snapshotAndRotate } = require('./snapshot-rotator.cjs');
const { appendAudit } = require('./audit-log.cjs');
const { normalizePath, relativeToConfig, CrossDriveError } = require('./path-utils.cjs');

const CONFIG_PATH = path.join(process.cwd(), '.claude', 'pm-ba.config.json');

// Files to EXCLUDE from migration scan even if matching pm-*.md / ba-*.md
const EXCLUDED_BASENAMES = new Set([
  'pm-ba-io-mapping.md',
  'pm-ba-document-status.md',
  'pm-ba-output-registry.md',
  'pm-ba-workspace-index.md',
  'pm-ba-master-task-list.md',
]);

// ---------------------------------------------------------------------------
// Readline async prompt (fix HIGH #1: replaces /dev/stdin ENOENT on Windows)
// ---------------------------------------------------------------------------

/** readline interface — created once in main(), closed at end. */
let rl = null;

/**
 * Async prompt helper.
 * Falls back to default answer when stdin is not a TTY (CI / piped input).
 * @param {string} question
 * @param {string} [defaultAnswer='0']
 * @returns {Promise<string>}
 */
function ask(question, defaultAnswer = '0') {
  if (!process.stdin.isTTY) {
    process.stdout.write(question + defaultAnswer + ' [non-interactive default]\n');
    return Promise.resolve(defaultAnswer);
  }
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

function loadConfig() {
  return loadJson(CONFIG_PATH);
}

/** Format ISO timestamp. */
function isoNow() {
  return new Date().toISOString();
}

/** Zero-padded map ID string. */
function mapId(n) {
  return 'MAP-' + String(n).padStart(3, '0');
}

/**
 * Recursively scan a directory for files matching predicate.
 * Returns array of absolute paths.
 */
function scanDir(dirPath, predicate) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDir(absPath, predicate));
    } else if (entry.isFile() && predicate(entry.name, absPath)) {
      results.push(absPath);
    }
  }
  return results;
}

/**
 * Determine if a filename should be included in migration scan.
 * Includes: pm-*.md, ba-*.md
 * Excludes: exact names in EXCLUDED_BASENAMES, names starting with 'pm-ba-kpi-'
 */
function isTargetOutput(name) {
  if (EXCLUDED_BASENAMES.has(name)) return false;
  if (name.startsWith('pm-ba-kpi-')) return false;
  return (name.startsWith('pm-') || name.startsWith('ba-')) && name.endsWith('.md');
}

/**
 * Infer which input subfolder(s) to search based on output filename.
 * e.g. ba-brd-analysis.md → ['brd']
 *      ba-urd-analysis.md → ['urd']
 *      pm-traceability-matrix.md → ['brd', 'urd']  (could come from either)
 *      ba-contract-review.md → ['contract']
 *      pm-meeting-post.md → ['meeting']
 *      pm-screen-spec.md → ['screen-spec']
 *      pm-process-map.md → ['process-flow']
 * Returns array of subfolder keys from config.input_subfolders.
 *
 * FIX MED: Replaced broad `.includes(normalized)` (substring match) with
 * exact segment comparison — splits output basename on '-' and '_' delimiters
 * and checks whether any resulting segment matches the subfolder key or its
 * dash-stripped form exactly. Prevents 'brd' matching inside 'hybrid-brd-urd'.
 */
function inferInputSubfolders(baseName, inputSubfolders) {
  // Strip extension; work fully lower-cased
  const name = baseName.toLowerCase().replace(/\.md$/, '');
  const keys = Object.keys(inputSubfolders);
  const matched = [];

  // Split output filename into discrete segments on - and _ boundaries
  const segments = name.split(/[-_]/);

  for (const key of keys) {
    // Normalize key for comparison: strip dashes (e.g. 'screen-spec' → 'screenspec')
    const keyNorm = key.replace(/-/g, '').toLowerCase();

    // Exact segment match — 'brd' must be a standalone token, not a substring
    const exactMatch = segments.some(
      (seg) => seg === key.toLowerCase() || seg === keyNorm
    );

    if (exactMatch) {
      matched.push(key);
    }
  }

  // Fallback heuristics for common patterns not resolved by exact segment match
  if (matched.length === 0) {
    if (name.includes('trace') || name.includes('traceability')) {
      matched.push(...keys.filter((k) => ['brd', 'urd'].includes(k)));
    } else if (name.includes('process') || name.includes('map')) {
      matched.push(...keys.filter((k) => k === 'process-flow'));
    } else if (name.includes('screen') || name.includes('ui')) {
      matched.push(...keys.filter((k) => k === 'screen-spec'));
    } else if (name.includes('meet') || name.includes('minute')) {
      matched.push(...keys.filter((k) => k === 'meeting'));
    }
  }

  return [...new Set(matched)];
}

/**
 * Scan input subfolders for .md candidates.
 * Returns array of absolute paths.
 */
function findInputCandidates(subfolderKeys, inputSubfolders, inputRoot) {
  const candidates = [];
  for (const key of subfolderKeys) {
    const subdir = inputSubfolders[key];
    if (!subdir) continue;
    const dirPath = path.join(inputRoot, subdir);
    const files = scanDir(dirPath, (name) => name.endsWith('.md'));
    candidates.push(...files);
  }
  return candidates;
}

/**
 * Safely compute hash; returns null if file not readable.
 */
function safeHash(filePath) {
  try { return normalizeAndHash(filePath); }
  catch (_) { return null; }
}

/**
 * Compute a relative path from configBase to absPath, guarded against cross-drive
 * Windows issues (fix HIGH #6: path.relative cross-drive returns broken paths).
 *
 * @param {string} absPath
 * @param {string} configBase
 * @returns {string}  normalized relative path, or normalized absolute path on cross-drive
 */
function safeRelative(absPath, configBase) {
  let relPath;
  try {
    relPath = relativeToConfig(absPath, configBase);
  } catch (e) {
    if (e instanceof CrossDriveError) {
      // Store absolute path — different drives can't produce a meaningful relative path
      relPath = normalizePath(absPath);
      process.stdout.write(
        `[migrate] Cross-drive path stored as absolute: ${absPath}\n`
      );
    } else {
      throw e;
    }
  }
  return relPath;
}

// ---------------------------------------------------------------------------
// Interactive prompt (async readline — fix HIGH #1)
// ---------------------------------------------------------------------------

/**
 * Prompt user to select from candidates via async readline.
 * Returns selected absolute path, or null to skip.
 * Only called when NOT in --auto-lock mode.
 */
async function promptUserSelect(outputBaseName, candidates) {
  process.stdout.write(`\n[MIGRATE] Multiple input candidates for: ${outputBaseName}\n`);
  candidates.forEach((c, i) => {
    process.stdout.write(`  [${i + 1}] ${normalizePath(c)}\n`);
  });
  process.stdout.write(`  [0] Skip (mark as orphan)\n`);

  const answer = await ask('Select [0-' + candidates.length + ']: ');

  const idx = parseInt(answer.trim(), 10);
  if (isNaN(idx) || idx === 0) return null;
  if (idx < 1 || idx > candidates.length) {
    process.stdout.write('[MIGRATE] Invalid selection; skipping.\n');
    return null;
  }
  return candidates[idx - 1];
}

// ---------------------------------------------------------------------------
// Build mapping entry
// ---------------------------------------------------------------------------

function buildMappingEntry(id, outputAbsPath, inputAbsPath, config, now) {
  const outputRoot = config.output_root || path.join(process.cwd(), 'docs');
  const inputRoot = config.input_root || '';

  // Use safeRelative to handle cross-drive paths (fix HIGH #6)
  const outputRel = safeRelative(outputAbsPath, path.dirname(outputRoot));
  const inputRel = inputAbsPath
    ? safeRelative(inputAbsPath, path.dirname(inputRoot))
    : null;

  const inputHash = inputAbsPath ? safeHash(inputAbsPath) : null;
  const outputHash = safeHash(outputAbsPath);

  return {
    map_id: id,
    // Wrap stored paths with normalizePath (fix MED: all stored paths normalized)
    input_path: inputRel ? normalizePath(inputRel) : 'ORPHAN',
    current_version: 1,
    versions: [
      {
        v: 1,
        input_hash_sha256: inputHash || 'unavailable',
        mode: 'migration',
        outputs: [
          {
            path: normalizePath(outputRel),  // fix MED: normalizePath on output path
            hash_sha256: outputHash || 'unavailable',
          },
        ],
        status: 'LOCKED',
        locked_at: now,
        locked_by: 'human',
        lock_notes: 'migration — existing output preserved as LOCKED v1',
        supersedes_version: null,
      },
    ],
    downstream_dependencies: [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Create readline interface once; close at end
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const autoLock = args.includes('--auto-lock');

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: node io-mapping-migrate.cjs [--dry-run] [--auto-lock]\n' +
      '\n' +
      '  --dry-run   Print migration plan without writing any files\n' +
      '  --auto-lock Skip interactive prompts; auto-link single candidates,\n' +
      '              mark multi-candidate as orphan with placeholder\n' +
      '\n' +
      'Exit codes: 0=success/dry-run 1=fatal-error\n'
    );
    rl.close();
    process.exit(0);
  }

  process.stdout.write('[MIGRATE] Starting IO-mapping migration...\n');
  if (dryRun) process.stdout.write('[MIGRATE] DRY-RUN mode — no files will be written.\n');
  if (autoLock) process.stdout.write('[MIGRATE] AUTO-LOCK mode — no interactive prompts.\n');

  // -- Load config --
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    process.stderr.write(`[MIGRATE] Cannot load config: ${e.message}\n`);
    rl.close();
    process.exit(1);
  }

  const outputRoot = config.output_root;
  const inputRoot = config.input_root;
  const inputSubfolders = config.input_subfolders || {};
  const projectRoot = config.project_root || process.cwd();

  const storePath = config.io_mapping && config.io_mapping.store_path;
  const auditLogPath = config.io_mapping && config.io_mapping.audit_log_path;
  const snapshotsDir = config.io_mapping && config.io_mapping.snapshots_dir;

  if (!storePath || !auditLogPath || !snapshotsDir) {
    process.stderr.write('[MIGRATE] Config missing io_mapping paths (store_path/audit_log_path/snapshots_dir).\n');
    rl.close();
    process.exit(1);
  }

  const absMappingPath = path.isAbsolute(storePath)
    ? storePath : path.join(projectRoot, storePath);
  const absAuditPath = path.isAbsolute(auditLogPath)
    ? auditLogPath : path.join(projectRoot, auditLogPath);
  const absSnapshotsDir = path.isAbsolute(snapshotsDir)
    ? snapshotsDir : path.join(projectRoot, snapshotsDir);
  const absPmBaDir = path.dirname(absMappingPath);

  // -- Scan output_root for target files --
  process.stdout.write(`[MIGRATE] Scanning output_root: ${normalizePath(outputRoot)}\n`);
  const outputFiles = scanDir(outputRoot, (name) => isTargetOutput(name));
  process.stdout.write(`[MIGRATE] Found ${outputFiles.length} candidate output file(s).\n`);

  if (outputFiles.length === 0) {
    process.stdout.write('[MIGRATE] Nothing to migrate. Exiting.\n');
    rl.close();
    process.exit(0);
  }

  // -- Process each output file --
  const mappings = [];
  const orphans = [];
  const now = isoNow();
  let counter = 1;

  for (const outputAbs of outputFiles) {
    const baseName = path.basename(outputAbs);
    const subfolderKeys = inferInputSubfolders(baseName, inputSubfolders);
    const candidates = findInputCandidates(subfolderKeys, inputSubfolders, inputRoot);

    let selectedInput = null;
    let confidence = 0;

    if (candidates.length === 0) {
      process.stdout.write(`[MIGRATE] ORPHAN (no input candidates): ${baseName}\n`);
      orphans.push(outputAbs);
    } else if (candidates.length === 1) {
      selectedInput = candidates[0];
      confidence = 95;
      process.stdout.write(`[MIGRATE] AUTO-LINK (95%): ${baseName} → ${normalizePath(candidates[0])}\n`);
    } else {
      // Multiple candidates
      if (autoLock) {
        process.stdout.write(
          `[MIGRATE] MULTI-CANDIDATE (${candidates.length}) for ${baseName} — ` +
          `auto-lock mode: marking as orphan with placeholder.\n`
        );
        orphans.push(outputAbs);
      } else {
        selectedInput = await promptUserSelect(baseName, candidates);
        if (!selectedInput) {
          process.stdout.write(`[MIGRATE] Skipped (orphan): ${baseName}\n`);
          orphans.push(outputAbs);
        } else {
          confidence = 100;
          process.stdout.write(`[MIGRATE] HUMAN-SELECTED: ${baseName} → ${normalizePath(selectedInput)}\n`);
        }
      }
    }

    const id = mapId(counter++);
    const entry = buildMappingEntry(id, outputAbs, selectedInput, config, now);
    if (confidence > 0) {
      entry.versions[0].lock_notes =
        `migration — ${confidence}% confidence link — existing output preserved as LOCKED v1`;
    }
    mappings.push(entry);
  }

  // -- Summary --
  process.stdout.write(`\n[MIGRATE] Migration plan summary:\n`);
  process.stdout.write(`  Total outputs:   ${outputFiles.length}\n`);
  process.stdout.write(`  Linked:          ${outputFiles.length - orphans.length}\n`);
  process.stdout.write(`  Orphans:         ${orphans.length}\n`);
  if (orphans.length > 0) {
    process.stdout.write(`  Orphan files:\n`);
    for (const o of orphans) {
      process.stdout.write(`    - ${normalizePath(o)}\n`);
    }
  }

  if (dryRun) {
    process.stdout.write('\n[MIGRATE] DRY-RUN complete. No files written.\n');
    rl.close();
    process.exit(0);
  }

  // -- Write files --

  // 1. Create directories
  fs.mkdirSync(absPmBaDir, { recursive: true });
  fs.mkdirSync(absSnapshotsDir, { recursive: true });

  // 2. Snapshot BEFORE mutation (fix MED: snapshot pre/post batch mutation)
  try {
    snapshotAndRotate(absMappingPath, 'pre-migration');
    process.stdout.write('[MIGRATE] Pre-migration snapshot created.\n');
  } catch (snapshotErr) {
    // io-mapping.json may not exist yet on first run — log warn and continue
    process.stdout.write(
      `[MIGRATE] WARN: Pre-migration snapshot skipped (${snapshotErr.message})\n`
    );
  }

  // 3. Atomic read-modify-write io-mapping.json (fix MED: replaces direct writeFileSync)
  const mappingContent = {
    schema_version: 1,
    generated_at: now,
    config: {
      input_root: normalizePath(inputRoot),       // fix MED: normalizePath on stored paths
      output_root: normalizePath(outputRoot),
      human_export_root: normalizePath(config.human_export_root || ''),
    },
    mappings,
    audit_log_path: normalizePath(auditLogPath),  // fix MED: normalizePath on stored paths
  };

  await atomicReadModifyWrite(absMappingPath, (_current) => {
    // Always overwrite — migration produces authoritative initial state
    return JSON.stringify(mappingContent, null, 2);
  });
  process.stdout.write(`[MIGRATE] Written: ${normalizePath(absMappingPath)}\n`);

  // 4. Snapshot AFTER mutation (fix MED: post-migration snapshot)
  try {
    snapshotAndRotate(absMappingPath, 'post-migration');
    process.stdout.write('[MIGRATE] Post-migration snapshot created.\n');
  } catch (snapshotErr) {
    process.stdout.write(
      `[MIGRATE] WARN: Post-migration snapshot failed (${snapshotErr.message})\n`
    );
  }

  // 5. Per-MAP audit entries (fix MED: granular CREATE events per mapping)
  for (const mapping of mappings) {
    const inputBasename = mapping.input_path !== 'ORPHAN'
      ? path.basename(mapping.input_path)
      : 'ORPHAN';
    try {
      appendAudit(absAuditPath, {
        actor: 'script',
        event_type: 'CREATE',
        map_id: mapping.map_id,
        version: 1,
        details: `migration: input=${inputBasename}`,
      });
    } catch (auditErr) {
      process.stdout.write(`[MIGRATE] WARN: Audit entry failed for ${mapping.map_id}: ${auditErr.message}\n`);
    }
  }

  // 6. Bulk summary audit entry (retained for backward-compat — bulk overview)
  try {
    appendAudit(absAuditPath, {
      actor: 'script',
      event_type: 'MIGRATE',
      map_id: '',
      version: 1,
      details: `entries=${mappings.length} linked=${mappings.length - orphans.length} orphans=${orphans.length} dry_run=false auto_lock=${autoLock}`,
    });
  } catch (auditErr) {
    process.stdout.write(`[MIGRATE] WARN: Bulk audit entry failed: ${auditErr.message}\n`);
  }

  process.stdout.write(`[MIGRATE] Audit log: ${normalizePath(absAuditPath)}\n`);
  process.stdout.write('[MIGRATE] Migration complete.\n');

  rl.close();
  process.exit(0);
}

main().catch((e) => {
  if (rl) try { rl.close(); } catch (_) {}
  process.stderr.write(`[MIGRATE] Unhandled error: ${e.message}\n`);
  process.exit(1);
});
