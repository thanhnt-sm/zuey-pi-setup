#!/usr/bin/env bash
#
# omp-private-restore.sh — Decrypt and restore private omp & claude state from encrypted archive
#
# Restores mnemopi banks, history.db, TypeSafe kit, and portable ~/.claude/ + mcpServers
# previously archived by omp-private-backup.sh. Archive paths are relative to $HOME.
#
# Designed to prevent hangs on macOS M1 / Apple Silicon and headless environments
# by enforcing GPG_TTY terminal binding, auto-configuring pinentry-mac or loopback fallback,
# resolving stale locks/hung daemons, and enforcing pipeline error trapping.
#
# Usage:
#   ./scripts/omp-private-restore.sh ~/omp-private-backups/omp-private-<timestamp>.tar.gz.gpg
#   ./scripts/omp-private-restore.sh --home /custom/home <archive>
#   OMP_BACKUP_PASSPHRASE_FILE=~/.omp-backup-pass ./scripts/omp-private-restore.sh <archive>
#
# Pre-requisites (macOS M1 / Apple Silicon):
#   brew install gnupg pinentry-mac
#
# Invariants:
#   - omp MUST be stopped before restore (prevent database corruption / lock contention).
#   - Stale *.db-wal and *.db-shm files are removed only upon successful extraction.
#   - Rehydrates {{CLAUDE_NODE}} and {{USER_HOME}} placeholders for target Windows or macOS workstation.
#
set -euo pipefail

USER_HOME="${HOME:-${USERPROFILE:-}}"
PASSPHRASE_FILE="${OMP_BACKUP_PASSPHRASE_FILE:-}"
PINENTRY_MODE_OVERRIDE=""
ARCHIVE=""

usage() {
	sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--home)
			[ $# -ge 2 ] || { echo "ERROR: --home requires an argument" >&2; exit 1; }
			USER_HOME="$2"; shift 2 ;;
		--passphrase-file)
			[ $# -ge 2 ] || { echo "ERROR: --passphrase-file requires an argument" >&2; exit 1; }
			PASSPHRASE_FILE="$2"; shift 2 ;;
		--pinentry-mode)
			[ $# -ge 2 ] || { echo "ERROR: --pinentry-mode requires an argument" >&2; exit 1; }
			PINENTRY_MODE_OVERRIDE="$2"; shift 2 ;;
		-h|--help)
			usage; exit 0 ;;
		-*)
			echo "ERROR: Unknown option: $1" >&2; usage; exit 1 ;;
		*)
			if [ -z "$ARCHIVE" ]; then
				ARCHIVE="$1"; shift
			else
				echo "ERROR: Unexpected argument: $1" >&2; exit 1
			fi
			;;
	esac
done

if [ -z "$ARCHIVE" ]; then
	echo "ERROR: Missing archive path argument." >&2
	usage >&2
	exit 1
fi

if [ ! -f "$ARCHIVE" ] || [ ! -r "$ARCHIVE" ]; then
	echo "ERROR: Archive not found or unreadable: $ARCHIVE" >&2
	exit 1
fi

if [ -z "$USER_HOME" ]; then
	echo "ERROR: HOME / USERPROFILE is not defined." >&2
	exit 1
fi

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

to_gpg_path() {
	if command -v cygpath >/dev/null 2>&1; then
		case "$(command -v gpg 2>/dev/null || true)" in
			*[Pp]rogram\ [Ff]iles*|*GnuPG*) cygpath -w "$1" ;;
			*) cygpath -u "$1" ;;
		esac
	else
		echo "$1"
	fi
}

# 1. Pre-flight check: gpg and tar tools
if ! command -v tar >/dev/null 2>&1; then
	echo "ERROR: 'tar' utility not found." >&2
	exit 1
fi

IS_GPG=0
case "$ARCHIVE" in
	*.gpg|*.asc) IS_GPG=1 ;;
	*)
		if command -v file >/dev/null 2>&1 && file "$ARCHIVE" | grep -qi "gpg\|pgp"; then
			IS_GPG=1
		fi
		;;
esac

if [ "$IS_GPG" -eq 1 ] && ! command -v gpg >/dev/null 2>&1; then
	echo "ERROR: 'gpg' is required to decrypt $ARCHIVE but is not installed." >&2
	exit 1
fi

# 2. Stop check: refuse restore if omp is currently active (pgrep on POSIX, tasklist fallback on Git Bash)
if command -v pgrep >/dev/null 2>&1; then
	if pgrep -x omp >/dev/null 2>&1; then
		echo "ERROR: 'omp' is currently running. Please stop omp before restoring." >&2
		exit 1
	fi
elif command -v tasklist.exe >/dev/null 2>&1; then
	if tasklist.exe /FI "IMAGENAME eq omp.exe" 2>/dev/null | grep -qi "omp\.exe"; then
		echo "ERROR: 'omp' is currently running. Please stop omp before restoring." >&2
		exit 1
	fi
fi

# 3. Terminal device binding (avoid GNU `tty` printing "not a tty" on stdout)
if tty -s 2>/dev/null; then
	GPG_TTY_VAL="$(tty)"
else
	GPG_TTY_VAL="/dev/tty"
fi
export GPG_TTY="$GPG_TTY_VAL"

# 4. GnuPG agent setup, stale lock resolution, and hung daemon restart
GNUPG_DIR="${GNUPGHOME:-$USER_HOME/.gnupg}"
mkdir -p "$GNUPG_DIR"
chmod 700 "$GNUPG_DIR" 2>/dev/null || true
if command -v cygpath >/dev/null 2>&1; then
	export GNUPGHOME="$(to_gpg_path "$GNUPG_DIR")"
fi
gpgconf --kill gpg-agent 2>/dev/null || true
rm -f "$GNUPG_DIR"/*.lock "$GNUPG_DIR"/public-keys.d/*.lock "$GNUPG_DIR"/openpgp-revocs.d/*.lock 2>/dev/null || true

OS_NAME="${OS_OVERRIDE:-$(uname -s 2>/dev/null || echo "Unknown")}"
AGENT_CONF="$GNUPG_DIR/gpg-agent.conf"

if [ ! -f "$AGENT_CONF" ] || ! grep -q "^allow-loopback-pinentry" "$AGENT_CONF" 2>/dev/null; then
	echo "allow-loopback-pinentry" >> "$AGENT_CONF"
	gpgconf --kill gpg-agent 2>/dev/null || true
fi

GPG_DECRYPT_ARGS=(--decrypt)

if [ "$IS_GPG" -eq 1 ]; then
	if [ -n "$PASSPHRASE_FILE" ]; then
		if [ ! -r "$PASSPHRASE_FILE" ]; then
			echo "ERROR: Passphrase file unreadable: $PASSPHRASE_FILE" >&2
			exit 1
		fi
		GPG_DECRYPT_ARGS=(--batch --pinentry-mode loopback --passphrase-file "$(to_gpg_path "$PASSPHRASE_FILE")" "${GPG_DECRYPT_ARGS[@]}")
	elif [ -n "$PINENTRY_MODE_OVERRIDE" ]; then
		GPG_DECRYPT_ARGS=(--pinentry-mode "$PINENTRY_MODE_OVERRIDE" "${GPG_DECRYPT_ARGS[@]}")
	else
		PINENTRY_MAC=""
		if [ "$OS_NAME" = "Darwin" ]; then
			if [ -x "/opt/homebrew/bin/pinentry-mac" ]; then
				PINENTRY_MAC="/opt/homebrew/bin/pinentry-mac"
			elif [ -x "/usr/local/bin/pinentry-mac" ]; then
				PINENTRY_MAC="/usr/local/bin/pinentry-mac"
			elif command -v pinentry-mac >/dev/null 2>&1; then
				PINENTRY_MAC="$(command -v pinentry-mac)"
			fi
		fi

		if [ -n "$PINENTRY_MAC" ]; then
			if [ ! -f "$AGENT_CONF" ] || ! grep -q "^pinentry-program" "$AGENT_CONF" 2>/dev/null; then
				echo "pinentry-program $PINENTRY_MAC" >> "$AGENT_CONF"
				gpgconf --kill gpg-agent 2>/dev/null || true
			fi
		else
			GPG_DECRYPT_ARGS=(--pinentry-mode loopback "${GPG_DECRYPT_ARGS[@]}")
		fi
	fi
fi

# 5. Execute extraction with pipeline error trapping
mkdir -p "$USER_HOME"
MCP_PRE_BAK=""
if [ -f "$USER_HOME/.omp/agent/mcp.json" ]; then
	MCP_PRE_BAK="$(mktemp -t omp-mcp-prebak-XXXXXX)"
	cp "$USER_HOME/.omp/agent/mcp.json" "$MCP_PRE_BAK"
fi
USER_HOME_TAR="$(to_tar_path "$USER_HOME")"

# ~/Projects/omp_extension is owned by omp_extension's sync-baseline.cjs (its extensions/typesafe-planner.ts
# loader points there). Never overwrite an existing copy from a --include-dev-repos archive; extract it
# only on a machine that does not have the directory yet.
TAR_EXCLUDES=()
if [ -d "$USER_HOME/Projects/omp_extension" ]; then
	echo "-> Skipping Projects/omp_extension from archive: directory already exists (managed by omp_extension sync-baseline)."
	TAR_EXCLUDES=(--exclude="./Projects/omp_extension" --exclude="Projects/omp_extension")
fi

if [ "$IS_GPG" -eq 1 ]; then
	echo "Decrypting and extracting $ARCHIVE into $USER_HOME..."
	gpg "${GPG_DECRYPT_ARGS[@]}" "$(to_gpg_path "$ARCHIVE")" | tar -xzf - "${TAR_EXCLUDES[@]}" -C "$USER_HOME_TAR"
else
	echo "Extracting plain archive $ARCHIVE into $USER_HOME..."
	tar -xzf "$(to_tar_path "$ARCHIVE")" "${TAR_EXCLUDES[@]}" -C "$USER_HOME_TAR"
fi
if [ -n "$MCP_PRE_BAK" ]; then
	if [ -f "$USER_HOME/.omp/agent/mcp.json" ] && ! cmp -s "$MCP_PRE_BAK" "$USER_HOME/.omp/agent/mcp.json" 2>/dev/null; then
		MCP_BAK_DIR="$USER_HOME/.omp/restore-backups/private-$(date +%Y%m%d%H%M%S)/agent"
		mkdir -p "$MCP_BAK_DIR"
		mv "$MCP_PRE_BAK" "$MCP_BAK_DIR/mcp.json"
		echo "-> Previous mcp.json saved to $MCP_BAK_DIR/mcp.json"
	else
		rm -f "$MCP_PRE_BAK"
	fi
fi

# 6. Cross-OS rehydration for restored ~/.claude templates + ~/.claude.json mcpServers
TARGET_HOME_NAT="$(native_path "$USER_HOME")"
TARGET_NODE="node"
if [ "$OS_NAME" != "Darwin" ] && [ -x "$USER_HOME/.claude/runtime/node/node.exe" ]; then
	TARGET_NODE="$TARGET_HOME_NAT/.claude/runtime/node/node.exe"
elif [ "$OS_NAME" = "Darwin" ] || [ "$OS_NAME" = "Linux" ]; then
	NODE_CANDS=(
		"/opt/homebrew/bin/node"
		"/usr/local/bin/node"
		"$USER_HOME/.volta/bin/node"
		"$HOME/.volta/bin/node"
	)
	for glob_dir in \
		"$USER_HOME/.nvm/versions/node"/*/bin/node \
		"$HOME/.nvm/versions/node"/*/bin/node \
		"$USER_HOME/.fnm/node-versions"/*/installation/bin/node \
		"$HOME/.fnm/node-versions"/*/installation/bin/node \
		"$USER_HOME/.local/share/mise/installs/node"/*/bin/node \
		"$HOME/.local/share/mise/installs/node"/*/bin/node; do
		[ -e "$glob_dir" ] && NODE_CANDS+=("$glob_dir")
	done
	NODE_CANDS+=("$(command -v node 2>/dev/null || true)")
	for cand in "${NODE_CANDS[@]}"; do
		if [ -n "$cand" ] && [ -x "$cand" ]; then
			TARGET_NODE="$cand"
			break
		fi
	done
elif command -v node >/dev/null 2>&1; then
	TARGET_NODE="$(native_path "$(command -v node)")"
fi

rehydrate_claude_json() {
	local jf="$1" py_reh=""
	[ -f "$jf" ] || return 0
	for _py in python3 python; do
		if command -v "$_py" >/dev/null 2>&1 && "$_py" -c "import pathlib" >/dev/null 2>&1; then
			py_reh="$_py"
			break
		fi
	done
	if [ -n "$py_reh" ]; then
		"$py_reh" - "$jf" "$TARGET_NODE" "$TARGET_HOME_NAT" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
node_bin = sys.argv[2].replace("\\", "/")
home_dir = sys.argv[3].rstrip("/\\").replace("\\", "/")
txt = p.read_text(encoding="utf-8", errors="ignore")
txt = txt.replace("{{CLAUDE_NODE}}", node_bin).replace("{{USER_HOME}}", home_dir)
p.write_text(txt, encoding="utf-8", newline="\n")
PY
	else
		sed -e "s|{{CLAUDE_NODE}}|$TARGET_NODE|g" -e "s|{{USER_HOME}}|$TARGET_HOME_NAT|g" \
			"$jf" > "$jf.tmp" && mv -f "$jf.tmp" "$jf"
	fi
}

rehydrate_claude_json "$USER_HOME/.claude/settings.json"
rehydrate_claude_json "$USER_HOME/.claude/plugins/known_marketplaces.json"
rehydrate_claude_json "$USER_HOME/.omp/agent/mcp.json"
if [ -f "$USER_HOME/.claude-mcp-servers.json" ]; then
	rehydrate_claude_json "$USER_HOME/.claude-mcp-servers.json"
	JS_RT=""
	if command -v node >/dev/null 2>&1; then JS_RT="node"; elif command -v bun >/dev/null 2>&1; then JS_RT="bun"; fi
	if [ -n "$JS_RT" ]; then
		"$JS_RT" -e '
			const fs = require("fs");
			const [src, dst] = process.argv.slice(-2);
			const patch = JSON.parse(fs.readFileSync(src, "utf8"));
			const base = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst, "utf8")) : {};
			base.mcpServers = { ...(base.mcpServers || {}), ...(patch.mcpServers || {}) };
			fs.writeFileSync(dst, JSON.stringify(base, null, 2) + "\n");
		' "$(native_path "$USER_HOME/.claude-mcp-servers.json")" "$(native_path "$USER_HOME/.claude.json")"
	fi
	rm -f "$USER_HOME/.claude-mcp-servers.json"
fi

if [ -d "$USER_HOME/.claude" ]; then
	find "$USER_HOME/.claude" -type f -name '*.sh' -exec chmod +x {} + 2>/dev/null || true
fi

# 7. Post-extraction SQLite WAL cleanup: ensures clean state after extraction
if [ -d "$USER_HOME/.omp/agent" ]; then
	find "$USER_HOME/.omp/agent" \( -name "*.db-wal" -o -name "*.db-shm" \) -delete 2>/dev/null || true
fi

echo "✓ omp-private-restore: completed successfully into $USER_HOME."
