"""
dry_bulk.py — Daily scraper for dry bulk shipping indicator.

Source: Yahoo Finance (no auth required)
  BDRY — Breakwave Dry Bulk Shipping ETF (NYSE Arca)
          Tracks Capesize + Supramax freight futures.
          Direct proxy for dry bulk shipping cost pressure,
          which drives fertilizer CIF pricing into Brazil.

Writes to backend/scraper/cache/dry_bulk.json.
Read by export_static_json → farmer_economics.json → fertilizer.dry_bulk.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_YAHOO_URL  = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=6mo&interval=1d"
_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "dry_bulk.json"

_TICKER = "BDRY"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def _fetch_bdry() -> dict | None:
    import requests
    try:
        resp = requests.get(_YAHOO_URL.format(ticker=_TICKER), headers=_HEADERS, timeout=20)
        resp.raise_for_status()
        payload = resp.json()
        result  = payload["chart"]["result"][0]
        meta    = result["meta"]
        ts      = result["timestamp"]
        closes  = result["indicators"]["quote"][0]["close"]

        # Build daily series — skip nulls
        series = []
        for t, c in zip(ts, closes):
            if c is None:
                continue
            series.append({
                "date":  datetime.utcfromtimestamp(t).strftime("%Y-%m-%d"),
                "close": round(float(c), 3),
            })

        if not series:
            return None

        last      = series[-1]
        prior_22  = series[-22] if len(series) >= 22 else series[0]
        prior_5   = series[-5]  if len(series) >= 5  else series[0]

        mom_pct = round((last["close"] / prior_22["close"] - 1) * 100, 1) if prior_22 else None
        wow_pct = round((last["close"] / prior_5["close"]  - 1) * 100, 1) if prior_5  else None

        return {
            "ticker":        _TICKER,
            "name":          "Breakwave Dry Bulk ETF",
            "description":   "Tracks Capesize + Supramax freight futures · proxy for bulk shipping cost pressure",
            "last_price":    last["close"],
            "last_date":     last["date"],
            "mom_pct":       mom_pct,
            "wow_pct":       wow_pct,
            "week52_low":    meta.get("fiftyTwoWeekLow"),
            "week52_high":   meta.get("fiftyTwoWeekHigh"),
            "series":        series,
            "source":        "Yahoo Finance / Breakwave Advisors",
            "scraped_at":    datetime.utcnow().isoformat() + "Z",
        }
    except Exception as e:
        logger.warning(f"[dry_bulk] BDRY fetch failed: {e}")
        return None


async def run(page, db) -> None:  # noqa: ARG001
    """Fetch BDRY from Yahoo Finance and write to cache. Does not raise on failure."""
    try:
        data = _fetch_bdry()
        if not data:
            print("[dry_bulk] No data returned — retaining cache")
            return

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"[dry_bulk] BDRY {data['last_price']} ({data['last_date']}) mom={data['mom_pct']}% — cached")

    except Exception as e:
        print(f"[dry_bulk] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    """Read from cache. Returns None if cache missing or stale (> 3 days)."""
    try:
        if not _CACHE_PATH.exists():
            return None
        data = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        # Stale check: last_date more than 5 calendar days ago (weekends / holidays)
        last = date.fromisoformat(data["last_date"])
        if (date.today() - last).days > 5:
            logger.warning("[dry_bulk] cache is stale (> 5 days)")
        return data
    except Exception as e:
        logger.warning(f"[dry_bulk] cache read failed: {e}")
        return None


def fetch_or_refresh() -> dict | None:
    """What the exporter should call: cache if usable, otherwise a live fetch.

    `backend/scraper/cache/` is gitignored, so the file this scraper writes does
    not survive from the daily scrape job to the export job — different runner,
    fresh checkout. The effect was silent: dry_bulk ran and reported success
    every day, `fetch_latest()` returned None in the export job every day, and
    farmer_economics.json shipped with no `dry_bulk` block at all, so the
    Freight page said "not yet available" indefinitely. Same failure mode the
    us_cpi exporter already documents, same fix — fall back to fetching.

    Falls back to a stale cache if the live fetch also fails: an old price
    labelled with its own date beats no panel.
    """
    cached = fetch_latest()
    if cached:
        try:
            if (date.today() - date.fromisoformat(cached["last_date"])).days <= 5:
                return cached
        except Exception:  # noqa: BLE001
            pass
    return _fetch_bdry() or cached


if __name__ == "__main__":
    import asyncio
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    async def _main():
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            b    = await pw.chromium.launch(headless=True)
            page = await b.new_page()
            await run(page, None)
            await b.close()

    asyncio.run(_main())
