#!/usr/bin/env node
'use strict';
/**
 * atomic-fs.cjs — Atomic write + advisory lock for pm-ba scripts.
 * Fix #4: fsync before rename (Google Drive sync / power-loss safety).
 * Fix #7: O_EXCL sentinel lock (concurrent-writer protection).
 *
 * Exports: { atomicWrite, atomicReadModifyWrite, acquireLock,
 *            AtomicWriteError, LockTimeoutError }
 * CLI:     node atomic-fs.cjs --test  →  concurrency smoke-test, exit 0=PASS
 * Exits:   0=ok  1=error  2=warning  3=lock-timeout
 */

const fs   = require('fs');
const path = require('path');

// Optional proper-lockfile — fallback to O_EXCL sentinel when absent
let lockfile = null;
try { lockfile = require('proper-lockfile'); }
catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }

// ── Error classes ────────────────────────────────────────────────────────────

class AtomicWriteError extends Error {
  constructor(msg, cause) { super(msg); this.name = 'AtomicWriteError'; this.cause = cause; }
}
class LockTimeoutError extends Error {
  constructor(msg) { super(msg); this.name = 'LockTimeoutError'; }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Async sleep. @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Unique tmp path alongside target. @param {string} fp @returns {string} */
function tmpPath(fp) {
  return `${fp}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Synchronously write `content` to `filePath` atomically:
 * write-to-tmp → fsync → rename, with EBUSY retry for Google Drive.
 * @param {string} filePath
 * @param {string} content  UTF-8 string
 * @param {{ fsync?: boolean, lockTimeoutMs?: number, mode?: number }} [opts]
 * @throws {AtomicWriteError}
 */
function atomicWrite(filePath, content, opts = {}) {
  const mode    = opts.mode !== undefined ? opts.mode : 0o644;
  const doFsync = opts.fsync !== false;
  const tmp     = tmpPath(filePath);

  // Ensure parent dir
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try { fs.writeFileSync(tmp, content, { mode, encoding: 'utf8' }); }
  catch (e) { throw new AtomicWriteError(`Failed to write tmp: ${tmp}`, e); }

  if (doFsync) {
    let fd;
    try { fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); }
    catch (_) { /* FAT32/network FS may not support fsync — non-fatal */ }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
  }

  // Rename with retry on EBUSY/EPERM/EACCES (Google Drive holds files briefly)
  const retryCodes = new Set(['EBUSY', 'EPERM', 'EACCES']);
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { fs.renameSync(tmp, filePath); return; }
    catch (e) {
      lastErr = e;
      if (!retryCodes.has(e.code)) break;
      const until = Date.now() + 200;
      while (Date.now() < until) {} // busy-wait 200 ms (sync context)
    }
  }
  try { fs.unlinkSync(tmp); } catch (_) {}
  throw new AtomicWriteError(`rename failed after retries: ${filePath}`, lastErr);
}

/**
 * Acquire an advisory lock on `filePath`.
 * Uses proper-lockfile when available; O_EXCL sentinel otherwise.
 * @param {string} filePath
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{ release: () => void }>}
 * @throws {LockTimeoutError}
 */
async function acquireLock(filePath, timeoutMs = 5000) {
  const abs = path.resolve(filePath);

  if (lockfile) {
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, '', { flag: 'a' });
    try {
      const release = await lockfile.lock(abs, {
        retries: { retries: 50, factor: 1, minTimeout: 100, maxTimeout: 100 },
        stale: 10000,
      });
      return { release };
    } catch (e) { throw new LockTimeoutError(`Lock timeout on ${filePath}: ${e.message}`); }
  }

  // Fallback: O_EXCL sentinel file
  const sentinel = `${abs}.lock`;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const fd = fs.openSync(sentinel, 'wx'); // fails with EEXIST if locked
      fs.closeSync(fd);
      return { release: () => { try { fs.unlinkSync(sentinel); } catch (_) {} } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() >= deadline) throw new LockTimeoutError(`Lock timeout (${timeoutMs}ms) on ${filePath}`);
      await sleep(100);
    }
  }
}

/**
 * Acquire lock → read current content (null if absent) → mutate → atomic write.
 * `mutatorFn(current: string|null) => string`  (return new content).
 * @param {string} filePath
 * @param {(current: string|null) => string} mutatorFn
 * @param {{ fsync?: boolean, lockTimeoutMs?: number, mode?: number }} [opts]
 */
async function atomicReadModifyWrite(filePath, mutatorFn, opts = {}) {
  const timeoutMs = opts.lockTimeoutMs !== undefined ? opts.lockTimeoutMs : 5000;
  const lock = await acquireLock(filePath, timeoutMs);
  try {
    let current = null;
    try { current = fs.readFileSync(path.resolve(filePath), 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    atomicWrite(filePath, mutatorFn(current), opts);
  } finally { lock.release(); }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { atomicWrite, atomicReadModifyWrite, acquireLock, AtomicWriteError, LockTimeoutError };

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] !== '--test') { process.stderr.write('Usage: node atomic-fs.cjs --test\n'); process.exit(1); }

  // Concurrency smoke-test: 50 parallel atomicWrite calls to same file.
  // Asserts final content is exactly one of the submitted payloads.
  (async () => {
    const os = require('os');
    const target   = path.join(os.tmpdir(), `atomic-fs-test-${process.pid}.txt`);
    const payloads = Array.from({ length: 50 }, (_, i) => `payload-${i}`);
    try {
      await Promise.allSettled(payloads.map((p) => Promise.resolve().then(() => atomicWrite(target, p))));
      const final = fs.readFileSync(target, 'utf8').replace(/\n$/, '').trim();
      try { fs.unlinkSync(target); } catch (_) {}
      if (payloads.includes(final)) { process.stdout.write('PASS\n'); process.exit(0); }
      process.stderr.write(`FAIL: unexpected content: ${JSON.stringify(final)}\n`);
      process.exit(1);
    } catch (e) { process.stderr.write(`FAIL: ${e.message}\n`); process.exit(1); }
  })();
}
