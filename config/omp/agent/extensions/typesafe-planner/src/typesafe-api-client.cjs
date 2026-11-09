'use strict';
/**
 * typesafe-api-client.cjs
 * Validates typesafe_judge arguments, redacts without trimming proof, calls the
 * TypeSafe System One API, and sanitizes the response down to only the
 * parsed numeric/enum fields the caller is allowed to see. Zero deps.
 *
 * Judgment failures return `{ ok: false, code, authError }` instead of
 * throwing — `code` is always a short string (never a response body, error
 * message, or the API key) so the MCP server can build an isError tool
 * result directly from it.
 */
/** @typedef {import('./payload-safety').TypeSafePreparationResult} TypeSafePreparationResult */
/** @typedef {import('./payload-safety').TypeSafeJudgeResult} TypeSafeJudgeResult */

const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const { performance } = require('node:perf_hooks');

function defaultNodeFetch(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const transport = url.protocol === 'http:' ? http : https;
      const req = transport.request(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: {
              get(name) { return res.headers[String(name).toLowerCase()] || null; }
            },
            text: async () => text,
            json: async () => JSON.parse(text),
            body: { cancel: async () => {} },
          });
        });
      });
      req.on('error', reject);
      if (options.signal) {
        if (options.signal.aborted) {
          req.destroy();
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          return reject(err);
        }
        options.signal.addEventListener('abort', () => {
          req.destroy();
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      }
      if (options.body) req.write(options.body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function resolveFetch(supplied) {
  if (typeof supplied === 'function') return supplied;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  return defaultNodeFetch;
}
const SafeAbortController = typeof globalThis.AbortController === 'function' ? globalThis.AbortController : class SafeAbortController {
  constructor() {
    const listeners = new Map();
    this.signal = {
      aborted: false,
      addEventListener(type, listener, options) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add({ listener, once: Boolean(options?.once) });
      },
      removeEventListener(type, listener) {
        const set = listeners.get(type);
        if (!set) return;
        for (const item of set) {
          if (item.listener === listener) { set.delete(item); break; }
        }
      }
    };
    this._listeners = listeners;
  }
  abort() {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    const set = this._listeners.get('abort');
    if (set) {
      for (const item of [...set]) {
        try { item.listener(); } catch (_) {}
      }
    }
  }
};
let preparePayload;
function loadPreparePayload() {
  if (preparePayload) return preparePayload;
  const loaded = require('./typesafe-redact.cjs');
  if (!loaded || typeof loaded.preparePayload !== 'function') throw new Error('redact_unavailable');
  preparePayload = loaded.preparePayload;
  return preparePayload;
}

const VALID_TYPES = new Set(['noul', 'choice', 'score', 'box']);
const API_URL = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const MAX_BODY_BYTES = 32768;

const SYSTEM_ONE_DIALECTS = Object.freeze({
  TYPESAFE: 'typesafe',
  OPENROUTER_DECISIONS: 'openrouter-decisions',
  WORKERS_AI_SYSTEMONE: 'workers-ai-systemone',
});
const VALID_DIALECTS = new Set(Object.values(SYSTEM_ONE_DIALECTS));

function buildSystemOneWirePayload(dialect = SYSTEM_ONE_DIALECTS.TYPESAFE, options = {}) {
  const d = VALID_DIALECTS.has(dialect) ? dialect : SYSTEM_ONE_DIALECTS.TYPESAFE;
  let effectiveModel = options.model || MODEL;
  if (d === SYSTEM_ONE_DIALECTS.WORKERS_AI_SYSTEMONE && (!options.model || options.model === MODEL)) {
    effectiveModel = '@cf/cloudflare/clef';
  }
  const { apiKey, state, questions, assets, endpoint, baseUrl, accountId, headers: extraHeaders } = options;
  const model = effectiveModel;
  let url;
  if (isNonEmptyString(endpoint)) {
    url = endpoint.trim();
  } else if (d === SYSTEM_ONE_DIALECTS.OPENROUTER_DECISIONS) {
    if (isNonEmptyString(baseUrl)) {
      const cleanBase = baseUrl.trim().replace(/\/+$/, '');
      url = cleanBase.endsWith('/decisions') ? cleanBase : `${cleanBase}/decisions`;
    } else {
      url = 'https://openrouter.ai/api/v1/decisions';
    }
  } else if (d === SYSTEM_ONE_DIALECTS.WORKERS_AI_SYSTEMONE) {
    if (isNonEmptyString(baseUrl)) {
      const cleanBase = baseUrl.trim().replace(/\/+$/, '');
      url = cleanBase.endsWith(`/${model}`) ? cleanBase : `${cleanBase}/${model}`;
    } else {
      const acct = isNonEmptyString(accountId) ? accountId.trim() : ':accountId';
      url = `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${model}`;
    }
  } else {
    if (isNonEmptyString(baseUrl)) {
      const cleanBase = baseUrl.trim().replace(/\/+$/, '');
      url = cleanBase.endsWith('/v1/systemone') ? cleanBase : `${cleanBase}/v1/systemone`;
    } else {
      url = API_URL;
    }
  }

  const hasAssets = assets && (
    Array.isArray(assets) ? assets.length > 0 : (typeof assets === 'object' && Object.keys(assets).length > 0)
  );

  const headers = {
    ...(isPlainObject(extraHeaders) ? extraHeaders : {}),
    'Content-Type': 'application/json',
    ...(isNonEmptyString(apiKey) ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
    ...(hasAssets ? { 'TypeSafe-Danger-Zone-Images': 'true' } : {}),
  };

  let wireQuestions = questions;
  if (isPlainObject(questions)) {
    wireQuestions = {};
    for (const [id, q] of Object.entries(questions)) {
      if (isPlainObject(q) && q.type === 'box') {
        const { image, ...rest } = q;
        wireQuestions[id] = rest;
      } else {
        wireQuestions[id] = q;
      }
    }
  }

  const payloadObj = {
    model,
    state,
    questions: wireQuestions,
    ...(assets !== undefined ? { assets } : {}),
  };
  const body = typeof options.body === 'string' ? options.body : JSON.stringify(payloadObj);

  return { url, headers, body };
}

function decodeSystemOneResponse(dialect, rawResponse) {
  const d = VALID_DIALECTS.has(dialect) ? dialect : SYSTEM_ONE_DIALECTS.TYPESAFE;
  if (!rawResponse || typeof rawResponse !== 'object') {
    return { answers: null, model: null, usage: null, cost: null, billing: null };
  }

  let effective = rawResponse;
  if (d === SYSTEM_ONE_DIALECTS.WORKERS_AI_SYSTEMONE) {
    if (rawResponse.success === false) {
      return { answers: null, model: null, usage: null, cost: null, billing: null };
    }
    if (isPlainObject(rawResponse.result)) {
      effective = rawResponse.result;
    }
  }

  if (!isPlainObject(effective.answers)) {
    return { answers: null, model: null, usage: null, cost: null, billing: null };
  }

  const answers = effective.answers;
  const model = isNonEmptyString(effective.model) ? effective.model : null;
  const billing = effective.billing ?? null;
  let cost = null;
  if (typeof effective.cost === 'number' && Number.isFinite(effective.cost)) {
    cost = effective.cost;
  } else if (effective.usage && typeof effective.usage.cost === 'number' && Number.isFinite(effective.usage.cost)) {
    cost = effective.usage.cost;
  }

  let usage = null;
  if (isPlainObject(effective.usage)) {
    usage = { ...effective.usage };
    if (cost !== null) usage.cost = cost;
  } else if (cost !== null) {
    usage = { cost };
  }

  return { answers, model, usage, cost, billing };
}
// ---- Retry policy (HTTP 429 / 529 only) -----------------------------------
// Source: docs.typesafe.ai/api.md (fetched 2026-10-07): "When you receive a
// 429 Too Many Requests or 529 Overloaded response, retry the request with
// exponential backoff instead of retrying immediately." The page does NOT
// document a Retry-After header, so honoring it below is purely defensive.
//
// Deliberate scope: ONLY 429 and 529 are retried. Network errors
// (ECONNRESET/ETIMEDOUT/...) and our own per-attempt timeout are NOT: the
// POST may already have been processed upstream, a timed-out attempt has
// already burned its whole window, and the call must stay fail-closed and
// fast. Other 4xx, 401/403 (auth kill-switch) and other 5xx are never retried.
//
// The MCP server's 10 s is a PER-ATTEMPT timeout; the kit configures no MCP
// tool-call timeout, so the whole judgment (attempts + sleeps) is bounded by
// a TOTAL budget (monotonic clock; the wall clock is only used to turn an
// HTTP-date Retry-After into a delay). Attempts or budget exhausted => the
// same fail-closed `http_429` / `http_529` result as before, AND a cool-down:
// for COOLDOWN_MS afterwards the same fail-closed result is returned
// immediately with no network call, so a rate-limited key is not hammered by
// every subsequent tool call.
// This shared runner owns retry policy for every bundled consumer.
const RETRYABLE_STATUS = new Set([429, 529]);
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TOTAL_BUDGET_MS = 15000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 4000;
const MAX_RETRY_AFTER_MS = 5000; // longer Retry-After => give up (never retry earlier than asked)
const RETRY_AFTER_JITTER_MS = 250; // added ON TOP of Retry-After so clients don't re-synchronize
const MIN_USEFUL_ATTEMPT_MS = 1000; // never start an attempt with less budget than this
const RATE_LIMIT_COOLDOWN_MS = 45000;

const RETRY_POLICY = Object.freeze({
  retryableStatus: [...RETRYABLE_STATUS],
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  totalBudgetMs: DEFAULT_TOTAL_BUDGET_MS,
  backoffBaseMs: BACKOFF_BASE_MS,
  backoffCapMs: BACKOFF_CAP_MS,
  maxRetryAfterMs: MAX_RETRY_AFTER_MS,
  retryAfterJitterMs: RETRY_AFTER_JITTER_MS,
  minUsefulAttemptMs: MIN_USEFUL_ATTEMPT_MS,
  cooldownMs: RATE_LIMIT_COOLDOWN_MS,
});

// State is keyed by a full SHA-256 digest, never a raw credential. A request
// captures the active generation; asynchronous completion may update state only
// if that exact credential generation remains active.
const defaultRateLimitState = {};

function monotonicNow() {
  return performance.now();
}

function hashCredential(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
}

function credentialStore(state) {
  const store = state && typeof state === 'object' ? state : defaultRateLimitState;
  if (!(store.entries instanceof Map)) store.entries = new Map();
  if (!Number.isSafeInteger(store.generation)) store.generation = 0;
  if (typeof store.activeHash !== 'string') store.activeHash = '';
  return store;
}

function observeCredential(apiKey, state) {
  const store = credentialStore(state);
  const hash = hashCredential(apiKey);
  if (store.activeHash !== hash) {
    store.activeHash = hash;
    store.generation += 1;
  }
  let entry = store.entries.get(hash);
  if (!entry) entry = { generation: store.generation, until: 0, status: 0, authFailed: false, alerted: false };
  if (entry.generation !== store.generation) entry = { ...entry, generation: store.generation };
  store.entries.set(hash, entry);
  return { store, token: { hash, generation: entry.generation }, entry };
}

function isCurrentCredential(store, token) {
  return store.entries.get(token.hash)?.generation === token.generation;
}

function resetRateLimitState(state = defaultRateLimitState) {
  const store = credentialStore(state);
  store.entries.clear();
  store.activeHash = '';
  store.generation = 0;
}

function checkCredentialCooldown(apiKey, options = {}) {
  const now = typeof options.nowImpl === 'function' ? options.nowImpl : monotonicNow;
  const { entry } = observeCredential(apiKey, options.rateLimitState);
  if (entry.authFailed) return { status: entry.status || 401, authFailed: true };
  return entry.until > now() ? { status: entry.status, cooldown: true, until: entry.until } : null;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isUnitInterval(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

/** Allowed `choice` options: dict keys only. */
function getChoiceOptions(criteria) {
  return isPlainObject(criteria) ? Object.keys(criteria) : [];
}

/**
 * Validate raw tool-call arguments against the canonical request shape
 * (skills/shared/typesafe-integration.md section 3). Returns `{ ok: true }`
 * or `{ ok: false, message }` with a short, specific reason.
 */
const ASSET_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_ASSETS_BYTES = 8 * 1024 * 1024;

function sanitizeStrictAssets(rawAssets) {
  if (rawAssets === undefined) return { ok: true, assets: undefined };
  if (!isPlainObject(rawAssets)) {
    return { ok: false, code: 'invalid_input', message: 'invalid_input: assets must be an object' };
  }
  const sanitized = {};
  let totalBytes = 0;
  for (const [key, asset] of Object.entries(rawAssets)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !ASSET_KEY_RE.test(key)) {
      return { ok: false, code: 'invalid_input', message: `invalid_input: asset key ${key} is invalid` };
    }
    if (!isPlainObject(asset)) {
      return { ok: false, code: 'invalid_input', message: `invalid_input: asset ${key} must be an object` };
    }
    const keys = Object.keys(asset);
    for (const k of keys) {
      if (k !== 'type' && k !== 'format' && k !== 'data_base64') {
        return { ok: false, code: 'invalid_input', message: `invalid_input: unsupported asset field ${k}` };
      }
    }
    if (asset.type !== 'image') {
      return { ok: false, code: 'invalid_input', message: `invalid_input: asset ${key}.type must be 'image'` };
    }
    if (asset.format !== 'png' && asset.format !== 'jpeg') {
      return { ok: false, code: 'invalid_input', message: `invalid_input: asset ${key}.format must be 'png' or 'jpeg'` };
    }
    if (typeof asset.data_base64 !== 'string' || !asset.data_base64.length || asset.data_base64.length % 4 !== 0 || !BASE64_RE.test(asset.data_base64)) {
      return { ok: false, code: 'invalid_input', message: `invalid_input: asset ${key}.data_base64 must be valid base64` };
    }
    const buf = Buffer.from(asset.data_base64, 'base64');
    if (buf.length > MAX_IMAGE_BYTES) {
      return { ok: false, code: 'invalid_input', message: `invalid_input: asset ${key} exceeds 4MB cap` };
    }
    totalBytes += buf.length;
    if (totalBytes > MAX_TOTAL_ASSETS_BYTES) {
      return { ok: false, code: 'invalid_input', message: 'invalid_input: total assets exceed 8MB cap' };
    }
    if (asset.format === 'png') {
      const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
      if (!isPng) {
        return { ok: false, code: 'invalid_input', message: `invalid_input: asset ${key} magic bytes do not match png format` };
      }
    } else if (asset.format === 'jpeg') {
      const isJpeg = buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      if (!isJpeg) {
        return { ok: false, code: 'invalid_input', message: `invalid_input: asset ${key} magic bytes do not match jpeg format` };
      }
    }
    sanitized[key] = {
      type: 'image',
      format: asset.format,
      data_base64: asset.data_base64,
    };
  }
  return { ok: true, assets: Object.keys(sanitized).length ? sanitized : undefined };
}

function validateInput(args, trustedLimits) {
  if (!isPlainObject(args)) return { ok: false, message: 'invalid_input: arguments must be an object' };
  const { state, questions } = args;
  if (!(isNonEmptyString(state) || isPlainObject(state))) {
    return { ok: false, message: 'invalid_input: state is required' };
  }
  if (!isPlainObject(questions)) {
    return { ok: false, message: 'invalid_input: questions must be a non-empty object' };
  }
  const countValidation = validateQuestionCount(Object.keys(questions).length, trustedLimits);
  if (!countValidation.ok) return { ...countValidation, message: countValidation.code };
  for (const key of Object.keys(questions)) {
    const q = questions[key];
    if (!isPlainObject(q)) return { ok: false, message: `invalid_input: questions.${key} must be an object` };
    if (Object.keys(q).some((field) => field !== 'type' && field !== 'instructions' && field !== 'criteria' && field !== 'image')) {
      return { ok: false, message: 'invalid_input: unsupported question field' };
    }
    if (!VALID_TYPES.has(q.type)) {
      return { ok: false, message: `invalid_input: questions.${key}.type must be noul|choice|score|box` };
    }
    if (!(isNonEmptyString(q.instructions) || isPlainObject(q.instructions))) {
      return { ok: false, message: `invalid_input: questions.${key}.instructions is required` };
    }
    if (q.type === 'choice') {
      if (!isPlainObject(q.criteria)) {
        return {
          ok: false,
          message: `invalid_input: questions.${key}.criteria must be a dict {option: description|null} for choice`,
        };
      }
      if (getChoiceOptions(q.criteria).length < 2) {
        return { ok: false, message: `invalid_input: questions.${key}.criteria needs >=2 options for choice` };
      }
    }
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2)) {
      return {
        ok: false,
        message: `invalid_input: questions.${key}.criteria must be an ordered array of >=2 level descriptions for score`,
      };
    }
    // Egress guard (review custom.9 #1): the redaction pass only scans STRING
    // values, so a nested object/array inside a score level or a noul
    // criteria value would travel to the API unredacted. The API accepts
    // structured criteria, but the kit deliberately restricts them to
    // strings so every byte that leaves the machine went through redact.
    if (q.type === 'score' && !q.criteria.every(isNonEmptyString)) {
      return { ok: false, message: `invalid_input: questions.${key}.criteria levels must be non-empty strings for score` };
    }
    if (q.type === 'noul' && q.criteria !== undefined) {
      const c = q.criteria;
      const stringOrAbsent = (v) => v === undefined || isNonEmptyString(v);
      if (!isPlainObject(c) || !stringOrAbsent(c.true) || !stringOrAbsent(c.false)) {
        return { ok: false, message: `invalid_input: questions.${key}.criteria must be {"true": desc, "false": desc} strings for noul` };
      }
    }
    if (q.type === 'box') {
      if (!Number.isInteger(q.image) || q.image < 0) {
        return { ok: false, code: 'invalid_input', message: `invalid_input: questions.${key}.image must be a non-negative integer for box` };
      }
    }
  }
  if (args.assets !== undefined) {
    const assetCheck = sanitizeStrictAssets(args.assets);
    if (!assetCheck.ok) return assetCheck;
  }
  return { ok: true };
}

function validateQuestionCount(count, trustedLimits) {
  if (trustedLimits && trustedLimits.ok === false) return { ok: false, code: 'policy_invalid' };
  const cap = trustedLimits?.maxQuestionsPerRequest ?? 128;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 128) return { ok: false, code: 'policy_invalid' };
  if (!Number.isSafeInteger(count) || count < 1) return { ok: false, code: 'invalid_input' };
  return count <= cap ? { ok: true } : { ok: false, code: 'question_limit_exceeded' };
}

// Only typed host messages are projected. Opaque public strings and business
// objects are not parsed or searched for words resembling private channels.
function projectPublicMessages(state) {
  if (!isPlainObject(state) || !Array.isArray(state.messages)) return state;
  const project = (entry) => {
    if (!isPlainObject(entry)) return null;
    const message = isPlainObject(entry.message) ? entry.message : entry;
    if (!['assistant', 'tool', 'toolResult'].includes(message.role)) return null;
    const content = typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content.flatMap((block) => {
      if (!isPlainObject(block)) return [];
      if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }];
      if (block.type === 'toolCall') {
        return [{
          type: 'toolCall', id: block.id, name: block.name,
          arguments: typeof block.arguments?.i === 'string' ? { i: block.arguments.i } : {},
        }];
      }
      if (block.type === 'tool_use') return [{ type: 'tool_use', id: block.id, name: block.name }];
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        return [{ type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content }];
      }
      return [];
    }) : [];
    const publicMessage = {
      role: message.role, content,
      ...(typeof message.toolName === 'string' ? { toolName: message.toolName } : {}),
      ...(typeof message.toolCallId === 'string' ? { toolCallId: message.toolCallId } : {}),
      ...(typeof message.isError === 'boolean' ? { isError: message.isError } : {}),
    };
    return message === entry ? publicMessage : {
      type: entry.type, id: entry.id, parentId: entry.parentId, message: publicMessage,
    };
  };
  return { ...state, messages: state.messages.map(project).filter(Boolean) };
}

function redactEvidenceState(state, options = {}) {
  return loadPreparePayload()(
    { state: projectPublicMessages(state) }, { ...options, maxBytes: Infinity },
  ).state;
}

/** @returns {TypeSafePreparationResult} */
function prepareRequest(args, trustedLimits, redactionOptions = {}) {
  const validation = validateInput(args, trustedLimits);
  if (!validation.ok) return { ok: false, code: validation.code || 'invalid_input' };
  if (trustedLimits === undefined) {
    try {
      trustedLimits = require('./typesafe-policy-client.cjs').resolveTrustedToolPolicy('judge');
      if (!trustedLimits?.ok) return { ok: false, code: 'policy_client_missing' };
    } catch (_) {
      return { ok: false, code: 'policy_client_missing' };
    }
  }
  const rawModel = isNonEmptyString(args.model) ? args.model.trim() : MODEL;
  const normalizedModel = rawModel.replace(/^typesafe\//i, '');
  const allowed = trustedLimits?.provider?.allowedModels ?? [MODEL];
  const modelAllowed = Array.isArray(allowed) && (
    allowed.includes(rawModel) ||
    allowed.includes(normalizedModel) ||
    (normalizedModel.startsWith('jev-') && allowed.some((m) => m === 'jev-latest' || m.startsWith('jev-'))) ||
    (rawModel.startsWith('@cf/') && allowed.some((m) => m.startsWith('@cf/'))) ||
    (rawModel.startsWith('openrouter/') && allowed.some((m) => m.startsWith('openrouter/')))
  );
  if (!modelAllowed) return { ok: false, code: 'model_not_allowed' };
  const model = normalizedModel;
  try {
    // Infinity disables the legacy water-filling truncator, not the final hard
    // bound. Redaction may change secrets, never discard evidence or criteria.
    const payload = loadPreparePayload()({
      state: projectPublicMessages(args.state), model, questions: args.questions,
    }, { ...redactionOptions, maxBytes: Infinity });
    if (args.assets !== undefined) {
      const assetCheck = sanitizeStrictAssets(args.assets);
      if (!assetCheck.ok) return { ok: false, code: assetCheck.code || 'invalid_input' };
      if (assetCheck.assets) payload.assets = assetCheck.assets;
    }
    const preparedValidation = validateInput(payload, trustedLimits);
    if (payload.model !== model) return { ok: false, code: 'model_not_allowed' };
    if (!preparedValidation.ok) return { ok: false, code: preparedValidation.code || 'invalid_input' };
    if (JSON.stringify(Object.keys(payload.questions)) !== JSON.stringify(Object.keys(args.questions))) {
      return { ok: false, code: 'question_identity_changed' };
    }
    const textBody = JSON.stringify({ state: payload.state, model: payload.model, questions: payload.questions });
    const textBytes = Buffer.byteLength(textBody, 'utf8');
    if (textBytes > MAX_BODY_BYTES) return { ok: false, code: 'payload too large' };
    const body = JSON.stringify(payload);
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    const questionIds = Object.keys(payload.questions);
    const bodyDigest = crypto.createHash('sha256').update(body).digest('hex');
    const metadata = {
      policyIdentity: trustedLimits?.policyIdentity,
      purpose: trustedLimits?.purpose,
      maxQuestionsPerRequest: trustedLimits?.maxQuestionsPerRequest ?? 128,
      questionIds, questionCount: questionIds.length, bodyBytes, bodyDigest,
    };
    return { ok: true, body, questions: payload.questions, bodyBytes, bodyDigest,
      questionCount: questionIds.length, policyIdentity: metadata.policyIdentity, metadata };
  } catch (error) {
    return { ok: false, code: error?.message === 'payload rejected: secret in key'
      ? error.message : 'redact_failed' };
  }
}

function freezePrepared(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) freezePrepared(value[key]);
  }
}

async function runPreparedValidation(prepared, validator) {
  if (validator === undefined) return { ok: true };
  if (typeof validator !== 'function') return { ok: false, code: 'prepared_validation_failed' };
  freezePrepared(prepared);
  try {
    const result = await validator(prepared);
    if (result?.ok === true) return { ok: true };
    const code = typeof result?.code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(result.code)
      ? result.code : 'prepared_validation_failed';
    return { ok: false, code };
  } catch (_) {
    return { ok: false, code: 'prepared_validation_failed' };
  }
}

/**
 * Parse+validate the upstream `answers` object down to only the numeric/enum
 * fields per question type. Returns `null` (whole call treated as errored)
 * if ANY key is missing, malformed, out of range, or (for choice) not one of
 * the options actually sent — never partial results.
 */
function sanitizeAnswers(questions, rawAnswers) {
  if (!isPlainObject(rawAnswers)) return null;
  const answers = {};
  for (const key of Object.keys(questions)) {
    const q = questions[key];
    const raw = rawAnswers[key];
    if (!isPlainObject(raw)) return null;

    if (q.type === 'noul') {
      if (!isUnitInterval(raw.noul)) return null;
      answers[key] = { noul: raw.noul };
    } else if (q.type === 'choice') {
      const options = getChoiceOptions(q.criteria);
      if (typeof raw.choice !== 'string' || !options.includes(raw.choice)) return null;
      if (!isUnitInterval(raw.confidence)) return null;
      answers[key] = { choice: raw.choice, confidence: raw.confidence };
    } else if (q.type === 'score') {
      // score = probability-weighted expected position (float) in [0, N-1]
      // (docs.typesafe.ai/api.md, verified jev-1.13.0 2026-09-28); round
      // only where a discrete level is needed (skills/shared/typesafe-integration.md §5).
      if (!Array.isArray(q.criteria)) return null;
      if (typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return null;
      if (raw.score < 0 || raw.score > q.criteria.length - 1) return null;
      if (!isUnitInterval(raw.confidence)) return null;
      answers[key] = { score: raw.score, confidence: raw.confidence };
    } else if (q.type === 'box') {
      if (!isPlainObject(raw.box)) return null;
      const { top, bottom, left, right } = raw.box;
      if (!isUnitInterval(top) || !isUnitInterval(bottom) || !isUnitInterval(left) || !isUnitInterval(right)) return null;
      if (top > bottom || left > right) return null;
      if (!isUnitInterval(raw.confidence)) return null;
      answers[key] = { box: { top, bottom, left, right }, confidence: raw.confidence };
    } else {
      return null; // unreachable: validateInput already restricted q.type
    }
  }
  return answers;
}

function abortError(name = 'AbortError') {
  const err = new Error(name === 'TimeoutError' ? 'timeout' : 'aborted');
  err.name = name;
  return err;
}

function withTimeout(promise, controller, timeoutMs, options = {}) {
  const setTimer = options.setTimeoutImpl || setTimeout;
  const clearTimer = options.clearTimeoutImpl || clearTimeout;
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      controller.abort();
      finish(reject, abortError());
    };
    const timer = setTimer(() => {
      controller.abort();
      finish(reject, abortError('TimeoutError'));
    }, Math.max(1, timeoutMs));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    promise.then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

function defaultSleep(ms, signal, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeoutImpl(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, abortError());
    const timer = setTimeoutImpl(() => finish(resolve), Math.max(0, ms));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function cancelBodyBounded(response, options = {}) {
  let body;
  try { body = response && response.body; } catch (_) { return; }
  if (!body || typeof body.cancel !== 'function') return;
  const remaining = typeof options.remainingMs === 'function'
    ? options.remainingMs()
    : Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : 250;
  const timeoutMs = Math.max(0, remaining);
  const setTimer = options.setTimeoutImpl || setTimeout;
  const clearTimer = options.clearTimeoutImpl || clearTimeout;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        clearTimer(timer);
        resolve();
      }
    };
    const timer = setTimer(finish, timeoutMs);
    Promise.resolve().then(() => body.cancel()).then(finish, finish);
  });
}

/**
 * Parse a Retry-After header value into a delay in ms, or null if absent /
 * unparseable. An oversized delta is Infinity: it is not a retry delay.
 */
function parseRetryAfter(value, wallNowMs) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return v.length > 9 ? Infinity : parseInt(v, 10) * 1000;
  if (v.length <= 64 && /[A-Za-z]{3}/.test(v)) {
    const time = Date.parse(v);
    const now = Number.isFinite(wallNowMs) ? wallNowMs : Date.now();
    if (Number.isFinite(time)) return Math.max(0, time - now);
  }
  return null;
}

function nextRetryDelayMs(attemptsMade, retryAfterMs, randomImpl) {
  if (typeof retryAfterMs === 'number') {
    if (!Number.isFinite(retryAfterMs) || retryAfterMs > MAX_RETRY_AFTER_MS) return null;
    return retryAfterMs + Math.floor(randomImpl() * RETRY_AFTER_JITTER_MS);
  }
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attemptsMade - 1));
  return Math.floor(randomImpl() * ceiling);
}

function createAttemptReceipt(context, outcome, error) {
  const data = outcome?.data;
  const reason = error ? 'request_failed' : outcome?.kind === 'http_error' || outcome?.kind === 'auth'
    ? 'error_response_not_parsed' : 'not_returned';
  const usage = isPlainObject(data?.usage) ? data.usage : null;
  const resolvedModel = isNonEmptyString(data?.model) ? data.model : null;
  const billing = isPlainObject(data?.billing) || (typeof data?.billing === 'number' && Number.isFinite(data.billing))
    ? data.billing : null;
  return Object.freeze({
    ...context, receiptId: crypto.randomUUID(), clock: 'monotonic_ms',
    provider: 'typesafe', endpoint: API_URL,
    kind: error ? 'request_error' : outcome.kind,
    status: outcome?.status ?? null,
    error: error ? error.name === 'TimeoutError' ? 'timeout' : error.name === 'AbortError' ? 'cancelled' : 'network_error' : null,
    resolvedModel, modelUnavailableReason: resolvedModel === null ? reason : null,
    usage, usageUnavailableReason: usage === null ? reason : null,
    billing, billingUnavailableReason: billing === null ? reason : null,
  });
}

async function requestWithRetry(options) {
  const o = options || {};
  const signals = [o.signal, o.reviewJob?.signal].filter(Boolean);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const fetchImpl = resolveFetch(o.fetchImpl);
  const apiKey = o.apiKey;
  const body = o.body;
  if (typeof body !== 'string') return { kind: 'local_error', code: 'invalid_body', attempts: 0, attemptReceipts: [] };
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  if (bodyBytes > MAX_BODY_BYTES) return { kind: 'local_error', code: 'payload too large', attempts: 0, attemptReceipts: [] };
  const bodyDigest = crypto.createHash('sha256').update(body).digest('hex');
  const attemptReceipts = [];
  const identity = { bodyBytes, bodyDigest,
    questionIds: o.preparedMetadata?.questionIds ?? null,
    questionCount: o.preparedMetadata?.questionCount ?? null,
    policyIdentity: o.preparedMetadata?.policyIdentity ?? null };
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 10000;
  const maxAttempts = Math.min(DEFAULT_MAX_ATTEMPTS, Number.isInteger(o.maxAttempts) && o.maxAttempts > 0 ? o.maxAttempts : DEFAULT_MAX_ATTEMPTS);
  const totalBudgetMs = Math.min(DEFAULT_TOTAL_BUDGET_MS, Number.isFinite(o.totalBudgetMs) && o.totalBudgetMs > 0 ? o.totalBudgetMs : DEFAULT_TOTAL_BUDGET_MS);
  const now = typeof o.nowImpl === 'function' ? o.nowImpl : monotonicNow;
  const wallNow = typeof o.wallNowImpl === 'function' ? o.wallNowImpl : Date.now;
  const sleep = typeof o.sleepImpl === 'function' ? o.sleepImpl : defaultSleep;
  const random = typeof o.randomImpl === 'function' ? o.randomImpl : Math.random;
  const setTimer = o.setTimeoutImpl || setTimeout;
  const clearTimer = o.clearTimeoutImpl || clearTimeout;
  const { store, token, entry } = observeCredential(apiKey, o.rateLimitState);
  const debug = (attempts, last) => {
    if (typeof o.debugLog !== 'function') return;
    try { o.debugLog(`typesafe: attempts=${attempts} last=${last}`); } catch (_) {}
  };
  if (signal?.aborted) throw abortError();
  if (entry.authFailed) {
    debug(0, entry.status || 401);
    return { kind: 'auth', status: entry.status || 401, authFailed: true, attempts: 0, attemptReceipts };
  }
  if (entry.until > now()) {
    debug(0, entry.status);
    return { kind: 'http_error', status: entry.status, cooldown: true, attempts: 0, attemptReceipts };
  }

  const deadline = now() + totalBudgetMs;
  let outcome = { kind: 'http_error', status: 529 };
  let attempts = 0;
  let last = 0;
  try {
    while (attempts < maxAttempts) {
      const remaining = deadline - now();
      if (remaining < MIN_USEFUL_ATTEMPT_MS) throw abortError('TimeoutError');
      if (signal?.aborted) throw abortError();
      const current = checkCredentialCooldown(apiKey, { rateLimitState: store, nowImpl: now });
      if (attempts > 0 && current) {
        outcome = { kind: 'http_error', status: current.status, cooldown: true };
        break;
      }
      if (o.reviewJob) {
        const admission = o.reviewJob.beforeDispatch();
        if (!admission.ok) return { kind: 'local_error', code: admission.code, attempts, attemptReceipts };
      }
      attempts += 1;
      const startedAtMs = now();
      const controller = new SafeAbortController();
      try {
        outcome = await withTimeout(
          performRequest(fetchImpl, apiKey, body, controller.signal, wallNow, {
            deadlineAt: Math.min(deadline, startedAtMs + timeoutMs),
            nowImpl: now,
            setTimeoutImpl: setTimer,
            clearTimeoutImpl: clearTimer,
            dialect: o.dialect,
            endpoint: o.endpoint,
            baseUrl: o.baseUrl,
            accountId: o.accountId,
            headers: o.headers,
            model: o.model,
          }),
          controller,
          Math.min(timeoutMs, remaining),
          { signal, setTimeoutImpl: setTimer, clearTimeoutImpl: clearTimer },
        );
      } catch (error) {
        attemptReceipts.push(createAttemptReceipt({ ...identity, attempt: attempts, startedAtMs, endedAtMs: now() }, null, error));
        throw error;
      }
      attemptReceipts.push(createAttemptReceipt({ ...identity, attempt: attempts, startedAtMs, endedAtMs: now() }, outcome));
      last = outcome.status === undefined ? 200 : outcome.status;
      if (outcome.kind !== 'http_error' || !RETRYABLE_STATUS.has(outcome.status)) break;
      if (attempts >= maxAttempts) break;
      const delay = nextRetryDelayMs(attempts, outcome.retryAfterMs, random);
      if (delay === null || now() + delay + MIN_USEFUL_ATTEMPT_MS > deadline) break;
      const sleepController = new SafeAbortController();
      await withTimeout(
        Promise.resolve(sleep(delay, sleepController.signal)),
        sleepController,
        Math.max(1, deadline - now()),
        { signal, setTimeoutImpl: setTimer, clearTimeoutImpl: clearTimer },
      );
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('request_failed');
    failure.attempts = attempts;
    failure.attemptReceipts = attemptReceipts;
    throw failure;
  } finally {
    debug(attempts, last);
  }

  if (isCurrentCredential(store, token) && outcome.kind === 'auth') {
    entry.authFailed = true;
    entry.status = outcome.status;
  }
  if (outcome.kind === 'http_error' && RETRYABLE_STATUS.has(outcome.status) && isCurrentCredential(store, token)) {
    const receivedAt = now();
    const retryAfterMs = outcome.retryAfterMs;
    const serverUntil = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? receivedAt + retryAfterMs : 0;
    const cooldownUntil = Math.max(receivedAt + RATE_LIMIT_COOLDOWN_MS, serverUntil);
    if (cooldownUntil > entry.until) {
      entry.until = cooldownUntil;
      entry.status = outcome.status;
    }
  }
  return { ...outcome, attempts, attemptReceipts,
    ...(entry.until > now() ? { cooldownUntil: entry.until } : {}) };
}

async function performRequest(fetchImpl, apiKey, body, signal, wallNowImpl, cleanupOptions = {}) {
  let response;
  let cleanupPromise;
  let cancellationRequested = false;
  const remainingMs = () => {
    if (typeof cleanupOptions.nowImpl !== 'function' || !Number.isFinite(cleanupOptions.deadlineAt)) return 250;
    return Math.max(0, cleanupOptions.deadlineAt - cleanupOptions.nowImpl());
  };
  const cancelResponseBody = () => {
    cancellationRequested = true;
    if (!response) return Promise.resolve();
    if (!cleanupPromise) cleanupPromise = cancelBodyBounded(response, { ...cleanupOptions, remainingMs });
    return cleanupPromise;
  };
  const cancelOnAbort = () => { void cancelResponseBody().catch(() => {}); };
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    const wire = buildSystemOneWirePayload(cleanupOptions.dialect, {
      apiKey,
      body,
      endpoint: cleanupOptions.endpoint,
      baseUrl: cleanupOptions.baseUrl,
      accountId: cleanupOptions.accountId,
      headers: cleanupOptions.headers,
      model: cleanupOptions.model,
    });
    response = await fetchImpl(wire.url, {
      method: 'POST',
      headers: wire.headers,
      body: wire.body,
      signal,
    });
    if (cancellationRequested) await cancelResponseBody();
    if (signal.aborted) {
      await cancelResponseBody();
      throw abortError();
    }
    if (response.status === 401 || response.status === 403) {
      await cancelResponseBody();
      return { kind: 'auth', status: response.status };
    }
    if (!response.ok) {
      const header = response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null;
      const retryAfterMs = parseRetryAfter(header, wallNowImpl());
      await cancelResponseBody();
      return { kind: 'http_error', status: response.status, retryAfterMs };
    }
    try {
      const rawJson = await response.json();
      const decoded = decodeSystemOneResponse(cleanupOptions.dialect, rawJson);
      return { kind: 'ok', status: response.status, data: rawJson, decoded };
    } catch (error) {
      await cancelResponseBody();
      if (signal.aborted) throw error;
      return { kind: 'bad_response', status: response.status };
    }
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
  }
}

/**
 * Validate, redact+cap, POST to TypeSafe System One, and sanitize the
 * response. Never throws. `homeDir` is injected (not read from os.homedir())
 * so callers/tests control what gets redacted to `~`.
 * @returns {Promise<TypeSafeJudgeResult>}
 */
async function judgeTypeSafe(options = {}) {
  const {
    fetchImpl: suppliedFetch, apiKey, args, homeDir, signal,
    trustedPolicy, trustedLimits, purpose = 'judge',
  } = options;
  const fetchImpl = resolveFetch(suppliedFetch);
  let policy;
  let policyClient;
  try {
    policyClient = require('./typesafe-policy-client.cjs');
    if (['resolveTrustedToolPolicy', 'validateRoutingQuestions', 'validateRoutingAnswers']
      .some((name) => typeof policyClient[name] !== 'function')) {
      return { ok: false, code: 'policy_client_missing', authError: false };
    }
    policy = policyClient.resolveTrustedToolPolicy(purpose, trustedPolicy !== undefined ? trustedPolicy : trustedLimits);
    if (!policy || typeof policy.ok !== 'boolean') {
      return { ok: false, code: 'policy_client_missing', authError: false };
    }
  } catch (_) {
    return { ok: false, code: 'policy_client_missing', authError: false };
  }
  if (!policy.ok) return { ok: false, code: 'policy_invalid', authError: false };
  const dialect = options.dialect || SYSTEM_ONE_DIALECTS.TYPESAFE;
  if (!VALID_DIALECTS.has(dialect)) {
    return { ok: false, code: 'invalid_dialect', authError: false };
  }
  const effectiveArgs = (dialect === SYSTEM_ONE_DIALECTS.WORKERS_AI_SYSTEMONE && !args?.model)
    ? { ...args, model: '@cf/cloudflare/clef' }
    : args;
  const prepared = prepareRequest(effectiveArgs, policy, { homeDirs: homeDir ? [homeDir] : undefined, apiKey });
  if (!prepared.ok) return { ...prepared, authError: false };
  const routing = policyClient.validateRoutingQuestions(prepared.questions, policy);
  if (!routing.ok) return { ...routing, authError: false };
  const coverage = await runPreparedValidation(prepared, options.validatePrepared);
  if (!coverage.ok) return { ...coverage, authError: false, metadata: prepared.metadata };
  if (!isNonEmptyString(apiKey)) return { ok: false, code: 'no_api_key', authError: false };
  if (typeof fetchImpl !== 'function') return { ok: false, code: 'no_fetch', authError: false };
  let outcome;
  try {
    outcome = await requestWithRetry({ ...options, dialect, fetchImpl, apiKey, body: prepared.body, signal, preparedMetadata: prepared.metadata });
  } catch (error) {
    return { ok: false, code: signal?.aborted || options.reviewJob?.signal.aborted ? 'cancelled'
      : error?.name === 'TimeoutError' ? 'timeout' : error?.name === 'AbortError' ? 'cancelled' : 'network_error',
      authError: false, metadata: { ...prepared.metadata, attempts: error?.attempts ?? 0,
        attemptReceipts: error?.attemptReceipts ?? [] } };
  }
  const metadata = { ...prepared.metadata, attempts: outcome.attempts, attemptReceipts: outcome.attemptReceipts };
  if (outcome.cooldown === true) metadata.cooldown = true;
  if (outcome.cooldownUntil !== undefined) metadata.cooldownUntil = outcome.cooldownUntil;
  if (outcome.kind === 'local_error') return { ok: false, code: outcome.code, authError: false, metadata };
  if (outcome.kind === 'auth' || outcome.kind === 'http_error') {
    return { ok: false, code: `http_${outcome.status}`, authError: outcome.kind === 'auth', metadata };
  }
  if (outcome.kind !== 'ok') return { ok: false, code: 'bad_response', authError: false, metadata };
  const decoded = outcome.decoded || decodeSystemOneResponse(dialect, outcome.data);
  if (isNonEmptyString(decoded.model)) metadata.resolvedModel = decoded.model;
  else if (isNonEmptyString(outcome.data?.model)) metadata.resolvedModel = outcome.data.model;
  if (isPlainObject(decoded.usage)) metadata.usage = decoded.usage;
  else if (isPlainObject(outcome.data?.usage)) metadata.usage = outcome.data.usage;
  if (decoded.cost !== null && decoded.cost !== undefined) metadata.cost = decoded.cost;
  if (decoded.billing !== null && decoded.billing !== undefined) metadata.billing = decoded.billing;
  else if (isPlainObject(outcome.data?.billing) || (typeof outcome.data?.billing === 'number' && Number.isFinite(outcome.data.billing))) {
    metadata.billing = outcome.data.billing;
  }
  const answers = sanitizeAnswers(prepared.questions, decoded.answers);
  if (!answers) return { ok: false, code: 'bad_response', authError: false, metadata };
  const compliance = policyClient.validateRoutingAnswers(prepared.questions, answers, policy);
  if (!compliance.ok) return { ...compliance, authError: false, metadata };
  return { ok: true, answers, metadata };
}

module.exports = {
  SYSTEM_ONE_DIALECTS,
  buildSystemOneWirePayload,
  decodeSystemOneResponse,
  validateInput,
  validateQuestionCount,
  prepareRequest,
  redactEvidenceState,
  runPreparedValidation,
  sanitizeAnswers,
  getChoiceOptions,
  judgeTypeSafe,
  requestWithRetry,
  checkCredentialCooldown,
  cancelBodyBounded,
  resetRateLimitState,
  parseRetryAfter,
  RETRY_POLICY,
};
