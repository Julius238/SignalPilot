#!/usr/bin/env python3
"""Tests of funding_carry_v2.py on synthetic data only (V2 step 1.1).

The V1 tests are kept unchanged (V2 adopts V1); the V2 tests below them cover the
filling of days missing entirely from the monthly archive and the downloader.
Run with ``python3 -I scripts/research/funding-carry-v2/test_funding_carry_v2.py``.
The module is loaded by path, so ``-I`` keeps the current directory out of sys.path.
"""

from __future__ import annotations

import gzip
import importlib.util
import io
import json
import math
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("funding_carry_v2", Path(__file__).with_name("funding_carry_v2.py"))
fc = importlib.util.module_from_spec(_SPEC)
sys.modules["funding_carry_v2"] = fc
_SPEC.loader.exec_module(fc)

HOUR, DAY = fc.HOUR, fc.DAY
START = fc.WINDOW_START


def flat_bars(hours: int, price: float = 100.0, start: int = START) -> dict:
    return {start + k * HOUR: (price, price, price, price) for k in range(hours)}


def market(hours: int, funding: list[tuple[int, float]] | None = None, spot=None, perp=None, mark=None) -> "fc.Market":
    return fc.Market("TEST", START, START + hours * HOUR, spot or flat_bars(hours), perp or flat_bars(hours), mark or flat_bars(hours), sorted(funding or []))


def every_8h(first: int, last: int, rate: float) -> list[tuple[int, float]]:
    return [(slot, rate) for slot in range(first, last, 8 * HOUR)]


class FundingAssignment(unittest.TestCase):
    def test_entry_at_slot_does_not_receive_that_settlement(self):
        # Entry at 00:00 of day 0; settlements every 8 h from day 0 to the end of day 1.
        result = fc.simulate(market(48, every_8h(START, START + 48 * HOUR, 0.0001)), fc.RunConfig("A"))
        received = sum(result.funding_by_day.values())
        quantity = 10_000 / 2 / 100  # costs are paid from the collateral, not from the hedge size
        self.assertAlmostEqual(received, 5 * 0.0001 * quantity * 100, places=9)  # 08, 16, 24, 32, 40 h; not 00 h

    def test_exit_at_slot_still_carries_that_settlement(self):
        warmup = every_8h(START - 7 * DAY, START, 0.0001)
        events = warmup + [(START + 8 * HOUR, 0.0001), (START + 16 * HOUR, -0.01), (START + 24 * HOUR, 0.0001), (START + 32 * HOUR, 0.0001)]
        result = fc.simulate(market(48, events), fc.RunConfig("B"))
        self.assertEqual((result.entries, result.exits), (1, 1))
        received = sum(result.funding_by_day.values())
        self.assertAlmostEqual(received, (0.0001 - 0.01 + 0.0001) * 50 * 100, places=9)  # 08, 16, 24 h; flat at 32 h


class LookAhead(unittest.TestCase):
    def test_settlement_at_decision_time_is_not_in_s7(self):
        warmup = every_8h(START - 7 * DAY, START, 0.0001)
        shock = [(START + DAY, -0.05)]  # exactly at the second decision
        result = fc.simulate(market(3 * 24, warmup + shock), fc.RunConfig("B"))
        # Decision at START + 1 day does not see the shock and keeps the position; the next one exits.
        exit_day = [day for day, cost in result.costs_by_day.items() if cost > 0]
        self.assertEqual(exit_day, [fc.day_key(START), fc.day_key(START + 2 * DAY)])
        # The shock was paid: the position was open at the settlement.
        self.assertLess(sum(result.funding_by_day.values()), 0)

    def test_forward_timestamps_are_refused(self):
        with self.assertRaises(fc.ForwardDataError):
            fc.normalize_timestamp(fc.FORWARD_CUTOFF)
        self.assertEqual(fc.normalize_timestamp(str(START * 1000)), START)  # microseconds


class Costs(unittest.TestCase):
    def test_round_trip_of_both_legs_is_46_bp_of_the_notional(self):
        result = fc.simulate(market(24), fc.RunConfig("A"))
        self.assertAlmostEqual(result.final_equity, 10_000 - 5_000 * 0.0046, places=9)
        self.assertAlmostEqual(fc.SPOT_COST.per_side(), 0.0014)
        self.assertAlmostEqual(fc.PERP_TAKER_COST.per_side(), 0.0009)

    def test_cost_stress_doubles_execution_costs(self):
        result = fc.simulate(market(24), fc.RunConfig("A", cost_multiplier=2.0))
        self.assertAlmostEqual(result.final_equity, 10_000 - 5_000 * 0.0092, places=9)


class Rebalancing(unittest.TestCase):
    def _jump(self, factor: float) -> "fc.SleeveResult":
        hours = 24
        bars = flat_bars(hours)
        for k in range(10, hours):
            price = 100 * factor
            bars[START + k * HOUR] = (price, price, price, price)
        bars[START + 9 * HOUR] = (100.0, 100 * factor, 100.0, 100 * factor)
        return fc.simulate(market(hours, spot=dict(bars), perp=dict(bars), mark=dict(bars)), fc.RunConfig("A"))

    def test_rebalance_after_a_close_beyond_the_band(self):
        result = self._jump(1.25)
        self.assertEqual(result.rebalances, 1)
        self.assertAlmostEqual(result.max_leverage, 1.25 / 0.75, delta=0.01)  # (1 + x) ÷ (1 − x), costs aside

    def test_no_rebalance_inside_the_band(self):
        self.assertEqual(self._jump(1.19).rebalances, 0)


class Liquidation(unittest.TestCase):
    def test_liquidation_on_the_mark_high_loses_the_collateral(self):
        hours = 30
        mark = flat_bars(hours)
        mark[START + 5 * HOUR] = (100.0, 300.0, 100.0, 100.0)
        result = fc.simulate(market(hours, mark=mark), fc.RunConfig("A"))
        self.assertEqual(len(result.liquidations), 1)
        # Spot leg (5 000) survives, collateral (5 000 − 11.5 costs) is gone; next day the hedge is rebuilt.
        self.assertEqual(result.rehedges, 1)
        self.assertLess(result.final_equity, 5_100)


class Legging(unittest.TestCase):
    def test_second_leg_one_hour_later_costs_the_hourly_move(self):
        spot = flat_bars(3)
        spot[START + HOUR] = (101.0, 101.0, 101.0, 101.0)
        spot[START + 2 * HOUR] = (101.0, 101.0, 101.0, 101.0)
        base = fc.simulate(market(3, spot=spot), fc.RunConfig("A"))
        stressed = fc.simulate(market(3, spot=spot), fc.RunConfig("A", legging=True))
        self.assertAlmostEqual(stressed.max_legging_loss, 50 * 1.0, places=9)
        self.assertAlmostEqual(base.final_equity - stressed.final_equity, 50.0, places=6)


class Statistics(unittest.TestCase):
    """Expected values computed with packages/evolution/src/paired.ts (spanningAlphaTest, studentT975)."""

    @staticmethod
    def series():
        months = fc.months_between("2020-01", "2026-09")
        f1 = [0.01 * math.sin(0.7 * k) + 0.002 * math.cos(1.3 * k) for k in range(len(months))]
        f2 = [0.008 * math.cos(0.5 * k + 1) for k in range(len(months))]
        y = [0.004 + 0.2 * a - 0.1 * b + 0.003 * math.sin(2.1 * k + 0.3) for k, (a, b) in enumerate(zip(f1, f2))]
        return months, dict(zip(months, y)), dict(zip(months, f1)), dict(zip(months, f2))

    def test_spanning_alpha_matches_typescript(self):
        months, y, f1, f2 = self.series()
        expected = {
            "full": (months, 0.003996795556789398, 0.00023994038005256503, 0.00011949470551950383, 16.657452805208518, 1.9908470685550521, [0.20098338015087602, -0.09265173850097266]),
            "first": ([m for m in months if m < "2024-01"], 0.003995899012911387, 0.00031698356321456023, 0.00015711017226905158, 12.606013297309797, 2.0141033848332923, [0.19313565699947374, -0.1026952984107708]),
            "later": ([m for m in months if m >= "2024-01"], 0.004003379294807348, 0.0003864054257350947, 0.00018934115678466456, 10.360566980112536, 2.042272425276678, [0.21244499340073428, -0.07859528404675636]),
        }
        for name, (subset, alpha, se, hac, t, critical, betas) in expected.items():
            with self.subTest(name):
                result = fc.spanning_alpha(y, [f1, f2], subset)
                self.assertAlmostEqual(result["alpha"], alpha, delta=1e-12)
                self.assertAlmostEqual(result["standardError"], se, delta=1e-12)
                self.assertAlmostEqual(result["hacStandardError"], hac, delta=1e-12)
                self.assertAlmostEqual(result["tStat"], t, delta=1e-7)
                self.assertAlmostEqual(result["criticalT"], critical, delta=1e-12)
                self.assertEqual(result["lag"], 3)
                for got, want in zip(result["betas"], betas):
                    self.assertAlmostEqual(got, want, delta=1e-10)

    def test_student_t_and_lag_match_typescript(self):
        for df, value in ((78, 1.9908470685550521), (45, 2.0141033848332923), (30, 2.042272425276678), (3, 3.178616995054062)):
            self.assertAlmostEqual(fc.student_t975(df), value, delta=1e-14)
        self.assertEqual([fc.newey_west_lag(n) for n in (81, 48, 33, 5)], [3, 3, 3, 2])
        self.assertAlmostEqual(fc.multiple_test_threshold(81), math.sqrt(2 * math.log(55)))
        self.assertAlmostEqual(round(fc.multiple_test_threshold(81), 2), 2.83)

    def test_exact_copy_has_no_testable_alpha(self):
        months, y, f1, _ = self.series()
        self.assertIsNone(fc.spanning_alpha(f1, [f1], months)["tStat"])

    def test_monthly_returns_follow_paired_ts(self):
        daily = [("2020-01-15", 101.0), ("2020-01-31", 102.0), ("2020-02-29", 99.96)]
        self.assertEqual(fc.monthly_returns(daily, 100.0), {"2020-01": 102.0 / 100 - 1, "2020-02": 99.96 / 102 - 1})


class DataChecks(unittest.TestCase):
    def test_funding_gap_longer_than_a_day_fails(self):
        raw = [fc.RawFunding(slot + 4, 8, 0.0001) for slot in range(START, START + 20 * DAY, 8 * HOUR)]
        gapped = [event for k, event in enumerate(raw) if not 10 <= k < 14]  # four settlements = 32 h
        _, report = fc.normalize_funding(gapped, START, START + 20 * DAY)
        self.assertEqual(report["missing"], 4)
        self.assertEqual(report["longestGapHours"], 32)
        self.assertFalse(report["passed"])

    def test_identical_duplicates_are_dropped_conflicts_count_as_missing(self):
        raw = [fc.RawFunding(slot, 8, 0.0001) for slot in range(START, START + 2 * DAY, 8 * HOUR)]
        raw.append(fc.RawFunding(START + 8 * HOUR + 5, 8, 0.0001))
        raw.append(fc.RawFunding(START + 16 * HOUR + 5, 8, 0.0002))
        events, report = fc.normalize_funding(raw, START, START + 2 * DAY)
        self.assertEqual(report["duplicatesDropped"], 1)
        self.assertEqual(report["conflictingSlotsDropped"], 1)
        self.assertEqual(report["missing"], 1)
        self.assertNotIn(START + 16 * HOUR, [event.slot for event in events])

    def test_ohlc_violations_count_as_missing_hours(self):
        bars = flat_bars(10)
        bars[START + 3 * HOUR] = (100.0, 99.0, 98.0, 100.0)
        clean, violations = fc.clean_bars(bars)
        report = fc.check_hourly(clean, START, START + 10 * HOUR, violations)
        self.assertEqual((report["missingHours"], report["ohlcViolations"]), (1, 1))

    def test_headerless_two_column_funding_and_microsecond_klines(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "f.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("f.csv", f"{START},0.00010000\n{START + 8 * HOUR},-0.00002000\n")
            events = fc.parse_funding(path)
            self.assertEqual([(e.calc_time, e.interval_hours, e.rate) for e in events], [(START, None, 0.0001), (START + 8 * HOUR, None, -0.00002)])
            klines = Path(tmp) / "k.zip"
            with zipfile.ZipFile(klines, "w") as archive:
                archive.writestr("k.csv", fc.KLINE_HEADER + f"\n{START * 1000},1,2,0.5,1.5,1,0,0,0,0,0,0\n")
            self.assertEqual(fc.parse_klines(klines), {START: (1.0, 2.0, 0.5, 1.5)})

    def test_benchmarks_with_optional_capital_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            plain, bound = Path(tmp) / "plain.csv", Path(tmp) / "bound.csv"
            plain.write_text("month,champion,challenger\n2020-01,0.01,-0.02\n", encoding="utf-8")
            bound.write_text("month,champion,challenger,champion_binding,challenger_binding\n2020-01,0.01,-0.02,0.004,0.0075\n", encoding="utf-8")
            series, binding = fc.parse_benchmarks(plain)
            self.assertEqual((series["challenger"]["2020-01"], binding["challenger"]), (-0.02, {}))
            _, binding = fc.parse_benchmarks(bound)
            self.assertEqual(binding["challenger"]["2020-01"], 0.0075)

    def test_checksum_mismatch_and_missing_month_fail_d1(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            fc.generate_synthetic(data, seed=3)
            target = fc.dataset_dir(data, "klines", "BTCUSDT") / fc.archive_name("klines", "BTCUSDT", "2021-05")
            target.write_bytes(target.read_bytes() + b"x")
            (fc.dataset_dir(data, "markPriceKlines", "ETHUSDT") / fc.archive_name("markPriceKlines", "ETHUSDT", "2023-02")).unlink()
            report = fc.check_files(data)
            self.assertFalse(report["passed"])
            self.assertEqual(report["series"]["klines/BTCUSDT"]["badChecksum"], ["2021-05"])
            self.assertEqual(report["series"]["markPriceKlines/ETHUSDT"]["missing"], ["2023-02"])


class Outcome(unittest.TestCase):
    ALL = {"B1": True, "B2": True, "B3": True, "B4": True, "B5": True, "B6": True}

    def test_classes(self):
        none = {key: False for key in self.ALL}
        compressed = dict(self.ALL, B2=False)
        net, dd = {"A": 0.05, "B": 0.055}, {"A": 0.02, "B": 0.01}
        self.assertEqual(fc.classify({"A": self.ALL, "B": none}, net, dd, "VERFUEGBAR")["outcome"], "BESTANDEN")
        self.assertEqual(fc.classify({"A": self.ALL, "B": none}, net, dd, "NICHT_VERFUEGBAR")["outcome"], "BESTANDEN_REFERENZ")
        self.assertEqual(fc.classify({"A": self.ALL, "B": none}, net, dd, "VERFUEGBAR_OHNE_HISTORIE")["outcome"], "BESTANDEN_REFERENZ")
        self.assertEqual(fc.classify({"A": self.ALL, "B": none}, net, dd, "OFFEN")["outcome"], "AUSSTEHEND_PHASE_1B")
        self.assertEqual(fc.classify({"A": compressed, "B": none}, net, dd, "VERFUEGBAR")["outcome"], "KOMPRIMIERT")
        self.assertEqual(fc.classify({"A": none, "B": none}, net, dd, "VERFUEGBAR")["outcome"], "NICHT_BESTANDEN")

    def test_selection_prefers_a_unless_b_is_clearly_better(self):
        both = {"A": self.ALL, "B": self.ALL}
        self.assertEqual(fc.classify(both, {"A": 0.05, "B": 0.055}, {"A": 0.02, "B": 0.01}, "VERFUEGBAR")["selectedVariant"], "A")
        self.assertEqual(fc.classify(both, {"A": 0.05, "B": 0.06}, {"A": 0.02, "B": 0.02}, "VERFUEGBAR")["selectedVariant"], "B")
        self.assertEqual(fc.classify(both, {"A": 0.05, "B": 0.07}, {"A": 0.02, "B": 0.03}, "VERFUEGBAR")["selectedVariant"], "A")


class EndToEnd(unittest.TestCase):
    def test_synthetic_run_once_then_one_correction(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fc.generate_synthetic(data, seed=11)
            data_report, _ = fc.check_data(data)
            self.assertTrue(data_report["blockingPassed"])
            self.assertNotIn("netPerYear", json.dumps(data_report))  # §2.2: no returns in the data report
            report = fc.evaluate(data, data / "benchmarks.csv", out)
            self.assertTrue(report["synthetic"])
            self.assertIn(report["outcome"], ("AUSSTEHEND_PHASE_1B", "KOMPRIMIERT", "NICHT_BESTANDEN"))
            for variant in ("A", "B"):
                self.assertEqual(set(report["variants"][variant]["criteria"]) - {"alphaThreshold"}, {"B1", "B2", "B3", "B4", "B5", "B6"})
                self.assertEqual(len(report["variants"][variant]["total"]["monthlyReturns"]), 81)
            self.assertTrue((out / "results.md").read_text(encoding="utf-8").startswith("# FUNDING_CARRY_FEASIBILITY_V2"))
            with self.assertRaises(fc.StudyError):
                fc.evaluate(data, data / "benchmarks.csv", out)
            fc.evaluate(data, data / "benchmarks.csv", out, correction="Test")
            with self.assertRaises(fc.StudyError):
                fc.evaluate(data, data / "benchmarks.csv", out, correction="zweite Korrektur")

    def test_archive_starting_in_january_2020_delays_the_sleeves_by_seven_days(self):
        # The real monthly archive begins in 2020-01 (directory listing of 2026-10-17): §2.1 applies.
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fc.generate_synthetic(data, seed=17, futures_from="2020-01")
            data_report, loaded = fc.check_data(data)
            self.assertTrue(data_report["blockingPassed"])
            for symbol in fc.SYMBOLS:
                self.assertEqual(data_report["checks"]["D1"]["series"][f"fundingRate/{symbol}"]["first"], "2020-01")
                self.assertEqual(data_report["checks"]["D2"]["symbols"][symbol]["sleeveStart"], "2020-01-08T00:00Z")
                self.assertEqual(data_report["checks"]["D4"]["series"][f"markPriceKlines/{symbol}"]["range"][0], "2020-01-08T00:00Z")
            report = fc.evaluate(data, data / "benchmarks.csv", out)
            for variant in ("A", "B"):
                total = report["variants"][variant]["total"]
                self.assertEqual(len(total["monthlyReturns"]), 81)  # 2020-01 still counts, with a week of cash
                self.assertEqual(report["variants"][variant]["sleeves"]["BTCUSDT"]["start"], "2020-01-08T00:00Z")
                self.assertGreater(total["finalEquity"], 0)

    def test_failed_data_check_stops_before_returns(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fc.generate_synthetic(data, seed=5)
            for path in (data / "binance" / "rest").glob("*2026-09.json"):
                path.unlink()
            report = fc.evaluate(data, data / "benchmarks.csv", out)
            self.assertEqual(report["outcome"], "NICHT_AUSWERTBAR")
            self.assertNotIn("variants", report)

    def test_synthetic_generator_is_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, second = Path(tmp) / "a", Path(tmp) / "b"
            fc.generate_synthetic(first, seed=2)
            fc.generate_synthetic(second, seed=2)
            files = sorted(p.relative_to(first) for p in first.rglob("*") if p.is_file())
            self.assertTrue(files)
            for relative in files:
                self.assertEqual((first / relative).read_bytes(), (second / relative).read_bytes(), str(relative))


class GapFill(unittest.TestCase):
    """V2 §1/§2: days missing entirely from a monthly file come from the daily archive."""

    GAPS = {"markPriceKlines/BTCUSDT": ["2021-07-24", "2021-07-25", "2021-07-26", "2021-07-27"],
            "indexPriceKlines/BTCUSDT": ["2022-07-24", "2022-07-25"],
            "indexPriceKlines/ETHUSDT": ["2023-02-24"]}

    def test_only_whole_days_are_missing(self):
        bars = flat_bars(3 * 24)
        for hour in range(24, 48):
            del bars[START + hour * HOUR]  # day 2 entirely
        for hour in range(50, 55):
            del bars[START + hour * HOUR]  # day 3 partly
        self.assertEqual(fc.missing_days(bars, START, START + 3 * DAY), [fc.day_key(START + DAY)])

    def test_merge_never_overwrites_and_reports_every_anomaly(self):
        day = fc.day_key(START)
        merged = {START: (1.0, 1.0, 1.0, 1.0)}  # already present (monthly archive)
        rows = [
            [str(START), "9", "9", "9", "9"],  # overlap: never overwrites
            [str((START + HOUR) * 1000), "2", "2", "2", "2"],  # microseconds
            [str(START + 2 * HOUR), "3", "3", "3", "3"], [str(START + 2 * HOUR), "3", "3", "3", "3"],  # identical duplicate
            [str(START + 3 * HOUR), "4", "4", "4", "4"], [str(START + 3 * HOUR), "5", "5", "5", "5"],  # contradiction
            [str(START + DAY), "6", "6", "6", "6"],  # next day: ignored
        ]
        stats = fc.merge_day(merged, day, rows)
        self.assertEqual(merged[START], (1.0, 1.0, 1.0, 1.0))
        self.assertEqual(merged[START + HOUR], (2.0, 2.0, 2.0, 2.0))
        self.assertNotIn(START + 3 * HOUR, merged)
        self.assertNotIn(START + DAY, merged)
        self.assertEqual(stats, {"added": 2, "outsideDay": 1, "duplicatesDropped": 1, "conflictingHours": [fc.iso(START + 3 * HOUR)], "overlaps": 1})

    def test_whole_missing_days_are_filled_and_pass_d4(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            fc.generate_synthetic(data, seed=21, futures_from="2020-01", drop_days=self.GAPS)
            report, loaded = fc.check_data(data)
            self.assertTrue(report["blockingPassed"])
            d9 = report["checks"]["D9"]["series"]
            for series, days in self.GAPS.items():
                self.assertEqual(d9[series]["neededDays"], days)
                self.assertEqual({day: stats["added"] for day, stats in d9[series]["filled"].items()}, {day: 24 for day in days})
                self.assertEqual(report["checks"]["D4"]["series"][series]["missingHours"], 0)
            self.assertEqual(report["checks"]["D1"]["daily"]["markPriceKlines/BTCUSDT"], {"neededDays": 4, "missingFiles": [], "badChecksum": []})
            self.assertNotEqual(report["checks"]["D1"]["fingerprint"], report["checks"]["D1"]["monthlyFingerprint"])
            self.assertIn(fc.utc_ms(2021, 7, 25, 13), loaded["BTCUSDT"].mark)

    def test_without_daily_files_d1_and_d4_fail_like_v1(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            fc.generate_synthetic(data, seed=21, futures_from="2020-01", drop_days=self.GAPS, write_daily=False)
            report, _ = fc.check_data(data)
            self.assertFalse(report["blockingPassed"])
            self.assertFalse(report["checks"]["D1"]["passed"])
            self.assertEqual(report["checks"]["D1"]["daily"]["markPriceKlines/BTCUSDT"]["missingFiles"], self.GAPS["markPriceKlines/BTCUSDT"])
            self.assertEqual(report["checks"]["D4"]["series"]["markPriceKlines/BTCUSDT"]["longestGapHours"], 96)

    def test_daily_file_failing_its_checksum_is_not_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            fc.generate_synthetic(data, seed=22, futures_from="2020-01", drop_days={"markPriceKlines/ETHUSDT": ["2022-10-02"]})
            daily = fc.daily_archive_path(data, "markPriceKlines", "ETHUSDT", "2022-10-02")
            daily.write_bytes(daily.read_bytes() + b"x")
            report, loaded = fc.check_data(data)
            self.assertFalse(report["checks"]["D1"]["passed"])
            self.assertEqual(report["checks"]["D9"]["series"]["markPriceKlines/ETHUSDT"]["badChecksum"], ["2022-10-02"])
            self.assertNotIn(fc.utc_ms(2022, 10, 2, 5), loaded["ETHUSDT"].mark)

    def test_partly_missing_day_is_not_filled_and_valid_data_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            fc.generate_synthetic(data, seed=23, futures_from="2020-01")
            # The monthly file loses five hours of 2024-03-10; a daily file with other values exists for that day.
            monthly = fc.dataset_dir(data, "indexPriceKlines", "BTCUSDT") / fc.archive_name("indexPriceKlines", "BTCUSDT", "2024-03")
            header, rows = fc.read_zip_csv(monthly)
            hidden = {fc.utc_ms(2024, 3, 10, hour) for hour in range(5, 10)}
            kept = [row for row in rows if int(row[0]) not in hidden]
            fc._write_zip(monthly, monthly.name.replace(".zip", ".csv"), ",".join(header) + "\n" + "".join(",".join(row) + "\n" for row in kept))
            day_rows = "".join(f"{fc.utc_ms(2024, 3, 10, hour)},1,1,1,1,1,0,1,1,0,0,0\n" for hour in range(24))
            fc._write_zip(fc.daily_archive_path(data, "indexPriceKlines", "BTCUSDT", "2024-03-10"), "BTCUSDT-1h-2024-03-10.csv", fc.KLINE_HEADER + "\n" + day_rows)
            report, loaded = fc.check_data(data)
            fill = report["checks"]["D9"]["series"]["indexPriceKlines/BTCUSDT"]
            self.assertEqual((fill["neededDays"], fill["unusedDailyFiles"]), ([], ["2024-03-10"]))
            self.assertEqual(report["checks"]["D4"]["series"]["indexPriceKlines/BTCUSDT"]["missingHours"], 5)
            self.assertNotEqual(loaded["BTCUSDT"].index[fc.utc_ms(2024, 3, 10, 12)], (1.0, 1.0, 1.0, 1.0))

    def test_anomalies_inside_a_needed_daily_file_reach_d9(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            fc.generate_synthetic(data, seed=24, futures_from="2020-01", drop_days={"markPriceKlines/BTCUSDT": ["2023-02-24"]}, write_daily=False)
            begin = fc.utc_ms(2023, 2, 24)
            lines = [f"{begin + h * HOUR},100,101,99,100,1,0,1,1,0,0,0" for h in range(24)]
            lines.append(f"{begin + 3 * HOUR},100,102,99,101,1,0,1,1,0,0,0")  # contradicts hour 3
            lines.append(f"{begin + DAY},100,101,99,100,1,0,1,1,0,0,0")  # belongs to the next day
            fc._write_zip(fc.daily_archive_path(data, "markPriceKlines", "BTCUSDT", "2023-02-24"), "BTCUSDT-1h-2023-02-24.csv", "\n".join(lines) + "\n")
            report, loaded = fc.check_data(data)
            stats = report["checks"]["D9"]["series"]["markPriceKlines/BTCUSDT"]["filled"]["2023-02-24"]
            self.assertEqual((stats["added"], stats["outsideDay"], stats["conflictingHours"]), (23, 1, [fc.iso(begin + 3 * HOUR)]))
            self.assertEqual(report["checks"]["D4"]["series"]["markPriceKlines/BTCUSDT"]["missingHours"], 1)
            self.assertTrue(report["checks"]["D4"]["passed"])
            self.assertNotEqual(loaded["BTCUSDT"].mark[begin + DAY], (100.0, 101.0, 99.0, 100.0))  # the monthly candle of the next day stays

    def test_plan_lists_exactly_the_days_missing_entirely(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            fc.generate_synthetic(data, seed=25, futures_from="2020-01", drop_days=self.GAPS, write_daily=False)
            expected = [(series.split("/")[0], series.split("/")[1], day) for series, days in self.GAPS.items() for day in days]
            order = {(dataset, symbol): (fc.SYMBOLS.index(symbol), fc.KLINE_DATASETS.index(dataset)) for dataset in fc.KLINE_DATASETS for symbol in fc.SYMBOLS}
            self.assertEqual(fc.plan_daily(data), sorted(expected, key=lambda item: (order[(item[0], item[1])], item[2])))

    def test_evaluation_runs_on_filled_data_as_v2(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fc.generate_synthetic(data, seed=26, futures_from="2020-01", drop_days=self.GAPS)
            report = fc.evaluate(data, data / "benchmarks.csv", out)
            self.assertEqual(report["study"], "FUNDING_CARRY_FEASIBILITY_V2")
            self.assertEqual(report["preregistration"]["frozenCommit"], "2f75ef0")
            self.assertEqual(report["preregistration"]["adopts"]["frozenCommit"], "248b739")
            self.assertIn("D9", report["dataChecks"]["checks"])


class Downloader(unittest.TestCase):
    """download_v2.sh without network: --dry-run copies, verifies and plans."""

    SCRIPT = Path(__file__).with_name("download_v2.sh")
    GAPS = {"markPriceKlines/BTCUSDT": ["2021-07-01"], "indexPriceKlines/ETHUSDT": ["2022-07-31", "2026-06-29"]}

    def _v1(self, tmp: str) -> tuple[Path, str]:
        v1 = Path(tmp) / "carry-v1"
        fc.generate_synthetic(v1, seed=31, futures_from="2020-01", drop_days=self.GAPS, write_daily=False)
        (v1 / "sources.json").write_text('{"study": "synthetic V1"}\n', encoding="utf-8")
        return v1, fc.write_manifest(v1)

    def _run(self, *args: str) -> "subprocess.CompletedProcess[str]":
        import subprocess
        return subprocess.run(["bash", str(self.SCRIPT), *args], capture_output=True, text=True, timeout=600)

    def test_dry_run_copies_verifies_and_plans_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            v1, manifest = self._v1(tmp)
            v2 = Path(tmp) / "carry-v2"
            result = self._run(str(v1), str(v2), "--dry-run", "--expected-v1-manifest", manifest)
            self.assertEqual(result.returncode, 0, result.stderr)
            planned = [line[len("PLAN "):] for line in result.stdout.splitlines() if line.startswith("PLAN ")]
            self.assertEqual(planned, [
                "https://data.binance.vision/data/futures/um/daily/markPriceKlines/BTCUSDT/1h/BTCUSDT-1h-2021-07-01.zip",
                "https://data.binance.vision/data/futures/um/daily/indexPriceKlines/ETHUSDT/1h/ETHUSDT-1h-2022-07-31.zip",
                "https://data.binance.vision/data/futures/um/daily/indexPriceKlines/ETHUSDT/1h/ETHUSDT-1h-2026-06-29.zip",
            ])
            self.assertIn("Dry run: nothing downloaded.", result.stdout)
            self.assertEqual((v2 / "manifest-v1.sha256").read_text(encoding="utf-8"), (v1 / "manifest.sha256").read_text(encoding="utf-8"))
            self.assertTrue((v2 / "sources-v1.json").exists())
            self.assertFalse((v2 / "binance" / "futures" / "um" / "daily").exists())
            for line in (v1 / "manifest.sha256").read_text(encoding="utf-8").splitlines():
                digest, relative = line.split("  ./")
                target = v2 / ("sources-v1.json" if relative == "sources.json" else relative)
                self.assertEqual(fc.sha256_file(target), digest, relative)

    def test_refuses_a_v1_manifest_that_differs_from_the_frozen_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            v1, _ = self._v1(tmp)
            result = self._run(str(v1), str(Path(tmp) / "carry-v2"), "--dry-run")  # default: the real frozen hash
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("differs from the frozen SHA-256", result.stderr)

    def test_refuses_a_v1_file_that_differs_from_the_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            v1, manifest = self._v1(tmp)
            target = fc.dataset_dir(v1, "klines", "BTCUSDT") / fc.archive_name("klines", "BTCUSDT", "2021-01")
            target.write_bytes(target.read_bytes() + b"x")
            result = self._run(str(v1), str(Path(tmp) / "carry-v2"), "--dry-run", "--expected-v1-manifest", manifest)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("differs from the V1 manifest", result.stderr)

    def test_refuses_a_non_empty_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            v1, manifest = self._v1(tmp)
            v2 = Path(tmp) / "carry-v2"
            v2.mkdir()
            (v2 / "keep.txt").write_text("existing", encoding="utf-8")
            result = self._run(str(v1), str(v2), "--dry-run", "--expected-v1-manifest", manifest)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((v2 / "keep.txt").read_text(encoding="utf-8"), "existing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
