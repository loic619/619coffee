"""
annual_scraper.py — Runs data sources that publish ~once a year.

Sources:
  un_wpp_age — UN World Population Prospects (adult-population age structure).
               Revised roughly annually (the underlying WPP revision lands
               mid-year), so a monthly scrape was ~11 wasted runs/year.
  population — World Bank SP.POP.TOTL total population, per country. Same
               cadence and the same reasoning; moved here from the monthly
               lane in Sep 2026. It is the denominator for the demand tab's
               per-capita ranking, so when it is missing that chart renders
               as an empty box — hence the health row in exporters/health.py,
               which it had none of before.

Called by .github/workflows/scraper-annual-un-wpp.yml.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session, upsert_news_item
from scraper.sources import population as _population
from scraper.sources import un_wpp_age as _un_wpp_age

TIMEOUT = 300  # 5 min per source


async def _run(name: str, coro, db=None) -> None:
    try:
        result = await asyncio.wait_for(coro, timeout=TIMEOUT)
        if isinstance(result, list):
            for item in result:
                upsert_news_item(db, item)
            print(f"[annual] {name}: {len(result)} items")
        else:
            print(f"[annual] {name}: OK")
    except TimeoutError:
        print(f"[annual] {name}: TIMEOUT after {TIMEOUT}s")
    except Exception as e:  # noqa: BLE001 — one bad source shouldn't abort the run
        print(f"[annual] {name} failed: {e}")


async def run_annual() -> None:
    from playwright.async_api import async_playwright

    with get_session() as db:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            for name, coro_fn in [
                ("un_wpp_age", lambda p: _un_wpp_age.run(p, db)),
                ("population",  lambda p: _population.run(p, db)),
            ]:
                page = await browser.new_page()
                try:
                    await _run(name, coro_fn(page), db=db)
                finally:
                    await page.close()
            await browser.close()
    print("[annual] Done.")


def main() -> None:
    asyncio.run(run_annual())


if __name__ == "__main__":
    main()
