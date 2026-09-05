"""The pure logic the study rests on. Run from backend/: pytest research/enso_arbitrage/tests

Not collected by CI (which runs tests/ scraper/tests/ telegram/tests/ only) —
the analysis stack is not in the scraper's requirements, by design.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research.enso_arbitrage.src import arbitrage as ab
from research.enso_arbitrage.src import enso
from research.enso_arbitrage.src import events as ev
from research.enso_arbitrage.src import stats as st


def P(s: str) -> pd.Period:
    return pd.Period(s, freq="M")


def months(start: str, vals) -> pd.Series:
    idx = pd.period_range(start, periods=len(vals), freq="M")
    return pd.Series(list(vals), index=idx, dtype=float)


# ── ENSO classification ───────────────────────────────────────────────────────

def test_official_episode_needs_five_seasons():
    oni = months("2000-01", [0.6, 0.7, 0.8, 0.6, 0.0, 0.6, 0.7, 0.9, 1.1, 0.8, 0.2])
    eps = enso.official_episodes(oni)
    assert [(e["phase"], str(e["onset"]), e["n_months"]) for e in eps] == [("el_nino", "2000-06", 5)]
    assert eps[0]["peak"] == 1.1 and str(eps[0]["peak_month"]) == "2000-09"


def test_la_nina_is_the_mirror_rule_and_neutral_fills_the_rest():
    oni = months("1999-01", [-0.6] * 6 + [0.1] * 3 + [0.5] * 5)
    lab = enso.regime_labels(oni)
    assert lab.iloc[0] == "la_nina" and lab.iloc[7] == "neutral" and lab.iloc[-1] == "el_nino"


def test_back_to_back_episodes_collapse_but_stay_countable():
    eps = [{"phase": "la_nina", "onset": P("2020-09"), "end": P("2021-04"), "n_months": 8, "peak": -1.1, "peak_month": P("2020-11")},
           {"phase": "la_nina", "onset": P("2021-09"), "end": P("2023-01"), "n_months": 17, "peak": -0.9, "peak_month": P("2021-11")},
           {"phase": "el_nino", "onset": P("2023-06"), "end": P("2024-04"), "n_months": 11, "peak": 2.0, "peak_month": P("2023-12")}]
    out = enso.collapse_back_to_back(eps)
    assert len(out) == 2 and out[0]["merged"] == 1 and str(out[0]["end"]) == "2023-01" and out[0]["peak"] == -1.1


def test_realtime_signal_carries_publication_delay_and_keeps_false_alarms():
    oni = months("2010-01", [0.0, 0.6, 0.7, 0.0, 0.0, 0.0, 0.0, 0.0])
    weekly = pd.Series(dtype=float)   # no weekly data: only the ONI rules can fire
    sig = enso.realtime_signals(oni, weekly)
    # two months past +0.5 (Feb, Mar) → known in May (Mar + 2)
    assert list(sig["month"].astype(str)) == ["2010-05"] and sig.iloc[0]["rule"] == "oni_2mo"
    lab = enso.label_signals(sig, enso.official_episodes(oni))
    assert bool(lab.iloc[0]["confirmed"]) is False     # never became a 5-season event


def test_nino34_four_week_rule_fires_in_the_month_of_the_fourth_week():
    weeks = pd.Series([0.6, 0.6, 0.6, 0.6], index=pd.to_datetime(["2023-05-10", "2023-05-17", "2023-05-24", "2023-06-01"]))
    sig = enso.realtime_signals(pd.Series(dtype=float), weeks)
    assert list(sig["month"].astype(str)) == ["2023-06"] and sig.iloc[0]["rule"] == "nino34_4wk"


def test_availability_shift_moves_the_key_not_the_value():
    s = months("2020-01", [1, 2, 3])
    out = enso.availability_shift(s, 2)
    assert str(out.index[0]) == "2020-03" and out.iloc[0] == 1


# ── arbitrage arithmetic ──────────────────────────────────────────────────────

def test_ny_london_uses_the_repo_conversion():
    kc = pd.Series([200.0], index=pd.to_datetime(["2024-01-02"]))
    rc = pd.Series([3000.0], index=pd.to_datetime(["2024-01-02"]))
    a = ab.ny_london(kc, rc)
    assert a["kc_usd_t"].iloc[0] == pytest.approx(200 * 22.0462)
    assert a["arb_usd"].iloc[0] == pytest.approx(4409.24 - 3000)
    assert a["arb_log"].iloc[0] == pytest.approx(np.log(4409.24 / 3000))


def test_physical_legs_convert_on_the_days_fx_and_b3_nets_the_exchange_out():
    d = pd.to_datetime(["2024-01-02"])
    legs = ab.to_usd_t(pd.Series([100_000.0], index=d), pd.Series([25_000.0], index=d),
                       pd.Series([1_500.0], index=d), pd.Series([5.0], index=d))
    assert legs["vn_usd_t"].iloc[0] == pytest.approx(4000.0)          # 100,000 VND/kg → USD/t
    assert legs["br_usd_t"].iloc[0] == pytest.approx(5000.0)          # 1,500 R$/saca → USD/t
    b = ab.vn_br(legs, pd.Series([4409.24], index=d), pd.Series([3000.0], index=d))
    assert b["b1_log"].iloc[0] == pytest.approx(np.log(5000 / 4000))
    assert b["b3_log"].iloc[0] == pytest.approx(np.log(5000 / 4000) - np.log(4409.24 / 3000))


def test_monthly_mean_refuses_a_thin_month():
    idx = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-02-01"] + [f"2024-03-{d:02d}" for d in range(1, 12)])
    s = pd.Series(range(len(idx)), index=idx, dtype=float)
    m = ab.monthly(s, min_obs=8)
    assert np.isnan(m[P("2024-01")]) and np.isnan(m[P("2024-02")]) and not np.isnan(m[P("2024-03")])


def test_seasonal_demeaning_uses_only_the_discovery_window():
    s = months("2000-01", [10, 20] * 12 + [100, 200] * 6)   # regime shift after 2 years
    t = ab.transforms(s, discovery_end=P("2001-12"))
    # January mean over discovery = 10 → first January residual is 0, later ones are +90
    assert t["sa"].iloc[0] == pytest.approx(0) and t["sa"].iloc[24] == pytest.approx(90)


# ── inference ─────────────────────────────────────────────────────────────────

def test_bh_fdr_is_monotone_and_bounded():
    p = pd.Series([0.001, 0.01, 0.04, 0.2, 0.5, np.nan])
    q = st.bh_fdr(p)
    assert q.iloc[0] < q.iloc[1] <= q.iloc[2] <= q.iloc[3] <= q.iloc[4] <= 1 and np.isnan(q.iloc[5])
    assert q.iloc[0] == pytest.approx(0.005)      # 0.001 × 5 / 1


def test_effective_n_shrinks_for_persistent_series():
    rng = np.random.default_rng(0)
    white = rng.normal(size=400)
    ar = np.zeros(400)
    for i in range(1, 400):
        ar[i] = 0.9 * ar[i - 1] + rng.normal()
    assert st.effective_n(white, white) > 300
    assert st.effective_n(ar, ar) < 80


def test_phase_randomisation_keeps_the_spectrum():
    rng = np.random.default_rng(1)
    a = np.cumsum(rng.normal(size=256))
    s = st.phase_randomise(a, rng)
    assert np.allclose(np.abs(np.fft.rfft(a - a.mean()))[1:], np.abs(np.fft.rfft(s - s.mean()))[1:], rtol=1e-6)
    assert st.acf(s, 1)[1] > 0.9      # still a random walk


def test_ccf_lag_sign_means_x_leads():
    idx = pd.period_range("2000-01", periods=200, freq="M")
    rng = np.random.default_rng(2)
    x = pd.Series(rng.normal(size=200), index=idx)
    y = x.shift(3) + 0.1 * pd.Series(rng.normal(size=200), index=idx)   # y_t = x_{t-3}
    c = st.ccf(x, y, range(-6, 7))
    best = c.loc[c["pearson"].abs().idxmax(), "lag"]
    assert best == 3


def test_max_abs_r_test_is_not_fooled_by_search():
    idx = pd.period_range("1990-01", periods=300, freq="M")
    rng = np.random.default_rng(4)
    x = pd.Series(rng.normal(size=300), index=idx).rolling(6).mean()
    y = pd.Series(rng.normal(size=300), index=idx).rolling(6).mean()   # unrelated, both smooth
    out = st.surrogate_ccf(x, y, range(-12, 13), n_sur=300)
    assert out["p_max"] > 0.05        # the best of 25 lags is not "significant"


# ── event study ───────────────────────────────────────────────────────────────

def test_event_paths_are_changes_from_onset_with_pre_level():
    arb = months("2000-01", range(30))
    paths = ev.event_paths(arb, [P("2000-06")], horizons=[0, 3, 12], pre_months=3)
    assert paths.loc[P("2000-06"), 3] == 3 and paths.loc[P("2000-06"), 12] == 12
    assert paths.loc[P("2000-06"), "pre_level"] == pytest.approx(np.mean([4, 3, 2]))


def test_summary_consistency_counts_agreement_with_the_mean():
    paths = pd.DataFrame({3: [1.0, 2.0, -0.5, 4.0]})
    s = ev.summarise_paths(paths, horizons=[3])
    assert s.iloc[0]["n"] == 4 and s.iloc[0]["consistency"] == 0.75


def test_event_table_has_one_row_per_episode():
    arb = months("2000-01", range(40))
    eps = [{"phase": "el_nino", "onset": P("2000-04"), "end": P("2000-10"), "n_months": 7, "peak": 1.2, "peak_month": P("2000-08")}]
    t = ev.event_table(arb, eps, horizons=[3, 6])
    assert len(t) == 1 and t.iloc[0]["chg_6m"] == 6 and t.iloc[0]["phase"] == "el_nino"
