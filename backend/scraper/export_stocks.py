"""
export_stocks.py
Reads DB + scraper caches and writes frontend/public/data/demand_stocks.json.

Sections:
  eu     — USDA FAS PSD annual EU green-coffee figures, from cache
  japan  — USDA FAS PSD annual Japan green-coffee figures, from cache

NB: ECF is a separate, self-contained flow ('3.4 – ECF stocks' →
ecf_history.json, read directly by the front-end) and is deliberately not part
of demand_stocks.json anymore.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem
from scraper.sources import ajca, population, psd_coffee, un_wpp_age, usda_gain_pdf
from scraper.validate_export import safe_write_json

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

def _psd_section(market_key: str, db_data: dict | None) -> dict | None:
    if not db_data:
        return None
    market = db_data.get("markets", {}).get(market_key)
    if not market:
        return None
    return {
        "source":                db_data.get("source", "USDA FAS PSD"),
        "last_updated":          db_data.get("last_updated"),
        "annual":                market.get("annual", []),
        "latest_year":           market.get("latest_year"),
        "latest_imports_mt":     market.get("latest_imports_mt"),
        "latest_consumption_mt": market.get("latest_consumption_mt"),
        "latest_stocks_mt":      market.get("latest_stocks_mt"),
    }


def _build_ajca(db=None) -> dict | None:
    try:
        data = ajca.fetch_latest()
    except Exception as e:
        print(f"  [stocks] AJCA fetch error: {e}")
        data = None
    if not data and db is not None:
        # Cache file missing (export runs on a fresh runner) — fall back to DB
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "AJCA")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if item and item.meta:
            try:
                data = json.loads(item.meta)
                print("  [stocks] AJCA: loaded from DB fallback")
            except Exception:
                pass
    if not data:
        return None
    return {
        "source":                 data.get("source", "AJCA"),
        "source_url":             data.get("source_url"),
        "last_updated":           data.get("last_updated"),
        "latest_year":            data.get("latest_year"),
        "latest_imports_mt":      data.get("latest_imports_mt"),
        "latest_consumption_mt":  data.get("latest_consumption_mt"),
        "monthly_imports_pdf":    data.get("monthly_imports_pdf"),
        "monthly_exports_pdf":    data.get("monthly_exports_pdf"),
        "supply_demand_pdf":      data.get("supply_demand_pdf"),
        "yearly_imports_pdf":     data.get("yearly_imports_pdf"),
        "latest_origin_breakdown": data.get("latest_origin_breakdown"),
        "latest_origin_pdf":       data.get("latest_origin_pdf"),
    }


def _merge_gain_into_producer(producer: dict, gain_block: dict | None) -> dict:
    """Layer the latest GAIN PDF forecast onto a PSD CSV producer block.

    USDA's downloadable PSD CSV currently stops at the last realized
    marketing year. The forward-year forecast lives in the GAIN narrative
    PDF (e.g. BR2026-0025) — parsed by scraper/sources/usda_gain_pdf.py
    into the same {annual: [...], latest_*} shape.

    Merge rules:
      • Years already present in `producer.annual` win — the CSV is the
        canonical realized series.
      • Forward years (those NOT in the CSV) are appended from `gain_block`.
      • `latest_*` summary fields are recomputed from the merged tail.
    """
    if not gain_block:
        return producer
    csv_years = {row.get("year") for row in producer.get("annual") or []}
    forward_rows = [r for r in (gain_block.get("annual") or [])
                    if r.get("year") and r["year"] not in csv_years]
    if not forward_rows:
        return producer

    merged_annual = list(producer.get("annual") or []) + forward_rows
    merged_annual.sort(key=lambda r: str(r.get("year") or ""))
    latest = merged_annual[-1]

    out = dict(producer)
    out["annual"] = merged_annual
    out["latest_year"]           = latest.get("year")
    out["latest_production_mt"]  = latest.get("production_mt")  or out.get("latest_production_mt")
    out["latest_exports_mt"]     = latest.get("exports_mt")     or out.get("latest_exports_mt")
    out["latest_consumption_mt"] = latest.get("consumption_mt") or out.get("latest_consumption_mt")
    out["latest_stocks_mt"]      = latest.get("stocks_mt")      or out.get("latest_stocks_mt")
    out["forecast_source"]       = gain_block.get("source_pdf") or gain_block.get("source")
    return out


def _psd_producers(psd_data: dict | None) -> dict | None:
    """Return {country: {latest_year, production_mt, exports_mt, ...}} summary.

    Merges GAIN PDF forecasts on top of the PSD CSV series, so forward
    years USDA only publishes in the GAIN narrative reach demand_stocks.json.
    Cache misses fall back to PSD CSV only — the merge never blocks export."""
    if not psd_data:
        return None
    producers = psd_data.get("producers")
    if not producers:
        return None
    out: dict[str, dict] = {}
    for country, d in producers.items():
        gain_block = usda_gain_pdf.load_cached(country)
        merged = _merge_gain_into_producer(d, gain_block)
        out[country] = {
            "latest_year":            merged.get("latest_year"),
            "latest_production_mt":   merged.get("latest_production_mt"),
            "latest_exports_mt":      merged.get("latest_exports_mt"),
            "latest_consumption_mt":  merged.get("latest_consumption_mt"),
            "latest_stocks_mt":       merged.get("latest_stocks_mt"),
            "annual":                 merged.get("annual", []),
            "forecast_source":        merged.get("forecast_source"),
        }
    return out or None


# Countries surfaced in the Growth Markets panel — emerging consumer markets
# plus producer countries with meaningful domestic consumption. Each entry's
# source block is whichever of psd_data["markets"] or psd_data["producers"]
# carries it (the PSD scraper parses both with the same shape).
_GROWTH_MARKETS = [
    # (short, display name, PSD block, demand group, tea-culture flag)
    #
    # group — how the Consumption sub-tab clusters the ranking:
    #   "producing"  origin countries whose own domestic demand matters
    #   "historical" mature demand (Europe, North America, Japan, Oceania)
    #   "growing"    emerging consumer markets
    # tea_culture — True where hot-drink culture is tea-dominant (or coffee is
    #   a recent arrival), so a low per-capita number is a starting point rather
    #   than a ceiling. Judgement call, documented not measured.
    ("usa",          "United States",  "markets",   "historical", False),
    ("eu",           "European Union", "markets",   "historical", False),
    ("japan",        "Japan",          "markets",   "historical", False),
    ("uk",           "United Kingdom", "markets",   "historical", True),
    ("canada",       "Canada",         "markets",   "historical", False),
    ("australia",    "Australia",      "markets",   "historical", False),
    ("new_zealand",  "New Zealand",    "markets",   "historical", False),
    ("switzerland",  "Switzerland",    "markets",   "historical", False),
    ("norway",       "Norway",         "markets",   "historical", False),

    ("china",        "China",          "markets",   "growing", True),
    ("india",        "India",          "producers", "growing", True),
    ("korea",        "South Korea",    "markets",   "growing", True),
    ("russia",       "Russia",         "markets",   "growing", True),
    ("turkey",       "Turkey",         "markets",   "growing", True),
    ("philippines",  "Philippines",    "markets",   "growing", False),
    ("egypt",        "Egypt",          "markets",   "growing", True),
    ("algeria",      "Algeria",        "markets",   "growing", False),
    ("morocco",      "Morocco",        "markets",   "growing", True),
    ("saudi_arabia", "Saudi Arabia",   "markets",   "growing", False),
    ("jordan",       "Jordan",         "markets",   "growing", True),
    ("iran",         "Iran",           "markets",   "growing", True),
    ("south_africa", "South Africa",   "markets",   "growing", True),
    ("ukraine",      "Ukraine",        "markets",   "growing", True),
    ("serbia",       "Serbia",         "markets",   "growing", False),
    ("bosnia",       "Bosnia & Herz.", "markets",   "growing", False),
    ("armenia",      "Armenia",        "markets",   "growing", False),
    ("kazakhstan",   "Kazakhstan",     "markets",   "growing", True),
    ("thailand",     "Thailand",       "markets",   "growing", True),
    ("malaysia",     "Malaysia",       "markets",   "growing", True),
    ("taiwan",       "Taiwan",         "markets",   "growing", True),
    ("argentina",    "Argentina",      "markets",   "growing", True),
    ("chile",        "Chile",          "markets",   "growing", False),

    ("brazil",       "Brazil",         "producers", "producing", False),
    ("indonesia",    "Indonesia",      "producers", "producing", True),
    ("vietnam",      "Vietnam",        "producers", "producing", True),
    ("ethiopia",     "Ethiopia",       "producers", "producing", False),
    ("mexico",       "Mexico",         "producers", "producing", False),
    ("colombia",     "Colombia",       "producers", "producing", False),
    ("peru",         "Peru",           "producers", "producing", False),
    ("honduras",     "Honduras",       "producers", "producing", False),
    ("guatemala",    "Guatemala",      "producers", "producing", False),
    ("nicaragua",    "Nicaragua",      "producers", "producing", False),
    ("costa_rica",   "Costa Rica",     "producers", "producing", False),
    ("uganda",       "Uganda",         "producers", "producing", True),
    ("tanzania",     "Tanzania",       "producers", "producing", True),
    ("ivory_coast",  "Côte d'Ivoire",  "producers", "producing", False),
    # Origins outside the balance-sheet roster, so parsed from the consuming
    # block — same shape, they just don't feed build_balance_sheets.
    ("venezuela",    "Venezuela",      "markets",   "producing", False),
    ("ecuador",      "Ecuador",        "markets",   "producing", False),
    ("el_salvador",  "El Salvador",    "markets",   "producing", False),
]


def _growth_markets(psd_data: dict | None, pop_data: dict | None) -> list[dict] | None:
    """Ranked consumption + per-capita series for every tracked consuming market.

    Each row carries its demand `group` and a `tea_culture` flag so the
    Consumption sub-tab can cluster the ranking without duplicating the
    taxonomy in the frontend."""
    if not psd_data:
        return None

    markets   = psd_data.get("markets", {}) or {}
    producers = psd_data.get("producers", {}) or {}
    pop_countries = (pop_data or {}).get("countries", {}) or {}

    out: list[dict] = []
    for short, name, block, group, tea_culture in _GROWTH_MARKETS:
        src = (markets if block == "markets" else producers).get(short)
        if not src or not src.get("latest_consumption_mt"):
            continue

        consumption_mt = src["latest_consumption_mt"]
        pop_entry = pop_countries.get(short)
        latest_pop = pop_entry.get("latest_population") if pop_entry else None

        # Per-capita in kg/year (consumption_mt * 1000 kg per MT) / population.
        per_capita_kg = None
        if latest_pop and latest_pop > 0:
            per_capita_kg = round(consumption_mt * 1000.0 / latest_pop, 2)

        out.append({
            "short":            short,
            "name":             name,
            "group":            group,          # producing | historical | growing
            "tea_culture":      tea_culture,
            "latest_year":      src.get("latest_year"),
            "consumption_mt":   consumption_mt,
            "population":       latest_pop,
            "per_capita_kg":    per_capita_kg,
            "annual":           src.get("annual", []),
        })

    out.sort(key=lambda r: -(r["consumption_mt"] or 0))
    return out or None


def _age_cohort(wpp_data: dict | None) -> dict | None:
    """Slim 18+ cohort payload for the AgeCohortPanel."""
    if not wpp_data:
        return None
    countries = wpp_data.get("countries", {}) or {}
    if not countries:
        return None
    return {
        "source":        wpp_data.get("source"),
        "last_updated":  wpp_data.get("last_updated"),
        "age_threshold": wpp_data.get("age_threshold", 18),
        "countries":     {
            short: {
                "name":         d.get("name"),
                "location_id":  d.get("location_id"),
                "annual":       d.get("annual", []),
                "latest_year":  d.get("latest_year"),
                "latest_pop":   d.get("latest_pop"),
            }
            for short, d in countries.items()
        },
    }


# USDA PSD labels a marketing year by the calendar year it BEGINS: Market_Year
# 2023 is the 2023/24 season. The June release adds the newest year, so a file
# stamped June 2026 carries 2026 — the 2026/27 FORECAST, not an actual.
def _psd_year(marketing_year: str | None) -> str | None:
    """"2023/24" -> "2023" (the PSD Market_Year label for that season)."""
    m = re.match(r"(\d{4})", marketing_year or "")
    return m.group(1) if m else None


def _season(psd_year: str | None) -> str | None:
    """"2023" -> "2023/24"."""
    if not psd_year or not str(psd_year).isdigit():
        return None
    y = int(psd_year)
    return f"{y}/{str(y + 1)[-2:]}"


def _sum_consumption(series: list[dict], year: str) -> tuple[int, int]:
    """Total consumption across markets for ONE PSD market year, and how many
    markets reported it. Reads each market's own annual series rather than its
    headline latest value, so every country in the total is the same season."""
    total = count = 0
    for d in series:
        for a in d.get("annual") or []:
            if str(a.get("year")) != year:
                continue
            c = a.get("consumption_mt")
            if c:
                total += c
                count += 1
            break
    return total, count


def _world_consumption(psd_data: dict | None) -> dict | None:
    """USDA PSD consumption summed across all tracked markets + producers,
    against a manually-maintained ICO world reference.

    The coverage % compares LIKE SEASONS. It used to divide the sum of each
    market's latest value — USDA's newest forecast year — by an ICO total two
    to three seasons older, and reported 100.5%: a claim that the app tracks
    all of world demand. Matched season-for-season the same 49 countries cover
    91.7% of ICO 2023/24, so roughly 880 kt of world demand is NOT counted.
    The forecast is still published alongside, labelled as one.

    ICO reference is updated by editing this dict when ICO publishes their
    annual statistics (typically May/June for the prior marketing year).
    """
    if not psd_data:
        return None
    markets   = psd_data.get("markets", {}) or {}
    producers = psd_data.get("producers", {}) or {}
    series    = list({**markets, **producers}.values())
    if not series:
        return None

    # ICO published "Total World Consumption" — marketing year 2023/24,
    # from the ICO Coffee Market Report 2024. Update annually.
    ico_reference = {
        "marketing_year":         "2023/24",
        "world_consumption_mt":   10_620_000,   # ≈ 177M 60-kg bags
        "source":                 "ICO Coffee Market Report",
        "source_url":             "https://www.ico.org/coffee-market-report.asp",
        "note":                   "Manually updated when ICO publishes annual statistics.",
    }

    latest_year = None
    for d in series:
        y = d.get("latest_year")
        if y and (latest_year is None or str(y) > str(latest_year)):
            latest_year = str(y)

    # The season the coverage % is computed on — the one ICO also reports.
    matched_year = _psd_year(ico_reference["marketing_year"])
    matched_mt, matched_n = _sum_consumption(series, matched_year) if matched_year else (0, 0)
    latest_mt,  latest_n  = _sum_consumption(series, latest_year) if latest_year else (0, 0)

    if matched_mt <= 0:
        # No overlap with the ICO season (PSD history too short). Report the
        # latest sum with no coverage claim rather than a mismatched ratio.
        if latest_mt <= 0:
            return None
        return {
            "tracked_consumption_mt": latest_mt,
            "tracked_countries":      latest_n,
            "tracked_year":           latest_year,
            "tracked_marketing_year": _season(latest_year),
            "tracked_latest_year":    latest_year,
            "latest_consumption_mt":  latest_mt,
            "latest_marketing_year":  _season(latest_year),
            "latest_is_forecast":     True,
            "ico_reference":          ico_reference,
            "tracked_vs_ico_pct":     None,
        }

    coverage_pct = round(matched_mt / ico_reference["world_consumption_mt"] * 100.0, 1)

    return {
        # Coverage basis — same season on both sides of the ratio.
        "tracked_consumption_mt": matched_mt,
        "tracked_countries":      matched_n,
        "tracked_year":           matched_year,
        "tracked_marketing_year": ico_reference["marketing_year"],
        "tracked_vs_ico_pct":     coverage_pct,
        # USDA's newest year, published alongside and flagged as a forecast so
        # nothing downstream can quietly compare it to the ICO actual again.
        "tracked_latest_year":    latest_year,
        "latest_consumption_mt":  latest_mt,
        "latest_countries":       latest_n,
        "latest_marketing_year":  _season(latest_year),
        "latest_is_forecast":     bool(latest_year and matched_year and latest_year > matched_year),
        "ico_reference":          ico_reference,
    }


def _populations(pop_data: dict | None) -> dict | None:
    """Slim population payload — only what the frontend needs."""
    if not pop_data:
        return None
    countries = pop_data.get("countries", {})
    if not countries:
        return None
    return {
        "source":       pop_data.get("source"),
        "last_updated": pop_data.get("last_updated"),
        "countries":    {
            short: {
                "name":              d.get("name"),
                "iso3":              d.get("iso3"),
                "latest_year":       d.get("latest_year"),
                "latest_population": d.get("latest_population"),
            }
            for short, d in countries.items()
        },
    }


def export_stocks(db) -> None:
    try:
        psd_data = psd_coffee.fetch_latest()
    except Exception as e:
        print(f"  [stocks] PSD fetch error: {e}")
        psd_data = None
    if not psd_data:
        # Cache file missing (export on fresh runner) — fall back to DB
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "PSD Coffee")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if item and item.meta:
            try:
                psd_data = json.loads(item.meta)
                print("  [stocks] PSD Coffee: loaded from DB fallback")
            except Exception:
                pass

    try:
        pop_data = population.fetch_latest()
    except Exception as e:
        print(f"  [stocks] population fetch error: {e}")
        pop_data = None
    if not pop_data:
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "World Bank")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if item and item.meta:
            try:
                pop_data = json.loads(item.meta)
                print("  [stocks] population: loaded from DB fallback")
            except Exception:
                pass

    try:
        wpp_data = un_wpp_age.fetch_latest()
    except Exception as e:
        print(f"  [stocks] UN WPP fetch error: {e}")
        wpp_data = None
    if not wpp_data:
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "UN WPP")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if item and item.meta:
            try:
                wpp_data = json.loads(item.meta)
                print("  [stocks] UN WPP: loaded from DB fallback")
            except Exception:
                pass

    # NB: ECF is intentionally NOT here. It is a self-contained flow owned by
    # the '3.4 – ECF stocks' scraper, which writes frontend/public/data/
    # ecf_history.json (read directly by the front-end). Do not re-add an "ecf"
    # key — that would resurrect the duplicate the dismantling removed.
    result = {
        "generated_at":   datetime.utcnow().isoformat() + "Z",
        "eu":             _psd_section("eu",    psd_data),
        "japan":          _psd_section("japan", psd_data),
        "usa":            _psd_section("usa",   psd_data),
        "ajca":           _build_ajca(db),
        "producers":      _psd_producers(psd_data),
        "growth_markets": _growth_markets(psd_data, pop_data),
        "populations":    _populations(pop_data),
        "age_cohort_18plus": _age_cohort(wpp_data),
        "world_consumption": _world_consumption(psd_data),
    }
    path = OUT_DIR / "demand_stocks.json"
    safe_write_json(path, result, ensure_ascii=False)
    prod_count = len(result["producers"] or {})
    growth_count = len(result["growth_markets"] or [])
    print(
        f"  demand_stocks.json -> "
        f"eu:{result['eu'] is not None} "
        f"japan:{result['japan'] is not None} "
        f"usa:{result['usa'] is not None} "
        f"ajca:{result['ajca'] is not None} "
        f"producers:{prod_count} "
        f"growth_markets:{growth_count} "
        f"populations:{(result['populations'] or {}).get('countries', {}) and len((result['populations'] or {}).get('countries', {}))}"
    )


def main():
    print("Exporting demand stocks JSON...")
    db = SessionLocal()
    try:
        export_stocks(db)
    finally:
        db.close()
    print("Done")


if __name__ == "__main__":
    main()
