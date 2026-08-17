#!/usr/bin/env python3
"""
build_origin_weather.py — per-origin weather data in the Vietnam chart shape.

Generates one `frontend/public/data/{origin}_weather.json` per coffee origin,
matching the shape that `WeatherCharts.tsx` (generalised from the original
Vietnam charts) consumes: per producing region (province) it provides monthly
rainfall + temperature climatology (30yr normal, 10yr min/max band), last-year
and current-year-to-date actuals, a 7-day rain forecast, plus a top-level daily
month-to-date accumulation series for a representative station and a 7-day
forecast list.

All climatology/actuals come from the Open-Meteo archive API; the forecast from
the Open-Meteo forecast API. Region coordinates and production weights are a
static, approximate config (see ORIGINS) — the weights only set the relative
production-weighting of the charts, not absolute production.

Open-Meteo is NOT reachable from the Claude Code web sandbox (egress allowlist),
so this runs in GitHub Actions. Safe to re-run; --write overwrites per origin.

Usage:
    python build_origin_weather.py [--write] [--origins brazil colombia ...]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import socket
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests
import urllib3.util.connection as urllib3_conn

# GitHub-hosted runners have no IPv6 route; Open-Meteo's CDN returns AAAA
# records, so the default getaddrinfo (IPv6-first) fails with
# "[Errno 101] Network is unreachable". Force IPv4-only resolution.
urllib3_conn.allowed_gai_family = lambda: socket.AF_INET

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

TODAY = dt.date.today()
CUR_YEAR = TODAY.year
LAST_YEAR = CUR_YEAR - 1
NORMAL_START, NORMAL_END = 1991, 2020          # 30yr normal
RANGE_START, RANGE_END = CUR_YEAR - 10, CUR_YEAR - 1  # 10yr min/max band
DRY_START, DRY_END = CUR_YEAR - 30, CUR_YEAR - 1  # last 30yr, drought-risk window
DRY_PCTL = 0.20                                # ≤P20 of the last 30yr = "too dry"
ARCHIVE_START = f"{NORMAL_START}-01-01"
# Archive lags ~5 days; pull through a week ago to stay inside available data.
ARCHIVE_END = (TODAY - dt.timedelta(days=6)).isoformat()

# ── Per-origin region config ────────────────────────────────────────────────
# lat/lon are representative points for each producing region; prod_mt_k is an
# APPROXIMATE green-coffee production weight (relative magnitudes only). The
# first region in each list doubles as the daily-station reference.
ORIGINS: dict[str, dict] = {
    "brazil": {
        "label": "Brazil",
        "share_label": "Brazil arabica+conilon",
        "source_production": "CONAB 2024/25 regional output (approx. weights)",
        "regions": [
            # crop_type + per-crop split — used by the chart's Arabica / Robusta filter.
            # ES is ~70% conilon (capital of Brazilian robusta), ~30% arabica (Caparaó).
            {"name": "Sul de Minas",   "station": "Varginha",     "lat": -21.55, "lon": -45.43, "prod_mt_k": 900, "crop_type": "arabica", "prod_mt_k_arabica": 900, "prod_mt_k_robusta":   0},
            {"name": "Cerrado",        "station": "Patrocínio",   "lat": -18.95, "lon": -46.99, "prod_mt_k": 600, "crop_type": "arabica", "prod_mt_k_arabica": 600, "prod_mt_k_robusta":   0},
            {"name": "Espírito Santo", "station": "Vitória",      "lat": -20.00, "lon": -40.80, "prod_mt_k": 700, "crop_type": "mixed",   "prod_mt_k_arabica": 210, "prod_mt_k_robusta": 490},
            {"name": "Paraná",         "station": "Londrina",     "lat": -23.31, "lon": -50.62, "prod_mt_k": 100, "crop_type": "arabica", "prod_mt_k_arabica": 100, "prod_mt_k_robusta":   0},
        ],
    },
    "colombia": {
        "label": "Colombia",
        "share_label": "Colombia arabica",
        "source_production": "FNC 2024 departmental output (approx. weights)",
        "regions": [
            {"name": "Huila",     "station": "Pitalito",  "lat": 1.85,  "lon": -76.05, "prod_mt_k": 200},
            {"name": "Antioquia", "station": "Medellín",  "lat": 6.25,  "lon": -75.56, "prod_mt_k": 180},
            {"name": "Cauca",     "station": "Popayán",   "lat": 2.44,  "lon": -76.61, "prod_mt_k": 120},
            {"name": "Caldas",    "station": "Manizales", "lat": 5.07,  "lon": -75.52, "prod_mt_k": 110},
            {"name": "Nariño",    "station": "Pasto",     "lat": 1.21,  "lon": -77.28, "prod_mt_k": 60},
        ],
    },
    "honduras": {
        "label": "Honduras",
        "share_label": "Honduras arabica",
        "source_production": "IHCAFE 2024 departmental output (approx. weights)",
        "regions": [
            {"name": "El Paraíso",    "station": "Danlí",     "lat": 13.99, "lon": -86.57, "prod_mt_k": 220},
            {"name": "Copán",         "station": "Copán",     "lat": 14.83, "lon": -88.87, "prod_mt_k": 180},
            {"name": "Santa Bárbara", "station": "Sta Bárbara","lat": 14.92, "lon": -88.24, "prod_mt_k": 160},
            {"name": "Montecillos",   "station": "Marcala",   "lat": 14.16, "lon": -88.02, "prod_mt_k": 130},
            {"name": "Agalta",        "station": "Juticalpa", "lat": 14.68, "lon": -86.22, "prod_mt_k": 90},
        ],
    },
    "indonesia": {
        "label": "Indonesia",
        "share_label": "Indonesia robusta+arabica",
        "source_production": "USDA/AEKI 2024 regional output (approx. weights)",
        "regions": [
            # Lampung is the heart of Indonesian robusta (~97% robusta); the small
            # arabica share is statistically irrelevant. Java has both — Ijen
            # arabica (~30%) + robusta everywhere else.
            {"name": "Lampung", "station": "Bandar Lampung", "lat": -5.00, "lon": 104.80, "prod_mt_k": 350, "crop_type": "robusta", "prod_mt_k_arabica":   0, "prod_mt_k_robusta": 350},
            {"name": "Gayo",    "station": "Takengon",       "lat": 4.62,  "lon": 96.85,  "prod_mt_k": 120, "crop_type": "arabica", "prod_mt_k_arabica": 120, "prod_mt_k_robusta":   0},
            {"name": "Java",    "station": "Bondowoso",      "lat": -7.91, "lon": 113.82, "prod_mt_k": 110, "crop_type": "mixed",   "prod_mt_k_arabica":  30, "prod_mt_k_robusta":  80},
            {"name": "Toraja",  "station": "Rantepao",       "lat": -2.97, "lon": 119.90, "prod_mt_k": 70,  "crop_type": "arabica", "prod_mt_k_arabica":  70, "prod_mt_k_robusta":   0},
            {"name": "Flores",  "station": "Bajawa",         "lat": -8.79, "lon": 120.98, "prod_mt_k": 50,  "crop_type": "arabica", "prod_mt_k_arabica":  50, "prod_mt_k_robusta":   0},
        ],
    },
    "uganda": {
        "label": "Uganda",
        "share_label": "Uganda robusta+arabica",
        "source_production": (
            "UCDA regional structure; weights scaled to the 85/15 robusta:arabica "
            "split measured over 78 months of UCDA export data (uganda_monthly.json)"
        ),
        # Rebuilt Aug 2026. The previous five points sampled the Rwenzori
        # massif twice (Kasese 20 km from Fort Portal) and Mt Elgon twice
        # (Mbale 47 km from Sironko), tagged Kasese as robusta though UCDA
        # maps it an arabica district, and left the two largest robusta
        # areas — the Lake Victoria crescent and the western belt — plus the
        # whole West Nile arabica belt unsampled.
        #
        # Now one station per production belt, weights summing to ~440 kt
        # (robusta 374 = 85%, arabica 66 = 15%). Kisoro/Kabale/Rubanda
        # arabica is real but ~3 kt — too small to justify its own daily
        # fetch, so it is deliberately unsampled.
        "regions": [
            # ── Robusta belts (85%) ──────────────────────────────────────
            {"name": "Greater Masaka",  "station": "Masaka",      "lat": -0.33, "lon": 31.73,
             "prod_mt_k": 118, "crop_type": "robusta", "prod_mt_k_arabica":  0, "prod_mt_k_robusta": 118},
            {"name": "Central",         "station": "Mityana",     "lat":  0.40, "lon": 32.04,
             "prod_mt_k": 105, "crop_type": "robusta", "prod_mt_k_arabica":  0, "prod_mt_k_robusta": 105},
            {"name": "Western",         "station": "Bushenyi",    "lat": -0.59, "lon": 30.19,
             "prod_mt_k":  96, "crop_type": "robusta", "prod_mt_k_arabica":  0, "prod_mt_k_robusta":  96},
            {"name": "Busoga",          "station": "Iganga",      "lat":  0.61, "lon": 33.47,
             "prod_mt_k":  55, "crop_type": "robusta", "prod_mt_k_arabica":  0, "prod_mt_k_robusta":  55},
            # ── Arabica belts (15%) ──────────────────────────────────────
            {"name": "Mt Elgon",        "station": "Kapchorwa",   "lat":  1.39, "lon": 34.45,
             "prod_mt_k":  38, "crop_type": "arabica", "prod_mt_k_arabica": 38, "prod_mt_k_robusta":   0},
            {"name": "West Nile",       "station": "Zombo",       "lat":  2.52, "lon": 30.90,
             "prod_mt_k":  16, "crop_type": "arabica", "prod_mt_k_arabica": 16, "prod_mt_k_robusta":   0},
            {"name": "Rwenzori",        "station": "Fort Portal", "lat":  0.66, "lon": 30.27,
             "prod_mt_k":  12, "crop_type": "arabica", "prod_mt_k_arabica": 12, "prod_mt_k_robusta":   0},
        ],
    },
    "ethiopia": {
        "label": "Ethiopia",
        "share_label": "Ethiopia arabica",
        "source_production": "ECX/USDA 2024 regional output (approx. weights)",
        "regions": [
            {"name": "Sidama/Yirgacheffe", "station": "Yirgacheffe", "lat": 6.16, "lon": 38.20, "prod_mt_k": 240},
            {"name": "Jimma",  "station": "Jimma",  "lat": 7.67, "lon": 36.83, "prod_mt_k": 180},
            {"name": "Limu",   "station": "Limu",   "lat": 8.06, "lon": 36.80, "prod_mt_k": 120},
            {"name": "Kaffa",  "station": "Bonga",  "lat": 7.27, "lon": 36.23, "prod_mt_k": 110},
            {"name": "Harrar", "station": "Harar",  "lat": 9.31, "lon": 42.12, "prod_mt_k": 90},
        ],
    },
}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ── HTTP with retry/backoff ──────────────────────────────────────────────────
def _get(url: str, params: dict) -> dict:
    last_exc: Exception | None = None
    for attempt in range(5):
        try:
            # (connect, read): short connect so an unreachable host fails fast.
            r = requests.get(url, params=params, timeout=(10, 60))
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"{r.status_code} retryable from Open-Meteo")
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001 — retry any transient fetch error
            last_exc = e
            if attempt < 4:
                time.sleep(2 ** (attempt + 1))  # 2,4,8,16s
    raise last_exc  # type: ignore[misc]


def preflight() -> None:
    """Fail fast (and loud) if Open-Meteo is unreachable, instead of letting
    every region time out and running the job into its wall-clock limit."""
    try:
        _get(ARCHIVE_URL, {
            "latitude": 0, "longitude": 0,
            "start_date": "2020-01-01", "end_date": "2020-01-02",
            "daily": "precipitation_sum", "timezone": "UTC",
        })
        print("[preflight] Open-Meteo reachable (IPv4).", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[preflight] FATAL — Open-Meteo unreachable from this runner: {e}",
              file=sys.stderr)
        sys.exit(2)


def fetch_archive(lat: float, lon: float) -> dict:
    return _get(ARCHIVE_URL, {
        "latitude": lat, "longitude": lon,
        "start_date": ARCHIVE_START, "end_date": ARCHIVE_END,
        "daily": "precipitation_sum,temperature_2m_mean",
        "timezone": "UTC",
    })


def fetch_forecast(lat: float, lon: float) -> dict:
    return _get(FORECAST_URL, {
        "latitude": lat, "longitude": lon,
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "forecast_days": 7, "timezone": "UTC",
    })


def r1(x: float) -> float:
    return round(x, 1)


# ── Archive reductions ───────────────────────────────────────────────────────
def _series(daily: dict):
    d = daily["daily"]
    return d["time"], d["precipitation_sum"], d["temperature_2m_mean"]


def monthly_rain_by_year(times, precip) -> dict[tuple[int, int], float]:
    """(year, month) -> total rainfall mm."""
    out: dict[tuple[int, int], float] = defaultdict(float)
    for t, p in zip(times, precip):
        if p is None:
            continue
        out[(int(t[:4]), int(t[5:7]))] += p
    return out


def monthly_temp_by_year(times, temp) -> dict[tuple[int, int], float]:
    """(year, month) -> mean temperature."""
    s: dict[tuple[int, int], float] = defaultdict(float)
    c: dict[tuple[int, int], int] = defaultdict(int)
    for t, v in zip(times, temp):
        if v is None:
            continue
        ym = (int(t[:4]), int(t[5:7]))
        s[ym] += v
        c[ym] += 1
    return {ym: s[ym] / c[ym] for ym in s if c[ym]}


def _normal(by_year: dict[tuple[int, int], float], month: int, y0: int, y1: int) -> float:
    vals = [v for (y, m), v in by_year.items() if m == month and y0 <= y <= y1]
    return statistics.fmean(vals) if vals else 0.0


def _range(by_year: dict[tuple[int, int], float], month: int, y0: int, y1: int):
    vals = [v for (y, m), v in by_year.items() if m == month and y0 <= y <= y1]
    if not vals:
        return 0.0, 0.0
    return min(vals), max(vals)


def _pctl(by_year: dict[tuple[int, int], float], month: int, y0: int, y1: int, q: float) -> float:
    """Linear-interpolated q-quantile (0..1) of monthly totals over [y0, y1]."""
    vals = sorted(v for (y, m), v in by_year.items() if m == month and y0 <= y <= y1)
    if not vals:
        return 0.0
    if len(vals) == 1:
        return vals[0]
    pos = q * (len(vals) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)


def _year_series(by_year: dict[tuple[int, int], float], year: int, full: bool):
    """12-length list for `year`; if not full, truncated at the last month present.

    ERA5 sometimes returns 0.0 (not null) for months whose quality-controlled data
    is not yet available. Runs of ≥2 consecutive zeros followed by a non-zero month
    are replaced with None so the frontend can distinguish 'genuinely dry' from
    'data not yet published'.
    """
    out: list = []
    for m in range(1, 13):
        if (year, m) in by_year:
            out.append(r1(by_year[(year, m)]))
        elif full:
            out.append(0.0)
        else:
            break

    if not full:
        i = 0
        while i < len(out):
            if out[i] == 0.0:
                j = i
                while j < len(out) and out[j] == 0.0:
                    j += 1
                if j - i >= 2 and j < len(out):
                    for k in range(i, j):
                        out[k] = None
                i = j
            else:
                i += 1

    return out


def build_region(cfg: dict) -> dict:
    daily = fetch_archive(cfg["lat"], cfg["lon"])
    times, precip, temp = _series(daily)
    rain_by = monthly_rain_by_year(times, precip)
    temp_by = monthly_temp_by_year(times, temp)

    fc = fetch_forecast(cfg["lat"], cfg["lon"])
    fc_rain = [r1(x or 0.0) for x in fc["daily"]["precipitation_sum"]]

    region = {
        "name": cfg["name"], "station": cfg["station"],
        "prod_mt_k": cfg["prod_mt_k"], "weight": 0.0,  # filled in by caller
        # Crop-type metadata for the Arabica / Robusta filter (Brazil + Indonesia).
        # Defaults preserve single-crop semantics for the other origins that
        # don't currently ship a crop_type — chart treats them as 100% arabica.
        "crop_type":          cfg.get("crop_type", "arabica"),
        "prod_mt_k_arabica":  cfg.get("prod_mt_k_arabica", cfg["prod_mt_k"] if cfg.get("crop_type", "arabica") != "robusta" else 0),
        "prod_mt_k_robusta":  cfg.get("prod_mt_k_robusta", cfg["prod_mt_k"] if cfg.get("crop_type") == "robusta" else 0),
        "monthly_avg_rain":       [r1(_normal(rain_by, m, NORMAL_START, NORMAL_END)) for m in range(1, 13)],
        "monthly_min_rain":       [r1(_range(rain_by, m, RANGE_START, RANGE_END)[0]) for m in range(1, 13)],
        "monthly_max_rain":       [r1(_range(rain_by, m, RANGE_START, RANGE_END)[1]) for m in range(1, 13)],
        "monthly_dry_warn":       [r1(_pctl(rain_by, m, DRY_START, DRY_END, DRY_PCTL)) for m in range(1, 13)],
        "monthly_last_year_rain": _year_series(rain_by, LAST_YEAR, full=True),
        "monthly_actual_cur":     _year_series(rain_by, CUR_YEAR, full=False),
        "monthly_avg_temp":       [r1(_normal(temp_by, m, NORMAL_START, NORMAL_END)) for m in range(1, 13)],
        "monthly_min_temp":       [r1(_range(temp_by, m, RANGE_START, RANGE_END)[0]) for m in range(1, 13)],
        "monthly_max_temp":       [r1(_range(temp_by, m, RANGE_START, RANGE_END)[1]) for m in range(1, 13)],
        "monthly_last_year_temp": _year_series(temp_by, LAST_YEAR, full=True),
        "monthly_actual_temp_cur":_year_series(temp_by, CUR_YEAR, full=False),
        "forecast_7d_rain":       fc_rain,
    }
    return region, daily, fc


def build_daily_station(daily: dict, fc: dict) -> tuple[list[dict], list[dict]]:
    """Current-month daily accumulation series + 7-day forecast list for the
    reference station (first region of the origin)."""
    times, precip, temp = _series(daily)

    # Determine the latest month present in the current year.
    cur_months = sorted({int(t[5:7]) for t in times if int(t[:4]) == CUR_YEAR})
    if not cur_months:
        return [], _forecast_list(fc)
    month = cur_months[-1]

    # Per-day-of-month accumulation across years, for climatology bands.
    accum_by_year: dict[int, dict[int, float]] = defaultdict(dict)  # year -> day -> accum
    run: dict[int, float] = defaultdict(float)
    for t, p in zip(times, precip):
        y, mo, d = int(t[:4]), int(t[5:7]), int(t[8:10])
        if mo != month:
            continue
        if d == 1:
            run[y] = 0.0
        run[y] += p or 0.0
        accum_by_year[y][d] = run[y]

    temp_cur: dict[int, float] = {}  # day -> temp for current year/month
    for t, v in zip(times, temp):
        if int(t[:4]) == CUR_YEAR and int(t[5:7]) == month and v is not None:
            temp_cur[int(t[8:10])] = v

    days = sorted({d for y in accum_by_year.values() for d in y})
    cur_year_days = sorted(accum_by_year.get(CUR_YEAR, {}).keys())
    max_day = max(cur_year_days) if cur_year_days else 0

    rows = []
    prev_accum = 0.0
    for d in days:
        norm_vals = [accum_by_year[y][d] for y in range(NORMAL_START, NORMAL_END + 1)
                     if d in accum_by_year.get(y, {})]
        range_vals = [accum_by_year[y][d] for y in range(RANGE_START, RANGE_END + 1)
                      if d in accum_by_year.get(y, {})]
        cur_accum = accum_by_year.get(CUR_YEAR, {}).get(d)
        row = {
            "day": d,
            "rain_mm": r1((cur_accum - prev_accum) if (cur_accum is not None and d <= max_day) else 0.0),
            "accum_mm": r1(cur_accum) if (cur_accum is not None and d <= max_day) else None,
            "avg_accum_mm": r1(statistics.fmean(norm_vals)) if norm_vals else 0.0,
            "min_accum_mm": r1(min(range_vals)) if range_vals else 0.0,
            "max_accum_mm": r1(max(range_vals)) if range_vals else 0.0,
            "last_year_accum_mm": r1(accum_by_year.get(LAST_YEAR, {}).get(d, 0.0)),
            "temp_c": r1(temp_cur.get(d, 0.0)),
        }
        if cur_accum is not None and d <= max_day:
            prev_accum = cur_accum
        rows.append(row)
    return rows, _forecast_list(fc)


def _forecast_list(fc: dict) -> list[dict]:
    d = fc["daily"]
    out = []
    for i, date in enumerate(d["time"]):
        m, day = int(date[5:7]), int(date[8:10])
        out.append({
            "date": date,
            "label": f"{MONTHS[m - 1]} {day}",
            "rain_mm": r1(d["precipitation_sum"][i] or 0.0),
            "temp_max_c": r1(d["temperature_2m_max"][i] or 0.0),
            "temp_min_c": r1(d["temperature_2m_min"][i] or 0.0),
        })
    return out


def build_origin(key: str) -> dict:
    cfg = ORIGINS[key]
    regions_cfg = cfg["regions"]
    total_prod = sum(r["prod_mt_k"] for r in regions_cfg)

    provinces = []
    first_daily = first_fc = None
    for i, rc in enumerate(regions_cfg):
        print(f"  [{key}] region {rc['name']} ({rc['lat']:.2f},{rc['lon']:.2f}) …", flush=True)
        prov, daily, fc = build_region(rc)
        prov["weight"] = round(rc["prod_mt_k"] / total_prod, 3) if total_prod else 0.0
        provinces.append(prov)
        if i == 0:
            first_daily, first_fc = daily, fc
        time.sleep(1)  # spacing under Open-Meteo's burst limit

    daily_rows, forecast_7d = build_daily_station(first_daily, first_fc)

    return {
        "_note": (
            "Per-region arrays: avg=30yr normal (1991-2020), min/max=10yr range "
            f"({RANGE_START}-{RANGE_END}), last_year={LAST_YEAR}, actual_cur={CUR_YEAR} YTD. "
            f"Daily = {regions_cfg[0]['station']} station current month. "
            "Open-Meteo archive + forecast; production weights approximate."
        ),
        "updated": ARCHIVE_END,
        "cur_year": CUR_YEAR,
        "last_year": LAST_YEAR,
        "label": cfg["label"],
        "share_label": cfg["share_label"],
        "station": regions_cfg[0]["station"],
        "source_production": cfg["source_production"],
        "source_weather": "Open-Meteo archive (1991-2020 normals) + forecast API",
        "provinces": provinces,
        "daily_station": daily_rows,
        "forecast_7d": forecast_7d,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="Write frontend/public/data/{origin}_weather.json. Default: preview.")
    ap.add_argument("--origins", nargs="*",
                    help="Subset of origin keys. Default: all.")
    args = ap.parse_args()

    selected = args.origins or list(ORIGINS.keys())
    print(f"[build_origin_weather] {len(selected)} origins · {ARCHIVE_START}→{ARCHIVE_END}")

    preflight()

    ok = 0
    for key in selected:
        if key not in ORIGINS:
            print(f"  [skip] unknown origin: {key}", file=sys.stderr)
            continue
        try:
            doc = build_origin(key)
        except Exception as e:  # noqa: BLE001
            print(f"  [fail] {key}: {e}", file=sys.stderr)
            continue
        path = DATA_DIR / f"{key}_weather.json"
        payload = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
        if args.write:
            path.write_text(payload, encoding="utf-8")
            print(f"  [write] {path} ({len(doc['provinces'])} regions, "
                  f"{len(doc['daily_station'])} daily rows)")
        else:
            print(f"  [preview] {key}: {len(doc['provinces'])} regions; "
                  f"first 600 chars:\n{payload[:600]}")
        ok += 1

    if ok == 0:
        print("[build_origin_weather] FATAL — no origin produced; failing.", file=sys.stderr)
        sys.exit(1)
    print(f"[build_origin_weather] done — {ok}/{len(selected)} origins.")


if __name__ == "__main__":
    main()
