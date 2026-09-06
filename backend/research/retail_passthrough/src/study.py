"""Run the whole study: inputs → machine-readable results → markdown tables.

    cd backend && PYTHONPATH=. python -m research.retail_passthrough.src.study

Headline market is the United States (BLS CUSR0000SEFP01, 2011-01→), because it
is the only consuming market where the repo holds a retail series long enough to
estimate a long-run relationship. The second US series, the EU basket and Brazil
run beside it as robustness, and each is reported with the reason it is weaker.

Every number written to outputs/ is produced here; REPORT.md quotes them and
adds nothing of its own.
"""
from __future__ import annotations

import json
import sys

import pandas as pd

from . import data as D
from . import model as M
from .paths import OUT_RESULTS, OUT_TABLES, ensure_out

MAX_LAG = 24
#: Shelf prices the cost-share grid is tabulated over, USD per kilo of roasted
#: coffee. Deliberately wide — the study does not own a retail price level, so
#: it hands the reader a row for whatever they pay rather than asserting one.
PRICE_GRID = (8, 10, 12, 15, 18, 20, 25, 30, 40)
#: Roast yields for the sensitivity run. 0.84 is the working figure; the range
#: spans a light city roast to a dark one.
ROAST_YIELDS = (0.80, 0.82, 0.84, 0.86, 0.88)


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


def _n(d: pd.DataFrame) -> int:
    """Months actually observed — `_pair` keeps holes as NaN rows, so len() lies."""
    return int(d.dropna().shape[0])


def _pair(green_kg: pd.Series, retail: pd.Series) -> pd.DataFrame:
    """Both legs in logs on one gap-free monthly grid — see `model._aligned` for
    why a hole must survive as a hole rather than be closed up."""
    return M._aligned(D.log(green_kg), D.log(retail))


# ── the four legs ────────────────────────────────────────────────────────────

def timing(lg: pd.Series, lr: pd.Series, n_sur: int) -> tuple[pd.DataFrame, dict]:
    """Differences are taken on each series' own full history before alignment —
    green runs to 1960, so truncating it to the retail window would throw away
    a real observation at the join for no reason."""
    prof = M.lag_profile(lg.diff(), lr.diff(), max_lag=MAX_LAG, n_sur=n_sur)
    return prof, M.plateau(prof)


def magnitude(d: pd.DataFrame) -> dict:
    eg = M.engle_granger(d["g"], d["r"])
    e = M.ecm(d["g"], d["r"])
    s = M.overlapping_slope(d["g"], d["r"], window=12, lag=5)
    return {"cointegration": eg, "ecm": e, "overlapping_12m_slope": s}


def anchor(theta: float, green_kg: pd.Series, retail: pd.Series, episode: tuple) -> dict:
    """θ inverted into a price level — the study's sharpest falsification.

    θ is a log-log elasticity fitted over the whole sample, so it is an average
    cost share over that sample, NOT the cost share at today's green price. The
    anchor is therefore reported at the sample MEAN green cost first, where the
    identity is on its own terms, and at the latest month second, where it is a
    statement about how far the current spike has travelled.
    """
    g = green_kg.dropna()
    latest_month, latest = g.index.max(), float(g.iloc[-1])
    mean_g, med_g = float(g.mean()), float(g.median())
    grid = M.cost_share_grid(mean_g * 1000.0 * D.ROAST_YIELD, PRICE_GRID, theta)
    return {"latest_month": str(latest_month), "latest_green_usd_per_kg_roasted": latest,
            "mean_green_usd_per_kg_roasted": mean_g, "median_green_usd_per_kg_roasted": med_g,
            "implied_at_sample_mean": M.implied_retail(theta, mean_g * 1000.0 * D.ROAST_YIELD),
            "implied_at_latest": M.implied_retail(theta, latest * 1000.0 * D.ROAST_YIELD),
            "grid": grid, "grid_green_basis": "sample mean green cost per roasted kg",
            "episode": M.dollar_episode(green_kg, retail, *episode)}


def asymmetry(d: pd.DataFrame, n_boot: int = 1000) -> dict:
    """The Wald tests, plus the simulated null that tells you what they are worth.

    The asymptotic HAC test over-rejects here — measured at ~10 % for a nominal
    5 % on symmetric synthetic data — so the verdict is taken from the bootstrap
    and the asymptotic p is reported beside it as the number NOT to quote.
    """
    return {"ecm_split": M.asymmetric_ecm(d["g"], d["r"], sr_lags=6),
            "bootstrap": M.asymmetry_bootstrap_p(d["g"], d["r"], sr_lags=6, n_boot=n_boot),
            "sign_split_slope": M.sign_split_slope(d["g"], d["r"], window=12, lag=5)}


# ── robustness ───────────────────────────────────────────────────────────────

def robustness(green: pd.DataFrame, retail: pd.DataFrame, cpi: pd.Series, fx: pd.Series) -> pd.DataFrame:
    """One row per specification: does θ move when the choices move?"""
    gk = {k: D.green_cost_per_kg_roasted(green[k]) for k in ("arabica", "robusta", "blend")}
    specs: list[tuple[str, str, pd.Series, pd.Series, int]] = [
        ("US CUSR0000SEFP01 (headline)", "blend 70/30, nominal", gk["blend"], retail["us_coffee"], 12),
        ("US CUSR0000SEFP01", "arabica only", gk["arabica"], retail["us_coffee"], 12),
        ("US CUSR0000SEFP01", "robusta only", gk["robusta"], retail["us_coffee"], 12),
        ("US CUSR0000SEFP01", "blend 50/50", D.green_cost_per_kg_roasted(
            D.blend(green["arabica"], green["robusta"], 0.50)), retail["us_coffee"], 12),
        ("US CUSR0000SEFP01", "blend 90/10", D.green_cost_per_kg_roasted(
            D.blend(green["arabica"], green["robusta"], 0.90)), retail["us_coffee"], 12),
        ("US CUSR0000SEFP01", "real, CPI-deflated (2017→)", (gk["blend"] / cpi).dropna(),
         (retail["us_coffee"] / cpi).dropna(), 12),
        ("US CUSR0000SEFP02", "blend 70/30, nominal", gk["blend"], retail["us"], 12),
        ("EU HICP basket", "blend 70/30, nominal", gk["blend"], retail["eu"], 12),
        ("Brazil IPCA café moído", "blend 70/30, green in BRL", (gk["blend"] * fx).dropna(), retail["brazil"], 6),
    ]
    rows = []
    for market, spec, g, r, sr in specs:
        d = _pair(g, r)
        eg, e = M.engle_granger(d["g"], d["r"]), M.ecm(d["g"], d["r"], sr_lags=sr)
        s = M.overlapping_slope(d["g"], d["r"], window=12, lag=5)
        rows.append({"market": market, "spec": spec, "n": _n(d),
                     "first": str(d.index.min()), "last": str(d.index.max()),
                     "eg_p": eg.get("eg_p"), "cointegrated_5pct": eg.get("cointegrated_5pct"),
                     "theta": e.get("theta_long_run"), "theta_se_hac": e.get("theta_se_hac"),
                     "n_eff": e.get("n_eff"),
                     "cum_passthrough_12m": (e.get("cum_passthrough") or {}).get(sr),
                     "gamma": e.get("gamma"), "gamma_p": e.get("gamma_p"),
                     "slope_12m_lag5": s.get("slope"), "slope_p_hac": s.get("p_hac"),
                     "slope_n_eff": s.get("n_eff")})
    return pd.DataFrame(rows)


#: One entry per consuming market the repo can actually test. `currency` is the
#: currency the retail index is denominated in — the green leg is converted into
#: it before the regression, because a euro shelf price regressed on a dollar
#: green price is partly a regression on the exchange rate.
MARKETS = (
    {"key": "us", "label": "United States", "retail": "us_coffee",
     "series": "BLS CUSR0000SEFP01", "currency": "USD"},
    {"key": "us_sefp02", "label": "United States (second basket)", "retail": "us",
     "series": "BLS CUSR0000SEFP02", "currency": "USD"},
    {"key": "eu_usd", "label": "Euro area (green in USD)", "retail": "eu",
     "series": "Eurostat HICP CP01211, DE/FR/IT/ES", "currency": "USD"},
    {"key": "eu_eur", "label": "Euro area (green in EUR)", "retail": "eu",
     "series": "Eurostat HICP CP01211, DE/FR/IT/ES", "currency": "EUR"},
    {"key": "br_usd", "label": "Brazil (green in USD)", "retail": "brazil",
     "series": "IPCA café moído, BCB SGS 1635", "currency": "USD"},
    {"key": "br_brl", "label": "Brazil (green in BRL)", "retail": "brazil",
     "series": "IPCA café moído, BCB SGS 1635", "currency": "BRL"},
)


def cross_market(green_kg: pd.Series, retail: pd.DataFrame, n_sur: int = 1000,
                 n_boot: int = 400) -> tuple[pd.DataFrame, dict]:
    """Is the relationship the same in every consuming market the repo holds?

    The same four questions asked market by market, so the answer is a table
    rather than an assertion. Each market's green leg is converted into that
    market's own currency first; where the FX series starts later than the
    retail index the sample shortens and the row says so.

    Japan and China are absent because the repository holds no retail price
    series for them at all — see §11 of the report for exactly what would have
    to be fetched.
    """
    rows, profiles = [], {}
    for m in MARKETS:
        r = retail[m["retail"]]
        g = green_kg if m["currency"] == "USD" else green_kg * D.local_per_usd(m["currency"])
        d = _pair(g, r)
        if _n(d) < 60:
            rows.append({**_market_id(m), "n": _n(d), "note": "too short to estimate"})
            continue
        prof = M.lag_profile(D.log(g).diff(), D.log(r).diff(), max_lag=MAX_LAG, n_sur=n_sur)
        plat = M.plateau(prof)
        profiles[m["key"]] = prof
        eg, e = M.engle_granger(d["g"], d["r"]), M.ecm(d["g"], d["r"], sr_lags=6)
        s = M.overlapping_slope(d["g"], d["r"], window=12, lag=5)
        gsub = g.reindex(d.index).dropna()
        ep = M.dollar_episode(g.reindex(d.index), r.reindex(d.index), gsub.idxmin(), d.index.max())
        boot = M.asymmetry_bootstrap_p(d["g"], d["r"], sr_lags=6, n_boot=n_boot)
        rows.append({**_market_id(m), "n": _n(d), "months_missing": int(len(d) - _n(d)),
                     "first": str(d.index.min()), "last": str(d.index.max()),
                     "peak_lag": plat.get("peak_lag"), "peak_r": plat.get("peak_r"),
                     "band_lo": plat.get("sig_band_lo"), "band_hi": plat.get("sig_band_hi"),
                     "p_max_surrogate": plat.get("p_max_surrogate"),
                     "eg_p": eg.get("eg_p"), "cointegrated_5pct": eg.get("cointegrated_5pct"),
                     "theta": e.get("theta_long_run"), "theta_se_hac": e.get("theta_se_hac"),
                     "n_eff": e.get("n_eff"),
                     "slope_12m_lag5": s.get("slope"), "slope_p_hac": s.get("p_hac"),
                     "episode_start": ep.get("start"), "episode_green_delta": ep.get("green_delta_usd_per_kg"),
                     "episode_retail_pct": ep.get("retail_pct"),
                     "cost_share_break_even": ep.get("cost_share_break_even"),
                     "asym_correction_p_boot": (boot or {}).get("p_equal_correction_bootstrap"),
                     "asym_shortrun_p_boot": (boot or {}).get("p_equal_shortrun_bootstrap"),
                     "note": ""})
    return pd.DataFrame(rows), profiles


def _market_id(m: dict) -> dict:
    # `key` travels into the payload so the article can join a lag profile to its
    # summary row by identity rather than by row order.
    return {"key": m["key"], "market": m["label"], "retail_series": m["series"], "currency": m["currency"]}


def roast_yield_sensitivity(green_usd_t: float, theta: float) -> pd.DataFrame:
    """θ is estimated on logs and is invariant to the roast yield — the yield
    only moves the LEVEL the anchor inverts to. Tabulated so the reader can see
    that the headline elasticity does not depend on the conversion."""
    return pd.DataFrame([{"roast_yield": y,
                          "green_usd_per_kg_roasted": green_usd_t / 1000.0 / y,
                          "implied_retail_usd_per_kg": green_usd_t / 1000.0 / y / theta,
                          "implied_retail_usd_per_lb": green_usd_t / 1000.0 / y / theta / 2.20462}
                         for y in ROAST_YIELDS])


def subsample(d: pd.DataFrame, split: str = "2019-12") -> pd.DataFrame:
    """Halves. The 2021-25 green spike dominates the sample; if every result
    comes from it, the reader should be told rather than left to guess."""
    p = pd.Period(split, freq="M")
    rows = []
    for name, part in (("full", d), ("pre-2020", d[d.index <= p]), ("2020→", d[d.index > p])):
        if _n(part) < 40:
            rows.append({"sample": name, "n": _n(part), "note": "too short to estimate"})
            continue
        eg, e = M.engle_granger(part["g"], part["r"]), M.ecm(part["g"], part["r"], sr_lags=6)
        s = M.overlapping_slope(part["g"], part["r"], window=12, lag=5)
        rows.append({"sample": name, "n": _n(part), "first": str(part.index.min()),
                     "last": str(part.index.max()), "eg_p": eg.get("eg_p"),
                     "theta": e.get("theta_long_run"), "cum_passthrough": (e.get("cum_passthrough") or {}).get(6),
                     "slope_12m_lag5": s.get("slope"), "slope_p_hac": s.get("p_hac"), "note": ""})
    return pd.DataFrame(rows)


def demand(retail: pd.DataFrame) -> dict:
    vol, vmeta = D.german_volume()
    price = retail["eu"].dropna()
    res = M.demand_response(D.log(price), D.log(vol), max_lag=12)
    res["volume_meta"] = vmeta
    res["price_series"] = "EU HICP coffee basket (DE/FR/IT/ES proxy) — the closest price the repo holds to the German till"
    res["overlap"] = {"first": str(max(price.index.min(), vol.index.min())),
                      "last": str(min(price.index.max(), vol.index.max()))}
    return res


# ── main ─────────────────────────────────────────────────────────────────────

def main(n_sur: int = 2000) -> int:
    ensure_out()
    green, gmeta = D.green()
    retail, rmeta = D.retail()
    cpi, cmeta = D.us_cpi_all_items()
    fx = D.usdbrl_monthly()

    gk = D.green_cost_per_kg_roasted(green["blend"])
    head = _pair(gk, retail["us_coffee"])
    missing = [str(p) for p in head.index[head.isna().any(axis=1)]]
    print(f"headline sample {head.index.min()} → {head.index.max()} "
          f"(n={_n(head)}, missing months: {missing or 'none'})")

    prof, plat = timing(D.log(gk), D.log(retail["us_coffee"]), n_sur)
    mag = magnitude(head)
    theta = mag["ecm"]["theta_long_run"]
    # The episode is the sample's own green trough-to-peak, chosen by the data
    # rather than by hand: the largest run-up available is the one with the most
    # power to move a shelf price.
    gsub = gk.reindex(head.index).dropna()
    lo_m = gsub.idxmin()
    hi_m = gsub.loc[lo_m:].idxmax()
    end_m = head.index.max()
    anch = anchor(theta, gk.reindex(head.index), retail["us_coffee"].reindex(head.index), (lo_m, end_m))
    anch["episode_peak"] = M.dollar_episode(gk.reindex(head.index), retail["us_coffee"].reindex(head.index), lo_m, hi_m)
    asym = asymmetry(head)
    rob = robustness(green, retail, cpi, fx)
    xm, xprof = cross_market(gk, retail, n_sur=min(n_sur, 1000))
    sub = subsample(head)
    dem = demand(retail)
    ry = roast_yield_sensitivity(float(green["blend"].reindex(head.index).mean()), theta)

    # ── write ──
    prof.to_csv(OUT_RESULTS / "lag_profile_us.csv", index=False)
    rob.to_csv(OUT_RESULTS / "robustness.csv", index=False)
    xm.to_csv(OUT_RESULTS / "cross_market.csv", index=False)
    pd.concat([p.assign(market=k) for k, p in xprof.items()], ignore_index=True) \
        .to_csv(OUT_RESULTS / "cross_market_lag_profiles.csv", index=False)
    sub.to_csv(OUT_RESULTS / "subsamples.csv", index=False)
    anch["grid"].to_csv(OUT_RESULTS / "cost_share_grid.csv", index=False)
    ry.to_csv(OUT_RESULTS / "roast_yield_sensitivity.csv", index=False)
    pd.DataFrame(dem.get("by_lag", [])).to_csv(OUT_RESULTS / "demand_by_lag.csv", index=False)
    pd.DataFrame([{"lag": k, "beta": v, "p": mag["ecm"]["beta_p"][k],
                   "cumulative": float(sum(mag["ecm"]["betas"][j] for j in range(k + 1)))}
                  for k, v in mag["ecm"]["betas"].items()]).to_csv(OUT_RESULTS / "ecm_betas.csv", index=False)

    series = pd.concat([green.add_prefix("green_"), gk.rename("green_usd_per_kg_roasted"),
                        retail.add_prefix("retail_"), cpi.rename("us_cpi_all_items")], axis=1)
    series = series.loc[series.index >= pd.Period("2010-01", freq="M")]
    series.index = series.index.astype(str)
    series.to_csv(OUT_RESULTS / "monthly_series.csv")

    summary = {
        "headline": {"market": "US", "retail_series": "BLS CUSR0000SEFP01",
                     "green": "ICO/Pink Sheet 70/30 arabica–robusta, converted to USD per kg ROASTED at a 0.84 yield",
                     "n": _n(head), "first": str(head.index.min()), "last": str(head.index.max()),
                     "months_missing": missing},
        "timing": plat, "magnitude": mag, "anchor": {k: v for k, v in anch.items() if k != "grid"},
        "asymmetry": asym, "demand": {k: v for k, v in dem.items() if k != "by_lag"},
        "cross_market": xm.to_dict("records"),
        "markets_not_covered": {
            "japan": "no retail coffee price series in the repository. Japan's Statistics Bureau Retail "
                     "Price Survey publishes an actual ¥ per 100 g — a price LEVEL, which would also close "
                     "the study's single biggest gap (§11.1).",
            "china": "no retail coffee price series in the repository. NBS publishes CPI subcategories but "
                     "not a coffee line at monthly frequency.",
            "note": "both would need a fetch, which in this repo runs on a GitHub Actions runner, not here.",
        },
        "meta": {"green": gmeta, "retail": rmeta, "us_cpi": cmeta,
                 "usdbrl_months": int(len(fx)), "roast_yield": D.ROAST_YIELD,
                 "n_surrogates": n_sur},
        "data_caveats": [
            "The retail leg is an INDEX, not a price. Nothing in the repo gives a coffee price per kilo, "
            "so the cost share is bounded and inverted rather than measured.",
            f"The EU basket stops at {rmeta['last_observation'].get('eu')} while the US and Brazil run to "
            f"{max(rmeta['last_observation'].values())}; the EU is therefore robustness, never headline.",
            "US CPI-U in the repo is a rolling ~10-year window, so the real-terms specification starts 2017-01.",
            "retail_cpi.json names CUSR0000SEFP01 'Coffee, all' and CUSR0000SEFP02 'Roasted coffee'. The data "
            "contradict that ordering — SEFP02 moves 2.5x less on 12-month changes and does not cointegrate "
            "with green — so the study cites both by series ID and treats the names as unverified.",
        ],
        "test_count": {
            "lag_profile": MAX_LAG + 1,
            "note": "the lag scan is protected by a max-|r| phase-randomised surrogate test (family-wise, "
                    "p_max_surrogate) and BH-FDR across lags; the two asymmetry tests are size-corrected by "
                    "a recursive block bootstrap under a symmetric null, and the report reads the pair at a "
                    "Bonferroni-halved 0.025.",
        },
    }
    (OUT_RESULTS / "summary.json").write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")

    # ── markdown tables ──
    (OUT_TABLES / "lag_profile_us.md").write_text(
        _md(prof[["lag", "pearson", "spearman", "n", "n_eff", "p_bartlett", "q_bh", "p_surrogate", "sur_q95_abs"]]),
        encoding="utf-8")
    (OUT_TABLES / "robustness.md").write_text(_md(rob), encoding="utf-8")
    (OUT_TABLES / "cross_market.md").write_text(_md(xm), encoding="utf-8")
    (OUT_TABLES / "subsamples.md").write_text(_md(sub), encoding="utf-8")
    (OUT_TABLES / "cost_share_grid.md").write_text(_md(anch["grid"]), encoding="utf-8")
    (OUT_TABLES / "roast_yield_sensitivity.md").write_text(_md(ry), encoding="utf-8")
    if dem.get("by_lag"):
        (OUT_TABLES / "demand_by_lag.md").write_text(_md(pd.DataFrame(dem["by_lag"])), encoding="utf-8")
    (OUT_TABLES / "headline.md").write_text("\n".join([
        f"- sample: {head.index.min()} → {head.index.max()} (n = {_n(head)}, n_eff = {mag['ecm']['n_eff']:.1f}"
        f"{'; missing ' + ', '.join(missing) if missing else ''})",
        f"- timing: peak lag {plat['peak_lag']} months, significant band {plat['sig_band_lo']}–{plat['sig_band_hi']}, "
        f"family-wise surrogate p = {plat['p_max_surrogate']:.4f}",
        f"- cointegrated: {mag['cointegration']['cointegrated_5pct']} (Engle–Granger p = {mag['cointegration']['eg_p']:.4f})",
        f"- long-run elasticity θ = {theta:.3f} (HAC SE {mag['ecm']['theta_se_hac']:.3f})",
        f"- cumulative short-run pass-through after 12 months = {mag['ecm']['cum_passthrough'][12]:.3f}",
        f"- 12-month-change slope at lag 5 = {mag['overlapping_12m_slope']['slope']:.3f} "
        f"(n = {mag['overlapping_12m_slope']['n']}, n_eff = {mag['overlapping_12m_slope']['n_eff']:.1f})",
        f"- complete dollar pass-through over {anch['episode']['start']}→{anch['episode']['end']} needs green to have been "
        f"under {anch['episode']['cost_share_break_even'] * 100:.1f}% of the base shelf price",
        f"- θ inverted at the sample-mean green cost implies a shelf price of "
        f"${anch['implied_at_sample_mean']['implied_retail_usd_per_kg']:.2f}/kg "
        f"(${anch['implied_at_sample_mean']['implied_retail_usd_per_kg'] / 2.20462:.2f}/lb)",
        f"- asymmetry, bootstrap p (asymptotic in brackets): short-run "
        f"{asym['bootstrap']['p_equal_shortrun_bootstrap']:.3f} "
        f"({asym['ecm_split']['p_equal_shortrun']:.4f}), correction "
        f"{asym['bootstrap']['p_equal_correction_bootstrap']:.3f} "
        f"({asym['ecm_split']['p_equal_correction']:.4f}) → {asym['bootstrap']['verdict']}",
    ]), encoding="utf-8")
    print("written to", OUT_RESULTS, "and", OUT_TABLES)
    print(f"θ={theta:.3f}  peak lag={plat['peak_lag']}  band={plat['sig_band_lo']}–{plat['sig_band_hi']}  "
          f"asym={asym['ecm_split']['verdict']}")
    return 0


if __name__ == "__main__":
    _sur = int(sys.argv[sys.argv.index("--n-sur") + 1]) if "--n-sur" in sys.argv else 2000
    sys.exit(main(_sur))
