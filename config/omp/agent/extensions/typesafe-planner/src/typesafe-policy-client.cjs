'use strict';

/** @typedef {import('./payload-safety').TrustedToolPolicy} TrustedToolPolicy */
/** @typedef {import('./payload-safety').ResolvedToolPolicy} ResolvedToolPolicy */
/** @typedef {import('./payload-safety').TypeSafeJudgeResult} TypeSafeJudgeResult */
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
function loadApiClient() {
  try {
    const api = require('./typesafe-api-client.cjs');
    return api && typeof api.judgeTypeSafe === 'function' && typeof api.prepareRequest === 'function'
      && typeof api.runPreparedValidation === 'function' && typeof api.sanitizeAnswers === 'function' ? api : null;
  } catch (_) { return null; }
}
const PURPOSES = Object.freeze(['judge', 'rerank', 'multi', 'plan', 'debate', 'advisory',
  'expert', 'advisor', 'native_done', 'native_drop', 'decision', 'health', 'egc', 'evaluation']);
const REVIEW_LIMITS = Object.freeze({ maxPackets: 128, maxDispatches: 384, deadlineMs: 300000,
  maxActive: 1, maxQueued: 1 });
const POLICY_FIELDS = Object.freeze({ maxQuestionsPerRequest: true, provider: true, routing: true, semanticReviewLimits: true });
const PROVIDER_FIELDS = Object.freeze({ allowedModels: true });
const ROUTING_FIELDS = Object.freeze({ baseline: true, lattice: true, questionKeys: true });
const hasOnlyFields = (value, fields) => Object.keys(value).every((key) => Object.prototype.hasOwnProperty.call(fields, key));
const snapshots = new WeakSet();
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value) => Array.isArray(value) && value.length > 0 &&
  value.every((item) => typeof item === 'string' && item.trim() === item && item.length > 0) &&
  new Set(value).size === value.length;

function checkPolicy(baseline, choice, lattice) {
  const baselineIndex = Array.isArray(lattice) ? lattice.indexOf(baseline) : -1;
  const choiceIndex = Array.isArray(lattice) ? lattice.indexOf(choice) : -1;
  if (baselineIndex < 0 || choiceIndex < 0) return { ok: false, reason: 'unknown-choice', attempted: choice, baseline };
  if (choiceIndex < baselineIndex) return { ok: false, reason: 'lattice-violation', attempted: choice, baseline };
  return { ok: true, choice };
}

/**
 * Called once by a host registration; only these host options supply policy.
 * @param {import('./payload-safety').JudgePurpose} purpose
 * @param {TrustedToolPolicy | ResolvedToolPolicy} [supplied]
 * @returns {ResolvedToolPolicy}
 */
function resolveTrustedToolPolicy(purpose, supplied, trustedDefaults = {}) {
  try {
    return resolvePolicySnapshot(purpose, supplied, trustedDefaults);
  } catch (_) {
    return invalid(purpose);
  }
}

function resolvePolicySnapshot(purpose, supplied, trustedDefaults) {
  if (snapshots.has(supplied)) return supplied.purpose === purpose ? supplied : invalid(purpose);
  if (!PURPOSES.includes(purpose) || (supplied !== undefined && !object(supplied))) return invalid(purpose);
  if (supplied?.ok === false) return invalid(purpose);
  const source = supplied ?? {
    maxQuestionsPerRequest: 128, provider: { allowedModels: ['jev-latest', 'jev-1.14.0', 'typesafe/jev-latest', 'typesafe/jev-1.14.0', '@cf/cloudflare/clef'] },
    ...(purpose === 'judge' ? { routing: {
      baseline: trustedDefaults.baseline === undefined ? 'review' : trustedDefaults.baseline,
      lattice: trustedDefaults.lattice === undefined ? ['auto', 'review', 'block'] : trustedDefaults.lattice,
    } } : {}),
  };
  if (!hasOnlyFields(source, POLICY_FIELDS) || !Number.isSafeInteger(source.maxQuestionsPerRequest) ||
      source.maxQuestionsPerRequest < 1 || source.maxQuestionsPerRequest > 128 || !object(source.provider) ||
      !hasOnlyFields(source.provider, PROVIDER_FIELDS) || !strings(source.provider.allowedModels)) return invalid(purpose);
  let routing;
  if (source.routing !== undefined) {
    const r = source.routing;
    if (!object(r) || !hasOnlyFields(r, ROUTING_FIELDS) || !strings(r.lattice) || r.lattice.length < 2 || !r.lattice.includes(r.baseline) ||
        (r.questionKeys !== undefined && !strings(r.questionKeys))) return invalid(purpose);
    routing = Object.freeze({ baseline: r.baseline, lattice: Object.freeze([...r.lattice]),
      ...(r.questionKeys ? { questionKeys: Object.freeze([...r.questionKeys]) } : {}) });
  }
  const limits = source.semanticReviewLimits === undefined ? REVIEW_LIMITS : source.semanticReviewLimits;
  if (!object(limits) || !hasOnlyFields(limits, REVIEW_LIMITS)) return invalid(purpose);
  const semanticReviewLimits = {};
  for (const [key, ceiling] of Object.entries(REVIEW_LIMITS)) {
    const value = limits[key] === undefined ? ceiling : limits[key];
    if (!Number.isSafeInteger(value) || value < (key === 'maxQueued' ? 0 : 1) || value > ceiling) return invalid(purpose);
    semanticReviewLimits[key] = value;
  }
  const policy = { purpose, maxQuestionsPerRequest: source.maxQuestionsPerRequest,
    provider: Object.freeze({ allowedModels: Object.freeze([...source.provider.allowedModels]) }),
    ...(routing ? { routing } : {}), semanticReviewLimits: Object.freeze(semanticReviewLimits) };
  const policyIdentity = crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  const result = Object.freeze({ ok: true, ...policy, policyIdentity });
  snapshots.add(result);
  return result;
}

function invalid(purpose) { return Object.freeze({ ok: false, code: 'policy_invalid', purpose }); }

function resolveToolPolicies(overrides = {}, trustedDefaults = {}) {
  return Object.freeze(Object.fromEntries(PURPOSES.map((purpose) => {
    try {
      return [purpose, resolveTrustedToolPolicy(purpose, object(overrides) ? overrides[purpose] : null, trustedDefaults)];
    } catch (_) {
      return [purpose, invalid(purpose)];
    }
  })));
}

function routingKeys(questions, policy) {
  if (!policy.routing) return { ok: true, keys: [] };
  const { lattice, questionKeys } = policy.routing;
  const keys = [];
  for (const key of questionKeys ?? Object.keys(questions)) {
    const question = questions[key];
    const configured = questionKeys !== undefined;
    if (!question || question.type !== 'choice') {
      if (configured) return { ok: false, code: 'routing_question_invalid' };
      continue;
    }
    const options = Object.keys(question.criteria);
    const known = options.filter((option) => lattice.includes(option)).length;
    if (configured || known > 0) {
      if (known !== options.length) return { ok: false, code: 'unknown-choice' };
      keys.push(key);
    }
  }
  return { ok: true, keys };
}

function validateRoutingAnswers(questions, answers, policy) {
  const routing = routingKeys(questions, policy);
  if (!routing.ok) return routing;
  for (const key of routing.keys) {
    const compliance = checkPolicy(policy.routing.baseline, answers?.[key]?.choice, policy.routing.lattice);
    if (!compliance.ok) return { ...compliance, code: compliance.reason };
  }
  return { ok: true };
}

/** @returns {Promise<TypeSafeJudgeResult>} */
async function judgeWithPolicy(options) {
  const { args, purpose = 'judge', trustedPolicy, judgeFn } = options;
  const policy = resolveTrustedToolPolicy(purpose, trustedPolicy);
  if (!policy.ok) return { ok: false, code: 'policy_invalid', authError: false };
  const api = loadApiClient();
  if (!api) return { ok: false, code: 'api_client_unavailable', authError: false };
  if (typeof judgeFn !== 'function') return api.judgeTypeSafe({ ...options, trustedPolicy: policy });
  const prepared = api.prepareRequest(args, policy, {
    apiKey: options.apiKey, homeDirs: options.homeDir ? [options.homeDir] : undefined,
  });
  if (!prepared.ok) return { ...prepared, authError: false };
  const routing = routingKeys(prepared.questions, policy);
  if (!routing.ok) return { ...routing, authError: false };
  const coverage = await api.runPreparedValidation(prepared, options.validatePrepared);
  if (!coverage.ok) return { ...coverage, authError: false, metadata: prepared.metadata };
  const signals = [options.signal, options.reviewJob?.signal].filter(Boolean);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  if (signal?.aborted) return { ok: false, code: 'cancelled', authError: false };
  let raw;
  try {
    raw = await judgeFn(JSON.parse(prepared.body), { signal });
  } catch (_) { return { ok: false, code: 'judge_unavailable', authError: false }; }
  if (signal?.aborted) return { ok: false, code: 'cancelled', authError: false };
  if (!raw) return { ok: false, code: 'judge_unavailable', authError: false };
  const metadata = { ...prepared.metadata };
  if (typeof raw.metadata?.resolvedModel === 'string' && raw.metadata.resolvedModel.trim()) metadata.resolvedModel = raw.metadata.resolvedModel;
  if (object(raw.metadata?.usage)) metadata.usage = raw.metadata.usage;
  if (Number.isSafeInteger(raw.metadata?.attempts) && raw.metadata.attempts >= 0) metadata.attempts = raw.metadata.attempts;
  if (Array.isArray(raw.metadata?.attemptReceipts)) metadata.attemptReceipts = raw.metadata.attemptReceipts;
  if (object(raw.metadata?.billing) || (typeof raw.metadata?.billing === 'number' && Number.isFinite(raw.metadata.billing))) {
    metadata.billing = raw.metadata.billing;
  }
  if (raw.metadata?.cooldown === true) metadata.cooldown = true;
  if (typeof raw.metadata?.cooldownUntil === 'number' && Number.isFinite(raw.metadata.cooldownUntil)) {
    metadata.cooldownUntil = raw.metadata.cooldownUntil;
  }
  if (typeof raw.model === 'string' && raw.model.trim()) metadata.resolvedModel = raw.model;
  if (object(raw.usage)) metadata.usage = raw.usage;
  if (object(raw.billing) || (typeof raw.billing === 'number' && Number.isFinite(raw.billing))) metadata.billing = raw.billing;
  if (raw.ok === false) {
    const code = typeof raw.code === 'string' && /^[A-Za-z0-9_: ]{1,64}$/.test(raw.code) ? raw.code : 'judge_unavailable';
    return { ok: false, code, authError: raw.authError === true, metadata };
  }
  const answers = api.sanitizeAnswers(prepared.questions, raw.answers);
  if (!answers) return { ok: false, code: 'bad_response', authError: false, metadata };
  const result = { ok: true, answers, metadata };
  const compliance = validateRoutingAnswers(prepared.questions, result.answers, policy);
  if (!compliance.ok) return { ...compliance, authError: false, metadata };
  return result;
}

/** One registration owns its scheduler; manifests contain IDs/criteria, never bodies. */
function createSemanticReviewScheduler(trustedPolicy, options = {}) {
  if (!snapshots.has(trustedPolicy) || !trustedPolicy.ok) throw new Error('policy_invalid');
  const limits = trustedPolicy.semanticReviewLimits;
  const now = options.nowImpl ?? (() => performance.now());
  const setTimer = options.setTimeoutImpl ?? setTimeout;
  const clearTimer = options.clearTimeoutImpl ?? clearTimeout;
  let active = 0;
  const queue = [];
  function run(manifest, worker, runOptions = {}) {
    const admittedAtMs = now();
    if (!Array.isArray(manifest) || manifest.length === 0 || manifest.length > limits.maxPackets ||
        manifest.some((packet) => !object(packet) || typeof packet.id !== 'string' || !packet.id || !strings(packet.criteria)) ||
        new Set(manifest.map((packet) => packet.id)).size !== manifest.length) {
      return Promise.resolve({ ok: false, code: 'review_packet_limit',
        coverage: { packetCount: Array.isArray(manifest) ? manifest.length : 0, covered: [],
          uncovered: Array.isArray(manifest) ? manifest : [] } });
    }
    const coverage = Object.freeze(manifest.map((packet) => Object.freeze({ id: packet.id,
      criteria: Object.freeze([...packet.criteria]) })));
    if (active >= limits.maxActive && queue.length >= limits.maxQueued) {
      return Promise.resolve({ ok: false, code: 'review_queue_full',
        coverage: { packetCount: coverage.length, covered: [], uncovered: coverage } });
    }
    const { promise, resolve } = Promise.withResolvers();
    const controller = new AbortController();
    const deadline = admittedAtMs + limits.deadlineMs;
    const admitted = new Set();
    const covered = new Set();
    let dispatches = 0;
    let finished = false;
    let started = false;
    let timer;
    const snapshot = () => ({ dispatches, packetCount: coverage.length,
      covered: coverage.filter((packet) => covered.has(packet.id)),
      uncovered: coverage.filter((packet) => !covered.has(packet.id)) });
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimer(timer);
      runOptions.signal?.removeEventListener('abort', cancel);
      const queuedIndex = queue.indexOf(start);
      if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
      if (started) active -= 1;
      resolve({ ...result, coverage: snapshot() });
      if (active < limits.maxActive) queue.shift()?.();
    };
    const stop = (code) => { controller.abort(); finish({ ok: false, code }); };
    const cancel = () => stop('cancelled');
    const job = Object.freeze({ signal: controller.signal, manifest: coverage, snapshot,
      admitPacket(id) {
        if (finished || controller.signal.aborted) return { ok: false, code: 'cancelled' };
        if (now() >= deadline) { stop('review_deadline_exceeded'); return { ok: false, code: 'review_deadline_exceeded' }; }
        if (!coverage.some((packet) => packet.id === id) || admitted.has(id)) return { ok: false, code: 'review_packet_invalid' };
        admitted.add(id);
        return { ok: true };
      },
      markCovered(id) {
        if (!finished && admitted.has(id)) covered.add(id);
      },
      beforeDispatch() {
        if (finished || controller.signal.aborted) return { ok: false, code: 'cancelled' };
        if (now() >= deadline) { stop('review_deadline_exceeded'); return { ok: false, code: 'review_deadline_exceeded' }; }
        if (admitted.size === 0) return { ok: false, code: 'review_packet_not_admitted' };
        if (dispatches >= limits.maxDispatches) return { ok: false, code: 'review_dispatch_limit' };
        dispatches += 1;
        return { ok: true };
      },
    });
    const start = () => {
      if (finished) return;
      started = true;
      active += 1;
      Promise.resolve().then(() => {
        if (finished) return;
        if (now() >= deadline) { stop('review_deadline_exceeded'); return; }
        return worker(job);
      }).then((result) => {
        if (finished) return;
        if (covered.size !== coverage.length) finish({ ok: false, code: 'EVIDENCE_REQUIRED', result });
        else finish(result);
      }, () => finish({ ok: false, code: 'review_unavailable' }));
    };
    timer = setTimer(() => stop('review_deadline_exceeded'), Math.max(0, deadline - now()));
    if (runOptions.signal?.aborted) { cancel(); return promise; }
    runOptions.signal?.addEventListener('abort', cancel, { once: true });
    if (active < limits.maxActive) start(); else queue.push(start);
    return promise;
  }
  return Object.freeze({ run });
}

module.exports = { checkPolicy, judgeWithPolicy, resolveTrustedToolPolicy, resolveToolPolicies,
  validateRoutingQuestions: routingKeys, validateRoutingAnswers, createSemanticReviewScheduler };
