#!/usr/bin/env node
'use strict';
/**
 * normalize-hash.cjs
 *
 * Canonical SHA-256 hasher for IO-mapping content comparison.
 * Hash stability depends on the EXACT normalization order below -- do not reorder.
 *
 * CANONICAL NORMALIZATION ORDER (must be preserved for hash stability):
 *   1. Strip BOMs -- UTF-8 (EF BB BF), UTF-16 BE (FE FF), UTF-16 LE (FF FE)
 *      Applied unconditionally on the decoded string.
 *   2. Normalize line endings -- CRLF -> LF, lone CR -> LF
 *   3. Strip Unicode line/paragraph separators -- U+2028, U+2029
 *      (Office-exported files may contain these; stripping ensures hash stability)
 *   4. Trim trailing whitespace per line -- removes trailing spaces/tabs
 *      (preserves leading indentation)
 *   5. Collapse final newlines -- ensures exactly one trailing \n
 *
 * Module exports: { normalizeAndHash, canonicalize, normalize, sha256 }
 *   normalize(buf) is kept for backward compatibility (calls canonicalize internally)
 *
 * CLI:
 *   node normalize-hash.cjs <file_path>            -> prints hex SHA-256
 *   node normalize-hash.cjs --canonicalize <path>  -> prints normalized content (no hash)
 *
 * Exit 0 = success, Exit 1 = error (file not found, etc.)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 * @param {string} str
 * @returns {string} lowercase hex
 */
function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Canonical text normalization for hash stability.
 *
 * Order matters -- do not reorder (see file header for rationale):
 *   1. Strip BOMs (UTF-8 EF BB BF, UTF-16 BE FE FF, UTF-16 LE FF FE)
 *   2. Normalize line endings: CRLF / CR -> LF
 *   3. Strip Unicode line separators: U+2028, U+2029
 *   4. Trim trailing whitespace per line (preserve indentation)
 *   5. Collapse final newlines to single trailing \n
 *
 * @param {string} content  decoded text (any line-ending convention)
 * @returns {string}        canonical UTF-8 string (ends with \n)
 */
function canonicalize(content) {
  var s = String(content);

  // 1. Strip BOMs unconditionally.
  // U+FEFF is the BOM codepoint shared by UTF-8 BOM (decoded) and UTF-16 BOM.
  // \xEF\xBB\xBF covers the case where the BOM bytes survived as Latin-1 escape chars.
  s = s.replace(/^﻿/, '');
  s = s.replace(/^\xEF\xBB\xBF/, ''); // redundant if already stripped above, harmless

  // 2. Normalize line endings: CRLF -> LF, lone CR -> LF
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Strip Unicode line/paragraph separators (U+2028, U+2029).
  // Using new RegExp with \u escapes to avoid invisible-char encoding issues in source.
  // These characters can appear in Office-exported Markdown and break hash stability.
  s = s.replace(new RegExp(' | ', 'g'), '');

  // 4. Trim trailing whitespace per line (preserve leading indentation)
  s = s.split('\n').map(function(l) { return l.replace(/[ \t]+$/, ''); }).join('\n');

  // 5. Ensure exactly one trailing newline.
  // Strip any excess trailing newlines, then append exactly one.
  // This also handles the case where content has no trailing newline at all.
  s = s.replace(/\n*$/, '\n');

  return s;
}

/**
 * Normalize a raw file Buffer to canonical string form.
 * Kept for backward compatibility -- callers passing Buffer still work.
 * Internally decodes as UTF-8, then delegates to canonicalize().
 *
 * @param {Buffer} buf  raw file bytes
 * @returns {string}    canonical UTF-8 string (ends with \n)
 */
function normalize(buf) {
  // Decode Buffer -> UTF-8 string, then apply canonical normalization.
  // Buffer.toString('utf8') passes through U+FEFF for a UTF-8 BOM, which
  // canonicalize() strips unconditionally in step 1.
  var text = buf.toString('utf8');
  return canonicalize(text);
}

/**
 * Read a file, normalize its content, and return the SHA-256 hex digest.
 *
 * @param {string} filePath  absolute or relative file path
 * @returns {string}         lowercase hex SHA-256
 * @throws {Error}           if file cannot be read
 */
function normalizeAndHash(filePath) {
  var resolved = path.resolve(filePath);
  var buf = fs.readFileSync(resolved);
  var canonical = normalize(buf);
  return sha256(canonical);
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = { normalizeAndHash, canonicalize, normalize, sha256 };

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  var args = process.argv.slice(2);

  // --canonicalize <path>: output normalized content to stdout, no hash
  if (args[0] === '--canonicalize' && args[1]) {
    try {
      var rawContent = fs.readFileSync(path.resolve(args[1]), 'utf8');
      process.stdout.write(canonicalize(rawContent));
      process.exit(0);
    } catch (e) {
      process.stderr.write('[NORMALIZE-HASH] Error: ' + e.message + '\n');
      process.exit(1);
    }
  }

  if (args.length === 0) {
    process.stderr.write(
      'Usage:\n' +
      '  node normalize-hash.cjs <file_path>            -> SHA-256 hex\n' +
      '  node normalize-hash.cjs --canonicalize <path>  -> normalized content\n'
    );
    process.exit(1);
  }

  try {
    var hex = normalizeAndHash(args[0]);
    process.stdout.write(hex + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write('[NORMALIZE-HASH] Error: ' + e.message + '\n');
    process.exit(1);
  }
}
