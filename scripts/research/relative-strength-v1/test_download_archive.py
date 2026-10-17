#!/usr/bin/env python3
"""Offline tests of download_archive.py (step 1.3); the archive is served from synthetic files.

Run with ``python3 -I scripts/research/relative-strength-v1/test_download_archive.py``.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


da = load("download_archive")
rs = load("relative_strength_v1")


class FakeArchive:
    """Serves files below a local directory that mirrors data/spot/ of data.binance.vision."""

    def __init__(self, root: Path, corrupt: set[str] = frozenset()):
        self.root, self.corrupt, self.calls = root, corrupt, []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        assert url.startswith(da.ARCHIVE_URL + "/"), url
        path = urllib.parse.unquote(url[len(da.ARCHIVE_URL) + 1:])
        source = self.root / path
        if not source.exists():
            raise da.Absent(url)
        body = source.read_bytes()
        return b"broken" if path in self.corrupt else body


def put(root: Path, path: str, body: bytes, checksum: bool = True) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    if checksum:
        target.with_name(target.name + ".CHECKSUM").write_text(f"{hashlib.sha256(body).hexdigest()}  {target.name}\n")


class Jobs(unittest.TestCase):
    def test_monthly_jobs_keep_the_window_and_delisted_symbols(self):
        listing = {"files": {"OLDUSDT": {"2019-06": {"size": 1}, "2019-07": {"size": 1}, "2020-08": {"size": 1}},
                             "NEWUSDT": {"2026-09": {"size": 1}, "2026-10": {"size": 1}, "2026-08": {"size": None}}}}
        self.assertEqual(da.monthly_jobs(listing), ["monthly/klines/NEWUSDT/1d/NEWUSDT-1d-2026-09.zip",
                                                    "monthly/klines/OLDUSDT/1d/OLDUSDT-1d-2019-07.zip",
                                                    "monthly/klines/OLDUSDT/1d/OLDUSDT-1d-2020-08.zip"])

    def test_daily_jobs_from_the_plan_without_duplicates(self):
        plan = {"dailyFilesE1": ["AUSDT\t2021-03-04"], "dailyFilesD12": ["AUSDT\t2021-03-04", "BUSDT\t2022-01-01"]}
        self.assertEqual(da.daily_jobs(plan), ["daily/klines/AUSDT/1d/AUSDT-1d-2021-03-04.zip", "daily/klines/BUSDT/1d/BUSDT-1d-2022-01-01.zip"])

    def test_non_ascii_symbols_are_percent_encoded(self):
        url = da.file_url(da.relative_path("monthly", "币安人生USDT", "2026-01"))
        self.assertTrue(url.isascii())
        self.assertIn("%E5%B8%81", url)


class Fetching(unittest.TestCase):
    def test_verified_files_are_kept_mismatches_rejected_and_reruns_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            root, data = Path(directory) / "remote", Path(directory) / "data"
            good, bad = "monthly/klines/AUSDT/1d/AUSDT-1d-2020-01.zip", "monthly/klines/BUSDT/1d/BUSDT-1d-2020-01.zip"
            put(root, good, b"zip-a")
            put(root, bad, b"zip-b")
            fake = FakeArchive(root, corrupt={bad})
            log = da.run(data, [good, bad], fetch=fake, rate=0)
            self.assertEqual((log["fetched"], log["failed"]), (1, 1))
            self.assertTrue(da.verified(data / "binance" / "spot" / good))
            self.assertFalse((data / "binance" / "spot" / bad).exists())  # nothing kept from a mismatch
            self.assertEqual(len(fake.calls), 2 + 4)  # one retry for the corrupt file
            again = FakeArchive(root)
            log = da.run(data, [good, bad], fetch=again, rate=0)
            self.assertEqual((log["skipped"], log["fetched"], log["failed"]), (1, 1, 0))
            self.assertNotIn(da.file_url(good), again.calls)

    def test_missing_monthly_file_fails_missing_daily_file_is_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            fake = FakeArchive(Path(directory) / "remote")
            monthly = da.run(data, ["monthly/klines/AUSDT/1d/AUSDT-1d-2020-01.zip"], fetch=fake, rate=0)
            self.assertEqual((monthly["failed"], monthly["absent"]), (1, 0))
            daily = da.run(data, ["daily/klines/AUSDT/1d/AUSDT-1d-2020-01-05.zip"], fetch=fake, rate=0, absent_ok=True)
            self.assertEqual((daily["failed"], daily["absent"]), (0, 1))

    def test_guards_confirm_token_synthetic_marker_and_dry_run(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            (data / "listing").mkdir()
            (data / "listing" / "spot-monthly-klines-1d.json").write_text(json.dumps({"files": {"AUSDT": {"2020-01": {"size": 5}}}}))
            with redirect_stderr(io.StringIO()) as err:
                self.assertEqual(da.main(["monthly", "--data", str(data)]), 1)
            self.assertIn(da.CONFIRM, err.getvalue())
            with redirect_stdout(io.StringIO()) as out:
                self.assertEqual(da.main(["monthly", "--data", str(data), "--dry-run"]), 0)
            self.assertEqual(json.loads(out.getvalue())["files"], 1)
            self.assertFalse((data / "binance").exists())
            (data / "SYNTHETIC").write_text("")
            with redirect_stderr(io.StringIO()):
                self.assertEqual(da.main(["monthly", "--data", str(data), "--confirm", da.CONFIRM]), 1)


class EndToEnd(unittest.TestCase):
    def test_download_of_a_synthetic_archive_reproduces_the_layout_and_the_manifest_verifies(self):
        with tempfile.TemporaryDirectory() as directory:
            source, data = Path(directory) / "synth", Path(directory) / "data"
            with redirect_stdout(io.StringIO()):
                rs.main(["synth", "--out", str(source)])
            remote = source / "binance" / "spot"
            files: dict[str, dict] = {}
            for path in remote.glob("monthly/klines/*/1d/*.zip"):
                symbol, month = path.parent.parent.name, path.stem.rsplit("-1d-", 1)[1]
                files.setdefault(symbol, {})[month] = {"size": path.stat().st_size}
            jobs = da.monthly_jobs({"files": files}) + da.daily_jobs(
                {"dailyFilesE1": [f"{p.parent.parent.name}\t{p.stem.rsplit('-1d-', 1)[1]}" for p in remote.glob("daily/klines/*/1d/*.zip")]})
            self.assertGreater(len(jobs), 10)
            log = da.run(data, jobs, fetch=FakeArchive(remote), rate=0, absent_ok=True, workers=4)  # parallel as in the real run
            self.assertEqual(log["failed"], 0)
            for path in remote.rglob("*.zip*"):
                self.assertEqual((data / "binance" / "spot" / path.relative_to(remote)).read_bytes(), path.read_bytes())
            (data / "binance" / "spot" / jobs[0]).with_name("x.zip.part").write_bytes(b"")
            with self.assertRaises(da.DownloadError):
                da.write_manifest(data)  # an unfinished download blocks the manifest
            (data / "binance" / "spot" / jobs[0]).with_name("x.zip.part").unlink()
            da.write_manifest(data)
            self.assertGreater(rs.verify_manifest(data)["files"], len(jobs))  # the study script accepts it (zip + CHECKSUM + log)


if __name__ == "__main__":
    unittest.main(verbosity=2)
