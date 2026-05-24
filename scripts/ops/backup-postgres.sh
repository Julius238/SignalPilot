#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Resolve DB name and user from the running container's environment
DB_USER=$(${COMPOSE} exec -T postgres sh -c 'echo "$POSTGRES_USER"' 2>/dev/null | tr -d '\r') || true
DB_NAME=$(${COMPOSE} exec -T postgres sh -c 'echo "$POSTGRES_DB"' 2>/dev/null | tr -d '\r') || true

DB_USER="${DB_USER:-signalpilot}"
DB_NAME="${DB_NAME:-signalpilot}"

BACKUP_FILE="${BACKUP_DIR}/signalpilot_${TIMESTAMP}.dump"

# Verify postgres is running
if ! ${COMPOSE} ps postgres | grep -q "running\|Up"; then
  echo "ERROR: postgres service is not running."
  echo "       Start it first with: pnpm ops:prod:up"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "=== SignalPilot: PostgreSQL Backup ==="
echo "Database : $DB_NAME"
echo "User     : $DB_USER"
echo "Output   : $BACKUP_FILE"
echo ""

${COMPOSE} exec -T postgres \
  pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "Backup saved: $BACKUP_FILE ($SIZE)"
