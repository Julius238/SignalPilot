#!/usr/bin/env bash
set -euo pipefail

# Behavioural tests of backup.sh, _backup.sh and backup-postgres.sh. The real
# scripts run in a sandbox repo with stub docker/age/gpg/rsync/rclone on PATH:
# no container starts, nothing leaves the machine, and no real backup
# directory or config is touched. Called by test-ops-scripts.sh.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# ── Static checks ────────────────────────────────────────────────────────────

# pg_restore must be the version of the production server.
compose_image=$(awk '/^  postgres:/ { f = 1; next } f && /image:/ { print $2; exit }' docker-compose.prod.yml)
[ -n "$compose_image" ] || fail "cannot read the postgres image from docker-compose.prod.yml"
grep -qF "SIGNALPILOT_BACKUP_PG_IMAGE:-$compose_image}" scripts/ops/_backup.sh ||
  fail "_backup.sh does not default to the compose postgres image $compose_image"

# Alerts only through n8n (opsWatch), never the Telegram API, with their own
# throttle file so the 10-minute watch throttle stays untouched.
backup_scripts=(scripts/ops/backup.sh scripts/ops/_backup.sh scripts/ops/backup-postgres.sh)
if grep -niE 'api\.telegram\.org|telegram_bot|bot[0-9]+:|sendMessage' "${backup_scripts[@]}"; then
  fail "a backup script talks to Telegram directly"
fi
grep -qF 'node dist/jobs/opsWatch.js' scripts/ops/_backup.sh || fail "backup alerts do not use opsWatch"
grep -qF -- '--state-file=/state/backup-alert.json' scripts/ops/_backup.sh || fail "backup alerts lack their own throttle file"
if grep -qF 'ops-watch.json' "${backup_scripts[@]}"; then fail "backup alerts would reset the watch throttle"; fi

# The restore path must never reach Compose (and so never the production
# postgres container).
restore_probe_dir=$(mktemp -d)
trap 'rm -rf "$restore_probe_dir"' EXIT
awk '/^(cmd_restore_test|wait_for_restore_db|assert_throwaway_container)\(\) \{/ { f = 1 } f { print } f && /^\}/ { f = 0 }' \
  scripts/ops/backup.sh >"$restore_probe_dir/restore.sh"
grep -q 'pg_restore' "$restore_probe_dir/restore.sh" || fail "could not extract the restore-test functions"
uses_compose() { grep -qE 'COMPOSE|compose' "$1"; }
if uses_compose "$restore_probe_dir/restore.sh"; then fail "the restore test uses Compose"; fi
# Negative control: the check must catch a restore aimed at the production container.
{
  cat "$restore_probe_dir/restore.sh"
  echo '  "${COMPOSE[@]}" exec -T postgres pg_restore --clean /restore/archive.dump'
} >"$restore_probe_dir/mutated.sh"
uses_compose "$restore_probe_dir/mutated.sh" || fail "the compose check cannot detect a production restore; it is worthless"

# ── Sandbox ──────────────────────────────────────────────────────────────────

sandbox=$(mktemp -d)
trap 'rm -rf "$restore_probe_dir" "$sandbox"' EXIT
ops="$sandbox/repo/scripts/ops"
bdir="$sandbox/backups"
remote="$sandbox/remote"
config="$sandbox/etc/backup.env"
log="$sandbox/calls.log"
mkdir -p "$ops" "$sandbox/bin" "$sandbox/state" "$sandbox/etc"
cp scripts/ops/_common.sh scripts/ops/_backup.sh scripts/ops/backup.sh scripts/ops/backup-postgres.sh "$ops/"
: >"$sandbox/repo/.env.production"
: >"$sandbox/repo/docker-compose.prod.yml"

cat >"$sandbox/bin/docker" <<'STUB'
#!/usr/bin/env bash
# Stub docker: logs every call, answers the calls the backup scripts make and
# fails loudly on anything else.
printf '%s\n' "$*" >>"$FAKE_LOG"
toc() {
  local i
  printf '1; 0 0 TABLE public _prisma_migrations signalpilot\n'
  for i in $(seq 1 "${FAKE_TOC_TABLES:-12}"); do printf '%s; 0 0 TABLE DATA public Table%s signalpilot\n' "$((100 + i))" "$i"; done
  if [ "${FAKE_TOC_NO_PRISMA:-0}" != 1 ]; then printf '99; 0 0 TABLE DATA public _prisma_migrations signalpilot\n'; fi
}
case " $* " in
  *" compose "*" config --quiet "*) exit 0 ;;
  *" compose "*" ps "*) echo fake-postgres-id ;;
  *" compose "*" exec -T postgres sh -c "*) printf 'signalpilot' ;;
  *" compose "*" exec -T postgres pg_dump "*)
    if [ "${FAKE_DUMP_FAIL:-0}" = 1 ]; then exit 1; fi
    head -c "${FAKE_DUMP_BYTES:-4096}" /dev/zero | tr '\0' 'x'
    ;;
  *" compose "*" run --rm --no-deps -T "*" trading-worker node dist/jobs/opsWatch.js "*)
    printf '{\n  "ok": false,\n  "delivery": "%s"\n}\n' "${FAKE_ALERT_DELIVERY:-SENT}"
    exit 1
    ;;
  *" run --rm --pull never --network none --read-only "*" pg_restore --list "*)
    if [ "${FAKE_TOC_FAIL:-0}" = 1 ]; then exit 1; fi
    toc
    ;;
  *" run --rm --pull never --network none --read-only "*" pg_restore --file=/dev/null "*)
    if [ "${FAKE_DATA_FAIL:-0}" = 1 ]; then exit 1; fi
    ;;
  *" run --detach --pull never --name signalpilot-restore-test-"*" --network none "*) echo fake-container-id ;;
  *" inspect --format "*) printf '%s\n' "${FAKE_INSPECT:-1 none}" ;;
  *" exec signalpilot-restore-test-"*" pg_isready "*) exit 0 ;;
  *" exec signalpilot-restore-test-"*" pg_restore "*) if [ "${FAKE_RESTORE_FAIL:-0}" = 1 ]; then exit 1; fi ;;
  *" exec -i signalpilot-restore-test-"*" psql "*)
    cat >/dev/null
    printf 'tables %s\nmigrations 31\nlatest_migration 20261015120000_add_evolution_engine\nrows:Portfolio 2\n' "${FAKE_TABLES:-72}"
    ;;
  *" rm --force --volumes signalpilot-restore-test-"*) exit 0 ;;
  *)
    echo "stub docker: unexpected call: $*" >&2
    exit 97
    ;;
esac
STUB

cat >"$sandbox/bin/age" <<'STUB'
#!/usr/bin/env bash
# Stub age: writes the real header followed by the input.
printf '%s\n' "age $*" >>"$FAKE_LOG"
out=""
in=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output | --recipient) [ "$1" = --output ] && out="$2"; shift 2 ;;
    --encrypt) shift ;;
    *) in="$1"; shift ;;
  esac
done
case "${FAKE_ENCRYPT:-ok}" in
  ok) { printf 'age-encryption.org/v1\n'; cat "$in"; } >"$out" ;;
  noop) cp "$in" "$out" ;;
  noheader) { printf 'not-age\n'; cat "$in"; } >"$out" ;;
  fail) exit 1 ;;
esac
STUB

cat >"$sandbox/bin/gpg" <<'STUB'
#!/usr/bin/env bash
# Stub gpg: knows the recipient's public key; a secret key only on request.
printf '%s\n' "gpg $*" >>"$FAKE_LOG"
case " $* " in
  *" --list-secret-keys "*) if [ "${FAKE_GPG_SECRET:-0}" = 1 ]; then echo 'sec:u:255:22:ABCDEF:::'; fi ;;
  *" --list-keys "*) exit 0 ;;
  *" --encrypt "*)
    out=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --output ]; then out="$2"; shift 2; else in="$1"; shift; fi
    done
    if [ "${FAKE_ENCRYPT:-ok}" = noop ]; then cp "$in" "$out"; else { printf '\205fake-gpg-packet\n'; cat "$in"; } >"$out"; fi
    ;;
  *) exit 2 ;;
esac
STUB

cat >"$sandbox/bin/rsync" <<'STUB'
#!/usr/bin/env bash
# Stub rsync: "uploads" into $FAKE_REMOTE; --list-only prints rsync's format
# with digit grouping (171,008,468).
printf '%s\n' "rsync $*" >>"$FAKE_LOG"
if [ "${FAKE_RSYNC_FAIL:-0}" = 1 ]; then exit 23; fi
list=0
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --list-only) list=1; shift ;;
    -e) shift 2 ;;
    --) shift ;;
    -*) shift ;;
    *) args+=("$1"); shift ;;
  esac
done
if [ "$list" = 1 ]; then
  f="$FAKE_REMOTE/${args[0]##*/}"
  [ -f "$f" ] || exit 23
  size=$(wc -c <"$f" | tr -d ' ')
  if [ "${FAKE_REMOTE_SIZE_WRONG:-0}" = 1 ]; then size=$((size + 1)); fi
  grouped=$(awk -v s="$size" 'BEGIN { o = ""; while (length(s) > 3) { o = "," substr(s, length(s) - 2) o; s = substr(s, 1, length(s) - 3) } print s o }')
  printf -- '-rw-------  %s 2026/10/15 03:00:00 %s\n' "$grouped" "${args[0]##*/}"
  exit 0
fi
cp "${args[0]}" "$FAKE_REMOTE/${args[1]##*/}"
STUB

cat >"$sandbox/bin/rclone" <<'STUB'
#!/usr/bin/env bash
# Stub rclone: copyto/lsf against $FAKE_REMOTE.
printf '%s\n' "rclone $*" >>"$FAKE_LOG"
if [ "${FAKE_RCLONE_FAIL:-0}" = 1 ]; then exit 1; fi
cmd=""
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --config | --format) shift 2 ;;
    --) shift ;;
    copyto | lsf) cmd="$1"; shift ;;
    *) args+=("$1"); shift ;;
  esac
done
case "$cmd" in
  copyto) cp "${args[0]}" "$FAKE_REMOTE/${args[1]##*/}" ;;
  lsf) f="$FAKE_REMOTE/${args[0]##*/}"; if [ -f "$f" ]; then wc -c <"$f" | tr -d ' '; fi ;;
esac
STUB
chmod +x "$sandbox/bin/"*

export SIGNALPILOT_BACKUP_DIR="$bdir"
export SIGNALPILOT_BACKUP_CONFIG="$config"
export SIGNALPILOT_OPS_STATE_DIR="$sandbox/state"
export FAKE_LOG="$log"
export FAKE_REMOTE="$remote"

# Runs a command in the sandbox with the stubs first on PATH; sets $out and $rc.
sb() {
  set +e
  out=$(cd "$sandbox" && PATH="$sandbox/bin:$PATH" "$@" 2>&1)
  rc=$?
  set -e
}
backup() { sb bash "$ops/backup.sh" "$@"; }
# Same with extra environment: backup_env FAKE_X=1 -- <args>
backup_env() {
  local vars=()
  while [ "$1" != -- ]; do vars+=("$1"); shift; done
  shift
  sb env "${vars[@]}" bash "$ops/backup.sh" "$@"
}

show() { printf '%s\n' "--- output ---" "$out" "--------------" >&2; }
expect_ok() { [ "$rc" -eq 0 ] || { show; fail "$1 (exit $rc)"; }; }
expect_fail() { [ "$rc" -ne 0 ] || { show; fail "$1 (succeeded)"; }; }
expect_out() { grep -qF -- "$1" <<<"$out" || { show; fail "$2: output lacks '$1'"; }; }
expect_no_out() { ! grep -qF -- "$1" <<<"$out" || { show; fail "$2: output contains '$1'"; }; }
expect_log() { grep -qF -- "$1" "$log" || { cat "$log" >&2; fail "$2: no call with '$1'"; }; }
expect_no_log() { ! grep -qF -- "$1" "$log" || { cat "$log" >&2; fail "$2: unexpected call with '$1'"; }; }

reset() {
  rm -rf "$bdir" "$remote" "$config" "$sandbox/state"
  mkdir -p "$bdir" "$remote" "$sandbox/state"
  : >"$log"
}

sidecar() {
  local dir="$1" name="$2" sum
  if command -v sha256sum >/dev/null 2>&1; then sum=$(sha256sum "$dir/$name"); else sum=$(shasum -a 256 "$dir/$name"); fi
  printf '%s  %s\n' "${sum%% *}" "$name" >"$dir/$name.sha256"
}

# seed <YYYYMMDD_HHMMSS> [bytes]: a managed backup (dump + sidecar).
seed() {
  head -c "${2:-4096}" /dev/zero | tr '\0' 'x' >"$bdir/signalpilot_$1.dump"
  sidecar "$bdir" "signalpilot_$1.dump"
}

write_config() {
  printf '%s\n' "$@" >"$config"
  chmod 600 "$config"
}

# Correctly named dumps in the backup directory, newest first, one line.
managed() {
  local path
  for path in "$bdir"/signalpilot_*.dump; do
    if [[ "${path##*/}" =~ ^signalpilot_[0-9]{8}_[0-9]{6}\.dump$ ]]; then printf '%s\n' "${path##*/}"; fi
  done | sort -r | tr '\n' ' '
}

age_recipient="age1$(printf '%058d' 0 | tr 0 q)"

# ── Rotation policy ──────────────────────────────────────────────────────────

reset
for spec in 07:31 08:31 09:30 10:15; do
  for d in $(seq -w 1 "${spec##*:}"); do seed "2026${spec%%:*}${d}_030000"; done
done
touch "$bdir/signalpilot_20260701_030000.dump.keep"
head -c 100 /dev/zero >"$bdir/signalpilot_20260601_120000.dump" # from before checksums
head -c 100 /dev/zero >"$bdir/pre-data-quality-20260724-175809.sql"
head -c 100 /dev/zero >"$bdir/signalpilot_20261014_030500.dump.unverified"
before=$(ls "$bdir" | wc -l)

backup rotate
expect_ok "rotate dry run"
expect_out "Rotation plan: 12 kept, 95 would be deleted (dry run, nothing deleted)." "dry-run summary"
expect_out "untouched    signalpilot_20260601_120000.dump (no .sha256, never rotated)" "unmanaged dump listed"
[ "$(ls "$bdir" | wc -l)" -eq "$before" ] || fail "rotate without --apply deleted files"

expected_keep="20261015_030000:daily,weekly,monthly 20261014_030000:daily 20261013_030000:daily
20261012_030000:daily 20261011_030000:daily,weekly 20261010_030000:daily 20261009_030000:daily
20261004_030000:weekly 20260930_030000:monthly 20260927_030000:weekly 20260831_030000:monthly
20260701_030000:pinned"
actual_keep=$(sed -n 's/^  keep  *signalpilot_\([0-9_]*\)\.dump (\(.*\))$/\1:\2/p' <<<"$out" | tr '\n' ' ')
[ "$actual_keep" = "$(echo $expected_keep) " ] || fail "retention set differs: $actual_keep"

backup rotate --apply
expect_ok "rotate --apply"
expect_out "Rotation done: 12 kept, 95 deleted." "apply summary"
[ "$(managed)" = "signalpilot_20261015_030000.dump signalpilot_20261014_030000.dump signalpilot_20261013_030000.dump signalpilot_20261012_030000.dump signalpilot_20261011_030000.dump signalpilot_20261010_030000.dump signalpilot_20261009_030000.dump signalpilot_20261004_030000.dump signalpilot_20260930_030000.dump signalpilot_20260927_030000.dump signalpilot_20260831_030000.dump signalpilot_20260701_030000.dump signalpilot_20260601_120000.dump " ] ||
  fail "unexpected backups after rotation: $(managed)"
for f in signalpilot_20260601_120000.dump pre-data-quality-20260724-175809.sql signalpilot_20261014_030500.dump.unverified signalpilot_20260701_030000.dump.keep; do
  [ -e "$bdir/$f" ] || fail "rotation removed $f, which it must never touch"
done
[ ! -e "$bdir/signalpilot_20261008_030000.dump.sha256" ] || fail "rotation left the sidecar of a deleted backup"
backup rotate --apply
expect_out "Rotation done: 12 kept, 0 deleted." "rotation is idempotent"

# Time passing alone deletes nothing: three old backups on three days stay.
reset
seed 20260101_030000
seed 20260102_030000
seed 20260105_030000
backup rotate --apply
expect_out "Rotation done: 3 kept, 0 deleted." "old backups without newer ones stay"

# Same day twice: only the newer of the day is the daily one.
reset
seed 20261014_030000
seed 20261015_030000
seed 20261015_120000
write_config BACKUP_KEEP_DAILY=2 BACKUP_KEEP_WEEKLY=0 BACKUP_KEEP_MONTHLY=0
backup rotate --apply
[ "$(managed)" = "signalpilot_20261015_120000.dump signalpilot_20261014_030000.dump " ] || fail "same-day rotation: $(managed)"

# Negative control: the tightest policy still keeps the newest backup.
reset
seed 20261001_030000
seed 20261015_030000
write_config BACKUP_KEEP_DAILY=1 BACKUP_KEEP_WEEKLY=0 BACKUP_KEEP_MONTHLY=0
backup rotate --apply
[ "$(managed)" = "signalpilot_20261015_030000.dump " ] || fail "tightest policy: $(managed)"

# ── Config ───────────────────────────────────────────────────────────────────

reset
backup rotate
expect_out "Rotation (dry-run)" "no config means dry run"

write_config BACKUP_ROTATION=apply
chmod 640 "$config"
backup rotate --apply
expect_fail "group-readable config accepted"
expect_out "must not be accessible by group or others" "config permission message"

write_config BACKUP_KEEP_DAYLY=7
backup rotate
expect_fail "unknown key accepted"
expect_out "unknown key BACKUP_KEEP_DAYLY" "unknown key message"

write_config BACKUP_ROTATION=canary-value-4711
backup rotate
expect_fail "invalid BACKUP_ROTATION accepted"
expect_no_out "canary-value-4711" "config values are never echoed"

write_config OFFSITE_METHOD=rsync OFFSITE_RSYNC_TARGET=u1@box:sp OFFSITE_AGE_RECIPIENT=AGE-SECRET-KEY-1CANARYSECRET
backup rotate
expect_fail "private age key accepted"
expect_out "PRIVATE age key" "private key message"
expect_no_out "CANARYSECRET" "a private key is never echoed"

write_config OFFSITE_METHOD=rsync OFFSITE_RSYNC_TARGET=u1@box:sp OFFSITE_ENCRYPTION=none
backup rotate
expect_fail "unencrypted off-site accepted"
expect_out "never unencrypted" "encryption required"

write_config "# comment" "" "BACKUP_ROTATION='apply'" 'BACKUP_KEEP_DAILY="5"'
backup rotate
expect_ok "quoted values and comments"
expect_out "Rotation (dry-run), keep 5 daily" "plain rotate stays a dry run even with BACKUP_ROTATION=apply"

# ── backup-postgres.sh ───────────────────────────────────────────────────────

reset
sb bash "$ops/backup-postgres.sh"
expect_ok "backup-postgres.sh"
new=$(managed)
new="${new% }"
[ -n "$new" ] && [ -f "$bdir/$new.sha256" ] || fail "no managed backup with sidecar: $(ls "$bdir")"
(cd "$bdir" && if command -v sha256sum >/dev/null 2>&1; then sha256sum -c "$new.sha256"; else shasum -a 256 -c "$new.sha256"; fi) >/dev/null ||
  fail "the sidecar does not verify with sha256sum -c"
expect_log "exec -T postgres pg_dump -U signalpilot -Fc signalpilot" "dump via compose exec"
expect_log "run --rm --pull never --network none --read-only" "archive read in a throwaway container"
expect_log ":/backup/archive.dump:ro" "archive mounted read-only"
expect_log "pg_restore --file=/dev/null /backup/archive.dump" "full data read"
expect_no_log "exec -T postgres pg_restore" "archive checks never use the production container"

reset
sb env FAKE_TOC_NO_PRISMA=1 bash "$ops/backup-postgres.sh"
expect_fail "a dump without _prisma_migrations passed"
expect_out "not a SignalPilot database" "prisma check message"
[ -z "$(managed)" ] || fail "an unverified dump became managed"
ls "$bdir"/signalpilot_*.dump.unverified >/dev/null 2>&1 || fail "the failed dump was not kept as .unverified"

reset
sb env FAKE_DATA_FAIL=1 bash "$ops/backup-postgres.sh"
expect_fail "an undecodable dump passed"
expect_out "does not decode completely" "data check message"
[ -z "$(managed)" ] || fail "an undecodable dump became managed"

reset
sb env FAKE_TOC_TABLES=3 bash "$ops/backup-postgres.sh"
expect_fail "a near-empty dump passed"

# ── verify ───────────────────────────────────────────────────────────────────

reset
seed 20261015_030000
backup verify
expect_ok "verify intact"
expect_out "All 1 backups verified." "verify summary"
printf 'y' | dd of="$bdir/signalpilot_20261015_030000.dump" bs=1 seek=10 conv=notrunc 2>/dev/null
backup verify
expect_fail "a changed backup verified"
expect_out "sha256 mismatch" "mismatch message"

reset
seed 20261015_030000
sed 's/20261015_030000/20261014_030000/' "$bdir/signalpilot_20261015_030000.dump.sha256" >"$sandbox/foreign"
mv "$sandbox/foreign" "$bdir/signalpilot_20261015_030000.dump.sha256"
backup verify
expect_fail "a foreign sidecar verified"
expect_out "malformed or foreign" "foreign sidecar message"

# ── nightly ──────────────────────────────────────────────────────────────────

# Without a config: dump, rotation only planned, no off-site, no alert.
reset
for d in 01 02 03 04 05 06 07 08 09 10; do seed "202610${d}_030000"; done
backup nightly
expect_ok "nightly without config"
expect_out "Rotation plan:" "rotation planned only"
expect_out "Nightly backup OK" "nightly summary"
[ "$(managed | wc -w)" -eq 11 ] || fail "nightly without BACKUP_ROTATION=apply deleted backups"
expect_no_log "opsWatch" "no alert on success"

# One nightly per reset: two in the same second would share a file name.
reset
for d in 01 02 03 04 05 06 07 08 09 10; do seed "202610${d}_030000"; done
seed 20260915_030000
write_config BACKUP_ROTATION=apply
backup nightly
expect_ok "nightly with rotation"
expect_out "Rotation done:" "rotation applied"
[ ! -e "$bdir/signalpilot_20261001_030000.dump" ] || fail "nightly apply kept an expired daily backup"

# Dump failure: one alert through opsWatch with its own throttle file.
reset
: >"$log"
backup_env FAKE_DUMP_FAIL=1 -- nightly
expect_fail "nightly with a failed dump"
expect_out "Alert delivery via n8n: SENT" "alert delivered"
expect_log "run --rm --no-deps -T -v $sandbox/state:/state trading-worker node dist/jobs/opsWatch.js --alert --state-file=/state/backup-alert.json --container-problem=BACKUP_FAILED:" "alert via opsWatch"

backup_env FAKE_DUMP_FAIL=1 FAKE_ALERT_DELIVERY=NO_WEBHOOK_CONFIGURED -- nightly
expect_fail "nightly with a failed dump and no webhook"
expect_out "the backup alert was NOT delivered (NO_WEBHOOK_CONFIGURED)" "undelivered alert reported"

# A shrunken database must not rotate the older, larger backups away.
reset
write_config BACKUP_ROTATION=apply BACKUP_KEEP_DAILY=1 BACKUP_KEEP_WEEKLY=0 BACKUP_KEEP_MONTHLY=0
seed 20261013_030000 100000
seed 20261014_030000 100000
backup_env FAKE_DUMP_BYTES=4000 -- nightly
expect_fail "nightly with a size drop"
expect_log "--container-problem=BACKUP_SIZE_DROP:" "size drop alert"
[ -e "$bdir/signalpilot_20261013_030000.dump" ] || fail "rotation ran despite the size drop"

# An invalid config still takes the dump, deletes nothing and alerts.
reset
seed 20261001_030000
seed 20261002_030000
write_config BACKUP_ROTATION=apply BACKUP_KEEP_DAILY=0
backup nightly
expect_fail "nightly with an invalid config"
expect_log "--container-problem=BACKUP_CONFIG_INVALID:" "config alert"
expect_no_log "BACKUP_ROTATION_FAILED" "rotation attempted with an invalid config"
[ "$(managed | wc -w)" -eq 3 ] || fail "invalid config: dump missing or backups deleted ($(managed))"

# Dry run: no dump, no deletion, no upload, no alert.
reset
seed 20261001_030000
seed 20261002_030000
write_config BACKUP_ROTATION=apply BACKUP_KEEP_DAILY=1 BACKUP_KEEP_WEEKLY=0 BACKUP_KEEP_MONTHLY=0
backup nightly --dry-run
expect_ok "nightly dry run"
expect_out "would delete signalpilot_20261001_030000.dump" "dry run shows the plan"
[ "$(managed | wc -w)" -eq 2 ] || fail "nightly --dry-run changed backups"
expect_no_log "pg_dump" "dry run took a dump"
expect_no_log "opsWatch" "dry run sent an alert"

# ── Off-site copy ────────────────────────────────────────────────────────────

offsite_files() {
  printf 'secret-key-material\n' >"$sandbox/etc/offsite_ed25519"
  chmod 600 "$sandbox/etc/offsite_ed25519"
  printf 'box.example ssh-ed25519 AAAA\n' >"$sandbox/etc/known_hosts"
}
rsync_config() {
  write_config OFFSITE_METHOD=rsync OFFSITE_RSYNC_TARGET=u1@box.example:signalpilot \
    OFFSITE_AGE_RECIPIENT="$age_recipient" OFFSITE_SSH_KEY="$sandbox/etc/offsite_ed25519" \
    OFFSITE_SSH_PORT=23 OFFSITE_SSH_KNOWN_HOSTS="$sandbox/etc/known_hosts" "$@"
}

reset
offsite_files
rsync_config
backup nightly
expect_ok "nightly with rsync + age"
new=$(managed)
new="${new% }"
[ -f "$remote/$new.age" ] && [ -f "$remote/$new.sha256" ] || fail "off-site objects missing: $(ls "$remote")"
[ "$(head -c 21 "$remote/$new.age")" = "age-encryption.org/v1" ] || fail "the off-site object is not age-encrypted"
if cmp -s "$bdir/$new" "$remote/$new.age"; then fail "the off-site object is the plaintext"; fi
cmp -s "$bdir/$new.sha256" "$remote/$new.sha256" || fail "the off-site checksum differs from the local one"
grep -q "^uploadedAt=.* method=rsync encryption=age object=$new.age bytes=[0-9]* sha256=[0-9a-f]\{64\}$" "$bdir/$new.offsite" ||
  fail "bad off-site marker: $(cat "$bdir/$new.offsite")"
if grep -q 'box.example' "$bdir/$new.offsite"; then fail "the marker records the target"; fi
expect_log "-o StrictHostKeyChecking=yes -o UserKnownHostsFile=$sandbox/etc/known_hosts" "host key pinned"
backup offsite
expect_out "every kept backup already has an off-site copy" "off-site is not repeated"

# Upload failure: alert, no marker, local backup intact.
reset
offsite_files
rsync_config
backup_env FAKE_RSYNC_FAIL=1 -- nightly
expect_fail "nightly with a failed upload"
expect_log "--container-problem=BACKUP_OFFSITE_FAILED:" "off-site alert"
new=$(managed)
new="${new% }"
[ -n "$new" ] && [ ! -e "$bdir/$new.offsite" ] || fail "a failed upload left a marker or no backup"

# Size read back differs: no marker.
reset
offsite_files
rsync_config
seed 20261015_030000
backup_env FAKE_REMOTE_SIZE_WRONG=1 -- offsite
expect_fail "off-site with a size mismatch"
expect_out "off-site size mismatch" "size mismatch message"
[ ! -e "$bdir/signalpilot_20261015_030000.dump.offsite" ] || fail "a size mismatch left a marker"

# Negative controls for the encryption guards: nothing is uploaded.
for mode in noop noheader fail; do
  reset
  offsite_files
  rsync_config
  seed 20261015_030000
  backup_env FAKE_ENCRYPT="$mode" -- offsite
  expect_fail "off-site with encryption mode $mode"
  [ -z "$(ls "$remote")" ] || fail "encryption mode $mode uploaded: $(ls "$remote")"
done

# A changed backup is not shipped.
reset
offsite_files
rsync_config
seed 20261015_030000
printf 'y' | dd of="$bdir/signalpilot_20261015_030000.dump" bs=1 seek=10 conv=notrunc 2>/dev/null
backup offsite
expect_fail "off-site of a changed backup"
[ -z "$(ls "$remote")" ] || fail "a changed backup was uploaded"

# Loose permissions on the SSH key are refused.
reset
offsite_files
rsync_config
chmod 644 "$sandbox/etc/offsite_ed25519"
backup offsite --dry-run
expect_fail "group-readable SSH key accepted"
expect_out "Off-site SSH key" "key permission message"

# rclone + gpg; and a secret key on the VPS is refused.
reset
mkdir -m 700 "$sandbox/etc/gnupg"
printf '[box]\ntype = sftp\n' >"$sandbox/etc/rclone.conf"
chmod 600 "$sandbox/etc/rclone.conf"
write_config OFFSITE_METHOD=rclone OFFSITE_RCLONE_REMOTE=box:signalpilot OFFSITE_RCLONE_CONFIG="$sandbox/etc/rclone.conf" \
  OFFSITE_ENCRYPTION=gpg OFFSITE_GPG_RECIPIENT=0123456789ABCDEF0123456789ABCDEF01234567 OFFSITE_GPG_HOMEDIR="$sandbox/etc/gnupg"
seed 20261015_030000
backup offsite
expect_ok "off-site with rclone + gpg"
[ -f "$remote/signalpilot_20261015_030000.dump.gpg" ] || fail "rclone/gpg object missing: $(ls "$remote")"
expect_log "--trust-model always --compress-algo none --recipient 0123456789ABCDEF0123456789ABCDEF01234567" "gpg to the public key"
rm -f "$bdir/signalpilot_20261015_030000.dump.offsite" "$remote/"*
# Negative control: gpg has no header to check, so only the plaintext
# comparison stops a no-op encryption.
backup_env FAKE_ENCRYPT=noop -- offsite
expect_fail "gpg no-op encryption uploaded"
expect_out "equals the plaintext" "plaintext guard"
[ -z "$(ls "$remote")" ] || fail "a plaintext copy was uploaded: $(ls "$remote")"
backup_env FAKE_GPG_SECRET=1 -- offsite
expect_fail "a secret gpg key on the VPS accepted"
expect_out "holds a secret key" "secret key message"

# ── restore-test ─────────────────────────────────────────────────────────────

reset
seed 20261015_030000
: >"$log"
backup restore-test "$bdir/signalpilot_20261015_030000.dump"
expect_ok "restore test"
expect_out "RESTORE TEST PASSED" "restore summary"
expect_log "run --detach --pull never --name signalpilot-restore-test-" "throwaway container"
expect_log "--network none --label signalpilot.restore-test=1" "no network, labelled"
expect_log "--no-owner --no-privileges --exit-on-error /restore/archive.dump" "strict restore"
expect_log "rm --force --volumes signalpilot-restore-test-" "container and volume removed"
expect_no_log "compose" "restore test used Compose"

# Negative control: a container without the label or with a network is refused.
: >"$log"
backup_env "FAKE_INSPECT= bridge" -- restore-test "$bdir/signalpilot_20261015_030000.dump"
expect_fail "restore into an unlabelled container"
expect_out "refusing to restore" "refusal message"
expect_no_log "pg_restore --username" "pg_restore ran despite the refusal"
expect_log "rm --force --volumes signalpilot-restore-test-" "refused container removed"

: >"$log"
backup_env FAKE_TABLES=3 -- restore-test "$bdir/signalpilot_20261015_030000.dump"
expect_fail "restore test with too few tables"

: >"$log"
printf 'y' | dd of="$bdir/signalpilot_20261015_030000.dump" bs=1 seek=10 conv=notrunc 2>/dev/null
backup restore-test "$bdir/signalpilot_20261015_030000.dump"
expect_fail "restore test of a changed backup"
expect_no_log "run --detach" "a changed backup reached a container"

# ── check (dead man's switch) ────────────────────────────────────────────────

reset
seed 20261015_030000
backup_env SIGNALPILOT_BACKUP_NOW=20261015_130000 -- check
expect_ok "fresh backup"
expect_out "(10h old, limit 26h)" "age reported"
expect_no_log "opsWatch" "no alert when fresh"

backup_env SIGNALPILOT_BACKUP_NOW=20261016_093000 -- check
expect_fail "stale backup"
expect_log "--container-problem=BACKUP_STALE:" "stale alert"

: >"$log"
backup_env SIGNALPILOT_BACKUP_NOW=20261016_093000 -- check --no-alert
expect_fail "stale backup without alert"
expect_no_log "opsWatch" "--no-alert sent an alert"

offsite_files
rsync_config
: >"$log"
backup_env SIGNALPILOT_BACKUP_NOW=20261015_130000 -- check
expect_fail "missing off-site copy"
expect_log "--container-problem=BACKUP_OFFSITE_STALE:" "off-site stale alert"

# An invalid config must not silence the dead man's switch.
reset
seed 20261015_030000
write_config BACKUP_KEEP_DAILY=0
backup_env SIGNALPILOT_BACKUP_NOW=20261015_130000 -- check
expect_fail "check with an invalid config"
expect_log "--container-problem=BACKUP_CONFIG_INVALID:" "config alert from check"

# A held lock skips the night, but never silently.
reset
mkdir "$bdir/.backup.lock"
echo "$$" >"$bdir/.backup.lock/pid"
backup nightly
expect_fail "nightly despite a held lock"
expect_log "--container-problem=BACKUP_FAILED: another backup run holds the lock" "lock alert"
expect_no_log "pg_dump" "nightly dumped despite the lock"
rm -rf "$bdir/.backup.lock"

reset
backup check --no-alert
expect_fail "no backup at all"
expect_out "BACKUP_STALE: no verified backup" "empty directory reported"

# ── Command surface ──────────────────────────────────────────────────────────

backup alert-test
expect_ok "alert-test"
expect_log "--container-problem=BACKUP_ALERT_TEST:" "alert-test sends exactly the test problem"
for bad in "unknown" "rotate --force" "nightly --apply" "restore-test" "check --quiet"; do
  # shellcheck disable=SC2086
  backup $bad
  [ "$rc" -eq 2 ] || { show; fail "'backup.sh $bad' was accepted (exit $rc)"; }
done

echo "Backup script checks passed."
