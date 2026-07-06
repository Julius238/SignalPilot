#!/usr/bin/env bash
set -euo pipefail

cat <<'CRON'
# Example SignalPilot production crontab.
# This script only prints the snippet. It does not install or overwrite crontab.
#
# NOTE: The periodic jobs (Crypto Pipeline, Equity Pipeline, Quick Crypto Radar,
# Radar Summary) run INSIDE the always-on worker-scheduler container and are
# configured via .env.production (CRYPTO_PIPELINE_CRON, EQUITY_PIPELINE_CRON,
# QUICK_RADAR_CRON, RADAR_SUMMARY_CRON). Do not add crontab entries for them —
# that would run them twice. Remove any old entries for:
#   worker:quick-crypto-radar, worker:run-crypto-pipeline,
#   worker:calculate-market-regime, worker:evaluate-paper-signals,
#   worker:run-equity-pipeline, worker:radar-summary
#
# Host cron is only for heavy jobs that should stay manual or nightly.
#
# To install manually:
#   crontab -e
# Then paste the lines below after reviewing paths and intervals.

SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Logs stay inside the repo at /opt/signalpilot/logs.
# Create the directory first:
#   mkdir -p /opt/signalpilot/logs

# Backtests / Strategy Comparison: manual or night-only after runtime review.
# 30 2 * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:run-strategy-comparison >> /opt/signalpilot/logs/strategy-comparison.log 2>&1
CRON
