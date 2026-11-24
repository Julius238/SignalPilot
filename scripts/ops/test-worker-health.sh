#!/usr/bin/env bash
set -euo pipefail

# Behavioural tests of the crash-restart and signal-analysis checks. The real
# scripts run in a sandbox repo with a stub docker on PATH: no container starts
# and nothing leaves the machine. Called by test-ops-scripts.sh.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

fail() {
  echo "FAIL: $*" >&2
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error file=scripts/ops/test-worker-health.sh::$*"; fi
  exit 1
}

sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/repo/scripts/ops" "$sandbox/bin" "$sandbox/state"
cp "$REPO_ROOT"/scripts/ops/*.sh "$sandbox/repo/scripts/ops/"
: >"$sandbox/repo/docker-compose.prod.yml"
: >"$sandbox/repo/.env.production"

minutes_ago() {
  date -u -d "-$1 minutes" +%Y-%m-%dT%H:%M:%S.123456789Z 2>/dev/null ||
    date -u -v-"$1"M +%Y-%m-%dT%H:%M:%S.123456789Z
}

# Stub: STUB_RESTARTS/STUB_STARTED describe the worker-scheduler container,
# every other container never crashed. STUB_ROW is the psql answer ("ERROR"
# makes psql fail). `compose run` records the opsWatch arguments.
cat >"$sandbox/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = inspect ]; then
  format="$3" id="$4"
  if [[ "$format" == *RestartCount* ]]; then
    if [ "$id" = id-worker-scheduler ]; then echo "$STUB_RESTARTS $STUB_STARTED"; else echo "0 2026-10-20T07:21:43.4Z"; fi
  elif [ "$id" = id-worker-scheduler ]; then
    echo running
  else
    echo healthy
  fi
  exit 0
fi
[ "$1" = compose ] || exit 99
shift
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-name | --env-file | -f) shift 2 ;;
    *) break ;;
  esac
done
case "$1" in
  config) exit 0 ;;
  ps)
    service="${!#}"
    echo "id-$service"
    ;;
  exec)
    if [ "$STUB_ROW" = ERROR ]; then exit 2; fi
    echo "$STUB_ROW"
    ;;
  run) printf '%s\n' "$@" >"$STUB_RUN_ARGS" ;;
  *) exit 98 ;;
esac
STUB
chmod +x "$sandbox/bin/docker"

run_script() {
  PATH="$sandbox/bin:$PATH" STUB_RESTARTS="$1" STUB_STARTED="$2" STUB_ROW="$3" STUB_RUN_ARGS="$sandbox/run-args" \
    SIGNALPILOT_OPS_STATE_DIR="$sandbox/state" bash "$sandbox/repo/scripts/ops/$4" ${5:+"$5"} 2>&1
}

# expect <name> <restarts> <started> <row> <healthcheck exit> <expected problem prefixes, space separated>
expect() {
  local name="$1" output status=0 watched prefix
  output=$(run_script "$2" "$3" "$4" healthcheck.sh) || status=$?
  [ "$status" -eq "$5" ] || fail "$name: healthcheck exit $status instead of $5: $output"
  rm -f "$sandbox/run-args"
  run_script "$2" "$3" "$4" trading-shadow.sh watch >/dev/null || fail "$name: watch failed"
  watched=$(sed -n 's/^--container-problem=\([A-Z_]*\):.*/\1/p' "$sandbox/run-args" | tr '\n' ' ')
  [ "${watched% }" = "$6" ] || fail "$name: watch reported '${watched% }' instead of '$6'"
  for prefix in $6; do
    grep -q "FAIL $prefix:" <<<"$output" || fail "$name: healthcheck does not report $prefix"
  done
  if [ -z "$6" ] && grep -q "FAIL" <<<"$output"; then fail "$name: unexpected failure: $output"; fi
}

expect "healthy" 0 "$(minutes_ago 50000)" "8|0|14" 0 ""
expect "crash loop of 2026-11-24" 79 "$(minutes_ago 13)" "8|6|74" 1 "CONTAINER_CRASH_RESTART SIGNAL_ANALYSIS_ABORTED"
expect "first crash" 1 "$(minutes_ago 5)" "8|1|14" 1 "CONTAINER_CRASH_RESTART"
expect "old crash, recovered" 3 "$(minutes_ago 300)" "8|0|14" 0 ""
expect "one aborted run after a deploy" 0 "$(minutes_ago 5)" "8|1|14" 0 ""
expect "analysis fails without a crash" 0 "$(minutes_ago 50000)" "8|2|14" 1 "SIGNAL_ANALYSIS_ABORTED"
expect "scheduler starts no runs" 0 "$(minutes_ago 50000)" "0|0|76" 1 "SIGNAL_ANALYSIS_STALE"
expect "age at the limit" 0 "$(minutes_ago 50000)" "0|0|75" 0 ""
expect "never succeeded" 0 "$(minutes_ago 50000)" "4|4|-1" 1 "SIGNAL_ANALYSIS_ABORTED SIGNAL_ANALYSIS_STALE"
expect "database error" 0 "$(minutes_ago 50000)" "ERROR" 1 "SIGNAL_ANALYSIS_UNKNOWN"
expect "garbage answer" 0 "$(minutes_ago 50000)" "oops" 1 "SIGNAL_ANALYSIS_UNKNOWN"

# Negative control: without the new checks the crash loop looks healthy, which
# is exactly the bug. If this passes with problems, the tests above prove nothing.
sed -i.bak -e '/^check_no_crash_restart /d' -e '/^check_signal_analysis$/d' "$sandbox/repo/scripts/ops/healthcheck.sh"
run_script 79 "$(minutes_ago 13)" "8|6|74" healthcheck.sh >/dev/null ||
  fail "negative control: the former healthcheck should have passed"

echo "Worker health checks passed."
