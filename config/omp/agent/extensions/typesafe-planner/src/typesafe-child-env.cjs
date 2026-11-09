"use strict";
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const BASE = Object.freeze(["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"]);
const DEPLOYMENT = Object.freeze(["OMP_WORKSPACE_DIR", "OMP_TARGET_DIR", "OMP_HOME_DIR", "OMP_EXTENSION_POINTER", "OMP_BACKUP_DIR", "OMP_BUN_BIN"]);
const PURPOSES = Object.freeze(["evidence-git", "verification", "egc-setup", "deployment-acl", "deployment-verify", "deployment-sync", "pointer-editor"]);
const GIT_FIXED = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsmonitor", GIT_CONFIG_VALUE_1: "false",
  GIT_CONFIG_KEY_2: "credential.helper", GIT_CONFIG_VALUE_2: "",
});
class ChildEnvironmentError extends Error {
  constructor(code) { super(`Child environment rejected: ${code}`); this.name = "ChildEnvironmentError"; this.code = code; }
}
const NAMED_SECRETS = ["TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const SECRET_SUFFIX = /(?:_API_KEY|_SECRET|_TOKEN|_PASSWORD)$/i;
const reject = (code) => { throw new ChildEnvironmentError(code); };
function collectSecrets(values) {
  const discovered = [];
  for (const name of NAMED_SECRETS) {
    const v = values.get(name.toUpperCase());
    if (typeof v === "string" && v.trim().length > 0) discovered.push(v, v.trim());
  }
  for (const [key, v] of values.entries()) {
    if (SECRET_SUFFIX.test(key) && typeof v === "string" && v.trim().length >= 12) discovered.push(v, v.trim());
  }
  return [...new Set(discovered.filter(Boolean))];
}
function policy(purpose) {
  if (!PURPOSES.includes(purpose)) reject("UNKNOWN_PURPOSE");
  return { version: 1, purpose, names: purpose === "deployment-sync" ? [...BASE, ...DEPLOYMENT] : [...BASE], required: process.platform === "win32" ? ["PATH", "SystemRoot"] : ["PATH"], absolutePaths: purpose === "deployment-sync" ? DEPLOYMENT.filter((name) => name !== "OMP_BUN_BIN") : [], executableNames: purpose === "deployment-sync" ? ["OMP_BUN_BIN"] : [], secretNames: NAMED_SECRETS, fixed: ["evidence-git", "egc-setup"].includes(purpose) ? GIT_FIXED : {}, maxValueBytes: 32768 };
}
function canonicalSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) reject("INVALID_SOURCE");
  const values = new Map();
  for (const name of Object.keys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, name);
    if (!descriptor || !("value" in descriptor)) reject("INVALID_SOURCE");
    const value = descriptor.value;
    if (value === undefined) continue;
    if (typeof value !== "string") reject("INVALID_VALUE");
    const key = name.toUpperCase();
    if (values.has(key) && values.get(key) !== value) reject("CASE_COLLISION");
    values.set(key, value);
  }
  return values;
}
function buildChildEnvironment(purpose, source = process.env) {
  const rules = policy(purpose); const values = canonicalSource(source); const result = {};
  const secrets = collectSecrets(values);
  for (const name of rules.names) {
    const value = values.get(name.toUpperCase());
    if (value === undefined || value === "") continue;
    if (value.includes("\0") || Buffer.byteLength(value) > rules.maxValueBytes || secrets.some((secret) => value.includes(secret))) reject("UNSAFE_ALLOWED_VALUE");
    if (rules.absolutePaths.includes(name) && (!path.isAbsolute(value) || /[\r\n]/.test(value))) reject("INVALID_DEPLOYMENT_PATH");
    if (rules.executableNames.includes(name) && !(path.isAbsolute(value) || /^[a-zA-Z0-9_.-]+$/.test(value))) reject("INVALID_EXECUTABLE");
    result[name] = value;
  }
  for (const name of rules.required) if (!result[name]) reject("MISSING_REQUIRED_OS_VALUE");
  Object.assign(result, rules.fixed);
  if (Object.values(result).some((value) => secrets.some((secret) => value.includes(secret)))) reject("UNSAFE_ALLOWED_VALUE");
  return result;
}
function processOptions(purpose, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "env")) reject("CALLER_ENV_FORBIDDEN");
  const { source = process.env, ...rest } = options;
  return { ...rest, env: buildChildEnvironment(purpose, source) };
}
function spawnChild(purpose, command, args = [], options = {}) { return childProcess.spawn(command, args, processOptions(purpose, options)); }
function spawnChildSync(purpose, command, args = [], options = {}) { return childProcess.spawnSync(command, args, processOptions(purpose, options)); }
function execFileChildSync(purpose, command, args = [], options = {}) { return childProcess.execFileSync(command, args, processOptions(purpose, options)); }
function execChildSync(purpose, command, options = {}) { return childProcess.execSync(command, processOptions(purpose, options)); }
function createVerificationHome() {
  const parent = fs.realpathSync.native(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "typesafe-verification-home-"));
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  const original = fs.lstatSync(directory, { bigint: true }); let closed = false;
  function assertOwned() {
    const current = fs.lstatSync(directory, { bigint: true });
    if (closed || current.isSymbolicLink() || !current.isDirectory() || current.ino !== original.ino || current.dev !== original.dev || fs.realpathSync.native(directory) !== directory) reject("VERIFICATION_HOME_CHANGED");
  }
  return Object.freeze({
    environment(purpose, source = process.env) {
      if (purpose !== "verification" && purpose !== "deployment-verify") reject("HOME_PURPOSE_FORBIDDEN");
      assertOwned();
      const result = { ...buildChildEnvironment(purpose, source), HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: directory, XDG_CACHE_HOME: directory, XDG_DATA_HOME: directory };
      const secrets = collectSecrets(canonicalSource(source));
      if (secrets.some((secret) => Object.values(result).some((value) => value.includes(secret)))) reject("UNSAFE_ALLOWED_VALUE");
      return result;
    },
    execFileSync(purpose, command, args = [], options = {}) {
      if (Object.prototype.hasOwnProperty.call(options, "env")) reject("CALLER_ENV_FORBIDDEN");
      const { source = process.env, ...rest } = options;
      return childProcess.execFileSync(command, args, { ...rest, env: this.environment(purpose, source) });
    },
    spawn(purpose, command, args = [], options = {}) {
      if (Object.prototype.hasOwnProperty.call(options, "env")) reject("CALLER_ENV_FORBIDDEN");
      const { source = process.env, ...rest } = options;
      return childProcess.spawn(command, args, { ...rest, env: this.environment(purpose, source) });
    },
    cleanup() { assertOwned(); closed = true; fs.rmSync(directory, { recursive: true, force: true }); },
  });
}
module.exports = { buildChildEnvironment, spawnChild, spawnChildSync, execFileChildSync, execChildSync, createVerificationHome, ChildEnvironmentError };
if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--policy-json") reject("POLICY_CLI_ARGUMENTS");
    process.stdout.write(`${JSON.stringify(policy(process.argv[3]))}\n`);
  } catch (error) { process.stderr.write(`${error instanceof ChildEnvironmentError ? error.code : "POLICY_FAILURE"}\n`); process.exitCode = 1; }
}
