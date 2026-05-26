#!/usr/bin/env bash
set -euo pipefail

cat <<'CRON'
# Example SignalPilot production crontab.
# This script only prints the snippet. It does not install or overwrite crontab.
#
# To install manually:
#   crontab -e
# Then paste the lines below after reviewing paths and intervals.

SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# SignalPilot worker jobs. Logs stay inside the repo at /opt/signalpilot/logs.
# Create the directory first:
#   mkdir -p /opt/signalpilot/logs

*/5 * * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:quick-crypto-radar >> /opt/signalpilot/logs/quick-crypto-radar.log 2>&1
*/15 * * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:run-crypto-pipeline >> /opt/signalpilot/logs/crypto-pipeline.log 2>&1
0 * * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:calculate-market-regime >> /opt/signalpilot/logs/market-regime.log 2>&1
5 */2 * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:evaluate-paper-signals >> /opt/signalpilot/logs/paper-evaluation.log 2>&1
10 */4 * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:run-equity-pipeline >> /opt/signalpilot/logs/equity-pipeline.log 2>&1
15 * * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:radar-summary >> /opt/signalpilot/logs/radar-summary.log 2>&1

# Backtests / Strategy Comparison: manual or night-only after runtime review.
# 30 2 * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:run-strategy-comparison >> /opt/signalpilot/logs/strategy-comparison.log 2>&1
CRON
