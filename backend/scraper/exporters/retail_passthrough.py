"""retail_passthrough.py — the green→shelf pass-through study, shaped for the research page.

The study (backend/research/retail_passthrough) does every computation and
commits its results as CSV/JSON under outputs/results. This only arranges them:
it picks the series and tables the page draws, thins the monthly series to the
window the charts show, and carries every sample size and p-value alongside so
the page cannot quote a number without the caveat attached to it.

Stdlib only, like every exporter here — the study's pandas stack is not a
runtime dependency of the pipeline. If the outputs are absent the exporter
skips; it never fabricates a payload.

Output: frontend/public/data/retail_passthrough.json
"""
from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path

from scraper.exporters.base import OUT_DIR

ROOT = Path(__file__).resolve().parents[3]
RESULTS = ROOT / "backend" / "research" / "retail_passthrough" / "outputs" / "results"
#: The charts start at 2011 — the first month the US retail index exists. Green
#: runs to 1960 in the source file and none of it is drawn, so it is dropped
#: here rather than shipped and ignored.
FIRST_MONTH = "2011-01"


def _num(v: str | None) -> float | None:
    if v is None or v == "" or str(v).lower() == "nan":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rows(name: str) -> list[dict]:
    p = RESULTS / name
    if not p.exists():
        return []
    with p.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def _summary() -> dict:
    p = RESULTS / "summary.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _r(v: float | None, nd: int = 4) -> float | None:
    return None if v is None else round(v, nd)


# ── pure shaping ─────────────────────────────────────────────────────────────

def compact(rows: list[dict], keep: tuple[str, ...], nd: int = 4) -> list[dict]:
    out = []
    for r in rows:
        row = {}
        for k in keep:
            v = r.get(k)
            f = _num(v)
            row[k] = _r(f, nd) if f is not None else (v if v not in ("", None, "nan") else None)
        out.append(row)
    return out


def series(rows: list[dict], first: str = FIRST_MONTH) -> list[dict]:
    """Monthly levels for chart 1: the green cost per roasted kilo against each
    retail index. Indices keep one decimal, the green cost three."""
    out = []
    for r in rows:
        m = r.get("month") or r.get("")
        if not m or m < first:
            continue
        out.append({
            "m": m,
            "green": _r(_num(r.get("green_usd_per_kg_roasted")), 3),
            "us": _r(_num(r.get("retail_us_coffee")), 1),
            "us2": _r(_num(r.get("retail_us")), 1),
            "eu": _r(_num(r.get("retail_eu")), 1),
            "br": _r(_num(r.get("retail_brazil")), 1),
        })
    return out


def lag_profile(rows: list[dict]) -> list[dict]:
    """One curve for chart 2: r at each lag with the surrogate band and both p's."""
    return compact(rows, ("lag", "pearson", "spearman", "n", "n_eff",
                          "p_bartlett", "q_bh", "p_surrogate", "sur_q95_abs"), 3)


def cross_market_profiles(rows: list[dict]) -> dict[str, list[dict]]:
    """Chart 9 — the same curve per market, keyed by market so the page can
    render small multiples without re-splitting a long table."""
    out: dict[str, list[dict]] = {}
    for r in rows:
        key = r.get("market")
        if not key:
            continue
        out.setdefault(key, []).append({
            "lag": int(float(r["lag"])),
            "r": _r(_num(r.get("pearson")), 3),
            "band": _r(_num(r.get("sur_q95_abs")), 3),
        })
    return out


def headline(summ: dict) -> dict:
    """The eight numbers the article's opening panel quotes, each with the thing
    that qualifies it — an n_eff beside a θ, a bootstrap p beside a Wald p."""
    h, t = summ.get("headline", {}), summ.get("timing", {})
    mag = summ.get("magnitude", {})
    ecm, eg = mag.get("ecm", {}), mag.get("cointegration", {})
    slope = mag.get("overlapping_12m_slope", {})
    anch = summ.get("anchor", {})
    ep = anch.get("episode", {})
    asym = summ.get("asymmetry", {})
    boot = asym.get("bootstrap", {})
    return {
        "market": h.get("market"), "retail_series": h.get("retail_series"),
        "n": h.get("n"), "first": h.get("first"), "last": h.get("last"),
        "months_missing": h.get("months_missing") or [],
        "peak_lag": t.get("peak_lag"), "peak_r": _r(t.get("peak_r"), 3),
        "band_lo": t.get("sig_band_lo"), "band_hi": t.get("sig_band_hi"),
        "p_max_surrogate": _r(t.get("p_max_surrogate"), 4),
        "cointegrated": eg.get("cointegrated_5pct"), "eg_p": _r(eg.get("eg_p"), 4),
        "theta": _r(ecm.get("theta_long_run"), 3), "theta_se": _r(ecm.get("theta_se_hac"), 3),
        "n_eff": _r(ecm.get("n_eff"), 1),
        "beta_impact": _r(ecm.get("beta_impact"), 3), "beta_impact_p": _r(ecm.get("beta_impact_p"), 3),
        "cum_12m": _r((ecm.get("cum_passthrough") or {}).get("12"), 3),
        "slope_12m": _r(slope.get("slope"), 3), "slope_n_eff": _r(slope.get("n_eff"), 1),
        "implied_retail_kg": _r((anch.get("implied_at_sample_mean") or {}).get("implied_retail_usd_per_kg"), 2),
        "mean_green_kg": _r(anch.get("mean_green_usd_per_kg_roasted"), 3),
        "episode": {k: _r(ep.get(k), 3) for k in
                    ("green_delta_usd_per_kg", "retail_pct", "cost_share_break_even")}
        | {"start": ep.get("start"), "end": ep.get("end")},
        "asymmetry": {
            "gamma_pos": _r((asym.get("ecm_split") or {}).get("gamma_pos"), 3),
            "gamma_neg": _r((asym.get("ecm_split") or {}).get("gamma_neg"), 3),
            # the SEs travel with the estimates: this panel's whole point is that
            # two very different-looking bars are not significantly different
            "gamma_pos_se": _r((asym.get("ecm_split") or {}).get("gamma_pos_se"), 3),
            "gamma_neg_se": _r((asym.get("ecm_split") or {}).get("gamma_neg_se"), 3),
            "half_life_pos": _r((asym.get("ecm_split") or {}).get("half_life_pos"), 1),
            "half_life_neg": _r((asym.get("ecm_split") or {}).get("half_life_neg"), 1),
            "p_correction_asymptotic": _r((asym.get("ecm_split") or {}).get("p_equal_correction"), 4),
            "p_correction_bootstrap": _r(boot.get("p_equal_correction_bootstrap"), 4),
            "p_shortrun_bootstrap": _r(boot.get("p_equal_shortrun_bootstrap"), 4),
            "verdict": boot.get("verdict"),
        },
        "demand": {k: _r((summ.get("demand") or {}).get(k), 3) if isinstance(
            (summ.get("demand") or {}).get(k), (int, float)) else (summ.get("demand") or {}).get(k)
            for k in ("best_lag", "best_elasticity", "best_p", "n_sig_05", "n_lags_tested")},
    }


def build() -> dict:
    summ = _summary()
    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "backend/research/retail_passthrough — see REPORT.md",
        "headline": headline(summ),
        "caveats": summ.get("data_caveats", []),
        "markets_not_covered": summ.get("markets_not_covered", {}),
        "series": series(_rows("monthly_series.csv")),
        "lag_profile": lag_profile(_rows("lag_profile_us.csv")),
        "cross_market": compact(_rows("cross_market.csv"), (
            "key", "market", "retail_series", "currency", "n", "first", "last", "peak_lag", "peak_r",
            "band_lo", "band_hi", "p_max_surrogate", "eg_p", "cointegrated_5pct", "theta",
            "theta_se_hac", "n_eff", "slope_12m_lag5", "slope_p_hac", "cost_share_break_even",
            "asym_correction_p_boot"), 3),
        "cross_market_profiles": cross_market_profiles(_rows("cross_market_lag_profiles.csv")),
        "betas": compact(_rows("ecm_betas.csv"), ("lag", "beta", "p", "cumulative"), 4),
        "cost_share_grid": compact(_rows("cost_share_grid.csv"), (
            "retail_usd_per_kg", "retail_usd_per_lb", "green_cost_share", "passthrough_rate"), 3),
        "robustness": compact(_rows("robustness.csv"), (
            "market", "spec", "n", "first", "last", "eg_p", "cointegrated_5pct", "theta",
            "theta_se_hac", "n_eff", "cum_passthrough_12m", "slope_12m_lag5", "slope_p_hac"), 3),
        "subsamples": compact(_rows("subsamples.csv"), (
            "sample", "n", "first", "last", "eg_p", "theta", "slope_12m_lag5", "slope_p_hac"), 3),
        "demand_by_lag": compact(_rows("demand_by_lag.csv"), ("lag", "elasticity", "se_hac", "p", "n"), 3),
        "roast_yield": compact(_rows("roast_yield_sensitivity.csv"), (
            "roast_yield", "green_usd_per_kg_roasted", "implied_retail_usd_per_kg",
            "implied_retail_usd_per_lb"), 3),
    }


def export_retail_passthrough() -> None:
    if not (RESULTS / "summary.json").exists():
        print(f"  retail_passthrough.json: no study outputs at {RESULTS} — skipped")
        return
    doc = build()
    (OUT_DIR / "retail_passthrough.json").write_text(
        json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    h = doc["headline"]
    print(f"  retail_passthrough.json: {len(doc['series'])} months, θ={h['theta']} "
          f"(n_eff {h['n_eff']}), lag band {h['band_lo']}–{h['band_hi']}, "
          f"{len(doc['cross_market'])} markets")


if __name__ == "__main__":
    export_retail_passthrough()
