# backend/scraper/main.py
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from playwright.async_api import async_playwright

from scraper.db import extract_physical_price, get_session, upsert_news_item, upsert_physical_price
from scraper.errors import CriticalSourceError

# Side-channel scrapers added in the feature branch — registered in the
# side-channel block further down. ajca + psd_coffee write directly to
# JSON caches consumed by export_stocks.py.
#
# NOTE: `freightos` is intentionally NOT in the daily suite — the dedicated
# "1.2 – Freight Rate Scraper" workflow scrapes it on Fri/Sun only (the FBX
# index only moves end-of-week), so running it here daily was redundant.
# ajca + psd_coffee moved off the daily run → monthly_scraper (slow-data).
from scraper.sources import (
    b3_icf,
    barchart,
    brazil,
    cepea,
    futures,
    noticias_cafe,
    rss,
    technicals,
    uganda,
    vietnam,
)
from scraper.sources import colombia as _colombia
from scraper.sources import colombia_weather as _colombia_weather
from scraper.sources import dry_bulk as _dry_bulk
from scraper.sources import ethiopia as _ethiopia
from scraper.sources import ethiopia_weather as _ethiopia_weather
from scraper.sources import farmer_economics as _farmer_economics
from scraper.sources import guatemala as _guatemala
from scraper.sources import honduras_weather as _honduras_weather
from scraper.sources import indonesia_weather as _indonesia_weather
from scraper.sources import macro_cot as _macro_cot
from scraper.sources import uganda_weather as _uganda_weather

# _guatemala (ANACAFE) proven live via the "Probe: ANACAFE" workflow (run #1:
# egress 200, RESULT PASS — 3 grades via the formula fallback), now in the daily
# suite. That standalone probe workflow has since been removed — the daily run
# is the live check.
# b3 (ICA) retired 2026-08-14: B3's DerivativeQuotation endpoint answers
# "Quotation not available" for ICA at every hour, while b3_icf pulls the
# SAME arabica 4/5 official settlement (prvsDayAdjstmntPric) from the same
# API and succeeds in the same second — ICF is B3's live coffee contract
# code, ICA is not. So this was a duplicate pointed at a dead symbol, not
# a market-hours problem.
# origins (Alfabean) and honduras (IHCAFE) retired 2026-08-14: both loaded
# their page fine and extracted nothing on every run — the price elements
# they key on are gone from the markup. Neither had a live consumer left:
# Alfabean fed no frontend component at all, and honduras_supply.json's
# ihcafe_price was already null with the panel guarded behind it.
# honduras_weather is a DIFFERENT module and is untouched.
ALL_SOURCES = [barchart, brazil, vietnam, technicals, futures, uganda, cepea, rss, noticias_cafe, b3_icf, _colombia, _ethiopia, _guatemala]
CONCURRENCY       = 3    # Max parallel Playwright pages
SCRAPER_TIMEOUT   = 180  # Seconds before a single scraper is killed


async def _run_one(source, browser, semaphore, db) -> int:
    """Run one news source with its own page, under the concurrency semaphore."""
    name = source.__name__.split(".")[-1]
    async with semaphore:
        # Isolated context per source — pristine cookies / cache / localStorage,
        # so a CAPTCHA or poisoned cookie state in one scraper can't bleed into a
        # concurrent one sharing the browser's default context.
        context = await browser.new_context()
        page = await context.new_page()
        try:
            items = await asyncio.wait_for(source.run(page), timeout=SCRAPER_TIMEOUT)
            count = 0
            for item in items:
                upsert_news_item(db, item)
                pp = extract_physical_price(item)
                if pp:
                    upsert_physical_price(db, **pp)
                count += 1
            print(f"[scraper] {name}: {count} items")
            return count
        except TimeoutError:
            print(f"[scraper] {name}: TIMEOUT after {SCRAPER_TIMEOUT}s — skipped")
            return 0
        except CriticalSourceError as e:
            # Opt-out from the swallow-all default — this source signaled
            # a total outage that should fail the workflow.
            print(f"[scraper] {name} CRITICAL: {e}")
            raise
        except Exception as e:
            print(f"[scraper] {name} failed: {e}")
            return 0
        finally:
            await context.close()  # closes the page too and tears down the sandbox


async def _run_side_channel(name, coro_fn, browser, timeout: int = SCRAPER_TIMEOUT) -> None:
    """Run a side-channel scraper (no news items returned) with its own page.
    timeout: per-source override. macro_cot in particular needs more headroom
    than the news scrapers because it does ~25 sequential yfinance.download()
    calls plus CFTC + ICE + stooq downloads.
    """
    page = await browser.new_page()
    try:
        await asyncio.wait_for(coro_fn(page), timeout=timeout)
        print(f"[scraper] {name}: OK")
    except TimeoutError:
        print(f"[scraper] {name}: TIMEOUT after {timeout}s — skipped")
    except Exception as e:
        print(f"[scraper] {name} failed: {e}")
    finally:
        await page.close()


async def run_all_scrapers():
    print("[scraper] Starting daily scrape run...")
    with get_session() as db:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            semaphore = asyncio.Semaphore(CONCURRENCY)

            # Phase 1: all news sources in parallel (capped at CONCURRENCY pages)
            # return_exceptions=True prevents one failing source from cancelling siblings.
            # CriticalSourceError is collected and re-raised after all tasks complete.
            tasks = [_run_one(source, browser, semaphore, db) for source in ALL_SOURCES]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            critical_errors = [r for r in results if isinstance(r, BaseException) and not isinstance(r, int)]
            total = sum(r for r in results if isinstance(r, int))

            # Phase 2: side-channel scrapers — run sequentially (they write to
            # their own tables and don't return news items). Per-source timeout
            # overrides: macro_cot downloads CFTC + ICE ZIPs + yfinance batch
            # which routinely takes 3–5 minutes.
            db_ref = db
            for name, coro_fn, timeout in [
                ("macro_cot",         lambda p: _macro_cot.run(p),                               420),
                ("farmer_economics",  lambda p: _farmer_economics.run(p, db_ref),                SCRAPER_TIMEOUT),
                ("dry_bulk",          lambda p: _dry_bulk.run(p, db_ref),                        SCRAPER_TIMEOUT),
                # psd_coffee + ajca + population are NOT run daily: USDA PSD
                # releases twice a year (Jun/Dec), AJCA monthly, and World Bank
                # population annually — so they run on the slow-data workflow
                # (monthly_scraper) instead. Running them daily re-stamped their
                # freshness to "today" every day and wasted a fetch per run.
                ("colombia_weather",  lambda p: _colombia_weather.run(p, db_ref),                60),
                ("honduras_weather",  lambda p: _honduras_weather.run(p, db_ref),                60),
                ("indonesia_weather", lambda p: _indonesia_weather.run(p, db_ref),               60),
                ("uganda_weather",    lambda p: _uganda_weather.run(p, db_ref),                  60),
                ("ethiopia_weather",  lambda p: _ethiopia_weather.run(p, db_ref),                60),
            ]:
                await _run_side_channel(name, coro_fn, browser, timeout=timeout)

            await browser.close()
    print(f"[scraper] Done. {total} items inserted.")
    if critical_errors:
        raise critical_errors[0]


def main():
    # Run once and exit. Scheduling is owned by an external scheduler, not an
    # in-process sleep loop: production runs the per-topic GitHub Actions cron
    # workflows (scraper-daily, scraper-cot, scraper-prices, …), and local dev
    # invokes this module via docker-compose. A long-lived `while True` loop is
    # fragile — a restart just after the scheduled hour would sleep ~24h and
    # skip the day — so the daily cadence lives in the scheduler instead.
    asyncio.run(run_all_scrapers())


if __name__ == "__main__":
    main()
