#!/usr/bin/env bash
# shellcheck disable=SC2154 # REPO_ROOT and COMPOSE come from _common.sh, sourced first.

# Backup policy for the production Postgres: checksums, archive verification,
# retention, the encrypted off-site copy and failure alerts. Sourced after
# _common.sh by backup.sh and backup-postgres.sh; not an operation by itself.
# Runbook: docs/trading/18-vps-24-7-shadow-runbook.md, section 13.
#
# Safety model:
# - A backup is "managed" only if it is named signalpilot_YYYYMMDD_HHMMSS.dump
#   AND has a .sha256 sidecar. Everything else in the directory (the old .sql
#   dumps, .dump files from before checksums, *.unverified) is never touched.
# - Nothing is deleted unless BACKUP_ROTATION=apply is set in the root-owned
#   config file, or an operator types `backup.sh rotate --apply`.
# - Archives are only ever read in throwaway containers without network. The
#   production database is read by pg_dump and by nothing else in here.
# - The off-site copy is always encrypted to a PUBLIC key; the VPS cannot
#   decrypt it. No secret lives in Git: credentials stay in root-owned files.
# - Alerts take the existing n8n path (opsWatch -> N8N_WEBHOOK_SIGNAL_URL),
#   never the Telegram API.
set -euo pipefail

BACKUP_DIR="${SIGNALPILOT_BACKUP_DIR:-$REPO_ROOT/backups}"
BACKUP_CONFIG_FILE="${SIGNALPILOT_BACKUP_CONFIG:-/etc/signalpilot/backup.env}"
# The image of the postgres service in docker-compose.prod.yml (test-backup.sh
# checks they match), so pg_restore is the version that wrote the dump. Never
# pulled implicitly: a missing image fails instead of downloading on the VPS.
BACKUP_PG_IMAGE="${SIGNALPILOT_BACKUP_PG_IMAGE:-postgres:16-alpine}"
BACKUP_VERIFY_CPUS="${SIGNALPILOT_BACKUP_VERIFY_CPUS:-0.5}"
BACKUP_VERIFY_MEMORY="${SIGNALPILOT_BACKUP_VERIFY_MEMORY:-512m}"
# A SignalPilot dump has ~70 tables; fewer means the wrong or an empty database.
readonly BACKUP_MIN_TABLE_DATA=10
readonly BACKUP_NAME_RE='^signalpilot_[0-9]{8}_[0-9]{6}\.dump$'

backup_die() {
  echo "ERROR: $*" >&2
  exit 1
}

# ── Config ───────────────────────────────────────────────────────────────────
# /etc/signalpilot/backup.env, root-owned, chmod 600. Parsed as plain
# KEY=VALUE (never sourced, nothing is expanded, a "$" stays literal). It holds
# no secret itself, only paths to the root-owned files that do. Error messages
# name keys, never values.

backup_config_defaults() {
  BACKUP_ROTATION=dry-run
  BACKUP_KEEP_DAILY=7
  BACKUP_KEEP_WEEKLY=4
  BACKUP_KEEP_MONTHLY=3
  BACKUP_MAX_AGE_HOURS=26
  BACKUP_MAX_SHRINK_PERCENT=50
  OFFSITE_METHOD=none
  OFFSITE_ENCRYPTION=age
  OFFSITE_AGE_RECIPIENT=
  OFFSITE_GPG_RECIPIENT=
  OFFSITE_GPG_HOMEDIR=/etc/signalpilot/gnupg
  OFFSITE_RSYNC_TARGET=
  OFFSITE_SSH_KEY=/etc/signalpilot/offsite_ed25519
  OFFSITE_SSH_PORT=22
  OFFSITE_SSH_KNOWN_HOSTS=/etc/signalpilot/offsite_known_hosts
  OFFSITE_RCLONE_REMOTE=
  OFFSITE_RCLONE_CONFIG=/etc/signalpilot/rclone.conf
  OFFSITE_MAX_AGE_HOURS=30
  OFFSITE_MAX_PER_RUN=3
  BACKUP_CONFIG_SOURCE="defaults (no $BACKUP_CONFIG_FILE)"
}

is_backup_config_key() {
  case "$1" in
    BACKUP_ROTATION | BACKUP_KEEP_DAILY | BACKUP_KEEP_WEEKLY | BACKUP_KEEP_MONTHLY | \
      BACKUP_MAX_AGE_HOURS | BACKUP_MAX_SHRINK_PERCENT | OFFSITE_METHOD | OFFSITE_ENCRYPTION | \
      OFFSITE_AGE_RECIPIENT | OFFSITE_GPG_RECIPIENT | OFFSITE_GPG_HOMEDIR | OFFSITE_RSYNC_TARGET | \
      OFFSITE_SSH_KEY | OFFSITE_SSH_PORT | OFFSITE_SSH_KNOWN_HOSTS | OFFSITE_RCLONE_REMOTE | \
      OFFSITE_RCLONE_CONFIG | OFFSITE_MAX_AGE_HOURS | OFFSITE_MAX_PER_RUN)
      return 0
      ;;
  esac
  return 1
}

# Fails unless PATH is owned by the invoking user (root under cron) and grants
# nothing to group or others. `ls -ln` is the one format GNU and BSD share.
require_private_path() {
  local path="$1" label="$2" listing mode uid
  [ -e "$path" ] || backup_die "$label not found: $path"
  listing=$(ls -lnd -- "$path")
  mode="${listing%% *}"
  uid=$(awk '{print $3}' <<<"$listing")
  [ "$uid" = "$(id -u)" ] || backup_die "$label $path must be owned by uid $(id -u) (root on the VPS)."
  case "$mode" in
    ?[r-][w-][x-]------ | ?[r-][w-][x-]------[.@]) ;;
    *) backup_die "$label $path must not be accessible by group or others (chmod 600, directories 700)." ;;
  esac
}

load_backup_config() {
  backup_config_defaults
  if [ -e "$BACKUP_CONFIG_FILE" ]; then
    require_private_path "$BACKUP_CONFIG_FILE" "Backup config"
    local line key value lineno=0
    local re_blank='^[[:space:]]*(#.*)?$' re_pair='^([A-Z][A-Z0-9_]*)=(.*)$' re_single="^'(.*)'$" re_double='^"(.*)"$'
    while IFS= read -r line || [ -n "$line" ]; do
      lineno=$((lineno + 1))
      line="${line%$'\r'}"
      if [[ "$line" =~ $re_blank ]]; then continue; fi
      [[ "$line" =~ $re_pair ]] || backup_die "$BACKUP_CONFIG_FILE line $lineno is not KEY=VALUE."
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      is_backup_config_key "$key" || backup_die "$BACKUP_CONFIG_FILE line $lineno: unknown key $key (typo?)."
      if [[ "$value" =~ $re_single ]] || [[ "$value" =~ $re_double ]]; then value="${BASH_REMATCH[1]}"; fi
      printf -v "$key" '%s' "$value"
    done <"$BACKUP_CONFIG_FILE"
    BACKUP_CONFIG_SOURCE="$BACKUP_CONFIG_FILE"
  fi
  validate_backup_config
}

# For the cron entry points: an invalid config falls back to the safe
# defaults (nothing deleted, nothing uploaded) instead of stopping the run.
# Returns 1 when it had to; the reason is on stderr.
load_backup_config_or_defaults() {
  if (load_backup_config >/dev/null); then
    load_backup_config
    return 0
  fi
  backup_config_defaults
  return 1
}

validate_backup_config() {
  local key
  case "$BACKUP_ROTATION" in
    dry-run | apply) ;;
    *) backup_die "BACKUP_ROTATION must be dry-run or apply." ;;
  esac
  for key in BACKUP_KEEP_DAILY BACKUP_KEEP_WEEKLY BACKUP_KEEP_MONTHLY BACKUP_MAX_AGE_HOURS \
    BACKUP_MAX_SHRINK_PERCENT OFFSITE_SSH_PORT OFFSITE_MAX_AGE_HOURS OFFSITE_MAX_PER_RUN; do
    [[ "${!key}" =~ ^[0-9]+$ ]] || backup_die "$key must be a non-negative integer."
  done
  [ "$BACKUP_KEEP_DAILY" -ge 1 ] || backup_die "BACKUP_KEEP_DAILY must be at least 1: the newest backup is always kept."
  [ "$BACKUP_MAX_SHRINK_PERCENT" -le 100 ] || backup_die "BACKUP_MAX_SHRINK_PERCENT must be 0..100."
  case "$OFFSITE_AGE_RECIPIENT $OFFSITE_GPG_RECIPIENT" in
    *AGE-SECRET-KEY-*) backup_die "a PRIVATE age key is in $BACKUP_CONFIG_FILE. Only the public key (age1...) belongs on the VPS: remove it and generate a new key pair." ;;
  esac
  case "$OFFSITE_METHOD" in
    none) return 0 ;;
    rsync) [ -n "$OFFSITE_RSYNC_TARGET" ] || backup_die "OFFSITE_METHOD=rsync needs OFFSITE_RSYNC_TARGET (user@host:path)." ;;
    rclone) [ -n "$OFFSITE_RCLONE_REMOTE" ] || backup_die "OFFSITE_METHOD=rclone needs OFFSITE_RCLONE_REMOTE (remote:path)." ;;
    *) backup_die "OFFSITE_METHOD must be none, rsync or rclone." ;;
  esac
  case "$OFFSITE_ENCRYPTION" in
    age) [[ "$OFFSITE_AGE_RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || backup_die "OFFSITE_AGE_RECIPIENT must be an age public key (age1...)." ;;
    gpg) [[ "$OFFSITE_GPG_RECIPIENT" =~ ^[0-9A-Fa-f]{40}$ ]] || backup_die "OFFSITE_GPG_RECIPIENT must be the 40-character key fingerprint." ;;
    *) backup_die "OFFSITE_ENCRYPTION must be age or gpg; the off-site copy is never unencrypted." ;;
  esac
  [ "$OFFSITE_MAX_PER_RUN" -ge 1 ] || backup_die "OFFSITE_MAX_PER_RUN must be at least 1."
  for key in OFFSITE_RSYNC_TARGET OFFSITE_SSH_KEY OFFSITE_SSH_KNOWN_HOSTS OFFSITE_RCLONE_REMOTE OFFSITE_RCLONE_CONFIG OFFSITE_GPG_HOMEDIR; do
    case "${!key}" in *[[:space:]]*) backup_die "$key must not contain whitespace." ;; esac
  done
}

print_backup_policy() {
  echo "Config     : $BACKUP_CONFIG_SOURCE"
  echo "Backup dir : $BACKUP_DIR"
  echo "Rotation   : $BACKUP_ROTATION (keep $BACKUP_KEEP_DAILY daily, $BACKUP_KEEP_WEEKLY weekly, $BACKUP_KEEP_MONTHLY monthly)"
  if [ "$OFFSITE_METHOD" = none ]; then
    echo "Off-site   : none"
  else
    echo "Off-site   : $OFFSITE_METHOD, encrypted with $OFFSITE_ENCRYPTION, up to $OFFSITE_MAX_PER_RUN per run"
  fi
  echo "Freshness  : newest backup <= ${BACKUP_MAX_AGE_HOURS}h, newest off-site copy <= ${OFFSITE_MAX_AGE_HOURS}h"
}

# ── Backups on disk ──────────────────────────────────────────────────────────

is_backup_name() { [[ "$1" =~ $BACKUP_NAME_RE ]]; }

file_size() { wc -c <"$1" | tr -d '[:space:]'; }

abs_path() {
  local dir
  dir=$(cd -- "$(dirname -- "$1")" && pwd) || return 1
  printf '%s/%s\n' "$dir" "${1##*/}"
}

# Managed backups, newest first (the timestamp sorts lexically).
list_managed_backups() {
  local path name
  for path in "$BACKUP_DIR"/signalpilot_*.dump; do
    name="${path##*/}"
    if [ -f "$path" ] && [ -f "$path.sha256" ] && is_backup_name "$name"; then printf '%s\n' "$name"; fi
  done | sort -r
}

# Correctly named dumps without a checksum, e.g. from before checksums
# existed. Kept forever, never rotated and never uploaded.
list_unmanaged_backups() {
  local path name
  for path in "$BACKUP_DIR"/signalpilot_*.dump; do
    name="${path##*/}"
    if [ -f "$path" ] && [ ! -f "$path.sha256" ] && is_backup_name "$name"; then printf '%s\n' "$name"; fi
  done | sort -r
}

newest_managed_backup() { list_managed_backups | awk 'NR == 1'; }

# ── Checksums ────────────────────────────────────────────────────────────────

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1"
  else
    shasum -a 256 -- "$1"
  fi | awk '{print $1}'
}

# Writes "<sha256>  <name>" (the format `sha256sum -c` reads) for DATA under
# NAME, the final file name, which a temp file does not have yet.
write_checksum_sidecar() {
  local data="$1" name="$2" sidecar="$3" sum
  sum=$(sha256_of "$data") || return 1
  [[ "$sum" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s  %s\n' "$sum" "$name" >"$sidecar"
}

verify_checksum() {
  local file="$1" name expected="" recorded="" actual
  name="${file##*/}"
  if [ ! -f "$file.sha256" ]; then
    echo "  FAIL $name: no .sha256 sidecar" >&2
    return 1
  fi
  read -r expected recorded <"$file.sha256" || true
  if ! [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || [ "$recorded" != "$name" ]; then
    echo "  FAIL $name: malformed or foreign .sha256 sidecar" >&2
    return 1
  fi
  actual=$(sha256_of "$file") || return 1
  if [ "$actual" != "$expected" ]; then
    echo "  FAIL $name: sha256 mismatch, the file changed after it was written" >&2
    return 1
  fi
  echo "  OK   $name sha256 ${expected:0:16}"
}

# ── Archive verification (throwaway container) ───────────────────────────────

# Runs a Postgres client tool on one archive in a throwaway container: no
# network, read-only root, the archive mounted read-only, capped CPU/memory.
run_isolated_pg_tool() {
  local archive="$1"
  shift
  docker run --rm --pull never --network none --read-only \
    --cpus "$BACKUP_VERIFY_CPUS" --memory "$BACKUP_VERIFY_MEMORY" \
    --label signalpilot.backup-verify=1 \
    --volume "$archive:/backup/archive.dump:ro" \
    "$BACKUP_PG_IMAGE" "$@"
}

# The table of contents must list SignalPilot's tables, and every data block
# must decode (pg_restore to /dev/null reads the whole archive).
verify_archive() {
  local archive="$1" name toc table_data
  name="${archive##*/}"
  archive=$(abs_path "$archive") || return 1
  if ! toc=$(run_isolated_pg_tool "$archive" pg_restore --list /backup/archive.dump); then
    echo "  FAIL $name: pg_restore cannot read the archive's table of contents" >&2
    return 1
  fi
  table_data=$(grep -c ' TABLE DATA ' <<<"$toc" || true)
  if [ "$table_data" -lt "$BACKUP_MIN_TABLE_DATA" ]; then
    echo "  FAIL $name: only $table_data tables with data (expected >= $BACKUP_MIN_TABLE_DATA)" >&2
    return 1
  fi
  if ! grep -q ' TABLE DATA public _prisma_migrations ' <<<"$toc"; then
    echo "  FAIL $name: no _prisma_migrations data, not a SignalPilot database" >&2
    return 1
  fi
  if ! run_isolated_pg_tool "$archive" pg_restore --file=/dev/null /backup/archive.dump; then
    echo "  FAIL $name: the data does not decode completely (truncated or corrupt)" >&2
    return 1
  fi
  echo "  OK   $name archive readable ($table_data tables with data)"
}

# ── Rotation ─────────────────────────────────────────────────────────────────

# Day number of a civil date (Howard Hinnant's days_from_civil) and the epoch
# seconds of a backup timestamp YYYYMMDD_HHMMSS. Pure arithmetic, so mawk,
# gawk and BSD awk agree and no GNU `date -d` is needed.
readonly BACKUP_AWK_TIME='
function days_from_civil(y, m, d,    era, yoe, doy, doe) {
  y -= (m <= 2)
  era = int(y / 400)
  yoe = y - era * 400
  doy = int((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1
  doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
  return era * 146097 + doe - 719468
}
function ts_days(ts) { return days_from_civil(substr(ts, 1, 4) + 0, substr(ts, 5, 2) + 0, substr(ts, 7, 2) + 0) }
function ts_epoch(ts) { return ts_days(ts) * 86400 + substr(ts, 10, 2) * 3600 + substr(ts, 12, 2) * 60 + substr(ts, 14, 2) }
'

# One line per managed backup, newest first:
#   KEEP <name> <reasons>      reasons: daily,weekly,monthly,pinned
#   DELETE <name>
# Semantics as restic's --keep-daily/-weekly/-monthly: keep the newest backup
# of each of the last N days (Monday weeks, months) that HAVE a backup. Time
# passing alone never deletes anything; only new backups push old ones out.
# A "<name>.keep" file pins a backup forever.
rotation_plan() {
  local name pinned
  list_managed_backups | while IFS= read -r name; do
    pinned=0
    if [ -e "$BACKUP_DIR/$name.keep" ]; then pinned=1; fi
    printf '%s %s\n' "$name" "$pinned"
  done | awk -v kd="$BACKUP_KEEP_DAILY" -v kw="$BACKUP_KEEP_WEEKLY" -v km="$BACKUP_KEEP_MONTHLY" "$BACKUP_AWK_TIME"'
    {
      ts = substr($1, 13, 15)
      day = substr(ts, 1, 8)
      week = int((ts_days(ts) + 3) / 7)
      month = substr(ts, 1, 6)
      r = ""
      if (!(day in seen_day)) { seen_day[day] = 1; if (n_day < kd) { n_day++; r = r ",daily" } }
      if (!(week in seen_week)) { seen_week[week] = 1; if (n_week < kw) { n_week++; r = r ",weekly" } }
      if (!(month in seen_month)) { seen_month[month] = 1; if (n_month < km) { n_month++; r = r ",monthly" } }
      if ($2 == 1) r = r ",pinned"
      if (r == "") print "DELETE " $1; else print "KEEP " $1 " " substr(r, 2)
    }'
}

# MODE is dry-run or apply. Prints every decision; deletes only in apply.
run_rotation() {
  local mode="$1" plan newest action name reasons kept=0 removed=0
  plan=$(rotation_plan)
  newest=$(newest_managed_backup)
  echo "Rotation ($mode), keep $BACKUP_KEEP_DAILY daily / $BACKUP_KEEP_WEEKLY weekly / $BACKUP_KEEP_MONTHLY monthly:"
  if [ -z "$plan" ]; then
    echo "  no managed backups"
  elif [ -z "$(awk -v n="$newest" '$1 == "KEEP" && $2 == n' <<<"$plan")" ]; then
    backup_die "the rotation plan does not keep the newest backup $newest; nothing deleted."
  fi
  while read -r action name reasons; do
    case "$action" in
      KEEP)
        kept=$((kept + 1))
        echo "  keep         $name ($reasons)"
        ;;
      DELETE)
        removed=$((removed + 1))
        if [ "$mode" != apply ]; then
          echo "  would delete $name"
          continue
        fi
        is_backup_name "$name" || backup_die "refusing to delete unexpected name: $name"
        [ ! -e "$BACKUP_DIR/$name.keep" ] || backup_die "refusing to delete pinned $name"
        # Sidecars first: an interrupted run leaves an unmanaged dump, which is
        # kept forever, never an orphan that still looks managed.
        rm -f -- "$BACKUP_DIR/$name.offsite" "$BACKUP_DIR/$name.sha256"
        rm -f -- "$BACKUP_DIR/$name"
        echo "  deleted      $name"
        ;;
    esac
  done <<<"$plan"
  list_unmanaged_backups | while IFS= read -r name; do
    echo "  untouched    $name (no .sha256, never rotated)"
  done
  if [ "$mode" = apply ]; then
    echo "Rotation done: $kept kept, $removed deleted."
  else
    echo "Rotation plan: $kept kept, $removed would be deleted (dry run, nothing deleted)."
  fi
}

# ── Off-site copy ────────────────────────────────────────────────────────────

offsite_extension() {
  case "$OFFSITE_ENCRYPTION" in
    age) echo age ;;
    gpg) echo gpg ;;
  esac
}

need_command() { command -v "$1" >/dev/null 2>&1 || backup_die "$1 is not installed (needed for the off-site copy)."; }

low_priority() {
  if command -v ionice >/dev/null 2>&1; then
    nice -n 10 ionice -c 2 -n 7 "$@"
  else
    nice -n 10 "$@"
  fi
}

# Tools and the private files the off-site copy needs. The VPS holds only a
# PUBLIC key: it can encrypt, but never decrypt its own off-site copies.
offsite_preflight() {
  case "$OFFSITE_ENCRYPTION" in
    age) need_command age ;;
    gpg)
      need_command gpg
      require_private_path "$OFFSITE_GPG_HOMEDIR" "GnuPG home"
      if gpg --homedir "$OFFSITE_GPG_HOMEDIR" --batch --list-secret-keys --with-colons 2>/dev/null | grep -q '^sec'; then
        backup_die "$OFFSITE_GPG_HOMEDIR holds a secret key. The VPS must only have the public key."
      fi
      gpg --homedir "$OFFSITE_GPG_HOMEDIR" --batch --list-keys --with-colons "$OFFSITE_GPG_RECIPIENT" >/dev/null 2>&1 ||
        backup_die "the public key OFFSITE_GPG_RECIPIENT is not imported into $OFFSITE_GPG_HOMEDIR."
      ;;
  esac
  case "$OFFSITE_METHOD" in
    rsync)
      need_command rsync
      need_command ssh
      require_private_path "$OFFSITE_SSH_KEY" "Off-site SSH key"
      [ -s "$OFFSITE_SSH_KNOWN_HOSTS" ] || backup_die "pin the target's host key in $OFFSITE_SSH_KNOWN_HOSTS first."
      ;;
    rclone)
      need_command rclone
      require_private_path "$OFFSITE_RCLONE_CONFIG" "rclone config"
      ;;
  esac
}

encrypt_for_offsite() {
  local plain="$1" out="$2"
  case "$OFFSITE_ENCRYPTION" in
    age) low_priority age --encrypt --recipient "$OFFSITE_AGE_RECIPIENT" --output "$out" "$plain" ;;
    gpg)
      low_priority gpg --homedir "$OFFSITE_GPG_HOMEDIR" --batch --yes --quiet --no-tty --trust-model always \
        --compress-algo none --recipient "$OFFSITE_GPG_RECIPIENT" --output "$out" --encrypt "$plain"
      ;;
  esac
}

offsite_ssh() {
  printf 'ssh -i %s -p %s -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%s -o ConnectTimeout=30' \
    "$OFFSITE_SSH_KEY" "$OFFSITE_SSH_PORT" "$OFFSITE_SSH_KNOWN_HOSTS"
}

offsite_upload() {
  local local_file="$1" object="$2"
  case "$OFFSITE_METHOD" in
    rsync) low_priority rsync --timeout=600 --perms --chmod=F600 -e "$(offsite_ssh)" -- "$local_file" "${OFFSITE_RSYNC_TARGET%/}/$object" ;;
    rclone) low_priority rclone --config "$OFFSITE_RCLONE_CONFIG" copyto -- "$local_file" "${OFFSITE_RCLONE_REMOTE%/}/$object" ;;
  esac
}

# Size in bytes of an uploaded object, read back from the target.
offsite_remote_size() {
  local object="$1"
  case "$OFFSITE_METHOD" in
    rsync)
      rsync --list-only -e "$(offsite_ssh)" -- "${OFFSITE_RSYNC_TARGET%/}/$object" |
        awk 'NR == 1 { gsub(/[,.]/, "", $2); print $2 }'
      ;;
    rclone) rclone --config "$OFFSITE_RCLONE_CONFIG" lsf --format s -- "${OFFSITE_RCLONE_REMOTE%/}/$object" | awk 'NR == 1' ;;
  esac
}

# Kept backups without a successful off-site copy, newest first. Backups the
# rotation is about to delete are not uploaded.
offsite_pending() {
  local name
  rotation_plan | awk '$1 == "KEEP" { print $2 }' | while IFS= read -r name; do
    if [ ! -e "$BACKUP_DIR/$name.offsite" ]; then printf '%s\n' "$name"; fi
  done | awk -v max="$OFFSITE_MAX_PER_RUN" 'NR <= max'
}

# Encrypts one verified backup, uploads it and its plaintext checksum, reads
# the size back and only then writes the local "<name>.offsite" marker.
offsite_copy_one() {
  local name="$1" staging="$2" object encrypted size remote_size header
  object="$name.$(offsite_extension)"
  encrypted="$staging/$object"
  echo "Off-site: $name"
  verify_checksum "$BACKUP_DIR/$name" || backup_die "not uploading $name: checksum verification failed."
  rm -f -- "$encrypted"
  encrypt_for_offsite "$BACKUP_DIR/$name" "$encrypted" || backup_die "encryption of $name failed."
  [ -s "$encrypted" ] || backup_die "encryption of $name produced no output."
  if cmp -s -- "$BACKUP_DIR/$name" "$encrypted"; then backup_die "the encrypted copy of $name equals the plaintext; not uploading."; fi
  if [ "$OFFSITE_ENCRYPTION" = age ]; then
    header=$(head -c 21 -- "$encrypted")
    [ "$header" = "age-encryption.org/v1" ] || backup_die "the encrypted copy of $name has no age header; not uploading."
  fi
  size=$(file_size "$encrypted")
  offsite_upload "$encrypted" "$object" || backup_die "upload of $object failed."
  # The plaintext checksum goes last: its presence at the target means the
  # encrypted object before it is complete.
  offsite_upload "$BACKUP_DIR/$name.sha256" "$name.sha256" || backup_die "upload of $name.sha256 failed."
  remote_size=$(offsite_remote_size "$object") || backup_die "cannot read $object back from the target."
  [ "$remote_size" = "$size" ] || backup_die "off-site size mismatch for $object (local $size, remote ${remote_size:-missing})."
  printf 'uploadedAt=%s method=%s encryption=%s object=%s bytes=%s sha256=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OFFSITE_METHOD" "$OFFSITE_ENCRYPTION" "$object" "$size" "$(sha256_of "$encrypted")" \
    >"$BACKUP_DIR/$name.offsite.tmp"
  mv -- "$BACKUP_DIR/$name.offsite.tmp" "$BACKUP_DIR/$name.offsite"
  rm -f -- "$encrypted"
  echo "  OK   $object uploaded and read back ($size bytes)"
}

# ── Freshness ────────────────────────────────────────────────────────────────

# Same clock as the file names (backup-postgres.sh uses local time; UTC on the
# VPS). SIGNALPILOT_BACKUP_NOW=YYYYMMDD_HHMMSS pins it for tests.
backup_now() { printf '%s\n' "${SIGNALPILOT_BACKUP_NOW:-$(date +%Y%m%d_%H%M%S)}"; }

backup_age_hours() {
  local ts="${1#signalpilot_}"
  ts="${ts%.dump}"
  awk -v ts="$ts" -v now="$2" "$BACKUP_AWK_TIME"'BEGIN { print int((ts_epoch(now) - ts_epoch(ts)) / 3600) }'
}

# ── Alerts ───────────────────────────────────────────────────────────────────

# Sends the given problems as ONE alert through the existing n8n path: the
# one-off opsWatch container the 10-minute `watch` cron uses
# (trading-shadow.sh), which forwards --container-problem lines to
# N8N_WEBHOOK_SIGNAL_URL unconditionally. Its own throttle file keeps the
# watch throttle untouched; the same problem repeats at most every 6 hours.
send_backup_alert() {
  local state_dir="${SIGNALPILOT_OPS_STATE_DIR:-/var/lib/signalpilot}" problem output delivery
  local args=(--alert --state-file=/state/backup-alert.json)
  for problem in "$@"; do
    problem="${problem//$'\n'/ }"
    echo "ALERT: $problem" >&2
    args+=("--container-problem=$problem")
  done
  require_production_env
  mkdir -p "$state_dir"
  # opsWatch exits 1 whenever it reports a problem, which is always the case
  # here; the delivery field says whether n8n took it. stderr is dropped like
  # every Compose warning on this host (it can quote secret fragments).
  output=$("${COMPOSE[@]}" run --rm --no-deps -T -v "$state_dir:/state" trading-worker \
    node dist/jobs/opsWatch.js "${args[@]}" 2>/dev/null) || true
  delivery=$(sed -n 's/^  "delivery": "\([A-Z0-9_]*\)".*/\1/p' <<<"$output" | tail -n 1)
  case "$delivery" in
    SENT | THROTTLED)
      echo "Alert delivery via n8n: $delivery"
      ;;
    *)
      echo "ERROR: the backup alert was NOT delivered (${delivery:-no delivery reported}). Check N8N_WEBHOOK_SIGNAL_URL and the trading-worker image." >&2
      return 1
      ;;
  esac
}
