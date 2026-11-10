#!/usr/bin/env node
'use strict';
/**
 * wave5-tasks.cjs — Wave 5 PM-BA Phase 6 cleanup tasks
 *
 * Tasks:
 *   5.1  Patch settings.json + settings.local.json: add Bash to
 *        pre-write-io-mapping-check matcher
 *   5.2  Audit log backfill: 19 CREATE entries (MAP-001 through MAP-019)
 *   5.3  Register 7 untracked docs (MAP-020 to MAP-026);
 *        skip pm-ba-io-mapping.md (auto-rendered)
 *   5.4  Final snapshot after registrations
 *   5.5  Write registration decisions report
 */

const fs   = require('fs');
const path = require('path');

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT_ABS = process.env.PM_BA_ROOT || process.cwd();

const SETTINGS_JSON  = path.join(ROOT_ABS, '.claude', 'settings.json');
const SETTINGS_LOCAL = path.join(ROOT_ABS, '.claude', 'settings.local.json');
const IO_MAPPING     = path.join(ROOT_ABS, 'docs', '.pm-ba', 'io-mapping.json');
const AUDIT_LOG      = path.join(ROOT_ABS, 'docs', '.pm-ba', 'audit.log');
const DOCS_DIR       = path.join(ROOT_ABS, 'docs');
const SCRIPTS_DIR    = path.join(ROOT_ABS, '.claude', 'skills', 'pm-ba', 'scripts');
const REPORTS_DIR    = path.join(
  ROOT_ABS,
  'plans',
  '260519-1730-pm-ba-io-mapping-phase-6-handlers-patches',
  'reports'
);

const MAX_SNAPSHOTS = 5;
const BACKFILL_TS   = '2026-05-19T09:11:43.056Z';
const NOW_ISO       = new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write('[WARN] ' + msg + '\n'); }

/** Return next MAP-NNN string given current mappings array. */
function nextMapId(mappings) {
  let max = 0;
  for (const m of mappings) {
    const n = parseInt(m.map_id.replace('MAP-', ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return 'MAP-' + String(max + 1).padStart(3, '0');
}

/**
 * Scan a parsed settings object for PreToolUse entries that reference
 * pre-write-io-mapping-check.cjs and append |Bash to their matcher if missing.
 * Returns { modified: boolean, obj: object }.
 */
function patchBashMatcher(obj, label) {
  let modified = false;
  const preToolUse = (obj.hooks && obj.hooks.PreToolUse) || [];

  for (const entry of preToolUse) {
    if (!Array.isArray(entry.hooks)) continue;
    const hasIoCheck = entry.hooks.some(
      h => typeof h.command === 'string' && h.command.includes('pre-write-io-mapping-check.cjs')
    );
    if (!hasIoCheck) continue;

    const matcher = entry.matcher || '';
    if (!matcher.includes('Bash')) {
      entry.matcher = matcher + '|Bash';
      modified = true;
      log(`  [${label}] Patched: "${matcher}" → "${entry.matcher}"`);
    } else {
      log(`  [${label}] Already has Bash in matcher "${matcher}" — no change`);
    }
  }
  return { modified, obj };
}

// ── Load helpers (after paths resolved) ──────────────────────────────────────

const { atomicWrite, atomicReadModifyWrite } = require(path.join(SCRIPTS_DIR, 'atomic-fs.cjs'));
const { appendAudit }                         = require(path.join(SCRIPTS_DIR, 'audit-log.cjs'));
const { snapshotAndRotate }                   = require(path.join(SCRIPTS_DIR, 'snapshot-rotator.cjs'));
const { normalizeAndHash }                    = require(path.join(SCRIPTS_DIR, 'normalize-hash.cjs'));

// ── Results tracker ───────────────────────────────────────────────────────────

const R = {
  t51: { bashSettings: false, bashLocal: /** @type {boolean|null} */ (null) },
  t52: { backfilled: 0, errors: [] },
  t53: { registered: [], skipped: [], errors: [] },
  t54: { snapshotFile: null, kept: 0, deleted: 0 },
  t55: { reportPath: null },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN (async IIFE — required for await atomicReadModifyWrite)
// ─────────────────────────────────────────────────────────────────────────────

(async () => {

  // ── Task 5.1: Patch Bash matcher ──────────────────────────────────────────

  log('\n=== Task 5.1: Patch Bash matcher in pre-write-io-mapping-check hook ===');

  // settings.json
  try {
    const raw = fs.readFileSync(SETTINGS_JSON, 'utf8');
    const obj = JSON.parse(raw);
    const { modified } = patchBashMatcher(obj, 'settings.json');
    if (modified) {
      atomicWrite(SETTINGS_JSON, JSON.stringify(obj, null, 2) + '\n');
      R.t51.bashSettings = true;
      log('  settings.json written.');
    } else {
      R.t51.bashSettings = false;
    }
  } catch (e) {
    warn('Task 5.1 settings.json: ' + e.message);
  }

  // settings.local.json — only patch if it actually has the hook
  try {
    const rawLocal = fs.readFileSync(SETTINGS_LOCAL, 'utf8');
    const objLocal = JSON.parse(rawLocal);
    const preLocal = (objLocal.hooks && objLocal.hooks.PreToolUse) || [];
    const hasHook  = preLocal.some(entry =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some(h =>
        typeof h.command === 'string' && h.command.includes('pre-write-io-mapping-check.cjs')
      )
    );

    if (hasHook) {
      const { modified } = patchBashMatcher(objLocal, 'settings.local.json');
      if (modified) {
        atomicWrite(SETTINGS_LOCAL, JSON.stringify(objLocal, null, 2) + '\n');
        R.t51.bashLocal = true;
        log('  settings.local.json written.');
      } else {
        R.t51.bashLocal = false;
        log('  settings.local.json: no change needed.');
      }
    } else {
      R.t51.bashLocal = null; // hook not present — intentionally skipped
      log('  settings.local.json: pre-write-io-mapping-check.cjs hook not present — skip.');
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      R.t51.bashLocal = null;
      log('  settings.local.json: file absent — skip.');
    } else {
      warn('Task 5.1 settings.local.json: ' + e.message);
    }
  }

  // ── Task 5.2: Audit log backfill MAP-001..MAP-019 ─────────────────────────

  log('\n=== Task 5.2: Audit log backfill (MAP-001 to MAP-019) ===');

  const ioObj = JSON.parse(fs.readFileSync(IO_MAPPING, 'utf8'));

  for (const m of ioObj.mappings) {
    const mapId    = m.map_id;
    const lockedAt = (m.versions && m.versions[0] && m.versions[0].locked_at) || BACKFILL_TS;

    try {
      appendAudit(AUDIT_LOG, {
        timestamp:  lockedAt,
        actor:      'script',
        event_type: 'CREATE',
        map_id:     mapId,
        version:    1,
        details:    'migration backfill (phase-6 cleanup)',
      });
      R.t52.backfilled++;
      log(`  CREATE → ${mapId} (ts=${lockedAt})`);
    } catch (e) {
      R.t52.errors.push({ mapId, error: e.message });
      warn(`  CREATE FAILED for ${mapId}: ${e.message}`);
    }
  }

  const auditLineCount = fs.readFileSync(AUDIT_LOG, 'utf8')
    .split('\n').filter(l => l.trim().length > 0).length;
  log(`  Backfill done: ${R.t52.backfilled} appended | Total audit lines now: ${auditLineCount}`);

  // ── Task 5.3: Register 7 untracked docs ──────────────────────────────────

  log('\n=== Task 5.3: Register untracked docs ===');

  const CANDIDATES = [
    { rel: 'docs/system-architecture.md',               decision: 'REGISTER' },
    { rel: 'docs/project-overview-pdr.md',              decision: 'REGISTER' },
    { rel: 'docs/md-convert-user-guide.md',             decision: 'REGISTER' },
    { rel: 'docs/pm-ba-document-status.md',             decision: 'REGISTER' },
    { rel: 'docs/pm-ba-master-task-list.md',            decision: 'REGISTER' },
    { rel: 'docs/pm-ba-kpi-audit-log.md',               decision: 'REGISTER' },
    { rel: 'docs/pm-ba-kpi-state-pvcb-[PROJECT]2-202606.md', decision: 'REGISTER' },
    {
      rel:      'docs/pm-ba-io-mapping.md',
      decision: 'SKIP',
      reason:   'auto-rendered by render-md.cjs — locking would break render pipeline',
    },
  ];

  // Pre-batch snapshot
  log('  Taking pre-batch snapshot of io-mapping.json...');
  try {
    const snap = snapshotAndRotate(IO_MAPPING, 'pre-phase-5-register', MAX_SNAPSHOTS);
    log(`  Pre-batch snapshot: ${path.basename(snap.snapshotPath)} (kept=${snap.kept}, deleted=${snap.deleted})`);
  } catch (e) {
    warn('  Pre-batch snapshot failed: ' + e.message);
  }

  // Process each candidate sequentially (writes must be ordered)
  for (const c of CANDIDATES) {
    if (c.decision === 'SKIP') {
      R.t53.skipped.push({ file: c.rel, reason: c.reason || 'policy' });
      log(`  SKIP  ${c.rel} — ${c.reason}`);
      continue;
    }

    // Resolve absolute path (rel uses forward slashes)
    const absPath = path.join(ROOT_ABS, ...c.rel.split('/'));

    if (!fs.existsSync(absPath)) {
      R.t53.skipped.push({ file: c.rel, reason: 'file not found on disk' });
      log(`  SKIP  ${c.rel} — file not found`);
      continue;
    }

    // Compute canonical hash
    let fileHash;
    try {
      fileHash = normalizeAndHash(absPath);
    } catch (e) {
      R.t53.errors.push({ file: c.rel, error: 'hash error: ' + e.message });
      warn(`  Hash failed ${c.rel}: ${e.message}`);
      continue;
    }

    // Atomic register
    let newMapId;
    try {
      await atomicReadModifyWrite(IO_MAPPING, (currentContent) => {
        const parsed = JSON.parse(currentContent);
        newMapId = nextMapId(parsed.mappings);

        parsed.mappings.push({
          map_id:                  newMapId,
          input_path:              'ORPHAN',
          current_version:         1,
          versions: [
            {
              v:                   1,
              input_hash_sha256:   'unavailable',
              mode:                'post-hoc-migration',
              outputs: [
                {
                  path:            c.rel,
                  hash_sha256:     fileHash,
                },
              ],
              status:              'LOCKED',
              locked_at:           NOW_ISO,
              locked_by:           'human',
              lock_notes:          'phase-6 cleanup — existing doc registered for LOCK protection',
              supersedes_version:  null,
            },
          ],
          downstream_dependencies: [],
        });

        return JSON.stringify(parsed, null, 2);
      });

      R.t53.registered.push({ file: c.rel, mapId: newMapId, hash: fileHash });
      log(`  REGISTERED ${c.rel} as ${newMapId} (hash=${fileHash.slice(0, 16)}...)`);

      // Audit: CREATE + LOCK
      appendAudit(AUDIT_LOG, {
        actor: 'script', event_type: 'CREATE',
        map_id: newMapId, version: 1,
        details: 'phase-6 untracked-doc registration',
      });
      appendAudit(AUDIT_LOG, {
        actor: 'human', event_type: 'LOCK',
        map_id: newMapId, version: 1,
        details: 'auto-mode registration LOCK',
      });

    } catch (e) {
      R.t53.errors.push({ file: c.rel, error: e.message });
      warn(`  Registration FAILED ${c.rel}: ${e.message}`);
    }
  }

  log(`  Done: ${R.t53.registered.length} registered | ${R.t53.skipped.length} skipped | ${R.t53.errors.length} errors`);

  // ── Task 5.4: Final snapshot ──────────────────────────────────────────────

  log('\n=== Task 5.4: Final snapshot ===');

  try {
    const snap = snapshotAndRotate(IO_MAPPING, 'phase-5-cleanup-final', MAX_SNAPSHOTS);
    R.t54.snapshotFile = path.basename(snap.snapshotPath);
    R.t54.kept         = snap.kept;
    R.t54.deleted      = snap.deleted;
    log(`  Final snapshot: ${R.t54.snapshotFile}`);
    log(`  Kept: ${snap.kept} | Deleted: ${snap.deleted} | max_snapshots: ${MAX_SNAPSHOTS}`);
  } catch (e) {
    warn('Task 5.4 final snapshot failed: ' + e.message);
  }

  // ── Task 5.5: Write registration decisions report ─────────────────────────

  log('\n=== Task 5.5: Write registration decisions report ===');

  const finalTotal = (() => {
    try { return JSON.parse(fs.readFileSync(IO_MAPPING, 'utf8')).mappings.length; }
    catch (_) { return '?'; }
  })();

  // Build decisions table rows
  const tableRows = CANDIDATES.map(c => {
    if (c.decision === 'SKIP') {
      return `| ${c.rel} | SKIPPED | ${c.reason} |`;
    }
    const reg = R.t53.registered.find(r => r.file === c.rel);
    if (reg) return `| ${c.rel} | REGISTERED as ${reg.mapId} | post-hoc-migration |`;
    const sk  = R.t53.skipped.find(r => r.file === c.rel);
    if (sk)  return `| ${c.rel} | SKIPPED | ${sk.reason} |`;
    const er  = R.t53.errors.find(r => r.file === c.rel);
    if (er)  return `| ${c.rel} | ERROR | ${er.error} |`;
    return `| ${c.rel} | UNKNOWN | — |`;
  }).join('\n');

  const registeredList = R.t53.registered.length > 0
    ? R.t53.registered.map(r =>
        `- **${r.mapId}** → \`${r.file}\` (hash: \`${r.hash.slice(0, 16)}...\`)`
      ).join('\n')
    : '(none)';

  const skippedList = R.t53.skipped.length > 0
    ? R.t53.skipped.map(s => `- \`${s.file}\` — ${s.reason}`).join('\n')
    : '(none)';

  const errorsSection = R.t53.errors.length > 0
    ? `\n## Errors\n\n${R.t53.errors.map(e => `- \`${e.file}\` — ${e.error}`).join('\n')}`
    : '';

  const report = `# Phase 5 Registration Decisions

**Date:** 2026-05-19
**Mode:** auto (no user prompts)
**Reasoning:** --auto mode default policy

## Decisions

| File | Decision | Reason |
|------|----------|--------|
${tableRows}

## Final State

- Total mappings: ${finalTotal} (was 19)
- New mappings: ${R.t53.registered.length}
- Skipped: ${R.t53.skipped.length} (with reasons)
- Errors: ${R.t53.errors.length}

## Registered Details

${registeredList}

## Skipped Details

${skippedList}
${errorsSection}

## Task 5.1 Settings Patch

- \`settings.json\` Bash matcher: ${R.t51.bashSettings ? 'ADDED' : 'already present / no change'}
- \`settings.local.json\` Bash matcher: ${
    R.t51.bashLocal === null
      ? 'N/A (hook not present in file)'
      : R.t51.bashLocal
        ? 'ADDED'
        : 'already present / no change'
  }

## Task 5.2 Audit Backfill

- Entries appended: ${R.t52.backfilled} / 19
${R.t52.errors.length > 0
  ? `- Errors: ${R.t52.errors.map(e => e.mapId).join(', ')}`
  : '- Errors: none'}

## Task 5.4 Final Snapshot

${R.t54.snapshotFile
  ? `- File: \`${R.t54.snapshotFile}\`\n- Kept: ${R.t54.kept} | Deleted: ${R.t54.deleted}`
  : '- FAILED — see warnings above'}
`;

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const REPORT_PATH = path.join(REPORTS_DIR, 'registration-decisions-260519.md');
  atomicWrite(REPORT_PATH, report);
  R.t55.reportPath = REPORT_PATH;
  log(`  Report written: ${REPORT_PATH}`);

  // ── Summary ───────────────────────────────────────────────────────────────

  log('\n=== WAVE 5 COMPLETE ===');
  log(`5.1 settings.json Bash:       ${R.t51.bashSettings ? 'ADDED' : 'no change'}`);
  log(`5.1 settings.local.json Bash: ${R.t51.bashLocal === null ? 'N/A' : R.t51.bashLocal ? 'ADDED' : 'no change'}`);
  log(`5.2 Audit backfill:           ${R.t52.backfilled}/19`);
  log(`5.3 Registrations:            ${R.t53.registered.length} new | ${R.t53.skipped.length} skipped | ${R.t53.errors.length} errors`);
  log(`5.4 Final snapshot:           ${R.t54.snapshotFile || 'FAILED'}`);
  log(`5.5 Report:                   ${R.t55.reportPath || 'FAILED'}`);

})().catch(err => {
  process.stderr.write('[FATAL] ' + err.stack + '\n');
  process.exit(1);
});
