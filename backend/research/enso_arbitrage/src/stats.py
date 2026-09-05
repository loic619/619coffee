"""Inference that does not pretend two persistent monthly series are iid draws.

Three nulls, used together:

  Bartlett        SE of r inflated by the two series' own autocorrelations —
                  the classic fix, and the source of the "effective N" numbers.
  block bootstrap CI on r at a chosen lag, resampling 12-month blocks so the
                  within-year dependence survives.
  phase-randomised surrogates
                  Each surrogate keeps the series' full power spectrum (hence
                  its autocorrelation at every lag) and randomises only the
                  phases, which destroys any cross-relationship. The r one
                  gets between a surrogate and the other series is what
                  "correlation between two persistent series with NO link"
                  looks like. Also yields the max-|r|-across-lags distribution,
                  which is the honest test for "does the best lag survive" —
                  the lag is chosen by the same search the surrogates go through.

Sign convention: lag k > 0 means ENSO(t−k) against arbitrage(t) — ENSO leads.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sps

# ── helpers ───────────────────────────────────────────────────────────────────

def _align(x: pd.Series, y: pd.Series, lag: int) -> tuple[np.ndarray, np.ndarray]:
    """x shifted forward by `lag` months against y: pairs (x_{t-lag}, y_t)."""
    xs = x.copy()
    xs.index = xs.index + lag
    df = pd.concat([xs.rename("x"), y.rename("y")], axis=1).dropna()
    return df["x"].to_numpy(float), df["y"].to_numpy(float)


def acf(a: np.ndarray, max_lag: int) -> np.ndarray:
    a = a - a.mean()
    denom = (a * a).sum()
    if denom == 0:
        return np.zeros(max_lag + 1)
    return np.array([1.0] + [(a[k:] * a[:-k]).sum() / denom for k in range(1, max_lag + 1)])


def effective_n(a: np.ndarray, b: np.ndarray, max_lag: int | None = None) -> float:
    """Bartlett's effective sample size: N / (1 + 2 Σ ρ_a(k) ρ_b(k))."""
    n = len(a)
    if n < 4:
        return float(n)
    K = max_lag or min(n // 4, 24)
    ra, rb = acf(a, K), acf(b, K)
    denom = 1 + 2 * float(np.sum(ra[1:] * rb[1:]))
    return float(n / max(denom, 1e-9))


def bartlett_test(r: float, n_eff: float) -> tuple[float, float, float]:
    """(p, ci_lo, ci_hi) for r using Fisher z with the effective N."""
    if n_eff <= 3 or abs(r) >= 1:
        return float("nan"), float("nan"), float("nan")
    z = np.arctanh(r)
    se = 1 / np.sqrt(n_eff - 3)
    p = 2 * (1 - sps.norm.cdf(abs(z) / se))
    return float(p), float(np.tanh(z - 1.96 * se)), float(np.tanh(z + 1.96 * se))


# ── cross-correlation over lags ───────────────────────────────────────────────

def ccf(x: pd.Series, y: pd.Series, lags: range = range(-24, 25), min_n: int = 24) -> pd.DataFrame:
    """Pearson and Spearman at every lag with Bartlett-corrected inference."""
    rows = []
    for k in lags:
        a, b = _align(x, y, k)
        if len(a) < min_n:
            rows.append({"lag": k, "n": len(a)})
            continue
        r = float(np.corrcoef(a, b)[0, 1])
        rho = float(sps.spearmanr(a, b).statistic)
        ne = effective_n(a, b)
        p, lo, hi = bartlett_test(r, ne)
        rows.append({"lag": k, "n": len(a), "n_eff": round(ne, 1), "pearson": r, "spearman": rho,
                     "p_bartlett": p, "ci_lo": lo, "ci_hi": hi})
    return pd.DataFrame(rows)


# ── surrogates ────────────────────────────────────────────────────────────────

def phase_randomise(a: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A surrogate with the same power spectrum and random Fourier phases."""
    n = len(a)
    f = np.fft.rfft(a - a.mean())
    ph = rng.uniform(0, 2 * np.pi, len(f))
    ph[0] = 0
    if n % 2 == 0:
        ph[-1] = 0
    sur = np.fft.irfft(np.abs(f) * np.exp(1j * ph), n=n)
    return sur + a.mean()


def surrogate_ccf(x: pd.Series, y: pd.Series, lags: range = range(-24, 25), n_sur: int = 2000,
                  seed: int = 7, min_n: int = 24) -> dict:
    """Per-lag surrogate p-values and the family-wise max-|r| test.

    The surrogate is drawn on the FULL x series once, then correlated with y at
    every lag, so each surrogate goes through the identical 49-lag search the
    real series did. Returns:
      per_lag   DataFrame(lag, r_obs, p_surrogate, sur_q95)
      max_abs_r_obs, p_max (share of surrogates whose best |r| ≥ the observed best),
      best_lag
    """
    rng = np.random.default_rng(seed)
    xv = x.dropna()
    obs = []
    aligned = {}
    for k in lags:
        a, b = _align(xv, y, k)
        aligned[k] = (a, b)
        obs.append(float(np.corrcoef(a, b)[0, 1]) if len(a) >= min_n else np.nan)
    obs = np.array(obs)
    # surrogate x on its own full index; realign per lag through the same indices
    xs_full = xv.to_numpy(float)
    sur_r = np.full((n_sur, len(list(lags))), np.nan)
    idx_full = xv.index
    for s in range(n_sur):
        sur = pd.Series(phase_randomise(xs_full, rng), index=idx_full)
        for j, k in enumerate(lags):
            a, b = _align(sur, y, k)
            if len(a) >= min_n:
                sur_r[s, j] = np.corrcoef(a, b)[0, 1]
    per = []
    for j, k in enumerate(lags):
        col = sur_r[:, j]
        col = col[~np.isnan(col)]
        if np.isnan(obs[j]) or len(col) == 0:
            per.append({"lag": k, "r_obs": obs[j], "p_surrogate": np.nan, "sur_q95_abs": np.nan})
            continue
        p = float((np.abs(col) >= abs(obs[j])).mean())
        per.append({"lag": k, "r_obs": obs[j], "p_surrogate": p, "sur_q95_abs": float(np.quantile(np.abs(col), 0.95))})
    per = pd.DataFrame(per)
    valid = ~np.isnan(obs)
    if valid.any():
        best_j = int(np.nanargmax(np.abs(obs)))
        max_obs = float(abs(obs[best_j]))
        sur_max = np.nanmax(np.abs(sur_r), axis=1)
        p_max = float((sur_max >= max_obs).mean())
        best_lag = list(lags)[best_j]
    else:
        max_obs, p_max, best_lag = np.nan, np.nan, None
    return {"per_lag": per, "max_abs_r_obs": max_obs, "p_max": p_max, "best_lag": best_lag,
            "sur_max_q95": float(np.nanquantile(np.nanmax(np.abs(sur_r), axis=1), 0.95))}


def block_bootstrap_ci(x: pd.Series, y: pd.Series, lag: int, n_boot: int = 2000, block: int = 12,
                       seed: int = 11) -> tuple[float, float, float]:
    """(r, lo, hi): 95 % CI on r at one lag by moving-block bootstrap of the aligned pairs."""
    a, b = _align(x, y, lag)
    n = len(a)
    if n < block * 2:
        return float("nan"), float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    r0 = float(np.corrcoef(a, b)[0, 1])
    starts_max = n - block
    nb = int(np.ceil(n / block))
    rs = []
    for _ in range(n_boot):
        st = rng.integers(0, starts_max + 1, nb)
        ii = np.concatenate([np.arange(s, s + block) for s in st])[:n]
        aa, bb = a[ii], b[ii]
        if aa.std() == 0 or bb.std() == 0:
            continue
        rs.append(np.corrcoef(aa, bb)[0, 1])
    rs = np.array(rs)
    return r0, float(np.quantile(rs, 0.025)), float(np.quantile(rs, 0.975))


# ── multiple testing ──────────────────────────────────────────────────────────

def bh_fdr(p: pd.Series) -> pd.Series:
    """Benjamini–Hochberg adjusted p-values (monotone), NaNs left NaN."""
    s = p.dropna()
    m = len(s)
    if m == 0:
        return p.copy()
    order = s.sort_values()
    ranks = np.arange(1, m + 1)
    adj = order.values * m / ranks
    adj = np.minimum.accumulate(adj[::-1])[::-1]
    adj = np.minimum(adj, 1.0)
    out = pd.Series(adj, index=order.index)
    return out.reindex(p.index)


# ── regression ────────────────────────────────────────────────────────────────

def newey_west_ols(y: pd.Series, X: pd.DataFrame, maxlags: int | None = None):
    """OLS with HAC (Newey–West) standard errors. Returns the statsmodels results."""
    import statsmodels.api as sm
    df = pd.concat([y.rename("y"), X], axis=1).dropna()
    if len(df) < X.shape[1] + 5:
        return None
    if maxlags is None:
        maxlags = int(np.floor(1.3 * len(df) ** 0.5))
    Xc = sm.add_constant(df.drop(columns="y"))
    return sm.OLS(df["y"], Xc).fit(cov_type="HAC", cov_kwds={"maxlags": maxlags})


def ar1(s: pd.Series) -> float:
    v = s.dropna().to_numpy(float)
    return float(acf(v, 1)[1]) if len(v) > 3 else float("nan")
