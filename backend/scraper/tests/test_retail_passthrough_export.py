"""The retail pass-through exporter shapes committed study outputs; it never computes.

Pure shaping only, on hand-made rows — the pandas study is not a test dependency
of the pipeline. What these tests guard is the one thing a shaping layer can get
catastrophically wrong: turning a missing number into a real one.
"""
from __future__ import annotations

from scraper.exporters import retail_passthrough as rp


def test_series_drops_months_before_the_retail_index_starts():
    rows = [{"month": "1975-03", "green_usd_per_kg_roasted": "1.234"},
            {"month": "2011-01", "green_usd_per_kg_roasted": "3.16512", "retail_us_coffee": "193.812",
             "retail_us": "124.3", "retail_eu": "", "retail_brazil": "nan"},
            {"month": "", "green_usd_per_kg_roasted": "9"}]
    s = rp.series(rows)
    assert len(s) == 1
    assert s[0] == {"m": "2011-01", "green": 3.165, "us": 193.8, "us2": 124.3, "eu": None, "br": None}


def test_a_blank_never_becomes_a_zero():
    out = rp.compact([{"market": "Brazil", "theta": "", "eg_p": "nan", "n": "79"}],
                     ("market", "theta", "eg_p", "n"))
    assert out == [{"market": "Brazil", "theta": None, "eg_p": None, "n": 79.0}]


def test_lag_profile_keeps_the_surrogate_band_beside_every_r():
    rows = [{"lag": "5", "pearson": "0.31879", "spearman": "0.2761", "n": "184", "n_eff": "135.7",
             "p_bartlett": "0.00014", "q_bh": "0.00355", "p_surrogate": "0.0", "sur_q95_abs": "0.1597"}]
    p = rp.lag_profile(rows)
    assert p[0]["lag"] == 5.0 and p[0]["pearson"] == 0.319 and p[0]["sur_q95_abs"] == 0.16


def test_cross_market_profiles_split_by_market_and_keep_lag_order():
    rows = [{"market": "us", "lag": "0", "pearson": "0.017", "sur_q95_abs": "0.169"},
            {"market": "us", "lag": "1", "pearson": "0.004", "sur_q95_abs": "0.168"},
            {"market": "br_brl", "lag": "0", "pearson": "0.10", "sur_q95_abs": "0.25"},
            {"market": "", "lag": "0", "pearson": "9"}]
    out = rp.cross_market_profiles(rows)
    assert set(out) == {"us", "br_brl"}
    assert [d["lag"] for d in out["us"]] == [0, 1]
    assert out["br_brl"][0] == {"lag": 0, "r": 0.1, "band": 0.25}


def test_headline_carries_the_qualifier_next_to_every_number():
    summ = {
        "headline": {"market": "US", "retail_series": "BLS CUSR0000SEFP01", "n": 186,
                     "first": "2011-01", "last": "2026-07", "months_missing": ["2025-10"]},
        "timing": {"peak_lag": 5, "peak_r": 0.31879, "sig_band_lo": 3, "sig_band_hi": 9,
                   "p_max_surrogate": 0.0025},
        "magnitude": {
            "cointegration": {"cointegrated_5pct": True, "eg_p": 0.005897},
            "ecm": {"theta_long_run": 0.287836, "theta_se_hac": 0.045684, "n_eff": 9.7614,
                    "beta_impact": 0.006181, "beta_impact_p": 0.52409,
                    "cum_passthrough": {"12": 0.268118}},
            "overlapping_12m_slope": {"slope": 0.181354, "n_eff": 17.8069},
        },
        "anchor": {"mean_green_usd_per_kg_roasted": 4.63907,
                   "implied_at_sample_mean": {"implied_retail_usd_per_kg": 16.11706},
                   "episode": {"start": "2019-05", "end": "2026-07", "green_delta_usd_per_kg": 5.26786,
                               "retail_pct": 54.9778, "cost_share_break_even": 0.28986}},
        "asymmetry": {"ecm_split": {"gamma_pos": -0.02597, "gamma_neg": -0.10809,
                                    "half_life_pos": 26.343, "half_life_neg": 6.0595,
                                    "p_equal_correction": 0.023565},
                      "bootstrap": {"p_equal_correction_bootstrap": 0.070929,
                                    "p_equal_shortrun_bootstrap": 0.308691,
                                    "verdict": "not established"}},
        "demand": {"best_lag": 4, "best_elasticity": -1.86889, "best_p": 0.067574,
                   "n_sig_05": 0, "n_lags_tested": 13},
    }
    h = rp.headline(summ)
    # a θ never travels without its effective n, nor a Wald p without the bootstrap
    assert h["theta"] == 0.288 and h["n_eff"] == 9.8
    assert "p_correction_asymptotic" not in h    # it lives under "asymmetry", beside the bootstrap p
    assert h["asymmetry"]["p_correction_asymptotic"] == 0.0236
    assert h["asymmetry"]["p_correction_bootstrap"] == 0.0709
    assert h["asymmetry"]["verdict"] == "not established"
    # the missing month is shipped, not smoothed away
    assert h["months_missing"] == ["2025-10"]
    assert h["band_lo"] == 3 and h["band_hi"] == 9 and h["p_max_surrogate"] == 0.0025
    assert h["episode"]["cost_share_break_even"] == 0.29 and h["episode"]["start"] == "2019-05"
    assert h["demand"]["n_sig_05"] == 0


def test_headline_survives_an_empty_summary():
    h = rp.headline({})
    assert h["theta"] is None and h["months_missing"] == [] and h["asymmetry"]["verdict"] is None


def test_export_skips_when_the_study_has_not_been_run(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(rp, "RESULTS", tmp_path)
    rp.export_retail_passthrough()
    assert "skipped" in capsys.readouterr().out
