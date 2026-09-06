"""The pure logic the study rests on. Run from backend/: pytest research/retail_passthrough/tests

Not collected by CI (which runs tests/ scraper/tests/ telegram/tests/ only) —
the analysis stack is not in the scraper's requirements, by design. The exporter
that ships these results to the frontend IS stdlib-only and IS covered by CI, in
scraper/tests/test_export_retail_passthrough.py.

Every test here is a property with a known answer: an elasticity recovered from
data built to have it, an identity checked against arithmetic, a null that must
stay null. Nothing asserts a number that came out of the real series — those
live in REPORT.md, where they can move when the data move.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research.retail_passthrough.src import data as D
from research.retail_passthrough.src import model as M


def months(start: str, vals) -> pd.Series:
    idx = pd.period_range(start, periods=len(vals), freq="M")
    return pd.Series(list(vals), index=idx, dtype=float)


def synth(n: int = 260, theta: float = 0.30, lag: int = 5, seed: int = 0,
          noise: float = 0.004) -> tuple[pd.Series, pd.Series]:
    """A retail series built to pass θ of a green move through at `lag` months."""
    rng = np.random.default_rng(seed)
    idx = pd.period_range("2000-01", periods=n, freq="M")
    lg = pd.Series(np.cumsum(rng.normal(0, 0.05, n)) + np.log(4.0), index=idx)
    lr = theta * lg.shift(lag) + np.log(12.0) + pd.Series(rng.normal(0, noise, n), index=idx)
    return lg, lr.dropna()


# ── conversions ──────────────────────────────────────────────────────────────

def test_roast_yield_makes_a_kilo_of_roast_cost_more_than_a_kilo_of_green():
    per_kg = D.green_cost_per_kg_roasted(months("2020-01", [4200.0]))
    assert per_kg.iloc[0] == pytest.approx(4.2 / 0.84)
    assert per_kg.iloc[0] > 4.2          # water leaves, cost does not


def test_blend_is_a_weighted_sum_of_prices_not_of_logs():
    a, r = months("2020-01", [5000.0]), months("2020-01", [2000.0])
    assert D.blend(a, r, 0.70).iloc[0] == pytest.approx(0.7 * 5000 + 0.3 * 2000)


def test_cost_share_and_implied_retail_are_the_same_identity_inverted():
    share = M.cost_share_at(6000.0, 20.0)
    inv = M.implied_retail(share, 6000.0)
    assert inv["implied_retail_usd_per_kg"] == pytest.approx(20.0)


# ── missing months ───────────────────────────────────────────────────────────

def test_aligned_keeps_a_hole_as_a_hole():
    lg = months("2020-01", [1.0, 2.0, 3.0, 4.0, 5.0])
    lr = months("2020-01", [1.0, 2.0, np.nan, 4.0, 5.0])
    d = M._aligned(lg, lr)
    assert len(d) == 5 and bool(d["r"].isna().iloc[2])
    # the month after the hole must not be differenced against two months back
    assert np.isnan(d["r"].diff().iloc[3])


def test_a_missing_month_does_not_bridge_into_a_double_change():
    """The US CPI has no October 2025. Dropping it before differencing turns
    November into a two-month change wearing a one-month label, which moved the
    correlation peak by a whole month before this was fixed."""
    idx = pd.period_range("2020-01", periods=60, freq="M")
    rng = np.random.default_rng(0)
    lg = pd.Series(np.cumsum(rng.normal(0, 0.05, 60)), index=idx)
    lr = pd.Series(0.3 * lg.shift(2) + np.log(12), index=idx)
    holed = lr.copy()
    holed.loc[pd.Period("2022-01", "M")] = np.nan
    d = M._aligned(lg, holed)
    dr = d["r"].diff()
    assert np.isnan(dr.loc[pd.Period("2022-01", "M")])
    assert np.isnan(dr.loc[pd.Period("2022-02", "M")])
    # …and everything either side is untouched
    assert dr.loc[pd.Period("2021-12", "M")] == pytest.approx(lr.diff().loc[pd.Period("2021-12", "M")])


def test_estimators_survive_a_hole_without_a_shape_error():
    lg, lr = synth(200, theta=0.3, lag=4)
    holed = lr.copy()
    holed.iloc[120] = np.nan
    assert M.ecm(lg, holed)["ok"]
    assert M.asymmetric_ecm(lg, holed, sr_lags=6)["ok"]
    assert M.overlapping_slope(lg, holed)["ok"]
    assert M.engle_granger(lg, holed)["n"] == len(lr) - 1


def test_bootstrap_replications_carry_the_same_holes_as_the_data():
    lg, lr = synth(200, theta=0.3, lag=4)
    holed = lr.copy()
    holed.iloc[120] = np.nan
    boot = M.asymmetry_bootstrap_p(lg, holed, sr_lags=6, n_boot=15, seed=1)
    assert boot["ok"] and boot["n_boot"] == 15      # every replication estimable
    assert 0 < boot["p_equal_correction_bootstrap"] <= 1
    # the hole really does cost observations, so a replication that silently
    # filled it would be comparing the observed statistic against an easier null
    assert M.asymmetric_ecm(lg, holed, sr_lags=6)["n"] < M.asymmetric_ecm(lg, lr, sr_lags=6)["n"]


# ── timing ───────────────────────────────────────────────────────────────────

def test_lag_profile_finds_the_lag_it_was_given():
    lg, lr = synth(lag=7)
    prof = M.lag_profile(lg.diff(), lr.diff(), max_lag=18, n_sur=200)
    assert prof.attrs["best_lag"] == 7
    assert prof.attrs["p_max_surrogate"] < 0.05


def test_plateau_reports_a_band_not_just_the_argmax():
    lg, lr = synth(lag=6, noise=0.02)
    prof = M.lag_profile(lg.diff(), lr.diff(), max_lag=18, n_sur=200)
    p = M.plateau(prof)
    assert p["band_lo"] <= p["peak_lag"] <= p["band_hi"]
    assert p["sig_band_lo"] <= p["band_lo"] and p["sig_band_hi"] >= p["band_hi"]


def test_run_around_keeps_only_the_contiguous_stretch():
    assert M._run_around([1, 2, 3, 7, 8], 2) == (1, 3)
    assert M._run_around([1, 2, 3, 7, 8], 8) == (7, 8)
    assert M._run_around([4], 4) == (4, 4)


def test_max_abs_r_test_is_not_fooled_by_two_unrelated_random_walks():
    rng = np.random.default_rng(11)
    idx = pd.period_range("1990-01", periods=300, freq="M")
    x = pd.Series(rng.normal(size=300), index=idx).rolling(6).mean()
    y = pd.Series(rng.normal(size=300), index=idx).rolling(6).mean()
    prof = M.lag_profile(x, y, max_lag=18, n_sur=300)
    assert prof.attrs["p_max_surrogate"] > 0.05


# ── magnitude ────────────────────────────────────────────────────────────────

def test_ecm_recovers_the_long_run_elasticity_it_was_built_with():
    lg, lr = synth(theta=0.42, lag=4)
    out = M.ecm(lg, lr)
    assert out["ok"]
    # Slightly attenuated, and necessarily so: the static level regression puts
    # lr against green TODAY while the truth is green four months ago, and a
    # random walk has drifted in between. The bias is toward zero, which makes
    # the study's headline θ a lower bound rather than a flattering one.
    assert 0.85 * 0.42 <= out["theta_long_run"] <= 1.02 * 0.42


def test_ecm_horizons_never_exceed_the_lags_actually_fitted():
    lg, lr = synth()
    out = M.ecm(lg, lr, sr_lags=6)
    assert max(out["cum_passthrough"]) == 6
    assert set(out["cum_passthrough"]) <= {0, 2, 5, 6}


def test_cumulative_passthrough_is_a_running_sum_of_the_betas():
    lg, lr = synth()
    out = M.ecm(lg, lr, sr_lags=12)
    assert out["cum_passthrough"][5] == pytest.approx(sum(out["betas"][k] for k in range(6)))


def test_engle_granger_rejects_two_independent_random_walks():
    rng = np.random.default_rng(3)
    idx = pd.period_range("1990-01", periods=300, freq="M")
    a = pd.Series(np.cumsum(rng.normal(size=300)), index=idx)
    b = pd.Series(np.cumsum(rng.normal(size=300)), index=idx)
    assert M.engle_granger(a, b)["cointegrated_5pct"] is False


def test_engle_granger_finds_a_relationship_that_is_really_there():
    lg, lr = synth(theta=0.3)
    assert M.engle_granger(lg, lr)["cointegrated_5pct"] is True


def test_overlapping_slope_reports_an_effective_n_far_below_its_nominal_n():
    lg, lr = synth()
    out = M.overlapping_slope(lg, lr, window=12, lag=5)
    assert out["n_eff"] < out["n"] / 5      # 12-month windows overlap 11 times in 12


# ── the anchor ───────────────────────────────────────────────────────────────

def test_dollar_episode_break_even_share_matches_the_algebra():
    g = months("2020-01", [3.0] + [np.nan] * 10 + [6.0])
    r = months("2020-01", [100.0] + [np.nan] * 10 + [150.0])
    ep = M.dollar_episode(g, r, pd.Period("2020-01", "M"), pd.Period("2020-12", "M"))
    # green +$3/kg, retail +50 %: the base shelf price must have been ≥ $6/kg
    assert ep["min_base_retail_usd_per_kg"] == pytest.approx(6.0)
    assert ep["cost_share_break_even"] == pytest.approx(0.5)


def test_dollar_episode_is_silent_when_the_shelf_did_not_move():
    g = months("2020-01", [3.0, 6.0])
    r = months("2020-01", [100.0, 100.0])
    ep = M.dollar_episode(g, r, pd.Period("2020-01", "M"), pd.Period("2020-02", "M"))
    assert ep["min_base_retail_usd_per_kg"] is None and ep["cost_share_break_even"] is None


def test_cost_share_grid_crosses_one_exactly_where_theta_equals_the_share():
    grid = M.cost_share_grid(6000.0, [10, 6000 / 1000 / 0.84 / 0.25, 40], 0.25)
    assert grid["passthrough_rate"].iloc[1] == pytest.approx(1.0)


# ── asymmetry ────────────────────────────────────────────────────────────────

def test_the_asymptotic_asymmetry_test_over_rejects_and_the_bootstrap_corrects_it():
    """Seed 7 is a SYMMETRIC data-generating process that the HAC Wald test
    calls asymmetric at p = 0.003.

    That is not a fluke to be reseeded away: across 150 symmetric replications
    the nominal 5 % test fires about 10 % of the time and the nominal 1 % about
    3 %, while the bootstrap fires about 3 %. This is the whole reason
    `asymmetry_bootstrap_p` exists and why the study's verdict quotes it. Seed 7
    still rejects after the correction — a correctly sized 5 % test is supposed
    to, one time in twenty — but its p-value moves an order of magnitude.
    """
    lg, lr = synth(theta=0.3, lag=3, noise=0.01, seed=7)
    assert M.asymmetric_ecm(lg, lr, sr_lags=6)["verdict"] == "asymmetric"
    boot = M.asymmetry_bootstrap_p(lg, lr, sr_lags=6, n_boot=150, seed=1)
    assert boot["ok"]
    assert boot["p_equal_shortrun_bootstrap"] > 3 * boot["p_equal_shortrun_asymptotic"]
    assert boot["p_equal_correction_bootstrap"] >= boot["p_equal_correction_asymptotic"]


def test_bootstrap_null_imposes_a_correcting_gamma():
    lg, lr = synth(theta=0.3, lag=3, noise=0.01, seed=2)
    boot = M.asymmetry_bootstrap_p(lg, lr, sr_lags=6, n_boot=40, seed=1)
    assert -1 < boot["gamma_null_used"] <= 0


def test_block_resample_keeps_length_and_draws_from_the_input():
    rng = np.random.default_rng(0)
    x = np.arange(50.0)
    out = M._block_resample(x, 37, 6, rng)
    assert len(out) == 37 and set(out) <= set(x)


def test_sign_split_reports_the_interaction_test_not_just_two_slopes():
    lg, lr = synth()
    out = M.sign_split_slope(lg, lr)
    assert {"slope_up", "slope_down", "interaction", "interaction_p", "verdict"} <= set(out)
    assert (out["verdict"] == "asymmetric") == (out["interaction_p"] < 0.05)


def test_half_life_is_none_for_a_speed_that_does_not_converge():
    assert M._half_life(0.05) is None and M._half_life(-1.4) is None
    assert M._half_life(-0.5) == pytest.approx(1.0)


# ── demand ───────────────────────────────────────────────────────────────────

def test_demand_response_finds_nothing_in_noise():
    rng = np.random.default_rng(5)
    idx = pd.period_range("2010-01", periods=200, freq="M")
    p = pd.Series(np.cumsum(rng.normal(size=200)) * 0.02 + 3, index=idx)
    v = pd.Series(rng.normal(10, 0.1, 200), index=idx)
    out = M.demand_response(np.log(p), np.log(v), max_lag=6)
    # 7 lags at a nominal 5 % that empirically fires at ~6.8 % (measured over 400
    # replications of this DGP): a couple of false positives is within the null.
    # The distortion only ever manufactures a demand response, so the study's
    # actual finding — none at any lag — is the conservative direction.
    assert out["ok"] and out["n_sig_05"] <= 2
