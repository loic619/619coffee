#!/usr/bin/env python3
"""
fetch_origin_weather.py — daily weather fetch → accumulate → rebuild chart JSON.

The pipeline the charts want, decoupled from the export workflow (1.4):

  1. FETCH daily rain + temperature for every origin's producing regions from
     Open-Meteo's *forecast* API (api.open-meteo.com — reachable from CI; the
     archive host is not), pulling past_days=92 + a 7-day forecast.
  2. ACCUMULATE the past/today actuals into a growing per-origin history file
     backend/seed/weather_history/{origin}.json (idempotent upsert keyed by
     date). Run daily, the history grows into full months/years.
  3. REBUILD frontend/public/data/{origin}_weather.json (the file the charts
     read): climatology bands (monthly avg/min/max rain & temp) are kept from
     the committed per-region seed; the actual-current-year, daily
     month-to-date accumulation, last-year (once accumulated) and 7-day
     forecast series are recomputed from the live history. As real history
     fills a calendar year, the actuals replace the seed month by month.

The forecast API only exposes ~92 past days, so historic months before
accumulation started can't be backfilled (the archive host that could is
blocked). Months are emitted as actuals only once the history covers them;
the current month always shows month-to-date.

Usage (no DB; files only):
    python fetch_origin_weather.py [--write] [--origins brazil colombia ...]
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import socket
import statistics
import sys
import time
from pathlib import Path

import requests
import urllib3.util.connection as urllib3_conn

# Runner has no IPv6 route; force IPv4 so api.open-meteo.com resolves to A.
urllib3_conn.allowed_gai_family = lambda: socket.AF_INET

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"
HISTORY_DIR = REPO_ROOT / "backend" / "seed" / "weather_history"
SPI_SEED_PATH  = REPO_ROOT / "backend" / "seed" / "spi_30yr_baselines.json"
SPEI_SEED_PATH = REPO_ROOT / "backend" / "seed" / "spei_30yr_baselines.json"

# SPI is computed in CI from the committed 30-yr baseline (built one-shot by the
# build-spi-baselines workflow) + the current month's rain — no archive call at
# daily runtime. Guarded: if scipy is unavailable or the seed isn't committed
# yet, SPI is simply omitted.
try:
    import spi_calc
    HAS_SPI = True
except Exception:  # noqa: BLE001  (scipy missing, etc.)
    HAS_SPI = False

# SPEI follows the exact same pattern as SPI but on D = P − ET₀. Same scipy
# guard, same graceful omission until the SPEI seed + ET₀-aware forecast
# fetch are both in place.
try:
    import spei_calc
    HAS_SPEI = True
except Exception:  # noqa: BLE001
    HAS_SPEI = False

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelWeather/1.0)"}
PAST_DAYS = 92
FORECAST_DAYS = 8  # today + 7 future days (the 7 future days populate the chart)

TODAY = dt.date.today()
CUR_YEAR = TODAY.year
LAST_YEAR = CUR_YEAR - 1
TWO_YEARS_AGO = CUR_YEAR - 2  # Needed by the crop-year LY line (e.g. Brazil
                              # Jun-May): the prior crop year's first 7 months
                              # fall in TWO_YEARS_AGO. See WeatherCharts.tsx
                              # _rainForYear / _tempForYear lookups.
# 10-year window for the daily-accum envelope. Built from the freshly
# backfilled history (1995-2024) + the live 2025+ data, so it reflects
# the actual recent decade rather than the stale fetched aggregates from
# the original seed run.
ENVELOPE_RANGE_START = CUR_YEAR - 10
ENVELOPE_RANGE_END   = CUR_YEAR - 1
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS_IN_MONTH = [31, 29 if CUR_YEAR % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# Per-region coordinates (name must match the seed/chart province names).
ORIGINS: dict[str, list[dict]] = {
    "brazil": [
        {"name": "Sul de Minas",   "lat": -21.55, "lon": -45.43},
        {"name": "Cerrado",        "lat": -18.95, "lon": -46.99},
        {"name": "Espírito Santo", "lat": -20.00, "lon": -40.80},
        {"name": "Paraná",         "lat": -23.31, "lon": -50.62},
    ],
    "colombia": [
        {"name": "Huila",     "lat": 1.85, "lon": -76.05},
        {"name": "Antioquia", "lat": 6.25, "lon": -75.56},
        {"name": "Cauca",     "lat": 2.44, "lon": -76.61},
        {"name": "Caldas",    "lat": 5.07, "lon": -75.52},
        {"name": "Nariño",    "lat": 1.21, "lon": -77.28},
    ],
    "honduras": [
        {"name": "El Paraíso",    "lat": 13.99, "lon": -86.57},
        {"name": "Copán",         "lat": 14.83, "lon": -88.87},
        {"name": "Santa Bárbara", "lat": 14.92, "lon": -88.24},
        {"name": "Montecillos",   "lat": 14.16, "lon": -88.02},
        {"name": "Agalta",        "lat": 14.68, "lon": -86.22},
    ],
    "indonesia": [
        {"name": "Lampung", "lat": -5.00, "lon": 104.80},
        {"name": "Gayo",    "lat": 4.62,  "lon": 96.85},
        {"name": "Java",    "lat": -7.91, "lon": 113.82},
        {"name": "Toraja",  "lat": -2.97, "lon": 119.90},
        {"name": "Flores",  "lat": -8.79, "lon": 120.98},
    ],
    # Rebuilt Aug 2026 — one station per production belt. Names MUST match
    # build_origin_weather.py's uganda regions (the rebuild keys on them).
    "uganda": [
        {"name": "Greater Masaka", "lat": -0.33, "lon": 31.73},   # robusta
        {"name": "Central",        "lat":  0.40, "lon": 32.04},   # robusta
        {"name": "Western",        "lat": -0.59, "lon": 30.19},   # robusta
        {"name": "Busoga",         "lat":  0.61, "lon": 33.47},   # robusta
        {"name": "Mt Elgon",       "lat":  1.39, "lon": 34.45},   # arabica
        {"name": "West Nile",      "lat":  2.52, "lon": 30.90},   # arabica
        {"name": "Rwenzori",       "lat":  0.66, "lon": 30.27},   # arabica
    ],
    "ethiopia": [
        {"name": "Sidama/Yirgacheffe", "lat": 6.16, "lon": 38.20},
        {"name": "Jimma", "lat": 7.67, "lon": 36.83},
        {"name": "Limu",  "lat": 8.06, "lon": 36.80},
        {"name": "Kaffa", "lat": 7.27, "lon": 36.23},
        {"name": "Harrar","lat": 9.31, "lon": 42.12},
    ],
    # Vietnam Central Highlands. Names MUST match vn_weather.json provinces — the
    # rebuild keeps that seed's curated climatology and only refreshes actuals,
    # daily MTD and forecast from live Open-Meteo, so VN stops going stale.
    "vn": [
        {"name": "Dak Lak",  "lat": 12.67, "lon": 108.05},
        {"name": "Lam Dong", "lat": 11.94, "lon": 108.44},
        {"name": "Dak Nong", "lat": 12.00, "lon": 107.69},
        {"name": "Gia Lai",  "lat": 13.98, "lon": 108.00},
        {"name": "Kon Tum",  "lat": 14.35, "lon": 108.00},
    ],
}


def r1(x: float) -> float:
    return round(x, 1)


# Open-Meteo *forecast*-API soil-moisture layers (0–81 cm). The archive/ERA5
# `0_to_7cm…28_to_100cm` layers aren't available on the forecast endpoint that
# CI can reach, so we use these. ESSM = per-hour unweighted mean of the
# available layers, averaged over the day → a single 0–1 soil-moisture fraction.
SOIL_LAYERS = (
    "soil_moisture_0_to_1cm",
    "soil_moisture_1_to_3cm",
    "soil_moisture_3_to_9cm",
    "soil_moisture_9_to_27cm",
    "soil_moisture_27_to_81cm",
)


def _daily_essm(hourly: dict | None) -> dict[str, float]:
    """Map date → daily Estimated Soil Moisture (0–1 fraction) from an
    Open-Meteo hourly block. Each hour's ESSM is the unweighted mean of the
    available soil layers; the day's ESSM is the mean over its hours."""
    if not hourly or "time" not in hourly:
        return {}
    times = hourly["time"]
    layers = [hourly[k] for k in SOIL_LAYERS if k in hourly]
    if not layers:
        return {}
    by_date: dict[str, list[float]] = {}
    for i, ts in enumerate(times):
        vals = [col[i] for col in layers if i < len(col) and col[i] is not None]
        if vals:
            by_date.setdefault(ts[:10], []).append(sum(vals) / len(vals))
    return {d: round(sum(v) / len(v), 3) for d, v in by_date.items() if v}


# Baseline lifecycle note: the seed JSONs are loaded fresh each invocation and
# never mutated. Per-month calibration is a {YYYY-MM: value} dict, so appending
# the current month is idempotent (no FIFO/pop needed; you can't accumulate
# duplicates). The real lifecycle concern is climatology aging — after a few
# years the 30y seed no longer reflects the latest climate. _warn_baseline_age()
# surfaces that in CI logs so we remember to re-run the build-* workflow.
_BASELINE_AGE_WARN_DAYS = 365 * 2   # 2 years; baselines should refresh annually


def _warn_baseline_age(label: str, base: dict) -> None:
    ts = base.get("generated_at") if isinstance(base, dict) else None
    if not ts:
        return
    try:
        gen = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return
    age_days = (dt.datetime.now(dt.UTC) - gen).days
    if age_days > _BASELINE_AGE_WARN_DAYS:
        print(f"  [{label}] baseline is {age_days}d old — consider re-running "
              f"the build-{label.lower()}-baselines workflow.")


def _load_spi_baselines() -> dict:
    if HAS_SPI and SPI_SEED_PATH.exists():
        try:
            return json.loads(SPI_SEED_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {}


_SPI_BASE = _load_spi_baselines()
_warn_baseline_age("SPI", _SPI_BASE)


def _load_spei_baselines() -> dict:
    if HAS_SPEI and SPEI_SEED_PATH.exists():
        try:
            return json.loads(SPEI_SEED_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {}


_SPEI_BASE = _load_spei_baselines()
_warn_baseline_age("SPEI", _SPEI_BASE)


def _monthly_rain(reg_hist: dict) -> tuple[dict[str, float], dict[str, int]]:
    """Region history rows → ({'YYYY-MM': total rain mm}, {'YYYY-MM': day count}).
    The day count lets SPI skip partially-covered months (a half-empty month
    would otherwise read as near-zero rain and pin SPI to its clamp floor)."""
    totals: dict[str, float] = {}
    counts: dict[str, int] = {}
    for date, v in reg_hist.items():
        if isinstance(v, dict) and v.get("rain") is not None:
            ym = date[:7]
            totals[ym] = round(totals.get(ym, 0.0) + v["rain"], 1)
            counts[ym] = counts.get(ym, 0) + 1
    return totals, counts


def _monthly_et0(reg_hist: dict) -> tuple[dict[str, float], dict[str, int]]:
    """Region history rows → ({'YYYY-MM': total ET₀ mm}, {'YYYY-MM': day count}).
    Same gating model as `_monthly_rain` — a half-covered month shouldn't bias
    the SPEI water balance."""
    totals: dict[str, float] = {}
    counts: dict[str, int] = {}
    for date, v in reg_hist.items():
        if isinstance(v, dict) and v.get("et0") is not None:
            ym = date[:7]
            totals[ym] = round(totals.get(ym, 0.0) + v["et0"], 1)
            counts[ym] = counts.get(ym, 0) + 1
    return totals, counts


def _month_complete(ym: str, month_days: dict[str, int]) -> bool:
    """True if the history covers ≥ (days_in_month − 2) days of `ym` — enough to
    treat its rain total as complete for SPI (vs a partial ~0 mm month that would
    pin SPI to its clamp floor)."""
    y, m = (int(x) for x in ym.split("-"))
    return month_days.get(ym, 0) >= calendar.monthrange(y, m)[1] - 2


def _spi_target_month(cur_monthly: dict[str, float], month_days: dict[str, int],
                      cur_key: str) -> str | None:
    """Latest month eligible for SPI: strictly before the (partial) current
    month, near-complete in the history, AND with non-zero rain. The non-zero
    rule excludes full-length but entirely-0 mm months (missing data written as
    zeros), which would otherwise pin SPI to its clamp floor. None if none."""
    done = sorted(k for k in cur_monthly
                  if k < cur_key and cur_monthly[k] > 0 and _month_complete(k, month_days))
    return done[-1] if done else None


# ── HTTP ─────────────────────────────────────────────────────────────────────
def _get(params: dict) -> dict:
    last: Exception | None = None
    for attempt in range(4):
        try:
            r = requests.get(FORECAST_URL, params=params, headers=HEADERS, timeout=(10, 60))
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"{r.status_code} retryable")
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
    raise last  # type: ignore[misc]


def preflight() -> None:
    try:
        _get({"latitude": 0, "longitude": 0, "daily": "precipitation_sum",
              "forecast_days": 1, "timezone": "UTC"})
        print("[preflight] api.open-meteo.com reachable.", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[preflight] FATAL — forecast API unreachable: {e}", file=sys.stderr)
        sys.exit(2)


def fetch_region(lat: float, lon: float) -> dict:
    return _get({
        "latitude": lat, "longitude": lon,
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean,et0_fao_evapotranspiration",
        "hourly": ",".join(SOIL_LAYERS),   # soil moisture → daily ESSM
        "past_days": PAST_DAYS, "forecast_days": FORECAST_DAYS, "timezone": "auto",
    })


# ── History accumulation ─────────────────────────────────────────────────────
def load_history(origin: str) -> dict:
    p = HISTORY_DIR / f"{origin}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"_note": f"Accumulated daily Open-Meteo actuals for {origin} regions. "
                     "Grows daily; never overwrites past days with gaps.", "regions": {}}


def save_history(origin: str, hist: dict) -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    (HISTORY_DIR / f"{origin}.json").write_text(
        json.dumps(hist, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def upsert(hist: dict, region: str, daily: dict) -> list[dict]:
    """Write past/today actuals into history; return the future forecast rows."""
    d = daily["daily"]
    times = d["time"]
    pr = d["precipitation_sum"]
    tx = d["temperature_2m_max"]
    tn = d["temperature_2m_min"]
    tm = d["temperature_2m_mean"]
    # et0 is a recent addition to the request (powers SPEI). Older history
    # rows may not carry it; we tolerate the key missing on the API side
    # too (older deployed versions of the fetcher didn't request it).
    et0 = d.get("et0_fao_evapotranspiration") or [None] * len(times)
    essm_by_date = _daily_essm(daily.get("hourly"))
    reg = hist["regions"].setdefault(region, {})
    today_iso = TODAY.isoformat()
    forecast = []
    for i, date in enumerate(times):
        raw_rain = pr[i]   # may be None — the API returns null for missing days
        if date <= today_iso:
            # Merge, don't clobber: the forecast API returns null precip/tmean for
            # many older past-days, so never overwrite a known value (e.g. one
            # filled by the archive backfill) with a null on a later run. A null
            # precip must NOT be stored as 0.0 — that silently zero-fills real rain
            # (the Mar/Apr all-zero months that broke SPI). Fall back to (max+min)/2
            # when the mean itself is null but the extremes aren't.
            mean = tm[i]
            if mean is None and tx[i] is not None and tn[i] is not None:
                mean = (tx[i] + tn[i]) / 2
            new_tmean = round(mean, 1) if mean is not None else None
            prev = reg.get(date, {})
            new_essm = essm_by_date.get(date)
            # Guard against the "API returns 0.0 for a past date" regression
            # that wiped Mar/Apr 2026 across every origin (the all-zero months
            # that broke the rainfall chart). If a date older than 7 days
            # already has a non-zero stored rain reading, refuse to overwrite
            # it with 0.0 — treat the new 0.0 as a transient API hiccup.
            # Real zero-rain days are still accepted on first capture (when
            # prev is None or already 0.0) and within the 7-day window.
            new_rain = r1(raw_rain) if raw_rain is not None else prev.get("rain")
            prev_rain = prev.get("rain")
            if (raw_rain == 0.0 and prev_rain not in (None, 0.0)
                    and date < (TODAY - dt.timedelta(days=7)).isoformat()):
                new_rain = prev_rain
            new_et0 = et0[i]
            reg[date] = {
                "rain":  new_rain,
                "tmean": new_tmean if new_tmean is not None else prev.get("tmean"),
                "essm":  new_essm if new_essm is not None else prev.get("essm"),
                # Penman-Monteith ET₀ in mm/day. Same merge-don't-clobber rule
                # as rain/tmean so an API hiccup never wipes a stored value.
                "et0":   r1(new_et0) if new_et0 is not None else prev.get("et0"),
            }
        else:
            # Future forecast rows are display-only; 0.0 for a null is fine here.
            forecast.append({"date": date, "rain": r1(raw_rain or 0.0),
                             "tmax": tx[i], "tmin": tn[i]})
    return forecast


# ── Chart-JSON rebuild ───────────────────────────────────────────────────────
def _pctl(vs: list[float], q: float) -> float:
    """Linear-interpolated q-quantile (0..1) of a sorted-or-unsorted list.
    Same shape as numpy.quantile(method='linear'). Caller is responsible
    for filtering out None entries before passing."""
    if not vs:
        return 0.0
    s = sorted(vs)
    if len(s) == 1:
        return s[0]
    pos = q * (len(s) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def _monthly_totals_per_year(reg_hist: dict, year_start: int, year_end: int,
                              ) -> dict[str, list[float | None]]:
    """{year_str: [12 monthly rain totals or None]} for each calendar year in
    [year_start, year_end]. A month with fewer than (dim - 2) days of data is
    emitted as None so partial months don't skew the cumulative-envelope
    computation downstream. Stored in the published *_weather.json so the
    chart can derive per-year cumulative curves client-side, then take min/
    max across years for an honest cumulative envelope (sum of per-month
    minima never lands on any single observed year — that was the old bug).
    11-year window — caller passes (CUR_YEAR-11, CUR_YEAR-1) so the chart
    can build 10 crop-year cumulative windows even when the displayed year
    straddles a calendar boundary (e.g. Brazil's Jun-May)."""
    out: dict[str, list[float | None]] = {}
    for y in range(year_start, year_end + 1):
        row: list[float | None] = []
        for m in range(1, 13):
            dim = DAYS_IN_MONTH[m - 1]
            total = 0.0
            n = 0
            for d in range(1, dim + 1):
                v = reg_hist.get(f"{y}-{m:02d}-{d:02d}")
                if v and v.get("rain") is not None:
                    total += v["rain"]
                    n += 1
            row.append(r1(total) if n >= dim - 2 else None)
        out[str(y)] = row
    return out


def _monthly_aggregates_10y(reg_hist: dict, year_start: int, year_end: int,
                             ) -> tuple[list[float | None], list[float | None],
                                        list[float | None], list[float | None],
                                        list[float | None], list[float | None],
                                        list[float | None]]:
    """For each calendar month 1..12, walk years [year_start, year_end] and
    return (avg_rain, min_rain, max_rain, dry_warn_p20, avg_temp, min_temp,
    max_temp) as 12-element lists. Months without ≥1 near-complete year
    (≥dim-2 days) get None.

    dry_warn_p20 = 20th percentile of monthly rain totals across the 10Y
    window — the drought-risk floor used by the Monthly Rainfall bar chart's
    orange "drought-risk zone" overlay. Previously sourced from
    build_origin_weather.py's 30Y P20 (one-shot seed, never refreshed); now
    auto-rolls with the rest of the climatology."""
    avg_rain: list[float | None] = []
    min_rain: list[float | None] = []
    max_rain: list[float | None] = []
    dry_warn: list[float | None] = []
    avg_temp: list[float | None] = []
    min_temp: list[float | None] = []
    max_temp: list[float | None] = []
    for m in range(1, 13):
        dim = DAYS_IN_MONTH[m - 1]
        rain_totals: list[float] = []
        temp_means: list[float] = []
        for y in range(year_start, year_end + 1):
            r_total = 0.0
            r_n = 0
            t_sum = 0.0
            t_n = 0
            for d in range(1, dim + 1):
                v = reg_hist.get(f"{y}-{m:02d}-{d:02d}")
                if not v:
                    continue
                if v.get("rain") is not None:
                    r_total += v["rain"]
                    r_n += 1
                if v.get("tmean") is not None:
                    t_sum += v["tmean"]
                    t_n += 1
            # Require near-complete months only; partial months would skew
            # both the average and the envelope endpoints downward.
            if r_n >= dim - 2:
                rain_totals.append(r_total)
            if t_n >= dim - 2:
                temp_means.append(t_sum / t_n)
        def _agg(vs: list[float], op):
            return r1(op(vs)) if vs else None
        avg_rain.append(_agg(rain_totals, lambda xs: sum(xs) / len(xs)))
        min_rain.append(_agg(rain_totals, min))
        max_rain.append(_agg(rain_totals, max))
        dry_warn.append(_agg(rain_totals, lambda xs: _pctl(xs, 0.20)))
        avg_temp.append(_agg(temp_means, lambda xs: sum(xs) / len(xs)))
        min_temp.append(_agg(temp_means, min))
        max_temp.append(_agg(temp_means, max))
    return avg_rain, min_rain, max_rain, dry_warn, avg_temp, min_temp, max_temp


def _month_rain(reg_hist: dict, year: int, month: int) -> tuple[float, int]:
    """(total rain, day-count) for a region-history dict in year/month."""
    total = 0.0
    n = 0
    for date, v in reg_hist.items():
        if int(date[:4]) == year and int(date[5:7]) == month and v.get("rain") is not None:
            total += v["rain"]
            n += 1
    return total, n


def _month_temp(reg_hist: dict, year: int, month: int) -> tuple[float | None, int]:
    vals = [v["tmean"] for date, v in reg_hist.items()
            if int(date[:4]) == year and int(date[5:7]) == month and v.get("tmean") is not None]
    return (statistics.fmean(vals) if vals else None), len(vals)


def _year_actuals_rain(reg_hist: dict, year: int, upto_month: int) -> list[float | None]:
    """Monthly totals for completed months (>=26 days covered) up to upto_month;
    the current month is emitted as month-to-date."""
    out: list[float | None] = []
    for m in range(1, upto_month + 1):
        total, n = _month_rain(reg_hist, year, m)
        complete = m == upto_month or n >= DAYS_IN_MONTH[m - 1] - 2
        out.append(r1(total) if (n > 0 and complete) else None)
    return out


def _year_actuals_temp(reg_hist: dict, year: int, upto_month: int) -> list[float | None]:
    out: list[float | None] = []
    for m in range(1, upto_month + 1):
        mean, n = _month_temp(reg_hist, year, m)
        complete = m == upto_month or n >= DAYS_IN_MONTH[m - 1] - 2
        out.append(r1(mean) if (mean is not None and complete) else None)
    return out


def _trim_trailing_none(xs: list) -> list:
    while xs and xs[-1] is None:
        xs.pop()
    return xs


def _daily_accum(reg_hist: dict, year: int, month: int, dim: int) -> list[float | None]:
    """Per-day cumulative rain (mm) through day d of (year, month); None for days
    with no history yet (so the current month is null after the last actual day).
    Returns [] when the month has no data at all (caller falls back)."""
    out: list[float | None] = []
    acc = 0.0
    seen = False
    for d in range(1, dim + 1):
        v = reg_hist.get(f"{year}-{month:02d}-{d:02d}")
        if v is not None and v.get("rain") is not None:
            acc += v["rain"] or 0.0
            seen = True
            out.append(r1(acc))
        else:
            out.append(None)
    return out if seen else []


def _daily_accum_envelope(reg_hist: dict, month: int, dim: int,
                          year_start: int, year_end: int,
                          ) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """Per-day (1..dim) min / avg / max of cumulative rain across years in
    [year_start, year_end]. Replaces the chart's linear interpolation of
    monthly_min/avg/max_rain — that approach mis-flags bursty rainfall (a
    single early-month storm pushes the cumulative line above a max
    envelope that grows linearly from 0). With per-day percentiles built
    from real history, the envelope contains every observed yearly curve
    by construction. Returns ([min], [avg], [max]); each list has `dim`
    entries. Years with no data for a given day-in-month are skipped (so
    a partial-year doesn't pin the min at zero)."""
    per_year_curves: list[list[float | None]] = []
    for y in range(year_start, year_end + 1):
        acc = 0.0
        any_data = False
        curve: list[float | None] = []
        for d in range(1, dim + 1):
            v = reg_hist.get(f"{y}-{month:02d}-{d:02d}")
            rain = v.get("rain") if v else None
            if rain is not None:
                acc += rain
                any_data = True
                curve.append(acc)
            else:
                # Carry the accumulator forward (gap day = zero rain). Curve
                # still emits the running total so a single missing day
                # doesn't reset the year's progression.
                curve.append(acc if any_data else None)
        if any_data:
            per_year_curves.append(curve)
    if not per_year_curves:
        return [None] * dim, [None] * dim, [None] * dim
    mins: list[float | None] = []
    avgs: list[float | None] = []
    maxs: list[float | None] = []
    for d in range(dim):
        day_vals = [c[d] for c in per_year_curves if c[d] is not None]
        if not day_vals:
            mins.append(None); avgs.append(None); maxs.append(None)
        else:
            mins.append(r1(min(day_vals)))
            avgs.append(r1(sum(day_vals) / len(day_vals)))
            maxs.append(r1(max(day_vals)))
    return mins, avgs, maxs


def _daily_rain_history(reg_hist: dict, anchor: dt.date, n_months: int = 36,
                         ) -> dict[str, list[float | None]]:
    """{'YYYY-MM': [day1_rain, day2_rain, ..., dim_rain]} for the n_months
    months ending at `anchor.month`. Used by the chart to render the Daily
    Accumulated Rainfall panel for ANY selected month (not just the current
    one), and to derive the LY line for any selected month by looking up
    its (year-1, month) entry. 36 months ≈ 3 years means the user can pick
    any of the last 24 months and still see both cur + LY lines."""
    out: dict[str, list[float | None]] = {}
    y, m = anchor.year, anchor.month
    for _ in range(n_months):
        dim = calendar.monthrange(y, m)[1]
        row: list[float | None] = []
        any_data = False
        for d in range(1, dim + 1):
            v = reg_hist.get(f"{y}-{m:02d}-{d:02d}")
            rain = v.get("rain") if v else None
            if rain is not None:
                any_data = True
            row.append(r1(rain) if rain is not None else None)
        if any_data:
            out[f"{y}-{m:02d}"] = row
        # Step backwards one calendar month.
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return out


def _envelope_by_month(reg_hist: dict, year_start: int, year_end: int,
                       ) -> dict[str, dict[str, list[float | None]]]:
    """Pre-computes the 10Y daily-accum envelope for every month so the chart
    can show a realistic band on ANY selected month (not just the current
    one). {'1': {min, avg, max}, '2': {...}, ...} — each list has the day
    count for that month. Inner arrays mirror the shape of
    daily_accum_min_10y / _avg_10y / _max_10y."""
    out: dict[str, dict[str, list[float | None]]] = {}
    # Use a leap year for Feb so the 29-day envelope is always available;
    # the chart selects dim from new Date(year, month+1, 0).getDate() and
    # truncates Feb to 28 in non-leap years.
    leap = 2024
    for m in range(1, 13):
        dim = calendar.monthrange(leap, m)[1]
        mins, avgs, maxs = _daily_accum_envelope(reg_hist, m, dim, year_start, year_end)
        out[str(m)] = {"min": mins, "avg": avgs, "max": maxs}
    return out


def _unmojibake(s: str) -> str:
    """Reverse a past double-encoding round-trip: when accented UTF-8
    was decoded as Latin-1 and re-encoded as UTF-8, the bytes look like
    'EspÃ\\xadrito Santo'. Re-encoding as Latin-1 and decoding as UTF-8
    inverts that transform. Returns s unchanged if the transform fails
    or the result is unchanged."""
    try:
        fixed = s.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s
    return fixed if fixed != s else s


def _resolve_region(prov_name: str, regions_hist: dict) -> tuple[str, dict]:
    """Find the seed-history entry for a province, tolerating mojibake
    introduced by a past round-trip. Once the published *_weather.json
    has mojibake, the direct lookup misses, and monthly_actual_cur stops
    refreshing for that province — the chart bars for the current year
    appear empty (this was the March/April gap on Brazil/Colombia/Honduras).
    Returns (canonical_name, history_dict). canonical_name differs from
    prov_name when a heal happened; caller writes it back so the file
    becomes UTF-8-clean on the next commit."""
    if prov_name in regions_hist:
        return prov_name, regions_hist[prov_name]
    fixed = _unmojibake(prov_name)
    if fixed != prov_name and fixed in regions_hist:
        return fixed, regions_hist[fixed]
    return prov_name, {}


def rebuild_chart(origin: str, hist: dict, forecasts: dict[str, list[dict]]) -> dict | None:
    path = DATA_DIR / f"{origin}_weather.json"
    if not path.exists():
        print(f"  [skip] {origin}: no seed {path.name} to refresh", file=sys.stderr)
        return None
    doc = json.loads(path.read_text(encoding="utf-8"))
    cur_month = TODAY.month
    dim_cur = DAYS_IN_MONTH[cur_month - 1]
    regions_hist = hist["regions"]

    # Heal mojibake in top-level station label too (display-only field).
    if "station" in doc:
        fixed_station = _unmojibake(doc["station"])
        if fixed_station != doc["station"]:
            print(f"  [heal] {origin}: top.station {doc['station']!r} → {fixed_station!r}")
            doc["station"] = fixed_station

    for prov in doc["provinces"]:
        canonical, rh = _resolve_region(prov["name"], regions_hist)
        if canonical != prov["name"]:
            print(f"  [heal] {origin}: mojibake {prov['name']!r} → {canonical!r}")
            prov["name"] = canonical
        # Per-province station label is display-only — heal without lookup.
        if "station" in prov:
            fixed = _unmojibake(prov["station"])
            if fixed != prov["station"]:
                print(f"  [heal] {origin}: {prov['name']} station {prov['station']!r} → {fixed!r}")
                prov["station"] = fixed
        # Per-province daily accumulation for the current month (+ last year) so
        # the frontend can prod-weight the Daily Accumulated chart across the
        # selected regions, not just the single reference station.
        # Kept for backward compatibility — the chart prefers daily_rain_history
        # (lets it render any selected month, not just the current one).
        prov["daily_accum_cur"] = _daily_accum(rh, CUR_YEAR, cur_month, dim_cur)
        prov["daily_accum_ly"]  = _daily_accum(rh, LAST_YEAR, cur_month, dim_cur)
        # Last 36 months of per-day rain → the chart can build cur + LY
        # cumulative curves for ANY selected month within the last 24-25
        # months (selected_month + selected_month - 12). Before this field
        # existed, picking a past month blanked the cur line because
        # daily_accum_cur only covered the current month.
        prov["daily_rain_history"] = _daily_rain_history(rh, TODAY, n_months=36)
        # Per-day 10Y min/avg/max envelope built from the real backfilled history.
        # The chart used to interpolate a linear envelope from monthly_min/max
        # totals (max_day_d = monthly_max * d/dim), which is physically wrong:
        # a single early-month storm pushes the cumulative line above an
        # envelope that grows linearly from 0. Now the band reflects real
        # day-by-day percentiles across the 10 prior years.
        env_min, env_avg, env_max = _daily_accum_envelope(
            rh, cur_month, dim_cur, ENVELOPE_RANGE_START, ENVELOPE_RANGE_END)
        prov["daily_accum_min_10y"] = env_min
        prov["daily_accum_avg_10y"] = env_avg
        prov["daily_accum_max_10y"] = env_max
        # Same 10Y envelope but precomputed for every calendar month, so the
        # band keeps its real shape when the user selects a non-current month.
        prov["daily_envelope_by_month"] = _envelope_by_month(  # type: ignore[assignment]
            rh, ENVELOPE_RANGE_START, ENVELOPE_RANGE_END)
        # Refresh the monthly aggregates from the freshly backfilled history.
        # The original seed values came from a one-shot Open-Meteo fetch in
        # build_origin_weather.py; they're stale (ES Jun max was 27mm vs the
        # real 38.8mm from 2018). Recomputing here per-cron means they
        # auto-roll forward each year — by Jan 1 2027 the 10Y window slides
        # to 2017-2026 with no manual intervention.
        ar, ir, xr, dw, at, it, xt = _monthly_aggregates_10y(
            rh, ENVELOPE_RANGE_START, ENVELOPE_RANGE_END)
        # Only overwrite when every month is populated; partial coverage
        # would mean keeping the seed values for the missing months.
        if all(v is not None for v in ar):
            prov["monthly_avg_rain"] = ar  # type: ignore[assignment]
        if all(v is not None for v in ir):
            prov["monthly_min_rain"] = ir  # type: ignore[assignment]
        if all(v is not None for v in xr):
            prov["monthly_max_rain"] = xr  # type: ignore[assignment]
        if all(v is not None for v in dw):
            prov["monthly_dry_warn"] = dw  # type: ignore[assignment]
        if all(v is not None for v in at):
            prov["monthly_avg_temp"] = at  # type: ignore[assignment]
        if all(v is not None for v in it):
            prov["monthly_min_temp"] = it  # type: ignore[assignment]
        if all(v is not None for v in xt):
            prov["monthly_max_temp"] = xt  # type: ignore[assignment]
        # Per-year monthly rain totals (11Y window so the chart can build
        # 10 crop-year cumulatives that may straddle a calendar boundary,
        # e.g. Brazil's Jun-May display needs Jun-Dec of year y plus
        # Jan-May of year y+1). Feeds the Cumulative YTD chart's proper
        # min/max envelope — replaces the old naive sum-of-per-month-mins
        # which couldn't correspond to any actually-observed year.
        prov["monthly_totals_history"] = _monthly_totals_per_year(  # type: ignore[assignment]
            rh, ENVELOPE_RANGE_START - 1, ENVELOPE_RANGE_END)
        # Current-year actuals (live, accumulating). Keep seed where history is absent.
        act_r = _trim_trailing_none(_year_actuals_rain(rh, CUR_YEAR, cur_month))
        act_t = _trim_trailing_none(_year_actuals_temp(rh, CUR_YEAR, cur_month))
        if any(v is not None for v in act_r):
            prov["monthly_actual_cur"] = act_r
        if any(v is not None for v in act_t):
            prov["monthly_actual_temp_cur"] = act_t
        # Last-year actuals — only once history covers them, else keep seed.
        ly_r = _year_actuals_rain(rh, LAST_YEAR, 12)
        if all(v is not None for v in ly_r) and len(ly_r) == 12:
            prov["monthly_last_year_rain"] = ly_r
        ly_t = _year_actuals_temp(rh, LAST_YEAR, 12)
        if all(v is not None for v in ly_t) and len(ly_t) == 12:
            prov["monthly_last_year_temp"] = ly_t
        # Two-years-ago actuals. Populates only after the 0.9 backfill workflow
        # has imported 1995-2024 into weather_history. Without these, crop-year
        # charts (Brazil = Jun-May) have a null first half on the previous-crop-
        # year line because the prior crop year's Jun-Dec falls in TWO_YEARS_AGO.
        t2_r = _year_actuals_rain(rh, TWO_YEARS_AGO, 12)
        if all(v is not None for v in t2_r) and len(t2_r) == 12:
            prov["monthly_two_years_ago_rain"] = t2_r
        t2_t = _year_actuals_temp(rh, TWO_YEARS_AGO, 12)
        if all(v is not None for v in t2_t) and len(t2_t) == 12:
            prov["monthly_two_years_ago_temp"] = t2_t
        # 7-day forecast rain.
        fc = forecasts.get(prov["name"], [])
        if fc:
            prov["forecast_7d_rain"] = [r1(f["rain"]) for f in fc]
        # Estimated Soil Moisture (0–1 fraction): latest reading + recent series.
        # 400 days ≈ 13 months covers both the in-chart "current month" view and
        # the "calendar year" toggle. Daily fetcher is forward-only, so the
        # year view fills in over time on existing files (currently shallow).
        essm = sorted((d, v["essm"]) for d, v in rh.items()
                      if isinstance(v, dict) and v.get("essm") is not None)
        if essm:
            prov["essm_fraction"] = essm[-1][1]
            prov["essm_recent"] = [{"date": d, "essm": e} for d, e in essm[-400:]]
        # SPI-1 / SPI-3 from the committed 30-yr baseline + live monthly rain.
        # Target the latest month that is past (current is partial), near-complete
        # in the history (≥ days−2), AND has non-zero rain. The non-zero check is
        # essential: some history months are full-length but entirely 0.0 mm
        # (missing data written as zeros) — feeding that into the gamma fit pins
        # SPI to its −4.75 clamp floor. Skipping them targets the last month with
        # real rain instead (or omits SPI if none qualifies).
        calib = _SPI_BASE.get("origins", {}).get(origin, {}).get(prov["name"])
        if HAS_SPI and calib:
            cur_monthly, month_days = _monthly_rain(rh)
            tgt = _spi_target_month(cur_monthly, month_days, f"{CUR_YEAR}-{cur_month:02d}")
            if tgt:
                s1 = spi_calc.spi_for_month(calib, cur_monthly, tgt, 1)
                s3 = spi_calc.spi_for_month(calib, cur_monthly, tgt, 3)
                if s1 is not None:
                    prov["spi_1"] = s1
                if s3 is not None:
                    prov["spi_3"] = s3
                if s1 is not None or s3 is not None:
                    prov["spi_month"] = tgt
        # SPEI-1 / SPEI-3 from the same 30-yr baseline pattern but on
        # D = P − ET₀. Reuses the SPI gating (`_spi_target_month`) and the
        # same monthly-rain helpers to identify the latest complete past
        # month; just needs the parallel monthly_et0 series.
        calib_spei = _SPEI_BASE.get("origins", {}).get(origin, {}).get(prov["name"])
        if HAS_SPEI and calib_spei:
            cur_p, day_counts = _monthly_rain(rh)
            cur_et0, _ = _monthly_et0(rh)
            tgt = _spi_target_month(cur_p, day_counts, f"{CUR_YEAR}-{cur_month:02d}")
            if tgt:
                # Calibration: {YYYY-MM: {'p': mm, 'et0': mm}} → D = P − ET₀.
                cal_p   = {k: v["p"]   for k, v in calib_spei.items() if v.get("p")   is not None}
                cal_et0 = {k: v["et0"] for k, v in calib_spei.items() if v.get("et0") is not None}
                cal_d = spei_calc.monthly_d(cal_p, cal_et0)
                cur_d = spei_calc.monthly_d(cur_p, cur_et0)
                if cal_d and cur_d.get(tgt) is not None:
                    z1 = spei_calc.spei_for_month(cal_d, cur_d, tgt, 1)
                    z3 = spei_calc.spei_for_month(cal_d, cur_d, tgt, 3)
                    if z1 is not None:
                        prov["spei_1"] = z1
                    if z3 is not None:
                        prov["spei_3"] = z3
                    if z1 is not None or z3 is not None:
                        prov["spei_month"] = tgt

    # Daily month-to-date accumulation for the reference (first) province.
    ref = doc["provinces"][0]
    ref_hist = regions_hist.get(ref["name"], {})
    m_idx = cur_month - 1
    dim = DAYS_IN_MONTH[m_idx]
    month_norm = ref["monthly_avg_rain"][m_idx] if ref.get("monthly_avg_rain") else 0
    cur_days = sorted(int(date[8:10]) for date in ref_hist
                      if int(date[:4]) == CUR_YEAR and int(date[5:7]) == cur_month)
    daily_rows: list[dict] = []
    keep_prior_daily = False
    if not cur_days and doc.get("daily_station"):
        # Month rollover before the live fetch has captured the 1st: keep
        # the previously-published daily_station rather than wipe it. The
        # next cron run with fresh history will replace it with the new
        # month. Without this guard, a one-shot heal or a day-1 fetch
        # failure would leave the chart blank.
        keep_prior_daily = True
    if cur_days:
        last_actual = max(cur_days)
        accum = 0.0
        ly_accum = 0.0
        # Emit the whole month so the climatology band/avg/last-year lines span
        # past the forecast window; current-year accum is null after the last
        # actual day (the chart bridges that gap with the forecast projection).
        for d in range(1, dim + 1):
            key = f"{CUR_YEAR}-{cur_month:02d}-{d:02d}"
            v = ref_hist.get(key, {})
            rain = v.get("rain", 0.0) or 0.0
            lyk = f"{LAST_YEAR}-{cur_month:02d}-{d:02d}"
            lv = ref_hist.get(lyk)
            avg_accum = month_norm * (d / dim)
            if lv is not None:
                ly_accum += lv.get("rain", 0.0) or 0.0
                ly_val = r1(ly_accum)
            else:
                ly_val = r1(avg_accum * 1.08)
            if d <= last_actual:
                accum += rain
                rain_out: float = r1(rain)
                accum_out: float | None = r1(accum)
            else:
                rain_out = 0.0
                accum_out = None
            daily_rows.append({
                "day": d,
                "rain_mm": rain_out,
                "accum_mm": accum_out,
                "avg_accum_mm": r1(avg_accum),
                "min_accum_mm": r1(avg_accum * 0.6),
                "max_accum_mm": r1(avg_accum * 1.5),
                "last_year_accum_mm": ly_val,
                "temp_c": r1(v["tmean"]) if v.get("tmean") is not None else 0.0,
            })
    if not keep_prior_daily:
        doc["daily_station"] = daily_rows

    # 7-day forecast list from the reference province.
    ref_fc = forecasts.get(ref["name"], [])
    fc_list = []
    for f in ref_fc:
        date = f["date"]
        mo, day = int(date[5:7]), int(date[8:10])
        fc_list.append({
            "date": date, "label": f"{MONTHS[mo - 1]} {day}",
            "rain_mm": r1(f["rain"]),
            "temp_max_c": r1(f["tmax"]) if f.get("tmax") is not None else 0.0,
            "temp_min_c": r1(f["tmin"]) if f.get("tmin") is not None else 0.0,
        })
    if fc_list:
        doc["forecast_7d"] = fc_list

    doc["updated"] = TODAY.isoformat()
    doc["cur_year"] = CUR_YEAR
    doc["last_year"] = LAST_YEAR
    doc["source_weather"] = ("Open-Meteo forecast API (live, accumulated daily) · "
                             "climatology bands seeded, refined as history builds")
    doc["_note"] = (
        "Climatology (avg/min/max) from committed per-region seed; actual-cur, "
        "daily MTD, last-year (once accumulated) and 7-day forecast are live from "
        "Open-Meteo's forecast API, accumulated daily in backend/seed/weather_history/."
    )
    return doc


def build_origin(origin: str, write: bool) -> None:
    regions = ORIGINS[origin]
    hist = load_history(origin)
    forecasts: dict[str, list[dict]] = {}
    fetched = 0
    for rc in regions:
        print(f"  [{origin}] fetch {rc['name']} ({rc['lat']:.2f},{rc['lon']:.2f}) …", flush=True)
        try:
            daily = fetch_region(rc["lat"], rc["lon"])
            forecasts[rc["name"]] = upsert(hist, rc["name"], daily)
            fetched += 1
        except Exception as e:  # noqa: BLE001 — a flaky region must not abort the origin
            print(f"  [warn] {origin}/{rc['name']} fetch failed, keeping prior data: {e}",
                  file=sys.stderr)
        time.sleep(1)
    if fetched == 0:
        raise RuntimeError("all regions failed to fetch")

    doc = rebuild_chart(origin, hist, forecasts)
    if doc is None:
        return
    if write:
        save_history(origin, hist)
        (DATA_DIR / f"{origin}_weather.json").write_text(
            json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        days = sum(len(v) for v in hist["regions"].values())
        print(f"  [write] {origin}: history={days} region-days, "
              f"daily={len(doc['daily_station'])}, fc={len(doc['forecast_7d'])}")
    else:
        ref = doc["provinces"][0]
        print(f"  [preview] {origin}: actual_cur(ref)={ref['monthly_actual_cur']}, "
              f"daily={len(doc['daily_station'])} rows, fc={len(doc['forecast_7d'])}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--origins", nargs="*")
    args = ap.parse_args()
    selected = args.origins or list(ORIGINS.keys())
    print(f"[fetch_origin_weather] {len(selected)} origins · {TODAY.isoformat()} "
          f"· past_days={PAST_DAYS}")
    preflight()
    ok = 0
    for origin in selected:
        if origin not in ORIGINS:
            print(f"  [skip] unknown origin: {origin}", file=sys.stderr)
            continue
        try:
            build_origin(origin, args.write)
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"  [fail] {origin}: {e}", file=sys.stderr)
    if ok == 0:
        print("[fetch_origin_weather] FATAL — no origin processed.", file=sys.stderr)
        sys.exit(1)
    print(f"[fetch_origin_weather] done — {ok}/{len(selected)} origins.")

    # News-feed drought-gate badge — additive, never fails the weather rebuild.
    if args.write:
        try:
            from weather_news_emit import emit as _emit_weather_news
            data_dir = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"
            _emit_weather_news(data_dir)
        except Exception as e:  # noqa: BLE001
            print(f"[weather-news] FAILED: {e!r} — weather files already written")


if __name__ == "__main__":
    main()
