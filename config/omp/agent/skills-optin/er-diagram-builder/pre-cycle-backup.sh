#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
# Workspace root is two levels up from current CWD during execution, but let's assume the script runs from the project root where _output lives.
# We will use relative path to _output assuming the skill is executed from the project root.
BACKUP_DIR="_output/logs/archive/run_$TIMESTAMP"

echo "[Phase 1] Starting Mandatory Pre-cycle Backup (First Gate)..."

# Ensure the backup directory exists
mkdir -p "$BACKUP_DIR"

# Copy directories if they exist
if [ -d "_output/diagrams" ]; then
    cp -r "_output/diagrams" "$BACKUP_DIR/"
    echo "  -> Backed up _output/diagrams to $BACKUP_DIR"
fi

if [ -d "_output/db_table_mapped" ]; then
    cp -r "_output/db_table_mapped" "$BACKUP_DIR/"
    echo "  -> Backed up _output/db_table_mapped to $BACKUP_DIR"
fi

echo "[Phase 1] Backup completed successfully."
exit 0
