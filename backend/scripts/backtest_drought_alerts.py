#!/usr/bin/env python3
"""backtest_drought_alerts.py — replay the 30-year baselines through the
drought thresholds so the IPHM numbers are defended, not hand-set.

For every region in the SPEI seed (1995-2024 monthly P and ET0), computes the
historical SPEI-3 series in-sample (each month scored against the full
calibration for its calendar month — the same math the live pipeline runs),
then reports:

  1. Base rates — % of region-months at/below each ladder threshold
     (−1.0 watch / −1.2 alert / −1.5 critical met-leg). Under a perfect
     normal fit these would be 15.9% / 11.5% / 6.7%; the persistence gate
     and the VHI conjunction are what make PUBLISHED alerts far rarer.
  2. Episode structure — distribution of consecutive-month runs below the
     critical met-leg (justifies the persistence windows).
  3. Event validation — the known drought episodes must show up:
       BRA 2014 (Jan–Mar), BRA 2020-21 (Sep 20–Sep 21), VNM 2015-16 El Niño
       (Nov 15–May 16), HND 2019 (Jun–Sep), ETH 2015-16 (Oct 15–Mar 16),
       IDN 2015 El Niño (Aug–Nov).
     Hit = any region of the origin at/below the alert met-leg (−1.2) inside
     the window.

Writes backend/seed/drought_backtest_report.json (evidence artifact cited by
the Research → drought methodology paper).

    python backend/scripts/backtest_drought_alerts.py          # print + write

Requires scipy (same as the live SPI/SPEI path).
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spei_calc  # noqa: E402

SEED = Path(__file__).resolve().parents[1] / "seed" / "spei_30yr_baselines.json"
OUT = Path(__file__).resolve().parents[1] / "seed" / "drought_backtest_report.json"

LADDER = {"watch": -1.0, "alert": -1.2, "critical": -1.5}

KNOWN_EVENTS = [
    {"origin": "brazil",    "label": "Brazil 2014 (SE drought)",      "start": "2014-01", "end": "2014-04"},
    {"origin": "brazil",    "label": "Brazil 2020-21 (pre-frost drought)", "start": "2020-09", "end": "2021-09"},
    {"origin": "vn",        "label": "Vietnam 2015-16 (El Niño)",     "start": "2015-11", "end": "2016-05"},
    {"origin": "honduras",  "label": "Central America 2019",          "start": "2019-06", "end": "2019-09"},
    {"origin": "ethiopia",  "label": "Ethiopia 2015-16 (El Niño)",    "start": "2015-10", "end": "2016-03"},
    {"origin": "indonesia", "label": "Indonesia 2015 (El Niño)",      "start": "2015-08", "end": "2015-11"},
]


def spei3_series(p_map: dict[str, float], et0_map: dict[str, float]) -> dict[str, float]:
    """Historical SPEI-3 per month, each scored against the full-period
    calibration for its calendar month (in-sample — the point is threshold
    frequency, not out-of-sample skill)."""
    d = spei_calc.monthly_d(p_map, et0_map)
    roll = spei_calc.rolling_sum(d, 3)
    by_cal: dict[str, list[float]] = defaultdict(list)
    for ym, v in roll.items():
        by_cal[ym[5:7]].append(v)
    out = {}
    for ym, v in roll.items():
        z = spei_calc.spei(by_cal[ym[5:7]], v)
        if z is not None:
            out[ym] = z
    return out


def runs_below(series: dict[str, float], thr: float) -> list[int]:
    """Lengths of consecutive-month runs at/below thr."""
    runs, cur = [], 0
    for ym in sorted(series):
        if series[ym] <= thr:
            cur += 1
        elif cur:
            runs.append(cur)
            cur = 0
    if cur:
        runs.append(cur)
    return runs


def main() -> None:
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    origins = seed.get("origins") or {}

    all_series: dict[str, dict[str, dict[str, float]]] = {}
    n_months = 0
    base = {k: 0 for k in LADDER}
    run_hist: list[int] = []

    for origin, regions in origins.items():
        for region, months in regions.items():
            p = {ym: rec["p"] for ym, rec in months.items() if rec.get("p") is not None}
            e = {ym: rec["et0"] for ym, rec in months.items() if rec.get("et0") is not None}
            s3 = spei3_series(p, e)
            if not s3:
                continue
            all_series.setdefault(origin, {})[region] = s3
            n_months += len(s3)
            for tier, thr in LADDER.items():
                base[tier] += sum(1 for v in s3.values() if v <= thr)
            run_hist.extend(runs_below(s3, LADDER["critical"]))

    base_rates = {t: round(c / n_months * 100, 1) for t, c in base.items()}

    events = []
    for ev in KNOWN_EVENTS:
        regions = all_series.get(ev["origin"], {})
        best, best_region = None, None
        for region, s3 in regions.items():
            vals = [v for ym, v in s3.items() if ev["start"] <= ym <= ev["end"]]
            if vals and (best is None or min(vals) < best):
                best, best_region = min(vals), region
        events.append({
            **ev,
            "min_spei3": round(best, 2) if best is not None else None,
            "worst_region": best_region,
            "hit_alert_leg": bool(best is not None and best <= LADDER["alert"]),
            "hit_critical_leg": bool(best is not None and best <= LADDER["critical"]),
        })

    runs_ge2 = sum(1 for r in run_hist if r >= 2)
    report = {
        "windows": "SPEI-3 in-sample vs 1995-2024 seeds; met-leg only (no VHI pre-2006)",
        "region_months": n_months,
        "met_leg_base_rates_pct": base_rates,
        "theoretical_normal_pct": {"watch": 15.9, "alert": 11.5, "critical": 6.7},
        "critical_runs": {
            "episodes": len(run_hist),
            "share_lasting_2plus_months": round(runs_ge2 / len(run_hist) * 100, 1) if run_hist else None,
            "max_run_months": max(run_hist) if run_hist else 0,
        },
        "known_events": events,
        "note": "Published-alert rarity comes from the VHI conjunction + persistence "
                "gates on top of these met-leg rates; see iphm_thresholds v3.",
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"region-months scored: {n_months}")
    print(f"met-leg base rates:   {base_rates}  (theory: 15.9/11.5/6.7)")
    print(f"critical runs: {report['critical_runs']}")
    print("known events:")
    for ev in events:
        flag = "HIT " if ev["hit_alert_leg"] else "MISS"
        print(f"  [{flag}] {ev['label']:38s} min SPEI-3 {ev['min_spei3']} ({ev['worst_region']})")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
