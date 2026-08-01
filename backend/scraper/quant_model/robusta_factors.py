"""
robusta_factors.py
Multi-factor OLS scoring model for Robusta (RC) futures direction.

Factors (all z-scored vs 52-week rolling window):
  1. Managed Money Net Positioning — ICE Robusta COT (market=ldn)
  2. USD Index (DXY) — via Stooq (dx.f), resampled to weekly
  3. RC Price Momentum 4w — 4-week ROC of price_ldn
  4. RC Price Momentum 13w — 13-week ROC of price_ldn
  5. KC-RC Spread — arabica premium over robusta (USD/MT)

Model: OLS regression
  Target: next-4-week RC price change (USD/MT)
  Training: full available COT history

Usage (debug):
    cd backend
    python -m scraper.quant_model.robusta_factors
"""

import json
import sys
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from database import SessionLocal
from models import CotPosition, CotWeekly

_WINDOW = 52  # rolling z-score window in weeks
_STOOQ_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; coffee-intel/1.0)"}


def _fetch_dxy_weekly(start: str) -> "pd.Series | None":
    """US Dollar Index weekly closes from Stooq (dx.f) — free CSV, no auth.

    Replaces the old yfinance DXY fetch, which Yahoo rate-limits/blocks on
    GitHub Actions IPs (the recurring 1.9 Robusta-step failures). Returns a
    weekly series resampled to COT Tuesdays, or None on failure.
    """
    url = "https://stooq.com/q/d/l/?s=dx.f&i=w"
    try:
        r = requests.get(url, headers=_STOOQ_HEADERS, timeout=20)
        r.raise_for_status()
        text = r.text
    except Exception:
        return None
    lines = text.strip().splitlines()
    if len(lines) < 2:
        return None
    dates, closes = [], []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        try:
            dates.append(pd.Timestamp(parts[0]))
            closes.append(float(parts[4]))
        except (ValueError, TypeError):
            continue
    if not closes:
        return None
    s = pd.Series(closes, index=pd.DatetimeIndex(dates)).sort_index()
    s = s[s.index >= pd.Timestamp(start)]
    s.index = s.index.normalize()
    return s.resample("W-TUE").last().ffill()


def _zscore_rolling(series: pd.Series, window: int = _WINDOW) -> pd.Series:
    mu    = series.rolling(window, min_periods=10).mean()
    sigma = series.rolling(window, min_periods=10).std()
    return (series - mu) / sigma.replace(0, np.nan)


def _pct_to_quantile(pct: float) -> int:
    """Map historical percentile [0, 100] to display quantile [-5, +5]."""
    if pct <= 10:  return -5
    if pct <= 20:  return -4
    if pct <= 30:  return -3
    if pct <= 40:  return -2
    if pct <= 50:  return -1
    if pct <= 60:  return 0
    if pct <= 70:  return 1
    if pct <= 80:  return 2
    if pct <= 90:  return 3
    if pct <= 95:  return 4
    return 5


def run(db) -> dict:
    warnings.filterwarnings("ignore")

    # ── 1. Load COT data ──────────────────────────────────────────────────────
    ldn_rows = (
        db.query(CotWeekly)
        .filter(CotWeekly.market == "ldn")
        .order_by(CotWeekly.date.asc())
        .all()
    )
    if len(ldn_rows) < 30:
        return {"available": False, "reason": f"Insufficient COT history ({len(ldn_rows)} weeks)"}

    ny_by_date = {
        r.date: r for r in
        db.query(CotWeekly).filter(CotWeekly.market == "ny").all()
    }

    # MM positions live in the narrow CotPosition table since the cot_weekly
    # wide-column migration (the old row.mm_long attributes no longer exist —
    # reading them crashed this model from the migration onward).
    mm_net_by_date: dict = {}
    mm_rows = (
        db.query(CotPosition)
        .filter(
            CotPosition.market == "ldn",
            CotPosition.crop == "all",
            CotPosition.category == "mm",
            CotPosition.side.in_(["long", "short"]),
        )
        .all()
    )
    for p_row in mm_rows:
        mm_net_by_date[p_row.date] = mm_net_by_date.get(p_row.date, 0) + (
            (p_row.oi or 0) if p_row.side == "long" else -(p_row.oi or 0)
        )
    if not mm_net_by_date:
        return {"available": False, "reason": "No CotPosition MM rows for LDN"}

    dates, mm_nets, rc_prices, kc_prices_usd = [], [], [], []
    for row in ldn_rows:
        if row.price_ldn is None:
            continue
        net = mm_net_by_date.get(row.date)
        if net is None:
            continue  # week without a position breakdown — skip cleanly
        ny = ny_by_date.get(row.date)
        kc_usd = (ny.price_ny * 22.046) if (ny and ny.price_ny) else None
        dates.append(pd.Timestamp(row.date))
        mm_nets.append(net)
        rc_prices.append(row.price_ldn)
        kc_prices_usd.append(kc_usd)

    df = pd.DataFrame({
        "mm_net":   mm_nets,
        "rc_price": rc_prices,
        "kc_price": kc_prices_usd,
    }, index=pd.DatetimeIndex(dates)).sort_index()

    # ── 2. Fetch DXY (weekly, Stooq → resampled to COT Tuesdays) ──────────────
    start = (df.index[0] - pd.Timedelta(days=14)).strftime("%Y-%m-%d")
    dxy_s = _fetch_dxy_weekly(start)
    if dxy_s is not None and not dxy_s.empty:
        df = df.join(dxy_s.rename("dxy"), how="left")
    else:
        df["dxy"] = np.nan

    # ── 3. Compute z-scored factors ───────────────────────────────────────────
    df["kc_rc_spread"]   = df["kc_price"] - df["rc_price"]
    df["rc_mom_4w"]      = df["rc_price"].pct_change(4) * 100
    df["rc_mom_13w"]     = df["rc_price"].pct_change(13) * 100

    df["mm_net_z"]       = _zscore_rolling(df["mm_net"])
    df["dxy_z"]          = _zscore_rolling(df["dxy"])
    df["rc_mom_4w_z"]    = _zscore_rolling(df["rc_mom_4w"])
    df["rc_mom_13w_z"]   = _zscore_rolling(df["rc_mom_13w"])
    df["kc_rc_spread_z"] = _zscore_rolling(df["kc_rc_spread"])

    # Target: next-4-week RC price change (USD/MT)
    df["target"] = df["rc_price"].shift(-4) - df["rc_price"]

    # ── 4. OLS regression ─────────────────────────────────────────────────────
    FEATURES = ["mm_net_z", "dxy_z", "rc_mom_4w_z", "rc_mom_13w_z", "kc_rc_spread_z"]
    df_model = df[FEATURES + ["target"]].dropna()

    if len(df_model) < 20:
        return {"available": False, "reason": f"Insufficient clean data ({len(df_model)} rows after dropna)"}

    X = df_model[FEATURES].values
    y = df_model["target"].values
    X_int = np.column_stack([np.ones(len(X)), X])

    try:
        coefs, _, _, _ = np.linalg.lstsq(X_int, y, rcond=None)
    except Exception as e:
        return {"available": False, "reason": f"OLS failed: {e}"}

    intercept = float(coefs[0])
    betas     = coefs[1:]

    y_hat  = X_int @ coefs
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2     = max(0.0, 1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0

    residual_std = float(np.std(y - y_hat))

    # ── 5. Current factor values ───────────────────────────────────────────────
    current  = df[FEATURES].iloc[-1]
    as_of    = df.index[-1].date().isoformat()
    hist     = df_model[FEATURES]

    FACTOR_META = [
        ("mm_net_z",       "MM Net Positioning", "Positioning"),
        ("dxy_z",          "USD Index (DXY)",    "Macro"),
        ("rc_mom_4w_z",    "RC Momentum 4w",     "Momentum"),
        ("rc_mom_13w_z",   "RC Momentum 13w",    "Momentum"),
        ("kc_rc_spread_z", "KC-RC Spread",       "Macro"),
    ]

    factors_out = []
    total_contrib = 0.0

    for i, (col, label, category) in enumerate(FACTOR_META):
        val  = current.get(col)
        beta = float(betas[i])

        if pd.isna(val):
            factors_out.append({
                "label": label, "category": category,
                "quantile": 0, "percentile": 50.0,
                "value_z": None, "beta": round(beta, 3),
                "contribution": 0.0, "available": False,
            })
            continue

        val        = float(val)
        percentile = float((hist[col] < val).mean() * 100)
        quantile   = _pct_to_quantile(percentile)
        contrib    = round(val * beta, 2)
        total_contrib += contrib

        factors_out.append({
            "label":        label,
            "category":     category,
            "quantile":     quantile,
            "percentile":   round(percentile, 1),
            "value_z":      round(val, 3),
            "beta":         round(beta, 3),
            "contribution": contrib,
            "available":    True,
        })

    delta_p    = round(intercept + total_contrib, 1)
    direction  = "Bullish" if delta_p > 0 else "Bearish"
    # Confidence: how many residual std-devs the prediction is from zero
    conf_raw   = min(0.95, abs(delta_p) / (residual_std + 1e-6))

    return {
        "available":  True,
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "as_of":      as_of,
        "model": {
            "r_squared":       round(r2, 3),
            "n_obs":           int(len(df_model)),
            "training_period": f"{df_model.index[0].date()} to {df_model.index[-1].date()}",
            "residual_std":    round(residual_std, 1),
        },
        "prediction": {
            "delta_p":    delta_p,
            "direction":  direction,
            "confidence": round(conf_raw, 2),
        },
        "intercept": round(intercept, 2),
        "factors":   factors_out,
    }


if __name__ == "__main__":
    db = SessionLocal()
    try:
        result = run(db)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    finally:
        db.close()
