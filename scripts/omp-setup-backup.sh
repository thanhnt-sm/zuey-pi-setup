#!/usr/bin/env bash
#
# omp-setup-backup.sh — Portable snapshot for oh-my-pi (omp)
#
# Usage:
#   ./omp-setup-backup.sh
#   ./omp-setup-backup.sh --config-dir config/omp
#   ./omp-setup-backup.sh --source ~/.omp --config-dir config/omp -o backups/omp-setup-portable.tar.gz
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
	ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
	ROOT="$SCRIPT_DIR"
fi

DEFAULT_OMP_DIR="${OMP_DIR:-${HOME:-$USERPROFILE}/.omp}"
if [ ! -d "$DEFAULT_OMP_DIR" ] && [ -n "${USERPROFILE:-}" ] && [ -d "$USERPROFILE/.omp" ]; then
    DEFAULT_OMP_DIR="$USERPROFILE/.omp"
fi

OMP_SRC="$DEFAULT_OMP_DIR"
CONFIG_DIR=""
OUT="$ROOT/backups/omp-setup-portable.tar.gz"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--source)
			OMP_SRC="$2"
			shift 2
			;;
		--config-dir)
			CONFIG_DIR="$2"
			shift 2
			;;
		-o|--output)
			OUT="$2"
			shift 2
			;;
		-h|--help)
			echo "Usage: $0 [--source <path>] [--config-dir <dir>] [-o <tarball>]"
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			exit 1
			;;
	esac
done

if [ ! -d "$OMP_SRC" ]; then
	echo "Error: OMP source directory not found at $OMP_SRC" >&2
	exit 1
fi

echo "=== omp-setup-backup: Sourcing from $OMP_SRC ==="

STAGE_DIR="$(mktemp -d -t omp-backup-XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT

mkdir -p "$STAGE_DIR/agent"
mkdir -p "$STAGE_DIR/plugins"

# 1. Sanitize & Copy config.yml
if [ -f "$OMP_SRC/agent/config.yml" ]; then
	echo "-> Processing agent/config.yml (normalizing shellPath)..."
	sed 's|^shellPath:.*|shellPath: {{SHELL_PATH}}|' "$OMP_SRC/agent/config.yml" > "$STAGE_DIR/agent/config.yml"
else
	echo "Warning: agent/config.yml not found." >&2
fi

# 2. Sanitize & Copy models.yml (convert hardcoded keys to !printenv)
if [ -f "$OMP_SRC/agent/models.yml" ]; then
	echo "-> Processing agent/models.yml (sanitizing credentials to !printenv)..."
	# Replace apiKey: sk-... or apiKey: $$CREDENTIAL_... with !printenv
	# If it already has !printenv, keep it.
	awk '
	/^[[:space:]]*apiKey:[[:space:]]*!printenv/ {
		print $0;
		next;
	}
	/^[[:space:]]*apiKey:/ {
		sub(/apiKey:.*/, "apiKey: !printenv API_KEY_PLACEHOLDER");
		print $0;
		next;
	}
	{ print $0; }
	' "$OMP_SRC/agent/models.yml" > "$STAGE_DIR/agent/models.yml"
fi

# 3. Handle .env -> .env.example (DO NOT copy .env)
if [ -f "$OMP_SRC/agent/.env" ]; then
	echo "-> Generating agent/.env.example from keys in .env (live secrets omitted)..."
	awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ { print $1 "=" }' "$OMP_SRC/agent/.env" > "$STAGE_DIR/agent/.env.example"
else
	# Create basic default if .env not found
	cat <<'EOF' > "$STAGE_DIR/agent/.env.example"
TYPESAFE_API_KEY=
ZAI_API_KEY=
EOF
fi

# 4. Copy commandcode-models.json
if [ -f "$OMP_SRC/agent/commandcode-models.json" ]; then
	echo "-> Copying agent/commandcode-models.json..."
	cp "$OMP_SRC/agent/commandcode-models.json" "$STAGE_DIR/agent/"
fi

# 5. Copy extensions/
if [ -d "$OMP_SRC/agent/extensions" ]; then
	echo "-> Copying agent/extensions/..."
	mkdir -p "$STAGE_DIR/agent/extensions"
	cp -r "$OMP_SRC/agent/extensions/"* "$STAGE_DIR/agent/extensions/" 2>/dev/null || true
	# Exclude any .bak or disabled files if present
	rm -f "$STAGE_DIR/agent/extensions/"*.bak* 2>/dev/null || true
fi

# 6. Copy managed-skills/
if [ -d "$OMP_SRC/agent/managed-skills" ]; then
	echo "-> Copying agent/managed-skills/..."
	mkdir -p "$STAGE_DIR/agent/managed-skills"
	cp -r "$OMP_SRC/agent/managed-skills/"* "$STAGE_DIR/agent/managed-skills/" 2>/dev/null || true
fi

# 7. Copy plugins manifest (package.json, lockfile)
if [ -d "$OMP_SRC/plugins" ]; then
	echo "-> Copying plugins manifests (excluding node_modules)..."
	mkdir -p "$STAGE_DIR/plugins"
	[ -f "$OMP_SRC/plugins/package.json" ] && cp "$OMP_SRC/plugins/package.json" "$STAGE_DIR/plugins/" || true
	[ -f "$OMP_SRC/plugins/omp-plugins.lock.json" ] && cp "$OMP_SRC/plugins/omp-plugins.lock.json" "$STAGE_DIR/plugins/" || true
	[ -f "$OMP_SRC/plugins/bun.lock" ] && cp "$OMP_SRC/plugins/bun.lock" "$STAGE_DIR/plugins/" || true
fi

# 8. Secret scan check
SECRET_RE='((^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{32,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"?(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"?[[:space:]]*[:=][[:space:]]*"[^"]{12,}")'
FOUND_SECRETS="$( (grep -r -E "$SECRET_RE" "$STAGE_DIR" 2>/dev/null || true) | (grep -v "\.env\.example" || true) )"
if [ -n "$FOUND_SECRETS" ]; then
	echo "CRITICAL: Potential unmasked credential detected in staged files!" >&2
	echo "$FOUND_SECRETS" >&2
	exit 2
fi

# 9. Output to config-dir if requested
if [ -n "$CONFIG_DIR" ]; then
	# Resolve relative to ROOT if not absolute
	if [[ "$CONFIG_DIR" != /* ]] && [[ "$CONFIG_DIR" != [A-Za-z]:* ]]; then
		TARGET_CONFIG_DIR="$ROOT/$CONFIG_DIR"
	else
		TARGET_CONFIG_DIR="$CONFIG_DIR"
	fi
	echo "-> Mirroring clean setup to $TARGET_CONFIG_DIR..."
	mkdir -p "$TARGET_CONFIG_DIR"
	rm -rf "$TARGET_CONFIG_DIR"/*
	cp -r "$STAGE_DIR/"* "$TARGET_CONFIG_DIR/"
fi

# 10. Output to tarball
mkdir -p "$(dirname "$OUT")"
echo "-> Creating portable tarball at $OUT..."
tar -czf "$OUT" -C "$STAGE_DIR" .

echo "✓ omp-setup-backup completed successfully."
