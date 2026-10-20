#!/usr/bin/env python3
"""Tests of deleveraging_events_v1.py on synthetic data only (step 1.1).

Run with ``python3 -I scripts/research/deleveraging-events-v1/test_deleveraging_events_v1.py``.
The module is loaded by path, so ``-I`` keeps the current directory out of sys.path.
No test reads market data; every price and open-interest value below is made up.
"""

from __future__ import annotations

import importlib.util
import io
import json
import math
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import replace
from pathlib import Path

sys.dont_write_bytecode = True
_SPEC = importlib.util.spec_from_file_location("deleveraging_events_v1", Path(__file__).with_name("deleveraging_events_v1.py"))
de = importlib.util.module_from_spec(_SPEC)
sys.modules["deleveraging_events_v1"] = de
_SPEC.loader.exec_module(de)

MIN, FIVE, DAY = de.MIN, de.FIVE, de.DAY
CFG = replace(de.FROZEN, norm_days=1)          # 288 normalisation points keep the tests small
T0 = de.ms_of("2023-03-01")
START = T0 + DAY + 2 * 60 * MIN                # one day and two hours of lead time
END = START + DAY
SHOCK = START + 6 * 60 * MIN                   # the shock starts here, on the 5-minute grid


def base_price(ms: int) -> float:
    m = (ms - T0) // MIN
    return 100.0 * (1 + 0.0015 * math.sin(2 * math.pi * m / 97))


def price_path(shock: float = -0.03, length: int = 30, after: str = "flat", at: int = SHOCK):
    """Sine noise; a linear shock over `length` minutes; afterwards flat at the shocked level."""
    def path(ms: int) -> float:
        if ms < at:
            return base_price(ms)
        level = base_price(at)
        if ms < at + length * MIN:
            return level * (1 + shock * ((ms - at) / MIN) / length)
        if after == "flat":                     # a tiny drift against the shock, so no new extreme follows
            return level * (1 + shock) * (1 - math.copysign(1e-6, shock) * ((ms - at) / MIN))
        if after == "falling":                  # keeps making new lows for two hours
            extra = min((ms - at) / MIN - length, 120)
            return level * (1 + shock) * (1 - 0.002 * extra)
        if after == "crash":                    # flat for 45 minutes (event ends), then falls through any stop
            calm = (ms - at) / MIN - length - 45
            return level * (1 + shock) * (1 - 0.003 * max(calm, 0.0))
        raise ValueError(after)
    return path


def make_klines(path, start: int = T0, end: int = END + DAY, gap_at: int | None = None) -> "de.Klines":
    rows = []
    for ms in range(start, end, MIN):
        o, c = path(ms), path(ms + MIN)
        if gap_at is not None and ms == gap_at:
            o = c                                # the candle opens at the gapped price
        rows.append((ms, o, max(o, c) * 1.00001, min(o, c) * 0.99999, c))
    return de.klines_from_rows(rows)


def make_oi(drop: float = -0.05, length: int = 30, at: int = SHOCK, start: int = T0, end: int = END + DAY,
            remove: tuple = (), override: dict | None = None) -> "de.OiPoints":
    rows = []
    for ms in range(start, end, FIVE):
        k = (ms - T0) // FIVE
        value = 1000.0 * (1 + 0.001 * math.sin(2 * math.pi * k / 41))
        if ms >= at:
            value *= 1 + drop * min((ms - at) / MIN, length) / length
        if override and ms in override:
            value = override[ms]
        if ms in remove:
            continue
        rows.append((de.iso(ms) + ":00", repr(value)))
    return de.validate_oi(rows)


def run(cfg=CFG, symbol="BTCUSDT", path=None, oi=None, funding=(), start=START, end=END, klines=None):
    klines = klines or make_klines(path or price_path())
    oi = oi or make_oi()
    return de.detect_events(cfg, symbol, klines, oi, list(funding), start, end)


def only(events, category=None):
    chosen = [e for e in events if category is None or e.category == category]
    assert len(chosen) == 1, [(e.category, de.iso(e.c0)) for e in events]
    return chosen[0]


class OiValidity(unittest.TestCase):
    def test_g7_rules(self):
        rows = [("2023-01-01 00:00:00", "10"), ("2023-01-01 00:02:30", "10"), ("2023-01-01 00:05:00", "x"),
                ("2023-01-01 00:10:00", "0"), ("2023-01-01 00:15:00", "12"), ("2023-01-01 00:15:00", "12"),
                ("2023-01-01 00:20:00", "13"), ("2023-01-01 00:20:00", "14"), ("2023-01-01 00:25:00", "-1"),
                ("2023-01-01 00:30:00", "nan")]
        oi = de.validate_oi(rows)
        self.assertEqual(sorted(oi.values), [de.ms_of("2023-01-01 00:00:00"), de.ms_of("2023-01-01 00:15:00")])
        self.assertEqual(oi.report["offGrid"], 1)
        self.assertEqual(oi.report["notNumeric"], 2)
        self.assertEqual(oi.report["notPositive"], 2)
        self.assertEqual(oi.report["duplicateIdentical"], 1)
        self.assertEqual(oi.report["duplicateConflicting"], 1)
        self.assertNotIn(de.ms_of("2023-01-01 00:20:00"), oi.values)   # a conflict voids the stamp

    def test_missing_share(self):
        oi = make_oi(remove=tuple(range(START, START + 30 * FIVE, FIVE)))
        self.assertAlmostEqual(de.oi_missing_share(oi, START, END), 30 / 288)


class TimeLogic(unittest.TestCase):
    def test_classification_uses_aligned_window_at_c0_plus_lag(self):
        event = only(run(), "D")
        self.assertGreaterEqual(event.c0, SHOCK)
        self.assertEqual(event.classified_at, event.c0 + 10 * MIN)
        self.assertEqual(event.oi_stamps, (event.c0 - 60 * MIN, event.c0))
        self.assertLessEqual(event.z_oi, -3)
        self.assertLessEqual(event.z_p, -3)

    def test_oi_after_c0_never_matters(self):
        reference = only(run(), "D")
        later = {reference.c0 + k * FIVE: 1.0 for k in range(1, 40)}   # absurd values after c0
        changed = only(run(oi=make_oi(override=later)), "D")
        self.assertEqual((changed.c0, changed.category, changed.z_oi, changed.net), (reference.c0, reference.category, reference.z_oi, reference.net))

    def test_oi_at_c0_decides(self):
        reference = only(run(), "D")
        flat = make_oi(drop=0.0)
        event = only(run(oi=flat))
        self.assertEqual(event.c0, reference.c0)
        self.assertEqual(event.category, "K")

    def test_price_after_c0_never_changes_detection(self):
        a = only(run(path=price_path(after="flat")), "D")
        b = run(path=price_path(after="falling"))[0]            # the long fall may form a later candidate
        self.assertEqual((a.c0, a.z_p, a.category), (b.c0, b.z_p, b.category))

    def test_rolling_std_excludes_current_and_future(self):
        stamps = list(range(0, 400 * FIVE, FIVE))
        values = {s: math.sin(i) for i, s in enumerate(stamps)}
        reference = de.rolling_z(stamps, values, 288)
        target = stamps[350]
        changed = dict(values)
        changed[target] = 1e6
        for later in stamps[351:]:
            changed[later] = -1e6
        self.assertEqual(de.rolling_z(stamps, changed, 288)[target], reference[target])
        self.assertEqual(reference[target][1], 288)

    def test_entry_after_all_signal_data(self):
        event = only(run(), "D")
        self.assertEqual(event.outcome, "TRADE")
        self.assertGreaterEqual(event.event_end, event.classified_at + FIVE)     # first bar starts at or after c0 + 10
        self.assertEqual(event.entry_at, event.event_end + MIN)
        self.assertGreater(event.entry_at, max(event.oi_stamps) + 10 * MIN)


class ControlGroup(unittest.TestCase):
    def test_missing_oi_at_c0_is_unclassifiable_not_control(self):
        reference = only(run(oi=make_oi(drop=0.0)), "K")
        event = only(run(oi=make_oi(drop=0.0, remove=(reference.c0,))))
        self.assertEqual(event.category, "UNCLASSIFIABLE")
        self.assertEqual(event.outcome, "NO_TRADE")

    def test_missing_oi_at_window_start_is_unclassifiable(self):
        reference = only(run(oi=make_oi(drop=0.0)), "K")
        event = only(run(oi=make_oi(drop=0.0, remove=(reference.c0 - 60 * MIN,))))
        self.assertEqual(event.category, "UNCLASSIFIABLE")

    def test_thin_normalisation_is_unclassifiable(self):
        reference = only(run(oi=make_oi(drop=0.0)), "K")
        gone = tuple(range(reference.c0 - 200 * FIVE, reference.c0 - 100 * FIVE, FIVE))   # 100 of 288 points missing
        event = only(run(oi=make_oi(drop=0.0, remove=gone)))
        self.assertEqual(event.category, "UNCLASSIFIABLE")

    def test_unassigned_between_thresholds(self):
        reference = only(run(oi=make_oi(drop=0.0)), "K")
        window_start = reference.c0 - 60 * MIN
        flat = make_oi(drop=0.0)
        std = de.rolling_z(list(range(START - DAY, END, FIVE)),
                           {c: flat.values[c] / flat.values[c - 60 * MIN] - 1 for c in range(START - DAY, END, FIVE)
                            if c in flat.values and c - 60 * MIN in flat.values}, 288)[reference.c0][0]
        target = flat.values[window_start] * (1 - 2 * std)            # z_OI around -2
        event = only(run(oi=make_oi(drop=0.0, override={reference.c0: target})))
        self.assertEqual(event.category, "UNASSIGNED")
        self.assertEqual(event.lock_until, event.classified_at + 60 * MIN)

    def test_identical_rules_for_d_and_k(self):
        d = only(run(), "D")
        k = only(run(oi=make_oi(drop=0.0)), "K")
        fields = ("c0", "event_end", "entry_at", "exit_at", "entry_price", "exit_price", "exit_reason", "gross", "costs", "net")
        self.assertEqual([getattr(d, f) for f in fields], [getattr(k, f) for f in fields])


class Overlap(unittest.TestCase):
    def test_one_candidate_per_shock(self):
        events = run(path=price_path(length=60))
        self.assertEqual(len(events), 1)

    def test_second_shock_needs_the_lock_to_expire(self):
        first, second = SHOCK, SHOCK + 3 * 60 * MIN
        def two(ms):
            p = price_path(at=first)(ms)
            if ms >= second:
                p *= price_path(at=second)(ms) / price_path(at=second)(second)
            return p
        events = run(path=two)
        self.assertEqual(len(events), 2)
        self.assertGreaterEqual(events[1].c0, events[0].lock_until)

    def test_no_event_end_by_deadline(self):
        event = only(run(path=price_path(after="falling")), "D")
        self.assertEqual(event.outcome, "NO_TRADE")
        self.assertEqual(event.lock_until, event.classified_at + 60 * MIN + 60 * MIN)


class CostsAndExits(unittest.TestCase):
    def test_time_exit_costs_btc_and_eth(self):
        btc = only(run(), "D")
        self.assertEqual(btc.exit_reason, "TIME")
        self.assertAlmostEqual(btc.costs, 0.0022)
        eth = only(run(symbol="ETHUSDT"), "D")
        self.assertAlmostEqual(eth.costs, 0.0028)
        self.assertAlmostEqual(btc.net, btc.gross - 0.0022)

    def test_stop_exit_and_gap(self):
        event = only(run(path=price_path(after="crash")), "D")
        self.assertIn(event.exit_reason, ("STOP", "STOP_GAP"))
        self.assertAlmostEqual(event.costs, 0.0027)
        stop = event.entry_price * (1 - abs(event.d_p))
        if event.exit_reason == "STOP":
            self.assertAlmostEqual(event.exit_price, stop)
        reference = only(run(), "D")
        gap_minute = reference.entry_at + 10 * MIN
        def gapped(ms):
            p = price_path()(ms)
            return p * 0.9 if ms > gap_minute else p
        gap = only(run(klines=make_klines(gapped, gap_at=gap_minute)), "D")
        self.assertEqual(gap.exit_reason, "STOP_GAP")
        self.assertLess(gap.exit_price, gap.entry_price * (1 - abs(gap.d_p)))

    def test_funding_sign(self):
        reference = only(run(), "D")
        funding = [(reference.entry_at + 30 * MIN, 0.001)]
        paid = only(run(funding=funding), "D")
        self.assertAlmostEqual(paid.funding, -0.001)                      # a long pays a positive rate
        self.assertAlmostEqual(paid.net, reference.net - 0.001)
        up_reference = only(run(path=price_path(shock=0.03)), "D")
        up = only(run(path=price_path(shock=0.03), funding=[(up_reference.entry_at + 30 * MIN, 0.001)]), "D")
        self.assertEqual(up.direction, -1)
        self.assertAlmostEqual(up.funding, 0.001)                        # a short receives it


class PeriodLock(unittest.TestCase):
    def test_data_after_end_is_never_read(self):
        reference = run()
        def noisy(ms):
            return price_path()(ms) * (0.5 if ms >= END else 1.0)
        changed = run(path=noisy, oi=make_oi(override={ms: 1.0 for ms in range(END, END + DAY, FIVE)}))
        self.assertEqual([(e.c0, e.category, e.net) for e in reference], [(e.c0, e.category, e.net) for e in changed])

    def test_candidate_too_close_to_end_is_not_formed(self):
        late = END - 60 * MIN
        events = run(path=price_path(at=late), oi=make_oi(at=late))
        self.assertEqual(events, [])


def event(symbol, c0, category, net, z=3.5):
    e = de.Event(symbol, c0, -z, -0.02, 1, c0 + 10 * MIN, category, outcome="TRADE", net=net)
    e.stratum = de.stratum_of(de.FROZEN, z)
    return e


def population(d_mean, k_mean, n=50, eth_sign=1.0, spread=0.004, step=3 * 60 * MIN):
    """n clusters per group; each cluster holds one BTC and one ETH trade 30 minutes apart.

    The two noise sequences differ, so cluster values vary. ETH's D trades sit at
    k_mean + eth_sign * (d_mean - k_mean): eth_sign < 0 turns ETH's difference negative.
    """
    events = []
    for i in range(n):
        noise_btc = spread * math.sin(i * 1.7)
        noise_eth = spread * math.cos(i * 2.3)
        for j, (category, mean) in enumerate((("D", d_mean), ("K", k_mean))):
            base = T0 + (2 * i + j) * step
            events.append(event("BTCUSDT", base, category, mean + noise_btc))
            eth = mean if category == "K" else k_mean + eth_sign * (d_mean - k_mean)
            events.append(event("ETHUSDT", base + 30 * MIN, category, eth + noise_eth))
    return events


class Classes(unittest.TestCase):
    def test_clusters_link_symbols_within_60_minutes(self):
        a = event("BTCUSDT", T0, "D", 0.01)
        b = event("ETHUSDT", T0 + 60 * MIN, "D", 0.03)
        c = event("ETHUSDT", T0 + 121 * MIN, "D", 0.05)
        groups = de.clusters(de.FROZEN, [a, b, c])
        self.assertEqual([len(g["members"]) for g in groups], [2, 1])
        self.assertAlmostEqual(groups[0]["value"], 0.02)

    def test_insufficient(self):
        self.assertEqual(de.classify(de.FROZEN, population(0.01, 0.0, n=30))["class"], "UNZUREICHEND")

    def test_not_passed(self):
        self.assertEqual(de.classify(de.FROZEN, population(-0.001, -0.002))["class"], "NICHT_BESTANDEN")

    def test_only_price_reversal(self):
        self.assertEqual(de.classify(de.FROZEN, population(0.003, 0.003))["class"], "NUR_KURSUMKEHR")

    def test_mixed_signs(self):
        mixed = de.classify(de.FROZEN, population(0.008, 0.0, eth_sign=-0.25, spread=0.002))
        self.assertEqual(mixed["class"], "UNEINHEITLICH", mixed)
        self.assertLess(mixed["perSymbolDifference"]["ETHUSDT"], 0)

    def test_hint_and_robust(self):
        weak = de.classify(de.FROZEN, population(0.0009, 0.0, spread=0.004))
        self.assertEqual(weak["class"], "HINWEIS", weak)
        self.assertTrue(2.0 <= weak["primary"]["t"] < de.FROZEN.t_robust())
        strong = de.classify(de.FROZEN, population(0.01, 0.0, spread=0.004))
        self.assertEqual(strong["class"], "BELASTBAR")
        self.assertAlmostEqual(de.FROZEN.t_robust(), math.sqrt(2 * math.log(58)))


class Commands(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="d8-test-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = de.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_synth_check_and_evaluate_end_to_end(self):
        data = self.tmp / "data"
        info = de.synth(data, seed=3, start="2023-11-01", days=40)
        self.assertTrue((data / "SYNTHETIC").exists())
        code, out, _ = self.main("check-data", "--data", str(data), "--period", "discovery",
                                 "--period-start", "2023-12-02", "--period-end", "2023-12-10")
        self.assertEqual(code, 0, out)
        self.assertFalse(json.loads(out)["halt"])
        code, out, err = self.main("evaluate", "--data", str(data), "--out", str(self.tmp / "out"), "--period", "discovery",
                                   "--period-start", "2023-12-02", "--period-end", "2023-12-10")
        self.assertEqual(code, 0, err)
        result = json.loads((self.tmp / "out" / "result-discovery-primary.json").read_text())
        self.assertTrue(result["synthetic"])
        self.assertIn(result["result"]["class"], ("UNZUREICHEND", "NICHT_BESTANDEN", "NUR_KURSUMKEHR", "UNEINHEITLICH", "HINWEIS", "BELASTBAR"))
        self.assertGreater(sum(result["describe"]["counts"].values()), 0, info)
        lines = (self.tmp / "out" / "events-discovery-primary.csv").read_text().splitlines()
        self.assertGreater(len(lines), 1)
        code, out, _ = self.main("summarize", "--events", str(self.tmp / "out" / "events-discovery-primary.csv"))
        self.assertEqual(code, 0)
        summary = json.loads(out)
        self.assertIn("D", summary["byCategory"])
        self.assertEqual(sum(summary["candidates"].values()), len(lines) - 1)

    def test_pre_evaluation_checks_never_show_returns(self):
        data = self.tmp / "data"
        de.synth(data, seed=3, start="2023-11-01", days=40)
        window = ("--period", "discovery", "--period-start", "2023-12-02", "--period-end", "2023-12-10")
        code, out, _ = self.main("check-data", "--data", str(data), *window)
        self.assertEqual(code, 0, out)
        details = json.loads(out)["report"]["BTCUSDT"]["details"]
        self.assertEqual(details["klines"]["missingMinutes"], 0)
        self.assertEqual(details["klines"]["duplicateConflicting"], 0)
        self.assertEqual(details["funding"]["intervalHours"], {"8": 23})
        self.assertIsNotNone(details["oiTiming"]["medianDeviationBpVsTradeOpen"]["t+0min"])
        code, out, _ = self.main("check-assumptions", "--data", str(data), *window)
        self.assertEqual(code, 0, out)
        report = json.loads(out)
        self.assertNotIn("net", out)
        self.assertEqual(report["tradesWithShiftedEntry"], 0)
        self.assertEqual(report["tradesWithShiftedExit"], 0)
        code, out, _ = self.main("cost-check", "--data", str(data), *window)
        self.assertEqual(code, 0, out)
        cost = json.loads(out)
        self.assertIn("no adjustment", cost["decision"])
        self.assertNotIn("net", out)

    def test_real_data_needs_confirmation(self):
        data = self.tmp / "data"
        de.synth(data, seed=3, start="2023-11-01", days=33)
        (data / "SYNTHETIC").unlink()
        code, _, err = self.main("evaluate", "--data", str(data), "--out", str(self.tmp / "out"), "--period", "discovery")
        self.assertEqual(code, 2)
        self.assertIn("--real --confirm", err)

    def test_period_override_only_for_synthetic(self):
        data = self.tmp / "data"
        de.synth(data, seed=3, start="2023-11-01", days=33)
        (data / "SYNTHETIC").unlink()
        code, _, err = self.main("check-data", "--data", str(data), "--period", "discovery", "--period-start", "2023-11-02",
                                 "--period-end", "2023-11-03")
        self.assertEqual(code, 2)
        self.assertIn("synthetic data only", err)

    def test_test_period_is_locked(self):
        result = self.tmp / "discovery.json"
        result.write_text(json.dumps({"variant": "primary", "result": {"class": "NUR_KURSUMKEHR"}}))
        for confirm, path in (("", None), (de.STUDY_KEY, str(result))):
            with self.assertRaises(de.StudyError):
                de.cmd_evaluate(type("A", (), {"data": str(self.tmp), "out": str(self.tmp / "o"), "real": True,
                                               "confirm": de.STUDY_KEY, "variant": "primary", "period": "test",
                                               "confirm_test": confirm, "discovery_result": path,
                                               "period_start": None, "period_end": None})())

    def test_verify_frozen_preregistration(self):
        report = de.verify_preregistration()
        self.assertTrue(report["verified"])
        self.assertEqual(report["blob"], de.PREREGISTRATION["frozenBlob"])
        root = self.tmp / "repo"
        target = root / de.PREREGISTRATION["path"]
        target.parent.mkdir(parents=True)
        text = (de.REPO_ROOT / de.PREREGISTRATION["path"]).read_text(encoding="utf-8")
        target.write_text(text.replace("z_OI ≤ −3", "z_OI ≤ −2,5", 1), encoding="utf-8")
        with self.assertRaises(de.StudyError):
            de.verify_preregistration(root)

    def test_frozen_values(self):
        cfg = de.FROZEN
        self.assertEqual((cfg.window_min, cfg.hold_min, cfg.oi_lag_min, cfg.norm_days), (60, 60, 10, 30))
        self.assertEqual((cfg.z_price, cfg.z_oi_d, cfg.z_oi_k), (3.0, -3.0, -1.0))
        self.assertEqual((cfg.fee_bp, cfg.slip("BTCUSDT"), cfg.slip("ETHUSDT"), cfg.stop_extra_bp), (6.0, 5.0, 8.0, 5.0))
        self.assertEqual((cfg.min_clusters, cfg.n_counter, cfg.min_valid_share, cfg.abort_invalid_share), (40, 57, 0.8, 0.05))
        self.assertEqual(cfg.period("discovery", "ETHUSDT"), (de.ms_of("2022-01-01"), de.ms_of("2024-01-01")))
        self.assertEqual(cfg.period("test", "BTCUSDT"), (de.ms_of("2024-01-01"), de.ms_of("2026-10-01")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
