#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env

PASS=0
FAIL=0

check_running() {
  local service="$1"
  if [ -n "$("${COMPOSE[@]}" ps --status running -q "$service" 2>/dev/null)" ]; then
    echo "  PASS $service running"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $service not running"
    FAIL=$((FAIL + 1))
  fi
}

check_healthy() {
  local service="$1"
  local container_id
  local health
  container_id=$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)
  health=""
  if [ -n "$container_id" ]; then
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
  fi
  if [ "$health" = "healthy" ] || [ "$health" = "running" ]; then
    echo "  PASS $service $health"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $service ${health:-missing}"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== SignalPilot production health ($COMPOSE_PROJECT_NAME) ==="
check_healthy postgres
check_healthy redis
check_healthy api
check_healthy dashboard
check_running worker-scheduler
check_healthy trading-worker

echo "Summary: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
