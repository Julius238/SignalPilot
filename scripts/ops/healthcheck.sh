#!/usr/bin/env bash

COMPOSE="docker compose -f docker-compose.prod.yml"
API_URL="${SIGNALPILOT_API_URL:-http://localhost:3100}"
DASH_URL="${SIGNALPILOT_DASHBOARD_URL:-http://localhost:3000}"

PASS=0
FAIL=0

check_container() {
  local name="$1"
  local service="$2"
  local state
  state=$($COMPOSE ps --status running -q "$service" 2>/dev/null)
  if [ -n "$state" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name (not running)"
    FAIL=$((FAIL + 1))
  fi
}

check_http() {
  local name="$1"
  local url="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo "  ✓ $name ($url)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name — HTTP ${code:-timeout} ($url)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== SignalPilot Health Check ==="
echo ""

echo "Docker services:"
check_container "postgres" "postgres"
check_container "redis" "redis"
check_container "api" "api"
check_container "dashboard" "dashboard"
check_container "worker-scheduler" "worker-scheduler"
echo ""

echo "HTTP endpoints:"
check_http "API /health" "$API_URL/health"
check_http "Dashboard" "$DASH_URL"
echo ""

echo "─────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo "  All checks passed ($PASS/$((PASS + FAIL)))"
else
  echo "  $FAIL check(s) failed ($PASS/$((PASS + FAIL)) passed)"
fi
echo ""
echo "For detailed API health (requires auth):"
echo "  curl -b 'signalpilot_session=<token>' $API_URL/health/deep"

[ "$FAIL" -eq 0 ]
