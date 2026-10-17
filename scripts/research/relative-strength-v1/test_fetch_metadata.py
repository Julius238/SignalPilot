#!/usr/bin/env python3
"""Offline tests of fetch_metadata.py (step 1.2); every response below is made up.

Run with ``python3 -I scripts/research/relative-strength-v1/test_fetch_metadata.py``.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path

sys.dont_write_bytecode = True
_SPEC = importlib.util.spec_from_file_location("fetch_metadata", Path(__file__).with_name("fetch_metadata.py"))
fm = importlib.util.module_from_spec(_SPEC)
sys.modules["fetch_metadata"] = fm
_SPEC.loader.exec_module(fm)


def s3_xml(prefixes=(), keys=(), truncated=False, next_marker=None) -> bytes:
    body = "".join(f"<CommonPrefixes><Prefix>{p}</Prefix></CommonPrefixes>" for p in prefixes)
    body += "".join(f"<Contents><Key>{k}</Key><LastModified>2025-02-01T00:00:00.000Z</LastModified><Size>{s}</Size></Contents>" for k, s in keys)
    marker = f"<NextMarker>{next_marker}</NextMarker>" if next_marker else ""
    return (f'<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            f"<IsTruncated>{'true' if truncated else 'false'}</IsTruncated>{marker}{body}</ListBucketResult>").encode()


class FakeArchive:
    """Two listing pages of symbols and one page of files per symbol."""

    def __init__(self):
        root = fm.MONTHLY_PREFIX
        self.pages = {("", root): s3_xml([f"{root}AAAUSDT/", f"{root}AAABTC/"], truncated=True, next_marker=f"{root}AAABTC/"),
                      (f"{root}AAABTC/", root): s3_xml([f"{root}BBBUSDT/", f"{root}USDT/", f"{root}币安USDT/"])}
        files = lambda symbol, months: [(f"{root}{symbol}/1d/{symbol}-1d-{m}.zip", 1000) for m in months] + \
            [(f"{root}{symbol}/1d/{symbol}-1d-{m}.zip.CHECKSUM", 90) for m in months if m != "2020-03"]
        self.pages[("", f"{root}AAAUSDT/1d/")] = s3_xml(keys=files("AAAUSDT", ["2019-06", "2020-01", "2020-03", "2026-10"]))
        self.pages[("", f"{root}BBBUSDT/1d/")] = s3_xml(keys=files("BBBUSDT", ["2021-01", "2021-02"]) + [(f"{root}BBBUSDT/1d/README", 1)])
        self.pages[("", f"{root}币安USDT/1d/")] = s3_xml(keys=files("币安USDT", ["2026-01"]))
        self.calls = []

    def __call__(self, url: str, pause: float = 0.0) -> bytes:
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        self.calls.append(query)
        return self.pages[(query.get("marker", ""), query["prefix"])]


class Listing(unittest.TestCase):
    def test_pagination_usdt_filter_checksums_holes_and_plan(self):
        fake = FakeArchive()
        listing = fm.build_listing(fake)
        self.assertEqual(listing["allSpotSymbolsInArchive"], 5)
        self.assertEqual(sorted(listing["symbols"]), ["AAAUSDT", "BBBUSDT", "币安USDT"])  # 'USDT' alone and BTC quotes are skipped
        self.assertEqual(listing["symbols"]["AAAUSDT"], ["2019-06", "2020-01", "2020-03", "2026-10"])
        self.assertEqual(listing["oddNames"], {"BBBUSDT": ["README"]})
        structure = fm.structure_report(listing)
        self.assertEqual(structure["zipFilesWithoutChecksum"], ["AAAUSDT 2020-03"])
        self.assertEqual(structure["interiorMonthHoles"]["AAAUSDT"][:2], ["2019-07", "2019-08"])
        self.assertIn("2020-02", structure["interiorMonthHoles"]["AAAUSDT"])
        self.assertEqual(structure["filesAfterWindow"], 1)
        plan = fm.download_plan(listing, requests_per_second=2)
        self.assertEqual((plan["monthlyFiles"], plan["requests"], plan["zipBytes"]), (5, 10, 5000))  # 2020-01, 2020-03, 2021-01, 2021-02, 2026-01
        self.assertEqual(plan["usdtSymbolsWithFilesInWindow"], 3)
        self.assertEqual(plan["symbolsEndingBeforeWindowEndByYear"], {"2021": 1, "2026": 1})


class GapCheck(unittest.TestCase):
    def test_hourly_files_inside_a_gap_are_suspected_archive_errors(self):
        def fake(url: str, pause: float = 0.0) -> bytes:
            prefix = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))["prefix"]
            symbol, month = prefix.split("/")[4], prefix[-7:]
            days = {("GAPUSDT", "2021-06"): ["2021-06-29", "2021-06-30"], ("GAPUSDT", "2021-07"): ["2021-07-03", "2021-07-25"],
                    ("OKUSDT", "2021-06"): ["2021-06-30"], ("OKUSDT", "2021-07"): ["2021-07-21"]}.get((symbol, month), [])
            return s3_xml(keys=[(f"data/spot/daily/klines/{symbol}/1h/{symbol}-1h-{day}.zip", 10) for day in days] +
                               [(f"data/spot/daily/klines/{symbol}/1h/{symbol}-1h-{day}.zip.CHECKSUM", 1) for day in days])
        gaps = [{"symbol": symbol, "from": "2021-07-01", "to": "2021-07-20"} for symbol in ("GAPUSDT", "OKUSDT", "OLDUSDT")]
        result = {item["symbol"]: item for item in fm.gap_check(gaps, fake)}
        self.assertEqual((result["GAPUSDT"]["verdict"], result["GAPUSDT"]["hourlyDaysInGap"]), ("suspected", ["2021-07-03"]))
        self.assertEqual(result["OKUSDT"]["verdict"], "consistent")
        self.assertEqual(result["OLDUSDT"]["verdict"], "notCheckable")  # no hourly file around the gap at all
        self.assertEqual(fm.shift_month("2021-01", -1), "2020-12")


def snap(time: str, symbols: dict) -> tuple:
    return (time, symbols, f"https://web.archive.org/web/{time[:10]}/x")


class PrecisionP7(unittest.TestCase):
    SNAPSHOTS = [snap("2019-12-20T00:00:00Z", {"OLDUSDT": ["OLD", "TRADING"], "PAUSEUSDT": ["PAUSE", "TRADING"], "REUSEUSDT": ["REUSE", "TRADING"]}),
                 snap("2020-06-01T00:00:00Z", {"OLDUSDT": ["OLD", "BREAK"], "PAUSEUSDT": ["PAUSE", "BREAK"], "REUSEUSDT": ["REUSE", "BREAK"],
                                               "TOKUSDT": ["TOK", "TRADING"], "GONEUSDT": ["GONE", "BREAK"]}),
                 snap("2020-09-01T00:00:00Z", {"PAUSEUSDT": ["PAUSE", "TRADING"], "TOKUSDT": ["TOK", "BREAK"], "REUSEUSDT": ["REUSE", "BREAK"]}),
                 snap("2023-01-01T00:00:00Z", {"REUSEUSDT": ["REUSE", "TRADING"], "TOKUSDT": ["TOK", "BREAK"], "PAUSEUSDT": ["PAUSE", "TRADING"]})]

    def test_token_pairs_need_archived_trading_before_and_an_end_after(self):
        evidenced, rejected = fm.token_pairs(["TOK", "GONE", "NONE"], "2020-07-01T00:00:00Z", "2020-07-15", self.SNAPSHOTS)
        self.assertEqual([item["pair"] for item in evidenced], ["TOKUSDT"])
        self.assertEqual({item["pair"] for item in rejected}, {"GONEUSDT", "NONEUSDT"})  # already BREAK, or never listed
        evidenced, _ = fm.token_pairs(["TOK"], "2020-07-01T00:00:00Z", "2023-06-01", self.SNAPSHOTS)
        self.assertEqual(evidenced, [])  # no capture after the trading end

    def test_snapshot_endings_skip_pauses_and_the_archive_check_refuses_reused_symbols(self):
        endings = {item["pair"]: item for item in fm.snapshot_endings(self.SNAPSHOTS)}
        self.assertEqual(set(endings), {"OLDUSDT", "REUSEUSDT", "TOKUSDT"})  # PAUSEUSDT trades again within a year
        symbols = {"OLDUSDT": ["2019-07", "2019-12", "2020-01"], "REUSEUSDT": ["2019-06", "2023-01"], "TOKUSDT": ["2020-06", "2020-07"]}
        survey = fm.snapshot_survey(list(endings.values()), symbols)
        self.assertEqual([item["pair"] for item in survey["2019"]["missing"]], ["REUSEUSDT"])  # only files from the reuse
        self.assertEqual((survey["2019"]["found"], survey["2020"]["found"]), (1, 1))

    def test_sample_counts_token_delistings_and_drops_pairs_removed_earlier(self):
        day = 86_400_000
        start = 1_590_969_600_000  # 2020-06-01
        candidates = [article("t1", "Binance Will Delist TOK", start + 30 * day), article("n1", "Notice of Removal", start + 10 * day),
                      article("x1", "Binance Will Delist X", start + 40 * day)]
        texts = {"n1": "Binance will remove ABC/USDT", "t1": "delist TOK", "x1": "delist X"}
        decisions = {"n1": {"qualifies": True, "pairs": ["ABCUSDT"], "tradingEnd": "2020-06-15"},
                     "t1": {"qualifies": False, "pairs": [], "tradingEnd": None, "p7": {"tokens": ["TOK"], "tradingEnd": "2020-07-15"}},
                     "x1": {"qualifies": False, "pairs": [], "tradingEnd": None}}
        snapshots = [snap(t.replace("2020-", "2021-"), s) for t, s, _ in self.SNAPSHOTS]  # shift the captures into a sample year
        candidates = [{**item, "releaseDate": item["releaseDate"] + 365 * day} for item in candidates]
        for item in decisions.values():
            for key in ("tradingEnd",):
                if item.get(key):
                    item[key] = item[key].replace("2020-", "2021-")
            if "p7" in item:
                item["p7"]["tradingEnd"] = item["p7"]["tradingEnd"].replace("2020-", "2021-")
        years = fm.build_p7_sample(candidates, decisions, snapshots, lambda a: texts[a["code"]])
        self.assertEqual([(item["kind"], item["pairs"]) for item in years["2021"]], [("named", ["ABCUSDT"]), ("token", ["TOKUSDT"])])
        texts["n1"] = "Binance will remove TOK/USDT and ABC/USDT"
        years = fm.build_p7_sample(candidates, decisions, snapshots, lambda a: texts[a["code"]])
        self.assertEqual([item["kind"] for item in years["2021"]], ["named"])  # TOK/USDT ended earlier, the token delisting adds nothing

    def test_slashless_pair_notation_is_recognized(self):
        self.assertEqual(fm.named_usdt_pairs("remove AAVEBRL, ABCUSDT and DEF/USDT"), ["DEFUSDT", "ABCUSDT"])


def article(code: str, title: str, published_ms: int) -> dict:
    return {"code": code, "title": title, "releaseDate": published_ms, "id": 1, "type": 1}


def body(text: str) -> str:
    return json.dumps({"node": "root", "child": [{"node": "element", "tag": "p", "child": [{"node": "text", "text": text}]}]})


MS_2020 = 1_577_836_800_000  # 2020-01-01


class Announcements(unittest.TestCase):
    def test_text_pairs_and_trading_end(self):
        text = fm.article_text(body("Binance will remove AION/BNB, ABC/USDT and XYZ / USDT at 2020/12/18 12:00 PM (UTC). ABC/USDT again."))
        self.assertEqual(fm.usdt_pairs(text), ["ABCUSDT", "XYZUSDT"])
        self.assertEqual(fm.trading_end("Notice of Removal of Trading Pairs - 2021-01-29", text, "2021-01-28T13:29:00Z"), ("2021-01-29", "title"))
        self.assertEqual(fm.trading_end("Binance Will Delist ABC", text, "2020-12-17T00:00:00Z"), ("2020-12-18", "text"))
        self.assertEqual(fm.trading_end("Binance Will Delist ABC", "no date", "2020-12-17T00:00:00Z"), ("2020-12-17", "publication"))
        self.assertEqual(fm.article_text("<p>ABC/USDT</p>").strip(), "ABC/USDT")

    def test_title_filter(self):
        self.assertTrue(fm.relevant_title("Notice of Removal of Trading Pairs - 2021-01-29"))
        self.assertTrue(fm.relevant_title("Binance Will Delist BCPT, CMT, TNB & VIBE on 2021-02-10"))
        self.assertFalse(fm.relevant_title("Binance Futures Will Delist DOTECO USDT-Margined Contract"))
        self.assertFalse(fm.relevant_title("Binance Margin to Delist AUD, EUR & GBP Pairs"))
        self.assertFalse(fm.relevant_title("Binance Lists ABC"))
        self.assertFalse(fm.relevant_title("Binance Liquid Swap Adds USDC Support and Opens USDC/USDT Liquidity Pool"))
        pool = fm.classify_article(article("p", "Binance Will Support the ABC Mainnet Token Swap", MS_2020), {"body": body("Trade ABC/USDT as usual.")})
        self.assertFalse(pool["qualifies"])  # a USDT pair without any end of trading

    def test_first_three_qualifying_per_year_with_cache_and_lazy_details(self):
        day = 86_400_000
        articles = [article(f"a{i}", f"Notice of Removal of Trading Pairs - 2020-0{1 + i}-15", MS_2020 + i * 30 * day) for i in range(6)]
        articles.append(article("futures", "Binance Futures Will Delist ABC", MS_2020 + day))
        texts = {"a0": "remove ABC/BTC", "a1": "remove AAA/USDT", "a2": "Binance will delist BBB: BBB/USDT", "a3": "remove CCC/USDT and DDD/USDT",
                 "a4": "remove EEE/USDT", "a5": "remove FFF/USDT"}
        details = []

        def fetch(url: str, pause: float = 0.0) -> bytes:
            query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
            if "articleCode" in query:
                details.append(query["articleCode"])
                return json.dumps({"data": {"body": body(texts[query["articleCode"]])}}).encode()
            batch = articles if query["catalogId"] == "49" and query["pageNo"] == "1" else []
            return json.dumps({"data": {"catalogs": [{"articles": batch}]}}).encode()

        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            sample = fm.collect_announcements(out, out / "cache", fetch)
            self.assertEqual([item["pairs"] for item in sample["years"]["2020"]], [["AAAUSDT"], ["BBBUSDT"], ["CCCUSDT", "DDDUSDT"]])
            self.assertEqual(details, ["a0", "a1", "a2", "a3"])  # stops after three qualifying; futures never fetched
            self.assertEqual(sample["years"]["2021"], [])
            fm.collect_announcements(out, out / "cache", lambda url, pause=0.0: self.fail(f"refetched {url}"))  # all from the cache
            stored = json.loads((out / "announcements-d0b.json").read_text())
            self.assertIn("rule", stored)

    def test_reviewed_sample_takes_the_first_three_confirmed_and_refuses_gaps(self):
        day = 86_400_000
        candidates = [article(f"r{i}", f"Binance Will Delist T{i}", MS_2020 + i * day) for i in range(5)]
        decisions = {"r0": {"qualifies": False, "pairs": [], "tradingEnd": "2020-01-08", "reason": "no USDT pair"},
                     "r1": {"qualifies": True, "pairs": ["T1USDT"], "tradingEnd": "2020-01-09"},
                     "r2": {"qualifies": True, "pairs": ["T2USDT"], "tradingEnd": "2020-01-10"},
                     "r3": {"qualifies": True, "pairs": ["T3USDT"], "tradingEnd": "2020-01-11"}}
        result = fm.build_reviewed_sample(candidates, decisions)
        self.assertEqual([item["pairs"] for item in result["years"]["2020"]], [["T1USDT"], ["T2USDT"], ["T3USDT"]])
        del decisions["r1"]
        with self.assertRaises(fm.FetchError):
            fm.build_reviewed_sample(candidates, decisions)  # an unreviewed candidate before the third hit

    def test_merge_review_marks_texts_without_a_usdt_pair_and_keeps_manual_decisions(self):
        candidates = [article(c, f"Binance Will Delist {c}", MS_2020) for c in ("m", "auto", "open", "uncached", "adds")]
        manual = {"m": {"qualifies": True, "pairs": ["MMUSDT"], "tradingEnd": "2020-01-08", "reason": "named"}}
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            for code, text in (("m", "remove MM/USDT"), ("auto", "remove AA/BTC"), ("open", "remove OO/USDT"), ("adds", "Binance adds NN/USDT")):
                (cache / f"article-{code}.json").write_text(json.dumps({"data": {"body": body(text)}}))
            decisions, pending = fm.merge_review(candidates, cache, manual)
        self.assertEqual(decisions["m"], manual["m"])
        self.assertFalse(decisions["auto"]["qualifies"])
        self.assertIn("kein Handelsende", decisions["adds"]["reason"])  # a new pair, no end: decided automatically
        self.assertEqual([item["code"] for item in pending], ["open"])
        self.assertNotIn("uncached", decisions)  # never fetched, so build_reviewed_sample refuses it if it matters

    def test_exchange_info_is_reduced_to_usdt(self):
        raw = json.dumps({"serverTime": 1, "symbols": [{"symbol": "ABCUSDT", "baseAsset": "ABC", "quoteAsset": "USDT", "status": "BREAK"},
                                                       {"symbol": "ABCBTC", "baseAsset": "ABC", "quoteAsset": "BTC", "status": "TRADING"}]}).encode()
        reduced = fm.reduce_exchange_info(raw)
        self.assertEqual(reduced["symbols"], [{"symbol": "ABCUSDT", "baseAsset": "ABC", "quoteAsset": "USDT", "status": "BREAK"}])


if __name__ == "__main__":
    unittest.main(verbosity=2)
