#!/usr/bin/env python3
"""Step 1.3 of RELATIVE_STRENGTH_FEASIBILITY_V1: download the daily candles of the Binance archive.

Writes exactly the layout that relative_strength_v1.py reads:
  <data>/binance/spot/monthly/klines/<SYM>/1d/<SYM>-1d-YYYY-MM.zip[.CHECKSUM]
  <data>/binance/spot/daily/klines/<SYM>/1d/<SYM>-1d-YYYY-MM-DD.zip[.CHECKSUM]   (E1, D12)
  <data>/manifest.sha256

Every file is kept only if its SHA-256 equals the .CHECKSUM published next to it. A rerun resumes:
files that are present and verified are skipped. Nothing is ever read from the zip files here.

Standard library only; run with ``python3 -I``. Network commands refuse to run without
``--confirm DOWNLOAD_RELATIVE_STRENGTH_V1``; ``--dry-run`` only prints what would be fetched.

Commands:
  monthly   --data DIR [--listing FILE] [--rate N] [--workers N] [--dry-run] [--confirm TOKEN]
            every monthly 1d file of the listing in 2019-07..2026-09 (step 1.3)
  daily     --data DIR --plan FILE [--rate N] [--workers N] [--dry-run] [--confirm TOKEN]
            daily files named by `relative_strength_v1.py plan` (E1, D12; steps 1.4a/1.4c)
  manifest  --data DIR       SHA-256 of every file under DIR -> DIR/manifest.sha256
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ARCHIVE_URL = "https://data.binance.vision/data/spot"
CONFIRM = "DOWNLOAD_RELATIVE_STRENGTH_V1"
FIRST_MONTH, LAST_MONTH = "2019-07", "2026-09"  # Vorlauf and window of the preregistration (§4.1)
USER_AGENT = "Mozilla/5.0 (SignalPilot research)"


class DownloadError(Exception):
    pass


class Absent(DownloadError):
    """HTTP 404: the archive has no such file (expected for some daily files)."""


def http_get(url: str, retries: int = 5) -> bytes:
    """GET with exponential backoff on 429/5xx and network errors; 404 raises Absent."""
    wait = 30.0
    for attempt in range(retries):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise Absent(url) from error
            if error.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise DownloadError(f"{url}: HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == retries - 1:
                raise DownloadError(f"{url}: {error}") from error
        time.sleep(wait)
        wait *= 2
    raise DownloadError(url)


def relative_path(kind: str, symbol: str, period: str) -> str:
    """Archive path below data/spot/ and below <data>/binance/spot/; `period` is YYYY-MM or YYYY-MM-DD."""
    return f"{kind}/klines/{symbol}/1d/{symbol}-1d-{period}.zip"


def file_url(path: str) -> str:
    return f"{ARCHIVE_URL}/{urllib.parse.quote(path)}"  # symbols with non-ASCII letters need percent-encoding


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def expected_digest(checksum_text: str) -> str:
    parts = checksum_text.split()
    if not parts or len(parts[0]) != 64:
        raise DownloadError(f"unreadable checksum file: {checksum_text[:80]!r}")
    return parts[0].lower()


def verified(target: Path) -> bool:
    checksum = target.with_name(target.name + ".CHECKSUM")
    if not target.exists() or not checksum.exists():
        return False
    try:
        return expected_digest(checksum.read_text(encoding="utf-8")) == sha256_file(target)
    except DownloadError:
        return False


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(data)
    os.replace(partial, path)


def fetch_pair(data: Path, path: str, fetch, pause: float) -> str:
    """Download one zip and its .CHECKSUM; keep both only if they agree. Returns 'skipped' or 'fetched'."""
    target = data / "binance" / "spot" / path
    if verified(target):
        return "skipped"
    for attempt in (1, 2):  # one retry if the zip does not match its checksum
        time.sleep(pause)
        checksum_text = fetch(file_url(path + ".CHECKSUM")).decode("utf-8")
        time.sleep(pause)
        body = fetch(file_url(path))
        if sha256_bytes(body) == expected_digest(checksum_text):
            write_atomic(target, body)
            write_atomic(target.with_name(target.name + ".CHECKSUM"), checksum_text.encode("utf-8"))
            return "fetched"
    raise DownloadError(f"{path}: SHA-256 differs from the published checksum twice")


def monthly_jobs(listing: dict) -> list[str]:
    """Every month the listing shows for a USDT symbol inside the window (delisted symbols included)."""
    jobs = []
    for symbol in sorted(listing["files"]):
        for month, entry in sorted(listing["files"][symbol].items()):
            if entry.get("size") is not None and FIRST_MONTH <= month <= LAST_MONTH:
                jobs.append(relative_path("monthly", symbol, month))
    return jobs


def daily_jobs(plan: dict) -> list[str]:
    """Lines 'SYM<TAB>YYYY-MM-DD' of the E1 and D12 lists of `relative_strength_v1.py plan`, without duplicates."""
    jobs = []
    for key in ("dailyFilesE1", "dailyFilesD12"):
        for line in plan.get(key) or []:
            symbol, day = line.split("\t")
            path = relative_path("daily", symbol, day)
            if path not in jobs:
                jobs.append(path)
    return jobs


def run(data: Path, jobs: list[str], fetch=http_get, rate: float = 4.0, absent_ok: bool = False, log_name: str = "download-log.json",
        workers: int = 1) -> dict:
    """Fetch all jobs with `workers` parallel connections at about `rate` requests per second in total (each
    answer takes 0.3-0.7 s, so one connection alone stays far below the rate); failures are collected."""
    pause = workers / rate if rate > 0 else 0.0
    counts = {"skipped": 0, "fetched": 0, "absent": 0, "failed": 0}
    absent, failed = [], []
    started = datetime.now(timezone.utc).isoformat()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_pair, data, path, fetch, pause): path for path in jobs}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            path = futures[future]
            try:
                counts[future.result()] += 1
            except Absent:
                counts["absent"] += 1
                absent.append(path)
            except DownloadError as error:
                counts["failed"] += 1
                failed.append({"path": path, "error": str(error)[:300]})
            if index % 500 == 0:
                print(json.dumps({"done": index, "of": len(jobs), **counts}), flush=True)
    absent.sort()
    failed.sort(key=lambda item: item["path"])
    if not absent_ok:  # a monthly file listed in 1.2 but missing now is a failure, not an absence
        failed.extend({"path": path, "error": "HTTP 404 although the listing shows the file"} for path in absent)
        counts["failed"] += counts["absent"]
        counts["absent"], absent = 0, []
    log = {"started": started, "finished": datetime.now(timezone.utc).isoformat(), "jobs": len(jobs), **counts,
           "absentFiles": absent, "failedFiles": failed}
    (data / "logs").mkdir(parents=True, exist_ok=True)
    (data / "logs" / log_name).write_text(json.dumps(log, indent=1, ensure_ascii=False), encoding="utf-8")
    return log


def write_manifest(data: Path) -> dict:
    """'<sha256>  <path>' for every file under data except the manifest, sorted; the format verify_manifest reads."""
    lines = []
    for path in sorted(data.rglob("*")):
        if path.is_file() and path.name != "manifest.sha256":
            if path.name.endswith(".part"):
                raise DownloadError(f"unfinished download {path}; rerun the download first")
            lines.append(f"{sha256_file(path)}  {path.relative_to(data).as_posix()}")
    (data / "manifest.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"files": len(lines), "sha256": sha256_file(data / "manifest.sha256")}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Step 1.3 download of RELATIVE_STRENGTH_FEASIBILITY_V1")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("monthly", "daily"):
        command = commands.add_parser(name)
        command.add_argument("--data", type=Path, required=True)
        command.add_argument("--rate", type=float, default=4.0, help="requests per second in total")
        command.add_argument("--workers", type=int, default=1, help="parallel connections")
        command.add_argument("--dry-run", action="store_true")
        command.add_argument("--confirm", default="")
        if name == "monthly":
            command.add_argument("--listing", type=Path, help="default: DATA/listing/spot-monthly-klines-1d.json")
        else:
            command.add_argument("--plan", type=Path, required=True, help="output of relative_strength_v1.py plan")
    manifest = commands.add_parser("manifest")
    manifest.add_argument("--data", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "manifest":
            print(json.dumps(write_manifest(args.data)))
            return 0
        if (args.data / "SYNTHETIC").exists():
            raise DownloadError(f"{args.data} holds synthetic data; download into the real data directory only")
        if args.command == "monthly":
            listing = json.loads((args.listing or args.data / "listing" / "spot-monthly-klines-1d.json").read_text(encoding="utf-8"))
            jobs = monthly_jobs(listing)
        else:
            jobs = daily_jobs(json.loads(args.plan.read_text(encoding="utf-8")))
        if args.dry_run:
            print(json.dumps({"files": len(jobs), "requests": 2 * len(jobs), "minutes": round(2 * len(jobs) / args.rate / 60, 1),
                              "first": jobs[:3], "urls": [file_url(path) for path in jobs[:2]]}, ensure_ascii=False))
            return 0
        if args.confirm != CONFIRM:
            raise DownloadError(f"downloading needs --confirm {CONFIRM} (separate approval of step 1.3)")
        log = run(args.data, jobs, rate=args.rate, absent_ok=args.command == "daily", log_name=f"download-{args.command}.json",
                  workers=max(1, args.workers))
        print(json.dumps({key: log[key] for key in ("jobs", "skipped", "fetched", "absent", "failed")}))
        return 0 if not log["failed"] else 2
    except (DownloadError, OSError, ValueError) as error:
        print(f"Download abgebrochen: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
