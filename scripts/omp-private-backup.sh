#!/usr/bin/env bash
#
# omp-private-backup.sh — Encrypted backup of private omp & claude state (NEVER commit the output)
#
# Opt-in items:
#   --memory        ~/.omp/agent/memories/mnemopi/banks/*/mnemopi.db   (long-term memory, per workspace)
#   --history       ~/.omp/agent/history.db                            (prompt history, session titles/recaps)
#   --typesafe-kit  ~/.claude/mcp/typesafe/, ~/.claude/hooks/lib/typesafe-enabled-resolver.cjs, ~/.claude/.ck.json
#   --claude        Full portable ~/.claude/ ecosystem (skills, agents, hooks, workflows, rules, settings, .ck.json,
#                   and ~/.claude.json mcpServers) with Windows paths templated ({{CLAUDE_NODE}}, {{USER_HOME}})
#                   for cross-OS Windows <-> macOS portability. Excludes runtime/, .logs/, cache/, .venv/, .credentials.json.
#   --all           All of the above (--memory --history --typesafe-kit --claude)
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
WANT_CLAUDE=0

usage() {
	sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--memory) WANT_MEMORY=1; shift ;;
		--history) WANT_HISTORY=1; shift ;;
		--typesafe-kit) WANT_KIT=1; shift ;;
		--claude) WANT_CLAUDE=1; shift ;;
		--all) WANT_MEMORY=1; WANT_HISTORY=1; WANT_KIT=1; WANT_CLAUDE=1; shift ;;
		--source) OMP_SRC="$2"; shift 2 ;;
		--home) USER_HOME="$2"; shift 2 ;;
		-o|--output) OUT="$2"; shift 2 ;;
		--no-encrypt) ENCRYPT=0; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ "$WANT_MEMORY$WANT_HISTORY$WANT_KIT$WANT_CLAUDE" = "0000" ]; then
	echo "Error: nothing selected. Use --memory, --history, --typesafe-kit, --claude or --all." >&2
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
elif command -v python3 >/dev/null 2>&1 && python3 -c 'import sqlite3' >/dev/null 2>&1; then
	SQLITE_TOOL="python3"
elif command -v python >/dev/null 2>&1 && python -c 'import sqlite3' >/dev/null 2>&1; then
	SQLITE_TOOL="python"
fi

snapshot_db() {
	local src="$1" dst="$2"
	mkdir -p "$(dirname "$dst")"
	case "$SQLITE_TOOL" in
		sqlite3)
			sqlite3 "$(native_path "$src")" ".backup '$(native_path "$dst")'"
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
		python3|python)
			"$SQLITE_TOOL" -c '
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
with sqlite3.connect(src) as s, sqlite3.connect(dst) as d:
    s.backup(d)
' "$(native_path "$src")" "$(native_path "$dst")"
			;;
		*)
			echo "Error: no SQLite snapshot tool (sqlite3, bun, node>=22.5, or python sqlite3)." >&2
			exit 1
			;;
	esac
}

template_claude_paths() {
	local target_file="$1" home_nat home_esc
	[ -f "$target_file" ] || return 0
	home_nat="$(native_path "$USER_HOME")"
	home_esc="${home_nat//\//\\\\}"
	if command -v python3 >/dev/null 2>&1; then
		python3 - "$target_file" "$home_nat" "$home_esc" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
home_fwd = sys.argv[2].rstrip("/\\")
home_bs = home_fwd.replace("/", "\\")
txt = p.read_text(encoding="utf-8", errors="ignore")
for node_pat in [
    re.escape(home_fwd) + r"/\.claude/runtime/node/node(?:\.exe)?",
    re.escape(home_bs) + r"\\+\.claude\\+runtime\\+node\\+node(?:\.exe)?",
    re.escape(home_fwd.replace("/", "\\\\")) + r"\\\\\.claude\\\\runtime\\\\node\\\\node(?:\.exe)?",
]:
    txt = re.sub(node_pat, "{{CLAUDE_NODE}}", txt, flags=re.IGNORECASE)
for h_pat in [re.escape(home_fwd), re.escape(home_fwd.replace("/", "\\\\")), re.escape(home_bs)]:
    txt = re.sub(h_pat, "{{USER_HOME}}", txt, flags=re.IGNORECASE)
p.write_text(txt, encoding="utf-8", newline="\n")
PY
	else
		sed -e "s|$home_nat/.claude/runtime/node/node.exe|{{CLAUDE_NODE}}|g" \
			-e "s|$home_nat/.claude/runtime/node/node|{{CLAUDE_NODE}}|g" \
			-e "s|$home_nat|{{USER_HOME}}|g" \
			"$target_file" > "$target_file.tmp" && mv -f "$target_file.tmp" "$target_file"
	fi
}

STAGE_DIR="$(mktemp -d -t omp-private-XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT
COUNT=0

if [ "$WANT_MEMORY" -eq 1 ]; then
	BANKS="$OMP_SRC/agent/memories/mnemopi/banks"
	if [ -d "$BANKS" ]; then
		mem_count=0
		for db in "$BANKS"/*/mnemopi.db; do
			[ -f "$db" ] || continue
			bank="$(basename "$(dirname "$db")")"
			snapshot_db "$db" "$STAGE_DIR/.omp/agent/memories/mnemopi/banks/$bank/mnemopi.db"
			mem_count=$((mem_count + 1))
			COUNT=$((COUNT + 1))
		done
		echo "-> memory: $mem_count mnemopi bank(s)"
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

if [ "$WANT_CLAUDE" -eq 1 ]; then
	CLAUDE_SRC="$USER_HOME/.claude"
	if [ -d "$CLAUDE_SRC" ]; then
		echo "-> claude: copying portable ~/.claude ecosystem (dereferencing junctions, pruning runtime/cache/credentials)..."
		mkdir -p "$STAGE_DIR/.claude"
		if command -v python3 >/dev/null 2>&1 && python3 -c "import shutil" >/dev/null 2>&1; then
			python3 - "$(native_path "$CLAUDE_SRC")" "$(native_path "$STAGE_DIR/.claude")" <<'PY'
import os, shutil, sys
src_root, dst_root = sys.argv[1], sys.argv[2]
ITEMS = [
    "skills", "agents", "hooks", "workflows", "rules", "output-styles",
    "schemas", "scripts", "templates", "evals", "mcp", "plugins",
    "CLAUDE.md", "settings.json", ".ck.json", "metadata.json",
    "statusline.cjs", ".ckignore", ".env.example", ".mcp.json.example",
]
SKIP_DIRS = {".venv", "venv", "node_modules", "__pycache__", ".logs", "runtime", "cache", "downloads", "marketplaces"}
SKIP_FILES = {".credentials.json", "plugin-directory-cache-v2.json"}
def _ignore(cur, names):
    ignored = set()
    for n in names:
        if n in SKIP_DIRS or n in SKIP_FILES or n.endswith((".pyc", ".lock")):
            ignored.add(n)
    return ignored
for item in ITEMS:
    sp = os.path.join(src_root, item)
    if not os.path.exists(sp):
        continue
    dp = os.path.join(dst_root, item)
    if os.path.isdir(sp):
        shutil.copytree(sp, dp, symlinks=False, ignore=_ignore, dirs_exist_ok=True)
    else:
        shutil.copy2(sp, dp)
PY
		else
			for item in skills agents hooks workflows rules output-styles schemas scripts templates evals mcp CLAUDE.md settings.json .ck.json metadata.json statusline.cjs .ckignore .env.example .mcp.json.example; do
				if [ -e "$CLAUDE_SRC/$item" ]; then
					cp -rL "$CLAUDE_SRC/$item" "$STAGE_DIR/.claude/" 2>/dev/null || cp -r "$CLAUDE_SRC/$item" "$STAGE_DIR/.claude/"
				fi
			done
			for psub in known_marketplaces.json store; do
				if [ -e "$CLAUDE_SRC/plugins/$psub" ]; then
					mkdir -p "$STAGE_DIR/.claude/plugins"
					cp -rL "$CLAUDE_SRC/plugins/$psub" "$STAGE_DIR/.claude/plugins/" 2>/dev/null || true
				fi
			done
			find "$STAGE_DIR/.claude" \( -name '.venv' -o -name 'venv' -o -name 'node_modules' -o -name '__pycache__' -o -name '.logs' -o -name 'runtime' -o -name 'cache' -o -name 'downloads' \) -type d -prune -exec rm -rf {} + 2>/dev/null || true
			find "$STAGE_DIR/.claude" -type f \( -name '*.pyc' -o -name '.credentials.json' -o -name '*.lock' \) -delete 2>/dev/null || true
		fi
		template_claude_paths "$STAGE_DIR/.claude/settings.json"
		template_claude_paths "$STAGE_DIR/.claude/plugins/known_marketplaces.json"
		COUNT=$((COUNT + 1))
	else
		echo "Warning: --claude: $CLAUDE_SRC not found." >&2
	fi
	if [ -f "$USER_HOME/.claude.json" ]; then
		JS_RT=""
		if command -v node >/dev/null 2>&1; then JS_RT="node"; elif command -v bun >/dev/null 2>&1; then JS_RT="bun"; fi
		if [ -n "$JS_RT" ]; then
			"$JS_RT" -e '
				const fs = require("fs");
				const [src, dst] = process.argv.slice(-2);
				try {
					const data = JSON.parse(fs.readFileSync(src, "utf8"));
					if (data && data.mcpServers && Object.keys(data.mcpServers).length) {
						fs.writeFileSync(dst, JSON.stringify({ mcpServers: data.mcpServers }, null, 2) + "\n");
					}
				} catch {}
			' "$(native_path "$USER_HOME/.claude.json")" "$(native_path "$STAGE_DIR/.claude-mcp-servers.json")"
			template_claude_paths "$STAGE_DIR/.claude-mcp-servers.json"
		fi
	fi
elif [ "$WANT_KIT" -eq 1 ]; then
	kit_found=0
	for rel in .claude/mcp/typesafe .claude/hooks/lib/typesafe-enabled-resolver.cjs .claude/.ck.json; do
		if [ -e "$USER_HOME/$rel" ]; then
			mkdir -p "$STAGE_DIR/$(dirname "$rel")"
			cp -rL "$USER_HOME/$rel" "$STAGE_DIR/$rel"
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
	if [ -n "${GNUPGHOME:-}" ]; then
		export GNUPGHOME="$(to_gpg_path "$GNUPGHOME")"
	fi
	GPG_ARGS=(--symmetric --cipher-algo AES256 --yes --output "$(to_gpg_path "$OUT")")
	if [ -n "${OMP_BACKUP_PASSPHRASE_FILE:-}" ]; then
		GPG_ARGS=(--batch --pinentry-mode loopback --passphrase-file "$(to_gpg_path "$OMP_BACKUP_PASSPHRASE_FILE")" "${GPG_ARGS[@]}")
	fi
	tar -czf - -C "$STAGE_DIR" . | gpg "${GPG_ARGS[@]}"
else
	echo "WARNING: --no-encrypt: archive holds private memory/history/kit files in plain form." >&2
	tar -czf "$(to_tar_path "$OUT")" -C "$STAGE_DIR" .
fi

echo "✓ omp-private-backup: $OUT"
echo "  Restore (omp stopped):"
echo "    ./scripts/omp-private-restore.sh \"$OUT\""
