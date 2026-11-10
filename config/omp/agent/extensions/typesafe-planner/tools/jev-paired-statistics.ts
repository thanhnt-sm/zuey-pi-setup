export interface QuantileInterval { lower:number|null; upper:number|null; lowerRank:number; upperRank:number|null; reason:string|null }
export interface RiskSummary { events:number; denominator:number; estimate:number|null; upper95:number|null; zeroEventUpper95:number|null; reason:string|null }
// Binomial calculations in log space avoid factorial overflow and tail cancellation.
function logAdd(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const hi = Math.max(a, b);
  return hi + Math.log1p(Math.exp(Math.min(a, b) - hi));
}
export function binomialTail(n: number, p: number, from: number, to: number): number {
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isFinite(p) || p < 0 || p > 1 || !Number.isFinite(from) || !Number.isFinite(to)) throw new Error("invalid_binomial_parameters");
  const lo = Math.max(0, Math.ceil(from)), hi = Math.min(n, Math.floor(to));
  if (lo > hi) return 0;
  if (p === 0) return lo === 0 ? 1 : 0;
  if (p === 1) return hi === n ? 1 : 0;
  let logCombination = 0, sum = -Infinity;
  const lp = Math.log(p), lq = Math.log1p(-p);
  for (let k = 0; k <= hi; k++) {
    if (k >= lo) sum = logAdd(sum, logCombination + k * lp + (n - k) * lq);
    if (k < hi) logCombination += Math.log(n - k) - Math.log(k + 1);
  }
  return Math.min(1, Math.exp(sum));
}
export function clopperPearson(k: number, n: number, alpha = .025): { lower: number; upper: number } {
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(n) || n <= 0 || k < 0 || k > n || !Number.isFinite(alpha) || alpha <= 0 || alpha >= .5) throw new Error("invalid_interval_parameters");
  let lower = 0, upper = 1;
  if (k > 0) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 90; i++) { const p = (lo + hi) / 2; if (binomialTail(n, p, k, n) < alpha) lo = p; else hi = p; }
    lower = (lo + hi) / 2;
  }
  if (k < n) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 90; i++) { const p = (lo + hi) / 2; if (binomialTail(n, p, 0, k) > alpha) lo = p; else hi = p; }
    upper = (lo + hi) / 2;
  }
  return { lower, upper };
}
export function pairedImprovement(a: number, b: number, n: number): number | null {
  if (![a,b,n].every(Number.isSafeInteger) || a < 0 || b < 0 || n < 0 || a+b > n) throw new Error("invalid_discordant_counts");
  if (n === 0) return null;
  return clopperPearson(a, n).lower - clopperPearson(b, n).upper;
}
export function zeroEventUpper(m: number): number | null {
  if (!Number.isSafeInteger(m) || m < 0) throw new Error("invalid_risk_denominator");
  return m === 0 ? null : -Math.expm1(Math.log(.05) / m);
}
export function nearestRank(values: number[], q: number): number | null {
  if (!Number.isFinite(q) || q <= 0 || q > 1 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error("invalid_quantile");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(q * sorted.length) - 1] : null;
}
export function quantileInterval(values: number[], q = .95): QuantileInterval {
  if (!Number.isFinite(q) || q <= 0 || q > 1 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error("invalid_quantile");
  const x = [...values].sort((a, b) => a - b), n = x.length;
  if (!n) return { lower: null, upper: null, lowerRank: 0, upperRank: null, reason: "no_observations" };
  // X_(r) <= population quantile iff Binomial(n,q) >= r. Each tail is <= .025.
  let lowerRank = 0;
  for (let r = 1; r <= n; r++) { if (binomialTail(n, q, 0, r - 1) <= .025) lowerRank = r; else break; }
  let upperRank: number | null = null;
  for (let r = 1; r <= n; r++) if (binomialTail(n, q, r, n) <= .025) { upperRank = r; break; }
  return { lower: lowerRank ? x[lowerRank - 1] : 0, upper: upperRank ? x[upperRank - 1] : null, lowerRank, upperRank, reason: upperRank === null ? "unsupported_upper_rank_unbounded" : null };
}

export function riskSummary(events:number,denominator:number):RiskSummary {
  if (!Number.isSafeInteger(events) || !Number.isSafeInteger(denominator) || events < 0 || denominator < events) throw new Error("invalid_risk_counts");
  if (denominator === 0) return {events,denominator,estimate:null,upper95:null,zeroEventUpper95:null,reason:"no_eligible_observations"};
  const zeroUpper = events === 0 ? zeroEventUpper(denominator) : null;
  return {events,denominator,estimate:events/denominator,upper95:zeroUpper ?? clopperPearson(events,denominator,.05).upper,zeroEventUpper95:zeroUpper,reason:null};
}
