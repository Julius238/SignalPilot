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

Setup (never activates portfolio, assignment, kill switch or session):
  bootstrap

One-time jobs:
  job day-start|candidate|risk|order|fill|monitor|reconcile|performance|alerts

Explicit state changes:
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
  require_scalar "BTCUSDT StrategyAssignment" 'SELECT a."id" FROM "StrategyAssignment" a JOIN "Portfolio" p ON p."id" = a."portfolioId" JOIN "Asset" x ON x."id" = a."assetId" JOIN "Strategy" s ON s."id" = a."strategyId" WHERE p."key" = '\''SHADOW_V1'\'' AND x."symbol" = '\''BTCUSDT'\'' AND s."key" = '\''CRYPTO_MTF_BREAKOUT_V1'\'' ORDER BY a."createdAt" ASC LIMIT 1;'
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
  "TRADING_ALERT_OUTBOX_ENABLED", "TRADING_ALERT_DELIVERY_ENABLED", "TRADING_RETENTION_ENABLED"
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
  a.\"assignmentConfigJson\"->>'direction' AS direction, a.\"enabled\"
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
    legacy_assignment_id=$(btc_assignment_id)
    legacy_assignment_version=$(assignment_version "$legacy_assignment_id")
    run_ops enable-btc-assignment --assignment-id="$legacy_assignment_id" --actor="$1" --idempotency-key="$2" --expected-version="$legacy_assignment_version" --confirmation="ENABLE_BTCUSDT_LONG_CRYPTO_MTF_BREAKOUT_V1_V${legacy_assignment_version}"
    ;;
  disable-btc-assignment)
    require_exact_args 3 "$@"
    require_confirmation "$3" DISABLE_BTCUSDT_ASSIGNMENT
    legacy_assignment_id=$(btc_assignment_id)
    legacy_assignment_version=$(assignment_version "$legacy_assignment_id")
    run_ops disable-btc-assignment --assignment-id="$legacy_assignment_id" --actor="$1" --idempotency-key="$2" --expected-version="$legacy_assignment_version" --confirmation="DISABLE_BTCUSDT_LONG_CRYPTO_MTF_BREAKOUT_V1_V${legacy_assignment_version}"
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
    enabled_assignment_rows=$(query_scalar 'SELECT a."id" || '''|''' || a."version" || '''|''' || x."symbol" || '''|''' || (a."assignmentConfigJson"->>'''direction''') || '''|''' || s."key" FROM "StrategyAssignment" a JOIN "Portfolio" p ON p."id" = a."portfolioId" JOIN "Asset" x ON x."id" = a."assetId" JOIN "Strategy" s ON s."id" = a."strategyId" WHERE p."key" = '''SHADOW_V1''' AND a."enabled" = true ORDER BY x."symbol", s."key";')
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
