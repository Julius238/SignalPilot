#!/usr/bin/env bash
set -euo pipefail

# Takes one dump of the production database, verifies the archive in a
# throwaway container and writes its .sha256 sidecar. Rotation, the off-site
# copy and alerts live in backup.sh (`backup.sh nightly` calls this script).

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
# shellcheck source=./_backup.sh
source "$OPS_DIR/_backup.sh"
require_production_env
require_service_running postgres

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
TEMP_SUM="$TEMP_FILE.sha256"
trap 'rm -f "$TEMP_FILE" "$TEMP_SUM"' EXIT

echo "=== SignalPilot: PostgreSQL Backup ==="
echo "Database : $DB_NAME"
echo "User     : $DB_USER"
echo "Output   : $BACKUP_FILE"
echo ""

"${COMPOSE[@]}" exec -T postgres pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$TEMP_FILE"
test -s "$TEMP_FILE"

echo "Verifying the archive (throwaway container, no network)..."
if ! verify_archive "$TEMP_FILE"; then
  # Kept for diagnosis under a name the rotation never manages.
  mv "$TEMP_FILE" "$BACKUP_FILE.unverified"
  echo "ERROR: archive verification failed; kept as $BACKUP_FILE.unverified (no checksum, never rotated)." >&2
  exit 1
fi

# Dump first, then its checksum: until both are in place the backup counts as
# unmanaged, which the rotation never deletes.
write_checksum_sidecar "$TEMP_FILE" "${BACKUP_FILE##*/}" "$TEMP_SUM"
mv "$TEMP_FILE" "$BACKUP_FILE"
mv "$TEMP_SUM" "$BACKUP_FILE.sha256"
trap - EXIT
verify_checksum "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "Backup saved: $BACKUP_FILE ($SIZE)"
