#!/usr/bin/env node
'use strict';
/**
 * snapshot-rotator.cjs
 *
 * Snapshot creation + rotation utility for PM-BA IO-mapping.
 * Fixes HIGH bug #5: max_snapshots config exists but rotation was never
 * implemented, causing unbounded disk growth.
 *
 * Exports: { createSnapshot, rotateSnapshots, snapshotAndRotate }
 * CLI: node snapshot-rotator.cjs --src <path> [--reason text] [--max N] [--dry-run]
 *      node snapshot-rotator.cjs --test
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Config loader (fail-soft: returns defaults if config missing)
// ---------------------------------------------------------------------------

let _cachedConfig = null;

function loadConfig() {
  if (_cachedConfig) return _cachedConfig;

  const candidates = [
    path.resolve(__dirname, '../../../pm-ba.config.json'),          // scripts → .claude
    path.resolve(process.cwd(), '.claude/pm-ba.config.json'),
    path.resolve(process.cwd(), 'pm-ba.config.json'),
  ];

  // Walk up from CWD looking for .claude/pm-ba.config.json
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, '.claude', 'pm-ba.config.json'));
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

  // Defaults when config is unavailable
  _cachedConfig = { io_mapping: { max_snapshots: 5, snapshots_dir: null } };
  return _cachedConfig;
}

// ---------------------------------------------------------------------------
// Atomic write helper (uses ./atomic-fs.cjs if available, else copyFileSync)
// ---------------------------------------------------------------------------

function atomicWrite(destPath, content) {
  try {
    const atomicFs = require('./atomic-fs.cjs');
    atomicFs.atomicWrite(destPath, content);
    return;
  } catch (_) { /* fallback */ }

  const tmp = destPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, content);
  try { fs.fsyncSync(fs.openSync(tmp, 'r')); } catch (_) { /* non-fatal */ }
  fs.renameSync(tmp, destPath);
}

// ---------------------------------------------------------------------------
// Snapshot filename timestamp pattern
// ---------------------------------------------------------------------------

const SNAPSHOT_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[\.\d]*Z)/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a snapshot of srcFilePath inside snapshotsDir.
 *
 * Filename format: 2026-05-19T17-30-12.456Z-<safeReason>.json
 *
 * @param {string} srcFilePath   Absolute path to source file
 * @param {string} snapshotsDir  Directory to write snapshot into
 * @param {string} [reason]      Human-readable reason tag (default: 'manual')
 * @returns {string}             Absolute path of created snapshot file
 */
function createSnapshot(srcFilePath, snapshotsDir, reason = 'manual') {
  const ts = new Date().toISOString().replace(/:/g, '-');
  const safeReason = reason.replace(/[^a-z0-9-]/gi, '-').slice(0, 32);
  const filename = `${ts}-${safeReason}.json`;
  const destPath = path.resolve(snapshotsDir, filename);

  fs.mkdirSync(snapshotsDir, { recursive: true });

  const content = fs.readFileSync(path.resolve(srcFilePath));
  atomicWrite(destPath, content);

  return destPath;
}

/**
 * Rotate snapshots in snapshotsDir, keeping the newest maxSnapshots files.
 * Only files matching the snapshot timestamp pattern are managed; unknown
 * files are preserved untouched.
 *
 * @param {string} snapshotsDir  Directory containing snapshot files
 * @param {number} maxSnapshots  Number of snapshots to retain
 * @returns {{ kept: number, deleted: number, deletedFiles: string[] }}
 */
function rotateSnapshots(snapshotsDir, maxSnapshots) {
  if (!fs.existsSync(snapshotsDir)) {
    return { kept: 0, deleted: 0, deletedFiles: [] };
  }

  const allFiles = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json'));

  // Separate managed (matching pattern) from unmanaged
  const managed = [];
  for (const f of allFiles) {
    const m = SNAPSHOT_RE.exec(f);
    if (m) {
      // Parse: replace first 3 dashes-in-time back to colons for Date parsing
      const isoTs = m[1].replace(
        /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})/,
        '$1$2:$3:$4'
      );
      managed.push({ file: f, ts: new Date(isoTs) });
    }
  }

  // Sort newest first
  managed.sort((a, b) => b.ts - a.ts);

  const toDelete = managed.slice(maxSnapshots);
  const deletedFiles = [];

  for (const entry of toDelete) {
    const fullPath = path.join(snapshotsDir, entry.file);
    fs.unlinkSync(fullPath);
    deletedFiles.push(entry.file);
  }

  return {
    kept: managed.length - toDelete.length,
    deleted: toDelete.length,
    deletedFiles,
  };
}

/**
 * Convenience: create a snapshot then rotate in one call.
 *
 * @param {string} srcFilePath         Absolute path to source file
 * @param {string} [reason]            Reason tag (default: 'manual')
 * @param {number} [maxSnapshots]      Override max; reads config if omitted
 * @returns {{ snapshotPath: string, kept: number, deleted: number, deletedFiles: string[] }}
 */
function snapshotAndRotate(srcFilePath, reason = 'manual', maxSnapshots) {
  const cfg = loadConfig();
  const ioMapping = cfg.io_mapping || {};

  const max = maxSnapshots != null ? maxSnapshots : (ioMapping.max_snapshots || 5);

  // Resolve snapshotsDir: config-relative to project_root, else sibling of src
  let snapshotsDir;
  if (ioMapping.snapshots_dir) {
    const projectRoot = cfg.project_root || process.cwd();
    snapshotsDir = path.isAbsolute(ioMapping.snapshots_dir)
      ? ioMapping.snapshots_dir
      : path.resolve(projectRoot, ioMapping.snapshots_dir);
  } else {
    snapshotsDir = path.join(path.dirname(srcFilePath), 'snapshots');
  }

  const snapshotPath = createSnapshot(srcFilePath, snapshotsDir, reason);
  const rotation = rotateSnapshots(snapshotsDir, max);

  return { snapshotPath, ...rotation };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = { createSnapshot, rotateSnapshots, snapshotAndRotate };

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);

  // --test: smoke test
  if (args.includes('--test')) {
    const tmpDir = path.join(os.tmpdir(), 'snapshot-rotator-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    // Create a dummy source file
    const srcFile = path.join(tmpDir, 'source.json');
    fs.writeFileSync(srcFile, JSON.stringify({ test: true }));

    // Manufacture 8 fake snapshot files with 1-second apart timestamps
    const base = new Date('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 8; i++) {
      const d = new Date(base.getTime() + i * 1000);
      const ts = d.toISOString().replace(/:/g, '-');
      const fname = `${ts}-test-snap.json`;
      fs.writeFileSync(path.join(tmpDir, fname), '{}');
    }

    // Rotate with max=5
    const result = rotateSnapshots(tmpDir, 5);

    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (result.kept === 5 && result.deleted === 3) {
      process.stdout.write(`PASS — 5 kept, 3 deleted\n`);
      process.exit(0);
    } else {
      process.stderr.write(`FAIL — kept=${result.kept}, deleted=${result.deleted}\n`);
      process.exit(1);
    }
  }

  // --src mode
  const srcIdx = args.indexOf('--src');
  if (srcIdx === -1) {
    process.stderr.write(
      'Usage: node snapshot-rotator.cjs --src <path> [--reason text] [--max N] [--dry-run]\n' +
      '       node snapshot-rotator.cjs --test\n'
    );
    process.exit(1);
  }

  const srcFilePath = path.resolve(args[srcIdx + 1]);
  const reasonIdx = args.indexOf('--reason');
  const reason = reasonIdx !== -1 ? args[reasonIdx + 1] : 'manual';
  const maxIdx = args.indexOf('--max');
  const maxSnapshots = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : undefined;
  const dryRun = args.includes('--dry-run');

  try {
    if (dryRun) {
      const cfg = loadConfig();
      const ioMapping = cfg.io_mapping || {};
      const max = maxSnapshots != null ? maxSnapshots : (ioMapping.max_snapshots || 5);
      const projectRoot = cfg.project_root || process.cwd();
      const snapshotsDir = ioMapping.snapshots_dir
        ? (path.isAbsolute(ioMapping.snapshots_dir)
            ? ioMapping.snapshots_dir
            : path.resolve(projectRoot, ioMapping.snapshots_dir))
        : path.join(path.dirname(srcFilePath), 'snapshots');

      process.stdout.write(`[DRY-RUN] Would snapshot: ${srcFilePath}\n`);
      process.stdout.write(`[DRY-RUN] Snapshots dir: ${snapshotsDir}\n`);
      process.stdout.write(`[DRY-RUN] Reason: ${reason}, max_snapshots: ${max}\n`);
      process.exit(0);
    }

    const result = snapshotAndRotate(srcFilePath, reason, maxSnapshots);
    process.stdout.write(`Snapshot created: ${result.snapshotPath}\n`);
    process.stdout.write(`Kept: ${result.kept}, Deleted: ${result.deleted}\n`);
    if (result.deletedFiles.length) {
      process.stdout.write(`Deleted files: ${result.deletedFiles.join(', ')}\n`);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`[SNAPSHOT-ROTATOR] Error: ${e.message}\n`);
    process.exit(1);
  }
}
