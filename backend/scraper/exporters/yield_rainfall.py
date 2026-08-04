"""
yield_rainfall.py
Theoretical rain→yield response curves, overlaid with reality.

For each origin-variety it publishes THREE layers the research chart stacks:

  theoretical_curve   literature-calibrated yield-potential curve over the
                      crop-year rainfall total (WCR/WMO bioclimatic envelopes;
                      Embrapa arabica zoning 1,200–1,800 mm optimal; Carr 2001 /
                      DaMatta & Ramalho water-relations reviews; robusta's
                      higher demand per Cenicafé/WCR). Interpolation between
                      anchors — a shape, not a regression.
  historical_scatter  real crop years: production-weighted crop-year rainfall
                      (30-yr Open-Meteo seeds, 1995-2024) × realized yield as
                      % of the log-linear production trend (USDA-derived
                      production seeds, 1996-2025). The scatter is the test of
                      the theory — corr(theory(rain), realized) ships with it.
  current_year_live   the running crop-year: rain-to-date from the live weather
                      feed + a projection to window end using seed climatology.

Crop-year windows (12 months, ending in the harvest year the production seed
keys on): Brazil arabica Oct→Sep · Vietnam robusta Nov→Oct · Indonesia
robusta Jul→Jun. Colombia is omitted until a long production seed exists.

DERIVED exporter — reads committed seeds + published weather JSONs, no network.
"""
import json
import math
from datetime import datetime, timezone

from scraper.exporters.base import OUT_DIR, ROOT
from scraper.validate_export import safe_write_json, validate_yield_rainfall

OUT_PATH = OUT_DIR / "yield_rainfall_model.json"
SEED_DIR = ROOT / "backend" / "seed"

# Literature anchors: crop-year rainfall (mm) → yield potential (% of max).
MODELS = [
    {
        "key": "arabica_brazil", "label": "Brazil Arabica", "origin": "brazil",
        "crop_types": {"arabica"}, "production_seed": "brazil_arabica_production.json",
        # seed keys are the marketing-year END (2022 = the frost-collapsed Jul-2021
        # harvest; 2021 = the 48.7M record of 2020) — verified against USDA events.
        "prod_year_offset": 1,
        "biennial": True,                  # arabica biennial bearing dominates raw deviations
        "window_start_month": 10,          # Oct (Y−1) → Sep (Y)
        "window_label": "Oct → Sep",
        "optimal_band": [1200, 1800],
        "theoretical_curve": [
            {"rain_mm": 500,  "yield_potential_pct": 5,   "stress": "Extreme drought — survival limit"},
            {"rain_mm": 800,  "yield_potential_pct": 25,  "stress": "Severe deficit"},
            {"rain_mm": 1000, "yield_potential_pct": 60,  "stress": "Moderate deficit"},
            {"rain_mm": 1200, "yield_potential_pct": 90,  "stress": "Light deficit"},
            {"rain_mm": 1400, "yield_potential_pct": 100, "stress": "Optimal"},
            {"rain_mm": 1800, "yield_potential_pct": 100, "stress": "Optimal"},
            {"rain_mm": 2200, "yield_potential_pct": 75,  "stress": "Excess — leaf disease pressure"},
            {"rain_mm": 2600, "yield_potential_pct": 50,  "stress": "Excess — flowering disruption"},
            {"rain_mm": 3000, "yield_potential_pct": 30,  "stress": "Waterlogging / severe disease"},
        ],
    },
    {
        "key": "robusta_vietnam", "label": "Vietnam Robusta", "origin": "vn",
        "crop_types": None, "production_seed": "vietnam_robusta_production.json",
        "window_start_month": 11,          # Nov (Y−1) → Oct (Y); harvest peaks Nov Y
        "window_label": "Nov → Oct",
        "optimal_band": [1600, 2200],
        "theoretical_curve": [
            {"rain_mm": 800,  "yield_potential_pct": 10,  "stress": "Extreme drought"},
            {"rain_mm": 1200, "yield_potential_pct": 45,  "stress": "Severe deficit (irrigation-dependent)"},
            {"rain_mm": 1400, "yield_potential_pct": 70,  "stress": "Moderate deficit"},
            {"rain_mm": 1600, "yield_potential_pct": 90,  "stress": "Light deficit"},
            {"rain_mm": 1800, "yield_potential_pct": 100, "stress": "Optimal"},
            {"rain_mm": 2200, "yield_potential_pct": 100, "stress": "Optimal"},
            {"rain_mm": 2600, "yield_potential_pct": 80,  "stress": "Excess — cherry drop"},
            {"rain_mm": 3000, "yield_potential_pct": 55,  "stress": "Excess — harvest & drying losses"},
        ],
    },
    {
        "key": "robusta_indonesia", "label": "Indonesia Robusta", "origin": "indonesia",
        "crop_types": {"robusta"}, "production_seed": "indonesia_robusta_production.json",
        "window_start_month": 7,           # Jul (Y−1) → Jun (Y); harvest peaks May-Aug Y
        "window_label": "Jul → Jun",
        "optimal_band": [2000, 2800],
        "theoretical_curve": [
            {"rain_mm": 1200, "yield_potential_pct": 30,  "stress": "Severe deficit"},
            {"rain_mm": 1600, "yield_potential_pct": 60,  "stress": "Moderate deficit"},
            {"rain_mm": 2000, "yield_potential_pct": 90,  "stress": "Light deficit"},
            {"rain_mm": 2400, "yield_potential_pct": 100, "stress": "Optimal"},
            {"rain_mm": 2800, "yield_potential_pct": 95,  "stress": "Upper optimal"},
            {"rain_mm": 3200, "yield_potential_pct": 70,  "stress": "Excess — flowering disruption"},
            {"rain_mm": 3600, "yield_potential_pct": 45,  "stress": "Excess — harvest-season rain"},
        ],
    },
]


def _load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _region_weights(weather: dict, crop_types: set | None) -> dict[str, float]:
    """{region: normalized production weight}, optionally filtered by crop type."""
    w = {}
    for p in weather.get("provinces") or []:
        name = p.get("name")
        if not name:
            continue
        if crop_types and (p.get("crop_type") or "").lower() not in crop_types:
            continue
        w[name] = float(p.get("weight") or 1.0)
    tot = sum(w.values())
    return {k: v / tot for k, v in w.items()} if tot else {}


def _weighted_monthly(seed_regions: dict, weights: dict[str, float]) -> dict[str, float]:
    """Region-weighted monthly rain {'YYYY-MM': mm} from the SPI seed."""
    out: dict[str, float] = {}
    for region, share in weights.items():
        months = seed_regions.get(region) or {}
        for ym, mm in months.items():
            if mm is not None:
                out[ym] = out.get(ym, 0.0) + mm * share
    return {k: round(v, 1) for k, v in out.items()}


def _window_total(monthly: dict[str, float], harvest_year: int, start_month: int):
    """12-month total from start_month of (harvest_year−1 if start>1 else Y)."""
    y, m = (harvest_year - 1, start_month) if start_month > 1 else (harvest_year, 1)
    vals = []
    for _ in range(12):
        vals.append(monthly.get(f"{y:04d}-{m:02d}"))
        m += 1
        if m > 12:
            m, y = 1, y + 1
    if any(v is None for v in vals):
        return None
    return round(sum(vals), 0)


def _log_trend_pct(prod: dict[int, float]) -> dict[int, float]:
    """Realized production as % of the log-linear trend fitted over all years."""
    years = sorted(prod)
    xs = [float(y) for y in years]
    ys = [math.log(prod[y]) for y in years]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0
    a = my - b * mx
    return {y: round(prod[y] / math.exp(a + b * y) * 100, 1) for y in years}


def _interp(curve: list[dict], rain: float):
    """Yield potential at `rain` by linear interpolation over the anchors."""
    pts = sorted((c["rain_mm"], c["yield_potential_pct"]) for c in curve)
    if rain <= pts[0][0]:
        return float(pts[0][1])
    if rain >= pts[-1][0]:
        return float(pts[-1][1])
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= rain <= x1:
            return y0 + (y1 - y0) * (rain - x0) / (x1 - x0)
    return None


def _pearson(xs, ys):
    n = len(xs)
    if n < 5:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sxx * syy) ** 0.5, 2)


def _parity_demean(scatter: list[dict]) -> list[float]:
    """Realized% with the on/off-year (odd/even harvest) means removed, re-centred
    on 100 — isolates the rain signal from arabica's biennial cycle."""
    even = [r["realized_pct"] for r in scatter if r["year"] % 2 == 0]
    odd = [r["realized_pct"] for r in scatter if r["year"] % 2 == 1]
    me = sum(even) / len(even) if even else 100.0
    mo = sum(odd) / len(odd) if odd else 100.0
    return [r["realized_pct"] - (me if r["year"] % 2 == 0 else mo) + 100.0 for r in scatter]


def _monthly_climatology(monthly: dict[str, float]) -> dict[int, float]:
    by_m: dict[int, list[float]] = {}
    for ym, v in monthly.items():
        by_m.setdefault(int(ym[5:7]), []).append(v)
    return {m: sum(v) / len(v) for m, v in by_m.items()}


def _live_monthly(weather: dict, weights: dict[str, float]) -> dict[str, float]:
    """Weighted monthly rain from the live feed (monthly_totals_history 2015+
    plus the current year's monthly actuals)."""
    out: dict[str, float] = {}
    for p in weather.get("provinces") or []:
        name = p.get("name")
        share = weights.get(name)
        if not share:
            continue
        for yr, arr in (p.get("monthly_totals_history") or {}).items():
            for i, v in enumerate(arr or []):
                if v is not None:
                    k = f"{yr}-{i + 1:02d}"
                    out[k] = out.get(k, 0.0) + v * share
        cur = p.get("monthly_actual_cur") or []
        cur_year = datetime.now(timezone.utc).year
        for i, v in enumerate(cur):
            if v is not None:
                k = f"{cur_year:04d}-{i + 1:02d}"
                out[k] = out.get(k, 0.0) + v * share
    return {k: round(v, 1) for k, v in out.items()}


def export_yield_rainfall() -> None:
    spi_seed = (_load(SEED_DIR / "spi_30yr_baselines.json") or {}).get("origins") or {}
    today = datetime.now(timezone.utc).date()

    models_out = {}
    for cfg in MODELS:
        weather = _load(OUT_DIR / f"{cfg['origin']}_weather.json") or {}
        prod_doc = _load(SEED_DIR / cfg["production_seed"]) or {}
        prod = {int(y): float(v) for y, v in (prod_doc.get("production_kbags") or {}).items()}
        seed_regions = spi_seed.get(cfg["origin"]) or {}
        weights = _region_weights(weather, cfg["crop_types"])
        if not (prod and seed_regions and weights):
            print(f"  yield_rainfall → {cfg['key']}: missing inputs, skipped")
            continue

        monthly = _weighted_monthly(seed_regions, weights)
        realized = _log_trend_pct(prod)
        offset = int(cfg.get("prod_year_offset", 0))

        scatter, xs, ys = [], [], []
        for seed_year in sorted(prod):
            harvest = seed_year - offset          # rain window ends in the harvest year
            rain = _window_total(monthly, harvest, cfg["window_start_month"])
            if rain is None or seed_year not in realized:
                continue
            scatter.append({"year": harvest, "rain_mm": rain, "realized_pct": realized[seed_year]})
            xs.append(_interp(cfg["theoretical_curve"], rain))
            ys.append(realized[seed_year])

        # auto-label the extremes so the chart can annotate without hardcoding
        if scatter:
            lo = min(scatter, key=lambda r: r["realized_pct"])
            hi = max(scatter, key=lambda r: r["realized_pct"])
            dry = min(scatter, key=lambda r: r["rain_mm"])
            wet = max(scatter, key=lambda r: r["rain_mm"])
            lo["label"] = "worst realized"
            hi["label"] = "best realized"
            dry.setdefault("label", "driest window")
            wet.setdefault("label", "wettest window")

        # current crop year: rain to date + climatology projection to window end
        live = _live_monthly(weather, weights)
        harvest_year = today.year if today.month >= cfg["window_start_month"] or cfg["window_start_month"] == 1 else today.year
        # the window ending in `harvest_year` runs (Y−1, start) → (Y, start−1);
        # if we're past its end the running window is next harvest year's
        end_y, end_m = (harvest_year, cfg["window_start_month"] - 1) if cfg["window_start_month"] > 1 else (harvest_year, 12)
        if (today.year, today.month) > (end_y, end_m):
            harvest_year += 1
        clim = _monthly_climatology(monthly)
        y, m = (harvest_year - 1, cfg["window_start_month"]) if cfg["window_start_month"] > 1 else (harvest_year, 1)
        to_date, projected, months_obs = 0.0, 0.0, 0
        for _ in range(12):
            v = live.get(f"{y:04d}-{m:02d}")
            if v is not None and (y, m) <= (today.year, today.month):
                to_date += v
                projected += v
                months_obs += 1
            else:
                projected += clim.get(m, 0.0)
            m += 1
            if m > 12:
                m, y = 1, y + 1

        band = cfg["optimal_band"]
        proj = round(projected, 0)
        models_out[cfg["key"]] = {
            "label": cfg["label"],
            "window": cfg["window_label"],
            "optimal_band": band,
            "theoretical_curve": cfg["theoretical_curve"],
            "historical_scatter": scatter,
            "theory_fit_corr": _pearson(xs, ys),
            # arabica's biennial bearing swamps single-year deviations: also fit
            # after demeaning realized% by on/off-year parity (Brazil only).
            "theory_fit_corr_biennial_adj": (
                _pearson(xs, _parity_demean(scatter)) if cfg.get("biennial") else None),
            "current_year_live": {
                "year": harvest_year,
                "rain_mm_to_date": round(to_date, 0),
                "months_observed": months_obs,
                "projected_end": proj,
                "projected_potential_pct": round(_interp(cfg["theoretical_curve"], proj) or 0, 0),
                "in_optimal_band": bool(band[0] <= proj <= band[1]),
            },
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "meta": {
            "x_axis": "crop-year rainfall total (mm), production-weighted across growing regions",
            "y_axis": "yield as % of normal — theory: potential vs max; scatter: production vs log-linear trend (=100)",
            "windows": {m["key"]: m["window_label"] for m in MODELS},
            "sources": "Curves: WCR/WMO bioclimatic envelopes; Embrapa arabica zoning (1,200–1,800 mm optimal); "
                       "Carr (2001), DaMatta & Ramalho (2006); Cenicafé/WCR robusta water demand. "
                       "Scatter: USDA-derived production seeds × Open-Meteo 30-yr regional rainfall.",
            "note": "Rainfall total is one axis of yield — distribution, temperature, biennial bearing and "
                    "management are absorbed by the trend/deviation framing, not modelled.",
        },
        "models": models_out,
    }
    safe_write_json(OUT_PATH, payload, validate_yield_rainfall)
    for k, v in models_out.items():
        cl = v["current_year_live"]
        print(f"  yield_rainfall: {k:18s} {len(v['historical_scatter'])} yrs · fit r={v['theory_fit_corr']} · "
              f"{cl['year']} proj {cl['projected_end']:.0f}mm ({'in' if cl['in_optimal_band'] else 'OUT of'} optimal band)")
