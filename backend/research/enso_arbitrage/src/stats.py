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


def _on_common_axis(x: pd.Series, y: pd.Series) -> tuple[np.ndarray, np.ndarray, pd.PeriodIndex]:
    lo = min(x.index.min(), y.index.min())
    hi = max(x.index.max(), y.index.max())
    idx = pd.period_range(lo, hi, freq="M")
    return x.reindex(idx).to_numpy(float), y.reindex(idx).to_numpy(float), idx


def _lag_slices(T: int, k: int) -> tuple[slice, slice]:
    """Positions pairing x_{t−k} with y_t on a common monthly axis."""
    if k >= 0:
        return slice(0, T - k), slice(k, T)
    return slice(-k, T), slice(0, T + k)


def surrogate_ccf(x: pd.Series, y: pd.Series, lags: range = range(-24, 25), n_sur: int = 2000,
                  seed: int = 7, min_n: int = 24) -> dict:
    """Per-lag surrogate p-values and the family-wise max-|r| test.

    Surrogates are phase-randomised copies of x on its CONTIGUOUS support, so
    each keeps x's spectrum; every surrogate is then correlated with y at every
    lag — the identical search the real series went through. Vectorised: one
    matrix of surrogates, one matrix-vector product per lag.

    Returns per_lag (lag, r_obs, p_surrogate, sur_q95_abs), max_abs_r_obs,
    p_max (share of surrogates whose best |r| over the lags ≥ the observed best),
    best_lag, sur_max_q95.
    """
    rng = np.random.default_rng(seed)
    xv, yv, _ = _on_common_axis(x, y)
    T = len(xv)
    # x must be contiguous for the spectrum to mean anything: interpolate only
    # isolated single-month holes, and only inside x's own span
    xs = pd.Series(xv).interpolate(limit=1, limit_area="inside").to_numpy(float)
    support = ~np.isnan(xs)
    first, last = np.argmax(support), T - 1 - np.argmax(support[::-1])
    core = xs[first:last + 1]
    if np.isnan(core).any():
        # a real gap inside ENSO history: fill with the mean for the surrogate
        # spectrum only; those months are masked out of every correlation
        core = np.where(np.isnan(core), np.nanmean(core), core)
    n_core = len(core)
    f = np.fft.rfft(core - core.mean())
    ph = rng.uniform(0, 2 * np.pi, (n_sur, len(f)))
    ph[:, 0] = 0
    if n_core % 2 == 0:
        ph[:, -1] = 0
    S = np.fft.irfft(np.abs(f)[None, :] * np.exp(1j * ph), n=n_core, axis=1) + core.mean()
    Sfull = np.full((n_sur, T), np.nan)
    Sfull[:, first:last + 1] = S

    obs, per, sur_r = [], [], np.full((n_sur, len(list(lags))), np.nan)
    for j, k in enumerate(lags):
        sx, sy = _lag_slices(T, k)
        a, b = xv[sx], yv[sy]
        m = ~np.isnan(a) & ~np.isnan(b)
        if m.sum() < min_n:
            obs.append(np.nan)
            per.append({"lag": k, "r_obs": np.nan, "p_surrogate": np.nan, "sur_q95_abs": np.nan})
            continue
        aa, bb = a[m], b[m]
        r_obs = float(np.corrcoef(aa, bb)[0, 1])
        A = Sfull[:, sx][:, m]
        A = A - A.mean(axis=1, keepdims=True)
        bc = bb - bb.mean()
        denom = np.sqrt((A * A).sum(axis=1) * (bc * bc).sum())
        with np.errstate(invalid="ignore", divide="ignore"):
            rs = (A @ bc) / denom
        rs = rs[np.isfinite(rs)]
        sur_r[: len(rs), j] = rs
        obs.append(r_obs)
        per.append({"lag": k, "r_obs": r_obs, "p_surrogate": float((np.abs(rs) >= abs(r_obs)).mean()),
                    "sur_q95_abs": float(np.quantile(np.abs(rs), 0.95))})
    obs = np.array(obs)
    per = pd.DataFrame(per)
    if np.isfinite(obs).any():
        best_j = int(np.nanargmax(np.abs(obs)))
        max_obs = float(abs(obs[best_j]))
        sur_max = np.nanmax(np.abs(sur_r), axis=1)
        sur_max = sur_max[np.isfinite(sur_max)]
        p_max = float((sur_max >= max_obs).mean())
        best_lag = list(lags)[best_j]
        q95 = float(np.quantile(sur_max, 0.95))
    else:
        max_obs, p_max, best_lag, q95 = np.nan, np.nan, None, np.nan
    return {"per_lag": per, "max_abs_r_obs": max_obs, "p_max": p_max, "best_lag": best_lag, "sur_max_q95": q95}


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
