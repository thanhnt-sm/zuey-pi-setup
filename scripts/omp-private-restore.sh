#!/usr/bin/env bash
#
# omp-private-restore.sh — Decrypt and restore private omp state from encrypted archive
#
# Restores mnemopi banks, history.db, and ClaudeKit TypeSafe files previously archived
# by omp-private-backup.sh. Archive paths are relative to $HOME.
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
#   - Operates strictly within $HOME without touching external boundaries.
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

# 1. Pre-flight check: gpg and tar tools
if ! command -v tar >/dev/null 2>&1; then
	echo "ERROR: 'tar' utility not found." >&2
	exit 1
fi

IS_GPG=0
case "$ARCHIVE" in
	*.gpg|*.asc) IS_GPG=1 ;;
	*)
		# Inspect file header if not named .gpg
		if command -v file >/dev/null 2>&1 && file "$ARCHIVE" | grep -qi "gpg\|pgp"; then
			IS_GPG=1
		fi
		;;
esac

if [ "$IS_GPG" -eq 1 ] && ! command -v gpg >/dev/null 2>&1; then
	echo "ERROR: 'gpg' is required to decrypt $ARCHIVE but is not installed." >&2
	exit 1
fi

# 2. Stop check: refuse restore if omp is currently active
if command -v pgrep >/dev/null 2>&1; then
	if pgrep -x omp >/dev/null 2>&1; then
		echo "ERROR: 'omp' is currently running. Please stop omp before restoring." >&2
		exit 1
	fi
fi

# 3. Terminal device binding to prevent headless / daemon hangs
GPG_TTY_VAL="$(tty 2>/dev/null || echo /dev/tty)"
export GPG_TTY="$GPG_TTY_VAL"

# 4. GnuPG agent setup, stale lock resolution, and hung daemon restart
GNUPG_DIR="${GNUPGHOME:-$USER_HOME/.gnupg}"
mkdir -p "$GNUPG_DIR"
chmod 700 "$GNUPG_DIR" 2>/dev/null || true
gpgconf --kill gpg-agent 2>/dev/null || true
rm -f "$GNUPG_DIR"/*.lock "$GNUPG_DIR"/public-keys.d/*.lock "$GNUPG_DIR"/openpgp-revocs.d/*.lock 2>/dev/null || true

OS_NAME="${OS_OVERRIDE:-$(uname -s 2>/dev/null || echo "Unknown")}"
AGENT_CONF="$GNUPG_DIR/gpg-agent.conf"

# Ensure loopback pinentry is always permitted by agent (required for batch and terminal fallback)
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
		GPG_DECRYPT_ARGS=(--batch --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" "${GPG_DECRYPT_ARGS[@]}")
	elif [ -n "$PINENTRY_MODE_OVERRIDE" ]; then
		GPG_DECRYPT_ARGS=(--pinentry-mode "$PINENTRY_MODE_OVERRIDE" "${GPG_DECRYPT_ARGS[@]}")
	else
		PINENTRY_MAC=""
		if [ "$OS_NAME" = "Darwin" ]; then
			# Search standard Apple Silicon (/opt/homebrew) and Intel (/usr/local) paths
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
			# Terminal fallback: pass --pinentry-mode loopback
			GPG_DECRYPT_ARGS=(--pinentry-mode loopback "${GPG_DECRYPT_ARGS[@]}")
		fi
	fi
fi

# 5. Execute extraction with pipeline error trapping
mkdir -p "$USER_HOME"

if [ "$IS_GPG" -eq 1 ]; then
	echo "Decrypting and extracting $ARCHIVE into $USER_HOME..."
	gpg "${GPG_DECRYPT_ARGS[@]}" "$ARCHIVE" | tar -xzf - -C "$USER_HOME"
else
	echo "Extracting plain archive $ARCHIVE into $USER_HOME..."
	tar -xzf "$ARCHIVE" -C "$USER_HOME"
fi

# 6. Post-extraction SQLite WAL cleanup: ensures clean state after extraction
if [ -d "$USER_HOME/.omp/agent" ]; then
	find "$USER_HOME/.omp/agent" \( -name "*.db-wal" -o -name "*.db-shm" \) -delete 2>/dev/null || true
fi

echo "✓ omp-private-restore: completed successfully into $USER_HOME."
