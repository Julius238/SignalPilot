#!/usr/bin/env bash
# Step 1.2 of FUNDING_CARRY_FEASIBILITY_V1: downloads exactly the data of §2.1 of the
# frozen preregistration (commit 248b739) into a new, gitignored directory.
# Public sources only: no account, no API key, no terms to accept.
#
#   scripts/research/funding-carry-v1/download_v1.sh <new-empty-data-dir>
#
# - Binance Vision monthly archive (BTCUSDT, ETHUSDT): fundingRate, klines 1h,
#   markPriceKlines 1h, indexPriceKlines 1h, every month the listing shows up to
#   2026-09, each with its .CHECKSUM. A file whose SHA-256 differs from its
#   checksum is downloaded once more (D1).
# - Binance USDⓈ-M REST fundingRate for 2020-01 and 2026-09 (D6 sample).
# - FRED DTB3.
# Requests run one after another with a short pause (the dataset terms forbid
# straining the servers). The data is licensed CC BY-NC-SA 4.0 for
# non-commercial research and must not be redistributed or committed.
set -euo pipefail

DATA="${1:?usage: download_v1.sh <new-empty-data-dir>}"
LAST_MONTH="2026-09"
LISTING="https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
ARCHIVE="https://data.binance.vision"
REST="https://fapi.binance.com/fapi/v1/fundingRate"
FRED="https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3"
PAUSE=0.1

if [ -e "$DATA" ] && [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then
  echo "Refusing: $DATA exists and is not empty." >&2
  exit 1
fi
mkdir -p "$DATA"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)

fetch() { # <url> <target>
  mkdir -p "$(dirname "$2")"
  curl -sS --fail --retry 3 --retry-delay 2 --max-time 120 -o "$2" "$1"
  sleep "$PAUSE"
}

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

month_start_ms() { python3 -I -c 'import calendar, sys; y, m = map(int, sys.argv[1].split("-")); print(calendar.timegm((y, m, 1, 0, 0, 0)) * 1000)' "$1"; }

archives=0
mismatches=0
for symbol in BTCUSDT ETHUSDT; do
  for dataset in fundingRate klines markPriceKlines indexPriceKlines; do
    prefix="data/futures/um/monthly/$dataset/$symbol/"
    if [ "$dataset" != fundingRate ]; then prefix="${prefix}1h/"; fi
    listing=$(curl -sS --fail --max-time 60 "$LISTING?delimiter=/&prefix=$prefix")
    case "$listing" in
      *"<IsTruncated>false</IsTruncated>"*) ;;
      *) echo "Listing of $prefix is truncated or invalid." >&2; exit 1 ;;
    esac
    for key in $(printf '%s' "$listing" | grep -o '<Key>[^<]*\.zip</Key>' | sed -e 's/<Key>//' -e 's#</Key>##'); do
      month=$(printf '%s' "$key" | grep -oE '[0-9]{4}-[0-9]{2}\.zip$' | cut -c1-7)
      if [[ "$month" > "$LAST_MONTH" ]]; then continue; fi
      target="$DATA/binance/${key#data/}"
      fetch "$ARCHIVE/$key" "$target"
      fetch "$ARCHIVE/$key.CHECKSUM" "$target.CHECKSUM"
      expected=$(cut -d' ' -f1 "$target.CHECKSUM")
      if [ "$expected" != "$(sha "$target")" ]; then
        fetch "$ARCHIVE/$key" "$target"
        if [ "$expected" != "$(sha "$target")" ]; then
          echo "Checksum still differs after one reload: $key" >&2
          mismatches=$((mismatches + 1))
        fi
      fi
      archives=$((archives + 1))
    done
    echo "$dataset $symbol done"
  done
done

for symbol in BTCUSDT ETHUSDT; do
  for month in 2020-01 2026-09; do
    start=$(month_start_ms "$month")
    year=${month%-*}; number=$((10#${month#*-}))
    if [ "$number" -eq 12 ]; then next="$((year + 1))-01"; else next=$(printf '%s-%02d' "$year" "$((number + 1))"); fi
    end=$(( $(month_start_ms "$next") - 1 ))
    fetch "$REST?symbol=$symbol&startTime=$start&endTime=$end&limit=1000" "$DATA/binance/rest/fundingRate-$symbol-$month.json"
  done
done

fetch "$FRED" "$DATA/fred/DTB3.csv"
finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$DATA/sources.json" <<EOF
{
  "study": "FUNDING_CARRY_FEASIBILITY_V1",
  "step": "1.2",
  "preregistration": { "commit": "248b739", "blob": "9b00cc9232efac8755496259cc9ff734d5620774" },
  "retrieved": { "from": "$started", "to": "$finished" },
  "sources": [
    { "name": "Binance Vision monthly archive", "base": "$ARCHIVE", "listing": "$LISTING", "symbols": ["BTCUSDT", "ETHUSDT"],
      "datasets": ["fundingRate", "klines/1h", "markPriceKlines/1h", "indexPriceKlines/1h"], "lastMonth": "$LAST_MONTH",
      "archives": $archives, "checksumMismatchesAfterReload": $mismatches,
      "license": "CC BY-NC-SA 4.0 and binance-public-data TERMS_AND_CONDITIONS (non-commercial research, no redistribution)" },
    { "name": "Binance USDⓈ-M REST fundingRate (D6 sample)", "endpoint": "$REST", "samples": ["BTCUSDT 2020-01", "BTCUSDT 2026-09", "ETHUSDT 2020-01", "ETHUSDT 2026-09"] },
    { "name": "FRED DTB3", "url": "$FRED" }
  ]
}
EOF

(cd "$DATA" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 shasum -a 256) > "$DATA/manifest.sha256"
echo "Archives: $archives, checksum mismatches after reload: $mismatches, files in manifest: $(wc -l < "$DATA/manifest.sha256" | tr -d ' ')"
