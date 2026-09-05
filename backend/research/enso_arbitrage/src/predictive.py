"""The trading question, asked last and asked plainly.

"When an ENSO signal first becomes observable under the REAL-TIME rule, what
did the arbitrage do over the next 3 / 6 / 12 months?" — a conditional
distribution of forward changes, set against the unconditional one and against
neutral months. No thresholds fitted, no strategy, no parameters to overfit:
the signal months come from enso.realtime_signals, which uses the repo's own
long-standing rule, and the horizons are the ones in the brief.

False alarms stay in. A desk acting on the signal in Jan-2025 did not know the
event would never be confirmed.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

HORIZONS = (3, 6, 12)


def forward_changes(arb: pd.Series, horizons=HORIZONS) -> pd.DataFrame:
    """fwd_h(t) = arb(t+h) − arb(t) for every month t."""
    return pd.DataFrame({f"fwd_{h}": arb.shift(-h) - arb for h in horizons})


def conditional(arb: pd.Series, signal_months: list[pd.Period], neutral_months: list[pd.Period],
                horizons=HORIZONS, n_boot: int = 4000, seed: int = 9) -> pd.DataFrame:
    """Per horizon: n signals, mean/median forward change after a signal, hit rate
    (share with the sign of the mean), the same for neutral months and for all
    months, a bootstrap CI on the conditional mean (resampling SIGNALS), and a
    two-sided p for 'conditional mean differs from the neutral mean' by drawing
    n signal-sized samples from neutral months."""
    fwd = forward_changes(arb, horizons)
    rng = np.random.default_rng(seed)
    rows = []
    for h in horizons:
        col = f"fwd_{h}"
        sig = fwd[col].reindex([m for m in signal_months if m in fwd.index]).dropna()
        neu = fwd[col].reindex([m for m in neutral_months if m in fwd.index]).dropna()
        allv = fwd[col].dropna()
        n = len(sig)
        row = {"h": h, "n_signals": n, "n_neutral": len(neu)}
        if n == 0:
            rows.append(row)
            continue
        mean = float(sig.mean())
        sgn = np.sign(mean) if mean != 0 else 1
        boots = rng.choice(sig.to_numpy(float), size=(n_boot, n), replace=True).mean(axis=1) if n >= 2 else np.array([mean])
        # neutral draws of the same size: the distribution of a "signal mean" when the signal is noise
        if len(neu) >= n and n >= 1:
            draws = rng.choice(neu.to_numpy(float), size=(n_boot, n), replace=True).mean(axis=1)
            p_vs_neutral = float((np.abs(draws - neu.mean()) >= abs(mean - neu.mean())).mean())
        else:
            p_vs_neutral = np.nan
        row.update({"mean": mean, "median": float(sig.median()), "hit_rate": float((np.sign(sig) == sgn).mean()),
                    "ci_lo": float(np.quantile(boots, 0.025)), "ci_hi": float(np.quantile(boots, 0.975)),
                    "neutral_mean": float(neu.mean()) if len(neu) else np.nan,
                    "neutral_share_same_sign": float((np.sign(neu) == sgn).mean()) if len(neu) else np.nan,
                    "all_mean": float(allv.mean()), "all_sd": float(allv.std()),
                    "p_vs_neutral": p_vs_neutral})
        rows.append(row)
    return pd.DataFrame(rows)


def split_in_out(signal_months: list[pd.Period], cut: pd.Period) -> tuple[list[pd.Period], list[pd.Period]]:
    return [m for m in signal_months if m <= cut], [m for m in signal_months if m > cut]
