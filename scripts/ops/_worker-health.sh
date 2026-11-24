#!/usr/bin/env bash

# Crash restarts and failing signal analysis. Sourced by healthcheck.sh and
# trading-shadow.sh after _common.sh; not an executable operation by itself.
# Read-only: docker inspect and one SELECT.
#
# Why this exists (2026-11-20 to 2026-11-24): the data worker died of heap
# exhaustion every 15 to 30 minutes. `restart: unless-stopped` brought it back
# within a second, so "is the container running" was always true, and the jobs
# that were watched (candles, regime) finished before the crash. Nothing alerted.

# A container that crash-restarted within this window is reported.
readonly WORKER_RESTART_WINDOW_MINUTES="${SIGNALPILOT_RESTART_WINDOW_MINUTES:-60}"
# Signal analysis: more than one missed full hour means 1h signals are missing.
readonly SIGNAL_ANALYSIS_MAX_AGE_MINUTES="${SIGNALPILOT_SIGNAL_ANALYSIS_MAX_AGE_MINUTES:-75}"
# Unfinished runs within two hours that are tolerated (one restart or deploy).
readonly SIGNAL_ANALYSIS_MAX_ABORTED="${SIGNALPILOT_SIGNAL_ANALYSIS_MAX_ABORTED:-1}"

# GNU date (VPS, CI) or BSD date (macOS).
iso_minutes_ago() {
  date -u -d "-$1 minutes" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -v-"$1"M +%Y-%m-%dT%H:%M:%S
}

# Prints a problem line when Docker restarted the service after a crash within
# the window. RestartCount counts only restarts by the restart policy: a deploy
# creates a new container (0) and `docker restart` does not increase it.
container_restart_problem() {
  local service="$1" container_id="$2" state restarts started cutoff
  state=$(docker inspect --format '{{.RestartCount}} {{.State.StartedAt}}' "$container_id" 2>/dev/null || true)
  restarts="${state%% *}"
  started="${state#* }"
  if ! [[ "$restarts" =~ ^[0-9]+$ ]] || [ "$restarts" -eq 0 ]; then return 0; fi
  cutoff=$(iso_minutes_ago "$WORKER_RESTART_WINDOW_MINUTES")
  # Both are UTC in ISO format, so text order is time order.
  if [[ "${started%%.*}" > "$cutoff" ]]; then
    echo "CONTAINER_CRASH_RESTART: $service restarted by Docker, $restarts crash restarts in total, last start ${started%%.*}Z"
  fi
}

# One row: runs in 2 h (without the last 10 min) | of these unfinished or failed | minutes since the last success (-1: never).
signal_analysis_sql() {
  cat <<'SQL'
WITH clock AS (SELECT (now() AT TIME ZONE 'UTC') AS t)
SELECT
  (SELECT count(*) FROM "BotRun" b, clock WHERE b."jobName" = 'analyzeCryptoSignals'
     AND b."startedAt" > clock.t - interval '2 hours' AND b."startedAt" <= clock.t - interval '10 minutes'),
  (SELECT count(*) FROM "BotRun" b, clock WHERE b."jobName" = 'analyzeCryptoSignals' AND b."status" <> 'SUCCESS'
     AND b."startedAt" > clock.t - interval '2 hours' AND b."startedAt" <= clock.t - interval '10 minutes'),
  COALESCE((SELECT floor(extract(epoch FROM clock.t - max(b."startedAt")) / 60)::int FROM "BotRun" b, clock
     WHERE b."jobName" = 'analyzeCryptoSignals' AND b."status" = 'SUCCESS' AND b."startedAt" <= clock.t GROUP BY clock.t), -1);
SQL
}

# Prints problem lines for the parsed row "runs|aborted|minutes since success".
signal_analysis_problems_from_row() {
  local runs aborted age
  IFS='|' read -r runs aborted age <<<"$1"
  if ! [[ "$runs" =~ ^[0-9]+$ && "$aborted" =~ ^[0-9]+$ && "$age" =~ ^-?[0-9]+$ ]]; then
    echo "SIGNAL_ANALYSIS_UNKNOWN: the signal analysis status could not be read"
    return 0
  fi
  if [ "$aborted" -gt "$SIGNAL_ANALYSIS_MAX_ABORTED" ]; then
    echo "SIGNAL_ANALYSIS_ABORTED: $aborted of $runs analyzeCryptoSignals runs in the last 2 h did not finish successfully"
  fi
  if [ "$age" -lt 0 ]; then
    echo "SIGNAL_ANALYSIS_STALE: analyzeCryptoSignals never succeeded"
  elif [ "$age" -gt "$SIGNAL_ANALYSIS_MAX_AGE_MINUTES" ]; then
    echo "SIGNAL_ANALYSIS_STALE: last successful analyzeCryptoSignals run $age min ago (limit $SIGNAL_ANALYSIS_MAX_AGE_MINUTES min)"
  fi
}

signal_analysis_problems() {
  local row
  row=$("${COMPOSE[@]}" exec -T postgres sh -c \
    'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"' sh "$(signal_analysis_sql)" 2>/dev/null || true)
  signal_analysis_problems_from_row "$row"
}
