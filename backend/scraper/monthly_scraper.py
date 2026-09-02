"""
monthly_scraper.py — Runs monthly data sources that don't have their own flow.

Sources:
  ajca             — AJCA Japan green-coffee imports/stocks headline + DB
                     NewsItem (monthly). The monthly j-import report drives the
                     "AJCA Japan stocks" freshness row. NB: ajca.json (the
                     monthly stocks file) is still built by '3.5 – AJCA (Japan)'
                     (scraper/backfill_japan_stocks.py); this run only refreshes
                     the DB headline/NewsItem.
  psd_coffee       — USDA FAS PSD CSV. USDA publishes the coffee PSD twice a
                     year (June new marketing year + December revision), so this
                     only fetches in months 6 & 12 — NOT every month.
  usda_gain_pdf    — USDA GAIN Coffee Annual PDFs (forward-year forecasts
                     USDA only publishes in the narrative reports, never in
                     the CSV). Merged on top of psd_coffee in export_stocks.

NB on what is NOT run here (to avoid duplicate scrapes):
  • ECF port stocks → '3.4 – ECF stocks' (scraper/backfill_ecf_history.py).
  • ucda_reports    → '3.3.5 – Uganda UCDA' (scraper.run_monthly ucda).
  • un_wpp_age      → annual cadence → scraper/annual_scraper.py.

Called by .github/workflows/scraper-slow-data.yml (~12th of each month). PSD
self-gates to June/December inside run_monthly().
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import UTC, datetime

from scraper.db import get_session, upsert_news_item
from scraper.sources import ajca as _ajca
from scraper.sources import psd_coffee as _psd_coffee
from scraper.sources import usda_gain_pdf as _usda_gain_pdf

TIMEOUT = 300  # 5 min per source


async def _run(name: str, coro, db=None) -> None:
    try:
        result = await asyncio.wait_for(coro, timeout=TIMEOUT)
        if isinstance(result, list):
            for item in result:
                upsert_news_item(db, item)
            print(f"[monthly] {name}: {len(result)} items")
        else:
            print(f"[monthly] {name}: OK")
    except TimeoutError:
        print(f"[monthly] {name}: TIMEOUT after {TIMEOUT}s")
    except Exception as e:
        print(f"[monthly] {name} failed: {e}")


async def run_monthly() -> None:
    from playwright.async_api import async_playwright

    # AJCA refreshes monthly; USDA PSD coffee only releases twice a year (June
    # new marketing year + December revision), so we only fetch PSD in those
    # months rather than every run. The workflow cron stays monthly.
    month = datetime.now(UTC).month

    with get_session() as db:
        sources = [
            ("ajca",          lambda p: _ajca.run(p, db)),
            ("usda_gain_pdf", lambda p: _usda_gain_pdf.run(p, db)),
            # population moved to annual_scraper (2026-09): World Bank
            # SP.POP.TOTL is revised about once a year, so eleven of twelve
            # monthly runs re-fetched identical numbers and re-stamped the
            # freshness to "today" — the same reasoning that moved un_wpp_age.
        ]
        # FORCE_PSD=1 bypasses the semi-annual gate — needed when the
        # producer roster in psd_coffee._PRODUCERS grows mid-cycle and the
        # DB blob must be re-parsed before the next Jun/Dec window (first
        # use: the Aug 2026 six-origin extension for the global S&D).
        if month in (6, 12) or os.environ.get("FORCE_PSD") == "1":
            sources.insert(0, ("psd_coffee", lambda p: _psd_coffee.run(p, db)))
        else:
            print(f"[monthly] psd_coffee skipped (month={month}; runs in Jun & Dec only)")

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)

            for name, coro_fn in sources:
                page = await browser.new_page()
                try:
                    await _run(name, coro_fn(page), db=db)
                finally:
                    await page.close()

            await browser.close()
    print("[monthly] Done.")


def main() -> None:
    asyncio.run(run_monthly())


if __name__ == "__main__":
    main()
