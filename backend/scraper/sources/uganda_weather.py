"""
uganda_weather.py — Open-Meteo weather for Uganda coffee regions.

One station per production belt (rebuilt Aug 2026):

  Robusta (~85% of exports)
    Greater Masaka — Lake Victoria crescent, the single largest belt
    Central        — Mityana / Mubende / Mukono / Luwero
    Western        — Bushenyi / Mitooma / Sheema / Rukungiri
    Busoga         — Iganga / Bugiri / Jinja / Kamuli

  Arabica (~15%)
    Mt Elgon       — Bugisu highlands (Kapchorwa / Kween / Bulambuli / Sironko)
    West Nile      — Okoro (Zombo / Nebbi / Arua)
    Rwenzori       — Kasese / Bundibugyo / Kabarole / Bunyangabu

The previous set sampled the Rwenzori massif twice (Kasese sat 20 km from
Fort Portal) and Mt Elgon twice (Mbale 47 km from Sironko), classified
Kasese as robusta although UCDA maps it an arabica district, and left the
two biggest robusta belts and all of West Nile unsampled.

No frost risk (all below 2500m or equatorial).
El Nino = drier = bad; La Nina = wetter = positive.
"""
from __future__ import annotations

from datetime import UTC, datetime

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

_REGIONS = [
    {"name": "Greater Masaka", "lat": -0.33, "lng": 31.73},
    {"name": "Central",        "lat":  0.40, "lng": 32.04},
    {"name": "Western",        "lat": -0.59, "lng": 30.19},
    {"name": "Busoga",         "lat":  0.61, "lng": 33.47},
    {"name": "Mt Elgon",       "lat":  1.39, "lng": 34.45},
    {"name": "West Nile",      "lat":  2.52, "lng": 30.90},
    {"name": "Rwenzori",       "lat":  0.66, "lng": 30.27},
]

# Andisol-like soils; Uganda highlands moderate AWC
_PWP = 0.22   # permanent wilting point (m³/m³)
_AWC = 0.18   # available water capacity (m³/m³)

_TZ = "Africa/Kampala"

# Uganda phenology weights (long rains Mar-May, short rains Oct-Dec)
_PHENO_WEIGHTS = [
    1.0, 1.0, 1.15, 1.20, 1.20, 1.0,   # Jan-Jun
    0.9, 0.9, 1.0,  1.20, 1.20, 1.0,   # Jul-Dec
]

_OM_URL = "https://api.open-meteo.com/v1/forecast"


def _root_zone_moisture(sm0: float, sm1: float, sm2: float) -> float:
    return sm0 * 0.30 + sm1 * 0.45 + sm2 * 0.25


def _calc_csi(daily: list[dict]) -> dict:
    """Crop Stress Index (CSI): fraction of days in window where soil moisture < PWP."""
    def _csi(window: list[dict]) -> float | None:
        if not window:
            return None
        stress = sum(
            1 for d in window
            if _root_zone_moisture(
                d.get("sm_0_1", _PWP + 0.05),
                d.get("sm_1_2", _PWP + 0.05),
                d.get("sm_2_3", _PWP + 0.05),
            ) < _PWP
        )
        raw = round(stress / len(window), 3)
        return min(raw * 1.4, 1.0)

    d30 = daily[:30] if len(daily) >= 30 else daily
    d60 = daily[:60] if len(daily) >= 60 else daily
    c30 = _csi(d30)
    c60 = _csi(d60)

    def _level(v: float | None) -> str:
        if v is None:
            return "unknown"
        if v >= 0.5:
            return "HIGH"
        if v >= 0.25:
            return "MED"
        if v > 0:
            return "LOW"
        return "OK"

    return {
        "csi_30d":       round(c30, 3) if c30 is not None else None,
        "csi_60d":       round(c60, 3) if c60 is not None else None,
        "csi_30d_level": _level(c30),
        "csi_60d_level": _level(c60),
    }


def _fetch_region(lat: float, lng: float) -> list[dict]:
    params = {
        "latitude":              lat,
        "longitude":             lng,
        "hourly":                "temperature_2m,relative_humidity_2m,precipitation,soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm,vapour_pressure_deficit",
        "daily":                 "precipitation_sum,wind_speed_10m_max,cloud_cover_mean",
        "timezone":              _TZ,
        "past_days":             60,
        "forecast_days":         7,
        "models":                "best_match",
    }
    from scraper.sources._open_meteo import get_json
    return get_json(_OM_URL, params=params, headers=_HEADERS)


def _process(raw: dict) -> list[dict]:
    hourly = raw.get("hourly", {})
    _daily_raw = raw.get("daily", {})
    times_h = hourly.get("time", [])
    temp_h  = hourly.get("temperature_2m", [])
    rh_h    = hourly.get("relative_humidity_2m", [])
    precip_h = hourly.get("precipitation", [])
    sm0_h   = hourly.get("soil_moisture_0_to_1cm", [])
    sm1_h   = hourly.get("soil_moisture_1_to_3cm", [])
    sm2_h   = hourly.get("soil_moisture_3_to_9cm", [])
    vpd_h   = hourly.get("vapour_pressure_deficit", [])

    days: dict[str, dict] = {}
    for i, t in enumerate(times_h):
        d = t[:10]
        if d not in days:
            days[d] = {
                "date": d, "temps": [], "rh_vals": [], "precip": 0.0,
                "sm0": [], "sm1": [], "sm2": [], "vpd": [],
            }
        if i < len(temp_h)   and temp_h[i]   is not None: days[d]["temps"].append(temp_h[i])
        if i < len(rh_h)     and rh_h[i]     is not None: days[d]["rh_vals"].append(rh_h[i])
        if i < len(precip_h) and precip_h[i] is not None: days[d]["precip"] += precip_h[i]
        if i < len(sm0_h)    and sm0_h[i]    is not None: days[d]["sm0"].append(sm0_h[i])
        if i < len(sm1_h)    and sm1_h[i]    is not None: days[d]["sm1"].append(sm1_h[i])
        if i < len(sm2_h)    and sm2_h[i]    is not None: days[d]["sm2"].append(sm2_h[i])
        if i < len(vpd_h)    and vpd_h[i]    is not None: days[d]["vpd"].append(vpd_h[i])

    out = []
    for d_str in sorted(days):
        d = days[d_str]
        mo = int(d_str[5:7]) - 1
        pw = _PHENO_WEIGHTS[mo]

        sm0 = sum(d["sm0"]) / len(d["sm0"]) if d["sm0"] else _PWP + 0.05
        sm1 = sum(d["sm1"]) / len(d["sm1"]) if d["sm1"] else _PWP + 0.05
        sm2 = sum(d["sm2"]) / len(d["sm2"]) if d["sm2"] else _PWP + 0.05
        rmz = _root_zone_moisture(sm0, sm1, sm2)
        vpd_mean = sum(d["vpd"]) / len(d["vpd"]) if d["vpd"] else 0.0
        rh_mean  = sum(d["rh_vals"]) / len(d["rh_vals"]) if d["rh_vals"] else 70.0
        precip   = d["precip"]
        max_temp = max(d["temps"]) if d["temps"] else 25.0

        drought_score = 0.0
        if rmz < _PWP:
            drought_score += 2.0 * pw
        elif rmz < _PWP + _AWC * 0.25:
            drought_score += 1.0 * pw
        if vpd_mean > 2.5:
            drought_score += 1.5
        elif vpd_mean > 1.5:
            drought_score += 0.8
        if rh_mean < 40:
            drought_score += 0.5

        if drought_score >= 3.0:
            drought_risk = "H"
        elif drought_score >= 1.5:
            drought_risk = "M"
        elif drought_score >= 0.5:
            drought_risk = "L"
        else:
            drought_risk = "-"

        precip_prob = min(precip / 10.0, 1.0)

        out.append({
            "date":          d_str,
            "max_temp":      round(max_temp, 1),
            "vpd":           round(vpd_mean, 2),
            "precip_mm":     round(precip, 1),
            "precip_prob":   round(precip_prob, 2),
            "soil_moisture": round(rmz, 3),
            "drought_risk":  drought_risk,
            "sm_0_1":        round(sm0, 3),
            "sm_1_2":        round(sm1, 3),
            "sm_2_3":        round(sm2, 3),
        })
    return out


async def run(page, db) -> None:
    from models import WeatherSnapshot
    now = datetime.now(UTC)

    for region in _REGIONS:
        try:
            raw = _fetch_region(region["lat"], region["lng"])
            daily = _process(raw)
            if not daily:
                print(f"[uganda_weather] {region['name']}: no daily data")
                continue

            existing = (
                db.query(WeatherSnapshot)
                .filter_by(region=region["name"])
                .first()
            )
            if existing:
                existing.scraped_at = now
                existing.daily_data = daily
            else:
                db.add(WeatherSnapshot(
                    region=region["name"],
                    scraped_at=now,
                    daily_data=daily,
                ))
            db.commit()
            print(f"[uganda_weather] {region['name']}: {len(daily)} days OK")
        except Exception as e:
            print(f"[uganda_weather] {region['name']}: FAILED — {e}")
            db.rollback()
