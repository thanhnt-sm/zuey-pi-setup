#!/usr/bin/env bash
#
# omp-setup-restore.sh — Restore portable oh-my-pi (omp) setup
#
# Usage:
#   ./omp-setup-restore.sh
#   ./omp-setup-restore.sh --source-tar backups/omp-setup-portable.tar.gz
#   ./omp-setup-restore.sh --config-dir config/omp [--upstream-dir config/omp-upstream]
#   ./omp-setup-restore.sh --target-dir ~/.omp
#   ./omp-setup-restore.sh --no-upstream      # skip the upstream-ported overlay
#
# Order of operations:
#   1. Every target path that will be overwritten is copied to <target>/restore-backups/<timestamp>/.
#   2. The live snapshot (agent/, plugins/) is copied over the target, dotfiles included.
#   3. The upstream overlay (APPEND_SYSTEM.md, ported extensions, extra plugin deps) is added
#      ONLY where the target has nothing yet — it never overwrites restored or local files.
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
UPSTREAM_DIR="$ROOT/config/omp-upstream"
APPLY_UPSTREAM=1
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
		--upstream-dir)
			UPSTREAM_DIR="$2"
			shift 2
			;;
		--no-upstream)
			APPLY_UPSTREAM=0
			shift
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
			echo "Usage: $0 [--source-tar <tarball>] [--config-dir <dir>] [--upstream-dir <dir>] [--no-upstream] [--target-dir <dir>] [--no-install]"
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			exit 1
			;;
	esac
done

resolve_repo_path() {
	if [[ "$1" != /* ]] && [[ "$1" != [A-Za-z]:* ]]; then
		echo "$ROOT/$1"
	else
		echo "$1"
	fi
}

# Paths handed to node/bun must be native on Windows (/c/... is not understood there)
native_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		echo "$1"
	fi
}

echo "=== omp-setup-restore: Restoring into $TARGET_DIR ==="

STAGE_DIR="$(mktemp -d -t omp-restore-XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT

# 1. Unpack source (config-dir mode stages the overlay from --upstream-dir; tarball mode carries upstream/)
if [ -n "$CONFIG_DIR" ]; then
	ACTUAL_CONFIG_DIR="$(resolve_repo_path "$CONFIG_DIR")"
	echo "-> Loading from config directory: $ACTUAL_CONFIG_DIR"
	cp -r "$ACTUAL_CONFIG_DIR/." "$STAGE_DIR/"
	rm -rf "$STAGE_DIR/upstream"
	UPSTREAM_DIR="$(resolve_repo_path "$UPSTREAM_DIR")"
	if [ -d "$UPSTREAM_DIR" ]; then
		mkdir -p "$STAGE_DIR/upstream"
		cp -r "$UPSTREAM_DIR/." "$STAGE_DIR/upstream/"
	fi
elif [ -f "$SOURCE_TAR" ]; then
	echo "-> Unpacking tarball: $SOURCE_TAR"
	tar -xzf "$SOURCE_TAR" -C "$STAGE_DIR"
else
	echo "Error: Neither source tarball ($SOURCE_TAR) nor config dir found." >&2
	exit 1
fi
rm -f "$STAGE_DIR/.omp-syncignore" "$STAGE_DIR/upstream/.omp-syncignore"
mkdir -p "$STAGE_DIR/agent"

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
		# Never pick C:\Windows\System32\bash.exe (WSL relay) — omp needs Git Bash.
		WIN_BASH=""
		for cand in "${GIT_BASH_BIN:-}" "C:\\Program Files\\Git\\bin\\bash.exe" "C:\\Program Files (x86)\\Git\\bin\\bash.exe"; do
			if [ -n "$cand" ] && [ -f "$cand" ]; then
				WIN_BASH="$cand"
				break
			fi
		done
		if [ -z "$WIN_BASH" ] && command -v bash >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
			cand="$(cygpath -w "$(command -v bash)")"
			case "$cand" in
				*[Ss]ystem32*|*WindowsApps*) ;;
				*) WIN_BASH="$cand" ;;
			esac
		fi
		if [ -n "$WIN_BASH" ]; then
			TARGET_SHELL="$WIN_BASH"
		else
			echo "Warning: Git Bash not found (set GIT_BASH_BIN). shellPath left as $TARGET_SHELL." >&2
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
	sed "s|{{SHELL_PATH}}|$ESCAPED_SHELL|g" "$STAGE_DIR/agent/config.yml" > "$STAGE_DIR/agent/config.yml.tmp"
	mv "$STAGE_DIR/agent/config.yml.tmp" "$STAGE_DIR/agent/config.yml"
fi

# 4. Back up every target path the snapshot will overwrite
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
RESTORE_BACKUP_DIR="$TARGET_DIR/restore-backups/$TIMESTAMP"
backup_overwritten() {
	local sub="$1" entry name
	[ -d "$STAGE_DIR/$sub" ] || return 0
	for entry in "$STAGE_DIR/$sub"/* "$STAGE_DIR/$sub"/.[!.]*; do
		[ -e "$entry" ] || continue
		name="$(basename "$entry")"
		if [ -e "$TARGET_DIR/$sub/$name" ]; then
			mkdir -p "$RESTORE_BACKUP_DIR/$sub"
			cp -r "$TARGET_DIR/$sub/$name" "$RESTORE_BACKUP_DIR/$sub/"
		fi
	done
}
backup_overwritten agent
backup_overwritten plugins
# A snapshot extension directory <name>/ replaces a same-named single-file extension (<name>.ts/.js,
# e.g. a local absolute-path shim); both would load under the same extension id.
if [ -d "$STAGE_DIR/agent/extensions" ]; then
	for ext_dir in "$STAGE_DIR/agent/extensions"/*/; do
		[ -d "$ext_dir" ] || continue
		name="$(basename "$ext_dir")"
		for f in "$TARGET_DIR/agent/extensions/$name.ts" "$TARGET_DIR/agent/extensions/$name.js"; do
			if [ -f "$f" ]; then
				mkdir -p "$RESTORE_BACKUP_DIR/agent/extensions"
				mv "$f" "$RESTORE_BACKUP_DIR/agent/extensions/"
				echo "-> Replaced single-file extension $(basename "$f") with directory $name/"
			fi
		done
	done
fi
if [ -d "$RESTORE_BACKUP_DIR" ]; then
	echo "-> Previous files saved to $RESTORE_BACKUP_DIR"
fi

# 5. Copy snapshot to target (trailing /. includes dotfiles such as .env.example)
mkdir -p "$TARGET_DIR/agent"
mkdir -p "$TARGET_DIR/plugins"

echo "-> Installing configuration into $TARGET_DIR..."
cp -r "$STAGE_DIR/agent/." "$TARGET_DIR/agent/"
if [ -d "$STAGE_DIR/plugins" ]; then
	cp -r "$STAGE_DIR/plugins/." "$TARGET_DIR/plugins/"
fi

# 6. Apply upstream overlay: add missing files, add missing plugin deps; never overwrite
if [ "$APPLY_UPSTREAM" -eq 1 ] && [ -d "$STAGE_DIR/upstream" ]; then
	echo "-> Applying upstream overlay (missing files only)..."
	if [ -d "$STAGE_DIR/upstream/agent" ]; then
		(cd "$STAGE_DIR/upstream/agent" && find . -type f) | while IFS= read -r rel; do
			rel="${rel#./}"
			if [ ! -e "$TARGET_DIR/agent/$rel" ]; then
				mkdir -p "$(dirname "$TARGET_DIR/agent/$rel")"
				cp "$STAGE_DIR/upstream/agent/$rel" "$TARGET_DIR/agent/$rel"
				echo "   + agent/$rel"
			fi
		done
	fi
	UP_PKG="$STAGE_DIR/upstream/plugins/package.json"
	if [ -f "$UP_PKG" ]; then
		JS_RUNTIME=""
		if command -v bun >/dev/null 2>&1; then
			JS_RUNTIME="bun"
		elif command -v node >/dev/null 2>&1; then
			JS_RUNTIME="node"
		fi
		if [ -z "$JS_RUNTIME" ]; then
			echo "Warning: neither bun nor node found; upstream plugin deps not merged ($UP_PKG)." >&2
		else
			"$JS_RUNTIME" -e '
				const fs = require("fs");
				const [target, upstream] = process.argv.slice(process.argv.length - 2);
				const base = fs.existsSync(target)
					? JSON.parse(fs.readFileSync(target, "utf8"))
					: { name: "omp-plugins", private: true, dependencies: {} };
				const up = JSON.parse(fs.readFileSync(upstream, "utf8"));
				base.dependencies = base.dependencies || {};
				for (const [name, version] of Object.entries(up.dependencies || {})) {
					if (!(name in base.dependencies)) {
						base.dependencies[name] = version;
						console.log("   + plugin " + name + "@" + version);
					}
				}
				fs.writeFileSync(target, JSON.stringify(base, null, 2) + "\n");
			' "$(native_path "$TARGET_DIR/plugins/package.json")" "$(native_path "$UP_PKG")"
		fi
	fi
fi

# 7. Ensure .env exists on target
if [ ! -f "$TARGET_DIR/agent/.env" ] && [ -f "$TARGET_DIR/agent/.env.example" ]; then
	echo "-> Creating initial .env from .env.example..."
	cp "$TARGET_DIR/agent/.env.example" "$TARGET_DIR/agent/.env"
	echo "⚠️  REMINDER: Please edit $TARGET_DIR/agent/.env and enter your API keys."
fi

# 8. Hydrate plugins if requested
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
