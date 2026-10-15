#!/usr/bin/env bash
# Store the Anthropic API key for the Evolution Engine in a gitignored env
# file without it ever appearing on screen, in shell history, in a chat or in
# a log (docs/trading/20-evolution-engine.md, "Echten Schlüssel hinterlegen").
#
#   bash scripts/ops/set-anthropic-key.sh            # repo-root .env
#   bash scripts/ops/set-anthropic-key.sh .env.evolution
#
# The key is read with hidden input, checked for the Anthropic key format and
# written as ANTHROPIC_API_KEY together with EVOLUTION_AI_PROVIDER=anthropic.
# Existing lines for both are replaced; every other line stays untouched.
# The file is created or kept with mode 600.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"
case "$ENV_FILE" in
  /*) ;;
  *) ENV_FILE="$ROOT/$ENV_FILE" ;;
esac

case "$ENV_FILE" in
  *.example)
    echo "Refusing to write a key into an example file: $ENV_FILE" >&2
    exit 1
    ;;
esac
if ! git -C "$ROOT" check-ignore -q "$ENV_FILE"; then
  echo "Refusing: $ENV_FILE is not gitignored, the key could be committed." >&2
  exit 1
fi

# Masked input: every received character shows as "*", so a paste is visibly
# accepted and nobody pastes twice. Backspace removes the last character.
printf 'Anthropic API key (paste once, each character shows as *, then Enter): ' >&2
KEY=""
while IFS= read -rs -n1 CHAR; do
  [[ -z "$CHAR" ]] && break
  if [[ "$CHAR" == $'\x7f' || "$CHAR" == $'\b' ]]; then
    if [[ -n "$KEY" ]]; then
      KEY="${KEY%?}"
      printf '\b \b' >&2
    fi
    continue
  fi
  KEY+="$CHAR"
  printf '*' >&2
done
unset CHAR
echo >&2
KEY="${KEY//[[:space:]]/}"
if [[ ! "$KEY" =~ ^sk-ant-[A-Za-z0-9_-]{30,}$ ]]; then
  unset KEY
  echo "That does not look like an Anthropic API key (sk-ant-...). Nothing was written." >&2
  exit 1
fi
REST="${KEY#sk-ant-}"
if [[ "$REST" == *sk-ant-* ]]; then
  LENGTH="${#KEY}"
  unset KEY REST
  echo "The input contains 'sk-ant-' more than once (${LENGTH} characters) - probably pasted twice. Nothing was written; please paste the key exactly once." >&2
  exit 1
fi
unset REST
KIND="${KEY#sk-ant-}"
KIND="sk-ant-${KIND%%-*}-"

umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
TMP="$(mktemp "$ENV_FILE.XXXXXX")"
grep -v -E '^(ANTHROPIC_API_KEY|EVOLUTION_AI_PROVIDER)=' "$ENV_FILE" > "$TMP" || true
{
  printf "ANTHROPIC_API_KEY='%s'\n" "$KEY"
  printf 'EVOLUTION_AI_PROVIDER=anthropic\n'
} >> "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
LENGTH="${#KEY}"
unset KEY
echo "Stored ANTHROPIC_API_KEY (type ${KIND}..., ${LENGTH} characters) and EVOLUTION_AI_PROVIDER=anthropic in $ENV_FILE (mode 600). The key was not printed." >&2
