#!/usr/bin/env bash
#
# scripts/omp-schedule-sync.sh — macOS launchd helper for periodic non-destructive OMP sync & drift watch
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
	ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

ACTION="dry-run"
INTERVAL_HOURS=24
LABEL="com.user.omp-sync"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--install) ACTION="install"; shift ;;
		--uninstall) ACTION="uninstall"; shift ;;
		--dry-run) ACTION="dry-run"; shift ;;
		--interval-hours) INTERVAL_HOURS="$2"; shift 2 ;;
		-h|--help)
			echo "Usage: $0 [--dry-run|--install|--uninstall] [--interval-hours 24]"
			exit 0
			;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ "$ACTION" = "uninstall" ]; then
	if [ -f "$PLIST_PATH" ]; then
		launchctl unload "$PLIST_PATH" 2>/dev/null || true
		rm -f "$PLIST_PATH"
		echo "✓ Uninstalled $PLIST_PATH"
	else
		echo "Notice: $PLIST_PATH does not exist."
	fi
	exit 0
fi

INTERVAL_SECONDS=$((INTERVAL_HOURS * 3600))
PLIST_CONTENT="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${ROOT}/scripts/omp-bootstrap.sh</string>
        <string>--mode</string>
        <string>backup</string>
        <string>--dry-run</string>
    </array>
    <key>StartInterval</key>
    <integer>${INTERVAL_SECONDS}</integer>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${HOME}/.omp/sync-agent.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/.omp/sync-agent.err</string>
</dict>
</plist>"

if [ "$ACTION" = "dry-run" ]; then
	echo "=== [DRY-RUN] launchd plist preview for $PLIST_PATH ==="
	echo "$PLIST_CONTENT"
	exit 0
fi

# ACTION = install
mkdir -p "$(dirname "$PLIST_PATH")" "${HOME}/.omp"
echo "$PLIST_CONTENT" > "$PLIST_PATH"
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "✓ Installed and loaded launchd schedule: $PLIST_PATH (interval: ${INTERVAL_HOURS}h)"
