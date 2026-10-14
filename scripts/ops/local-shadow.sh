#!/usr/bin/env bash
# Lokaler Shadow-Betrieb auf dem Entwicklungsrechner (macOS, launchd).
#
# Läuft gegen die Datenbank aus der Root-.env und die gebauten dist/-Dateien;
# die Flags stehen in scripts/ops/local-shadow.env. Kein Echtgeldhandel.
#
#   scripts/ops/local-shadow.sh job <datei>            # z. B. shadowStartTradingDay
#   scripts/ops/local-shadow.sh ops <args…>            # shadowOps (Assignments, Session, Kill Switch)
#   scripts/ops/local-shadow.sh bootstrap              # Champion-/Challenger-Portfolio, Profile, Strategy-Setup (idempotent)
#   scripts/ops/local-shadow.sh eligibility [--portfolio=SHADOW_CHALLENGER_V1]
#   scripts/ops/local-shadow.sh install-agent          # Trading-Worker als launchd-Agent starten
#   scripts/ops/local-shadow.sh restart-agent | stop-agent | status | logs
#
# Der Trading-Worker läuft als de.jul1us.signalpilot-trading-worker (KeepAlive,
# RunAtLoad) nach demselben Muster wie de.jul1us.signalpilot-worker/-api.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TRADING_DIR="$ROOT/apps/trading-worker"
ENV_FILE="$ROOT/scripts/ops/local-shadow.env"
LABEL="de.jul1us.signalpilot-trading-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname -- "$NODE_BIN")"

load_env() {
  set -a
  # shellcheck source=local-shadow.env
  source "$ENV_FILE"
  set +a
  export TRADING_CODE_VERSION="${TRADING_CODE_VERSION:-$(git -C "$ROOT" rev-parse --short HEAD)}"
}

run_node() {
  load_env
  (cd "$TRADING_DIR" && "$NODE_BIN" "$@")
}

# Operator steps that the running worker must not do on its own.
run_node_with_bootstrap() {
  load_env
  export TRADING_BOOTSTRAP_ENABLED=true
  (cd "$TRADING_DIR" && "$NODE_BIN" "$@")
}

write_plist() {
  load_env
  local vars=""
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    vars+="    <key>$key</key><string>$value</string>\n"
  done < "$ENV_FILE"
  vars+="    <key>TRADING_CODE_VERSION</key><string>$TRADING_CODE_VERSION</string>\n"
  vars+="    <key>HOME</key><string>$HOME</string>\n"
  vars+="    <key>PATH</key><string>$NODE_DIR:/opt/homebrew/bin:/usr/bin:/bin</string>\n"
  mkdir -p "$(dirname -- "$PLIST")"
  printf '%s\n' "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>dist/index.js</string></array>
  <key>WorkingDirectory</key><string>$TRADING_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
$(printf '%b' "$vars")  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/$LABEL.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/$LABEL.err.log</string>
</dict>
</plist>" > "$PLIST"
  plutil -lint "$PLIST" >/dev/null
}

command="${1:-status}"
shift || true
case "$command" in
  job)
    [[ $# -eq 1 ]] || { echo "usage: job <shadowJobFile>" >&2; exit 2; }
    run_node "dist/jobs/$1.js"
    ;;
  ops)
    run_node dist/jobs/shadowOps.js "$@"
    ;;
  bootstrap)
    # Champion and challenger portfolios, then the strategy setup that
    # assigns each strategy to its own portfolio (all idempotent).
    run_node_with_bootstrap dist/jobs/shadowBootstrap.js
    run_node_with_bootstrap dist/jobs/shadowBootstrap.js --portfolio=SHADOW_CHALLENGER_V1
    run_node_with_bootstrap dist/jobs/shadowStrategySetup.js
    ;;
  calibrate-execution-profile)
    run_node_with_bootstrap dist/jobs/shadowExecutionProfileCalibrate.js --confirm=CALIBRATE_EXECUTION_PROFILE
    ;;
  eligibility)
    run_node dist/jobs/shadowEligibilityReport.js ${@+"$@"}
    ;;
  install-agent)
    write_plist
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$PLIST"
    echo "gestartet: $LABEL (TRADING_CODE_VERSION=$TRADING_CODE_VERSION)"
    ;;
  restart-agent)
    write_plist
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$PLIST"
    echo "neu gestartet: $LABEL (TRADING_CODE_VERSION=$TRADING_CODE_VERSION)"
    ;;
  stop-agent)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null && echo "gestoppt: $LABEL" || echo "lief nicht: $LABEL"
    ;;
  status)
    for label in de.jul1us.signalpilot-worker de.jul1us.signalpilot-api "$LABEL"; do
      launchctl print "gui/$UID/$label" 2>/dev/null | awk -v l="$label" '/^\tstate = /{s=$3} /^\tpid = /{p=$3} END{printf "%-42s state=%s pid=%s\n", l, (s?s:"nicht geladen"), (p?p:"-")}'
    done
    [[ -f /tmp/signalpilot-trading-worker-heartbeat ]] && echo "Heartbeat: $(cat /tmp/signalpilot-trading-worker-heartbeat)"
    ;;
  logs)
    tail -n "${1:-40}" "$LOG_DIR/$LABEL.out.log" "$LOG_DIR/$LABEL.err.log"
    ;;
  *)
    echo "unbekannt: $command" >&2
    exit 2
    ;;
esac
