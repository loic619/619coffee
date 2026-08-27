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


async def _api(pg, url: str, tries: int = 4) -> tuple[dict | None, str | None]:
    """Fetch one API URL. Returns (payload, reason it failed) — exactly one set.

    Carrying the reason out matters more than it looks. Barchart answers a
    refused session with an ordinary HTTP status, and a caller that only sees
    `None` cannot tell "this contract has no data" from "we are being turned
    away". That is precisely how the 2026-08-27 run logged `no history` for all
    110 contracts — including the front month, which was trading that day — and
    still reported success.
    """
    reason = "no attempt made"
    for i in range(tries):
        try:
            res = await pg.evaluate(_JS_FETCH, url)
        except Exception as e:                    # noqa: BLE001 — reported, not swallowed
            reason = f"evaluate failed ({type(e).__name__})"
            try:
                await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=45_000)
                await pg.wait_for_timeout(2_000)
            except Exception:
                pass
            continue
        status = res.get("__status") if isinstance(res, dict) else None
        if status is None:
            return res, None
        reason = f"HTTP {status}"
        if status != 429 and status < 500:
            return None, reason
        await asyncio.sleep(20 * (i + 1))
    return None, reason


# Consecutive identical failures that mean "the source is refusing us" rather
# than "these contracts have no data". Past this, stop: grinding the rest of
# the board against a host that is turning us away is both useless and rude.
_MAX_CONSECUTIVE_FAILURES = 8


def backfill_verdict(contracts_with_rows: int, total_added: int,
                     failures: dict[str, int]) -> tuple[int, str]:
    """Exit code and summary for a completed sweep.

    The distinction this exists to draw: **zero new cells is not failure**. A
    re-run over an already-deep archive legitimately writes nothing, because
    merge_prices fills gaps only. What is failure is fetching nothing at all —
    no contract returning a single row — and the two look identical if you only
    count cells written. Judge on rows fetched, report on cells written.
    """
    if contracts_with_rows == 0:
        return 3, (f"FAILED — not one contract returned data. Reasons: {dict(failures)}. "
                   "That is the source refusing us, not an empty board. "
                   "The archive was NOT modified.")
    msg = (f"{contracts_with_rows} contracts returned data; "
           f"wrote {total_added} new price cells")
    if total_added == 0:
        msg += " (archive already covered this span — nothing to fill)"
    if failures:
        msg += f"; partial failures: {dict(failures)}"
    return 0, msg


def host_reachable(timeout: float = 15.0) -> bool:
    """One cheap probe before launching a browser.

    Without it a denied host surfaces as Playwright's "run playwright install"
    banner or a 30s navigation timeout — neither of which names the actual
    problem. Same preflight as the Vietnam study, for the same reason.
    """
    import requests
    try:
        requests.head("https://www.barchart.com", timeout=timeout, allow_redirects=True)
        return True
    except Exception as e:                    # noqa: BLE001 — any failure is the answer
        print(f"[backfill-prices] barchart.com unreachable ({type(e).__name__}: {e})")
        return False


async def run(years: int, today: date) -> int:
    from playwright.async_api import async_playwright

    if not ARCHIVE_FILE.exists():
        print(f"[backfill-prices] archive missing at {ARCHIVE_FILE}")
        return 1
    if not host_reachable():
        print("[backfill-prices] ABORT — no network path to Barchart. Run this where the "
              "scrapers run, not in a sandbox that denies outbound by policy. "
              "The archive was NOT modified.")
        return 2
    archive = json.loads(ARCHIVE_FILE.read_text(encoding="utf-8"))
    print(f"[backfill-prices] before: {archive_span(archive)}")

    start_year = today.year - years
    end_year = today.year + 1          # contracts listed into next year

    total_added = 0
    contracts_with_rows = 0
    failures: dict[str, int] = {}
    streak_reason: str | None = None
    streak = 0
    aborted = False

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        pg = await (await browser.new_context()).new_page()
        await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=45_000)
        await pg.wait_for_timeout(3_000)

        for market in ("arabica", "robusta"):
            if aborted:
                break
            for sym in contracts_for_span(market, start_year, end_year):
                payload, err = await _api(pg, f"{BASE}/historical/get?symbol={sym}&type=eod")
                by_date = parse_eod(payload)
                if by_date:
                    contracts_with_rows += 1
                    streak, streak_reason = 0, None
                    added = merge_prices(archive, market, sym, by_date)
                    total_added += added
                    print(f"[backfill-prices] {sym}: {len(by_date)} rows, {added} new cells")
                else:
                    reason = err or "empty payload"
                    failures[reason] = failures.get(reason, 0) + 1
                    print(f"[backfill-prices] {sym}: no history ({reason})")
                    streak = streak + 1 if reason == streak_reason else 1
                    streak_reason = reason
                    if streak >= _MAX_CONSECUTIVE_FAILURES:
                        print(f"[backfill-prices] ABORT — {streak} consecutive failures, "
                              f"all '{reason}'. The source is refusing us; the rest of the "
                              f"board would fail the same way.")
                        aborted = True
                        break
                # Be polite on EVERY path. Sleeping only after a success means a
                # total failure sweeps the whole board at full rate — which is
                # how the 2026-08-27 run got through 110 contracts in 7 seconds.
                await asyncio.sleep(1.0)

        await browser.close()

    code, summary = backfill_verdict(contracts_with_rows, total_added, failures)
    if code:
        # Nothing was fetched, so there is nothing to write. Leaving the file
        # untouched keeps a failed sweep from rewriting the app's deepest price
        # history for no reason.
        print(f"[backfill-prices] {summary}")
        return code

    ARCHIVE_FILE.write_text(
        json.dumps(archive, separators=(",", ":")), encoding="utf-8")
    print(f"[backfill-prices] after: {archive_span(archive)}")
    print(f"[backfill-prices] {summary}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=10)
    a = ap.parse_args()
    raise SystemExit(asyncio.run(run(a.years, date.today())))
