#!/usr/bin/env bash
#
# tests/test-omp-sync-extraction.sh - TDD test for git show isolation
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TEST_TMP="$(mktemp -d -t omp-sync-extract-XXXXXX)"
trap 'rm -rf "$TEST_TMP"' EXIT

SYNC_SCRIPT="$ROOT/scripts/omp-sync-upstream.sh"
run_sync() {
  . "$SYNC_SCRIPT" "$@"
}

echo "=== [TDD] tests/test-omp-sync-extraction.sh ==="

# 1. Set up mock upstream repo
MOCK_UPSTREAM_DIR="$TEST_TMP/mock_upstream"
mkdir -p "$MOCK_UPSTREAM_DIR"
cd "$MOCK_UPSTREAM_DIR"
git init -b main --quiet
git config user.email "upstream@example.com"
git config user.name "Upstream Admin"

mkdir -p config/extensions
echo "# Upstream APPEND_SYSTEM Content v2.0" > config/APPEND_SYSTEM.md
echo "export const compaction = { ratio: 0.8 };" > config/extensions/compaction-policy.ts
echo '{"footer": "custom-v2"}' > config/extensions/pi-footer.json
echo "export const cacheTps = true;" > config/extensions/pi-footer-cache-tps.ts
cat <<'EOF' > config/settings.json
{
  "packages": [
    "npm:pi-web-access@^1.2.0",
    "npm:pi-smart-fetch@0.3.17",
    "npm:pi-lens"
  ]
}
EOF
git add .
git commit -m "feat(upstream): safe files and settings" --quiet

# 2. Set up mock local repo
MOCK_LOCAL_DIR="$TEST_TMP/mock_local"
mkdir -p "$MOCK_LOCAL_DIR"
cd "$MOCK_LOCAL_DIR"
git init -b main --quiet
git config user.email "local@example.com"
git config user.name "Local Dev"

mkdir -p config/omp-upstream/agent/extensions config/omp-upstream/plugins
echo "# Local Initial System" > config/omp-upstream/agent/APPEND_SYSTEM.md
cat <<'EOF' > config/omp-upstream/plugins/package.json
{
  "name": "omp-plugins",
  "private": true,
  "dependencies": {
    "pi-commandcode-provider": "^0.6.0"
  }
}
EOF
cat <<'EOF' > config/omp-upstream/.omp-syncignore
pi-lens
EOF

git add .
git commit -m "initial local commit" --quiet

# Record HEAD before sync
PRE_HEAD="$(git rev-parse HEAD)"

# Add mock upstream remote
git remote add upstream "$MOCK_UPSTREAM_DIR"

echo "Pre-sync HEAD: $PRE_HEAD"

# 3. Run the sync orchestrator script
if [ ! -f "$SYNC_SCRIPT" ]; then
  echo "FAIL: $SYNC_SCRIPT does not exist! Please implement Phase 2." >&2
  exit 1
fi

echo "Running $SYNC_SCRIPT against mock repository..."
run_sync \
  --repo-dir "$MOCK_LOCAL_DIR" \
  --upstream-remote "upstream" \
  --upstream-ref "upstream/main" \
  --no-backup

# 4. Assertions: Test 3 (Git Show Isolation)
cd "$MOCK_LOCAL_DIR"
POST_HEAD="$(git rev-parse HEAD)"

echo "Post-sync HEAD: $POST_HEAD"

# Assertion 3a: HEAD must NOT advance
if [ "$PRE_HEAD" != "$POST_HEAD" ]; then
  echo "FAIL: HEAD advanced from $PRE_HEAD to $POST_HEAD! Sync must not create commits." >&2
  exit 1
fi
echo "✓ PASS: HEAD did not advance ($PRE_HEAD == $POST_HEAD)"

# Assertion 3b: MERGE_HEAD must NOT exist
if [ -f ".git/MERGE_HEAD" ]; then
  echo "FAIL: .git/MERGE_HEAD exists! Git merge was improperly called instead of git show." >&2
  exit 1
fi
echo "✓ PASS: .git/MERGE_HEAD does not exist (no merge pollution)"

# Assertion 3c: Verify extracted files match upstream exactly
if ! grep -q "Upstream APPEND_SYSTEM Content v2.0" config/omp-upstream/agent/APPEND_SYSTEM.md; then
  echo "FAIL: config/omp-upstream/agent/APPEND_SYSTEM.md was not extracted cleanly!" >&2
  exit 1
fi
echo "✓ PASS: config/omp-upstream/agent/APPEND_SYSTEM.md extracted"

if ! grep -q "ratio: 0.8" config/omp-upstream/agent/extensions/compaction-policy.ts; then
  echo "FAIL: compaction-policy.ts was not extracted cleanly!" >&2
  exit 1
fi
echo "✓ PASS: compaction-policy.ts extracted"

if ! grep -q "custom-v2" config/omp-upstream/agent/extensions/pi-footer.json; then
  echo "FAIL: pi-footer.json was not extracted cleanly!" >&2
  exit 1
fi
echo "✓ PASS: pi-footer.json extracted"

if ! grep -q "cacheTps = true" config/omp-upstream/agent/extensions/pi-footer-cache-tps.ts; then
  echo "FAIL: pi-footer-cache-tps.ts was not extracted cleanly!" >&2
  exit 1
fi
echo "✓ PASS: pi-footer-cache-tps.ts extracted"

# Assertion 3d: Verify package.json updated without pi-lens
PKG_CONTENT="$(cat config/omp-upstream/plugins/package.json)"
if echo "$PKG_CONTENT" | grep -q "pi-lens"; then
  echo "FAIL: pi-lens found in config/omp-upstream/plugins/package.json!" >&2
  exit 1
fi

if ! echo "$PKG_CONTENT" | grep -q "pi-web-access"; then
  echo "FAIL: pi-web-access missing from config/omp-upstream/plugins/package.json!" >&2
  exit 1
fi

if [ -e config/omp ]; then
  echo "FAIL: sync wrote into config/omp (backup-owned snapshot)!" >&2
  exit 1
fi

echo "✓ PASS: config/omp-upstream/plugins/package.json properly filtered; config/omp untouched"

echo "=== ALL TESTS IN test-omp-sync-extraction.sh PASSED ==="
cd "$ROOT"
