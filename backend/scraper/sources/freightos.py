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

# The composite. Freightos publishes it alongside the twelve on the same ticker
# call, and we had no way to see it while scraping one lane page at a time — the
# lane pages show only their own number. It is a global weighted average, not a
# thirteenth lane, so it stays out of FBX_LANES and out of anything that reasons
# about tradelanes; it is an index in its own right and is stored as one.
FBX_COMPOSITE_CODE = "FBX"
FBX_COMPOSITE_NAME = "Global composite (all lanes)"

FBX_NAMES: dict[str, str] = {
    **{lane["code"]: lane["name"] for lane in FBX_LANES},
    FBX_COMPOSITE_CODE: FBX_COMPOSITE_NAME,
}

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

# ── The ticker endpoint ──────────────────────────────────────────────────────
#
# Probe 0.32 established that the page's own ticker call returns all thirteen
# values — the twelve lanes plus the composite — in one 898-byte JSON, and that
# the call can be made with plain HTTP:
#
#     POST /wp-admin/admin-ajax.php
#     action=freightos_get_ticker_data&nonce=<10 hex>
#     Content-Type: application/x-www-form-urlencoded
#
# Three things the probe settled, each of which shapes the code below:
#
#   * the nonce IS validated. A bogus one and a missing one both come back 200
#     with a 40-byte {"success":false,...}, which is visibly different from the
#     one-byte `0` an unrecognised action returns — so this is a real rejection,
#     not the endpoint refusing everything.
#   * the Content-Type is load-bearing. Without it WordPress cannot parse the
#     form body, no handler runs, and the reply is that bare `0`.
#   * the working nonce is present in the served HTML, reachable with a plain
#     GET. No browser is needed anywhere on this path.
#
# What is NOT there: any way to ask for a past date. Six different argument
# names all returned byte-identical payloads to the no-argument baseline, and
# unlike the first attempt at that test the baseline proves the call reached a
# handler. Consistent with probes 0.28/0.29 — FBX history stays unreachable.
_AJAX_URL = "https://www.freightos.com/wp-admin/admin-ajax.php"
_TICKER_ACTION = "freightos_get_ticker_data"
_FORM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/x-www-form-urlencoded",
}
# Any lane page carries the ticker; FBX11 is the one we have scraped longest.
_NONCE_PAGE = _URL_TEMPLATES[0].format(slug=FBX_LANES[4]["slug"])

# Below this many lanes the ticker is not doing its job and the per-lane scrape
# is worth the twelve page loads. Twelve of thirteen is fine; four is not.
_MIN_TICKER_LANES = 10


def _nonce_candidates(html: str) -> list[str]:
    """Every 10-hex token that could be the ticker nonce, best guesses first.

    The action name does not appear in the HTML at all — it lives inside a
    bundled script — so there is nothing to anchor a positional regex to, and
    an earlier attempt that matched "a nonce-shaped field" picked a real token
    belonging to something else and got rejected. A WordPress page carries
    several nonces and only the endpoint can say which is which.

    So: gather candidates rather than pick one. Explicit `nonce: "…"` fields
    come first because that is what the right answer looks like, then every
    remaining bare token as a backstop. In practice the first or second is the
    one, which keeps this to a request or two rather than seventeen.
    """
    ordered: list[str] = []
    seen: set[str] = set()
    for pattern in (
        r'nonce["\']?\s*[:=]\s*["\']([0-9a-f]{10})["\']',
        r"\b([0-9a-f]{10})\b",
    ):
        for m in re.finditer(pattern, html, re.I):
            token = m.group(1).lower()
            if token not in seen:
                seen.add(token)
                ordered.append(token)
    return ordered


def _parse_ticker(payload: dict) -> dict[str, float]:
    """{"label": "FBX01", "value": "$7,621"} rows → {code: rate}."""
    out: dict[str, float] = {}
    for row in payload.get("data") or []:
        if not isinstance(row, dict):
            continue
        code = (row.get("label") or "").strip().upper()
        clean = re.sub(r"[^\d.]", "", str(row.get("value") or ""))
        if not code or code not in FBX_NAMES or not clean:
            continue
        try:
            rate = float(clean)
        except ValueError:
            continue
        # Same band the per-lane path enforces: a layout change that starts
        # returning zeros must cost an observation, not corrupt the series.
        if _RATE_MIN <= rate <= _RATE_MAX:
            out[code] = rate
    return out


def fetch_ticker() -> dict[str, float]:
    """All thirteen FBX values in two HTTP requests. {} if unavailable.

    Returning {} rather than raising is deliberate: `run` falls back to the
    per-lane browser scrape, so a Freightos change to the ticker costs us speed
    and the composite, never the day's prints. FBX is the only container-freight
    source here and an observation missed is gone for good.
    """
    import requests

    try:
        page = requests.get(_NONCE_PAGE, headers={"User-Agent": _FORM_HEADERS["User-Agent"]},
                            timeout=45)
        page.raise_for_status()
    except Exception as e:  # noqa: BLE001
        print(f"[freightos] ticker: could not load the nonce page — {type(e).__name__}: {e}")
        return {}

    candidates = _nonce_candidates(page.text)
    if not candidates:
        print("[freightos] ticker: no nonce-shaped token in the page")
        return {}

    for attempt, nonce in enumerate(candidates[:20], start=1):
        try:
            resp = requests.post(
                _AJAX_URL, timeout=30, headers=_FORM_HEADERS,
                data=f"action={_TICKER_ACTION}&nonce={nonce}",
            )
        except Exception as e:  # noqa: BLE001
            print(f"[freightos] ticker: POST failed — {type(e).__name__}: {e}")
            return {}
        if resp.status_code != 200:
            continue
        # Judge the reply by what parses out of it, not by its size. A rejected
        # nonce yields {"success": false, "data": "<string>"} and an unhandled
        # action yields a bare `0`; both parse to nothing. An earlier version
        # also required ~200 bytes, which would have silently rejected a
        # legitimately slimmer payload if Freightos ever trimmed a field.
        try:
            rates = _parse_ticker(resp.json())
        except Exception:  # noqa: BLE001
            continue
        if rates:
            print(f"[freightos] ticker: {len(rates)} values on nonce attempt {attempt}")
            return rates

    print(f"[freightos] ticker: none of {len(candidates)} candidate nonces was accepted")
    return {}


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
    """Store every FBX value. Returns [] (side-effect only).

    Two paths, fast one first:

      ticker    two HTTP requests, no browser, thirteen values including the
                composite. This is what a normal run does.
      per-lane  twelve Playwright page loads, twelve values. Kept as a fallback
                because FBX is the only container-freight source here, so a
                Freightos change to the ticker must cost speed, not the day's
                prints — an observation missed is gone for good.

    Raises when neither path captures anything. The runner retries three times
    and alerts on the third failure, so a total outage should be loud; a partial
    one should not be, since re-scraping eleven good lanes to chase a twelfth
    would waste the retry budget and the lanes already stored are still correct.
    """
    ticker = fetch_ticker()
    if len(ticker) >= _MIN_TICKER_LANES:
        for code, rate in sorted(ticker.items()):
            upsert_freight_rate(code, date.today(), rate)
            print(f"[freightos] {code}: {rate}")
        missing = sorted(set(FBX_NAMES) - set(ticker))
        print(f"[freightos] {len(ticker)}/{len(FBX_NAMES)} values captured via the ticker")
        if missing:
            print(f"[freightos] not in the ticker payload: {', '.join(missing)}")
        return []

    print(
        f"[freightos] ticker returned {len(ticker)} value(s), below the "
        f"{_MIN_TICKER_LANES} needed — falling back to per-lane pages"
    )

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
