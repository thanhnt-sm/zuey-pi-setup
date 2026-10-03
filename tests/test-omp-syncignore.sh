#!/usr/bin/env bash
#
# tests/test-omp-syncignore.sh - TDD tests for .omp-syncignore and version pinning
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TEST_TMP="$(mktemp -d -t omp-syncignore-test-XXXXXX)"
trap 'rm -rf "$TEST_TMP"' EXIT

SYNC_SCRIPT="$ROOT/scripts/omp-sync-upstream.sh"
run_sync() {
  . "$SYNC_SCRIPT" "$@"
}

echo "=== [TDD] tests/test-omp-syncignore.sh ==="

# Prepare mock environment
MOCK_CONFIG_DIR="$TEST_TMP/config/omp"
mkdir -p "$MOCK_CONFIG_DIR/plugins"

cat <<'EOF' > "$MOCK_CONFIG_DIR/.omp-syncignore"
# Conflicting extensions handled natively by OMP
pi-advisor-flow
pi-model-fallback
pi-lens
EOF

cat <<'EOF' > "$MOCK_CONFIG_DIR/plugins/package.json"
{
  "name": "omp-plugins",
  "private": true,
  "dependencies": {
    "pi-commandcode-provider": "^0.6.0",
    "pi-footer": "^0.5.1"
  }
}
EOF

# -------------------------------------------------------------
# Test 1 (Blocklist): Mock an upstream settings.json containing pi-lens
# Assert pi-lens is missing from output
# -------------------------------------------------------------
echo "--- Running Test 1: Blocklist exclusion (pi-lens) ---"
MOCK_UPSTREAM_SETTINGS_1="$TEST_TMP/settings_test1.json"
cat <<'EOF' > "$MOCK_UPSTREAM_SETTINGS_1"
{
  "packages": [
    "npm:pi-lens",
    "npm:pi-advisor-flow",
    "npm:pi-model-fallback",
    "npm:pi-smart-fetch@0.3.17"
  ]
}
EOF

if [ -f "$SYNC_SCRIPT" ]; then
  # When orchestrator script exists, test via CLI
  run_sync \
    --settings-file "$MOCK_UPSTREAM_SETTINGS_1" \
    --config-dir "$MOCK_CONFIG_DIR" \
    --filter-only \
    --no-fetch \
    --no-backup
else
  # Step 3.T Red phase: run jq filter logic directly if script not yet created
  IGNORE_PATTERNS="$(grep -v '^[[:space:]]*#' "$MOCK_CONFIG_DIR/.omp-syncignore" | grep -v '^[[:space:]]*$' | tr '\n' ' ')"
  
  UPDATED_JSON="$(jq -n \
    --slurpfile base "$MOCK_CONFIG_DIR/plugins/package.json" \
    --slurpfile upstream "$MOCK_UPSTREAM_SETTINGS_1" \
    --arg ignored "$IGNORE_PATTERNS" \
    '
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
    $base[0] as $b |
    ($upstream[0] | normalize_settings) as $norm |
    ($norm | map(select(.name as $n | ($ignore_list | index($n)) == null))) as $valid |
    reduce $valid[] as $item (
      $b;
      .dependencies[$item.name] = (
        if $item.version != null and $item.version != "" then
          $item.version
        elif .dependencies[$item.name]? then
          .dependencies[$item.name]
        else
          "*"
        end
      )
    ) |
    reduce $ignore_list[] as $bad (
      .;
      del(.dependencies[$bad])
    )
    ')"
  echo "$UPDATED_JSON" > "$MOCK_CONFIG_DIR/plugins/package.json"
fi

PKG_OUTPUT="$(cat "$MOCK_CONFIG_DIR/plugins/package.json")"
echo "Resulting package.json:"
echo "$PKG_OUTPUT"

# Assertions for Test 1
if echo "$PKG_OUTPUT" | grep -q "pi-lens"; then
  echo "FAIL: pi-lens should have been blocked by .omp-syncignore but was found in package.json!" >&2
  exit 1
fi

if echo "$PKG_OUTPUT" | grep -q "pi-advisor-flow"; then
  echo "FAIL: pi-advisor-flow should have been blocked by .omp-syncignore!" >&2
  exit 1
fi

if echo "$PKG_OUTPUT" | grep -q "pi-model-fallback"; then
  echo "FAIL: pi-model-fallback should have been blocked by .omp-syncignore!" >&2
  exit 1
fi

if ! echo "$PKG_OUTPUT" | grep -q "pi-smart-fetch"; then
  echo "FAIL: pi-smart-fetch was safe and should have been included!" >&2
  exit 1
fi

echo "✓ PASS: Test 1 (Blocklist exclusion)"


# -------------------------------------------------------------
# Test 2 (Pinning): Mock an upstream settings.json with "npm:pi-web-access": "^1.2.0"
# Assert the injected output retains ^1.2.0 exactly, not latest or *
# -------------------------------------------------------------
echo "--- Running Test 2: Version Pinning preservation ---"
MOCK_UPSTREAM_SETTINGS_2="$TEST_TMP/settings_test2.json"
cat <<'EOF' > "$MOCK_UPSTREAM_SETTINGS_2"
{
  "npm:pi-web-access": "^1.2.0",
  "npm:pi-smart-fetch": "0.3.17",
  "npm:pi-unversioned-pkg": ""
}
EOF

if [ -f "$SYNC_SCRIPT" ]; then
  run_sync \
    --settings-file "$MOCK_UPSTREAM_SETTINGS_2" \
    --config-dir "$MOCK_CONFIG_DIR" \
    --filter-only \
    --no-fetch \
    --no-backup
else
  IGNORE_PATTERNS="$(grep -v '^[[:space:]]*#' "$MOCK_CONFIG_DIR/.omp-syncignore" | grep -v '^[[:space:]]*$' | tr '\n' ' ')"
  
  UPDATED_JSON="$(jq -n \
    --slurpfile base "$MOCK_CONFIG_DIR/plugins/package.json" \
    --slurpfile upstream "$MOCK_UPSTREAM_SETTINGS_2" \
    --arg ignored "$IGNORE_PATTERNS" \
    '
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
    $base[0] as $b |
    ($upstream[0] | normalize_settings) as $norm |
    ($norm | map(select(.name as $n | ($ignore_list | index($n)) == null))) as $valid |
    reduce $valid[] as $item (
      $b;
      .dependencies[$item.name] = (
        if $item.version != null and $item.version != "" then
          $item.version
        elif .dependencies[$item.name]? then
          .dependencies[$item.name]
        else
          "*"
        end
      )
    ) |
    reduce $ignore_list[] as $bad (
      .;
      del(.dependencies[$bad])
    )
    ')"
  echo "$UPDATED_JSON" > "$MOCK_CONFIG_DIR/plugins/package.json"
fi

PKG_OUTPUT_2="$(cat "$MOCK_CONFIG_DIR/plugins/package.json")"
echo "Resulting package.json (Test 2):"
echo "$PKG_OUTPUT_2"

PINNED_VERSION="$(jq -r '.dependencies["pi-web-access"] // empty' "$MOCK_CONFIG_DIR/plugins/package.json")"
if [ "$PINNED_VERSION" != "^1.2.0" ]; then
  echo "FAIL: Expected pi-web-access version to be '^1.2.0', but got: '$PINNED_VERSION'" >&2
  exit 1
fi

if [ "$PINNED_VERSION" = "latest" ] || [ "$PINNED_VERSION" = "*" ]; then
  echo "FAIL: Pinned version was replaced with wildcard/latest!" >&2
  exit 1
fi
if echo "$PKG_OUTPUT_2" | grep -q "pi-unversioned-pkg"; then
  echo "FAIL: Unversioned package without pinned version should have been omitted to prevent wildcard supply-chain risk!" >&2
  exit 1
fi

if echo "$PKG_OUTPUT_2" | grep -E '("\*|"\^?\*|"latest")'; then
  echo "FAIL: Detected wildcard or latest version in dependencies!" >&2
  exit 1
fi

echo "✓ PASS: Test 2 (Version Pinning retained: $PINNED_VERSION; unversioned packages safely omitted)"
echo "=== ALL TESTS IN test-omp-syncignore.sh PASSED ==="
