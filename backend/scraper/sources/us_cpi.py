"""
us_cpi.py — Headline US CPI (CPI-U) scraper for the Macro tab.

This is the *broad* US consumer-price index — the BLS "Table 1" release
(https://www.bls.gov/news.release/cpi.t01.htm), not the coffee-specific
retail sub-index that retail_cpi.py already tracks. It gives the
macro-inflation backdrop that frames every commodity position: when
headline/core CPI runs hot, the Fed-path / USD / real-rate regime shifts
under the whole complex.

Four series, all from the BLS public API (Consumer Price Index for All
Urban Consumers, U.S. city average, NOT seasonally adjusted — NSA is the
basis BLS uses for the headline 12-month change quoted in the release):

  all_items — CUUR0000SA0     (All items)
  core      — CUUR0000SA0L1E  (All items less food and energy)
  food      — CUUR0000SAF1    (Food)
  energy    — CUUR0000SA0E    (Energy)

Each is a monthly index; we compute YoY % so the four overlay cleanly.

Cache shape:
  {
    "source":       "US Bureau of Labor Statistics (CPI-U)",
    "source_url":   "https://www.bls.gov/news.release/cpi.t01.htm",
    "last_updated": "YYYY-MM-DD",
    "series": {
      "all_items": {"name": "...", "series_id": "...", "source_url": "...",
                    "monthly": [{"period": "YYYY-MM", "index": float, "yoy_pct": float|null}]},
      "core":      {...}, "food": {...}, "energy": {...}
    }
  }

API access is anonymous (no key needed: 25 queries/day, 10-year window).
A registered BLS API key in the BLS_API_KEY env var lifts the window to
20 years. On any failure the existing cache is retained so the Macro tab
keeps rendering.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "us_cpi.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Content-Type": "application/json",
}

_RELEASE_URL = "https://www.bls.gov/news.release/cpi.t01.htm"

# BLS CPI-U series (NSA — matches the headline 12-month change in cpi.t01).
_SERIES = {
    "all_items": {"id": "CUUR0000SA0",    "name": "All items"},
    "core":      {"id": "CUUR0000SA0L1E", "name": "All items less food & energy (core)"},
    "food":      {"id": "CUUR0000SAF1",   "name": "Food"},
    "energy":    {"id": "CUUR0000SA0E",   "name": "Energy"},
}

# Sub-components for the drill-down view: clicking a category tile in the panel
# shows that category's total plus these breakdowns. All BLS CPI-U expenditure
# series (CUUR0000…, NSA, U.S. city average), the same hierarchy as cpi.t01.
# The fetch is resilient — any id BLS doesn't return is silently omitted, so a
# stale/renamed series degrades the drill-down rather than breaking it.
# Total fetched series (4 top-level + components) stays ≤ 25, the BLS keyless
# per-request cap.
_COMPONENTS: dict[str, list[tuple[str, str, str]]] = {
    "food": [
        ("food_at_home",   "CUUR0000SAF11",  "Food at home"),
        ("food_away",      "CUUR0000SEFV",   "Food away from home"),
        ("cereals_bakery", "CUUR0000SAF111", "Cereals & bakery products"),
        ("meats",          "CUUR0000SAF112", "Meats, poultry, fish & eggs"),
        ("dairy",          "CUUR0000SAF113", "Dairy & related products"),
        ("fruits_veg",     "CUUR0000SAF114", "Fruits & vegetables"),
    ],
    "energy": [
        ("energy_commodities", "CUUR0000SACE",   "Energy commodities"),
        ("gasoline",           "CUUR0000SETB01", "Gasoline (all types)"),
        ("fuel_oil",           "CUUR0000SEHE01", "Fuel oil"),
        ("energy_services",    "CUUR0000SEHF",   "Energy services"),
        ("electricity",        "CUUR0000SEHF01", "Electricity"),
        ("utility_gas",        "CUUR0000SEHF02", "Utility (piped) gas"),
    ],
    "core": [
        ("commodities_core",   "CUUR0000SACL1E", "Commodities less food & energy"),
        ("services_core",      "CUUR0000SASLE",  "Services less energy services"),
        ("shelter",            "CUUR0000SAH1",   "Shelter"),
        ("medical_care",       "CUUR0000SAM",    "Medical care"),
        ("transportation_svc", "CUUR0000SAS4",   "Transportation services"),
        ("new_vehicles",       "CUUR0000SETA01", "New vehicles"),
        ("apparel",            "CUUR0000SAA",    "Apparel"),
    ],
}

_PERIOD_TO_MONTH = {f"M{i:02d}": f"{i:02d}" for i in range(1, 13)}


def _yoy_series(rows: list[dict]) -> list[dict]:
    """Compute YoY % from prior-year same month. Rows have 'period' YYYY-MM and 'index'."""
    by_period = {r["period"]: r["index"] for r in rows if r.get("index") is not None}
    out: list[dict] = []
    for r in rows:
        if r.get("index") is None:
            continue
        y, m = r["period"].split("-")
        prev = f"{int(y) - 1}-{m}"
        prev_idx = by_period.get(prev)
        yoy = round(((r["index"] / prev_idx) - 1.0) * 100.0, 2) if prev_idx else None
        out.append({"period": r["period"], "index": r["index"], "yoy_pct": yoy})
    return out


def _fetch_bls() -> dict[str, dict] | None:
    """One BLS API call for the four top-level CPI-U series + their drill-down
    sub-components.

    Returns the nested series structure (top-level categories, each optionally
    carrying a ``components`` map), or None if the request fails outright.
    Individual series that come back empty are simply omitted.
    """
    api_key = os.environ.get("BLS_API_KEY", "").strip()
    end_year = datetime.utcnow().year
    # Target window ~10y (20y with key). The BLS keyless API silently serves
    # only the first 10 CALENDAR years of an over-long request — this froze
    # the series at 2025-12 for months while every run logged OK. The shared
    # helper chunks requests into windows the API actually honours.
    start_year = end_year - (19 if api_key else 9)

    # Flat fetch list: (request_key, series_id, display_name, parent_or_None).
    wanted: list[tuple[str, str, str, str | None]] = [
        (key, meta["id"], meta["name"], None) for key, meta in _SERIES.items()
    ]
    for parent, comps in _COMPONENTS.items():
        for key, sid, name in comps:
            wanted.append((key, sid, name, parent))

    from scraper.utils.bls import fetch_series, newest_period
    fetched = fetch_series([w[1] for w in wanted], start_year, end_year,
                           api_key=api_key, headers=_HEADERS, tag="us_cpi")
    if fetched is None:
        logger.warning("[us_cpi] all BLS chunks failed")
        return None
    newest = newest_period(fetched)
    logger.info(f"[us_cpi] BLS newest period: {newest}")

    # YoY per series.
    parsed: dict[str, list] = {sid: _yoy_series(rows) for sid, rows in fetched.items()}

    # Assemble the nested structure (top-level first, so a parent node exists
    # before its components are attached).
    result: dict[str, dict] = {}
    for key, sid, name, parent in wanted:
        monthly = parsed.get(sid)
        if not monthly:
            continue
        node = {
            "name":       name,
            "series_id":  sid,
            "source_url": f"https://data.bls.gov/timeseries/{sid}",
            "monthly":    monthly,
        }
        if parent is None:
            result.setdefault(key, {}).update(node)
        else:
            result.setdefault(parent, {}).setdefault("components", {})[key] = node

    # Keep only categories that actually have a top-level series.
    return {k: v for k, v in result.items() if v.get("monthly")} or None


def _build_payload() -> dict | None:
    series = _fetch_bls()
    if not series:
        return None
    return {
        "source":       "US Bureau of Labor Statistics (CPI-U)",
        "source_url":   _RELEASE_URL,
        "last_updated": datetime.utcnow().date().isoformat(),
        "series":       series,
    }


async def run(page, db) -> None:  # noqa: ARG001
    """Fetch headline US CPI, persist to cache + DB news item.

    Mirrors retail_cpi.run: the cache file is gitignored and doesn't survive
    cross-job in CI, so we also stash the full payload in a NewsItem.meta the
    exporter can fall back to.
    """
    try:
        payload = _build_payload()
        if not payload:
            print("[us_cpi] BLS fetch failed — retaining cache")
            return

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        names = ", ".join(payload["series"].keys())
        print(f"[us_cpi] OK: {len(payload['series'])}/4 series ({names}), "
              f"last_updated={payload['last_updated']}")

        if db is not None:
            # Headline-stat body so the Macro news feed / Telegram brief can
            # surface the latest all-items + core YoY.
            parts: list[str] = []
            for key, label in (("all_items", "Headline"), ("core", "Core")):
                monthly = (payload["series"].get(key) or {}).get("monthly") or []
                if not monthly:
                    continue
                yoy = monthly[-1].get("yoy_pct")
                if yoy is None:
                    continue
                parts.append(f"{label}: {'+' if yoy >= 0 else ''}{yoy:.1f}% YoY")
            body = (
                "US CPI (CPI-U) — " + ", ".join(parts)
                if parts
                else f"US CPI series fetched: {names}"
            )

            from scraper.db import upsert_news_item
            upsert_news_item(db, {
                "title":    f"US CPI – {payload['last_updated']}",
                "body":     body,
                "source":   "US CPI",
                "category": "macro",
                "lat":      0.0,
                "lng":      0.0,
                "tags":     ["cpi", "inflation", "macro"],
                "meta":     json.dumps(payload),
            })
    except Exception as e:
        print(f"[us_cpi] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[us_cpi] cache read failed: {e}")
        return None
