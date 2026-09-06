"""Publication charts from outputs/results. Matplotlib, light surface, one axis per panel.

Same palette as the ENSO study — the validated dataviz reference instance
(adjacent CVD ΔE ≥ 8, normal-vision ≥ 15), categorical slots 1–3 only, and no
dual axes anywhere: a green price in USD/kg and a retail index with an arbitrary
base do not share a scale, so they get their own panels.

One extra convention here: the two directions of a price move keep the same
meaning on every figure — a RISE in green wears the warm colour, a FALL the
cool one — so "rockets" and "feathers" are readable without the legend.
"""
from __future__ import annotations

import json

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from .paths import OUT_CHARTS, OUT_RESULTS, ensure_out  # noqa: E402

SURFACE, TXT, TXT2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"
S1, S2, S3 = "#2a78d6", "#eb6834", "#1baf7a"          # categorical 1–3
UP, DOWN, MUTE = "#e34948", "#2a78d6", "#b8b7b1"      # a rise / a fall / not significant

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": TXT2, "xtick.color": TXT2, "ytick.color": TXT2,
    "text.color": TXT, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False, "font.size": 9, "axes.titlesize": 10,
    "axes.titleweight": "bold", "legend.frameon": False, "legend.fontsize": 8,
})


def _summary() -> dict:
    return json.loads((OUT_RESULTS / "summary.json").read_text(encoding="utf-8"))


def _csv(name: str) -> pd.DataFrame:
    return pd.read_csv(OUT_RESULTS / name)


def _series() -> pd.DataFrame:
    s = _csv("monthly_series.csv")
    s = s.rename(columns={s.columns[0]: "month"})
    s["t"] = pd.PeriodIndex(s["month"], freq="M").to_timestamp()
    return s.set_index("t")


def _save(fig, name: str, **adjust) -> None:
    fig.tight_layout()
    if adjust:
        fig.subplots_adjust(**adjust)
    fig.savefig(OUT_CHARTS / name, dpi=150)
    plt.close(fig)


# ── 1. the two legs ──────────────────────────────────────────────────────────

def chart_levels(s: pd.DataFrame, summ: dict) -> None:
    d = s.loc["2011":]
    fig, axes = plt.subplots(2, 1, figsize=(9, 5.6), sharex=True)
    ep = summ["anchor"]["episode"]
    lo = pd.Period(ep["start"], freq="M").to_timestamp()
    hi = pd.Period(ep["end"], freq="M").to_timestamp()
    for ax in axes:
        ax.axvspan(lo, hi, color=UP, alpha=0.07, lw=0)
    axes[0].plot(d.index, d["green_usd_per_kg_roasted"], color=S1, lw=1.4)
    axes[0].set_ylabel("USD / kg roasted-equivalent")
    axes[0].set_title("Green coffee cost embodied in a kilo of roasted coffee (70/30 arabica–robusta)")
    axes[1].plot(d.index, d["retail_us_coffee"], color=S2, lw=1.4)
    axes[1].set_ylabel("index (BLS, SA)")
    axes[1].set_title("US retail coffee price index — BLS CUSR0000SEFP01")
    axes[1].annotate(f"shaded: the green run-up the dollar test uses\n{ep['start']} → {ep['end']}",
                     xy=(0.015, 0.9), xycoords="axes fraction", color=TXT2, fontsize=8, va="top")
    _save(fig, "01_levels.png")


# ── 2. timing ────────────────────────────────────────────────────────────────

def chart_lag_profile(summ: dict) -> None:
    p = _csv("lag_profile_us.csv")
    t = summ["timing"]
    sig = p["pearson"].abs() > p["sur_q95_abs"]
    fig, ax = plt.subplots(figsize=(9, 3.8))
    ax.bar(p["lag"], p["pearson"], color=np.where(sig, S1, MUTE), width=0.72, lw=0)
    ax.plot(p["lag"], p["sur_q95_abs"], color=TXT2, lw=1.0, ls="--",
            label="95 % of phase-randomised surrogates")
    ax.plot(p["lag"], -p["sur_q95_abs"], color=TXT2, lw=1.0, ls="--")
    ax.axvspan(t["sig_band_lo"] - 0.5, t["sig_band_hi"] + 0.5, color=S1, alpha=0.08, lw=0)
    ax.axhline(0, color=TXT2, lw=0.8)
    ax.set_xlabel("months from a green move to the shelf")
    ax.set_ylabel("correlation of monthly log changes")
    ax.set_ylim(-0.36, 0.42)
    ax.set_title(f"The shelf responds over months {t['sig_band_lo']}–{t['sig_band_hi']}, not at one lag "
                 f"(family-wise surrogate p = {t['p_max_surrogate']:.3f})")
    ax.legend(loc="upper right")
    _save(fig, "02_lag_profile.png")


# ── 3. magnitude ─────────────────────────────────────────────────────────────

def chart_cumulative(summ: dict) -> None:
    b = _csv("ecm_betas.csv")
    e = summ["magnitude"]["ecm"]
    theta, se = e["theta_long_run"], e["theta_se_hac"]
    fig, ax = plt.subplots(figsize=(9, 3.8))
    ax.plot(b["lag"], b["cumulative"], color=S1, lw=1.8, marker="o", ms=3.5,
            label="cumulative short-run pass-through, Σβ")
    ax.axhline(theta, color=S3, lw=1.4, ls="-", label=f"long-run elasticity θ = {theta:.3f}")
    ax.fill_between([b["lag"].min(), b["lag"].max()], theta - 1.96 * se, theta + 1.96 * se,
                    color=S3, alpha=0.12, lw=0)
    ax.axhline(summ["magnitude"]["overlapping_12m_slope"]["slope"], color=S2, lw=1.2, ls=":",
               label=f"12-month-change slope = {summ['magnitude']['overlapping_12m_slope']['slope']:.3f}")
    ax.axhline(0, color=TXT2, lw=0.8)
    ax.set_xlabel("months since the green move")
    ax.set_ylabel("elasticity")
    ax.set_title("A green move arrives slowly: nothing at impact, most of θ within a year")
    ax.legend(loc="lower right")
    _save(fig, "03_cumulative_passthrough.png")


# ── 4. the denominator ───────────────────────────────────────────────────────

def chart_cost_share(summ: dict) -> None:
    g = _csv("cost_share_grid.csv")
    # solved, not read off the grid: θ equals the cost share exactly at G/θ
    cross = summ["anchor"]["implied_at_sample_mean"]["implied_retail_usd_per_kg"] / 2.20462
    fig, ax = plt.subplots(figsize=(9, 3.9))
    ax.plot(g["retail_usd_per_lb"], g["passthrough_rate"], color=S1, lw=1.8, marker="o", ms=3.5)
    ax.axhline(1.0, color=TXT2, lw=1.0, ls="--")
    ax.annotate("complete pass-through", xy=(g["retail_usd_per_lb"].max(), 1.0), xytext=(-4, 5),
                textcoords="offset points", ha="right", color=TXT2, fontsize=8)
    ax.axvline(cross, color=S3, lw=1.2, ls=":")
    ax.annotate(f"θ = the green cost share at ${cross:.2f}/lb", xy=(cross, ax.get_ylim()[1]),
                xytext=(6, -12), textcoords="offset points", color=S3, fontsize=8)
    ax.set_xlabel("assumed shelf price, USD per lb (the reader supplies this)")
    ax.set_ylabel("θ ÷ green cost share")
    ax.set_title("θ = 0.29 is only 'a fifth survives' if green is a fifth of the shelf price")
    _save(fig, "04_cost_share_grid.png")


# ── 5. asymmetry ─────────────────────────────────────────────────────────────

def chart_asymmetry(summ: dict) -> None:
    a = summ["asymmetry"]["ecm_split"]
    b = summ["asymmetry"]["bootstrap"]
    fig, axes = plt.subplots(1, 2, figsize=(9.4, 4.1))
    ax = axes[0]
    vals = [a["gamma_pos"], a["gamma_neg"]]
    ses = [a["gamma_pos_se"], a["gamma_neg_se"]]
    ax.bar([0, 1], vals, yerr=[1.96 * s for s in ses], color=[UP, DOWN], width=0.55, lw=0,
           error_kw={"ecolor": TXT2, "capsize": 4, "lw": 1})
    ax.set_xticks([0, 1])
    ax.set_xticklabels(["shelf ABOVE its\nlong-run level", "shelf BELOW its\nlong-run level"])
    ax.axhline(0, color=TXT2, lw=0.8)
    ax.set_ylabel("monthly correction speed γ")
    rejected = b["p_equal_correction_bootstrap"] < 0.05
    ax.set_title(f"Correction looks one-way — {'and the test agrees' if rejected else 'but the test does not confirm it'}"
                 f"\nγ⁺ = γ⁻, bootstrap p = {b['p_equal_correction_bootstrap']:.3f} "
                 f"(asymptotic {a['p_equal_correction']:.3f})", loc="left", fontsize=9)
    ax = axes[1]
    ax.bar([0, 1], [a["cum_up"], a["cum_down"]], color=[UP, DOWN], width=0.55, lw=0)
    ax.set_xticks([0, 1])
    ax.set_xticklabels(["green rising", "green falling"])
    ax.axhline(0, color=TXT2, lw=0.8)
    ax.set_ylabel("cumulative coefficient over 6 months")
    ax.set_title("Short-run response is symmetric"
                 f"\nΣβ⁺ = Σβ⁻ holds, bootstrap p = {b['p_equal_shortrun_bootstrap']:.3f}", loc="left", fontsize=9)
    _save(fig, "05_asymmetry.png")


# ── 6. robustness ────────────────────────────────────────────────────────────

def chart_robustness() -> None:
    r = _csv("robustness.csv").iloc[::-1].reset_index(drop=True)
    y = np.arange(len(r))
    ok = r["cointegrated_5pct"].fillna(False).astype(bool)
    fig, ax = plt.subplots(figsize=(9.6, 4.6))
    ax.errorbar(r["theta"], y, xerr=1.96 * r["theta_se_hac"], fmt="o", ms=5, lw=0,
                elinewidth=1.2, capsize=3, ecolor=TXT2,
                mfc="none", mec="none")
    ax.scatter(r["theta"], y, s=42, color=np.where(ok, S1, MUTE), zorder=3)
    ax.set_yticks(y)
    ax.set_yticklabels([f"{m.replace('US CUSR0000', '')} — {s}" for m, s in zip(r["market"], r["spec"])],
                       fontsize=7.5)
    ax.axvline(0, color=TXT2, lw=0.8)
    ax.set_xlabel("long-run elasticity θ, HAC 95 %")
    ax.set_title("θ ≈ 0.27–0.30 wherever the levels cointegrate (blue);\ngrey = no long-run relationship to read",
                 loc="left")
    _save(fig, "06_robustness.png", left=0.30)


# ── 7. the dollar test ───────────────────────────────────────────────────────

def chart_episode(summ: dict) -> None:
    ep = summ["anchor"]["episode"]
    share = ep["cost_share_break_even"]
    fig, ax = plt.subplots(figsize=(9, 3.6))
    xs = np.linspace(0.05, 1.0, 200)
    ax.plot(xs * 100, (ep["green_kg_start"] / xs) * (ep["retail_factor"] - 1) / ep["green_delta_usd_per_kg"],
            color=S1, lw=1.8)
    ax.axhline(1.0, color=TXT2, lw=1.0, ls="--")
    ax.axvline(share * 100, color=S3, lw=1.2, ls=":")
    ax.annotate(f"break-even at a {share * 100:.0f} % green cost share",
                xy=(share * 100, 1.0), xytext=(8, 14), textcoords="offset points", color=S3, fontsize=8)
    ax.set_xlabel(f"green share of the shelf price in {ep['start']} (%)")
    ax.set_ylabel("dollars added to the shelf ÷ dollars added to green")
    ax.set_ylim(0, 4)
    ax.set_title(f"{ep['start']}→{ep['end']}: green +${ep['green_delta_usd_per_kg']:.2f}/kg, retail +{ep['retail_pct']:.0f} %\n"
                 f"complete pass-through needs only a green share below {share * 100:.0f} %", loc="left")
    _save(fig, "07_dollar_episode.png")


# ── 8. demand ────────────────────────────────────────────────────────────────

def chart_demand(summ: dict) -> None:
    d = _csv("demand_by_lag.csv")
    if d.empty:
        return
    fig, ax = plt.subplots(figsize=(9, 3.6))
    ax.errorbar(d["lag"], d["elasticity"], yerr=1.96 * d["se_hac"], fmt="o", ms=4,
                color=S1, ecolor=TXT2, elinewidth=1, capsize=3, lw=0)
    ax.axhline(0, color=TXT2, lw=0.9)
    ax.set_xlabel("months from a retail price move to the tax receipt")
    ax.set_ylabel("elasticity of German cleared volume")
    ax.set_title(f"No demand response survives: {summ['demand']['n_sig_05']} of "
                 f"{summ['demand']['n_lags_tested']} lags significant at 5 %")
    _save(fig, "08_demand.png")


# ── 9. is it the same everywhere? ────────────────────────────────────────────

def chart_cross_market(summ: dict) -> None:
    prof = _csv("cross_market_lag_profiles.csv")
    xm = _csv("cross_market.csv")
    keys = [k for k in prof["market"].unique()]
    labels = dict(zip(("us", "us_sefp02", "eu_usd", "eu_eur", "br_usd", "br_brl"),
                      ("United States\nCUSR0000SEFP01", "United States\nCUSR0000SEFP02",
                       "Euro area\ngreen in USD", "Euro area\ngreen in EUR",
                       "Brazil\ngreen in USD", "Brazil\ngreen in BRL")))
    rows = (len(keys) + 2) // 3
    fig, axes = plt.subplots(rows, 3, figsize=(10.5, 3.0 * rows), sharey=True)
    for ax, k in zip(np.ravel(axes), keys):
        p = prof[prof["market"] == k]
        r = xm.iloc[keys.index(k)]
        sig = p["pearson"].abs() > p["sur_q95_abs"]
        # blue where the lag clears its own surrogate envelope AND the whole
        # family clears the max-|r| test; grey wherever the family does not,
        # because a single bar is not evidence if the search was not protected
        family_ok = float(r["p_max_surrogate"]) < 0.05
        ax.bar(p["lag"], p["pearson"], color=np.where(sig & family_ok, S1, MUTE), width=0.75, lw=0)
        ax.plot(p["lag"], p["sur_q95_abs"], color=TXT2, lw=0.9, ls="--")
        ax.plot(p["lag"], -p["sur_q95_abs"], color=TXT2, lw=0.9, ls="--")
        ax.axhline(0, color=TXT2, lw=0.8)
        ax.set_title(f"{labels.get(k, k)}\nfamily p = {r['p_max_surrogate']:.3f}"
                     f"{'' if family_ok else '  (not significant)'}", fontsize=8.5, loc="left")
        ax.set_xlabel("lag, months", fontsize=8)
    for ax in np.ravel(axes)[len(keys):]:
        ax.set_visible(False)
    np.ravel(axes)[0].set_ylabel("correlation of monthly log changes")
    fig.suptitle("Only the United States survives a family-wise test — the lag structure is not shared",
                 fontsize=11, fontweight="bold", x=0.01, ha="left")
    _save(fig, "09_cross_market.png", top=0.88)


def main() -> int:
    ensure_out()
    summ, s = _summary(), _series()
    chart_levels(s, summ)
    chart_lag_profile(summ)
    chart_cumulative(summ)
    chart_cost_share(summ)
    chart_asymmetry(summ)
    chart_robustness()
    chart_episode(summ)
    chart_demand(summ)
    chart_cross_market(summ)
    print("charts written to", OUT_CHARTS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
