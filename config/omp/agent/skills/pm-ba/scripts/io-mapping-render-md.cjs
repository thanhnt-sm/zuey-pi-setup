#!/usr/bin/env node
'use strict';
/**
 * io-mapping-render-md.cjs
 *
 * Generates the human-readable markdown view of io-mapping.json.
 * Output: docs/pm-ba-io-mapping.md (path from config.io_mapping.human_view_path)
 *
 * CLI: node io-mapping-render-md.cjs
 *
 * Features:
 *   - YAML frontmatter: generated_at, schema_version, total_mappings,
 *     total_locked, total_pending
 *   - ## Current Mappings table: Map ID | Input | Current v | Mode |
 *     Outputs | Status | Locked At | Notes
 *   - ## Version History section: per mapping with current_version > 1,
 *     lists all SUPERSEDED versions
 *   - Atomic write: tmp → rename (idempotent)
 *
 * Exit codes:
 *   0 = success
 *   1 = error
 */

const fs = require('fs');
const path = require('path');
const { atomicWrite } = require('./atomic-fs.cjs');
const { appendAudit } = require('./audit-log.cjs');
const { normalizePath } = require('./path-utils.cjs');

const CONFIG_PATH = path.join(process.cwd(), '.claude', 'pm-ba.config.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

function loadConfig() {
  return loadJson(CONFIG_PATH);
}

/** Escape pipe and backtick characters in markdown table cells; normalize line endings to space. */
function escMd(s) {
  if (s == null) return '';
  return String(s).replace(/[|`\\]/g, c => '\\' + c).replace(/\r?\n/g, ' ');
}

/** Format ISO timestamp to readable form (keep as-is, just truncate ms). */
function fmtTime(iso) {
  if (!iso) return '—';
  return String(iso).replace(/\.\d{3}Z$/, 'Z').replace('T', ' ');
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Render YAML frontmatter block.
 */
function renderFrontmatter(mapping, totalLocked, totalPending) {
  const generatedAt = new Date().toISOString();
  return [
    '---',
    `generated_at: "${generatedAt}"`,
    `schema_version: ${mapping.schema_version}`,
    `total_mappings: ${(mapping.mappings || []).length}`,
    `total_locked: ${totalLocked}`,
    `total_pending: ${totalPending}`,
    '---',
    '',
  ].join('\n');
}

/**
 * Render the Current Mappings markdown table.
 * Columns: Map ID | Input | Current v | Mode | Outputs | Status | Locked At | Notes
 */
function renderCurrentMappingsTable(mappings) {
  const lines = [];
  lines.push('## Current Mappings');
  lines.push('');
  lines.push(
    '| Map ID | Input | Current v | Mode | Outputs | Status | Locked At | Notes |'
  );
  lines.push(
    '|--------|-------|-----------|------|---------|--------|-----------|-------|'
  );

  for (const entry of mappings) {
    const currentV = entry.current_version;
    const versions = entry.versions || [];
    const activeVer = versions.find((v) => v.v === currentV);

    const mapId = escMd(entry.map_id);
    const inputPath = escMd(normalizePath(entry.input_path || 'ORPHAN'));
    const vNum = currentV != null ? String(currentV) : '—';
    const mode = escMd((activeVer && activeVer.mode) || '—');
    const status = escMd((activeVer && activeVer.status) || '—');
    const lockedAt = fmtTime(activeVer && activeVer.locked_at);
    const notes = escMd((activeVer && activeVer.lock_notes) || '');

    // Outputs: newline-separated paths rendered as <br> in table
    let outputsCell = '—';
    if (activeVer && Array.isArray(activeVer.outputs) && activeVer.outputs.length > 0) {
      outputsCell = activeVer.outputs
        .map((o) => escMd(normalizePath(o.path || '')))
        .join('<br>');
    }

    lines.push(
      `| ${mapId} | ${inputPath} | v${vNum} | ${mode} | ${outputsCell} | ${status} | ${lockedAt} | ${notes} |`
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render Version History section.
 * Only includes mappings with current_version > 1 (i.e., have SUPERSEDED versions).
 */
function renderVersionHistory(mappings) {
  const lines = [];
  lines.push('## Version History');
  lines.push('');

  const hasHistory = mappings.some(
    (e) => e.current_version > 1 && Array.isArray(e.versions) && e.versions.length > 1
  );

  if (!hasHistory) {
    lines.push('_No version history yet. All mappings are at v1._');
    lines.push('');
    return lines.join('\n');
  }

  for (const entry of mappings) {
    if (!entry.current_version || entry.current_version <= 1) continue;
    const versions = entry.versions || [];
    const superseded = versions.filter((v) => v.status === 'SUPERSEDED');
    if (superseded.length === 0) continue;

    lines.push(`### ${entry.map_id}`);
    lines.push('');
    lines.push('| v | Mode | Status | Locked At | Supersedes | Notes |');
    lines.push('|---|------|--------|-----------|------------|-------|');

    for (const ver of superseded.sort((a, b) => a.v - b.v)) {
      const vNum = ver.v;
      const mode = escMd(ver.mode || '—');
      const status = escMd(ver.status || '—');
      const lockedAt = fmtTime(ver.locked_at);
      const supersedes = ver.supersedes_version != null
        ? `v${ver.supersedes_version}` : '—';
      const notes = escMd(ver.lock_notes || '');
      lines.push(`| v${vNum} | ${mode} | ${status} | ${lockedAt} | ${supersedes} | ${notes} |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // -- Load config --
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    process.stderr.write(`[RENDER] Cannot load config: ${e.message}\n`);
    process.exit(1);
  }

  const projectRoot = config.project_root || process.cwd();

  // Resolve mapping store path
  const storePath = config.io_mapping && config.io_mapping.store_path;
  if (!storePath) {
    process.stderr.write('[RENDER] config.io_mapping.store_path not defined.\n');
    process.exit(1);
  }
  const absMappingPath = path.isAbsolute(storePath)
    ? storePath : path.join(projectRoot, storePath);

  // Resolve human view output path
  const humanViewPath = config.io_mapping && config.io_mapping.human_view_path;
  if (!humanViewPath) {
    process.stderr.write('[RENDER] config.io_mapping.human_view_path not defined.\n');
    process.exit(1);
  }
  const absOutputPath = path.isAbsolute(humanViewPath)
    ? humanViewPath : path.join(projectRoot, humanViewPath);

  // -- Load mapping --
  let mapping;
  try {
    mapping = loadJson(absMappingPath);
  } catch (e) {
    process.stderr.write(`[RENDER] Cannot load io-mapping.json: ${e.message}\n`);
    process.exit(1);
  }

  const mappings = mapping.mappings || [];

  // -- Compute stats --
  let totalLocked = 0;
  let totalPending = 0;
  for (const entry of mappings) {
    const activeVer = (entry.versions || []).find((v) => v.v === entry.current_version);
    if (!activeVer) continue;
    if (activeVer.status === 'LOCKED') totalLocked++;
    if (activeVer.status === 'DRAFT' || activeVer.status === 'PENDING_REVIEW') totalPending++;
  }

  // -- Render sections --
  const frontmatter = renderFrontmatter(mapping, totalLocked, totalPending);
  const header = [
    '# PM-BA IO Mapping',
    '',
    '> Auto-generated by `io-mapping-render-md.cjs`. Do not edit manually.',
    '> To regenerate: `node .claude/skills/pm-ba/scripts/io-mapping-render-md.cjs`',
    '',
  ].join('\n');

  const currentTable = renderCurrentMappingsTable(mappings);
  const versionHistory = renderVersionHistory(mappings);

  const fullContent = frontmatter + header + currentTable + versionHistory;

  // -- Normalize line endings to LF --
  const normalized = fullContent.replace(/\r\n|\r/g, '\n');

  // -- Atomic write --
  try {
    atomicWrite(absOutputPath, normalized);
  } catch (e) {
    process.stderr.write(`[RENDER] Write failed: ${e.message}\n`);
    process.exit(1);
  }

  // -- Audit: render completed --
  const auditLogPath = config.io_mapping && config.io_mapping.audit_log_path;
  if (auditLogPath) {
    const absAuditPath = path.isAbsolute(auditLogPath)
      ? auditLogPath : path.join(projectRoot, auditLogPath);
    try {
      appendAudit(absAuditPath, {
        actor: 'script',
        event_type: 'VALIDATE_OK',
        details: `render completed: ${normalizePath(absOutputPath)}`,
      });
    } catch (e) {
      // Non-fatal: audit failure should not fail the render
      process.stderr.write(`[RENDER] Audit write warning: ${e.message}\n`);
    }
  }

  process.stdout.write(`[RENDER] Generated: ${normalizePath(absOutputPath)}\n`);
  process.stdout.write(
    `[RENDER] Stats: ${mappings.length} mappings, ${totalLocked} locked, ${totalPending} pending.\n`
  );
  process.exit(0);
}

main();
