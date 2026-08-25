"""
open_direction.py
Pre-open direction classifier for ICE Robusta's OVERNIGHT GAP, with an exact
additive (SHAP-style) decomposition of the latest prediction.

Model spec (locked 2026-07 — see docs/research/open-price-direction-findings.md)
================================================================================
TARGET   direction of the overnight gap:
             gap_t = RC first-bar open_t / RC 17:30-London close_{t-1} − 1
         Roll days are EXCLUDED (front-month change ⇒ the two prices are
         different delivery months; the calendar spread would masquerade as a
         gap). An ABSTAIN band suppresses the call when |p−0.5| < band.

FIRES    pre-open (03:00 UTC weekdays) via open_direction_log.py, which owns
         both artifacts of the one prediction: the append-only track record
         (open_direction_history.json) and this panel payload
         (quant_report.json["open_direction"]). run_quant.py no longer
         computes this section — it preserves whatever is present.

FEATURES (all knowable pre-open; each earned its place in a walk-forward
          ablation — expanding window, standardise-on-past, vs the rolling
          majority-class baseline):
  kc_after_rc_diff  NY arabica's move in the hour AFTER London robusta closes:
                    KC(18:30 London) / KC(17:30 London) − 1, prior session.
                    Same KC contract, same day → roll-immune. The core lead
                    signal (+2.8pp OOS edge, sign-stable).
  days_since_roll   trading days since the front contract last rolled —
                    position in the bi-monthly contract cycle. (+1.1pp marginal
                    over kc_after; confirmed on an untouched holdout. Gaps tilt
                    down mid-cycle, up late-cycle.)
  cci_overnight     Coffee Currency Index move from 17:30 London (RC close) to
                    03:00 UTC, reconstructed from intraday FX snapshots
                    (fx_intraday_snapshots.json). No historical intraday FX
                    exists, so this ships live and is graded forward-only; it
                    activates once ≥ _MIN_CCI_OVERLAP days accumulate.

DROPPED after testing (see the findings doc): rc_ret_1d, KC−RC arbitrage gap
(level z at 7/15/21d and its daily change), harvest/frost/day-of-year
seasonality, term structure, daily BRL, calendar dummies. rc_open15_ret and
rc_overnight_gap are OUTCOMES the model is graded against, not inputs.

Why logistic regression (and why the SHAP is exact)
===================================================
Ordinary L2 logistic regression on standardised features. For a logistic model
the SHAP value of feature i is closed-form exact in log-odds (margin) space:

    margin(x)   = β0 + Σ βi · zi          (zi = standardised feature)
    base_margin = β0                      (E[zi] = 0 by construction)
    φi          = βi · zi ,   Σ φi = margin(x) − base_margin   (exactly)

No Shapley sampling, no `shap` dependency, pure numpy.
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ROOT      = Path(__file__).resolve().parents[3]
_INTRADAY  = _ROOT / "frontend" / "public" / "data" / "intraday_kc_rc_15min.json"
_FX_SNAPS  = _ROOT / "frontend" / "public" / "data" / "fx_intraday_snapshots.json"
_BRENT     = _ROOT / "data" / "brent_intraday_anchors.json"
_B3_SNAPS  = _ROOT / "frontend" / "public" / "data" / "b3_kc_close_snapshots.json"
_TAPE      = _ROOT / "frontend" / "public" / "data" / "tradespread.json"

_KC_TO_USD_PER_MT = 22.0462   # KC ¢/lb → USD/MT

# Owner decision (2026-07): calls inside ±10pp are "Undefined" — the model
# only speaks when it means it. Measured on the 899-session walk-forward:
# acted hit-rate 63.6% at 36% coverage (~1 call per 2.7 sessions), capture
# +$5.0/t per call vs +$2.1 acting on everything. The monotone band→accuracy
# curve (0.03→56.5%, 0.06→58.7%, 0.10→63.6%) shows confidence is informative.
# Stored direction value remains "Abstain" for record continuity; every UI
# surface renders it as "Undefined".
_ABSTAIN_BAND    = 0.10       # |prob_up − 0.5| below this → Undefined
_MIN_TRAIN       = 252        # ≥ ~1y of labelled sessions before predicting
_MIN_CCI_OVERLAP = 40         # days of FX snapshots before cci_overnight joins
_MIN_B3_OVERLAP  = 40         # sessions of B3 gap captures before b3_close_gap joins
_MIN_TAPE_OVERLAP = 40        # sessions of acaphe tape before its features join
_WF_STEP         = 5          # walk-forward refit cadence (matches the ablation)
_WF_EMBARGO      = 1          # single-session labels don't overlap; 1 day guard

# Display metadata per feature (order = canonical panel order).
_FEATURE_SPECS = [
    ("kc_after_rc_diff", "NY after RC-Close Move",  lambda v: f"{v*100:+.2f}%"),
    ("days_since_roll",  "Roll-Cycle Position",     lambda v: f"day {v:.0f}"),
    ("brent_overnight",  "Brent Overnight Move",    lambda v: f"{v*100:+.2f}%"),
    ("cci_overnight",    "CCI Overnight Move",      lambda v: f"{v*100:+.2f}%"),
]

# brent_overnight needs this much history before it activates (it has ~5y of
# backfilled anchors, so it is active from day one; the threshold guards a
# fresh checkout with a truncated file).
_MIN_BRENT_OVERLAP = 300
_FEATURE_KEYS = [k for k, _, _ in _FEATURE_SPECS]


def _unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason}


# ── dataset ──────────────────────────────────────────────────────────────────

def build_dataset() -> "pd.DataFrame | None":
    """Per-session frame indexed by session date.

    Columns:
      gap        overnight gap of that session (NaN on roll days / missing bars)
      y          1.0 gap up, 0.0 gap down, NaN unlabelled
      kc_after_rc_diff  PRIOR session's KC 17:30→18:30 move  (pre-open info)
      days_since_roll   trading days since the last front-month roll
      cci_overnight     CCI 17:30(prev) → 03:00 UTC move, when snapshots exist
      rc_close_prev     prior 17:30 RC close (USD/MT ruler for $/t displays)
      kc_1730_prev / kc_1830_prev  prior session KC anchors (¢/lb, for detail)

    Alignment: every feature in row t is knowable strictly BEFORE session t's
    open — kc_after and the KC anchors are shift(1); dsr on non-roll days
    equals dsr_{t-1}+1 and the roll calendar is deterministic.
    """
    if not _INTRADAY.exists():
        return None
    rows = json.loads(_INTRADAY.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        return None
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    for c in ("rc_open_first", "rc_last_1730", "kc_last_1730", "kc_last_1830"):
        df[c] = pd.to_numeric(df.get(c), errors="coerce")

    prev_close = df["rc_last_1730"].shift(1)
    prev_sym   = df["rc_symbol"].shift(1)
    roll       = df["rc_symbol"].ne(prev_sym) & prev_sym.notna()
    gap = (df["rc_open_first"] / prev_close - 1.0).where(
        (prev_close > 0) & df["rc_open_first"].notna() & (~roll))

    kc_after = (df["kc_last_1830"] / df["kc_last_1730"] - 1.0).where(df["kc_last_1730"] > 0)

    dsr = np.zeros(len(df)); c = 0
    for i, is_roll in enumerate(roll.values):
        c = 0 if is_roll else c + 1
        dsr[i] = c

    out = pd.DataFrame({
        "gap":              gap,
        "y":                (gap > 0).astype(float).where(gap.notna()),
        "kc_after_rc_diff": kc_after.shift(1),
        "days_since_roll":  dsr,
        "rc_close_prev":    prev_close,
        "kc_1730_prev":     df["kc_last_1730"].shift(1),
        "kc_1830_prev":     df["kc_last_1830"].shift(1),
        "_roll":            roll,
    }, index=df.index)

    cci = _cci_overnight_series()
    if cci is not None:
        out["cci_overnight"] = cci.reindex(out.index)
    brent = _brent_overnight_series()
    if brent is not None:
        out["brent_overnight"] = brent.reindex(out.index)
    tape = _tape_series()
    if tape is not None:
        t_ret, t_press = tape
        if len(t_ret):
            out["tape_open15_ret"] = t_ret.reindex(out.index).shift(1)
        if len(t_press):
            out["tape_pressure"] = t_press.reindex(out.index).shift(1)
    b3 = _b3_close_gap_series()
    if b3 is not None:
        # gap of session t-1 is the pre-open information for session t
        out["b3_close_gap"] = b3.reindex(out.index).shift(1)
    return out


def _brent_overnight_series() -> "pd.Series | None":
    """{session date → Brent % move 17:30-London(prev) → 03:00 UTC} from the
    per-contract anchor file (backfilled ~5y + appended daily). Anchors come
    from the SAME front contract, so the return is roll-immune. Earned its
    model slot in the 2026-07 walk-forward: +5.4pp univariate, +1.2pp marginal
    over kc_after+dsr, sign 100% stable, and strongest exactly in the 2022
    oil-shock year (see the findings doc)."""
    if not _BRENT.exists():
        return None
    try:
        rows = json.loads(_BRENT.read_text(encoding="utf-8")).get("days") or []
    except Exception:
        return None
    out = {}
    for r in rows:
        a, b = r.get("prev_1730"), r.get("at_0300")
        if r.get("date") and a and b and a > 0:
            out[pd.Timestamp(r["date"])] = b / a - 1.0
    return pd.Series(out).sort_index() if out else None


def _cci_overnight_series() -> "pd.Series | None":
    """{session date → CCI % move 17:30-London(prev) → 03:00 UTC} from the
    intraday FX snapshot file, weighted with the published CCI weights.

    Snapshot rows: {"date": session date, "pairs": {ticker: {"prev_1730": r,
    "at_0300": r}}} where rates are the raw stored orientation of
    fx_history.json. Each pair's overnight return is normalised to a
    USD-strength return via _strength_sign, then exporters add (+w) and
    importers subtract (−w) — identical construction to the published index.
    Returns None when the file is absent or empty (feature stays dormant).
    """
    if not _FX_SNAPS.exists():
        return None
    try:
        # SNAPSHOT_* not EXPORTERS/IMPORTERS: the published index was widened
        # to eight origins on 2026-08-25, but the intraday snapshots this
        # feature reads cover only the original twelve Barchart pairs. The loop
        # below zero-fills absent pairs and gates on `used >= 6`, so the wider
        # table would shrink every historical value by the weight that moved to
        # HNL/UGX/ETB without tripping anything. See the note beside
        # SNAPSHOT_EXPORTERS.
        from scraper.quant_model.fetch_currency_index import (
            SNAPSHOT_EXPORTERS as EXPORTERS,
            SNAPSHOT_IMPORTERS as IMPORTERS,
            _strength_sign,
        )
        doc = json.loads(_FX_SNAPS.read_text(encoding="utf-8"))
        rows = doc.get("days") or []
    except Exception as e:  # noqa: BLE001 — dormancy is fine, SILENT dormancy is not
        # fetch_currency_index imports requests/numpy/pandas at module level,
        # so a missing dependency in the runner disables this feature for
        # good. Swallowing that silently is indistinguishable from "not enough
        # data yet" — say which, so a dead feature can't masquerade as a
        # patient one.
        print(f"[open_direction] cci_overnight unavailable: {type(e).__name__}: {e}",
              file=sys.stderr)
        return None
    weights = {t: w * _strength_sign(t) for t, _n, w in EXPORTERS}
    weights.update({t: -w * _strength_sign(t) for t, _n, w in IMPORTERS})
    out = {}
    for r in rows:
        d = r.get("date"); pairs = r.get("pairs") or {}
        if not d:
            continue
        delta = 0.0; used = 0
        for ticker, w in weights.items():
            p = pairs.get(ticker) or {}
            a, b = p.get("prev_1730"), p.get("at_0300")
            if a and b and a > 0:
                delta += (b / a - 1.0) * w
                used += 1
        if used >= 6:   # require a majority of the basket
            out[pd.Timestamp(d)] = delta
    if not out:
        return None
    return pd.Series(out).sort_index()


def _b3_close_gap_series() -> "pd.Series | None":
    """{session date → B3 arabica move at-KC-close → official fechamento}
    from the two-phase capture (capture_b3_at_kc_close.py). B3's regular
    session outlives the KC settle (and its after-hours runs to 18:00 BRT),
    so this is Brazilian arabica pricing New York hasn't seen — knowable the
    evening before the session it predicts. Forward-only accumulation, same
    path as cci_overnight: dormant until _MIN_B3_OVERLAP sessions exist."""
    if not _B3_SNAPS.exists():
        return None
    try:
        rows = json.loads(_B3_SNAPS.read_text(encoding="utf-8")).get("days") or []
    except Exception:
        return None
    out = {r["date"]: r["gap"] for r in rows
           if r.get("date") and isinstance(r.get("gap"), (int, float))}
    if not out:
        return None
    return pd.Series({pd.Timestamp(d): v for d, v in out.items()}).sort_index()


def _tape_series() -> "tuple[pd.Series, pd.Series] | None":
    """(opening 15-min return, buy pressure) per session for the most-traded
    robusta contract, from acaphe's traded tape (fetch_tradespread.py).

    open15_ret = open15 / first_tick − 1: how the session's first 15 minutes
    went. pressure = (lifted − hit lots) / total, the tick-rule order-flow
    balance. Both describe a session that is OVER, so shift(1) in the frame
    makes them pre-open information for the NEXT session — the same discipline
    every other candidate here follows. (rc_open15_ret is separately a GRADING
    outcome; this is the prior session's, never the one being predicted.)"""
    if not _TAPE.exists():
        return None
    try:
        rows = json.loads(_TAPE.read_text(encoding="utf-8")).get("history") or []
    except Exception:
        return None
    rets, press = {}, {}
    for r in rows:
        d = r.get("date")
        legs = [c for c in (r.get("contracts") or {}).values()
                if c.get("market") == "robusta" and c.get("total_volume")]
        if not d or not legs:
            continue
        c = max(legs, key=lambda x: x["total_volume"])   # the active contract
        first = (c.get("first_tick") or {}).get("price")
        o15 = (c.get("open15") or {}).get("price")
        if first and o15:
            rets[pd.Timestamp(d)] = o15 / first - 1.0
        if c.get("pressure") is not None:
            press[pd.Timestamp(d)] = float(c["pressure"])
    if not rets and not press:
        return None
    return (pd.Series(rets).sort_index() if rets else pd.Series(dtype=float),
            pd.Series(press).sort_index() if press else pd.Series(dtype=float))


def active_features(frame: "pd.DataFrame") -> list[str]:
    """The model's feature set for a given dataset — single source of truth,
    shared by run() and the log module's seed so they can never diverge.
    Optional features join once their data clears the coverage threshold.

    brent_overnight is deliberately NOT here: the full-sample verdict
    (2026-07) is that it's a 2022-oil-shock-only signal (+6.1pp that year,
    NEGATIVE marginal every calm year; regime-gating didn't rescue it — see
    the findings doc). It ships as a REGIME TAG instead; the anchor data
    keeps accruing daily so it can be re-evaluated in a future oil-shock
    regime.

    TRAINABILITY GATE (2026-08 fix)
    ==============================
    A coverage threshold alone is NOT sufficient to admit a young feature.
    run() trains on `frame.dropna(subset=["y"] + active)` — LISTWISE
    deletion — so a feature with 55 rows of history does not add a column to
    1,168 training rows, it CUTS the training set to the ~51 rows where it
    exists — below _MIN_TRAIN, so run() would return "Only 51 labelled
    sessions (need ≥252)" and the model would go dark the moment an optional
    feature became "available". Even short of that cliff the silent version
    is worse: 300 rows would train fine and quietly discard 870 of history.

    This has NOT happened live. cci_overnight cleared its coverage gate
    around 2026-07-29 but never entered the frame at all, because
    _cci_overnight_series() needs fetch_currency_index, which imports
    `requests` — absent from the 1.16 runner. Verified against git history of
    quant_report.json: active_features stayed [kc_after_rc_diff,
    days_since_roll] and n_train advanced 1,159 → 1,168 across that window.
    Add the dependency without this gate in place and the cliff is exactly
    what you get, which is why the gate lands first.

    So each optional feature is admitted only if, WITH it, the resulting
    training set still clears _MIN_TRAIN. Candidates are tested one at a time
    (most-covered first) so one thin feature cannot block a well-covered one.
    A feature that fails simply stays dormant and keeps accruing — exactly
    the intended behaviour, now actually enforced."""
    active = ["kc_after_rc_diff", "days_since_roll"]
    candidates = [
        ("cci_overnight", _MIN_CCI_OVERLAP),
        ("b3_close_gap", _MIN_B3_OVERLAP),
        ("tape_open15_ret", _MIN_TAPE_OVERLAP),
        ("tape_pressure", _MIN_TAPE_OVERLAP),
    ]
    # Most-covered first: a feature with more history is likelier to survive
    # the joint dropna, and admitting it first cannot be blocked by a thinner
    # sibling that would have failed anyway.
    ready = [(c, frame[c].notna().sum()) for c, gate in candidates
             if c in frame.columns and frame[c].notna().sum() >= gate]
    for col, _n in sorted(ready, key=lambda kv: -kv[1]):
        if len(frame.dropna(subset=["y"] + active + [col])) >= _MIN_TRAIN:
            active.append(col)
    return active


def feature_status(frame: "pd.DataFrame") -> list[dict]:
    """Why every optional feature is on or off — as DATA, not a log line.

    The 2026-08-21 audit found cci_overnight had been dormant in production
    since it shipped, for a reason nobody had diagnosed: _cci_overnight_series
    imports fetch_currency_index, which imports `requests`, which the 1.16
    runner does not install. The column simply never reached the frame. From
    outside, "the dependency is missing" and "still accruing data, be patient"
    looked identical — the watchdog counted rows locally (where requests IS
    installed) and reported healthy progress toward a gate the live model
    could never reach.

    So each candidate reports its state and the REASON, and the payload
    carries it. `absent` is the one that must never be mistaken for patience:
    it means the series builder returned nothing at all.
    """
    active = set(active_features(frame))
    out = []
    for col, gate in (("cci_overnight", _MIN_CCI_OVERLAP),
                      ("b3_close_gap", _MIN_B3_OVERLAP),
                      ("tape_open15_ret", _MIN_TAPE_OVERLAP),
                      ("tape_pressure", _MIN_TAPE_OVERLAP)):
        if col not in frame.columns:
            state, reason, n, trainable = "absent", (
                "series unavailable — the builder returned nothing (missing "
                "dependency or unreadable source), NOT a data-accrual wait"
            ), 0, 0
        else:
            n = int(frame[col].notna().sum())
            trainable = int(len(frame.dropna(subset=["y", "kc_after_rc_diff",
                                                     "days_since_roll", col])))
            if col in active:
                state, reason = "active", "coverage and trainability gates both cleared"
            elif n < gate:
                state, reason = "accruing", f"coverage {n}/{gate} sessions"
            else:
                state, reason = "held", (
                    f"coverage cleared ({n} sessions) but only {trainable}/"
                    f"{_MIN_TRAIN} trainable rows — admitting it would truncate "
                    "the training set")
        out.append({"name": col, "state": state, "reason": reason,
                    "coverage": n, "coverage_gate": gate,
                    "trainable_rows": trainable, "trainable_gate": _MIN_TRAIN})
    return out


# ── logistic (numpy IRLS + L2, intercept unpenalised) ────────────────────────

def _fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 1.0,
                  iters: int = 100, tol: float = 1e-8) -> np.ndarray:
    n, p = X.shape
    beta = np.zeros(p)
    ridge = np.eye(p) * l2
    ridge[0, 0] = 0.0
    for _ in range(iters):
        eta = X @ beta
        mu = 1.0 / (1.0 + np.exp(-np.clip(eta, -35, 35)))
        W = np.clip(mu * (1.0 - mu), 1e-6, None)
        grad = X.T @ (y - mu) - ridge @ beta
        H = -(X.T * W) @ X - ridge
        try:
            step = np.linalg.solve(H, grad)
        except np.linalg.LinAlgError:
            break
        beta_new = beta - step
        if np.max(np.abs(beta_new - beta)) < tol:
            return beta_new
        beta = beta_new
    return beta


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-np.clip(x, -35, 35))))


def _fit_ridge(Z: np.ndarray, y: np.ndarray, l2: float = 1.0) -> np.ndarray:
    """Closed-form ridge on standardised features (intercept unpenalised).
    Returns [b0, w...]. Used by the magnitude head — same features as the
    classifier, predicting the SIGNED gap return instead of its direction."""
    n, k = Z.shape
    Zb = np.column_stack([np.ones(n), Z])
    P = np.eye(k + 1) * l2
    P[0, 0] = 0.0
    return np.linalg.solve(Zb.T @ Zb + P, Zb.T @ y)


def _walk_forward_magnitude(Xraw: np.ndarray, g: np.ndarray,
                            min_train: int = _MIN_TRAIN, step: int = _WF_STEP,
                            embargo: int = _WF_EMBARGO, l2: float = 1.0) -> "dict | None":
    """OOS check for the magnitude head: MAE of the predicted signed gap vs the
    zero-prediction baseline (MAE of |gap|). If the head can't beat 'predict no
    gap', its size estimate is decoration — report both so that's visible."""
    n = len(g)
    if n < min_train + step:
        return None
    preds, truth = [], []
    cut = min_train
    while cut < n:
        tr_end = cut - embargo
        Xtr, gtr = Xraw[:tr_end], g[:tr_end]
        mu = Xtr.mean(0); sd = Xtr.std(0); sd[sd == 0] = 1.0
        w = _fit_ridge((Xtr - mu) / sd, gtr, l2=l2)
        te = slice(cut, min(cut + step, n))
        Zte = (Xraw[te] - mu) / sd
        preds.extend(np.column_stack([np.ones(Zte.shape[0]), Zte]) @ w)
        truth.extend(g[te])
        cut += step
    preds = np.array(preds); truth = np.array(truth)
    mae = float(np.abs(preds - truth).mean())
    base = float(np.abs(truth).mean())          # MAE of always predicting 0
    return {"mae_pct": mae * 100, "baseline_mae_pct": base * 100,
            "skill": 1.0 - (mae / base) if base > 0 else None,
            "n": int(len(truth))}


def _walk_forward_eval(Xraw: np.ndarray, y: np.ndarray,
                       min_train: int = _MIN_TRAIN, step: int = _WF_STEP,
                       embargo: int = _WF_EMBARGO, l2: float = 1.0,
                       band: float = _ABSTAIN_BAND) -> "dict | None":
    """Honest OOS read: expanding window, refit every `step` sessions,
    standardise on training rows only. Reports accuracy on ALL predictions,
    accuracy on ACTED (outside the abstain band) predictions, the rolling
    majority-class baseline on the same rows, and the abstain rate.
    """
    n = len(y)
    if n < min_train + step:
        return None
    probs, truth, bases = [], [], []
    cut = min_train
    while cut < n:
        tr_end = cut - embargo
        Xtr, ytr = Xraw[:tr_end], y[:tr_end]
        mu = Xtr.mean(0); sd = Xtr.std(0); sd[sd == 0] = 1.0
        beta = _fit_logistic(np.column_stack([np.ones(tr_end), (Xtr - mu) / sd]), ytr, l2=l2)
        te = slice(cut, min(cut + step, n))
        Zte = (Xraw[te] - mu) / sd
        p = 1.0 / (1.0 + np.exp(-np.clip(np.column_stack([np.ones(Zte.shape[0]), Zte]) @ beta, -35, 35)))
        probs.extend(p); truth.extend(y[te])
        bases.extend([1.0 if ytr.mean() >= 0.5 else 0.0] * (te.stop - te.start))
        cut += step
    probs = np.array(probs); truth = np.array(truth); bases = np.array(bases)
    yhat = (probs >= 0.5).astype(float)
    acted = np.abs(probs - 0.5) >= band
    out = {
        "accuracy":       float((yhat == truth).mean()),
        "baseline":       float((bases == truth).mean()),
        "n":              int(len(truth)),
        "abstain_rate":   float((~acted).mean()),
        "acted_accuracy": float((yhat[acted] == truth[acted]).mean()) if acted.any() else None,
        "acted_n":        int(acted.sum()),
    }
    out["edge"] = out["accuracy"] - out["baseline"]
    return out


# ── payload ──────────────────────────────────────────────────────────────────

def run(db=None) -> dict:
    """Fit on all labelled history and return the pre-open prediction for the
    UPCOMING session + exact SHAP decomposition. `db` accepted for orchestration
    symmetry; unused (all inputs are file-based).
    """
    warnings.filterwarnings("ignore")

    frame = build_dataset()
    if frame is None:
        return _unavailable("intraday_kc_rc_15min.json missing or unreadable")

    active = active_features(frame)

    train = frame.dropna(subset=["y"] + active)
    if len(train) < _MIN_TRAIN:
        return _unavailable(f"Only {len(train)} labelled sessions (need ≥{_MIN_TRAIN})")

    Xraw = train[active].values
    y = train["y"].values.astype(float)
    g = train["gap"].values.astype(float)

    wf = _walk_forward_eval(Xraw, y)
    wf_mag = _walk_forward_magnitude(Xraw, g)

    # Live fit on everything, standardised on the full training distribution.
    mu = Xraw.mean(0); sd = Xraw.std(0); sd[sd == 0] = 1.0
    beta = _fit_logistic(np.column_stack([np.ones(len(y)), (Xraw - mu) / sd]), y)
    ridge = _fit_ridge((Xraw - mu) / sd, g)

    # ── live feature vector for the UPCOMING session ─────────────────────────
    last = frame.iloc[-1]              # most recently traded session
    last_date = frame.index[-1]
    for_session = pd.Timestamp(np.busday_offset(last_date.date(), 1, roll="forward"))

    # kc_after for the upcoming session = the move computed ON the last traded
    # day (the frame stores it shift(1), i.e. it would sit on the NEXT row).
    # Read the anchors straight from the last intraday record.
    rows = json.loads(_INTRADAY.read_text(encoding="utf-8"))
    last_row = max(rows, key=lambda r: r.get("date", ""))
    k1730, k1830 = last_row.get("kc_last_1730"), last_row.get("kc_last_1830")
    if not k1730 or not k1830:
        return _unavailable(f"last session {last_row.get('date')} missing KC 17:30/18:30 anchors")
    live_vals = {
        "kc_after_rc_diff": float(k1830) / float(k1730) - 1.0,
        "days_since_roll":  float(last["days_since_roll"]) + 1.0,
    }
    if "cci_overnight" in active:
        cci = _cci_overnight_series()
        v = cci.get(for_session) if cci is not None else None
        if v is None:
            # snapshot for this morning not present → predict without the
            # feature by imputing the training mean (z = 0 ⇒ φ = 0).
            v = float(mu[active.index("cci_overnight")])
        live_vals["cci_overnight"] = float(v)
    for key in ("tape_open15_ret", "tape_pressure"):
        if key in active:
            tape = _tape_series()
            ser = None
            if tape is not None:
                ser = tape[0] if key == "tape_open15_ret" else tape[1]
            # the tape of the LAST TRADED session is the pre-open information
            v = ser.get(last_date) if ser is not None and len(ser) else None
            if v is None:
                v = float(mu[active.index(key)])
            live_vals[key] = float(v)
    if "b3_close_gap" in active:
        b3 = _b3_close_gap_series()
        # the gap computed on the LAST traded session is the pre-open info
        v = b3.get(last_date) if b3 is not None else None
        if v is None:
            v = float(mu[active.index("b3_close_gap")])
        live_vals["b3_close_gap"] = float(v)

    x_raw = np.array([live_vals[k] for k in active], dtype=float)
    z = (x_raw - mu) / sd
    base_margin  = float(beta[0])
    phis         = beta[1:] * z
    final_margin = base_margin + float(phis.sum())
    final_prob   = _sigmoid(final_margin)

    abstain = abs(final_prob - 0.5) < _ABSTAIN_BAND
    direction = "Abstain" if abstain else ("Bullish" if final_prob >= 0.5 else "Bearish")

    # Magnitude head (same features → signed expected gap). Sizes the call in
    # $/t for the brief/panel; the direction call above stays the headline.
    expected_gap = float(np.r_[1.0, z] @ ridge)

    # ── Regime tags (decision support, NOT model inputs) ─────────────────────
    # Tested as features, these add nothing (see findings doc: vol20 −2.3pp
    # marginal, harvest/interactions ≤+0.3pp). But they condition how much to
    # TRUST the call (measured: NY-shock days 88% hit; low-vol+confident 63.7%
    # vs high-vol+confident 54.1%) — so they ride along as tags.
    gap_vol = frame["gap"].rolling(20, min_periods=10).std()
    vol_now = gap_vol.iloc[-1]
    vol_pctile = float((gap_vol.dropna() <= vol_now).mean()) if pd.notna(vol_now) else None
    _HARVEST_W = {1: .45, 2: .05, 3: 0, 4: .10, 5: .30, 6: .30, 7: .20,
                  8: 0, 9: 0, 10: .20, 11: .45, 12: .45}
    harvest_w = _HARVEST_W.get(for_session.month, 0)
    ny_shock = abs(live_vals["kc_after_rc_diff"]) >= 0.008
    # Brent overnight as CONTEXT (not a coefficient — see active_features):
    # today's 17:30→03:00 move, flagged when it's a genuine oil jolt.
    brent_series = _brent_overnight_series()
    brent_val = (brent_series.get(for_session)
                 if brent_series is not None else None)
    # A dead feed and a calm tape must not share a value. Publishing
    # oil_shock=False for a frozen anchor file read as "oil is quiet" for 35
    # sessions after the Barchart symbol stopped returning bars (2026-07-03).
    # None is falsy in JS, so existing truthiness checks are unaffected.
    brent_last = (brent_series.index[-1]
                  if brent_series is not None and len(brent_series) else None)
    brent_stale = (int(np.busday_count(brent_last.date(), for_session.date()))
                   if brent_last is not None else None)
    if brent_val is not None:
        brent_status = "ok"
    elif brent_last is None:
        brent_status = "missing"
    else:
        brent_status = "stale"
    regime = {
        "ny_shock":        bool(ny_shock),          # 88% hit-rate setup (n=42)
        "vol_regime":      ("high" if vol_pctile is not None and vol_pctile > 0.5 else "low")
                           if vol_pctile is not None else None,
        "vol_percentile":  round(vol_pctile, 2) if vol_pctile is not None else None,
        "harvest_weight":  harvest_w,               # robusta-origin harvest calendar
        "harvest_active":  harvest_w >= 0.30,
        "brent_overnight_pct": (round(float(brent_val) * 100, 2)
                                if brent_val is not None else None),
        "brent_status":    brent_status,            # ok | stale | missing
        "brent_last_date": (brent_last.strftime("%Y-%m-%d")
                            if brent_last is not None else None),
        "brent_stale_sessions": brent_stale,
        # None = unknown, not calm.
        "oil_shock":       (bool(abs(brent_val) >= 0.015)
                            if brent_val is not None else None),
    }
    if brent_status != "ok":
        print(f"[open_direction] brent regime tag {brent_status}: last anchor "
              f"{regime['brent_last_date']} ({brent_stale} sessions) — "
              "oil_shock reported as unknown, not false", file=sys.stderr)

    # ── $/t ruler + per-feature detail ───────────────────────────────────────
    rc_px = float(last_row.get("rc_last_1730") or 0) or None   # USD/MT
    kc_move_usd = (float(k1830) - float(k1730)) * _KC_TO_USD_PER_MT

    spec_by_key = {k: (label, fmt) for k, label, fmt in _FEATURE_SPECS}
    features_out = []
    for key, raw, phi, z_i in zip(active, x_raw, phis, z):
        label, fmt = spec_by_key[key]
        usd = None
        if rc_px is not None and key != "days_since_roll":
            usd = round(raw * rc_px, 1)
        item = {
            "var_name":    key,
            "label":       label,
            "raw_value":   float(raw),
            "raw_fmt":     fmt(float(raw)),
            "z":           round(float(z_i), 2),   # vs the feature's own history
            "usd_per_ton": usd,
            "phi":         float(phi),
        }
        if key == "kc_after_rc_diff":
            item["detail"] = {
                "text": (f"KC at RC close (17:30 London) {float(k1730):,.2f}¢/lb → "
                         f"KC close (18:30) {float(k1830):,.2f}¢/lb = "
                         f"{kc_move_usd:+,.1f} $/t on arabica; "
                         f"{raw*100:+.2f}% mapped on robusta ≈ {usd:+,.1f} $/t"
                         if usd is not None else
                         f"KC 17:30 {float(k1730):,.2f} → 18:30 {float(k1830):,.2f} ¢/lb")
            }
        elif key == "days_since_roll":
            item["detail"] = {
                "text": (f"day {raw:.0f} of the bi-monthly front-contract cycle — "
                         "gaps historically tilt down mid-cycle (~day 10), up late-cycle")
            }
        elif key == "brent_overnight":
            item["detail"] = {
                "text": ("Brent front-month move 17:30 London → 03:00 UTC (same-contract, "
                         "roll-immune) — risk/energy tone while robusta was shut; "
                         "strongest in oil-shock regimes (2022: +6pp extra edge)")
            }
        elif key == "cci_overnight":
            item["detail"] = {
                "text": "Coffee Currency Index move 17:30 London → 03:00 UTC (intraday FX snapshots)"
            }
        elif key == "tape_open15_ret":
            item["detail"] = {
                "text": ("Robusta's move over the first 15 minutes of the PRIOR "
                         "session, from acaphe's traded tape (open tick → the "
                         "print 15 min later)")
            }
        elif key == "tape_pressure":
            item["detail"] = {
                "text": ("Prior session's tick-rule order-flow balance on the "
                         "active robusta contract: (lots lifted − lots hit) / "
                         "total; +100% all buyer-initiated, −100% all seller-initiated")
            }
        elif key == "b3_close_gap":
            item["detail"] = {
                "text": ("B3 arabica 4/5 front: official fechamento vs its price at the "
                         "KC settle — Brazil's post-NY-close move, prior session")
            }
        features_out.append(item)
    features_out.sort(key=lambda f: abs(f["phi"]), reverse=True)

    n_roll_excluded = int(frame["_roll"].sum())

    return {
        "available":     True,
        "as_of":         last_date.strftime("%Y-%m-%d"),          # last data used
        "for_session":   for_session.strftime("%Y-%m-%d"),        # session predicted
        "scraped_at":    datetime.utcnow().isoformat() + "Z",
        "direction":     direction,
        "base_margin":   base_margin,
        "final_margin":  final_margin,
        "base_prob":     _sigmoid(base_margin),
        "final_prob":    final_prob,
        "prob_up":       final_prob,
        "prob_down":     1.0 - final_prob,
        "regime":        regime,
        "expected_gap_pct":    round(expected_gap * 100, 3),
        "expected_gap_usd_mt": (round(expected_gap * rc_px, 1)
                                if rc_px is not None else None),
        "features":      features_out,
        "target": {
            "kind":         "overnight_gap",
            "definition":   "RC first-bar open ÷ prior 17:30-London close − 1; roll days excluded",
            "abstain_band": _ABSTAIN_BAND,
        },
        "model": {
            "kind":              "logistic_regression_l2",
            "active_features":   active,
            "feature_status":    feature_status(frame),
            "n_features":        len(active),
            "n_train":           int(len(y)),
            "test_accuracy":     wf["accuracy"] if wf else None,
            "baseline_accuracy": wf["baseline"] if wf else None,
            "edge":              wf["edge"] if wf else None,
            "acted_accuracy":    wf["acted_accuracy"] if wf else None,
            "acted_n":           wf["acted_n"] if wf else None,
            "abstain_rate":      wf["abstain_rate"] if wf else None,
            "eval_method":       "walk_forward",
            # Everything needed to REPRODUCE the numbers above from the
            # published input files. Emitted rather than documented because a
            # documented constant drifts from the code the first time either
            # is edited, and a reproduction that lands on a different number
            # than the panel is worse than no reproduction at all.
            "eval_spec": {
                "min_train":     _MIN_TRAIN,
                "refit_step":    _WF_STEP,
                "embargo":       _WF_EMBARGO,
                "l2":            1.0,
                "abstain_band":  _ABSTAIN_BAND,
                "standardise":   "training rows only, recomputed at each refit",
                "baseline":      "majority class of the expanding training window",
                "intercept":     "unpenalised",
            },
            "n_test":            wf["n"] if wf else 0,
            "mag_mae_pct":          wf_mag["mae_pct"] if wf_mag else None,
            "mag_baseline_mae_pct": wf_mag["baseline_mae_pct"] if wf_mag else None,
            "mag_skill":            wf_mag["skill"] if wf_mag else None,
            "cci_available":     "cci_overnight" in active,
            "intraday_source":   "barchart_15min",
            "roll_days_excluded": n_roll_excluded,
        },
    }
