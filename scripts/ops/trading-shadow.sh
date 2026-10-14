#!/usr/bin/env bash
set -euo pipefail

# P9 operator entrypoint. Every application command runs in the already-built,
# running production containers. No host pnpm, dependency install, migration,
# session auto-activation, secret dump or .env.production rewrite occurs here.
# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/ops/trading-shadow.sh <command> [arguments]

Read-only:
  worker-health
  api-health
  scheduler-status
  status
  eligibility

Research (reads candles, writes only ShadowReplayRun results, no trading state):
  replay

Setup (never activates portfolio, assignment, kill switch or session):
  bootstrap

One-time jobs:
  job day-start|candidate|risk|order|fill|monitor|reconcile|performance|alerts|arena

24/7 operation (docs/trading/18-vps-24-7-shadow-runbook.md):
  preflight                                   # read-only: branch, flags, single trading worker, DB state
  monitor                                     # read-only health report (exit 1 on problems)
  watch                                       # for cron: alerts n8n directly only if the worker cannot
  alert-test                                  # sends exactly one harmless OPS_TEST alert through n8n
  consistency-snapshot <file>                 # restart test: state before
  consistency-compare <file>                  # restart test: verify nothing was lost or duplicated
  eligibility-for <portfolio-key>
  arena <arena-command> [--args]              # bootstrap-official-v1, evaluate, transition, export-dossier, ...

Official forward test (portfolio set OFFICIAL_V1):
  official-bootstrap OFFICIAL_BOOTSTRAP       # portfolios + strategy setup; activates nothing
  enable-strategy <portfolio-key> <strategy-key> <symbol> <actor> <idempotency-key> ENABLE_<STRATEGY>_<SYMBOL>_IN_<PORTFOLIO>
  portfolio-op <portfolio-key> activate-portfolio|release-kill-switch|activate-session|pause-session <actor> <idempotency-key> <OP>_<PORTFOLIO>
  portfolio-op <portfolio-key> engage-kill-switch <actor> <idempotency-key> ENGAGE_KILL_SWITCH_<PORTFOLIO> <reason-code>

Explicit state changes:
  calibrate-execution-profile CALIBRATE_EXECUTION_PROFILE   # new cost-profile version, see job header
  enable-assignment <assignment-id> <expected-version> <actor> <idempotency-key> <exact-confirmation>
  disable-assignment <assignment-id> <expected-version> <actor> <idempotency-key> <exact-confirmation>
  enable-btc-assignment <actor> <idempotency-key> ENABLE_BTCUSDT_ASSIGNMENT
  disable-btc-assignment <actor> <idempotency-key> DISABLE_BTCUSDT_ASSIGNMENT
  activate-portfolio <actor> <idempotency-key> ACTIVATE_SHADOW_V1
  release-kill-switch <actor> <idempotency-key> RELEASE_SHADOW_KILL_SWITCH
  activate-session <actor> <idempotency-key> ACTIVATE_SHADOW_SESSION
  pause-session <actor> <idempotency-key> PAUSE_SHADOW_SESSION
  engage-kill-switch <actor> <idempotency-key> <reason-code> ENGAGE_SHADOW_KILL_SWITCH
  unlock-session <actor> <idempotency-key> UNLOCK_CAUSE_RESOLVED
  manual-risk-close <position-id> <actor> <idempotency-key> <reason-note> MANUAL_RISK_CLOSE
  rollback-disabled <actor> <idempotency-prefix> ROLLBACK_SHADOW_DISABLED
USAGE
}

require_exact_args() {
  local expected="$1"
  shift
  if [ "$#" -ne "$expected" ]; then
    usage >&2
    exit 1
  fi
}

require_confirmation() {
  local actual="$1"
  local expected="$2"
  if [ "$actual" != "$expected" ]; then
    echo "ERROR: confirmation must be exactly $expected." >&2
    exit 1
  fi
}

query_scalar() {
  local sql="$1"
  compose_exec postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"' sh "$sql"
}

require_scalar() {
  local label="$1"
  local sql="$2"
  local value
  value=$(query_scalar "$sql")
  if [ -z "$value" ]; then
    echo "ERROR: could not resolve $label." >&2
    exit 1
  fi
  printf '%s' "$value"
}

portfolio_id() {
  require_scalar "Portfolio SHADOW_V1" 'SELECT "id" FROM "Portfolio" WHERE "key" = '\''SHADOW_V1'\'' AND "status" <> '\''ARCHIVED'\'';'
}

session_id() {
  require_scalar "open SHADOW_V1 TradingSession" 'SELECT s."id" FROM "TradingSession" s JOIN "Portfolio" p ON p."id" = s."portfolioId" WHERE p."key" = '\''SHADOW_V1'\'' AND s."status" <> '\''CLOSED'\'' ORDER BY s."createdAt" DESC LIMIT 1;'
}

btc_assignment_id() {
  require_scalar "BTCUSDT StrategyAssignment" 'SELECT a."id" FROM "StrategyAssignment" a JOIN "Portfolio" p ON p."id" = a."portfolioId" JOIN "Asset" x ON x."id" = a."assetId" JOIN "Strategy" s ON s."id" = a."strategyId" WHERE p."key" = '\''SHADOW_V1'\'' AND x."symbol" = '\''BTCUSDT'\'' AND s."key" = '\''CRYPTO_MTF_BREAKOUT_LONG_V1'\'' ORDER BY a."createdAt" ASC LIMIT 1;'
}

assignment_version() {
  local assignment_id="$1"
  require_scalar "StrategyAssignment version" "SELECT \"version\" FROM \"StrategyAssignment\" WHERE \"id\" = '$assignment_id';"
}

run_trading_node() {
  compose_exec trading-worker node "$@"
}

run_ops() {
  run_trading_node dist/jobs/shadowOps.js "$@"
}

worker_health() {
  require_service_running trading-worker
  local container_id
  local health
  container_id=$("${COMPOSE[@]}" ps -q trading-worker)
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  echo "trading-worker=$health"
  if [ "$health" != "healthy" ]; then
    exit 1
  fi
}

api_health() {
  compose_exec api node --input-type=module -e '
const expectedEnabled = process.env.TRADING_API_ENABLED === "true";
const checks = await Promise.all([
  fetch("http://127.0.0.1:3100/health").then((r) => ({ name: "api", status: r.status })),
  fetch("http://127.0.0.1:3100/trading/overview").then((r) => ({ name: "trading-read-route", status: r.status }))
]);
for (const check of checks) console.log(`${check.name}=${check.status}`);
if (checks[0].status !== 200) process.exit(1);
const tradingStatus = checks[1].status;
if (expectedEnabled ? ![401, 403].includes(tradingStatus) : tradingStatus !== 404) process.exit(1);
'
}

scheduler_status() {
  worker_health
  run_trading_node -e '
const keys = [
  "ENABLE_LIVE_TRADING", "PAPER_TRADING_ONLY", "TRADING_MODE", "TRADING_SHADOW_ENABLED",
  "TRADING_STRATEGY_V1_ENABLED", "TRADING_RISK_V1_ENABLED", "TRADING_BOOTSTRAP_ENABLED",
  "TRADING_STRATEGY_LONG_V1_ENABLED", "TRADING_STRATEGY_SHORT_V1_ENABLED",
  "TRADING_SHADOW_SHORT_ENABLED",
  "TRADING_SHADOW_EXECUTION_ENABLED", "TRADING_SHADOW_POSITION_MONITOR_ENABLED",
  "TRADING_SHADOW_RECONCILIATION_ENABLED", "TRADING_WORKER_ENABLED", "TRADING_SCHEDULER_ENABLED",
  "TRADING_DAY_START_JOB_ENABLED",
  "TRADING_CANDIDATE_JOB_ENABLED", "TRADING_RISK_JOB_ENABLED", "TRADING_ORDER_JOB_ENABLED",
  "TRADING_FILL_JOB_ENABLED", "TRADING_POSITION_MONITOR_JOB_ENABLED",
  "TRADING_RECONCILIATION_JOB_ENABLED", "TRADING_API_ENABLED", "TRADING_API_OPERATIONS_ENABLED",
  "NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED", "TRADING_PERFORMANCE_JOB_ENABLED",
  "TRADING_ALERT_OUTBOX_ENABLED", "TRADING_ALERT_DELIVERY_ENABLED", "TRADING_RETENTION_ENABLED",
  "TRADING_PERFORMANCE_SCHEDULE_ENABLED", "TRADING_ALERT_SCHEDULE_ENABLED", "TRADING_ARENA_ENABLED",
  "TRADING_ARENA_SCHEDULE_ENABLED", "TRADING_PORTFOLIO_SET", "TRADING_CODE_VERSION"
];
for (const key of keys) console.log(`${key}=${process.env[key] ?? "<unset>"}`);
'
  compose_exec postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "SELECT \"jobName\", \"status\", \"startedAt\", \"finishedAt\" FROM \"BotRun\" WHERE \"jobName\" IN ('\''shadowStartTradingDay'\'', '\''shadowGenerateCandidates'\'', '\''shadowAssessRisk'\'', '\''shadowCreateOrders'\'', '\''shadowProcessFills'\'', '\''shadowMonitorPositions'\'', '\''shadowReconcilePortfolio'\'') ORDER BY \"startedAt\" DESC LIMIT 20;"'
}

status_report() {
  compose_exec postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -x -c "
SELECT
  p.\"id\" AS portfolio_id, p.\"key\" AS portfolio_key, p.\"status\" AS portfolio_status,
  p.\"startingCash\" AS starting_cash, p.\"availableCash\" AS available_cash,
  p.\"reservedCash\" AS reserved_cash, p.\"realizedPnl\" AS realized_pnl,
  p.\"feesPaid\" AS fees_paid, p.\"equity\", p.\"highWaterMark\" AS high_water_mark,
  p.\"ledgerSequence\" AS ledger_sequence, p.\"lastReconciledAt\" AS portfolio_reconciled_at,
  ts.\"id\" AS session_id, ts.\"status\" AS session_status,
  ts.\"killSwitchEngaged\" AS kill_switch_engaged, ts.\"reconciledAt\" AS session_reconciled_at
FROM \"Portfolio\" p
LEFT JOIN LATERAL (
  SELECT * FROM \"TradingSession\" s
  WHERE s.\"portfolioId\" = p.\"id\" AND s.\"status\" <> '\''CLOSED'\''
  ORDER BY s.\"createdAt\" DESC LIMIT 1
) ts ON true
WHERE p.\"key\" = '\''SHADOW_V1'\'';

SELECT
  s.\"key\" AS strategy_key, s.\"status\" AS strategy_status,
  sv.\"id\" AS strategy_version_id, sv.\"version\", sv.\"status\" AS strategy_version_status,
  sv.\"engineVersion\", sv.\"codeVersion\", sv.\"specificationHash\",
  a.\"id\" AS assignment_id, x.\"symbol\", a.\"timeframe\",
  a.\"assignmentConfigJson\"->>'\''direction'\'' AS direction, a.\"enabled\"
FROM \"StrategyAssignment\" a
JOIN \"Strategy\" s ON s.\"id\" = a.\"strategyId\"
JOIN \"StrategyVersion\" sv ON sv.\"id\" = a.\"strategyVersionId\"
JOIN \"Asset\" x ON x.\"id\" = a.\"assetId\"
JOIN \"Portfolio\" p ON p.\"id\" = a.\"portfolioId\"
WHERE p.\"key\" = '\''SHADOW_V1'\''
ORDER BY x.\"symbol\", a.\"createdAt\";

SELECT p.\"key\" AS portfolio_key, x.\"symbol\", s.\"key\" AS strategy_key,
  a.\"id\" AS assignment_id, a.\"timeframe\", a.\"enabled\"
FROM \"StrategyAssignment\" a
JOIN \"Strategy\" s ON s.\"id\" = a.\"strategyId\"
JOIN \"Asset\" x ON x.\"id\" = a.\"assetId\"
JOIN \"Portfolio\" p ON p.\"id\" = a.\"portfolioId\"
WHERE a.\"enabled\" = true
ORDER BY p.\"key\", x.\"symbol\", a.\"createdAt\";

SELECT x.\"symbol\", ep.\"version\", ep.\"status\", ep.\"tickSize\", ep.\"stepSize\",
  ep.\"minQuantity\", ep.\"minNotional\", ep.\"feeBps\", ep.\"fullSpreadBps\",
  ep.\"slippageBps\", ep.\"maxParticipationRate\", ep.\"source\", ep.\"specificationHash\"
FROM \"InstrumentExecutionProfile\" ep
JOIN \"Asset\" x ON x.\"id\" = ep.\"assetId\"
WHERE x.\"symbol\" IN ('\''BTCUSDT'\'', '\''ETHUSDT'\'') AND ep.\"status\" = '\''ACTIVE'\''
ORDER BY x.\"symbol\";

SELECT '\''candidate'\'' AS entity, tc.\"status\"::text AS state, count(*) AS count
FROM \"TradeCandidate\" tc JOIN \"Portfolio\" p ON p.\"id\" = tc.\"portfolioId\"
WHERE p.\"key\" = '\''SHADOW_V1'\'' GROUP BY tc.\"status\"
UNION ALL
SELECT '\''order'\'', so.\"status\"::text, count(*)
FROM \"ShadowOrder\" so JOIN \"Portfolio\" p ON p.\"id\" = so.\"portfolioId\"
WHERE p.\"key\" = '\''SHADOW_V1'\'' GROUP BY so.\"status\"
UNION ALL
SELECT '\''position'\'', sp.\"status\"::text, count(*)
FROM \"ShadowPosition\" sp JOIN \"Portfolio\" p ON p.\"id\" = sp.\"portfolioId\"
WHERE p.\"key\" = '\''SHADOW_V1'\'' GROUP BY sp.\"status\"
UNION ALL
SELECT '\''fill'\'', sf.\"triggerType\"::text, count(*)
FROM \"ShadowFill\" sf JOIN \"ShadowOrder\" so ON so.\"id\" = sf.\"shadowOrderId\"
JOIN \"Portfolio\" p ON p.\"id\" = so.\"portfolioId\"
WHERE p.\"key\" = '\''SHADOW_V1'\'' GROUP BY sf.\"triggerType\"
UNION ALL
SELECT '\''ledger'\'', le.\"type\"::text, count(*)
FROM \"PortfolioLedgerEntry\" le JOIN \"Portfolio\" p ON p.\"id\" = le.\"portfolioId\"
WHERE p.\"key\" = '\''SHADOW_V1'\'' GROUP BY le.\"type\"
ORDER BY 1, 2;

SELECT tc.\"id\", tc.\"candidateKey\", x.\"symbol\", tc.\"direction\", tc.\"anchorCandleId\", tc.\"status\",
  tc.\"decisionTime\", tc.\"inputHash\", tc.\"createdAt\"
FROM \"TradeCandidate\" tc
JOIN \"Portfolio\" p ON p.\"id\" = tc.\"portfolioId\"
JOIN \"Asset\" x ON x.\"id\" = tc.\"assetId\"
WHERE p.\"key\" = '\''SHADOW_V1'\''
ORDER BY tc.\"createdAt\" DESC LIMIT 20;

SELECT so.\"id\", so.\"orderKey\", so.\"clientOrderId\", so.\"entryCandidateKey\",
  x.\"symbol\", so.\"direction\", so.\"side\", so.\"purpose\", so.\"status\", so.\"requestedQuantity\",
  so.\"filledQuantity\", so.\"remainingQuantity\", so.\"createdAt\"
FROM \"ShadowOrder\" so
JOIN \"Portfolio\" p ON p.\"id\" = so.\"portfolioId\"
JOIN \"Asset\" x ON x.\"id\" = so.\"assetId\"
WHERE p.\"key\" = '\''SHADOW_V1'\''
ORDER BY so.\"createdAt\" DESC LIMIT 20;

SELECT sf.\"id\", sf.\"fillKey\", sf.\"shadowOrderId\", x.\"symbol\", so.\"direction\", sf.\"side\", sf.\"sequence\",
  sf.\"triggerType\", sf.\"quantity\", sf.\"fillPrice\", sf.\"feeAmount\",
  sf.\"sourceCandleId\", sf.\"occurredAt\"
FROM \"ShadowFill\" sf
JOIN \"ShadowOrder\" so ON so.\"id\" = sf.\"shadowOrderId\"
JOIN \"Portfolio\" p ON p.\"id\" = so.\"portfolioId\"
JOIN \"Asset\" x ON x.\"id\" = sf.\"assetId\"
WHERE p.\"key\" = '\''SHADOW_V1'\''
ORDER BY sf.\"occurredAt\" DESC, sf.\"sequence\" DESC LIMIT 20;

SELECT sp.\"id\", sp.\"positionKey\", x.\"symbol\", sp.\"direction\", sp.\"status\", sp.\"initialQuantity\",
  sp.\"openQuantity\", sp.\"closedQuantity\", sp.\"stopPrice\", sp.\"takeProfitPrice\",
  sp.\"reservedCollateral\", sp.\"realizedPnl\", sp.\"feesPaid\",
  sp.\"activeExitPlanVersion\", sp.\"openedAt\", sp.\"closedAt\"
FROM \"ShadowPosition\" sp
JOIN \"Portfolio\" p ON p.\"id\" = sp.\"portfolioId\"
JOIN \"Asset\" x ON x.\"id\" = sp.\"assetId\"
WHERE p.\"key\" = '\''SHADOW_V1'\''
ORDER BY sp.\"createdAt\" DESC LIMIT 20;

SELECT re.\"severity\", re.\"reasonCode\", count(*) AS count,
  count(*) FILTER (WHERE re.\"acknowledgedAt\" IS NULL) AS unacknowledged
FROM \"RiskEvent\" re JOIN \"Portfolio\" p ON p.\"id\" = re.\"portfolioId\"
WHERE p.\"key\" = '\''SHADOW_V1'\'' GROUP BY re.\"severity\", re.\"reasonCode\"
ORDER BY re.\"severity\", re.\"reasonCode\";

SELECT \"status\", count(*) AS count, max(\"updatedAt\") AS last_updated_at
FROM \"TradingAlertOutbox\" GROUP BY \"status\" ORDER BY \"status\";

SELECT \"jobKey\", \"scopeKey\", \"claimedBy\", \"claimedAt\", \"claimExpiresAt\", \"lastProcessedAt\", \"version\"
FROM \"TradingJobCursor\" ORDER BY \"jobKey\", \"scopeKey\";
"'
}

# Runs a one-off node command in the trading-worker image with extra
# environment for exactly that command (e.g. the bootstrap gate). Never starts
# a scheduler: only the given script runs.
run_trading_node_env() {
  local env_args=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    env_args+=(-e "$1")
    shift
  done
  shift
  require_production_env
  require_service_running trading-worker
  "${COMPOSE[@]}" exec -T "${env_args[@]}" trading-worker node "$@"
}

# One-off container from the trading-worker image (works while the service is
# down); runs only the given script, never the scheduler.
run_trading_oneoff() {
  require_production_env
  "${COMPOSE[@]}" run --rm --no-deps -T trading-worker node "$@"
}

require_key() {
  local label="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[A-Z0-9_]{1,64}$ ]]; then
    echo "ERROR: $label must match ^[A-Z0-9_]+\$, got: $value" >&2
    exit 1
  fi
}

portfolio_id_for() {
  require_key "portfolio key" "$1"
  require_scalar "Portfolio $1" "SELECT \"id\" FROM \"Portfolio\" WHERE \"key\" = '$1' AND \"status\" <> 'ARCHIVED';"
}

session_id_for() {
  require_key "portfolio key" "$1"
  require_scalar "open TradingSession of $1" "SELECT s.\"id\" FROM \"TradingSession\" s JOIN \"Portfolio\" p ON p.\"id\" = s.\"portfolioId\" WHERE p.\"key\" = '$1' AND s.\"status\" <> 'CLOSED' ORDER BY s.\"createdAt\" DESC LIMIT 1;"
}

preflight() {
  echo "=== Repository ==="
  echo "branch=$(git rev-parse --abbrev-ref HEAD) commit=$(git rev-parse --short HEAD)"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "WARN: tracked files modified on this host"; fi
  echo ""
  echo "=== Trading workers on this host (all Compose projects) ==="
  local workers
  workers=$(docker ps --filter "label=com.docker.compose.service=trading-worker" --format '{{.Names}} project={{.Label "com.docker.compose.project"}} status={{.Status}}')
  printf '%s\n' "${workers:-none}"
  if [ "$(printf '%s' "$workers" | grep -c . || true)" -gt 1 ]; then
    echo "ERROR: more than one trading worker is running." >&2
    exit 1
  fi
  echo ""
  echo "=== Shadow flags in $ENV_FILE (booleans and modes only) ==="
  require_production_env
  grep -E '^(ENABLE_LIVE_TRADING|PAPER_TRADING_ONLY|TRADING_[A-Z0-9_]*(ENABLED|MODE|SET)|NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED)=' "$ENV_FILE" | sort || true
  echo ""
  echo "=== Database state ==="
  require_service_running postgres
  compose_exec postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "$1"' sh '
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) AS migrations_applied, max(migration_name) AS latest_migration FROM _prisma_migrations;
SELECT p.key, p.status, p."startingCash", p.equity, p."ledgerSequence",
  s.status AS session_status, s."killSwitchEngaged" AS kill_switch, s."startedAt" AS session_started_at
FROM "Portfolio" p
LEFT JOIN LATERAL (SELECT * FROM "TradingSession" t WHERE t."portfolioId" = p.id AND t.status <> '\''CLOSED'\'' ORDER BY t."createdAt" DESC LIMIT 1) s ON true
ORDER BY p."createdAt";
SELECT p.key AS portfolio, st.key AS strategy, x.symbol, sv.version, left(sv."specificationHash", 12) AS spec_hash
FROM "StrategyAssignment" a JOIN "Portfolio" p ON p.id = a."portfolioId" JOIN "Strategy" st ON st.id = a."strategyId"
JOIN "StrategyVersion" sv ON sv.id = a."strategyVersionId" JOIN "Asset" x ON x.id = a."assetId"
WHERE a.enabled ORDER BY p.key, st.key;
SELECT x.symbol, ep.version, ep."feeBps", ep."fullSpreadBps", ep."slippageBps", ep.source, left(ep."specificationHash", 12) AS spec_hash
FROM "InstrumentExecutionProfile" ep JOIN "Asset" x ON x.id = ep."assetId" WHERE ep.status = '\''ACTIVE'\'' AND x.symbol IN ('\''BTCUSDT'\'', '\''ETHUSDT'\'');
SELECT symbol, max("closeTime") AS latest_1h_close, max(source) AS source FROM "Candle" WHERE timeframe = '\''1h'\'' AND symbol IN ('\''BTCUSDT'\'', '\''ETHUSDT'\'') GROUP BY symbol;
'
  echo "Arena cohorts (if the arena migration is applied):"
  query_scalar 'SELECT string_agg(key || '\''='\'' || phase, '\'', '\'') FROM "ArenaCohort";' 2>/dev/null || echo "  none / not migrated"
}

container_problems() {
  local service container_id health
  for service in postgres worker-scheduler trading-worker api dashboard; do
    container_id=$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)
    if [ -z "$container_id" ]; then
      echo "CONTAINER_DOWN: $service"
      continue
    fi
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
    if [ "$health" != "healthy" ] && [ "$health" != "running" ]; then
      echo "CONTAINER_UNHEALTHY: $service=$health"
    fi
  done
}

ops_watch() {
  require_production_env
  local state_dir="${SIGNALPILOT_OPS_STATE_DIR:-/var/lib/signalpilot}"
  mkdir -p "$state_dir"
  local args=(--alert --state-file=/state/ops-watch.json)
  local problem
  while IFS= read -r problem; do
    if [ -n "$problem" ]; then args+=("--container-problem=$problem"); fi
  done <<<"$(container_problems)"
  "${COMPOSE[@]}" run --rm --no-deps -T -v "$state_dir:/state" trading-worker node dist/jobs/opsWatch.js "${args[@]}"
}

run_job() {
  local job="$1"
  local target
  case "$job" in
    day-start) target=dist/jobs/shadowStartTradingDay.js ;;
    candidate) target=dist/jobs/shadowGenerateCandidates.js ;;
    risk) target=dist/jobs/shadowAssessRisk.js ;;
    order) target=dist/jobs/shadowCreateOrders.js ;;
    fill) target=dist/jobs/shadowProcessFills.js ;;
    monitor) target=dist/jobs/shadowMonitorPositions.js ;;
    reconcile) target=dist/jobs/shadowReconcilePortfolio.js ;;
    performance) target=dist/jobs/shadowPerformanceRefresh.js ;;
    alerts) target=dist/jobs/shadowAlertOutbox.js ;;
    arena) target=dist/jobs/arenaEvaluate.js ;;
    *)
      echo "ERROR: unsupported one-time trading job: $job" >&2
      exit 1
      ;;
  esac
  run_trading_node "$target"
}

command_name="${1:-help}"
if [ "$#" -gt 0 ]; then shift; fi

case "$command_name" in
  help|-h|--help)
    require_exact_args 0 "$@"
    usage
    ;;
  worker-health)
    require_exact_args 0 "$@"
    worker_health
    ;;
  api-health)
    require_exact_args 0 "$@"
    api_health
    ;;
  scheduler-status)
    require_exact_args 0 "$@"
    scheduler_status
    ;;
  status)
    require_exact_args 0 "$@"
    status_report
    ;;
  eligibility)
    require_exact_args 0 "$@"
    run_trading_node dist/jobs/shadowEligibilityReport.js
    ;;
  replay)
    require_exact_args 0 "$@"
    run_trading_node dist/jobs/shadowReplay.js
    ;;
  calibrate-execution-profile)
    require_exact_args 1 "$@"
    require_confirmation "$1" CALIBRATE_EXECUTION_PROFILE
    # The gate flag only for this explicitly confirmed one-off command.
    run_trading_node_env TRADING_BOOTSTRAP_ENABLED=true -- dist/jobs/shadowExecutionProfileCalibrate.js --confirm=CALIBRATE_EXECUTION_PROFILE
    ;;
  preflight)
    require_exact_args 0 "$@"
    preflight
    ;;
  monitor)
    require_exact_args 0 "$@"
    if [ -n "$("${COMPOSE[@]}" ps --status running -q trading-worker 2>/dev/null)" ]; then
      run_trading_node dist/jobs/opsWatch.js
    else
      run_trading_oneoff dist/jobs/opsWatch.js "--container-problem=CONTAINER_DOWN: trading-worker"
    fi
    ;;
  watch)
    require_exact_args 0 "$@"
    ops_watch
    ;;
  alert-test)
    require_exact_args 0 "$@"
    run_trading_node dist/jobs/shadowAlertOutbox.js --test-event
    ;;
  consistency-snapshot)
    require_exact_args 1 "$@"
    run_trading_node dist/jobs/opsConsistency.js snapshot >"$1"
    echo "snapshot written to $1"
    ;;
  consistency-compare)
    require_exact_args 1 "$@"
    require_production_env
    require_service_running trading-worker
    "${COMPOSE[@]}" exec -T trading-worker node dist/jobs/opsConsistency.js compare --before=- <"$1"
    ;;
  eligibility-for)
    require_exact_args 1 "$@"
    require_key "portfolio key" "$1"
    run_trading_node dist/jobs/shadowEligibilityReport.js "--portfolio=$1"
    ;;
  arena)
    if [ "$#" -lt 1 ]; then
      usage >&2
      exit 1
    fi
    run_trading_node dist/jobs/arenaOps.js "$@"
    ;;
  official-bootstrap)
    require_exact_args 1 "$@"
    require_confirmation "$1" OFFICIAL_BOOTSTRAP
    # Creates disabled structures only: the legacy home SHADOW_V1 (if missing),
    # the two official portfolios (DRAFT, stopped session, kill switch on) and
    # the strategy setup with every forward-tested strategy in its own official
    # portfolio. Activates nothing.
    run_trading_node_env TRADING_BOOTSTRAP_ENABLED=true -- dist/jobs/shadowBootstrap.js
    run_trading_node_env TRADING_BOOTSTRAP_ENABLED=true -- dist/jobs/shadowBootstrap.js --portfolio=OFFICIAL_TREND_CORE_LONG_V1
    run_trading_node_env TRADING_BOOTSTRAP_ENABLED=true -- dist/jobs/shadowBootstrap.js --portfolio=OFFICIAL_REGIME_LONG_V1
    run_trading_node_env TRADING_BOOTSTRAP_ENABLED=true TRADING_PORTFOLIO_SET=OFFICIAL_V1 -- dist/jobs/shadowStrategySetup.js
    ;;
  enable-strategy)
    require_exact_args 6 "$@"
    require_key "portfolio key" "$1"
    require_key "strategy key" "$2"
    require_key "symbol" "$3"
    require_confirmation "$6" "ENABLE_$2_$3_IN_$1"
    strategy_row=$(require_scalar "assignment $2/$3 in $1" "SELECT a.\"id\" || '|' || a.\"version\" || '|' || (a.\"assignmentConfigJson\"->>'direction') FROM \"StrategyAssignment\" a JOIN \"Portfolio\" p ON p.\"id\" = a.\"portfolioId\" JOIN \"Strategy\" s ON s.\"id\" = a.\"strategyId\" JOIN \"Asset\" x ON x.\"id\" = a.\"assetId\" WHERE p.\"key\" = '$1' AND s.\"key\" = '$2' AND x.\"symbol\" = '$3' ORDER BY a.\"createdAt\" ASC LIMIT 1;")
    IFS='|' read -r strategy_assignment_id strategy_assignment_version strategy_direction <<<"$strategy_row"
    run_ops enable-assignment --assignment-id="$strategy_assignment_id" --actor="$4" --idempotency-key="$5" --expected-version="$strategy_assignment_version" --confirmation="ENABLE_$3_${strategy_direction}_$2_V${strategy_assignment_version}"
    ;;
  portfolio-op)
    if [ "$#" -lt 5 ]; then
      usage >&2
      exit 1
    fi
    target_key="$1"
    operation="$2"
    require_key "portfolio key" "$target_key"
    case "$operation" in
      activate-portfolio)
        require_exact_args 5 "$@"
        require_confirmation "$5" "ACTIVATE_PORTFOLIO_$target_key"
        run_ops activate-portfolio --portfolio-id="$(portfolio_id_for "$target_key")" --actor="$3" --idempotency-key="$4"
        ;;
      release-kill-switch)
        require_exact_args 5 "$@"
        require_confirmation "$5" "RELEASE_KILL_SWITCH_$target_key"
        run_ops release-kill-switch --session-id="$(session_id_for "$target_key")" --actor="$3" --idempotency-key="$4"
        ;;
      activate-session)
        require_exact_args 5 "$@"
        require_confirmation "$5" "ACTIVATE_SESSION_$target_key"
        run_ops activate-session --session-id="$(session_id_for "$target_key")" --actor="$3" --idempotency-key="$4"
        ;;
      pause-session)
        require_exact_args 5 "$@"
        require_confirmation "$5" "PAUSE_SESSION_$target_key"
        run_ops pause-session --session-id="$(session_id_for "$target_key")" --actor="$3" --idempotency-key="$4"
        ;;
      engage-kill-switch)
        require_exact_args 6 "$@"
        require_confirmation "$5" "ENGAGE_KILL_SWITCH_$target_key"
        run_ops engage-kill-switch --session-id="$(session_id_for "$target_key")" --actor="$3" --idempotency-key="$4" --reason="$6"
        ;;
      *)
        echo "ERROR: unknown portfolio operation: $operation" >&2
        exit 1
        ;;
    esac
    ;;
  bootstrap)
    require_exact_args 0 "$@"
    run_trading_node dist/jobs/shadowBootstrap.js
    run_trading_node dist/jobs/shadowStrategySetup.js
    ;;
  job)
    require_exact_args 1 "$@"
    run_job "$1"
    ;;
  enable-btc-assignment)
    require_exact_args 3 "$@"
    require_confirmation "$3" ENABLE_BTCUSDT_ASSIGNMENT
    btc_long_assignment_id=$(btc_assignment_id)
    btc_long_assignment_version=$(assignment_version "$btc_long_assignment_id")
    run_ops enable-btc-assignment --assignment-id="$btc_long_assignment_id" --actor="$1" --idempotency-key="$2" --expected-version="$btc_long_assignment_version" --confirmation="ENABLE_BTCUSDT_LONG_CRYPTO_MTF_BREAKOUT_LONG_V1_V${btc_long_assignment_version}"
    ;;
  disable-btc-assignment)
    require_exact_args 3 "$@"
    require_confirmation "$3" DISABLE_BTCUSDT_ASSIGNMENT
    btc_long_assignment_id=$(btc_assignment_id)
    btc_long_assignment_version=$(assignment_version "$btc_long_assignment_id")
    run_ops disable-btc-assignment --assignment-id="$btc_long_assignment_id" --actor="$1" --idempotency-key="$2" --expected-version="$btc_long_assignment_version" --confirmation="DISABLE_BTCUSDT_LONG_CRYPTO_MTF_BREAKOUT_LONG_V1_V${btc_long_assignment_version}"
    ;;
  enable-assignment)
    require_exact_args 5 "$@"
    run_ops enable-assignment --assignment-id="$1" --expected-version="$2" --actor="$3" --idempotency-key="$4" --confirmation="$5"
    ;;
  disable-assignment)
    require_exact_args 5 "$@"
    run_ops disable-assignment --assignment-id="$1" --expected-version="$2" --actor="$3" --idempotency-key="$4" --confirmation="$5"
    ;;
  activate-portfolio)
    require_exact_args 3 "$@"
    require_confirmation "$3" ACTIVATE_SHADOW_V1
    run_ops activate-portfolio --portfolio-id="$(portfolio_id)" --actor="$1" --idempotency-key="$2"
    ;;
  release-kill-switch)
    require_exact_args 3 "$@"
    require_confirmation "$3" RELEASE_SHADOW_KILL_SWITCH
    run_ops release-kill-switch --session-id="$(session_id)" --actor="$1" --idempotency-key="$2"
    ;;
  activate-session)
    require_exact_args 3 "$@"
    require_confirmation "$3" ACTIVATE_SHADOW_SESSION
    run_ops activate-session --session-id="$(session_id)" --actor="$1" --idempotency-key="$2"
    ;;
  pause-session)
    require_exact_args 3 "$@"
    require_confirmation "$3" PAUSE_SHADOW_SESSION
    run_ops pause-session --session-id="$(session_id)" --actor="$1" --idempotency-key="$2"
    ;;
  engage-kill-switch)
    require_exact_args 4 "$@"
    require_confirmation "$4" ENGAGE_SHADOW_KILL_SWITCH
    run_ops engage-kill-switch --session-id="$(session_id)" --actor="$1" --idempotency-key="$2" --reason="$3"
    ;;
  unlock-session)
    require_exact_args 3 "$@"
    require_confirmation "$3" UNLOCK_CAUSE_RESOLVED
    run_ops unlock-session --session-id="$(session_id)" --actor="$1" --idempotency-key="$2" --confirm-cause-resolved
    ;;
  manual-risk-close)
    require_exact_args 5 "$@"
    require_confirmation "$5" MANUAL_RISK_CLOSE
    run_ops manual-risk-close --position-id="$1" --actor="$2" --idempotency-key="$3" --reason-note="$4"
    ;;
  rollback-disabled)
    require_exact_args 3 "$@"
    require_confirmation "$3" ROLLBACK_SHADOW_DISABLED
    current_session_id=$(session_id)
    run_ops engage-kill-switch --session-id="$current_session_id" --actor="$1" --idempotency-key="$2-kill" --reason=P9_ROLLBACK
    current_status=$(query_scalar "SELECT \"status\" FROM \"TradingSession\" WHERE \"id\" = '$current_session_id';")
    if [ "$current_status" = "SHADOW_ACTIVE" ]; then
      run_ops pause-session --session-id="$current_session_id" --actor="$1" --idempotency-key="$2-pause"
    fi
    # Einfache Anführungszeichen müssen im äußeren '...'-String als '\'' geschrieben
    # werden. Die Form '''x''' schließt den String, hängt ein leeres Paar an und lässt
    # x unquotiert — aus '''direction''' wurde so ->>direction (ungültiges SQL).
    enabled_assignment_rows=$(query_scalar 'SELECT a."id" || '\''|'\'' || a."version" || '\''|'\'' || x."symbol" || '\''|'\'' || (a."assignmentConfigJson"->>'\''direction'\'') || '\''|'\'' || s."key" FROM "StrategyAssignment" a JOIN "Portfolio" p ON p."id" = a."portfolioId" JOIN "Asset" x ON x."id" = a."assetId" JOIN "Strategy" s ON s."id" = a."strategyId" WHERE p."key" = '\''SHADOW_V1'\'' AND a."enabled" = true ORDER BY x."symbol", s."key";')
    while IFS='|' read -r assignment_id current_version symbol direction strategy_key; do
      if [ -z "$assignment_id" ]; then continue; fi
      run_ops disable-assignment --assignment-id="$assignment_id" --actor="$1" --idempotency-key="$2-assignment-$assignment_id" --expected-version="$current_version" --confirmation="DISABLE_${symbol}_${direction}_${strategy_key}_V${current_version}"
    done <<<"$enabled_assignment_rows"
    echo "Rollback DB gates applied. Keep monitoring open positions; disable scheduler flags and recreate only after review."
    ;;
  *)
    echo "ERROR: unknown command: $command_name" >&2
    usage >&2
    exit 1
    ;;
esac
