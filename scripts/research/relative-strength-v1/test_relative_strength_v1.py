#!/usr/bin/env python3
"""Tests of relative_strength_v1.py on synthetic data only (step 1.1).

Run with ``python3 -I scripts/research/relative-strength-v1/test_relative_strength_v1.py``.
The module is loaded by path, so ``-I`` keeps the current directory out of sys.path.
No test reads market data; every price below is made up.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import math
import shutil
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from dataclasses import replace
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the research script
_SPEC = importlib.util.spec_from_file_location("relative_strength_v1", Path(__file__).with_name("relative_strength_v1.py"))
rs = importlib.util.module_from_spec(_SPEC)
sys.modules["relative_strength_v1"] = rs
_SPEC.loader.exec_module(rs)

T0 = rs.day_of("2021-01-04")  # a Monday
START = T0 + 98  # a Monday, 98 days of history before the window
CFG = replace(rs.FROZEN, prelude_start=T0, window_start=START, window_end=START + 100, subperiod_start=START + 50,
              four_week_anchor=START)
RISK_ON_ALL = {day: "RISK_ON" for day in range(START - 1, START + 100)}
RISK_ON_ALL[START - 1] = "NEUTRAL"


def wave(base: float, slope: float = 0.0, amplitude: float = 0.04):
    return lambda day: base * (1 + slope * (day - T0)) * (1 + amplitude * math.sin(day / 3))


def series(symbol: str, close, first: int = T0, last: int = START + 99, qv: float = 2e8, trades: int = 1000, skip=()) -> "rs.SymbolSeries":
    candles = {}
    for day in range(first, last + 1):
        if day in skip:
            continue
        o, c = close(day - 1), close(day)
        candles[day] = (o, max(o, c) * 1.001, min(o, c) * 0.999, c, qv, trades)
    return rs.SymbolSeries(symbol, candles)


def market(items, labels=None, evidence=(), errors=None, cfg=CFG):
    by_symbol = {item.symbol: item for item in items}
    instruments, cases = rs.build_instruments(by_symbol, list(evidence), errors or {}, cfg)
    rf = {day: 4.0 for day in range(cfg.prelude_start, cfg.window_end)}
    return rs.build_market(cfg, instruments, labels or RISK_ON_ALL, rf), cases


def evidence(symbol, kind, day, published=None, successor=None, ratio=None):
    return rs.Evidence(symbol, kind, day, rs.day_of(published) + 1 if published else None, "https://example.invalid", successor, ratio)


def trades(result, reason=None, side=None):
    return [t for t in result.trades if (reason is None or t["reason"] == reason) and (side is None or t["side"] == side)]


def final_equity(result):
    return result.daily[-1][1]


def one_symbol(item, labels=None, evidence_list=(), **spec):
    m, _ = market([item], labels, evidence_list)
    return m, rs.simulate(m, rs.SimSpec("XS", "WEEKLY", **spec))


# --- Universe (§3) --------------------------------------------------------------------


class Universe(unittest.TestCase):
    def test_history_liquidity_and_completeness(self):
        young = series("YOUNGUSDT", wave(5), first=START - 60)
        thin = series("THINUSDT", wave(5), qv=1e6)
        gap = series("GAPUSDT", wave(5), skip={START - 5})
        ok = series("OKUSDT", wave(5))
        m, _ = market([young, thin, gap, ok])
        members = lambda day: {m.instruments[key].symbol for key in m.universe[day].members}
        self.assertEqual(members(START), {"OKUSDT"})  # young < 90 days, thin < 5 M, gap inside the last 30 days
        self.assertIn("GAPUSDT", members(START + 26))  # 30 complete days again
        self.assertIn("YOUNGUSDT", members(START + 31))  # 90 days of history reached

    def test_exclusions_x1_to_x5_point_in_time(self):
        items = [series("USDCUSDT", wave(1, amplitude=0.0)), series("PAXGUSDT", wave(1800)), series("WBTCUSDT", wave(30000)),
                 series("FLATUSDT", wave(2, amplitude=0.005)), series("FOOUPUSDT", wave(3)),
                 series("FOOUSDT", wave(4), first=START + 10), series("OKUSDT", wave(5))]
        m, _ = market(items)
        members = lambda day: {m.instruments[key].symbol for key in m.universe[day].members}
        self.assertEqual(m.exclusions["USDCUSDT"], "X1")
        self.assertEqual(m.exclusions["PAXGUSDT"], "X3")
        self.assertEqual(m.exclusions["WBTCUSDT"], "X5")
        self.assertEqual(m.exclusions["FLATUSDT"], "X2")
        # K5: FOOUP counts as a leveraged token only once FOOUSDT had a candle before the reference day.
        self.assertIn("FOOUPUSDT", members(START + 5))
        self.assertNotIn("FOOUPUSDT", members(START + 20))
        self.assertEqual(members(START + 20), {"OKUSDT"})

    def test_top_fifty_by_liquidity_ties_by_symbol(self):
        items = [series(f"S{index:02d}USDT", wave(1 + index), qv=1e7 * (1 + index // 2)) for index in range(54)]
        m, _ = market(items)
        members = [m.instruments[key].symbol for key in m.universe[START].members]
        self.assertEqual(len(members), 50)
        self.assertNotIn("S00USDT", members)
        self.assertNotIn("S03USDT", members)
        self.assertEqual(members[:2], ["S52USDT", "S53USDT"])  # equal L30: by symbol

    def test_no_lookahead_in_universe_ranks_and_labels(self):
        items = [series(f"S{index:02d}USDT", wave(1 + index, slope=0.001 * (index - 6))) for index in range(14)]
        m1, _ = market(items)
        day = START + 40
        changed = list(items)
        weakest = min(m1.ranks["A"][day], key=lambda key: -m1.ranks["A"][day][key])
        symbol = m1.instruments[weakest].symbol
        index = [item.symbol for item in items].index(symbol)
        candles = {d: (c if d < day else (c[0] * 3, c[1] * 3, c[2] * 3, c[3] * 3, c[4], c[5])) for d, c in items[index].candles.items()}
        changed[index] = rs.SymbolSeries(symbol, candles)  # the weakest coin triples from day D on
        m2, _ = market(changed)
        self.assertEqual(m1.universe[day].members, m2.universe[day].members)
        self.assertEqual(m1.ranks["A"][day], m2.ranks["A"][day])  # decisions on D see nothing of D
        self.assertEqual(m2.ranks["A"][day + 1][weakest], 1)  # on D + 1 the close of D is known
        btc = {d: (100.0, 100, 100, 100 + d) for d in range(T0 - 300, START + 100)}
        eth = {d: (10.0, 10, 10, 10 + d / 10) for d in range(T0 - 300, START + 100)}
        labels = rs.regime_labels(btc, eth, START, START + 50)
        future = dict(btc)
        future.update({d: (1.0, 1, 1, 1.0) for d in range(START + 30, START + 100)})
        self.assertEqual(rs.regime_labels(future, eth, START, START + 30), {d: labels[d] for d in range(START, START + 31)})
        self.assertEqual(labels[START], "RISK_ON")


# --- Strategy mechanics (§5, §6, §7, §8) -----------------------------------------------


class Mechanics(unittest.TestCase):
    def setUp(self):
        self.items = [series(f"S{index:02d}USDT", wave(1 + index, slope=0.002 * index)) for index in range(14)]

    def test_build_buys_top_ten_equal_weight_at_open(self):
        m, _ = market(self.items)
        result = rs.simulate(m, rs.SimSpec("XS", "WEEKLY"))
        builds = trades(result, "BUILD", "BUY")
        self.assertEqual(len(builds), 10)
        self.assertEqual({t["day"] for t in builds}, {START})
        expected = sorted(m.ranks["A"][START], key=lambda key: m.ranks["A"][START][key])[:10]
        self.assertEqual({t["instrument"] for t in builds}, set(expected))
        amount = rs.FROZEN.slot / 10
        for trade in builds:
            self.assertAlmostEqual(trade["notional"] * (1 + rs.side_bp("L1") / 10_000), amount, places=6)

    def test_buffer_keeps_rank_twenty_and_sells_beyond(self):
        items = [series(f"S{index:02d}USDT", wave(1 + index)) for index in range(30)]
        m, _ = market(items)
        day = START + 7  # first weekly schedule day after the build
        held = sorted(m.ranks["A"][START], key=lambda key: m.ranks["A"][START][key])[:10]
        others = [key for key in m.universe[day].members if key not in held]
        ranks = {key: 21 + position for position, key in enumerate(held[:2])}  # two holdings fall to 21, 22
        ranks.update({key: 11 + position for position, key in enumerate(held[2:])})  # the rest to 11-18: kept
        ranks.update({key: 1 + position for position, key in enumerate(others)})
        m.ranks["A"][day] = ranks
        result = rs.simulate(m, rs.SimSpec("XS", "WEEKLY"))
        sold = {t["instrument"] for t in trades(result) if t["day"] == day and t["side"] == "SELL"}
        bought = {t["instrument"] for t in trades(result) if t["day"] == day and t["side"] == "BUY"}
        self.assertEqual(sold, set(held[:2]))
        self.assertEqual(bought, set(sorted(others, key=lambda key: ranks[key])[:2]))

    def test_gate_exit_sells_everything_at_open_and_cash_earns_nothing_in_s1(self):
        labels = dict(RISK_ON_ALL)
        labels.update({day: "NEUTRAL" for day in range(START + 30, START + 100)})
        m, _ = market(self.items, labels)
        result = rs.simulate(m, rs.SimSpec("XS", "WEEKLY"))
        exits = trades(result, "GATE_EXIT")
        self.assertEqual({t["day"] for t in exits}, {START + 30})
        self.assertEqual(len(exits), 10)
        after = [equity for day, equity, invested, *_ in result.daily if day >= START + 30]
        self.assertTrue(all(abs(value - after[0]) < 1e-9 for value in after))
        self.assertTrue(all(invested == 0 for day, _, invested, *_ in result.daily if day >= START + 30))

    def test_lag_moves_every_execution_one_day(self):
        labels = dict(RISK_ON_ALL)
        labels.update({day: "NEUTRAL" for day in range(START + 30, START + 100)})
        m, _ = market(self.items, labels)
        result = rs.simulate(m, rs.SimSpec("XS", "WEEKLY", lag=1))
        self.assertEqual({t["day"] for t in trades(result, "BUILD")}, {START + 1})
        self.assertEqual({t["day"] for t in trades(result, "GATE_EXIT")}, {START + 31})

    def test_control_holds_the_whole_universe_equal_weight(self):
        m, _ = market(self.items)
        result = rs.simulate(m, rs.SimSpec("CONTROL", "WEEKLY"))
        builds = trades(result, "BUILD", "BUY")
        self.assertEqual({t["instrument"] for t in builds}, set(m.universe[START].members))
        amounts = {round(t["notional"] * (1 + rs.side_bp(t["tier"]) / 10_000), 6) for t in builds}
        self.assertEqual(amounts, {round(rs.FROZEN.slot / len(m.universe[START].members), 6)})

    def test_costs_are_charged_exactly_by_tier_and_doubled_in_the_stress(self):
        item = series("ONEUSDT", wave(10))
        m, result = one_symbol(item)
        buy = trades(result, "BUILD")[0]
        self.assertEqual(buy["tier"], "L1")
        self.assertAlmostEqual(buy["fee"], buy["notional"] * 10 / 10_000)
        self.assertAlmostEqual(buy["spread"], buy["notional"] * 1 / 10_000)
        self.assertAlmostEqual(buy["slippage"], buy["notional"] * 3 / 10_000)
        stressed = rs.simulate(m, rs.SimSpec("XS", "WEEKLY", cost_mult=2.0))
        self.assertAlmostEqual(trades(stressed, "BUILD")[0]["fee"], trades(stressed, "BUILD")[0]["notional"] * 20 / 10_000)
        last = START + 99
        expected = (rs.FROZEN.slot / (1 + 14 / 10_000)) / m.instruments[buy["instrument"]].open(START) * item.candles[last][3] * (1 - 14 / 10_000)
        self.assertAlmostEqual(final_equity(result), expected, places=6)
        mid = series("MIDUSDT", wave(10), qv=5e7)
        low = series("LOWUSDT", wave(10), qv=8e6)
        m2, _ = market([mid, low])
        self.assertEqual(m2.tier(m2.universe[START].members[0], START)[0], "L2")
        self.assertEqual(m2.tier(m2.universe[START].members[1], START)[0], "L3")

    def test_tick_proxy_forces_l3(self):
        raw = series("TICKUSDT", wave(0.5)).candles
        coarse = rs.SymbolSeries("TICKUSDT", {d: tuple(round(v, 3) for v in c[:4]) + c[4:] for d, c in raw.items()})  # every price on a 0.001 grid
        m, _ = market([coarse])
        tier, by_tick = m.tier(m.universe[START].members[0], START)
        self.assertEqual((tier, by_tick), ("L3", True))

    def test_minimum_order_skips_small_buys(self):
        m, _ = market(self.items, cfg=replace(CFG, slot=50.0))
        result = rs.simulate(m, rs.SimSpec("XS", "WEEKLY"))
        self.assertEqual(trades(result, "BUILD"), [])  # 5 USDT per position < 10 USDT

    def test_s2_pays_interest_only_in_s2_and_delays_the_build(self):
        labels = {day: "NEUTRAL" for day in range(START - 1, START + 100)}
        labels.update({day: "RISK_ON" for day in range(START + 20, START + 100)})
        m, _ = market(self.items, labels)
        s1 = rs.simulate(m, rs.SimSpec("XS", "WEEKLY"))
        s2 = rs.simulate(m, rs.SimSpec("XS", "WEEKLY", s2=True))
        self.assertEqual(s1.interest, 0.0)
        self.assertAlmostEqual(s1.daily[19][1], rs.FROZEN.slot)
        self.assertAlmostEqual(s2.interest, rs.FROZEN.slot * (1 + 0.04 / 365) ** 20 - rs.FROZEN.slot, places=6)
        self.assertEqual({t["day"] for t in trades(s1, "BUILD")}, {START + 20})
        self.assertEqual({t["day"] for t in trades(s2, "BUILD")}, {START + 21})

    def test_accounting_identity_and_invested_quota(self):
        m, _ = market(self.items)
        result = rs.simulate(m, rs.SimSpec("CONTROL", "FOURWEEKLY"))
        self.assertAlmostEqual(final_equity(result), rs.FROZEN.slot + sum(result.pnl_by_symbol.values()), places=6)
        quota = rs.quota_metrics(result, m)
        self.assertGreater(quota["meanQuotaRiskOn"], 0.99)
        self.assertEqual(result.daily[-1][2], 0.0)  # liquidated at the end

    def test_pair_reference_holds_btc_and_eth_at_l1(self):
        items = self.items + [series("BTCUSDT", wave(30000)), series("ETHUSDT", wave(2000))]
        m, _ = market(items)
        result = rs.simulate(m, rs.SimSpec("PAIR"))
        self.assertEqual({t["symbol"] for t in trades(result, "BUILD")}, {"BTCUSDT", "ETHUSDT"})
        self.assertEqual({t["tier"] for t in result.trades}, {"L1"})

    def test_invested_capital_return_ignores_cash(self):
        m, _ = market(self.items[:1])
        result = rs.simulate(m, rs.SimSpec("XS", "WEEKLY"))
        item = self.items[0]
        price_ratio = item.candles[START + 99][3] / item.candles[START][0]
        cost = (1 - 14 / 10_000) / (1 + 14 / 10_000)
        self.assertAlmostEqual(rs.invested_capital_return(result, m), price_ratio * cost - 1, places=9)


# --- Events E1-E7 (§4.3) ---------------------------------------------------------------


class Events(unittest.TestCase):
    def test_e2_pause_defers_the_exit_to_the_first_open_after_resumption(self):
        item = series("HALTUSDT", wave(10), skip={START + 30, START + 31, START + 32})
        labels = dict(RISK_ON_ALL)
        labels.update({day: "NEUTRAL" for day in range(START + 31, START + 100)})
        m, result = one_symbol(item, labels)
        exit_trade = trades(result, side="SELL")[0]
        self.assertEqual((exit_trade["day"], exit_trade["reason"], exit_trade["tier"]), (START + 33, "E2", "L3"))
        self.assertAlmostEqual(exit_trade["notional"] / result.daily[0][2], item.candles[START + 33][0] / item.candles[START][3], places=3)

    def test_e3_exit_at_the_reopen_and_the_haircut_is_a_separate_stress(self):
        close = wave(10)
        gap = set(range(START + 30, START + 40))
        item = series("LONGUSDT", lambda d: close(d) * (2 if d >= START + 39 else 1), skip=gap)  # reopens twice as high
        m, result = one_symbol(item)
        exit_trade = trades(result, "E3")[0]
        self.assertEqual(exit_trade["day"], START + 40)
        quantity = result.daily[0][2] / item.candles[START][3]
        self.assertAlmostEqual(exit_trade["notional"], quantity * item.candles[START + 40][0], places=6)
        haircut = rs.simulate(m, rs.SimSpec("XS", "WEEKLY", e3_haircut=True))
        self.assertAlmostEqual(trades(haircut, "E3")[0]["notional"], quantity * item.candles[START + 29][3], places=6)
        self.assertLess(final_equity(haircut), final_equity(result))

    def test_e4_unresolved_jump_is_real_in_a_and_neutralized_in_b(self):
        close = wave(10)
        item = series("PUMPUSDT", lambda d: close(d) * (12 if d >= START + 30 else 1))
        m, result_a = one_symbol(item)
        result_b = rs.simulate(m, rs.SimSpec("XS", "WEEKLY", reading="B"))
        self.assertGreater(final_equity(result_a), 8 * rs.FROZEN.slot)
        self.assertLess(final_equity(result_b), 1.5 * rs.FROZEN.slot)
        instrument = m.instruments[next(iter(m.instruments))]
        self.assertEqual(instrument.jumps[0][0], START + 30)
        # The jump happens during the day: in reading B the open of the jump day stays in the old units.
        self.assertAlmostEqual(instrument.open(START + 30, "B"), item.candles[START + 30][0])
        factor = item.candles[START + 30][3] / item.candles[START + 29][3]  # the measured close-to-close jump
        self.assertAlmostEqual(instrument.close(START + 30, "B"), item.candles[START + 29][3], places=9)
        self.assertAlmostEqual(instrument.open(START + 31, "B"), item.candles[START + 31][0] / factor, places=9)

    def test_e4_documented_redenomination_converts_without_gain_or_loss(self):
        close = wave(500)
        item = series("SPLITUSDT", lambda d: close(d) / (1000 if d >= START + 30 else 1))
        m, result = one_symbol(item, evidence_list=[evidence("SPLITUSDT", "REDENOMINATION", START + 30, ratio=1000)])
        before = result.daily[28][1]
        after = result.daily[30][1]
        self.assertAlmostEqual(after / before, close(START + 30) / close(START + 28), places=2)
        self.assertTrue(any(event["kind"] == "E4-Umstellung" for event in result.events))

    def test_e4_data_error_from_d12_removes_the_candle(self):
        item = series("ERRUSDT", wave(4))
        instruments, cases = rs.build_instruments({"ERRUSDT": item}, [], {"ERRUSDT": {START + 30}}, CFG)
        instrument = next(iter(instruments.values()))
        self.assertIsNone(instrument.candle(START + 30))
        self.assertTrue(any(case.kind == "E4" and case.documented for case in cases))

    def test_e5_exit_at_the_first_open_after_the_publication(self):
        item = series("DLXUSDT", wave(5), last=START + 60)
        published = rs.day_text(START + 40)
        m, result = one_symbol(item, evidence_list=[evidence("DLXUSDT", "DELISTING", START + 60, published)])
        exit_trade = trades(result, "E5")[0]
        self.assertEqual((exit_trade["day"], exit_trade["tier"]), (START + 41, "L3"))
        late = rs.Evidence("DLXUSDT", "DELISTING", START + 60, START + 61, "u")
        m2, result2 = one_symbol(item, evidence_list=[late])
        self.assertEqual(trades(result2, "E5"), [])  # no window: E7, frozen without a sale
        self.assertTrue(any(str(e["kind"]).startswith("E7") for e in result2.events))

    def test_e6_migration_without_window_converts_at_the_successor(self):
        old = series("OLDUSDT", wave(0.01), last=START + 40)
        new = series("NEWUSDT", wave(10), first=START + 44)
        m, _ = market([old, new], evidence=[evidence("OLDUSDT", "MIGRATION", START + 40, rs.day_text(START + 40), "NEWUSDT", 0.001)])
        result = rs.simulate(m, rs.SimSpec("XS", "WEEKLY"))
        exit_trade = trades(result, "E6")[0]
        self.assertEqual(exit_trade["day"], START + 44)
        quantity = result.daily[0][2] / old.candles[START][3]
        self.assertAlmostEqual(exit_trade["notional"], quantity * 0.001 * new.candles[START + 44][0], places=6)

    def test_e7_is_frozen_in_a_zero_in_b_and_in_the_stress(self):
        item = series("DEADUSDT", wave(5), last=START + 40)
        m, result_a = one_symbol(item)
        result_b = rs.simulate(m, rs.SimSpec("XS", "WEEKLY", reading="B"))
        stress = rs.simulate(m, rs.SimSpec("XS", "WEEKLY", delisting_stress=True))
        quantity = result_a.daily[0][2] / item.candles[START][3]
        self.assertAlmostEqual(final_equity(result_a), quantity * item.candles[START + 40][3], places=6)
        self.assertAlmostEqual(final_equity(result_b), 0.0, places=9)
        self.assertAlmostEqual(final_equity(stress), 0.0, places=9)
        self.assertEqual(trades(result_a, side="SELL"), [])  # a valuation, never a sale

    def test_e7_long_gap_reopening_ten_times_higher_is_unresolved(self):
        close = wave(1)
        item = series("LUNAUSDT", lambda d: close(d) * (5000 if d >= START + 39 else 1), skip=set(range(START + 30, START + 40)))
        instruments, _ = rs.build_instruments({"LUNAUSDT": item}, [], {}, CFG)
        first = min(instruments.values(), key=lambda i: i.start)
        self.assertEqual((first.end_rule.kind, first.end_rule.reason), ("E7", "LONG_GAP_REOPEN_JUMP"))

    def test_m28_control_books_events_at_the_last_close(self):
        dead = series("DEADUSDT", wave(5), last=START + 40)
        alive = series("LIVEUSDT", wave(7))
        m, _ = market([dead, alive])
        favorable = rs.simulate(m, rs.SimSpec("CONTROL", "WEEKLY", favorable_events=True))
        sale = trades(favorable, "M28-Schluss")[0]
        self.assertEqual(sale["day"], START + 40)


# --- Data checks (D0-D12) ---------------------------------------------------------------


def write_zip(path: Path, rows: list[str], header: bool = False) -> None:
    rs._write_zip(path, path.name.replace(".zip", ".csv"), "\n".join(([rs.KLINE_HEADER] if header else []) + rows) + "\n")


class DataChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def month_rows(self, month: str, micro: bool = False, drop=()):
        return [rs.kline_line(day, (10.0, 10.5, 9.5, 10.2, 1e7, 100), micro) for day in rs.month_days(month) if day not in drop]

    def test_d1_d2_e1_microseconds_header_defects_and_fill(self):
        listing = {"symbols": {"ABCUSDT": ["2025-01", "2025-02"], "BTCUSDT": ["2025-01"]}}
        cfg = replace(CFG, prelude_start=rs.day_of("2025-01-01"), window_start=rs.day_of("2025-01-01"), window_end=rs.day_of("2025-03-01"))
        missing_day = rs.day_of("2025-02-10")
        rows = self.month_rows("2025-02", micro=True, drop={missing_day})
        rows.append(rows[-1].replace(",10.50000000,", ",1.00000000,"))  # high below close: a D2 defect (and unsorted)
        write_zip(rs.monthly_path(self.tmp, "ABCUSDT", "2025-01"), self.month_rows("2025-01"), header=True)
        write_zip(rs.monthly_path(self.tmp, "ABCUSDT", "2025-02"), rows)
        write_zip(rs.daily_path(self.tmp, "ABCUSDT", missing_day), [rs.kline_line(missing_day, (10.0, 10.5, 9.5, 10.2, 1e7, 100))])
        btc = rs.monthly_path(self.tmp, "BTCUSDT", "2025-01")
        write_zip(btc, self.month_rows("2025-01"))
        btc.with_name(btc.name + ".CHECKSUM").write_text("0" * 64 + "  x\n")  # D1 mismatch on a key symbol
        loaded, report = rs.load_archive(self.tmp, listing, cfg)
        self.assertEqual(report["D1"]["missingOrMismatched"], 1)
        self.assertFalse(report["D1"]["passed"])
        self.assertEqual(report["D2"]["defects"], 1)
        self.assertIn(missing_day, loaded["ABCUSDT"].candles)
        self.assertEqual(report["D10"]["filledDays"], 1)
        self.assertEqual(len(loaded["ABCUSDT"].candles), 59)

    def test_forward_data_is_refused(self):
        path = self.tmp / "x.zip"
        write_zip(path, [rs.kline_line(rs.day_of("2026-10-20"), (1, 1, 1, 1, 1, 1))])
        with self.assertRaises(rs.StudyError):
            rs.parse_kline_file(path, CFG)

    def test_d12_detects_a_contradicting_daily_file(self):
        day = START + 30
        close = wave(4)
        item = series("ERRUSDT", lambda d: close(d) * (15 if d == day else 1))
        write_zip(rs.daily_path(self.tmp, "ERRUSDT", day), [rs.kline_line(day, (4.0, 4.1, 3.9, 4.05, 1e8, 10))])
        errors, report = rs.check_jump_days(self.tmp, {"ERRUSDT": item}, CFG)
        self.assertEqual(errors["ERRUSDT"], {day})
        self.assertIn(f"ERRUSDT {rs.day_text(day + 1)}", report["unverifiable"])

    def test_d3_requires_complete_btc_and_eth(self):
        btc = series("BTCUSDT", wave(30000), skip={START + 10})
        eth = series("ETHUSDT", wave(2000))
        report = rs.check_gaps({"BTCUSDT": btc, "ETHUSDT": eth}, CFG)
        self.assertFalse(report["passed"])
        self.assertTrue(report["keySymbolsMissing"])
        report = rs.check_gaps({"BTCUSDT": series("BTCUSDT", wave(30000)), "ETHUSDT": eth}, CFG)
        self.assertTrue(report["passed"])
        halted = series("HALTUSDT", wave(3), skip=set(range(START + 10, START + 20)))
        report = rs.check_gaps({"BTCUSDT": series("BTCUSDT", wave(30000)), "ETHUSDT": eth, "HALTUSDT": halted}, CFG)
        self.assertEqual(report["missingSymbolDays"], 0)  # a long gap is no trading time ...
        self.assertEqual(report["longGaps"], [{"symbol": "HALTUSDT", "from": rs.day_text(START + 10), "to": rs.day_text(START + 19), "days": 10}])
        self.assertTrue(report["passed"])  # ... but it is listed, never silent

    def test_long_gaps_of_members_need_the_hourly_archive_check(self):
        gap = rs.EventCase("E3", "LONGUSDT", "LONGUSDT#1", rs.day_of("2021-06-30"), False, {"resumes": "2021-07-21"})
        paused = rs.EventCase("E3", "PAUSEUSDT", "PAUSEUSDT#1", rs.day_of("2021-06-30"), True, {"resumes": "2021-07-21"})
        members = {"LONGUSDT#1", "PAUSEUSDT#1"}
        review = rs.long_gap_review([gap, paused], members, None)
        self.assertEqual(review["unchecked"], [{"symbol": "LONGUSDT", "from": "2021-07-01", "to": "2021-07-20"}])  # documented pause exempt
        self.assertTrue(review["halt"])
        checked = {"gaps": [{"symbol": "LONGUSDT", "from": "2021-07-01", "verdict": "suspected", "hourlyDaysInGap": ["2021-07-03"]}]}
        review = rs.long_gap_review([gap], members, checked)
        self.assertEqual(len(review["suspectedArchiveErrors"]), 1)
        self.assertTrue(review["halt"])  # hourly files inside the gap: not booked as a pause without the operator
        checked["gaps"][0]["verdict"] = "consistent"
        self.assertFalse(rs.long_gap_review([gap], members, checked)["halt"])
        self.assertFalse(rs.long_gap_review([gap], set(), None)["halt"])  # never a universe member: no requirement

    def test_d0_d0b_d0c_frozen_reading(self):
        original, rs.APPROVED_PRECISIONS = rs.APPROVED_PRECISIONS, ()  # the V1 rules, kept as 'v1' next to P7
        try:
            (self.tmp / "listing").mkdir()
            symbols = {symbol: [f"{year}-01"] for symbol, year in rs.D0_CONTROL.items()}
            symbols.update({f"D{year}USDT": [f"{year}-0{m}" for m in range(1, 4)] for year in rs.D0B_YEARS})
            (self.tmp / "listing" / "spot-monthly-klines-1d.json").write_text(json.dumps({"symbols": symbols}))
            years = {str(year): [{"url": "u", "published": f"{year}-0{k}-01", "tradingEnd": f"{year}-04-01", "pairs": [f"D{year}USDT"]} for k in (1, 2, 3)]
                     for year in rs.D0B_YEARS}
            (self.tmp / "listing" / "announcements-d0b.json").write_text(json.dumps({"years": years}))
            (self.tmp / "listing" / "exchangeInfo.json").write_text(json.dumps({"symbols": [{"symbol": "GONEUSDT", "quoteAsset": "USDT", "status": "BREAK"}]}))
            report = rs.check_listing(self.tmp, CFG)
            self.assertEqual(report["halts"], [])
            self.assertEqual(report["D0c"]["absentFromArchive"], ["GONEUSDT"])
            years["2022"][0]["pairs"].append("NOTINARCHIVEUSDT")
            (self.tmp / "listing" / "announcements-d0b.json").write_text(json.dumps({"years": years}))
            self.assertEqual(rs.check_listing(self.tmp, CFG)["halts"], ["D0b"])  # 1 of 2 found in 2022: below 90 %
            del symbols["LUNAUSDT"]
            (self.tmp / "listing" / "spot-monthly-klines-1d.json").write_text(json.dumps({"symbols": symbols}))
            self.assertIn("D0", rs.check_listing(self.tmp, CFG)["halts"])
            (self.tmp / "listing" / "announcements-d0b.json").write_text(json.dumps({"years": years, "neverListed": [{"symbol": "LUNAUSDT", "url": "u"}]}))
            self.assertNotIn("D0", rs.check_listing(self.tmp, CFG)["halts"])
            (self.tmp / "listing" / "announcements-d0b.json").write_text(json.dumps({"years": {}}))
            report = rs.check_listing(self.tmp, CFG)
            self.assertFalse(report["D0b"]["performable"])
            self.assertIn("D0b", report["halts"])
        finally:
            rs.APPROVED_PRECISIONS = original

    def test_d0b_under_the_approved_precision_p7(self):
        (self.tmp / "listing").mkdir()
        symbols = {symbol: [f"{year}-01"] for symbol, year in rs.D0_CONTROL.items()}
        symbols.update({f"D{year}USDT": [f"{year}-0{m}" for m in range(1, 4)] for year in rs.D0B_YEARS})
        (self.tmp / "listing" / "spot-monthly-klines-1d.json").write_text(json.dumps({"symbols": symbols}))
        v1 = {str(year): [{"url": "u", "published": f"{year}-0{k}-01", "tradingEnd": f"{year}-04-01", "pairs": [f"D{year}USDT"]} for k in (1, 2, 3)]
              for year in rs.D0B_YEARS}
        v1["2025"] = v1["2025"][:2]  # the frozen reading finds only two announcements in 2025
        (self.tmp / "listing" / "announcements-d0b.json").write_text(json.dumps({"years": v1}))
        p7 = {"years": {**v1, "2025": v1["2025"] + [{"url": "u", "published": "2025-03-01", "tradingEnd": "2025-04-01",
                                                      "pairs": ["D2025USDT"], "kind": "token"}]}}
        (self.tmp / "listing" / "announcements-d0b-p7.json").write_text(json.dumps(p7))
        self.assertEqual(rs.APPROVED_PRECISIONS, ("P7",))  # approved 2026-10-17
        original = rs.APPROVED_PRECISIONS
        try:
            rs.APPROVED_PRECISIONS = ()
            self.assertIn("D0b", rs.check_listing(self.tmp, CFG)["halts"])  # without P7 the frozen reading halts
            rs.APPROVED_PRECISIONS = ("P7",)
            report = rs.check_listing(self.tmp, CFG)
            self.assertEqual(report["halts"], [])
            self.assertEqual(report["D0b"]["precision"], "P7")
            self.assertFalse(report["D0b"]["v1"]["performable"])  # the frozen reading stays visible
            p7["years"]["2021"][0]["pairs"].append("NOTINARCHIVEUSDT")
            (self.tmp / "listing" / "announcements-d0b-p7.json").write_text(json.dumps(p7))
            report = rs.check_listing(self.tmp, CFG)
            self.assertEqual(report["D0b"]["years"]["2021"]["missing"], ["NOTINARCHIVEUSDT"])
            self.assertIn("D0b", report["halts"])  # re-checked against the listing: 3 of 4 found, below 90 %
        finally:
            rs.APPROVED_PRECISIONS = original


# --- Statistics and classes (§10) -------------------------------------------------------


class Statistics(unittest.TestCase):
    def test_threshold_is_two_point_eight_four(self):
        self.assertAlmostEqual(rs.multiple_test_threshold(rs.FROZEN, 81, 1), math.sqrt(2 * math.log(57)), places=12)
        self.assertAlmostEqual(rs.multiple_test_threshold(rs.FROZEN, 81, 2), 2.8436, places=4)

    def test_spanning_alpha_recovers_alpha_and_refuses_a_copy(self):
        months = [f"2020-{m:02d}" for m in range(1, 13)] + [f"2021-{m:02d}" for m in range(1, 13)] + [f"2022-{m:02d}" for m in range(1, 13)]
        factor = {m: 0.03 * math.sin(i) for i, m in enumerate(months)}
        candidate = {m: 0.01 + 1.5 * factor[m] + 0.002 * math.cos(3 * i) for i, m in enumerate(months)}
        result = rs.spanning_alpha(candidate, [factor], months)
        self.assertAlmostEqual(result["alpha"], 0.01, places=3)
        self.assertAlmostEqual(result["betas"][0], 1.5, places=2)
        self.assertGreater(result["tStat"], 10)
        self.assertIsNone(rs.spanning_alpha(factor, [factor], months)["tStat"])

    def test_monthly_returns_cagr_and_drawdown(self):
        curve = [(rs.day_of("2020-01-31"), 110.0), (rs.day_of("2020-02-29"), 99.0)]
        self.assertEqual(rs.monthly_returns(curve, 100.0), {"2020-01": 0.10000000000000009, "2020-02": -0.09999999999999998})
        self.assertAlmostEqual(rs.cagr(100, 121, 730), 1.21 ** (365.25 / 730) - 1)
        self.assertAlmostEqual(rs.max_drawdown([110, 99, 120], 100), 0.1)


def criteria(**overrides):
    base = {"B1": True, "B2": True, "B3": True, "B4": True, "B5": True, "B6": True, "B3withoutSince2024": True, "B5withoutSince2024": True,
            "since2024AlphaPositive": {"B3": True, "B5": True}, "metrics": {"variant": {"netPerYear": 0.1, "maxDrawdown": 0.3}}}
    base.update(overrides)
    return base


class Classes(unittest.TestCase):
    def test_selection_rule_prefers_b(self):
        a = criteria(metrics={"variant": {"netPerYear": 0.105, "maxDrawdown": 0.3}})
        b = criteria(metrics={"variant": {"netPerYear": 0.10, "maxDrawdown": 0.3}})
        self.assertEqual(rs.classify({"A": a, "B": b}, False, "VERFUEGBAR", rs.FROZEN)["selectedVariant"], "B")
        a = criteria(metrics={"variant": {"netPerYear": 0.11, "maxDrawdown": 0.3}})
        self.assertEqual(rs.classify({"A": a, "B": b}, False, "VERFUEGBAR", rs.FROZEN)["selectedVariant"], "A")
        self.assertEqual(rs.classify({"A": a, "B": b}, False, "OFFEN", rs.FROZEN)["outcome"], "AUSSTEHEND_PHASE_1B")
        self.assertEqual(rs.classify({"A": a, "B": b}, False, "NICHT_VERFUEGBAR", rs.FROZEN)["outcome"], "BESTANDEN_REFERENZ")

    def test_compressed_and_nur_beta(self):
        compressed = criteria(B2=False)
        failing = criteria(B3=False, B3withoutSince2024=False)
        self.assertEqual(rs.classify({"A": compressed, "B": failing}, False, "OFFEN", rs.FROZEN)["outcome"], "KOMPRIMIERT")
        since = criteria(B3=False, since2024AlphaPositive={"B3": False, "B5": True})
        self.assertEqual(rs.classify({"A": since, "B": failing}, False, "OFFEN", rs.FROZEN)["outcome"], "KOMPRIMIERT")
        result = rs.classify({"A": failing, "B": failing}, True, "OFFEN", rs.FROZEN)
        self.assertEqual((result["outcome"], result["subclass"]), ("NICHT_BESTANDEN", "NUR_BETA"))
        self.assertIsNone(rs.classify({"A": failing, "B": failing}, False, "OFFEN", rs.FROZEN)["subclass"])

    def test_determinability(self):
        positive, negative = {"outcome": "AUSSTEHEND_PHASE_1B"}, {"outcome": "NICHT_BESTANDEN", "subclass": None}
        self.assertEqual(rs.determinability(positive, negative, [])["outcome"], "NICHT_BESTIMMBAR")
        self.assertEqual(rs.determinability(negative, positive, [])["outcome"], "NICHT_BESTIMMBAR")
        self.assertEqual(rs.determinability(positive, positive, ["D0b"])["outcome"], "NICHT_BESTIMMBAR")
        self.assertEqual(rs.determinability(positive, positive, ["D11"])["outcome"], "AUSSTEHEND_PHASE_1B")
        self.assertEqual(rs.determinability(negative, {"outcome": "KOMPRIMIERT"}, [])["outcome"], "NICHT_BESTANDEN")


# --- Guard, preregistration, end to end ---------------------------------------------------


def run_args(**overrides):
    values = {"real": False, "confirm": None, "random_portfolios": 2, "correction": None}
    values.update(overrides)
    return argparse.Namespace(**values)


class Guard(unittest.TestCase):
    def test_preregistration_matches_the_frozen_blob_and_detects_changes(self):
        self.assertTrue(rs.verify_preregistration()["verified"])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / rs.PREREGISTRATION["path"]
            target.parent.mkdir(parents=True)
            text = (rs.REPO_ROOT / rs.PREREGISTRATION["path"]).read_text(encoding="utf-8")
            target.write_text(text.replace("N = 10", "N = 12", 1), encoding="utf-8")
            with self.assertRaises(rs.StudyError):
                rs.verify_preregistration(root)

    def test_real_run_needs_confirmation_canonical_paths_real_data_and_frozen_config(self):
        with tempfile.TemporaryDirectory() as directory:
            data, out = Path(directory) / "data", Path(directory) / "out"
            data.mkdir()
            with self.assertRaisesRegex(rs.StudyError, "--confirm"):
                rs.guard_run(run_args(real=True), data, out, rs.FROZEN)
            (data / "SYNTHETIC").write_text("x")
            with self.assertRaisesRegex(rs.StudyError, "SYNTHETIC"):
                rs.guard_run(run_args(real=True, confirm=rs.STUDY_KEY, random_portfolios=None), data, out, rs.FROZEN)
            (data / "SYNTHETIC").unlink()
            with self.assertRaisesRegex(rs.StudyError, "frozen configuration"):
                rs.guard_run(run_args(real=True, confirm=rs.STUDY_KEY), data, out, rs.FROZEN)
            with self.assertRaisesRegex(rs.StudyError, "canonical|reads"):
                rs.guard_run(run_args(real=True, confirm=rs.STUDY_KEY, random_portfolios=None), data, out, rs.FROZEN)
            with self.assertRaisesRegex(rs.StudyError, "SYNTHETIC"):
                rs.guard_run(run_args(), data, out, rs.FROZEN)  # without --real only synthetic data
            self.assertFalse(out.exists())


class EndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.data = cls.tmp / "synth"
        rs.generate_synthetic(cls.data, seed=11)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def evaluate(self, data: Path, out: Path, accept=(), correction=None):
        cfg = replace(rs.FROZEN, random_portfolios=2)
        guard = rs.guard_run(run_args(correction=correction), data, out, cfg)
        return rs.evaluate(data, out, data / "spot", cfg, guard, "OFFEN", list(accept), correction)

    def test_checks_run_and_cases_are_classified(self):
        report, market, cases = rs.prepare(self.data, self.data / "spot", rs.FROZEN, True)
        self.assertTrue(report["blockingPassed"], report["blocking"])
        self.assertEqual(report["halts"], [])
        kinds = {(case.symbol, case.kind) for case in cases}
        for expected in (("HALTUSDT", "E2"), ("LONGUSDT", "E3"), ("PUMPUSDT", "E4"), ("SPLITUSDT", "E4"), ("XMRUSDT", "E5"),
                         ("MATICUSDT", "E6W"), ("ERDUSDT", "E6C"), ("LUNAUSDT", "E7")):
            self.assertIn(expected, kinds)
        self.assertEqual(report["D12"]["dataErrors"], 1)
        self.assertEqual(report["D10"]["filledDays"], 2)
        self.assertEqual(report["D5"]["excluded"], {"ALT00UPUSDT": "X4", "BULLUSDT": "X4", "PAXGUSDT": "X3", "USDCUSDT": "X1"})
        self.assertFalse(report["D9"]["halt"])
        self.assertEqual(report["D11"]["share"], 1.0)

    def test_one_run_then_locked_and_n_unchanged_for_synthetic_data(self):
        out = self.tmp / "eval"
        report = self.evaluate(self.data, out)
        self.assertIn(report["outcome"], ("BESTANDEN", "BESTANDEN_REFERENZ", "AUSSTEHEND_PHASE_1B", "KOMPRIMIERT", "NICHT_BESTANDEN", "NICHT_BESTIMMBAR"))
        self.assertEqual(report["multipleTest"], {"before": 55, "after": 55, "countsForN": False, "thresholdN": 57})
        self.assertEqual(set(report["criteria"]), {"A", "B"})
        for reading in ("A", "B"):
            for variant in ("A", "B"):
                self.assertEqual(set(k for k in report["criteria"][reading][variant] if k.startswith("B") and len(k) == 2),
                                 {"B1", "B2", "B3", "B4", "B5", "B6"})
        extra = report["report"]
        for key in ("fairness", "scenarioS2", "benchmarksS1", "benchmarksS2", "equalRisk", "m29E3Haircut", "readingB", "signalIc", "unresolvedCases"):
            self.assertIn(key, extra)
        self.assertGreater(extra["series"]["A"]["trades"]["trades"], 100)
        self.assertEqual(set(report["b3cSharpeDefinitionCheck"]), {"A", "B"})
        self.assertIn("dependsOnSharpeDefinition", report["b3cSharpeDefinitionCheck"]["A"])
        self.assertEqual(set(extra["series"]["A"]["buysOnLastTradingDay"]), {"count", "notional", "symbols"})
        for reading in ("A", "B"):  # 1.0.1: the S1 metrics behind the criteria are stored, consistent with B4
            for variant in ("A", "B"):
                metrics = report["metricsS1"][reading][variant]
                self.assertEqual(set(metrics), {"variant", "control", "reference"})
                for key in ("sharpeMonthly", "sharpeDaily", "calendarYears", "netPerYearSince2024", "monthlyReturns", "finalEquity"):
                    self.assertIn(key, metrics["variant"])
                b4 = report["criteria"][reading][variant]["details"]["B4"]
                self.assertEqual(b4["maxDrawdown"], [metrics["variant"]["maxDrawdown"], metrics["control"]["maxDrawdown"]])
                self.assertAlmostEqual(b4["calmar"][0] * metrics["variant"]["maxDrawdown"], metrics["variant"]["netPerYear"], places=12)
        self.assertTrue((out / "results.json").exists() and (out / "results.md").exists() and (out / "RUN.lock").exists())
        with self.assertRaisesRegex(rs.StudyError, "already run once"):
            self.evaluate(self.data, out)
        corrected = self.evaluate(self.data, out, correction="Testkorrektur")
        self.assertEqual(corrected["correction"], "Testkorrektur")
        with self.assertRaisesRegex(rs.StudyError, "one corrected run"):
            self.evaluate(self.data, out, correction="zweite")
        with self.assertRaisesRegex(rs.StudyError, "first run"):
            self.evaluate(self.data, self.tmp / "other", correction="ohne Erstlauf")

    def test_without_the_gap_check_plan_works_and_d11_asks_for_it(self):
        data = self.tmp / "no-gap-check"
        shutil.copytree(self.data, data)
        (data / "events" / "long-gap-check.json").unlink()
        report, market, _ = rs.prepare(data, data / "spot", rs.FROZEN, True)
        self.assertIsNotNone(market)
        self.assertTrue(report["D11"]["halt"])
        self.assertIn("D11", report["halts"])
        with redirect_stdout(io.StringIO()) as out:
            rs.main(["plan", "--data", str(data), "--spot", str(data / "spot")])
        self.assertIn("LONGUSDT", {gap["symbol"] for gap in json.loads(out.getvalue())["longGapsToCheck"]})

    def test_a_halt_stops_until_accepted_and_releases_the_lock(self):
        data = self.tmp / "halt"
        shutil.copytree(self.data, data)
        for name in ("announcements-d0b.json", "announcements-d0b-p7.json"):  # P7 governs D0b, V1 stays consistent
            path = data / "listing" / name
            document = json.loads(path.read_text())
            document["years"]["2023"][0]["pairs"] = ["MISSINGUSDT"]
            path.write_text(json.dumps(document))
        out = self.tmp / "halt-eval"
        with self.assertRaises(rs.HaltError):
            self.evaluate(data, out)
        self.assertFalse((out / "RUN.lock").exists())
        report = self.evaluate(data, out, accept=["D0b"])
        self.assertEqual(report["acceptedHalts"], ["D0b"])
        self.assertNotIn(report["outcome"], ("BESTANDEN", "BESTANDEN_REFERENZ", "AUSSTEHEND_PHASE_1B"))

    def test_a_missing_input_before_any_return_releases_the_lock(self):
        data = self.tmp / "broken"
        shutil.copytree(self.data, data)
        (data / "fred" / "DTB3.csv").unlink()
        out = self.tmp / "broken-eval"
        with self.assertRaises(rs.StudyError):
            self.evaluate(data, out)
        self.assertFalse((out / "RUN.lock").exists())

    def test_report_covers_m4_m6_m7_m11(self):
        out = self.tmp / "metrics"
        report = self.evaluate(self.data, out)
        extra = report["report"]
        self.assertEqual(set(extra["selectionExtremes"]["A"]), {"worstMonth", "worstWeek", "spearmanChallenger", "pearsonChampion"})
        self.assertIn("costsByYear", extra["series"]["A"]["trades"])
        metrics = report["criteria"]["A"]["A"]["details"]["B4"]
        self.assertEqual(len(metrics["maxDrawdown"]), 2)

    def test_n_rises_to_57_only_after_a_real_return_calculation(self):
        guard = {"synthetic": False, "configHash": "x", "resultName": "results"}
        out = self.tmp / "nreal"
        out.mkdir()
        report = rs.evaluate(self.data, out, self.data / "spot", replace(rs.FROZEN, random_portfolios=1), guard)
        self.assertEqual(report["outcome"], "NICHT_AUSWERTBAR")  # synthetic regime counts are not the frozen D7 counts
        self.assertFalse(report["dataChecks"]["D7"]["passed"])
        self.assertEqual((report["multipleTest"]["after"], report["multipleTest"]["countsForN"]), (55, False))
        frozen_counts = rs.REGIME_COUNTS
        rs.REGIME_COUNTS = json.loads((self.data / "synthetic.json").read_text())["regimeCounts"]
        try:
            out2 = self.tmp / "nreal2"
            out2.mkdir()
            report = rs.evaluate(self.data, out2, self.data / "spot", replace(rs.FROZEN, random_portfolios=1), guard)
        finally:
            rs.REGIME_COUNTS = frozen_counts
        self.assertNotEqual(report["outcome"], "NICHT_AUSWERTBAR")
        self.assertEqual((report["multipleTest"]["after"], report["multipleTest"]["countsForN"]), (57, True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
