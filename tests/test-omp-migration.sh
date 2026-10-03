#!/usr/bin/env bash
#
# tests/test-omp-migration.sh - TDD verification for omp backup and restore
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_SCRIPT="$ROOT/scripts/omp-setup-backup.sh"
RESTORE_SCRIPT="$ROOT/scripts/omp-setup-restore.sh"
# Subshells: the scripts `exit` and install their own EXIT traps.
run_backup() {
  ( . "$BACKUP_SCRIPT" "$@" )
}
run_restore() {
  ( . "$RESTORE_SCRIPT" "$@" )
}

TEST_TMP="$(mktemp -d -t omp-test-XXXXXX)"
trap 'rm -rf "$TEST_TMP"' EXIT

echo "=== [TDD] Setting up mock omp directory ==="
MOCK_OMP="$TEST_TMP/mock_omp"
mkdir -p "$MOCK_OMP/agent/extensions"
mkdir -p "$MOCK_OMP/agent/managed-skills/sample-skill"
mkdir -p "$MOCK_OMP/agent/blobs"
mkdir -p "$MOCK_OMP/agent/sessions"
mkdir -p "$MOCK_OMP/cache"
mkdir -p "$MOCK_OMP/logs"
mkdir -p "$MOCK_OMP/natives/18.4.10"
mkdir -p "$MOCK_OMP/plugins/node_modules/dummy-pkg"

# Create mock files
cat <<'EOF' > "$MOCK_OMP/agent/config.yml"
shellPath: C:\Program Files\Git\bin\bash.exe
modelRoles:
  default: google-antigravity/gemini-3.8-flash:high
EOF

cat <<'EOF' > "$MOCK_OMP/agent/models.yml"
providers:
  typesafe:
    baseUrl: https://api.typesafe.ai
    apiKey: !printenv TYPESAFE_API_KEY
  test-raw-key:
    baseUrl: https://api.example.com
    apiKey: sk-proj-1234567890abcdef1234567890abcdef
  test-bracket-key:
    baseUrl: https://api.bracket.com
    apiKey: sk-523f3efc6fb9051015992e94fd1039ec2aef2998a5b97ca0eb7f593a35ebf0cd
EOF

cat <<'EOF' > "$MOCK_OMP/agent/.env"
TYPESAFE_API_KEY=ts_secret_live_key_99999
CUSTOM_TOKEN=custom_super_secret_value
EOF

echo '{"models": []}' > "$MOCK_OMP/agent/commandcode-models.json"
echo 'export default {};' > "$MOCK_OMP/agent/extensions/orca-agent-status.ts"
echo 'export default { live: true };' > "$MOCK_OMP/agent/extensions/typesafe-planner.ts"
echo 'export default { old: true };' > "$MOCK_OMP/agent/extensions/typesafe-planner.ts.disabled"
# Shim extension re-exporting an absolute path outside ~/.omp (real source + relative src/ import)
EXT_SRC="$TEST_TMP/ext_src"
mkdir -p "$EXT_SRC/src"
printf 'import { helper } from "./src/helper";\nexport default { shimTarget: helper };\n' > "$EXT_SRC/shimmed.ts"
echo 'export const helper = 42;' > "$EXT_SRC/src/helper.ts"
echo "export { default } from \"$EXT_SRC/shimmed.ts\";" > "$MOCK_OMP/agent/extensions/shimmed.ts"
echo '# Sample Skill' > "$MOCK_OMP/agent/managed-skills/sample-skill/SKILL.md"
echo 'fake windows binary' > "$MOCK_OMP/natives/18.4.10/pi_natives.win32-x64-baseline.node"
echo 'fake db content' > "$MOCK_OMP/agent/agent.db"
echo 'fake db wal' > "$MOCK_OMP/agent/agent.db-wal"
echo 'fake blob image' > "$MOCK_OMP/agent/blobs/dummy.png"
echo 'fake session' > "$MOCK_OMP/agent/sessions/session-1.json"

cat <<'EOF' > "$MOCK_OMP/plugins/package.json"
{
  "name": "omp-plugins",
  "private": true,
  "dependencies": {
    "pi-commandcode-provider": "^0.6.0"
  }
}
EOF
echo '{"lockfileVersion": 1}' > "$MOCK_OMP/plugins/omp-plugins.lock.json"
echo 'dummy node module' > "$MOCK_OMP/plugins/node_modules/dummy-pkg/index.js"

MOCK_OUT_DIR="$TEST_TMP/config_out"
MOCK_TARBALL="$TEST_TMP/omp-setup-portable.tar.gz"

echo "=== [TDD] Running backup script against mock ==="
if [ ! -f "$BACKUP_SCRIPT" ]; then
    echo "FAIL: Backup script $BACKUP_SCRIPT does not exist yet."
    exit 1
fi

chmod +x "$BACKUP_SCRIPT"
# Upstream overlay: owned by sync, must reach the tarball but never the mirrored config dir
MOCK_UPSTREAM="$TEST_TMP/omp-upstream"
mkdir -p "$MOCK_UPSTREAM/agent/extensions" "$MOCK_UPSTREAM/plugins"
echo '# upstream append' > "$MOCK_UPSTREAM/agent/APPEND_SYSTEM.md"
echo 'export const compaction = 1;' > "$MOCK_UPSTREAM/agent/extensions/compaction-policy.ts"
echo 'export default { upstream: true };' > "$MOCK_UPSTREAM/agent/extensions/typesafe-planner.ts"
echo 'pi-lens' > "$MOCK_UPSTREAM/.omp-syncignore"
cat <<'EOF' > "$MOCK_UPSTREAM/plugins/package.json"
{
  "dependencies": {
    "pi-commandcode-provider": "^9.9.9",
    "pi-footer": "^0.5.1"
  }
}
EOF

run_backup --source "$MOCK_OMP" --config-dir "$MOCK_OUT_DIR" -o "$MOCK_TARBALL" --upstream-dir "$MOCK_UPSTREAM"

echo "=== [TDD] Assertions for Backup ==="

# 1. .env must NOT exist in output config dir
if [ -f "$MOCK_OUT_DIR/agent/.env" ]; then
    echo "FAIL: .env was copied to config dir! Sensitive data leak."
    exit 1
fi
echo "✓ PASS: .env is not in config dir."

# 2. .env.example must exist and have masked keys
if [ ! -f "$MOCK_OUT_DIR/agent/.env.example" ]; then
    echo "FAIL: .env.example was not created."
    exit 1
fi
if ! grep -q "TYPESAFE_API_KEY=" "$MOCK_OUT_DIR/agent/.env.example"; then
    echo "FAIL: .env.example missing TYPESAFE_API_KEY."
    exit 1
fi
if grep -q "ts_secret_live_key" "$MOCK_OUT_DIR/agent/.env.example"; then
    echo "FAIL: .env.example leaked live secret value!"
    exit 1
fi
echo "✓ PASS: .env.example created with keys without live secrets."

# 3. models.yml must have secrets replaced with !printenv
if grep -E 'sk-proj-|CREDENTIAL_' "$MOCK_OUT_DIR/agent/models.yml"; then
    echo "FAIL: models.yml contains unmasked credentials!"
    exit 1
fi
if ! grep -q '!printenv' "$MOCK_OUT_DIR/agent/models.yml"; then
    echo "FAIL: models.yml does not use !printenv."
    exit 1
fi
# Each literal key gets its own provider-scoped variable, declared in .env.example
for var in TEST_RAW_KEY_API_KEY TEST_BRACKET_KEY_API_KEY; do
    if ! grep -q "apiKey: !printenv $var" "$MOCK_OUT_DIR/agent/models.yml"; then
        echo "FAIL: models.yml missing provider-scoped !printenv $var."
        exit 1
    fi
    if ! grep -q "^$var=$" "$MOCK_OUT_DIR/agent/.env.example"; then
        echo "FAIL: .env.example does not declare $var."
        exit 1
    fi
done
if ! grep -q 'apiKey: !printenv TYPESAFE_API_KEY' "$MOCK_OUT_DIR/agent/models.yml"; then
    echo "FAIL: existing !printenv reference was rewritten."
    exit 1
fi
echo "✓ PASS: models.yml sanitized with per-provider env vars."

# 4. config.yml shellPath must be template placeholder
if grep -q 'C:\\Program Files' "$MOCK_OUT_DIR/agent/config.yml"; then
    echo "FAIL: config.yml still contains Windows hardcoded path."
    exit 1
fi
if ! grep -q '{{SHELL_PATH}}' "$MOCK_OUT_DIR/agent/config.yml"; then
    echo "FAIL: config.yml missing {{SHELL_PATH}} placeholder."
    exit 1
fi
echo "✓ PASS: config.yml shellPath templated."

# 5. Excluded files check
for bad in "natives" "agent.db" "blobs" "sessions" "node_modules"; do
    if find "$MOCK_OUT_DIR" -name "*$bad*" | grep -q .; then
        echo "FAIL: Found excluded item containing '$bad' in $MOCK_OUT_DIR."
        exit 1
    fi
done
echo "✓ PASS: Excluded files (natives, db, blobs, sessions, node_modules) not in config dir."

# 5b. Extensions: keep authored code, drop Orca-generated and disabled copies
if [ ! -f "$MOCK_OUT_DIR/agent/extensions/typesafe-planner.ts" ]; then
    echo "FAIL: authored extension typesafe-planner.ts missing from snapshot."
    exit 1
fi
for bad in orca-agent-status.ts typesafe-planner.ts.disabled; do
    if [ -e "$MOCK_OUT_DIR/agent/extensions/$bad" ]; then
        echo "FAIL: $bad must not be snapshotted."
        exit 1
    fi
done
echo "✓ PASS: extensions exclude orca-* and *.disabled."

# 5b'. Absolute-path shims are replaced by the real source + its relative imports
if [ -e "$MOCK_OUT_DIR/agent/extensions/shimmed.ts" ] \
    || ! grep -q 'shimTarget' "$MOCK_OUT_DIR/agent/extensions/shimmed/index.ts" \
    || ! grep -q 'helper = 42' "$MOCK_OUT_DIR/agent/extensions/shimmed/src/helper.ts"; then
    echo "FAIL: absolute-path shim was not dereferenced into extensions/shimmed/{index.ts,src/}."
    exit 1
fi
echo "✓ PASS: absolute-path extension shim dereferenced with its src/ imports."

# 5c. Upstream overlay stays out of the mirrored snapshot
if [ -e "$MOCK_OUT_DIR/upstream" ] || [ -e "$MOCK_OUT_DIR/agent/APPEND_SYSTEM.md" ]; then
    echo "FAIL: upstream overlay leaked into the config-dir snapshot."
    exit 1
fi
echo "✓ PASS: config dir holds only the live snapshot."

# 6. Tarball contents check
if [ ! -f "$MOCK_TARBALL" ]; then
    echo "FAIL: Tarball $MOCK_TARBALL was not generated."
    exit 1
fi
TAR_CONTENT="$(tar -tf "$MOCK_TARBALL")"
for bad in "natives" ".db" "blobs" "node_modules" "agent/.env$"; do
    if echo "$TAR_CONTENT" | grep -E "$bad" | grep -v "\.env\.example"; then
        echo "FAIL: Tarball contains disallowed item matching '$bad'."
        exit 1
    fi
done
if ! echo "$TAR_CONTENT" | grep -q "upstream/agent/APPEND_SYSTEM.md"; then
    echo "FAIL: tarball is missing the upstream overlay."
    exit 1
fi
if echo "$TAR_CONTENT" | grep -q "upstream/.omp-syncignore"; then
    echo "FAIL: tarball ships the sync-only .omp-syncignore."
    exit 1
fi
echo "✓ PASS: Tarball contains only clean, portable setup plus upstream overlay."

# 7. Guards: SQLite state and unquoted tokens abort the backup (tarball is tracked in a public repo)
GUARD_OMP="$TEST_TMP/guard_omp"
cp -r "$MOCK_OMP" "$GUARD_OMP"
echo 'sqlite' > "$GUARD_OMP/agent/managed-skills/sample-skill/cache.db"
set +e
run_backup --source "$GUARD_OMP" -o "$TEST_TMP/guard-db.tar.gz" --no-upstream >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 2 ]; then
    echo "FAIL: backup accepted a .db file into the tracked tarball."
    exit 1
fi
rm -f "$GUARD_OMP/agent/managed-skills/sample-skill/cache.db"
# Assembled at runtime so the repo never contains a key-shaped literal
FAKE_GOOGLE_KEY="AIza$(printf 'x%.0s' $(seq 1 35))"
echo "const key = \"$FAKE_GOOGLE_KEY\";" > "$GUARD_OMP/agent/extensions/leak.ts"
set +e
run_backup --source "$GUARD_OMP" -o "$TEST_TMP/guard-key.tar.gz" --no-upstream >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 2 ]; then
    echo "FAIL: backup accepted a Google API key."
    exit 1
fi
printf 'providers:\n  x:\n    token: abcdefghijklmnopqrstuvwxyz123456\n' > "$GUARD_OMP/agent/managed-skills/sample-skill/creds.yml"
rm -f "$GUARD_OMP/agent/extensions/leak.ts"
set +e
run_backup --source "$GUARD_OMP" -o "$TEST_TMP/guard-yaml.tar.gz" --no-upstream >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 2 ]; then
    echo "FAIL: backup accepted an unquoted YAML token."
    exit 1
fi
echo "✓ PASS: backup refuses SQLite files, AIza keys and unquoted YAML tokens."

# Shim whose absolute target is gone must abort instead of shipping a dangling path
GUARD2_OMP="$TEST_TMP/guard2_omp"
cp -r "$MOCK_OMP" "$GUARD2_OMP"
echo "export { default } from \"$TEST_TMP/does-not-exist/x.ts\";" > "$GUARD2_OMP/agent/extensions/dangling.ts"
set +e
run_backup --source "$GUARD2_OMP" -o "$TEST_TMP/guard-shim.tar.gz" --no-upstream >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 2 ]; then
    echo "FAIL: backup accepted a shim pointing at a missing absolute path."
    exit 1
fi
# Non-shim code importing an absolute machine path must abort too
rm -f "$GUARD2_OMP/agent/extensions/dangling.ts"
printf 'import x from "%s/ext_src/shimmed.ts";\nexport default { x, more: true };\n' "$TEST_TMP" > "$GUARD2_OMP/agent/extensions/mixed.ts"
set +e
run_backup --source "$GUARD2_OMP" -o "$TEST_TMP/guard-mixed.tar.gz" --no-upstream >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 2 ]; then
    echo "FAIL: backup accepted an extension importing an absolute machine path."
    exit 1
fi
echo "✓ PASS: backup refuses dangling shims and absolute-path imports."

echo "=== [TDD] Assertions for Restore ==="
if [ ! -f "$RESTORE_SCRIPT" ]; then
    echo "FAIL: Restore script $RESTORE_SCRIPT does not exist yet."
    exit 1
fi
chmod +x "$RESTORE_SCRIPT"

# Pre-existing target: local edits must survive in restore-backups/, overlay must not clobber them
MOCK_RESTORE_TARGET="$TEST_TMP/restored_omp"
mkdir -p "$MOCK_RESTORE_TARGET/agent/extensions" "$MOCK_RESTORE_TARGET/agent/managed-skills/sample-skill" "$MOCK_RESTORE_TARGET/plugins"
echo 'export default { localEdit: true };' > "$MOCK_RESTORE_TARGET/agent/extensions/typesafe-planner.ts"
echo '# Locally edited skill' > "$MOCK_RESTORE_TARGET/agent/managed-skills/sample-skill/SKILL.md"
echo '# local append' > "$MOCK_RESTORE_TARGET/agent/APPEND_SYSTEM.md"
echo 'export { default } from "/somewhere/local-only.ts";' > "$MOCK_RESTORE_TARGET/agent/extensions/shimmed.ts"

OS_OVERRIDE="Darwin" run_restore --source-tar "$MOCK_TARBALL" --target-dir "$MOCK_RESTORE_TARGET" --no-install

# Check restored config.yml has /bin/zsh on Darwin
RESTORED_SHELL="$(grep 'shellPath:' "$MOCK_RESTORE_TARGET/agent/config.yml" | tr -d '\r')"
if [[ "$RESTORED_SHELL" != *"shellPath: /bin/zsh"* && "$RESTORED_SHELL" != *"shellPath: /bin/bash"* ]]; then
    echo "FAIL: Expected /bin/zsh or /bin/bash on macOS target, got: $RESTORED_SHELL"
    exit 1
fi
echo "✓ PASS: Restore correctly configured macOS shellPath ($RESTORED_SHELL)."

# Dotfiles must survive the copy, and .env is seeded from .env.example
if [ ! -f "$MOCK_RESTORE_TARGET/agent/.env.example" ] || [ ! -f "$MOCK_RESTORE_TARGET/agent/.env" ]; then
    echo "FAIL: restore dropped .env.example / did not create .env."
    exit 1
fi
if ! grep -q '^TEST_RAW_KEY_API_KEY=$' "$MOCK_RESTORE_TARGET/agent/.env"; then
    echo "FAIL: restored .env lacks provider variable declarations."
    exit 1
fi
echo "✓ PASS: .env.example restored and .env created."

BAK_DIR="$(find "$MOCK_RESTORE_TARGET/restore-backups" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -z "$BAK_DIR" ] \
    || ! grep -q 'localEdit' "$BAK_DIR/agent/extensions/typesafe-planner.ts" \
    || ! grep -q 'Locally edited skill' "$BAK_DIR/agent/managed-skills/sample-skill/SKILL.md"; then
    echo "FAIL: overwritten extensions/managed-skills were not saved to restore-backups/."
    exit 1
fi
if ! grep -q 'live: true' "$MOCK_RESTORE_TARGET/agent/extensions/typesafe-planner.ts"; then
    echo "FAIL: snapshot extension was not restored (or overlay clobbered it)."
    exit 1
fi
echo "✓ PASS: overwritten files saved to restore-backups/; snapshot wins over overlay."

if [ -e "$MOCK_RESTORE_TARGET/agent/extensions/shimmed.ts" ] \
    || [ ! -f "$MOCK_RESTORE_TARGET/agent/extensions/shimmed/index.ts" ] \
    || ! grep -q 'local-only' "$BAK_DIR/agent/extensions/shimmed.ts"; then
    echo "FAIL: same-named single-file extension not replaced by snapshot directory (or not backed up)."
    exit 1
fi
echo "✓ PASS: directory extension replaces same-named shim file, shim saved to restore-backups/."

if ! grep -q '# local append' "$MOCK_RESTORE_TARGET/agent/APPEND_SYSTEM.md"; then
    echo "FAIL: overlay overwrote an existing APPEND_SYSTEM.md."
    exit 1
fi
if [ ! -f "$MOCK_RESTORE_TARGET/agent/extensions/compaction-policy.ts" ]; then
    echo "FAIL: overlay did not add missing compaction-policy.ts."
    exit 1
fi
PKG_RESTORED="$(cat "$MOCK_RESTORE_TARGET/plugins/package.json")"
if ! echo "$PKG_RESTORED" | grep -q '"pi-footer"' || ! echo "$PKG_RESTORED" | grep -q '"pi-commandcode-provider": "\^0.6.0"'; then
    echo "FAIL: overlay plugin merge wrong (missing pi-footer or overrode existing version): $PKG_RESTORED"
    exit 1
fi
echo "✓ PASS: overlay adds only missing files and plugin deps."

# --no-upstream skips the overlay entirely
CLEAN_TARGET="$TEST_TMP/restored_clean"
OS_OVERRIDE="Darwin" run_restore --source-tar "$MOCK_TARBALL" --target-dir "$CLEAN_TARGET" --no-install --no-upstream >/dev/null
if [ -e "$CLEAN_TARGET/agent/APPEND_SYSTEM.md" ] || grep -q '"pi-footer"' "$CLEAN_TARGET/plugins/package.json"; then
    echo "FAIL: --no-upstream still applied the overlay."
    exit 1
fi
echo "✓ PASS: --no-upstream restores the snapshot only."

echo "=== ALL TDD TESTS PASSED ==="
