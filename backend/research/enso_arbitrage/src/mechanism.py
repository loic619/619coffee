"""Is there a coffee-market road from ENSO to the arbitrage, and does ENSO still
matter once the road is in the regression?

The chain, link by link, each tested with the same CCF + surrogate toolkit:

  ENSO → rainfall anomaly       Brazil arabica belt (Sul de Minas, Cerrado),
                                Vietnam Central Highlands. 1995 →.
  ENSO / rainfall → next crop   Brazil arabica and Vietnam robusta harvests,
                                annual, with the biennial cycle controlled.
  supply → exports / stocks     CECAFE arabica exports 1990 →; ICE certified
                                robusta 1993 →, arabica 2010 →.
  stocks / differentials → arb  physical-minus-futures differentials where the
                                external data allows; certified stocks always.

Then the question the brief singles out: regress Δ arbitrage on ENSO(t−k) with
and without the regional rainfall anomalies at their own best lags. If the ENSO
coefficient goes away, ENSO was an early read on the weather — a finding, not
a failure.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import stats as st


def best_lag(x: pd.Series, y: pd.Series, lags: range) -> dict:
    """The lag with the largest |r|, with its Bartlett p, plus the surrogate
    family-wise p that accounts for having searched the lags."""
    c = st.ccf(x, y, lags)
    if "pearson" not in c.columns:
        return {"lag": None}
    c = c.dropna(subset=["pearson"])
    if c.empty:
        return {"lag": None}
    j = c["pearson"].abs().idxmax()
    sur = st.surrogate_ccf(x, y, lags, n_sur=1000)
    return {"lag": int(c.loc[j, "lag"]), "r": float(c.loc[j, "pearson"]), "n": int(c.loc[j, "n"]),
            "n_eff": float(c.loc[j, "n_eff"]), "p_bartlett": float(c.loc[j, "p_bartlett"]),
            "p_max_surrogate": sur["p_max"]}


def chain_links(oni: pd.Series, rain_br: pd.Series, rain_vn: pd.Series, arb: pd.Series,
                stocks: pd.DataFrame | None, exports_br: pd.Series | None,
                diffs: pd.DataFrame | None) -> pd.DataFrame:
    """One row per link: x → y, best lag, r, n_eff, Bartlett p, surrogate family p."""
    links = [("ONI", "Brazil rain anomaly (arabica belt)", oni, rain_br, range(0, 7)),
             ("ONI", "Vietnam rain anomaly (Central Highlands)", oni, rain_vn, range(0, 7))]
    if exports_br is not None:
        links.append(("ONI", "Δlog CECAFE arabica exports (12m)", oni, exports_br, range(0, 25)))
        links.append(("Brazil rain anomaly", "Δlog CECAFE arabica exports (12m)", rain_br, exports_br, range(0, 25)))
    if stocks is not None:
        for col, name in (("d_log_rob_12", "Δlog ICE certified robusta (12m)"),
                          ("d_log_ara_12", "Δlog ICE certified arabica (12m)")):
            if col in stocks:
                links.append(("ONI", name, oni, stocks[col], range(0, 25)))
        if "d_log_ara_12" in stocks:
            links.append(("Brazil rain anomaly", "Δlog ICE certified arabica (12m)", rain_br, stocks["d_log_ara_12"], range(0, 25)))
        if "d_log_rob_12" in stocks:
            links.append(("Vietnam rain anomaly", "Δlog ICE certified robusta (12m)", rain_vn, stocks["d_log_rob_12"], range(0, 25)))
    if diffs is not None:
        for col, name in (("ny_diff_z", "NY arabica differential (indicator − KC)"),
                          ("ldn_diff_z", "London robusta differential (indicator − RC)")):
            if col in diffs:
                links.append(("ONI", name, oni, diffs[col], range(0, 25)))
    links.append(("Brazil rain anomaly", "Δ arbitrage (log, 3m)", rain_br, arb, range(0, 25)))
    links.append(("Vietnam rain anomaly", "Δ arbitrage (log, 3m)", rain_vn, arb, range(0, 25)))
    links.append(("ONI", "Δ arbitrage (log, 3m)", oni, arb, range(0, 25)))
    rows = []
    for xn, yn, x, y, lags in links:
        b = best_lag(x, y, lags)
        rows.append({"from": xn, "to": yn, **b})
    return pd.DataFrame(rows)


def enso_vs_weather_regression(arb_d: pd.Series, oni: pd.Series, rain_br: pd.Series, rain_vn: pd.Series,
                               k_enso: int, k_br: int, k_vn: int, month_dummies: bool = True,
                               extra: pd.DataFrame | None = None) -> dict:
    """Two HAC regressions of Δ arbitrage on lagged ENSO: without, then with, the
    regional rainfall anomalies at their own lags. Returns coefficient tables and
    the change in the ENSO coefficient."""
    def lagged(s: pd.Series, k: int, name: str) -> pd.Series:
        o = s.copy()
        o.index = o.index + k
        return o.rename(name)

    X0 = pd.concat([lagged(oni, k_enso, f"oni_l{k_enso}"), arb_d.shift(1).rename("arb_d_lag1")], axis=1)
    X1 = pd.concat([X0, lagged(rain_br, k_br, f"rain_br_l{k_br}"), lagged(rain_vn, k_vn, f"rain_vn_l{k_vn}")], axis=1)
    if extra is not None:
        X0 = pd.concat([X0, extra], axis=1)
        X1 = pd.concat([X1, extra], axis=1)
    if month_dummies:
        d = pd.get_dummies(pd.Series(arb_d.index.month, index=arb_d.index), prefix="m", drop_first=True).astype(float)
        X0 = pd.concat([X0, d], axis=1)
        X1 = pd.concat([X1, d], axis=1)
    r0 = st.newey_west_ols(arb_d, X0)
    r1 = st.newey_west_ols(arb_d, X1)

    def table(res):
        if res is None:
            return None
        t = pd.DataFrame({"coef": res.params, "se_hac": res.bse, "t": res.tvalues, "p": res.pvalues})
        return t[~t.index.str.startswith("m_")]
    out = {"without_weather": table(r0), "with_weather": table(r1),
           "n": int(r1.nobs) if r1 is not None else 0,
           "r2_without": float(r0.rsquared) if r0 is not None else np.nan,
           "r2_with": float(r1.rsquared) if r1 is not None else np.nan}
    key = f"oni_l{k_enso}"
    if r0 is not None and r1 is not None:
        out["enso_coef_without"] = float(r0.params[key])
        out["enso_p_without"] = float(r0.pvalues[key])
        out["enso_coef_with"] = float(r1.params[key])
        out["enso_p_with"] = float(r1.pvalues[key])
        out["enso_coef_shrink_pct"] = float(100 * (1 - r1.params[key] / r0.params[key])) if r0.params[key] != 0 else np.nan
    return out


def crop_year_regression(prod: pd.Series, oni: pd.Series, window_months: list[int], year_offset: int) -> dict:
    """Annual: log(prod_y / prod_{y−1}) on mean ONI over `window_months` of the growing
    season that feeds harvest y, controlling for the biennial cycle (lagged yoy).
    `year_offset` = 1 if the window is in calendar year y−1 (Brazil flowering
    Sep–Nov of y−1 feeds harvest y), else 0."""
    yoy = np.log(prod).diff()
    rows = []
    for y in yoy.dropna().index:
        months = []
        for m in window_months:
            yy = y - year_offset if m >= 7 else y
            months.append(pd.Period(year=yy, month=m, freq="M"))
        v = oni.reindex(months)
        rows.append({"year": y, "yoy": float(yoy[y]), "oni_window": float(v.mean()) if v.notna().any() else np.nan,
                     "yoy_lag1": float(yoy.get(y - 1, np.nan))})
    df = pd.DataFrame(rows).set_index("year").dropna()
    if len(df) < 8:
        return {"n": len(df)}
    res = st.newey_west_ols(df["yoy"], df[["oni_window", "yoy_lag1"]], maxlags=2)
    return {"n": int(res.nobs), "coef_oni": float(res.params["oni_window"]), "p_oni": float(res.pvalues["oni_window"]),
            "coef_biennial": float(res.params["yoy_lag1"]), "r2": float(res.rsquared),
            "corr_simple": float(df["yoy"].corr(df["oni_window"]))}
