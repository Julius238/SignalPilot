#!/usr/bin/env bash
set -euo pipefail

# Backup operations for the production Postgres: the nightly run, retention,
# verification, the encrypted off-site copy, the restore test and the
# freshness check. Policy and safety model: _backup.sh.
# Runbook: docs/trading/18-vps-24-7-shadow-runbook.md, section 13.

INVOCATION_DIR="$PWD"
# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
# shellcheck source=./_backup.sh
source "$OPS_DIR/_backup.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/ops/backup.sh <command>

  nightly [--dry-run]           cron 03:00: dump + verify, rotate, off-site copy; alerts n8n on failure
                                --dry-run: no dump, no deletion, no upload, no alert
  rotate [--apply]              retention plan (default 7 daily, 4 weekly, 3 monthly); deletes only with --apply
  verify [<file>...]            checksum + archive check (default: every managed backup)
  offsite [--dry-run]           encrypt and upload pending backups (OFFSITE_METHOD in the config)
  restore-test <file> [--keep]  restore into a throwaway container, never the production database
  check [--no-alert]            cron: newest backup and off-site copy fresh enough, else alert n8n
  alert-test                    sends exactly one harmless BACKUP_ALERT_TEST through n8n

Config: /etc/signalpilot/backup.env (root, chmod 600; SIGNALPILOT_BACKUP_CONFIG overrides).
Without it: rotation is a dry run only and there is no off-site copy.
USAGE
}

RESTORE_TEST_CPUS="${SIGNALPILOT_RESTORE_TEST_CPUS:-0.5}"
RESTORE_TEST_MEMORY="${SIGNALPILOT_RESTORE_TEST_MEMORY:-1g}"
RESTORE_TEST_READY_SECONDS="${SIGNALPILOT_RESTORE_TEST_READY_SECONDS:-120}"
readonly RESTORE_TEST_DB=signalpilot_restore_test
readonly RESTORE_TEST_MIN_TABLES=10

RESTORE_TEST_CONTAINER=""
BACKUP_STAGING_DIR=""
BACKUP_LOCK_DIR=""

backup_cleanup() {
  if [ -n "$RESTORE_TEST_CONTAINER" ]; then
    docker rm --force --volumes "$RESTORE_TEST_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [ -n "$BACKUP_STAGING_DIR" ]; then rm -rf -- "$BACKUP_STAGING_DIR"; fi
  if [ -n "$BACKUP_LOCK_DIR" ]; then rm -rf -- "$BACKUP_LOCK_DIR"; fi
}
trap backup_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# One mutating run at a time. `nightly` holds the lock and hands it to the
# rotate and offsite steps it runs as child processes.
acquire_backup_lock() {
  local lock="$BACKUP_DIR/.backup.lock" pid
  pid=$(cat "$lock/pid" 2>/dev/null || true)
  if [ -n "${SIGNALPILOT_BACKUP_LOCK_OWNER:-}" ] && [ "$pid" = "$SIGNALPILOT_BACKUP_LOCK_OWNER" ]; then return 0; fi
  mkdir -p "$BACKUP_DIR"
  if ! mkdir "$lock" 2>/dev/null; then
    pid=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -z "$pid" ]; then
      echo "ERROR: $lock exists without a pid; if no backup is running, remove it." >&2
      return 1
    fi
    if kill -0 "$pid" 2>/dev/null; then
      echo "ERROR: another backup run (pid $pid) holds $lock." >&2
      return 1
    fi
    echo "Removing the stale lock of pid $pid."
    rm -rf -- "$lock"
    mkdir "$lock" || return 1
  fi
  echo "$$" >"$lock/pid"
  BACKUP_LOCK_DIR="$lock"
  export SIGNALPILOT_BACKUP_LOCK_OWNER="$$"
}

# File arguments are relative to where the operator ran the command;
# _common.sh has changed into the repo root since.
resolve_arg() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$INVOCATION_DIR/$1" ;;
  esac
}

bad_usage() {
  usage >&2
  exit 2
}

shrank_too_much() {
  local before after
  before=$(file_size "$BACKUP_DIR/$1")
  after=$(file_size "$BACKUP_DIR/$2")
  [ $((after * 100)) -lt $((before * (100 - BACKUP_MAX_SHRINK_PERCENT))) ]
}

cmd_nightly() {
  local config_ok=yes previous newest="" rotate_mode problems=()
  echo "=== SignalPilot nightly backup $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  # A broken config must not cost the day's dump.
  if ! load_backup_config_or_defaults; then
    config_ok=no
    problems+=("BACKUP_CONFIG_INVALID: $BACKUP_CONFIG_FILE rejected, dump only (no rotation, no off-site copy)")
  fi
  if ! acquire_backup_lock; then
    send_backup_alert "BACKUP_FAILED: another backup run holds the lock, tonight's backup was skipped" || true
    return 1
  fi
  print_backup_policy

  previous=$(newest_managed_backup)
  if bash "$OPS_DIR/backup-postgres.sh"; then
    newest=$(newest_managed_backup)
    if [ -z "$newest" ] || [ "$newest" = "$previous" ]; then
      problems+=("BACKUP_FAILED: backup-postgres.sh succeeded but left no new verified backup")
      newest=""
    fi
  else
    problems+=("BACKUP_FAILED: dump or archive verification failed (exit $?), see the backup log on the VPS")
  fi

  if [ -n "$newest" ] && [ "$config_ok" = yes ]; then
    if [ -n "$previous" ] && shrank_too_much "$previous" "$newest"; then
      # The dump is valid and kept, but a database that suddenly shrank must
      # not push the older, larger backups out of the retention window.
      problems+=("BACKUP_SIZE_DROP: $newest is more than ${BACKUP_MAX_SHRINK_PERCENT}% smaller than $previous; rotation skipped, check the database")
    else
      if [ "$BACKUP_ROTATION" = apply ]; then rotate_mode=--apply; else rotate_mode=--dry-run; fi
      bash "$OPS_DIR/backup.sh" rotate "$rotate_mode" ||
        problems+=("BACKUP_ROTATION_FAILED: rotation stopped (exit $?), nothing further deleted")
    fi
    if [ "$OFFSITE_METHOD" != none ]; then
      bash "$OPS_DIR/backup.sh" offsite ||
        problems+=("BACKUP_OFFSITE_FAILED: encrypted off-site copy failed (exit $?), local backups are intact")
    fi
  fi

  if [ "${#problems[@]}" -gt 0 ]; then
    send_backup_alert "${problems[@]}" || true
    echo "Nightly backup FAILED." >&2
    return 1
  fi
  echo "Nightly backup OK: $newest"
}

cmd_nightly_dry_run() {
  local pending
  echo "=== DRY RUN: no dump, no deletion, no upload, no alert ==="
  load_backup_config
  print_backup_policy
  echo ""
  echo "A real run takes a dump, verifies it, then rotates (BACKUP_ROTATION=$BACKUP_ROTATION)."
  run_rotation dry-run
  if [ "$OFFSITE_METHOD" != none ]; then
    echo ""
    offsite_preflight
    echo "Off-site preflight OK (tools, key files, permissions)."
    pending=$(offsite_pending)
    if [ -n "$pending" ]; then sed 's/^/  would upload /' <<<"$pending"; else echo "  nothing pending"; fi
  fi
  echo ""
  cmd_check no-alert || true
}

cmd_offsite() {
  local mode="$1" pending name
  if [ "$OFFSITE_METHOD" = none ]; then
    echo "Off-site copy not configured (OFFSITE_METHOD=none, $BACKUP_CONFIG_SOURCE)."
    return 0
  fi
  offsite_preflight
  pending=$(offsite_pending)
  if [ -z "$pending" ]; then
    echo "Off-site: every kept backup already has an off-site copy."
    return 0
  fi
  if [ "$mode" = dry-run ]; then
    sed 's/^/  would upload /' <<<"$pending"
    echo "Off-site dry run: nothing encrypted or uploaded."
    return 0
  fi
  acquire_backup_lock || exit 1
  BACKUP_STAGING_DIR="$BACKUP_DIR/.offsite-staging"
  rm -rf -- "$BACKUP_STAGING_DIR"
  mkdir -m 700 "$BACKUP_STAGING_DIR"
  while IFS= read -r name; do
    offsite_copy_one "$name" "$BACKUP_STAGING_DIR" </dev/null
  done <<<"$pending"
}

cmd_verify() {
  local files=() file name failed=0
  if [ "$#" -eq 0 ]; then
    while IFS= read -r name; do files+=("$BACKUP_DIR/$name"); done < <(list_managed_backups)
    if [ "${#files[@]}" -eq 0 ]; then
      echo "No managed backups in $BACKUP_DIR."
      return 0
    fi
  else
    for file in "$@"; do files+=("$(resolve_arg "$file")"); done
  fi
  for file in "${files[@]}"; do
    if [ ! -f "$file" ]; then
      echo "  FAIL ${file##*/}: not found" >&2
      failed=$((failed + 1))
    elif ! verify_checksum "$file" || ! verify_archive "$file"; then
      failed=$((failed + 1))
    fi
  done
  [ "$failed" -eq 0 ] || backup_die "$failed of ${#files[@]} backups failed verification."
  echo "All ${#files[@]} backups verified."
}

# TCP on loopback: the image's init phase listens on the socket only, so this
# succeeds once the final server accepts connections, not during init.
wait_for_restore_db() {
  local name="$1" waited=0
  until docker exec "$name" pg_isready --host=127.0.0.1 --username=postgres --dbname="$RESTORE_TEST_DB" --quiet >/dev/null 2>&1; do
    waited=$((waited + 1))
    [ "$waited" -lt "$RESTORE_TEST_READY_SECONDS" ] || backup_die "the throwaway Postgres $name was not ready within ${RESTORE_TEST_READY_SECONDS}s."
    sleep 1
  done
}

# Last guard before pg_restore writes anything: the target must be a
# container this script created, with no network.
assert_throwaway_container() {
  local name="$1" facts
  case "$name" in
    signalpilot-restore-test-*) ;;
    *) backup_die "refusing to restore into '$name': not a restore-test container." ;;
  esac
  facts=$(docker inspect --format '{{index .Config.Labels "signalpilot.restore-test"}} {{.HostConfig.NetworkMode}}' "$name") ||
    backup_die "cannot inspect $name."
  [ "$facts" = "1 none" ] || backup_die "refusing to restore into '$name': it lacks the restore-test label or has a network ($facts)."
}

# Restores one backup into a throwaway Postgres: no network, its own anonymous
# data volume, capped CPU and memory, removed afterwards. The production
# database cannot be reached from it, and nothing here uses Compose.
cmd_restore_test() {
  local file="$1" keep="$2" archive name started summary tables migrations
  [ -f "$file" ] || backup_die "backup file not found: $file"
  echo "=== SignalPilot restore test (throwaway container, never the production database) ==="
  verify_checksum "$file" || backup_die "not restoring an archive whose checksum does not match."
  archive=$(abs_path "$file")
  name="signalpilot-restore-test-$(date -u +%Y%m%d%H%M%S)-$$"
  if [ "$keep" = keep ]; then
    echo "Keeping $name afterwards; remove it with: docker rm --force --volumes $name"
  else
    RESTORE_TEST_CONTAINER="$name"
  fi
  docker run --detach --pull never --name "$name" --network none \
    --label signalpilot.restore-test=1 \
    --cpus "$RESTORE_TEST_CPUS" --memory "$RESTORE_TEST_MEMORY" \
    --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB="$RESTORE_TEST_DB" \
    --volume "$archive:/restore/archive.dump:ro" \
    "$BACKUP_PG_IMAGE" >/dev/null
  wait_for_restore_db "$name"
  assert_throwaway_container "$name"

  echo "Restoring ${file##*/} ($(du -sh "$file" | cut -f1)) into $name ($RESTORE_TEST_CPUS CPU, $RESTORE_TEST_MEMORY RAM)..."
  started=$(date +%s)
  docker exec "$name" pg_restore --username=postgres --dbname="$RESTORE_TEST_DB" \
    --no-owner --no-privileges --exit-on-error /restore/archive.dump ||
    backup_die "pg_restore failed: ${file##*/} does NOT restore cleanly."
  echo "pg_restore finished in $(($(date +%s) - started))s."

  summary=$(docker exec -i "$name" psql --username=postgres --dbname="$RESTORE_TEST_DB" \
    --no-psqlrc -v ON_ERROR_STOP=1 --tuples-only --no-align --field-separator=' ' <<'SQL'
SELECT 'tables', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
SELECT 'migrations', count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT 'latest_migration', coalesce(max(migration_name), '-') FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT 'rows:' || t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text
FROM unnest(ARRAY['Candle', 'Portfolio', 'TradingSession', 'PortfolioLedgerEntry', 'TradingAuditEvent', 'ArenaCohort']) AS t
WHERE to_regclass(format('public.%I', t)) IS NOT NULL;
SQL
  ) || backup_die "the sanity queries failed on the restored database."
  sed 's/^/  /' <<<"$summary"
  tables=$(awk '$1 == "tables" { print $2 }' <<<"$summary")
  migrations=$(awk '$1 == "migrations" { print $2 }' <<<"$summary")
  [ "${tables:-0}" -ge "$RESTORE_TEST_MIN_TABLES" ] || backup_die "only ${tables:-0} tables restored (expected >= $RESTORE_TEST_MIN_TABLES)."
  [ "${migrations:-0}" -ge 1 ] || backup_die "no applied Prisma migration in the restored database."
  echo "RESTORE TEST PASSED: ${file##*/} restores into a fresh database ($tables tables, $migrations migrations)."
}

# Dead man's switch for the nightly run: alerts when the newest verified
# backup (or off-site copy) is too old, whatever the reason.
cmd_check() {
  local alert="$1" now newest offsite_newest age name problems=()
  if ! load_backup_config_or_defaults; then
    problems+=("BACKUP_CONFIG_INVALID: $BACKUP_CONFIG_FILE rejected, freshness checked with the defaults")
  fi
  now=$(backup_now)
  newest=$(newest_managed_backup)
  if [ -z "$newest" ]; then
    problems+=("BACKUP_STALE: no verified backup in $BACKUP_DIR")
  else
    age=$(backup_age_hours "$newest" "$now")
    echo "Newest verified backup: $newest (${age}h old, limit ${BACKUP_MAX_AGE_HOURS}h)"
    [ "$age" -le "$BACKUP_MAX_AGE_HOURS" ] ||
      problems+=("BACKUP_STALE: newest verified backup $newest is ${age}h old (limit ${BACKUP_MAX_AGE_HOURS}h)")
  fi
  if [ "$OFFSITE_METHOD" != none ]; then
    offsite_newest=$(list_managed_backups | while IFS= read -r name; do
      if [ -e "$BACKUP_DIR/$name.offsite" ]; then printf '%s\n' "$name"; fi
    done | awk 'NR == 1')
    if [ -z "$offsite_newest" ]; then
      problems+=("BACKUP_OFFSITE_STALE: no backup has an off-site copy yet")
    else
      age=$(backup_age_hours "$offsite_newest" "$now")
      echo "Newest off-site copy  : $offsite_newest (${age}h old, limit ${OFFSITE_MAX_AGE_HOURS}h)"
      [ "$age" -le "$OFFSITE_MAX_AGE_HOURS" ] ||
        problems+=("BACKUP_OFFSITE_STALE: newest off-site copy $offsite_newest is ${age}h old (limit ${OFFSITE_MAX_AGE_HOURS}h)")
    fi
  fi
  if [ "${#problems[@]}" -eq 0 ]; then
    echo "Backup freshness OK."
    return 0
  fi
  printf '  PROBLEM %s\n' "${problems[@]}"
  if [ "$alert" = alert ]; then send_backup_alert "${problems[@]}" || true; fi
  return 1
}

command_name="${1:-help}"
if [ "$#" -gt 0 ]; then shift; fi

case "$command_name" in
  help | -h | --help)
    usage
    ;;
  nightly)
    case "$*" in
      "") cmd_nightly ;;
      --dry-run) cmd_nightly_dry_run ;;
      *) bad_usage ;;
    esac
    ;;
  rotate)
    load_backup_config
    case "$*" in
      "" | --dry-run) run_rotation dry-run ;;
      --apply)
        acquire_backup_lock || exit 1
        run_rotation apply
        ;;
      *) bad_usage ;;
    esac
    ;;
  verify)
    cmd_verify "$@"
    ;;
  offsite)
    load_backup_config
    case "$*" in
      "") cmd_offsite apply ;;
      --dry-run) cmd_offsite dry-run ;;
      *) bad_usage ;;
    esac
    ;;
  restore-test)
    case "$#:${2:-}" in
      1:) cmd_restore_test "$(resolve_arg "$1")" remove ;;
      2:--keep) cmd_restore_test "$(resolve_arg "$1")" keep ;;
      *) bad_usage ;;
    esac
    ;;
  check)
    case "$*" in
      "") cmd_check alert ;;
      --no-alert) cmd_check no-alert ;;
      *) bad_usage ;;
    esac
    ;;
  alert-test)
    [ "$#" -eq 0 ] || bad_usage
    send_backup_alert "BACKUP_ALERT_TEST: harmless test of the backup alert path, no action needed"
    ;;
  *)
    bad_usage
    ;;
esac
