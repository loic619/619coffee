"""
export_honduras.py
Reads DB and writes frontend/public/data/honduras_supply.json.

Sections:
  exports        — ICO monthly green coffee exports
  ihcafe_price   — IHCAFE reference price in HNL/quintal (if scraped)
  weather        — drought + frost risk per region (WeatherSnapshot)
  enso           — NOAA ONI + Honduras-specific regional impact
  harvest_cal    — static single-harvest calendar
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
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

_HONDURAS_REGIONS = ["Copán", "Santa Bárbara", "Montecillos", "El Paraíso", "Agalta"]

_HONDURAS_ENSO_IMPACT = {
    "el-nino": {
        "regions": [
            {"region": "Copán",         "type": "DRY",  "note": "dry season extends, moisture deficit amplified"},
            {"region": "Santa Bárbara", "type": "DRY",  "note": "below-avg rainfall, stress at flowering"},
            {"region": "Montecillos",   "type": "DRY",  "note": "Pacific corridor dries significantly"},
            {"region": "El Paraíso",    "type": "DRY",  "note": "Caribbean side reduced rainfall"},
            {"region": "Agalta",        "type": "DRY",  "note": "extended dry season, soil moisture deficit"},
        ],
        "historical_stat": "El Niño years: Honduras coffee output −10 to −20% vs neutral (IHCAFE / ICO)",
    },
    "la-nina": {
        "regions": [
            {"region": "Copán",         "type": "WET",  "note": "above-avg rainfall, good moisture for flowering"},
            {"region": "Santa Bárbara", "type": "WET",  "note": "elevated rainfall, landslide/flood risk"},
            {"region": "Montecillos",   "type": "WET",  "note": "generally positive for yield"},
            {"region": "El Paraíso",    "type": "WET",  "note": "Caribbean rains increase, may delay harvest"},
            {"region": "Agalta",        "type": "WET",  "note": "above-avg rainfall, quality risk if excess"},
        ],
        "historical_stat": "La Niña brings above-average rainfall — positive for yield but harvest delays possible",
    },
    "neutral": {
        "regions": [
            {"region": r, "type": "WARM", "note": "near-normal conditions"}
            for r in _HONDURAS_REGIONS
        ],
        "historical_stat": "Neutral ENSO: near-average Honduras arabica output expected",
    },
}






def _current_harvest_phase() -> str:
    mo = date.today().month
    if mo in (10, 11, 12, 1, 2): return "harvest"
    if mo in (4, 5, 6):          return "flowering"
    if mo == 9:                   return "pre-harvest"
    return "development"


def export_honduras(db) -> None:
    # ── 1. Exports (ICO) ──────────────────────────────────────────────────────
    exports_out = None
    try:
        ico_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "ICO", NewsItem.title.like("Honduras%"))
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if ico_item:
            meta = json.loads(ico_item.meta or "{}")
            exports_out = {
                "source":       "ICO",
                "last_updated": meta.get("last_updated", ""),
                "unit":         meta.get("unit", "thousand 60-kg bags"),
                "monthly":      meta.get("monthly", []),
            }
    except Exception as e:
        print(f"  [honduras] exports section error: {e}")

    # Fall back to USDA PSD annual exports when ICO monthly data is absent
    # (it never lands for this origin — see psd_country_exports).
    if exports_out is None:
        try:
            from scraper.psd_country_exports import psd_country_exports
            exports_out = psd_country_exports(db, "honduras")
        except Exception as e:
            print(f"  [honduras] PSD exports fallback error: {e}")

    # ── 2. IHCAFE price ───────────────────────────────────────────────────────
    # The IHCAFE scraper was retired 2026-08-14 (ihcafe.hn still serves the page
    # but no longer carries the reference-price element, so it returned 0 items
    # on every run). Nothing writes source="IHCAFE" NewsItems any more, and the
    # query here was unbounded by date — left in place it would eventually
    # resurface a months-old price as if it were current. The key stays in the
    # payload as null: HondurasFarmerEconomics.tsx already renders that block
    # behind an `{ihcafe_price ? ...}` guard, and honduras_supply.json has been
    # shipping null for it already.
    ihcafe_out = None

    # ── 3. Weather ────────────────────────────────────────────────────────────
    weather_out = None
    try:
        from scraper.sources._weather_baseline import mtd_rain_fields
        from scraper.sources.honduras_weather import _calc_csi

        snapshots = (
            db.query(WeatherSnapshot)
            .filter(WeatherSnapshot.region.in_(_HONDURAS_REGIONS))
            .order_by(WeatherSnapshot.scraped_at.desc())
            .all()
        )
        latest_by_region: dict = {}
        for snap in snapshots:
            if snap.region not in latest_by_region:
                latest_by_region[snap.region] = snap

        if latest_by_region:
            regions_out = []
            daily_frost_out    = []
            daily_drought_out  = []
            drought_detail_out = []
            scraped_at_out = None

            for region_name in _HONDURAS_REGIONS:
                snap = latest_by_region.get(region_name)
                if snap is None:
                    continue
                if scraped_at_out is None and snap.scraped_at:
                    scraped_at_out = snap.scraped_at.isoformat() + "Z"

                daily = snap.daily_data or []
                week  = daily[:7]
                frost_codes   = [d.get("frost_risk",   "-") for d in week]
                drought_codes = [d.get("drought_risk", "-") for d in week]
                csi = _calc_csi(daily)

                regions_out.append({
                    "name":          region_name,
                    "frost":         _badge(_worst_risk(frost_codes)),
                    "drought":       _badge(_worst_risk(drought_codes)),
                    "csi_30d":       csi["csi_30d"],
                    "csi_60d":       csi["csi_60d"],
                    "csi_30d_level": csi["csi_30d_level"],
                    "csi_60d_level": csi["csi_60d_level"],
                })
                if region_name == "Copán":
                    regions_out[-1].update(mtd_rain_fields(daily, "honduras"))

                frost_days   = [d.get("frost_risk",   "-") for d in daily]
                drought_days = [d.get("drought_risk", "-") for d in daily]
                if any(c != "-" for c in frost_days):
                    daily_frost_out.append({"region": region_name, "days": frost_days})
                if any(c != "-" for c in drought_days):
                    daily_drought_out.append({"region": region_name, "days": drought_days})
                    drought_detail_out.append({
                        "region": region_name,
                        "days": [
                            {
                                "date":          d.get("date", ""),
                                "precip_prob":   d.get("precip_prob", 0.0),
                                "precip_mm":     d.get("precip_mm", 0.0),
                                "soil_moisture": d.get("soil_moisture", 0.0),
                                "drought_risk":  d.get("drought_risk", "-"),
                            }
                            for d in daily
                        ],
                    })

            if regions_out:
                weather_out = {
                    "scraped_at":    scraped_at_out or date.today().isoformat(),
                    "regions":       regions_out,
                    "daily_frost":   daily_frost_out,
                    "daily_drought": daily_drought_out,
                    "drought_detail": drought_detail_out,
                }
    except Exception as e:
        print(f"  [honduras] weather section error: {e}")

    # ── 4. ENSO ───────────────────────────────────────────────────────────────
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
                impact_def = _HONDURAS_ENSO_IMPACT.get(phase, _HONDURAS_ENSO_IMPACT["neutral"])
                regional_impact = [{**r, "dots": dots} for r in impact_def["regions"]]

                recent_vals = [p["value"] for p in oni_history[-5:]]
                trend = (recent_vals[-1] - recent_vals[0]) if len(recent_vals) >= 2 else 0
                forecast_direction = (
                    "Neutral · No strong signal" if phase == "neutral"
                    else ("El Niño weakening" if trend < -0.15 else "El Niño conditions ongoing") if phase == "el-nino"
                    else ("La Niña weakening toward neutral" if trend > 0.15 else "La Niña ongoing")
                )

                confirmed  = [p for p in oni_history if not p.get("preliminary")]
                peak_entry = max(confirmed or oni_history, key=lambda p: abs(p["value"]))
                peak_month = peak_entry["month"]

                enso_out = {
                    "phase":              phase,
                    "intensity":          intensity,
                    "oni":                current_oni,
                    "peak_month":         peak_month,
                    "forecast_direction": forecast_direction,
                    "oni_history":        oni_history,
                    "oni_forecast":       meta.get("oni_forecast", []),
                    "regional_impact":    regional_impact,
                    "historical_stat":    impact_def["historical_stat"],
                    "last_updated":       str(enso_item.pub_date)[:10],
                }
    except Exception as e:
        print(f"  [honduras] ENSO section error: {e}")

    # ── 5. Harvest calendar ───────────────────────────────────────────────────
    harvest_cal = {
        "current_phase":    _current_harvest_phase(),
        "harvest_window":   "Oct–Feb",
        "flowering_window": "Apr–Jun",
        "development":      "Jul–Sep",
        "description": (
            "Honduras has a single annual harvest (cosecha), unlike Colombia's bimodal pattern. "
            "Flowering occurs Apr–Jun, fruit develops Jul–Sep, and harvest runs Oct–Feb "
            "(peak Nov–Jan). Honduras is the largest arabica producer in Central America."
        ),
    }

    # ── Assemble & write ──────────────────────────────────────────────────────
    result = {
        "country":     "honduras",
        "scraped_at":  datetime.utcnow().isoformat() + "Z",
        "exports":     exports_out,
        "ihcafe_price": ihcafe_out,
        "weather":     weather_out,
        "enso":        enso_out,
        "harvest_cal": harvest_cal,
    }

    path = OUT_DIR / "honduras_supply.json"
    safe_write_json(path, result, ensure_ascii=False)
    print(
        f"  honduras_supply.json → "
        f"exports:{exports_out is not None} "
        f"ihcafe:{ihcafe_out is not None} "
        f"weather:{weather_out is not None} "
        f"enso:{enso_out is not None}"
    )


def main():
    print("Exporting Honduras supply JSON...")
    db = SessionLocal()
    try:
        export_honduras(db)
    finally:
        db.close()
    print("Done")


if __name__ == "__main__":
    main()
