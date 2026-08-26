"""Measure what ENSO actually does to each growing region, per crop phase.

Replaces the hand-typed effect table in enso_risk.py with numbers computed
from the rainfall history this repo already collects. The old table asserted,
for example, that El Niño means drought across all five Ugandan belts; the
measurement says the opposite, in every belt, in both directions.

WHAT IT MEASURES, per region

  lag_months   Where the teleconnection actually lands. ENSO arrives as an SST
               anomaly; the rainfall response is not simultaneous and the
               offset differs by region. Found by correlating monthly rainfall
               anomaly against the ONI at lags 0-6 and keeping the strongest.

  per phase    For each crop phase (flowering / fruit fill / harvest, per
               cycle), the mean rainfall anomaly across El Niño, La Niña and
               neutral occurrences of that window — with the ONI read at the
               region's own lag, so the classification matches the physics.

  consistency  The share of events that moved the same way as the mean. A
               large mean built from events that disagree is not a signal, and
               this is what makes that visible instead of averaging it away.

HONEST LIMITS, which the output carries so downstream cannot forget them
  · The per-year rainfall history is 2015-2025 — ELEVEN years, not thirty.
    That is roughly 3-4 El Niño and 4-5 La Niña occurrences per window. Enough
    to establish direction where the effect is large and consistent; not
    enough to pin a magnitude, and not enough to trust a weak signal at all.
  · Monthly rainfall totals are a cruder proxy than the SPI/SPEI/ET0 the
    drought model uses. A region can hit its normal total in three storms.
  · Every event is weighted equally: a weak El Niño counts the same as
    2015-16. Strength enters later, in the risk scoring, not here.

Run:  PYTHONPATH=. python -m scraper.enso_teleconnection
"""
from __future__ import annotations

import json
import statistics
from datetime import UTC, datetime
from pathlib import Path

from scraper.crop_calendar import CROP_CALENDAR, PHASES

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "public" / "data"
SEED = ROOT / "backend" / "seed" / "oni_history_full.json"
OUT_PATH = DATA / "enso_teleconnection.json"

WEATHER_FILE = {
    "brazil": "brazil_weather.json", "colombia": "colombia_weather.json",
    "honduras": "honduras_weather.json", "indonesia": "indonesia_weather.json",
    "uganda": "uganda_weather.json", "ethiopia": "ethiopia_weather.json",
    "vn": "vn_weather.json",
}

ONI_THRESHOLD = 0.5
MAX_LAG = 6
#: Below this many occurrences a bucket is reported but must not drive a
#: severity — three events is an anecdote, not a composite.
MIN_EVENTS = 3


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _pearson(xs: list[float], ys: list[float]) -> float:
    """Plain Pearson r — no numpy, so this script adds no dependency."""
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = statistics.mean(xs), statistics.mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=False))
    dx = sum((x - mx) ** 2 for x in xs)
    dy = sum((y - my) ** 2 for y in ys)
    return num / (dx * dy) ** 0.5 if dx > 0 and dy > 0 else 0.0


def _monthly_series(region: dict) -> dict[tuple[int, int], float]:
    """{(year, month): rainfall_mm} from a region's monthly_totals_history."""
    out: dict[tuple[int, int], float] = {}
    for year, months in (region.get("monthly_totals_history") or {}).items():
        for i, v in enumerate(months or [], start=1):
            if v is not None:
                out[(int(year), i)] = float(v)
    return out


def _climatology(series: dict[tuple[int, int], float]) -> dict[int, float]:
    """Mean rainfall per calendar month — the baseline anomalies are read against."""
    by_month: dict[int, list[float]] = {}
    for (_y, m), v in series.items():
        by_month.setdefault(m, []).append(v)
    return {m: statistics.mean(v) for m, v in by_month.items() if v}


def _anomaly_pct(series, clim, year, month) -> float | None:
    """Rainfall as % departure from that calendar month's own normal.

    Percent-of-normal rather than absolute mm, because a 50 mm miss is
    catastrophic in a dry month and noise in a wet one.
    """
    v = series.get((year, month))
    base = clim.get(month)
    if v is None or not base:
        return None
    return (v / base - 1.0) * 100.0


def measure_lag(series, clim, oni: dict[tuple[int, int], float]) -> tuple[int, float]:
    """Lag (months, ONI leading) whose correlation with rainfall is strongest."""
    best_lag, best_r = 0, 0.0
    for lag in range(MAX_LAG + 1):
        xs, ys = [], []
        for (y, m) in sorted(series):
            a = _anomaly_pct(series, clim, y, m)
            if a is None:
                continue
            ly, lm = y, m - lag
            while lm < 1:
                lm += 12
                ly -= 1
            o = oni.get((ly, lm))
            if o is None:
                continue
            xs.append(o)
            ys.append(a)
        r = _pearson(xs, ys)
        if abs(r) > abs(best_r):
            best_lag, best_r = lag, r
    return best_lag, round(best_r, 3)


def _occurrences(months: list[int], years: range) -> list[list[tuple[int, int]]]:
    """Each year's instance of a (possibly year-wrapping) window.

    Calendar windows are stored in chronological order, so a decrease in the
    month number means the window has rolled into the next year.
    """
    out = []
    for y in years:
        pairs, cur = [], y
        prev = None
        for m in months:
            if prev is not None and m < prev:
                cur += 1
            pairs.append((cur, m))
            prev = m
        out.append(pairs)
    return out


def _shift(pairs, lag: int):
    """Shift (year, month) pairs back by `lag` months — the ONI that drove them."""
    out = []
    for y, m in pairs:
        lm, ly = m - lag, y
        while lm < 1:
            lm += 12
            ly -= 1
        out.append((ly, lm))
    return out


def composite_phase(series, clim, oni, months: list[int], lag: int, years: range) -> dict:
    """Mean rainfall anomaly over this window, bucketed by ENSO phase."""
    buckets: dict[str, list[float]] = {"el-nino": [], "la-nina": [], "neutral": []}
    for pairs in _occurrences(months, years):
        anomalies = [a for a in (_anomaly_pct(series, clim, y, m) for y, m in pairs) if a is not None]
        if len(anomalies) < len(months):
            continue  # partial window — skip rather than half-count it
        drivers = [oni[p] for p in _shift(pairs, lag) if p in oni]
        if not drivers:
            continue
        mean_oni = statistics.mean(drivers)
        phase = ("el-nino" if mean_oni >= ONI_THRESHOLD
                 else "la-nina" if mean_oni <= -ONI_THRESHOLD else "neutral")
        buckets[phase].append(statistics.mean(anomalies))

    out = {}
    for phase, vals in buckets.items():
        if not vals:
            out[phase] = {"anomaly_pct": None, "n": 0, "consistency": None, "usable": False}
            continue
        mean = statistics.mean(vals)
        same = sum(1 for v in vals if (v >= 0) == (mean >= 0))
        out[phase] = {
            "anomaly_pct": round(mean, 1),
            "n": len(vals),
            # Share of events that moved with the mean. 1.0 means every event
            # agreed; 0.5 means the mean is an artefact of cancellation.
            "consistency": round(same / len(vals), 2),
            "usable": len(vals) >= MIN_EVENTS,
        }
    return out


def build() -> dict:
    seed = _load(SEED) or {}
    oni = {(p["year"], p["month"]): p["value"] for p in (seed.get("oni") or [])}
    regions_out: dict[str, dict] = {}
    year_lo, year_hi = 9999, 0

    for origin, fname in WEATHER_FILE.items():
        doc = _load(DATA / fname)
        cal = CROP_CALENDAR.get(origin)
        if not doc or not cal:
            continue
        for region in doc.get("provinces") or []:
            series = _monthly_series(region)
            if not series:
                continue
            years = sorted({y for y, _ in series})
            year_lo, year_hi = min(year_lo, years[0]), max(year_hi, years[-1])
            clim = _climatology(series)
            lag, r = measure_lag(series, clim, oni)
            span = range(years[0], years[-1] + 1)

            phases: dict[str, dict] = {}
            for cycle in cal["cycles"]:
                for phase in PHASES:
                    months = cycle.get(phase)
                    if not months:
                        continue
                    key = f"{cycle['label']}/{phase}"
                    phases[key] = {
                        "months": months,
                        "inferred": bool(cycle.get("fill_inferred")) and phase == "fruit_fill",
                        **composite_phase(series, clim, oni, months, lag, span),
                    }

            regions_out[f"{origin}|{region['name']}"] = {
                "origin": origin,
                "region": region["name"],
                "lag_months": lag,
                "lag_r": r,
                "years": [years[0], years[-1]],
                "phases": phases,
            }

    return {
        "generated": datetime.now(UTC).isoformat(timespec="seconds"),
        "window_years": [year_lo, year_hi],
        "oni_threshold": ONI_THRESHOLD,
        "min_events": MIN_EVENTS,
        "note": (
            "Measured ENSO response per growing region per crop phase, from this repo's own "
            "monthly rainfall history and ONI record. anomaly_pct is the mean departure from that "
            "window's normal across occurrences of each ENSO phase; consistency is the share of "
            "occurrences that moved the same way as the mean, so a large mean built from "
            "disagreeing events is visible rather than averaged away. lag_months is where the "
            "teleconnection actually lands — ENSO arrives as an SST anomaly and the rainfall "
            "response is not simultaneous. The history is eleven years, so treat direction as "
            "informative and magnitude as indicative; a bucket with usable=false has too few "
            "occurrences to drive a severity."
        ),
        "regions": regions_out,
    }


def export() -> None:
    doc = build()
    OUT_PATH.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    n_phase = sum(len(r["phases"]) for r in doc["regions"].values())
    print(f"[teleconnection] {len(doc['regions'])} regions × {n_phase} phase-windows "
          f"from {doc['window_years'][0]}–{doc['window_years'][1]} → {OUT_PATH.name}")


if __name__ == "__main__":
    export()
