"""Run the whole study: inputs → machine-readable results → markdown tables.

    cd backend && PYTHONPATH=. python -m research.enso_arbitrage.src.study

Tier 1 is the ICO indicator premium (Other Milds − Robustas, World Bank Pink
Sheet, 1960→) against ONI (1980→), Niño 3.4 (1981→) and SOI (1960→); the repo's
own futures premium (2021→) is run beside it as the short cross-check. Tier 2 is
the physical Vietnam–Brazil premium (2023-06→), exploratory by construction.

Every number written to outputs/ is produced here; REPORT.md quotes them and
adds nothing of its own.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import arbitrage as ab
from . import enso, events, load_external, mechanism, predictive
from . import repo_data as rd
from . import stats as st
from .paths import OUT_RESULTS, OUT_TABLES, ensure_out

LAGS = range(-24, 25)
POS_LAGS = range(0, 25)
DISCOVERY_END = pd.Period("2012-12", freq="M")
TRANSFORMS = ("level", "diff1", "diff3", "sa", "sa_diff1", "z")
HYPOTHESIS_WINDOWS = {"el_nino": [(1, 3), (3, 6), (6, 9), (9, 12), (12, 18)],
                      "la_nina": [(3, 6), (6, 9), (9, 12), (12, 18), (18, 24)]}


@dataclass
class Inputs:
    oni: pd.Series
    nino34: pd.Series
    soi: pd.Series                      # sign-flipped: positive = El Niño-like, so lags read like ONI
    episodes: list[dict]
    episodes_all: list[dict]
    regimes: pd.Series
    signals: pd.DataFrame
    tier1: pd.DataFrame                 # ind_arb_log, other_milds_usd_t, robustas_usd_t
    tier1_meta: dict
    fut: pd.DataFrame                   # repo futures premium, monthly, 2021→
    tier2: pd.DataFrame                 # b1_log, b2_log, b3_log, vn_usd_t, br_usd_t
    tier2_meta: dict
    stocks: pd.DataFrame
    exports: pd.DataFrame
    rain_br: pd.DataFrame
    rain_vn: pd.DataFrame
    production: pd.DataFrame
    notes: dict = field(default_factory=dict)


def build_inputs() -> Inputs:
    oni = rd.oni()
    nino34 = enso.nino34_monthly(rd.nino34_weekly())
    soi = -rd.soi()
    eps_all = enso.official_episodes(oni)
    eps = enso.collapse_back_to_back(eps_all)
    regimes = enso.regime_labels(oni, eps_all)
    sig = enso.label_signals(enso.realtime_signals(oni, rd.nino34_weekly()), eps_all)

    ps, ps_meta = load_external.pink_sheet()
    kc, rc = rd.front_series("arabica"), rd.front_series("robusta")
    a_daily = ab.ny_london(kc["price"], rc["price"])
    fut = ab.monthly(a_daily)
    vn, vn_excl, vn_prov = rd.vietnam_local()
    br, _ = rd.origin_price("brazil_arabica")
    fx = rd.fx()
    legs = ab.to_usd_t(vn, fx["usdvnd"], br, fx["usdbrl"])
    b_daily = ab.vn_br(legs, a_daily["kc_usd_t"], a_daily["rc_usd_t"])
    tier2 = ab.monthly(b_daily)
    stocks = rd.cert_stocks_monthly()
    stocks["d_log_rob_12"] = np.log(stocks["robusta_t"]).diff(12)
    stocks["d_log_ara_12"] = np.log(stocks["arabica_bags"]).diff(12)
    exports = rd.cecafe_monthly()
    exports["ara_12m"] = exports["arabica"].rolling(12).sum()
    exports["d_log_ara_12"] = np.log(exports["ara_12m"]).diff(12)
    rain_br = rd.weather_monthly("brazil", rd.BRAZIL_REGIONS)
    rain_vn = rd.weather_monthly("vn", rd.VIETNAM_REGIONS)
    prod = rd.production_annual()
    notes = {"vietnam_provenance": vn_prov, "vietnam_exclusions": vn_excl,
             "kc_roll": "nearest contract, rolled 5 trading days before FND (KC) / 3 (RC), from contract_prices_archive.json",
             "soi_sign": "SOI multiplied by −1 so that positive = El Niño-like (matches ONI sign)",
             "oni_provenance": rd.oni_provenance()}
    return Inputs(oni, nino34, soi, eps, eps_all, regimes, sig, ps, ps_meta, fut, tier2,
                  {"months": int(tier2["b1_log"].notna().sum()), "first": str(tier2.index.min()),
                   "last": str(tier2.dropna(subset=["b1_log"]).index.max())},
                  stocks, exports, rain_br, rain_vn, prod, notes)


# ── CCF families ──────────────────────────────────────────────────────────────

def ccf_family(x: pd.Series, y: pd.Series, lags: range = LAGS, n_sur: int = 2000) -> tuple[pd.DataFrame, dict]:
    c = st.ccf(x, y, lags)
    if "pearson" not in c.columns or c["pearson"].notna().sum() == 0:
        return c, {"best_lag": None}
    sur = st.surrogate_ccf(x, y, lags, n_sur=n_sur)
    c = c.merge(sur["per_lag"][["lag", "p_surrogate", "sur_q95_abs"]], on="lag", how="left")
    c["q_bh_bartlett"] = st.bh_fdr(c["p_bartlett"])
    c["q_bh_surrogate"] = st.bh_fdr(c["p_surrogate"])
    valid = c.dropna(subset=["pearson"])
    if valid.empty:
        return c, {"best_lag": None}
    j = valid["pearson"].abs().idxmax()
    r, lo, hi = st.block_bootstrap_ci(x, y, int(c.loc[j, "lag"]))
    pos = valid[valid["lag"] >= 0]
    jp = pos["pearson"].abs().idxmax() if not pos.empty else j
    summ = {"best_lag": int(c.loc[j, "lag"]), "r": float(c.loc[j, "pearson"]), "spearman": float(c.loc[j, "spearman"]),
            "n": int(c.loc[j, "n"]), "n_eff": float(c.loc[j, "n_eff"]),
            "p_bartlett": float(c.loc[j, "p_bartlett"]), "q_bh": float(c.loc[j, "q_bh_bartlett"]),
            "p_surrogate_lag": float(c.loc[j, "p_surrogate"]), "p_max_surrogate": sur["p_max"],
            "ci_block_lo": lo, "ci_block_hi": hi, "sur_max_q95": sur["sur_max_q95"],
            "n_lags_sig_bartlett_05": int((valid["p_bartlett"] < 0.05).sum()),
            "n_lags_sig_bh_10": int((valid["q_bh_bartlett"] < 0.10).sum()),
            "best_pos_lag": int(c.loc[jp, "lag"]), "r_best_pos_lag": float(c.loc[jp, "pearson"]),
            "p_bartlett_best_pos": float(c.loc[jp, "p_bartlett"]), "q_bh_best_pos": float(c.loc[jp, "q_bh_bartlett"])}
    return c, summ


def run_ccf_families(inp: Inputs, tier: str, arb_series: dict[str, pd.Series], indices: dict[str, pd.Series],
                     discovery_end: pd.Period | None) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows, summaries = [], []
    for aname, a in arb_series.items():
        tr = ab.transforms(a, discovery_end=discovery_end)
        for tname in TRANSFORMS:
            y = tr[tname]
            for iname, x in indices.items():
                c, s = ccf_family(x, y)
                c.insert(0, "index", iname)
                c.insert(0, "transform", tname)
                c.insert(0, "arbitrage", aname)
                c.insert(0, "tier", tier)
                rows.append(c)
                summaries.append({"tier": tier, "arbitrage": aname, "transform": tname, "index": iname, **s})
    return pd.concat(rows, ignore_index=True), pd.DataFrame(summaries)


# ── events ────────────────────────────────────────────────────────────────────

def run_events(arb: pd.Series, episodes: list[dict], regimes: pd.Series, label: str) -> dict:
    out = {}
    neutral = [p for p, v in regimes.items() if v == "neutral" and p in arb.index]
    for phase in ("el_nino", "la_nina"):
        onsets = [e["onset"] for e in episodes if e["phase"] == phase and e["onset"] in arb.index]
        paths = events.event_paths(arb, onsets)
        if len(paths) == 0:
            # no onset of this phase inside the series — say so, do not invent one
            out[phase] = {"onsets": [], "paths": paths, "summary": pd.DataFrame({"h": events.HORIZONS, "n": 0}),
                          "p_placebo_family": np.nan, "peak_h": None, "peak_mean": np.nan, "n": 0}
            continue
        summ = events.summarise_paths(paths)
        pl = events.placebo(arb, max(len(paths), 1), neutral)
        summ = summ.merge(pl, on="h", how="left")
        pp, fam = events.placebo_p(summ.set_index("h")["mean"], arb, max(len(paths), 1), neutral)
        summ["p_placebo"] = summ["h"].map(pp)
        peak_h, peak_v = events.time_to_peak(summ)
        out[phase] = {"onsets": [str(o) for o in onsets], "paths": paths, "summary": summ,
                      "p_placebo_family": fam, "peak_h": peak_h, "peak_mean": peak_v, "n": len(paths)}
    out["table"] = events.event_table(arb, episodes)
    out["label"] = label
    return out


# ── regime × lag heatmap ──────────────────────────────────────────────────────

def regime_lag_grid(x: pd.Series, y: pd.Series, regimes: pd.Series, lags: range = POS_LAGS) -> pd.DataFrame:
    """r between x(t−k) and y(t) over months whose ENSO state AT t−k was the regime."""
    rows = []
    for reg in ("el_nino", "la_nina", "neutral"):
        mask = regimes == reg
        xm = x.where(mask.reindex(x.index, fill_value=False).astype(bool))
        for k in lags:
            a, b = st._align(xm, y, k)
            if len(a) < 20:
                rows.append({"regime": reg, "lag": k, "n": len(a)})
                continue
            r = float(np.corrcoef(a, b)[0, 1])
            p, lo, hi = st.bartlett_test(r, st.effective_n(a, b))
            rows.append({"regime": reg, "lag": k, "n": len(a), "r": r, "p_bartlett": p})
    return pd.DataFrame(rows)


# ── regressions ───────────────────────────────────────────────────────────────

def _lag(s: pd.Series, k: int, name: str) -> pd.Series:
    o = s.copy()
    o.index = o.index + k
    return o.rename(name)


def run_regressions(inp: Inputs, arb: pd.Series, lags_to_test: list[int]) -> pd.DataFrame:
    """Δ3 log-premium on ONI(t−k), then ONI split by sign (asymmetry), with
    controls: lagged Δ, Δlog certified stocks, month dummies. HAC errors."""
    y = arb.diff(3).rename("d3")
    month_d = pd.get_dummies(pd.Series(y.index.month, index=y.index), prefix="m", drop_first=True).astype(float)
    rows = []
    for k in lags_to_test:
        base = pd.concat([_lag(inp.oni, k, "oni"), arb.diff(3).shift(3).rename("d3_lag3")], axis=1)
        ctrl_rob = pd.concat([base, inp.stocks["d_log_rob_12"].rename("dlog_rob_stocks_12")], axis=1)
        ctrl = pd.concat([ctrl_rob, inp.stocks["d_log_ara_12"].rename("dlog_ara_stocks_12")], axis=1)
        asym = pd.concat([_lag(inp.oni.clip(lower=0), k, "oni_pos"), _lag(inp.oni.clip(upper=0), k, "oni_neg"),
                          arb.diff(3).shift(3).rename("d3_lag3")], axis=1)
        # the same sample as the control spec, so a change in the ENSO coefficient
        # is the control and not the years
        base_2010 = base[base.index >= pd.Period("2010-08", freq="M")]
        for spec, X in (("oni + lagged Δ + month dummies", pd.concat([base, month_d], axis=1)),
                        ("… + Δlog cert robusta stocks (1993→, same sample)", pd.concat([ctrl_rob, month_d], axis=1)),
                        ("oni alone, 2010-08→ sample", pd.concat([base_2010, month_d], axis=1)),
                        ("… + Δlog cert stocks rob & ara (2010-08→)", pd.concat([ctrl, month_d], axis=1)),
                        ("ONI⁺ / ONI⁻ (asymmetry) + lagged Δ + month dummies", pd.concat([asym, month_d], axis=1))):
            res = st.newey_west_ols(y, X)
            if res is None:
                continue
            for var in [c for c in X.columns if not c.startswith("m_")]:
                rows.append({"lag": k, "spec": spec, "var": var, "coef": float(res.params[var]),
                             "se_hac": float(res.bse[var]), "t": float(res.tvalues[var]), "p": float(res.pvalues[var]),
                             "n": int(res.nobs), "r2": float(res.rsquared)})
    return pd.DataFrame(rows)


# ── out-of-sample ─────────────────────────────────────────────────────────────

def run_oos(x: pd.Series, y_full: pd.Series, cut: pd.Period, lags: range = POS_LAGS) -> dict:
    """Pick the best positive lag on the discovery window; report it on the validation window."""
    yd, yv = y_full[y_full.index <= cut], y_full[y_full.index > cut]
    cd = st.ccf(x, yd, lags).dropna(subset=["pearson"])
    if cd.empty:
        return {}
    j = cd["pearson"].abs().idxmax()
    k = int(cd.loc[j, "lag"])
    cv = st.ccf(x, yv, range(k, k + 1)).dropna(subset=["pearson"])
    out = {"discovery_end": str(cut), "best_lag_discovery": k, "r_discovery": float(cd.loc[j, "pearson"]),
           "p_discovery": float(cd.loc[j, "p_bartlett"]), "n_discovery": int(cd.loc[j, "n"])}
    if not cv.empty:
        out.update({"r_validation": float(cv.iloc[0]["pearson"]), "p_validation": float(cv.iloc[0]["p_bartlett"]),
                    "n_validation": int(cv.iloc[0]["n"]),
                    "same_sign": bool(np.sign(cv.iloc[0]["pearson"]) == np.sign(cd.loc[j, "pearson"]))})
    sur_v = st.surrogate_ccf(x, yv, lags, n_sur=1000)
    out["p_max_validation_if_searched"] = sur_v["p_max"]
    return out


# ── price / stock regimes ─────────────────────────────────────────────────────

def run_market_regimes(inp: Inputs, arb_d3: pd.Series) -> pd.DataFrame:
    rows = []
    level = inp.tier1["other_milds_usd_t"]
    rob = inp.stocks["robusta_t"]
    ara = inp.stocks["arabica_bags"]
    for name, s in (("arabica price level (Other Milds, USD/t)", level),
                    ("ICE certified robusta stocks (1993→)", rob),
                    ("ICE certified arabica stocks (2010→)", ara)):
        s = s.dropna()
        q = s.quantile([1 / 3, 2 / 3])
        for lab, mask in (("low tercile", s <= q.iloc[0]), ("mid tercile", (s > q.iloc[0]) & (s <= q.iloc[1])),
                          ("high tercile", s > q.iloc[1])):
            y = arb_d3.where(mask.reindex(arb_d3.index, fill_value=False).astype(bool))
            c = st.ccf(inp.oni, y, POS_LAGS).dropna(subset=["pearson"])
            if c.empty:
                continue
            j = c["pearson"].abs().idxmax()
            rows.append({"regime_variable": name, "regime": lab, "n_months": int(mask.sum()),
                         "best_lag": int(c.loc[j, "lag"]), "r": float(c.loc[j, "pearson"]),
                         "p_bartlett": float(c.loc[j, "p_bartlett"]), "n_pairs": int(c.loc[j, "n"])})
    return pd.DataFrame(rows)


# ── predictive ────────────────────────────────────────────────────────────────

def _decluster(months: list[pd.Period], min_gap: int = 6) -> list[pd.Period]:
    """Keep the first signal of a cluster: two flags six months apart are one
    developing event seen twice, and counting both overstates n."""
    out: list[pd.Period] = []
    for m in sorted(months):
        if not out or (m - out[-1]).n >= min_gap:
            out.append(m)
    return out


def run_predictive(inp: Inputs, arb: pd.Series, label: str) -> pd.DataFrame:
    neutral = [p for p, v in inp.regimes.items() if v == "neutral"]
    rows = []
    for phase in ("el_nino", "la_nina"):
        sig = _decluster([m for m in inp.signals.loc[inp.signals["phase"] == phase, "month"] if m in arb.index])
        off = [e["onset"] for e in inp.episodes if e["phase"] == phase and e["onset"] in arb.index]
        for kind, months in (("real-time signal (incl. false alarms)", sig), ("official onset (retrospective)", off)):
            for sample, mm in (("all", months), *[(n, m) for n, m in zip(("discovery ≤2012", "validation 2013→"),
                                                                            predictive.split_in_out(months, DISCOVERY_END))]):
                c = predictive.conditional(arb, mm, neutral)
                c.insert(0, "sample", sample)
                c.insert(0, "signal", kind)
                c.insert(0, "phase", phase)
                c.insert(0, "series", label)
                rows.append(c)
    return pd.concat(rows, ignore_index=True)


# ── the lag-response table the brief asks for ─────────────────────────────────

def lag_response_row(phase: str, arb_name: str, ev: dict, fam: pd.DataFrame, price_level: float) -> dict:
    e = ev[phase]
    row = {"event": phase, "arbitrage": arb_name, "n_events": e["n"]}
    if "mean" not in e["summary"].columns:
        return row                      # no onset of this phase inside the series
    s = e["summary"].dropna(subset=["mean"])
    if s.empty:
        return row
    j = s["mean"].abs().idxmax()
    peak = s.loc[j]
    row.update({"direction": "premium widens" if peak["mean"] > 0 else "premium narrows",
                "peak_lag_months": int(peak["h"]), "mean_change_log": float(peak["mean"]),
                "ci_lo": float(peak["ci_lo"]), "ci_hi": float(peak["ci_hi"]), "consistency": float(peak["consistency"]),
                "p_placebo_at_peak": float(peak["p_placebo"]), "p_placebo_family": e["p_placebo_family"],
                "pct_change_in_premium_ratio": float(100 * (np.exp(peak["mean"]) - 1)),
                "usd_t_at_sample_median_price": float(price_level * (np.exp(peak["mean"]) - 1))})
    # correlation side: the phase-signed ONI against the 3-month change, best positive lag
    f = fam[(fam["arbitrage"] == arb_name) & (fam["transform"] == "diff3") & (fam["index"] == ("ONI⁺" if phase == "el_nino" else "ONI⁻"))]
    if not f.empty:
        r = f.iloc[0]
        row.update({"ccf_best_lag": int(r["best_pos_lag"]), "ccf_r": float(r["r_best_pos_lag"]),
                    "ccf_p_bartlett": float(r["p_bartlett_best_pos"]), "ccf_q_bh": float(r["q_bh_best_pos"]),
                    "ccf_p_max_surrogate": float(r["p_max_surrogate"]), "ccf_n_eff": float(r["n_eff"])})
    return row


# ── main ──────────────────────────────────────────────────────────────────────

def _md(df: pd.DataFrame, floatfmt: str = ".3f") -> str:
    d = df.copy()
    for c in d.columns:
        if d[c].dtype.kind == "f":
            d[c] = d[c].map(lambda v: "" if pd.isna(v) else format(v, floatfmt))
    cols = list(d.columns)
    lines = ["| " + " | ".join(str(c) for c in cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for _, r in d.iterrows():
        lines.append("| " + " | ".join("" if pd.isna(v) else str(v) for v in r.values) + " |")
    return "\n".join(lines)


def main(n_sur: int = 2000) -> int:
    ensure_out()
    ccf_family.__defaults__ = (LAGS, n_sur)   # one knob for a quick pass (--n-sur 200)
    inp = build_inputs()
    print(f"Tier 1: {inp.tier1_meta}; Tier 2: {inp.tier2_meta}; episodes {len(inp.episodes)} (collapsed) / {len(inp.episodes_all)}")

    # phase-signed ONI so El Niño and La Niña get their own correlation
    indices = {"ONI": inp.oni, "Niño 3.4": inp.nino34, "−SOI": inp.soi,
               "ONI⁺": inp.oni.clip(lower=0), "ONI⁻": inp.oni.clip(upper=0)}
    t1 = {"ICO indicator premium (1960→)": inp.tier1["ind_arb_log"],
          "ICE futures premium (2021→, repo)": inp.fut["arb_log"]}
    t2 = {"VN–BR physical premium B1": inp.tier2["b1_log"], "VN–BR FOB-basis B2": inp.tier2["b2_log"],
          "VN–BR net of exchange B3": inp.tier2["b3_log"]}

    ccf1, fam1 = run_ccf_families(inp, "tier1", t1, indices, DISCOVERY_END)
    ccf2, fam2 = run_ccf_families(inp, "tier2", t2, indices, None)
    ccf_all = pd.concat([ccf1, ccf2], ignore_index=True)
    fam_all = pd.concat([fam1, fam2], ignore_index=True)
    n_tests = int(ccf_all["pearson"].notna().sum()) * 2   # Pearson and Spearman at every lag
    fam_all["q_bh_global"] = st.bh_fdr(fam_all["p_bartlett"])

    ev1 = run_events(inp.tier1["ind_arb_log"], inp.episodes, inp.regimes, "ICO indicator premium")
    ev1_all = run_events(inp.tier1["ind_arb_log"], inp.episodes_all, inp.regimes, "ICO indicator premium, back-to-back kept")
    ev2 = run_events(inp.tier2["b1_log"], inp.episodes_all, inp.regimes, "VN–BR physical premium B1")
    ev_fut = run_events(inp.fut["arb_log"], inp.episodes_all, inp.regimes, "ICE futures premium (repo)")

    grid1 = regime_lag_grid(inp.oni, inp.tier1["ind_arb_log"].diff(3), inp.regimes)
    grid2 = regime_lag_grid(inp.oni, inp.tier2["b1_log"].diff(3), inp.regimes)

    best_lags = sorted({int(r["best_pos_lag"]) for _, r in fam1.iterrows() if r["arbitrage"].startswith("ICO") and pd.notna(r.get("best_pos_lag"))}
                       | {3, 6, 9, 12, 18, 24})
    reg1 = run_regressions(inp, inp.tier1["ind_arb_log"], best_lags)

    # mechanism: rainfall anomalies (1995→), production, exports, stocks
    rain_br = inp.rain_br["rain_z"].rolling(3).mean()
    rain_vn = inp.rain_vn["rain_z"].rolling(3).mean()
    chain = mechanism.chain_links(inp.oni, rain_br, rain_vn, inp.tier1["ind_arb_log"].diff(3),
                                  inp.stocks, inp.exports["d_log_ara_12"], None)
    crop_br = mechanism.crop_year_regression(inp.production["brazil_arabica"], inp.oni, [9, 10, 11, 12, 1, 2, 3, 4], 1)
    crop_vn = mechanism.crop_year_regression(inp.production["vietnam_robusta"], inp.oni, [5, 6, 7, 8, 9, 10], 0)
    k_enso = int(fam1[(fam1["arbitrage"].str.startswith("ICO")) & (fam1["transform"] == "diff3") & (fam1["index"] == "ONI")].iloc[0]["best_pos_lag"])
    def _lag_of(frm: str) -> int:
        v = chain[(chain["from"] == frm) & (chain["to"].str.startswith("Δ arbitrage"))].iloc[0]["lag"]
        return int(v) if pd.notna(v) else 0
    k_br, k_vn = _lag_of("Brazil rain anomaly"), _lag_of("Vietnam rain anomaly")
    wx = mechanism.enso_vs_weather_regression(inp.tier1["ind_arb_log"].diff(3), inp.oni, rain_br, rain_vn, k_enso, k_br, k_vn)

    oos = {}
    for tname in ("diff3", "sa_diff1", "level"):
        tr = ab.transforms(inp.tier1["ind_arb_log"], discovery_end=DISCOVERY_END)
        oos[tname] = run_oos(inp.oni, tr[tname], DISCOVERY_END)
    mreg = run_market_regimes(inp, inp.tier1["ind_arb_log"].diff(3))
    pred1 = run_predictive(inp, inp.tier1["ind_arb_log"], "ICO indicator premium")
    pred2 = run_predictive(inp, inp.tier2["b1_log"], "VN–BR physical premium B1")

    med_price = float(inp.tier1["other_milds_usd_t"].loc["1980-01":].median())
    latest_price = float(inp.tier1["other_milds_usd_t"].dropna().iloc[-1])
    lag_table = pd.DataFrame([lag_response_row(ph, an, ev, fam_all, med_price)
                              for an, ev in (("ICO indicator premium (1960→)", ev1), ("VN–BR physical premium B1", ev2))
                              for ph in ("el_nino", "la_nina")])

    # ── write ──
    ccf_all.to_csv(OUT_RESULTS / "ccf_all_lags.csv", index=False)
    fam_all.to_csv(OUT_RESULTS / "ccf_family_summary.csv", index=False)
    for name, ev in (("tier1", ev1), ("tier1_backtoback_kept", ev1_all), ("tier2", ev2), ("futures_repo", ev_fut)):
        for ph in ("el_nino", "la_nina"):
            ev[ph]["summary"].to_csv(OUT_RESULTS / f"event_{name}_{ph}.csv", index=False)
            ev[ph]["paths"].to_csv(OUT_RESULTS / f"event_paths_{name}_{ph}.csv")
        ev["table"].to_csv(OUT_RESULTS / f"event_table_{name}.csv", index=False)
    grid1.to_csv(OUT_RESULTS / "regime_lag_grid_tier1.csv", index=False)
    grid2.to_csv(OUT_RESULTS / "regime_lag_grid_tier2.csv", index=False)
    reg1.to_csv(OUT_RESULTS / "regressions_tier1.csv", index=False)
    chain.to_csv(OUT_RESULTS / "mechanism_chain.csv", index=False)
    mreg.to_csv(OUT_RESULTS / "market_regimes_tier1.csv", index=False)
    pd.concat([pred1, pred2]).to_csv(OUT_RESULTS / "predictive_conditional.csv", index=False)
    lag_table.to_csv(OUT_RESULTS / "lag_response_table.csv", index=False)
    inp.signals.assign(month=inp.signals["month"].astype(str)).to_csv(OUT_RESULTS / "realtime_signals.csv", index=False)
    pd.DataFrame([{**e, "onset": str(e["onset"]), "end": str(e["end"]), "peak_month": str(e["peak_month"])} for e in inp.episodes_all]) \
        .to_csv(OUT_RESULTS / "enso_episodes_official.csv", index=False)
    series = pd.concat([inp.oni.rename("oni"), inp.nino34.rename("nino34"), inp.soi.rename("neg_soi"),
                        inp.tier1.rename(columns=lambda c: c), inp.fut[["kc_usd_t", "rc_usd_t", "arb_log", "arb_usd"]].add_prefix("fut_"),
                        inp.tier2[["vn_usd_t", "br_usd_t", "b1_log", "b2_log", "b3_log", "b3_usd"]],
                        inp.regimes.rename("regime")], axis=1)
    series.index = series.index.astype(str)
    series.to_csv(OUT_RESULTS / "monthly_series.csv")

    summary = {
        "tier1": inp.tier1_meta, "tier2": inp.tier2_meta, "notes": inp.notes,
        "n_tests_ccf": n_tests, "n_families": int(len(fam_all)), "discovery_end": str(DISCOVERY_END),
        "episodes_collapsed": len(inp.episodes), "episodes_all": len(inp.episodes_all),
        "episodes_in_tier1": {ph: ev1[ph]["n"] for ph in ("el_nino", "la_nina")},
        "episodes_in_tier2": {ph: ev2[ph]["n"] for ph in ("el_nino", "la_nina")},
        "event_placebo_family_p": {ph: ev1[ph]["p_placebo_family"] for ph in ("el_nino", "la_nina")},
        "oos": oos, "weather_regression": {k: v for k, v in wx.items() if not isinstance(v, pd.DataFrame)},
        "weather_regression_tables": {k: v.round(4).to_dict() for k, v in wx.items() if isinstance(v, pd.DataFrame)},
        "crop_year_regression": {"brazil_arabica": crop_br, "vietnam_robusta": crop_vn},
        "price_levels_usd_t": {"other_milds_median_1980_on": med_price, "other_milds_latest": latest_price},
        "lags_used_in_regressions": best_lags, "k_enso_k_br_k_vn": [k_enso, k_br, k_vn],
        "arb_volatility": {"tier1_sd_diff3_log": float(inp.tier1["ind_arb_log"].diff(3).std()),
                           "tier1_sd_level_log": float(inp.tier1["ind_arb_log"].std()),
                           "tier2_sd_diff3_log": float(inp.tier2["b1_log"].diff(3).std())},
    }
    (OUT_RESULTS / "summary.json").write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")

    # ── markdown tables ──
    cols = ["tier", "arbitrage", "transform", "index", "best_lag", "r", "n", "n_eff", "p_bartlett", "q_bh", "p_max_surrogate",
            "ci_block_lo", "ci_block_hi", "best_pos_lag", "r_best_pos_lag", "q_bh_best_pos"]
    (OUT_TABLES / "ccf_family_summary.md").write_text(_md(fam_all[cols]), encoding="utf-8")
    (OUT_TABLES / "lag_response_table.md").write_text(_md(lag_table), encoding="utf-8")
    (OUT_TABLES / "event_table_tier1.md").write_text(_md(ev1["table"]), encoding="utf-8")
    (OUT_TABLES / "event_table_tier1_all.md").write_text(_md(ev1_all["table"]), encoding="utf-8")
    (OUT_TABLES / "event_table_tier2.md").write_text(_md(ev2["table"]), encoding="utf-8")
    for ph in ("el_nino", "la_nina"):
        (OUT_TABLES / f"event_summary_tier1_{ph}.md").write_text(
            _md(ev1[ph]["summary"][["h", "n", "mean", "median", "q25", "q75", "min", "max", "consistency", "ci_lo", "ci_hi",
                                    "placebo_q025", "placebo_q975", "p_placebo"]]), encoding="utf-8")
    (OUT_TABLES / "regressions_tier1.md").write_text(_md(reg1), encoding="utf-8")
    (OUT_TABLES / "mechanism_chain.md").write_text(_md(chain), encoding="utf-8")
    (OUT_TABLES / "market_regimes_tier1.md").write_text(_md(mreg), encoding="utf-8")
    (OUT_TABLES / "predictive_conditional.md").write_text(_md(pd.concat([pred1, pred2])), encoding="utf-8")
    (OUT_TABLES / "realtime_signals.md").write_text(_md(inp.signals.assign(month=inp.signals["month"].astype(str))), encoding="utf-8")
    wtab = {k: v for k, v in wx.items() if isinstance(v, pd.DataFrame)}
    (OUT_TABLES / "enso_vs_weather.md").write_text(
        "\n\n".join(f"**{k}**\n\n{_md(v.reset_index().rename(columns={'index': 'var'}))}" for k, v in wtab.items()), encoding="utf-8")
    print("written to", OUT_RESULTS, "and", OUT_TABLES)
    return 0


if __name__ == "__main__":
    _n = int(sys.argv[sys.argv.index("--n-sur") + 1]) if "--n-sur" in sys.argv else 2000
    sys.exit(main(_n))
