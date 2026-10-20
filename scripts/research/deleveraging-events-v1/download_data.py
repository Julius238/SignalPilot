#!/usr/bin/env python3
"""Download of the public Binance files for DELEVERAGING_EVENTS_V1 (D8), step 1.2.

Python standard library only; run with ``python3 -I``. The file list is fixed and
deterministic (§7, §8 of the frozen preregistration): only the discovery period plus its
normalisation lead is fetched; the test period 2024-2026 is not part of this script.

Every zip is checked against its ``.CHECKSUM`` (SHA-256) and must hold exactly one CSV.
A file the archive does not have (HTTP 404) is recorded as missing, never replaced. The
run is resumable: verified files are kept. At the end ``manifest.sha256`` lists every
file of the data directory, including ``download-report.json``.

Commands:
  plan   --out DIR                 the fixed file list and its size class, no network
  fetch  --out DIR [--workers N]   download, verify, report, manifest
  check  --out DIR                 re-verify every zip against its checksum and the manifest
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BASE_URL = "https://data.binance.vision/data/"
SYMBOLS = {
    # symbol: (first month of 1m klines and funding, first metrics day)
    "BTCUSDT": ("2020-08", "2020-09-01"),
    "ETHUSDT": ("2021-11", "2021-12-01"),
}
LAST_MONTH = "2023-12"
LAST_DAY = "2023-12-31"
BOOKDEPTH = ("2023-01-01", "2023-12-31")   # cost check of §6 uses discovery data only


def months(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    ly, lm = map(int, last.split("-"))
    out = []
    while (y, m) <= (ly, lm):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def days(first: str, last: str) -> list[str]:
    d, end = date.fromisoformat(first), date.fromisoformat(last)
    out = []
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def plan() -> list[str]:
    """Relative paths below data.binance.vision/data/, sorted and unique."""
    files = []
    for symbol, (first_month, first_day) in SYMBOLS.items():
        for month in months(first_month, LAST_MONTH):
            files.append(f"futures/um/monthly/klines/{symbol}/1m/{symbol}-1m-{month}.zip")
            files.append(f"futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip")
        for day in days(first_day, LAST_DAY):
            files.append(f"futures/um/daily/metrics/{symbol}/{symbol}-metrics-{day}.zip")
        for day in days(*BOOKDEPTH):
            files.append(f"futures/um/daily/bookDepth/{symbol}/{symbol}-bookDepth-{day}.zip")
    if len(files) != len(set(files)):
        raise SystemExit("duplicate entries in the file list")
    return sorted(files)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get(url: str, attempts: int = 4) -> bytes | None:
    """Body of `url`; None on HTTP 404; raises after repeated other errors."""
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "SignalPilot-research/1"})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if attempt == attempts - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == attempts - 1:
                raise
        time.sleep(2 ** attempt)
    return None


def zip_ok(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.endswith(".csv")]
            return len(names) == 1 and archive.testzip() is None
    except zipfile.BadZipFile:
        return False


def expected_sum(path: Path) -> str | None:
    checksum = path.with_name(path.name + ".CHECKSUM")
    if not checksum.exists():
        return None
    parts = checksum.read_text(encoding="utf-8").split()
    return parts[0] if parts else None


def fetch_one(out: Path, rel: str) -> dict:
    target = out / rel
    checksum_path = target.with_name(target.name + ".CHECKSUM")
    if target.exists() and checksum_path.exists() and expected_sum(target) == sha256_file(target) and zip_ok(target):
        return {"file": rel, "status": "kept"}
    checksum = get(BASE_URL + rel + ".CHECKSUM")
    if checksum is None:
        return {"file": rel, "status": "missing"}
    body = get(BASE_URL + rel)
    if body is None:
        return {"file": rel, "status": "missing"}
    expected = checksum.decode("utf-8").split()[0]
    if sha256_bytes(body) != expected:
        return {"file": rel, "status": "corrupt", "why": "checksum mismatch"}
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(body)
    tmp.replace(target)
    checksum_path.write_bytes(checksum)
    if not zip_ok(target):
        return {"file": rel, "status": "corrupt", "why": "zip does not hold exactly one readable CSV"}
    return {"file": rel, "status": "downloaded", "bytes": len(body)}


def write_manifest(out: Path) -> Path:
    manifest = out / "manifest.sha256"
    lines = []
    for path in sorted(p for p in out.rglob("*") if p.is_file() and p.name != "manifest.sha256" and not p.name.endswith(".part")):
        lines.append(f"{sha256_file(path)}  {path.relative_to(out).as_posix()}")
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return manifest


def cmd_plan(args) -> int:
    files = plan()
    kinds: dict[str, int] = {}
    for rel in files:
        kind = rel.split("/")[3]
        kinds[kind] = kinds.get(kind, 0) + 1
    print(json.dumps({"files": len(files), "byType": kinds, "first": files[0], "last": files[-1], "out": args.out}, indent=2))
    return 0


def cmd_fetch(args) -> int:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if (out / "SYNTHETIC").exists():
        raise SystemExit("refusing to download into a synthetic data directory")
    files = plan()
    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda rel: fetch_one(out, rel), files))
    by_status: dict[str, list[str]] = {}
    for result in results:
        by_status.setdefault(result["status"], []).append(result["file"])
    report = {
        "study": "DELEVERAGING_EVENTS_V1",
        "step": "1.2 download, discovery period only",
        "source": BASE_URL,
        "started": started,
        "finished": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "planned": len(files),
        "counts": {k: len(v) for k, v in sorted(by_status.items())},
        "missing": sorted(by_status.get("missing", [])),
        "corrupt": [r for r in results if r["status"] == "corrupt"],
        "bytesDownloaded": sum(r.get("bytes", 0) for r in results),
    }
    (out / "download-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    manifest = write_manifest(out)
    report["manifestSha256"] = sha256_file(manifest)
    print(json.dumps({k: v for k, v in report.items() if k != "missing"} | {"missingCount": len(report["missing"]),
                                                                              "missingFirst": report["missing"][:10]}, indent=2))
    return 1 if report["corrupt"] else 0


def cmd_check(args) -> int:
    out = Path(args.out)
    problems = []
    for rel in plan():
        path = out / rel
        if not path.exists():
            continue
        if expected_sum(path) != sha256_file(path):
            problems.append({"file": rel, "why": "checksum mismatch"})
        elif not zip_ok(path):
            problems.append({"file": rel, "why": "zip unreadable"})
    manifest = out / "manifest.sha256"
    listed = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        digest, name = line.split(None, 1)
        listed[name.strip()] = digest
    for name, digest in listed.items():
        if sha256_file(out / name) != digest:
            problems.append({"file": name, "why": "manifest mismatch"})
    present = {p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file() and p.name != "manifest.sha256"}
    for name in sorted(present - set(listed)):
        problems.append({"file": name, "why": "not in manifest"})
    print(json.dumps({"checkedZips": sum(1 for rel in plan() if (out / rel).exists()), "manifestEntries": len(listed),
                      "problems": problems}, indent=2))
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "fetch", "check"):
        p = sub.add_parser(name)
        p.add_argument("--out", required=True)
        if name == "fetch":
            p.add_argument("--workers", type=int, default=4)
    args = parser.parse_args(argv)
    return {"plan": cmd_plan, "fetch": cmd_fetch, "check": cmd_check}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
