#!/usr/bin/env bash
# Step 1.2 of FUNDING_CARRY_FEASIBILITY_V2 (preregistration V2 §3, commit 2f75ef0):
#
#   scripts/research/funding-carry-v2/download_v2.sh <v1-data-dir> <new-empty-v2-dir> [--dry-run] [--expected-v1-manifest <sha256>]
#
# 1. Checks the V1 manifest against its frozen SHA-256 (V2 §3) and copies exactly the
#    files it lists into the new directory; every copy is verified against it.
#    Nothing is downloaded again; V1's manifest and sources stay as *-v1 files.
# 2. Determines the needed daily files with `funding_carry_v2.py plan-daily`: the UTC
#    days missing entirely from a monthly kline file (timestamps only, V2 §1).
# 3. Downloads exactly those daily files with their .CHECKSUM, one after another with a
#    pause. An existing file is never overwritten; a file whose SHA-256 differs from its
#    checksum is downloaded once more (D1).
# 4. Writes sources.json and manifest.sha256 of the V2 directory.
#
# --dry-run stops after step 2 and prints the planned URLs: no network access at all.
# The data is licensed CC BY-NC-SA 4.0 for non-commercial research; never commit it.
set -euo pipefail

usage="usage: download_v2.sh <v1-data-dir> <new-empty-v2-dir> [--dry-run] [--expected-v1-manifest <sha256>]"
V1="${1:?$usage}"
V2="${2:?$usage}"
shift 2
DRY_RUN=0
EXPECTED_V1_MANIFEST="c1d349467279355b525a003c74371aab60457fe63bab7a7e4ff06d2f12138908"  # V2 §3
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --expected-v1-manifest) EXPECTED_V1_MANIFEST="${2:?$usage}"; shift 2 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
ARCHIVE="https://data.binance.vision"
PAUSE=0.1

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

fetch() { # <url> <target>; never overwrites
  if [ -e "$2" ]; then echo "Refusing to overwrite $2." >&2; exit 1; fi
  mkdir -p "$(dirname "$2")"
  curl -sS --fail --retry 3 --retry-delay 2 --max-time 120 -o "$2" "$1"
  sleep "$PAUSE"
}

[ -f "$V1/manifest.sha256" ] || { echo "No manifest.sha256 in $V1." >&2; exit 1; }
if [ "$(sha "$V1/manifest.sha256")" != "$EXPECTED_V1_MANIFEST" ]; then
  echo "The V1 manifest differs from the frozen SHA-256 $EXPECTED_V1_MANIFEST." >&2
  exit 1
fi
if [ -e "$V2" ] && [ -n "$(ls -A "$V2" 2>/dev/null)" ]; then
  echo "Refusing: $V2 exists and is not empty." >&2
  exit 1
fi
mkdir -p "$V2"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 1. Copy exactly the files listed in the V1 manifest, then verify every copy.
copied=0
while IFS= read -r line; do
  relative="${line#*  ./}"
  mkdir -p "$V2/$(dirname "$relative")"
  cp -p "$V1/$relative" "$V2/$relative"
  copied=$((copied + 1))
done < "$V1/manifest.sha256"
cp -p "$V1/manifest.sha256" "$V2/manifest-v1.sha256"
if ! (cd "$V2" && shasum -a 256 -c --quiet manifest-v1.sha256); then
  echo "A copied V1 file differs from the V1 manifest; aborting." >&2
  exit 1
fi
if [ -f "$V2/sources.json" ]; then mv "$V2/sources.json" "$V2/sources-v1.json"; fi
echo "Copied and verified $copied V1 files."

# 2. Plan: days missing entirely from a monthly kline file.
plan=$(python3 -I "$HERE/funding_carry_v2.py" plan-daily --data "$V2")
needed=$(printf '%s' "$plan" | grep -c . || true)
echo "Daily files needed: $needed"
urls=()
targets=()
while IFS=$'\t' read -r dataset symbol day; do
  [ -n "${dataset:-}" ] || continue
  key="data/futures/um/daily/$dataset/$symbol/1h/$symbol-1h-$day.zip"
  urls+=("$ARCHIVE/$key")
  targets+=("$V2/binance/${key#data/}")
done <<< "$plan"
for url in "${urls[@]+"${urls[@]}"}"; do echo "PLAN $url"; done
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: nothing downloaded."
  exit 0
fi

# 3. Download exactly the planned daily files.
mismatches=0
index=0
while [ "$index" -lt "${#urls[@]}" ]; do  # bash 3.2 (macOS): no "${!array[@]}" on empty arrays under set -u
  url="${urls[$index]}"
  target="${targets[$index]}"
  fetch "$url" "$target"
  fetch "$url.CHECKSUM" "$target.CHECKSUM"
  expected=$(cut -d' ' -f1 "$target.CHECKSUM")
  if [ "$expected" != "$(sha "$target")" ]; then
    rm -f "$target"  # only the file this run just downloaded
    fetch "$url" "$target"
    if [ "$expected" != "$(sha "$target")" ]; then
      echo "Checksum still differs after one reload: $url" >&2
      mismatches=$((mismatches + 1))
    fi
  fi
  index=$((index + 1))
done
finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 4. Provenance of the V2 directory.
cat > "$V2/sources.json" <<EOF
{
  "study": "FUNDING_CARRY_FEASIBILITY_V2",
  "step": "1.2",
  "preregistration": { "commit": "2f75ef0", "blob": "0bc948df03807b0ba9884dd50934de027d1f9fa4" },
  "retrieved": { "from": "$started", "to": "$finished" },
  "v1Files": { "copiedFrom": "$V1", "manifestSha256": "$EXPECTED_V1_MANIFEST", "files": $copied },
  "dailyFiles": { "source": "$ARCHIVE/data/futures/um/daily/", "needed": $needed, "checksumMismatchesAfterReload": $mismatches },
  "license": "CC BY-NC-SA 4.0 and binance-public-data TERMS_AND_CONDITIONS (non-commercial research, no redistribution)"
}
EOF
(cd "$V2" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 shasum -a 256) > "$V2/manifest.sha256"
echo "Daily files: $needed, checksum mismatches after reload: $mismatches, files in manifest: $(wc -l < "$V2/manifest.sha256" | tr -d ' ')"
