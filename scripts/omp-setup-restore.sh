#!/usr/bin/env bash
#
# omp-setup-restore.sh — Restore portable oh-my-pi (omp) setup
#
# Usage:
#   ./omp-setup-restore.sh
#   ./omp-setup-restore.sh --source-tar backups/omp-setup-portable.tar.gz
#   ./omp-setup-restore.sh --config-dir config/omp
#   ./omp-setup-restore.sh --target-dir ~/.omp
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

TARGET_DIR="$DEFAULT_OMP_DIR"
SOURCE_TAR="$ROOT/backups/omp-setup-portable.tar.gz"
CONFIG_DIR=""
NO_INSTALL=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--source-tar)
			SOURCE_TAR="$2"
			shift 2
			;;
		--config-dir)
			CONFIG_DIR="$2"
			shift 2
			;;
		--target-dir)
			TARGET_DIR="$2"
			shift 2
			;;
		--no-install)
			NO_INSTALL=1
			shift
			;;
		-h|--help)
			echo "Usage: $0 [--source-tar <tarball>] [--config-dir <dir>] [--target-dir <dir>] [--no-install]"
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			exit 1
			;;
	esac
done

echo "=== omp-setup-restore: Restoring into $TARGET_DIR ==="

STAGE_DIR="$(mktemp -d -t omp-restore-XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT

# 1. Unpack source
if [ -n "$CONFIG_DIR" ]; then
	if [[ "$CONFIG_DIR" != /* ]] && [[ "$CONFIG_DIR" != [A-Za-z]:* ]]; then
		ACTUAL_CONFIG_DIR="$ROOT/$CONFIG_DIR"
	else
		ACTUAL_CONFIG_DIR="$CONFIG_DIR"
	fi
	echo "-> Loading from config directory: $ACTUAL_CONFIG_DIR"
	cp -r "$ACTUAL_CONFIG_DIR/"* "$STAGE_DIR/"
elif [ -f "$SOURCE_TAR" ]; then
	echo "-> Unpacking tarball: $SOURCE_TAR"
	tar -xzf "$SOURCE_TAR" -C "$STAGE_DIR"
else
	echo "Error: Neither source tarball ($SOURCE_TAR) nor config dir found." >&2
	exit 1
fi
# 2. Detect OS and determine appropriate shellPath
OS_TYPE="${OS_OVERRIDE:-$(uname -s)}"
TARGET_SHELL="/bin/bash"

case "$OS_TYPE" in
	Darwin*)
		echo "-> Detected macOS / Darwin (Apple Silicon / Intel)."
		if [ -x "/bin/zsh" ]; then
			TARGET_SHELL="/bin/zsh"
		elif command -v zsh >/dev/null 2>&1; then
			TARGET_SHELL="$(command -v zsh)"
		else
			TARGET_SHELL="/bin/bash"
		fi
		;;
	Linux*)
		echo "-> Detected Linux."
		TARGET_SHELL="/bin/bash"
		;;
	MINGW*|MSYS*|CYGWIN*|Windows_NT*)
		echo "-> Detected Windows (Git Bash / MSYS2)."
		if [ -f "C:\\Program Files\\Git\\bin\\bash.exe" ]; then
			TARGET_SHELL="C:\\Program Files\\Git\\bin\\bash.exe"
		elif command -v bash >/dev/null 2>&1; then
			TARGET_SHELL="$(command -v bash)"
		fi
		;;
	*)
		echo "-> Unknown OS ($OS_TYPE), defaulting shell to /bin/bash."
		TARGET_SHELL="/bin/bash"
		;;
esac

echo "-> Target shell path set to: $TARGET_SHELL"

# 3. Inject shellPath into config.yml
if [ -f "$STAGE_DIR/agent/config.yml" ]; then
	# Escape backslashes for sed if on Windows
	ESCAPED_SHELL="$(echo "$TARGET_SHELL" | sed 's/\\/\\\\/g')"
	if ! sed -i "s|{{SHELL_PATH}}|$ESCAPED_SHELL|g" "$STAGE_DIR/agent/config.yml" 2>/dev/null; then
		sed "s|{{SHELL_PATH}}|$ESCAPED_SHELL|g" "$STAGE_DIR/agent/config.yml" > "$STAGE_DIR/agent/config.yml.tmp"
		mv "$STAGE_DIR/agent/config.yml.tmp" "$STAGE_DIR/agent/config.yml"
	fi
fi

# 4. Backup existing files before overwriting
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
if [ -d "$TARGET_DIR/agent" ]; then
	for f in config.yml models.yml commandcode-models.json; do
		if [ -f "$TARGET_DIR/agent/$f" ]; then
			cp "$TARGET_DIR/agent/$f" "$TARGET_DIR/agent/$f.bak.$TIMESTAMP"
		fi
	done
fi

# 5. Copy files to target
mkdir -p "$TARGET_DIR/agent"
mkdir -p "$TARGET_DIR/plugins"

echo "-> Installing configuration into $TARGET_DIR..."
cp -r "$STAGE_DIR/agent/"* "$TARGET_DIR/agent/"
if [ -d "$STAGE_DIR/plugins" ]; then
	cp -r "$STAGE_DIR/plugins/"* "$TARGET_DIR/plugins/" 2>/dev/null || true
fi

# 6. Ensure .env exists on target
if [ ! -f "$TARGET_DIR/agent/.env" ] && [ -f "$TARGET_DIR/agent/.env.example" ]; then
	echo "-> Creating initial .env from .env.example..."
	cp "$TARGET_DIR/agent/.env.example" "$TARGET_DIR/agent/.env"
	echo "⚠️  REMINDER: Please edit $TARGET_DIR/agent/.env and enter your API keys."
fi

# 7. Hydrate plugins if requested
if [ "$NO_INSTALL" -eq 0 ] && [ -f "$TARGET_DIR/plugins/package.json" ]; then
	echo "-> Hydrating plugins in $TARGET_DIR/plugins..."
	(
		cd "$TARGET_DIR/plugins"
		if command -v bun >/dev/null 2>&1; then
			echo "Running 'bun install'..."
			bun install
		elif command -v npm >/dev/null 2>&1; then
			echo "Running 'npm install'..."
			npm install
		else
			echo "Notice: Neither bun nor npm found. Please run 'bun install' inside $TARGET_DIR/plugins manually."
			if [ "$OS_TYPE" = "Darwin" ]; then
				echo "To install Bun on macOS: curl -fsSL https://bun.sh/install | bash"
			fi
		fi
	)
fi

echo "✓ omp-setup-restore completed successfully."
