#!/usr/bin/env node
'use strict';
/**
 * audit-log.cjs — Per-MAP structured audit logging for PM-BA skill.
 *
 * Line format (6 fields, ' | ' separator):
 *   ISO_TS | actor | event_type | map_id | v=N | details
 *
 * Exports: { EVENT_TYPES, appendAudit, parseAuditLog, eventsByMap, eventsByType }
 * CLI:     node audit-log.cjs --log <path> [--filter map=ID|type=EVENT]
 *          node audit-log.cjs --test
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @type {Readonly<string[]>} All valid audit event types. */
const EVENT_TYPES = Object.freeze([
  'CREATE', 'LOCK', 'UNLOCK', 'SUPERSEDE',
  'ACCEPT_PASS', 'ACCEPT_FAIL',
  'STALE_INPUT_DETECTED', 'STALE_OUTPUT_DETECTED',
  'VALIDATE_OK', 'VALIDATE_FAIL',
  'ROLLBACK', 'MIGRATE', 'LOCK_BLOCKED', 'BYPASS_USED',
]);

const VALID_ACTORS = ['human', 'script', 'hook'];
const SEP = ' | ';

// ---------------------------------------------------------------------------
// appendAudit
// ---------------------------------------------------------------------------

/**
 * Append a single audit event to the log file (atomic per-write via O_APPEND).
 * Creates log dir if missing. Throws on invalid event_type or actor.
 *
 * @param {string} logPath
 * @param {{ timestamp?: string, actor: string, event_type: string, map_id?: string, version?: number, details?: string }} event
 */
function appendAudit(logPath, event) {
  const { actor, event_type, map_id, version, details } = event;
  const ts = event.timestamp || new Date().toISOString();

  if (!EVENT_TYPES.includes(event_type))
    throw new Error(`[audit-log] Invalid event_type "${event_type}". Valid: ${EVENT_TYPES.join(', ')}`);
  if (!VALID_ACTORS.includes(actor))
    throw new Error(`[audit-log] Invalid actor "${actor}". Valid: ${VALID_ACTORS.join(', ')}`);

  const line = [ts, actor, event_type, map_id ?? '', version != null ? `v=${version}` : '', details ?? ''].join(SEP) + '\n';
  fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
  fs.appendFileSync(logPath, line, { flag: 'a' });
}

// ---------------------------------------------------------------------------
// parseAuditLog
// ---------------------------------------------------------------------------

/**
 * Parse all valid 6-field audit lines. Malformed/legacy lines are skipped with console.warn.
 *
 * @param {string} logPath
 * @returns {Array<{ timestamp: string, actor: string, event_type: string, map_id: string, version: number|null, details: string }>}
 */
function parseAuditLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  const results = [];
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)) {
    const parts = line.split(SEP);
    if (parts.length !== 6) {
      console.warn(`[audit-log] Skipping malformed line (${parts.length} fields): ${line.slice(0, 80)}`);
      continue;
    }
    const [timestamp, actor, event_type, map_id, vRaw, details] = parts;
    if (isNaN(Date.parse(timestamp))) {
      console.warn(`[audit-log] Skipping line with invalid timestamp: ${timestamp}`);
      continue;
    }
    const vn = vRaw.startsWith('v=') ? parseInt(vRaw.slice(2), 10) : NaN;
    results.push({ timestamp, actor, event_type, map_id, version: isNaN(vn) ? null : vn, details });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

/** @param {string} logPath @param {string} mapId @returns {Array<object>} */
function eventsByMap(logPath, mapId) { return parseAuditLog(logPath).filter((e) => e.map_id === mapId); }

/** @param {string} logPath @param {string} eventType @returns {Array<object>} */
function eventsByType(logPath, eventType) { return parseAuditLog(logPath).filter((e) => e.event_type === eventType); }

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { EVENT_TYPES, appendAudit, parseAuditLog, eventsByMap, eventsByType };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    const tmpLog = require('path').join(require('os').tmpdir(), `audit-log-test-${Date.now()}.log`);
    for (let i = 0; i < 100; i++) {
      appendAudit(tmpLog, {
        actor: VALID_ACTORS[i % 3],
        event_type: EVENT_TYPES[i % EVENT_TYPES.length],
        map_id: `MAP-${String(i % 5 + 1).padStart(3, '0')}`,
        version: i + 1,
        details: `test event #${i}`,
      });
    }
    const events = parseAuditLog(tmpLog);
    if (events.length !== 100) { process.stderr.write(`FAIL — expected 100, got ${events.length}\n`); process.exit(1); }

    // Verify append order
    for (let i = 1; i < events.length; i++) {
      if (events[i].timestamp < events[i - 1].timestamp) { process.stderr.write('FAIL — events not in append order\n'); process.exit(1); }
    }

    // Verify invalid type throws
    let threw = false;
    try { appendAudit(tmpLog, { actor: 'script', event_type: 'FAKE_TYPE' }); } catch (_) { threw = true; }
    if (!threw) { process.stderr.write('FAIL — appendAudit did not throw on FAKE_TYPE\n'); process.exit(1); }

    fs.unlinkSync(tmpLog);
    process.stdout.write(`PASS — ${events.length}/100 events\n`);
    process.exit(0);
  }

  const logIdx = args.indexOf('--log');
  if (logIdx === -1 || !args[logIdx + 1]) {
    process.stderr.write('Usage: node audit-log.cjs --log <path> [--filter map=ID|type=EVENT]\n       node audit-log.cjs --test\n');
    process.exit(1);
  }
  const logPath = args[logIdx + 1];
  const filterIdx = args.indexOf('--filter');
  let events;
  if (filterIdx !== -1 && args[filterIdx + 1]) {
    const [key, val] = args[filterIdx + 1].split('=');
    if      (key === 'map')  events = eventsByMap(logPath, val);
    else if (key === 'type') events = eventsByType(logPath, val);
    else { process.stderr.write(`Unknown filter key "${key}". Use map or type.\n`); process.exit(1); }
  } else {
    events = parseAuditLog(logPath);
  }
  process.stdout.write(JSON.stringify(events, null, 2) + '\n');
}
