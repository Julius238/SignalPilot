#!/usr/bin/env bash
set -euo pipefail

# Runs only an allowlisted, already-built research job in the existing
# worker-scheduler container. It never installs dependencies or invokes host
# pnpm, and it cannot accidentally start a second scheduler.
# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <worker-script-name> [job arguments]" >&2
  exit 1
fi

WORKER_SCRIPT="$1"
shift
COMMAND=(node)

case "$WORKER_SCRIPT" in
  worker:analyze-crypto-indicators) COMMAND+=(dist/jobs/analyzeCryptoIndicators.js) ;;
  worker:analyze-crypto-signals) COMMAND+=(dist/jobs/analyzeCryptoSignals.js) ;;
  worker:create-paper-evaluations) COMMAND+=(dist/jobs/paperSignalEvaluations.js create) ;;
  worker:evaluate-paper-signals) COMMAND+=(dist/jobs/paperSignalEvaluations.js evaluate) ;;
  worker:reclassify-paper-evaluations) COMMAND+=(dist/jobs/paperSignalEvaluations.js reclassify) ;;
  worker:backfill-paper-evaluations) COMMAND+=(dist/jobs/paperSignalEvaluations.js backfill) ;;
  worker:fetch-crypto-candles) COMMAND+=(dist/jobs/fetchCryptoCandles.js) ;;
  worker:quick-crypto-radar) COMMAND+=(dist/jobs/quickCryptoRadar.js) ;;
  worker:quick-equity-radar) COMMAND+=(dist/jobs/quickEquityRadar.js) ;;
  worker:radar-summary) COMMAND+=(dist/jobs/radarSummary.js) ;;
  worker:global-event-monitor) COMMAND+=(dist/jobs/globalEventMonitor.js) ;;
  worker:fetch-equity-candles) COMMAND+=(dist/jobs/fetchEquityCandles.js) ;;
  worker:fetch-equity-news) COMMAND+=(dist/jobs/fetchEquityNews.js) ;;
  worker:fetch-equity-events) COMMAND+=(dist/jobs/fetchEquityEvents.js) ;;
  worker:backfill-candles) COMMAND+=(dist/jobs/backfillCandleHistory.js) ;;
  worker:audit-candle-gaps) COMMAND+=(dist/jobs/auditCandleGaps.js) ;;
  worker:calculate-market-regime) COMMAND+=(dist/jobs/calculateMarketRegime.js) ;;
  worker:run-backtest) COMMAND+=(dist/jobs/runBacktest.js) ;;
  worker:run-strategy-comparison) COMMAND+=(dist/jobs/runStrategyComparison.js) ;;
  worker:analyze-equity-signals) COMMAND+=(dist/jobs/analyzeEquitySignals.js) ;;
  worker:run-equity-pipeline) COMMAND+=(dist/jobs/runEquitySignalPipeline.js) ;;
  worker:run-crypto-pipeline) COMMAND+=(dist/jobs/runCryptoSignalPipeline.js) ;;
  worker:discovery-refresh) COMMAND+=(dist/jobs/universeRefresh.js) ;;
  worker:discovery-scan) COMMAND+=(dist/jobs/discoveryScan.js) ;;
  worker:discovery-select) COMMAND+=(dist/jobs/selectActiveUniverse.js) ;;
  worker:discovery-reconcile) COMMAND+=(dist/jobs/reconcileActiveUniverse.js) ;;
  worker:discovery-run) COMMAND+=(dist/jobs/runAssetDiscoveryPipeline.js) ;;
  *)
    echo "ERROR: unsupported worker script: $WORKER_SCRIPT" >&2
    exit 1
    ;;
esac

echo "=== SignalPilot: one-time research job $WORKER_SCRIPT ==="
compose_exec worker-scheduler "${COMMAND[@]}" "$@"
