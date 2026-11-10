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
#   ./omp-setup-restore.sh --no-install       # skip bun/npm plugin & Python tools-venv install
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

native_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		echo "$1"
	fi
}

to_tar_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -u "$1"
	else
		echo "$1"
	fi
}

find_real_python() {
	local cand
	for cand in "${OMP_PYTHON_BIN:-}" python3 python; do
		[ -n "$cand" ] || continue
		if command -v "$cand" >/dev/null 2>&1; then
			local resolved
			resolved="$(command -v "$cand")"
			# Reject Microsoft Store WindowsApps python3 stub unless functional
			case "$resolved" in
				*WindowsApps*)
					if ! "$resolved" -c "import sys, venv" >/dev/null 2>&1; then
						continue
					fi
					;;
			esac
			if "$resolved" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; then
				echo "$resolved"
				return 0
			fi
		fi
	done
	return 1
}

echo "=== omp-setup-restore: Restoring into $TARGET_DIR ==="

STAGE_DIR="$(mktemp -d -t omp-restore-XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT

# 1. Unpack source
if [ -n "$CONFIG_DIR" ]; then
	ACTUAL_CONFIG_DIR="$(resolve_repo_path "$CONFIG_DIR")"
	echo "-> Loading from config directory: $ACTUAL_CONFIG_DIR"
	cp -rL "$ACTUAL_CONFIG_DIR/." "$STAGE_DIR/"
	rm -rf "$STAGE_DIR/upstream"
	UPSTREAM_DIR="$(resolve_repo_path "$UPSTREAM_DIR")"
	if [ -d "$UPSTREAM_DIR" ]; then
		mkdir -p "$STAGE_DIR/upstream"
		cp -rL "$UPSTREAM_DIR/." "$STAGE_DIR/upstream/"
	fi
elif [ -f "$SOURCE_TAR" ]; then
	echo "-> Unpacking tarball: $SOURCE_TAR"
	tar -xzf "$(to_tar_path "$SOURCE_TAR")" -C "$STAGE_DIR"
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

# 3. Inject shellPath & skills-optin directory into config.yml safely (escaping \, &, |)
if [ -f "$STAGE_DIR/agent/config.yml" ]; then
	OPTIN_NATIVE="$(native_path "$TARGET_DIR/agent/skills-optin")"
	ESCAPED_SHELL="$(printf '%s' "$TARGET_SHELL" | sed -e 's/[\\&|]/\\&/g')"
	ESCAPED_OPTIN="$(printf '%s' "$OPTIN_NATIVE" | sed -e 's/[\\&|]/\\&/g')"
	tr -d '\r' < "$STAGE_DIR/agent/config.yml" \
		| sed "s|{{SHELL_PATH}}|$ESCAPED_SHELL|g" \
		| sed "s|{{OMP_SKILLS_OPTIN_DIR}}|$ESCAPED_OPTIN|g" \
		> "$STAGE_DIR/agent/config.yml.tmp"
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

# Normalize CRLF -> LF on shell/env files and restore executable bit on POSIX
for lf_target in "$TARGET_DIR/agent/.env.example" "$TARGET_DIR/agent/tools-requirements.txt"; do
	if [ -f "$lf_target" ]; then
		tr -d '\r' < "$lf_target" > "$lf_target.tmp" && mv -f "$lf_target.tmp" "$lf_target"
	fi
done
find "$TARGET_DIR/agent" -type f -name '*.sh' | while IFS= read -r shf; do
	tr -d '\r' < "$shf" > "$shf.tmp" && mv -f "$shf.tmp" "$shf"
	chmod +x "$shf" 2>/dev/null || true
done

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
				const path = require("path");
				const [target, upstream] = process.argv.slice(process.argv.length - 2);
				const base = fs.existsSync(target)
					? JSON.parse(fs.readFileSync(target, "utf8"))
					: { name: "omp-plugins", private: true, dependencies: {} };
				const up = JSON.parse(fs.readFileSync(upstream, "utf8"));
				base.dependencies = base.dependencies || {};
				const added = [];
				for (const [name, version] of Object.entries(up.dependencies || {})) {
					if (!(name in base.dependencies)) {
						base.dependencies[name] = version;
						added.push([name, version]);
						console.log("   + plugin " + name + "@" + version);
					}
				}
				fs.writeFileSync(target, JSON.stringify(base, null, 2) + "\n");
				const lockPath = path.join(path.dirname(target), "omp-plugins.lock.json");
				if (added.length > 0 && fs.existsSync(lockPath)) {
					const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
					lock.plugins = lock.plugins && typeof lock.plugins === "object" ? lock.plugins : {};
					for (const [name, version] of added) {
						if (!(name in lock.plugins)) {
							lock.plugins[name] = {
								version: String(version).replace(/^[\^~>=<]+/, ""),
								enabledFeatures: null,
								enabled: true
							};
						}
					}
					fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
				}
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

# 8. Hydrate plugins & Python tools-venv if requested (NO_INSTALL=0)
if [ "$NO_INSTALL" -eq 0 ]; then
	# Probe common macOS/user bin dirs if bun isn't yet on PATH
	if ! command -v bun >/dev/null 2>&1; then
		for p in "$HOME/.bun/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
			[ -x "$p/bun" ] && export PATH="$p:$PATH" && break
		done
	fi
	if [ -f "$TARGET_DIR/plugins/package.json" ]; then
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

	REQ_FILE="$TARGET_DIR/agent/tools-requirements.txt"
	if [ -f "$REQ_FILE" ]; then
		VENV_DIR="$TARGET_DIR/tools-venv"
		echo "-> Hydrating Python tools-venv at $VENV_DIR..."
		if [ ! -d "$VENV_DIR" ]; then
			if command -v uv >/dev/null 2>&1; then
				uv venv "$(native_path "$VENV_DIR")"
			elif REAL_PY="$(find_real_python)"; then
				"$REAL_PY" -m venv "$(native_path "$VENV_DIR")"
			else
				echo "Warning: No Python 3.9+ or uv found; skipping tools-venv provisioning." >&2
			fi
		fi
		VENV_PY="$VENV_DIR/bin/python"
		[ -f "$VENV_PY" ] || VENV_PY="$VENV_DIR/Scripts/python.exe"
		if [ -f "$VENV_PY" ]; then
			if command -v uv >/dev/null 2>&1; then
				uv pip install --python "$(native_path "$VENV_PY")" -r "$(native_path "$REQ_FILE")"
			else
				"$VENV_PY" -m pip install -r "$(native_path "$REQ_FILE")"
			fi
		elif [ -d "$VENV_DIR" ]; then
			echo "Warning: Python executable not found in $VENV_DIR" >&2
		fi
	fi
fi

echo "✓ omp-setup-restore completed successfully."
