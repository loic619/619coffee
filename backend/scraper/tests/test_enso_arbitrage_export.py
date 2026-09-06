"""The ENSO × arbitrage exporter shapes committed study outputs; it never computes.

Pure shaping only, on hand-made rows — the pandas study is not a test
dependency of the pipeline.
"""
from __future__ import annotations

from scraper.exporters import enso_arbitrage as ea


def test_ccf_curve_selects_one_family_and_sorts_by_lag():
    rows = [
        {"arbitrage": ea.TIER1, "index": "ONI", "transform": "diff3", "lag": "2", "pearson": "-0.10", "spearman": "-0.08",
         "n": "797", "n_eff": "198.0", "sur_q95_abs": "0.147", "p_bartlett": "0.12", "p_surrogate": "0.16", "q_bh_bartlett": "0.70"},
        {"arbitrage": ea.TIER1, "index": "ONI", "transform": "diff3", "lag": "-1", "pearson": "-0.101", "spearman": "-0.09",
         "n": "795", "n_eff": "197.3", "sur_q95_abs": "0.151", "p_bartlett": "0.158", "p_surrogate": "0.19", "q_bh_bartlett": "0.70"},
        {"arbitrage": ea.TIER1, "index": "ONI", "transform": "level", "lag": "0", "pearson": "-0.05", "spearman": "",
         "n": "800", "n_eff": "", "sur_q95_abs": "", "p_bartlett": "", "p_surrogate": "", "q_bh_bartlett": ""},
        {"arbitrage": ea.TIER2, "index": "ONI", "transform": "diff3", "lag": "0", "pearson": "nan", "spearman": "nan",
         "n": "0", "n_eff": "", "sur_q95_abs": "", "p_bartlett": "", "p_surrogate": "", "q_bh_bartlett": ""},
    ]
    c = ea.ccf_curve(rows, ea.TIER1, "ONI", "diff3")
    assert [d["lag"] for d in c] == [-1, 2]
    assert c[1]["r"] == -0.1 and c[1]["band"] == 0.147 and c[1]["q_bh"] == 0.7
    # blanks and 'nan' become null, never 0
    lvl = ea.ccf_curve(rows, ea.TIER1, "ONI", "level")
    assert lvl[0]["rho"] is None and lvl[0]["band"] is None
    assert ea.ccf_curve(rows, ea.TIER2, "ONI", "diff3")[0]["r"] is None


def test_event_summary_and_paths_keep_the_horizon_grid():
    summ = ea.event_summary([{"h": "12", "n": "17", "mean": "-0.102", "median": "-0.09", "q25": "-0.211", "q75": "-0.034",
                              "min": "-0.632", "max": "0.191", "consistency": "0.765", "ci_lo": "-0.198", "ci_hi": "-0.011",
                              "placebo_q025": "-0.072", "placebo_q975": "0.093", "p_placebo": "0.016"},
                             {"h": "0", "n": "0"}])
    assert summ[0]["h"] == 12 and summ[0]["consistency"] == 0.765 and summ[1]["mean"] is None
    paths = ea.event_paths([{"": "1997-05", **{str(h): str(-0.01 * h) for h in range(25)}}])
    assert paths[0]["onset"] == "1997-05" and len(paths[0]["values"]) == 25 and paths[0]["values"][12] == -0.12


def test_series_rounds_and_drops_blank_months():
    s = ea.series([{"month": "1997-05", "oni": "0.7123", "ind_arb_log": "0.89012", "fut_arb_log": "", "b1_log": "nan",
                    "b3_log": "", "regime": "el_nino"},
                   {"month": "", "oni": "1"}])
    assert len(s) == 1
    assert s[0] == {"m": "1997-05", "oni": 0.71, "ind": 0.89, "fut": None, "b1": None, "b3": None, "regime": "el_nino"}


def test_compact_keeps_text_and_numbers_apart():
    out = ea.compact([{"event": "el_nino", "peak_lag_months": "12.0", "direction": "premium narrows", "ci_lo": "nan"}],
                     ("event", "peak_lag_months", "direction", "ci_lo"))
    assert out == [{"event": "el_nino", "peak_lag_months": 12.0, "direction": "premium narrows", "ci_lo": None}]
