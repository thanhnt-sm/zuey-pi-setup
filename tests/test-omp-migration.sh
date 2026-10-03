#!/usr/bin/env bash
#
# tests/test-omp-migration.sh - TDD verification for omp backup and restore
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_SCRIPT="$ROOT/scripts/omp-setup-backup.sh"
RESTORE_SCRIPT="$ROOT/scripts/omp-setup-restore.sh"
run_backup() {
  . "$BACKUP_SCRIPT" "$@"
}
run_restore() {
  . "$RESTORE_SCRIPT" "$@"
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
run_backup --source "$MOCK_OMP" --config-dir "$MOCK_OUT_DIR" -o "$MOCK_TARBALL"

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
echo "✓ PASS: models.yml sanitized."

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
echo "✓ PASS: Tarball contains only clean, portable setup."

echo "=== [TDD] Assertions for Restore ==="
if [ ! -f "$RESTORE_SCRIPT" ]; then
    echo "FAIL: Restore script $RESTORE_SCRIPT does not exist yet."
    exit 1
fi
chmod +x "$RESTORE_SCRIPT"

MOCK_RESTORE_TARGET="$TEST_TMP/restored_omp"
OS_OVERRIDE="Darwin" run_restore --source-tar "$MOCK_TARBALL" --target-dir "$MOCK_RESTORE_TARGET" --no-install

# Check restored config.yml has /bin/zsh on Darwin
RESTORED_SHELL="$(grep 'shellPath:' "$MOCK_RESTORE_TARGET/agent/config.yml" | tr -d '\r')"
if [[ "$RESTORED_SHELL" != *"shellPath: /bin/zsh"* && "$RESTORED_SHELL" != *"shellPath: /bin/bash"* ]]; then
    echo "FAIL: Expected /bin/zsh or /bin/bash on macOS target, got: $RESTORED_SHELL"
    exit 1
fi
echo "✓ PASS: Restore correctly configured macOS shellPath ($RESTORED_SHELL)."

echo "=== ALL TDD TESTS PASSED ==="
