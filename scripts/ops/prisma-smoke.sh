#!/usr/bin/env bash
set -euo pipefail

# Verify that @prisma/client is properly initialized in the api and
# worker-scheduler containers. This catches the "did not initialize yet"
# error without requiring a live database connection.

COMPOSE="docker compose -f docker-compose.prod.yml"
PASS=0
FAIL=0

PRISMA_CHECK='const { PrismaClient } = require("@prisma/client"); console.log(typeof PrismaClient)'

check_prisma() {
  local service="$1"
  local result

  # Run the check in a one-off container so services do not need to be running.
  result=$(
    $COMPOSE run --rm --no-deps \
      --entrypoint "" \
      "$service" \
      node -e "$PRISMA_CHECK" 2>&1
  )

  if echo "$result" | grep -q "^function"; then
    echo "  ✓ $service: PrismaClient is typeof function"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $service: unexpected output — $result"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== SignalPilot Prisma Smoke Test ==="
echo "Checking @prisma/client initialisation in containers..."
echo ""

check_prisma "api"
check_prisma "worker-scheduler"

echo ""
echo "─────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo "  All checks passed ($PASS/$((PASS + FAIL)))"
else
  echo "  $FAIL check(s) failed — rebuild images with: pnpm ops:prod:build"
fi

[ "$FAIL" -eq 0 ]
