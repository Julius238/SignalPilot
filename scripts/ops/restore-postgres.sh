#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup-file>"
  echo "Example: $0 backups/signalpilot_20240101_120000.dump"
  echo ""
  echo "Available backups:"
  ls -lh backups/*.dump 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}' || echo "  (none found in backups/)"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Resolve DB config from the running container
DB_USER=$(${COMPOSE} exec -T postgres sh -c 'echo "$POSTGRES_USER"' 2>/dev/null | tr -d '\r') || true
DB_NAME=$(${COMPOSE} exec -T postgres sh -c 'echo "$POSTGRES_DB"' 2>/dev/null | tr -d '\r') || true
DB_USER="${DB_USER:-signalpilot}"
DB_NAME="${DB_NAME:-signalpilot}"

echo "=== SignalPilot: PostgreSQL Restore ==="
echo ""
echo "  Backup file : $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"
echo "  Database    : $DB_NAME"
echo "  User        : $DB_USER"
echo ""
echo "WARNING: ALL EXISTING DATA IN '$DB_NAME' WILL BE REPLACED."
echo "         Make a backup first if you haven't already."
echo ""
read -r -p "Type 'yes' to confirm restore: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

# Verify postgres is running
if ! ${COMPOSE} ps postgres | grep -q "running\|Up"; then
  echo "ERROR: postgres service is not running."
  exit 1
fi

echo ""
echo "Step 1/2: Terminating active connections and dropping existing objects..."

${COMPOSE} exec -T postgres psql -U "$DB_USER" -d postgres <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();
SQL

echo "Step 2/2: Restoring from backup..."

${COMPOSE} exec -T postgres \
  pg_restore -U "$DB_USER" -d "$DB_NAME" \
    --clean --if-exists --no-owner \
    < "$BACKUP_FILE"

echo ""
echo "Restore complete. Restart services if they were running:"
echo "  pnpm ops:prod:up"
