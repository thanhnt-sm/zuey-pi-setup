#!/usr/bin/env bash
#
# omp-private-backup.sh — Encrypted backup of private omp state (NEVER commit the output)
#
# The portable snapshot (omp-setup-backup.sh) is tracked in a public repo, so it can never hold
# memory, history or kit code. This script collects that state, opt-in per item, into a gpg-encrypted
# archive written OUTSIDE any git work tree. Paths inside the archive are relative to $HOME.
#
# Usage:
#   ./scripts/omp-private-backup.sh --all
#   ./scripts/omp-private-backup.sh --memory --history -o ~/omp-private-backups/omp.tar.gz.gpg
#   OMP_BACKUP_PASSPHRASE_FILE=~/.omp-backup-pass ./scripts/omp-private-backup.sh --all   # non-interactive
#
# Opt-in items:
#   --memory        ~/.omp/agent/memories/mnemopi/banks/*/mnemopi.db   (long-term memory, per workspace)
#   --history       ~/.omp/agent/history.db                            (prompt history, session titles/recaps)
#   --typesafe-kit  ~/.claude/mcp/typesafe/, ~/.claude/hooks/lib/typesafe-enabled-resolver.cjs, ~/.claude/.ck.json
#                   (ClaudeKit files typesafe-planner.ts requires; licensed kit code, never public)
#   --all           all of the above
#
# SQLite files are snapshotted with `sqlite3 .backup`, or `VACUUM INTO` via bun/node, never `cp`:
# omp keeps them open in WAL mode, so a plain copy can be torn or miss the WAL contents.
# OAuth logins (agent.db auth_credentials) are deliberately NOT exported: re-login is documented instead.
#
# Restore (omp stopped):
#   gpg -d <archive> | tar -xzf - -C ~
#   find ~/.omp/agent -name "*.db-wal" -o -name "*.db-shm" -delete
#
set -euo pipefail

OMP_SRC="${OMP_DIR:-${HOME:-$USERPROFILE}/.omp}"
USER_HOME="${HOME:-$USERPROFILE}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
OUT="$USER_HOME/omp-private-backups/omp-private-$TIMESTAMP.tar.gz.gpg"
ENCRYPT=1
WANT_MEMORY=0
WANT_HISTORY=0
WANT_KIT=0

usage() {
	sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--memory) WANT_MEMORY=1; shift ;;
		--history) WANT_HISTORY=1; shift ;;
		--typesafe-kit) WANT_KIT=1; shift ;;
		--all) WANT_MEMORY=1; WANT_HISTORY=1; WANT_KIT=1; shift ;;
		--source) OMP_SRC="$2"; shift 2 ;;
		--home) USER_HOME="$2"; shift 2 ;;
		-o|--output) OUT="$2"; shift 2 ;;
		--no-encrypt) ENCRYPT=0; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ "$WANT_MEMORY$WANT_HISTORY$WANT_KIT" = "000" ]; then
	echo "Error: nothing selected. Use --memory, --history, --typesafe-kit or --all." >&2
	exit 1
fi

if [ "$ENCRYPT" -eq 0 ]; then
	OUT="${OUT%.gpg}"
fi
native_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		echo "$1"
	fi
}

# --- Output must never land in a git work tree (this repo is public) ---
OUT_DIR="$(dirname "$OUT")"
mkdir -p "$OUT_DIR"
if git -C "$OUT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	echo "Error: output dir $OUT_DIR is inside a git work tree ($(git -C "$OUT_DIR" rev-parse --show-toplevel))." >&2
	echo "       Private state must stay out of git. Choose a path outside any repository." >&2
	exit 1
fi
if [ "$ENCRYPT" -eq 1 ] && ! command -v gpg >/dev/null 2>&1; then
	echo "Error: gpg not found. Install gpg, or pass --no-encrypt to write a plain archive (not recommended)." >&2
	exit 1
fi

# --- SQLite snapshot: consistent single-file copy including WAL contents ---
SQLITE_TOOL=""
if command -v sqlite3 >/dev/null 2>&1; then
	SQLITE_TOOL="sqlite3"
elif command -v bun >/dev/null 2>&1; then
	SQLITE_TOOL="bun"
elif command -v node >/dev/null 2>&1 && node -e 'require("node:sqlite")' >/dev/null 2>&1; then
	SQLITE_TOOL="node"
fi

snapshot_db() {
	local src="$1" dst="$2"
	mkdir -p "$(dirname "$dst")"
	case "$SQLITE_TOOL" in
		sqlite3)
			sqlite3 "$src" ".backup '$dst'"
			;;
		bun)
			bun -e '
				const { Database } = require("bun:sqlite");
				const [src, dst] = process.argv.slice(-2);
				const db = new Database(src, { readonly: true });
				db.run("VACUUM INTO ?", [dst]);
				db.close();
			' "$(native_path "$src")" "$(native_path "$dst")"
			;;
		node)
			node -e '
				const { DatabaseSync } = require("node:sqlite");
				const [src, dst] = process.argv.slice(-2);
				const db = new DatabaseSync(src, { readOnly: true });
				db.prepare("VACUUM INTO ?").run(dst);
				db.close();
			' "$(native_path "$src")" "$(native_path "$dst")"
			;;
		*)
			echo "Error: no SQLite snapshot tool (sqlite3, bun, or node>=22.5 with node:sqlite)." >&2
			exit 1
			;;
	esac
}

STAGE_DIR="$(mktemp -d -t omp-private-XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT
COUNT=0

if [ "$WANT_MEMORY" -eq 1 ]; then
	BANKS="$OMP_SRC/agent/memories/mnemopi/banks"
	if [ -d "$BANKS" ]; then
		for db in "$BANKS"/*/mnemopi.db; do
			[ -f "$db" ] || continue
			bank="$(basename "$(dirname "$db")")"
			snapshot_db "$db" "$STAGE_DIR/.omp/agent/memories/mnemopi/banks/$bank/mnemopi.db"
			COUNT=$((COUNT + 1))
		done
		echo "-> memory: $COUNT mnemopi bank(s)"
	else
		echo "Warning: --memory: $BANKS not found." >&2
	fi
fi

if [ "$WANT_HISTORY" -eq 1 ]; then
	if [ -f "$OMP_SRC/agent/history.db" ]; then
		snapshot_db "$OMP_SRC/agent/history.db" "$STAGE_DIR/.omp/agent/history.db"
		COUNT=$((COUNT + 1))
		echo "-> history: history.db"
	else
		echo "Warning: --history: $OMP_SRC/agent/history.db not found." >&2
	fi
fi

if [ "$WANT_KIT" -eq 1 ]; then
	kit_found=0
	for rel in .claude/mcp/typesafe .claude/hooks/lib/typesafe-enabled-resolver.cjs .claude/.ck.json; do
		if [ -e "$USER_HOME/$rel" ]; then
			mkdir -p "$STAGE_DIR/$(dirname "$rel")"
			cp -r "$USER_HOME/$rel" "$STAGE_DIR/$rel"
			kit_found=$((kit_found + 1))
		else
			echo "Warning: --typesafe-kit: $USER_HOME/$rel not found." >&2
		fi
	done
	COUNT=$((COUNT + kit_found))
	echo "-> typesafe-kit: $kit_found path(s)"
fi

if [ "$COUNT" -eq 0 ]; then
	echo "Error: none of the selected items exist; no archive written." >&2
	exit 1
fi

if [ "$ENCRYPT" -eq 1 ]; then
	GPG_ARGS=(--symmetric --cipher-algo AES256 --yes --output "$OUT")
	if [ -n "${OMP_BACKUP_PASSPHRASE_FILE:-}" ]; then
		GPG_ARGS=(--batch --pinentry-mode loopback --passphrase-file "$OMP_BACKUP_PASSPHRASE_FILE" "${GPG_ARGS[@]}")
	fi
	tar -czf - -C "$STAGE_DIR" . | gpg "${GPG_ARGS[@]}"
else
	echo "WARNING: --no-encrypt: archive holds private memory/history/kit files in plain form." >&2
	tar -czf "$OUT" -C "$STAGE_DIR" .
fi

echo "✓ omp-private-backup: $OUT"
echo "  Restore (omp stopped):"
echo "    gpg -d \"$OUT\" | tar -xzf - -C ~"
echo "    find ~/.omp/agent -name \"*.db-wal\" -o -name \"*.db-shm\" -delete"
