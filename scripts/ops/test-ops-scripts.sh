#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

for script in scripts/ops/*.sh; do
  bash -n "$script"
done

test -x scripts/ops/trading-shadow.sh
test -x scripts/ops/prod-build.sh
test -x scripts/ops/prod-migrate-docker.sh
test -x scripts/ops/validate-prod-config.sh

help_output=$(bash scripts/ops/trading-shadow.sh --help)
grep -q "rollback-disabled" <<<"$help_output"
grep -q "enable-btc-assignment" <<<"$help_output"
grep -q "enable-assignment <assignment-id> <expected-version>" <<<"$help_output"
grep -q "disable-assignment <assignment-id> <expected-version>" <<<"$help_output"
grep -q "manual-risk-close" <<<"$help_output"
grep -q "job day-start|candidate|risk|order|fill|monitor|reconcile|performance|alerts" <<<"$help_output"

if bash scripts/ops/trading-shadow.sh unknown-command >/dev/null 2>&1; then
  echo "ERROR: trading-shadow.sh accepted an unknown command." >&2
  exit 1
fi

grep -q 'export COMPOSE_PROJECT_NAME=signalpilot' scripts/ops/_common.sh
grep -q 'readonly ENV_FILE=".env.production"' scripts/ops/_common.sh
grep -q 'docker-compose.prod.yml' scripts/ops/_common.sh
grep -q 'warning details are suppressed' scripts/ops/_common.sh
# The interpolation diagnosis must name variables only — never echo a value.
grep -q 'names only, values never shown' scripts/ops/_common.sh
grep -q 'scan_unescaped_dollar_keys' scripts/ops/_common.sh
if grep -qF 'cat "$validation_output"' scripts/ops/_common.sh; then
  echo "ERROR: _common.sh would print raw Compose warning text (may contain secret fragments)." >&2
  exit 1
fi

# The dashboard build flag must reach the image as a build arg, defaulting to
# false, and must never be turned into a runtime-only variable.
grep -q 'ARG NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=false' apps/dashboard/Dockerfile
grep -q 'ENV NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=' apps/dashboard/Dockerfile
grep -qF 'NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED: ${NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED:-false}' docker-compose.prod.yml

# Every app image must build its own workspace dependency closure. A bare
# "packages/** then the app" pair silently skips an app-to-app dependency and
# is exactly what broke the API and migration images.
for dockerfile in apps/api/Dockerfile apps/worker/Dockerfile apps/trading-worker/Dockerfile; do
  if grep -qF 'filter "./packages/**" build' "$dockerfile"; then
    echo "ERROR: $dockerfile builds packages/** instead of the app's dependency closure." >&2
    exit 1
  fi
done
grep -qF 'filter "@signalpilot/api..." build' apps/api/Dockerfile
grep -qF 'filter "@signalpilot/worker..." build' apps/worker/Dockerfile
grep -qF 'filter "@signalpilot/trading-worker..." build' apps/trading-worker/Dockerfile
grep -q 'compose_exec trading-worker node' scripts/ops/trading-shadow.sh
grep -q 'TRADING_BOOTSTRAP_ENABLED' scripts/ops/trading-shadow.sh
grep -q 'TRADING_SCHEDULER_ENABLED' scripts/ops/trading-shadow.sh
grep -q 'TRADING_STRATEGY_SHORT_V1_ENABLED' scripts/ops/trading-shadow.sh
grep -q 'TRADING_SHADOW_SHORT_ENABLED' scripts/ops/trading-shadow.sh
grep -q 'reservedCollateral' scripts/ops/trading-shadow.sh
grep -q 'DISABLE_${symbol}_${direction}_${strategy_key}_V${current_version}' scripts/ops/trading-shadow.sh
if grep -Eq '^[[:space:]]*pnpm([[:space:]]|$)' scripts/ops/trading-shadow.sh; then
  echo "ERROR: trading-shadow.sh invokes host pnpm." >&2
  exit 1
fi
if grep -Eq 'migrate|prisma migrate' scripts/ops/prod-up.sh; then
  echo "ERROR: prod-up.sh must not run migrations." >&2
  exit 1
fi

# ── Hotfix 1: Dashboard-Healthcheck ────────────────────────────────────────
# "localhost" löst im Container auch auf ::1 auf, wo Next nicht lauscht; "/"
# antwortet je nach Session mit einem Redirect. Beides zusammen meldete ein
# laufendes Dashboard produktiv als unhealthy.
if ! grep -qF 'wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1' docker-compose.prod.yml; then
  echo "ERROR: dashboard healthcheck must probe http://127.0.0.1:3000/login." >&2
  exit 1
fi
if grep -qF 'http://localhost:3000/' docker-compose.prod.yml; then
  echo "ERROR: the old localhost:3000/ dashboard healthcheck came back." >&2
  exit 1
fi
# Kein anderer Healthcheck darf auf "localhost" zurückfallen.
if grep -E '^\s*test:.*healthcheck' docker-compose.prod.yml | grep -qF 'localhost'; then
  echo "ERROR: a healthcheck still resolves via localhost instead of 127.0.0.1." >&2
  exit 1
fi

# ── Hotfix 2: JSON-Key-Quoting im äußeren sh -c '...' ──────────────────────
# Verhaltensprüfung statt Textsuche: Die Funktion wird aus dem Script extrahiert
# und mit einem Stub ausgeführt, der abfängt, was tatsächlich bei psql ankommt.
quoting_probe_dir="$(mktemp -d)"
trap 'rm -rf "$quoting_probe_dir"' EXIT

awk '/^status_report\(\) \{/{f=1} f{print} f&&/^\}/{exit}' \
  scripts/ops/trading-shadow.sh >"$quoting_probe_dir/status_report.sh"

if ! grep -q 'assignmentConfigJson' "$quoting_probe_dir/status_report.sh"; then
  echo "ERROR: could not extract status_report() for the quoting check." >&2
  exit 1
fi

status_sql=$(
  cd "$quoting_probe_dir"
  # shellcheck disable=SC2317
  compose_exec() { shift 3; printf '%s' "$1"; }
  # shellcheck source=/dev/null
  source ./status_report.sh
  status_report
)

# Das ist der Kern des Hotfixes: die einfachen Anführungszeichen um den JSON-Key
# müssen das Shell-Parsen überleben.
if ! grep -qF "assignmentConfigJson\\\"->>'direction'" <<<"$status_sql"; then
  echo "ERROR: status SQL does not pass ->>'direction' to psql." >&2
  grep -o "assignmentConfigJson[^,]*" <<<"$status_sql" >&2 || true
  exit 1
fi
# Die zerfallene Form darf nicht auftreten.
if grep -qE "assignmentConfigJson\\\\\"->>[[:space:]]*direction" <<<"$status_sql"; then
  echo "ERROR: JSON key collapsed to ->>direction (unquoted)." >&2
  exit 1
fi

# Negativkontrolle: Die Prüfung oben muss die alte Form auch wirklich ablehnen.
broken_sql=$(bash -c "printf '%s' 'a.\\\"assignmentConfigJson\\\"->>'direction' AS direction'")
if grep -qF "assignmentConfigJson\\\"->>'direction'" <<<"$broken_sql"; then
  echo "ERROR: the quoting check cannot detect the broken form — it is worthless." >&2
  exit 1
fi

# Die Form '''x''' zerfällt genauso wie 'x' und darf in keiner Codezeile stehen.
# Kommentarzeilen dürfen sie zitieren — sie erklären genau diesen Fehler.
if grep -vE '^\s*#' scripts/ops/trading-shadow.sh | grep -qF "'''"; then
  echo "ERROR: trading-shadow.sh uses the '''x''' form, which drops the quotes." >&2
  grep -nE "^[^#]*'''" scripts/ops/trading-shadow.sh >&2
  exit 1
fi

# Jeder SQL-String-Literal im Rollback-Pfad muss die '\'' -Form nutzen.
if ! grep -qF "assignmentConfigJson\"->>'\\''direction'\\''" scripts/ops/trading-shadow.sh; then
  echo "ERROR: rollback query does not quote the direction JSON key safely." >&2
  exit 1
fi

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -x scripts/ops/*.sh
else
  echo "shellcheck not installed; bash -n and command-surface checks passed."
fi

echo "Operations script checks passed."
