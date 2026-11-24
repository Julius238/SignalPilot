#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
# shellcheck source=./_worker-health.sh
source "$OPS_DIR/_worker-health.sh"
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

# "running" alone says nothing about a crash loop: Docker restarts the container
# within a second, so every probe sees it running.
check_no_crash_restart() {
  local service="$1" container_id problem=""
  container_id=$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)
  if [ -n "$container_id" ]; then problem=$(container_restart_problem "$service" "$container_id"); fi
  if [ -n "$problem" ]; then
    echo "  FAIL $problem"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS $service without crash restart in the last $WORKER_RESTART_WINDOW_MINUTES min"
    PASS=$((PASS + 1))
  fi
}

check_signal_analysis() {
  local problems line
  problems=$(signal_analysis_problems)
  if [ -z "$problems" ]; then
    echo "  PASS signal analysis"
    PASS=$((PASS + 1))
    return 0
  fi
  while IFS= read -r line; do
    echo "  FAIL $line"
    FAIL=$((FAIL + 1))
  done <<<"$problems"
}

echo "=== SignalPilot production health ($COMPOSE_PROJECT_NAME) ==="
check_healthy postgres
check_healthy redis
check_healthy api
check_healthy dashboard
check_running worker-scheduler
check_healthy trading-worker
check_no_crash_restart worker-scheduler
check_no_crash_restart trading-worker
check_no_crash_restart api
check_signal_analysis

echo "Summary: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
