"""enso_arbitrage.py — the ENSO × arbitrage study, shaped for the research page.

The study (backend/research/enso_arbitrage) does every computation and commits
its results as CSV/JSON under outputs/results. This only arranges them: it
picks the series and tables the page draws, trims the 12,000-row lag file to
the four curves the article shows, and carries the sample sizes and provenance
alongside so the page cannot quote a number without its n.

Stdlib only, like every exporter here — the study's pandas stack is not a
runtime dependency of the pipeline. If the outputs are absent the exporter
skips, as vn_midmonth does; it never fabricates a payload.

Output: frontend/public/data/enso_arbitrage.json
"""
from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path

from scraper.exporters.base import OUT_DIR

ROOT = Path(__file__).resolve().parents[3]
RESULTS = ROOT / "backend" / "research" / "enso_arbitrage" / "outputs" / "results"
TIER1 = "ICO indicator premium (1960→)"
TIER2 = "VN–BR physical premium B1"


def _num(v: str | None) -> float | None:
    if v is None or v == "" or v.lower() == "nan":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _rows(name: str) -> list[dict]:
    p = RESULTS / name
    if not p.exists():
        return []
    with p.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def _r(v: float | None, nd: int = 4) -> float | None:
    return None if v is None else round(v, nd)


# ── pure shaping ─────────────────────────────────────────────────────────────

def ccf_curve(rows: list[dict], arbitrage: str, index: str, transform: str) -> list[dict]:
    """One lag-by-lag curve: r, Spearman, the surrogate 95 % band, the two p's, the BH q."""
    out = []
    for r in rows:
        if r.get("arbitrage") != arbitrage or r.get("index") != index or r.get("transform") != transform:
            continue
        out.append({
            "lag": int(float(r["lag"])),
            "r": _r(_num(r.get("pearson"))),
            "rho": _r(_num(r.get("spearman"))),
            "n": int(float(r["n"])) if _num(r.get("n")) is not None else None,
            "n_eff": _r(_num(r.get("n_eff")), 1),
            "band": _r(_num(r.get("sur_q95_abs"))),
            "p_bartlett": _r(_num(r.get("p_bartlett"))),
            "p_surrogate": _r(_num(r.get("p_surrogate"))),
            "q_bh": _r(_num(r.get("q_bh_bartlett"))),
        })
    out.sort(key=lambda d: d["lag"])
    return out


def event_summary(rows: list[dict]) -> list[dict]:
    keys = ("mean", "median", "q25", "q75", "min", "max", "consistency", "ci_lo", "ci_hi",
            "placebo_q025", "placebo_q975", "p_placebo")
    out = []
    for r in rows:
        row = {"h": int(float(r["h"])), "n": int(float(r.get("n") or 0))}
        for k in keys:
            row[k] = _r(_num(r.get(k)))
        out.append(row)
    return out


def event_paths(rows: list[dict]) -> list[dict]:
    """Per-episode paths: {onset, values: [h0..h24]} — the spaghetti behind the mean."""
    out = []
    for r in rows:
        onset = r.get("") or r.get("onset") or next(iter(r.values()))
        vals = [_r(_num(r.get(str(h)))) for h in range(25)]
        out.append({"onset": onset, "values": vals})
    return out


def series(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        m = r.get("month") or r.get("")
        out.append({
            "m": m,
            "oni": _r(_num(r.get("oni")), 2),
            "ind": _r(_num(r.get("ind_arb_log")), 3),
            "fut": _r(_num(r.get("fut_arb_log")), 3),
            "b1": _r(_num(r.get("b1_log")), 3),
            "b3": _r(_num(r.get("b3_log")), 3),
            "regime": r.get("regime") or None,
        })
    return [s for s in out if s["m"]]


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


def build() -> dict:
    ccf = _rows("ccf_all_lags.csv")
    fam = _rows("ccf_family_summary.csv")
    summary = json.loads((RESULTS / "summary.json").read_text(encoding="utf-8"))
    ser = _rows("monthly_series.csv")
    t1 = [r for r in fam if r.get("arbitrage") == TIER1]
    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "backend/research/enso_arbitrage/outputs/results — study.py output, committed with the paper",
        "paper": "backend/research/enso_arbitrage/REPORT.md",
        "summary": {
            "tier1": summary.get("tier1"), "tier2": summary.get("tier2"),
            "n_tests_ccf": summary.get("n_tests_ccf"), "n_families": summary.get("n_families"),
            "episodes_all": summary.get("episodes_all"), "episodes_collapsed": summary.get("episodes_collapsed"),
            "episodes_in_tier1": summary.get("episodes_in_tier1"), "episodes_in_tier2": summary.get("episodes_in_tier2"),
            "event_placebo_family_p": summary.get("event_placebo_family_p"),
            "oos": summary.get("oos"), "weather_regression": summary.get("weather_regression"),
            "crop_year_regression": summary.get("crop_year_regression"),
            "price_levels_usd_t": summary.get("price_levels_usd_t"), "arb_volatility": summary.get("arb_volatility"),
            "discovery_end": summary.get("discovery_end"), "notes": summary.get("notes"),
            "tier1_families": len(t1),
            "tier1_families_pmax_lt_05": sum(1 for r in t1 if (_num(r.get("p_max_surrogate")) or 1) < 0.05),
            "tier1_families_q_lt_10": sum(1 for r in t1 if (_num(r.get("q_bh")) or 1) < 0.10),
            "tier1_min_pmax": min((_num(r.get("p_max_surrogate")) or 1) for r in t1) if t1 else None,
            "tier1_lag_tests": sum(1 for r in ccf if r.get("arbitrage") == TIER1 and _num(r.get("pearson")) is not None),
            "tier1_lag_tests_p05": sum(1 for r in ccf if r.get("arbitrage") == TIER1 and (_num(r.get("p_bartlett")) or 1) < 0.05),
            "tier1_lag_tests_q10": sum(1 for r in ccf if r.get("arbitrage") == TIER1 and (_num(r.get("q_bh_bartlett")) or 1) < 0.10),
        },
        "lag_response": compact(_rows("lag_response_table.csv"), (
            "event", "arbitrage", "n_events", "direction", "peak_lag_months", "mean_change_log", "ci_lo", "ci_hi",
            "consistency", "p_placebo_at_peak", "p_placebo_family", "pct_change_in_premium_ratio",
            "usd_t_at_sample_median_price", "ccf_best_lag", "ccf_r", "ccf_p_bartlett", "ccf_q_bh",
            "ccf_p_max_surrogate", "ccf_n_eff")),
        "series": series(ser),
        "episodes": compact(_rows("enso_episodes_official.csv"), ("phase", "onset", "end", "n_months", "peak", "peak_month"), 2),
        "ccf": {
            "tier1_diff3": ccf_curve(ccf, TIER1, "ONI", "diff3"),
            "tier1_level": ccf_curve(ccf, TIER1, "ONI", "level"),
            "tier1_pos_diff3": ccf_curve(ccf, TIER1, "ONI⁺", "diff3"),
            "tier1_neg_diff3": ccf_curve(ccf, TIER1, "ONI⁻", "diff3"),
            "tier2_diff3": ccf_curve(ccf, TIER2, "ONI", "diff3"),
            "tier2_level": ccf_curve(ccf, TIER2, "ONI", "level"),
        },
        "events": {
            "tier1": {ph: {"summary": event_summary(_rows(f"event_tier1_{ph}.csv")),
                           "paths": event_paths(_rows(f"event_paths_tier1_{ph}.csv"))}
                      for ph in ("el_nino", "la_nina")},
            "tier1_unmerged": {ph: {"summary": event_summary(_rows(f"event_tier1_backtoback_kept_{ph}.csv"))}
                               for ph in ("el_nino", "la_nina")},
            "tier2": {ph: {"summary": event_summary(_rows(f"event_tier2_{ph}.csv")),
                           "paths": event_paths(_rows(f"event_paths_tier2_{ph}.csv"))}
                      for ph in ("el_nino", "la_nina")},
        },
        "episode_table": compact(_rows("event_table_tier1.csv"), (
            "onset", "phase", "peak_oni", "peak_month", "duration_m", "merged_episodes", "pre_level",
            "chg_3m", "chg_6m", "chg_9m", "chg_12m", "chg_18m", "chg_24m"), 3),
        "regime_grid": compact(_rows("regime_lag_grid_tier1.csv"), ("regime", "lag", "n", "r", "p_bartlett"), 3),
        "robustness": compact([r for r in t1 if r.get("index") in ("ONI", "ONI⁺", "ONI⁻")], (
            "transform", "index", "best_lag", "r", "n", "n_eff", "p_bartlett", "q_bh", "p_max_surrogate",
            "ci_block_lo", "ci_block_hi", "best_pos_lag", "r_best_pos_lag", "q_bh_best_pos"), 3),
        "mechanism": compact(_rows("mechanism_chain.csv"), ("from", "to", "lag", "r", "n", "n_eff", "p_bartlett", "p_max_surrogate"), 3),
        "regressions": compact([r for r in _rows("regressions_tier1.csv")
                                if r.get("var") in ("oni", "oni_pos", "oni_neg", "dlog_ara_stocks_12")
                                and int(float(r["lag"])) in (0, 1, 3, 6, 12)],
                               ("lag", "spec", "var", "coef", "se_hac", "t", "p", "n"), 4),
        "predictive": compact([r for r in _rows("predictive_conditional.csv") if r.get("series", "").startswith("ICO")], (
            "phase", "signal", "sample", "h", "n_signals", "mean", "median", "hit_rate", "ci_lo", "ci_hi",
            "neutral_mean", "p_vs_neutral"), 3),
        "market_regimes": compact(_rows("market_regimes_tier1.csv"), ("regime_variable", "regime", "n_months", "best_lag", "r", "p_bartlett"), 3),
        "signals": {
            "total": len(_rows("realtime_signals.csv")),
            "confirmed": sum(1 for r in _rows("realtime_signals.csv") if r.get("confirmed") == "True"),
            "by_phase": {ph: {"n": sum(1 for r in _rows("realtime_signals.csv") if r.get("phase") == ph),
                              "confirmed": sum(1 for r in _rows("realtime_signals.csv") if r.get("phase") == ph and r.get("confirmed") == "True")}
                         for ph in ("el_nino", "la_nina")},
        },
    }


def export_enso_arbitrage() -> None:
    if not (RESULTS / "summary.json").exists():
        print(f"  enso_arbitrage.json: no study outputs at {RESULTS} — skipped")
        return
    doc = build()
    (OUT_DIR / "enso_arbitrage.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                                                 encoding="utf-8")
    s = doc["summary"]
    print(f"  enso_arbitrage.json: {len(doc['series'])} months, {s['n_tests_ccf']} tests, "
          f"episodes {s['episodes_in_tier1']}")


if __name__ == "__main__":
    export_enso_arbitrage()
