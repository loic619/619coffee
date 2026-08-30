# backend/scraper/sources/freightos.py
"""Freightos Baltic Index (FBX) — scrape every published tradelane.

Probe 0.27 harvested the lane list from Freightos' own index page and resolved
each one: there are exactly twelve, and all twelve return a live page. Until now
this scraper took three of them (FBX11, FBX01, FBX03) because those were the
only codes the coffee route table referenced, and the other nine went
unrecorded. FBX is the only container-freight source available to this project,
and a spot index not captured on the day is gone for good — so the whole set is
now stored, and the extra lanes accumulate history from here on.

What this does NOT do is invent a coffee lane. FBX publishes no South America →
Europe leg, nothing out of Africa and nothing in the Caribbean, so Santos,
Cartagena and Djibouti still have no index of their own; see ROUTE_CONFIG in
exporters/macro.py, which labels them as the estimates they are. The value of
the other nine is context: the transatlantic (FBX21/22) and Mediterranean
(FBX13/14) legs at least share weather, canal and capacity shocks with the
coffee corridors, which is more than a single Asia → Europe number offers.
"""
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from scraper.db import upsert_freight_rate

# All twelve FBX tradelanes, slugs verified live by probe 0.27 (2026-08-29).
# `name` is Freightos' own published title, trimmed; it is what the UI shows.
FBX_LANES: list[dict] = [
    {"code": "FBX01", "slug": "fbx-01-china-to-north-america-west-coast",
     "name": "China → N. America West Coast"},
    {"code": "FBX02", "slug": "fbx-02-north-america-west-coast-to-china",
     "name": "N. America West Coast → China"},
    {"code": "FBX03", "slug": "fbx-03-china-to-north-america-east-coast",
     "name": "China → N. America East Coast"},
    {"code": "FBX04", "slug": "fbx-04-north-america-east-coast-to-china",
     "name": "N. America East Coast → China"},
    {"code": "FBX11", "slug": "fbx-11-china-to-northern-europe",
     "name": "China → North Europe"},
    {"code": "FBX12", "slug": "fbx-12-northern-europe-to-china",
     "name": "North Europe → China"},
    {"code": "FBX13", "slug": "fbx-13-china-to-mediterranean",
     "name": "China → Mediterranean"},
    {"code": "FBX14", "slug": "fbx-14-mediterranean-to-china",
     "name": "Mediterranean → China"},
    {"code": "FBX21", "slug": "fbx-21-north-america-east-coast-to-northern-europe",
     "name": "N. America East Coast → North Europe"},
    {"code": "FBX22", "slug": "fbx-22-northern-europe-to-north-american-east-coast",
     "name": "North Europe → N. America East Coast"},
    {"code": "FBX24", "slug": "fbx-24-europe-to-south-america-east-coast",
     "name": "Europe → S. America East Coast"},
    {"code": "FBX26", "slug": "fbx-26-europe-to-south-america-west-coast",
     "name": "Europe → S. America West Coast"},
]

FBX_NAMES: dict[str, str] = {lane["code"]: lane["name"] for lane in FBX_LANES}

# Two hosts serve the same lane pages. The enterprise path is the one the
# original three lanes have been scraped from for months, so it goes first; the
# terminal host is the fallback the probe confirmed answers 200 for all twelve.
_URL_TEMPLATES = (
    "https://www.freightos.com/enterprise/terminal/{slug}/",
    "https://terminal.freightos.com/{slug}/",
)

# Kept for callers that only want code → canonical URL.
FBX_INDICES: dict[str, str] = {
    lane["code"]: _URL_TEMPLATES[0].format(slug=lane["slug"]) for lane in FBX_LANES
}

RATE_SELECTOR = ".fr-value-amount"

# Published FEU rates have sat between roughly $700 and $20,000 across the whole
# post-2020 range, spike included. Anything outside this band means the selector
# matched something that is not a rate — a page redesign, a cookie banner, a
# "0" placeholder — and storing it would poison the history silently. Rejecting
# it costs one missed observation instead.
_RATE_MIN, _RATE_MAX = 100.0, 60000.0


async def _read_rate(page, url: str) -> float | None:
    """Load one lane page and return the parsed rate, or None if it did not."""
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_selector(RATE_SELECTOR, timeout=15000)
    text = await page.inner_text(RATE_SELECTOR)
    # Strip "$", commas, spaces — e.g. "$2,614.20" -> 2614.20
    clean = re.sub(r"[^\d.]", "", text)
    if not clean:
        raise ValueError(f"selector matched non-numeric text {text!r}")
    rate = float(clean)
    if not (_RATE_MIN <= rate <= _RATE_MAX):
        raise ValueError(f"rate {rate} outside plausible band — refusing to store")
    return rate


async def _scrape_index(page, index_code: str, slug: str) -> bool:
    """Fetch one lane and upsert it. Returns True on success."""
    last_err: Exception | None = None
    for template in _URL_TEMPLATES:
        url = template.format(slug=slug)
        try:
            rate = await _read_rate(page, url)
        except Exception as e:  # noqa: BLE001
            last_err = e
            continue
        upsert_freight_rate(index_code, date.today(), rate)
        print(f"[freightos] {index_code}: {rate}")
        return True
    print(f"[freightos] {index_code}: ERROR - {last_err}")
    return False


async def run(page) -> list[dict]:
    """Scrape every FBX lane into freight_rates. Returns [] (side-effect only).

    Raises when nothing at all was captured. The runner retries three times and
    alerts on the third failure, so a total outage should be loud; a partial one
    should not be, since re-scraping eleven good lanes to chase a twelfth would
    waste the retry budget and the lanes already stored are still correct.
    """
    ok, failed = 0, []
    for lane in FBX_LANES:
        if await _scrape_index(page, lane["code"], lane["slug"]):
            ok += 1
        else:
            failed.append(lane["code"])

    print(f"[freightos] {ok}/{len(FBX_LANES)} lanes captured")
    if failed:
        print(f"[freightos] missed: {', '.join(failed)}")
    if ok == 0:
        raise RuntimeError(
            f"no FBX lane returned a usable rate ({len(FBX_LANES)} attempted) — "
            "the selector or the page layout has probably changed"
        )
    return []
