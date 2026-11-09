"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class WorkspaceFileError extends Error {
  constructor(code, kind = "security") { super(`Workspace file rejected: ${code}`); this.name = "WorkspaceFileError"; this.code = code; this.kind = kind; }
}
const reject = (code, kind) => { throw new WorkspaceFileError(code, kind); };
function identity(stat) {
  if (stat.ino === 0n || stat.dev < 0n || ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs", "birthtimeNs"].some((key) => typeof stat[key] !== "bigint")) reject("IDENTITY_UNAVAILABLE");
  return Object.freeze(Object.fromEntries(["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs", "birthtimeNs"].map((key) => [key, String(stat[key])])));
}
function sameIdentity(a, b) { return Object.keys(a).every((key) => a[key] === b[key]); }
function sameNode(a, b) { return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode; }
function comparable(value) { return process.platform === "win32" ? value.toLowerCase() : value; }
function contained(root, candidate) {
  const relative = path.relative(comparable(root), comparable(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function parts(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || /[\x00:]/.test(relativePath) || (process.platform === "win32" && /[\x01-\x1f]/.test(relativePath)) || path.isAbsolute(relativePath) || /^[\\/]/.test(relativePath)) reject("UNSAFE_PATH");
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^\.claude$/i.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) reject("UNSAFE_PATH");
  return segments;
}
function inspectDirectoryChain(directory) {
  const absolute = path.resolve(directory); const volume = path.parse(absolute).root;
  const chain = []; let cursor = volume;
  for (const segment of ["", ...path.relative(volume, absolute).split(path.sep).filter(Boolean)]) {
    if (segment) cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) reject("UNSAFE_PARENT");
    chain.push({ path: cursor, identity: identity(stat) });
  }
  const real = fs.realpathSync.native(absolute);
  if (comparable(path.resolve(real)) !== comparable(absolute)) reject("AMBIGUOUS_PARENT");
  return chain;
}
function inspect(root, segments) {
  const directories = inspectDirectoryChain(path.join(root, ...segments.slice(0, -1)));
  const target = path.join(root, ...segments);
  const stat = fs.lstatSync(target, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n) reject("UNSAFE_FILE");
  const real = fs.realpathSync.native(target);
  if (!contained(root, real) || comparable(real) !== comparable(target)) reject("OUTSIDE_ROOT");
  return { target, directories, identity: identity(stat), stat };
}
function readWorkspaceFile(root, relativePath, { maxBytes } = {}) {
  let descriptor;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 256 * 1024 * 1024) reject("INVALID_BOUND");
    if (typeof root !== "string" || !path.isAbsolute(root)) reject("INVALID_ROOT");
    const segments = parts(relativePath);
    const canonicalRoot = fs.realpathSync.native(root);
    const originalRoot = comparable(canonicalRoot) === comparable(path.resolve(root)) ? null : inspectDirectoryChain(root);
    const before = inspect(canonicalRoot, segments);
    if (originalRoot && originalRoot.some((entry, index) => !before.directories[index] || !sameNode(entry.identity, before.directories[index].identity))) reject("ROOT_IDENTITY_CHANGED");
    if (before.stat.size > BigInt(maxBytes)) reject("FILE_TOO_LARGE", "unavailable");
    descriptor = fs.openSync(before.target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameIdentity(before.identity, identity(opened))) reject("OPEN_IDENTITY_CHANGED");
    const buffer = Buffer.alloc(Number(opened.size) + 1); let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (length > maxBytes || length !== Number(opened.size)) reject("READ_SIZE_CHANGED");
    const afterHandle = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(before.identity, identity(afterHandle))) reject("HANDLE_IDENTITY_CHANGED");
    const after = inspect(canonicalRoot, segments);
    if (!sameIdentity(before.identity, after.identity) || before.directories.length !== after.directories.length || before.directories.some((entry, index) => !sameNode(entry.identity, after.directories[index].identity))) reject("PATH_IDENTITY_CHANGED");
    if (originalRoot) {
      const afterRoot = inspectDirectoryChain(root);
      if (originalRoot.length !== afterRoot.length || originalRoot.some((entry, index) => !sameNode(entry.identity, afterRoot[index].identity))) reject("ROOT_IDENTITY_CHANGED");
    }
    if (comparable(fs.realpathSync.native(root)) !== comparable(canonicalRoot)) reject("ROOT_IDENTITY_CHANGED");
    const bytes = buffer.subarray(0, length);
    return { bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), identity: before.identity };
  } catch (error) {
    if (error instanceof WorkspaceFileError) throw error;
    reject(error && error.code === "ENOENT" ? "FILE_MISSING" : "FILE_UNAVAILABLE", "unavailable");
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { reject("DESCRIPTOR_CLOSE_FAILED", "unavailable"); }
    }
  }
}
function listWorkspaceFiles(root, relativeDirectory, { maxFiles } = {}) {
  try {
    if (typeof root !== "string" || !path.isAbsolute(root)) reject("INVALID_ROOT");
    if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 10000) reject("INVALID_BOUND");
    const segments = relativeDirectory === "" ? [] : parts(relativeDirectory);
    const rootChain = inspectDirectoryChain(root); const canonicalRoot = fs.realpathSync.native(root);
    const pending = [{ segments, depth: 0 }]; const visited = []; const files = []; let nodes = 0;
    while (pending.length) {
      const current = pending.pop(); const directory = path.join(canonicalRoot, ...current.segments);
      if (current.depth > 64) reject("DIRECTORY_LIMIT", "unavailable");
      const chain = inspectDirectoryChain(directory);
      if (!contained(canonicalRoot, fs.realpathSync.native(directory)) || rootChain.some((entry, index) => !chain[index] || !sameNode(entry.identity, chain[index].identity))) reject("ROOT_IDENTITY_CHANGED");
      const before = identity(fs.lstatSync(directory, { bigint: true }));
      const entries = []; const handle = fs.opendirSync(directory, { bufferSize: 32 });
      try {
        let entry;
        while ((entry = handle.readSync()) !== null) {
          if (++nodes > maxFiles) reject("DIRECTORY_LIMIT", "unavailable");
          entries.push(entry);
        }
      } finally { handle.closeSync(); }
      if (!sameIdentity(before, identity(fs.lstatSync(directory, { bigint: true })))) reject("DIRECTORY_IDENTITY_CHANGED");
      for (const entry of entries) {
        const childSegments = [...current.segments, entry.name]; parts(childSegments.join("/"));
        const child = path.join(canonicalRoot, ...childSegments); const stat = fs.lstatSync(child, { bigint: true });
        if (stat.isSymbolicLink()) reject("UNSAFE_FILE");
        if (stat.isDirectory()) pending.push({ segments: childSegments, depth: current.depth + 1 });
        else if (stat.isFile() && stat.nlink === 1n) files.push(childSegments.join("/"));
        else reject("UNSAFE_FILE");
      }
      if (!sameIdentity(before, identity(fs.lstatSync(directory, { bigint: true })))) reject("DIRECTORY_IDENTITY_CHANGED");
      visited.push({ directory, identity: before });
    }
    for (const entry of visited) {
      inspectDirectoryChain(entry.directory);
      if (!sameIdentity(entry.identity, identity(fs.lstatSync(entry.directory, { bigint: true })))) reject("DIRECTORY_IDENTITY_CHANGED");
    }
    const afterRoot = inspectDirectoryChain(root);
    if (rootChain.length !== afterRoot.length || rootChain.some((entry, index) => !sameNode(entry.identity, afterRoot[index].identity))) reject("ROOT_IDENTITY_CHANGED");
    return files.sort();
  } catch (error) {
    if (error instanceof WorkspaceFileError) throw error;
    reject(error && error.code === "ENOENT" ? "FILE_MISSING" : "FILE_UNAVAILABLE", "unavailable");
  }
}
function writeRecoveryReport(root, input) {
  let descriptor;
  try {
    if (typeof root !== "string" || !path.isAbsolute(root)) reject("INVALID_ROOT");
    if (!input || typeof input !== "object") reject("INVALID_REPORT");
    const idProperty = Object.getOwnPropertyDescriptor(input, "id"); const contentProperty = Object.getOwnPropertyDescriptor(input, "content");
    if (!idProperty || !contentProperty || !("value" in idProperty) || !("value" in contentProperty)) reject("INVALID_REPORT");
    const id = idProperty.value; const content = contentProperty.value;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) reject("INVALID_REPORT_ID");
    if (typeof content !== "string" || content.length > 65536) reject("REPORT_TOO_LARGE", "unavailable");
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > 65536) reject("REPORT_TOO_LARGE", "unavailable");
    if (bytes.toString("utf8") !== content) reject("INVALID_REPORT_UTF8");
    const rootProof = inspectDirectoryChain(root); const canonicalRoot = fs.realpathSync.native(root);
    let directory = canonicalRoot; let proof = inspectDirectoryChain(directory);
    const validateDirectories = () => {
      const current = inspectDirectoryChain(directory); const currentRoot = inspectDirectoryChain(root);
      if (proof.length !== current.length || proof.some((entry, index) => !sameNode(entry.identity, current[index].identity)) || rootProof.length !== currentRoot.length || rootProof.some((entry, index) => !sameNode(entry.identity, currentRoot[index].identity))) reject("REPORT_PARENT_CHANGED");
    };
    validateDirectories();
    for (const component of ["plans", "reports", "typesafe-recovery"]) {
      validateDirectories(); const next = path.join(directory, component);
      let stat;
      try { stat = fs.lstatSync(next, { bigint: true }); }
      catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
        validateDirectories(); fs.mkdirSync(next, { mode: 0o700 });
        stat = fs.lstatSync(next, { bigint: true });
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) reject("UNSAFE_REPORT_DIRECTORY");
      validateDirectories();
      const nextProof = inspectDirectoryChain(next);
      if (proof.some((entry, index) => !sameNode(entry.identity, nextProof[index].identity))) reject("REPORT_PARENT_CHANGED");
      directory = next; proof = nextProof;
    }
    const relativePath = `plans/reports/typesafe-recovery/${id}.md`; const target = path.join(directory, `${id}.md`);
    validateDirectories();
    try { fs.lstatSync(target); reject("REPORT_EXISTS"); } catch (error) { if (!error || error.code !== "ENOENT") throw error; }
    descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    const createdStat = fs.fstatSync(descriptor, { bigint: true }); const created = identity(createdStat);
    if (!createdStat.isFile() || createdStat.nlink !== 1n || createdStat.size !== 0n) reject("UNSAFE_REPORT_FILE");
    validateDirectories(); fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor);
    const writtenStat = fs.fstatSync(descriptor, { bigint: true }); const written = identity(writtenStat);
    if (!writtenStat.isFile() || writtenStat.nlink !== 1n || writtenStat.size !== BigInt(bytes.length) || !sameNode(created, written) || created.birthtimeNs !== written.birthtimeNs) reject("REPORT_DESCRIPTOR_CHANGED");
    validateDirectories();
    fs.closeSync(descriptor); descriptor = undefined;
    const accepted = readWorkspaceFile(root, relativePath, { maxBytes: 65536 });
    validateDirectories();
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    // Finalized close timestamps can differ on Windows; the accepted buffer must still be our exact node and bytes.
    if (!sameNode(written, accepted.identity) || written.birthtimeNs !== accepted.identity.birthtimeNs || written.size !== accepted.identity.size || accepted.sha256 !== digest) reject("REPORT_READBACK_CHANGED");
    return { path: relativePath, sha256: accepted.sha256 };
  } catch (error) {
    if (error instanceof WorkspaceFileError) throw error;
    reject(error && error.code === "EEXIST" ? "REPORT_EXISTS" : "REPORT_UNAVAILABLE", "unavailable");
  } finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { reject("DESCRIPTOR_CLOSE_FAILED", "unavailable"); } }
  }
}
module.exports = { readWorkspaceFile, listWorkspaceFiles, writeRecoveryReport, WorkspaceFileError };
