"""Event study: what the arbitrage did after each ENSO onset, event by event.

The unit of evidence here is an EPISODE, not a month. Every summary carries n
(episodes), the share of episodes that moved the way the mean did, and a CI
from resampling episodes. A placebo redraws the same number of onsets from
neutral months, so "the mean path after El Niño" can be compared with "the
mean path after nothing in particular".
"""
from __future__ import annotations

import numpy as np
import pandas as pd

HORIZONS = list(range(0, 25))
TABLE_HORIZONS = [3, 6, 9, 12, 18, 24]


def event_paths(arb: pd.Series, onsets: list[pd.Period], horizons: list[int] = HORIZONS,
                pre_months: int = 3) -> pd.DataFrame:
    """Rows = onsets, columns = h: arb(t0+h) − arb(t0). Also `pre_level`
    (mean of the `pre_months` before t0) and `pre_trend` (arb(t0) − arb(t0−pre))."""
    rows = {}
    for t0 in onsets:
        if t0 not in arb.index:
            continue
        base = arb.get(t0)
        if pd.isna(base):
            continue
        row = {}
        for h in horizons:
            v = arb.get(t0 + h)
            row[h] = float(v - base) if v is not None and pd.notna(v) else np.nan
        pre = arb.reindex([t0 - i for i in range(1, pre_months + 1)])
        row["pre_level"] = float(pre.mean()) if pre.notna().any() else np.nan
        row["pre_trend"] = float(base - arb.get(t0 - pre_months)) if pd.notna(arb.get(t0 - pre_months, np.nan)) else np.nan
        rows[t0] = row
    return pd.DataFrame(rows).T


def summarise_paths(paths: pd.DataFrame, horizons: list[int] = HORIZONS, n_boot: int = 4000,
                    seed: int = 3) -> pd.DataFrame:
    """Per horizon: n, mean, median, q25, q75, min, max, consistency, bootstrap CI on the mean."""
    rng = np.random.default_rng(seed)
    rows = []
    for h in horizons:
        col = paths[h].dropna().to_numpy(float) if h in paths.columns else np.array([])
        n = len(col)
        if n == 0:
            rows.append({"h": h, "n": 0})
            continue
        mean = float(col.mean())
        sign = np.sign(mean) if mean != 0 else 1
        cons = float((np.sign(col) == sign).mean())
        if n >= 3:
            boots = rng.choice(col, size=(n_boot, n), replace=True).mean(axis=1)
            lo, hi = float(np.quantile(boots, 0.025)), float(np.quantile(boots, 0.975))
        else:
            lo = hi = np.nan
        rows.append({"h": h, "n": n, "mean": mean, "median": float(np.median(col)),
                     "q25": float(np.quantile(col, 0.25)), "q75": float(np.quantile(col, 0.75)),
                     "min": float(col.min()), "max": float(col.max()), "consistency": cons,
                     "ci_lo": lo, "ci_hi": hi})
    out = pd.DataFrame(rows)
    return out


def time_to_peak(summary: pd.DataFrame) -> tuple[int | None, float]:
    s = summary.dropna(subset=["mean"]) if "mean" in summary else summary.iloc[0:0]
    if s.empty:
        return None, np.nan
    j = s["mean"].abs().idxmax()
    return int(s.loc[j, "h"]), float(s.loc[j, "mean"])


def placebo(arb: pd.Series, n_events: int, candidate_months: list[pd.Period], horizons: list[int] = HORIZONS,
            n_draws: int = 2000, seed: int = 5, min_gap: int = 12) -> pd.DataFrame:
    """Distribution of the mean path when `n_events` onsets are drawn at random from
    `candidate_months` (neutral months, ≥ min_gap apart). Per horizon: q2.5, q97.5,
    and the sd of the placebo mean. Compare the real mean path to these bands."""
    rng = np.random.default_rng(seed)
    cands = [p for p in candidate_months if p in arb.index]
    if len(cands) < n_events * 2:
        return pd.DataFrame({"h": horizons})
    draws = np.full((n_draws, len(horizons)), np.nan)
    for i in range(n_draws):
        picked: list[pd.Period] = []
        tries = 0
        while len(picked) < n_events and tries < 500:
            tries += 1
            c = cands[rng.integers(len(cands))]
            if all(abs((c - q).n) >= min_gap for q in picked):
                picked.append(c)
        paths = event_paths(arb, picked, horizons)
        if len(paths):
            draws[i] = paths[horizons].mean(axis=0).to_numpy(float)
    return pd.DataFrame({"h": horizons,
                         "placebo_q025": np.nanquantile(draws, 0.025, axis=0),
                         "placebo_q975": np.nanquantile(draws, 0.975, axis=0),
                         "placebo_sd": np.nanstd(draws, axis=0)})


def placebo_p(real_mean: pd.Series, arb: pd.Series, n_events: int, candidate_months: list[pd.Period],
              horizons: list[int] = HORIZONS, n_draws: int = 2000, seed: int = 5) -> tuple[pd.Series, float]:
    """Two-sided placebo p per horizon, and a family-wise p for the largest |mean| across horizons."""
    rng = np.random.default_rng(seed)
    cands = [p for p in candidate_months if p in arb.index]
    draws = np.full((n_draws, len(horizons)), np.nan)
    for i in range(n_draws):
        picked: list[pd.Period] = []
        tries = 0
        while len(picked) < n_events and tries < 500:
            tries += 1
            c = cands[rng.integers(len(cands))]
            if all(abs((c - q).n) >= 12 for q in picked):
                picked.append(c)
        paths = event_paths(arb, picked, horizons)
        if len(paths):
            draws[i] = paths[horizons].mean(axis=0).to_numpy(float)
    obs = real_mean.reindex(horizons).to_numpy(float)
    per = pd.Series([float(np.nanmean(np.abs(draws[:, j]) >= abs(obs[j]))) if not np.isnan(obs[j]) else np.nan
                     for j in range(len(horizons))], index=horizons)
    obs_max = np.nanmax(np.abs(obs))
    fam = float(np.nanmean(np.nanmax(np.abs(draws), axis=1) >= obs_max))
    return per, fam


def event_table(arb: pd.Series, episodes: list[dict], horizons: list[int] = TABLE_HORIZONS) -> pd.DataFrame:
    """§9 of the brief: one row per episode with the arbitrage change at fixed horizons."""
    rows = []
    for e in episodes:
        t0 = e["onset"]
        base = arb.get(t0)
        pre = arb.reindex([t0 - i for i in range(1, 4)]).mean()
        row = {"onset": str(t0), "phase": e["phase"], "peak_oni": e["peak"], "peak_month": str(e["peak_month"]),
               "duration_m": e["n_months"], "merged_episodes": e.get("merged", 0),
               "pre_level": float(pre) if pd.notna(pre) else np.nan}
        for h in horizons:
            v = arb.get(t0 + h)
            row[f"chg_{h}m"] = float(v - base) if (v is not None and pd.notna(v) and pd.notna(base)) else np.nan
        rows.append(row)
    return pd.DataFrame(rows)
