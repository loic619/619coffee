"""Publication charts from outputs/results. Matplotlib, light surface, one axis per panel.

Palette: the dataviz reference instance (validated: adjacent CVD ΔE ≥ 8,
normal-vision ≥ 15). Categorical slots 1–3 only; diverging blue ↔ red with a
grey midpoint for the regime heat-map; ENSO phases painted with the diverging
poles (El Niño warm, La Niña cool) so the same colour means the same thing on
every figure. Text wears text tokens, never a series colour.
"""
from __future__ import annotations

import json

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm  # noqa: E402

from .paths import OUT_CHARTS, OUT_RESULTS, ensure_out  # noqa: E402

SURFACE, TXT, TXT2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"
S1, S2, S3 = "#2a78d6", "#eb6834", "#1baf7a"          # categorical 1–3
WARM, COOL, MID = "#e34948", "#2a78d6", "#f0efec"      # diverging poles + midpoint
NINO, NINA = WARM, COOL

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": TXT2, "xtick.color": TXT2, "ytick.color": TXT2,
    "text.color": TXT, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False, "font.size": 9, "axes.titlesize": 10,
    "axes.titleweight": "bold", "legend.frameon": False, "legend.fontsize": 8,
})
DIV = LinearSegmentedColormap.from_list("div", [COOL, MID, WARM])


def _p(name: str) -> pd.DataFrame:
    return pd.read_csv(OUT_RESULTS / name)


def _series() -> pd.DataFrame:
    s = _p("monthly_series.csv")
    s = s.rename(columns={s.columns[0]: "month"})
    s["t"] = pd.PeriodIndex(s["month"], freq="M").to_timestamp()
    return s.set_index("t")


def _episodes() -> pd.DataFrame:
    e = _p("enso_episodes_official.csv")
    e["onset_t"] = pd.PeriodIndex(e["onset"], freq="M").to_timestamp()
    e["end_t"] = pd.PeriodIndex(e["end"], freq="M").to_timestamp(how="end")
    return e


def _shade_episodes(ax, eps: pd.DataFrame, lo: pd.Timestamp, hi: pd.Timestamp) -> None:
    for _, e in eps.iterrows():
        if e["end_t"] < lo or e["onset_t"] > hi:
            continue
        ax.axvspan(max(e["onset_t"], lo), min(e["end_t"], hi), color=NINO if e["phase"] == "el_nino" else NINA,
                   alpha=0.10, lw=0)


def _oni_panel(ax, s: pd.DataFrame, lo, hi) -> None:
    o = s.loc[lo:hi, "oni"].dropna()
    cols = np.where(o >= 0.5, NINO, np.where(o <= -0.5, NINA, "#b8b7b1"))
    ax.bar(o.index, o.values, width=26, color=cols, lw=0)
    ax.axhline(0.5, color=NINO, lw=0.8, ls=":")
    ax.axhline(-0.5, color=NINA, lw=0.8, ls=":")
    ax.set_ylabel("ONI (°C)")
    ax.set_title("ENSO — Oceanic Niño Index (red ≥ +0.5 El Niño, blue ≤ −0.5 La Niña)")


def chart_01_02() -> None:
    s, eps = _series(), _episodes()
    # 01: long series
    lo, hi = pd.Timestamp("1980-01-01"), s.index.max()
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 6), sharex=True, gridspec_kw={"height_ratios": [1, 1.4]})
    _oni_panel(a1, s, lo, hi)
    y = s.loc[lo:hi, "ind_arb_log"]
    _shade_episodes(a2, eps, lo, hi)
    a2.plot(y.index, y.values, color=S1, lw=1.4, label="ICO indicator premium: ln(Other Milds / Robustas)")
    f = s.loc[lo:hi, "fut_arb_log"].dropna()
    if len(f):
        a2.plot(f.index, f.values, color=S2, lw=1.2, label="ICE futures premium: ln(KC / RC), repo, 2021→")
    a2.axhline(0, color=TXT2, lw=0.6)
    a2.set_ylabel("log premium")
    a2.set_title("NY–London arbitrage — arabica premium over robusta (shading = official ENSO episodes)")
    a2.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(OUT_CHARTS / "01_enso_vs_ny_london.png", dpi=160)
    plt.close(fig)
    # 02: Tier 2 window
    b = s["b1_log"].dropna()
    if len(b):
        lo2, hi2 = b.index.min() - pd.DateOffset(months=6), b.index.max()
        fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 6), sharex=True, gridspec_kw={"height_ratios": [1, 1.4]})
        _oni_panel(a1, s, lo2, hi2)
        _shade_episodes(a2, eps, lo2, hi2)
        a2.plot(b.index, b.values, color=S1, lw=1.6, label="B1  ln(BR arabica físico / VN robusta FAQ), USD/t interior")
        b3 = s["b3_log"].dropna()
        a2.plot(b3.index, b3.values, color=S3, lw=1.3, label="B3  B1 net of the exchange premium ln(KC/RC)")
        a2.axhline(0, color=TXT2, lw=0.6)
        a2.set_ylabel("log premium")
        a2.set_title("Vietnam–Brazil physical arbitrage (exploratory: 2023-06 → , one El Niño, no La Niña)")
        a2.legend(loc="upper left")
        fig.tight_layout()
        fig.savefig(OUT_CHARTS / "02_enso_vs_vn_br.png", dpi=160)
        plt.close(fig)


def _ccf_panel(ax, c: pd.DataFrame, title: str) -> None:
    c = c.sort_values("lag")
    ax.fill_between(c["lag"], -c["sur_q95_abs"], c["sur_q95_abs"], color="#b8b7b1", alpha=0.25, lw=0,
                    label="surrogate 95 % band (no relationship, same persistence)")
    ax.plot(c["lag"], c["pearson"], color=S1, lw=1.6, label="Pearson r")
    ax.plot(c["lag"], c["spearman"], color=S1, lw=1.0, ls="--", label="Spearman ρ")
    sig = c[c["q_bh_bartlett"] < 0.10]
    if len(sig):
        ax.scatter(sig["lag"], sig["pearson"], s=34, color=S2, zorder=5, label="BH q < 0.10 (Bartlett)")
    sur = c[c["p_surrogate"] < 0.05]
    if len(sur):
        ax.scatter(sur["lag"], sur["pearson"], s=70, facecolors="none", edgecolors=TXT, zorder=6, label="surrogate p < 0.05")
    ax.axvline(0, color=TXT2, lw=0.6)
    ax.axhline(0, color=TXT2, lw=0.6)
    ax.set_xlabel("lag k (months):  k > 0 → ENSO leads the arbitrage;  k < 0 → arbitrage leads ENSO")
    ax.set_ylabel("correlation")
    ax.set_title(title)


def chart_03_04() -> None:
    c = _p("ccf_all_lags.csv")
    for arb, fname in (("ICO indicator premium (1960→)", "03_ccf_enso_ny_london.png"),
                       ("VN–BR physical premium B1", "04_ccf_enso_vn_br.png")):
        fig, axes = plt.subplots(2, 1, figsize=(11, 7))
        for ax, tr, lab in zip(axes, ("level", "diff3"), ("LEVELS — reported, flagged: two persistent series", "3-MONTH CHANGES — the test that counts")):
            sub = c[(c["arbitrage"] == arb) & (c["index"] == "ONI") & (c["transform"] == tr)]
            if sub.empty or sub["pearson"].notna().sum() == 0:
                ax.text(0.5, 0.5, "insufficient overlap", ha="center", transform=ax.transAxes)
                continue
            _ccf_panel(ax, sub, f"ONI → {arb}: {lab}")
        axes[0].legend(loc="upper right", ncol=2)
        fig.tight_layout()
        fig.savefig(OUT_CHARTS / fname, dpi=160)
        plt.close(fig)


def _event_panel(ax, phase: str, name: str, title: str) -> None:
    summ = _p(f"event_{name}_{phase}.csv")
    paths = pd.read_csv(OUT_RESULTS / f"event_paths_{name}_{phase}.csv", index_col=0)
    hcols = [c for c in paths.columns if c.isdigit()]
    if "mean" not in summ.columns or paths.empty:
        ax.text(0.5, 0.5, "no onset of this phase inside the series", ha="center", transform=ax.transAxes)
        ax.set_title(title)
        return
    col = NINO if phase == "el_nino" else NINA
    for _, r in paths.iterrows():
        ax.plot([int(h) for h in hcols], r[hcols].values, color="#b8b7b1", lw=0.8, alpha=0.9)
    if "placebo_q025" in summ:
        ax.fill_between(summ["h"], summ["placebo_q025"], summ["placebo_q975"], color="#b8b7b1", alpha=0.25, lw=0,
                        label="placebo 95 % band (same n of random neutral onsets)")
    ax.fill_between(summ["h"], summ["q25"], summ["q75"], color=col, alpha=0.18, lw=0, label="inter-quartile range of events")
    ax.plot(summ["h"], summ["mean"], color=col, lw=2.2, label=f"mean of n = {int(summ['n'].max())} events")
    ax.plot(summ["h"], summ["median"], color=col, lw=1.2, ls="--", label="median")
    ax.axhline(0, color=TXT2, lw=0.6)
    ax.set_xlabel("months after onset")
    ax.set_ylabel("Δ log premium since onset")
    ax.set_title(title)
    ax.legend(loc="upper left", fontsize=7)


def chart_05_06() -> None:
    for phase, fname, lab in (("el_nino", "05_event_study_el_nino.png", "El Niño"), ("la_nina", "06_event_study_la_nina.png", "La Niña")):
        fig, axes = plt.subplots(1, 2, figsize=(12, 4.6))
        _event_panel(axes[0], phase, "tier1", f"{lab} onsets → NY–London (ICO indicator premium, 1980→)")
        _event_panel(axes[1], phase, "tier2", f"{lab} onsets → VN–BR physical (2023→, exploratory)")
        fig.tight_layout()
        fig.savefig(OUT_CHARTS / fname, dpi=160)
        plt.close(fig)


def chart_07() -> None:
    fig, axes = plt.subplots(2, 1, figsize=(11, 5.6))
    for ax, name, title in zip(axes, ("tier1", "tier2"),
                               ("ONI(t−k) × Δ3 NY–London premium(t), by ENSO state at t−k", "ONI(t−k) × Δ3 VN–BR premium(t), by ENSO state at t−k (exploratory)")):
        g = _p(f"regime_lag_grid_{name}.csv")
        regs = ["el_nino", "neutral", "la_nina"]
        M = np.full((3, 25), np.nan)
        P = np.full((3, 25), np.nan)
        for i, reg in enumerate(regs):
            sub = g[g["regime"] == reg].set_index("lag")
            for k in range(25):
                if k in sub.index and pd.notna(sub.loc[k].get("r", np.nan)):
                    M[i, k] = sub.loc[k, "r"]
                    P[i, k] = sub.loc[k, "p_bartlett"]
        vmax = np.nanmax(np.abs(M)) if np.isfinite(M).any() else 0.5
        im = ax.imshow(M, cmap=DIV, norm=TwoSlopeNorm(0, -vmax, vmax), aspect="auto")
        ax.set_yticks(range(3))
        ax.set_yticklabels(["El Niño", "neutral", "La Niña"])
        ax.set_xticks(range(0, 25, 2))
        ax.set_xlabel("lag k (months, ENSO leads)")
        for i in range(3):
            for k in range(25):
                if np.isfinite(M[i, k]):
                    mark = "•" if (np.isfinite(P[i, k]) and P[i, k] < 0.05) else ""
                    ax.text(k, i, f"{M[i, k]:+.2f}{mark}", ha="center", va="center", fontsize=6, color=TXT)
        ax.set_title(title + "   (• Bartlett p < 0.05, uncorrected)")
        ax.grid(False)
        fig.colorbar(im, ax=ax, fraction=0.02, pad=0.01, label="r")
    fig.tight_layout()
    fig.savefig(OUT_CHARTS / "07_regime_lag_heatmap.png", dpi=160)
    plt.close(fig)


def chart_08() -> None:
    f = _p("ccf_family_summary.csv")
    f = f[(f["arbitrage"] == "ICO indicator premium (1960→)") & (f["index"].isin(["ONI", "ONI⁺", "ONI⁻"]))].copy()
    f = f.dropna(subset=["r"])
    order = ["level", "z", "sa", "diff3", "diff1", "sa_diff1"]
    f["o"] = f["transform"].map({t: i for i, t in enumerate(order)})
    f = f.sort_values(["o", "index"])
    fig, ax = plt.subplots(figsize=(10, 5))
    ypos = np.arange(len(f))
    cols = f["index"].map({"ONI": S1, "ONI⁺": NINO, "ONI⁻": NINA})
    ax.hlines(ypos, f["ci_block_lo"], f["ci_block_hi"], color=cols, lw=2, alpha=0.6)
    ax.scatter(f["r"], ypos, color=cols, s=40, zorder=5)
    surv = f[f["p_max_surrogate"] < 0.05]
    ax.scatter(surv["r"], [ypos[i] for i in np.where(f["p_max_surrogate"] < 0.05)[0]], s=110, facecolors="none",
               edgecolors=TXT, zorder=6, label="best lag survives the max-|r| surrogate test (p < 0.05)")
    ax.set_yticks(ypos)
    ax.set_yticklabels([f"{t}  ·  {i}  ·  lag {int(k):+d}" for t, i, k in zip(f["transform"], f["index"], f["best_lag"])], fontsize=7)
    ax.axvline(0, color=TXT2, lw=0.6)
    ax.set_xlabel("r at the best lag (block-bootstrap 95 % CI)")
    ax.set_title("Robustness across transformations — NY–London premium vs ONI (blue), ONI⁺ El Niño (red), ONI⁻ La Niña (blue)")
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(OUT_CHARTS / "08_robustness_transforms.png", dpi=160)
    plt.close(fig)


def chart_09() -> None:
    ch = _p("mechanism_chain.csv").dropna(subset=["r"])
    fig, ax = plt.subplots(figsize=(10, 0.45 * len(ch) + 1.5))
    ypos = np.arange(len(ch))[::-1]
    cols = [S2 if p < 0.05 else "#b8b7b1" for p in ch["p_max_surrogate"].fillna(1)]
    ax.barh(ypos, ch["r"], color=cols, height=0.6)
    for y, (_, r) in zip(ypos, ch.iterrows()):
        ax.text(r["r"] + (0.01 if r["r"] >= 0 else -0.01), y,
                f"lag {int(r['lag'])}, n_eff {r['n_eff']:.0f}, p_max {r['p_max_surrogate']:.2f}",
                va="center", ha="left" if r["r"] >= 0 else "right", fontsize=7, color=TXT2)
    ax.set_yticks(ypos)
    ax.set_yticklabels([f"{a} → {b}" for a, b in zip(ch["from"], ch["to"])], fontsize=8)
    ax.axvline(0, color=TXT2, lw=0.6)
    ax.set_xlabel("r at best lag (orange = survives the max-|r| surrogate test at 5 %)")
    ax.set_title("The mechanism chain, link by link")
    fig.tight_layout()
    fig.savefig(OUT_CHARTS / "09_mechanism_chain.png", dpi=160)
    plt.close(fig)


def chart_10() -> None:
    p = _p("predictive_conditional.csv")
    p = p[(p["series"] == "ICO indicator premium") & (p["signal"].str.startswith("real-time")) & (p["sample"] == "all")]
    fig, ax = plt.subplots(figsize=(9, 4.4))
    hs = [3, 6, 12]
    w = 0.27
    for i, (phase, col, lab) in enumerate((("el_nino", NINO, "after an El Niño signal"), ("la_nina", NINA, "after a La Niña signal"))):
        sub = p[p["phase"] == phase].set_index("h").reindex(hs)
        x = np.arange(len(hs)) + (i - 0.5) * w
        ax.bar(x, sub["mean"], width=w, color=col, label=f"{lab} (n = {int(sub['n_signals'].max())})")
        ax.errorbar(x, sub["mean"], yerr=[sub["mean"] - sub["ci_lo"], sub["ci_hi"] - sub["mean"]], fmt="none", ecolor=TXT, lw=1)
        for xi, (_, r) in zip(x, sub.iterrows()):
            ax.text(xi, max(r["ci_hi"], 0) + 0.01, f"hit {r['hit_rate']:.0%}", ha="center", fontsize=7, color=TXT2)
    neu = p[p["phase"] == "el_nino"].set_index("h").reindex(hs)["neutral_mean"]
    ax.plot(np.arange(len(hs)), neu, color=TXT2, marker="_", ms=22, lw=0, label="mean in neutral months")
    ax.set_xticks(range(len(hs)))
    ax.set_xticklabels([f"+{h} m" for h in hs])
    ax.axhline(0, color=TXT2, lw=0.6)
    ax.set_ylabel("forward Δ log premium")
    ax.set_title("What the NY–London premium did after a real-time ENSO signal (false alarms included), 1981→")
    ax.legend(loc="upper left", fontsize=7)
    fig.tight_layout()
    fig.savefig(OUT_CHARTS / "10_predictive_conditional.png", dpi=160)
    plt.close(fig)


def main() -> int:
    ensure_out()
    chart_01_02()
    chart_03_04()
    chart_05_06()
    chart_07()
    chart_08()
    chart_09()
    chart_10()
    written = sorted(p.name for p in OUT_CHARTS.glob("*.png"))
    (OUT_CHARTS / "INDEX.json").write_text(json.dumps(written, indent=1), encoding="utf-8")
    print("\n".join(written))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
