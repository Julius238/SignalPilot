#!/usr/bin/env bash
set -euo pipefail

# Verify that @prisma/client is properly initialized in the api and
# worker-scheduler containers. This catches the "did not initialize yet"
# error without requiring a live database connection.

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env
PASS=0
FAIL=0

PRISMA_CHECK='const { PrismaClient } = require("@prisma/client"); console.log(typeof PrismaClient)'

check_prisma() {
  local service="$1"
  local result

  # Check the already-built runtime in the existing running service.
  result=$(
    compose_exec "$service" node -e "$PRISMA_CHECK" 2>&1
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
check_prisma "trading-worker"

echo ""
echo "─────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo "  All checks passed ($PASS/$((PASS + FAIL)))"
else
  echo "  $FAIL check(s) failed — rebuild images with: ./scripts/ops/prod-build.sh"
fi

[ "$FAIL" -eq 0 ]
