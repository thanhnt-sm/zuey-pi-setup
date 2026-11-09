import { createRequire } from "node:module";
import { types } from "node:util";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Redactor {
  redactString(value: string, options: { apiKey?: string }): string;
  sensitiveKeyKind(value: string): string | null;
  sensitiveCamelKeyKind(value: string): string | null;
}
const redact = createRequire(import.meta.url)("./typesafe-redact-patterns.cjs") as Redactor;
export class EgcBoundaryError extends Error {
  constructor(readonly code: string) { super(code); this.name = "EgcBoundaryError"; }
}
const fail = (code: string): never => { throw new EgcBoundaryError(code); };
const keysNow = () => [...new Set([process.env.TYPESAFE_API_KEY ?? "", process.env.TYPESAFE_API_KEY?.trim() ?? ""].filter(Boolean))];
function decoded(value: string): string {
  return value.replace(/\\u([\da-f]{4})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([\da-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
function residual(value: string, keys: string[]): boolean {
  const expanded = decoded(value);
  return keys.some((key) => value.includes(key) || expanded.includes(key));
}
/** Validate before traversal invokes any user code. Limits include keys and values. */
export function boundedEgcJson(input: unknown): Json {
  let nodes = 0, bytes = 0;
  const active = new Set<object>();
  const text = (value: string) => {
    const size = Buffer.byteLength(value);
    if (size > 32768) fail("egc_string_limit");
    bytes += size;
    if (bytes > 131072) fail("egc_aggregate_limit");
    return value;
  };
  function visit(value: unknown, depth: number): Json {
    if (++nodes > 2000) fail("egc_node_limit");
    if (depth > 5) fail("egc_depth_limit");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return text(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : fail("egc_nonfinite");
    if (typeof value !== "object") return fail("egc_unsupported_value");
    if (types.isProxy(value)) fail("egc_unsupported_object");
    if (active.has(value)) fail("egc_cycle");
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if ((!array && proto !== Object.prototype && proto !== null) || (array && proto !== Array.prototype)) fail("egc_unsupported_object");
    const properties = Reflect.ownKeys(value);
    if (properties.length > 2000 - nodes + 1) fail("egc_node_limit");
    active.add(value);
    const arrayItems: Json[] = [];
    const objectItems: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
    for (const key of properties) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || key === "toJSON") fail("egc_unsupported_property");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("egc_accessor");
      text(key);
      if (array) {
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) !== arrayItems.length) fail("egc_sparse_array");
        arrayItems.push(visit(descriptor.value, depth + 1));
      } else objectItems[key] = visit(descriptor.value, depth + 1);
    }
    if (array && Object.getOwnPropertyDescriptor(value, "length")?.value !== arrayItems.length) fail("egc_sparse_array");
    active.delete(value);
    return array ? arrayItems : objectItems;
  }
  try { return visit(input, 0); } catch (error) {
    if (error instanceof EgcBoundaryError) throw error;
    return fail("egc_traversal_failed");
  }
}
/** Authoritative IDs must round trip unchanged, including task content. */
export function assertEgcIdentity(value: string): void {
  const keys = keysNow();
  if (residual(value, keys)) fail("egc_sensitive_identity");
  try { if (redact.redactString(value, { apiKey: keys[0] }) !== value) fail("egc_sensitive_identity"); }
  catch (error) { if (error instanceof EgcBoundaryError) throw error; fail("egc_redaction_failed"); }
}
/** One safe projection for HTTP, host, persistence, notifications and returned errors. */
export function prepareEgcData(input: unknown): Json {
  const safe = boundedEgcJson(input), keys = keysNow();
  const cleanText = (value: string) => {
    let result = value;
    for (const apiKey of keys.length ? keys : [""]) result = redact.redactString(result, { apiKey });
    if (residual(result, keys)) fail("egc_residual_secret");
    return result;
  };
  function clean(value: Json, path: string[]): Json {
    if (typeof value === "string") return cleanText(value);
    if (Array.isArray(value)) return value.map((item) => clean(item, path));
    if (!value || typeof value !== "object") return value;
    const result: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
    for (const [key, item] of Object.entries(value)) {
      const roundTrip = path.length === 1 && path[0] === "questions" || path.at(-1) === "criteria" && path[0] === "questions";
      if (roundTrip) assertEgcIdentity(key);
      const nextKey = roundTrip ? key : cleanText(key);
      if (Object.hasOwn(result, nextKey)) fail("egc_key_collision");
      const sensitive = redact.sensitiveKeyKind(key) || redact.sensitiveCamelKeyKind(key);
      result[nextKey] = sensitive && item !== null && typeof item !== "boolean" ? "[REDACTED:kv]" : clean(item, [...path, key]);
    }
    return result;
  }
  try {
    const result = clean(safe, []), serialized = JSON.stringify(result);
    if (residual(serialized, keys)) fail("egc_residual_secret");
    return result;
  } catch (error) {
    if (error instanceof EgcBoundaryError) throw error;
    return fail("egc_redaction_failed");
  }
}
export function egcBoundaryCode(error: unknown): string {
  return error instanceof EgcBoundaryError ? error.code : "egc_unavailable";
}

/** Final encoding guard for on-disk bytes; never reopen or reserialize after this boundary. */
export function serializeEgcData(input: unknown): string {
  try {
    const serialized = JSON.stringify(prepareEgcData(input));
    if (residual(serialized, keysNow())) fail("egc_residual_secret");
    return serialized;
  } catch (error) {
    if (error instanceof EgcBoundaryError) throw error;
    return fail("egc_serialization_failed");
  }
}

/** Native tool-result details are a payload inside a host envelope, not extra payload nesting. */
export function boundedEgcToolResult(input: unknown): Record<string, unknown> {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("egc_unsupported_object");
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) fail("egc_unsupported_object");
    const envelope: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let details: Json = null;
    const properties = Reflect.ownKeys(input);
    if (properties.length > 2000) fail("egc_node_limit");
    for (const key of properties) {
      if (typeof key !== "string" || key === "toJSON") fail("egc_unsupported_property");
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("egc_accessor");
      if (key === "details") details = boundedEgcJson(descriptor.value);
      else envelope[key] = descriptor.value;
    }
    const cloned = boundedEgcJson(envelope);
    if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) fail("egc_invalid_result");
    const pending: Json[] = [cloned, details];
    let nodes = 0;
    while (pending.length) {
      if (++nodes > 2000) fail("egc_node_limit");
      const current = pending.pop();
      if (Array.isArray(current)) pending.push(...current);
      else if (current && typeof current === "object") pending.push(...Object.values(current));
    }
    if (Buffer.byteLength(JSON.stringify(cloned)) + Buffer.byteLength(JSON.stringify(details)) > 131072) fail("egc_aggregate_limit");
    cloned.details = details;
    return cloned;
  } catch (error) {
    if (error instanceof EgcBoundaryError) throw error;
    return fail("egc_traversal_failed");
  }
}
