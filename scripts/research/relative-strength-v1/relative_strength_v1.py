#!/usr/bin/env python3
"""Relative strength (cross-sectional momentum) feasibility study V1 (RELATIVE_STRENGTH_FEASIBILITY_V1).

Implements the frozen preregistration
docs/trading/research/2026-10-17-relative-strength-feasibility-preregistration.md
(text commit c188c38, blob 96525664..., status block 6520f42). Section references (§)
point to it. Every value of FROZEN is a value of the preregistration (§5.4); a real
run refuses any other configuration.

Python standard library only; run with ``python3 -I``. The script contains no network
code: it reads files fetched separately (steps 1.2-1.4c) or written by ``synth`` and
never writes into a data directory except with ``synth``.

Commands:
  synth          --out DIR [--seed N]                  synthetic data in the archive layout
  verify         [--data DIR]                          frozen preregistration, configuration, manifest
  check-listing  --data DIR [--out FILE]               D0, D0b, D0c on the listing (step 1.2)
  plan           --data DIR [--spot DIR]               daily files (E1, D12) and evidence cases (D11) to fetch
  check-data     --data DIR [--spot DIR] [--out FILE]  D0-D12, never returns
  evaluate       --data DIR --out DIR [--spot DIR] [--venue-status S] [--accept-halt CHECK]...
                 [--correction REASON] [--random-portfolios N]
                 [--real --confirm RELATIVE_STRENGTH_FEASIBILITY_V1]
                                                       the one run (§10.4)

Data layout (<data> is data/market-snapshots/relative-strength-v1 for the real run):
  binance/spot/monthly/klines/<SYM>/1d/<SYM>-1d-YYYY-MM.zip[.CHECKSUM]
  binance/spot/daily/klines/<SYM>/1d/<SYM>-1d-YYYY-MM-DD.zip[.CHECKSUM]   (E1, D12)
  listing/spot-monthly-klines-1d.json   {"symbols": {"SYM": ["YYYY-MM", ...]}}
  listing/exchangeInfo.json             Binance exchangeInfo as fetched (D0c)
  listing/announcements-d0b.json        {"years": {"2020": [{"url", "published", "tradingEnd", "pairs"}]},
                                         "neverListed": [{"symbol", "url"}]}
  listing/announcements-d0b-p7.json     D0b under precision P7 (fetch_metadata.py d0b-p7); read only once P7 is approved
  events/evidence.json                  {"cases": [{"symbol", "kind", "day", "published", "url", "successor", "ratio"}]}
  events/long-gap-check.json            {"gaps": [{"symbol", "from", "to", "verdict"}]}  hourly-archive check of long
                                         gaps (fetch_metadata.py gap-check); verdict consistent|suspected|notCheckable
  fred/DTB3.csv, benchmarks/benchmarks.csv   copies of the carry files (§4.1)
  manifest.sha256                       real run; a file SYNTHETIC marks synthetic data
  <spot>/<SYM>-1d.csv.gz                existing BTC/ETH snapshot (default data/market-snapshots/real)
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import os
import random
import statistics
import sys
import zipfile
from collections import defaultdict
from dataclasses import asdict, dataclass, field, replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

STUDY_KEY = "RELATIVE_STRENGTH_FEASIBILITY_V1"
SCRIPT_VERSION = "relative-strength-v1/1.0.0"
PREREGISTRATION = {
    "path": "docs/trading/research/2026-10-17-relative-strength-feasibility-preregistration.md",
    "frozenCommit": "c188c38",
    "frozenBlob": "965256641b152d9a0850f72c4c2609f846d0bc90",
    "statusCommit": "6520f42",
    "statusMarker": "> **Status 2026-10-17: freigegeben und eingefroren (V1).**",
}
REPO_ROOT = Path(__file__).resolve().parents[3]
CANONICAL_DATA = REPO_ROOT / "data" / "market-snapshots" / "relative-strength-v1"
CANONICAL_OUT = REPO_ROOT / "data" / "replay-research" / "relative-strength-v1" / "evaluation"
DEFAULT_SPOT = REPO_ROOT / "data" / "market-snapshots" / "real"

# --- Time (days since 1970-01-01, UTC) ------------------------------------------------

EPOCH = date(1970, 1, 1)
DAY_MS = 86_400_000


def day_of(text: str) -> int:
    return (date.fromisoformat(text[:10]) - EPOCH).days


def day_text(day: int) -> str:
    return (EPOCH + timedelta(days=day)).isoformat()


def month_text(day: int) -> str:
    return day_text(day)[:7]


def weekday(day: int) -> int:
    """0 = Monday (1970-01-01 was a Thursday)."""
    return (day + 3) % 7


def months_between(first: str, last: str) -> list[str]:
    year, month = int(first[:4]), int(first[5:7])
    result = []
    while f"{year:04d}-{month:02d}" <= last:
        result.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return result


def month_days(month: str) -> range:
    first = day_of(f"{month}-01")
    year, mon = int(month[:4]), int(month[5:7])
    following = day_of(f"{year + (mon == 12):04d}-{mon % 12 + 1:02d}-01")
    return range(first, following)


# --- Frozen values (§3, §5.4, §7, §10) -------------------------------------------------


@dataclass(frozen=True)
class Config:
    window_start: int = day_of("2020-01-01")
    window_end: int = day_of("2026-10-01")  # exclusive; the last day is 2026-09-30
    prelude_start: int = day_of("2019-07-01")
    subperiod_start: int = day_of("2024-01-01")
    forward_cutoff: int = day_of("2026-10-15")  # never loaded (§4.1)
    four_week_anchor: int = day_of("2020-01-06")  # variant B: every fourth Monday from here (§5.3)
    slot: float = 20_000.0
    n_positions: int = 10
    buffer_rank: int = 20
    universe_size: int = 50
    min_liquidity: float = 5_000_000.0
    liquidity_days: int = 30
    history_days: int = 90
    lookback_days: int = 28
    peg_days: int = 90
    peg_ratio: float = 1.03
    tier_l1: float = 100_000_000.0
    tier_l2: float = 20_000_000.0
    tick_proxy_limit: float = 0.001  # 10 bp
    min_order: float = 10.0
    long_gap_days: int = 7
    jump_factor: float = 10.0
    evidence_day_tolerance: int = 3
    cost_stress: float = 2.0
    haircut: float = 0.015
    haircut_pessimistic: float = 0.03
    multiple_test_n_before: int = 55
    multiple_test_n_after: int = 57
    max_selection_correlation: float = 0.5
    drawdown_ratio: float = 1.25
    min_risk_on_days_year: int = 30
    min_informative_months: int = 24
    selection_margin: float = 0.01
    random_portfolios: int = 1000
    random_seed: int = 20261017
    benchmark_reserve_s2: float = 0.30
    d0b_min_share: float = 0.90
    d0b_announcements_per_year: int = 3
    d11_min_share: float = 0.80
    d1_max_missing_share: float = 0.005
    d2_max_defect_share: float = 0.001
    d3_max_missing_share: float = 0.005
    d6_tolerance: float = 1e-8
    d6_max_mismatch_share: float = 0.001
    capacity_participation: float = 0.01
    equal_risk_volatility: float = 0.10
    gates_v4_drawdown: float = 0.10


FROZEN = Config()
D0B_YEARS = tuple(range(2020, 2026))
CALENDAR_YEARS = tuple(range(2020, 2027))
D0_CONTROL = {"ERDUSDT": 2020, "LUNAUSDT": 2022, "FTTUSDT": 2022, "XMRUSDT": 2024, "MATICUSDT": 2024}
REGIME_COUNTS = {"RISK_ON": 829, "NEUTRAL": 633, "MIXED": 275, "RISK_OFF": 728}  # carry report §5, D7
QUOTE = "USDT"
X1_STABLE_FIAT = frozenset({
    "USDC", "BUSD", "TUSD", "USDP", "PAX", "DAI", "FDUSD", "USDD", "UST", "USTC", "SUSD", "USDS", "USDSB", "VAI",
    "AEUR", "EURI", "USD1", "RLUSD", "PYUSD", "USDE", "BFUSD", "XUSD", "EUR", "GBP", "AUD", "BRL", "TRY", "RUB",
    "UAH", "BIDR", "IDRT", "NGN", "ZAR", "BKRW"})
X3_COMMODITY = frozenset({"PAXG", "XAUT"})
X5_DERIVED = frozenset({"WBTC", "WBETH", "BETH"})
LEVERAGE_SUFFIXES = ("UP", "DOWN", "BULL", "BEAR")
TIER_COSTS = {"L1": (10.0, 2.0, 3.0), "L2": (10.0, 10.0, 10.0), "L3": (10.0, 20.0, 20.0)}  # fee, full spread, slippage (bp)
EVIDENCE_KINDS = ("DELISTING", "MIGRATION", "SYMBOL_REUSE", "REDENOMINATION", "PAUSE")
VENUE_STATUSES = ("OFFEN", "VERFUEGBAR", "NICHT_VERFUEGBAR")
POSITIVE_CLASSES = ("BESTANDEN", "BESTANDEN_REFERENZ", "AUSSTEHEND_PHASE_1B")
HALT_CHECKS = ("D0", "D0b", "D9", "D11")
# Precisions approved by the operator after the freeze. "P7" (D0b with archived exchangeInfo captures,
# docs/trading/research/2026-10-17-relative-strength-d0b-precision-p7.md) is a draft: it is added here only
# after its approval, in its own commit.
APPROVED_PRECISIONS: tuple[str, ...] = ()
BLOCKING_CHECKS = ("D1", "D2", "D3", "D6", "D7")
RISK_ON = "RISK_ON"
KLINE_HEADER = "open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore"
SPOT_HEADER = "openTime,closeTime,open,high,low,close,volume"


def side_bp(tier: str) -> float:
    fee, spread, slippage = TIER_COSTS[tier]
    return fee + spread / 2 + slippage


class StudyError(Exception):
    """A precondition of the preregistration is not met."""


class HaltError(StudyError):
    """A halt of §10.4 needs a decision of the operator (D0, D0b, D9, D11)."""


# --- Reading files ----------------------------------------------------------------------


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_number(text: str) -> bool:
    try:
        float(text)
    except ValueError:
        return False
    return True


def _csv_rows(text: str) -> tuple[list[str] | None, list[list[str]]]:
    rows = [row for row in csv.reader(io.StringIO(text)) if row and any(cell.strip() for cell in row)]
    if rows and not _is_number(rows[0][0]):
        return [cell.strip() for cell in rows[0]], rows[1:]
    return None, rows


def read_zip_csv(path: Path) -> tuple[list[str] | None, list[list[str]]]:
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if len(names) != 1:
            raise StudyError(f"{path.name}: expected exactly one CSV, found {names}.")
        return _csv_rows(archive.read(names[0]).decode("utf-8"))


def checksum_ok(path: Path) -> bool:
    """D1: the file exists and its SHA-256 equals the .CHECKSUM file next to it."""
    checksum = path.with_name(path.name + ".CHECKSUM")
    if not path.exists() or not checksum.exists():
        return False
    expected = checksum.read_text(encoding="utf-8").split()
    return bool(expected) and expected[0].lower() == sha256_file(path)


Candle = tuple  # (open, high, low, close, quote_volume, trades)


def timestamp_day(raw: str, cfg: Config) -> tuple[int, bool]:
    """(day, is_midnight); the archive switched spot files to microseconds (D2)."""
    value = int(float(raw))
    if value >= 10**14:
        value //= 1000
    day = value // DAY_MS
    if day >= cfg.forward_cutoff:
        raise StudyError(f"Timestamp {day_text(day)} lies in the forward period (§4.1).")
    return day, value % DAY_MS == 0


@dataclass
class ParsedFile:
    candles: dict
    rows: int
    defects: list


def parse_kline_file(path: Path, cfg: Config) -> ParsedFile:
    """D2: 12 columns, timestamp unit, sorted, no duplicates, 00:00 UTC, low <= open/close <= high, volume >= 0."""
    _, rows = read_zip_csv(path)
    candles: dict[int, Candle] = {}
    defects: list[str] = []
    previous = None
    for row in rows:
        try:
            if len(row) != 12:
                raise ValueError(f"{len(row)} Spalten")
            day, midnight = timestamp_day(row[0], cfg)
            if not midnight:
                raise ValueError("Eröffnung nicht 00:00 UTC")
            if previous is not None and day <= previous:
                raise ValueError("unsortiert oder doppelt")
            o, h, l, c, volume = (float(cell) for cell in row[1:6])
            quote_volume, trades = float(row[7]), int(float(row[8]))
            if min(o, h, l, c) <= 0 or l > min(o, c) or h < max(o, c) or l > h:
                raise ValueError("OHLC verletzt")
            if volume < 0 or quote_volume < 0 or trades < 0:
                raise ValueError("Volumen negativ")
            candles[day] = (o, h, l, c, quote_volume, trades)
            previous = day
        except ValueError as error:
            defects.append(f"{path.name}: {row[0] if row else '?'}: {error}")
    return ParsedFile(candles, len(rows), defects)


def require(path: Path) -> Path:
    if not path.exists():
        raise StudyError(f"Missing input {path}.")
    return path


def parse_spot_snapshot(path: Path, cfg: Config) -> dict[int, tuple]:
    """The existing project snapshot (exportBinanceHistory): day -> (open, high, low, close)."""
    with gzip.open(require(path), "rt", encoding="utf-8") as handle:
        header = handle.readline().strip()
        if header != SPOT_HEADER:
            raise StudyError(f"{path.name}: unexpected snapshot header {header!r}.")
        bars = {}
        for line in handle:
            if not line.strip():
                continue
            parts = line.strip().split(",")
            day = int(parts[0]) // DAY_MS
            if day >= cfg.forward_cutoff:
                continue
            bars[day] = (float(parts[2]), float(parts[3]), float(parts[4]), float(parts[5]))
    return bars


def parse_dtb3(path: Path) -> dict[int, float]:
    """FRED DTB3 in percent; '.' entries are skipped."""
    header, rows = _csv_rows(require(path).read_text(encoding="utf-8"))
    if header is None:
        raise StudyError(f"{path.name}: missing header.")
    return {day_of(row[0]): float(row[1]) for row in rows if len(row) >= 2 and row[1].strip() not in ("", ".")}


def parse_benchmarks(path: Path) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    """month,champion,challenger,champion_binding,challenger_binding (carry step 1.4, comparison A)."""
    header, rows = _csv_rows(require(path).read_text(encoding="utf-8"))
    if header is None or header[:5] != ["month", "champion", "challenger", "champion_binding", "challenger_binding"]:
        raise StudyError(f"{path.name}: expected header month,champion,challenger,champion_binding,challenger_binding.")
    series = {"champion": {}, "challenger": {}}
    binding = {"champion": {}, "challenger": {}}
    for row in rows:
        series["champion"][row[0]] = float(row[1])
        series["challenger"][row[0]] = float(row[2])
        binding["champion"][row[0]] = float(row[3])
        binding["challenger"][row[0]] = float(row[4])
    return series, binding


def read_json(path: Path, default=None):
    if not path.exists():
        if default is not None:
            return default
        raise StudyError(f"Missing input {path}.")
    return json.loads(path.read_text(encoding="utf-8"))


def monthly_path(data: Path, symbol: str, month: str) -> Path:
    return data / "binance" / "spot" / "monthly" / "klines" / symbol / "1d" / f"{symbol}-1d-{month}.zip"


def daily_path(data: Path, symbol: str, day: int) -> Path:
    return data / "binance" / "spot" / "daily" / "klines" / symbol / "1d" / f"{symbol}-1d-{day_text(day)}.zip"


def base_asset(symbol: str) -> str:
    return symbol[: -len(QUOTE)]


# --- Evidence (D11, §4.3) ---------------------------------------------------------------


@dataclass(frozen=True)
class Evidence:
    symbol: str
    kind: str
    day: int  # the day the event concerns: last trading day, last day before a gap, or the jump day
    trigger: int | None  # first daily open strictly after the publication (§4.3, E5)
    url: str
    successor: str | None = None
    ratio: float | None = None


def parse_evidence(document: dict) -> list[Evidence]:
    cases = []
    for raw in document.get("cases", []):
        kind = raw["kind"]
        if kind not in EVIDENCE_KINDS:
            raise StudyError(f"Unknown evidence kind {kind!r}.")
        published = raw.get("published")
        # "first open strictly after the publication": a publication on day X, at any time or
        # date-only ("Ende dieses Tags"), allows the open of X + 1 at the earliest.
        trigger = day_of(published) + 1 if published else None
        cases.append(Evidence(raw["symbol"], kind, day_of(raw["day"]), trigger, raw.get("url", ""),
                              raw.get("successor"), float(raw["ratio"]) if raw.get("ratio") is not None else None))
    return cases


def find_evidence(evidence: list[Evidence], symbol: str, day: int, kinds: tuple, tolerance: int) -> Evidence | None:
    matches = [case for case in evidence if case.symbol == symbol and case.kind in kinds and abs(case.day - day) <= tolerance]
    return min(matches, key=lambda case: abs(case.day - day)) if matches else None


# --- Archive loading: D1, D2, E1, D10 ---------------------------------------------------


@dataclass
class SymbolSeries:
    symbol: str
    candles: dict  # day -> Candle
    filled: list = field(default_factory=list)  # E1 days from the daily archive


def usdt_symbols(listing: dict) -> dict[str, list[str]]:
    return {symbol: sorted(months) for symbol, months in listing.get("symbols", {}).items()
            if symbol.endswith(QUOTE) and len(symbol) > len(QUOTE)}


def load_archive(data: Path, listing: dict, cfg: Config) -> tuple[dict[str, SymbolSeries], dict]:
    first_month, last_month = month_text(cfg.prelude_start), month_text(cfg.window_end - 1)
    series: dict[str, SymbolSeries] = {}
    expected = missing = rows = 0
    missing_files: list[str] = []
    defects: list[str] = []
    key_missing: list[str] = []
    for symbol, months in sorted(usdt_symbols(listing).items()):
        candles: dict[int, Candle] = {}
        for month in months:
            if not first_month <= month <= last_month:
                continue
            expected += 1
            path = monthly_path(data, symbol, month)
            if not checksum_ok(path):
                missing += 1
                missing_files.append(f"{symbol} {month}")
                if symbol in ("BTCUSDT", "ETHUSDT"):
                    key_missing.append(f"{symbol} {month}")
                continue
            parsed = parse_kline_file(path, cfg)
            rows += parsed.rows
            defects.extend(parsed.defects)
            candles.update({day: candle for day, candle in parsed.candles.items() if cfg.prelude_start <= day < cfg.window_end})
        if candles:
            series[symbol] = SymbolSeries(symbol, candles)
    filled_report = []
    for symbol, item in series.items():
        days = sorted(item.candles)
        for day in range(days[0], days[-1] + 1):
            if day in item.candles:
                continue
            path = daily_path(data, symbol, day)
            if not checksum_ok(path):
                continue
            parsed = parse_kline_file(path, cfg)
            defects.extend(parsed.defects)
            if day in parsed.candles:
                item.candles[day] = parsed.candles[day]
                item.filled.append(day)
        if item.filled:
            filled_report.append({"symbol": symbol, "days": [day_text(day) for day in item.filled]})
    d1 = {"expectedSymbolMonths": expected, "missingOrMismatched": missing,
          "share": missing / expected if expected else 0.0, "keySymbolsMissing": key_missing,
          "missing": missing_files[:200]}
    d1["passed"] = not key_missing and d1["share"] <= cfg.d1_max_missing_share
    d2 = {"rows": rows, "defects": len(defects), "share": len(defects) / rows if rows else 0.0, "examples": defects[:50]}
    d2["passed"] = d2["share"] <= cfg.d2_max_defect_share
    d10 = {"filledDays": sum(len(item["days"]) for item in filled_report), "bySymbol": filled_report}
    return series, {"D1": d1, "D2": d2, "D10": d10}


def check_gaps(series: dict[str, SymbolSeries], cfg: Config) -> dict:
    """D3: missing symbol-days inside trading times (gaps of 1-6 days after E1); BTC/ETH complete;
    no day missing for more than half of the active symbols. Long gaps are no trading time (D4)."""
    missing = trading = 0
    absent_by_day: dict[int, int] = defaultdict(int)
    active_by_day: dict[int, int] = defaultdict(int)
    long_gaps = []
    for symbol, item in series.items():
        days = sorted(day for day in item.candles if cfg.window_start <= day < cfg.window_end)
        if not days:
            continue
        trading += len(days)
        for previous, current in zip(days, days[1:]):
            gap = current - previous - 1
            if 0 < gap < cfg.long_gap_days:
                missing += gap
                trading += gap
            elif gap >= cfg.long_gap_days:
                long_gaps.append({"symbol": symbol, "from": day_text(previous + 1), "to": day_text(current - 1), "days": gap})
        for day in range(days[0], days[-1] + 1):
            active_by_day[day] += 1
            if day not in item.candles:
                absent_by_day[day] += 1
    key_missing = []
    for symbol in ("BTCUSDT", "ETHUSDT"):
        candles = series[symbol].candles if symbol in series else {}
        absent = [day_text(day) for day in range(cfg.window_start, cfg.window_end) if day not in candles]
        key_missing.extend(f"{symbol} {day}" for day in absent[:20])
    market_wide = [day_text(day) for day, count in sorted(absent_by_day.items()) if count * 2 > active_by_day[day]]
    report = {"missingSymbolDays": missing, "tradingSymbolDays": trading, "share": missing / trading if trading else 0.0,
              "keySymbolsMissing": key_missing, "marketWideMissingDays": market_wide[:50],
              "longGaps": long_gaps, "longGapDays": sum(item["days"] for item in long_gaps)}
    report["passed"] = report["share"] <= cfg.d3_max_missing_share and not key_missing and not market_wide
    return report


def check_jump_days(data: Path, series: dict[str, SymbolSeries], cfg: Config, members: set[str] | None = None) -> tuple[dict[str, set[int]], dict]:
    """D12: compare the monthly candle of every jump day with the daily archive file of that day."""
    errors: dict[str, set[int]] = defaultdict(set)
    checked, unverifiable = [], []
    for symbol, item in series.items():
        if members is not None and symbol not in members:
            continue
        for day in jump_days(item, cfg):
            path = daily_path(data, symbol, day)
            if not checksum_ok(path):
                unverifiable.append(f"{symbol} {day_text(day)}")
                continue
            parsed = parse_kline_file(path, cfg)
            daily = parsed.candles.get(day)
            monthly = item.candles[day]
            same = daily is not None and all(abs(a - b) <= 1e-9 * max(abs(a), abs(b), 1e-12) for a, b in zip(daily[:4], monthly[:4]))
            checked.append({"symbol": symbol, "day": day_text(day), "dataError": not same})
            if not same:
                errors[symbol].add(day)
    return errors, {"checked": checked, "unverifiable": unverifiable, "dataErrors": sum(len(days) for days in errors.values())}


def jump_days(item: SymbolSeries, cfg: Config) -> list[int]:
    """E4 candidates: close >= 10x or <= 0.1x the previous close, without a gap or across a short gap."""
    days = sorted(item.candles)
    result = []
    for previous, current in zip(days, days[1:]):
        if current - previous - 1 >= cfg.long_gap_days:
            continue
        factor = item.candles[current][3] / item.candles[previous][3]
        if factor >= cfg.jump_factor or factor <= 1 / cfg.jump_factor:
            result.append(current)
    return result


# --- Instruments and events E1-E7 (§4.3) ------------------------------------------------


@dataclass
class EndRule:
    """How a position in an instrument ends when the instrument's series ends (§4.3)."""

    kind: str  # OPEN, E3, E4CONV, E5, E6W, E6C, E7
    documented: bool = False
    reason: str = ""
    trigger: int | None = None  # E5/E6W: first open after the publication
    successor: str | None = None  # instrument id (E3 reopen, E4CONV, E6C)
    ratio: float | None = None  # E4CONV, E6C: new units per old unit
    resume_day: int | None = None  # E3: first day after the gap
    url: str = ""


@dataclass
class Instrument:
    id: str
    symbol: str
    base: str
    start: int
    end: int  # last day with a candle
    candles: list  # index day - start, None if missing
    valid_prefix: list  # count of days with candle, quote volume > 0 and trades > 0 before index i
    end_rule: EndRule = field(default_factory=lambda: EndRule("OPEN"))
    pauses: list = field(default_factory=list)  # (first missing day, last missing day)
    jumps: list = field(default_factory=list)  # (day, factor) unresolved E4
    divisor_b: list = field(default_factory=list)  # (day, cumulative divisor, jump already in the open) for reading B

    def candle(self, day: int) -> Candle | None:
        if self.start <= day <= self.end:
            return self.candles[day - self.start]
        return None

    def divisor(self, day: int, reading: str, for_open: bool = False) -> float:
        if reading != "B":
            return 1.0
        value = 1.0
        for jump_day, cumulative, open_jumped in self.divisor_b:
            # On the jump day the open is still in the old units unless the jump happened at the open (gap).
            if jump_day < day or (jump_day == day and (open_jumped or not for_open)):
                value = cumulative
        return value

    def open(self, day: int, reading: str = "A") -> float | None:
        candle = self.candle(day)
        return None if candle is None else candle[0] / self.divisor(day, reading, for_open=True)

    def close(self, day: int, reading: str = "A") -> float | None:
        candle = self.candle(day)
        return None if candle is None else candle[3] / self.divisor(day, reading)

    def last_close(self, day: int, reading: str = "A") -> float | None:
        """Close of the last candle on or before day (valuation during pauses and after the end)."""
        current = min(day, self.end)
        while current >= self.start:
            candle = self.candles[current - self.start]
            if candle is not None:
                return candle[3] / self.divisor(current, reading)
            current -= 1
        return None

    def valid_count(self, first: int, last: int) -> int:
        if first < self.start or last > self.end or first > last:
            return -1
        return self.valid_prefix[last - self.start + 1] - self.valid_prefix[first - self.start]

    def window(self, first: int, last: int) -> list:
        return [candle for candle in self.candles[max(first, self.start) - self.start:min(last, self.end) - self.start + 1] if candle is not None]


def make_instrument(symbol: str, candles: dict, start: int, end: int) -> Instrument:
    values = [candles.get(day) for day in range(start, end + 1)]
    prefix = [0]
    for candle in values:
        prefix.append(prefix[-1] + (1 if candle is not None and candle[4] > 0 and candle[5] > 0 else 0))
    return Instrument(f"{symbol}@{day_text(start)}", symbol, base_asset(symbol), start, end, values, prefix)


@dataclass
class EventCase:
    """One E2-E7 case for M14 and D4."""

    kind: str
    symbol: str
    instrument: str
    day: int
    documented: bool
    detail: dict


def build_instruments(series: dict[str, SymbolSeries], evidence: list[Evidence], data_errors: dict[str, set[int]],
                      cfg: Config) -> tuple[dict[str, Instrument], list[EventCase]]:
    """Split every symbol into instruments and classify E2-E7; data errors (D12) count as missing days."""
    instruments: dict[str, Instrument] = {}
    cases: list[EventCase] = []
    by_symbol: dict[str, list[Instrument]] = {}
    tolerance = cfg.evidence_day_tolerance
    for symbol, item in sorted(series.items()):
        candles = {day: candle for day, candle in item.candles.items() if day not in data_errors.get(symbol, set())}
        days = sorted(candles)
        if not days:
            continue
        segments: list[tuple[int, int, EndRule, list, list]] = []
        start, pauses, jumps = days[0], [], []
        for previous, current in zip(days, days[1:]):
            gap = current - previous - 1
            if gap >= cfg.long_gap_days:
                segments.append((start, previous, long_gap_rule(symbol, previous, current, candles, evidence, cfg), pauses, jumps))
                start, pauses, jumps = current, [], []
                continue
            if gap > 0:
                pauses.append((previous + 1, current - 1))
            factor = candles[current][3] / candles[previous][3]
            if factor >= cfg.jump_factor or factor <= 1 / cfg.jump_factor:
                case = find_evidence(evidence, symbol, current, ("REDENOMINATION",), 1)
                if case is not None and case.ratio:
                    rule = EndRule("E4CONV", True, "belegte Umstellung", ratio=case.ratio, url=case.url)
                    segments.append((start, previous, rule, pauses, jumps))
                    start, pauses, jumps = current, [], []
                else:
                    jumps.append((current, factor))
        final = days[-1]
        if final >= cfg.window_end - 1:
            rule = EndRule("OPEN")
        else:
            rule = final_end_rule(symbol, final, evidence, cfg)
        segments.append((start, final, rule, pauses, jumps))
        built = []
        for seg_start, seg_end, rule, seg_pauses, seg_jumps in segments:
            instrument = make_instrument(symbol, candles, seg_start, seg_end)
            instrument.end_rule, instrument.pauses, instrument.jumps = rule, seg_pauses, seg_jumps
            cumulative = 1.0
            for jump_day, factor in seg_jumps:
                if factor >= cfg.jump_factor:  # reading B neutralizes unresolved jumps upwards only
                    cumulative *= factor
                    previous_close = max(day for day in candles if day < jump_day)
                    o, _, _, c, *_ = candles[jump_day]
                    open_jumped = abs(math.log(o / candles[previous_close][3])) >= abs(math.log(c / o))
                    instrument.divisor_b.append((jump_day, cumulative, open_jumped))
            built.append(instrument)
        for current, following in zip(built, built[1:]):
            if current.end_rule.kind in ("E3", "E4CONV") or (current.end_rule.kind == "E7" and current.end_rule.reason == "LONG_GAP_REOPEN_JUMP"):
                current.end_rule.successor = following.id
                current.end_rule.resume_day = following.start
        by_symbol[symbol] = built
        for instrument in built:
            instruments[instrument.id] = instrument
    for symbol, built in by_symbol.items():
        for instrument in built:
            rule = instrument.end_rule
            if rule.kind in ("E6W", "E6C") and rule.successor and "@" not in rule.successor:
                successor = next((candidate for candidate in by_symbol.get(rule.successor, []) if candidate.start > instrument.end), None)
                rule.successor = successor.id if successor else None
                if rule.kind == "E6C" and successor is None:
                    instrument.end_rule = EndRule("E7", False, "MIGRATION_SUCCESSOR_MISSING", url=rule.url)
            for first, last in instrument.pauses:
                cases.append(EventCase("E2", symbol, instrument.id, first, False, {"until": day_text(last)}))
            for jump_day, factor in instrument.jumps:
                cases.append(EventCase("E4", symbol, instrument.id, jump_day, False, {"factor": factor, "status": "ungeklärt"}))
            if rule.kind == "E4CONV":
                cases.append(EventCase("E4", symbol, instrument.id, instrument.end + 1, True, {"ratio": rule.ratio, "status": "belegte Umstellung"}))
            elif rule.kind != "OPEN":
                cases.append(EventCase(rule.kind, symbol, instrument.id, instrument.end, rule.documented,
                                       {"reason": rule.reason, "trigger": day_text(rule.trigger) if rule.trigger else None,
                                        "successor": rule.successor, "ratio": rule.ratio, "url": rule.url,
                                        "resumes": day_text(rule.resume_day) if rule.resume_day else None}))
    for symbol, days in data_errors.items():
        for day in sorted(days):
            cases.append(EventCase("E4", symbol, "", day, True, {"status": "belegter Datenfehler (D12)"}))
    return instruments, cases


def long_gap_rule(symbol: str, previous: int, current: int, candles: dict, evidence: list[Evidence], cfg: Config) -> EndRule:
    case = find_evidence(evidence, symbol, previous, ("PAUSE", "MIGRATION", "SYMBOL_REUSE", "DELISTING"), cfg.evidence_day_tolerance)
    if case is not None and case.kind == "PAUSE":
        return EndRule("E3", True, "belegte Handelspause", url=case.url)
    if case is not None:
        return documented_end_rule(case, previous)
    ratio = candles[current][0] / candles[previous][3]
    if ratio >= cfg.jump_factor:
        return EndRule("E7", False, "LONG_GAP_REOPEN_JUMP")
    return EndRule("E3", False, "lange Lücke")


def final_end_rule(symbol: str, final: int, evidence: list[Evidence], cfg: Config) -> EndRule:
    case = find_evidence(evidence, symbol, final, ("DELISTING", "MIGRATION", "SYMBOL_REUSE"), cfg.evidence_day_tolerance)
    if case is None:
        return EndRule("E7", False, "DATA_END_NO_EVIDENCE")
    return documented_end_rule(case, final)


def documented_end_rule(case: Evidence, last_day: int) -> EndRule:
    has_window = case.trigger is not None and case.trigger <= last_day
    if case.kind == "DELISTING" or (case.kind == "SYMBOL_REUSE" and not case.successor):
        if has_window:
            return EndRule("E5", True, f"belegtes {case.kind}", trigger=case.trigger, url=case.url)
        return EndRule("E7", True, "DELISTING_NO_WINDOW", url=case.url)
    if has_window:
        return EndRule("E6W", True, f"belegte {case.kind}", trigger=case.trigger, successor=case.successor, ratio=case.ratio, url=case.url)
    return EndRule("E6C", True, f"belegte {case.kind} ohne Fenster", successor=case.successor, ratio=case.ratio or 1.0, url=case.url)


# --- Regime replication (D7) ------------------------------------------------------------


def _js_round(value: float) -> float:
    return math.floor(value * 100 + 0.5) / 100


def regime_labels(btc: dict[int, tuple], eth: dict[int, tuple], first: int, last: int) -> dict[int, str]:
    """crypto-native-regime-v1/1.0.0 as in funding_carry_v2.regime_labels: the label of day D uses
    the daily candles opened before D (no look-ahead)."""

    def summary(days: list[int], bars: dict[int, tuple], before: int) -> dict | None:
        closes = [bars[day][3] for day in days if day < before]
        if len(closes) < 200:
            return None
        last_close = closes[-1]
        sma50 = sum(closes[-50:]) / 50
        sma200 = sum(closes[-200:]) / 200
        previous = closes[-21]
        performance = (last_close - previous) / previous * 100 if previous else None
        momentum = "UNKNOWN" if performance is None else "POSITIVE" if performance > 1 else "NEGATIVE" if performance < -1 else "NEUTRAL"
        return {"vs50": _js_round((last_close - sma50) / sma50 * 100), "vs200": _js_round((last_close - sma200) / sma200 * 100),
                "momentum": momentum}

    btc_days, eth_days = sorted(btc), sorted(eth)
    labels = {}
    for day in range(first, last + 1):
        b, e = summary(btc_days, btc, day), summary(eth_days, eth, day)
        if b is None or e is None or b["momentum"] == "UNKNOWN" or e["momentum"] == "UNKNOWN":
            label = "UNKNOWN"
        elif b["vs200"] > 0 and b["vs50"] > 0 and b["momentum"] != "NEGATIVE" and e["vs50"] > 0:
            label = RISK_ON
        elif not b["vs200"] > 0 and b["vs50"] < 0:
            label = "RISK_OFF"
        elif (b["vs50"] > 0) != (e["vs50"] > 0):
            label = "MIXED"
        else:
            label = "NEUTRAL"
        labels[day] = label
    return labels


# --- Market: universe, ranks, tiers (§3, §5, §7) -----------------------------------------


def excluded_static(base: str) -> str | None:
    if base in X1_STABLE_FIAT:
        return "X1"
    if base in X3_COMMODITY:
        return "X3"
    if base in X5_DERIVED:
        return "X5"
    if base in ("BULL", "BEAR"):
        return "X4"
    return None


def leveraged(base: str, day: int, first_day: dict[str, int]) -> bool:
    """X4: suffix UP/DOWN/BULL/BEAR and the rest had a USDT pair on or before the reference day (K5)."""
    for suffix in LEVERAGE_SUFFIXES:
        if base.endswith(suffix) and len(base) > len(suffix):
            first = first_day.get(base[: -len(suffix)] + QUOTE)
            if first is not None and first <= day:
                return True
    return False


@dataclass
class UniverseDay:
    members: list  # instrument ids, highest L30 first
    l30: dict


@dataclass
class Market:
    cfg: Config
    instruments: dict
    labels: dict
    rf: dict  # day -> DTB3 in percent (observations)
    universe: dict = field(default_factory=dict)
    ranks: dict = field(default_factory=dict)  # reading -> day -> {id: rank}
    signals: dict = field(default_factory=dict)  # reading -> day -> {id: r28}
    first_day: dict = field(default_factory=dict)  # symbol -> first candle
    exclusions: dict = field(default_factory=dict)  # symbol -> rule (D5)
    tier_cache: dict = field(default_factory=dict)
    pair: tuple = ("BTCUSDT", "ETHUSDT")

    def instrument_on(self, symbol: str, day: int) -> Instrument | None:
        for instrument in self.instruments.values():
            if instrument.symbol == symbol and instrument.start <= day <= instrument.end:
                return instrument
        return None

    def rf_rate(self, day: int) -> float:
        """DTB3 of the day or the last observation before (decimal, annual)."""
        current = day
        while current not in self.rf:
            current -= 1
            if current < day - 30:
                return 0.0
        return self.rf[current] / 100

    def tier(self, instrument_id: str, day: int) -> tuple[str, bool]:
        """L1/L2/L3 from L30 up to the previous day; the tick proxy forces L3 (§7)."""
        key = (instrument_id, day)
        if key not in self.tier_cache:
            instrument = self.instruments[instrument_id]
            window = instrument.window(day - self.cfg.liquidity_days, day - 1)
            if not window:
                self.tier_cache[key] = ("L3", False)
            else:
                l30 = statistics.median(candle[4] for candle in window)
                prices = sorted({value for candle in window for value in candle[:4]})
                steps = [b - a for a, b in zip(prices, prices[1:]) if b - a > 0]
                tick = bool(steps) and min(steps) / window[-1][3] > self.cfg.tick_proxy_limit
                tier = "L1" if l30 >= self.cfg.tier_l1 else "L2" if l30 >= self.cfg.tier_l2 else "L3"
                self.tier_cache[key] = ("L3" if tick else tier, tick and tier != "L3")
        return self.tier_cache[key]


def build_market(cfg: Config, instruments: dict[str, Instrument], labels: dict[int, str], rf: dict[int, float],
                 universe_days: range | None = None) -> Market:
    market = Market(cfg, instruments, labels, rf)
    for instrument in instruments.values():
        market.first_day[instrument.symbol] = min(market.first_day.get(instrument.symbol, instrument.start), instrument.start)
        rule = excluded_static(instrument.base)
        if rule:
            market.exclusions[instrument.symbol] = rule
    days = universe_days or range(cfg.window_start, cfg.window_end)
    candidates: dict[int, list] = defaultdict(list)
    for instrument in instruments.values():
        if excluded_static(instrument.base):
            continue
        first = max(instrument.start + cfg.history_days, days.start)
        last = min(instrument.end + 1, days.stop - 1)
        for day in range(first, last + 1):
            if instrument.valid_count(day - cfg.liquidity_days, day - 1) != cfg.liquidity_days:
                continue
            window = instrument.candles[day - cfg.liquidity_days - instrument.start: day - instrument.start]
            l30 = statistics.median(candle[4] for candle in window)
            if l30 < cfg.min_liquidity:
                continue
            if leveraged(instrument.base, day - 1, market.first_day):
                market.exclusions.setdefault(instrument.symbol, "X4")
                continue
            closes = [candle[3] for candle in instrument.window(day - cfg.peg_days, day - 1)]
            if max(closes) / min(closes) < cfg.peg_ratio:
                market.exclusions.setdefault(instrument.symbol, "X2")
                continue
            candidates[day].append((l30, instrument.symbol, instrument.id))
    for day in days:
        chosen = sorted(candidates.get(day, []), key=lambda item: (-item[0], item[1]))[: cfg.universe_size]
        market.universe[day] = UniverseDay([item[2] for item in chosen], {item[2]: item[0] for item in chosen})
    for reading in ("A", "B"):
        market.ranks[reading], market.signals[reading] = {}, {}
        for day in days:
            if labels.get(day) != RISK_ON:
                continue
            signals = {}
            for instrument_id in market.universe[day].members:
                signals[instrument_id] = momentum(instruments[instrument_id], day, cfg, reading)
            order = sorted(signals, key=lambda key: (-signals[key], instruments[key].symbol))
            market.ranks[reading][day] = {key: position + 1 for position, key in enumerate(order)}
            market.signals[reading][day] = signals
    return market


def momentum(instrument: Instrument, day: int, cfg: Config, reading: str) -> float:
    """r28 = close(D-1) / close(D-29) - 1; a missing start close falls back to the last close before (§5.1)."""
    end = instrument.close(day - 1, reading) or instrument.last_close(day - 1, reading)
    start = instrument.last_close(day - 1 - cfg.lookback_days, reading)
    return end / start - 1 if start else 0.0


# --- Simulation (§5, §6, §8) ------------------------------------------------------------


@dataclass(frozen=True)
class SimSpec:
    kind: str  # XS, CONTROL, PAIR, BUYHOLD, RANDOM
    schedule: str | None = None  # WEEKLY, FOURWEEKLY
    reading: str = "A"
    lag: int = 0  # B6(e): every execution one day later
    s2: bool = False  # §8.1 scenario S2 (report only)
    cost_mult: float = 1.0  # B6(c)
    delisting_stress: bool = False  # M18
    e3_haircut: bool = False  # M29
    favorable_events: bool = False  # M28 (control only)
    seed: int | None = None  # RANDOM


@dataclass
class Order:
    kind: str  # BUILD, RERANK, GATE_EXIT
    sells: list
    buys: list
    n_eff: int


@dataclass
class SimResult:
    spec: SimSpec
    daily: list  # (day, equity, invested, positions, hhi)
    trades: list  # dicts
    pnl_by_symbol: dict
    events: list  # dicts
    flows: dict  # day -> [buys_out, sells_in, positions_value_close]
    interest: float = 0.0
    paused_outside_risk_on: float = 0.0


def is_schedule_day(day: int, schedule: str | None, cfg: Config) -> bool:
    if schedule == "WEEKLY":
        return weekday(day) == 0
    if schedule == "FOURWEEKLY":
        return weekday(day) == 0 and (day - cfg.four_week_anchor) % 28 == 0
    return False


def simulate(market: Market, spec: SimSpec) -> SimResult:  # noqa: C901 - one book, kept in one place on purpose
    cfg, reading = market.cfg, spec.reading
    instruments = market.instruments
    cash = cfg.slot
    positions: dict[str, list] = {}  # id -> [quantity, entry day]
    frozen: dict[str, float] = {}
    pending_sell: set[str] = set()
    orders: dict[int, list[Order]] = defaultdict(list)
    trades: list[dict] = []
    daily: list[tuple] = []
    events: list[dict] = []
    pnl: dict[str, float] = defaultdict(float)
    flows: dict[int, list] = {}
    rng = random.Random(spec.seed) if spec.kind == "RANDOM" else None
    interest_total = 0.0
    paused_outside = 0.0
    last_value: dict[str, float] = {}

    def price_open(instrument_id: str, day: int) -> float | None:
        return instruments[instrument_id].open(day, reading)

    def value_at_close(instrument_id: str, day: int) -> float:
        quantity = positions[instrument_id][0]
        price = instruments[instrument_id].close(day, reading)
        if price is None:
            price = instruments[instrument_id].last_close(day, reading) or 0.0
        return quantity * price

    def record(day: int, instrument_id: str, side: str, notional: float, tier: str, reason: str, mult: float = 1.0) -> float:
        fee, spread, slippage = TIER_COSTS[tier]
        factor = spec.cost_mult * mult / 10_000
        cost = notional * (fee + spread / 2 + slippage) * factor
        candle = instruments[instrument_id].candle(day)
        trades.append({"day": day, "symbol": instruments[instrument_id].symbol, "instrument": instrument_id, "side": side,
                       "notional": notional, "fee": notional * fee * factor, "spread": notional * spread / 2 * factor,
                       "slippage": notional * slippage * factor, "tier": tier, "reason": reason,
                       "quoteVolume": candle[4] if candle else None,
                       "tickProxy": market.tier(instrument_id, day)[1] if tier == "L3" and reason in ("BUILD", "RERANK", "GATE_EXIT", "FINAL") else False})
        return cost

    def sell(instrument_id: str, day: int, price: float, tier: str, reason: str, flow: list) -> None:
        nonlocal cash
        quantity = positions[instrument_id][0]
        gross = quantity * price
        if 0 < gross < cfg.min_order and reason in ("RERANK", "GATE_EXIT", "BUILD"):
            return  # §5.1: orders below 10 USDT are skipped
        cost = record(day, instrument_id, "SELL", gross, tier, reason) if gross > 0 else 0.0
        proceeds = gross - cost
        cash += proceeds
        flow[1] += proceeds
        pnl[instruments[instrument_id].symbol] += proceeds
        del positions[instrument_id]
        pending_sell.discard(instrument_id)

    def write_off(instrument_id: str, day: int, value: float, reason: str, flow: list, frozen_value: bool) -> None:
        """E7 freeze (A: last close, B and stress: 0) or a stressed forced exit at zero proceeds."""
        if frozen_value:
            frozen[instrument_id] = value
        flow[1] += value
        pnl[instruments[instrument_id].symbol] += value
        events.append({"day": day_text(day), "instrument": instrument_id, "kind": reason, "value": value})
        del positions[instrument_id]
        pending_sell.discard(instrument_id)

    def buy(instrument_id: str, day: int, amount: float, tier: str, reason: str, flow: list) -> None:
        nonlocal cash
        price = price_open(instrument_id, day)
        rate = side_bp(tier) * spec.cost_mult / 10_000
        notional = amount / (1 + rate)
        if price is None or notional < cfg.min_order:
            return
        record(day, instrument_id, "BUY", notional, tier, reason)
        cash -= amount
        flow[0] += amount
        pnl[instruments[instrument_id].symbol] -= amount
        positions[instrument_id] = [notional / price, day]

    def intended(day: int) -> set[str]:
        current = set(positions) - pending_sell
        for exec_day, day_orders in orders.items():
            if exec_day >= day:
                for order in day_orders:
                    current -= set(order.sells)
                    current |= set(order.buys)
        return current

    def universe_targets(day: int) -> tuple[list[str], dict[str, int]]:
        members = market.universe.get(day, UniverseDay([], {})).members
        if spec.kind == "RANDOM":
            shuffled = sorted(members)
            rng.shuffle(shuffled)
            ranks = {key: position + 1 for position, key in enumerate(shuffled)}
        else:
            ranks = market.ranks[reading].get(day, {})
        return members, ranks

    def decide(day: int) -> None:
        label = market.labels.get(day)
        previous = market.labels.get(day - 1) if day > cfg.window_start else None
        if spec.kind == "BUYHOLD":
            if day == cfg.window_start:
                targets = [instrument.id for symbol in market.pair if (instrument := market.instrument_on(symbol, day))]
                orders[day].append(Order("BUILD", [], targets, len(targets)))
            return
        current = intended(day)
        if label == RISK_ON and previous != RISK_ON:
            if spec.kind == "PAIR":
                targets = [instrument.id for symbol in market.pair if (instrument := market.instrument_on(symbol, day - 1))]
                n_eff = 2
            else:
                members, ranks = universe_targets(day)
                if spec.kind == "CONTROL":
                    targets, n_eff = list(members), len(members)
                else:
                    targets = sorted(members, key=lambda key: ranks[key])[: cfg.n_positions]
                    n_eff = min(cfg.n_positions, len(members))
            delay = spec.lag + (1 if spec.s2 else 0)
            orders[day + delay].append(Order("BUILD", sorted(current - set(targets)), [t for t in targets if t not in current], max(n_eff, 1)))
        elif label == RISK_ON and previous == RISK_ON and is_schedule_day(day, spec.schedule, cfg) and spec.kind in ("XS", "RANDOM", "CONTROL"):
            members, ranks = universe_targets(day)
            if spec.kind == "CONTROL":
                sells = sorted(current - set(members))
                buys = [key for key in members if key not in current]
                n_eff = max(len(members), 1)
            else:
                keep = {key for key in current if key in ranks and ranks[key] <= cfg.buffer_rank}
                sells = sorted(current - keep)
                need = max(0, min(cfg.n_positions, len(members)) - len(keep))
                buys = [key for key in sorted(members, key=lambda key: ranks[key]) if key not in current][:need]
                n_eff = cfg.n_positions
            if sells or buys:
                orders[day + spec.lag].append(Order("RERANK", sells, buys, n_eff))
        elif label != RISK_ON and previous == RISK_ON:
            orders[day + spec.lag].append(Order("GATE_EXIT", sorted(current), [], 1))

    def start_of_day_events(day: int, flow: list) -> None:
        for instrument_id in list(positions):
            instrument = instruments[instrument_id]
            rule = instrument.end_rule
            quantity, entry = positions[instrument_id]
            if spec.favorable_events and rule.kind in ("E3", "E5", "E6W", "E6C", "E7"):
                continue  # M28: handled at the close of the last day
            if day <= instrument.end:
                if rule.kind in ("E5", "E6W") and day >= rule.trigger and day >= entry + 1 and instrument.candle(day) is not None:
                    if spec.delisting_stress:
                        write_off(instrument_id, day, 0.0, f"{rule.kind[:2]}-Stress", flow, False)
                    else:
                        sell(instrument_id, day, price_open(instrument_id, day), "L3", rule.kind[:2], flow)
                continue
            # The series of the instrument has ended before this day.
            if rule.kind == "E4CONV" and rule.successor and day >= instruments[rule.successor].start:
                positions[rule.successor] = [quantity * rule.ratio, entry]
                del positions[instrument_id]
                if instrument_id in pending_sell:
                    pending_sell.discard(instrument_id)
                    pending_sell.add(rule.successor)
                events.append({"day": day_text(day), "instrument": instrument_id, "kind": "E4-Umstellung", "ratio": rule.ratio})
            elif rule.kind == "E3":
                if day >= rule.resume_day:
                    successor = instruments[rule.successor]
                    reopen = successor.open(day, reading)
                    if spec.delisting_stress:
                        write_off(instrument_id, day, 0.0, "E3-Stress", flow, False)
                    else:
                        price = min(reopen, instrument.last_close(day, reading)) if spec.e3_haircut else reopen
                        sell_price_instrument(instrument_id, successor.id, day, price, "E3", flow)
            elif rule.kind in ("E6C", "E6W") and rule.successor:
                # E6 without an execution window for this position: exchange at the announced ratio (§4.3).
                successor = instruments[rule.successor]
                if day >= successor.start:
                    if spec.delisting_stress:
                        write_off(instrument_id, day, 0.0, "E6-Stress", flow, False)
                    else:
                        price = (successor.open(day, reading) or successor.last_close(day, reading)) * (rule.ratio or 1.0)
                        sell_price_instrument(instrument_id, successor.id, day, price, "E6", flow)
            elif rule.kind in ("E7", "E5", "E6W") and day >= instrument.end + 1:
                # E7, or E5/E6 without an execution window for this position: frozen without a sale (§4.3).
                if spec.delisting_stress or reading == "B":
                    write_off(instrument_id, day, 0.0, "E7-0", flow, True)
                else:
                    write_off(instrument_id, day, quantity * instrument.last_close(day, reading), "E7-eingefroren", flow, True)

    def sell_price_instrument(instrument_id: str, quote_instrument: str, day: int, price: float, reason: str, flow: list) -> None:
        """A forced exit priced on another instrument of the same asset (E3 reopen, E6 successor)."""
        nonlocal cash
        quantity = positions[instrument_id][0]
        gross = quantity * price
        rate = side_bp("L3") * spec.cost_mult / 10_000
        fee, spread, slippage = TIER_COSTS["L3"]
        factor = spec.cost_mult / 10_000
        trades.append({"day": day, "symbol": instruments[instrument_id].symbol, "instrument": instrument_id, "side": "SELL",
                       "notional": gross, "fee": gross * fee * factor, "spread": gross * spread / 2 * factor,
                       "slippage": gross * slippage * factor, "tier": "L3", "reason": reason,
                       "quoteVolume": (instruments[quote_instrument].candle(day) or (0, 0, 0, 0, None))[4], "tickProxy": False})
        proceeds = gross * (1 - rate)
        cash += proceeds
        flow[1] += proceeds
        pnl[instruments[instrument_id].symbol] += proceeds
        events.append({"day": day_text(day), "instrument": instrument_id, "kind": reason, "value": proceeds})
        del positions[instrument_id]
        pending_sell.discard(instrument_id)

    def execute(day: int, flow: list) -> None:
        nonlocal cash
        todays = orders.pop(day, [])
        if any(order.kind == "GATE_EXIT" for order in todays):
            todays = [order for order in todays if order.kind != "BUILD"]  # S2: the gate closed before the transfer arrived
        for instrument_id in sorted(pending_sell):
            if instrument_id in positions and instruments[instrument_id].candle(day) is not None:
                sell(instrument_id, day, price_open(instrument_id, day), "L3", "E2", flow)
        for order in todays:
            for instrument_id in order.sells:
                if instrument_id not in positions:
                    continue
                if instruments[instrument_id].candle(day) is None or day > instruments[instrument_id].end:
                    pending_sell.add(instrument_id)
                    continue
                tier = "L1" if spec.kind in ("PAIR", "BUYHOLD") else market.tier(instrument_id, day)[0]
                sell(instrument_id, day, price_open(instrument_id, day), tier, order.kind, flow)
            buys = [key for key in order.buys if key not in positions and instruments[key].candle(day) is not None]
            if not buys:
                continue
            equity = cash + sum(positions[key][0] * (price_open(key, day) or instruments[key].last_close(day, reading) or 0.0)
                                for key in positions) + sum(frozen.values())
            amount = min(equity / order.n_eff, cash / len(buys))
            for instrument_id in buys:
                tier = "L1" if spec.kind in ("PAIR", "BUYHOLD") else market.tier(instrument_id, day)[0]
                buy(instrument_id, day, amount, tier, order.kind, flow)

    previous_value = 0.0
    for day in range(cfg.window_start, cfg.window_end):
        flow = [0.0, 0.0, 0.0]
        start_of_day_events(day, flow)
        decide(day)
        execute(day, flow)
        label = market.labels.get(day)
        if spec.s2 and label != RISK_ON and not any(t["day"] == day and t["reason"] == "GATE_EXIT" for t in trades[-60:]):
            interest = cash * market.rf_rate(day) / 365
            cash += interest
            interest_total += interest
        if spec.favorable_events:
            for instrument_id in list(positions):
                instrument = instruments[instrument_id]
                if instrument.end == day and instrument.end_rule.kind in ("E3", "E5", "E6W", "E6C", "E7"):
                    sell(instrument_id, day, instrument.close(day, reading), "L3", "M28-Schluss", flow)
        if day == cfg.window_end - 1:
            for instrument_id in list(positions):
                instrument = instruments[instrument_id]
                price = instrument.close(day, reading)
                if price is None:
                    sell(instrument_id, day, instrument.last_close(day, reading) or 0.0, "L3", "FINAL", flow)
                else:
                    tier = "L1" if spec.kind in ("PAIR", "BUYHOLD") else market.tier(instrument_id, day)[0]
                    sell(instrument_id, day, price, tier, "FINAL", flow)
        values = {key: value_at_close(key, day) for key in positions}
        invested = sum(values.values())
        equity = cash + invested + sum(frozen.values())
        if label != RISK_ON and invested > 0:
            paused_outside += sum(values[key] - last_value[key] for key in values if key in last_value)
        last_value = values
        weights = [value / invested for value in values.values()] if invested > 0 else []
        flow[2] = invested
        flows[day] = flow + [previous_value]
        previous_value = invested
        daily.append((day, equity, invested, len(positions), sum(w * w for w in weights)))
    return SimResult(spec, daily, trades, dict(pnl), events, flows, interest_total, paused_outside)


# --- Statistics (as funding_carry_v2 and packages/evolution/src/paired.ts) ---------------


def student_t975(df: float) -> float:
    """Cornish-Fisher expansion, identical to studentT975 in packages/evolution/src/paired.ts."""
    if not math.isfinite(df) or df < 3:
        raise StudyError(f"Student-t quantile needs at least 3 degrees of freedom, got {df}.")
    z = 1.959963984540054
    g1 = (z**3 + z) / 4
    g2 = (5 * z**5 + 16 * z**3 + 3 * z) / 96
    g3 = (3 * z**7 + 19 * z**5 + 17 * z**3 - 15 * z) / 384
    g4 = (79 * z**9 + 776 * z**7 + 1482 * z**5 - 1920 * z**3 - 945 * z) / 92160
    return z + g1 / df + g2 / df**2 + g3 / df**3 + g4 / df**4


def newey_west_lag(n: int) -> int:
    return max(1, math.floor(4 * (n / 100) ** (2 / 9)))


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float] | None:
    n = len(vector)
    a = [row[:] + [vector[index]] for index, row in enumerate(matrix)]
    for column in range(n):
        pivot = max(range(column, n), key=lambda row: abs(a[row][column]))
        scale = max(max(abs(row[column]) for row in a), 1e-300)
        if abs(a[pivot][column]) <= 1e-12 * scale:
            return None
        a[column], a[pivot] = a[pivot], a[column]
        for row in range(column + 1, n):
            factor = a[row][column] / a[column][column]
            for k in range(column, n + 1):
                a[row][k] -= factor * a[column][k]
    x = [0.0] * n
    for row in range(n - 1, -1, -1):
        x[row] = (a[row][n] - sum(a[row][k] * x[k] for k in range(row + 1, n))) / a[row][row]
    return x


def _invert(matrix: list[list[float]]) -> list[list[float]] | None:
    columns = []
    for index in range(len(matrix)):
        column = _solve(matrix, [1.0 if k == index else 0.0 for k in range(len(matrix))])
        if column is None:
            return None
        columns.append(column)
    return [[columns[col][row] for col in range(len(matrix))] for row in range(len(matrix))]


def ols_hac(y: list[float], x_rows: list[list[float]]) -> dict | None:
    """OLS with max(iid, Newey-West) standard errors, as spanningAlphaTest (paired.ts)."""
    n, p = len(y), len(x_rows[0]) if x_rows else 0
    if n - p < 3:
        return None
    xtx = [[sum(row[i] * row[j] for row in x_rows) for j in range(p)] for i in range(p)]
    xty = [sum(row[i] * value for row, value in zip(x_rows, y)) for i in range(p)]
    coefficients, inverse = _solve(xtx, xty), _invert(xtx)
    if coefficients is None or inverse is None:
        return None
    residuals = [value - sum(c * v for c, v in zip(coefficients, row)) for row, value in zip(x_rows, y)]
    rss = sum(r * r for r in residuals)
    tss = sum(value * value for value in y)
    lag = min(newey_west_lag(n), n - 1)
    meat = [[0.0] * p for _ in range(p)]
    for t in range(n):
        for i in range(p):
            for j in range(p):
                meat[i][j] += residuals[t] ** 2 * x_rows[t][i] * x_rows[t][j]
    for step in range(1, lag + 1):
        weight = 1 - step / (lag + 1)
        for t in range(step, n):
            product = residuals[t] * residuals[t - step]
            for i in range(p):
                for j in range(p):
                    meat[i][j] += weight * product * (x_rows[t][i] * x_rows[t - step][j] + x_rows[t - step][i] * x_rows[t][j])
    iid = [math.sqrt(max(0.0, rss / (n - p) * inverse[k][k])) for k in range(p)]
    hac = [math.sqrt(max(0.0, sum(inverse[k][i] * meat[i][j] * inverse[j][k] for i in range(p) for j in range(p)))) for k in range(p)]
    return {"n": n, "p": p, "coefficients": coefficients, "iid": iid, "hac": hac,
            "se": [max(a, b) for a, b in zip(iid, hac)], "lag": lag, "rss": rss, "tss": tss}


def spanning_alpha(candidate: dict[str, float], factors: list[dict[str, float]], months: list[str]) -> dict:
    """α of r_c = α + Σ βk·rk + ε; t uses max(iid, HAC) (spanningAlphaTest, paired.ts)."""
    rows = [(candidate[m], [1.0] + [f[m] for f in factors]) for m in months if m in candidate and all(m in f for f in factors)]
    n, p = len(rows), len(factors) + 1
    result = {"months": n, "informativeMonths": sum(1 for y, _ in rows if abs(y) > 1e-12), "alpha": None, "tStat": None,
              "criticalT": None, "standardError": None, "betas": None, "lag": None}
    fit = ols_hac([y for y, _ in rows], [x for _, x in rows]) if rows else None
    if fit is None:
        return result
    explained = fit["rss"] <= 1e-18 * max(fit["tss"], 1e-300)
    se = fit["se"][0]
    result.update({"alpha": fit["coefficients"][0], "standardError": se, "lag": fit["lag"], "betas": fit["coefficients"][1:],
                   "tStat": None if explained or se <= 1e-15 else fit["coefficients"][0] / se,
                   "criticalT": student_t975(n - p) if n - p >= 3 else None})
    return result


def pearson(a: list[float], b: list[float]) -> float | None:
    if len(a) < 3:
        return None
    mean_a, mean_b = statistics.fmean(a), statistics.fmean(b)
    cov = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b))
    var_a, var_b = sum((x - mean_a) ** 2 for x in a), sum((y - mean_b) ** 2 for y in b)
    return cov / math.sqrt(var_a * var_b) if var_a > 0 and var_b > 0 else None


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    position = 0
    while position < len(order):
        end = position
        while end + 1 < len(order) and values[order[end + 1]] == values[order[position]]:
            end += 1
        for k in range(position, end + 1):
            ranks[order[k]] = (position + end) / 2 + 1
        position = end + 1
    return ranks


def spearman(a: list[float], b: list[float]) -> float | None:
    return pearson(_ranks(a), _ranks(b)) if len(a) >= 3 else None


def cagr(start: float, end: float, days: int) -> float:
    if start <= 0 or end <= 0 or days <= 0:
        return -1.0
    return (end / start) ** (365.25 / days) - 1


def max_drawdown(values: list[float], start: float | None = None) -> float:
    peak = start if start is not None else (values[0] if values else 0.0)
    worst = 0.0
    for value in values:
        peak = max(peak, value)
        if peak > 0:
            worst = max(worst, 1 - value / peak)
    return worst


def longest_recovery(values: list[float], start: float) -> int:
    peak, since, longest = start, 0, 0
    for value in values:
        if value >= peak:
            peak, since = value, 0
        else:
            since += 1
            longest = max(longest, since)
    return longest


def multiple_test_threshold(cfg: Config, n_months: int, regressors: int) -> float | None:
    if n_months - regressors - 1 < 3:
        return None
    return max(2.0, math.sqrt(2 * math.log(cfg.multiple_test_n_after)), student_t975(n_months - regressors - 1))


# --- Metrics (§9) -----------------------------------------------------------------------


def window_months(cfg: Config) -> list[str]:
    return months_between(month_text(cfg.window_start), month_text(cfg.window_end - 1))


def equity_curve(result: SimResult) -> list[tuple[int, float]]:
    return [(day, equity) for day, equity, *_ in result.daily]


def monthly_returns(curve: list[tuple[int, float]], start_equity: float) -> dict[str, float]:
    month_end: dict[str, float] = {}
    for day, equity in curve:
        month_end[month_text(day)] = equity
    result, previous = {}, start_equity
    for month in sorted(month_end):
        result[month] = month_end[month] / previous - 1 if previous > 0 else 0.0
        previous = month_end[month]
    return result


def equity_at(curve: list[tuple[int, float]], day: int, default: float) -> float:
    value = default
    for point_day, equity in curve:
        if point_day > day:
            break
        value = equity
    return value


def mean_rate(market: Market, first: int, last: int) -> float:
    values = [value for day, value in market.rf.items() if first <= day <= last]
    if not values:
        raise StudyError(f"DTB3 has no observation between {day_text(first)} and {day_text(last)}.")
    return statistics.fmean(values) / 100


def monthly_rf(market: Market, months: list[str]) -> dict[str, float]:
    return {month: sum(market.rf_rate(day) for day in month_days(month)) / 365 for month in months}


def series_metrics(curve: list[tuple[int, float]], market: Market, start_equity: float) -> dict:
    cfg = market.cfg
    values = [equity for _, equity in curve]
    final = values[-1]
    days = len(curve)
    sub_start = equity_at(curve, cfg.subperiod_start - 1, start_equity)
    sub_days = sum(1 for day, _ in curve if day >= cfg.subperiod_start)
    returns, previous = [], start_equity
    for value in values:
        returns.append(value / previous - 1 if previous > 0 else 0.0)
        previous = value
    months = window_months(cfg)
    monthly = monthly_returns(curve, start_equity)
    rf_month = monthly_rf(market, months)
    month_values = [monthly[m] for m in months if m in monthly]
    excess = [monthly[m] - rf_month[m] for m in months if m in monthly]
    risk_on_months = {month_text(day) for day in range(cfg.window_start, cfg.window_end) if market.labels.get(day) == RISK_ON}
    weekly: dict[int, float] = {}
    for day, equity in curve:
        weekly[(day - weekday(day))] = equity
    week_returns, previous = [], start_equity
    for week in sorted(weekly):
        week_returns.append(weekly[week] / previous - 1 if previous > 0 else 0.0)
        previous = weekly[week]
    total = cagr(start_equity, final, days)
    since = cagr(sub_start, final, sub_days)
    rf_total = mean_rate(market, cfg.window_start, cfg.window_end - 1)
    rf_since = mean_rate(market, cfg.subperiod_start, cfg.window_end - 1)
    years, previous = {}, start_equity
    for year in CALENDAR_YEARS:
        end = equity_at(curve, day_of(f"{year}-12-31"), previous)
        years[str(year)] = {"return": end / previous - 1 if previous > 0 else None,
                            "riskOnDays": sum(1 for day in range(max(cfg.window_start, day_of(f"{year}-01-01")),
                                                                 min(cfg.window_end, day_of(f"{year + 1}-01-01")))
                                              if market.labels.get(day) == RISK_ON)}
        previous = end

    def sharpe(series: list[float], scale: float) -> float | None:
        if len(series) < 2:
            return None
        sd = statistics.stdev(series)
        return statistics.fmean(series) / sd * math.sqrt(scale) if sd > 0 else None

    first_part = [(day, equity) for day, equity in curve if day < cfg.subperiod_start]
    later_part = [(day, equity) for day, equity in curve if day >= cfg.subperiod_start]
    first_months = [m for m in months if m < month_text(cfg.subperiod_start) and m in monthly]
    later_months = [m for m in months if m >= month_text(cfg.subperiod_start) and m in monthly]
    return {
        "subperiods": {"2020To2023": {"sharpeMonthly": sharpe([monthly[m] for m in first_months], 12),
                                      "maxDrawdown": max_drawdown([e for _, e in first_part], start_equity) if first_part else None},
                       "since2024": {"sharpeMonthly": sharpe([monthly[m] for m in later_months], 12),
                                     "maxDrawdown": max_drawdown([e for _, e in later_part], sub_start) if later_part else None}},
        "finalEquity": final, "netPerYear": total, "netPerYearSince2024": since,
        "netPerYear2020To2023": cagr(start_equity, sub_start, days - sub_days),
        "sharpeDaily": sharpe(returns, 365), "sharpeMonthly": sharpe(month_values, 12), "sharpeExcessMonthly": sharpe(excess, 12),
        "maxDrawdown": max_drawdown(values, start_equity), "longestRecoveryDays": longest_recovery(values, start_equity),
        "worstMonth": min(month_values) if month_values else None, "worstWeek": min(week_returns) if week_returns else None,
        "negativeMonthShareRiskOn": (sum(1 for m in months if m in risk_on_months and monthly.get(m, 0) < 0)
                                     / max(1, sum(1 for m in months if m in risk_on_months))),
        "calendarYears": years, "monthlyReturns": monthly,
        "riskFreeMean": rf_total, "riskFreeMeanSince2024": rf_since,
        "excessAfterHaircut": total - cfg.haircut - rf_total, "excessAfterHaircutSince2024": since - cfg.haircut - rf_since,
        "excessAfterPessimisticHaircut": total - cfg.haircut_pessimistic - rf_total,
        "excessAfterPessimisticHaircutSince2024": since - cfg.haircut_pessimistic - rf_since,
    }


def trade_metrics(result: SimResult, market: Market) -> dict:
    """M1 decomposition, M12 turnover, M13 cost tiers, M22 capacity."""
    cfg = market.cfg
    fee = sum(t["fee"] for t in result.trades)
    spread = sum(t["spread"] for t in result.trades)
    slippage = sum(t["slippage"] for t in result.trades)
    costs = fee + spread + slippage
    final = result.daily[-1][1]
    net = final - cfg.slot
    notional = sum(t["notional"] for t in result.trades)
    by_tier = defaultdict(float)
    for trade in result.trades:
        by_tier[trade["tier"]] += trade["notional"]
    gate = sum(t["fee"] + t["spread"] + t["slippage"] for t in result.trades if t["reason"] in ("BUILD", "GATE_EXIT"))
    rerank = sum(t["fee"] + t["spread"] + t["slippage"] for t in result.trades if t["reason"] == "RERANK")
    rerank_days = sorted({t["day"] for t in result.trades if t["reason"] == "RERANK"})
    equity_by_day = {day: equity for day, equity, *_ in result.daily}
    replaced = [sum(t["notional"] for t in result.trades if t["day"] == day and t["reason"] == "RERANK" and t["side"] == "SELL")
                / max(equity_by_day.get(day - 1, cfg.slot), 1e-9) for day in rerank_days]
    years = len(result.daily) / 365.25
    average_equity = statistics.fmean(equity for _, equity, *_ in result.daily)
    costs_by_year: dict[str, float] = defaultdict(float)
    for trade in result.trades:
        costs_by_year[day_text(trade["day"])[:4]] += trade["fee"] + trade["spread"] + trade["slippage"]
    capacities = [cfg.capacity_participation * t["quoteVolume"] * cfg.slot / t["notional"]
                  for t in result.trades if t["quoteVolume"] and t["notional"] > 0]
    return {
        "pnl": net, "gross": net + costs, "costs": costs, "fee": fee, "spread": spread, "slippage": slippage,
        "costShareOfGross": costs / (net + costs) if net + costs > 0 else None,
        "rerankDays": len(rerank_days), "meanReplacedShare": statistics.fmean(replaced) if replaced else 0.0,
        "turnoverPerYear": notional / 2 / average_equity / years if average_equity > 0 else None,
        "costGate": gate, "costRerank": rerank, "costEvents": costs - gate - rerank,
        "tierShare": {tier: by_tier[tier] / notional if notional else 0.0 for tier in ("L1", "L2", "L3")},
        "meanCostPerSideBp": costs / notional * 10_000 if notional else 0.0,
        "l3ByTickProxy": sum(1 for t in result.trades if t.get("tickProxy")),
        "capacitySlot": min(capacities) if capacities else None, "trades": len(result.trades), "costsByYear": dict(sorted(costs_by_year.items())),
    }


def quota_metrics(result: SimResult, market: Market) -> dict:
    """M16 investment quota and M26 positions and concentration."""
    risk_on = [(day, equity, invested, count, hhi) for day, equity, invested, count, hhi in result.daily if market.labels.get(day) == RISK_ON]
    quota_all = [invested / equity if equity > 0 else 0.0 for _, equity, invested, *_ in result.daily]
    quota_on = [invested / equity if equity > 0 else 0.0 for _, equity, invested, *_ in risk_on]
    by_month: dict[str, list] = defaultdict(list)
    for day, equity, invested, *_ in risk_on:
        by_month[month_text(day)].append(invested / equity if equity > 0 else 0.0)
    month_means = sorted(statistics.fmean(values) for values in by_month.values())

    def quantile(values: list[float], q: float) -> float | None:
        if not values:
            return None
        return values[min(len(values) - 1, max(0, round(q * (len(values) - 1))))]

    return {"meanQuotaAllDays": statistics.fmean(quota_all) if quota_all else 0.0,
            "meanQuotaRiskOn": statistics.fmean(quota_on) if quota_on else 0.0,
            "monthlyQuotaRiskOn": {"p10": quantile(month_means, 0.1), "median": quantile(month_means, 0.5), "p90": quantile(month_means, 0.9)},
            "meanPositionsRiskOn": statistics.fmean(count for *_, count, _ in risk_on) if risk_on else 0.0,
            "meanHerfindahlRiskOn": statistics.fmean(hhi for *_, hhi in risk_on) if risk_on else 0.0}


def invested_capital_return(result: SimResult, market: Market) -> float:
    """M27: chain-linked daily return of the invested part over RISK_ON days and phase exits."""
    total = 1.0
    previous_label = None
    for day in sorted(result.flows):
        buys, sells, value, previous_value = result.flows[day]
        label = market.labels.get(day)
        if label == RISK_ON or previous_label == RISK_ON:
            base = previous_value + buys
            if base > 0:
                total *= 1 + (value + sells - buys - previous_value) / base
        previous_label = label
    return total - 1


def concentration(result: SimResult) -> dict:
    """M15: contribution of the best instrument and the best five."""
    pnl = dict(result.pnl_by_symbol)
    total = sum(pnl.values())
    ordered = sorted(pnl.items(), key=lambda item: item[1], reverse=True)
    best = ordered[0] if ordered else (None, 0.0)
    return {"totalPnlBySymbol": total, "bestSymbol": best[0], "bestContribution": best[1],
            "best5Contribution": sum(value for _, value in ordered[:5]), "pnlWithoutBest": total - best[1]}


def monthly_series_metrics(monthly: dict[str, float], market: Market, extra: dict[str, float] | None = None) -> dict:
    """Champion and challenger (monthly series only); extra adds S2 interest per month."""
    cfg = market.cfg
    months = window_months(cfg)
    equity, curve = cfg.slot, []
    for month in months:
        equity *= 1 + monthly[month] + (extra.get(month, 0.0) if extra else 0.0)
        curve.append(equity)
    returns = [curve[0] / cfg.slot - 1] + [b / a - 1 for a, b in zip(curve, curve[1:])]
    sd = statistics.stdev(returns) if len(returns) > 1 else 0.0
    days = cfg.window_end - cfg.window_start
    rf_month = monthly_rf(market, months)
    excess = [r - rf_month[m] for r, m in zip(returns, months)]
    sd_excess = statistics.stdev(excess) if len(excess) > 1 else 0.0
    return {"netPerYear": cagr(cfg.slot, curve[-1], days), "sharpeMonthly": statistics.fmean(returns) / sd * math.sqrt(12) if sd > 0 else None,
            "sharpeExcessMonthly": statistics.fmean(excess) / sd_excess * math.sqrt(12) if sd_excess > 0 else None,
            "maxDrawdownMonthEnd": max_drawdown(curve, cfg.slot), "worstMonth": min(returns),
            "excessOverRiskFree": cagr(cfg.slot, curve[-1], days) - mean_rate(market, cfg.window_start, cfg.window_end - 1),
            "monthlyReturns": dict(zip(months, returns))}


def ic_metrics(market: Market, schedule: str) -> dict:
    """M23: rank IC between r28 and the return until the next schedule day, inside RISK_ON only (K2)."""
    cfg = market.cfg
    days = [day for day in range(cfg.window_start, cfg.window_end) if market.labels.get(day) == RISK_ON
            and (is_schedule_day(day, schedule, cfg) or market.labels.get(day - 1) != RISK_ON)]
    values = []
    for index, day in enumerate(days):
        end = day + 1
        while end < cfg.window_end and market.labels.get(end) == RISK_ON and not is_schedule_day(end, schedule, cfg):
            end += 1
        end = min(end, cfg.window_end - 1)
        signals, forward = [], []
        for key, signal in market.signals["A"].get(day, {}).items():
            instrument = market.instruments[key]
            start_price, end_price = instrument.open(day), instrument.open(end) or instrument.last_close(end)
            if start_price and end_price and end <= instrument.end:
                signals.append(signal)
                forward.append(end_price / start_price - 1)
        if len(signals) >= 5:
            ic = spearman(signals, forward)
            if ic is not None:
                values.append(ic)
    if len(values) < 2:
        return {"days": len(values), "meanIc": statistics.fmean(values) if values else None, "tStat": None}
    sd = statistics.stdev(values)
    return {"days": len(values), "meanIc": statistics.fmean(values), "tStat": statistics.fmean(values) / sd * math.sqrt(len(values)) if sd > 0 else None}


# --- Criteria and classes (§10) ---------------------------------------------------------


@dataclass
class Runs:
    """All simulations of one reading (§10.2, rule 1)."""

    base: dict
    cost2: dict
    delist: dict
    lag1: dict


VARIANTS = {"A": ("XS", "WEEKLY"), "B": ("XS", "FOURWEEKLY")}
CONTROLS = {"A": "K_A", "B": "K_B"}


def run_reading(market: Market, reading: str) -> Runs:
    def specs(**options) -> dict:
        return {"A": simulate(market, SimSpec("XS", "WEEKLY", reading, **options)),
                "B": simulate(market, SimSpec("XS", "FOURWEEKLY", reading, **options)),
                "K_A": simulate(market, SimSpec("CONTROL", "WEEKLY", reading, **options)),
                "K_B": simulate(market, SimSpec("CONTROL", "FOURWEEKLY", reading, **options)),
                "R": simulate(market, SimSpec("PAIR", None, reading, **options))}
    return Runs(specs(), specs(cost_mult=market.cfg.cost_stress), specs(delisting_stress=True), specs(lag=1))


def criteria_for(variant: str, runs: Runs, market: Market, benchmarks: dict[str, dict[str, float]]) -> dict:
    cfg = market.cfg
    months = window_months(cfg)
    control = CONTROLS[variant]
    metric = {key: series_metrics(equity_curve(result), market, cfg.slot) for key, result in runs.base.items()}
    v, k, r = metric[variant], metric[control], metric["R"]
    first_months = [m for m in months if m < month_text(cfg.subperiod_start)]
    later_months = [m for m in months if m >= month_text(cfg.subperiod_start)]
    selection_alpha = spanning_alpha(v["monthlyReturns"], [k["monthlyReturns"]], months)
    selection_first = spanning_alpha(v["monthlyReturns"], [k["monthlyReturns"]], first_months)
    selection_later = spanning_alpha(v["monthlyReturns"], [k["monthlyReturns"]], later_months)
    threshold_2 = multiple_test_threshold(cfg, selection_alpha["months"], 1)
    own = spanning_alpha(v["monthlyReturns"], [benchmarks["champion"], benchmarks["challenger"]], months)
    own_first = spanning_alpha(v["monthlyReturns"], [benchmarks["champion"], benchmarks["challenger"]], first_months)
    own_later = spanning_alpha(v["monthlyReturns"], [benchmarks["champion"], benchmarks["challenger"]], later_months)
    threshold_3 = multiple_test_threshold(cfg, own["months"], 2)
    selection_monthly = {m: v["monthlyReturns"][m] - k["monthlyReturns"][m] for m in months}
    selection_corr = pearson([selection_monthly[m] for m in months], [benchmarks["challenger"][m] for m in months])
    b1 = v["excessAfterHaircut"] > 0
    b2 = v["excessAfterHaircutSince2024"] > 0
    b3a_core = (selection_alpha["tStat"] is not None and threshold_2 is not None and selection_alpha["tStat"] >= threshold_2
                and selection_alpha["informativeMonths"] >= cfg.min_informative_months and (selection_first["alpha"] or 0) > 0)
    b3a_later = (selection_later["alpha"] or 0) > 0
    b3b = v["netPerYear"] > k["netPerYear"]
    b3c = v["netPerYear"] >= r["netPerYear"] and (v["sharpeMonthly"] or -1e9) >= (r["sharpeMonthly"] or -1e9)
    b4 = (v["maxDrawdown"] <= cfg.drawdown_ratio * k["maxDrawdown"]
          and _calmar(v) >= _calmar(k))
    b5_core = (own["tStat"] is not None and threshold_3 is not None and own["tStat"] >= threshold_3
               and own["informativeMonths"] >= cfg.min_informative_months and (own_first["alpha"] or 0) > 0
               and selection_corr is not None and selection_corr <= cfg.max_selection_correlation)
    b5_later = (own_later["alpha"] or 0) > 0
    qualifying = [year for year, data in v["calendarYears"].items() if data["riskOnDays"] >= cfg.min_risk_on_days_year]
    yearly_selection = {year: (v["calendarYears"][year]["return"] or 0) - (k["calendarYears"][year]["return"] or 0) for year in qualifying}
    positive_years = sum(1 for value in yearly_selection.values() if value > 0)
    needed_years = math.ceil(2 * len(qualifying) / 3)
    without_best = sum(yearly_selection.values()) - (max(yearly_selection.values()) if yearly_selection else 0.0)
    stress = {name: (series_metrics(equity_curve(getattr(runs, name)[variant]), market, cfg.slot),
                     series_metrics(equity_curve(getattr(runs, name)[control]), market, cfg.slot)) for name in ("cost2", "delist", "lag1")}
    b6 = {"a": len(qualifying) > 0 and positive_years >= needed_years,
          "b": len(qualifying) > 0 and without_best > 0,
          "c": stress["cost2"][0]["netPerYear"] > stress["cost2"][1]["netPerYear"] and stress["cost2"][0]["excessAfterHaircut"] > 0,
          "d": stress["delist"][0]["netPerYear"] > stress["delist"][1]["netPerYear"],
          "e": stress["lag1"][0]["netPerYear"] > stress["lag1"][1]["netPerYear"]}
    return {
        "B1": b1, "B2": b2, "B3": b3a_core and b3a_later and b3b and b3c, "B4": b4, "B5": b5_core and b5_later, "B6": all(b6.values()),
        "B3withoutSince2024": b3a_core and b3b and b3c, "B5withoutSince2024": b5_core,
        "B3WithDailySharpe": b3a_core and b3a_later and b3b and v["netPerYear"] >= r["netPerYear"]
                             and (v["sharpeDaily"] or -1e9) >= (r["sharpeDaily"] or -1e9),
        "since2024AlphaPositive": {"B3": b3a_later, "B5": b5_later},
        "details": {
            "B3": {"a": b3a_core and b3a_later, "b": b3b, "c": b3c,
                   "cWithDailySharpe": v["netPerYear"] >= r["netPerYear"] and (v["sharpeDaily"] or -1e9) >= (r["sharpeDaily"] or -1e9),
                   "selectionAlpha": selection_alpha, "alphaFirstPeriod": selection_first["alpha"], "alphaSince2024": selection_later["alpha"],
                   "threshold": threshold_2},
            "B5": {"ownAlpha": own, "alphaFirstPeriod": own_first["alpha"], "alphaSince2024": own_later["alpha"], "threshold": threshold_3,
                   "selectionCorrelationChallenger": selection_corr},
            "B6": {**b6, "qualifyingYears": qualifying, "positiveYears": positive_years, "neededYears": needed_years,
                   "yearlySelection": yearly_selection, "sumWithoutBestYear": without_best,
                   "netCost2": [stress["cost2"][0]["netPerYear"], stress["cost2"][1]["netPerYear"]],
                   "netDelistingStress": [stress["delist"][0]["netPerYear"], stress["delist"][1]["netPerYear"]],
                   "netLag1": [stress["lag1"][0]["netPerYear"], stress["lag1"][1]["netPerYear"]]},
            "B4": {"maxDrawdown": [v["maxDrawdown"], k["maxDrawdown"]], "calmar": [_calmar(v), _calmar(k)]},
        },
        "metrics": {"variant": v, "control": k, "reference": r},
    }


def _calmar(metrics: dict) -> float:
    return metrics["netPerYear"] / metrics["maxDrawdown"] if metrics["maxDrawdown"] > 0 else float("inf") if metrics["netPerYear"] > 0 else 0.0


def classify(criteria: dict[str, dict], controls_b1: bool, venue_status: str, cfg: Config) -> dict:
    keys = ("B1", "B2", "B3", "B4", "B5", "B6")
    passing = [v for v in ("A", "B") if all(criteria[v][key] for key in keys)]
    compressed = []
    for variant in ("A", "B"):
        c = criteria[variant]
        others = c["B1"] and c["B3withoutSince2024"] and c["B4"] and c["B5withoutSince2024"] and c["B6"]
        if others and (not c["B2"] or not c["since2024AlphaPositive"]["B3"] or not c["since2024AlphaPositive"]["B5"]):
            compressed.append(variant)
    selected = None
    if len(passing) == 2:
        net = {v: criteria[v]["metrics"]["variant"]["netPerYear"] for v in passing}
        dd = {v: criteria[v]["metrics"]["variant"]["maxDrawdown"] for v in passing}
        # §10.3: B unless A is at least 1.0 pp better and has no larger drawdown (tolerance for float rounding).
        selected = "A" if net["A"] - net["B"] >= cfg.selection_margin - 1e-12 and dd["A"] <= dd["B"] else "B"
    elif passing:
        selected = passing[0]
    subclass = None
    if selected:
        outcome = "BESTANDEN" if venue_status == "VERFUEGBAR" else "AUSSTEHEND_PHASE_1B" if venue_status == "OFFEN" else "BESTANDEN_REFERENZ"
    elif compressed:
        outcome = "KOMPRIMIERT"
    else:
        outcome = "NICHT_BESTANDEN"
        if not any(criteria[v]["B3"] for v in ("A", "B")) and controls_b1:
            subclass = "NUR_BETA"
    return {"outcome": outcome, "subclass": subclass, "passingVariants": passing, "compressedVariants": compressed, "selectedVariant": selected}


def determinability(class_a: dict, class_b: dict, accepted_halts: list[str]) -> dict:
    """§10.2 rules 2-4."""
    positive_a, positive_b = class_a["outcome"] in POSITIVE_CLASSES, class_b["outcome"] in POSITIVE_CLASSES
    if positive_a != positive_b:
        return {"outcome": "NICHT_BESTIMMBAR", "reason": "Lesarten A und B unterscheiden sich im positiven Urteil (Regel 3)"}
    if positive_a and any(check in accepted_halts for check in ("D0", "D0b")):
        return {"outcome": "NICHT_BESTIMMBAR", "reason": "positives Ergebnis nach angenommenem Halt an D0/D0b (Regel 4)"}
    return {"outcome": class_a["outcome"], "subclass": class_a.get("subclass"),
            "reason": "beide Lesarten gleich" if class_a["outcome"] == class_b["outcome"] else "beide Lesarten nicht positiv; es gilt Lesart A (Regel 2)"}


# --- Checks on listing and data (D0-D12) ------------------------------------------------


def d0b_p7(document: dict, symbols: dict[str, list[str]], cfg: Config) -> dict:
    """D0b under precision P7, re-checked here against the listing: announcements 2021-2025 (named pairs or
    token delistings proven by archived exchangeInfo), and for 2020 every USDT pair that the archived captures
    show ending; such a pair needs a file between the month before its last TRADING capture (or its first
    capture) and the month it was seen ended."""
    years = {}
    pairs_2020 = document.get("endings2020") or []
    found = []
    for item in pairs_2020:
        required = max(shift_month(item["lastSeenTrading"][:7], -1), item["firstSeenTrading"][:7])
        found.append((item["pair"], any(required <= month <= item["firstSeenEnded"][:7] for month in symbols.get(item["pair"], []))))
    years["2020"] = {"method": "snapshots", "pairs": len(found), "found": sum(ok for _, ok in found),
                     "missing": [pair for pair, ok in found if not ok]}
    for year in range(2021, 2026):
        items = sorted(document.get("years", {}).get(str(year), []), key=lambda item: item["published"])[: cfg.d0b_announcements_per_year]
        checks = []
        for item in items:
            required = shift_month(item["tradingEnd"][:7], -1)
            for pair in item["pairs"]:
                months = symbols.get(pair, [])
                checks.append((pair, bool(months) and max(months) >= required))
        years[str(year)] = {"method": "announcements", "announcements": len(items), "pairs": len(checks),
                            "found": sum(ok for _, ok in checks), "missing": [pair for pair, ok in checks if not ok]}
    for item in years.values():
        item["share"] = item["found"] / item["pairs"] if item["pairs"] else None
    performable = bool(pairs_2020) and all(years[str(year)]["announcements"] >= cfg.d0b_announcements_per_year for year in range(2021, 2026))
    passed = performable and all(item["share"] is not None and item["share"] >= cfg.d0b_min_share for item in years.values())
    return {"precision": "P7", "years": years, "performable": performable, "passed": passed}


def shift_month(month: str, delta: int) -> str:
    index = int(month[:4]) * 12 + int(month[5:7]) - 1 + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def check_listing(data: Path, cfg: Config) -> dict:
    """D0, D0b and D0c on the step-1.2 metadata; never opens a market data file."""
    listing = read_json(data / "listing" / "spot-monthly-klines-1d.json")
    announcements = read_json(data / "listing" / "announcements-d0b.json", {})
    exchange = read_json(data / "listing" / "exchangeInfo.json", {})
    symbols = usdt_symbols(listing)
    never = {item["symbol"]: item.get("url", "") for item in announcements.get("neverListed", [])}
    d0_missing, d0_never = [], []
    for symbol, year in D0_CONTROL.items():
        months = symbols.get(symbol, [])
        if any(month.startswith(str(year)) for month in months):
            continue
        (d0_never if symbol in never else d0_missing).append(symbol)
    d0 = {"controlList": D0_CONTROL, "missing": d0_missing, "neverListedWithEvidence": d0_never, "passed": not d0_missing}
    years = announcements.get("years", {})
    d0b_years = {}
    performable = True
    for year in D0B_YEARS:
        items = sorted(years.get(str(year), []), key=lambda item: item["published"])[: cfg.d0b_announcements_per_year]
        if len(items) < cfg.d0b_announcements_per_year:
            performable = False
        pairs = [(pair, item["tradingEnd"]) for item in items for pair in item.get("pairs", []) if pair.endswith(QUOTE)]
        found = []
        for pair, trading_end in pairs:
            end_month = month_text(day_of(trading_end))
            previous_month = months_between("1990-01", end_month)[-2] if end_month > "1990-01" else end_month
            months = symbols.get(pair, [])
            found.append(bool(months) and max(months) >= previous_month)
        share = sum(found) / len(found) if found else None
        d0b_years[str(year)] = {"announcements": len(items), "pairs": len(pairs), "found": sum(found), "share": share,
                                "missing": [pair for (pair, _), ok in zip(pairs, found) if not ok]}
        if share is None:
            performable = False
    d0b_passed = performable and all(item["share"] is not None and item["share"] >= cfg.d0b_min_share for item in d0b_years.values())
    ended = defaultdict(int)
    for symbol, months in symbols.items():
        if months and max(months) < month_text(cfg.window_end - 1):
            ended[max(months)[:4]] += 1
    d0b = {"years": d0b_years, "performable": performable, "passed": d0b_passed, "endingSymbolsPerYear": dict(sorted(ended.items()))}
    if "P7" in APPROVED_PRECISIONS:  # the frozen reading stays in the report next to the approved one
        d0b = {**d0b_p7(read_json(data / "listing" / "announcements-d0b-p7.json"), symbols, cfg),
               "v1": d0b, "endingSymbolsPerYear": d0b["endingSymbolsPerYear"]}
    not_trading = [item["symbol"] for item in exchange.get("symbols", []) if item.get("quoteAsset") == QUOTE and item.get("status") != "TRADING"]
    absent = [symbol for symbol in not_trading if symbol not in symbols]
    d0c = {"notTradingUsdtSymbols": len(not_trading), "absentFromArchive": absent,
           "absentShare": len(absent) / len(not_trading) if not_trading else None}
    halts = [name for name, passed in (("D0", d0["passed"]), ("D0b", d0b["passed"])) if not passed]
    holes = {symbol: [month for month in months_between(months[0], months[-1]) if month not in months]
             for symbol, months in symbols.items() if months}
    holes = {symbol: missing for symbol, missing in holes.items() if missing}
    return {"usdtSymbols": len(symbols), "D0": d0, "D0b": d0b, "D0c": d0c, "halts": halts,
            "interiorMonthHoles": holes}  # whole archive months missing inside a series: long gaps (D3, D4), never filled by E1


def d6_check(series: dict[str, SymbolSeries], snapshot: dict[str, dict], cfg: Config) -> dict:
    compared = mismatched = 0
    examples = []
    for symbol in ("BTCUSDT", "ETHUSDT"):
        archive = series.get(symbol)
        bars = snapshot.get(symbol, {})
        for day in range(cfg.window_start, cfg.window_end):
            if archive is None or day not in archive.candles or day not in bars:
                continue
            compared += 1
            a, b = archive.candles[day][3], bars[day][3]
            if abs(a - b) > cfg.d6_tolerance * max(abs(a), abs(b)):
                mismatched += 1
                if len(examples) < 20:
                    examples.append(f"{symbol} {day_text(day)}: {a} / {b}")
    share = mismatched / compared if compared else 1.0
    return {"compared": compared, "mismatched": mismatched, "share": share, "examples": examples,
            "passed": compared > 0 and share <= cfg.d6_max_mismatch_share}


def d8_check(market: Market) -> dict:
    """Abdi/Ranaldo (2017) spread estimate per instrument and month for month-end members, by tier (report only)."""
    cfg = market.cfg
    assumed = {tier: TIER_COSTS[tier][1] for tier in TIER_COSTS}
    estimates: dict[str, list] = defaultdict(list)
    for month in window_months(cfg):
        last_day = min(month_days(month)[-1], cfg.window_end - 1)
        for key in market.universe.get(last_day, UniverseDay([], {})).members:
            instrument = market.instruments[key]
            terms = []
            for day in month_days(month):
                today, tomorrow = instrument.candle(day), instrument.candle(day + 1)
                if today is None or tomorrow is None or day + 1 > last_day:
                    continue
                eta_t = (math.log(today[1]) + math.log(today[2])) / 2
                eta_n = (math.log(tomorrow[1]) + math.log(tomorrow[2])) / 2
                c_t = math.log(today[3])
                terms.append((c_t - eta_t) * (c_t - eta_n))
            if terms:
                estimates[market.tier(key, last_day)[0]].append(math.sqrt(max(4 * statistics.fmean(terms), 0.0)) * 10_000)
    report = {}
    for tier, values in estimates.items():
        median = statistics.median(values)
        report[tier] = {"cases": len(values), "medianBp": median, "assumedBp": assumed[tier], "flag": median > 2 * assumed[tier]}
    return {"byTier": report}


def d9_check(market: Market) -> dict:
    cfg = market.cfg
    sizes: dict[str, list] = defaultdict(list)
    members_ever: set[str] = set()
    for day in range(cfg.window_start, cfg.window_end):
        members = market.universe.get(day, UniverseDay([], {})).members
        sizes[month_text(day)].append(len(members))
        members_ever.update(members)
    ended = {key for key in members_ever if market.instruments[key].end_rule.kind in ("E5", "E6W", "E6C", "E7")}  # the asset ended (§4.3)
    member_days = sum(len(market.universe[day].members) for day in market.universe)
    ended_days = sum(1 for day in market.universe for key in market.universe[day].members if key in ended)
    by_year = defaultdict(list)
    for key in ended:
        by_year[day_text(market.instruments[key].end)[:4]].append(market.instruments[key].symbol)
    days_small = sum(1 for day in market.universe if len(market.universe[day].members) < 20)
    return {"byMonth": {month: {"min": min(values), "median": statistics.median(values), "max": max(values)} for month, values in sizes.items()},
            "distinctMembers": len(members_ever), "membersEnded": len(ended),
            "endedShareBySymbols": len(ended) / len(members_ever) if members_ever else 0.0,
            "endedShareBySymbolDays": ended_days / member_days if member_days else 0.0,
            "endedByYear": {year: sorted(set(symbols)) for year, symbols in sorted(by_year.items())},
            "shareOfDaysWithFewerThan20": days_small / len(market.universe) if market.universe else 0.0,
            "halt": len(ended) == 0}


def long_gap_review(cases: list[EventCase], members_ever: set[str], review: dict | None) -> dict:
    """Operator requirement of 2026-10-17 (P7 draft, part c): a long gap of a universe member without a
    documented pause is booked as E3 only after the hourly archive was checked for it. Hourly files inside
    the gap mean a suspected archive error; an unchecked or suspected gap halts at D11 for the operator."""
    checked = {(item["symbol"], item["from"]): item for item in (review or {}).get("gaps", [])}
    unchecked, suspected, not_checkable = [], [], []
    for case in cases:
        if case.kind != "E3" or case.documented or case.instrument not in members_ever:
            continue
        resumes = case.detail.get("resumes")
        gap = {"symbol": case.symbol, "from": day_text(case.day + 1), "to": day_text(day_of(resumes) - 1) if resumes else None}
        item = checked.get((gap["symbol"], gap["from"]))
        if item is None:
            unchecked.append(gap)
        elif item.get("verdict") == "suspected":
            suspected.append({**gap, "hourlyDaysInGap": item.get("hourlyDaysInGap")})
        elif item.get("verdict") == "notCheckable":
            not_checkable.append(gap)
    return {"unchecked": unchecked, "suspectedArchiveErrors": suspected, "notCheckable": not_checkable,
            "halt": bool(unchecked or suspected)}


def d11_check(market: Market, cases: list[EventCase], gap_review: dict | None = None) -> dict:
    cfg = market.cfg
    members_ever = {key for day in market.universe for key in market.universe[day].members}
    symbols = {market.instruments[key].symbol for key in members_ever}
    final_ends = [case for case in cases if case.kind in ("E5", "E6W", "E6C", "E7") and case.instrument in members_ever
                  and case.detail.get("reason") != "LONG_GAP_REOPEN_JUMP"]
    documented = [case for case in final_ends if case.documented]
    share = len(documented) / len(final_ends) if final_ends else 1.0
    lookups = [{"symbol": case.symbol, "kind": case.kind, "day": day_text(case.day), "documented": case.documented}
               for case in cases if case.symbol in symbols and case.kind in ("E3", "E4", "E5", "E6W", "E6C", "E7")]
    gaps = long_gap_review(cases, members_ever, gap_review)
    return {"finalEnds": len(final_ends), "documented": len(documented), "share": share, "longGapReview": gaps,
            "halt": share < cfg.d11_min_share or gaps["halt"], "cases": lookups}


def load_inputs(data: Path, spot: Path | None, cfg: Config) -> dict:
    listing = read_json(data / "listing" / "spot-monthly-klines-1d.json")
    series, reports = load_archive(data, listing, cfg)
    snapshot = {symbol: parse_spot_snapshot((spot or DEFAULT_SPOT) / f"{symbol}-1d.csv.gz", cfg) for symbol in ("BTCUSDT", "ETHUSDT")}
    evidence = parse_evidence(read_json(data / "events" / "evidence.json", {"cases": []}))
    rf = parse_dtb3(data / "fred" / "DTB3.csv")
    gap_review = read_json(data / "events" / "long-gap-check.json", None)
    return {"listing": listing, "series": series, "reports": reports, "snapshot": snapshot, "evidence": evidence, "rf": rf,
            "gapReview": gap_review}


def prepare(data: Path, spot: Path | None, cfg: Config, synthetic: bool) -> tuple[dict, Market | None, list]:
    """All data checks D0-D12 in the order of §4.2; returns the market only if the blocking checks pass."""
    inputs = load_inputs(data, spot, cfg)
    report = {"synthetic": synthetic, "listing": check_listing(data, cfg), **inputs["reports"]}
    series = inputs["series"]
    report["D3"] = check_gaps(series, cfg)
    report["D6"] = d6_check(series, inputs["snapshot"], cfg)
    labels = regime_labels(inputs["snapshot"]["BTCUSDT"], inputs["snapshot"]["ETHUSDT"], cfg.window_start, cfg.window_end - 1)
    counts = {label: sum(1 for value in labels.values() if value == label) for label in ("RISK_ON", "NEUTRAL", "MIXED", "RISK_OFF", "UNKNOWN")}
    expected = REGIME_COUNTS
    if synthetic:
        expected = read_json(data / "synthetic.json")["regimeCounts"]
    report["D7"] = {"counts": counts, "expected": expected, "passed": all(counts.get(k) == v for k, v in expected.items()) and counts["UNKNOWN"] == 0}
    data_errors, report["D12"] = check_jump_days(data, series, cfg)
    instruments, cases = build_instruments(series, inputs["evidence"], data_errors, cfg)
    report["D4"] = {"cases": len(cases), "byKind": dict(sorted(_count(case.kind for case in cases).items())),
                    "list": [{"kind": c.kind, "symbol": c.symbol, "day": day_text(c.day), "documented": c.documented, **c.detail} for c in cases][:500]}
    blocking = {name: report[name]["passed"] for name in BLOCKING_CHECKS}
    report["blocking"] = blocking
    report["blockingPassed"] = all(blocking.values())
    if not report["blockingPassed"]:
        report["halts"] = report["listing"]["halts"]
        return report, None, cases
    market = build_market(cfg, instruments, labels, inputs["rf"])
    report["D5"] = {"excluded": dict(sorted(market.exclusions.items()))}
    report["D8"] = d8_check(market)
    report["D9"] = d9_check(market)
    report["D11"] = d11_check(market, cases, inputs["gapReview"])
    halts = list(report["listing"]["halts"])
    if report["D9"]["halt"]:
        halts.append("D9")
    if report["D11"]["halt"]:
        halts.append("D11")
    report["halts"] = halts
    report["regimeCounts"] = counts
    return report, market, cases


def _count(items) -> dict:
    counts: dict = defaultdict(int)
    for item in items:
        counts[item] += 1
    return dict(counts)


def plan(data: Path, spot: Path | None, cfg: Config) -> dict:
    """Files and evidence to fetch next (E1 daily files, D12 jump days, D11 cases); timestamps and volumes only."""
    listing = read_json(data / "listing" / "spot-monthly-klines-1d.json")
    series, _ = load_archive(data, listing, cfg)
    e1 = []
    for symbol, item in series.items():
        days = sorted(item.candles)
        e1.extend(f"{symbol}\t{day_text(day)}" for day in range(days[0], days[-1] + 1) if day not in item.candles)
    report: dict = {"dailyFilesE1": e1}
    members = None
    try:
        _, market, cases = prepare(data, spot, cfg, (data / "SYNTHETIC").exists())
        if market is not None:
            d11 = d11_check(market, cases)
            report["evidenceCasesD11"] = d11["cases"]
            report["longGapsToCheck"] = d11["longGapReview"]["unchecked"]  # input of fetch_metadata.py gap-check
            members = {market.instruments[key].symbol for day in market.universe for key in market.universe[day].members}
    except StudyError as error:
        report["evidenceCasesD11"] = f"nicht bestimmbar: {error}"
    report["dailyFilesD12"] = [f"{symbol}\t{day_text(day)}" for symbol, item in series.items()
                               if members is None or symbol in members for day in jump_days(item, cfg)]
    if len(report["dailyFilesD12"]) > 100:
        report["dailyFilesD12Note"] = "mehr als 100 Dateien: Rückfrage beim Betreiber (§4.1)"
    return report


# --- Evaluation (§10, §15 step 1.5) ------------------------------------------------------


def verify_preregistration(root: Path = REPO_ROOT) -> dict:
    """The preregistration file minus its freeze status block must hash to the frozen blob."""
    path = root / PREREGISTRATION["path"]
    if not path.exists():
        raise StudyError(f"Preregistration {path} not found.")
    content = path.read_bytes()
    marker = PREREGISTRATION["statusMarker"].encode()
    start = content.find(marker)
    if start < 0:
        raise StudyError("The freeze status block is missing; the preregistration is not frozen.")
    end = content.index(b"\n\n", start) + 2
    status = content[start:end].decode("utf-8")
    frozen = content[:start] + content[end:]
    blob = hashlib.sha1(b"blob %d\0" % len(frozen) + frozen).hexdigest()
    ok = blob == PREREGISTRATION["frozenBlob"] and PREREGISTRATION["frozenCommit"] in status and PREREGISTRATION["frozenBlob"] in status
    if not ok:
        raise StudyError(f"Preregistration differs from the frozen text (blob {blob}).")
    return {"path": PREREGISTRATION["path"], "blob": blob, "frozenCommit": PREREGISTRATION["frozenCommit"], "verified": True}


def verify_manifest(data: Path) -> dict:
    manifest = data / "manifest.sha256"
    if not manifest.exists():
        raise StudyError(f"{manifest} is missing; the real run needs the download manifest.")
    listed = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if line.strip():
            digest, name = line.split(None, 1)
            listed[name.strip().removeprefix("./")] = digest
    for name, digest in listed.items():
        if sha256_file(data / name) != digest:
            raise StudyError(f"Manifest mismatch: {name}.")
    present = {path.relative_to(data).as_posix() for path in data.rglob("*") if path.is_file() and path.name != "manifest.sha256"}
    unlisted = sorted(present - set(listed))
    if unlisted:
        raise StudyError(f"Files not in the manifest: {unlisted[:5]}.")
    return {"files": len(listed), "sha256": sha256_file(manifest)}


def config_hash(cfg: Config) -> str:
    return hashlib.sha256(json.dumps(asdict(cfg), sort_keys=True).encode()).hexdigest()


def guard_run(args, data: Path, out: Path, cfg: Config) -> dict:
    """§10.4: one run, at most one corrected run; the real run only on the canonical, verified data."""
    synthetic = (data / "SYNTHETIC").exists()
    guard: dict = {"synthetic": synthetic, "configHash": config_hash(cfg)}
    if args.real:
        if args.confirm != STUDY_KEY:
            raise StudyError(f"A real run needs --confirm {STUDY_KEY}.")
        if synthetic:
            raise StudyError("The data directory is marked SYNTHETIC; a real run is not possible on it.")
        if cfg != FROZEN or args.random_portfolios not in (None, FROZEN.random_portfolios):
            raise StudyError("A real run uses the frozen configuration only.")
        if data.resolve() != CANONICAL_DATA.resolve() or out.resolve() != CANONICAL_OUT.resolve():
            raise StudyError(f"A real run reads {CANONICAL_DATA} and writes {CANONICAL_OUT} only.")
        guard["preregistration"] = verify_preregistration()
        guard["manifest"] = verify_manifest(data)
    elif not synthetic:
        raise StudyError("Without --real only data marked SYNTHETIC may be evaluated.")
    out.mkdir(parents=True, exist_ok=True)
    name = "results-correction" if args.correction else "results"
    if args.correction:
        if not (out / "results.json").exists():
            raise StudyError("A corrected run needs the first run in the same directory.")
        if (out / "results-correction.json").exists() or (out / "RUN-correction.lock").exists():
            raise StudyError("The one corrected run allowed by §10.4 already exists.")
    elif (out / "results.json").exists() or (out / "RUN.lock").exists():
        raise StudyError("This study was already run once (§10.4); a corrected run needs --correction REASON.")
    lock = out / ("RUN-correction.lock" if args.correction else "RUN.lock")
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(json.dumps({"started": datetime.now(timezone.utc).isoformat(), "pid": os.getpid(), "real": bool(args.real)}))
    guard["resultName"] = name
    return guard


def evaluate(data: Path, out: Path, spot: Path | None, cfg: Config, guard: dict, venue_status: str = "OFFEN",
             accepted_halts: list[str] | None = None, correction: str | None = None) -> dict:
    accepted_halts = accepted_halts or []
    synthetic = guard["synthetic"]
    lock = out / ("RUN-correction.lock" if correction else "RUN.lock")
    try:
        data_report, market, cases = prepare(data, spot, cfg, synthetic)
    except StudyError:
        lock.unlink(missing_ok=True)  # no return was calculated yet; the run is not used up
        raise
    name = guard["resultName"]
    base_report = {"study": STUDY_KEY, "scriptVersion": SCRIPT_VERSION, "scriptSha256": sha256_file(Path(__file__)),
                   "preregistration": PREREGISTRATION, "guard": guard, "synthetic": synthetic, "correction": correction,
                   "multipleTest": {"before": cfg.multiple_test_n_before,
                                    "after": cfg.multiple_test_n_before if synthetic else cfg.multiple_test_n_after,
                                    "countsForN": not synthetic, "thresholdN": cfg.multiple_test_n_after}}
    if market is None:
        # §13: without a return calculation N stays 55, also in a real run.
        base_report["multipleTest"].update({"after": cfg.multiple_test_n_before, "countsForN": False})
        report = {**base_report, "outcome": "NICHT_AUSWERTBAR", "reason": "blockierende Datenprüfung verletzt", "dataChecks": data_report}
        _write(out, name, report)
        return report
    open_halts = [halt for halt in data_report["halts"] if halt not in accepted_halts]
    if open_halts:
        lock.unlink(missing_ok=True)
        raise HaltError(f"Halt {open_halts}: Rückfrage beim Betreiber nötig (§10.4); weiter nur mit --accept-halt.")
    benchmarks, binding = parse_benchmarks(data / "benchmarks" / "benchmarks.csv")
    months = window_months(cfg)
    for key in ("champion", "challenger"):
        missing = [m for m in months if m not in benchmarks[key]]
        if missing:
            raise StudyError(f"Benchmark {key} misses months {missing[:6]}.")
    readings = {reading: run_reading(market, reading) for reading in ("A", "B")}
    criteria = {reading: {v: criteria_for(v, readings[reading], market, benchmarks) for v in ("A", "B")} for reading in ("A", "B")}
    classes, controls_b1_by_reading = {}, {}
    for reading in ("A", "B"):
        controls_b1 = controls_b1_by_reading[reading] = any(series_metrics(equity_curve(readings[reading].base[key]), market, cfg.slot)["excessAfterHaircut"] > 0 for key in ("K_A", "K_B"))
        classes[reading] = classify(criteria[reading], controls_b1, venue_status, cfg)
    final = determinability(classes["A"], classes["B"], accepted_halts)
    sharpe_check = {}
    for reading in ("A", "B"):
        alternative = {v: {**c, "B3": c["B3WithDailySharpe"]} for v, c in criteria[reading].items()}
        other = classify(alternative, controls_b1_by_reading[reading], venue_status, cfg)
        sharpe_check[reading] = {"classWithDailySharpe": other["outcome"],
                                 "dependsOnSharpeDefinition": other["outcome"] != classes[reading]["outcome"]}
    report = {**base_report, "outcome": final["outcome"], "subclass": final.get("subclass"), "determinability": final,
              "classByReading": classes, "venueStatus": venue_status, "acceptedHalts": accepted_halts,
              "b3cSharpeDefinitionCheck": sharpe_check,
              "criteria": {reading: {v: {key: value for key, value in c.items() if key != "metrics"} for v, c in by.items()}
                           for reading, by in criteria.items()},
              "dataChecks": data_report,
              "report": report_metrics(market, readings, criteria, benchmarks, binding, cases, cfg)}
    report["interpretations"] = INTERPRETATIONS
    _write(out, name, report)
    return report


INTERPRETATIONS = [
    "B3(c): 'Sharpe' ist die Monats-Sharpe aus denselben Kalendermonats-Renditen wie die α-Tests (M2: × √12, ohne Zins); "
    "vom Betreiber am 2026-10-17 als primäre Berechnung bestätigt. Die Tages-Sharpe steht nur als Sensitivität daneben "
    "(cWithDailySharpe, b3cSharpeDefinitionCheck) und ersetzt die Entscheidung nie.",
    "AUSSTEHEND_PHASE_1B: positives Ergebnis vor Phase 1B (venue OFFEN), wie beim Carry; endgültig nach 1.6.",
    "D3 zählt nur Lücken von 1-6 Tagen als fehlend; lange Lücken (E3/E7) sind keine Handelszeit und stehen in D4.",
    "Mindestorder 10 USDT gilt für Käufe und reguläre Verkäufe; erzwungene Ausstiege (E2-E7) und die Glattstellung am Ende entfallen nie.",
    "S2-Zins: Tagessatz DTB3/365 auf die Kasse an Nicht-RISK_ON-Tagen außer dem Ausstiegstag; DTB3 wird bis zu 30 Tage fortgeschrieben.",
    "Lesart B rechnet bei ungeklärten Sprüngen nach oben den gemessenen Faktor (Schluss zu Vorschluss) heraus; die Eröffnung des Sprungtags bleibt in alten Einheiten, wenn der Sprung im Tagesverlauf lag.",
    "Ein Nachweis gehört zu einem Ereignis, wenn sein Tag höchstens 3 Tage (Umstellung: 1 Tag) abweicht; frühester Ausstieg ist die Eröffnung des Tags nach der Veröffentlichung.",
]


def report_metrics(market: Market, readings: dict[str, Runs], criteria: dict, benchmarks: dict, binding: dict,
                   cases: list[EventCase], cfg: Config) -> dict:
    base = readings["A"].base
    months = window_months(cfg)
    per_series = {}
    for key, result in base.items():
        last_day_buys = [t for t in result.trades if t["side"] == "BUY" and t["day"] == market.instruments[t["instrument"]].end
                         and market.instruments[t["instrument"]].end_rule.kind != "OPEN"]
        per_series[key] = {"trades": trade_metrics(result, market), "quota": quota_metrics(result, market),
                           "buysOnLastTradingDay": {"count": len(last_day_buys), "notional": sum(t["notional"] for t in last_day_buys),
                                                    "symbols": sorted({t["symbol"] for t in last_day_buys})},
                           "concentration": concentration(result), "events": result.events[:200],
                           "investedCapitalReturn": invested_capital_return(result, market),
                           "pausedOutsideRiskOn": result.paused_outside_risk_on}
    buyhold = simulate(market, SimSpec("BUYHOLD"))
    s2 = {key: simulate(market, SimSpec(kind, schedule, "A", s2=True))
          for key, (kind, schedule) in {"A": VARIANTS["A"], "B": VARIANTS["B"], "K_A": ("CONTROL", "WEEKLY"),
                                         "K_B": ("CONTROL", "FOURWEEKLY"), "R": ("PAIR", None)}.items()}
    s2_metrics = {key: series_metrics(equity_curve(result), market, cfg.slot) for key, result in s2.items()}
    s2_metrics["BUYHOLD"] = series_metrics(equity_curve(buyhold), market, cfg.slot)
    rf_month = monthly_rf(market, months)
    bench_s1 = {key: monthly_series_metrics(benchmarks[key], market) for key in ("champion", "challenger")}
    bench_s2 = {key: monthly_series_metrics(benchmarks[key], market, {m: (1 - cfg.benchmark_reserve_s2) * rf_month[m] for m in months})
                for key in ("champion", "challenger")}
    favorable = {control: simulate(market, SimSpec("CONTROL", schedule, "A", favorable_events=True))
                 for control, schedule in (("K_A", "WEEKLY"), ("K_B", "FOURWEEKLY"))}
    haircut = {key: simulate(market, replace(result.spec, e3_haircut=True)) for key, result in base.items()}
    btc = market.instrument_on("BTCUSDT", cfg.window_start)
    btc_monthly = {}
    if btc is not None:
        previous = btc.last_close(cfg.window_start - 1) or btc.open(cfg.window_start)
        for month in months:
            close = btc.last_close(min(month_days(month)[-1], cfg.window_end - 1))
            btc_monthly[month] = close / previous - 1 if previous else 0.0
            previous = close
    random_report = {}
    for variant, (_, schedule) in VARIANTS.items():
        nets, drawdowns = [], []
        for index in range(cfg.random_portfolios):
            result = simulate(market, SimSpec("RANDOM", schedule, "A", seed=cfg.random_seed + index))
            metrics = series_metrics(equity_curve(result), market, cfg.slot)
            nets.append(metrics["netPerYear"])
            drawdowns.append(metrics["maxDrawdown"])
        variant_net = criteria["A"][variant]["metrics"]["variant"]["netPerYear"]
        ordered = sorted(nets)

        def pick(q: float) -> float | None:
            return ordered[min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))] if ordered else None

        random_report[variant] = {"portfolios": len(nets), "shareBetterThanVariant": sum(1 for n in nets if n > variant_net) / len(nets) if nets else None,
                                  "medianNet": pick(0.5), "p5Net": pick(0.05), "p95Net": pick(0.95),
                                  "medianMaxDrawdown": statistics.median(drawdowns) if drawdowns else None}
    fairness = {}
    for variant in ("A", "B"):
        c = criteria["A"][variant]
        v_monthly = c["metrics"]["variant"]["monthlyReturns"]
        beta_btc = spanning_alpha(v_monthly, [btc_monthly], months)["betas"] if btc_monthly else None
        control = CONTROLS[variant]
        fairness[variant] = {
            "betaToControl": c["details"]["B3"]["selectionAlpha"]["betas"], "betaToBtc": beta_btc,
            "positions": [per_series[variant]["quota"]["meanPositionsRiskOn"], per_series[control]["quota"]["meanPositionsRiskOn"]],
            "herfindahl": [per_series[variant]["quota"]["meanHerfindahlRiskOn"], per_series[control]["quota"]["meanHerfindahlRiskOn"]],
            "quotaRiskOn": [per_series[variant]["quota"]["meanQuotaRiskOn"], per_series[control]["quota"]["meanQuotaRiskOn"]],
            "quotaDifference": per_series[variant]["quota"]["meanQuotaRiskOn"] - per_series[control]["quota"]["meanQuotaRiskOn"],
            "costPerSideBp": [per_series[variant]["trades"]["meanCostPerSideBp"], per_series[control]["trades"]["meanCostPerSideBp"]],
            "costShareOfGross": [per_series[variant]["trades"]["costShareOfGross"], per_series[control]["trades"]["costShareOfGross"]],
            "events": [len(base[variant].events), len(base[control].events)],
            "randomPortfolios": random_report[variant],
            "investedCapitalSelection": per_series[variant]["investedCapitalReturn"] - per_series[control]["investedCapitalReturn"],
            "m28AsymmetricStress": {"variantNet": c["metrics"]["variant"]["netPerYear"],
                                    "controlFavorableNet": series_metrics(equity_curve(favorable[control]), market, cfg.slot)["netPerYear"]},
        }
        metrics_v = c["metrics"]["variant"]
        fairness[variant]["m27Warning"] = criteria["A"][variant]["B3"] and fairness[variant]["investedCapitalSelection"] <= 0
        fairness[variant]["m9Decomposition"] = {"controlMinusReference": c["metrics"]["control"]["netPerYear"] - c["metrics"]["reference"]["netPerYear"],
                                               "variantMinusControl": metrics_v["netPerYear"] - c["metrics"]["control"]["netPerYear"]}
    equal_risk = {}
    for key, metrics in s2_metrics.items():
        dd = series_metrics(equity_curve(base[key] if key in base else buyhold), market, cfg.slot)["maxDrawdown"]
        quota = cfg.gates_v4_drawdown / dd if dd > 0 else None
        excess = metrics["netPerYear"] - metrics["riskFreeMean"]
        equal_risk[key] = {"excessAt10PctVol": cfg.equal_risk_volatility * metrics["sharpeExcessMonthly"] if metrics["sharpeExcessMonthly"] else None,
                           "quotaFor10PctDrawdown": quota, "s2ExcessAtQuota": quota * excess if quota is not None else None}
    for key in ("champion", "challenger"):
        equal_risk[key] = {"excessAt10PctVol": cfg.equal_risk_volatility * bench_s2[key]["sharpeExcessMonthly"] if bench_s2[key]["sharpeExcessMonthly"] else None}
    selection_extremes = {}
    for variant in ("A", "B"):
        control = CONTROLS[variant]
        weeks: dict[int, list] = {}
        for (day, equity_v, *_), (_, equity_k, *_) in zip(base[variant].daily, base[control].daily):
            weeks[day - weekday(day)] = [equity_v, equity_k]
        previous, differences = [cfg.slot, cfg.slot], []
        for week in sorted(weeks):
            differences.append((weeks[week][0] / previous[0] - 1) - (weeks[week][1] / previous[1] - 1))
            previous = weeks[week]
        monthly_selection = [criteria["A"][variant]["metrics"]["variant"]["monthlyReturns"][m] - criteria["A"][variant]["metrics"]["control"]["monthlyReturns"][m]
                             for m in months]
        selection_extremes[variant] = {"worstMonth": min(monthly_selection), "worstWeek": min(differences) if differences else None,
                                       "spearmanChallenger": spearman(monthly_selection, [benchmarks["challenger"][m] for m in months]),
                                       "pearsonChampion": pearson(monthly_selection, [benchmarks["champion"][m] for m in months])}
    unresolved = {}
    for key, result in base.items():
        held = {trade["instrument"] for trade in result.trades}
        freezes = sum(1 for event in result.events if str(event.get("kind", "")).startswith("E7"))
        jumps = sum(1 for instrument_id in held if market.instruments[instrument_id].jumps)
        unresolved[key] = {"e7Freezes": freezes, "heldInstrumentsWithUnresolvedJumps": jumps,
                           "shareOfHeldInstruments": (freezes + jumps) / len(held) if held else 0.0}
    return {
        "series": per_series,
        "selectionMonthly": {v: {m: criteria["A"][v]["metrics"]["variant"]["monthlyReturns"][m] - criteria["A"][v]["metrics"]["control"]["monthlyReturns"][m]
                                 for m in months} for v in ("A", "B")},
        "correlations": {v: {"rawChallengerPearson": pearson([criteria["A"][v]["metrics"]["variant"]["monthlyReturns"][m] for m in months],
                                                            [benchmarks["challenger"][m] for m in months]),
                             "rawChallengerSpearman": spearman([criteria["A"][v]["metrics"]["variant"]["monthlyReturns"][m] for m in months],
                                                              [benchmarks["challenger"][m] for m in months]),
                             "rawChampionPearson": pearson([criteria["A"][v]["metrics"]["variant"]["monthlyReturns"][m] for m in months],
                                                          [benchmarks["champion"][m] for m in months])} for v in ("A", "B")},
        "signalIc": {"A": ic_metrics(market, "WEEKLY"), "B": ic_metrics(market, "FOURWEEKLY")},
        "fairness": fairness,
        "selectionExtremes": selection_extremes,
        "scenarioS2": {key: {k: value for k, value in metrics.items() if k not in ("monthlyReturns", "calendarYears")} for key, metrics in s2_metrics.items()},
        "benchmarksS1": {key: {k: value for k, value in metrics.items() if k != "monthlyReturns"} for key, metrics in bench_s1.items()},
        "benchmarksS2": {key: {k: value for k, value in metrics.items() if k != "monthlyReturns"} for key, metrics in bench_s2.items()},
        "benchmarkBinding": {key: statistics.fmean(binding[key][m] for m in months) for key in ("champion", "challenger")},
        "buyAndHold": {k: value for k, value in series_metrics(equity_curve(buyhold), market, cfg.slot).items() if k != "monthlyReturns"},
        "equalRisk": equal_risk,
        "m29E3Haircut": {key: series_metrics(equity_curve(result), market, cfg.slot)["netPerYear"] for key, result in haircut.items()},
        "readingB": {v: {"criteria": {key: criteria["B"][v][key] for key in ("B1", "B2", "B3", "B4", "B5", "B6")},
                         "netPerYear": criteria["B"][v]["metrics"]["variant"]["netPerYear"]} for v in ("A", "B")},
        "unresolvedCases": unresolved,
        "eventCases": [{"kind": c.kind, "symbol": c.symbol, "day": day_text(c.day), "documented": c.documented, **c.detail} for c in cases][:500],
    }


def _write(out: Path, name: str, report: dict) -> None:
    (out / f"{name}.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    (out / f"{name}.md").write_text(render_markdown(report), encoding="utf-8")


def _pct(value) -> str:
    return "–" if value is None else f"{value * 100:.2f} %"


def render_markdown(report: dict) -> str:
    lines = [f"# {STUDY_KEY}: {report['outcome']}", "",
             f"- Skript {report['scriptVersion']}, SHA-256 `{report['scriptSha256']}`",
             f"- synthetisch: {report['synthetic']}; zählt für N: {report['multipleTest']['countsForN']} "
             f"(N {report['multipleTest']['before']} → {report['multipleTest']['after']})"]
    if report["outcome"] == "NICHT_AUSWERTBAR":
        lines.append(f"- Grund: {report.get('reason')}")
        return "\n".join(lines) + "\n"
    lines.append(f"- Bestimmbarkeit: {report['determinability']['reason']}")
    for reading in ("A", "B"):
        cls = report["classByReading"][reading]
        lines += ["", f"## Lesart {reading}: {cls['outcome']}" + (f" ({cls['subclass']})" if cls.get("subclass") else ""), "",
                  "| Variante | B1 | B2 | B3 | B4 | B5 | B6 |", "|---|---|---|---|---|---|---|"]
        for variant in ("A", "B"):
            c = report["criteria"][reading][variant]
            lines.append(f"| {variant} | " + " | ".join("✔" if c[key] else "✘" for key in ("B1", "B2", "B3", "B4", "B5", "B6")) + " |")
    return "\n".join(lines) + "\n"


# --- Synthetic data (tests and dry runs only) --------------------------------------------


def _write_zip(path: Path, name: str, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, text)
    path.write_bytes(buffer.getvalue())
    path.with_name(path.name + ".CHECKSUM").write_text(f"{sha256_file(path)}  {path.name}\n", encoding="utf-8")


def kline_line(day: int, candle: Candle, micro: bool = False) -> str:
    o, h, l, c, qv, n = candle
    ms = day * DAY_MS * (1000 if micro else 1)
    volume = qv / c
    return f"{ms},{o:.8f},{h:.8f},{l:.8f},{c:.8f},{volume:.4f},{ms + DAY_MS - 1},{qv:.2f},{n},{volume / 2:.4f},{qv / 2:.2f},0"


def synthetic_paths(seed: int, cfg: Config) -> dict[str, dict[int, Candle]]:
    """Price paths with planted cases for every rule (E2-E7, X1-X5, tiers); not market data."""
    rng = random.Random(seed)
    first, last = day_of("2018-05-01"), cfg.window_end - 1

    def path(start: int, end: int, price: float, drift: float, vol: float, volume: float, market: list[float] | None = None) -> dict:
        candles = {}
        for day in range(start, end + 1):
            shock = (market[day - first] if market else 0.0) + rng.gauss(0, vol)
            open_ = price
            price = max(price * math.exp(drift + shock), 1e-7)
            high, low = max(open_, price) * (1 + abs(rng.gauss(0, vol / 3))), min(open_, price) * (1 - abs(rng.gauss(0, vol / 3)))
            candles[day] = (open_, high, low, price, volume * math.exp(rng.gauss(0, 0.3)), int(1000 + rng.random() * 9000))
        return candles

    regime = []
    level = 0.0
    for day in range(first, last + 1):
        cycle = math.sin((day - first) / 180 * math.pi)
        regime.append(0.004 * cycle + rng.gauss(0, 0.02))
        level += regime[-1]
    paths: dict[str, dict[int, Candle]] = {
        "BTCUSDT": path(first, last, 9000.0, 0.0002, 0.005, 3e9, regime),
        "ETHUSDT": path(first, last, 300.0, 0.0002, 0.008, 1.2e9, regime),
    }
    start = cfg.prelude_start
    for index in range(28):
        name = f"ALT{index:02d}USDT"
        volume = [3e8, 6e7, 2.5e7, 8e6, 2e6][index % 5]
        paths[name] = path(start, last, 1 + index, rng.gauss(0, 0.001), 0.01 + 0.002 * (index % 4), volume, regime)
    stable = {}
    for day in range(start, last + 1):
        close = 1.0 + rng.gauss(0, 0.0005)
        stable[day] = (1.0, max(1.001, close), min(0.999, close), close, 5e8, 5000)
    paths["USDCUSDT"] = stable
    paths["PAXGUSDT"] = path(start, last, 1800.0, 0.0001, 0.006, 3e7)
    paths["ALT00UPUSDT"] = path(start, last, 5.0, 0.0, 0.03, 4e7, regime)
    paths["BULLUSDT"] = path(start, last, 5.0, 0.0, 0.03, 4e7, regime)
    # D0 control list and events (§4.3)
    paths["ERDUSDT"] = path(start, day_of("2020-09-10"), 0.01, 0.0, 0.02, 2e7, regime)
    paths["EGLDUSDT"] = path(day_of("2020-09-14"), last, 10.0, 0.0, 0.02, 2e7, regime)
    luna = path(start, day_of("2022-05-12"), 50.0, 0.0, 0.02, 3e8, regime)
    luna.update({day: (o * 1e-5, h * 1e-5, l * 1e-5, c * 1e-5, q, n) for day, (o, h, l, c, q, n) in path(day_of("2022-05-09"), day_of("2022-05-12"), 1.0, -0.5, 0.05, 3e8).items()})
    luna.update(path(day_of("2022-06-01"), last, 5.0, 0.0, 0.03, 1e8, regime))  # symbol reused by a new coin after a long gap
    paths["LUNAUSDT"] = luna
    ftt = path(start, last, 20.0, 0.0, 0.02, 5e7, regime)
    paths["FTTUSDT"] = ftt
    paths["XMRUSDT"] = path(start, day_of("2024-02-20"), 150.0, 0.0, 0.015, 6e7, regime)
    paths["MATICUSDT"] = path(start, day_of("2024-09-10"), 1.0, 0.0, 0.02, 1.5e8, regime)
    paths["POLUSDT"] = path(day_of("2024-09-11"), last, 0.4, 0.0, 0.02, 1.2e8, regime)
    halt = path(start, last, 2.0, 0.0, 0.02, 4e7, regime)
    for day in range(day_of("2021-03-10"), day_of("2021-03-13")):
        halt.pop(day)
    paths["HALTUSDT"] = halt
    long_gap = path(start, last, 3.0, 0.0, 0.02, 4e7, regime)
    for day in range(day_of("2021-07-01"), day_of("2021-07-21")):
        long_gap.pop(day)
    paths["LONGUSDT"] = long_gap
    pump = path(start, last, 0.5, 0.0, 0.02, 3e7, regime)
    jump_day = day_of("2021-02-15")
    for day in sorted(d for d in pump if d >= jump_day):
        o, h, l, c, q, n = pump[day]
        if day == jump_day:  # opens at the old level, closes twelve times higher: an unresolved E4
            pump[day] = (o, c * 12, min(l, o), c * 12, q, n)
        else:
            pump[day] = (o * 12, h * 12, l * 12, c * 12, q, n)
    paths["PUMPUSDT"] = pump
    split = path(start, last, 500.0, 0.0, 0.02, 3e7, regime)
    split_day = day_of("2022-08-01")
    for day in [d for d in split if d >= split_day]:
        o, h, l, c, q, n = split[day]
        split[day] = (o / 1000, h / 1000, l / 1000, c / 1000, q, n)
    paths["SPLITUSDT"] = split
    paths["ERRUSDT"] = path(start, last, 4.0, 0.0, 0.02, 3e7, regime)
    o, h, l, c, q, n = paths["ERRUSDT"][day_of("2023-03-01")]
    paths["ERRUSDT"][day_of("2023-03-01")] = (o, c * 15, l, c * 15, q, n)  # wrong in the monthly file only (D12)
    for year in D0B_YEARS:
        for letter in "ABC":
            paths[f"DL{year % 100}{letter}USDT"] = path(start, day_of(f"{year}-0{3 + 'ABC'.index(letter)}-15"), 1.0, 0.0, 0.02, 1e7, regime)
    return paths


def generate_synthetic(out: Path, seed: int = 7, cfg: Config = FROZEN) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "SYNTHETIC").write_text("synthetic test data, not market data\n", encoding="utf-8")
    paths = synthetic_paths(seed, cfg)
    listing: dict[str, list[str]] = {}
    for symbol, candles in paths.items():
        by_month: dict[str, list] = defaultdict(list)
        for day in sorted(candles):
            if cfg.prelude_start <= day < cfg.window_end:
                by_month[month_text(day)].append(day)
        listing[symbol] = sorted(by_month)
        for month, days in by_month.items():
            micro = month >= "2025-01"
            lines = [KLINE_HEADER] if month >= "2022-01" else []
            missing = {day_of(f"{month}-11")} if symbol == "ALT01USDT" and month in ("2021-04", "2023-06") else set()
            lines += [kline_line(day, candles[day], micro) for day in days if day not in missing]
            _write_zip(monthly_path(out, symbol, month), f"{symbol}-1d-{month}.csv", "\n".join(lines) + "\n")
            for day in missing:
                _write_zip(daily_path(out, symbol, day), f"{symbol}-1d-{day_text(day)}.csv", kline_line(day, candles[day]) + "\n")
    error_day = day_of("2023-03-01")
    o, h, l, c, q, n = paths["ERRUSDT"][error_day]
    _write_zip(daily_path(out, "ERRUSDT", error_day), f"ERRUSDT-1d-{day_text(error_day)}.csv", kline_line(error_day, (o, o * 1.02, l, o * 1.01, q, n)) + "\n")
    for symbol, day in (("PUMPUSDT", day_of("2021-02-15")), ("SPLITUSDT", day_of("2022-08-01"))):
        _write_zip(daily_path(out, symbol, day), f"{symbol}-1d-{day_text(day)}.csv", kline_line(day, paths[symbol][day]) + "\n")
    (out / "listing").mkdir(exist_ok=True)
    (out / "listing" / "spot-monthly-klines-1d.json").write_text(json.dumps({"symbols": listing}, indent=1), encoding="utf-8")
    announcements = {"years": {str(year): [{"url": f"https://example.invalid/{year}/{letter}", "published": f"{year}-0{2 + 'ABC'.index(letter)}-20",
                                            "tradingEnd": f"{year}-0{3 + 'ABC'.index(letter)}-15", "pairs": [f"DL{year % 100}{letter}USDT"]}
                                           for letter in "ABC"] for year in D0B_YEARS}, "neverListed": []}
    (out / "listing" / "announcements-d0b.json").write_text(json.dumps(announcements, indent=1), encoding="utf-8")
    exchange = {"symbols": [{"symbol": symbol, "quoteAsset": QUOTE, "status": "BREAK" if symbol.startswith("DL") else "TRADING"} for symbol in listing]}
    (out / "listing" / "exchangeInfo.json").write_text(json.dumps(exchange), encoding="utf-8")
    evidence = {"cases": [
        {"symbol": "ERDUSDT", "kind": "MIGRATION", "day": "2020-09-10", "published": "2020-09-10", "url": "https://example.invalid/erd",
         "successor": "EGLDUSDT", "ratio": 0.001},
        {"symbol": "XMRUSDT", "kind": "DELISTING", "day": "2024-02-20", "published": "2024-02-06T03:00:00Z", "url": "https://example.invalid/xmr"},
        {"symbol": "MATICUSDT", "kind": "MIGRATION", "day": "2024-09-10", "published": "2024-08-27", "url": "https://example.invalid/matic",
         "successor": "POLUSDT", "ratio": 1.0},
        {"symbol": "SPLITUSDT", "kind": "REDENOMINATION", "day": "2022-08-01", "published": "2022-07-20", "url": "https://example.invalid/split", "ratio": 1000},
    ] + [{"symbol": f"DL{year % 100}{letter}USDT", "kind": "DELISTING", "day": f"{year}-0{3 + 'ABC'.index(letter)}-15",
          "published": f"{year}-0{2 + 'ABC'.index(letter)}-20", "url": f"https://example.invalid/{year}/{letter}"} for year in D0B_YEARS for letter in "ABC"]}
    (out / "events").mkdir(exist_ok=True)
    (out / "events" / "evidence.json").write_text(json.dumps(evidence, indent=1), encoding="utf-8")
    gap_check = {"gaps": [{"symbol": "LONGUSDT", "from": "2021-07-01", "to": "2021-07-20", "verdict": "consistent", "hourlyDaysInGap": []}]}
    (out / "events" / "long-gap-check.json").write_text(json.dumps(gap_check, indent=1), encoding="utf-8")
    (out / "fred").mkdir(exist_ok=True)
    rows = ["observation_date,DTB3"]
    for day in range(day_of("2019-06-01"), cfg.window_end):
        if weekday(day) < 5:
            rows.append(f"{day_text(day)},{(1.5 if day < day_of('2022-06-01') else 4.5):.2f}")
    (out / "fred" / "DTB3.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    (out / "benchmarks").mkdir(exist_ok=True)
    rows = ["month,champion,challenger,champion_binding,challenger_binding"]
    for month in window_months(cfg):
        rows.append(f"{month},{rng_month(seed, month, 0):.6f},{rng_month(seed, month, 1):.6f},0.009,0.021")
    (out / "benchmarks" / "benchmarks.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    spot = out / "spot"
    spot.mkdir(exist_ok=True)
    for symbol in ("BTCUSDT", "ETHUSDT"):
        with gzip.open(spot / f"{symbol}-1d.csv.gz", "wt", encoding="utf-8") as handle:
            handle.write(SPOT_HEADER + "\n")
            for day, (o, h, l, c, *_rest) in sorted(paths[symbol].items()):
                handle.write(f"{day * DAY_MS},{day * DAY_MS + DAY_MS - 1},{o:.8f},{h:.8f},{l:.8f},{c:.8f},1\n")
    snapshot = {symbol: parse_spot_snapshot(spot / f"{symbol}-1d.csv.gz", cfg) for symbol in ("BTCUSDT", "ETHUSDT")}
    labels = regime_labels(snapshot["BTCUSDT"], snapshot["ETHUSDT"], cfg.window_start, cfg.window_end - 1)
    counts = {label: sum(1 for value in labels.values() if value == label) for label in ("RISK_ON", "NEUTRAL", "MIXED", "RISK_OFF")}
    (out / "synthetic.json").write_text(json.dumps({"seed": seed, "regimeCounts": counts}, indent=1), encoding="utf-8")


def rng_month(seed: int, month: str, which: int) -> float:
    return random.Random(f"{seed}-{month}-{which}").gauss(0.002, 0.006)


# --- CLI --------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=f"{STUDY_KEY} ({SCRIPT_VERSION})")
    commands = parser.add_subparsers(dest="command", required=True)
    synth = commands.add_parser("synth", help="synthetic data in the archive layout")
    synth.add_argument("--out", type=Path, required=True)
    synth.add_argument("--seed", type=int, default=7)
    verify = commands.add_parser("verify", help="frozen preregistration, configuration and (with --data) manifest")
    verify.add_argument("--data", type=Path)
    listing = commands.add_parser("check-listing", help="D0, D0b, D0c on the step-1.2 metadata")
    listing.add_argument("--data", type=Path, required=True)
    listing.add_argument("--out", type=Path)
    planning = commands.add_parser("plan", help="daily files (E1, D12) and evidence cases (D11) to fetch")
    planning.add_argument("--data", type=Path, required=True)
    planning.add_argument("--spot", type=Path)
    check = commands.add_parser("check-data", help="data checks D0-D12, no returns")
    check.add_argument("--data", type=Path, required=True)
    check.add_argument("--spot", type=Path)
    check.add_argument("--out", type=Path)
    run = commands.add_parser("evaluate", help="the one run (§10.4)")
    run.add_argument("--data", type=Path, required=True)
    run.add_argument("--out", type=Path, required=True)
    run.add_argument("--spot", type=Path)
    run.add_argument("--venue-status", default="OFFEN", choices=VENUE_STATUSES)
    run.add_argument("--accept-halt", action="append", default=[], choices=HALT_CHECKS)
    run.add_argument("--correction")
    run.add_argument("--random-portfolios", type=int)
    run.add_argument("--real", action="store_true")
    run.add_argument("--confirm")
    args = parser.parse_args(argv)
    try:
        if args.command == "synth":
            generate_synthetic(args.out, args.seed)
            print(f"Synthetic data written to {args.out}")
            return 0
        if args.command == "verify":
            result = {"preregistration": verify_preregistration(), "configHash": config_hash(FROZEN)}
            if args.data:
                result["manifest"] = verify_manifest(args.data)
            print(json.dumps(result, indent=2))
            return 0
        if args.command == "check-listing":
            report = check_listing(args.data, FROZEN)
            if args.out:
                args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
            print(json.dumps({"halts": report["halts"], "usdtSymbols": report["usdtSymbols"]}, ensure_ascii=False))
            return 3 if report["halts"] else 0
        if args.command == "plan":
            print(json.dumps(plan(args.data, args.spot, FROZEN), indent=1, ensure_ascii=False))
            return 0
        if args.command == "check-data":
            report, _, _ = prepare(args.data, args.spot, FROZEN, (args.data / "SYNTHETIC").exists())
            if args.out:
                args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
            print(json.dumps({"blocking": report["blocking"], "halts": report["halts"]}, ensure_ascii=False))
            return 2 if not report["blockingPassed"] else 3 if report["halts"] else 0
        cfg = FROZEN if args.random_portfolios is None or args.real else replace(FROZEN, random_portfolios=args.random_portfolios)
        guard = guard_run(args, args.data, args.out, cfg)
        report = evaluate(args.data, args.out, args.spot, cfg, guard, args.venue_status, args.accept_halt, args.correction)
        print(f"Ergebnisklasse: {report['outcome']}")
        return 2 if report["outcome"] == "NICHT_AUSWERTBAR" else 0
    except HaltError as error:
        print(f"Halt: {error}", file=sys.stderr)
        return 3
    except StudyError as error:
        print(f"Abgebrochen: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
