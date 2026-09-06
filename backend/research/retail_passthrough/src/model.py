"""Pass-through econometrics: how much of a green move reaches the shelf, and when.

Four questions, four tools, in the order the report asks them.

TIMING       A lag scan on monthly log-changes, with the ENSO study's
             phase-randomised surrogate test so the peak cannot be data-mined.
             Reported as the contiguous BAND that clears the surrogate band, not
             as the single largest r — a plateau read as a spike is false
             precision, and the difference matters when the answer is being
             quoted as "the shelf moves five months later".

MAGNITUDE    An error-correction model, because "how much survives" and "how
             fast" are two coefficients and a single regression conflates them:

               long run   ln R_t = μ + θ ln G_t + u_t
               short run  Δln R_t = α + Σᵢ βᵢ Δln G_{t−i} + γ û_{t−1} + ε_t

             θ is the long-run elasticity, β₀ the impact effect, γ the speed at
             which the gap closes (γ < 0, half-life = ln½ / ln(1+γ)). A slope
             fitted on 12-month changes — the shape IMP-004 used — is a blend of
             all three and cannot separate "little arrives" from "it all
             arrives, slowly".

             The level regression is only meaningful if the two series are
             cointegrated; if they are not, θ is a spurious-regression artifact.
             `engle_granger` tests that first and the report leads with the
             answer either way.

THE ANCHOR   Under COMPLETE long-run pass-through, θ is not "the fraction that
             survives" — it IS the green cost share of the retail price, because
             d ln R / d ln G = (∂R/∂G)(G/R) and ∂R/∂G is the green needed per
             unit sold. So θ implies a retail price level given a green price,
             and that level can be checked against reality. `implied_retail`
             does the inversion; it is the study's sharpest falsification and
             needs no data the repo lacks.

ASYMMETRY    The standard rockets-and-feathers specification splits BOTH the
             short-run terms and the error correction by sign:

               Δln R = α + Σ β⁺ᵢ Δln G⁺ + Σ β⁻ᵢ Δln G⁻ + γ⁺ û⁺ + γ⁻ û⁻ + ε

             and tests β⁺ = β⁻ and γ⁺ = γ⁻. Splitting a sample on the sign of a
             12-month change instead — IMP-004's method — throws away the
             within-window variation and tests a different, weaker claim.

Everything is HAC (Newey–West); overlapping windows and a persistent dependent
variable make OLS standard errors meaningless here, and `stats.effective_n`
from the ENSO package is reported beside every n so the reader can see how few
independent observations a long monthly series really carries.
"""
from __future__ import annotations

import sys

import numpy as np
import pandas as pd
import statsmodels.api as sm

from .paths import BACKEND

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
# The inference toolkit is house-standard — built and tested for the ENSO study,
# reused verbatim rather than reimplemented.
from research.enso_arbitrage.src import stats as st  # noqa: E402

MAX_LAG = 24
DEFAULT_SR_LAGS = 12


def _hac(y: pd.Series, X: pd.DataFrame, maxlags: int | None = None):
    d = pd.concat([y.rename("__y"), X], axis=1).dropna()
    if len(d) < X.shape[1] + 8:
        return None
    if maxlags is None:
        maxlags = int(np.floor(1.3 * len(d) ** 0.5))
    return sm.OLS(d["__y"], sm.add_constant(d.drop(columns="__y"))).fit(
        cov_type="HAC", cov_kwds={"maxlags": maxlags})


def _aligned(lg: pd.Series, lr: pd.Series) -> pd.DataFrame:
    """The two log series on ONE gap-free monthly grid, holes kept as NaN.

    `dropna()` before `diff()` is a silent trap: it closes the hole, and the
    first observation after it is then differenced against a value two months
    back as if it were one. The US CPI has exactly such a hole — 2025-10, in the
    middle of the largest green move in the sample — and bridging it moves the
    correlation peak by a whole month. So: intersect, then reindex onto the
    complete period range, so a missing month stays missing and every routine
    downstream drops it instead of inventing a two-month change.
    """
    d = pd.concat([lg.rename("g"), lr.rename("r")], axis=1).dropna()
    if d.empty:
        return d
    return d.reindex(pd.period_range(d.index.min(), d.index.max(), freq="M"))


def _half_life(gamma: float) -> float | None:
    """Months for half the gap to close at an adjustment speed γ (γ < 0)."""
    return float(np.log(0.5) / np.log(1 + gamma)) if -1 < gamma < 0 else None


def _shift(s: pd.Series, k: int, name: str) -> pd.Series:
    o = s.copy()
    o.index = o.index + k
    return o.rename(name)


# ── timing ───────────────────────────────────────────────────────────────────

def lag_profile(dg: pd.Series, dr: pd.Series, max_lag: int = MAX_LAG, n_sur: int = 2000) -> pd.DataFrame:
    """r between Δln green(t−k) and Δln retail(t) for k = 0…max_lag, with the
    surrogate band and both p-values at every lag."""
    lags = range(0, max_lag + 1)
    c = st.ccf(dg, dr, lags)
    sur = st.surrogate_ccf(dg, dr, lags, n_sur=n_sur)
    out = c.merge(sur["per_lag"][["lag", "p_surrogate", "sur_q95_abs"]], on="lag", how="left")
    out["q_bh"] = st.bh_fdr(out["p_bartlett"])
    out.attrs["p_max_surrogate"] = sur["p_max"]
    out.attrs["best_lag"] = sur["best_lag"]
    out.attrs["max_abs_r"] = sur["max_abs_r_obs"]
    return out


def plateau(prof: pd.DataFrame, frac: float = 0.90) -> dict:
    """The contiguous band of lags whose |r| is within `frac` of the maximum, and
    which also clear the surrogate 95 % band.

    This is the honest form of "the lag": a peak at 5 flanked by 3, 4, 6 and 7
    that are statistically indistinguishable from it is a band, and quoting the
    argmax alone invents a precision the data does not carry.
    """
    v = prof.dropna(subset=["pearson"])
    if v.empty:
        return {"peak_lag": None}
    peak = v.loc[v["pearson"].abs().idxmax()]
    thr = abs(peak["pearson"]) * frac
    inside = v[(v["pearson"].abs() >= thr) & (v["pearson"].abs() > v["sur_q95_abs"].fillna(np.inf))]
    if inside.empty:
        inside = v[v["pearson"].abs() >= thr]
    lo, hi = _run_around(sorted(inside["lag"].tolist()), int(peak["lag"]))
    sig = v[v["pearson"].abs() > v["sur_q95_abs"].fillna(np.inf)]
    slo, shi = _run_around(sorted(sig["lag"].tolist()), int(peak["lag"]))
    return {"peak_lag": int(peak["lag"]), "peak_r": float(peak["pearson"]),
            "band_lo": lo, "band_hi": hi, "band_width": hi - lo + 1,
            "sig_band_lo": slo, "sig_band_hi": shi, "sig_band_width": shi - slo + 1,
            "p_bartlett_at_peak": float(peak["p_bartlett"]), "q_bh_at_peak": float(peak["q_bh"]),
            "p_max_surrogate": prof.attrs.get("p_max_surrogate"),
            "n_lags_over_surrogate_band": int((v["pearson"].abs() > v["sur_q95_abs"]).sum())}


def _run_around(lags: list[int], peak: int) -> tuple[int, int]:
    """The contiguous run of `lags` containing `peak`."""
    s = set(lags)
    lo = hi = peak
    while lo - 1 in s:
        lo -= 1
    while hi + 1 in s:
        hi += 1
    return lo, hi


# ── magnitude ────────────────────────────────────────────────────────────────

def engle_granger(lg: pd.Series, lr: pd.Series) -> dict:
    """Are the two log levels cointegrated? If not, the long-run regression below
    is a spurious-regression artifact and must be labelled as one."""
    from statsmodels.tsa.stattools import adfuller, coint
    # Levels only, so the gap-free grid buys nothing here: the unit-root tests
    # take a contiguous vector and the missing month is simply not observed.
    d = _aligned(lg, lr).dropna()
    if len(d) < 30:
        return {"n": len(d)}
    t, p, crit = coint(d["r"], d["g"], trend="c", autolag="AIC")
    lr_fit = sm.OLS(d["r"], sm.add_constant(d["g"])).fit()
    resid_adf = adfuller(lr_fit.resid, autolag="AIC")
    return {"n": int(len(d)), "eg_stat": float(t), "eg_p": float(p),
            "eg_crit_5pct": float(crit[1]), "cointegrated_5pct": bool(p < 0.05),
            "resid_adf_p": float(resid_adf[1]),
            "theta_static": float(lr_fit.params.iloc[1]), "mu_static": float(lr_fit.params.iloc[0])}


def ecm(lg: pd.Series, lr: pd.Series, sr_lags: int = DEFAULT_SR_LAGS) -> dict:
    """Two-step error-correction estimate of pass-through.

    Returns the long-run elasticity θ, the impact effect β₀, the cumulative
    short-run pass-through after 3/6/12 months, the adjustment speed γ and its
    half-life, each with HAC inference and an effective sample size.
    """
    d = _aligned(lg, lr)
    obs = d.dropna()
    if len(obs) < sr_lags + 24:
        return {"n": len(obs), "ok": False}
    # step 1 — the long-run relationship, on the months that exist
    step1 = sm.OLS(obs["r"], sm.add_constant(obs["g"])).fit()
    theta = float(step1.params.iloc[1])
    # …put back on the gap-free grid so the differences below cannot bridge a hole
    resid = pd.Series(step1.resid, index=obs.index).reindex(d.index)
    dg, dr = d["g"].diff(), d["r"].diff()
    X = pd.concat([_shift(dg, k, f"dg_l{k}") for k in range(sr_lags + 1)]
                  + [_shift(resid, 1, "ecm_lag1"), _shift(dr, 1, "dr_lag1")], axis=1)
    step2 = _hac(dr, X, maxlags=max(sr_lags, 12))
    if step2 is None:
        return {"n": len(obs), "ok": False}
    betas = {k: float(step2.params[f"dg_l{k}"]) for k in range(sr_lags + 1)}
    horizons = sorted({h for h in (0, 2, 5, 11) if h <= sr_lags} | {sr_lags})
    cum = {h: float(sum(betas[k] for k in range(0, h + 1))) for h in horizons}
    gamma = float(step2.params["ecm_lag1"])
    half = _half_life(gamma)
    a, b = obs["g"].to_numpy(), obs["r"].to_numpy()
    return {
        "ok": True, "n": int(len(obs)), "n_eff": float(st.effective_n(a, b)),
        "theta_long_run": theta,
        "theta_se_hac": float(sm.OLS(obs["r"], sm.add_constant(obs["g"])).fit(
            cov_type="HAC", cov_kwds={"maxlags": 18}).bse.iloc[1]),
        "beta_impact": betas[0], "beta_impact_p": float(step2.pvalues["dg_l0"]),
        "cum_passthrough": cum,
        "gamma": gamma, "gamma_p": float(step2.pvalues["ecm_lag1"]),
        "half_life_months": half,
        "sr_lags": sr_lags, "r2_step2": float(step2.rsquared),
        "betas": betas,
        "beta_p": {k: float(step2.pvalues[f"dg_l{k}"]) for k in range(sr_lags + 1)},
    }


def overlapping_slope(lg: pd.Series, lr: pd.Series, window: int = 12, lag: int = 5) -> dict:
    """The regression IMP-004 ran — 12-month change on 12-month change — kept so
    the report can show what it says AND what it is worth. The n it reports is
    ~14× its effective sample because the windows overlap."""
    d = _aligned(lg, lr)
    g, r = d["g"].diff(window), d["r"].diff(window)
    X = _shift(g, lag, "g").to_frame()
    fit = _hac(r, X, maxlags=window + 6)
    if fit is None:
        return {"ok": False}
    used = pd.concat([X, r], axis=1).dropna()
    return {"ok": True, "slope": float(fit.params["g"]), "p_hac": float(fit.pvalues["g"]),
            "se_hac": float(fit.bse["g"]), "ci_lo": float(fit.conf_int().loc["g", 0]),
            "ci_hi": float(fit.conf_int().loc["g", 1]),
            "n": int(fit.nobs), "n_eff": float(st.effective_n(used.iloc[:, 0].to_numpy(), used.iloc[:, 1].to_numpy())),
            "r2": float(fit.rsquared), "window": window, "lag": lag}


# ── the anchor ───────────────────────────────────────────────────────────────

def implied_retail(theta: float, green_usd_t: float, roast_yield: float = 0.84) -> dict:
    """Invert the identity: what retail price per kilo does θ imply?

    Under complete long-run pass-through θ equals the green cost share, so
    retail = (green cost per roasted kg) / θ. A θ far below the true cost share
    therefore implies an impossibly HIGH retail price — which is how a reader
    with no price series can still falsify "pass-through is complete".
    """
    g_kg = green_usd_t / 1000.0 / roast_yield
    return {"green_usd_per_kg_roasted_equiv": g_kg, "theta": theta,
            "implied_retail_usd_per_kg": (g_kg / theta) if theta else None,
            "reading": "under COMPLETE pass-through θ IS the green cost share, so this is the "
                       "retail price θ implies. Compare it with a real shelf price: if the real "
                       "price is lower, the green share is bigger than θ and pass-through is "
                       "incomplete by the difference."}


def cost_share_at(green_usd_t: float, retail_usd_per_kg: float, roast_yield: float = 0.84) -> float:
    """Green cost share of a retail kilo, for any assumed shelf price."""
    return (green_usd_t / 1000.0 / roast_yield) / retail_usd_per_kg


def dollar_episode(green_kg: pd.Series, retail_index: pd.Series, start, end) -> dict:
    """The falsification that needs no shelf price at all.

    Over a window the green bill per roasted kilo rose by a KNOWN number of
    dollars, Δ$. The retail index rose by a known FACTOR f. For the shelf to
    have passed the whole increase through, the base-date shelf price P₀ must
    satisfy P₀(f − 1) ≥ Δ$ — so

        P₀_min = Δ$ / (f − 1)

    is the smallest base shelf price consistent with complete pass-through.
    Equivalently, dividing by the base green cost, complete pass-through needs
    only that green was less than

        share_max = G₀ / P₀_min = G₀ (f − 1) / Δ$

    of the base shelf price. That form closes the loop entirely inside the
    repo: it converts an unobserved price into a bound on a share, and a share
    has a ceiling of 1 whatever the shelf price was.
    """
    g0, g1 = float(green_kg.loc[start]), float(green_kg.loc[end])
    r0, r1 = float(retail_index.loc[start]), float(retail_index.loc[end])
    f = r1 / r0
    d_green = g1 - g0
    live = f > 1 and d_green > 0
    p_min = (d_green / (f - 1)) if live else None
    return {"start": str(start), "end": str(end), "months": int((pd.Period(end, "M") - pd.Period(start, "M")).n),
            "green_kg_start": g0, "green_kg_end": g1, "green_delta_usd_per_kg": d_green,
            "retail_index_start": r0, "retail_index_end": r1, "retail_factor": f,
            "retail_pct": (f - 1) * 100.0,
            "min_base_retail_usd_per_kg": p_min,
            "min_base_retail_usd_per_lb": (p_min / 2.20462) if live else None,
            "cost_share_break_even": (g0 / p_min) if live else None}


def cost_share_grid(green_usd_t: float, prices_usd_per_kg, theta: float,
                    roast_yield: float = 0.84) -> pd.DataFrame:
    """The denominator, tabulated. For each assumed shelf price: the green cost
    share it implies, and θ read against it as a pass-through rate.

    The reader picks the row matching the price they actually pay; the study
    does not have to assert one. A row where θ / share > 1 is over-shooting;
    below 1 is the fraction of a green move that survives to the shelf.
    """
    rows = []
    for p in prices_usd_per_kg:
        share = cost_share_at(green_usd_t, p, roast_yield)
        rows.append({"retail_usd_per_kg": float(p), "retail_usd_per_lb": float(p) / 2.20462,
                     "green_cost_share": share, "theta": theta,
                     "passthrough_rate": theta / share if share else None})
    return pd.DataFrame(rows)


# ── asymmetry ────────────────────────────────────────────────────────────────

def asymmetric_ecm(lg: pd.Series, lr: pd.Series, sr_lags: int = 6) -> dict:
    """Rockets and feathers, done as the literature does it.

    Both the short-run terms and the error correction are split by sign, and the
    two equalities are tested with HAC Wald tests: β⁺ = β⁻ (does a rise pass
    faster than a fall?) and γ⁺ = γ⁻ (is a shelf price ABOVE its long-run level
    corrected more slowly than one below?).
    """
    d = _aligned(lg, lr)
    obs = d.dropna()
    if len(obs) < sr_lags + 30:
        return {"ok": False, "n": len(obs)}
    step1 = sm.OLS(obs["r"], sm.add_constant(obs["g"])).fit()
    resid = pd.Series(step1.resid, index=obs.index).reindex(d.index)
    dg, dr = d["g"].diff(), d["r"].diff()
    up, dn = dg.clip(lower=0), dg.clip(upper=0)
    cols = [_shift(up, k, f"up_l{k}") for k in range(sr_lags + 1)] \
        + [_shift(dn, k, f"dn_l{k}") for k in range(sr_lags + 1)] \
        + [_shift(resid.clip(lower=0), 1, "ecm_pos"), _shift(resid.clip(upper=0), 1, "ecm_neg"),
           _shift(dr, 1, "dr_lag1")]
    fit = _hac(dr, pd.concat(cols, axis=1), maxlags=max(sr_lags, 12))
    if fit is None:
        return {"ok": False, "n": len(obs)}
    up_names = [f"up_l{k}" for k in range(sr_lags + 1)]
    dn_names = [f"dn_l{k}" for k in range(sr_lags + 1)]
    cum_up = float(sum(fit.params[n] for n in up_names))
    cum_dn = float(sum(fit.params[n] for n in dn_names))
    # Wald: are the cumulative short-run responses equal?
    r_sr = " + ".join(up_names) + " = " + " + ".join(dn_names)
    w_sr = fit.f_test(r_sr)
    w_ec = fit.f_test("ecm_pos = ecm_neg")
    return {"ok": True, "n": int(fit.nobs), "sr_lags": sr_lags,
            "cum_up": cum_up, "cum_down": cum_dn, "cum_gap": cum_up - cum_dn,
            "p_equal_shortrun": float(np.ravel(w_sr.pvalue)[0]),
            "gamma_pos": float(fit.params["ecm_pos"]), "gamma_neg": float(fit.params["ecm_neg"]),
            "gamma_pos_p": float(fit.pvalues["ecm_pos"]), "gamma_neg_p": float(fit.pvalues["ecm_neg"]),
            "gamma_pos_se": float(fit.bse["ecm_pos"]), "gamma_neg_se": float(fit.bse["ecm_neg"]),
            "half_life_pos": _half_life(float(fit.params["ecm_pos"])),
            "half_life_neg": _half_life(float(fit.params["ecm_neg"])),
            "p_equal_correction": float(np.ravel(w_ec.pvalue)[0]),
            "verdict": "asymmetric" if min(float(np.ravel(w_sr.pvalue)[0]),
                                          float(np.ravel(w_ec.pvalue)[0])) < 0.05 else "not established"}


def asymmetry_bootstrap_p(lg: pd.Series, lr: pd.Series, sr_lags: int = 6, n_boot: int = 500,
                          block: int = 12, seed: int = 0) -> dict:
    """Size-corrected p-values for the two asymmetry tests.

    The HAC Wald test over-rejects here — on symmetric synthetic data built the
    way this study's own test suite builds it, a nominal 5 % test fires about
    10 % of the time and a nominal 1 % about 3 %. Quoting the asymptotic p-value
    alone would therefore overstate the evidence, so the null is simulated.

    The null DGP is the SYMMETRIC error-correction model fitted to the data, run
    forward recursively on the real green series with its own residuals
    resampled in moving blocks (blocks, not draws, so the residuals keep their
    own serial correlation). γ is clipped to (−1, 0] because a null with a
    non-correcting or explosive root is not the null anyone means by
    "symmetric adjustment", and imposing it is the conservative choice: it makes
    the simulated shelf price MORE willing to come back down, which is exactly
    the behaviour the observed data are being tested against.

    Returns the fraction of null replications whose Wald statistic reaches the
    observed one — a p-value that is correct by construction whatever the
    asymptotics do.
    """
    obs = asymmetric_ecm(lg, lr, sr_lags=sr_lags)
    if not obs.get("ok"):
        return {"ok": False}
    d = _aligned(lg, lr)
    present = d["r"].notna().to_numpy()
    obs_lvl = d.dropna()
    step1 = sm.OLS(obs_lvl["r"], sm.add_constant(obs_lvl["g"])).fit()
    mu, theta = float(step1.params.iloc[0]), float(step1.params.iloc[1])
    resid = pd.Series(step1.resid, index=obs_lvl.index).reindex(d.index)
    dg, dr = d["g"].diff(), d["r"].diff()
    X = pd.concat([_shift(dg, k, f"dg_l{k}") for k in range(sr_lags + 1)]
                  + [_shift(resid, 1, "ecm_lag1"), _shift(dr, 1, "dr_lag1")], axis=1)
    fit = _hac(dr, X, maxlags=max(sr_lags, 12))
    if fit is None:
        return {"ok": False}
    betas = np.array([fit.params[f"dg_l{k}"] for k in range(sr_lags + 1)])
    alpha, gamma, phi = float(fit.params["const"]), float(fit.params["ecm_lag1"]), float(fit.params["dr_lag1"])
    gamma = min(max(gamma, -0.99), 0.0)
    eps = np.asarray(fit.resid, dtype=float)
    g_arr, r_arr = d["g"].to_numpy(float), d["r"].to_numpy(float)
    n, rng = len(g_arr), np.random.default_rng(seed)
    # The recursion needs a seed value at every step, so it runs on a green
    # series interpolated over any hole; the SIMULATED retail path is then
    # re-holed to match the observed missing months, so each null replication
    # faces exactly the same gaps the real estimate did.
    g_arr = pd.Series(g_arr).interpolate(limit_direction="both").to_numpy()
    r_arr = pd.Series(r_arr).interpolate(limit_direction="both").to_numpy()
    start = sr_lags + 2                       # first t with a full set of regressors
    obs_stats = (obs["p_equal_shortrun"], obs["p_equal_correction"])
    hits = [0, 0]
    done = 0
    for _ in range(n_boot):
        e = _block_resample(eps, n, block, rng)
        r_sim = r_arr.copy()
        for t in range(start, n):
            dg_terms = float(np.dot(betas, [g_arr[t - k] - g_arr[t - k - 1] for k in range(sr_lags + 1)]))
            ec = r_sim[t - 1] - mu - theta * g_arr[t - 1]
            r_sim[t] = r_sim[t - 1] + alpha + dg_terms + gamma * ec + phi * (r_sim[t - 1] - r_sim[t - 2]) + e[t]
        r_sim[~present] = np.nan
        sim = asymmetric_ecm(d["g"], pd.Series(r_sim, index=d.index), sr_lags=sr_lags)
        if not sim.get("ok"):
            continue
        done += 1
        hits[0] += sim["p_equal_shortrun"] <= obs_stats[0]
        hits[1] += sim["p_equal_correction"] <= obs_stats[1]
    if not done:
        return {"ok": False}
    p_sr = (hits[0] + 1) / (done + 1)
    p_ec = (hits[1] + 1) / (done + 1)
    return {"ok": True, "n_boot": done, "block": block,
            "p_equal_shortrun_asymptotic": obs_stats[0], "p_equal_shortrun_bootstrap": p_sr,
            "p_equal_correction_asymptotic": obs_stats[1], "p_equal_correction_bootstrap": p_ec,
            "gamma_null_used": gamma,
            "verdict": "asymmetric" if min(p_sr, p_ec) < 0.05 else "not established"}


def _block_resample(x: np.ndarray, n: int, block: int, rng) -> np.ndarray:
    """Moving-block resample of `x` to length `n`, keeping within-block order."""
    out = np.empty(n)
    i = 0
    while i < n:
        s = rng.integers(0, max(len(x) - block, 1))
        take = min(block, n - i)
        out[i:i + take] = x[s:s + take]
        i += take
    return out


def sign_split_slope(lg: pd.Series, lr: pd.Series, window: int = 12, lag: int = 5) -> dict:
    """IMP-004's asymmetry method — split the sample on the sign of the green
    move — plus the interaction test it omitted. Kept to show the difference
    between 'two slopes look different' and 'the difference is significant'."""
    a = _aligned(lg, lr)
    g, r = a["g"].diff(window), a["r"].diff(window)
    gs = _shift(g, lag, "g")
    d = pd.concat([gs, r.rename("r")], axis=1).dropna()
    up = (d["g"] > 0).astype(float)
    X = pd.DataFrame({"g": d["g"], "g_up": d["g"] * up, "up": up})
    fit = _hac(d["r"], X, maxlags=window + 6)
    if fit is None:
        return {"ok": False}
    su = _hac(d.loc[up == 1, "r"], d.loc[up == 1, ["g"]], maxlags=window + 6)
    sd = _hac(d.loc[up == 0, "r"], d.loc[up == 0, ["g"]], maxlags=window + 6)
    return {"ok": True, "slope_up": float(su.params["g"]) if su is not None else None,
            "n_up": int(su.nobs) if su is not None else 0,
            "slope_down": float(sd.params["g"]) if sd is not None else None,
            "n_down": int(sd.nobs) if sd is not None else 0,
            "interaction": float(fit.params["g_up"]), "interaction_p": float(fit.pvalues["g_up"]),
            "verdict": "asymmetric" if fit.pvalues["g_up"] < 0.05 else "not established"}


# ── the quantity leg ─────────────────────────────────────────────────────────

def demand_response(l_price: pd.Series, l_volume: pd.Series, max_lag: int = 12) -> dict:
    """Does the shelf price move volume? Δln volume on Δln price at 0…max_lag,
    with a seasonal control — coffee clearances have a hard December."""
    dv, dp = l_volume.diff(), l_price.diff()
    rows = []
    for k in range(max_lag + 1):
        X = pd.concat([_shift(dp, k, "dp")], axis=1)
        m = pd.get_dummies(pd.Series(dv.index.month, index=dv.index), prefix="m", drop_first=True).astype(float)
        fit = _hac(dv, pd.concat([X, m], axis=1), maxlags=12)
        if fit is None:
            continue
        rows.append({"lag": k, "elasticity": float(fit.params["dp"]), "se_hac": float(fit.bse["dp"]),
                     "p": float(fit.pvalues["dp"]), "n": int(fit.nobs)})
    df = pd.DataFrame(rows)
    if df.empty:
        return {"ok": False}
    best = df.loc[df["elasticity"].abs().idxmax()]
    return {"ok": True, "by_lag": df.to_dict("records"), "best_lag": int(best["lag"]),
            "best_elasticity": float(best["elasticity"]), "best_p": float(best["p"]),
            "n_sig_05": int((df["p"] < 0.05).sum()), "n_lags_tested": len(df)}
