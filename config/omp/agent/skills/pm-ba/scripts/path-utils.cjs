#!/usr/bin/env node
'use strict';
/**
 * path-utils.cjs
 *
 * Windows-safe path normalization and comparison utilities for the PM-BA skill.
 * Solves cross-drive `path.relative` breakage on Windows (e.g. Google Drive G:\ vs C:\).
 *
 * Exports: { normalizePath, samePath, relativeToConfig, resolveConfigPath, isInsideDir, CrossDriveError }
 * CLI:
 *   node path-utils.cjs --normalize '<path>'
 *   node path-utils.cjs --same <a> <b>
 *   node path-utils.cjs --test
 */

const path = require('path');

// ---------------------------------------------------------------------------
// CrossDriveError
// ---------------------------------------------------------------------------

class CrossDriveError extends Error {
  /**
   * @param {string} driveA
   * @param {string} driveB
   */
  constructor(driveA, driveB) {
    super(`Cross-drive operation not supported: ${driveA} vs ${driveB}`);
    this.name = 'CrossDriveError';
    this.driveA = driveA;
    this.driveB = driveB;
  }
}

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

/**
 * Normalize a filesystem path to a canonical form:
 *   - Backslashes → forward slashes
 *   - Drive letter lowercased (Windows)
 *   - Collapse multiple consecutive slashes (except UNC prefix)
 *   - Strip trailing slash unless root (e.g. 'c:/' or '/')
 *   - Preserve spaces and path component casing
 *
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  if (!p) return p;
  let s = String(p);

  // Detect and strip UNC prefix (\\server or //server)
  const uncMatch = s.match(/^(\\\\|\/\/)([^\\\/]+)/);
  let uncPrefix = '';
  if (uncMatch) {
    uncPrefix = '//' + uncMatch[2];
    s = s.slice(uncMatch[0].length);
  }

  // Backslashes → forward slashes
  s = s.replace(/\\/g, '/');

  // Lowercase drive letter
  if (/^[A-Za-z]:/.test(s)) {
    s = s[0].toLowerCase() + s.slice(1);
  }

  // Collapse multiple slashes
  s = s.replace(/\/+/g, '/');

  // Strip trailing slash — but keep 'c:/' and '/'
  if (s.length > 1 && s.endsWith('/') && !/^[a-z]:\/$/.test(s) && s !== '/') {
    s = s.slice(0, -1);
  }

  return uncPrefix + s;
}

// ---------------------------------------------------------------------------
// samePath
// ---------------------------------------------------------------------------

/**
 * Return true if two paths resolve to the same normalized form.
 * Note: only drive letter is lowercased; path component casing is preserved.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function samePath(a, b) {
  return normalizePath(a) === normalizePath(b);
}

// ---------------------------------------------------------------------------
// Helpers: drive extraction
// ---------------------------------------------------------------------------

/**
 * Extract drive letter (lowercase, no colon) from a normalized path, or null.
 * @param {string} normalized
 * @returns {string|null}
 */
function _extractDrive(normalized) {
  const m = normalized.match(/^([a-z]):/);
  return m ? m[1] : null;
}

/**
 * Extract UNC server from a normalized path (starts with '//'), or null.
 * @param {string} normalized
 * @returns {string|null}
 */
function _extractUncServer(normalized) {
  const m = normalized.match(/^\/\/([^/]+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// relativeToConfig
// ---------------------------------------------------------------------------

/**
 * Compute a normalized relative path from configBase to absPath.
 * Throws CrossDriveError if the paths are on different drives/UNC servers.
 *
 * @param {string} absPath
 * @param {string} configBase
 * @returns {string}  forward-slash relative path
 * @throws {CrossDriveError}
 */
function relativeToConfig(absPath, configBase) {
  const normAbs  = normalizePath(absPath);
  const normBase = normalizePath(configBase);

  const driveAbs  = _extractDrive(normAbs);
  const driveBase = _extractDrive(normBase);

  // Both Windows paths — must share drive
  if (driveAbs !== null || driveBase !== null) {
    if (driveAbs === null || driveBase === null || driveAbs !== driveBase) {
      throw new CrossDriveError(
        driveAbs  ? driveAbs  + ':' : (normAbs  || '(no drive)'),
        driveBase ? driveBase + ':' : (normBase || '(no drive)')
      );
    }
    return normalizePath(path.relative(configBase, absPath));
  }

  // Both UNC paths — must share server
  const serverAbs  = _extractUncServer(normAbs);
  const serverBase = _extractUncServer(normBase);
  if (serverAbs !== null || serverBase !== null) {
    if (serverAbs !== serverBase) {
      throw new CrossDriveError(
        serverAbs  ? '//' + serverAbs  : normAbs,
        serverBase ? '//' + serverBase : normBase
      );
    }
    return normalizePath(path.relative(configBase, absPath));
  }

  // POSIX paths — no drive check needed
  return normalizePath(path.relative(configBase, absPath));
}

// ---------------------------------------------------------------------------
// resolveConfigPath
// ---------------------------------------------------------------------------

/**
 * Expand template variables like ${INPUT_ROOT} using config values, then
 * resolve to an absolute path.
 *
 * @param {string} template  e.g. '${INPUT_ROOT}/brd'
 * @param {Object} config    e.g. { input_root: '/x/y' }
 * @returns {string}         absolute path (OS native separators from path.resolve)
 */
function resolveConfigPath(template, config) {
  const expanded = template.replace(/\$\{([A-Z_]+)\}/g, (_, key) => {
    const lower = key.toLowerCase();
    return (config[lower] !== undefined ? config[lower] : config[key]) ?? '';
  });
  return path.resolve(expanded);
}

// ---------------------------------------------------------------------------
// isInsideDir
// ---------------------------------------------------------------------------

/**
 * Return true if child is equal to or inside parent directory.
 * Boundary-safe: '/foobar' is NOT inside '/foo'.
 *
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
function isInsideDir(child, parent) {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  // Ensure parent ends with exactly one slash for prefix check
  const prefix = p.endsWith('/') ? p : p + '/';
  return c === p || c.startsWith(prefix);
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  normalizePath,
  samePath,
  relativeToConfig,
  resolveConfigPath,
  isInsideDir,
  CrossDriveError,
};

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--normalize' && args[1]) {
    process.stdout.write(normalizePath(args[1]) + '\n');
    process.exit(0);
  }

  if (args[0] === '--same' && args[1] && args[2]) {
    process.stdout.write(String(samePath(args[1], args[2])) + '\n');
    process.exit(0);
  }

  if (args[0] === '--test') {
    let passed = 0;
    let failed = 0;

    function assert(label, actual, expected) {
      if (actual === expected) {
        process.stdout.write(`  PASS  ${label}\n`);
        passed++;
      } else {
        process.stdout.write(`  FAIL  ${label}\n         expected: ${JSON.stringify(expected)}\n         actual:   ${JSON.stringify(actual)}\n`);
        failed++;
      }
    }

    function assertThrows(label, fn, errorName) {
      try {
        fn();
        process.stdout.write(`  FAIL  ${label} — expected throw, got none\n`);
        failed++;
      } catch (e) {
        if (errorName && e.name !== errorName) {
          process.stdout.write(`  FAIL  ${label} — expected ${errorName}, got ${e.name}: ${e.message}\n`);
          failed++;
        } else {
          process.stdout.write(`  PASS  ${label} (threw ${e.name}: ${e.message})\n`);
          passed++;
        }
      }
    }

    process.stdout.write('--- normalizePath ---\n');
    assert('Windows backslash + spaces', normalizePath('G:\\My Drive\\02.SM_Drive\\foo'), 'g:/My Drive/02.SM_Drive/foo');
    assert('Double slash collapsed + trailing strip', normalizePath('C:/foo//bar/'), 'c:/foo/bar');
    assert('UNC preserved', normalizePath('//server/share/foo'), '//server/share/foo');
    assert('UNC backslash prefix', normalizePath('\\\\server\\share\\foo'), '//server/share/foo');
    assert('Root drive preserved', normalizePath('C:/'), 'c:/');
    assert('POSIX root', normalizePath('/'), '/');

    process.stdout.write('--- samePath ---\n');
    assert('Case diff in component → false', samePath('C:\\Foo', 'c:/foo'), false);
    assert('Drive lower + same component → true', samePath('C:\\Foo', 'c:/Foo'), true);
    assert('Same POSIX path', samePath('/foo/bar', '/foo/bar'), true);

    process.stdout.write('--- relativeToConfig ---\n');
    assertThrows('Cross-drive throws', () => relativeToConfig('C:\\a\\b', 'G:\\x'), 'CrossDriveError');
    assert('Same drive relative', relativeToConfig('G:/My Drive/foo/bar', 'G:/My Drive/foo'), 'bar');
    assert('POSIX relative', relativeToConfig('/a/b/c', '/a/b'), 'c');

    process.stdout.write('--- resolveConfigPath ---\n');
    const resolved = resolveConfigPath('${INPUT_ROOT}/brd', { input_root: '/x/y' });
    // path.resolve may use OS separators; normalize for comparison
    assert('Template expansion absolute', normalizePath(resolved), normalizePath(path.resolve('/x/y/brd')));

    process.stdout.write('--- isInsideDir ---\n');
    assert('Child inside parent → true', isInsideDir('/foo/bar', '/foo'), true);
    assert('Boundary: /foobar not inside /foo', isInsideDir('/foobar', '/foo'), false);
    assert('Equal paths → true', isInsideDir('/foo', '/foo'), true);
    assert('Google Drive path inside', isInsideDir('g:/My Drive/02/docs/file.md', 'g:/My Drive/02/docs'), true);
    assert('Different branch → false', isInsideDir('/foo/other', '/foo/bar'), false);

    process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  }

  process.stderr.write('Usage:\n  node path-utils.cjs --normalize <path>\n  node path-utils.cjs --same <a> <b>\n  node path-utils.cjs --test\n');
  process.exit(1);
}
