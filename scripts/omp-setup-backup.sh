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
# Extension loader shims (`export { default } from "<abs path>";`) are dereferenced for portability and
# listed in extension-loader-shims.tsv so omp-setup-restore.sh keeps/recreates the 1-line loader instead.
#
# Private state (mnemopi memory, history, ~/.claude) is NOT handled here:
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

to_tar_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -u "$1"
	else
		echo "$1"
	fi
}

norm_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
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

# 1. Sanitize & Copy config.yml (normalize shellPath, opt-in customDirectories, and CRLF)
if [ -f "$OMP_SRC/agent/config.yml" ]; then
	echo "-> Processing agent/config.yml (normalizing shellPath & customDirectories)..."
	tr -d '\r' < "$OMP_SRC/agent/config.yml" \
		| sed 's|^shellPath:.*|shellPath: {{SHELL_PATH}}|' \
		| sed -E 's|^([[:space:]]*-[[:space:]]*).*skills-optin.*$|\1"{{OMP_SKILLS_OPTIN_DIR}}"|' \
		> "$STAGE_DIR/agent/config.yml"
else
	echo "Warning: agent/config.yml not found." >&2
fi

# 2. Sanitize & Copy models.yml: literal apiKey values become !printenv <PROVIDER>_API_KEY
PROVIDER_ENV_VARS="$STAGE_DIR/.provider-env-vars"
: > "$PROVIDER_ENV_VARS"
if [ -f "$OMP_SRC/agent/models.yml" ]; then
	echo "-> Processing agent/models.yml (sanitizing credentials to !printenv)..."
	tr -d '\r' < "$OMP_SRC/agent/models.yml" | awk -v varsfile="$PROVIDER_ENV_VARS" '
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
	' > "$STAGE_DIR/agent/models.yml"
fi

# 3. Handle .env -> .env.example (DO NOT copy .env)
if [ -f "$OMP_SRC/agent/.env" ]; then
	echo "-> Generating agent/.env.example from keys in .env (live secrets omitted)..."
	tr -d '\r' < "$OMP_SRC/agent/.env" | awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ { print $1 "=" }' > "$STAGE_DIR/agent/.env.example"
else
	cat <<'EOF' > "$STAGE_DIR/agent/.env.example"
TYPESAFE_API_KEY=
ZAI_API_KEY=
EOF
fi
while IFS= read -r var; do
	[ -n "$var" ] || continue
	grep -q "^$var=" "$STAGE_DIR/agent/.env.example" || echo "$var=" >> "$STAGE_DIR/agent/.env.example"
done < "$PROVIDER_ENV_VARS"
rm -f "$PROVIDER_ENV_VARS"

# 4. Copy static JSON agent configs (NEVER copy raw live mcp.json; emit sanitized mcp.json.example instead)
for cfg in commandcode-models.json typesafe.json mcp.json.example tools-requirements.txt; do
	if [ -f "$OMP_SRC/agent/$cfg" ]; then
		echo "-> Copying agent/$cfg..."
		tr -d '\r' < "$OMP_SRC/agent/$cfg" > "$STAGE_DIR/agent/$cfg"
	fi
done
if [ -f "$OMP_SRC/agent/mcp.json" ] && [ ! -f "$STAGE_DIR/agent/mcp.json.example" ]; then
	echo "-> Generating sanitized agent/mcp.json.example from mcp.json..."
	MCP_PY=""
	for _py in python3 python; do
		if command -v "$_py" >/dev/null 2>&1 && "$_py" -c "import json" >/dev/null 2>&1; then
			MCP_PY="$_py"
			break
		fi
	done
	if [ -n "$MCP_PY" ]; then
		"$MCP_PY" - "$(norm_path "$OMP_SRC/agent/mcp.json")" "$(norm_path "$STAGE_DIR/agent/mcp.json.example")" "$(norm_path "${HOME:-${USERPROFILE:-}}")" <<'PY'
import json, os, pathlib, re, sys
src, dst, home_arg = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3].rstrip("/\\")
homes = {h for h in (home_arg, os.path.expanduser("~").replace("\\", "/"), os.environ.get("USERPROFILE", "").replace("\\", "/")) if h}
txt = src.read_text(encoding="utf-8", errors="ignore")
for h in sorted(homes, key=len, reverse=True):
    h_bs = h.replace("/", "\\")
    for pat in (
        re.escape(h) + r"/\.claude/runtime/node/node(?:\.exe)?",
        re.escape(h_bs) + r"\\+\.claude\\+runtime\\+node\\+node(?:\.exe)?",
        re.escape(h.replace("/", "\\\\")) + r"\\\\\.claude\\\\runtime\\\\node\\\\node(?:\.exe)?",
    ):
        txt = re.sub(pat, "{{OMP_NODE}}", txt, flags=re.IGNORECASE)
    for h_pat in (re.escape(h), re.escape(h.replace("/", "\\\\")), re.escape(h_bs)):
        txt = re.sub(h_pat, "{{USER_HOME}}", txt, flags=re.IGNORECASE)
try:
    data = json.loads(txt)
    for srv in (data.get("mcpServers") or {}).values():
        if isinstance(srv, dict):
            cmd = str(srv.get("command") or "")
            if cmd.endswith(("node", "node.exe")) and ("/" in cmd or "\\" in cmd):
                srv["command"] = "{{OMP_NODE}}"
            if isinstance(srv.get("env"), dict):
                for k in list(srv["env"].keys()):
                    if any(tok in k.upper() for tok in ("KEY", "TOKEN", "SECRET", "PASS")):
                        srv["env"][k] = ""
    dst.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
except Exception:
    dst.write_text(txt.replace("\\", "/"), encoding="utf-8", newline="\n")
PY
	fi
fi

# 5. Copy extensions/ with recursive relative-import shim dereferencing
ABS_IMPORT_RE="(from|import|require\\()[[:space:]]*[\"'](([A-Za-z]:[/\\\\])|/)[^\"']+[\"']"
REL_IMPORT_RE="(from|import[[:space:]]*\\(?|[A-Za-z_]*[Rr]equire[[:space:]]*\\(|new[[:space:]]+URL[[:space:]]*\\()[[:space:]]*[\"']\\.\\.?/[^\"']+[\"']"

resolve_rel_module() {
	local base_dir="$1" rel_spec="$2" root_norm="$3" cand resolved
	cand="$base_dir/$rel_spec"
	# Normalize .. and . lexically/physically via cd+pwd on dirname
	local cdir cbase
	cdir="$(dirname "$cand")"
	cbase="$(basename "$cand")"
	if [ -d "$cdir" ]; then
		cdir="$(cd "$cdir" && pwd -P)"
		cdir="$(norm_path "$cdir")"
	else
		return 1
	fi
	for try in "$cdir/$cbase" "$cdir/$cbase.ts" "$cdir/$cbase.tsx" "$cdir/$cbase.js" "$cdir/$cbase.cjs" "$cdir/$cbase.mjs" "$cdir/$cbase/index.ts" "$cdir/$cbase/index.js"; do
		if [ -f "$try" ]; then
			resolved="$try"
			break
		fi
	done
	[ -n "${resolved:-}" ] || return 1
	case "$resolved" in
		"$root_norm"/*)
			echo "${resolved#$root_norm/}"
			return 0
			;;
		*)
			echo "CRITICAL: $base_dir imports $rel_spec ($resolved) outside $root_norm; cannot make portable." >&2
			return 2
			;;
	esac
}

deref_extension_shim() {
	local shim="$1" target name ext target_dir target_dir_norm pkg rel resolved_rel
	target="$(grep -oE "$ABS_IMPORT_RE" "$shim" | head -n 1 | sed -E "s/^[^\"']*[\"']//; s/[\"']$//")"
	[ -n "$target" ] || return 0
	if [ ! -f "$target" ]; then
		echo "CRITICAL: extension shim $(basename "$shim") points at missing $target" >&2
		exit 2
	fi
	name="$(basename "$shim")"
	name="${name%.*}"
	ext="${target##*.}"
	target_dir="$(cd "$(dirname "$target")" && pwd -P)"
	target_dir_norm="$(norm_path "$target_dir")"
	pkg="$STAGE_DIR/agent/extensions/$name"
	echo "   dereferencing shim $name -> $target (recursive relative closure)"
	mkdir -p "$pkg"
	cp "$target" "$pkg/index.$ext"

	local fast_done=0
	local fast_rt=""
	for rt in node bun python3 python; do
		if command -v "$rt" >/dev/null 2>&1; then
			if [ "$rt" = "python3" ] || [ "$rt" = "python" ]; then
				"$rt" -c "import sys" >/dev/null 2>&1 || continue
			fi
			fast_rt="$rt"
			break
		fi
	done
	if [ "$fast_rt" = "node" ] || [ "$fast_rt" = "bun" ]; then
		set +e
		"$fast_rt" -e '
const fs = require("fs");
const path = require("path");
const [entryPath, rootDir, pkgDir] = process.argv.slice(-3);
const rootReal = fs.realpathSync(rootDir);
const visited = new Set([fs.realpathSync(entryPath)]);
const copiedTop = new Set();
const queue = [fs.realpathSync(entryPath)];
const impRe = /(?:from|import\s*\(?|[A-Za-z_]*[Rr]equire\s*\(|new\s+URL\s*\()\s*["'\''](\.\.?\/[^"'\'']+)["'\'']/g;
const exts = ["", ".ts", ".tsx", ".js", ".cjs", ".mjs", "/index.ts", "/index.js"];
function copyDirFiltered(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name.includes(".bak")) continue;
    const sp = path.join(srcDir, ent.name), dp = path.join(dstDir, ent.name);
    if (ent.isDirectory()) copyDirFiltered(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}
while (queue.length) {
  const cur = queue.shift();
  const txt = fs.readFileSync(cur, "utf8");
  let m;
  while ((m = impRe.exec(txt)) !== null) {
    const base = path.resolve(path.dirname(cur), m[1]);
    let found = null;
    for (const e of exts) {
      const cand = base + e;
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { found = fs.realpathSync(cand); break; }
    }
    if (!found) continue;
    const rel = path.relative(rootReal, found);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      console.error("CRITICAL: " + cur + " imports " + m[1] + " outside " + rootReal);
      process.exit(2);
    }
    const topSeg = rel.split(path.sep)[0];
    const topSrc = path.join(rootReal, topSeg);
    if (topSeg === "src" && fs.existsSync(topSrc) && fs.statSync(topSrc).isDirectory() && !copiedTop.has(topSeg)) {
      copiedTop.add(topSeg);
      copyDirFiltered(topSrc, path.join(pkgDir, topSeg));
    } else if (!fs.existsSync(path.join(pkgDir, rel))) {
      const dst = path.join(pkgDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(found, dst);
      for (const declExt of [".d.ts", ".d.cts"]) {
        const decl = found.replace(/\.(ts|js|cjs|mjs)$/, declExt);
        if (decl !== found && fs.existsSync(decl)) {
          fs.copyFileSync(decl, path.join(pkgDir, path.relative(rootReal, decl)));
        }
      }
    }
    if (!visited.has(found)) {
      visited.add(found);
      queue.push(found);
    }
  }
}
' "$(norm_path "$target_dir/$(basename "$target")")" "$target_dir_norm" "$(norm_path "$pkg")"
		rc=$?
		set -e
		if [ "$rc" -eq 2 ]; then exit 2; fi
		[ "$rc" -eq 0 ] && fast_done=1
	fi

	if [ "$fast_done" -eq 0 ]; then
		local visited_file="$STAGE_DIR/.ext_visited_$$"
		local queue_file="$STAGE_DIR/.ext_queue_$$"
		: > "$visited_file"
		printf '%s\t%s\n' "$(norm_path "$target_dir/$(basename "$target")")" "index.$ext" > "$queue_file"
		while [ -s "$queue_file" ]; do
			local next_queue="$STAGE_DIR/.ext_next_$$"
			: > "$next_queue"
			while IFS=$'\t' read -r src_file _pkg_rel; do
				[ -n "$src_file" ] || continue
				local src_dir
				src_dir="$(norm_path "$(cd "$(dirname "$src_file")" && pwd -P)")"
				while IFS= read -r rel; do
					[ -n "$rel" ] || continue
					set +e
					resolved_rel="$(resolve_rel_module "$src_dir" "$rel" "$target_dir_norm")"
					rc=$?
					set -e
					if [ "$rc" -eq 2 ]; then rm -f "$visited_file" "$queue_file" "$next_queue"; exit 2; fi
					[ "$rc" -eq 0 ] && [ -n "$resolved_rel" ] || continue
					if ! grep -qxF "$resolved_rel" "$visited_file" 2>/dev/null; then
						echo "$resolved_rel" >> "$visited_file"
						mkdir -p "$(dirname "$pkg/$resolved_rel")"
						cp "$target_dir_norm/$resolved_rel" "$pkg/$resolved_rel"
						printf '%s\t%s\n' "$target_dir_norm/$resolved_rel" "$resolved_rel" >> "$next_queue"
					fi
				done < <(grep -oE "$REL_IMPORT_RE" "$src_file" 2>/dev/null | sed -E "s/^[^\"']*[\"']//; s/[\"']$//" | sort -u || true)
			done < "$queue_file"
			mv -f "$next_queue" "$queue_file"
		done
		rm -f "$visited_file" "$queue_file"
	fi
	record_loader_shim "$name" "${shim##*.}" "$target"
	rm -f "$shim"
}

# Mark a dereferenced shim in $STAGE_DIR/extension-loader-shims.tsv (name, loader extension,
# target as {{USER_HOME}}-relative template or "-" when outside $HOME). Restore uses it to keep or
# recreate the 1-line loader instead of installing a second, dereferenced copy next to it.
SHIM_MANIFEST="$STAGE_DIR/extension-loader-shims.tsv"
record_loader_shim() {
	local name="$1" loader_ext="$2" target="$3" home_norm target_norm tmpl="-" lc_home lc_target
	home_norm="$(norm_path "${HOME:-${USERPROFILE:-}}")"
	home_norm="${home_norm%/}"
	target_norm="$(norm_path "$target")"
	if [ -n "$home_norm" ]; then
		lc_home="$(printf '%s' "$home_norm/" | tr '[:upper:]' '[:lower:]')"
		lc_target="$(printf '%s' "$target_norm" | tr '[:upper:]' '[:lower:]')"
		case "$lc_target" in
			"$lc_home"*) tmpl="{{USER_HOME}}/${target_norm:$((${#home_norm} + 1))}" ;;
		esac
	fi
	printf '%s	%s	%s
' "$name" "$loader_ext" "$tmpl" >> "$SHIM_MANIFEST"
}

if [ -d "$OMP_SRC/agent/extensions" ]; then
	echo "-> Copying agent/extensions/ (excluding *.bak*, *.disabled, *.off, orca-*)..."
	mkdir -p "$STAGE_DIR/agent/extensions"
	cp -rL "$OMP_SRC/agent/extensions/." "$STAGE_DIR/agent/extensions/"
	find "$STAGE_DIR/agent/extensions" \( -name '*.bak*' -o -name '*.disabled' -o -name '*.off' -o -name 'orca-*' \) -prune -exec rm -rf {} +
	for shim in "$STAGE_DIR/agent/extensions"/*.ts "$STAGE_DIR/agent/extensions"/*.js; do
		[ -f "$shim" ] || continue
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

# 6. Copy OMP-native Priority-100 dirs & managed-skills (dereferencing symlinks/junctions via cp -rL)
for sub in skills skills-optin managed-skills agents commands rules hooks tools; do
	if [ -d "$OMP_SRC/agent/$sub" ]; then
		echo "-> Copying agent/$sub/ (dereferenced)..."
		mkdir -p "$STAGE_DIR/agent/$sub"
		cp -rL "$OMP_SRC/agent/$sub/." "$STAGE_DIR/agent/$sub/"
		find "$STAGE_DIR/agent/$sub" \( -name '__pycache__' -o -name '.venv' -o -name 'venv' -o -name 'node_modules' \) -type d -prune -exec rm -rf {} + 2>/dev/null || true
		find "$STAGE_DIR/agent/$sub" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete 2>/dev/null || true
	fi
done

# 7. Copy plugins manifests (package.json & omp-plugins.lock.json; exclude node_modules and bun.lock)
if [ -d "$OMP_SRC/plugins" ]; then
	echo "-> Copying plugins manifests (excluding node_modules and bun.lock)..."
	mkdir -p "$STAGE_DIR/plugins"
	for f in package.json omp-plugins.lock.json; do
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
		cp -rL "$UPSTREAM_DIR/." "$STAGE_DIR/upstream/"
		rm -f "$STAGE_DIR/upstream/.omp-syncignore"
	fi
fi

# 9. Refuse un-dereferenced symlinks & SQLite state
LEFT_LINKS="$(find "$STAGE_DIR" -type l 2>/dev/null || true)"
if [ -n "$LEFT_LINKS" ]; then
	echo "CRITICAL: Symlinks survived staging (breaks cross-OS Windows/macOS portability):" >&2
	echo "$LEFT_LINKS" >&2
	exit 2
fi

DB_FILES="$(find "$STAGE_DIR" -type f \( -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' -o -name '*.sqlite' -o -name '*.sqlite3' \) 2>/dev/null || true)"
if [ -n "$DB_FILES" ]; then
	echo "CRITICAL: SQLite files staged for a tracked artifact (use omp-private-backup.sh instead):" >&2
	echo "$DB_FILES" >&2
	exit 2
fi

# 10. Secret & unportable machine-path scan check
TOKEN_RE='((^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{32,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[Bb]earer[[:space:]]+[A-Za-z0-9._~+/-]{20,})'
KEYVAL_RE='("?(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"?[[:space:]]*[:=][[:space:]]*"[^"]{12,}"|(api[_-]?key|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password)[[:space:]]*:[[:space:]]*[A-Za-z0-9._~+/=-]{20,}[[:space:]]*$)'
FOUND_TOKENS="$(grep -r -I -E "$TOKEN_RE" "$STAGE_DIR" 2>/dev/null | (grep -v "\.env\.example" || true) || true)"
FOUND_KEYVALS="$(grep -r -I -i -E "$KEYVAL_RE" "$STAGE_DIR" 2>/dev/null | (grep -v -E '\.env\.example|process\.env\.|\$\{[A-Z0-9_]+\}|<PLACEHOLDER>|<API_TOKEN>' || true) || true)"
FOUND_SECRETS="${FOUND_TOKENS}${FOUND_KEYVALS}"
if [ -n "$FOUND_SECRETS" ]; then
	echo "CRITICAL: Potential unmasked credential detected in staged files!" >&2
	echo "$FOUND_SECRETS" >&2
	exit 2
fi

# 10b. Scan all staged agent/ subdirectories for leaked workstation/personal machine paths
ABS_PY_BIN=""
for _py in python3 python; do
	if command -v "$_py" >/dev/null 2>&1 && "$_py" -c "import sys" >/dev/null 2>&1; then
		ABS_PY_BIN="$_py"
		break
	fi
done
if [ -n "$ABS_PY_BIN" ]; then
	set +e
	ABS_AGENT_HITS="$("$ABS_PY_BIN" - "$STAGE_DIR/agent" <<'PY'
import pathlib, re, sys
agent_root = pathlib.Path(sys.argv[1])
scan_dirs = ("skills", "skills-optin", "agents", "commands", "rules", "managed-skills", "tools")
scan_exts = {".ts", ".tsx", ".js", ".cjs", ".mjs", ".py", ".sh", ".ps1", ".yml", ".yaml", ".json", ".md"}
placeholders = {"user", "username", "jesse", "name", "example", "demo", "<user>", "...", "path", "foo", "x"}
allow_files = {"path-utils.cjs", "typesafe-redact-patterns.cjs", "typesafe-enabled-resolver.cjs"}
win_path_re = re.compile(r"(?:^|(?<=[\s\"'`(=,;\[{<]))([A-Za-z]):(/+|\\+(?![sSwWdDbBnrtvf0-9.*+?\[({\\$]))([^\s\"'`<>)\]]*)")
posix_home_re = re.compile(r"(?:/Users/|/home/)([A-Za-z0-9._<>-]+)")
bad = []
for sub in scan_dirs:
    sd = agent_root / sub
    if not sd.is_dir():
        continue
    for p in sorted(sd.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in scan_exts:
            continue
        rel = p.relative_to(agent_root).as_posix()
        if p.name in allow_files or "/__tests__/" in f"/{rel}":
            continue
        txt = p.read_text(encoding="utf-8", errors="ignore")
        for lno, line in enumerate(txt.splitlines(), 1):
            for m in win_path_re.finditer(line):
                drv = m.group(1).upper()
                rest = m.group(3).replace("\\", "/")
                first = rest.split("/", 1)[0].lower()
                if drv == "C" and (first.startswith("windows") or first.startswith("program") or first == "programdata"):
                    continue
                if rest.lower().startswith("users/"):
                    parts = rest.split("/")
                    uname = parts[1].lower() if len(parts) > 1 else ""
                    if uname in placeholders or uname.startswith("<"):
                        continue
                if first in ("path", "foo", "x", "...", "demo", "example"):
                    continue
                if drv == "G" and (first in ("...", "x") or rest.lower().startswith("my")):
                    continue
                if rest.startswith("\\\\") or not rest:
                    continue
                bad.append(f"{rel}:{lno}: {m.group(0).strip()}")
            for m in posix_home_re.finditer(line):
                uname = m.group(1).lower()
                if uname in placeholders or uname.startswith("<"):
                    continue
                bad.append(f"{rel}:{lno}: {m.group(0).strip()}")
if bad:
    print("\n".join(bad[:25]))
    sys.exit(2)
PY
)"
	abs_rc=$?
	set -e
	if [ "$abs_rc" -ne 0 ]; then
		echo "CRITICAL: staged agent files contain raw workstation/user paths (not portable):" >&2
		echo "$ABS_AGENT_HITS" >&2
		exit 2
	fi
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
		cp -rL "$entry" "$TARGET_CONFIG_DIR/"
	done
fi

# 12. Output to tarball
mkdir -p "$(dirname "$OUT")"
echo "-> Creating portable tarball at $OUT..."
tar -czf "$(to_tar_path "$OUT")" -C "$STAGE_DIR" .

echo "✓ omp-setup-backup completed successfully."
