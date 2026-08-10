"""
export_colombia.py
Reads DB and writes frontend/public/data/colombia_supply.json.

Sections:
  exports    — ICO monthly green coffee exports (from colombia.py NewsItem)
  fnc_price  — FNC precio interno COP/carga (from colombia.py NewsItem)
  weather    — drought risk per Colombian region (WeatherSnapshot)
  enso       — NOAA ONI + Colombia-specific regional impact (same ONI as Brazil)
  mitaca     — static season calendar + current phase
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

_COLOMBIA_REGIONS = ["Huila", "Nariño", "Antioquia", "Cauca", "Caldas"]


# Colombia ENSO impact (OPPOSITE to Brazil: El Niño → drier → bad)
_COLOMBIA_ENSO_IMPACT = {
    "el-nino": {
        "regions": [
            {"region": "Huila",     "type": "DRY",  "note": "ITCZ disruption, −25% rainfall vs norm."},
            {"region": "Nariño",    "type": "DRY",  "note": "Pacific influence, below-avg moisture"},
            {"region": "Antioquia", "type": "DRY",  "note": "reduced Intertropical front activity"},
            {"region": "Cauca",     "type": "DRY",  "note": "water deficit at critical elevation"},
            {"region": "Caldas",    "type": "DRY",  "note": "Eje Cafetero moisture deficit"},
        ],
        "historical_stat": "El Niño years avg. Colombia coffee output −8 to −15% vs neutral (CENICAFÉ)",
    },
    "la-nina": {
        "regions": [
            {"region": "Huila",     "type": "WET",  "note": "above-avg rainfall, flood/landslide risk"},
            {"region": "Nariño",    "type": "WET",  "note": "excessive moisture, fungal disease risk"},
            {"region": "Antioquia", "type": "WET",  "note": "above-avg rainfall, rot risk at harvest"},
            {"region": "Cauca",     "type": "WET",  "note": "above-avg moisture, quality impact"},
            {"region": "Caldas",    "type": "WET",  "note": "excess rain during flowering can reduce set"},
        ],
        "historical_stat": "La Niña brings excess rainfall — yield may hold but bean quality risks (fungal, rot)",
    },
    "neutral": {
        "regions": [
            {"region": "Huila",     "type": "WARM", "note": "near-normal bimodal rainfall"},
            {"region": "Nariño",    "type": "WARM", "note": "near-normal conditions"},
            {"region": "Antioquia", "type": "WARM", "note": "near-normal conditions"},
            {"region": "Cauca",     "type": "WARM", "note": "near-normal conditions"},
            {"region": "Caldas",    "type": "WARM", "note": "near-normal conditions"},
        ],
        "historical_stat": "Neutral ENSO: near-average Colombia arabica output expected",
    },
}

# Same ONI season parsing as farmer_economics
_SEASON_MONTH = {
    "DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4,
    "AMJ": 5, "MJJ": 6, "JJA": 7, "JAS": 8,
    "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12,
}






def _current_mitaca_phase() -> str:
    mo = date.today().month
    if mo in (9, 10):      return "flowering"
    if mo in (4, 5, 6):    return "harvest"
    if mo in (3, 11):      return "pre-harvest"
    return "off-season"


def export_colombia(db) -> None:
    # ── 1. Exports (ICO) ──────────────────────────────────────────────────────
    exports_out = None
    try:
        ico_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "ICO", NewsItem.title.like("Colombia%"))
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
        print(f"  [colombia] exports section error: {e}")

    # Fall back to USDA PSD annual exports when ICO monthly data is absent
    # (it never lands for this origin — see psd_country_exports).
    if exports_out is None:
        try:
            from scraper.psd_country_exports import psd_country_exports
            exports_out = psd_country_exports(db, "colombia")
        except Exception as e:
            print(f"  [colombia] PSD exports fallback error: {e}")

    # ── 1b. Preserve the DANE/FNC monthly series (file-resident only) ────────
    # The monthly rows exist ONLY in the shipped JSON: workflow 0.10 merges
    # DANE XLS + FNC bulletin rows straight into colombia_supply.json and the
    # DB never sees them. This rebuild used to clobber them to [] every night,
    # blanking the Exports tab until the next 0.10 run — and, because the
    # source sentinel verifies ingestion against this same file, re-triggering
    # the full scrape day after day (observed Aug 2026).
    try:
        prior_doc = json.loads((OUT_DIR / "colombia_supply.json").read_text(encoding="utf-8"))
        prior_monthly = ((prior_doc.get("exports") or {}).get("monthly")) or []
    except Exception:
        prior_monthly = []
    if prior_monthly and not (exports_out or {}).get("monthly"):
        if exports_out is None:
            exports_out = {"unit": "thousand 60-kg bags", "annual": []}
        exports_out["monthly"] = prior_monthly
        exports_out["source"] = "DANE + FNC (monthly) · USDA PSD (annual)"
        exports_out["last_updated"] = max(
            str(exports_out.get("last_updated") or ""),
            str(prior_monthly[-1].get("month") or ""),
        )

    # ── 2. FNC precio interno ─────────────────────────────────────────────────
    fnc_out = None
    try:
        fnc_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "FNC")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if fnc_item:
            fnc_out = json.loads(fnc_item.meta or "{}")
    except Exception as e:
        print(f"  [colombia] FNC section error: {e}")

    # ── 3. Weather (Colombia regions) ─────────────────────────────────────────
    weather_out = None
    try:
        from scraper.sources._weather_baseline import mtd_rain_fields
        from scraper.sources.colombia_weather import _calc_csi

        snapshots = (
            db.query(WeatherSnapshot)
            .filter(WeatherSnapshot.region.in_(_COLOMBIA_REGIONS))
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
            drought_detail_out = []
            scraped_at_out = None

            for region_name in _COLOMBIA_REGIONS:
                snap = latest_by_region.get(region_name)
                if snap is None:
                    continue
                if scraped_at_out is None and snap.scraped_at:
                    scraped_at_out = snap.scraped_at.isoformat() + "Z"

                daily = snap.daily_data or []
                week  = daily[:7]
                drought_codes = [d.get("drought_risk", "-") for d in week]
                csi = _calc_csi(daily)

                regions_out.append({
                    "name":          region_name,
                    "drought":       _badge(_worst_risk(drought_codes)),
                    "csi_30d":       csi["csi_30d"],
                    "csi_60d":       csi["csi_60d"],
                    "csi_30d_level": csi["csi_30d_level"],
                    "csi_60d_level": csi["csi_60d_level"],
                })
                # Month-to-date rain vs historical envelope, on the country's
                # baseline representative region only (one rain row per country).
                if region_name == "Huila":
                    regions_out[-1].update(mtd_rain_fields(daily, "colombia"))

                drought_days = [d.get("drought_risk", "-") for d in daily]
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
                    "daily_drought": daily_drought_out,
                    "drought_detail": drought_detail_out,
                }
    except Exception as e:
        print(f"  [colombia] weather section error: {e}")

    # ── 4. ENSO (shared NOAA CPC source, Colombia-specific impact table) ──────
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
                impact_def = _COLOMBIA_ENSO_IMPACT.get(phase, _COLOMBIA_ENSO_IMPACT["neutral"])
                regional_impact = [{**r, "dots": dots} for r in impact_def["regions"]]

                recent_vals = [p["value"] for p in oni_history[-5:]]
                trend = (recent_vals[-1] - recent_vals[0]) if len(recent_vals) >= 2 else 0
                if phase == "neutral":
                    forecast_direction = "Neutral · No strong signal for 2026"
                elif phase == "el-nino":
                    forecast_direction = "El Niño weakening" if trend < -0.15 else "El Niño conditions ongoing"
                else:
                    forecast_direction = "La Niña weakening toward neutral" if trend > 0.15 else "La Niña ongoing"

                confirmed = [p for p in oni_history if not p.get("preliminary")]
                history_for_peak = confirmed if confirmed else oni_history
                peak_month = max(history_for_peak, key=lambda p: abs(p["value"]))["month"] if history_for_peak else ""

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
        print(f"  [colombia] ENSO section error: {e}")

    # ── 5. Mitaca season ──────────────────────────────────────────────────────
    mitaca_phase = _current_mitaca_phase()
    mitaca_out = {
        "current_phase":       mitaca_phase,
        "harvest_window":      "Apr–Jun",
        "flowering_window":    "Sep–Oct",
        "main_crop_harvest":   "Oct–Jan",
        "main_crop_flowering": "Mar–May",
        "description": (
            "Colombia's unique bimodal rainfall pattern enables two crop cycles per year. "
            "The main crop (cosecha principal) harvests Oct–Jan; "
            "the Mitaca (second crop) harvests Apr–Jun."
        ),
    }

    # ── Assemble & write ──────────────────────────────────────────────────────
    result = {
        "country":    "colombia",
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "exports":    exports_out,
        "fnc_price":  fnc_out,
        "weather":    weather_out,
        "enso":       enso_out,
        "mitaca":     mitaca_out,
    }

    path = OUT_DIR / "colombia_supply.json"
    safe_write_json(path, result, ensure_ascii=False)
    print(
        f"  colombia_supply.json → "
        f"exports:{exports_out is not None} "
        f"fnc:{fnc_out is not None} "
        f"weather:{weather_out is not None} "
        f"enso:{enso_out is not None}"
    )


def main():
    print("Exporting Colombia supply JSON...")
    db = SessionLocal()
    try:
        export_colombia(db)
    finally:
        db.close()
    print("Done")


if __name__ == "__main__":
    main()
