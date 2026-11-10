#!/usr/bin/env bash
#
# tests/test-omp-tools-venv-hydration.sh - Verify tools-venv provisioning and --no-install behavior
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_SCRIPT="$ROOT/scripts/omp-setup-backup.sh"
RESTORE_SCRIPT="$ROOT/scripts/omp-setup-restore.sh"

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-omp-venv-XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

MOCK_OMP="$TEST_TMP/mock_omp"
mkdir -p "$MOCK_OMP/agent" "$MOCK_OMP/plugins"
echo 'shellPath: /bin/bash' > "$MOCK_OMP/agent/config.yml"
echo 'providers: {}' > "$MOCK_OMP/agent/models.yml"
echo '{"name":"omp-plugins","private":true,"dependencies":{}}' > "$MOCK_OMP/plugins/package.json"
# Use a pure-stdlib-friendly empty or lightweight requirement for fast offline-safe mock check when stubbing uv/pip
cat <<'EOF' > "$MOCK_OMP/agent/tools-requirements.txt"
openpyxl>=3.1.2
EOF

TAR_OUT="$TEST_TMP/pkg.tar.gz"
"$BASH" "$BACKUP_SCRIPT" --source "$MOCK_OMP" -o "$TAR_OUT" --no-upstream

# 1. --no-install MUST NOT create tools-venv
TGT_NOINST="$TEST_TMP/tgt_noinst"
"$BASH" "$RESTORE_SCRIPT" --source-tar "$TAR_OUT" --target-dir "$TGT_NOINST" --no-install --no-upstream
if [ -d "$TGT_NOINST/tools-venv" ]; then
  echo "FAIL: --no-install created tools-venv unexpectedly" >&2
  exit 1
fi
test -f "$TGT_NOINST/agent/tools-requirements.txt"
echo "✓ PASS: --no-install preserves tools-requirements.txt without creating tools-venv."

# 2. Hydration with fast mock uv + python shim on PATH (proves invocation without network flakiness)
SHIM_BIN="$TEST_TMP/shim_bin"
mkdir -p "$SHIM_BIN"
UV_LOG="$TEST_TMP/uv.log"
cat <<EOF > "$SHIM_BIN/uv"
#!/usr/bin/env bash
echo "uv \$*" >> "$UV_LOG"
if [ "\$1" = "venv" ]; then
  mkdir -p "\$2/bin" "\$2/Scripts"
  printf '#!/bin/sh\necho py "\$@"\n' > "\$2/bin/python"
  chmod +x "\$2/bin/python"
fi
exit 0
EOF
chmod +x "$SHIM_BIN/uv"

TGT_HYD="$TEST_TMP/tgt_hyd"
PATH="$SHIM_BIN:$PATH" "$BASH" "$RESTORE_SCRIPT" --source-tar "$TAR_OUT" --target-dir "$TGT_HYD" --no-upstream
test -d "$TGT_HYD/tools-venv"
grep -q "uv venv" "$UV_LOG"
grep -q "uv pip install" "$UV_LOG"
grep -q "tools-requirements.txt" "$UV_LOG"
echo "✓ PASS: tools-venv created and hydrated from agent/tools-requirements.txt."
echo "=== ALL TOOLS-VENV HYDRATION TESTS PASSED ==="
