"""Supply-side exporters (Brazil farmer economics + selling, Vietnam, per-origin)."""
import json
import sys
from datetime import date, datetime

from models import (
    FertilizerImport,
    NewsItem,
    WeatherSnapshot,
)
from scraper._export_common import _badge as _badge_from_risk_code
from scraper._export_common import _worst_risk
from scraper.enso import classify_enso as _classify_enso
from scraper.enso import current_event_peak as _current_event_peak
from scraper.enso import oni_to_dots as _oni_to_dots
from scraper.exporters.base import OUT_DIR, ROOT
from scraper.rules import frost_model as _fm
from scraper.validate_export import (
    safe_write_json,
    validate_farmer_economics,
)

_REGIONAL_IMPACT_BY_PHASE = {
    "el-nino": [
        {"region": "Sul de Minas",   "type": "DRY",  "note": "rainfall −18% vs norm."},
        {"region": "Cerrado",        "type": "DRY",  "note": "moisture deficit critical"},
        {"region": "Paraná",         "type": "COLD", "note": "frost window +12 days"},
        {"region": "Espírito Santo", "type": "WET",  "note": "above-avg rainfall"},
    ],
    "la-nina": [
        {"region": "Sul de Minas",   "type": "WET",  "note": "above-avg rainfall"},
        {"region": "Cerrado",        "type": "WET",  "note": "above-avg rainfall"},
        {"region": "Paraná",         "type": "WARM", "note": "reduced frost risk"},
        {"region": "Espírito Santo", "type": "DRY",  "note": "below-avg rainfall"},
    ],
    "neutral": [
        {"region": "Sul de Minas",   "type": "WARM", "note": "near-normal conditions"},
        {"region": "Cerrado",        "type": "WARM", "note": "near-normal conditions"},
        {"region": "Paraná",         "type": "WARM", "note": "near-normal conditions"},
        {"region": "Espírito Santo", "type": "WARM", "note": "near-normal conditions"},
    ],
}


_HISTORICAL_STAT_BY_PHASE = {
    "el-nino": "El Niño years avg. Brazil arabica output −4.2% vs neutral",
    "la-nina": "La Niña years avg. Brazil arabica output +2.1% vs neutral",
    "neutral":  "Neutral ENSO: near-average Brazil arabica output expected",
}


_FERT_CONFIG = {
    "urea": {"name": "Urea (N)", "input_weight": 0.35, "base_usd_per_bag": 18.9},
    "dap":  {"name": "MAP (P)",  "input_weight": 0.20, "base_usd_per_bag": 10.8},
    "kcl":  {"name": "KCl (K)",  "input_weight": 0.25, "base_usd_per_bag": 13.5},
}


def _load_dry_bulk_cache() -> dict | None:
    """Read dry_bulk.json cache written by dry_bulk scraper."""
    try:
        from scraper.sources.dry_bulk import fetch_latest
        return fetch_latest()
    except Exception:
        return None


def _load_origins_cache() -> dict | None:
    """Read br_fert_origins.json cache written by comex_fertilizer scraper."""
    try:
        cache_path = ROOT / "backend" / "scraper" / "cache" / "br_fert_origins.json"
        if cache_path.exists():
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            return data.get("origins")
    except Exception:
        pass
    return None


def export_farmer_economics(db) -> None:
    _REGIONS_ORDER = ["Sul de Minas", "Cerrado", "Paraná", "Espírito Santo"]

    # ── Weather ──────────────────────────────────────────────────────────────
    weather_out = None
    try:
        snapshots = db.query(WeatherSnapshot).order_by(WeatherSnapshot.scraped_at.desc()).all()
        latest_by_region = {}
        for snap in snapshots:
            if snap.region not in latest_by_region:
                latest_by_region[snap.region] = snap

        if latest_by_region:
            regions_out           = []
            daily_frost_out       = []
            frost_drivers_out     = []
            daily_drought_out     = []
            drought_detail_out    = []
            current_conditions_out= []
            scraped_at_out        = None
            _today_iso            = date.today().isoformat()

            for region_name in _REGIONS_ORDER:
                snap = latest_by_region.get(region_name)
                if snap is None:
                    continue
                if scraped_at_out is None and snap.scraped_at:
                    scraped_at_out = snap.scraped_at.isoformat() + "Z"

                daily = snap.daily_data or []
                week  = daily[:7]

                frost_codes   = [d.get("frost_risk",   "-") for d in week]
                drought_codes = [d.get("drought_risk", "-") for d in week]
                frost_badge   = _badge_from_risk_code(_worst_risk(frost_codes))
                drought_badge = _badge_from_risk_code(_worst_risk(drought_codes))

                from scraper.sources._weather_baseline import mtd_rain_fields
                from scraper.sources.farmer_economics import _calc_csi
                csi = _calc_csi(daily)

                # Per-region physics-based frost detail over the FORECAST
                # window (Phase 1 fields on daily_data). Drives the graduated
                # per-region frost ALERT in scraper.agronomic_alerts and the
                # frontend Frost Watch panel; None when the forecast holds no
                # frost (e.g. coastal Espírito Santo, or out of frost season).
                # Enrich with the same severity the alert engine uses, so the
                # UI badge and the Telegram alert can never disagree.
                frost_detail = _fm.worst_forecast_frost(daily, _today_iso)
                if frost_detail:
                    frost_detail["severity"] = _fm.severity(
                        frost_detail["risk"], frost_detail["frost_type"],
                        frost_detail["surface_c"], frost_detail["hours_below_0"],
                    )

                regions_out.append({
                    "name":           region_name,
                    "frost":          frost_badge,
                    "frost_detail":   frost_detail,
                    "drought":        drought_badge,
                    "csi_30d":        csi["csi_30d"],
                    "csi_60d":        csi["csi_60d"],
                    "csi_30d_level":  csi["csi_30d_level"],
                    "csi_60d_level":  csi["csi_60d_level"],
                })
                # Brazil's baseline representative point is the Cerrado.
                if region_name == "Cerrado":
                    regions_out[-1].update(mtd_rain_fields(daily, "brazil"))

                frost_days   = [d.get("frost_risk",   "-") for d in daily]
                drought_days = [d.get("drought_risk", "-") for d in daily]
                if any(c != "-" for c in frost_days):
                    daily_frost_out.append({"region": region_name, "days": frost_days})

                # Full per-day frost variable trend for EVERY region (even
                # frost-free ones), so the UI can show how close each region
                # runs to a freeze across the FORECAST. daily_data trails ~2
                # months of history for the drought baseline, so slice to the
                # days from today forward (capped at the 14-day grid width) —
                # the trend table is about what's coming, not the past. Each
                # day carries the physics the model keyed on + the same severity
                # the alert engine fires, so table and Telegram can't disagree.
                frost_forecast = [
                    d for d in daily if str(d.get("date", "")) >= _today_iso
                ][:14] or daily[-14:]
                frost_drivers_out.append({
                    "region": region_name,
                    "days": [
                        {
                            "date":             d.get("date", ""),
                            "risk":             d.get("frost_risk", "-"),
                            "frost_type":       d.get("frost_type", "none"),
                            "severity":         _fm.severity(
                                d.get("frost_risk", "-"), d.get("frost_type", "none"),
                                d.get("frost_surface_c"), d.get("frost_hours_below_0", 0),
                            ),
                            "canopy_c":         d.get("frost_surface_c"),
                            "air_min_c":        d.get("frost_air_min_c"),
                            "dew_c":            d.get("dew_point"),
                            "cloud_pct":        d.get("cloud_cover"),
                            "wind_kmh":         d.get("wind_speed"),
                            "hours_below_0":    d.get("frost_hours_below_0", 0),
                            "hours_below_hard": d.get("frost_hours_below_hard"),
                        }
                        for d in frost_forecast
                    ],
                })
                if any(c != "-" for c in drought_days):
                    daily_drought_out.append({"region": region_name, "days": drought_days})
                    drought_detail_out.append({
                        "region": region_name,
                        "days": [
                            {
                                "date":          d.get("date", ""),
                                "vpd":           d.get("vpd", 0.0),
                                "precip_prob":   d.get("precip_prob", 0.0),
                                "soil_moisture": d.get("soil_moisture", 0.0),
                                "drought_risk":  d.get("drought_risk", "-"),
                            }
                            for d in daily
                        ],
                    })

                today = daily[0] if daily else {}
                current_conditions_out.append({
                    "region":          region_name,
                    "temp_c":          today.get("max_temp", 0),
                    "dew_point_c":     today.get("dew_point", 0),
                    "cloud_cover_pct": today.get("cloud_cover", 0),
                    "wind_speed_kmh":  today.get("wind_speed", 0),
                })

            if regions_out:
                weather_out = {
                    "scraped_at":         scraped_at_out or date.today().isoformat(),
                    "regions":            regions_out,
                    "daily_frost":        daily_frost_out,
                    "frost_drivers":      frost_drivers_out,
                    "daily_drought":      daily_drought_out,
                    "drought_detail":     drought_detail_out,
                    "current_conditions": current_conditions_out,
                }
    except Exception as e:
        print(f"  [farmer_economics] weather section error: {e}")

    # ── ENSO ─────────────────────────────────────────────────────────────────
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
                # Niño 3.4 leads the ONI, so the same weekly series the map
                # uses is fed in here too — otherwise farmer_economics.json and
                # enso.json can disagree about the phase, which is exactly how
                # the risk map ended up green during a +2.6 °C event.
                _idx_path = OUT_DIR / "enso_indices.json"
                _nino34 = None
                if _idx_path.exists():
                    try:
                        _idx = json.loads(_idx_path.read_text(encoding="utf-8"))
                        _nino34 = (_idx.get("nino34") or {}).get("weekly") or None
                    except (OSError, ValueError):
                        _nino34 = None
                _cls = _classify_enso(oni_history, nino34_weekly=_nino34)
                phase, intensity, current_oni = _cls["phase"], _cls["intensity"], _cls["oni"]
                status = _cls["status"]
                dots = _oni_to_dots(current_oni)

                regional_impact = []
                for entry in _REGIONAL_IMPACT_BY_PHASE.get(phase, []):
                    regional_impact.append({**entry, "dots": dots})

                # Forecast direction: trend-based sentence (NOAA ONI file is
                # all historical — no real future forecasts available).
                recent_vals = [p["value"] for p in oni_history[-5:]]
                trend = (recent_vals[-1] - recent_vals[0]) if len(recent_vals) >= 2 else 0
                label = "El Niño" if phase == "el-nino" else "La Niña"
                if phase == "neutral":
                    forecast_direction = "Neutral · no ENSO signal in the observed record"
                elif status == "emerging":
                    # Say plainly that it is not yet a NOAA-confirmed event —
                    # the alternative was calling a +1.39 ONI "neutral".
                    forecast_direction = (
                        f"{label} developing · strengthening"
                        if (trend > 0.15) == (phase == "el-nino")
                        else f"{label} developing · not yet a confirmed event"
                    )
                elif phase == "el-nino":
                    forecast_direction = "El Niño weakening" if trend < -0.15 else "El Niño conditions ongoing"
                else:  # la-nina
                    forecast_direction = "La Niña weakening toward neutral" if trend > 0.15 else "La Niña ongoing"

                # Peak of the CURRENT event. The old code took the extremum over
                # the whole published history, so a developing El Niño reported
                # the previous La Niña's trough as its peak (Nov-25, -0.61).
                peak_month = _current_event_peak(oni_history, phase)

                oni_forecast = meta.get("oni_forecast", [])
                enso_out = {
                    "phase":              phase,
                    "phase_status":       status,
                    "official_phase":     _cls["official_phase"],
                    "phase_basis":        _cls["basis"],
                    "intensity":          intensity,
                    "oni":                current_oni,
                    "peak_month":         peak_month,
                    "forecast_direction": forecast_direction,
                    "oni_history":        oni_history,
                    "oni_forecast":       oni_forecast,
                    "regional_impact":    regional_impact,
                    "historical_stat":    _HISTORICAL_STAT_BY_PHASE.get(phase, ""),
                    "last_updated":       str(enso_item.pub_date)[:10],
                }
    except Exception as e:
        print(f"  [farmer_economics] ENSO section error: {e}")

    # ── Fertilizer prices ─────────────────────────────────────────────────────
    fert_items_out = []
    fert_prices_as_of = None
    try:
        wb_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "World Bank")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if wb_item:
            meta = json.loads(wb_item.meta or "{}")
            fert_prices_as_of = meta.get("last_data_month")  # e.g. "Feb-2026"
            for key, cfg in _FERT_CONFIG.items():
                monthly = meta.get(f"{key}_monthly", [])
                if len(monthly) < 2:
                    continue
                current_price = monthly[-1]
                prev_price    = monthly[-2]
                mom_pct = (current_price - prev_price) / prev_price * 100 if prev_price else 0.0
                # Long-form history (5y monthly with dates) backs the new
                # Macro-tab fertilizer chart. Falls back to the legacy
                # sparkline array if the WB parser didn't populate _history
                # (older NewsItem rows from before that field was added).
                history = meta.get(f"{key}_history", [])
                fert_items_out.append({
                    "name":              cfg["name"],
                    "price_usd_mt":      round(current_price, 0),
                    "mom_pct":           round(mom_pct, 1),
                    "sparkline":         monthly[:6],
                    "history":           history,
                    "input_weight":      cfg["input_weight"],
                    "base_usd_per_bag":  cfg["base_usd_per_bag"],
                })
    except Exception as e:
        print(f"  [farmer_economics] fertilizer prices section error: {e}")

    # ── Fertilizer imports ────────────────────────────────────────────────────
    imports_out = None
    comex_price_items: list = []
    comex_prices_as_of: str | None = None
    try:
        today = date.today()
        cutoff_date = date(today.year - 3, today.month, 1)

        import_rows = (
            db.query(FertilizerImport)
            .filter(FertilizerImport.month >= cutoff_date)
            .order_by(FertilizerImport.month.asc())
            .all()
        )
        if import_rows:
            # NCM code → fertilizer type bucket (handles both old wrong codes + new correct codes)
            _CODE_TO_TYPE: dict[str, str] = {
                # Urea
                "31021010": "urea", "31021090": "urea", "31028000": "urea",
                # KCl — 31042010 was old wrong code kept for compat with existing DB rows
                "31042010": "kcl",  "31042090": "kcl",
                # MAP (monoammonium phosphate) — 31052000 was old wrong code
                "31052000": "map",  "31054000": "map",
                # DAP (diammonium phosphate)
                "31053000": "dap",
                # AN (ammonium nitrate)
                "31023000": "an",
                # AS (ammonium sulphate)
                "31022100": "as",
                # Superphosphate
                "31031020": "superp", "31031030": "superp",
                "31031100": "superp", "31031900": "superp",
            }

            def _row_type(row) -> str | None:
                t = _CODE_TO_TYPE.get((row.ncm_code or "")[:8])
                if t:
                    return t
                # Label fallback for old "NCM XXXXX" entries
                lc = (row.ncm_label or "").lower()
                if "urea" in lc or "ureia" in lc:
                    return "urea"
                if "kcl" in lc or "cloreto de pot" in lc:
                    return "kcl"
                if lc == "map":
                    return "map"
                if "dap" in lc or "diamônio" in lc or "diamonio" in lc:
                    return "dap"
                if lc == "an" or "nitrato" in lc:
                    return "an"
                if lc == "as" or "sulfato de amônio" in lc:
                    return "as"
                if "superphosphate" in lc or "superfosfato" in lc:
                    return "superp"
                return None

            # Group by month string "YYYY-MM", tracking volume + FOB per type
            months_data: dict = {}
            for row in import_rows:
                m_str = row.month.strftime("%Y-%m")
                if m_str not in months_data:
                    months_data[m_str] = {
                        "month":       m_str,
                        "urea_kt":     0.0, "urea_fob":   0.0,
                        "kcl_kt":      0.0, "kcl_fob":    0.0,
                        "map_kt":      0.0, "map_fob":    0.0,
                        "dap_kt":      0.0, "dap_fob":    0.0,
                        "an_kt":       0.0, "an_fob":     0.0,
                        "as_kt":       0.0, "as_fob":     0.0,
                        "superp_kt":   0.0, "superp_fob": 0.0,
                        "total_kt":    0.0,
                        "total_fob_usd_m": 0.0,
                    }
                ftype = _row_type(row)
                kt    = (row.net_weight_kg or 0) / 1_000_000
                fob_m = (row.fob_usd or 0) / 1_000_000
                if ftype:
                    months_data[m_str][f"{ftype}_kt"]  += kt
                    months_data[m_str][f"{ftype}_fob"] += fob_m
                months_data[m_str]["total_kt"]         += kt
                months_data[m_str]["total_fob_usd_m"]  += fob_m

            # Compute implied FOB price (USD/mt) per type per month
            def _implied_price(fob_m: float, kt: float) -> float | None:
                """fob_m = millions USD, kt = kilotons → USD/mt"""
                if kt < 0.5:   # ignore months with negligible volume
                    return None
                return round(fob_m * 1_000 / kt, 0)

            sorted_months = sorted(months_data.values(), key=lambda x: x["month"])

            # Round volume/value fields for output, include implied price per type
            monthly_out = []
            for entry in sorted_months:
                map_dap_kt  = entry["map_kt"]  + entry["dap_kt"]
                map_dap_fob = entry["map_fob"] + entry["dap_fob"]
                monthly_out.append({
                    "month":              entry["month"],
                    "urea_kt":            round(entry["urea_kt"],   1),
                    "kcl_kt":             round(entry["kcl_kt"],    1),
                    "map_kt":             round(entry["map_kt"],    1),
                    "dap_kt":             round(entry["dap_kt"],    1),
                    "an_kt":              round(entry["an_kt"],     1),
                    "as_kt":              round(entry["as_kt"],     1),
                    "superp_kt":          round(entry["superp_kt"], 1),
                    "map_dap_kt":         round(map_dap_kt,         1),  # backward compat
                    "total_kt":           round(entry["total_kt"],  1),
                    "total_fob_usd_m":    round(entry["total_fob_usd_m"], 2),
                    "urea_price_usd_mt":    _implied_price(entry["urea_fob"], entry["urea_kt"]),
                    "kcl_price_usd_mt":     _implied_price(entry["kcl_fob"],  entry["kcl_kt"]),
                    "map_dap_price_usd_mt": _implied_price(map_dap_fob,       map_dap_kt),
                })

            # Build price sparklines (last 7 months with valid data) per type
            _COMEX_FERT = {
                "urea":    {"name": "Urea (N)", "kt_key": "urea_kt", "fob_key": "urea_fob", **_FERT_CONFIG["urea"]},
                "map_dap": {"name": "MAP (P)",  "kt_key": "map_kt",  "fob_key": "map_fob",  **_FERT_CONFIG["dap"]},
                "kcl":     {"name": "KCl (K)",  "kt_key": "kcl_kt",  "fob_key": "kcl_fob",  **_FERT_CONFIG["kcl"]},
            }
            for cfg in _COMEX_FERT.values():
                prices_by_month = [
                    (e["month"], _implied_price(e[cfg["fob_key"]], e[cfg["kt_key"]]))
                    for e in sorted_months
                ]
                valid = [(m, p) for m, p in prices_by_month if p is not None]
                if len(valid) < 2:
                    continue
                sparkline     = [p for _, p in valid[-7:]]
                current_price = sparkline[-1]
                prev_price    = sparkline[-2]
                mom_pct = (current_price - prev_price) / prev_price * 100 if prev_price else 0.0
                comex_prices_as_of = valid[-1][0]  # "YYYY-MM"
                comex_price_items.append({
                    "name":             cfg["name"],
                    "price_usd_mt":     current_price,
                    "mom_pct":          round(mom_pct, 1),
                    "sparkline":        sparkline,
                    "input_weight":     cfg["input_weight"],
                    "base_usd_per_bag": cfg["base_usd_per_bag"],
                })

            if comex_prices_as_of:
                yr, mo = comex_prices_as_of.split("-")
                _M = {"01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun",
                      "07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec"}
                comex_prices_as_of = f"{_M.get(mo, mo)}-{yr}"

            last_import = max(import_rows, key=lambda r: r.scraped_at)
            imports_out = {
                "last_updated": last_import.scraped_at.strftime("%Y-%m-%d"),
                "monthly":      monthly_out,
            }
    except Exception as e:
        print(f"  [farmer_economics] fertilizer imports section error: {e}")

    # ── Acreage / Yield ───────────────────────────────────────────────────────
    acreage_out = None
    yield_out   = None
    season      = None
    try:
        safra_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "CONAB Safra")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if safra_item:
            meta   = json.loads(safra_item.meta or "{}")
            season = meta.get("season")

            area_cur  = meta.get("harvested_area_kha")
            area_prev = meta.get("prev_area_kha")
            yld_cur   = meta.get("yield_bags_ha")
            yld_prev  = meta.get("prev_yield_bags_ha")

            if area_cur is not None:
                area_yoy = (area_cur - area_prev) / area_prev * 100 if area_prev else 0.0
                acreage_out = {
                    "thousand_ha":  area_cur,
                    "yoy_pct":      round(area_yoy, 1),
                    "source_label": meta.get("source_label", "CONAB Safra"),
                }
            if yld_cur is not None:
                yld_yoy = (yld_cur - yld_prev) / yld_prev * 100 if yld_prev else 0.0
                yield_out = {
                    "bags_per_ha":  yld_cur,
                    "yoy_pct":      round(yld_yoy, 1),
                    "source_label": meta.get("source_label", "CONAB Safra"),
                }
    except Exception as e:
        print(f"  [farmer_economics] acreage/yield section error: {e}")

    # ── Cost helper ───────────────────────────────────────────────────────────
    def _build_cost_out(db_source: str, spot_price: float | None, spot_field: str) -> dict | None:
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == db_source)
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if not item:
            return None
        meta          = json.loads(item.meta or "{}")
        total_brl     = meta.get("total_brl_per_bag")
        prev_total_brl= meta.get("prev_total_brl_per_bag")
        brl_usd       = meta.get("brl_usd", 5.0)
        components    = meta.get("components_brl", [])
        inputs_detail = meta.get("inputs_detail_brl", [])
        if total_brl is None:
            return None

        total_usd      = total_brl / brl_usd if brl_usd else None
        total_comp_brl = sum(c.get("brl", 0) for c in components)
        components_out = [
            {
                "label": c.get("label"),
                "color": c.get("color"),
                "brl":   c.get("brl", 0),
                "usd":   round(c.get("brl", 0) / brl_usd, 2) if brl_usd else None,
                "share": round(c.get("brl", 0) / total_comp_brl, 4) if total_comp_brl else 0.0,
            }
            for c in components
        ]
        inputs_total_brl  = sum(d.get("brl", 0) for d in inputs_detail)
        inputs_detail_out = [
            {
                "label": d.get("label"),
                "brl":   d.get("brl", 0),
                "usd":   round(d.get("brl", 0) / brl_usd, 2) if brl_usd else None,
                "share": round(d.get("brl", 0) / inputs_total_brl, 4) if inputs_total_brl else 0.0,
            }
            for d in inputs_detail
        ]
        yoy_pct = 0.0
        if prev_total_brl:
            yoy_pct = round((total_brl - prev_total_brl) / prev_total_brl * 100, 1)
        return {
            "total_usd_per_bag": round(total_usd, 1) if total_usd is not None else None,
            "yoy_pct":           yoy_pct,
            "season_label":      meta.get("source_label", db_source),
            "components":        components_out,
            "inputs_detail":     inputs_detail_out,
            spot_field:          spot_price,
            "last_updated":      str(item.pub_date)[:10],
        }

    # ── Cost ──────────────────────────────────────────────────────────────────
    cost_arabica_out = None
    cost_conilon_out = None
    try:
        # KC spot from arabica futures
        kc_spot = None
        try:
            arabica_item = next(
                (i for i in
                 db.query(NewsItem)
                 .filter(NewsItem.meta.isnot(None))
                 .order_by(NewsItem.pub_date.desc())
                 .all()
                 if "futures" in (i.tags or []) and "arabica" in (i.tags or [])),
                None
            )
            if arabica_item:
                ar_meta = json.loads(arabica_item.meta or "{}")
                contracts = ar_meta.get("contracts", [])
                if contracts:
                    kc_spot = contracts[0].get("lastPrice")
        except Exception:
            pass

        # RC spot from robusta futures ($/MT → $/bag: ×0.06)
        rc_spot_per_bag = None
        try:
            robusta_item = next(
                (i for i in
                 db.query(NewsItem)
                 .filter(NewsItem.meta.isnot(None))
                 .order_by(NewsItem.pub_date.desc())
                 .all()
                 if "futures" in (i.tags or []) and "robusta" in (i.tags or [])),
                None
            )
            if robusta_item:
                rc_meta = json.loads(robusta_item.meta or "{}")
                contracts = rc_meta.get("contracts", [])
                if contracts:
                    rc_usd_mt = contracts[0].get("lastPrice")
                    if rc_usd_mt:
                        rc_spot_per_bag = round(float(rc_usd_mt) * 0.06, 1)
        except Exception:
            pass

        cost_arabica_out = _build_cost_out("CONAB Custos",         kc_spot,        "kc_spot")
        cost_conilon_out = _build_cost_out("CONAB Custos Conilon", rc_spot_per_bag, "rc_spot")

        # Keep season from arabica item
        if cost_arabica_out and not season:
            arabica_item_c = (db.query(NewsItem).filter(NewsItem.source == "CONAB Custos")
                               .order_by(NewsItem.pub_date.desc()).first())
            if arabica_item_c:
                season = json.loads(arabica_item_c.meta or "{}").get("season")
    except Exception as e:
        print(f"  [farmer_economics] cost section error: {e}")

    # ── Assemble & write ──────────────────────────────────────────────────────
    if season is None:
        _today = date.today()
        _y = _today.year if _today.month >= 7 else _today.year - 1
        season = f"{_y}/{str(_y + 1)[-2:]}"

    result = {
        "country":    "brazil",
        "season":     season,
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "cost":         cost_arabica_out,
        "cost_arabica": cost_arabica_out,
        "cost_conilon": cost_conilon_out,
        "acreage":    acreage_out,
        "yield":      yield_out,
        "weather":    weather_out,
        "enso":       enso_out,
        "fertilizer": {
            # Prefer Comex-derived prices (same source as import volume, FOB Brazil)
            # Fall back to World Bank if Comex data is insufficient
            "items":            comex_price_items if comex_price_items else fert_items_out,
            "prices_as_of":     comex_prices_as_of if comex_prices_as_of else fert_prices_as_of,
            "imports":          imports_out,
            "import_origins":   _load_origins_cache(),
            "dry_bulk":         _load_dry_bulk_cache(),
            "next_application": "May–Jun",
        },
    }

    path = OUT_DIR / "farmer_economics.json"
    written = safe_write_json(path, result, validate_farmer_economics)
    print(f"  farmer_economics.json → written:{written} cost:{cost_arabica_out is not None} weather:{weather_out is not None} enso:{enso_out is not None}")


def export_farmer_selling() -> None:
    import logging as _logging

    from scraper.sources import farmer_selling as _fs
    from scraper.sources.farmer_selling import build_farmer_selling
    # Surface the scraper's INFO diagnostics (article found / parsed values / skip
    # reason) in the export log — export_static_json sets up no logging, so these
    # are otherwise swallowed and staleness is impossible to diagnose from the log.
    if not _fs.log.handlers:
        _h = _logging.StreamHandler(sys.stdout)
        _h.setFormatter(_logging.Formatter("    [farmer_selling] %(message)s"))
        _fs.log.addHandler(_h)
        _fs.log.setLevel(_logging.INFO)
        _fs.log.propagate = False
    try:
        before = (OUT_DIR / "farmer_selling_brazil.json")
        before_txt = before.read_text(encoding="utf-8") if before.exists() else ""
        result = build_farmer_selling()
        after_txt = before.read_text(encoding="utf-8") if before.exists() else ""
        changed = after_txt != before_txt
        if result:
            ar = result.get("arabica", {}).get("brazil", {})
            rb = result.get("robusta", {}).get("brazil", {})
            print(f"  farmer_selling_brazil.json → arabica:{ar.get('current')}% robusta:{rb.get('current')}% "
                  f"({'UPDATED' if changed else 'unchanged'}, report {result.get('report_date')})")
        else:
            print("  farmer_selling_brazil.json → no update (no bs4 / file missing)")
    except Exception as e:
        print(f"  farmer_selling_brazil.json → FAILED: {e}")


def export_vietnam_last() -> None:
    """Read latest VN local prices from DB and write vietnam_last.json.
    This persists morning prices that Cecafe/acaphe remove each afternoon."""
    from scraper.db import get_latest_vn_local_price
    path = OUT_DIR / "vietnam_last.json"
    try:
        snapshot = get_latest_vn_local_price()
        if not snapshot:
            print("  vietnam_last.json → no data in DB yet — skipped")
            return
        safe_write_json(
            path, snapshot,
            lambda d: (bool(d.get("saved_at")), "missing saved_at"),
        )
        saved_at = snapshot.get("saved_at", "?")
        bmt_bid  = snapshot.get("bmt_bid", "?")
        print(f"  vietnam_last.json → BMT bid={bmt_bid}, recorded {saved_at}")
    except Exception as e:
        print(f"  vietnam_last.json → FAILED: {e}")


def export_vietnam_supply() -> None:
    """Fetch ICO Vietnam export data and write vietnam_supply.json."""
    from scraper.sources.vietnam_supply import build_vietnam_supply
    try:
        data = build_vietnam_supply()
        path = OUT_DIR / "vietnam_supply.json"
        safe_write_json(
            path, data,
            lambda d: (True, "ok") if d.get("country") == "vietnam" else (False, "country != vietnam"),
        )
        exports = data.get("exports") or {}
        n = len(exports.get("monthly", []))
        print(f"  vietnam_supply.json → {n} export months")
    except Exception as e:
        print(f"  vietnam_supply.json → FAILED: {e}")


# XLSX labels → the 5X bulletins' country naming, so YoY comparisons stay
# continuous across the source boundary in the stitched series below.
# ── Vietnam green-bean equivalent (GBE) ──────────────────────────────────────
# The 5X customs bulletin reports coffee exports by PRODUCT weight, so the
# ~15 kt/month Vietnam ships as instant/soluble coffee is counted once at its
# own weight. Roughly 2 t of green coffee go into 1 t of instant, so the green
# coffee actually leaving the country is understated by about one extra tonne
# per tonne of instant — ≈15 kt/month.
#
# We add that back pro-rata across the month's destinations. Pro-rata is an
# assumption, not a measurement: customs publishes no per-destination split for
# soluble, and instant's destination mix genuinely differs from green bean's.
#
# Applied ONLY to the 5X customs months (2024-02 onward). The pre-2024 XLSX
# backfill is ALREADY on a green-bean-equivalent basis, so uplifting it
# would double-count. Do not "fix" this by extending the uplift backwards.
# With the 5X months lifted, the whole series reads on one consistent GBE
# basis across the 2024-02 boundary.
#
# The raw, unadjusted customs rows stay in backend/seed/vn_customs_by_country.json,
# so the uplift is always reversible/auditable.
_VN_GBE_UPLIFT_T_PER_MONTH = 15_000.0

_VN_XLSX_ALIAS = {
    "US":      "United States of America",
    "UK":      "United Kingdom",
    "Russia":  "Russian Federation",
    "Korea":   "Korea (Republic)",
    "Myanmar": "Myanmar (Burma)",
}


def export_vn_export_by_destination() -> None:
    """Chart series behind the Vietnam Export-by-Destination panel:
    months + {country: {ym: tonnes}}, stitched from two Customs sources.

    Primary: the 5X '(ta-sb)' preliminary bulletins (all coffee, harvested by
    scraper.backfill_vn_customs_country) — archive starts 2024-02 (probed
    exhaustively; see the harvester's probe-past notes). Pre-2024 history and
    any 5X gap months are filled from the older Export_Destination_Port.xlsx
    series (green bean, 2014-10 → 2024-08, vn_export_destination_port.json)
    whose overlap months agree with the 5X within ~0-12%. XLSX labels are
    harmonized to the 5X naming so YoY windows read across the boundary."""
    try:
        # ROOT is the REPO root (exporters/base.py), so the harvester's seed
        # lives under backend/. The old ROOT/"seed" path pointed at a
        # nonexistent repo-root/seed dir — this exporter had been printing
        # FAILED (non-fatally) on every run while the committed JSON quietly
        # froze at its last good state (caught 2026-08-11 by the sentinel's
        # ingestion check when July's 5X harvest wouldn't land).
        seed_path = ROOT / "backend" / "seed" / "vn_customs_by_country.json"
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        month_keys = sorted(seed.get("months", {}))
        countries: dict[str, dict[str, float]] = {}
        for ym in month_keys:
            for row in seed["months"][ym].get("exports_by_country") or []:
                vol = row.get("volume_ton")
                if not row.get("country") or vol is None:
                    continue
                countries.setdefault(row["country"], {})[ym] = vol
        five_x_months = {ym for ym in month_keys
                         if (seed["months"][ym].get("exports_by_country") or [])}

        # Stitch: any month the 5X series doesn't carry comes from the XLSX.
        months_from_xlsx: list[str] = []
        xlsx_path = OUT_DIR / "vn_export_destination_port.json"
        if xlsx_path.exists():
            mbc = json.loads(xlsx_path.read_text(encoding="utf-8")) \
                .get("monthly_by_country") or {}
            for ym in sorted(mbc):
                if ym in five_x_months:
                    continue
                months_from_xlsx.append(ym)
                for name, vol in mbc[ym].items():
                    if name == "na" or vol is None:
                        continue
                    canon = _VN_XLSX_ALIAS.get(name, name)
                    countries.setdefault(canon, {})[ym] = round(float(vol), 1)

        # ── Green-bean-equivalent uplift on the 5X months ──────────────────
        # See _VN_GBE_UPLIFT_T_PER_MONTH. Split pro-rata by each destination's
        # share of that month's reported total, so the country ranking keeps
        # its shape and only the level moves.
        gbe_months: list[str] = []
        for ym in sorted(five_x_months):
            month_total = sum(mv[ym] for mv in countries.values() if ym in mv)
            if month_total <= 0:
                continue
            for mv in countries.values():
                if ym not in mv:
                    continue
                mv[ym] = round(
                    mv[ym] + _VN_GBE_UPLIFT_T_PER_MONTH * (mv[ym] / month_total), 1
                )
            gbe_months.append(ym)

        all_months = sorted(set(month_keys) | set(months_from_xlsx))
        data = {
            "source": ("Vietnam Customs — 5X '(ta-sb)' preliminary bulletins "
                       "(2024-02 onward, all coffee) stitched with the "
                       "Export_Destination_Port.xlsx series (2014-10 → 2024-08, "
                       "green bean) for earlier / gap months"),
            "unit": "tonnes",
            "coverage_note": ("The 5X bulletin lists coffee only for countries "
                              "where it is a 'main export' line (~85-94% of the "
                              "2x national total); pre-2024 months are the "
                              "green-bean XLSX series, which agrees with the 5X "
                              "within ~0-12% on overlap months."),
            "basis": "green-bean equivalent",
            "gbe_uplift_t_per_month": _VN_GBE_UPLIFT_T_PER_MONTH,
            "gbe_months": gbe_months,
            "gbe_note": (
                "Customs reports coffee by product weight, so the ~15 kt/month "
                "Vietnam ships as instant/soluble is counted once at its own "
                "weight. At ~2 t green per 1 t instant, roughly 15 kt/month of "
                "green coffee is missing; it is added back pro-rata across each "
                "month's destinations. Pro-rata is an assumption — customs "
                "publishes no per-destination split for soluble. Applied to the "
                "5X customs months only — the pre-2024 XLSX backfill is already on "
                "a green-bean-equivalent basis, so uplifting it would double-count. "
                "Both halves of the series therefore read on one consistent GBE basis. "
                "Raw rows remain in backend/seed/vn_customs_by_country.json."
            ),
            "source_boundary": min(five_x_months) if five_x_months else None,
            "months_from_xlsx": months_from_xlsx,
            "months": all_months,
            "countries": countries,
        }
        path = OUT_DIR / "vn_export_by_destination.json"
        safe_write_json(
            path, data,
            lambda d: (True, "ok") if d.get("countries") else (False, "no countries"),
        )
        print(f"  vn_export_by_destination.json → {len(countries)} countries × "
              f"{len(all_months)} months ({len(months_from_xlsx)} from the XLSX series; "
              f"GBE +{_VN_GBE_UPLIFT_T_PER_MONTH:,.0f} t on {len(gbe_months)} 5X months)")
    except Exception as e:
        print(f"  vn_export_by_destination.json → FAILED: {e}")


def export_vn_coffee_imports() -> None:
    """Publish the national coffee-import series harvested from the Customs 1n
    bulletins by the vn_fertilizer job (see _COFFEE_CACHE_PATH there). The 5N
    by-country table carries no coffee line, so national is the only import
    figure the customs bulletins publish."""
    try:
        cache_path = ROOT / "scraper" / "cache" / "vn_coffee_imports.json"
        if not cache_path.exists():
            print("  vn_coffee_imports.json → skipped (cache not yet harvested)")
            return
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        monthly = cache.get("monthly") or []
        data = {
            "source": cache.get("source", "Vietnam Customs 1n bulletins"),
            "unit": cache.get("unit", "tonnes"),
            "note": ("National imports only — the customs bulletins do not "
                     "publish a by-country split for coffee imports."),
            "monthly": monthly,
        }
        path = OUT_DIR / "vn_coffee_imports.json"
        safe_write_json(
            path, data,
            lambda d: (True, "ok") if d.get("monthly") else (False, "no months"),
        )
        print(f"  vn_coffee_imports.json → {len(monthly)} months")
    except Exception as e:
        print(f"  vn_coffee_imports.json → FAILED: {e}")


def export_colombia(db) -> None:
    try:
        from scraper.export_colombia import export_colombia as _export_colombia
        _export_colombia(db)
    except Exception as e:
        print(f"  colombia_supply.json → FAILED: {e}")


def export_honduras(db) -> None:
    try:
        from scraper.export_honduras import export_honduras as _export_honduras
        _export_honduras(db)
    except Exception as e:
        print(f"  honduras_supply.json → FAILED: {e}")


def export_indonesia(db) -> None:
    try:
        from scraper.export_indonesia import export_indonesia as _export_indonesia
        _export_indonesia(db)
    except Exception as e:
        print(f"  indonesia_supply.json → FAILED: {e}")


def export_uganda(db) -> None:
    try:
        from scraper.export_uganda import export_uganda as _export_uganda
        _export_uganda(db)
    except Exception as e:
        print(f"  uganda_supply.json → FAILED: {e}")


def export_ethiopia(db) -> None:
    try:
        from scraper.export_ethiopia import export_ethiopia as _export_ethiopia
        _export_ethiopia(db)
    except Exception as e:
        print(f"  ethiopia_supply.json → FAILED: {e}")
