#!/usr/bin/env python3
"""Step 1.2 of RELATIVE_STRENGTH_FEASIBILITY_V1: metadata only, never a price file.

Fetches and checks
  * the S3 listing of data.binance.vision (file names, sizes, .CHECKSUM presence) for
    data/spot/monthly/klines/<SYM>/1d/ of every symbol quoted in USDT, delisted ones included;
  * the current exchangeInfo (only for D0c, never as a historical universe);
  * public Binance announcements for the D0b sample (first three per year 2020-2025
    that end the trading of at least one spot pair quoted in USDT).
Then writes the download plan of step 1.3.

Standard library only; run with ``python3 -I``. The network calls are slow on purpose
(the announcement API answers 429 when asked too often).

Commands:
  listing        --out DIR [--symbols SYM,...]   S3 listing -> DIR/spot-monthly-klines-1d.json
  exchange-info  --out DIR                       USDT symbols and status -> DIR/exchangeInfo.json
  announcements  --out DIR [--cache DIR]         D0b candidates and an automatic pre-sample -> DIR/announcements-d0b*.json
  review-sheet   --out DIR [--cache DIR] [--per-year N]
                                                 fetch the first N candidates per year, write the sheet for the manual review
  d0b-sample     --out DIR --decisions FILE [--cache DIR]
                                                 manual decisions plus an automatic "no" for texts without a USDT pair
                                                 -> DIR/announcements-d0b-review.json, D0b sample -> DIR/announcements-d0b.json
  download-plan  --listing FILE [--out FILE]     files, volume, requests and duration of step 1.3
  gap-check      --plan FILE --out FILE          hourly archive files inside each long gap of a universe member
                                                 (input: `relative_strength_v1.py plan`, key longGapsToCheck)
  d0b-p7         --out DIR --decisions FILE [--cache DIR]
                                                 D0b under the draft precision P7 (report until approved)
                                                 -> DIR/announcements-d0b-p7.json
  snapshots      --out DIR                       archived exchangeInfo captures (Internet Archive), one per month,
                                                 reduced to USDT symbols -> DIR/wayback-exchangeInfo/ (P7 evidence)
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ElementTree
from datetime import datetime, timezone
from pathlib import Path

LISTING_URL = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
ARCHIVE_URL = "https://data.binance.vision"
EXCHANGE_INFO_URL = "https://data-api.binance.vision/api/v3/exchangeInfo"
ARTICLE_LIST_URL = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query"
ARTICLE_DETAIL_URL = "https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query"
ARTICLE_PAGE_URL = "https://www.binance.com/en/support/announcement/{code}"
MONTHLY_PREFIX = "data/spot/monthly/klines/"
HOURLY_DAILY_PREFIX = "data/spot/daily/klines/{symbol}/1h/{symbol}-1h-{month}"
WAYBACK_CDX_URL = "https://web.archive.org/cdx/search/cdx"
WAYBACK_RAW_URL = "https://web.archive.org/web/{timestamp}id_/{original}"
# Binance served the same exchangeInfo under these addresses; the Internet Archive captured each of them now and then.
EXCHANGE_INFO_ORIGINALS = ("www.binance.com/api/v1/exchangeInfo", "api.binance.com/api/v1/exchangeInfo",
                           "api.binance.com/api/v3/exchangeInfo", "www.binance.com/api/v3/exchangeInfo")
S3_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
FIRST_MONTH, LAST_MONTH = "2019-07", "2026-09"  # Vorlauf and window of the preregistration (§4.1)
D0B_YEARS = tuple(range(2020, 2026))
# "New Cryptocurrency Listing" (2020 removals and delistings were filed here), "Latest Binance News" (delistings
# until early 2022), "Maintenance Updates" (token swaps and rebrandings from 2022) and "Delisting" (from 2022-02-17)
CATALOGS = (48, 49, 157, 161)
# "trading pair" catches notices that add pairs and remove others in the same text (2020: BKRW/USDT, DAI/USDT inverted)
TITLE_KEYWORDS = ("delist", "removal", "remove", "cease trading", "swap", "migration", "rebrand", "redenomination", "trading pair")
TITLE_EXCLUDE = ("futures", "margin", "p2p", "staking", "loans", "earn", "options", "convert", "isolated", "cross",
                 "copy trading", "trading bots", "launchpool", "savings", "dual investment", "auto-invest",
                 "liquid swap", "bswap", "liquidity pool", "opens deposits", "completes")
# The text must state an end of trading next to the named pair, not just mention a USDT pair (liquidity pools, new pairs).
REMOVAL_PHRASES = ("delist", "remove", "removal", "cease trading", "close trading", "terminate trading",
                   "no longer be available for trading")
END_PHRASES = REMOVAL_PHRASES + ("halt", "suspend", "stop trading")  # anything that might end trading goes to the manual review
USER_AGENT = "Mozilla/5.0 (SignalPilot research; metadata only)"
D0B_RULE = ("D0b (§4.2), Auslegung: eine Ankündigung zählt, wenn ihr Text das dauerhafte Ende des Spot-Handels "
            "mindestens eines ausdrücklich genannten Paars mit Quote USDT ankündigt. Nicht gezählt: nur Margin- oder "
            "Futures-Paare, Paare mit anderer Quote (etwa USDT/BKRW), neu eröffnete Paare, Handelsstopps mit "
            "Wiedereröffnung unter demselben Symbol (Redenominierungen) und Token-Delistings ohne genannte Paare. "
            "Entscheidung nur aus dem Ankündigungstext, vor dem Abgleich mit dem Archiv.")


class FetchError(Exception):
    pass


def http_get(url: str, pause: float = 0.0, retries: int = 5) -> bytes:
    """GET with a pause before the call and exponential backoff on 429/5xx."""
    wait = 60.0
    for attempt in range(retries):
        time.sleep(pause)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                if response.status == 200 and body:
                    return body
                raise FetchError(f"{url}: HTTP {response.status}, {len(body)} bytes")
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise FetchError(f"{url}: HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError, FetchError) as error:
            if attempt == retries - 1:
                raise FetchError(str(error)) from error
        time.sleep(wait)
        wait *= 2
    raise FetchError(url)


# --- S3 listing ---------------------------------------------------------------------------


def s3_page(xml_bytes: bytes) -> tuple[list[str], list[dict], str | None]:
    """(common prefixes, keys with size and date, next marker) of one ListBucket page."""
    root = ElementTree.fromstring(xml_bytes)
    prefixes = [node.text for node in root.findall("s3:CommonPrefixes/s3:Prefix", S3_NS)]
    keys = [{"key": node.findtext("s3:Key", namespaces=S3_NS), "size": int(node.findtext("s3:Size", namespaces=S3_NS)),
             "lastModified": node.findtext("s3:LastModified", namespaces=S3_NS)} for node in root.findall("s3:Contents", S3_NS)]
    truncated = root.findtext("s3:IsTruncated", namespaces=S3_NS) == "true"
    marker = root.findtext("s3:NextMarker", namespaces=S3_NS) or (keys[-1]["key"] if keys else (prefixes[-1] if prefixes else None))
    return prefixes, keys, marker if truncated else None


def s3_list(prefix: str, fetch=http_get, pause: float = 0.05) -> tuple[list[str], list[dict]]:
    prefixes, keys, marker = [], [], ""
    while True:
        query = {"delimiter": "/", "prefix": prefix}
        if marker:
            query["marker"] = marker
        page_prefixes, page_keys, marker = s3_page(fetch(f"{LISTING_URL}?{urllib.parse.urlencode(query)}", pause))
        prefixes.extend(page_prefixes)
        keys.extend(page_keys)
        if not marker:
            return prefixes, keys


FILE_PATTERN = re.compile(r"^(?P<symbol>[^/]+?)-1d-(?P<month>\d{4}-\d{2})\.zip(?P<checksum>\.CHECKSUM)?$")  # symbols may be non-ASCII


def symbol_files(symbol: str, keys: list[dict]) -> tuple[dict, list[str]]:
    """month -> {size, checksum, lastModified}; plus names that do not follow the archive pattern."""
    files: dict[str, dict] = {}
    odd = []
    for item in keys:
        name = item["key"].rsplit("/", 1)[-1]
        match = FILE_PATTERN.match(name)
        if not match or match.group("symbol") != symbol:
            odd.append(name)
            continue
        entry = files.setdefault(match.group("month"), {"size": None, "checksum": False, "lastModified": None})
        if match.group("checksum"):
            entry["checksum"] = True
        else:
            entry["size"], entry["lastModified"] = item["size"], item["lastModified"]
    return files, odd


def build_listing(fetch=http_get, only: list[str] | None = None) -> dict:
    prefixes, _ = s3_list(MONTHLY_PREFIX, fetch)
    all_symbols = [prefix[len(MONTHLY_PREFIX):].strip("/") for prefix in prefixes]
    usdt = sorted(symbol for symbol in all_symbols if symbol.endswith("USDT") and len(symbol) > 4)
    if only:
        usdt = [symbol for symbol in usdt if symbol in only]
    files, odd = {}, {}
    for symbol in usdt:
        _, keys = s3_list(f"{MONTHLY_PREFIX}{symbol}/1d/", fetch)
        files[symbol], odd_names = symbol_files(symbol, keys)
        if odd_names:
            odd[symbol] = odd_names
    symbols = {symbol: sorted(month for month, entry in months.items() if entry["size"] is not None) for symbol, months in files.items()}
    return {"source": f"{LISTING_URL}?prefix={MONTHLY_PREFIX}<SYM>/1d/", "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "allSpotSymbolsInArchive": len(all_symbols), "symbols": {s: m for s, m in symbols.items() if m}, "files": files,
            "oddNames": odd}


def months_between(first: str, last: str) -> list[str]:
    year, month = int(first[:4]), int(first[5:7])
    result = []
    while f"{year:04d}-{month:02d}" <= last:
        result.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return result


def structure_report(listing: dict) -> dict:
    """Checksums, interior month holes, months outside the window, archive updates (metadata only)."""
    missing_checksum, holes, after_window, modified = [], {}, 0, {}
    for symbol, months in listing["files"].items():
        present = sorted(month for month, entry in months.items() if entry["size"] is not None)
        if not present:
            continue
        for month in present:
            if not months[month]["checksum"]:
                missing_checksum.append(f"{symbol} {month}")
            stamp = (months[month]["lastModified"] or "")[:7]
            modified[stamp] = modified.get(stamp, 0) + 1
        gaps = [month for month in months_between(present[0], present[-1]) if month not in present]
        if gaps:
            holes[symbol] = gaps
        after_window += sum(1 for month in present if month > LAST_MONTH)
    return {"zipFilesWithoutChecksum": missing_checksum, "interiorMonthHoles": holes,
            "symbolsWithInteriorHoles": len(holes), "filesAfterWindow": after_window,
            "lastModifiedByMonth": dict(sorted(modified.items()))}


def shift_month(month: str, delta: int) -> str:
    index = int(month[:4]) * 12 + int(month[5:7]) - 1 + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def gap_check(gaps: list[dict], fetch=http_get) -> list[dict]:
    """Metadata check of long gaps (P7 draft, part c): daily files of the hourly klines inside a gap whose
    daily candles are missing point to an archive error. The months around the gap show whether the hourly
    archive covers that time at all; without any hourly file there the gap is not checkable."""
    results = []
    for gap in gaps:
        symbol, first, last = gap["symbol"], gap["from"], gap["to"]
        inside, around = [], 0
        for month in months_between(shift_month(first[:7], -1), shift_month(last[:7], 1)):
            _, keys = s3_list(HOURLY_DAILY_PREFIX.format(symbol=symbol, month=month), fetch)
            for item in keys:
                name = item["key"].rsplit("/", 1)[-1]
                if not (name.startswith(f"{symbol}-1h-") and name.endswith(".zip")):
                    continue
                day = name[len(symbol) + 4:-4]
                if first <= day <= last:
                    inside.append(day)
                else:
                    around += 1
        verdict = "suspected" if inside else ("consistent" if around else "notCheckable")
        results.append({"symbol": symbol, "from": first, "to": last, "verdict": verdict,
                        "hourlyDaysInGap": sorted(inside), "hourlyFilesAround": around})
    return results


def download_plan(listing: dict, requests_per_second: float = 4.0) -> dict:
    """Monthly 1d files of every USDT symbol for 2019-07..2026-09, with their .CHECKSUM (step 1.3)."""
    files = size = 0
    symbols_in_window, ended, started = 0, {}, {}
    for symbol, months in listing["files"].items():
        in_window = sorted(month for month, entry in months.items() if entry["size"] is not None and FIRST_MONTH <= month <= LAST_MONTH)
        if not in_window:
            continue
        symbols_in_window += 1
        files += len(in_window)
        size += sum(months[month]["size"] for month in in_window)
        all_months = sorted(month for month, entry in months.items() if entry["size"] is not None)
        if all_months[-1] < LAST_MONTH:
            ended[all_months[-1][:4]] = ended.get(all_months[-1][:4], 0) + 1
        started[in_window[0][:4]] = started.get(in_window[0][:4], 0) + 1
    requests = 2 * files
    return {"window": [FIRST_MONTH, LAST_MONTH], "usdtSymbolsInArchive": len(listing["files"]),
            "usdtSymbolsWithFilesInWindow": symbols_in_window, "monthlyFiles": files, "checksumFiles": files,
            "requests": requests, "zipBytes": size, "zipMegabytes": round(size / 1e6, 1),
            "durationMinutesAtRate": round(requests / requests_per_second / 60, 1), "requestsPerSecond": requests_per_second,
            "symbolsEndingBeforeWindowEndByYear": dict(sorted(ended.items())),
            "symbolsStartingByYear": dict(sorted(started.items())),
            "notIncluded": ["daily files for E1 (only after the monthly download, from `plan`)",
                            "daily files for D12 (jump days of universe members, at most 100)",
                            "DTB3 and benchmark file (local copies from the carry, checked against its manifest)"]}


# --- exchangeInfo (D0c only) ----------------------------------------------------------------


def wayback_index(fetch=http_get, first: str = "201910", last: str = "202512") -> dict[str, list[dict]]:
    """Archived exchangeInfo captures with HTTP 200 over all addresses, grouped by month in capture order."""
    rows = []
    for original in EXCHANGE_INFO_ORIGINALS:
        query = urllib.parse.urlencode({"url": original, "from": first, "to": last, "output": "json",
                                        "fl": "timestamp,original,digest", "filter": "statuscode:200"})
        table = json.loads(fetch(f"{WAYBACK_CDX_URL}?{query}", 2.0) or b"[]")
        rows.extend(dict(zip(table[0], row)) for row in table[1:])
    by_month: dict[str, list[dict]] = {}
    for row in sorted(rows, key=lambda item: item["timestamp"]):
        by_month.setdefault(row["timestamp"][:6], []).append(row)
    return by_month


def reduce_snapshot(raw: bytes, row: dict) -> dict:
    """USDT symbols of one archived capture. Binance's own serverTime dates the content; the capture time
    of the Internet Archive is kept next to it."""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    document = json.loads(raw)
    server_time = document.get("serverTime")
    return {"captured": row["timestamp"], "original": row["original"],
            "archiveUrl": WAYBACK_RAW_URL.format(timestamp=row["timestamp"], original=row["original"]),
            "rawSha256": hashlib.sha256(raw).hexdigest(),
            "serverTime": datetime.fromtimestamp(server_time / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if server_time else None,
            "symbols": {item["symbol"]: [item["baseAsset"], item["status"]] for item in document.get("symbols", [])
                        if item.get("quoteAsset") == "USDT"}}


def fetch_snapshots(out: Path, fetch=http_get) -> list[dict]:
    """The first usable capture of every month (cached by capture time). Some captures are cut off at 1 MiB;
    those are listed as unusable and the next capture of the month is tried."""
    folder = out / "wayback-exchangeInfo"
    folder.mkdir(parents=True, exist_ok=True)
    index = []
    for month, rows in sorted(wayback_index(fetch).items()):
        reduced = None
        for row in rows:
            path = folder / f"{row['timestamp']}.json"
            if path.exists():
                reduced = json.loads(path.read_text(encoding="utf-8"))
                break
            try:
                reduced = reduce_snapshot(fetch(WAYBACK_RAW_URL.format(timestamp=row["timestamp"], original=row["original"]), 2.0), row)
            except (FetchError, ValueError) as error:
                index.append({"captured": row["timestamp"], "original": row["original"], "unusable": str(error)[:200]})
                continue
            path.write_text(json.dumps(reduced, indent=1), encoding="utf-8")
            break
        if reduced is None:
            continue
        index.append({key: reduced[key] for key in ("captured", "original", "archiveUrl", "rawSha256", "serverTime")}
                     | {"usdtSymbols": len(reduced["symbols"]), "trading": sum(1 for _, status in reduced["symbols"].values() if status == "TRADING")})
    (out / "wayback-exchangeInfo.json").write_text(json.dumps({"source": WAYBACK_CDX_URL, "fetchedAt": datetime.now(timezone.utc).isoformat(),
                                                               "captures": index}, indent=1), encoding="utf-8")
    return index



def reduce_exchange_info(raw: bytes) -> dict:
    document = json.loads(raw)
    symbols = [{"symbol": item["symbol"], "baseAsset": item["baseAsset"], "quoteAsset": item["quoteAsset"], "status": item["status"]}
               for item in document.get("symbols", []) if item.get("quoteAsset") == "USDT"]
    return {"source": EXCHANGE_INFO_URL, "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "rawSha256": hashlib.sha256(raw).hexdigest(), "serverTime": document.get("serverTime"),
            "note": "today's state; used for D0c only, never as a historical universe", "symbols": symbols}


# --- Announcements (D0b) --------------------------------------------------------------------


def article_text(body: str) -> str:
    """Plain text of the CMS body (a JSON node tree, sometimes HTML)."""
    try:
        tree = json.loads(body)
    except (TypeError, ValueError):
        return re.sub(r"<[^>]+>", " ", body or "")
    parts: list[str] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            if node.get("node") == "text":
                parts.append(node.get("text", ""))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(tree)
    return " ".join(parts)


PAIR_PATTERN = re.compile(r"\b([A-Z0-9]{2,15})\s*/\s*USDT\b")
SLASHLESS_PATTERN = re.compile(r"\b([A-Z0-9]{2,15})USDT\b")  # some notices write pairs as AAVEBRL, ABCUSDT
DATE_PATTERN = re.compile(r"(20\d\d)[-/.](\d{1,2})[-/.](\d{1,2})")


def usdt_pairs(text: str) -> list[str]:
    """Spot pairs quoted in USDT that the text names explicitly ('ABC/USDT')."""
    seen = []
    for base in PAIR_PATTERN.findall(text):
        symbol = f"{base}USDT"
        if symbol not in seen:
            seen.append(symbol)
    return seen


def named_usdt_pairs(text: str) -> list[str]:
    """USDT pairs in either notation ('ABC/USDT' or 'ABCUSDT')."""
    return usdt_pairs(text) + [f"{base}USDT" for base in SLASHLESS_PATTERN.findall(text) if f"{base}USDT" not in usdt_pairs(text)]


def trading_end(title: str, text: str, published: str) -> tuple[str, str]:
    """(date, source): the first date in the title, else in the text, else the publication date."""
    for source, value in (("title", title), ("text", text)):
        match = DATE_PATTERN.search(value)
        if match:
            year, month, day = (int(group) for group in match.groups())
            try:
                return datetime(year, month, day).strftime("%Y-%m-%d"), source
            except ValueError:
                continue
    return published[:10], "publication"


def relevant_title(title: str) -> bool:
    lowered = title.lower()
    return any(keyword in lowered for keyword in TITLE_KEYWORDS) and not any(word in lowered for word in TITLE_EXCLUDE)


def list_articles(catalog: int, cache: Path | None, fetch=http_get, page_size: int = 50) -> list[dict]:
    articles, page = [], 1
    while True:
        path = cache / f"catalog-{catalog}-page-{page}.json" if cache else None
        if path and path.exists():
            raw = path.read_bytes()
        else:
            raw = fetch(f"{ARTICLE_LIST_URL}?type=1&catalogId={catalog}&pageNo={page}&pageSize={page_size}", 2.0)
            if path:
                path.write_bytes(raw)
        catalogs = json.loads(raw)["data"]["catalogs"]
        batch = [article for item in catalogs for article in item["articles"]]
        articles.extend(batch)
        if len(batch) < page_size:
            return articles
        page += 1


def published_iso(article: dict) -> str:
    return datetime.fromtimestamp(article["releaseDate"] / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def candidate_articles(articles: list[dict]) -> list[dict]:
    unique = {article["code"]: article for article in articles}
    selected = [article for article in unique.values() if relevant_title(article["title"])
                and str(D0B_YEARS[0]) <= published_iso(article)[:4] <= str(D0B_YEARS[-1])]
    return sorted(selected, key=lambda article: article["releaseDate"])


def classify_article(article: dict, detail: dict) -> dict:
    text = article_text(detail.get("body", ""))
    published = published_iso(article)
    end, end_source = trading_end(article["title"], text, published)
    pairs = usdt_pairs(text)
    removal = any(phrase in text.lower() for phrase in REMOVAL_PHRASES)
    contexts = {}
    for pair in pairs:
        match = re.search(rf"\b{re.escape(pair[:-4])}\s*/\s*USDT\b", text)
        contexts[pair] = text[max(0, match.start() - 90):match.end() + 60].replace("\n", " ") if match else ""
    return {"code": article["code"], "title": article["title"], "url": ARTICLE_PAGE_URL.format(code=article["code"]),
            "published": published, "tradingEnd": end, "tradingEndSource": end_source, "pairs": pairs,
            "removalPhrase": removal, "contexts": contexts, "qualifies": bool(pairs) and removal}


def select_sample(classified: list[dict], per_year: int = 3) -> dict:
    """D0b: the first `per_year` qualifying announcements of each year (chronological)."""
    years: dict[str, list] = {str(year): [] for year in D0B_YEARS}
    for item in sorted(classified, key=lambda entry: entry["published"]):
        year = item["published"][:4]
        if year in years and item["qualifies"] and len(years[year]) < per_year:
            years[year].append({key: item[key] for key in ("url", "published", "tradingEnd", "pairs", "title", "tradingEndSource", "contexts")})
    return years


def collect_announcements(out: Path, cache: Path, fetch=http_get, per_year: int = 3) -> dict:
    cache.mkdir(parents=True, exist_ok=True)
    articles = [article for catalog in CATALOGS for article in list_articles(catalog, cache, fetch)]
    candidates = candidate_articles(articles)
    classified = []
    done: dict[str, int] = {str(year): 0 for year in D0B_YEARS}
    for article in candidates:
        year = published_iso(article)[:4]
        if done[year] >= per_year:
            continue  # only as many details as the rule needs: the first three qualifying per year
        path = cache / f"article-{article['code']}.json"
        if path.exists():
            raw = path.read_bytes()
        else:
            raw = fetch(f"{ARTICLE_DETAIL_URL}?articleCode={article['code']}", 4.0)
            path.write_bytes(raw)
        item = classify_article(article, json.loads(raw)["data"])
        classified.append(item)
        done[year] += item["qualifies"]
    sample = {"rule": "first three announcements per year 2020-2025 (chronological, catalogs 49 and 161) whose text names "
                      "at least one spot pair quoted in USDT ('ABC/USDT') and states an end of trading (delist, remove, cease "
                      "trading); futures, margin, P2P, staking, loans, earn, options, convert and liquidity-pool announcements "
                      "excluded by title",
              "fetchedAt": datetime.now(timezone.utc).isoformat(), "years": select_sample(classified, per_year), "neverListed": []}
    (out / "announcements-d0b-candidates.json").write_text(json.dumps(classified, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "announcements-d0b.json").write_text(json.dumps(sample, indent=1, ensure_ascii=False), encoding="utf-8")
    return sample


def cached_candidates(cache: Path, fetch=http_get) -> list[dict]:
    return candidate_articles([article for catalog in CATALOGS for article in list_articles(catalog, cache, fetch)])


def review_sheet(out: Path, cache: Path, fetch=http_get, per_year: int = 12, years: list[str] | None = None) -> list[dict]:
    """The first `per_year` candidates of each year with text excerpts, for the manual D0b review.
    The automatic flag is only a hint: the text names a USDT pair next to a removal phrase."""
    sheet, counts = [], {str(year): 0 for year in D0B_YEARS}
    for article in cached_candidates(cache, fetch):
        year = published_iso(article)[:4]
        if counts[year] >= per_year or (years and year not in years):
            continue
        counts[year] += 1
        path = cache / f"article-{article['code']}.json"
        if not path.exists():
            path.write_bytes(fetch(f"{ARTICLE_DETAIL_URL}?articleCode={article['code']}", 4.0))
        detail = json.loads(path.read_bytes())["data"]
        item = classify_article(article, detail)
        item["excerpt"] = article_text(detail.get("body", ""))[:900]
        sheet.append(item)
    (out / "announcements-d0b-review-sheet.json").write_text(json.dumps(sheet, indent=1, ensure_ascii=False), encoding="utf-8")
    return sheet


def merge_review(candidates: list[dict], cache: Path, manual: dict) -> tuple[dict, list]:
    """Decisions for every cached candidate: the manual one if present, else an automatic 'no' when the text
    names no USDT pair or announces no end of trading at all. Other candidates come back as pending."""
    decisions, pending = {}, []
    for article in candidates:
        path = cache / f"article-{article['code']}.json"
        if article["code"] in manual:
            decisions[article["code"]] = manual[article["code"]]
        elif path.exists() and not named_usdt_pairs(text := article_text(json.loads(path.read_bytes())["data"].get("body", ""))):
            decisions[article["code"]] = {"qualifies": False, "pairs": [], "tradingEnd": None,
                                          "reason": "kein USDT-Paar im Text genannt (automatisch)"}
        elif path.exists() and not any(phrase in text.lower() for phrase in END_PHRASES):
            decisions[article["code"]] = {"qualifies": False, "pairs": [], "tradingEnd": None,
                                          "reason": "nennt USDT-Paare, kündigt aber kein Handelsende an (automatisch)"}
        elif path.exists():
            pending.append({"code": article["code"], "published": published_iso(article), "title": article["title"]})
    return decisions, pending


def build_reviewed_sample(candidates: list[dict], decisions: dict, per_year: int = 3) -> dict:
    """First `per_year` announcements per year that the review confirmed (chronological). Every candidate
    before the last selected one must carry a decision, so no announcement can be skipped silently."""
    years: dict[str, list] = {str(year): [] for year in D0B_YEARS}
    reviewed_until: dict[str, str] = {}
    for article in sorted(candidates, key=lambda item: item["releaseDate"]):
        year = published_iso(article)[:4]
        if year not in years or len(years[year]) >= per_year:
            continue
        decision = decisions.get(article["code"])
        if decision is None:
            raise FetchError(f"Candidate {article['code']} ({published_iso(article)[:10]}, {article['title'][:60]}) is not reviewed.")
        reviewed_until[year] = published_iso(article)
        if decision["qualifies"]:
            years[year].append({"url": ARTICLE_PAGE_URL.format(code=article["code"]), "published": published_iso(article),
                                "tradingEnd": decision["tradingEnd"], "pairs": decision["pairs"], "title": article["title"],
                                "reason": decision.get("reason", "")})
    return {"years": years, "reviewedUntil": reviewed_until}


# --- D0b under the draft precision P7 ---------------------------------------------------------

P7_YEARS = tuple(str(year) for year in D0B_YEARS)


def load_snapshots(out: Path) -> list[tuple[str, dict, str]]:
    """(Binance serverTime, {symbol: [baseAsset, status]}, archive URL) of every usable capture, oldest first."""
    index = json.loads((out / "wayback-exchangeInfo.json").read_text(encoding="utf-8"))
    snapshots = []
    for row in index["captures"]:
        if row.get("serverTime"):
            reduced = json.loads((out / "wayback-exchangeInfo" / f"{row['captured']}.json").read_text(encoding="utf-8"))
            snapshots.append((reduced["serverTime"], reduced["symbols"], row["archiveUrl"]))
    return sorted(snapshots, key=lambda item: item[0])


def token_pairs(tokens: list[str], published: str, trading_end: str, snapshots: list) -> tuple[list[dict], list[dict]]:
    """P7 (a): a token delisting ends <TOKEN>USDT only if Binance's own exchangeInfo, as archived before the
    publication, lists that pair with this base asset as TRADING, and the first capture after the trading end
    no longer lists it as TRADING. Today's exchangeInfo is not used."""
    before = [item for item in snapshots if item[0] <= published]
    after = [item for item in snapshots if item[0][:10] > trading_end]
    evidenced, rejected = [], []
    for token in tokens:
        pair = f"{token}USDT"
        b, a = (before[-1] if before else None), (after[0] if after else None)
        b_state, a_state = (b[1].get(pair) if b else None), (a[1].get(pair) if a else None)
        record = {"pair": pair, "before": b[0] if b else None, "beforeState": b_state, "beforeUrl": b[2] if b else None,
                  "after": a[0] if a else None, "afterState": a_state, "afterUrl": a[2] if a else None}
        ok = b_state == [token, "TRADING"] and a is not None and (a_state is None or a_state[1] != "TRADING")
        (evidenced if ok else rejected).append(record)
    return evidenced, rejected


def intervening_removal(pair: str, start: str, end: str, candidates: list[dict], text_of) -> str | None:
    """Code of an announcement between the archived capture and the delisting that already removed the pair."""
    for article in candidates:
        if start < published_iso(article) < end:
            text = text_of(article)
            if pair in named_usdt_pairs(text) and any(phrase in text.lower() for phrase in REMOVAL_PHRASES):
                return article["code"]
    return None


def build_p7_sample(candidates: list[dict], decisions: dict, snapshots: list, text_of, per_year: int = 3) -> dict:
    """First `per_year` announcements per year, chronological: explicitly named USDT pairs as before, plus token
    delistings without any pair list whose USDT pairs the archived exchangeInfo proves (decision field 'p7')."""
    years: dict[str, list] = {year: [] for year in P7_YEARS}
    ordered = sorted(candidates, key=lambda item: item["releaseDate"])
    for article in ordered:
        year = published_iso(article)[:4]
        if year not in years or len(years[year]) >= per_year:
            continue
        decision = decisions.get(article["code"])
        if decision is None:
            raise FetchError(f"Candidate {article['code']} ({published_iso(article)[:10]}, {article['title'][:60]}) is not reviewed.")
        item = {"url": ARTICLE_PAGE_URL.format(code=article["code"]), "published": published_iso(article), "title": article["title"]}
        if decision["qualifies"]:
            years[year].append({**item, "kind": "named", "tradingEnd": decision["tradingEnd"], "pairs": decision["pairs"]})
        elif decision.get("p7"):
            p7 = decision["p7"]
            evidenced, rejected = token_pairs(p7["tokens"], item["published"], p7["tradingEnd"], snapshots)
            for record in list(evidenced):
                code = intervening_removal(record["pair"], record["before"], item["published"], ordered, text_of)
                if code:
                    evidenced.remove(record)
                    rejected.append({**record, "removedEarlierBy": code})
            if evidenced:
                years[year].append({**item, "kind": "token", "tradingEnd": p7["tradingEnd"], "pairs": [r["pair"] for r in evidenced],
                                    "evidence": evidenced, "tokensWithoutUsdtPair": [r["pair"] for r in rejected]})
    return years


def snapshot_endings(snapshots: list, first: str = "2019-12-01", last: str = "2025-12-31", reopen_days: int = 365) -> list[dict]:
    """Report next to P7: every USDT pair that is TRADING in one archived capture and no longer TRADING in the
    next, for captures from `first` to `last`; a pair TRADING again within `reopen_days` was only paused."""
    endings = []
    for (t1, s1, u1), (t2, s2, u2) in zip(snapshots, snapshots[1:]):
        if not first <= t1[:10] <= last:
            continue
        for pair, (base, status) in sorted(s1.items()):
            after = s2.get(pair)
            if status != "TRADING" or (after and after[1] == "TRADING"):
                continue
            limit = datetime.fromisoformat(t2.replace("Z", "+00:00")).timestamp() + reopen_days * 86_400
            if any(s.get(pair, [None, None])[1] == "TRADING" for t, s, _ in snapshots
                   if t > t2 and datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() <= limit):
                continue
            seen = next(t for t, s, _ in snapshots if pair in s and s[pair][1] == "TRADING")
            endings.append({"pair": pair, "baseAsset": base, "firstSeenTrading": seen, "lastSeenTrading": t1, "firstSeenEnded": t2,
                            "stateAfter": after, "lastTradingUrl": u1, "endedUrl": u2})
    return endings


def previous_month(month: str) -> str:
    return shift_month(month, -1)


def snapshot_survey(endings: list[dict], symbols: dict) -> dict:
    """Report only: is every pair the archived captures show ending in the archive? The file must lie between
    the month before the last TRADING capture (at the earliest the month of the first one) and the month the end
    is seen, so a symbol reused years later cannot pass for the old pair."""
    by_year: dict[str, dict] = {}
    for pair in endings:
        required = max(previous_month(pair["lastSeenTrading"][:7]), pair["firstSeenTrading"][:7])
        months = symbols.get(pair["pair"], [])
        ok = any(required <= month <= pair["firstSeenEnded"][:7] for month in months)
        year = by_year.setdefault(pair["lastSeenTrading"][:4], {"pairs": 0, "found": 0, "missing": []})
        year["pairs"] += 1
        year["found"] += ok
        if not ok:
            year["missing"].append({"pair": pair["pair"], "required": required, "seenEnded": pair["firstSeenEnded"][:10],
                                    "archive": [months[0], months[-1]] if months else None})
    return dict(sorted(by_year.items()))


def p7_archive_check(years: dict, symbols: dict, min_share: float = 0.9) -> dict:
    """D0b under P7: the frozen 'found' rule (an archive file up to at least the month before the trading end)."""
    result = {}
    for year, items in years.items():
        found = []
        for item in items:
            required = previous_month(item["tradingEnd"][:7])
            for pair in item["pairs"]:
                months = symbols.get(pair, [])
                found.append((pair, bool(months) and max(months) >= required))
        result[year] = {"method": "announcements", "announcements": len(items), "pairs": len(found),
                        "found": sum(ok for _, ok in found), "missing": [pair for pair, ok in found if not ok]}
    for item in result.values():
        item["share"] = item["found"] / item["pairs"] if item["pairs"] else None
        item["performable"] = bool(item["pairs"]) and item["announcements"] >= 3
        item["passed"] = item["performable"] and item["share"] >= min_share
    return {"years": result, "passed": all(item["passed"] for item in result.values())}


# --- CLI ------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Step 1.2 metadata of RELATIVE_STRENGTH_FEASIBILITY_V1")
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("listing")
    listing.add_argument("--out", type=Path, required=True)
    listing.add_argument("--symbols", help="comma separated subset (for a test)")
    info = commands.add_parser("exchange-info")
    info.add_argument("--out", type=Path, required=True)
    announcements = commands.add_parser("announcements")
    announcements.add_argument("--out", type=Path, required=True)
    announcements.add_argument("--cache", type=Path)
    sheet = commands.add_parser("review-sheet")
    sheet.add_argument("--out", type=Path, required=True)
    sheet.add_argument("--cache", type=Path)
    sheet.add_argument("--per-year", type=int, default=12)
    sheet.add_argument("--years", help="comma separated subset of 2020-2025")
    reviewed = commands.add_parser("d0b-sample")
    reviewed.add_argument("--out", type=Path, required=True)
    reviewed.add_argument("--decisions", type=Path, required=True, help="manual decisions (d0b-review-decisions.json)")
    reviewed.add_argument("--cache", type=Path)
    gaps = commands.add_parser("gap-check")
    gaps.add_argument("--plan", type=Path, required=True)
    gaps.add_argument("--out", type=Path, required=True, help="events/long-gap-check.json of the data directory")
    p7 = commands.add_parser("d0b-p7")
    p7.add_argument("--out", type=Path, required=True)
    p7.add_argument("--decisions", type=Path, required=True)
    p7.add_argument("--cache", type=Path)
    snapshots = commands.add_parser("snapshots")
    snapshots.add_argument("--out", type=Path, required=True)
    plan = commands.add_parser("download-plan")
    plan.add_argument("--listing", type=Path, required=True)
    plan.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "listing":
            args.out.mkdir(parents=True, exist_ok=True)
            result = build_listing(only=args.symbols.split(",") if args.symbols else None)
            result["structure"] = structure_report(result)
            (args.out / "spot-monthly-klines-1d.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
            print(json.dumps({"usdtSymbols": len(result["symbols"]), "allSpotSymbols": result["allSpotSymbolsInArchive"],
                              "symbolsWithInteriorHoles": result["structure"]["symbolsWithInteriorHoles"],
                              "zipFilesWithoutChecksum": len(result["structure"]["zipFilesWithoutChecksum"])}))
        elif args.command == "exchange-info":
            args.out.mkdir(parents=True, exist_ok=True)
            reduced = reduce_exchange_info(http_get(EXCHANGE_INFO_URL))
            (args.out / "exchangeInfo.json").write_text(json.dumps(reduced, indent=1), encoding="utf-8")
            print(json.dumps({"usdtSymbols": len(reduced["symbols"]), "rawSha256": reduced["rawSha256"]}))
        elif args.command == "announcements":
            args.out.mkdir(parents=True, exist_ok=True)
            sample = collect_announcements(args.out, args.cache or args.out / "announcement-cache")
            print(json.dumps({year: len(items) for year, items in sample["years"].items()}))
        elif args.command == "review-sheet":
            items = review_sheet(args.out, args.cache or args.out / "announcement-cache", per_year=args.per_year,
                                 years=args.years.split(",") if args.years else None)
            print(json.dumps({"candidates": len(items), "autoFlagged": sum(item["qualifies"] for item in items)}))
        elif args.command == "d0b-sample":
            cache = args.cache or args.out / "announcement-cache"
            candidates = cached_candidates(cache)
            decisions, pending = merge_review(candidates, cache, json.loads(args.decisions.read_text(encoding="utf-8")))
            review = {"rule": D0B_RULE, "reviewedAt": datetime.now(timezone.utc).date().isoformat(), "decisions": decisions, "pending": pending}
            (args.out / "announcements-d0b-review.json").write_text(json.dumps(review, indent=1, ensure_ascii=False), encoding="utf-8")
            result = build_reviewed_sample(candidates, decisions)
            sample = {"rule": D0B_RULE, "reviewedAt": review["reviewedAt"], "neverListed": [], **result}
            (args.out / "announcements-d0b.json").write_text(json.dumps(sample, indent=1, ensure_ascii=False), encoding="utf-8")
            print(json.dumps({year: [item["pairs"] for item in items] for year, items in result["years"].items()}, ensure_ascii=False))
        elif args.command == "gap-check":
            checked = gap_check(json.loads(args.plan.read_text(encoding="utf-8")).get("longGapsToCheck") or [])
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps({"source": f"{LISTING_URL}?prefix={HOURLY_DAILY_PREFIX}", "checkedAt": datetime.now(timezone.utc).isoformat(),
                                            "gaps": checked}, indent=1), encoding="utf-8")
            print(json.dumps({verdict: sum(1 for item in checked if item["verdict"] == verdict) for verdict in ("consistent", "suspected", "notCheckable")}))
        elif args.command == "d0b-p7":
            cache = args.cache or args.out / "announcement-cache"
            candidates = cached_candidates(cache)
            decisions, _ = merge_review(candidates, cache, json.loads(args.decisions.read_text(encoding="utf-8")))

            def text_of(article: dict) -> str:
                path = cache / f"article-{article['code']}.json"
                if not path.exists():
                    path.write_bytes(http_get(f"{ARTICLE_DETAIL_URL}?articleCode={article['code']}", 4.0))
                return article_text(json.loads(path.read_bytes())["data"].get("body", ""))

            snapshots = load_snapshots(args.out)
            years = build_p7_sample(candidates, decisions, snapshots, text_of)
            endings = snapshot_endings(snapshots)
            symbols = json.loads((args.out / "spot-monthly-klines-1d.json").read_text(encoding="utf-8"))["symbols"]
            result = {"rule": "Entwurf P7 (docs/trading/research/2026-10-17-relative-strength-d0b-precision-p7.md); "
                              "Bericht bis zur Freigabe", "computedAt": datetime.now(timezone.utc).isoformat(),
                      "snapshotsUsed": [item[0] for item in snapshots], "years": years,
                      "check": p7_archive_check(years, symbols),
                      "snapshotSurvey": {"note": "nur Bericht, kein Kriterium", "byYear": snapshot_survey(endings, symbols),
                                         "endings": endings}}
            (args.out / "announcements-d0b-p7.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
            print(json.dumps({year: {k: item[k] for k in ("pairs", "found", "share", "passed")} for year, item in result["check"]["years"].items()}))
        elif args.command == "snapshots":
            index = fetch_snapshots(args.out)
            print(json.dumps([(item["captured"], item.get("serverTime"), item.get("trading", item.get("unusable"))) for item in index]))
        else:
            plan_result = download_plan(json.loads(args.listing.read_text(encoding="utf-8")))
            text = json.dumps(plan_result, indent=1)
            if args.out:
                args.out.write_text(text, encoding="utf-8")
            print(text)
        return 0
    except FetchError as error:
        print(f"Abruf gescheitert: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
