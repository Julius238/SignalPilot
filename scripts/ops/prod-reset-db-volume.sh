#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

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
echo "║  If you have data to keep: run pnpm ops:prod:backup FIRST.      ║"
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
$COMPOSE down --remove-orphans 2>/dev/null || true

# ── Find the postgres data volume ────────────────────────────────────────────
# Docker Compose names volumes as: <project-name>_<volume-name>
# The project name defaults to the directory name.
COMPOSE_PROJECT=$(
  # Try to get it from Docker Compose's own output
  $COMPOSE config 2>/dev/null \
    | grep -E "^name:" \
    | awk '{print $2}' \
    || basename "$(pwd)"
)

VOLUME_NAME="${COMPOSE_PROJECT}_postgres_data"

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
echo "       pnpm ops:prod:migrate"
echo ""
echo "  2. Start all services:"
echo "       pnpm ops:prod:up"
echo ""
echo "  3. If you have a backup to restore:"
echo "       pnpm ops:prod:restore <backup-file>"
