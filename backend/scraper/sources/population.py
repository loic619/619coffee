"""
population.py — World Bank total-population scraper for the demand-tab
Growth Markets panel.

Fetches annual SP.POP.TOTL (total population) for 15 countries / aggregates
covering the mature consumer set (EU, Japan, USA) plus the 12 emerging-
market countries we surface in the per-capita coffee-consumption ranking.

World Bank API is free, no key needed, and updates a couple times per year.
Daily polling is harmless (small payload, gentle). On failure the cache is
retained so the demand tab still renders.

Cache shape:
  {
    "source":       "World Bank API",
    "last_updated": "2026-05-14",
    "countries": {
      "china":   {"name": "China",  "iso3": "CHN", "annual": [{"year": "2024", "population": 1410000000}, ...]},
      ...
    }
  }
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "population.json"

# The cache above is gitignored, so it exists only inside the job that wrote it.
# demand_stocks.json is rebuilt by FOUR workflows and only one of them runs this
# scraper — the other three found no cache and published `populations: null`,
# blanking the demand tab's per-capita chart within hours of every refresh
# (2026-09-02 07:29 wrote 48 countries; the next export, 03:00 the following
# morning, wrote null). So the payload is also published as a normal committed
# data file, which is present at checkout for every export whether or not the
# World Bank was contacted in that job.
_PUBLISHED_PATH = (Path(__file__).resolve().parents[3]
                   / "frontend" / "public" / "data" / "populations.json")

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# (short_key, display_name, World-Bank-code). EUU = European Union (28 then 27).
_COUNTRIES = [
    ("eu",          "European Union",  "EUU"),
    ("japan",       "Japan",           "JPN"),
    ("usa",         "United States",   "USA"),
    ("china",       "China",           "CHN"),
    ("india",       "India",           "IND"),
    ("brazil",      "Brazil",          "BRA"),
    ("indonesia",   "Indonesia",       "IDN"),
    ("vietnam",     "Vietnam",         "VNM"),
    ("russia",      "Russia",          "RUS"),
    ("mexico",      "Mexico",          "MEX"),
    ("turkey",      "Turkey",          "TUR"),
    ("philippines", "Philippines",     "PHL"),
    ("egypt",       "Egypt",           "EGY"),
    ("korea",       "South Korea",     "KOR"),
    ("ethiopia",    "Ethiopia",        "ETH"),
    # Aug 2026: extended to cover every market the Consumption ranking shows,
    # so per-capita kg is populated for all of them rather than the original
    # fifteen. One World Bank call each, on a monthly job. Taiwan is absent
    # deliberately — the World Bank publishes no series for it, so its
    # per-capita stays null rather than being filled from a mismatched source.
    ("uk",           "United Kingdom",  "GBR"),
    ("canada",       "Canada",          "CAN"),
    ("australia",    "Australia",       "AUS"),
    ("new_zealand",  "New Zealand",     "NZL"),
    ("switzerland",  "Switzerland",     "CHE"),
    ("norway",       "Norway",          "NOR"),
    ("ukraine",      "Ukraine",         "UKR"),
    ("serbia",       "Serbia",          "SRB"),
    ("bosnia",       "Bosnia & Herz.",  "BIH"),
    ("armenia",      "Armenia",         "ARM"),
    ("kazakhstan",   "Kazakhstan",      "KAZ"),
    ("algeria",      "Algeria",         "DZA"),
    ("morocco",      "Morocco",         "MAR"),
    ("saudi_arabia", "Saudi Arabia",    "SAU"),
    ("jordan",       "Jordan",          "JOR"),
    ("iran",         "Iran",            "IRN"),
    ("south_africa", "South Africa",    "ZAF"),
    ("thailand",     "Thailand",        "THA"),
    ("malaysia",     "Malaysia",        "MYS"),
    ("argentina",    "Argentina",       "ARG"),
    ("chile",        "Chile",           "CHL"),
    ("colombia",     "Colombia",        "COL"),
    ("peru",         "Peru",            "PER"),
    ("honduras",     "Honduras",        "HND"),
    ("guatemala",    "Guatemala",       "GTM"),
    ("nicaragua",    "Nicaragua",       "NIC"),
    ("costa_rica",   "Costa Rica",      "CRI"),
    ("uganda",       "Uganda",          "UGA"),
    ("tanzania",     "Tanzania",        "TZA"),
    ("ivory_coast",  "Côte d'Ivoire",   "CIV"),
    ("venezuela",    "Venezuela",       "VEN"),
    ("ecuador",      "Ecuador",         "ECU"),
    ("el_salvador",  "El Salvador",     "SLV"),
]

# Span chosen so the chart can show a 2000–latest history; World Bank
# publishes through prior year ~Q2 of the current year.
_START_YEAR = 2000
_END_YEAR   = 2030


def _fetch_country(iso3: str) -> list[dict] | None:
    url = (
        f"https://api.worldbank.org/v2/country/{iso3}/indicator/SP.POP.TOTL"
        f"?format=json&date={_START_YEAR}:{_END_YEAR}&per_page=100"
    )
    try:
        r = requests.get(url, headers=_HEADERS, timeout=20)
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.warning(f"[population] {iso3} fetch failed: {e}")
        return None

    if not isinstance(body, list) or len(body) < 2 or not isinstance(body[1], list):
        return None

    rows = []
    for entry in body[1]:
        val = entry.get("value")
        year = entry.get("date")
        if val is None or year is None:
            continue
        try:
            rows.append({"year": str(year), "population": int(val)})
        except (TypeError, ValueError):
            continue
    rows.sort(key=lambda r_: r_["year"])
    return rows or None


def _build_payload() -> dict | None:
    countries: dict[str, dict] = {}
    for short, name, iso3 in _COUNTRIES:
        annual = _fetch_country(iso3)
        if annual:
            latest = annual[-1]
            countries[short] = {
                "name":              name,
                "iso3":              iso3,
                "annual":            annual,
                "latest_year":       latest["year"],
                "latest_population": latest["population"],
            }
        else:
            logger.warning(f"[population] no data for {short} ({iso3})")

    if not countries:
        return None
    return {
        "source":       "World Bank API (SP.POP.TOTL)",
        "last_updated": datetime.utcnow().date().isoformat(),
        "countries":    countries,
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        payload = _build_payload()
        if not payload:
            print("[population] no data fetched — retaining cache")
            return

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        _PUBLISHED_PATH.parent.mkdir(parents=True, exist_ok=True)
        _PUBLISHED_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False),
                                   encoding="utf-8")

        n = len(payload["countries"])
        print(f"[population] OK: {n}/{len(_COUNTRIES)} countries, latest year {payload['last_updated']}")

        if db is not None:
            from scraper.db import upsert_news_item
            upsert_news_item(db, {
                "title":    f"World Bank Population – {payload['last_updated']}",
                "body":     f"Tracked {n} countries for demand-tab per-capita normalization.",
                "source":   "World Bank",
                "category": "demand",
                "lat":      0.0,
                "lng":      0.0,
                "tags":     ["population", "demand", "world-bank"],
                "meta":     json.dumps(payload),
            })
    except Exception as e:
        print(f"[population] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    """Freshest available payload: this job's cache first, else the committed
    file. Never returns None just because the scraper did not run here."""
    for path, label in ((_CACHE_PATH, "cache"), (_PUBLISHED_PATH, "published")):
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("countries"):
                return data
        except Exception as e:
            logger.warning(f"[population] {label} read failed: {e}")
    return None
