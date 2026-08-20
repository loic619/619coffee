"""
open_direction_factors.py — the open-direction model's factor panel: every
candidate's correlation with the next overnight gap, through time, plus the
B3 late-close study (2026-08).

Extends the open-price-direction research (docs/research/
open-price-direction-findings.md) with two things the owner asked for:

1. THE B3 TIME-DIFFERENCE HYPOTHESIS. B3 São Paulo trades ~2.4h after KC's
   NY close (arabica ICF) and ~3h after London robusta's close (conilon
   CNL). The late window could carry Brazil physical / BRL / weather news
   into the next ICE open. Constructions:
     * b3_after_kc — the ICF front's daily return RESIDUAL vs the same-day
       KC settle return (rolling-60 beta): the information B3 printed that
       KC's own close did not already contain. Roll-cleaned on both legs
       (ICF front_month change; KC symbol change). Knowable ~21:00 London,
       well before the 03:00 UTC firing — timing is valid.
     * cnl_after_rc — the same construction for conilon vs the RC close.
       B3 exposes no CNL history; the accumulator started 2026-08 and the
       factor is DATA-STARVED (the Vietnam-candidate precedent).
2. THE CORRELATION-THROUGH-TIME PANEL. Rolling 120-session correlation of
   each factor with the next session's gap, so strong vs weak factors are
   visible at a glance — including the in-model features, the dropped ones,
   the regime tag, and the new candidates.

Walk-forward gate (same spec as the findings doc: expanding window,
standardise-on-past, refit every 5 sessions, min-train 252, rolling-252
majority baseline; logistic fit is a pure-python Newton — no numpy needed):
edge = OOS accuracy − baseline. Marginals are judged on MATCHED OOS dates.

CCI weights are inlined from scraper/quant_model/fetch_currency_index.py
(EXPORTERS/IMPORTERS literals + the strength-sign convention) because that
module imports numpy and this exporter must run stdlib-only. If the weights
change there, update here.

Writes frontend/public/data/open_direction_factors.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR, ROOT

INTRADAY = OUT_DIR / "intraday_kc_rc_15min.json"
QUANT = OUT_DIR / "quant_report.json"
B3_SNAPS = OUT_DIR / "b3_kc_close_snapshots.json"
ICF = OUT_DIR / "brazil_b3_arabica.json"
CNL = OUT_DIR / "brazil_b3_conilon.json"
FX_SNAPS = OUT_DIR / "fx_intraday_snapshots.json"
BRENT = ROOT / "data" / "brent_intraday_anchors.json"
OUT = OUT_DIR / "open_direction_factors.json"

ROLL_WIN = 120          # rolling-correlation window (sessions)
BETA_WIN = 60           # rolling beta for the B3 residual
MIN_TRAIN = 252
WF_STEP = 5

# CCI weights (mirrors fetch_currency_index.py literals; sign = strength
# convention: plain local-per-USD tickers flip, EURUSD=X keeps).
_CCI_W = {
    "BRL=X": +0.513 * -1, "VND=X": +0.262 * -1, "COP=X": +0.128 * -1,
    "IDR=X": +0.051 * -1, "PEN=X": +0.047 * -1,
    "EURUSD=X": -0.673 * +1, "JPY=X": -0.095 * -1, "CHF=X": -0.052 * -1,
    "CNY=X": -0.052 * -1, "CAD=X": -0.046 * -1, "KRW=X": -0.045 * -1,
    "GBP=X": -0.038 * -1,
}


def _r(x, n: int = 3):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _corr(a, b):
    if len(a) < 30:
        return None
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    return num / (da * db) if da * db else None


def _t_of(r, n):
    if r is None or abs(r) >= 1 or n < 3:
        return None
    return r * math.sqrt(n - 2) / math.sqrt(1 - r * r)


def _residual_series(base_ret: dict, hedge_ret: dict) -> dict:
    """Rolling-BETA_WIN residual of base on hedge (same-day returns)."""
    seq = [(d, base_ret[d], hedge_ret[d]) for d in sorted(base_ret) if d in hedge_ret]
    out = {}
    for i in range(BETA_WIN, len(seq)):
        win = seq[i - BETA_WIN:i]
        xs = [w[2] for w in win]
        ys = [w[1] for w in win]
        mx, my = st.mean(xs), st.mean(ys)
        cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        var = sum((x - mx) ** 2 for x in xs)
        d, by, hx = seq[i]
        out[d] = by - (cov / var if var else 1.0) * hx
    return out


def _b3_front_returns(doc: dict) -> dict:
    rows = sorted(doc.get("history", []), key=lambda x: x["date"])
    out = {}
    for i in range(1, len(rows)):
        a, b = rows[i - 1], rows[i]
        if a.get("front_month") == b.get("front_month") and a.get("front_price") and b.get("front_price"):
            out[b["date"]] = b["front_price"] / a["front_price"] - 1.0
    return out


def _fit_logistic(X, y, lam=1.0, iters=15):
    k = len(X[0])
    w = [0.0] * (k + 1)
    for _ in range(iters):
        g = [0.0] * (k + 1)
        H = [[0.0] * (k + 1) for _ in range(k + 1)]
        for xi, yi in zip(X, y):
            z = w[0] + sum(w[j + 1] * xi[j] for j in range(k))
            p = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
            e, s = p - yi, p * (1 - p)
            g[0] += e
            H[0][0] += s
            for j in range(k):
                g[j + 1] += e * xi[j]
                H[0][j + 1] += s * xi[j]
                H[j + 1][0] += s * xi[j]
                for l in range(k):  # noqa: E741
                    H[j + 1][l + 1] += s * xi[j] * xi[l]
        for j in range(1, k + 1):
            g[j] += lam * w[j]
            H[j][j] += lam
        n = k + 1
        A = [row[:] + [g[i2]] for i2, row in enumerate(H)]
        for c in range(n):
            piv = max(range(c, n), key=lambda r2: abs(A[r2][c]))
            A[c], A[piv] = A[piv], A[c]
            if abs(A[c][c]) < 1e-12:
                return w
            for r2 in range(n):
                if r2 != c and A[r2][c]:
                    f = A[r2][c] / A[c][c]
                    for c2 in range(c, n + 1):
                        A[r2][c2] -= f * A[c][c2]
        d = [A[i2][n] / A[i2][i2] for i2 in range(n)]
        w = [w[i2] - d[i2] for i2 in range(n)]
        if max(abs(x) for x in d) < 1e-8:
            break
    return w


def _wf_preds(rows_all, feats):
    rows_ok = [r for r in rows_all if r["gap"] is not None and all(r.get(f) is not None for f in feats)]
    y = [1.0 if r["gap"] > 0 else 0.0 for r in rows_ok]
    preds = {}
    w = mu = sd = None
    for i in range(MIN_TRAIN, len(rows_ok)):
        if (i - MIN_TRAIN) % WF_STEP == 0:
            tr = rows_ok[:i]
            mu = [st.mean(r[f] for r in tr) for f in feats]
            sd = [st.pstdev(r[f] for r in tr) or 1.0 for f in feats]
            X = [[(r[f] - mu[j]) / sd[j] for j, f in enumerate(feats)] for r in tr]
            w = _fit_logistic(X, y[:i])
        xi = [(rows_ok[i][f] - mu[j]) / sd[j] for j, f in enumerate(feats)]
        z = w[0] + sum(w[j + 1] * xi[j] for j in range(len(feats)))
        p = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
        preds[rows_ok[i]["date"]] = (p > 0.5, y[i] > 0.5, st.mean(y[i - MIN_TRAIN:i]) > 0.5)
    return preds


def _edge(preds, dates=None):
    ds = sorted(dates if dates is not None else preds.keys())
    if not ds:
        return None
    acc = st.mean(1.0 if preds[d][0] == preds[d][1] else 0.0 for d in ds)
    base = st.mean(1.0 if preds[d][2] == preds[d][1] else 0.0 for d in ds)
    return {"n": len(ds), "span": [ds[0], ds[-1]], "acc": _r(acc * 100, 1),
            "base": _r(base * 100, 1), "edge": _r((acc - base) * 100, 1)}


def export_open_direction_factors():
    intr = _load(INTRADAY)
    if not intr:
        raise RuntimeError("intraday_kc_rc_15min.json missing")
    rows = sorted(intr, key=lambda x: x["date"])

    # per-session frame: gap_t + every factor already aligned pre-open
    data = []
    dsr = 0
    kc_ret, rc_ret_same = {}, {}
    for i in range(1, len(rows)):
        a, b = rows[i - 1], rows[i]
        roll = a.get("rc_symbol") != b.get("rc_symbol")
        dsr = 0 if roll else dsr + 1
        gap = None
        if not roll and a.get("rc_last_1730") and b.get("rc_open_first"):
            gap = b["rc_open_first"] / a["rc_last_1730"] - 1.0
        kc_after_prev = None
        if a.get("kc_last_1730") and a.get("kc_last_1830"):
            kc_after_prev = a["kc_last_1830"] / a["kc_last_1730"] - 1.0
        rc_ret_prev = None
        if i >= 2 and rows[i - 2].get("rc_symbol") == a.get("rc_symbol") \
                and rows[i - 2].get("rc_last_1730") and a.get("rc_last_1730"):
            rc_ret_prev = a["rc_last_1730"] / rows[i - 2]["rc_last_1730"] - 1.0
        if a.get("kc_symbol") == b.get("kc_symbol") and a.get("kc_settle") and b.get("kc_settle"):
            kc_ret[b["date"]] = b["kc_settle"] / a["kc_settle"] - 1.0
        if not roll and a.get("rc_last_1730") and b.get("rc_last_1730"):
            rc_ret_same[b["date"]] = b["rc_last_1730"] / a["rc_last_1730"] - 1.0
        data.append({"date": b["date"], "gap": gap, "kc_after": kc_after_prev,
                     "dsr": float(dsr), "rc_ret": rc_ret_prev})

    # B3 arabica residual (prior evening) — the new candidate
    icf_ret = _b3_front_returns(_load(ICF))
    b3_resid = _residual_series(icf_ret, kc_ret)
    for i in range(1, len(data)):
        data[i]["b3"] = b3_resid.get(data[i - 1]["date"])
    if data:
        data[0]["b3"] = None

    # brent + cci overnight (already keyed by the session they precede)
    brent = {}
    for r_ in (_load(BRENT).get("days") or []):
        a, b = r_.get("prev_1730"), r_.get("at_0300")
        if r_.get("date") and a and b and a > 0:
            brent[r_["date"]] = b / a - 1.0
    cci = {}
    for r_ in (_load(FX_SNAPS).get("days") or []):
        pairs = r_.get("pairs") or {}
        delta, used = 0.0, 0
        for tk, w_ in _CCI_W.items():
            p = pairs.get(tk) or {}
            a, b = p.get("prev_1730"), p.get("at_0300")
            if a and b and a > 0:
                delta += (b / a - 1.0) * w_
                used += 1
        if r_.get("date") and used >= 6:
            cci[r_["date"]] = delta
    # b3_close_gap — the model's OWN B3 construction (added 2026-08, PR #697):
    # B3's move from its price at the KC close to its official fechamento, i.e.
    # only the window after New York settles. Distinct from this study's
    # `b3` residual, which used B3's WHOLE day minus KC's whole day.
    b3_gap = {}
    for r_ in (_load(B3_SNAPS).get("days") or []):
        if r_.get("date") and isinstance(r_.get("gap"), (int, float)):
            b3_gap[r_["date"]] = r_["gap"]
    for i, r_ in enumerate(data):
        r_["brent"] = brent.get(r_["date"])
        r_["cci"] = cci.get(r_["date"])
        # knowable the evening before the session it predicts → shift(1)
        r_["b3_close_gap"] = b3_gap.get(data[i - 1]["date"]) if i else None

    # ── factor battery: full-window + per-year lead correlations ────────────
    # Status is READ FROM THE LIVE MODEL, never asserted here: quant_report's
    # model block is written by the 03:00 job and is the authority on which
    # features actually carry a coefficient. A hardcoded "IN MODEL" label
    # silently lies the moment the model's spec or a coverage gate changes.
    live_model = (_load(QUANT).get("open_direction") or {}).get("model") or {}
    active_live = list(live_model.get("active_features") or [])
    # exporter key → the model's own feature name (None = not a model feature)
    MODEL_NAME = {
        "kc_after": "kc_after_rc_diff", "dsr": "days_since_roll",
        "cci": "cci_overnight", "brent": None, "rc_ret": None,
        "b3": None, "b3_close_gap": "b3_close_gap",
    }

    def _status(key: str, fallback: str) -> str:
        name = MODEL_NAME.get(key)
        if name and name in active_live:
            return "ACTIVE IN MODEL"
        return fallback

    FACTORS = [
        ("kc_after", "NY after RC-close move", _status("kc_after", "not in the live model")),
        ("dsr", "Roll-cycle position", _status("dsr", "not in the live model")),
        ("cci", "CCI overnight move", _status("cci", "candidate — dormant until its coverage gate clears")),
        ("brent", "Brent overnight move", "REGIME TAG (2022-only coefficient)"),
        ("rc_ret", "RC prior-day return", "DROPPED 2026-07 — re-examined here"),
        ("b3", "B3 arabica after-KC residual (whole day)", "REJECTED at the gate — this study"),
        ("b3_close_gap", "B3 post-KC-close gap (narrow window)",
         _status("b3_close_gap", "candidate — accruing toward its activation gate")),
    ]
    factors = []
    for key, label, status in FACTORS:
        ps = [(r_["date"], r_[key], r_["gap"]) for r_ in data
              if r_.get(key) is not None and r_["gap"] is not None]
        r0 = _corr([p[1] for p in ps], [p[2] for p in ps])
        per_year = {}
        for yr in ("2022", "2023", "2024", "2025", "2026"):
            py = [p for p in ps if p[0][:4] == yr]
            if len(py) >= 40:
                per_year[yr] = _r(_corr([p[1] for p in py], [p[2] for p in py]))
        factors.append({"key": key, "label": label, "status": status,
                        "n": len(ps), "r": _r(r0), "t": _r(_t_of(r0, len(ps)), 2),
                        "per_year": per_year})

    # rolling-ROLL_WIN correlation series (chartable factors)
    roll_keys = ["kc_after", "rc_ret", "b3", "brent"]
    rolling = []
    frame = [r_ for r_ in data if r_["gap"] is not None]
    for i in range(ROLL_WIN, len(frame)):
        win = frame[i - ROLL_WIN:i]
        row_out = {"date": frame[i]["date"]}
        keep = False
        for k in roll_keys:
            ps = [(w[k], w["gap"]) for w in win if w.get(k) is not None]
            if len(ps) >= int(ROLL_WIN * 0.7):
                rr = _corr([p[0] for p in ps], [p[1] for p in ps])
                if rr is not None:
                    row_out[k] = _r(rr)
                    keep = True
        if keep:
            rolling.append(row_out)

    # ── power analysis: does STRONG B3 variation predict? ───────────────────
    # Buckets by past-only |z| of the residual (expanding std, min 40 obs).
    # The honest bar for a conditional signal: accuracy should RISE with |z|
    # (as the model's own confidence curve does). A wrong-way tail on a small
    # bucket is recorded with its own binomial z, not promoted.
    pframe = [r_ for r_ in data if r_.get("b3") is not None and r_["gap"] is not None]
    vals: list[float] = []
    for r_ in pframe:
        r_["b3_z"] = (r_["b3"] / st.pstdev(vals)) if len(vals) >= 40 and st.pstdev(vals) else None
        vals.append(r_["b3"])
    zf = [r_ for r_ in pframe if r_.get("b3_z") is not None]

    def _bucket(rows_):
        n = len(rows_)
        if n < 12:
            return {"n": n}
        acc = st.mean(1.0 if (r_["b3"] > 0) == (r_["gap"] > 0) else 0.0 for r_ in rows_)
        down = st.mean(1.0 if r_["gap"] <= 0 else 0.0 for r_ in rows_)
        blind = max(down, 1 - down)
        return {"n": n, "acc": _r(acc * 100, 1), "blind": _r(blind * 100, 1),
                "skill": _r((acc - blind) * 100, 1),
                "avg_abs_gap": _r(st.mean(abs(r_["gap"]) for r_ in rows_) * 100, 2)}

    tail = [r_ for r_ in zf if abs(r_["b3_z"]) >= 2]
    tail_stats = _bucket(tail)
    inv_z = None
    if tail_stats.get("acc") is not None:
        k_inv = sum(1 for r_ in tail if (r_["b3"] > 0) != (r_["gap"] > 0))
        p0 = tail_stats["blind"] / 100
        n_t = tail_stats["n"]
        se = math.sqrt(n_t * p0 * (1 - p0))
        inv_z = _r((k_inv - n_t * p0) / se, 2) if se else None
    power = {
        "n": len(zf),
        "buckets": [
            {"band": "|z| < 1", **_bucket([r_ for r_ in zf if abs(r_["b3_z"]) < 1])},
            {"band": "1 ≤ |z| < 2", **_bucket([r_ for r_ in zf if 1 <= abs(r_["b3_z"]) < 2])},
            {"band": "|z| ≥ 2", **tail_stats},
        ],
        "inverted_tail_z": inv_z,
        "verdict": "non-monotone — strength does not add power; the strongest bucket leans WRONG-way (reversal) but fails significance on its own tail",
    }

    # ── harvest seasonality + last-hour pre-hedging tests (2026-08) ─────────
    # Owner hypotheses: (1) the B3 late window is worth more in Brazil harvest;
    # (2) commercials pre-hedging next-day purchases in the LAST HOUR either
    # reverse next day (pressure) or start trends (informed flow). Brazil
    # harvest window here = May–Sep (arabica main + conilon overlap) — distinct
    # from the model's robusta-origin _HARVEST_W calendar. KC's last hour is
    # the stored 17:30→18:30-London anchor pair; RC's own last hour needs the
    # rc_last_1630 anchor, recorded forward from 2026-08 (refresher change).
    def _in_harvest(d: str) -> bool:
        return 5 <= int(d[5:7]) <= 9

    sframe = []
    for i in range(1, len(rows)):
        a, b = rows[i - 1], rows[i]
        if a.get("rc_symbol") != b.get("rc_symbol"):
            continue
        if not (a.get("rc_last_1730") and b.get("rc_open_first")):
            continue
        kc_after_prev = (a["kc_last_1830"] / a["kc_last_1730"] - 1.0
                         if a.get("kc_last_1730") and a.get("kc_last_1830") else None)
        kc_day = (b["kc_settle"] / a["kc_settle"] - 1.0
                  if a.get("kc_symbol") == b.get("kc_symbol") and a.get("kc_settle") and b.get("kc_settle") else None)
        sframe.append({
            "date": b["date"], "h": _in_harvest(b["date"]),
            "gap": b["rc_open_first"] / a["rc_last_1730"] - 1.0,
            "kc_after": kc_after_prev,
            "b3": b3_resid.get(a["date"]),
            "day": (b["rc_last_1730"] / a["rc_last_1730"] - 1.0) if b.get("rc_last_1730") else None,
            "drift": (b["rc_last_1730"] / b["rc_open_first"] - 1.0) if b.get("rc_last_1730") else None,
            "kc_day": kc_day,
        })
    svals: list[float] = []
    for r_ in sframe:
        if r_["kc_after"] is None:
            r_["kz"] = None
            continue
        r_["kz"] = (r_["kc_after"] / st.pstdev(svals)) if len(svals) >= 60 and st.pstdev(svals) else None
        svals.append(r_["kc_after"])

    def _split_corr(fac_key: str, tgt_key: str) -> dict:
        out_s = {}
        for lbl, sel in (("harvest", True), ("off", False)):
            ps = [(r_[fac_key], r_[tgt_key]) for r_ in sframe
                  if r_[fac_key] is not None and r_[tgt_key] is not None and r_["h"] == sel]
            rr = _corr([p[0] for p in ps], [p[1] for p in ps])
            out_s[lbl] = {"n": len(ps), "r": _r(rr), "t": _r(_t_of(rr, len(ps)), 2)}
        return out_s

    def _heavy_cont(tgt_key: str, sel: bool) -> dict:
        ok = [r_ for r_ in sframe if r_["h"] == sel and r_.get("kz") is not None
              and abs(r_["kz"]) >= 1.5 and r_[tgt_key] is not None]
        if len(ok) < 12:
            return {"n": len(ok)}
        cont = st.mean(1.0 if (r_["kc_after"] > 0) == (r_[tgt_key] > 0) else 0.0 for r_ in ok)
        return {"n": len(ok), "cont": _r(cont * 100, 1)}

    hv_heavy = [r_ for r_ in sframe if r_["h"] and r_.get("kz") is not None
                and abs(r_["kz"]) >= 1.5 and r_["drift"] is not None]
    aligned = (st.mean((1 if r_["kc_after"] > 0 else -1) * r_["drift"] for r_ in hv_heavy)
               if hv_heavy else None)
    ch = _heavy_cont("drift", True)
    co = _heavy_cont("drift", False)
    z_coin = z_seas = None
    if ch.get("cont") is not None:
        p1 = ch["cont"] / 100
        z_coin = _r((p1 - 0.5) / math.sqrt(0.25 / ch["n"]), 2)
        if co.get("cont") is not None:
            p2 = co["cont"] / 100
            pp_ = (p1 * ch["n"] + p2 * co["n"]) / (ch["n"] + co["n"])
            z_seas = _r((p1 - p2) / math.sqrt(pp_ * (1 - pp_) * (1 / ch["n"] + 1 / co["n"])), 2)
    b3_abs = {}
    for lbl, sel in (("harvest", True), ("off", False)):
        v = [abs(r_["b3"]) for r_ in sframe if r_["b3"] is not None and r_["h"] == sel]
        b3_abs[lbl] = _r(st.mean(v) * 100, 3) if v else None
    seasonality = {
        "harvest_def": "May–Sep (Brazil arabica main harvest + conilon overlap)",
        "b3_by_season": _split_corr("b3", "gap"),
        "b3_abs_move": b3_abs,
        "last_hour": {tgt: _split_corr("kc_after", tgt) for tgt in ("gap", "day", "drift", "kc_day")},
        "heavy": {tgt: {"harvest": _heavy_cont(tgt, True), "off": _heavy_cont(tgt, False)}
                  for tgt in ("gap", "day", "drift")},
        "heavy_drift_detail": {
            "up": _r(st.mean(1.0 if r_["drift"] > 0 else 0.0 for r_ in hv_heavy if r_["kc_after"] > 0) * 100, 1)
            if any(r_["kc_after"] > 0 for r_ in hv_heavy) else None,
            "dn": _r(st.mean(1.0 if r_["drift"] < 0 else 0.0 for r_ in hv_heavy if r_["kc_after"] < 0) * 100, 1)
            if any(r_["kc_after"] < 0 for r_ in hv_heavy) else None,
            "aligned_drift_pct": _r(aligned * 100, 2) if aligned is not None else None,
            "z_vs_coin": z_coin, "z_vs_offseason": z_seas,
        },
        "rc_last_hour_status": "not in stored anchors — rc_last_1630 records forward from 2026-08 (daily refresher); test activates at ~120 harvest sessions",
    }

    # ── walk-forward gates ──────────────────────────────────────────────────
    p_base = _wf_preds(data, ["kc_after", "dsr"])
    p_b3 = _wf_preds(data, ["kc_after", "dsr", "b3"])
    p_b3u = _wf_preds(data, ["b3"])
    p_rc = _wf_preds(data, ["kc_after", "dsr", "rc_ret"])
    common_b3 = sorted(set(p_base) & set(p_b3))
    common_rc = sorted(set(p_base) & set(p_rc))
    base_full = _edge(p_base)
    per_year_base = {}
    for yr in ("2022", "2023", "2024", "2025", "2026"):
        ds = [d for d in p_base if d[:4] == yr]
        if len(ds) >= 40:
            per_year_base[yr] = _edge(p_base, ds)["edge"]
    flips = [d for d in common_b3 if p_base[d][0] != p_b3[d][0]]
    flips_won = sum(1 for d in flips if p_b3[d][0] == p_b3[d][1])
    gate = {
        "baseline": {**base_full, "per_year": per_year_base},
        "b3_univariate": _edge(p_b3u),
        "b3_matched": {
            "base": _edge(p_base, common_b3), "with_b3": _edge(p_b3, common_b3),
            "marginal": _r((_edge(p_b3, common_b3)["acc"] - _edge(p_base, common_b3)["acc"]), 1)
            if common_b3 else None,
            "flips": len(flips), "flips_won": flips_won,
        },
        "rc_ret_matched": {
            "base": _edge(p_base, common_rc), "with_rc": _edge(p_rc, common_rc),
            "marginal": _r((_edge(p_rc, common_rc)["acc"] - _edge(p_base, common_rc)["acc"]), 1)
            if common_rc else None,
        },
    }

    cnl_hist = _load(CNL).get("history", [])
    out = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "method": {
            "target": "RC overnight gap (open vs prior 17:30-London close), roll days excluded",
            "alignment": "every factor value is knowable strictly before the session's open",
            "b3_construction": f"ICF front daily return residual vs same-day KC settle return (rolling-{BETA_WIN} beta), both legs roll-cleaned; knowable ~21:00 London",
            "wf": f"expanding window, standardise-on-past, refit every {WF_STEP}, min-train {MIN_TRAIN}, rolling-{MIN_TRAIN} majority baseline; marginals on matched OOS dates",
            "rolling_window": ROLL_WIN,
        },
        "live_model": {
            "active_features": active_live,
            "n_features": live_model.get("n_features"),
            "edge": _r(live_model.get("edge"), 4),
            "acted_accuracy": _r(live_model.get("acted_accuracy"), 4),
            "cci_available": live_model.get("cci_available"),
            "b3_close_gap_sessions": len(b3_gap),
            "b3_close_gap_gate": 40,
            "note": "read from quant_report.json['open_direction']['model'] — the "
                    "03:00 job's own output, so this panel cannot drift from the "
                    "live spec",
        },
        "factors": factors,
        "rolling": rolling,
        "gate": gate,
        "power": power,
        "seasonality": seasonality,
        "b3_study": {
            "arabica": {
                "icf_sessions": len(icf_ret) + 1, "resid_sessions": len(b3_resid),
                "close_gap_note": "B3 ICF closes ~2.4h after KC's NY close; the residual isolates what B3 printed that KC's close did not contain",
            },
            "conilon": {
                "cnl_sessions": len(cnl_hist),
                "status": "DATA-STARVED — accumulator started 2026-08; timing viable (B3 closes ~3h after RC; settle knowable pre-firing); retest at ~300 sessions",
            },
        },
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    g = gate["b3_matched"]
    print(f"  open_direction_factors.json → baseline edge {gate['baseline']['edge']}pp "
          f"(n={gate['baseline']['n']}) | b3 marginal {g['marginal']}pp on {g['base']['n'] if g['base'] else 0} matched days "
          f"| rolling rows {len(rolling)}")


if __name__ == "__main__":
    export_open_direction_factors()
