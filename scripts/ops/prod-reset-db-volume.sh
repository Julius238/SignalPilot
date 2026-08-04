#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║          SIGNALPILOT — POSTGRES VOLUME RESET                    ║"
echo "║                                                                  ║"
echo "║  This deletes the production Postgres Docker volume and         ║"
echo "║  ALL data stored in it. This cannot be undone.                  ║"
echo "║                                                                  ║"
echo "║  Only use this when:                                            ║"
echo "║    • The volume has no data worth keeping, AND                  ║"
echo "║    • Credentials drifted (volume was initialised with a         ║"
echo "║      different POSTGRES_PASSWORD than .env.production).         ║"
echo "║                                                                  ║"
echo "║  If data matters: run scripts/ops/backup-postgres.sh FIRST.    ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

read -r -p "Type RESET_SIGNALPILOT_PROD_DB to continue (anything else cancels): " CONFIRM
echo ""

if [ "$CONFIRM" != "RESET_SIGNALPILOT_PROD_DB" ]; then
  echo "Reset cancelled. Nothing was changed."
  exit 0
fi

# ── Stop all services ────────────────────────────────────────────────────────
echo "Step 1/3: Stopping all production services..."
"${COMPOSE[@]}" down --remove-orphans 2>/dev/null || true

# ── Find the postgres data volume ────────────────────────────────────────────
# Docker Compose names volumes as: <project-name>_<volume-name>
# The project name defaults to the directory name.
VOLUME_NAME="${COMPOSE_PROJECT_NAME}_postgres_data"

echo "Step 2/3: Removing volume: $VOLUME_NAME"

if docker volume inspect "$VOLUME_NAME" &>/dev/null; then
  docker volume rm "$VOLUME_NAME"
  echo "  → Volume removed."
else
  echo "  → Volume '$VOLUME_NAME' not found — nothing to remove."
  echo ""
  echo "  If the volume has a different name, list all volumes with:"
  echo "    docker volume ls | grep postgres"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "Step 3/3: Done."
echo ""
echo "Next steps:"
echo "  1. Run migrations (this re-initialises the database):"
echo "       ./scripts/ops/prod-migrate-docker.sh"
echo ""
echo "  2. Start all services:"
echo "       ./scripts/ops/prod-up.sh"
echo ""
echo "  3. If you have a backup to restore:"
echo "       ./scripts/ops/restore-postgres.sh <backup-file>"
