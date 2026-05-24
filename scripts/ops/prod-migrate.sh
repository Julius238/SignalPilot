#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f ".env.production" ]; then
  echo "ERROR: .env.production not found."
  exit 1
fi

echo "=== SignalPilot: Running database migrations ==="
echo ""
echo "Target: prisma migrate deploy (production-safe, no schema drift allowed)"
echo ""

$COMPOSE --profile migration run --rm migrate

echo ""
echo "Migrations complete."
