#!/usr/bin/env bash

# Shared, non-secret production Compose context. This file is sourced by the
# operations scripts; it is not an executable operation by itself.
set -euo pipefail

OPS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$OPS_DIR/../.." && pwd)"
cd "$REPO_ROOT"

export COMPOSE_PROJECT_NAME=signalpilot
readonly ENV_FILE=".env.production"
readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly COMPOSE_PROJECT_NAME
COMPOSE=(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
readonly ENV_FILE COMPOSE_FILE REPO_ROOT OPS_DIR

# Names the env keys whose value contains a "$" that Docker Compose would treat
# as a variable reference.
#
# Prints KEY NAMES ONLY and never any part of a value — that is the whole point:
# Compose's own warning text quotes the fragment it mistook for a variable name,
# which for a password or a bcrypt hash is secret material. This scan gives an
# operator the one thing they need (which line to fix) without ever rendering
# the value.
#
# Mirrors Compose's rules: a fully single-quoted value is literal, "$$" is an
# escaped dollar, anything else starting with "$" interpolates.
scan_unescaped_dollar_keys() {
  local file="$1"
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      eq = index($0, "=")
      if (eq == 0) next
      key = substr($0, 1, eq - 1)
      sub(/^[[:space:]]*/, "", key)
      sub(/^export[[:space:]]+/, "", key)
      sub(/[[:space:]]*$/, "", key)
      val = substr($0, eq + 1)
      # \047 is a single quote: a fully single-quoted value never interpolates.
      if (val ~ /^\047.*\047$/) next
      gsub(/\$\$/, "", val)
      if (index(val, "$") > 0) print key
    }
  ' "$file"
}

# Prints the safe remediation hint for an interpolation warning. Emits only key
# names and static text.
report_interpolation_suspects() {
  local suspects
  suspects=$(scan_unescaped_dollar_keys "$ENV_FILE" | sort -u | tr '\n' ' ')
  suspects="${suspects% }"

  if [ -n "$suspects" ]; then
    echo "Affected variable(s) in $ENV_FILE (names only, values never shown): $suspects" >&2
    echo "Cause: the value contains a '\$' that Docker Compose reads as a variable reference." >&2
    echo "Compose then substitutes an empty string, so the value is SILENTLY TRUNCATED — not just warned about." >&2
    echo "Fix, without changing the secret itself, either:" >&2
    echo "  1. wrap the whole value in single quotes:  KEY='...\$...'" >&2
    echo "  2. or double every dollar sign:            KEY=...\$\$..." >&2
    echo "Double quotes do NOT escape a '\$' in a Compose env file." >&2
  else
    echo "No unescaped '\$' found in $ENV_FILE; inspect the file locally for another interpolation issue." >&2
  fi
}

require_production_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE not found." >&2
    echo "Copy .env.production.example, review every value, then retry." >&2
    exit 1
  fi

  # Compose interpolation warnings can reveal fragments of secret values.
  # Capture and suppress them, and fail closed before any operational command.
  local validation_output
  validation_output=$(mktemp)
  if ! "${COMPOSE[@]}" config --quiet >/dev/null 2>"$validation_output"; then
    rm -f "$validation_output"
    echo "ERROR: Docker Compose rejected the production configuration." >&2
    echo "Review .env.production locally without copying values into logs or tickets." >&2
    exit 1
  fi
  if [ -s "$validation_output" ]; then
    rm -f "$validation_output"
    echo "ERROR: Docker Compose emitted a production configuration warning." >&2
    echo "Treat this as a blocker and review .env.production locally; warning details are suppressed to protect secrets." >&2
    report_interpolation_suspects
    exit 1
  fi
  rm -f "$validation_output"
}

require_service_running() {
  local service="$1"
  if [ -z "$("${COMPOSE[@]}" ps --status running -q "$service" 2>/dev/null)" ]; then
    echo "ERROR: Compose service '$service' is not running in project $COMPOSE_PROJECT_NAME." >&2
    exit 1
  fi
}

compose_exec() {
  local service="$1"
  shift
  require_production_env
  require_service_running "$service"
  "${COMPOSE[@]}" exec -T "$service" "$@"
}
