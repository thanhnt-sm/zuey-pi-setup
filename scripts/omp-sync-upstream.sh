#!/usr/bin/env bash
#
# scripts/omp-sync-upstream.sh — Synchronize safe updates from upstream pi into omp mirror
#
# Principles:
# 1. Zero git merge pollution: uses git fetch + git show for isolated extraction.
# 2. Declarative plugin deduplication: filters out conflicting plugins via .omp-syncignore.
# 3. Supply-chain security: preserves exact pinned versions from upstream.
# 4. Conditional backup: triggers backup when config changes are detected.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  ROOT="$SCRIPT_DIR"
fi

# -------------------------------------------------------------
# Dependency Check: jq
# -------------------------------------------------------------
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: 'jq' is required by omp-sync-upstream.sh but was not found in PATH." >&2
  echo "Please install jq (e.g., 'apt install jq', 'brew install jq', or 'winget install jqlang.jq')." >&2
  exit 1
fi

# -------------------------------------------------------------
# Defaults & CLI Argument Parsing
# -------------------------------------------------------------
REPO_DIR="$ROOT"
UPSTREAM_REMOTE="upstream"
UPSTREAM_URL="https://github.com/mrgoonie/zuey-pi-setup.git"
UPSTREAM_REF="upstream/main"
CONFIG_DIR=""
SYNCIGNORE_FILE=""
PACKAGE_JSON_FILE=""
SETTINGS_FILE=""
DO_FETCH=true
FILTER_ONLY=false
DO_BACKUP="auto" # "auto", "always", "never"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"
      shift 2
      ;;
    --upstream-remote)
      UPSTREAM_REMOTE="$2"
      shift 2
      ;;
    --upstream-url)
      UPSTREAM_URL="$2"
      shift 2
      ;;
    --upstream-ref)
      UPSTREAM_REF="$2"
      shift 2
      ;;
    --config-dir)
      CONFIG_DIR="$2"
      shift 2
      ;;
    --syncignore)
      SYNCIGNORE_FILE="$2"
      shift 2
      ;;
    --package-json)
      PACKAGE_JSON_FILE="$2"
      shift 2
      ;;
    --settings-file)
      SETTINGS_FILE="$2"
      shift 2
      ;;
    --filter-only)
      FILTER_ONLY=true
      shift
      ;;
    --no-fetch)
      DO_FETCH=false
      shift
      ;;
    --no-backup)
      DO_BACKUP="never"
      shift
      ;;
    --backup)
      DO_BACKUP="always"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --repo-dir <path>       Target git repository root (default: $ROOT)"
      echo "  --upstream-remote <name> Upstream remote name (default: upstream)"
      echo "  --upstream-url <url>    Upstream git URL (default: https://github.com/mrgoonie/zuey-pi-setup.git)"
      echo "  --upstream-ref <ref>    Upstream git ref to extract from (default: upstream/main)"
      echo "  --config-dir <dir>      Upstream overlay directory (default: <repo-dir>/config/omp-upstream)"
      echo "  --syncignore <file>     Path to .omp-syncignore blocklist"
      echo "  --package-json <file>   Path to plugins package.json"
      echo "  --settings-file <file>  Explicit local settings.json (bypasses git show)"
      echo "  --filter-only           Only run plugin deduplication & package.json merge"
      echo "  --no-fetch              Skip git fetch upstream"
      echo "  --no-backup             Skip conditional backup check"
      echo "  --backup                Force backup execution"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

cd "$REPO_DIR"

# Upstream-ported files live in their own overlay dir. config/omp is the live snapshot owned by
# omp-setup-backup.sh, which wipes it on every --config-dir run.
if [ -z "$CONFIG_DIR" ]; then
  CONFIG_DIR="$REPO_DIR/config/omp-upstream"
fi

if [ -z "$SYNCIGNORE_FILE" ]; then
  SYNCIGNORE_FILE="$CONFIG_DIR/.omp-syncignore"
fi

if [ -z "$PACKAGE_JSON_FILE" ]; then
  PACKAGE_JSON_FILE="$CONFIG_DIR/plugins/package.json"
fi

echo "================================================="
echo "   OMP Upstream Synchronization Orchestrator     "
echo "================================================="
echo "Repo Dir:        $REPO_DIR"
echo "Config Dir:      $CONFIG_DIR"
echo "Upstream Ref:    $UPSTREAM_REF"
echo "Syncignore:      $SYNCIGNORE_FILE"
echo "Package JSON:    $PACKAGE_JSON_FILE"
echo "================================================="

# Record diff status before changes to detect modifications later
PRE_DIFF_STATE=""
if git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PRE_DIFF_STATE="$(git -C "$REPO_DIR" status --porcelain "$CONFIG_DIR" 2>/dev/null || true)"
fi

# -------------------------------------------------------------
# 1. Upstream Remote Verification & Fetch
# -------------------------------------------------------------
if [ "$FILTER_ONLY" = false ]; then
  if ! git -C "$REPO_DIR" remote | grep -qx "$UPSTREAM_REMOTE"; then
    echo "Remote '$UPSTREAM_REMOTE' not found. Adding $UPSTREAM_URL..."
    git -C "$REPO_DIR" remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
  fi

  if [ "$DO_FETCH" = true ]; then
    echo "Fetching updates from $UPSTREAM_REMOTE..."
    git -C "$REPO_DIR" fetch "$UPSTREAM_REMOTE"
  else
    echo "Skipping git fetch (--no-fetch specified)."
  fi

  # -------------------------------------------------------------
  # 2. Safe File Extraction via git show (Zero-Merge Isolation)
  # -------------------------------------------------------------
  echo "Extracting safe configuration files from $UPSTREAM_REF..."

  # File map: upstream source path -> local target destination relative to CONFIG_DIR
  declare -a SAFE_FILES=(
    "config/APPEND_SYSTEM.md:agent/APPEND_SYSTEM.md"
    "config/extensions/compaction-policy.ts:agent/extensions/compaction-policy.ts"
    "config/extensions/pi-footer.json:agent/extensions/pi-footer.json"
    "config/extensions/pi-footer-cache-tps.ts:agent/extensions/pi-footer-cache-tps.ts"
  )

  for entry in "${SAFE_FILES[@]}"; do
    SRC_PATH="${entry%%:*}"
    DEST_REL="${entry##*:}"
    DEST_PATH="$CONFIG_DIR/$DEST_REL"

    mkdir -p "$(dirname "$DEST_PATH")"

    # Verify upstream file exists in ref before attempting extraction
    if git -C "$REPO_DIR" cat-file -e "$UPSTREAM_REF:$SRC_PATH" 2>/dev/null; then
      TMP_EXTRACT="$(mktemp -t omp-extract-XXXXXX)"
      git -C "$REPO_DIR" show "$UPSTREAM_REF:$SRC_PATH" > "$TMP_EXTRACT"
      mv -f "$TMP_EXTRACT" "$DEST_PATH"
      echo "✓ Extracted: $SRC_PATH -> $DEST_PATH"
    else
      echo "Notice: Upstream file $SRC_PATH not present in $UPSTREAM_REF. Skipping."
    fi
  done
fi

# -------------------------------------------------------------
# 3. Declarative Plugin Deduplication & Version Pinning
# -------------------------------------------------------------
echo "Processing plugin deduplication and version pinning..."

# Read .omp-syncignore blocklist
IGNORE_PATTERNS=""
if [ -f "$SYNCIGNORE_FILE" ]; then
  IGNORE_PATTERNS="$(grep -v '^[[:space:]]*#' "$SYNCIGNORE_FILE" | grep -v '^[[:space:]]*$' | tr '\n' ' ')"
fi

# Obtain upstream settings JSON payload
TMP_SETTINGS="$(mktemp -t omp-settings-XXXXXX.json)"
trap 'rm -f "$TMP_SETTINGS"' EXIT

if [ -n "$SETTINGS_FILE" ] && [ -f "$SETTINGS_FILE" ]; then
  cp "$SETTINGS_FILE" "$TMP_SETTINGS"
else
  if git -C "$REPO_DIR" cat-file -e "$UPSTREAM_REF:config/settings.json" 2>/dev/null; then
    git -C "$REPO_DIR" show "$UPSTREAM_REF:config/settings.json" > "$TMP_SETTINGS"
  elif [ -f "$REPO_DIR/config/settings.json" ]; then
    cp "$REPO_DIR/config/settings.json" "$TMP_SETTINGS"
  else
    echo '{"packages": []}' > "$TMP_SETTINGS"
  fi
fi

# Ensure target package.json exists
mkdir -p "$(dirname "$PACKAGE_JSON_FILE")"
if [ ! -s "$PACKAGE_JSON_FILE" ]; then
  cat <<'EOF' > "$PACKAGE_JSON_FILE"
{
  "name": "omp-plugins",
  "private": true,
  "dependencies": {}
}
EOF
fi

# Atomic jq processing: deduplicate, enforce blocklist, and pin exact upstream versions
TMP_PKG_OUT="$(mktemp -t omp-pkg-XXXXXX.json)"

jq -n \
  --slurpfile base "$PACKAGE_JSON_FILE" \
  --slurpfile upstream "$TMP_SETTINGS" \
  --arg ignored "$IGNORE_PATTERNS" \
  '
  # Normalize packages list from array of strings/objects, or object mapping
  def normalize_settings:
    if .packages? | type == "array" then
      [ .packages[] |
        (if type == "string" then . elif type == "object" and .source? then .source else empty end) |
        sub("^npm:"; "") |
        if startswith("@") then
          (split("@") | if length > 2 then {name: ("@" + .[1]), version: .[2]} else {name: ("@" + .[1]), version: null} end)
        else
          (split("@") | if length > 1 then {name: .[0], version: .[1]} else {name: .[0], version: null} end)
        end
      ]
    elif .packages? | type == "object" then
      [ .packages | to_entries[] |
        {
          name: (.key | sub("^npm:"; "")),
          version: (if .value != null and .value != "" then .value else null end)
        }
      ]
    else
      [ to_entries[] | select(.key | startswith("npm:")) |
        {
          name: (.key | sub("^npm:"; "")),
          version: (if .value != null and .value != "" then .value else null end)
        }
      ]
    end;

  ($ignored | split(" ") | map(select(length > 0))) as $ignore_list |
  (($base[0] // {name: "omp-plugins", private: true, dependencies: {}}) | if .dependencies then . else .dependencies = {} end) as $b |
  (($upstream[0] // {}) | normalize_settings) as $norm |
  # Exclude any packages matching the ignore list
  (($norm // []) | map(select(.name as $n | ($ignore_list | index($n)) == null))) as $valid |
  
  # Merge valid upstream dependencies: only inject if upstream has explicit pinned version or base already has a pinned version.
  # Strictly reject wildcard "*" or "latest" to eliminate supply-chain confusion attacks.
  reduce ($valid // [])[] as $item (
    $b;
    if $item.version != null and $item.version != "" and $item.version != "*" and $item.version != "latest" then
      .dependencies[$item.name] = $item.version
    elif .dependencies[$item.name]? then
      . # retain existing pinned version from base
    else
      . # omit unversioned package lacking explicit version
    end
  ) |
  # Ensure any blocklisted packages are deleted from dependencies
  reduce ($ignore_list // [])[] as $bad (
    .;
    del(.dependencies[$bad])
  )
' > "$TMP_PKG_OUT"

mv -f "$TMP_PKG_OUT" "$PACKAGE_JSON_FILE"
echo "✓ Plugin package.json updated cleanly."

# -------------------------------------------------------------
# 4. Conditional Backup Check
# -------------------------------------------------------------
if [ "$DO_BACKUP" != "never" ]; then
  POST_DIFF_STATE=""
  if git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    POST_DIFF_STATE="$(git -C "$REPO_DIR" status --porcelain "$CONFIG_DIR" 2>/dev/null || true)"
  fi

  BACKUP_SCRIPT="$ROOT/scripts/omp-setup-backup.sh"

  if [ "$DO_BACKUP" = "always" ] || [ "$PRE_DIFF_STATE" != "$POST_DIFF_STATE" ]; then
    if [ -f "$BACKUP_SCRIPT" ]; then
      echo "Changes detected in $CONFIG_DIR. Rebuilding portable tarball with the new overlay..."
      "$BACKUP_SCRIPT" --config-dir "$REPO_DIR/config/omp" --upstream-dir "$CONFIG_DIR" \
        -o "$REPO_DIR/backups/omp-setup-portable.tar.gz"
    else
      echo "Notice: Backup script $BACKUP_SCRIPT not found. Skipping backup."
    fi
  else
    echo "No configuration modifications detected. Skipping backup."
  fi
fi

echo "================================================="
echo "   OMP Upstream Sync Completed Successfully!     "
echo "================================================="
