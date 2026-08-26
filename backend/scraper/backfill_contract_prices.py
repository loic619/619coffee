"""backfill_contract_prices.py — deepen the per-contract archive to 10 years.

`data/contract_prices_archive.json` accumulates forward from the nightly OI
fetch, so it only reaches back as far as that job has been running: 2021-08.
Five years is enough for the Industry Pulse price line, and NOT enough for the
studies that read the archive as a research series. The certified-stocks/spread
work is the clear case — 61 monthly points, and the robusta relationship turned
out to change regime inside that window, which is exactly the situation where a
short sample misleads.

This walks Barchart's per-contract EOD history for every delivery month in the
target span and merges it into the archive.

    python -m backend.scraper.backfill_contract_prices --years 10

IMPORTANT — retention. `fetch_oi_json._trim_archive` prunes anything older than
ARCHIVE_MAX_DAYS on every nightly run. That constant is raised to 10 years in
the same change as this script; backfilling without raising it first would have
the next night silently delete the work.

Network: needs barchart.com. Sandboxes that deny outbound cannot run this.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import date
from pathlib import Path

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[1]))

ROOT = _HERE.parents[2]
ARCHIVE_FILE = ROOT / "data" / "contract_prices_archive.json"

BASE = "https://www.barchart.com/proxies/core-api/v1"
INIT_URL = "https://www.barchart.com/futures/quotes/KCK26/overview"

# Delivery months actually listed, per board. Enumerating the wrong set either
# wastes requests on contracts that never existed or silently skips real ones.
DELIVERY_MONTHS = {
    "arabica": ["H", "K", "N", "U", "Z"],            # Mar May Jul Sep Dec
    "robusta": ["F", "H", "K", "N", "U", "X"],       # Jan Mar May Jul Sep Nov
}
ROOT_SYMBOL = {"arabica": "KC", "robusta": "RC"}

_JS_FETCH = """async (url) => {
    function getCookie(n) {
        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
        return v ? decodeURIComponent(v[2]) : null;
    }
    const r = await fetch(url, { credentials: 'include',
        headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                   'accept': 'application/json' } });
    if (!r.ok) return { __status: r.status };
    return await r.json();
}"""


def contracts_for_span(market: str, start_year: int, end_year: int) -> list[str]:
    """Every delivery contract on `market`'s board between two years.

    Ordered oldest-first so a run that dies partway has still deepened the
    archive's tail rather than scattering coverage.
    """
    months = DELIVERY_MONTHS[market]
    root = ROOT_SYMBOL[market]
    out = []
    for y in range(start_year, end_year + 1):
        for code in months:
            out.append(f"{root}{code}{y % 100:02d}")
    return out


def parse_eod(payload: dict | None) -> dict[str, float]:
    """Barchart EOD response → {YYYY-MM-DD: settlement}.

    Tolerates both the `raw`-wrapped and flat row shapes the core API returns,
    and skips rows with no usable close rather than writing a zero — a zero
    settlement would sail through downstream filters as a real price.
    """
    rows = (payload or {}).get("data")
    if not isinstance(rows, list):
        return {}
    out: dict[str, float] = {}
    for item in rows:
        r = item.get("raw") if isinstance(item.get("raw"), dict) else item
        if not isinstance(r, dict):
            continue
        d = r.get("tradeTime") or r.get("date") or r.get("sessionDate")
        px = r.get("close") or r.get("lastPrice") or r.get("settlement")
        if not isinstance(d, str) or len(d) < 10:
            continue
        try:
            px = float(px)
        except (TypeError, ValueError):
            continue
        if px > 0:
            out[d[:10]] = px
    return out


def merge_prices(archive: dict, market: str, symbol: str,
                 by_date: dict[str, float]) -> int:
    """Write prices into the archive without clobbering anything present.

    The nightly fetch is authoritative for dates it already covers — it reads
    the live board, this reads a vendor's history file. Backfill fills GAPS
    only; an existing price is never overwritten.
    """
    days = archive.setdefault(market, {})
    added = 0
    for d, px in by_date.items():
        cell = days.setdefault(d, {}).setdefault(symbol, {})
        if "price" not in cell:
            cell["price"] = px
            added += 1
    return added


def archive_span(archive: dict) -> dict[str, tuple[str, str] | None]:
    out: dict[str, tuple[str, str] | None] = {}
    for m in ("arabica", "robusta"):
        ks = sorted(archive.get(m, {}))
        out[m] = (ks[0], ks[-1]) if ks else None
    return out


async def _api(pg, url: str, tries: int = 4):
    for i in range(tries):
        try:
            res = await pg.evaluate(_JS_FETCH, url)
        except Exception:
            try:
                await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=45_000)
                await pg.wait_for_timeout(2_000)
            except Exception:
                pass
            continue
        status = res.get("__status") if isinstance(res, dict) else None
        if status is None:
            return res
        if status != 429 and status < 500:
            return None
        await asyncio.sleep(20 * (i + 1))
    return None


async def run(years: int, today: date) -> int:
    from playwright.async_api import async_playwright

    if not ARCHIVE_FILE.exists():
        print(f"[backfill-prices] archive missing at {ARCHIVE_FILE}")
        return 1
    archive = json.loads(ARCHIVE_FILE.read_text(encoding="utf-8"))
    print(f"[backfill-prices] before: {archive_span(archive)}")

    start_year = today.year - years
    end_year = today.year + 1          # contracts listed into next year

    total_added = 0
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        pg = await (await browser.new_context()).new_page()
        await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=45_000)
        await pg.wait_for_timeout(3_000)

        for market in ("arabica", "robusta"):
            for sym in contracts_for_span(market, start_year, end_year):
                payload = await _api(pg, f"{BASE}/historical/get?symbol={sym}&type=eod")
                by_date = parse_eod(payload)
                if not by_date:
                    print(f"[backfill-prices] {sym}: no history")
                    continue
                added = merge_prices(archive, market, sym, by_date)
                total_added += added
                print(f"[backfill-prices] {sym}: {len(by_date)} rows, {added} new cells")
                await asyncio.sleep(1.0)          # be polite; Barchart throttles

        await browser.close()

    ARCHIVE_FILE.write_text(
        json.dumps(archive, separators=(",", ":")), encoding="utf-8")
    print(f"[backfill-prices] after: {archive_span(archive)}")
    print(f"[backfill-prices] wrote {total_added} new price cells")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=10)
    a = ap.parse_args()
    raise SystemExit(asyncio.run(run(a.years, date.today())))
