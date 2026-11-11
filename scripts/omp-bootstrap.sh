#!/usr/bin/env bash
#
# scripts/omp-bootstrap.sh — Unified Cross-OS Two-Tier Bootstrap & Sync Entrypoint
#
# Modes:
#   --mode restore  (default) Optional git pull -> Public restore -> Optional Private GPG restore -> Local mirror links -> Doctor
#   --mode backup   Harvester scan -> Public snapshot backup -> Optional Private GPG backup -> Doctor (--strict)
#   --mode doctor   Read-only cross-OS diagnostics (tools-venv, plugins, mcp.json, local links, WAL/leaks)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
	ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
	ROOT="$SCRIPT_DIR"
fi

MODE="restore"
TARGET_DIR="${OMP_DIR:-${HOME:-$USERPROFILE}/.omp}"
USER_HOME="${HOME:-${USERPROFILE:-}}"
REPO_DIR="$ROOT"
PRIVATE_ARCHIVE=""
PASSPHRASE_FILE="${OMP_BACKUP_PASSPHRASE_FILE:-}"
SKIP_PULL=0
NO_INSTALL=0
LINK_MIRRORS=0
LINK_CLAUDE=0
DRY_RUN=0
STRICT=0
NO_LOCAL_CONFIG=0
DOCTOR_JSON=0

usage() {
	sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--mode) MODE="$2"; shift 2 ;;
		--target-dir) TARGET_DIR="$2"; shift 2 ;;
		--home) USER_HOME="$2"; shift 2 ;;
		--repo-dir) REPO_DIR="$2"; shift 2 ;;
		--private-archive) PRIVATE_ARCHIVE="$2"; shift 2 ;;
		--passphrase-file) PASSPHRASE_FILE="$2"; shift 2 ;;
		--skip-pull) SKIP_PULL=1; shift ;;
		--no-install) NO_INSTALL=1; shift ;;
		--link-mirrors) LINK_MIRRORS=1; shift ;;
		--link-claude) LINK_CLAUDE=1; shift ;;
		--strict) STRICT=1; shift ;;
		--no-local-config) NO_LOCAL_CONFIG=1; shift ;;
		--json) DOCTOR_JSON=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

case "$MODE" in
	restore|backup|doctor) ;;
	*) echo "ERROR: Invalid --mode '$MODE' (expected restore|backup|doctor)" >&2; exit 1 ;;
esac

find_py() {
	local cand
	for cand in python3 python; do
		if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import sys" >/dev/null 2>&1; then
			echo "$cand"
			return 0
		fi
	done
	return 1
}

PY_BIN="$(find_py)" || { echo "ERROR: Python 3 not found on PATH." >&2; exit 1; }

run_doctor_step() {
	local doc_args=(--target-dir "$TARGET_DIR" --home "$USER_HOME" --repo-dir "$REPO_DIR" --json)
	[ "$STRICT" -eq 1 ] && doc_args+=(--strict)
	[ "$NO_LOCAL_CONFIG" -eq 1 ] && doc_args+=(--no-local-config)
	"$PY_BIN" "$REPO_DIR/scripts/omp-doctor.py" "${doc_args[@]}"
}

echo "=== omp-bootstrap: mode=$MODE target=$TARGET_DIR ==="

if [ "$MODE" = "doctor" ]; then
	run_doctor_step
	exit $?
fi

if [ "$MODE" = "restore" ]; then
	if [ "$SKIP_PULL" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ -d "$REPO_DIR/.git" ]; then
		echo "-> [1/4] Updating repository via git pull --ff-only..."
		git -C "$REPO_DIR" pull --ff-only || echo "Warning: git pull --ff-only skipped or failed; continuing with local tree." >&2
	else
		echo "-> [1/4] Skipping git pull."
	fi

	RESTORE_ARGS=(--source-tar "$REPO_DIR/backups/omp-setup-portable.tar.gz" --target-dir "$TARGET_DIR")
	[ "$NO_INSTALL" -eq 1 ] && RESTORE_ARGS+=(--no-install)

	if [ "$DRY_RUN" -eq 1 ]; then
		echo "[DRY-RUN] Would run: omp-setup-restore.sh ${RESTORE_ARGS[*]}"
	else
		echo "-> [2/4] Running Public Stage 1 restore..."
		HOME="$USER_HOME" "$BASH" "$REPO_DIR/scripts/omp-setup-restore.sh" "${RESTORE_ARGS[@]}"
	fi

	if [ -n "$PRIVATE_ARCHIVE" ]; then
		PRIV_ARGS=(--home "$USER_HOME")
		[ -n "$PASSPHRASE_FILE" ] && PRIV_ARGS+=(--passphrase-file "$PASSPHRASE_FILE")
		PRIV_ARGS+=("$PRIVATE_ARCHIVE")
		if [ "$DRY_RUN" -eq 1 ]; then
			echo "[DRY-RUN] Would run: omp-private-restore.sh ${PRIV_ARGS[*]}"
		else
			echo "-> [3/4] Running Private Stage 2 GPG restore..."
			"$BASH" "$REPO_DIR/scripts/omp-private-restore.sh" "${PRIV_ARGS[@]}"
		fi
	else
		echo "-> [3/4] No --private-archive specified; skipping Private Stage 2 restore."
	fi

	if [ "$LINK_MIRRORS" -eq 1 ] && [ "$NO_LOCAL_CONFIG" -eq 0 ]; then
		LINK_ARGS=(--global-agent-dir "$TARGET_DIR/agent" --config "$REPO_DIR/config/harvest-workspaces.json")
		if [ "$DRY_RUN" -eq 1 ]; then
			"$PY_BIN" "$REPO_DIR/scripts/omp-link-local.py" "${LINK_ARGS[@]}" --plan --json
		else
			"$PY_BIN" "$REPO_DIR/scripts/omp-link-local.py" "${LINK_ARGS[@]}" --apply --json
			"$PY_BIN" "$REPO_DIR/scripts/omp-link-local.py" "${LINK_ARGS[@]}" --verify --json
		fi
	fi
	if [ "$LINK_CLAUDE" -eq 1 ]; then
		echo "-> Linking OMP suite skills and routing rules into ~/.claude..."
		CLAUDE_DIR="$USER_HOME/.claude"
		if [ -d "$CLAUDE_DIR" ]; then
			mkdir -p "$CLAUDE_DIR/rules" "$CLAUDE_DIR/skills"
			BAK_TS="$(date +%Y%m%d%H%M%S)"
			BAK_DIR="$TARGET_DIR/restore-backups/claude-link-$BAK_TS"
			mkdir -p "$BAK_DIR"
			for rf in file-type-enforcement.md skill-domain-routing.md; do
				if [ -f "$REPO_DIR/config/omp/agent/rules/$rf" ]; then
					[ -f "$CLAUDE_DIR/rules/$rf" ] && cp "$CLAUDE_DIR/rules/$rf" "$BAK_DIR/$rf"
					cp "$REPO_DIR/config/omp/agent/rules/$rf" "$CLAUDE_DIR/rules/$rf"
				fi
			done
			for suite in pmo-project-suite office-doc-suite email-intelligence-suite system-maintenance-suite; do
				src_s="$TARGET_DIR/agent/skills/$suite"
				dst_s="$CLAUDE_DIR/skills/$suite"
				if [ -d "$src_s" ] && [ ! -e "$dst_s" ]; then
					if command -v cygpath >/dev/null 2>&1; then
						cmd.exe /c mklink /J "$(cygpath -w "$dst_s")" "$(cygpath -w "$src_s")" >/dev/null 2>&1 || cp -r "$src_s" "$dst_s"
					else
						ln -s "$src_s" "$dst_s" 2>/dev/null || cp -r "$src_s" "$dst_s"
					fi
				fi
			done
			echo "✓ Linked OMP suite skills and routing rules into $CLAUDE_DIR."
		else
			echo "Notice: ~/.claude directory not found; skipping --link-claude."
		fi
	fi

	if [ "$DRY_RUN" -eq 1 ]; then
		echo "[DRY-RUN] Skipping doctor validation on unhydrated dry-run target."
		exit 0
	fi
	echo "-> [4/4] Running omp-doctor verification..."
	run_doctor_step
	exit $?
fi

# MODE = backup
if [ "$DRY_RUN" -eq 1 ]; then
	echo "[DRY-RUN] Would scan harvester, export config/omp + portable tarball, optionally run private backup, and run omp-doctor --strict."
	exit 0
fi

echo "-> [1/4] Running incremental harvester scan..."
HARV_ARGS=(--scan --diff-global)
[ "$NO_LOCAL_CONFIG" -eq 1 ] && HARV_ARGS+=(--no-local-config)
"$PY_BIN" "$REPO_DIR/scripts/omp-session-harvester.py" "${HARV_ARGS[@]}"

echo "-> [2/4] Running Public Stage 1 backup into config/omp & portable tarball..."
"$BASH" "$REPO_DIR/scripts/omp-setup-backup.sh" --source "$TARGET_DIR" --config-dir "$REPO_DIR/config/omp" -o "$REPO_DIR/backups/omp-setup-portable.tar.gz"

if [ -n "$PRIVATE_ARCHIVE" ]; then
	echo "-> [3/4] Running Private Stage 2 GPG backup to $PRIVATE_ARCHIVE..."
	PRIV_BAK_ARGS=(--all --source "$TARGET_DIR" --home "$USER_HOME" -o "$PRIVATE_ARCHIVE")
	if [ -n "$PASSPHRASE_FILE" ]; then
		OMP_BACKUP_PASSPHRASE_FILE="$PASSPHRASE_FILE" "$BASH" "$REPO_DIR/scripts/omp-private-backup.sh" "${PRIV_BAK_ARGS[@]}"
	else
		"$BASH" "$REPO_DIR/scripts/omp-private-backup.sh" "${PRIV_BAK_ARGS[@]}"
	fi
else
	echo "-> [3/4] No --private-archive output specified; skipping Private Stage 2 backup."
fi

echo "-> [4/4] Running strict omp-doctor validation..."
STRICT=1
run_doctor_step
