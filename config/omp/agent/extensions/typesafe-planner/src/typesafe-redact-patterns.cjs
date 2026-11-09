'use strict';
/**
 * typesafe-redact-patterns.cjs
 * Pattern/heuristic definitions AND the string-level redaction primitives
 * built directly on them: TOKEN_PATTERNS, the key=value regexes (SEPARATED +
 * GLUED) + classifier, the high-entropy-run classifier, home-dir substitution,
 * literal-value
 * substitution, `redactString()`, `detectSecret()`, and `capBytes()`. Split
 * out of typesafe-redact.cjs to keep that file under the ~200-line
 * guideline once the shape-aware key-redaction/rejection logic (H2) and the
 * water-filling cap algorithm are added on top of these primitives.
 * typesafe-redact.cjs requires this file via a plain relative require (same
 * directory) — resolves correctly no matter which absolute path the OWNING
 * file was itself loaded through (see typesafe-redact.cjs's own header).
 * Zero deps besides `os` (home directory detection).
 *
 * Perf note (applies to every pattern below): every quantifier is bounded
 * enough to avoid O(n^2) blowups on adversarial input — see individual
 * comments. This was profiled against 50-210KB adversarial strings; see
 * typesafe-redact.test.cjs's "perf:" tests for the regression suite.
 */
const os = require('os');

const HEX_ENTROPY_THRESHOLD = 3.0; // bits/char, max for hex alphabet(16) = 4
const MIXED_ENTROPY_THRESHOLD = 4.3; // bits/char, base64/base64url alphabet max ~6
const MIN_ENTROPY_RUN = 32;

/** Shannon entropy in bits/char for a string (order-0: frequency only). */
function shannonEntropy(str) {
  const freq = Object.create(null);
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  let entropy = 0;
  for (const ch of Object.keys(freq)) {
    const p = freq[ch] / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Standalone high-entropy base64/base64url/hex runs (>=32 chars). `+` and
// `/` (standard base64 alphabet, e.g. AWS secret keys) were added to the
// class (H2 fix: previously missing, ~53% of std-base64-shaped secrets were
// never even considered as candidates). Note `.` is deliberately NOT in
// this class: a file path's `.ext` breaks any candidate run at the dot, so
// a normal short-ish path segment (e.g. "src/lib/foo/bar" before ".ts")
// never reaches the 32-char MIN_ENTROPY_RUN in the first place — this is
// what actually protects the task's literal example
// ("src/lib/foo/bar.ts"), not a dedicated path-shape check (an earlier
// dotted-extension-based path guard here was DEAD CODE: this class has no
// `.`, so no candidate can ever contain one, and the guard's own dotted-
// extension requirement could therefore never match — removed, verified
// by instrumenting actual candidate matches during test-writing).
// KNOWN LIMITATION (documented, same class as the natural-language-run
// limitation below): a genuinely long (~100+ char) real path with NO dot
// anywhere in it (rare — most real paths end in a file extension) can
// still occasionally exceed the entropy threshold on its own and get
// false-positive redacted, exactly like a long run-on English phrase can.
const ENTROPY_CANDIDATE_RE = /[A-Za-z0-9_+/-]{32,}={0,2}/g;

/** Score one already-length-qualified string in isolation: true = redact. */
function scoreEntropy(str) {
  const isHex = /^[0-9a-fA-F]+$/.test(str);
  const threshold = isHex ? HEX_ENTROPY_THRESHOLD : MIXED_ENTROPY_THRESHOLD;
  return shannonEntropy(str) > threshold;
}

/** Classify one already-matched ENTROPY_CANDIDATE_RE run: true = redact it. */
function isHighEntropyMatch(match) {
  if (match.length < MIN_ENTROPY_RUN) return false;
  return scoreEntropy(match);
}

// N1 fix: a real path/URL (e.g. a ck:plan dir path, a github.com blob URL)
// is built entirely from '/'-joined segments that are each either a single
// same-case "word" (all-lowercase, ALL-CAPS acronym like README, or one
// Capitalized-Word), or several such words joined by '-'/'_' (kebab/snake).
// A random base64/hex secret essentially never has this shape: case mixes
// WITHIN an unbroken chunk (no '-'/'_' inside it) with near-certainty for
// any chunk longer than a few chars. This is the discriminator used below,
// NOT raw entropy-of-the-whole-run, which false-positived on long real
// paths/URLs purely because concatenating many low-entropy words produces a
// high aggregate entropy by accident.
const PATH_SEGMENT_SHAPE_RE = /^_*(?:[a-z0-9]+|[A-Z0-9]+|[A-Z][a-z0-9]+)(?:[-_]+(?:[a-z0-9]+|[A-Z0-9]+|[A-Z][a-z0-9]+))*_*$/;

/** True if `match` should be treated as a path/URL-shaped candidate at all:
 * contains a '/' (multiple segments) and no '+'/'=' (still std-base64-
 * shaped otherwise, e.g. an AWS secret key — always scored as a whole). */
function isPathLikeCandidate(match) {
  return match.indexOf('/') !== -1 && match.indexOf('+') === -1 && match.indexOf('=') === -1;
}

/** Redact one already-matched ENTROPY_CANDIDATE_RE run, returning either the
 * original (nothing to redact) or a copy with high-entropy portions
 * replaced. Path/URL-shaped runs (see isPathLikeCandidate) are scored per
 * '/'-segment instead of as one blob: only an UNBROKEN segment (no '-'/'_'
 * inside it) of >=32 chars gets entropy-checked at all — this still catches
 * a bare hex SHA embedded as its own path segment, while every kebab/snake
 * segment (real path/URL tokens) is exempt outright. If ANY segment fails
 * the word/acronym/Capitalized shape (the tell of a real secret smuggled in
 * — case mixed within one unbroken chunk), the whole candidate falls back
 * to ordinary whole-run scoring (this is what still catches a slash-
 * containing secret with no recognizable path shape at all, e.g. std-
 * base64 with an embedded '/' but no '+'/'=' anywhere). */
function redactEntropyCandidate(match) {
  if (isPathLikeCandidate(match)) {
    const segments = match.split('/');
    if (segments.every((seg) => seg === '' || PATH_SEGMENT_SHAPE_RE.test(seg))) {
      return segments
        .map((seg) =>
          seg.indexOf('-') === -1 && seg.indexOf('_') === -1 && isHighEntropyMatch(seg) ? '[REDACTED:high-entropy]' : seg,
        )
        .join('/');
    }
  }
  return isHighEntropyMatch(match) ? '[REDACTED:high-entropy]' : match;
}

function redactHighEntropy(str) {
  return str.replace(ENTROPY_CANDIDATE_RE, redactEntropyCandidate);
}

/** N4: true if `token` looks like a real "user:pass" Basic-auth credential:
 * either it contains a digit or "=" (fast heuristic, catches most real
 * credentials without needing to decode anything), or it cleanly base64-
 * decodes to printable ASCII containing a ":" (closes the all-letter gap,
 * e.g. "dXNlcjpwYXNz" -> "user:pass"). `Buffer.from(x, 'base64')` never
 * throws (it silently skips invalid chars), so this needs no try/catch. */
function looksLikeBasicAuthToken(token) {
  if (/[0-9=]/.test(token)) return true;
  const decoded = Buffer.from(token, 'base64').toString('utf8');
  return /^[\x20-\x7E]*$/.test(decoded) && decoded.includes(':');
}

// Specific secret patterns, checked before the generic entropy scan. Each
// entry is [regex, replacement] where replacement is either a fixed string
// or a function (String.prototype.replace supports both identically).
const TOKEN_PATTERNS = [
  // PEM, multiline, bounded body, properly terminated.
  [/-----BEGIN [^-]+-----[\s\S]{0,8192}?-----END [^-]+-----/g, '[REDACTED:private-key]'],
  // PEM PRIVATE KEY block with NO matching END anywhere in the payload
  // (truncated/streamed key material, or a deliberately malformed marker
  // used to smuggle a real key past the terminated-block pattern above).
  // Redacts from the marker to the end of the string. A trailing greedy
  // `[\s\S]*` with no further constraint is O(n) (single linear consume,
  // no backtracking choice once the fixed BEGIN marker itself matches).
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, '[REDACTED:private-key]'],
  // JWT header.payload.signature. Lookbehind anchors the start (no boundary
  // check -> a repeated "eyJeyJeyJ..." string would otherwise retry the
  // failing match at every 3-char offset); segment lengths bounded so each
  // retry costs O(1) instead of O(remaining string).
  [/(?<![\w-])eyJ[\w-]{0,4096}\.[\w-]{1,4096}\.[\w-]{1,4096}/g, '[REDACTED:jwt]'],
  [/\bsk-[A-Za-z0-9]{10,}\b/g, '[REDACTED:api-key]'],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{10,}\b/g, '[REDACTED:api-key]'],
  // Covers ghp_/gho_/ghs_/ghu_/ghr_ (personal/oauth/server-to-server/
  // user-to-server/refresh) in one alternation-free character class.
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bglpat-[\w-]{20,}\b/g, '[REDACTED:gitlab-token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:slack-token]'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED:google-api-key]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bnpm_[A-Za-z0-9]{20,}\b/g, '[REDACTED:npm-token]'],
  // Basic <base64>: redact if EITHER the digit/"=" heuristic fires (fast
  // path, catches most real credentials) OR the token actually base64-
  // decodes to printable ASCII containing a ":" (N4 fix — closes the gap
  // where an all-letter credential like "user:pass" -> "dXNlcjpwYXNz" has
  // no digit and no "=" padding at all, so it slipped past the digit/"="
  // guard entirely). Ordinary prose ("input/output", "requirements",
  // "configuration", ...) decodes to non-printable garbage bytes, not
  // clean text with a colon — verified empirically against every existing
  // prose false-positive guard test in this suite, so this stays precise.
  [/\bBasic\s+([A-Za-z0-9+/=]{8,})/gi, (m, token) => (looksLikeBasicAuthToken(token) ? '[REDACTED:basic-auth]' : m)],
  // Bearer <token>: lowered from a 20-char minimum to 8 (H2: short bearer
  // tokens were previously never even considered), but a plain word/phrase
  // run that happens to be >=8 chars ("Bearer token auth is required",
  // "Bearer token-based auth", "a Bearer authorization.") must still be
  // left alone. Guard narrowed to digit/"=" only (an earlier draft also
  // triggered on ".", "-", "~", "+", "/" — all of which appear in ordinary
  // English punctuation/hyphenated-compounds/sentence-final periods, so
  // that draft wrongly redacted plain prose containing those characters).
  [/\bBearer\s+([A-Za-z0-9\-._~+/]{8,}=*)/gi, (m, token) => (/[0-9=]/.test(token) ? '[REDACTED:bearer-token]' : m)],
  // Any scheme (postgres://, redis://...), keep scheme+host, redact
  // userinfo up to the LAST '@' before the host (H2: a password containing
  // an embedded '@' or '/' used to only be partially redacted, leaking the
  // tail — the password class here allows both, and the trailing literal
  // '@' plus greedy backtracking naturally lands on the RIGHTMOST '@' in
  // the run). Both userinfo groups are bounded ({0,256} each): a single
  // char-class repeat has no backtracking AMBIGUITY regardless of bound
  // (no nested/overlapping quantifiers), but on an adversarial string with
  // thousands of "scheme://" occurrences and no '@' anywhere, EVERY
  // occurrence still pays up to `bound` failed-backtrack steps before
  // giving up — profiled: 4096 cost ~1.5s/200KB (over budget), 256 cost
  // ~0.1s/200KB. 256 bytes is already generous for a real password.
  //
  // N3 fix: `(?!\d{1,5}(?:[/?#]|$))` right after the mandatory ':' rejects
  // a "host:port" shape (1-5 digits then '/', '?', '#', or end-of-string) —
  // that is NOT userinfo, it's a bare host followed by a port, and the old
  // pattern wrongly ate everything up to the next unrelated '@' later in
  // the URL (e.g. `http://localhost:3000/users/@me`). The password class
  // also now excludes '?' and '#' (previously `[^\s]`), so a query string
  // or fragment after the real host can never be swallowed into it either.
  [/([a-z][a-z0-9+.-]{0,20}:\/\/)([^/\s:@]{0,256}):(?!\d{1,5}(?:[/?#]|$))([^\s?#]{0,256})@/gi, '$1[REDACTED:credentials]@'],
];

function kindOf(word) {
  const w = word.toLowerCase();
  if (w === 'password' || w === 'passwd' || w === 'pwd') return 'password';
  if (w === 'secret') return 'secret';
  if (w === 'token') return 'token';
  if (w === 'credential' || w === 'credentials') return 'credential';
  if (w === 'apikey' || w === 'api_key' || w === 'api-key') return 'api-key';
  if (w === 'privatekey' || w === 'private_key' || w === 'private-key') return 'private-key';
  return 'credential'; // unreachable; regex alternation below guarantees a match
}

// N2a: exempt a sensitive-word match when the segment RIGHT AFTER the word
// is one of these known-benign SUFFIXES — "password_policy",
// "token_budget", "secret_management", "auth_token_flow",
// "credentials_rotation_plan" are planning/config vocabulary, not secret
// VALUES, and wholesale-redacting them destroyed exactly the auth/LLM-
// budget planning content where the judgment mattered most. Deliberately
// NOT "the sensitive word must be the LAST segment" (that would also
// exempt AWS_SECRET_ACCESS_KEY/DB_PASSWORD_PROD/etc., reopening H2) — this
// only exempts a specific, curated vocabulary of non-secret continuations.
// N13 fix: added `min`, `max`, `hash` (`length`/`expiry` were already
// present; `expires?` added alongside for symmetry) so
// "password_min_length" (suffix "min") and "password_hash" (suffix "hash")
// pass.
//
// R4-1 CORRECTION — this list is SUFFIX-only. An earlier revision of the
// N13 fix ALSO reused this whole vocabulary as the benign-PREFIX check
// (i.e. "is the segment BEFORE the word one of these"), which wrongly
// exempted real secret keys whose prefix segment happens to collide with a
// benign SUFFIX word: "reset_token", "rotation_token", "flow_secret",
// "HASH_SECRET_KEY", "PASSWORD_RESET_TOKEN" all leaked that way (`reset`,
// `rotation`, `flow`, `hash` are legitimate SUFFIX vocabulary — e.g.
// "token_reset" — but are NOT safe as a blanket PREFIX exemption, since a
// real secret can just as easily be *preceded* by one of those words). The
// PREFIX exemption is a separate, much narrower list — see
// `BENIGN_PREFIX_RE`/`isBenignTokenPrefix` below — and only ever applies
// when the sensitive word itself is `token`.
const BENIGN_SUFFIX_RE =
  /^(?:policy|policies|budget|management|flow|rotation|plan|limits?|length|strength|requirements?|count|expiry|expires?|ttl|reset|fields?|format|type|name|label|hint|min|max|hash)$/i;

function isBenignSuffix(seg) {
  return typeof seg === 'string' && BENIGN_SUFFIX_RE.test(seg);
}

// R4-1 fix: the benign-PREFIX exemption ("max_tokens", "total_tokens",
// "num_tokens" — count-like fields where the sensitive word is a plural
// noun, not a secret VALUE) is a SEPARATE, narrow list — NOT
// `BENIGN_SUFFIX_RE` reused backwards. Deliberately excludes `hash`/
// `reset`/`rotation`/`flow`/`type`/`label`/`policy`/`name`/etc: those are
// fine as a SUFFIX (the sensitive word ends a benign continuation) but NOT
// as a PREFIX (a real secret key is easily *preceded* by one of those
// words: "reset_token", "HASH_SECRET_KEY", "PASSWORD_RESET_TOKEN").
const BENIGN_PREFIX_RE = /^(?:max|min|num|total)$/i;

// key=value / key: value / "key":"value" forms. The sensitive word is baked
// into the KEY alternation (not checked after matching) so a non-sensitive
// key ("Note", "db") never matches/consumes text, and a real secret right
// after it is not swallowed as that key's "value" (near-miss "password is
// required" without a following `:`/`=` never matches either, since the
// separator group is mandatory).
//
// The key alternation now covers password|passwd|pwd|secret|token|
// api[_-]?key|private[_-]?key|credential(s?) (H2: passwd/pwd/private_key/
// credential were previously missing entirely).
//
// Split into TWO regexes (N2b fix): a case-INSENSITIVE "SEPARATED" form
// (underscore/dash-segmented compound names: DB_PASSWORD, password:,
// TF_VAR_db_admin_password) and a case-SENSITIVE, UPPERCASE-ONLY "GLUED"
// form (no separator at all before the word: PGPASSWORD, MYCREDENTIALS).
// A single case-insensitive regex covering BOTH used to also match
// camelCase code identifiers with no separator at all (`maxTokens: 4096`,
// `outputTokens: 1024`, `resetPassword = true` were never real secrets but
// got redacted anyway) — JS regex flags apply to the whole pattern, so
// there is no way to say "the glued form only counts in uppercase" inside
// one `/gi` regex. A real glued secret-shaped env-var name is always
// upper-snake; camelCase is always mixed-case, so restricting the glued
// alternative to pure uppercase (no `i` flag) keeps every real case
// (PGPASSWORD, MYSQL_ROOT_PASSWORD's glued core) matching while dropping
// every camelCase false positive — the only signal available once there is
// no `_`/`-` to define a segment boundary.
//
// Both keep the SEPARATED form's existing bounded-segment convention
// (`{0,8}` x `{1,64}` chars, split on `[_-]`/case — never ambiguous, no new
// backtracking surface) profiled against the existing "token_" x35000 and
// "PGPASSWORD"-shaped adversarial inputs (see typesafe-redact.test.cjs
// perf: tests).
//
// The `(?=(?:[_-](?<firstSuffix>[A-Za-z0-9]{1,64}))?)` lookahead right
// after the word (SEPARATED only) captures the FIRST suffix segment
// WITHOUT consuming it, so the real (consuming) suffix quantifier right
// after still matches exactly as before — this is purely an added,
// zero-width peek used for the N2a benign-suffix exemption below.
//
// N13 fix: `(?<prefixChain>...)` names the EXISTING prefix-consuming group
// (unchanged text/bound, just given a name) so the last "_"/"-"-delimited
// segment right before the word can be recovered in JS (see
// `lastSegmentOf` below) — this is what lets "max_tokens" (benign PREFIX
// "max", the word is the LAST segment so there is no suffix at all to
// check) pass, symmetric to the firstSuffix check. Deliberately NOT done
// with a lookbehind capturing just the last segment: a
// `(?<=(?:^|[_-])(?<lastPrefix>...)[_-])` assertion, when made optional
// (`?`/`{0,1}`) to cover the zero-prefix case, was profiled to never
// backtrack into its 1-repetition branch at all in V8 (a group containing
// ONLY a zero-width assertion is apparently never retried once its
// 0-repetitions branch already lets the rest of the pattern succeed) —
// `lastPrefix` came back `undefined` on EVERY input, prefixed or not.
// Naming the already-consuming prefix quantifier and splitting it in JS
// sidesteps that engine quirk entirely, at zero extra regex cost.
const KV_RE_SEPARATED =
  /(?<kq>["']?)(?<![A-Za-z0-9_-])(?<key>(?<prefixChain>(?:[A-Za-z0-9]{1,64}[_-]){0,8})(?<word>password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|credential)s?(?=(?:[_-](?<firstSuffix>[A-Za-z0-9]{1,64}))?)(?:[_-][A-Za-z0-9]{1,64}){0,8})\k<kq>(?<sep>\s*[:=]\s*)(?:"(?<dval>(?:[^"\\]|\\.)*)"|'(?<sval>[^']*)'|(?<uval>[^"'\s,;&[\]]+))/gi;

/** Last non-empty `_`/`-`-delimited segment of a captured prefix chain (the
 * segment immediately before the sensitive word), or undefined if there was
 * no prefix at all. Plain string split — no regex, no backtracking. */
function lastSegmentOf(prefixChain) {
  if (!prefixChain) return undefined;
  const parts = prefixChain.split(/[_-]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}

/** R4-1: true only for the narrow "max_tokens"/"total_tokens"/"num_tokens"
 * family — the segment immediately before the sensitive word matches
 * `BENIGN_PREFIX_RE` AND the word itself is `token` (not password/secret/
 * credential/api-key/private-key — those are never benign just because a
 * count-like word precedes them, e.g. "min_password"/"max_password"/
 * "MAX_SECRET" must still be redacted). Applied identically in
 * `applyKvRegex` (text) and `sensitiveKeyKind` (object-key form) so both
 * stay consistent. */
function isBenignTokenPrefix(prefixChain, word) {
  return BENIGN_PREFIX_RE.test(lastSegmentOf(prefixChain) ?? '') && typeof word === 'string' && /^token$/i.test(word);
}

// N12 fix: the SAME zero-width `(?=(?:_(?<firstSuffix>[A-Z0-9]{1,64}))?)`
// benign-suffix peek as KV_RE_SEPARATED, added here too — previously this
// GLUED (uppercase-only) form had NO benign-suffix awareness at all, so
// "TOKEN_BUDGET=8000"/"PASSWORD_MIN_LENGTH=12" (exempted as text by the
// SEPARATED pass first) got wholesale-redacted anyway on the SECOND pass
// through this regex, and the reverse ("SECRET_NAME: ..." — exempt as an
// object KEY via sensitiveKeyKind, but redacted as TEXT) was equally
// inconsistent. Uses `_` (not `[_-]`) as the boundary since GLUED's key
// class is `[A-Z0-9_]`, no dash.
const KV_RE_GLUED =
  /(?<kq>["']?)(?<![A-Za-z0-9_-])(?<key>[A-Z0-9_]{0,64}(?<word>PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIALS?)(?=(?:_(?<firstSuffix>[A-Z0-9]{1,64}))?)[A-Z0-9_]{0,64})\k<kq>(?<sep>\s*[:=]\s*)(?:"(?<dval>(?:[^"\\]|\\.)*)"|'(?<sval>[^']*)'|(?<uval>[^"'\s,;&[\]]+))/g;

function applyKvRegex(str, re) {
  return str.replace(re, (...args) => {
    const groups = args[args.length - 1];
    const { kq = '', key, word, firstSuffix, prefixChain, sep, dval, sval } = groups;
    // N2a: benign suffix. R4-1: benign token-count prefix (max_tokens/
    // total_tokens/num_tokens) — see isBenignTokenPrefix's header comment
    // for why this is NOT BENIGN_SUFFIX_RE reused backwards (that was the
    // R4-1 leak regression).
    if (isBenignSuffix(firstSuffix) || isBenignTokenPrefix(prefixChain, word)) return args[0];
    const kind = kindOf(word);
    if (dval !== undefined) return `${kq}${key}${kq}${sep}"[REDACTED:${kind}]"`;
    if (sval !== undefined) return `${kq}${key}${kq}${sep}'[REDACTED:${kind}]'`;
    return `${kq}${key}${kq}${sep}[REDACTED:${kind}]`;
  });
}

// N10 fix: a THIRD glued alternative, case-sensitive (no `i` flag, same
// reasoning as KV_RE_GLUED's own case-sensitivity — see its header comment),
// that requires the sensitive word to be the FINAL capitalized segment of
// an otherwise lowercase-led camelCase identifier: "clientSecret",
// "accessToken", "dbPassword", "authToken", "refreshToken", "githubToken",
// "adminPassword" all match (word is the last segment). "maxTokens"/
// "outputTokens" (plural "Tokens" has no matching alternative — the word
// list has no trailing "s" the way KV_RE_GLUED's CREDENTIALS? does),
// "tokenCount"/"passwordMinLength" (the sensitive word is not the LAST
// segment) never even match the KEY shape at all. This is intentionally a
// SEPARATE regex from KV_RE_GLUED (uppercase-only) and KV_RE_SEPARATED
// (requires an actual `_`/`-` boundary) — camelCase has neither signal, so
// its own bounded shape is the sole discriminator (same bound profile as
// the other two: {0,32}/{0,6} segments, no nested-quantifier ambiguity).
const KV_RE_CAMEL =
  /(?<kq>["']?)(?<![A-Za-z0-9_-])(?<key>[a-z][a-z0-9]{0,32}(?:[A-Z][a-z0-9]{0,32}){0,6}?(?<word>Password|Passwd|Pwd|Secret|Token|Credentials?))\k<kq>(?<sep>\s*[:=]\s*)(?:"(?<dval>(?:[^"\\]|\\.)*)"|'(?<sval>[^']*)'|(?<uval>[^"'\s,;&[\]]+))/g;

// N10: value-shape skip, ONLY for KV_RE_CAMEL's UNQUOTED branch. camelCase
// secret-shaped keys are the dominant style for ordinary, non-secret code
// identifiers too, so an unquoted value that is itself number-shaped, a JS
// literal keyword, or a word-like identifier/member-access expression is
// accepted as a documented non-secret trade-off. A QUOTED value (the
// realistic shape an actual short secret literal takes) is NEVER exempted
// by this check.
//
// R4-2 fix: the original identifier check (`CAMEL_IDENTIFIER_RE`) exempted
// ANY alphanumeric-shaped value regardless of digit count/position, which
// let real secrets leak whenever they happened to be unquoted YAML/env
// text ("clientSecret: Xk9mP2qR7sT4vW8yZ3bN", "export dbPassword=...",
// "dbPassword=hunter2x", "clientSecret: hunter2"). Replaced with three
// narrower, word-like shapes: (1) member access (`res.nextPageToken`), (2)
// a plain identifier with NO digit anywhere (`token`), (3) a genuine
// multi-word camelCase identifier (an internal lower->upper transition,
// e.g. "rotateEvery") ending in a SHORT (<=3 digit) trailing digit run,
// optionally followed by exactly one more trailing letter ("rotateEvery24h").
// A flat lowercase run that merely happens to end in 1-3 digits
// ("hunter2x") has no camelCase transition at all and is NOT exempted; a
// value with digits scattered through the middle ("s3cr3tValue",
// "Xk9mP2qR7sT4vW8yZ3bN") has more than one digit run and is NOT exempted
// either.
const CAMEL_SKIP_VALUE_RE = /^(?:\d+|true|false|null|undefined)$/;
const CAMEL_MEMBER_ACCESS_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)+$/;
const CAMEL_NO_DIGIT_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z_$]*$/;
const CAMEL_WORD_CHARS_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isLetterUnderscoreOrDollar(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

/** True if `s` (letters/underscore/$ only, no digits) has an internal
 * lower->upper transition — the tell of a real multi-word camelCase
 * identifier ("rotateEvery") as opposed to a flat lowercase run that merely
 * happens to end in a digit ("hunter"). Plain char-code loop, O(n), no
 * regex — deliberately avoids combining this probe with the surrounding
 * unbounded quantifiers in one regex (see isCamelWordWithShortTrailingDigits
 * below for why that shape is a ReDoS risk on a long adversarial value). */
function hasLowerUpperTransition(s) {
  for (let i = 1; i < s.length; i++) {
    const prev = s.charCodeAt(i - 1);
    const cur = s.charCodeAt(i);
    if (prev >= 97 && prev <= 122 && cur >= 65 && cur <= 90) return true;
  }
  return false;
}

/** R4-2: true if `uval` is a genuine camelCase WORD ending in a short (<=3
 * digit) trailing digit run, optionally followed by exactly one more
 * trailing letter — "rotateEvery24h", "stage2", "v3" — as opposed to a flat
 * lowercase/secret-shaped string that merely happens to end in 1-3 digits
 * ("hunter2x": no camelCase transition) or has digits scattered elsewhere
 * ("s3cr3tValue", "Xk9mP2qR7sT4vW8yZ3bN": more than one digit run).
 * Implemented with plain string scanning, NOT one combined regex: a pattern
 * like `^[A-Za-z]*[a-z][A-Z][A-Za-z]*[0-9]{1,3}[A-Za-z]?$` has two adjacent
 * unbounded `*` quantifiers around a required 2-char probe pair, which is
 * the classic catastrophic-backtracking shape on a long adversarial value
 * that contains the probe pair but ultimately fails to match (each of the
 * O(n) candidate split points then re-scans the remainder) — profiled at
 * risk of O(n^2) on a 200KB unquoted value, over the 1s/200KB budget. This
 * function is O(n) with no backtracking. */
function isCamelWordWithShortTrailingDigits(uval) {
  if (!CAMEL_WORD_CHARS_RE.test(uval)) return false;
  let i = uval.length;
  if (i > 0 && isLetterUnderscoreOrDollar(uval[i - 1])) i--; // one optional trailing letter
  let digits = 0;
  while (i > 0 && isDigit(uval[i - 1])) {
    i--;
    digits++;
    if (digits > 3) return false; // more than 3 trailing digits: not a short suffix
  }
  if (digits === 0) return false; // no trailing digit run at all -> not this shape
  const head = uval.slice(0, i);
  if (!head) return false;
  for (let k = 0; k < head.length; k++) {
    if (isDigit(head[k])) return false; // a digit earlier in the string: more than one run
  }
  return hasLowerUpperTransition(head);
}

function shouldSkipCamelValue(uval) {
  return (
    CAMEL_SKIP_VALUE_RE.test(uval) ||
    CAMEL_MEMBER_ACCESS_RE.test(uval) ||
    CAMEL_NO_DIGIT_IDENTIFIER_RE.test(uval) ||
    isCamelWordWithShortTrailingDigits(uval)
  );
}

function applyKvCamelRegex(str) {
  return str.replace(KV_RE_CAMEL, (...args) => {
    const groups = args[args.length - 1];
    const { kq = '', key, word, sep, dval, sval, uval } = groups;
    if (uval !== undefined && shouldSkipCamelValue(uval)) return args[0];
    const kind = kindOf(word);
    if (dval !== undefined) return `${kq}${key}${kq}${sep}"[REDACTED:${kind}]"`;
    if (sval !== undefined) return `${kq}${key}${kq}${sep}'[REDACTED:${kind}]'`;
    return `${kq}${key}${kq}${sep}[REDACTED:${kind}]`;
  });
}

function redactKeyValue(str) {
  return applyKvCamelRegex(applyKvRegex(applyKvRegex(str, KV_RE_SEPARATED), KV_RE_GLUED));
}

// Same prefix/word/suffix shape as KV_RE_SEPARATED/KV_RE_GLUED's KEY group,
// but ANCHORED to the WHOLE string and with no separator/value tail — used
// to classify a real JSON object KEY on its own (e.g. `{"PGPASSWORD":
// "..."}`), as opposed to the KV regexes' job of finding "key=value"/
// "key: value" TEXT embedded inside a free-form string. This closes a real
// gap the KV regexes structurally can't: a dict VALUE next to a
// sensitive-named KEY (e.g. a short, low-entropy password like
// "hunter2CorrectBattery" with no recognizable pattern of its own) is
// invisible to every pattern/entropy check, since none of them look at the
// SIBLING key. Anchored + same bounded segments, so no new backtracking-
// ambiguity/ReDoS surface (applied once per key, keys are inherently
// short). Split the same SEPARATED/GLUED way as the KV regexes (N2b): a
// bare "maxTokens" object KEY was ALSO classified sensitive by the old
// single case-insensitive form (the glued alternative matched it directly),
// which meant `{maxTokens: 4096}` would wholesale-redact its own numeric
// value once N9 (below) started covering non-string values too.
// N13: same named `prefixChain` + `lastSegmentOf()` split as KV_RE_SEPARATED
// (see its header comment) — makes the object-key classification of
// "max_tokens" agree with the text-form check.
const SENSITIVE_KEY_NAME_SEPARATED_RE =
  /^(?<prefixChain>(?:[A-Za-z0-9]{1,64}[_-]){0,8})(?<word>password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|credential)s?(?=(?:[_-](?<firstSuffix>[A-Za-z0-9]{1,64}))?)(?:[_-][A-Za-z0-9]{1,64}){0,8}$/i;

const SENSITIVE_KEY_NAME_GLUED_RE =
  /^[A-Z0-9_]{0,64}(?<word>PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIALS?)[A-Z0-9_]{0,64}$/;

// N10: anchored camelCase-final form, same shape as KV_RE_CAMEL — see its
// header comment for the exact discriminator (word must be the LAST
// segment). Classified SEPARATELY from sensitiveKeyKind() below (via
// sensitiveCamelKeyKind) rather than folded into the same lookup: a
// SEPARATED/GLUED sibling key (N9) wholesale-redacts a sibling value of ANY
// type (number/array/object/string), which is safe because those key
// shapes are essentially never legitimate non-secret code — but a
// camelCase-final key ("resetPassword", "tokenCount" (not even a match),
// "showPassword") is the everyday shape of ordinary code identifiers with
// non-secret boolean/numeric values, so its caller must only wholesale-
// redact a STRING sibling value for this form (see typesafe-redact.cjs's
// redactDeep).
const SENSITIVE_KEY_NAME_CAMEL_RE =
  /^[a-z][a-z0-9]{0,32}(?:[A-Z][a-z0-9]{0,32}){0,6}?(?<word>Password|Passwd|Pwd|Secret|Token|Credentials?)$/;

/** If `key` (the whole string) looks like a sensitive field NAME on its
 * own — "PGPASSWORD", "api_key", "MYCREDENTIALS" — return its redaction
 * kind ('password', 'secret', 'token', 'api-key', 'private-key',
 * 'credential'); else null (including when a benign prefix/suffix exempts
 * it, N2a/N13). Does NOT check the camelCase-final form — see
 * sensitiveCamelKeyKind below. */
function sensitiveKeyKind(key) {
  if (typeof key !== 'string') return null;
  const separated = SENSITIVE_KEY_NAME_SEPARATED_RE.exec(key);
  if (separated) {
    const { firstSuffix, prefixChain, word } = separated.groups;
    if (isBenignSuffix(firstSuffix) || isBenignTokenPrefix(prefixChain, word)) return null;
    return kindOf(word);
  }
  const glued = SENSITIVE_KEY_NAME_GLUED_RE.exec(key);
  return glued ? kindOf(glued.groups.word) : null;
}

/** N10: camelCase-final anchored form only ("clientSecret", "accessToken",
 * "dbPassword"...) — see SENSITIVE_KEY_NAME_CAMEL_RE above for why this is
 * a separate function from sensitiveKeyKind rather than merged into it. */
function sensitiveCamelKeyKind(key) {
  if (typeof key !== 'string') return null;
  const camel = SENSITIVE_KEY_NAME_CAMEL_RE.exec(key);
  return camel ? kindOf(camel.groups.word) : null;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Literal, non-pattern-based redaction: replace every occurrence of a known
 * literal string (the actual API key value) with a fixed marker. Catches an
 * opaque key format that wouldn't match any TOKEN_PATTERNS/entropy rule. */
function redactLiteral(str, literal, marker) {
  if (!literal) return str;
  return str.replace(new RegExp(escapeRegExp(literal), 'g'), marker);
}

// Home directory prefixes -> "~". Windows drive forms case-insensitive per
// spec; posix /Users, /home stay case-sensitive. (?<![\w.-]) blocks
// mid-path/mid-URL false matches ("app/home/page.tsx", ".../home/x").
// Separator alternation `(?:\\\\|\\|/)` also matches a JSON-escaped double
// backslash (`C:\\Users\\name` as LITERAL two-backslash-character text,
// e.g. a Windows path that was JSON.stringify'd then logged/re-embedded as
// raw text) in addition to a single backslash or forward slash — each
// alternative is a fixed literal, no backtracking ambiguity.
// M3 fix: username class now excludes whitespace too — without it, a
// username-less separator later on the same line (rare on Windows, but the
// class had no OTHER stop condition) let the match run to the end of the
// line, swallowing unrelated prose as if it were still part of the path.
const WINDOWS_HOME_RE = /[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/:*?"<>|\r\n\s]+/gi;
const GITBASH_HOME_RE = /(?<![\w.-])\/[A-Za-z]\/Users\/[^/\s]+/gi;
const POSIX_HOME_RE = /(?<![\w.-])\/(?:Users|home)\/[^/\s]+/g;

function redactHomeDirs(str, homeDirs) {
  let out = str;
  for (const dir of homeDirs) {
    if (!dir) continue;
    out = out.replace(new RegExp(escapeRegExp(dir), 'gi'), '~');
    // Also catch the same path with every single backslash doubled (L6:
    // JSON-escaped form) — the generic WINDOWS_HOME_RE below only catches
    // the literal "...Users..." shape, not a homeDir value that may
    // contain nested subdirectories beyond "Users".
    if (dir.indexOf('\\') !== -1) {
      const doubled = dir.replace(/\\/g, '\\\\');
      out = out.replace(new RegExp(escapeRegExp(doubled), 'gi'), '~');
    }
  }
  return out.replace(WINDOWS_HOME_RE, '~').replace(GITBASH_HOME_RE, '~').replace(POSIX_HOME_RE, '~');
}

function defaultHomeDirs() {
  try {
    return [os.homedir()];
  } catch {
    return [];
  }
}

/** Redact one string: literal apiKey -> marker, tokens -> [REDACTED:<kind>],
 * key=value -> [REDACTED:<kind>], home dir -> "~", then entropy scan. */
function redactString(str, opts = {}) {
  if (typeof str !== 'string' || str.length === 0) return str;
  const homeDirs = opts.homeDirs || defaultHomeDirs();
  let out = str;
  if (opts.apiKey) out = redactLiteral(out, opts.apiKey, '[REDACTED:api-key]');
  for (const [re, replacement] of TOKEN_PATTERNS) out = out.replace(re, replacement);
  out = redactKeyValue(out);
  out = redactHomeDirs(out, homeDirs);
  out = redactHighEntropy(out);
  return out;
}

/** True if ANY secret-shaped pattern (literal apiKey, token, key=value, or
 * high-entropy run) is present in `str` — used to gate round-trip-critical
 * keys (question names, choice option identifiers) that must never be
 * silently altered: either they're clean, or the whole call is rejected
 * before it's built. Does NOT check home-dir prefixes (a bare home path in
 * a key isn't a "secret" requiring rejection). */
function detectSecret(str, opts = {}) {
  if (typeof str !== 'string' || str.length === 0) return false;
  if (opts.apiKey && str.includes(opts.apiKey)) return true;
  // Use the SAME .replace() a real redaction pass would use (not .test()):
  // several TOKEN_PATTERNS entries are [regex, function] pairs whose
  // function applies an additional prose guard (Bearer/Basic) that .test()
  // would silently ignore — a bare .test() here previously reported
  // "Bearer authentication"/"Basic configuration" as containing a secret
  // (matching the outer regex) even though redactString() itself leaves
  // both untouched, which would have wrongly rejected a whole call over a
  // false positive. String.prototype.replace resets a global regex's
  // lastIndex internally, so no manual reset is needed here (unlike .test()).
  for (const [re, replacement] of TOKEN_PATTERNS) {
    if (str.replace(re, replacement) !== str) return true;
  }
  if (redactKeyValue(str) !== str) return true;
  ENTROPY_CANDIDATE_RE.lastIndex = 0;
  let m;
  while ((m = ENTROPY_CANDIDATE_RE.exec(str))) {
    // Same segment-aware scoring redactHighEntropy uses (N1), so a question/
    // choice key is never rejected over a path/URL-shaped run that
    // redactString itself would leave untouched.
    if (redactEntropyCandidate(m[0]) !== m[0]) return true;
    if (m.index === ENTROPY_CANDIDATE_RE.lastIndex) ENTROPY_CANDIDATE_RE.lastIndex++;
  }
  return false;
}

/** Truncate to <=maxBytes UTF-8 bytes, never splitting a code point. */
function capBytes(str, maxBytes = 32768) {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  const marker = '\n[truncated]';
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  let result = '';
  let used = 0;
  for (const ch of str) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (used + chBytes > budget) break;
    result += ch;
    used += chBytes;
  }
  return result + marker;
}

module.exports = { redactString, detectSecret, capBytes, sensitiveKeyKind, sensitiveCamelKeyKind };
