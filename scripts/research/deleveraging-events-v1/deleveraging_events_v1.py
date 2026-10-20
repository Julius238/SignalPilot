#!/usr/bin/env python3
"""Deleveraging event study V1 (DELEVERAGING_EVENTS_V1, D8).

Implements the frozen preregistration
docs/trading/research/2026-10-20-deleveraging-events-v1-preregistration.md
(text commit f04377f, blob 0afb5abb..., status block fb8d094). Section references (§)
point to it. Every value of FROZEN is a value of the preregistration; a real run refuses
any other configuration.

Python standard library only; run with ``python3 -I``. The script contains no network
code. It reads files fetched separately (step 1.2) or written by ``synth`` and never
writes into a data directory except with ``synth``.

Commands:
  synth       --out DIR [--seed N]          synthetic data in the archive layout
  verify      [--data DIR]                  frozen preregistration, configuration, manifest
  check-data  --data DIR --period P         validity of OI points and 1m klines (G7), never returns
  evaluate    --data DIR --out DIR --period P [--variant V]
              [--real --confirm DELEVERAGING_EVENTS_V1]
              [--discovery-result FILE --confirm-test DELEVERAGING_EVENTS_V1]   (test period only)

Data layout (<data> is data/market-snapshots/deleveraging-events-v1 for the real run):
  futures/um/monthly/klines/<SYM>/1m/<SYM>-1m-YYYY-MM.zip          1m klines of the perpetual
  futures/um/daily/metrics/<SYM>/<SYM>-metrics-YYYY-MM-DD.zip      5-minute open interest
  futures/um/monthly/fundingRate/<SYM>/<SYM>-fundingRate-YYYY-MM.zip
  manifest.sha256                                                  real run
  SYNTHETIC                                                        marks synthetic data

Time logic (§3, §4, §5, §16), per symbol on the 5-minute grid c:
  P(c)      close of the 1m candle that starts at c - 1 min          known at c
  dP(c)     P(c) / P(c - 60 min) - 1                                 known at c
  OI(t)     sum_open_interest (base units) stamped t                 known at t + 10 min (G6)
  dOI(c)    OI(c) / OI(c - 60 min) - 1                               known at c + 10 min
  z(c)      value / sample std of the values at c - 30 d ... c - 5 min
  candidate c0: first c outside a lock with |z_P(c)| >= 3 (price only)
  classification at c0 + 10 min with z_OI(c0): D <= -3, K >= -1, else unassigned;
           missing OI or < 80 % valid normalisation values: unclassifiable (never K)
  event end c*: close of the first full 5-minute bar starting at or after c0 + 10 min
           that does not extend the extreme since c0 - 60 min; none by c0 + 70 min: no trade
  entry at the open of the 1m candle from c* + 1 min, time exit after 60 min, stop at the
           size of the shock |dP(c0)|; lock from c0 to the end of the trade (or the no-trade
           finding) plus 60 min, for every class.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import random
import statistics
import sys
import zipfile
from array import array
from bisect import bisect_right
from collections import deque
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

STUDY_KEY = "DELEVERAGING_EVENTS_V1"
REPO_ROOT = Path(__file__).resolve().parents[3]
PREREGISTRATION = {
    "path": "docs/trading/research/2026-10-20-deleveraging-events-v1-preregistration.md",
    "frozenCommit": "f04377f",
    "frozenBlob": "0afb5abb37e62a484158f51b9db5b1fe5ceb5984",
    "statusMarker": "> **Status 2026-10-20: freigegeben und eingefroren (V1).**",
}

MIN = 60_000
FIVE = 5 * MIN
DAY = 1440 * MIN
NAN = float("nan")


class StudyError(Exception):
    """A rule of the preregistration or of the data contract is violated."""


def ms_of(text: str) -> int:
    """UTC timestamp 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' in milliseconds."""
    fmt = "%Y-%m-%d %H:%M:%S" if " " in text else "%Y-%m-%d"
    return int(datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).timestamp() * 1000)


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")


# ─────────────────────────────────────────────────────────────────────────────
# Frozen configuration (§4, §5, §6, §8, §9, §13 G1-G7)
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Config:
    symbols: tuple = ("BTCUSDT", "ETHUSDT")
    window_min: int = 60                 # G1: price and OI window
    norm_days: int = 30                  # G2: normalisation window
    z_price: float = 3.0                 # G2: |z_P| >= 3
    z_oi_d: float = -3.0                 # G2: D if z_OI <= -3
    z_oi_k: float = -1.0                 # G2: K if z_OI >= -1
    oi_lag_min: int = 10                 # G6: OI stamped t usable from t + 10 min
    exhaustion_search_min: int = 60      # §5: event end by c0 + lag + 60 min
    entry_delay_min: int = 1             # §5: one minute execution delay
    hold_min: int = 60                   # G1: maximum holding time
    lock_extra_min: int = 60             # §5: lock until end of trade + 60 min
    cluster_gap_min: int = 60            # §5: clusters across symbols
    notional_usd: float = 25_000.0       # §5
    fee_bp: float = 6.0                  # G3: per side
    slip_bp: tuple = (("BTCUSDT", 5.0), ("ETHUSDT", 8.0))   # G3: spread and slippage per side
    stop_extra_bp: float = 5.0           # G3: extra on a stop exit
    min_valid_share: float = 0.80        # G7: OI normalisation needs 80 % valid values
    abort_invalid_share: float = 0.05    # G7: data abort above 5 % invalid or missing OI points
    min_clusters: int = 40               # G4
    t_hint: float = 2.0                  # §9
    n_counter: int = 57                  # G5: N before this study is evaluated
    strata: tuple = (3.0, 4.0, 6.0)      # §9: |z_P| strata 3-4, 4-6, > 6
    periods: tuple = (                   # §8, UTC, end exclusive
        ("discovery", "BTCUSDT", "2020-10-01", "2024-01-01"),
        ("discovery", "ETHUSDT", "2022-01-01", "2024-01-01"),
        ("test", "BTCUSDT", "2024-01-01", "2026-10-01"),
        ("test", "ETHUSDT", "2024-01-01", "2026-10-01"),
    )

    def slip(self, symbol: str) -> float:
        return dict(self.slip_bp)[symbol]

    def period(self, name: str, symbol: str) -> tuple[int, int]:
        for period, sym, start, end in self.periods:
            if period == name and sym == symbol:
                return ms_of(start), ms_of(end)
        raise StudyError(f"No period {name} for {symbol}.")

    @property
    def norm_points(self) -> int:
        return self.norm_days * 288

    def t_robust(self) -> float:
        """§9 BELASTBAR: t >= sqrt(2 ln N_new); D8 itself counts once it is evaluated."""
        return math.sqrt(2 * math.log(self.n_counter + 1))


FROZEN = Config()

# Descriptive variants (§9 "Weitere Berichte"); they never decide a class.
VARIANTS = {
    "primary": {},
    "oi-lag-20": {"oi_lag_min": 20},
    "delay-5": {"entry_delay_min": 5},
}
SPOT_FEE_BP = 10.0  # descriptive spot view (§6): long trades after down events only


def config_hash(cfg: Config) -> str:
    return hashlib.sha256(json.dumps(asdict(cfg), sort_keys=True).encode()).hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# Data: 1m klines, OI points (G7), funding
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Klines:
    """1m candles on a minute index starting at base (ms); missing minutes are NaN."""

    base: int
    open: array
    high: array
    low: array
    close: array
    limit: int | None = None          # minutes at or after `limit` are treated as missing (period lock)

    @property
    def end(self) -> int:
        return self.base + len(self.open) * MIN

    def index(self, ms: int) -> int:
        return (ms - self.base) // MIN

    def has(self, ms: int) -> bool:
        return self.bar(ms) is not None

    def bar(self, ms: int) -> tuple[float, float, float, float] | None:
        if self.limit is not None and ms >= self.limit:
            return None
        i = self.index(ms)
        if 0 <= i < len(self.open) and not math.isnan(self.open[i]):
            return self.open[i], self.high[i], self.low[i], self.close[i]
        return None


def klines_from_rows(rows: list[tuple[int, float, float, float, float]]) -> Klines:
    if not rows:
        raise StudyError("No 1m klines.")
    rows = sorted(rows)
    base = rows[0][0] - rows[0][0] % MIN
    size = (rows[-1][0] - base) // MIN + 1
    columns = [array("d", [NAN]) * size for _ in range(4)]
    seen: dict[int, tuple] = {}
    for ms, o, h, low, c in rows:
        if ms % MIN:
            raise StudyError(f"1m kline off the minute grid: {ms}.")
        if ms in seen and seen[ms] != (o, h, low, c):
            raise StudyError(f"Conflicting 1m klines at {iso(ms)}.")
        seen[ms] = (o, h, low, c)
        i = (ms - base) // MIN
        for column, value in zip(columns, (o, h, low, c)):
            column[i] = value
    return Klines(base, *columns)


@dataclass
class OiPoints:
    """Valid OI points (G7) by stamp, plus the counters of §3.1."""

    values: dict[int, float]
    report: dict


def validate_oi(rows: list[tuple[str, str]]) -> OiPoints:
    """G7 (§3.1): grid, numeric > 0, identical duplicates count once, conflicting ones void the stamp."""
    report = {"rows": len(rows), "offGrid": 0, "notNumeric": 0, "notPositive": 0,
              "duplicateIdentical": 0, "duplicateConflicting": 0}
    seen: dict[int, float] = {}
    void: set[int] = set()
    for stamp, value in rows:
        try:
            ms = ms_of(stamp.strip())
        except ValueError:
            report["offGrid"] += 1
            continue
        if ms % FIVE:
            report["offGrid"] += 1
            continue
        try:
            number = float(value)
        except ValueError:
            report["notNumeric"] += 1
            continue
        if not math.isfinite(number):
            report["notNumeric"] += 1
            continue
        if number <= 0:
            report["notPositive"] += 1
            continue
        if ms in seen:
            if seen[ms] == number:
                report["duplicateIdentical"] += 1
            else:
                report["duplicateConflicting"] += 1
                void.add(ms)
            continue
        seen[ms] = number
    for ms in void:
        del seen[ms]
    report["valid"] = len(seen)
    return OiPoints(seen, report)


def oi_missing_share(points: OiPoints, start: int, end: int) -> float:
    expected = (end - start) // FIVE
    present = sum(1 for ms in points.values if start <= ms < end)
    return 1 - present / expected if expected else 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Event engine (§4, §5, §16)
# ─────────────────────────────────────────────────────────────────────────────


def rolling_z(stamps: list[int], values: dict[int, float], points: int) -> dict[int, tuple[float, int]]:
    """For each stamp c: (sample std, count) of the values at the `points` grid stamps before c.

    The window is c - points*5 min ... c - 5 min, so the value at c itself never enters.
    """
    out: dict[int, tuple[float, int]] = {}
    total = squares = 0.0
    count = 0
    window: deque[int] = deque()
    for c in stamps:
        lower = c - points * FIVE
        while window and window[0] < lower:
            old = window.popleft()
            v = values[old]
            total -= v
            squares -= v * v
            count -= 1
        if count >= 2:
            mean = total / count
            var = max(squares / count - mean * mean, 0.0) * count / (count - 1)
            out[c] = (math.sqrt(var), count)
        else:
            out[c] = (NAN, count)
        if c in values:
            window.append(c)
            v = values[c]
            total += v
            squares += v * v
            count += 1
    return out


@dataclass
class Event:
    symbol: str
    c0: int
    z_p: float
    d_p: float
    direction: int                    # +1 long after a down event, -1 short after an up event
    classified_at: int
    category: str                     # D, K, UNASSIGNED, UNCLASSIFIABLE
    z_oi: float | None = None
    outcome: str = "NO_TRADE"         # TRADE, NO_TRADE
    reason: str = ""
    event_end: int | None = None
    entry_at: int | None = None
    exit_at: int | None = None
    entry_price: float | None = None
    exit_price: float | None = None
    exit_reason: str = ""
    gross: float = 0.0
    costs: float = 0.0
    funding: float = 0.0
    net: float = 0.0
    lock_until: int = 0
    stratum: int = -1
    oi_stamps: tuple = ()             # stamps used for the classification (audit of the time logic)
    incomplete_bars: int = 0          # 5-minute bars skipped as event end because a minute was missing
    entry_shift_min: int = 0          # minutes the entry moved past c* + delay because candles were missing
    exit_shift_min: int = 0           # minutes a time exit moved past entry + hold because candles were missing


def stratum_of(cfg: Config, z_abs: float) -> int:
    edges = cfg.strata
    for i in range(len(edges) - 1):
        if edges[i] <= z_abs < edges[i + 1]:
            return i
    return len(edges) - 1


def detect_events(cfg: Config, symbol: str, klines: Klines, oi: OiPoints, funding: list[tuple[int, float]],
                  start: int, end: int, *, fee_bp: float | None = None) -> list[Event]:
    """All candidates of `symbol` with c0 in [start, end) and their trades.

    Data after `end` is never read: a candidate whose maximal horizon (c0 + lag + search +
    delay + hold, plus one minute for a missing exit candle is not allowed either) exceeds
    `end` is not formed. Data before `start` serves only as normalisation lead time.
    """
    klines = replace(klines, limit=end)            # never read 1m data at or after the period end
    window = cfg.window_min * MIN
    lag = cfg.oi_lag_min * MIN
    horizon = lag + cfg.exhaustion_search_min * MIN + cfg.entry_delay_min * MIN + cfg.hold_min * MIN
    lead = cfg.norm_points * FIVE + window
    grid = list(range(max(start - lead, klines.base - klines.base % FIVE + FIVE), end, FIVE))

    prices: dict[int, float] = {}
    for c in grid:
        bar = klines.bar(c - MIN)
        if bar is not None:
            prices[c] = bar[3]
    d_price = {c: prices[c] / prices[c - window] - 1 for c in grid if c in prices and (c - window) in prices}
    d_oi = {c: oi.values[c] / oi.values[c - window] - 1 for c in grid
            if c in oi.values and (c - window) in oi.values and c < end}
    z_price_std = rolling_z(grid, d_price, cfg.norm_points)
    z_oi_std = rolling_z(grid, d_oi, cfg.norm_points)

    fee = cfg.fee_bp if fee_bp is None else fee_bp
    slip = cfg.slip(symbol)
    funding_times = [ms for ms, _ in funding]
    events: list[Event] = []
    lock_until = start
    for c in grid:
        if c < start or c < lock_until:
            continue
        if c + horizon > end:
            break
        if c not in d_price:
            continue
        std, _ = z_price_std[c]
        if not std or math.isnan(std):
            continue
        z_p = d_price[c] / std
        if abs(z_p) < cfg.z_price:
            continue
        # Candidate (price only). Classification no earlier than c0 + lag, with OI(c0), OI(c0 - 60).
        event = Event(symbol, c, z_p, d_price[c], 1 if z_p < 0 else -1, classified_at=c + lag, category="",
                      stratum=stratum_of(cfg, abs(z_p)), oi_stamps=(c - window, c))
        assert max(event.oi_stamps) + lag <= event.classified_at  # G6: no OI before it is known
        oi_std, oi_count = z_oi_std[c]
        if c not in d_oi or not oi_std or math.isnan(oi_std) or oi_count < cfg.min_valid_share * cfg.norm_points:
            event.category = "UNCLASSIFIABLE"
            event.reason = "OI missing or normalisation below 80 %"
            event.lock_until = event.classified_at + cfg.lock_extra_min * MIN
        else:
            event.z_oi = d_oi[c] / oi_std
            if event.z_oi <= cfg.z_oi_d:
                event.category = "D"
            elif event.z_oi >= cfg.z_oi_k:
                event.category = "K"
            else:
                event.category = "UNASSIGNED"
                event.lock_until = event.classified_at + cfg.lock_extra_min * MIN
        if event.category in ("D", "K"):
            simulate_trade(cfg, event, klines, funding, funding_times, fee, slip)
        events.append(event)
        lock_until = event.lock_until
    return events


def simulate_trade(cfg: Config, event: Event, klines: Klines, funding: list[tuple[int, float]],
                   funding_times: list[int], fee_bp: float, slip_bp: float) -> None:
    """§5 identical for D and K: event end, entry, stop, time exit, costs, funding."""
    c0 = event.c0
    search_start = event.classified_at                      # bars start at or after c0 + lag
    deadline = event.classified_at + cfg.exhaustion_search_min * MIN
    down = event.direction == 1
    extreme = math.inf if down else -math.inf
    for minute in range(c0 - cfg.window_min * MIN, search_start, MIN):
        bar = klines.bar(minute)
        if bar is not None:
            extreme = min(extreme, bar[2]) if down else max(extreme, bar[1])
    event_end = None
    s = search_start
    while s + FIVE <= deadline:
        bars = [klines.bar(s + k * MIN) for k in range(5)]
        if not all(b is not None for b in bars):
            event.incomplete_bars += 1
        if all(b is not None for b in bars):
            bar_low = min(b[2] for b in bars)
            bar_high = max(b[1] for b in bars)
            extends = bar_low < extreme if down else bar_high > extreme
            if not extends:
                event_end = s + FIVE
                break
            extreme = bar_low if down else bar_high
        else:
            for b in bars:
                if b is not None:
                    extreme = min(extreme, b[2]) if down else max(extreme, b[1])
        s += FIVE
    if event_end is None:
        event.reason = "no event end by the deadline"
        event.lock_until = deadline + cfg.lock_extra_min * MIN
        return
    event.event_end = event_end
    entry_at = event_end + cfg.entry_delay_min * MIN
    entry_limit = event_end + cfg.exhaustion_search_min * MIN
    while entry_at < entry_limit and not klines.has(entry_at):
        entry_at += MIN
    if not klines.has(entry_at):
        event.reason = "no 1m candle for the entry"
        event.lock_until = entry_at + cfg.lock_extra_min * MIN
        return
    event.entry_shift_min = (entry_at - (event_end + cfg.entry_delay_min * MIN)) // MIN
    entry = klines.bar(entry_at)[0]
    side = event.direction
    stop = entry * (1 - abs(event.d_p)) if side == 1 else entry * (1 + abs(event.d_p))
    scheduled_exit = entry_at + cfg.hold_min * MIN
    exit_price = None
    exit_at = None
    reason = ""
    minute = entry_at
    while minute < scheduled_exit:
        bar = klines.bar(minute)
        if bar is not None:
            o, h, low, _ = bar
            if minute > entry_at and ((side == 1 and o <= stop) or (side == -1 and o >= stop)):
                exit_price, exit_at, reason = o, minute, "STOP_GAP"
                break
            if (side == 1 and low <= stop) or (side == -1 and h >= stop):
                exit_price, exit_at, reason = stop, minute, "STOP"
                break
        minute += MIN
    if exit_price is None:
        exit_at = scheduled_exit
        while not klines.has(exit_at) and exit_at < scheduled_exit + cfg.hold_min * MIN:
            exit_at += MIN
        if not klines.has(exit_at):
            event.reason = "no 1m candle for the exit"
            event.lock_until = exit_at + cfg.lock_extra_min * MIN
            return
        exit_price, reason = klines.bar(exit_at)[0], "TIME"
        event.exit_shift_min = (exit_at - scheduled_exit) // MIN
    gross = side * (exit_price / entry - 1)
    costs = 2 * (fee_bp + slip_bp) + (cfg.stop_extra_bp if reason.startswith("STOP") else 0.0)
    pay = 0.0
    for i in range(bisect_right(funding_times, entry_at), bisect_right(funding_times, exit_at)):
        pay -= side * funding[i][1]               # a long pays a positive rate, a short receives it
    event.outcome = "TRADE"
    event.entry_at, event.exit_at = entry_at, exit_at
    event.entry_price, event.exit_price = entry, exit_price
    event.exit_reason = reason
    event.gross, event.costs, event.funding = gross, costs / 1e4, pay
    event.net = gross - costs / 1e4 + pay
    event.lock_until = exit_at + cfg.lock_extra_min * MIN


# ─────────────────────────────────────────────────────────────────────────────
# Statistics and classes (§9)
# ─────────────────────────────────────────────────────────────────────────────


def clusters(cfg: Config, trades: list[Event]) -> list[dict]:
    """Single linkage on c0 across symbols, gap <= 60 min; value = mean net, stratum of the largest |z_P|."""
    out: list[dict] = []
    for event in sorted(trades, key=lambda e: e.c0):
        if out and event.c0 - out[-1]["last"] <= cfg.cluster_gap_min * MIN:
            group = out[-1]
            group["members"].append(event)
            group["last"] = event.c0
        else:
            out.append({"members": [event], "last": event.c0})
    for group in out:
        members = group["members"]
        group["value"] = statistics.fmean(e.net for e in members)
        group["stratum"] = max(members, key=lambda e: abs(e.z_p)).stratum
    return out


def reweighted_difference(cfg: Config, d_values: list[tuple[float, int]], k_values: list[tuple[float, int]]) -> dict:
    """Mean(D) - stratum-reweighted mean(K) with a Welch-type t (§9)."""
    n_d = len(d_values)
    if n_d < 2:
        return {"ok": False, "why": "fewer than 2 D values"}
    mean_d = statistics.fmean(v for v, _ in d_values)
    var_d = statistics.variance([v for v, _ in d_values])
    strata = sorted({s for _, s in d_values})
    mean_k = 0.0
    var_k = 0.0
    for s in strata:
        weight = sum(1 for _, x in d_values if x == s) / n_d
        values = [v for v, x in k_values if x == s]
        if len(values) < 2:
            return {"ok": False, "why": f"stratum {s} has fewer than 2 K values"}
        mean_k += weight * statistics.fmean(values)
        var_k += weight * weight * statistics.variance(values) / len(values)
    diff = mean_d - mean_k
    se = math.sqrt(var_d / n_d + var_k)
    return {"ok": True, "meanD": mean_d, "meanKReweighted": mean_k, "difference": diff,
            "t": diff / se if se > 0 else (math.inf if diff > 0 else -math.inf)}


def classify(cfg: Config, events: list[Event]) -> dict:
    """§9 classes in table order: the first matching class applies."""
    trades = [e for e in events if e.outcome == "TRADE"]
    d_clusters = clusters(cfg, [e for e in trades if e.category == "D"])
    k_clusters = clusters(cfg, [e for e in trades if e.category == "K"])
    result = {"dClusters": len(d_clusters), "kClusters": len(k_clusters), "dTrades": sum(1 for e in trades if e.category == "D"),
              "kTrades": sum(1 for e in trades if e.category == "K")}
    if len(d_clusters) < cfg.min_clusters or len(k_clusters) < cfg.min_clusters:
        return {**result, "class": "UNZUREICHEND", "why": "fewer than 40 D or K clusters"}
    mean_d = statistics.fmean(c["value"] for c in d_clusters)
    result["meanNetD"] = mean_d
    if mean_d <= 0:
        return {**result, "class": "NICHT_BESTANDEN"}
    primary = reweighted_difference(cfg, [(c["value"], c["stratum"]) for c in d_clusters],
                                    [(c["value"], c["stratum"]) for c in k_clusters])
    result["primary"] = primary
    if not primary["ok"]:
        return {**result, "class": "UNZUREICHEND", "why": primary["why"]}
    if primary["difference"] <= 0 or primary["t"] < cfg.t_hint:
        return {**result, "class": "NUR_KURSUMKEHR"}
    per_symbol = {}
    for symbol in cfg.symbols:
        d = [(e.net, e.stratum) for e in trades if e.category == "D" and e.symbol == symbol]
        k = [(e.net, e.stratum) for e in trades if e.category == "K" and e.symbol == symbol]
        diff = reweighted_difference(cfg, d, k)
        per_symbol[symbol] = diff.get("difference") if diff["ok"] else None
    result["perSymbolDifference"] = per_symbol
    if any(value is None or value <= 0 for value in per_symbol.values()):
        return {**result, "class": "UNEINHEITLICH"}
    if primary["t"] >= cfg.t_robust():
        return {**result, "class": "BELASTBAR"}
    return {**result, "class": "HINWEIS"}


def describe(events: list[Event]) -> dict:
    """§9 descriptive reports; they decide nothing."""
    counts: dict[str, int] = {}
    for e in events:
        key = f"{e.category}:{e.outcome}"
        counts[key] = counts.get(key, 0) + 1
    trades = [e for e in events if e.outcome == "TRADE"]
    out: dict = {"counts": counts}
    for name, subset in (("long", [e for e in trades if e.direction == 1]), ("short", [e for e in trades if e.direction == -1])):
        for category in ("D", "K"):
            group = [e for e in subset if e.category == category]
            out[f"{name}{category}"] = {"trades": len(group), "meanNet": statistics.fmean(e.net for e in group) if group else None,
                                        "stopShare": (sum(1 for e in group if e.exit_reason.startswith("STOP")) / len(group)) if group else None}
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Files
# ─────────────────────────────────────────────────────────────────────────────


def read_zip_csv(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.endswith(".csv")]
        if len(names) != 1:
            raise StudyError(f"{path} must hold exactly one CSV.")
        return list(csv.reader(io.StringIO(archive.read(names[0]).decode("utf-8"))))


def inspect_symbol(data: Path, symbol: str, start: int, end: int) -> dict:
    """check-data details (§3.1, §7): coverage, gaps, duplicates, OI timing, funding format. Never returns."""
    stamps: dict[int, tuple] = {}
    identical = conflicting = 0
    for path in sorted((data / f"futures/um/monthly/klines/{symbol}/1m").glob("*.zip")):
        for row in read_zip_csv(path):
            if not row or not row[0].strip().isdigit():
                continue
            ms = int(row[0])
            ms = ms // 1000 if ms > 10 ** 14 else ms
            values = tuple(row[1:5])
            if ms in stamps:
                if stamps[ms] == values:
                    identical += 1
                else:
                    conflicting += 1
            stamps[ms] = values
    in_period = sorted(ms for ms in stamps if start <= ms < end)
    gaps = []
    previous = start - MIN
    for ms in in_period + [end]:
        if ms - previous > MIN:
            gaps.append(((ms - previous) // MIN - 1, iso(previous + MIN), iso(ms - MIN)))
        previous = ms
    gaps.sort(reverse=True)
    expected = (end - start) // MIN
    offsets: dict[int, list[float]] = {k: [] for k in (-5, 0, 5)}
    oi_rows = 0
    for path in sorted((data / f"futures/um/daily/metrics/{symbol}").glob("*.zip")):
        rows = read_zip_csv(path)
        header = rows[0]
        t_col, q_col, v_col = header.index("create_time"), header.index("sum_open_interest"), header.index("sum_open_interest_value")
        for row in rows[1:]:
            if not row:
                continue
            oi_rows += 1
            try:
                ms = ms_of(row[t_col])
                implied = float(row[v_col]) / float(row[q_col])
            except (ValueError, ZeroDivisionError):
                continue
            if not (start <= ms < end) or ms % (60 * MIN):
                continue                                     # hourly sample is enough for the timing check
            for k in offsets:
                quote = stamps.get(ms + k * MIN)
                if quote:
                    offsets[k].append(abs(implied / float(quote[0]) - 1) * 1e4)
    funding_rows = []
    header_seen = set()
    for path in sorted((data / f"futures/um/monthly/fundingRate/{symbol}").glob("*.zip")):
        rows = read_zip_csv(path)
        header_seen.add(tuple(rows[0]))
        cols = rows[0]
        if "calc_time" in cols and "last_funding_rate" in cols:
            t_col, r_col = cols.index("calc_time"), cols.index("last_funding_rate")
            funding_rows += [(int(r[t_col]), float(r[r_col])) for r in rows[1:] if r]
    funding_rows.sort()
    in_funding = [(t, r) for t, r in funding_rows if start <= t < end]
    intervals: dict[int, int] = {}
    for (a, _), (b, _) in zip(in_funding, in_funding[1:]):
        hours = round((b - a) / (60 * MIN))
        intervals[hours] = intervals.get(hours, 0) + 1
    return {
        "klines": {"first": iso(min(stamps)) if stamps else None, "last": iso(max(stamps)) if stamps else None,
                   "inPeriod": len(in_period), "expected": expected, "missingMinutes": expected - len(in_period),
                   "missingShare": (expected - len(in_period)) / expected if expected else 1.0,
                   "duplicateIdentical": identical, "duplicateConflicting": conflicting,
                   "largestGaps": [{"minutes": g[0], "from": g[1], "to": g[2]} for g in gaps[:8]], "gaps": len(gaps)},
        "oiTiming": {"rows": oi_rows, "hourlySamples": len(offsets[0]),
                     "medianDeviationBpVsTradeOpen": {f"t{k:+d}min": (statistics.median(v) if v else None) for k, v in offsets.items()}},
        "funding": {"headers": [list(h) for h in sorted(header_seen)], "pointsInPeriod": len(in_funding),
                    "intervalHours": intervals, "minRate": min((r for _, r in in_funding), default=None),
                    "maxRate": max((r for _, r in in_funding), default=None)},
    }


def load_symbol(data: Path, symbol: str) -> tuple[Klines, OiPoints, list[tuple[int, float]]]:
    kline_rows: list[tuple[int, float, float, float, float]] = []
    for path in sorted((data / f"futures/um/monthly/klines/{symbol}/1m").glob("*.zip")):
        for row in read_zip_csv(path):
            if not row or not row[0].strip().isdigit():
                continue                                   # header line
            ms = int(row[0])
            if ms > 10 ** 14:
                ms //= 1000                                # microsecond stamps
            kline_rows.append((ms, float(row[1]), float(row[2]), float(row[3]), float(row[4])))
    oi_rows: list[tuple[str, str]] = []
    for path in sorted((data / f"futures/um/daily/metrics/{symbol}").glob("*.zip")):
        rows = read_zip_csv(path)
        header = rows[0]
        if "create_time" not in header or "sum_open_interest" not in header:
            raise StudyError(f"{path}: unexpected metrics header {header}.")
        time_col, oi_col = header.index("create_time"), header.index("sum_open_interest")
        oi_rows += [(row[time_col], row[oi_col]) for row in rows[1:] if row]
    funding: list[tuple[int, float]] = []
    for path in sorted((data / f"futures/um/monthly/fundingRate/{symbol}").glob("*.zip")):
        rows = read_zip_csv(path)
        header = rows[0]
        if "calc_time" not in header or "last_funding_rate" not in header:
            raise StudyError(f"{path}: unexpected fundingRate header {header}.")
        time_col, rate_col = header.index("calc_time"), header.index("last_funding_rate")
        funding += [(int(row[time_col]), float(row[rate_col])) for row in rows[1:] if row]
    funding.sort()
    return klines_from_rows(kline_rows), validate_oi(oi_rows), funding


def git_blob(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


def verify_preregistration(root: Path = REPO_ROOT) -> dict:
    """The preregistration minus its freeze status block must hash to the frozen blob."""
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
    blob = git_blob(frozen)
    if not (blob == PREREGISTRATION["frozenBlob"] and PREREGISTRATION["frozenCommit"] in status and PREREGISTRATION["frozenBlob"] in status):
        raise StudyError(f"Preregistration differs from the frozen text (blob {blob}).")
    return {"path": PREREGISTRATION["path"], "blob": blob, "frozenCommit": PREREGISTRATION["frozenCommit"], "verified": True}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    present = {p.relative_to(data).as_posix() for p in data.rglob("*") if p.is_file() and p.name != "manifest.sha256"}
    unlisted = sorted(present - set(listed))
    if unlisted:
        raise StudyError(f"Files not in the manifest: {unlisted[:5]}.")
    return {"files": len(listed), "sha256": sha256_file(manifest)}


# ─────────────────────────────────────────────────────────────────────────────
# Synthetic data (tests and dry runs only)
# ─────────────────────────────────────────────────────────────────────────────


def write_zip_csv(path: Path, header: list[str] | None, rows: list[list]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    if header:
        writer.writerow(header)
    writer.writerows(rows)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(path.name.replace(".zip", ".csv"), buffer.getvalue())


def synth(out: Path, seed: int = 7, start: str = "2023-11-01", days: int = 61) -> dict:
    """Random-walk 1m klines and 5-minute OI with injected shocks; no market data involved."""
    rng = random.Random(seed)
    base = ms_of(start)
    minutes = days * 1440
    shocks: dict[str, list[tuple[int, int, float, float]]] = {"BTCUSDT": [], "ETHUSDT": []}
    for symbol, price0, oi0 in (("BTCUSDT", 30_000.0, 100_000.0), ("ETHUSDT", 2_000.0, 1_500_000.0)):
        for k in range(8, days - 1, 3):          # a 40-minute shock every 3 days, alternating D and K
            at = base + k * DAY + rng.randrange(0, 1200) * MIN
            shocks[symbol].append((at - at % FIVE, 40, rng.choice((-0.03, 0.03)), -0.06 if k % 2 == 0 else 0.0))
        price, oi = price0, oi0
        kline_rows: dict[str, list[list]] = {}
        oi_rows: dict[str, list[list]] = {}
        for m in range(minutes):
            ms = base + m * MIN
            drift, oi_drift = 0.0, 0.0
            for at, length, move, oi_move in shocks[symbol]:
                if at <= ms < at + length * MIN:
                    drift += move / length
                    oi_drift += oi_move / length
            o = price
            price *= math.exp(rng.gauss(0, 0.0008) + drift)
            oi *= math.exp(rng.gauss(0, 0.0004) + oi_drift)
            high = max(o, price) * (1 + abs(rng.gauss(0, 0.0003)))
            low = min(o, price) * (1 - abs(rng.gauss(0, 0.0003)))
            month = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m")
            kline_rows.setdefault(month, []).append([ms, f"{o:.4f}", f"{high:.4f}", f"{low:.4f}", f"{price:.4f}", "1", ms + MIN - 1, "1", 1, "0", "0", "0"])
            if ms % FIVE == 0:
                day = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                oi_rows.setdefault(day, []).append([iso(ms) + ":00", symbol, f"{oi:.3f}", f"{oi * price:.3f}", "1", "1", "1", "1"])
        for month, rows in kline_rows.items():
            write_zip_csv(out / f"futures/um/monthly/klines/{symbol}/1m/{symbol}-1m-{month}.zip",
                          ["open_time", "open", "high", "low", "close", "volume", "close_time", "quote_volume", "count",
                           "taker_buy_volume", "taker_buy_quote_volume", "ignore"], rows)
        for day, rows in oi_rows.items():
            write_zip_csv(out / f"futures/um/daily/metrics/{symbol}/{symbol}-metrics-{day}.zip",
                          ["create_time", "symbol", "sum_open_interest", "sum_open_interest_value", "count_toptrader_long_short_ratio",
                           "sum_toptrader_long_short_ratio", "count_long_short_ratio", "sum_taker_long_short_vol_ratio"], rows)
        shock_days = sorted({datetime.fromtimestamp(at / 1000, tz=timezone.utc).strftime("%Y-%m-%d") for at, *_ in shocks[symbol]})
        for day in shock_days:                      # bookDepth snapshots once a minute on the shock days only
            day_start = ms_of(day)
            depth_rows = []
            for m in range(1440):
                stamp = iso(day_start + m * MIN) + ":05"
                for level in (-5, -4, -3, -2, -1, 1, 2, 3, 4, 5):
                    notional = 5e7 * abs(level)
                    depth_rows.append([stamp, level, f"{notional / price0:.3f}", f"{notional:.3f}"])
            write_zip_csv(out / f"futures/um/daily/bookDepth/{symbol}/{symbol}-bookDepth-{day}.zip",
                          ["timestamp", "percentage", "depth", "notional"], depth_rows)
        funding_rows = {}
        for d in range(days):
            for hour in (0, 8, 16):
                ms = base + d * DAY + hour * 60 * MIN
                month = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m")
                funding_rows.setdefault(month, []).append([ms, 8, "0.0001"])
        for month, rows in funding_rows.items():
            write_zip_csv(out / f"futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip",
                          ["calc_time", "funding_interval_hours", "last_funding_rate"], rows)
    (out / "SYNTHETIC").write_text("synthetic data written by deleveraging_events_v1.py synth\n", encoding="utf-8")
    return {"out": str(out), "seed": seed, "start": start, "days": days,
            "shocks": {s: [iso(at) for at, *_ in v] for s, v in shocks.items()}}


# ─────────────────────────────────────────────────────────────────────────────
# Commands
# ─────────────────────────────────────────────────────────────────────────────


def is_synthetic(data: Path) -> bool:
    return (data / "SYNTHETIC").exists()


def guard_real(args, data: Path) -> None:
    if is_synthetic(data):
        return
    if not (args.real and args.confirm == STUDY_KEY):
        raise StudyError("Real data needs --real --confirm DELEVERAGING_EVENTS_V1 (separate operator approval).")
    verify_preregistration()
    verify_manifest(data)


def period_bounds(cfg: Config, args, symbol: str) -> tuple[int, int]:
    if args.period_start and args.period_end:
        return ms_of(args.period_start), ms_of(args.period_end)
    return cfg.period(args.period, symbol)


def cmd_check_data(args) -> int:
    data = Path(args.data)
    guard_real(args, data)
    cfg = FROZEN
    report = {}
    halt = False
    for symbol in cfg.symbols:
        klines, oi, funding = load_symbol(data, symbol)
        start, end = period_bounds(cfg, args, symbol)
        missing_oi = oi_missing_share(oi, start, end)
        minutes = (end - start) // MIN
        present = sum(1 for m in range(start, end, MIN) if klines.has(m))
        report[symbol] = {"oi": oi.report, "oiMissingShare": missing_oi, "klinesMissingShare": 1 - present / minutes if minutes else 1.0,
                          "fundingPoints": len(funding), "details": inspect_symbol(data, symbol, start, end)}
        if missing_oi > cfg.abort_invalid_share:
            halt = True
    print(json.dumps({"study": STUDY_KEY, "period": args.period, "report": report, "halt": halt}, indent=2))
    return 3 if halt else 0


def detect_all(cfg: Config, data: Path, args) -> tuple[list[Event], dict]:
    events: list[Event] = []
    halt = {}
    for symbol in cfg.symbols:
        klines, oi, funding = load_symbol(data, symbol)
        start, end = period_bounds(cfg, args, symbol)
        share = oi_missing_share(oi, start, end)
        if share > cfg.abort_invalid_share:
            halt[symbol] = share
            continue
        events += detect_events(cfg, symbol, klines, oi, funding, start, end)
    return events, halt


def cmd_check_assumptions(args) -> int:
    """How often the README assumptions act on this data; counts only, never returns."""
    data = Path(args.data)
    guard_real(args, data)
    events, halt = detect_all(FROZEN, data, args)
    counts: dict[str, int] = {}
    for e in events:
        counts[f"{e.symbol}:{e.category}"] = counts.get(f"{e.symbol}:{e.category}", 0) + 1
    dk = [e for e in events if e.category in ("D", "K")]
    report = {
        "study": STUDY_KEY, "period": args.period, "halt": halt, "candidates": counts,
        "dkCandidates": len(dk),
        "dkWithIncompleteBars": sum(1 for e in dk if e.incomplete_bars),
        "dkNoTradeReasons": {r: sum(1 for e in dk if e.outcome == "NO_TRADE" and e.reason == r)
                             for r in sorted({e.reason for e in dk if e.outcome == "NO_TRADE"})},
        "tradesWithShiftedEntry": sum(1 for e in dk if e.outcome == "TRADE" and e.entry_shift_min),
        "tradesWithShiftedExit": sum(1 for e in dk if e.outcome == "TRADE" and e.exit_shift_min),
        "trades": sum(1 for e in dk if e.outcome == "TRADE"),
    }
    print(json.dumps(report, indent=2))
    return 0


def cmd_cost_check(args) -> int:
    """§6: price impact of 25 000 USD from bookDepth at the entries of 2023 (discovery only). Never returns.

    Impact = 1 % x notional / cumulative notional within 1 % on the side the order takes
    (ask for a long entry, bid for a short entry): the price reached if the depth inside 1 %
    were spread evenly, a conservative upper value for the average fill.
    """
    data = Path(args.data)
    guard_real(args, data)
    events, _ = detect_all(FROZEN, data, args)
    cache: dict[str, list[tuple[int, dict]]] = {}
    per_symbol: dict[str, list[float]] = {}
    without = {}
    for e in events:
        if e.outcome != "TRADE" or e.category not in ("D", "K") or not (ms_of("2023-01-01") <= e.entry_at < ms_of("2024-01-01")):
            continue
        day = datetime.fromtimestamp(e.entry_at / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        path = data / f"futures/um/daily/bookDepth/{e.symbol}/{e.symbol}-bookDepth-{day}.zip"
        key = str(path)
        if key not in cache:
            snapshots: dict[int, dict] = {}
            if path.exists():
                rows = read_zip_csv(path)
                header = rows[0]
                t_col, p_col, n_col = header.index("timestamp"), header.index("percentage"), header.index("notional")
                for row in rows[1:]:
                    if row:
                        snapshots.setdefault(ms_of(row[t_col]), {})[float(row[p_col])] = float(row[n_col])
            cache[key] = sorted(snapshots.items())
        snaps = cache[key]
        i = bisect_right([t for t, _ in snaps], e.entry_at) - 1
        level = 1.0 if e.direction == 1 else -1.0
        if i < 0 or e.entry_at - snaps[i][0] > 2 * MIN or level not in snaps[i][1]:
            without[e.symbol] = without.get(e.symbol, 0) + 1
            continue
        impact_bp = 100.0 * FROZEN.notional_usd / snaps[i][1][level]
        per_symbol.setdefault(e.symbol, []).append(impact_bp)
    report = {}
    exceeds = False
    for symbol in FROZEN.symbols:
        values = sorted(per_symbol.get(symbol, []))
        assumed = FROZEN.slip(symbol)
        stats = {"entries": len(values), "withoutSnapshot": without.get(symbol, 0), "assumedSpreadSlippageBp": assumed}
        if values:
            stats |= {"medianImpactBp": statistics.median(values), "p95ImpactBp": values[int(0.95 * (len(values) - 1))],
                      "maxImpactBp": values[-1]}
            exceeds |= values[-1] > assumed
        report[symbol] = stats
    print(json.dumps({"study": STUDY_KEY, "costCheck": report,
                      "decision": "assumption exceeded: operator decision needed" if exceeds else "no adjustment: every impact is below the assumption"},
                     indent=2))
    return 3 if exceeds else 0


def summarize_rows(rows: list[dict]) -> dict:
    """Breakdown of one evaluate run (events CSV): descriptive, decides nothing."""
    def block(subset: list[dict]) -> dict:
        if not subset:
            return {"trades": 0}
        net = [float(r["net"]) for r in subset]
        gross = [float(r["gross"]) for r in subset]
        losses = [v for v in net if v <= 0]
        return {"trades": len(subset), "meanGrossBp": 1e4 * statistics.fmean(gross), "meanNetBp": 1e4 * statistics.fmean(net),
                "medianNetBp": 1e4 * statistics.median(net), "hitRateNet": sum(1 for v in net if v > 0) / len(net),
                "hitRateGross": sum(1 for v in gross if v > 0) / len(gross),
                "meanLossBp": 1e4 * statistics.fmean(losses) if losses else None, "worstNetBp": 1e4 * min(net),
                "bestNetBp": 1e4 * max(net), "meanCostsBp": 1e4 * statistics.fmean(float(r["costs"]) for r in subset),
                "meanFundingBp": 1e4 * statistics.fmean(float(r["funding"]) for r in subset),
                "stopShare": sum(1 for r in subset if r["exit_reason"].startswith("STOP")) / len(subset),
                "longShare": sum(1 for r in subset if r["direction"] == "1") / len(subset),
                "meanAbsShockPct": 100 * statistics.fmean(abs(float(r["d_p"])) for r in subset),
                "medianAbsZp": statistics.median(abs(float(r["z_p"])) for r in subset),
                "strata": {s: sum(1 for r in subset if r["stratum"] == s) for s in ("0", "1", "2")}}
    trades = [r for r in rows if r["outcome"] == "TRADE"]
    out: dict = {"candidates": {}, "byCategory": {}, "bySymbol": {}}
    for r in rows:
        key = f"{r['category']}:{r['outcome']}"
        out["candidates"][key] = out["candidates"].get(key, 0) + 1
    for category in ("D", "K"):
        out["byCategory"][category] = block([r for r in trades if r["category"] == category])
        for symbol in sorted({r["symbol"] for r in rows}):
            out["bySymbol"][f"{symbol}:{category}"] = block([r for r in trades if r["category"] == category and r["symbol"] == symbol])
    return out


def cmd_summarize(args) -> int:
    with Path(args.events).open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    print(json.dumps(summarize_rows(rows), indent=2))
    return 0


def cmd_evaluate(args) -> int:
    data = Path(args.data)
    out = Path(args.out)
    guard_real(args, data)
    cfg = replace(FROZEN, **VARIANTS[args.variant])
    if args.period == "test" and not is_synthetic(data):
        if args.confirm_test != STUDY_KEY or not args.discovery_result:
            raise StudyError("The test period stays locked: needs --discovery-result FILE --confirm-test DELEVERAGING_EVENTS_V1.")
        discovery = json.loads(Path(args.discovery_result).read_text(encoding="utf-8"))
        if discovery.get("variant") != "primary" or discovery.get("result", {}).get("class") not in ("HINWEIS", "BELASTBAR"):
            raise StudyError("The test period opens only after a primary discovery result HINWEIS or BELASTBAR.")
    events: list[Event] = []
    halt = {}
    for symbol in cfg.symbols:
        klines, oi, funding = load_symbol(data, symbol)
        start, end = period_bounds(cfg, args, symbol)
        share = oi_missing_share(oi, start, end)
        if share > cfg.abort_invalid_share:
            halt[symbol] = share
            continue
        fee = SPOT_FEE_BP if args.variant == "spot" else None
        found = detect_events(cfg, symbol, klines, oi, funding, start, end, fee_bp=fee)
        if args.variant == "spot":
            found = [e for e in found if e.direction == 1]
        events += found
    if halt:
        print(json.dumps({"study": STUDY_KEY, "halt": "data abort before any return (G7)", "missingShare": halt}, indent=2))
        return 3
    result = classify(cfg, events) if args.variant == "primary" else {"class": "DESCRIPTIVE_ONLY"}
    out.mkdir(parents=True, exist_ok=True)
    summary = {"study": STUDY_KEY, "period": args.period, "variant": args.variant, "synthetic": is_synthetic(data),
               "configHash": config_hash(cfg), "result": result, "describe": describe(events),
               "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    (out / f"result-{args.period}-{args.variant}.json").write_text(json.dumps(summary, indent=2, default=float), encoding="utf-8")
    with (out / f"events-{args.period}-{args.variant}.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["symbol", "c0", "category", "z_p", "z_oi", "outcome", "reason", "event_end", "entry_at", "exit_at",
                         "exit_reason", "gross", "costs", "funding", "net", "stratum", "d_p", "direction"])
        for e in events:
            writer.writerow([e.symbol, iso(e.c0), e.category, f"{e.z_p:.3f}", "" if e.z_oi is None else f"{e.z_oi:.3f}", e.outcome, e.reason,
                             "" if e.event_end is None else iso(e.event_end), "" if e.entry_at is None else iso(e.entry_at),
                             "" if e.exit_at is None else iso(e.exit_at), e.exit_reason, f"{e.gross:.6f}", f"{e.costs:.6f}",
                             f"{e.funding:.6f}", f"{e.net:.6f}", e.stratum, f"{e.d_p:.6f}", e.direction])
    print(json.dumps(summary, indent=2, default=float))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("synth")
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=7)
    p = sub.add_parser("verify")
    p.add_argument("--data")
    p = sub.add_parser("summarize")
    p.add_argument("--events", required=True)
    for name in ("check-data", "check-assumptions", "cost-check", "evaluate"):
        p = sub.add_parser(name)
        p.add_argument("--data", required=True)
        p.add_argument("--period", choices=("discovery", "test"), required=True)
        p.add_argument("--period-start", help="synthetic data only: override the period start (YYYY-MM-DD)")
        p.add_argument("--period-end", help="synthetic data only: override the period end, exclusive (YYYY-MM-DD)")
        p.add_argument("--real", action="store_true")
        p.add_argument("--confirm", default="")
        if name == "evaluate":
            p.add_argument("--out", required=True)
            p.add_argument("--variant", choices=(*VARIANTS, "spot"), default="primary")
            p.add_argument("--discovery-result")
            p.add_argument("--confirm-test", default="")
    args = parser.parse_args(argv)
    try:
        if args.command == "synth":
            print(json.dumps(synth(Path(args.out), args.seed), indent=2))
            return 0
        if args.command == "summarize":
            return cmd_summarize(args)
        if args.command == "verify":
            report = {"preregistration": verify_preregistration(), "configHash": config_hash(FROZEN)}
            if args.data:
                report["manifest"] = verify_manifest(Path(args.data))
            print(json.dumps(report, indent=2))
            return 0
        if getattr(args, "period_start", None) and not is_synthetic(Path(args.data)):
            raise StudyError("--period-start/--period-end are for synthetic data only.")
        if args.command == "check-data":
            return cmd_check_data(args)
        if args.command == "check-assumptions":
            return cmd_check_assumptions(args)
        if args.command == "cost-check":
            return cmd_cost_check(args)
        return cmd_evaluate(args)
    except StudyError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
