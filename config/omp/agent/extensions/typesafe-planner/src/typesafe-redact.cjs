'use strict';
/**
 * Egress redaction + shape-aware key-safety gate + size-cap orchestration
 * for TypeSafe payloads (state, criteria, questions.*). Zero deps besides
 * the sibling typesafe-redact-patterns.cjs (same dir, plain relative
 * require — resolves correctly no matter which absolute path THIS file was
 * itself loaded through, e.g. OMP's createRequire(import.meta.url) loading
 * it by absolute path under ~/.claude/mcp/typesafe/).
 *
 * String-level primitives (TOKEN_PATTERNS, key=value regex, entropy scan,
 * home-dir substitution, `redactString`, `detectSecret`, `capBytes`) live in
 * typesafe-redact-patterns.cjs; this file adds the REQUEST-SHAPE-aware
 * logic on top: which keys are safe to redact vs. must be rejected-not-
 * altered, and the water-filling size cap.
 */
const { redactString, detectSecret, capBytes, sensitiveKeyKind, sensitiveCamelKeyKind } = require('./typesafe-redact-patterns.cjs');

/** Deep-clone payload, redacting every string value. Keys untouched. Generic
 * (shape-agnostic) — used by the exported `redactPayload` only; the
 * shape-aware real-request redaction (with key handling) lives in
 * `redactRealShape` below, used internally by `preparePayload`. */
function deepMapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => deepMapStrings(v, fn));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = deepMapStrings(value[key], fn);
    return out;
  }
  return value;
}

function redactPayload(payload, opts = {}) {
  return deepMapStrings(payload, (str) => redactString(str, opts));
}

/** Deep-clone, redacting every string VALUE and (only when `redactKeys` is
 * true) every plain-object KEY too. Used for payload regions that are never
 * round-tripped against the response (state, object-shaped instructions,
 * noul/score criteria) — safe to alter keys there. Never used for
 * `questions` keys or `choice` criteria dict keys (those are gated by
 * `findSecretInRoundTripKeys` instead: reject-or-passthrough, never alter).
 *
 * When `redactKeys` is true, a value whose SIBLING key is itself a
 * sensitive field name (`sensitiveKeyKind`, e.g. `{"PGPASSWORD": "..."}`)
 * is redacted wholesale, regardless of whether the value's own content
 * matches any TOKEN_PATTERNS/KV_RE/entropy rule — a short, low-entropy
 * password/token value has nothing self-evidently secret-shaped about it
 * on its own, and KV_RE only ever finds "key=value" TEXT embedded inside
 * one string, not a real JSON key/value pair as two separate strings. N9
 * fix: this now also covers non-string values (number/array/object) — see
 * `isWholesaleRedactable` — a gap that let `{"PGPASSWORD": 12345678}` and
 * `{"api_key": ["abc12345"]}` pass through untouched before. */
/** N9: true for a value the sensitive-sibling-key rule should wholesale-
 * redact — any non-empty string, number, array, or plain object. Booleans
 * and null/undefined are left alone: a boolean FLAG next to a sensitive-
 * shaped key name (e.g. `{"password_required": true}`) carries no secret
 * material of its own, and wiping it destroys planning-relevant information
 * for no security benefit; `true`/`false` is not a value that can leak. */
const TELEMETRY_COUNT_KEYS = new Set(["input_tokens","output_tokens","total_tokens","prompt_tokens","completion_tokens","cache_creation_input_tokens","cache_read_input_tokens"]);
const isTelemetryCount = (k, v) => TELEMETRY_COUNT_KEYS.has(k) && Number.isSafeInteger(v) && v >= 0;

function isWholesaleRedactable(v) {
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return true;
  if (Array.isArray(v)) return true;
  return Boolean(v && typeof v === 'object');
}

/** R4-4: camelCase-final-key variant of `isWholesaleRedactable`, used only
 * by the `camelKind` branch below. Extends N10's original STRING-only rule
 * to also cover array/object sibling values, for consistency with N9's
 * SEPARATED/GLUED wholesale-redact rule (`{accessToken: ["<token>"]}` and
 * `{clientSecret: {value: "<token>"}}` were previously invisible to this
 * check entirely, same class of gap N9 fixed for SEPARATED/GLUED keys).
 * Deliberately still excludes number/boolean/null — unlike SEPARATED/GLUED
 * keys, a camelCase-final key is the everyday shape of ordinary code
 * identifiers holding non-secret numeric/boolean values (`accessToken:
 * 123456789`, `resetPassword: true`), and those must keep surviving
 * untouched (locked in by an existing must-pass test) or the numeric/
 * boolean false-positive N10 was written to avoid comes right back. */
function isCamelWholesaleRedactable(v) {
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return true;
  return Boolean(v && typeof v === 'object');
}

function redactDeep(value, opts, redactKeys) {
  if (typeof value === 'string') return redactString(value, opts);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, opts, redactKeys));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      const newKey = redactKeys ? redactString(key, opts) : key;
      const v = value[key];
      const kind = redactKeys ? sensitiveKeyKind(key) : null;
      if (kind && isWholesaleRedactable(v) && !isTelemetryCount(key, v)) {
        // N9: string values keep their specific kind marker (unchanged from
        // before); number/array/object values — invisible to this rule
        // before N9, since only strings were ever checked — get a generic
        // `[REDACTED:kv]` marker (there is no meaningful "kind" for a
        // redacted ARRAY or OBJECT the way there is for a string).
        out[newKey] = typeof v === 'string' ? `[REDACTED:${kind}]` : '[REDACTED:kv]';
      } else {
        // N10/R4-4: a camelCase-final sensitive key (clientSecret,
        // accessToken, dbPassword...) wholesale-redacts a STRING, ARRAY, or
        // OBJECT sibling value — unlike a SEPARATED/GLUED key (N9, above),
        // a camelCase-final key is the everyday shape of ordinary code
        // identifiers holding non-secret numeric/boolean values
        // (`resetPassword: true`, `tokenCount` isn't even a match for the
        // camel form at all), so NUMBER/BOOLEAN/null values still survive
        // untouched (see isCamelWholesaleRedactable's header comment) —
        // only string/array/object siblings are redacted here.
        const camelKind = redactKeys && !kind ? sensitiveCamelKeyKind(key) : null;
        if (camelKind && isCamelWholesaleRedactable(v)) {
          out[newKey] = typeof v === 'string' ? `[REDACTED:${camelKind}]` : '[REDACTED:kv]';
        } else {
          out[newKey] = redactDeep(v, opts, redactKeys);
        }
      }
    }
    return out;
  }
  return value;
}

/** True if any ROUND-TRIP-CRITICAL key — a question name, or a DICT-shaped
 * `choice` question's option identifier — contains a detected secret. These
 * keys are compared verbatim against the upstream response
 * (`answers.<questionKey>`, `answers.<key>.choice`) AND are how the
 * ORIGINAL CALLER looks up its own answer (e.g. `answers['risk']`) — if
 * redaction silently renamed the key, the caller's own lookup by the
 * ORIGINAL name would come up empty, a strictly worse outcome than
 * rejecting the call outright. Array-shaped `choice` criteria items are NOT
 * checked here: the API client's validateInput already rejects array-shaped
 * `choice` criteria before this module runs, so that shape only reaches
 * preparePayload when it is called directly (defensive path). Those items
 * are plain string VALUES (not object keys the caller indexes by name), so
 * they simply go through ordinary redaction below (see
 * redactQuestionsShapeAware's array branch). */
function findSecretInRoundTripKeys(questions, opts) {
  if (!questions || typeof questions !== 'object') return false;
  for (const qKey of Object.keys(questions)) {
    if (detectSecret(qKey, opts)) return true;
    const q = questions[qKey];
    if (q && typeof q === 'object' && q.type === 'choice' && q.criteria && typeof q.criteria === 'object' && !Array.isArray(q.criteria)) {
      for (const ck of Object.keys(q.criteria)) {
        if (detectSecret(ck, opts)) return true;
      }
    }
  }
  return false;
}

/** Redact the real `questions` shape (skills/shared/typesafe-integration.md
 * §3): per-question `instructions` (string or object) always redacted
 * (values + keys, since it never round-trips); `criteria` handling depends
 * on shape/type — array-shaped criteria is redacted as ordinary string
 * values (the canonical use is `score` level descriptions, which
 * `sanitizeAnswers` only length-checks; array-shaped `choice` is rejected by
 * the API client before redaction and is handled here only defensively).
 * Array items are never treated as gated identifiers, only DICT keys are,
 * see findSecretInRoundTripKeys;
 * dict on type 'choice' has option-identifier KEYS (passthrough, gated
 * above by findSecretInRoundTripKeys — the caller indexes its OWN answer
 * by the original key name, so silently renaming it would be worse than
 * rejecting) but free-text VALUES (redacted); dict on any other type
 * (noul, or a non-canonical shape) never round-trips either key or value
 * (both redacted). Caller MUST have already confirmed
 * `findSecretInRoundTripKeys(questions)` is false before calling this — a
 * `choice` dict key is never altered here, only ever left as-is or (by the
 * caller) rejected. */
function redactQuestionsShapeAware(questions, opts) {
  const out = {};
  for (const key of Object.keys(questions)) {
    const q = questions[key];
    if (!q || typeof q !== 'object') {
      out[key] = q;
      continue;
    }
    const newQ = { ...q };
    if (typeof q.instructions === 'string') {
      newQ.instructions = redactString(q.instructions, opts);
    } else if (q.instructions && typeof q.instructions === 'object') {
      newQ.instructions = redactDeep(q.instructions, opts, true);
    }
    const criteria = q.criteria;
    if (Array.isArray(criteria)) {
      newQ.criteria = criteria.map((item) => (typeof item === 'string' ? redactString(item, opts) : item));
    } else if (criteria && typeof criteria === 'object') {
      if (q.type === 'choice') {
        const critOut = {};
        for (const ck of Object.keys(criteria)) {
          const cv = criteria[ck];
          // Keys are option identifiers (passthrough, gated above). Values
          // are free-text descriptions — redact strings normally, and
          // recurse (keys+values) into an object-shaped value too, so this
          // stays consistent with collectCappableFields's own recursion
          // into non-string criteria values (M1).
          if (typeof cv === 'string') critOut[ck] = redactString(cv, opts);
          else if (cv && typeof cv === 'object') critOut[ck] = redactDeep(cv, opts, true);
          else critOut[ck] = cv;
        }
        newQ.criteria = critOut;
      } else {
        newQ.criteria = redactDeep(criteria, opts, true);
      }
    }
    out[key] = newQ;
  }
  return out;
}

/** Shape-aware redaction of the real request payload ({state, model,
 * questions}). `questions` keys/choice-option-keys are passed through
 * verbatim (never altered — see redactQuestionsShapeAware); every other
 * field (state, model, and defensively any unexpected extra field) is
 * redacted deeply, keys included. */
function redactRealShape(payload, opts) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = {};
  for (const key of Object.keys(payload)) {
    if (key === 'questions' && payload.questions && typeof payload.questions === 'object' && !Array.isArray(payload.questions)) {
      out.questions = redactQuestionsShapeAware(payload.questions, opts);
    } else {
      out[key] = redactDeep(payload[key], opts, true);
    }
  }
  return out;
}

/** Recursively collect every STRING leaf inside an object/array as a
 * cappable {get,set} field, mutating the containing array/object in place
 * via the closure. Used for object-shaped `state`/`instructions`/criteria
 * values (M1 fix: these were previously invisible to the cap pass entirely,
 * so an oversized object-shaped field always hit "payload too large" even
 * when there was byte budget to spare after capping). */
function collectStringLeaves(container, fields) {
  if (Array.isArray(container)) {
    container.forEach((v, i) => {
      if (typeof v === 'string') fields.push({ get: () => container[i], set: (nv) => (container[i] = nv) });
      else if (v && typeof v === 'object') collectStringLeaves(v, fields);
    });
  } else if (container && typeof container === 'object') {
    for (const k of Object.keys(container)) {
      const v = container[k];
      if (typeof v === 'string') fields.push({ get: () => container[k], set: (nv) => (container[k] = nv) });
      else if (v && typeof v === 'object') collectStringLeaves(v, fields);
    }
  }
}

// Cappable fields, matching the REAL request shape (skills/shared/
// typesafe-integration.md §3): { state, questions: { <key>: { type,
// instructions, criteria } } }. `state`/`instructions`/criteria-dict-VALUES
// may be a plain string OR an object (nested string leaves, collected via
// collectStringLeaves) — never dict KEYS (the response's `choice` is
// validated against them, must survive byte-for-byte) and never array items
// on a non-'score' type (option IDENTIFIERS, matched like keys).
function collectCappableFields(payload) {
  const fields = [];
  if (typeof payload.state === 'string') {
    fields.push({ get: () => payload.state, set: (v) => (payload.state = v) });
  } else if (payload.state && typeof payload.state === 'object') {
    collectStringLeaves(payload.state, fields);
  }
  if (payload.questions && typeof payload.questions === 'object') {
    for (const key of Object.keys(payload.questions)) {
      const q = payload.questions[key];
      if (!q || typeof q !== 'object') continue;
      if (typeof q.instructions === 'string') {
        fields.push({ get: () => q.instructions, set: (v) => (q.instructions = v) });
      } else if (q.instructions && typeof q.instructions === 'object') {
        collectStringLeaves(q.instructions, fields);
      }
      const criteria = q.criteria;
      if (Array.isArray(criteria) && q.type === 'score') {
        criteria.forEach((_item, i) => {
          if (typeof criteria[i] === 'string') {
            fields.push({ get: () => criteria[i], set: (v) => (criteria[i] = v) });
          }
        });
      } else if (criteria && typeof criteria === 'object' && !Array.isArray(criteria)) {
        for (const ck of Object.keys(criteria)) {
          const cv = criteria[ck];
          if (typeof cv === 'string') fields.push({ get: () => criteria[ck], set: (v) => (criteria[ck] = v) });
          else if (cv && typeof cv === 'object') collectStringLeaves(cv, fields);
        }
      }
    }
  }
  return fields;
}

/**
 * Redact then cap so JSON.stringify(payload) fits within maxBytes.
 *
 * Uses a "water-filling" pass: binary-search the LARGEST single byte level
 * L such that capping every cappable field down to at most L bytes (fields
 * already <=L are left untouched) brings the total at or under maxBytes.
 * This is fair by construction — two equally-oversized fields (e.g. a
 * `state` and an `instructions` that are both 30KB) get cut to the SAME
 * level rather than one being fully sacrificed before the other is even
 * touched, and a short field is never reduced AT ALL while a larger field
 * is still above L. Because the search always finds the LARGEST feasible
 * L (searching the full `[0, maxOrigBytes]` range directly — no separate
 * "try a floor first" phase is needed, that would only re-derive the same
 * answer whenever the floor happens to fit), a field only drops below a
 * notional small floor when the total budget genuinely can't be met
 * without it — never as an arbitrary/unfair choice.
 *
 * BEFORE any redaction, rejects (throws) if a round-trip-critical key
 * (question name, or a `choice` question's option identifier) contains a
 * detected secret — those keys can never be silently altered, so the only
 * safe response is to refuse to build/send the request at all.
 */
function preparePayload(payload, opts = {}) {
  const maxBytes = opts.maxBytes || 32768;
  if (payload && payload.questions && typeof payload.questions === 'object' && !Array.isArray(payload.questions)) {
    if (findSecretInRoundTripKeys(payload.questions, opts)) {
      const err = new Error('payload rejected: secret in key');
      err.code = 'payload_rejected_secret_in_key';
      throw err;
    }
  }
  const redacted = redactRealShape(payload, opts);
  const fields = collectCappableFields(redacted);
  if (fields.length === 0) return redacted;

  const totalBytes = () => Buffer.byteLength(JSON.stringify(redacted), 'utf8');
  if (totalBytes() <= maxBytes) return redacted;

  const originals = fields.map((f) => f.get());
  let maxOrigBytes = 0;
  for (const o of originals) maxOrigBytes = Math.max(maxOrigBytes, Buffer.byteLength(o, 'utf8'));

  /** Cap every field to at most `level` bytes, always re-deriving from the
   * ORIGINAL value (not the previous probe's result) so probes are
   * independent/idempotent regardless of binary-search order. */
  function applyLevel(level) {
    fields.forEach((field, i) => {
      const original = originals[i];
      field.set(Buffer.byteLength(original, 'utf8') > level ? capBytes(original, level) : original);
    });
  }

  /** Largest level in [lo, hi] for which applyLevel(level) brings the total
   * at or under maxBytes, or null if not even `lo` achieves it. Total is
   * monotonic non-increasing as level decreases, so a standard
   * find-largest-passing binary search applies. */
  function findLevel(lo, hi) {
    applyLevel(lo);
    if (totalBytes() > maxBytes) return null;
    let best = lo;
    let low = lo;
    let high = hi;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      applyLevel(mid);
      if (totalBytes() <= maxBytes) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  const level = findLevel(0, maxOrigBytes);
  applyLevel(level === null ? 0 : level); // level===null: even L=0 can't fit (uncappable overhead) -- best effort
  return redacted;
}

module.exports = { redactString, redactPayload, capBytes, preparePayload, detectSecret };
