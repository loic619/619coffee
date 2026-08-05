#!/usr/bin/env python3
"""
compute_weather_analogs.py — weather-analog forecasting for all 3 robusta /
arabica producing regions where we have enough data: Brazil arabica,
Vietnam robusta, Indonesia robusta. Same architecture per origin, different
phenology + production seed.

Per-stage signature (6 features × 4 stages = 24 dim):
    rain_mm         prod-weighted total
    temp_c          prod-weighted mean
    rain_anom_pct   (rain - 10Y mean) / 10Y mean × 100
    spi_z           z-score of stage rain across historical population
    spei_z          z-score of stage (rain - et0) across historical population
    oni_avg         NOAA CPC 3-mo Niño-3.4 anomaly averaged over stage

Distance: Mahalanobis on z-scored historical features (with ridge), Top-N
closest. Detrended (log-linear) production y/y for cross-decade comparison.
Walk-forward backtest for skill assessment. Bootstrap 95% CI on ensemble.

Output: frontend/public/data/weather_analogs_{origin}.json
"""
from __future__ import annotations

import datetime as dt
import json
import math
import statistics
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
HISTORY_DIR = REPO_ROOT / "backend" / "seed" / "weather_history"
SEED_DIR    = REPO_ROOT / "backend" / "seed"
OUT_DIR     = REPO_ROOT / "frontend" / "public" / "data"
ONI_PATH    = SEED_DIR / "oni_history_full.json"
VHI_DIR     = REPO_ROOT / "frontend" / "public" / "data"


def _load_vhi_history(vhi_file: str, prod_weights: dict[str, int]
                       ) -> dict[tuple[int, int], float]:
    """{(year, week): prod-weighted VHI} pulled from the long-form
    backfill (vhi_<origin>.json's weekly_history). Returns empty dict when
    no long-form is present (only the rolling 3Y window is shipped) — the
    analog engine then silently skips the VHI feature."""
    path = VHI_DIR / vhi_file
    if not path.exists():
        return {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}
    out: dict[tuple[int, int], list[tuple[float, int]]] = {}
    provs = doc.get("provinces", {}) or {}
    for prov_name, weight in prod_weights.items():
        history = (provs.get(prov_name) or {}).get("weekly_history") or []
        for row in history:
            y, w, v = row.get("year"), row.get("week"), row.get("vhi")
            if y is None or w is None or v is None:
                continue
            out.setdefault((int(y), int(w)), []).append((float(v), int(weight)))
    # Reduce to a single prod-weighted value per (year, week).
    return {
        ym: round(sum(v * w for v, w in vals) / sum(w for _, w in vals), 2)
        for ym, vals in out.items() if vals
    }


def _iso_week_in_stage(year: int, week: int, stage_months: list[int], anchor: str,
                       crop_year: int) -> bool:
    """True when the ISO week belongs to one of the stage's calendar
    (year, month) tuples for the given crop_year. Approximate: ISO week
    midpoint = year-01-01 + (week-1)*7 + 3 (Thursday). Good enough for
    bucketing weekly VHI into per-stage averages."""
    midpoint = dt.date(year, 1, 1) + dt.timedelta(days=(week - 1) * 7 + 3)
    target_months = {(cy, m) for cy, m in _stage_window(stage_months, crop_year, anchor)}
    return (midpoint.year, midpoint.month) in target_months

# ONI history: NOAA CPC 3-month running mean of Niño-3.4 SST anomaly.
_ONI_DOC = json.loads(ONI_PATH.read_text(encoding="utf-8"))
ONI_BY_YM: dict[tuple[int, int], float] = {
    (r["year"], r["month"]): float(r["value"]) for r in _ONI_DOC["oni"]
}

# ── Phenology zone templates ─────────────────────────────────────────────────
# Coffee phenology is climate-hemisphere-dependent. Two symmetric templates
# with a clean 6-month offset between them, matching how harvest peaks split
# between the hemispheres:
#
#   southern_hemisphere (Brazil + Indonesia robusta): pre-flowering starts
#     Aug-Sep, harvest peaks May-Sep of the crop year. Used by producers
#     south of ~3°N — including Indonesia's Lampung+Java robusta belt
#     (5-7°S) where Brazil's pattern fits cleanly.
#
#   northern_hemisphere (Vietnam + future Honduras / Ethiopia / Colombia):
#     6 months offset from southern — pre-flowering starts Feb-Mar,
#     harvest peaks Nov-Feb. Used by producers north of ~3°N. Vietnam
#     robusta's bloom is timed Feb-Mar via dry-season irrigation
#     withholding; the rest of the cycle follows Asian/Caribbean monsoon
#     rhythm.
#
# Equatorial origins (Indonesia, Colombia, Uganda) PICK ONE of the two
# templates based on which hemisphere their dominant producing region sits
# in. Each origin's config says "zone": "southern_hemisphere" or
# "northern_hemisphere" — no separate equatorial template, just pick the
# right anchor for the producer geography.
PHENOLOGY_ZONES: dict[str, dict] = {
    "southern_hemisphere": {
        "stages": [
            ("pre_flowering", [8, 9]),       # Aug-Sep of (Y-1): end of dry season
            ("flowering",     [10, 11]),     # Oct-Nov of (Y-1): spring rain triggers bloom
            ("fruit_fill",    [12, 1, 2]),   # Dec (Y-1) - Feb (Y): summer wet, grand expansion
            ("maturation",    [3, 4, 5]),    # Mar-May of (Y): autumn dry-down toward harvest
        ],
        "anchor":            "wrap_august",  # months ≥ 8 → crop_year-1
        "harvest_period":    "May-Sep of crop_year",
        "flip_month":        8,              # cur_crop_year advances when today.month ≥ 8
        "post_flip_offset":  1,              # year+1 when past flip (harvest is NEXT year)
    },
    "northern_hemisphere": {
        # Symmetric 6-month offset from southern_hemisphere. All stages live
        # in calendar year Y; harvest straddles into Y+1 but stages don't.
        "stages": [
            ("pre_flowering", [2, 3]),       # Feb-Mar of Y: end of dry rest
            ("flowering",     [4, 5]),       # Apr-May of Y: rain triggers bloom (or irrigation in VN)
            ("fruit_fill",    [6, 7, 8]),    # Jun-Aug of Y: monsoon wet season
            ("maturation",    [9, 10, 11]),  # Sep-Nov of Y: dry-down toward harvest
        ],
        "anchor":            "no_wrap",      # all stage months belong to crop_year directly
        "harvest_period":    "Nov Y - Feb Y+1",
        "flip_month":        2,              # cur_crop_year advances when today.month ≥ 2
        "post_flip_offset":  0,              # year+0 (harvest is THIS year's late + Y+1 early)
    },
}

# Days after a crop-cycle flip during which an empty current-cycle feature
# vector is treated as the normal "new cycle, nothing accumulated yet" state
# (graceful skip) rather than an error. The first stage spans two months, so
# features can legitimately take ~60 d to appear; 92 d matches the weather
# fetcher's own history window and leaves margin before we alarm.
ROLLOVER_GRACE_DAYS = 92


def _days_into_cycle(today: "dt.date", flip_month: int) -> int:
    """Days since the most recent cycle flip (the 1st of flip_month)."""
    flip_year = today.year if today.month >= flip_month else today.year - 1
    return (today - dt.date(flip_year, flip_month, 1)).days


# Per-origin configuration — each origin references a phenology zone above
# and adds its own region weights, production seed, history files.
ORIGIN_CONFIGS = {
    "brazil_arabica": {
        "label":          "Brazil arabica",
        "history_file":   "brazil.json",
        "prod_seed_file": "brazil_arabica_production.json",
        "vhi_file":       "vhi_brazil.json",
        "out_file":       "weather_analogs_brazil.json",
        "zone":           "southern_hemisphere",
        # Production weights (arabica share only; Espírito Santo's conilon excluded).
        "prod_weights": {
            "Sul de Minas":   900,
            "Cerrado":        600,
            "Espírito Santo": 210,
            "Paraná":         100,
        },
    },
    "vietnam_robusta": {
        "label":          "Vietnam robusta",
        "history_file":   "vn.json",
        "prod_seed_file": "vietnam_robusta_production.json",
        "vhi_file":       "vhi_vn.json",
        "out_file":       "weather_analogs_vietnam.json",
        "zone":           "northern_hemisphere",
        # USDA AEKI 2024 regional weights (Vietnam is ~95% robusta so use
        # total prod for all 5 regions in the Central Highlands).
        "prod_weights": {
            "Dak Lak":  480,
            "Lam Dong": 580,
            "Dak Nong": 500,
            "Gia Lai":  320,
            "Kon Tum":  120,
        },
    },
    "indonesia_robusta": {
        "label":          "Indonesia robusta",
        "history_file":   "indonesia.json",
        "prod_seed_file": "indonesia_robusta_production.json",
        "vhi_file":       "vhi_indonesia.json",
        "out_file":       "weather_analogs_indonesia.json",
        # Equatorial origin: Lampung+Java sit 5-7°S, so we use the southern
        # hemisphere template. If we later add an arabica-side engine for
        # Gayo (4°N), it'd reference "northern_hemisphere" instead.
        "zone":           "southern_hemisphere",
        # Robusta share only — Lampung dominant; Java carries a smaller
        # robusta load. Gayo/Toraja/Flores are arabica → excluded here so
        # the signature tracks robusta-producing weather only.
        "prod_weights": {
            "Lampung": 350,
            "Java":    80,
        },
    },
}

N_ANALOGS = 5
N_BOOTSTRAP = 1000
BACKTEST_START = 2005


def _dim(year: int, month: int) -> int:
    if month == 2:
        return 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28
    if month in (1, 3, 5, 7, 8, 10, 12):
        return 31
    return 30


def _stage_window(stage_months: list[int], crop_year: int, anchor: str) -> list[tuple[int, int]]:
    """For a crop-year, return [(calendar_year, month), ...] for the stage's
    calendar months.
      anchor "wrap_august": months ≥ 8 belong to crop_year-1 (southern_hemisphere).
      anchor "no_wrap":     all months belong to crop_year (northern_hemisphere).
    The older "southern_hemisphere" / "calendar_year" aliases are kept for
    backward-compat with any callers that hand-built the anchor string."""
    out = []
    for m in stage_months:
        if anchor in ("wrap_august", "southern_hemisphere"):
            cy = crop_year - 1 if m >= 8 else crop_year
        elif anchor == "calendar_year":   # legacy: Dec → Y-1, rest → Y
            cy = crop_year - 1 if m == 12 else crop_year
        else:                              # "no_wrap" or anything else
            cy = crop_year
        out.append((cy, m))
    return out


def _aggregate_stage(reg_hist: dict, crop_year: int, stage_months: list[int],
                     anchor: str) -> tuple[float | None, float | None, float | None]:
    """Returns (rain_total_mm, mean_temp_C, et0_total_mm) for one province
    in one stage. Rejects when rain coverage < 80% of expected days."""
    total_rain = 0.0
    temp_sum = 0.0
    et0_total = 0.0
    n_rain = n_temp = n_et0 = 0
    expected_days = 0
    for cal_year, month in _stage_window(stage_months, crop_year, anchor):
        dim = _dim(cal_year, month)
        expected_days += dim
        for d in range(1, dim + 1):
            v = reg_hist.get(f"{cal_year}-{month:02d}-{d:02d}")
            if not v:
                continue
            if v.get("rain") is not None:
                total_rain += v["rain"]; n_rain += 1
            if v.get("tmean") is not None:
                temp_sum += v["tmean"]; n_temp += 1
            if v.get("et0") is not None:
                et0_total += v["et0"]; n_et0 += 1
    coverage = n_rain / expected_days if expected_days else 0
    if coverage < 0.80:
        return None, None, None
    return (
        round(total_rain, 1),
        round(temp_sum / n_temp, 2) if n_temp else None,
        round(et0_total, 1) if n_et0 / expected_days >= 0.80 else None,
    )


def _oni_for_stage(stage_months: list[int], crop_year: int, anchor: str) -> float | None:
    vals = []
    for cal_year, month in _stage_window(stage_months, crop_year, anchor):
        v = ONI_BY_YM.get((cal_year, month))
        if v is None:
            return None
        vals.append(v)
    return round(sum(vals) / len(vals), 3) if vals else None


def build_country_signature(history: dict, crop_year: int,
                            phenology, anchor: str,
                            prod_weights: dict[str, int],
                            vhi_by_week: dict[tuple[int, int], float] | None = None,
                            ) -> list[dict]:
    """Per-stage prod-weighted (rain, temp, et0, ONI, VHI) for the country.
    vhi_by_week (when provided) is {(year, iso_week): prod-weighted VHI};
    we average across all weeks falling within the stage's calendar window."""
    out = []
    for stage_name, months in phenology:
        rain_sum = temp_sum = et0_sum = 0.0
        rain_w = temp_w = et0_w = 0
        for prov_name, weight in prod_weights.items():
            reg_hist = history["regions"].get(prov_name, {})
            r, t, e = _aggregate_stage(reg_hist, crop_year, months, anchor)
            if r is not None:
                rain_sum += r * weight; rain_w += weight
            if t is not None:
                temp_sum += t * weight; temp_w += weight
            if e is not None:
                et0_sum += e * weight; et0_w += weight

        vhi_avg: float | None = None
        if vhi_by_week:
            stage_vhis = [v for (y, w), v in vhi_by_week.items()
                          if _iso_week_in_stage(y, w, months, anchor, crop_year)]
            if stage_vhis:
                vhi_avg = round(sum(stage_vhis) / len(stage_vhis), 2)

        out.append({
            "name": stage_name,
            "rain_mm": round(rain_sum / rain_w, 1) if rain_w else None,
            "temp_c":  round(temp_sum / temp_w, 2) if temp_w else None,
            "et0_mm":  round(et0_sum / et0_w, 1) if et0_w else None,
            "oni_avg": _oni_for_stage(months, crop_year, anchor),
            "vhi":     vhi_avg,
        })
    return out


# ── Feature engineering: enrich raw signature with anomalies, SPI, SPEI ──

def enrich_signature(sig: list[dict], stage_norms: dict[str, dict]) -> list[dict]:
    """Add rain_anom_pct, spi_z, spei_z, temp_anom_c, vhi_z to each stage entry."""
    enriched = []
    for s in sig:
        sn = stage_norms.get(s["name"], {})
        rain = s.get("rain_mm")
        temp = s.get("temp_c")
        et0  = s.get("et0_mm")
        vhi  = s.get("vhi")
        rain_anom = (
            ((rain - sn["rain_mean"]) / sn["rain_mean"] * 100)
            if rain is not None and sn.get("rain_mean") else None
        )
        spi_z = (
            ((rain - sn["rain_mean"]) / sn["rain_std"])
            if rain is not None and sn.get("rain_std") else None
        )
        wb = (rain - et0) if rain is not None and et0 is not None else None
        spei_z = (
            ((wb - sn["wb_mean"]) / sn["wb_std"])
            if wb is not None and sn.get("wb_std") else None
        )
        temp_anom = (
            (temp - sn["temp_mean"])
            if temp is not None and sn.get("temp_mean") is not None else None
        )
        vhi_z = (
            ((vhi - sn["vhi_mean"]) / sn["vhi_std"])
            if vhi is not None and sn.get("vhi_std") else None
        )
        enriched.append({
            **s,
            "rain_anom_pct": round(rain_anom, 1) if rain_anom is not None else None,
            "temp_anom_c":   round(temp_anom, 2) if temp_anom is not None else None,
            "spi_z":         round(spi_z,  3) if spi_z  is not None else None,
            "spei_z":        round(spei_z, 3) if spei_z is not None else None,
            "vhi_z":         round(vhi_z,  3) if vhi_z  is not None else None,
        })
    return enriched


def signature_to_vector(sig: list[dict]) -> list[float | None]:
    """Flatten enriched signature → 28-dim feature vector for distance metric.
    Order per stage: rain_mm, temp_c, rain_anom_pct, spi_z, spei_z, oni_avg, vhi_z."""
    vec: list[float | None] = []
    for s in sig:
        vec.extend([
            s.get("rain_mm"),
            s.get("temp_c"),
            s.get("rain_anom_pct"),
            s.get("spi_z"),
            s.get("spei_z"),
            s.get("oni_avg"),
            s.get("vhi_z"),
        ])
    return vec


def _stage_population_stats(all_signatures: dict[int, list[dict]],
                            range_years: list[int]) -> dict[str, dict]:
    """Mean + std of stage rain, temp, water-balance, and VHI across the
    10Y rolling normal window. Drives the anomaly + SPI + SPEI + VHI-z features."""
    norms: dict[str, dict] = {}
    stage_names = [s["name"] for s in next(iter(all_signatures.values()))]
    for stage_name in stage_names:
        rains, temps, wbs, vhis = [], [], [], []
        for y in range_years:
            sig = all_signatures.get(y)
            if not sig:
                continue
            s = next((x for x in sig if x["name"] == stage_name), None)
            if not s:
                continue
            if s.get("rain_mm") is not None:
                rains.append(s["rain_mm"])
            if s.get("temp_c") is not None:
                temps.append(s["temp_c"])
            if s.get("rain_mm") is not None and s.get("et0_mm") is not None:
                wbs.append(s["rain_mm"] - s["et0_mm"])
            if s.get("vhi") is not None:
                vhis.append(s["vhi"])
        norms[stage_name] = {
            "rain_mean": round(statistics.fmean(rains), 1) if rains else None,
            "rain_std":  round(statistics.pstdev(rains), 1) if len(rains) > 1 else None,
            "temp_mean": round(statistics.fmean(temps), 2) if temps else None,
            "temp_std":  round(statistics.pstdev(temps), 2) if len(temps) > 1 else None,
            "wb_mean":   round(statistics.fmean(wbs), 1) if wbs else None,
            "wb_std":    round(statistics.pstdev(wbs), 1) if len(wbs) > 1 else None,
            "vhi_mean":  round(statistics.fmean(vhis), 2) if vhis else None,
            "vhi_std":   round(statistics.pstdev(vhis), 2) if len(vhis) > 1 else None,
        }
    return norms


# ── Detrending ───────────────────────────────────────────────────────────────

def _detrend_log_production(prod: dict[int, int]) -> dict[int, float]:
    years = sorted(prod)
    if len(years) < 5:
        return {y: 0.0 for y in years}
    xs = np.array(years, dtype=float)
    ys = np.log(np.array([prod[y] for y in years], dtype=float))
    b, a = np.polyfit(xs, ys, 1)
    fitted = a + b * xs
    return {int(y): float(yy - ff) for y, yy, ff in zip(years, ys, fitted)}


def _detrended_yoy_pct(year: int, detrended: dict[int, float]) -> float | None:
    if year not in detrended or (year - 1) not in detrended:
        return None
    return round((detrended[year] - detrended[year - 1]) * 100, 1)


# ── Mahalanobis distance ─────────────────────────────────────────────────────

def _mahalanobis_setup(historical_vectors: list[list[float]]) -> np.ndarray:
    X = np.array(historical_vectors, dtype=float)
    cov = np.cov(X.T)
    cov = cov + np.eye(cov.shape[0]) * np.diag(cov).mean() * 1e-4
    try:
        return np.linalg.inv(cov)
    except np.linalg.LinAlgError:
        return np.eye(cov.shape[0])


def _mahalanobis_dist(x: list[float], y: list[float], inv_cov: np.ndarray) -> float:
    delta = np.array(x, dtype=float) - np.array(y, dtype=float)
    sq = float(delta @ inv_cov @ delta)
    return math.sqrt(max(sq, 0.0))


def _bootstrap_ci(values: list[float], n_resamples: int = N_BOOTSTRAP,
                   ) -> tuple[float, float] | None:
    if not values:
        return None
    rng = np.random.default_rng(seed=42)
    arr = np.array(values, dtype=float)
    samples = rng.choice(arr, size=(n_resamples, len(arr)), replace=True)
    means = samples.mean(axis=1)
    return round(float(np.percentile(means, 2.5)), 1), round(float(np.percentile(means, 97.5)), 1)


def _ensemble_stats(values: list[float | None]) -> dict | None:
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    ci = _bootstrap_ci(clean)
    return {
        "mean_pct":   round(statistics.fmean(clean), 1),
        "median_pct": round(statistics.median(clean), 1),
        "stdev_pct":  round(statistics.pstdev(clean), 1) if len(clean) > 1 else 0.0,
        "n":          len(clean),
        "min_pct":    round(min(clean), 1),
        "max_pct":    round(max(clean), 1),
        "ci95_lo":    ci[0] if ci else None,
        "ci95_hi":    ci[1] if ci else None,
    }


# ── Walk-forward backtest ────────────────────────────────────────────────────

def _backtest(all_signatures: dict[int, list[dict]],
              detrended: dict[int, float],
              candidate_years: list[int],
              kept_dims: list[int] | None = None) -> dict | None:
    """For each year Y in [BACKTEST_START, cur-1] with complete signature
    AND production data, refit using only years < Y, predict, compare.
    kept_dims, when provided, projects the signature vector to only those
    indices — keeps the backtest consistent with the main-pass dim filter
    (e.g. dropping VHI before its backfill has populated it)."""
    def _project(vec: list[float | None]) -> list[float | None]:
        return [vec[i] for i in kept_dims] if kept_dims is not None else vec

    eligible = sorted(y for y in candidate_years if y >= BACKTEST_START
                      and y in detrended and (y - 1) in detrended)
    if len(eligible) < 5:
        return None
    rows = []
    for target in eligible:
        train_years = sorted(y for y in candidate_years
                              if y < target
                              and all(v is not None for v in _project(signature_to_vector(all_signatures[y]))))
        if len(train_years) < 8:
            continue
        train_vecs = [_project(signature_to_vector(all_signatures[y])) for y in train_years]
        inv_cov = _mahalanobis_setup(train_vecs)  # type: ignore[arg-type]
        target_vec = _project(signature_to_vector(all_signatures[target]))
        if any(v is None for v in target_vec):
            continue
        distances = sorted(
            ((y, _mahalanobis_dist(target_vec, v, inv_cov)) for y, v in zip(train_years, train_vecs)),  # type: ignore[arg-type]
            key=lambda x: x[1],
        )
        analog_yoys = [
            _detrended_yoy_pct(ay, detrended)
            for ay, _ in distances[:N_ANALOGS]
        ]
        analog_yoys = [y for y in analog_yoys if y is not None]
        if not analog_yoys:
            continue
        pred = statistics.fmean(analog_yoys)
        actual = _detrended_yoy_pct(target, detrended)
        if actual is None:
            continue
        rows.append((target, pred, actual))
    if not rows:
        return None

    preds   = np.array([r[1] for r in rows])
    actuals = np.array([r[2] for r in rows])
    rmse_model = float(np.sqrt(np.mean((preds - actuals) ** 2)))
    rmse_zero  = float(np.sqrt(np.mean(actuals ** 2)))

    persist_preds, persist_actuals = [], []
    for target, _, actual in rows:
        prev = _detrended_yoy_pct(target - 1, detrended)
        if prev is not None:
            persist_preds.append(prev)
            persist_actuals.append(actual)
    rmse_persist = (
        float(np.sqrt(np.mean((np.array(persist_preds) - np.array(persist_actuals)) ** 2)))
        if persist_preds else None
    )

    hit_model = float(np.mean(np.sign(preds) == np.sign(actuals)))
    hit_persist = (
        float(np.mean(np.sign(np.array(persist_preds)) == np.sign(np.array(persist_actuals))))
        if persist_preds else None
    )

    return {
        "n_years": len(rows),
        "first_year": int(rows[0][0]),
        "last_year": int(rows[-1][0]),
        "rmse_model":   round(rmse_model, 2),
        "rmse_naive_zero":    round(rmse_zero, 2),
        "rmse_naive_persist": round(rmse_persist, 2) if rmse_persist else None,
        "hit_rate_model":    round(hit_model, 3),
        "hit_rate_persist":  round(hit_persist, 3) if hit_persist else None,
        "skill_vs_zero_pct": round((1 - rmse_model / rmse_zero) * 100, 1) if rmse_zero else None,
        "skill_vs_persist_pct": (
            round((1 - rmse_model / rmse_persist) * 100, 1)
            if rmse_persist else None
        ),
        "per_year_predictions": [
            {"year": int(y), "pred_pct": round(p, 1), "actual_pct": round(a, 1)}
            for y, p, a in rows
        ],
    }


# ── Per-origin runner ────────────────────────────────────────────────────────

def run_for_origin(origin_key: str, cfg: dict) -> int:
    """Execute the analog engine for one origin config."""
    history_path = HISTORY_DIR / cfg["history_file"]
    if not history_path.exists():
        print(f"[{origin_key}] no history file at {history_path} — skipping", file=sys.stderr)
        return 0

    history = json.loads(history_path.read_text(encoding="utf-8"))
    prod_doc = json.loads((SEED_DIR / cfg["prod_seed_file"]).read_text(encoding="utf-8"))
    prod = {int(k): int(v) for k, v in prod_doc["production_kbags"].items()}

    # VHI weekly history — empty dict when the long-form backfill hasn't
    # run yet. The engine then quietly omits the VHI feature.
    vhi_by_week = _load_vhi_history(cfg.get("vhi_file", ""), cfg["prod_weights"])
    if vhi_by_week:
        years = sorted({y for y, _ in vhi_by_week})
        print(f"[{origin_key}] VHI history: {len(vhi_by_week)} weeks, "
              f"{years[0]}-{years[-1]}")

    # Resolve phenology + stage anchor from the origin's climate-zone template.
    # Zone-driven: brazil → southern_temperate, vietnam → northern_monsoon_asia,
    # indonesia → equatorial. Stage definitions live in PHENOLOGY_ZONES above so
    # adding Honduras / Colombia / Uganda is one zone-key reference + a new
    # template entry.
    zone_key = cfg.get("zone")
    if zone_key not in PHENOLOGY_ZONES:
        print(f"[{origin_key}] unknown zone {zone_key!r} — skipping", file=sys.stderr)
        return 1
    zone = PHENOLOGY_ZONES[zone_key]
    phenology = zone["stages"]
    stage_anchor = zone["anchor"]

    today = dt.date.today()
    # Crop-year semantics per hemisphere:
    #   southern (Brazil): growing cycle Aug Y-1 → May Y, harvest in Y.
    #     When today.month ≥ flip_month (Aug), we've already started growing
    #     for NEXT year's harvest → cur = today.year + 1.
    #   northern (Vietnam): growing cycle Feb Y → Nov Y, harvest spans Nov Y
    #     → Feb Y+1. When today.month ≥ flip_month (Feb), we're growing
    #     for THIS year's harvest → cur = today.year. Before Feb (Jan only)
    #     we're still in the previous cycle's harvest tail → cur = today.year - 1.
    flip_month       = zone["flip_month"]
    post_flip_offset = zone["post_flip_offset"]
    if today.month >= flip_month:
        cur_crop_year = today.year + post_flip_offset
    else:
        cur_crop_year = today.year + post_flip_offset - 1

    all_years = sorted({y for prov in history["regions"].values()
                          for y in {int(k[:4]) for k in prov}})
    candidate_years = [y for y in all_years if 1996 <= y <= cur_crop_year]
    if cur_crop_year not in candidate_years:
        candidate_years.append(cur_crop_year)

    raw_signatures = {
        y: build_country_signature(history, y, phenology, stage_anchor,
                                    cfg["prod_weights"], vhi_by_week or None)
        for y in candidate_years
    }

    # 10Y rolling window for the population stats.
    norm_window = [y for y in candidate_years if cur_crop_year - 10 <= y < cur_crop_year]
    stage_norms = _stage_population_stats(raw_signatures, norm_window)

    all_signatures = {
        y: enrich_signature(sig, stage_norms) for y, sig in raw_signatures.items()
    }

    detrended = _detrend_log_production(prod)

    # First pass: detect which feature dimensions have enough population
    # support for Mahalanobis. Dims with < 10 populated years (e.g. VHI
    # before the long-form backfill workflow has run) get dropped entirely
    # — otherwise every historical year would fail the "all dims non-None"
    # gate. Once a backfill ships those years, the dim re-enters the engine.
    full_vecs = {y: signature_to_vector(all_signatures[y])
                 for y in candidate_years if y < cur_crop_year}
    n_dims_total = len(next(iter(full_vecs.values())))
    populated_per_dim = [
        sum(1 for vec in full_vecs.values() if vec[i] is not None)
        for i in range(n_dims_total)
    ]
    kept_dims = [i for i, n in enumerate(populated_per_dim) if n >= 10]
    dropped_dims = [i for i, n in enumerate(populated_per_dim) if n < 10]
    if dropped_dims:
        print(f"[{origin_key}] dropping {len(dropped_dims)} feature dim(s) with "
              f"< 10 populated years (likely VHI pre-backfill).")

    def _project(vec: list[float | None]) -> list[float | None]:
        return [vec[i] for i in kept_dims]

    historical_years = [
        y for y in candidate_years if y < cur_crop_year
        and all(v is not None for v in _project(signature_to_vector(all_signatures[y])))
    ]
    if len(historical_years) < 5:
        print(f"[{origin_key}] insufficient historical signatures ({len(historical_years)})", file=sys.stderr)
        return 1

    historical_vecs = [_project(signature_to_vector(all_signatures[y])) for y in historical_years]
    inv_cov_full = _mahalanobis_setup(historical_vecs)  # type: ignore[arg-type]

    cur_vec = _project(signature_to_vector(all_signatures[cur_crop_year]))
    present_idx = [i for i, v in enumerate(cur_vec) if v is not None]
    if not present_idx:
        # Right after the crop-cycle flip (Aug 1 southern / Feb 1 northern)
        # the new cycle has zero accumulated stage features — an EXPECTED
        # annual condition, not a failure. Treating it as an error made the
        # whole workflow fail (with pointless 5-min retries + a Telegram
        # alert) every day from Aug 1 until the first stage populated. Skip
        # gracefully inside the grace window (first stage spans two months;
        # 92 d ≈ the fetcher's own history window) and keep last cycle's
        # analog file on disk; past the window an empty vector means the
        # pipeline genuinely stopped accumulating — fail loudly then.
        days_in = _days_into_cycle(today, flip_month)
        if days_in <= ROLLOVER_GRACE_DAYS:
            print(f"[{origin_key}] cycle {cur_crop_year} rolled {days_in}d ago — no "
                  f"current-cycle features yet (expected); keeping previous analog file.",
                  file=sys.stderr)
            return 0
        print(f"[{origin_key}] current year has no features yet "
              f"({days_in}d into the cycle — past the {ROLLOVER_GRACE_DAYS}d grace)",
              file=sys.stderr)
        return 1
    cov_full = np.linalg.inv(inv_cov_full)
    cov_present_inv = np.linalg.inv(cov_full[np.ix_(present_idx, present_idx)])
    cur_present = [cur_vec[i] for i in present_idx]

    distances = []
    for y, vec in zip(historical_years, historical_vecs):
        sub = [vec[i] for i in present_idx]
        d = _mahalanobis_dist(cur_present, sub, cov_present_inv)
        distances.append((y, d, len(present_idx)))
    distances.sort(key=lambda x: x[1])

    top_analogs = []
    for analog_year, dist, used in distances[:N_ANALOGS]:
        same_yoy_raw = (
            round((prod[analog_year] - prod[analog_year - 1]) / prod[analog_year - 1] * 100, 1)
            if analog_year in prod and analog_year - 1 in prod else None
        )
        next_yoy_raw = (
            round((prod[analog_year + 1] - prod[analog_year]) / prod[analog_year] * 100, 1)
            if analog_year + 1 in prod and analog_year in prod else None
        )
        top_analogs.append({
            "year": analog_year,
            "distance": round(dist, 3),
            "features_compared": used,
            "same_cycle_crop_year": analog_year,
            "same_cycle_production_kbags": prod.get(analog_year),
            "same_cycle_yoy_pct": same_yoy_raw,
            "same_cycle_yoy_detrended_pct": _detrended_yoy_pct(analog_year, detrended),
            "next_crop_year": analog_year + 1,
            "next_crop_production_kbags": prod.get(analog_year + 1),
            "next_crop_yoy_pct": next_yoy_raw,
            "next_crop_yoy_detrended_pct": _detrended_yoy_pct(analog_year + 1, detrended),
            "stages": all_signatures[analog_year],
        })

    ensemble_same = _ensemble_stats([a["same_cycle_yoy_detrended_pct"] for a in top_analogs])
    ensemble_next = _ensemble_stats([a["next_crop_yoy_detrended_pct"] for a in top_analogs])

    backtest = _backtest(all_signatures, detrended, historical_years, kept_dims=kept_dims)

    out_doc = {
        "_schema": "v3",
        "_note": (f"{cfg['label']} weather-analog forecast. Mahalanobis on 24-dim "
                  "(rain, temp, rain_anom, SPI z, SPEI z, ONI) × 4 phenology stages. "
                  "Detrended production residuals. Walk-forward backtest. "
                  "Bootstrap 95% CI on ensemble."),
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "origin": origin_key,
        "origin_label": cfg["label"],
        "current_crop_year": cur_crop_year,
        "zone": zone_key,
        "harvest_period": zone["harvest_period"],
        "phenology": [{"name": n, "months": m} for (n, m) in phenology],
        "stage_normals_10y": stage_norms,
        "current_year_signature": all_signatures[cur_crop_year],
        "top_analogs": top_analogs,
        "ensemble_same_cycle":  ensemble_same,
        "ensemble_lag_one":     ensemble_next,
        "backtest": backtest,
        "historical_signatures": [
            {
                "year": y,
                "stages": all_signatures[y],
                "production_kbags": prod.get(y),
                "detrended_residual": round(detrended.get(y, 0.0), 4),
            }
            for y in historical_years
        ],
        "production_seed_note": prod_doc.get("_replace_when"),
    }
    out_path = OUT_DIR / cfg["out_file"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[{origin_key}] wrote {out_path}")
    print(f"  top {len(top_analogs)} analogs:")
    for a in top_analogs:
        det = f" detrended y/y: same={a['same_cycle_yoy_detrended_pct']:+.1f}%" if a['same_cycle_yoy_detrended_pct'] is not None else ""
        print(f"    {a['year']}: d={a['distance']:.3f}{det}")
    if ensemble_same:
        ci = f" CI95 [{ensemble_same.get('ci95_lo'):+.1f}, {ensemble_same.get('ci95_hi'):+.1f}]" if ensemble_same.get("ci95_lo") is not None else ""
        print(f"  ensemble same-cycle: {ensemble_same['mean_pct']:+.1f}%{ci}")
    if backtest:
        print(f"  backtest ({backtest['n_years']} years): RMSE model={backtest['rmse_model']}, "
              f"vs zero={backtest['rmse_naive_zero']}, vs persist={backtest['rmse_naive_persist']}; "
              f"hit rate={backtest['hit_rate_model']:.2f}")
    return 0


def main() -> int:
    rc = 0
    for origin_key, cfg in ORIGIN_CONFIGS.items():
        rc |= run_for_origin(origin_key, cfg)
    return rc


if __name__ == "__main__":
    sys.exit(main())
