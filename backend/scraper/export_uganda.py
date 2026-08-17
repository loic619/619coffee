"""
export_uganda.py
Reads DB and writes frontend/public/data/uganda_supply.json.

Data sources (in priority order):
  UCDA_REPORT  — monthly PDF reports (robusta/arabica split, grades, destinations, exporters, buyers)
  UCDA         — home page Screen 15 price scrape
  NOAA CPC     — ENSO ONI data
  WeatherSnapshot — drought / CSI per region
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, date, datetime
from pathlib import Path

from scraper._export_common import _badge, _worst_risk
from scraper.enso import derive_enso_phase as _derive_enso_phase
from scraper.enso import oni_to_dots as _oni_to_dots
from scraper.validate_export import safe_write_json

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem, WeatherSnapshot

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# One entry per production belt — must match sources/uganda_weather.py.
_UGANDA_REGIONS = [
    "Greater Masaka", "Central", "Western", "Busoga",   # robusta ~85%
    "Mt Elgon", "West Nile", "Rwenzori",                 # arabica ~15%
]

_UGANDA_ENSO_IMPACT = {
    "el-nino": {
        "regions": [
            {"region": "Greater Masaka", "type": "DRY", "note": "Lake Victoria crescent robusta — drought risk in the largest belt"},
            {"region": "Central",        "type": "DRY", "note": "Mityana/Mubende robusta moisture deficit"},
            {"region": "Western",        "type": "DRY", "note": "Bushenyi/Sheema robusta below-avg rainfall"},
            {"region": "Busoga",         "type": "DRY", "note": "eastern robusta lowlands heat stress"},
            {"region": "Mt Elgon",       "type": "DRY", "note": "Bugisu highland arabica moisture stress"},
            {"region": "West Nile",      "type": "DRY", "note": "Okoro arabica — driest belt, most exposed"},
            {"region": "Rwenzori",       "type": "DRY", "note": "Rwenzori arabica rainfall deficit"},
        ],
        "historical_stat": "El Nino years: Uganda coffee output -10 to -20% vs neutral (UCDA)",
    },
    "la-nina": {
        "regions": [
            {"region": "Greater Masaka", "type": "WET", "note": "above-avg rainfall — positive for robusta yield"},
            {"region": "Central",        "type": "WET", "note": "elevated moisture, positive for robusta"},
            {"region": "Western",        "type": "WET", "note": "good conditions for robusta flowering"},
            {"region": "Busoga",         "type": "WET", "note": "above-avg rainfall, flooding risk in lowlands"},
            {"region": "Mt Elgon",       "type": "WET", "note": "good conditions for arabica flowering"},
            {"region": "West Nile",      "type": "WET", "note": "wetter Okoro — relieves the belt's usual deficit"},
            {"region": "Rwenzori",       "type": "WET", "note": "excess moisture — fungal disease risk"},
        ],
        "historical_stat": "La Nina: above-average rainfall — positive for yield; flooding risk in lowlands",
    },
    "neutral": {
        "regions": [
            {"region": "Greater Masaka", "type": "WARM", "note": "near-normal robusta conditions"},
            {"region": "Central",        "type": "WARM", "note": "near-normal robusta conditions"},
            {"region": "Western",        "type": "WARM", "note": "near-normal robusta conditions"},
            {"region": "Busoga",         "type": "WARM", "note": "near-normal conditions"},
            {"region": "Mt Elgon",       "type": "WARM", "note": "near-normal arabica growing conditions"},
            {"region": "West Nile",      "type": "WARM", "note": "near-normal arabica conditions"},
            {"region": "Rwenzori",       "type": "WARM", "note": "near-normal arabica conditions"},
        ],
        "historical_stat": "Neutral ENSO: near-average Uganda coffee output expected",
    },
}




# ── UCDA report assembly ──────────────────────────────────────────────────────

def _load_ucda_reports(db) -> list[dict]:
    """Load all UCDA_REPORT NewsItems, return sorted by month."""
    items = (
        db.query(NewsItem)
        .filter(NewsItem.source == "UCDA_REPORT")
        .order_by(NewsItem.pub_date.asc())
        .all()
    )
    reports = []
    for item in items:
        try:
            data = json.loads(item.meta or "{}")
            if data.get("month"):
                reports.append(data)
        except Exception:
            continue
    return reports


def _build_monthly_series(reports: list[dict]) -> list[dict]:
    """
    Merge monthly data from all reports into a unified series.
    Each report gives current month robusta/arabica/total.
    The trend_12m from the latest report fills in total-only months.
    """
    # Primary: per-report current month data (has robusta/arabica split)
    by_month: dict[str, dict] = {}

    # 1. Fill from trend_12m (totals only) of each report — earlier reports first
    for r in reports:
        for entry in r.get("trend_12m", []):
            m = entry["month"]
            if m not in by_month:
                by_month[m] = {"month": m, "total_bags": entry["total_bags"]}

    # 2. Overwrite/enhance with per-report current month (has split)
    for r in reports:
        s = r.get("summary", {})
        m = r["month"]
        rob  = s.get("robusta_bags")
        arab = s.get("arabica_bags")
        tot  = s.get("total_bags")
        if not tot:
            continue
        entry: dict = {"month": m, "total_bags": int(tot)}
        if rob and arab and tot:
            split_sum = rob + arab
            if abs(split_sum - tot) / tot < 0.05 and rob >= arab:
                entry["robusta_bags"] = int(rob)
                entry["arabica_bags"] = int(arab)
                entry["robusta_pct"] = round(rob / tot * 100, 1)
                entry["arabica_pct"] = round(arab / tot * 100, 1)
        if s.get("avg_price_usd_kg"): entry["avg_price_usd_kg"] = s["avg_price_usd_kg"]
        if s.get("total_value"):      entry["total_value_usd"]  = int(s["total_value"])
        if s.get("yoy_qty_pct") is not None: entry["yoy_pct"] = s["yoy_qty_pct"]
        # Also add prior year same month if present
        if s.get("total_bags_py"):
            py_m   = f"{int(m[:4]) - 1}-{m[5:]}"
            py_tot = s["total_bags_py"]
            if py_m not in by_month or "total_bags" not in by_month.get(py_m, {}):
                py_entry: dict = {"month": py_m, "total_bags": int(py_tot)}
                py_rob  = s.get("robusta_bags_py")
                py_arab = s.get("arabica_bags_py")
                if py_rob and py_arab and py_tot:
                    split_sum = py_rob + py_arab
                    if abs(split_sum - py_tot) / py_tot < 0.05 and py_rob >= py_arab:
                        py_entry["robusta_bags"] = int(py_rob)
                        py_entry["arabica_bags"] = int(py_arab)
                by_month[py_m] = py_entry
        by_month[m] = entry

    # Sort and add YoY where missing
    series = sorted(by_month.values(), key=lambda x: x["month"])

    # Compute YoY for entries that don't have it
    total_map = {e["month"]: e.get("total_bags", 0) for e in series}
    for e in series:
        if "yoy_pct" not in e:
            m = e["month"]
            yr, mo = m[:4], m[5:]
            py_m = f"{int(yr) - 1}-{mo}"
            py_val = total_map.get(py_m)
            if py_val and py_val > 0:
                e["yoy_pct"] = round((e["total_bags"] - py_val) / py_val * 100, 1)

    # Convert to k_bags for UI compatibility (keep original too)
    for e in series:
        e["total_k_bags"] = round(e["total_bags"] / 1000, 1)
        if "robusta_bags" in e:
            e["robusta_k_bags"] = round(e["robusta_bags"] / 1000, 1)
        if "arabica_bags" in e:
            e["arabica_k_bags"] = round(e["arabica_bags"] / 1000, 1)

    return series


# ── Main export function ──────────────────────────────────────────────────────

def export_uganda(db) -> None:

    # 1. Load all UCDA PDF reports
    ucda_reports = _load_ucda_reports(db)
    latest_report = ucda_reports[-1] if ucda_reports else None

    exports_out   = None
    ucda_detail   = None

    if ucda_reports:
        monthly_series = _build_monthly_series(ucda_reports)
        last_month = monthly_series[-1]["month"] if monthly_series else ""

        exports_out = {
            "source":       "UCDA Monthly Reports",
            "last_updated": last_month,
            "unit":         "thousand 60-kg bags",
            "monthly":      monthly_series[-48:],  # last 4 years
        }

        if latest_report:
            ucda_detail = {
                "month":        latest_report["month"],
                "grades":       latest_report.get("grades", []),
                "exporters":    latest_report.get("exporters", []),
                "destinations": latest_report.get("destinations", []),
                "buyers":       latest_report.get("buyers", []),
                "farmgate":     latest_report.get("farmgate", {}),
            }

    # 2. UCDA home page Screen 15 price
    ucda_price_out = None
    try:
        ucda_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "UCDA")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if ucda_item:
            ucda_price_out = json.loads(ucda_item.meta or "{}")
    except Exception as e:
        print(f"  [uganda] UCDA price error: {e}")

    # 3. Weather
    weather_out = None
    try:
        from scraper.sources._weather_baseline import mtd_rain_fields
        from scraper.sources.uganda_weather import _calc_csi

        snapshots = (
            db.query(WeatherSnapshot)
            .filter(WeatherSnapshot.region.in_(_UGANDA_REGIONS))
            .order_by(WeatherSnapshot.scraped_at.desc())
            .all()
        )
        latest_by_region: dict = {}
        for snap in snapshots:
            if snap.region not in latest_by_region:
                latest_by_region[snap.region] = snap

        if latest_by_region:
            regions_out = []
            daily_drought_out = []
            scraped_at_out = None

            for rname in _UGANDA_REGIONS:
                snap = latest_by_region.get(rname)
                if snap is None:
                    continue
                if scraped_at_out is None and snap.scraped_at:
                    scraped_at_out = snap.scraped_at.isoformat() + "Z"
                daily = snap.daily_data or []
                week  = daily[:7]
                drought_codes = [d.get("drought_risk", "-") for d in week]
                csi = _calc_csi(daily)
                regions_out.append({
                    "name":          rname,
                    "drought":       _badge(_worst_risk(drought_codes)),
                    "csi_30d":       csi["csi_30d"],
                    "csi_60d":       csi["csi_60d"],
                    "csi_30d_level": csi["csi_30d_level"],
                    "csi_60d_level": csi["csi_60d_level"],
                })
                if rname == "Mt Elgon":
                    regions_out[-1].update(mtd_rain_fields(daily, "uganda"))
                drought_days = [d.get("drought_risk", "-") for d in daily]
                if any(c != "-" for c in drought_days):
                    daily_drought_out.append({"region": rname, "days": drought_days})

            if regions_out:
                weather_out = {
                    "scraped_at":    scraped_at_out or date.today().isoformat(),
                    "regions":       regions_out,
                    "daily_drought": daily_drought_out,
                }
    except Exception as e:
        print(f"  [uganda] weather error: {e}")

    # 4. ENSO
    enso_out = None
    try:
        enso_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "NOAA CPC")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if enso_item:
            meta = json.loads(enso_item.meta or "{}")
            oni_history = meta.get("oni_history", [])
            if oni_history:
                phase, intensity, current_oni = _derive_enso_phase(oni_history)
                dots = _oni_to_dots(current_oni)
                impact_def = _UGANDA_ENSO_IMPACT.get(phase, _UGANDA_ENSO_IMPACT["neutral"])
                regional_impact = [{**r, "dots": dots} for r in impact_def["regions"]]
                recent_vals = [p["value"] for p in oni_history[-5:]]
                trend = (recent_vals[-1] - recent_vals[0]) if len(recent_vals) >= 2 else 0
                if phase == "neutral":     forecast_direction = "Neutral — no strong signal"
                elif phase == "el-nino":   forecast_direction = "El Nino weakening" if trend < -0.15 else "El Nino ongoing"
                else:                      forecast_direction = "La Nina weakening toward neutral" if trend > 0.15 else "La Nina ongoing"
                confirmed = [p for p in oni_history if not p.get("preliminary")]
                peak_month = max(confirmed or oni_history, key=lambda p: abs(p["value"]))["month"] if (confirmed or oni_history) else ""
                enso_out = {
                    "phase": phase, "intensity": intensity, "oni": current_oni,
                    "peak_month": peak_month, "forecast_direction": forecast_direction,
                    "oni_history": oni_history, "oni_forecast": meta.get("oni_forecast", []),
                    "regional_impact": regional_impact, "historical_stat": impact_def["historical_stat"],
                    "last_updated": str(enso_item.pub_date)[:10],
                }
    except Exception as e:
        print(f"  [uganda] ENSO error: {e}")

    result = {
        "country":    "uganda",
        "scraped_at": datetime.now(UTC).isoformat(),
        "exports":    exports_out,
        "ucda_detail": ucda_detail,
        "ucda_price": ucda_price_out,
        "weather":    weather_out,
        "enso":       enso_out,
        "harvest_cal": {
            "main_crop_harvest":   "Oct-Feb",
            "main_crop_flowering": "Apr-Jun",
            "fly_crop_harvest":    "Apr-Jun",
            "fly_crop_flowering":  "Oct-Dec",
            "description": (
                "Uganda has two crop cycles. Main crop Oct-Feb (robusta & arabica); "
                "fly crop Apr-Jun. 85% robusta (Screen 15 benchmark), 15% arabica."
            ),
        },
        "production_mix": {
            # Measured, not assumed: 78 months of UCDA by-type export data in
            # uganda_monthly.json give robusta 85.6% / arabica 14.4% (last 12M
            # 85.4/14.6 — the ratio is stable). The previous 75/25 overstated
            # arabica by ~10pp.
            "robusta_pct": 85,
            "arabica_pct": 15,
            "note": (
                "Uganda is Africa's leading robusta exporter. Screen 15 benchmark grade. "
                "Split measured from UCDA monthly by-type exports."
            ),
            "key_regions": {
                "robusta": ["Greater Masaka", "Central", "Western", "Busoga"],
                # Kasese sits in the Rwenzori arabica belt (UCDA maps it an
                # arabica district) — it used to be listed under robusta.
                "arabica": ["Mt Elgon", "West Nile", "Rwenzori"],
            },
        },
    }

    path = OUT_DIR / "uganda_supply.json"
    safe_write_json(path, result, ensure_ascii=False)
    n_months = len((exports_out or {}).get("monthly", []))
    n_exp    = len((ucda_detail or {}).get("exporters", []))
    n_dst    = len((ucda_detail or {}).get("destinations", []))
    print(
        f"  uganda_supply.json -> {n_months} months, "
        f"{n_exp} exporters, {n_dst} destinations, "
        f"weather:{weather_out is not None} enso:{enso_out is not None}"
    )


def main():
    print("Exporting Uganda supply JSON...")
    db = SessionLocal()
    try:
        export_uganda(db)
    finally:
        db.close()
    print("Done")


if __name__ == "__main__":
    main()
