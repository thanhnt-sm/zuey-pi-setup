#!/usr/bin/env bash
#
# omp-setup-backup.sh — Portable snapshot for oh-my-pi (omp)
#
# Usage:
#   ./omp-setup-backup.sh
#   ./omp-setup-backup.sh --config-dir config/omp
#   ./omp-setup-backup.sh --source ~/.omp --config-dir config/omp -o backups/omp-setup-portable.tar.gz
#
# Layers:
#   config/omp/           live snapshot (owned by this script; --config-dir mirrors it, wiping old content)
#   config/omp-upstream/  upstream-ported overlay (owned by omp-sync-upstream.sh; NEVER written here)
# The tarball carries both: the snapshot at its root and the overlay under upstream/.
#
# Private state (mnemopi memory, prompt history, TypeSafe kit) is NOT handled here:
# use scripts/omp-private-backup.sh, which writes an encrypted archive outside the repo.
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
UPSTREAM_DIR="$ROOT/config/omp-upstream"

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
		--upstream-dir)
			UPSTREAM_DIR="$2"
			shift 2
			;;
		--no-upstream)
			UPSTREAM_DIR=""
			shift
			;;
		-h|--help)
			echo "Usage: $0 [--source <path>] [--config-dir <dir>] [-o <tarball>] [--upstream-dir <dir> | --no-upstream]"
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

# 2. Sanitize & Copy models.yml: literal apiKey values become !printenv <PROVIDER>_API_KEY
#    (provider name upper-cased, non-alphanumerics -> "_"), so each provider keeps its own variable.
PROVIDER_ENV_VARS="$STAGE_DIR/.provider-env-vars"
: > "$PROVIDER_ENV_VARS"
if [ -f "$OMP_SRC/agent/models.yml" ]; then
	echo "-> Processing agent/models.yml (sanitizing credentials to !printenv)..."
	awk -v varsfile="$PROVIDER_ENV_VARS" '
	/^providers:[[:space:]]*$/ { in_providers = 1; print; next }
	/^[^[:space:]#]/ { in_providers = 0 }
	in_providers && /^  [^[:space:]#][^:]*:[[:space:]]*$/ {
		provider = $0
		sub(/^  /, "", provider)
		sub(/:[[:space:]]*$/, "", provider)
		gsub(/"|\047/, "", provider)
	}
	/^[[:space:]]*apiKey:[[:space:]]*!printenv/ { print; next }
	/^[[:space:]]*apiKey:/ {
		var = (provider != "") ? toupper(provider) : "PROVIDER"
		gsub(/[^A-Z0-9]/, "_", var)
		var = var "_API_KEY"
		sub(/apiKey:.*/, "apiKey: !printenv " var)
		print var >> varsfile
		print
		next
	}
	{ print }
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
# Variables introduced by models.yml sanitization must be declared for the restored .env
while IFS= read -r var; do
	[ -n "$var" ] || continue
	grep -q "^$var=" "$STAGE_DIR/agent/.env.example" || echo "$var=" >> "$STAGE_DIR/agent/.env.example"
done < "$PROVIDER_ENV_VARS"
rm -f "$PROVIDER_ENV_VARS"

# 4. Copy commandcode-models.json
if [ -f "$OMP_SRC/agent/commandcode-models.json" ]; then
	echo "-> Copying agent/commandcode-models.json..."
	cp "$OMP_SRC/agent/commandcode-models.json" "$STAGE_DIR/agent/"
fi

# 5. Copy extensions/
#    Excluded: backups (*.bak*), disabled/off copies, and Orca-generated orca-*.ts
#    (Orca regenerates them; shipping stale copies would pin old generated code).
#    Shims that re-export an absolute path (export { default } from "C:/.../foo.ts") are
#    dereferenced into extensions/<name>/index.<ext> plus the target's relative imports, so the
#    snapshot carries the real source instead of a path that exists only on this machine.
ABS_IMPORT_RE="(from|import|require\\()[[:space:]]*[\"'](([A-Za-z]:[/\\\\])|/)[^\"']+[\"']"
deref_extension_shim() {
	local shim="$1" target name ext target_dir pkg rel top
	target="$(grep -oE "$ABS_IMPORT_RE" "$shim" | head -n 1 | sed -E "s/^[^\"']*[\"']//; s/[\"']$//")"
	[ -n "$target" ] || return 0
	if [ ! -f "$target" ]; then
		echo "CRITICAL: extension shim $(basename "$shim") points at missing $target" >&2
		exit 2
	fi
	name="$(basename "$shim")"
	name="${name%.*}"
	ext="${target##*.}"
	target_dir="$(dirname "$target")"
	pkg="$STAGE_DIR/agent/extensions/$name"
	echo "   dereferencing shim $name -> $target"
	mkdir -p "$pkg"
	cp "$target" "$pkg/index.$ext"
	# Relative imports of the entry: copy each top-level path segment (e.g. ./src/x -> src/)
	while IFS= read -r rel; do
		case "$rel" in
			../*)
				echo "CRITICAL: $target imports $rel outside its directory; cannot make it portable." >&2
				exit 2
				;;
		esac
		top="${rel#./}"
		top="${top%%/*}"
		if [ -d "$target_dir/$top" ]; then
			[ -e "$pkg/$top" ] || cp -r "$target_dir/$top" "$pkg/$top"
		else
			for cand in "$target_dir/$top" "$target_dir/$top".ts "$target_dir/$top".js; do
				if [ -f "$cand" ]; then
					cp "$cand" "$pkg/"
					break
				fi
			done
		fi
	done < <(grep -oE "(from|require\\()[[:space:]]*[\"']\\.\\.?/[^\"']+[\"']" "$target" | sed -E "s/^[^\"']*[\"']//; s/[\"']$//" | sort -u)
	rm -f "$shim"
}
if [ -d "$OMP_SRC/agent/extensions" ]; then
	echo "-> Copying agent/extensions/ (excluding *.bak*, *.disabled, *.off, orca-*)..."
	mkdir -p "$STAGE_DIR/agent/extensions"
	cp -r "$OMP_SRC/agent/extensions/." "$STAGE_DIR/agent/extensions/"
	find "$STAGE_DIR/agent/extensions" \( -name '*.bak*' -o -name '*.disabled' -o -name '*.off' -o -name 'orca-*' \) -prune -exec rm -rf {} +
	for shim in "$STAGE_DIR/agent/extensions"/*.ts "$STAGE_DIR/agent/extensions"/*.js; do
		[ -f "$shim" ] || continue
		# Pure shim = every non-blank, non-comment line is an absolute-path import/export.
		# Count non-matching lines to avoid SIGPIPE under set -euo pipefail.
		if grep -qE "$ABS_IMPORT_RE" "$shim"; then
			n="$(grep -vE "^[[:space:]]*(//.*)?$" "$shim" | grep -cvE "$ABS_IMPORT_RE" || true)"
			if [ "$n" -eq 0 ]; then
				deref_extension_shim "$shim"
			fi
		fi
	done
	ABS_LEFT="$(grep -rlE "$ABS_IMPORT_RE" "$STAGE_DIR/agent/extensions" 2>/dev/null || true)"
	if [ -n "$ABS_LEFT" ]; then
		echo "CRITICAL: extensions still import absolute machine paths (not portable):" >&2
		echo "$ABS_LEFT" >&2
		exit 2
	fi
fi

# 6. Copy managed-skills/
if [ -d "$OMP_SRC/agent/managed-skills" ]; then
	echo "-> Copying agent/managed-skills/..."
	mkdir -p "$STAGE_DIR/agent/managed-skills"
	cp -r "$OMP_SRC/agent/managed-skills/." "$STAGE_DIR/agent/managed-skills/"
fi

# 7. Copy plugins manifest (package.json only; lockfiles are generated fresh on target OS)
if [ -d "$OMP_SRC/plugins" ]; then
	echo "-> Copying plugins manifests (excluding node_modules and lockfiles)..."
	mkdir -p "$STAGE_DIR/plugins"
	for f in package.json; do
		if [ -f "$OMP_SRC/plugins/$f" ]; then
			cp "$OMP_SRC/plugins/$f" "$STAGE_DIR/plugins/"
		fi
	done
fi

# 8. Stage upstream overlay (tarball only; never mirrored into --config-dir)
if [ -n "$UPSTREAM_DIR" ]; then
	UPSTREAM_DIR="$(resolve_repo_path "$UPSTREAM_DIR")"
	if [ -d "$UPSTREAM_DIR" ]; then
		echo "-> Staging upstream overlay from $UPSTREAM_DIR..."
		mkdir -p "$STAGE_DIR/upstream"
		cp -r "$UPSTREAM_DIR/." "$STAGE_DIR/upstream/"
		rm -f "$STAGE_DIR/upstream/.omp-syncignore"
	fi
fi

# 9. Refuse SQLite state: the tarball is tracked in git, so .gitignore cannot protect it
DB_FILES="$(find "$STAGE_DIR" -type f \( -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' -o -name '*.sqlite' -o -name '*.sqlite3' \) 2>/dev/null || true)"
if [ -n "$DB_FILES" ]; then
	echo "CRITICAL: SQLite files staged for a tracked artifact (use omp-private-backup.sh instead):" >&2
	echo "$DB_FILES" >&2
	exit 2
fi

# 10. Secret scan check
#     TOKEN_RE: provider token formats (case-sensitive to avoid false hits in lockfile hashes).
#     KEYVAL_RE: credential-named keys with a literal value, quoted or bare YAML (case-insensitive).
TOKEN_RE='((^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{32,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[Bb]earer[[:space:]]+[A-Za-z0-9._~+/-]{20,})'
KEYVAL_RE='("?(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"?[[:space:]]*[:=][[:space:]]*"[^"]{12,}"|(api[_-]?key|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password)[[:space:]]*:[[:space:]]*[A-Za-z0-9._~+/=-]{20,}[[:space:]]*$)'
FOUND_SECRETS="$( { grep -r -I -E "$TOKEN_RE" "$STAGE_DIR" 2>/dev/null || true; grep -r -I -i -E "$KEYVAL_RE" "$STAGE_DIR" 2>/dev/null || true; } | (grep -v "\.env\.example" || true) )"
if [ -n "$FOUND_SECRETS" ]; then
	echo "CRITICAL: Potential unmasked credential detected in staged files!" >&2
	echo "$FOUND_SECRETS" >&2
	exit 2
fi

# 11. Mirror the live snapshot (not the upstream overlay) into config-dir
if [ -n "$CONFIG_DIR" ]; then
	TARGET_CONFIG_DIR="$(resolve_repo_path "$CONFIG_DIR")"
	if [ -n "$UPSTREAM_DIR" ] && [ -d "$TARGET_CONFIG_DIR" ] && [ -d "$UPSTREAM_DIR" ] \
		&& [ "$(cd "$TARGET_CONFIG_DIR" && pwd)" = "$(cd "$UPSTREAM_DIR" && pwd)" ]; then
		echo "Error: --config-dir must not be the upstream overlay dir ($UPSTREAM_DIR)." >&2
		exit 1
	fi
	echo "-> Mirroring clean setup to $TARGET_CONFIG_DIR..."
	mkdir -p "$TARGET_CONFIG_DIR"
	find "$TARGET_CONFIG_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
	for entry in "$STAGE_DIR"/* "$STAGE_DIR"/.[!.]*; do
		[ -e "$entry" ] || continue
		[ "$(basename "$entry")" = "upstream" ] && continue
		cp -r "$entry" "$TARGET_CONFIG_DIR/"
	done
fi

# 12. Output to tarball
mkdir -p "$(dirname "$OUT")"
echo "-> Creating portable tarball at $OUT..."
tar -czf "$OUT" -C "$STAGE_DIR" .

echo "✓ omp-setup-backup completed successfully."
