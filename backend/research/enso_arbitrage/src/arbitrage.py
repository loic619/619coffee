"""The dependent variables, built exactly as documented in REPORT.md §4.

A  NY_LONDON_ARB    kc_usd_t = KC ¢/lb × 22.0462 ;  arb_usd = kc_usd_t − RC ;
                    arb_ratio = kc_usd_t / RC ;  arb_log = ln kc_usd_t − ln RC
                    Both legs USD exchange contracts: no FX, freight or cost
                    enters — the repo's own convention (lib/units.ts).
B  VN_BR_ARB        vn_usd_t = VND/kg × 1000 / USDVND ;
                    br_usd_t = R$/saca × (1000/60) / USDBRL
                    B1 log = ln br − ln vn (interior basis, standard grades)
                    B2 log = same with the repo's FOBbing ladders added
                    B3     = (br − kc) − (vn − rc): differential-of-differentials,
                             the physical arbitrage with the exchange arbitrage
                             subtracted out.

`arb_log` is the statistical workhorse everywhere: the USD/t spread scales with
the price level (coffee tripled 2021→25), and a level-driven spread against a
persistent index is the textbook spurious correlation.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .repo_data import KC_CENTS_TO_USD_MT

SACA_KG = 60.0
# FOBbing ladders as tender_parity.py / lib/originCosts.ts (model v4):
# fobbing = fixed + pct% × farmgate_usd. Brazil arabica has no ladder of its
# own in the repo; originCosts.ts borrows the "CON T7" one as a logistics twin.
FOB_VN = (55.0, 1.29)
FOB_BR_ARABICA_TWIN = (62.5, 5.83)


def ny_london(kc_cents: pd.Series, rc_usd: pd.Series) -> pd.DataFrame:
    """Daily A-variables from a KC ¢/lb series and an RC USD/t series."""
    df = pd.DataFrame({"kc_cents": kc_cents, "rc_usd_t": rc_usd}).dropna()
    df["kc_usd_t"] = df["kc_cents"] * KC_CENTS_TO_USD_MT
    df["arb_usd"] = df["kc_usd_t"] - df["rc_usd_t"]
    df["arb_ratio"] = df["kc_usd_t"] / df["rc_usd_t"]
    df["arb_log"] = np.log(df["kc_usd_t"]) - np.log(df["rc_usd_t"])
    return df


def to_usd_t(vn_vnd_kg: pd.Series, usdvnd: pd.Series, br_brl_saca: pd.Series, usdbrl: pd.Series) -> pd.DataFrame:
    """Convert both physical legs to USD per tonne on the day's FX (forward-filled ≤ 5 days
    across weekends/holidays only — the price prints on days FX does not)."""
    fx = pd.DataFrame({"usdvnd": usdvnd, "usdbrl": usdbrl}).sort_index()
    idx = vn_vnd_kg.index.union(br_brl_saca.index).union(fx.index)
    fx = fx.reindex(idx).ffill(limit=5)
    vn = (vn_vnd_kg * 1000.0).reindex(idx) / fx["usdvnd"]
    br = (br_brl_saca * (1000.0 / SACA_KG)).reindex(idx) / fx["usdbrl"]
    return pd.DataFrame({"vn_usd_t": vn, "br_usd_t": br}).dropna(how="all")


def vn_br(legs: pd.DataFrame, kc_usd_t: pd.Series | None = None, rc_usd_t: pd.Series | None = None) -> pd.DataFrame:
    """Daily B-variables from USD/t legs (and, for B3, the exchange legs)."""
    df = legs.dropna().copy()
    df["b1_usd"] = df["br_usd_t"] - df["vn_usd_t"]
    df["b1_log"] = np.log(df["br_usd_t"]) - np.log(df["vn_usd_t"])
    vn_fob = df["vn_usd_t"] + FOB_VN[0] + FOB_VN[1] / 100 * df["vn_usd_t"]
    br_fob = df["br_usd_t"] + FOB_BR_ARABICA_TWIN[0] + FOB_BR_ARABICA_TWIN[1] / 100 * df["br_usd_t"]
    df["b2_log"] = np.log(br_fob) - np.log(vn_fob)
    if kc_usd_t is not None and rc_usd_t is not None:
        ex = pd.DataFrame({"kc": kc_usd_t, "rc": rc_usd_t}).reindex(df.index).ffill(limit=5)
        df["br_diff"] = df["br_usd_t"] - ex["kc"]          # NY arabica differential at origin
        df["vn_diff"] = df["vn_usd_t"] - ex["rc"]          # London robusta differential at origin
        df["b3_usd"] = df["br_diff"] - df["vn_diff"]
        # B3 in log form: the physical premium net of the exchange premium
        df["b3_log"] = df["b1_log"] - (np.log(ex["kc"]) - np.log(ex["rc"]))
    return df


def monthly(df: pd.DataFrame | pd.Series, how: str = "mean", min_obs: int = 8) -> pd.DataFrame | pd.Series:
    """Daily → monthly. `mean` of the month's prints (primary) or `last`. A month
    with fewer than `min_obs` prints is NaN, not a thin average dressed as one."""
    g = df.groupby(df.index.to_period("M"))
    n = g.size()
    out = g.mean() if how == "mean" else g.last()
    out = out.where(n.reindex(out.index) >= min_obs)
    return out.sort_index()


# ── transformations ───────────────────────────────────────────────────────────

def transforms(s: pd.Series, discovery_end: pd.Period | None = None, z_window: int | None = None) -> dict[str, pd.Series]:
    """The set every test is run on.

    level      as is — reported, and flagged as spurious-prone
    diff1      s_t − s_{t−1}
    diff3      s_t − s_{t−3}
    sa         calendar-month means removed; means estimated on the discovery
               window only when one is given, so the hold-out never leaks in
    z          standardised on the discovery window (or a rolling window)
    """
    s = s.astype(float)
    out = {"level": s, "diff1": s.diff(1), "diff3": s.diff(3)}
    base = s[s.index <= discovery_end] if discovery_end is not None else s
    mm = base.groupby(base.index.month).mean()
    out["sa"] = s - pd.Series(mm.reindex(s.index.month).values, index=s.index)
    if z_window:
        out["z"] = (s - s.rolling(z_window, min_periods=z_window // 2).mean()) / \
                   s.rolling(z_window, min_periods=z_window // 2).std()
    else:
        out["z"] = (s - base.mean()) / base.std()
    out["sa_diff1"] = out["sa"].diff(1)
    return out
