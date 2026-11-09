/**
 * typesafe-enabled-resolver.cjs
 *
 * Resolves whether the TypeSafe AI-judge integration is active for a given
 * project. Pure, synchronous, built-ins only (fs/path/os) - designed to run
 * cheaply on every session-init/subagent-init invocation, and shared verbatim
 * by the MCP server and the OMP extension (P4 F9) so all call sites agree.
 * This file's path and export shape are part of the OMP public contract: a
 * user's own OMP extension `require`s it, so it stays ONE file with NO new
 * `require` (the parity test copies only this file).
 *
 * Precedence (first match wins):
 *   1. No non-empty TYPESAFE_API_KEY in env                       -> off ('no-key')
 *   2. Global <homeDir>/.omp/agent/typesafe.json EXISTS but can't be read/
 *      parsed (bad JSON, UTF-16 content, non-object top level,
 *      after stripping a leading BOM)                              -> off ('global-config-unreadable')
 *   3. Global typesafe === false, or typesafe present but not a
 *      plain object, or typesafe.enabled present and not strictly
 *      boolean true                                                -> off ('global-kill-switch'), always wins
 *      (global typesafe.enabled === true, or typesafe/enabled
 *      absent entirely, has NO effect either way)
 *   4. Global typesafe.excludeProjects (present, see "Exclude" below):
 *        invalid list                                              -> off ('global-exclude-invalid')
 *        session matches an entry                                  -> off ('global-excluded')
 *   5. Global typesafe.projects[] matches (see "Allowlist" below)  -> on  ('global-allowlist')
 *   6. Otherwise                                                    -> off ('default-off')
 * Neither new reason refuses `--repair-mcp` (registering the MCP is harmless;
 * the server re-resolves on every call).
 *
 * Fail-CLOSED, never open: an unreadable GLOBAL config must disable
 * TypeSafe, never silently let the allowlist through.
 *
 * Allowlist (`typesafe.projects`) keeps the lenient, fail-toward-OFF rules:
 *   - an entry is compared to the session's git root (exact match, never a
 *     prefix; realpath + win32 case-insensitive; no git root -> projectDir
 *     itself, so an explicitly listed non-repo folder still works);
 *   - a bad entry (non-string, blank) is silently ignored - an ignored allow
 *     entry can only mean "off";
 *   - an entry whose trim() is exactly "*" enables ANY git repo, but ONLY when
 *     a git root is found for the session (a non-repo dir such as home, or a
 *     folder holding several repos, stays 'default-off' under "*"). There is
 *     no globbing: "D:/x/*" is a literal path.
 *
 * Exclude (`typesafe.excludeProjects`) is the deny list and is STRICT, because
 * under "*" it is the only guard and an entry that can never match is as
 * dangerous as a wrong type (an ignored deny entry would mean ON):
 *   - absent -> no exclusion. Present -> must be an array whose EVERY entry is
 *     exactly "*" or an absolute path: a string equal to its own trim(), not
 *     starting with "~" (a "~" inside a name such as PROGRA~1 is fine), with no
 *     "*" / "?" / "%" and no C0 control character on any platform (a JSON
 *     half-escape typo such as "D:\\Work\repos" decodes `\r` to CR and could
 *     never match), absolute (win32: drive `X:\` or UNC `\\srv\share` prefix,
 *     no `\\.\` / `\\?\` device prefix, no `"<>|` and no ":" after the drive
 *     letter, and no segment ending in an ASCII "." or space, which Windows
 *     strips so the entry could never match; POSIX: starts with "/", and
 *     `"<>|:` stay legal there). Anything
 *     else (non-array, null, {}, relative, ~/x, MSYS /d/x on win32, a glob,
 *     %VAR%, padding, control chars, non-strings) -> 'global-exclude-invalid':
 *     TypeSafe is off everywhere until fixed. A valid entry that does not
 *     exist on disk is NOT rejected here (the resolver does no FS work for it);
 *     typesafe-config-diagnostics.cjs warns about it at SessionStart.
 *   - "*" excludes everything. Otherwise matching is by SUBTREE, separator-
 *     aware (P/ab is not under P/a), case-insensitive on win32, lexical and
 *     realpath. The session is excluded when any candidate path equals an
 *     entry E, lies INSIDE E, or is an ANCESTOR of E (a session in a parent
 *     can read and send the excluded subtree - so an exclude anywhere under a
 *     directory also disables sessions rooted at or above that directory,
 *     even an explicitly allowlisted non-repo home). Candidates: projectDir,
 *     its git root, and the OWNER repo root when the git root's `.git` is a
 *     FILE (linked worktree: `gitdir:` then `commondir`; submodule: the part
 *     before `/.git/modules/`). A worktree/submodule checkout holds a copy of
 *     the owner's tracked content, so it is excluded with the owner. The
 *     resolved gitdir and common dir are candidates too (they sit inside the
 *     owner's `.git`, or ARE a bare repo), which covers shapes whose owner root
 *     cannot be derived (pruned admin dir, no `commondir`, submodule inside a
 *     worktree, bare-repo worktree). Candidates only ever widen exclusion.
 *   - A `.git` file that cannot be read/parsed while a non-wildcard list is
 *     non-empty fails closed ('global-excluded').
 *
 * Lazy keys: git root / realpaths / the owner-root read are computed on first
 * need and memoised per call. With the common shape (projects ["*", ...],
 * excludeProjects [] or absent) a call does one findGitRoot walk, 0 realpath
 * calls and 0 `.git`-file reads. Nothing is cached across calls.
 *
 * Misspelled keys (typeSafeConfigWarnings): next to a "*" allowlist a sibling
 * key that looks like exclude/projects but is not spelled right is IGNORED
 * (OMP and other tools' extra keys stay tolerated) and only produces a warning
 * line for SessionStart - never a fail-closed result.
 *
 * Opt-in is global allowlist only: project-local configuration is NEVER
 * read. A project must not be able to opt every clone into sending data to
 * TypeSafe. Consent belongs in the user's OMP-owned activation file, separate
 * from native modelRoles and authentication. There is no legacy config fallback
 * or automatic import. The global kill switch still always wins.
 *
 * IMPORTANT: the global config is read RAW with JSON.parse, never merged with
 * project defaults. `readGlobalConfig` remains exported for diagnostics.
 * This resolver uses the default OMP profile only; PI_CODING_AGENT_DIR is not
 * interpreted until native profile path semantics are explicitly validated.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Walk up from `dir` looking for a `.git` entry. Checked as EXISTS rather
 * than "is a directory" because git worktrees and submodules use a `.git`
 * FILE (containing `gitdir: <path>`) instead of a real `.git/` directory —
 * both must count as a repo root. Never spawns a git process; stops at the
 * filesystem root without throwing.
 *
 * @param {string} dir - Directory to start searching from.
 * @returns {string|null} Absolute path to the git root, or null if none found.
 */
function findGitRoot(dir) {
  let current;
  try {
    current = path.resolve(dir);
  } catch (_) {
    return null;
  }

  const fsRoot = path.parse(current).root;

  // Bounded by the filesystem root; `parent === current` is a belt-and-
  // braces guard against any platform quirk where dirname() stops early.
  while (true) {
    let hasGit = false;
    try {
      hasGit = fs.existsSync(path.join(current, '.git'));
    } catch (_) {
      hasGit = false;
    }
    if (hasGit) return current;

    if (current === fsRoot) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Strip a leading UTF-8 BOM (U+FEFF) some editors/tools write into JSON
 * files. JSON.parse throws on a raw BOM prefix, which would otherwise make
 * an intentionally-valid config look unreadable.
 * @param {string} text
 * @returns {string}
 */
function stripBOM(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read the GLOBAL OMP `typesafe.json` activation file, distinguishing "file does not
 * exist" (ENOENT/ENOTDIR - unset, no effect on resolution) from "file
 * exists but could not be read/parsed" (BOM-mangled UTF-16, trailing
 * commas, non-object JSON, permission errors, etc. — must fail CLOSED per
 * H1, never silently fall through as if nothing were there). A single
 * readFileSync() call decides both: no separate existsSync() pre-check
 * (which would otherwise race with the file being created/removed between
 * the check and the read, and cost a second syscall on every call).
 * @param {string} configPath
 * @returns {{ config: Object|null, unreadable: boolean }}
 */
function readGlobalConfig(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    // ENOENT: no such file. ENOTDIR: a path SEGMENT above it (e.g.
    // <homeDir>/.omp itself) is a file, not a directory - both mean
    // "there is no config here", not "unreadable". Anything else
    // (permission errors, EISDIR on configPath itself, etc.) is a genuine
    // read failure and must fail CLOSED.
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return { config: null, unreadable: false };
    }
    return { config: null, unreadable: true };
  }

  try {
    const parsed = JSON.parse(stripBOM(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { config: parsed, unreadable: false };
    }
    // Valid JSON but not a usable config shape (array/number/string/null) —
    // same fail-closed bucket as a parse error.
    return { config: null, unreadable: true };
  } catch (_) {
    return { config: null, unreadable: true };
  }
}

/**
 * Decide whether a (readable) global config triggers the kill switch.
 *
 * Fires when:
 *   - `typesafe === false`, or
 *   - `typesafe` is present (not undefined) but is not a plain object
 *     (covers `typesafe: true`, a string, a number, `null`, an array —
 *     any shape other than `false` or a proper `{ ... }` object is
 *     malformed and must fail closed), or
 *   - `typesafe.enabled` is present (not undefined) and is not strictly
 *     boolean `true` (covers `"false"`, `0`, `null`, etc.).
 *
 * Does NOT fire (no effect either way) when `typesafe` is absent entirely,
 * or `typesafe.enabled` is absent, or `typesafe.enabled === true`.
 *
 * @param {Object|null} globalConfig
 * @returns {boolean}
 */
function globalKillSwitchTriggered(globalConfig) {
  if (!globalConfig) return false;

  const ts = globalConfig.typesafe;
  if (ts === undefined) return false;
  if (ts === false) return true;
  if (ts === null || typeof ts !== 'object' || Array.isArray(ts)) return true;


  return Object.prototype.hasOwnProperty.call(ts, 'enabled') && ts.enabled !== true;
}
function hasProjectMarker(dir) {
  try {
    const markers = ['.git', 'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', '.ck.json', '.omp-dev.json'];
    return markers.some((m) => {
      try {
        return fs.existsSync(path.join(dir, m));
      } catch (_) {
        return false;
      }
    });
  } catch (_) {
    return false;
  }
}

// Case-fold a path for comparison: case-insensitive on win32 (the
// filesystem itself is case-insensitive there), case-sensitive elsewhere.
function foldPath(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

// Resolve through fs.realpathSync when possible so a symlinked path doesn't
// produce a false mismatch; falls back to path.resolve() when realpath
// fails (e.g. the path doesn't exist on this machine).
function realpathOrResolve(p) {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    return path.resolve(p);
  }
}

const WILDCARD = '*';
const UNREADABLE = 'unreadable';
const KNOWN_TYPESAFE_KEYS = new Set(['enabled', 'projects', 'excludeProjects', 'dialect', 'endpoint', 'baseUrl']);
const VALID_DIALECTS = new Set(['typesafe', 'openrouter-decisions', 'workers-ai-systemone']);

function isValidWireUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)) return false;
    if (u.username || u.password) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** An allowlist entry whose trim() is exactly "*" (any git repo). */
function isWildcard(entry) {
  return typeof entry === 'string' && entry.trim() === WILDCARD;
}

/**
 * Strict validity of ONE excludeProjects entry: exactly "*", or a string equal
 * to its own trim() that is non-empty, does not start with "~", contains no
 * "*" / "?" / "%" or C0 control character, and is absolute for `platform`
 * (win32: a drive `X:\` or UNC `\\srv\share` prefix - path.win32.isAbsolute
 * alone would accept "\x" and the MSYS "/d/x", which can never match - with no
 * `\\.\` / `\\?\` device prefix, no `"<>|`, no ":" after the drive letter and
 * no segment ending in an ASCII "." or space; elsewhere: starts with "/").
 * Exported so tests and callers share this one validator.
 * @param {*} entry
 * @param {string} [platform=process.platform]
 * @returns {boolean}
 */
function isValidExcludeEntry(entry, platform = process.platform) {
  if (typeof entry !== 'string') return false;
  if (entry === WILDCARD) return true;
  if (!entry || entry !== entry.trim()) return false;
  if (entry.startsWith('~') || /[*?%]/.test(entry)) return false;
  // C0 control chars (CR from a JSON "\r" half-escape, ESC, NUL...) can never be in a path that was meant:
  // fail closed on every platform (POSIX allows them, but such an entry is far likelier a typo than a real name).
  if (/[\x00-\x1f]/.test(entry)) return false;
  if (platform === 'win32') {
    const driveOrUnc = /^[A-Za-z]:[\\/]/.test(entry) || /^(\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(entry);
    if (!driveOrUnc || !path.win32.isAbsolute(entry)) return false;
    if (/^[\\/]{2}[.?][\\/]/.test(entry)) return false; // device namespace: never matches a resolved path
    // Chars Windows never allows in a name; the drive colon is at index 1 and UNC paths have none.
    if (/["<>|]/.test(entry) || entry.indexOf(':', 2) !== -1) return false;
    // Windows strips a trailing ASCII dot/space from a segment (NBSP / U+3000 are legal name chars);
    // "." and ".." are real path operators.
    return entry.split(/[\\/]/).every((seg) => seg === '.' || seg === '..' || !/[. ]$/.test(seg));
  }
  return entry.startsWith('/') && path.posix.isAbsolute(entry);
}

/** A valid exclude list is an array (possibly empty) of valid entries only. */
function isValidExcludeList(list, platform = process.platform) {
  return Array.isArray(list) && list.every((entry) => isValidExcludeEntry(entry, platform));
}

// Separator-aware "child is strictly inside parent" on folded, resolved paths.
function isInside(child, parent) {
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/**
 * Extra exclude candidates for the checkout at `gitRoot` when its `.git` is a
 * FILE (linked worktree or submodule): the owner repo root when derivable, plus
 * the resolved gitdir and common dir themselves. null when `.git` is a
 * directory; 'unreadable' when the `.git` file cannot be stat'ed/read/parsed
 * (callers fail CLOSED).
 *   worktree: `gitdir: <p>` (relative to gitRoot), then `<p>/commondir` if any
 *             (missing -> the gitdir itself is the common dir); a common dir
 *             whose basename is `.git` -> its dirname is the owner.
 *   submodule: `<owner>/.git/modules/...` -> `<owner>` (outermost repo).
 *   `<owner>/.git/worktrees/...` (pruned admin dir, no commondir, submodule inside a
 *   worktree) -> `<owner>` too, derived from the gitdir path itself.
 * gitdir/common are always returned: they sit inside the owner's `.git` (or
 * are a bare repo), so an exclude of the owner matches even when no owner root
 * can be derived. Only ever widens exclusion.
 * @param {string} gitRoot
 * @returns {string[]|null|'unreadable'}
 */
function ownerRepoRoot(gitRoot) {
  try {
    const dotGit = path.join(gitRoot, '.git');
    if (fs.statSync(dotGit).isDirectory()) return null;
    const match = /^gitdir:[ \t]*(.+?)[ \t]*\r?$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!match) return UNREADABLE;

    const gitdir = path.resolve(gitRoot, match[1]);
    let common = gitdir;
    try {
      const rel = fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim();
      if (rel) common = path.resolve(gitdir, rel);
    } catch (err) {
      if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) return UNREADABLE;
    }

    // Owner = the part before the first dot-git segment that ends the path or is followed by `modules` or
    // `worktrees` (so a pruned admin dir, a missing commondir, or a submodule inside a worktree still yield it).
    const isDotGit = (s) => (process.platform === 'win32' ? s.toLowerCase() === '.git' : s === '.git');
    for (const p of [common, gitdir]) {
      const segs = path.normalize(p).split(path.sep);
      for (let i = 0; i < segs.length; i++) {
        if (isDotGit(segs[i]) && (i === segs.length - 1 || segs[i + 1] === 'modules' || segs[i + 1] === 'worktrees')) {
          return [path.resolve(segs.slice(0, i).join(path.sep) + path.sep), gitdir, common];
        }
      }
    }
    return [gitdir, common];
  } catch (_) {
    return UNREADABLE;
  }
}

/**
 * Lazy per-call memo of the session's path facts. Nothing is computed until a
 * consumer asks, and nothing outlives the call (no cross-call cache).
 *   gitRoot()    - one findGitRoot walk, memoised.
 *   candidates() - folded lexical+realpath forms of projectDir, its git root,
 *                  the owner repo root, gitdir and common dir; `unreadable` when the .git read
 *                  failed. Only the exclude check (non-wildcard, non-empty
 *                  list) ever calls this.
 */
function makeKeys(projectDir) {
  let rootDone = false;
  let rootValue = null;
  let cands = null;
  const gitRoot = () => {
    if (!rootDone) {
      rootValue = findGitRoot(projectDir);
      rootDone = true;
    }
    return rootValue;
  };
  const candidates = () => {
    if (cands) return cands;
    const set = new Set();
    const add = (p) => {
      set.add(foldPath(path.resolve(p)));
      set.add(foldPath(realpathOrResolve(p)));
    };
    add(projectDir);
    let unreadable = false;
    const root = gitRoot();
    if (root) {
      add(root);
      const extra = ownerRepoRoot(root);
      if (extra === UNREADABLE) unreadable = true;
      else if (extra) extra.forEach(add);
    }
    cands = { list: Array.from(set), unreadable };
    return cands;
  };
  return { projectDir, gitRoot, candidates };
}

/**
 * Exclude check on an already-VALIDATED list (see isValidExcludeList).
 * "*" excludes everything with no path work; otherwise subtree + ancestor
 * matching against every candidate (see the module header). Fails closed when
 * the owner-root read was unreadable.
 */
function excludeListMatches(entries, keys, unreadableMatches = true) {
  if (entries.includes(WILDCARD)) return true;
  if (entries.length === 0) return false;

  const { list, unreadable } = keys.candidates();
  if (unreadable && unreadableMatches) return true;

  return entries.some((entry) => {
    const forms = [foldPath(path.resolve(entry)), foldPath(realpathOrResolve(entry))];
    return forms.some((e) => list.some((c) => c === e || isInside(c, e) || isInside(e, c)));
  });
}

/**
 * Allowlist check (lenient: bad entries are ignored, which can only fail
 * toward off). A "*" entry matches only when a git root exists. Other entries
 * match the git root exactly (no git root -> projectDir itself).
 *
 * PERF: the compared path is resolved (lexically AND via realpath) ONCE up
 * front, not once per entry. Each entry is compared lexically first (cheap -
 * matches the common case where the allowlist already holds the canonical
 * path verbatim); only a lexical MISMATCH pays for the entry's own realpath.
 * Realpath is idempotent, so this never accepts an entry the old always-
 * realpath `samePath()` would have rejected.
 */
function projectListMatches(entries, keys) {
  if (entries.some(isWildcard)) return true;

  const compared = keys.gitRoot() || path.resolve(keys.projectDir);
  const gitLex = foldPath(path.resolve(compared));
  const gitReal = foldPath(realpathOrResolve(compared));

  return entries.some((entry) => {
    if (typeof entry !== 'string' || !entry.trim() || isWildcard(entry)) return false;
    const entryLex = foldPath(path.resolve(entry));
    if (entryLex === gitLex || entryLex === gitReal) return true;
    return foldPath(realpathOrResolve(entry)) === gitReal;
  });
}

/**
 * Warning lines for misspelled typesafe keys. Only while `typesafe.projects`
 * contains "*": an own key of `typesafe` outside enabled|projects|
 * excludeProjects whose name case-insensitively contains "exclu" or "project"
 * is ignored (so nothing is excluded by it) - say so. Other unknown keys (OMP
 * and future tools) stay silent. Pure; never throws.
 * @param {Object|null} config - the parsed GLOBAL config (readGlobalConfig().config).
 * @returns {string[]}
 */
function typeSafeConfigWarnings(config) {
  if (!isPlainObject(config) || !isPlainObject(config.typesafe)) return [];
  const ts = config.typesafe;
  if (!hasOwn(ts, 'projects') || !Array.isArray(ts.projects) || !ts.projects.some(isWildcard)) return [];
  return Object.keys(ts)
    .filter((key) => !KNOWN_TYPESAFE_KEYS.has(key) && /exclu|project/i.test(key))
    .map((key) => {
      const suggestion = /exclu/i.test(key) ? 'excludeProjects' : 'projects';
      return (
        `TypeSafe config warning: unknown key "typesafe.${key}" in ~/.omp/agent/typesafe.json is ignored while ` +
        `typesafe.projects contains "*" - did you mean "${suggestion}"? Nothing is excluded by it.`
      );
    });
}

/**
 * Credential-independent, affirmative project exclusion for native delegation.
 * Unlike transport fail-closed resolution, missing credentials, malformed config
 * and unreadable git metadata never grant an exclusion bypass. The caller must
 * snapshot this decision for its native session; this function does not cache.
 */
function resolveTypeSafeProjectExclusion(projectDir, { homeDir = os.homedir() } = {}) {
  try {
    const result = readGlobalConfig(path.join(homeDir, '.omp', 'agent', 'typesafe.json'));
    if (result.unreadable) return { excluded: false, reason: 'global-config-unreadable' };
    if (globalKillSwitchTriggered(result.config)) return { excluded: false, reason: 'global-kill-switch' };
    const ts = result.config && isPlainObject(result.config.typesafe) ? result.config.typesafe : null;
    if (!ts || !hasOwn(ts, 'excludeProjects')) return { excluded: false, reason: 'not-excluded' };
    if (!isValidExcludeList(ts.excludeProjects)) return { excluded: false, reason: 'global-exclude-invalid' };
    const excluded = excludeListMatches(ts.excludeProjects, makeKeys(projectDir), false);
    return { excluded, reason: excluded ? 'global-excluded' : 'not-excluded' };
  } catch (_) {
    return { excluded: false, reason: 'exclusion-resolution-unavailable' };
  }
}

/**
 * Resolve TypeSafe enabled/disabled state for a project directory.
 *
 * @param {string} projectDir - Directory to resolve TypeSafe status for
 *   (e.g. the OMP session working directory).
 * @param {Object} [opts]
 * @param {Object} [opts.env=process.env] - Environment to read TYPESAFE_API_KEY
 *   from (injectable so tests never touch the real process env).
 * @param {string} [opts.homeDir=os.homedir()] - Home directory override
 *   (injectable so tests never touch the real home).
 * @returns {{ enabled: boolean, reason: 'no-key'|'global-config-unreadable'|'global-kill-switch'|'global-excluded'|'global-exclude-invalid'|'global-allowlist'|'default-off' }}
 */
function resolveTypeSafeEnabled(projectDir, { env = process.env, homeDir = os.homedir() } = {}) {
  try {
    // 1. No key -> off. Skip all file I/O below.
    const rawKey = env && typeof env.TYPESAFE_API_KEY === 'string' ? env.TYPESAFE_API_KEY : '';
    if (!rawKey.trim()) {
      return { enabled: false, reason: 'no-key' };
    }

    const globalConfigPath = path.join(homeDir, '.omp', 'agent', 'typesafe.json');
    const globalResult = readGlobalConfig(globalConfigPath);

    // 2. Global file EXISTS but can't be read/parsed -> fail CLOSED. Never
    // fall through to the allowlist as if the global file weren't there.
    if (globalResult.unreadable) {
      return { enabled: false, reason: 'global-config-unreadable' };
    }

    // 3. Global kill switch always wins.
    if (globalKillSwitchTriggered(globalResult.config)) {
      return { enabled: false, reason: 'global-kill-switch' };
    }

    // Past the kill switch, a present `typesafe` is guaranteed a plain object.
    const config = globalResult.config;
    const ts = config && isPlainObject(config.typesafe) ? config.typesafe : null;
    const keys = makeKeys(projectDir);

    // 4. Exclude beats the allowlist. Present-but-invalid fails CLOSED.
    if (ts && hasOwn(ts, 'excludeProjects')) {
      if (!isValidExcludeList(ts.excludeProjects)) {
        return { enabled: false, reason: 'global-exclude-invalid' };
      }
      if (excludeListMatches(ts.excludeProjects, keys)) {
        return { enabled: false, reason: 'global-excluded' };
      }
    }
    // 4b. Wire configuration validation (fail-closed)
    if (ts && (hasOwn(ts, 'dialect') || hasOwn(ts, 'endpoint') || hasOwn(ts, 'baseUrl'))) {
      if (hasOwn(ts, 'dialect') && (typeof ts.dialect !== 'string' || !VALID_DIALECTS.has(ts.dialect.trim()))) {
        return { enabled: false, reason: 'global-wire-config-invalid' };
      }
      if (hasOwn(ts, 'endpoint') && (typeof ts.endpoint !== 'string' || !isValidWireUrl(ts.endpoint))) {
        return { enabled: false, reason: 'global-wire-config-invalid' };
      }
      if (hasOwn(ts, 'baseUrl') && (typeof ts.baseUrl !== 'string' || !isValidWireUrl(ts.baseUrl))) {
        return { enabled: false, reason: 'global-wire-config-invalid' };
      }
    }

    // 5. Global allowlist: on iff typesafe.projects has "*" (any git repo) or
    // lists this project's git root (not raw cwd, so a session started from a
    // subdirectory still resolves to the same root). Project-local configuration
    // is never read here - see the security boundary in the module header.
    if (ts && hasOwn(ts, 'projects') && Array.isArray(ts.projects) && projectListMatches(ts.projects, keys)) {
      const result = { enabled: true, reason: 'global-allowlist' };
      if (typeof ts.dialect === 'string' && ts.dialect.trim().length > 0) {
        result.dialect = ts.dialect.trim();
      }
      if (typeof ts.endpoint === 'string' && ts.endpoint.trim().length > 0) {
        result.endpoint = ts.endpoint.trim();
      }
      if (typeof ts.baseUrl === 'string' && ts.baseUrl.trim().length > 0) {
        result.baseUrl = ts.baseUrl.trim();
      }
      return result;
    }

    // 6. No key restriction, no kill switch, not allowlisted -> default off.
    return { enabled: false, reason: 'default-off' };
  } catch (_) {
    // Never throw: this runs on every session-init/subagent-init call.
    return { enabled: false, reason: 'default-off' };
  }
}
function resolveTypeSafeConfig(projectDir, options) {
  return resolveTypeSafeEnabled(projectDir, options);
}

module.exports = {
  resolveTypeSafeEnabled,
  resolveTypeSafeConfig,
  resolveTypeSafeProjectExclusion,
  findGitRoot,
  readGlobalConfig,
  typeSafeConfigWarnings,
  isValidExcludeEntry,
  isValidExcludeList,
  globalKillSwitchTriggered,
};
