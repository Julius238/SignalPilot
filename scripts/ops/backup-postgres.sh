#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env
require_service_running postgres

BACKUP_DIR="${SIGNALPILOT_BACKUP_DIR:-$REPO_ROOT/backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Resolve DB name and user from the running container's environment
DB_USER=$("${COMPOSE[@]}" exec -T postgres sh -c 'printf "%s" "$POSTGRES_USER"')
DB_NAME=$("${COMPOSE[@]}" exec -T postgres sh -c 'printf "%s" "$POSTGRES_DB"')

if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  echo "ERROR: POSTGRES_USER or POSTGRES_DB is empty inside the postgres service." >&2
  exit 1
fi

BACKUP_FILE="${BACKUP_DIR}/signalpilot_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"
TEMP_FILE=$(mktemp "$BACKUP_DIR/.signalpilot_${TIMESTAMP}.XXXXXX.dump")
trap 'rm -f "$TEMP_FILE"' EXIT

echo "=== SignalPilot: PostgreSQL Backup ==="
echo "Database : $DB_NAME"
echo "User     : $DB_USER"
echo "Output   : $BACKUP_FILE"
echo ""

"${COMPOSE[@]}" exec -T postgres pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$TEMP_FILE"
test -s "$TEMP_FILE"
mv "$TEMP_FILE" "$BACKUP_FILE"
trap - EXIT

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "Backup saved: $BACKUP_FILE ($SIZE)"
