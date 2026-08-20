"""
intraday_drift.py — the harvest last-hour signal on its own horizon.

Follow-up study (2026-08) to the open-direction factor panel. That panel found
that KC's last hour (17:30→18:30 London, after robusta closes) predicts the
next session's POST-OPEN DRIFT — but only during Brazil harvest, and only on
heavy moves. The open-direction model does not trade that horizon (it calls
the overnight GAP), so the signal was recorded rather than used. This exporter
tests it properly on its own target.

The rule (deliberately parameter-poor: a SIGN rule, nothing fitted)
==================================================================
  feature   prior session's KC last hour, kc_1830 / kc_1730 − 1
  gate      |z| ≥ 1.5 on a PAST-ONLY expanding std (min 60 obs), AND the
            session falls in the Brazil harvest window (May–Sep)
  trade     RC post-open drift in the same direction: long if the last hour
            was up, short if down
  target    rc_1730 / rc_open_first − 1  (open → close, same session,
            same contract by construction — roll-immune)
  warm-up   the first 252 sessions are never traded

Nothing is regressed and no coefficient is estimated, so there is no fitting
to leak; the only in-sample choices are the |z| gate and the harvest window,
both stated, and the threshold sweep is published.

Honesty about discovery
=======================
The harvest×last-hour interaction was DISCOVERED on this same price history
(see the factor panel). This study is therefore a confirmation, not an
out-of-sample validation. What carries the weight instead:
  * per-season stability — every harvest season is independently positive;
  * a gap control — the drift is not the overnight gap continuing
    (corr ≈ −0.05; residualising drift on the gap makes the rule STRONGER);
  * two placebos — random signs on the same days, and the same rule with the
    feature lagged one extra session (the timing-specific one must die);
  * a weekly block bootstrap CI;
  * costs and a pessimistic entry (09:15 instead of the open).
The forward record is the real arbiter and accrues from here.

Writes frontend/public/data/intraday_drift.json.
"""
from __future__ import annotations

import json
import math
import random
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR

INTRADAY = OUT_DIR / "intraday_kc_rc_15min.json"
OUT = OUT_DIR / "intraday_drift.json"

Z_GATE = 1.5
Z_MIN_OBS = 60
WARMUP = 252
HARVEST_MONTHS = (5, 6, 7, 8, 9)
COST_USD_T = 4.0          # round-trip spread+commission assumption, USD/tonne
BOOT_N = 4000
BLOCK = 5                 # weekly blocks for the bootstrap
SEED = 7


def _r(x, n: int = 3):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _corr(a, b):
    if len(a) < 20:
        return None
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    return num / (da * db) if da * db else None


def _tstat(v: list[float]) -> float | None:
    if len(v) < 3:
        return None
    sd = st.pstdev(v)
    return st.mean(v) / (sd / math.sqrt(len(v))) if sd else None


def _cell(v: list[float]) -> dict:
    return {"n": len(v), "mean": _r(st.mean(v)) if v else None, "t": _r(_tstat(v), 2)}


def export_intraday_drift():
    raw = _load(INTRADAY)
    if not raw:
        raise RuntimeError("intraday_kc_rc_15min.json missing")
    rows = sorted(raw, key=lambda x: x["date"])

    frame = []
    for i in range(1, len(rows)):
        a, b = rows[i - 1], rows[i]
        ka = (a["kc_last_1830"] / a["kc_last_1730"] - 1.0
              if a.get("kc_last_1730") and a.get("kc_last_1830") else None)
        drift = (b["rc_last_1730"] / b["rc_open_first"] - 1.0
                 if b.get("rc_last_1730") and b.get("rc_open_first") else None)
        if ka is None or drift is None:
            continue
        gap = (b["rc_open_first"] / a["rc_last_1730"] - 1.0
               if a.get("rc_symbol") == b.get("rc_symbol") and a.get("rc_last_1730")
               and b.get("rc_open_first") else None)
        first15 = (b["rc_open_0915"] / b["rc_open_first"] - 1.0
                   if b.get("rc_open_0915") and b.get("rc_open_first") else None)
        after15 = (b["rc_last_1730"] / b["rc_open_0915"] - 1.0
                   if b.get("rc_open_0915") and b.get("rc_last_1730") else None)
        frame.append({
            "date": b["date"], "h": int(b["date"][5:7]) in HARVEST_MONTHS,
            "ka": ka, "drift": drift, "gap": gap, "px": b["rc_open_first"],
            "first15": first15, "after15": after15,
        })

    vals: list[float] = []
    for f in frame:
        sd = st.pstdev(vals) if len(vals) >= Z_MIN_OBS else 0
        f["z"] = (f["ka"] / sd) if sd else None
        vals.append(f["ka"])

    def _signed(f, key="drift"):
        return (1 if f["ka"] > 0 else -1) * f[key] * 100

    def _select(thr: float, harvest: bool | None):
        out = []
        for i, f in enumerate(frame):
            if i < WARMUP or f["z"] is None or abs(f["z"]) < thr:
                continue
            if harvest is not None and f["h"] != harvest:
                continue
            out.append(f)
        return out

    sel = _select(Z_GATE, True)
    if len(sel) < 10:
        raise RuntimeError("not enough gated harvest sessions")
    pnl = [_signed(f) for f in sel]

    # threshold × season sweep (all published)
    sweep = []
    for thr in (1.0, 1.5, 2.0):
        for lbl, hv in (("harvest", True), ("off-season", False), ("all seasons", None)):
            s = _select(thr, hv)
            if len(s) >= 10:
                v = [_signed(f) for f in s]
                hit = st.mean(1.0 if (f["ka"] > 0) == (f["drift"] > 0) else 0.0 for f in s)
                sweep.append({"z": thr, "season": lbl, "n": len(s), "hit": _r(hit * 100, 1),
                              "mean": _r(st.mean(v)), "t": _r(_tstat(v), 2),
                              "usd": _r(st.mean(_signed(f) / 100 * f["px"] for f in s), 1)})

    per_season = []
    by_year: dict[str, list] = {}
    for f in sel:
        by_year.setdefault(f["date"][:4], []).append(f)
    for yr, v in sorted(by_year.items()):
        vv = [_signed(f) for f in v]
        per_season.append({"year": int(yr), "n": len(v),
                           "hit": _r(st.mean(1.0 if (f["ka"] > 0) == (f["drift"] > 0) else 0.0 for f in v) * 100, 1),
                           "mean": _r(st.mean(vv))})

    # ── robustness ─────────────────────────────────────────────────────────
    gp = [(f["gap"], f["drift"]) for f in frame if f["gap"] is not None]
    r_gap = _corr([p[0] for p in gp], [p[1] for p in gp])
    xs = [p[0] for p in gp]
    ys = [p[1] for p in gp]
    mx, my = st.mean(xs), st.mean(ys)
    beta = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    resid_pnl = [(1 if f["ka"] > 0 else -1) * (f["drift"] - beta * f["gap"]) * 100
                 for f in sel if f["gap"] is not None]

    rnd = random.Random(SEED)
    series = [_signed(f) for f in sel]
    blocks = [series[i:i + BLOCK] for i in range(0, len(series), BLOCK)]
    boots = []
    for _ in range(BOOT_N):
        samp: list[float] = []
        for _ in range(len(blocks)):
            samp += rnd.choice(blocks)
        boots.append(st.mean(samp))
    boots.sort()
    obs = st.mean(pnl)

    rnd2 = random.Random(SEED + 4)
    placebo = sorted(st.mean(rnd2.choice((1, -1)) * f["drift"] * 100 for f in sel) for _ in range(2000))
    p_placebo = sum(1 for m in placebo if m >= obs) / len(placebo)

    lagged = []
    for i, f in enumerate(frame):
        if i < WARMUP + 1 or f["z"] is None or not f["h"] or abs(f["z"]) < Z_GATE:
            continue
        lagged.append((1 if frame[i - 1]["ka"] > 0 else -1) * f["drift"] * 100)

    # Continuation split by the direction of the last hour. A pre-hedging
    # story predicts the SELLING side is sharper (that is the hedger's
    # direction); published so the card never hardcodes it.
    def _cont(rows_):
        return _r(st.mean(1.0 if (f["ka"] > 0) == (f["drift"] > 0) else 0.0 for f in rows_) * 100, 1) if rows_ else None

    up_rows = [f for f in sel if f["ka"] > 0]
    dn_rows = [f for f in sel if f["ka"] < 0]
    direction_split = {"up_n": len(up_rows), "up_cont": _cont(up_rows),
                       "dn_n": len(dn_rows), "dn_cont": _cont(dn_rows)}

    gross_usd = st.mean(_signed(f) / 100 * f["px"] for f in sel)
    pess_usd = st.mean((1 if f["ka"] > 0 else -1) * f["after15"] * f["px"]
                       for f in sel if f["after15"] is not None)

    live = None
    last = frame[-1]
    if last["z"] is not None:
        live = {"date": last["date"], "kc_last_hour_pct": _r(last["ka"] * 100, 2),
                "z": _r(last["z"], 2), "in_harvest": last["h"],
                "armed": bool(last["h"] and abs(last["z"]) >= Z_GATE),
                "direction": ("long" if last["ka"] > 0 else "short") if last["h"] and abs(last["z"]) >= Z_GATE else None}

    out = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "method": {
            "feature": "prior session KC last hour (17:30→18:30 London)",
            "gate": f"|z| >= {Z_GATE} on a past-only expanding std (min {Z_MIN_OBS} obs) AND harvest month (May–Sep)",
            "target": "RC post-open drift, open → 17:30 close, same session",
            "rule": "sign rule — nothing fitted, no coefficient estimated",
            "warmup": WARMUP, "cost_usd_t": COST_USD_T,
        },
        "headline": {
            "n": len(sel), "span": [sel[0]["date"], sel[-1]["date"]],
            "hit": _r(st.mean(1.0 if (f["ka"] > 0) == (f["drift"] > 0) else 0.0 for f in sel) * 100, 1),
            "mean_pct": _r(obs), "t": _r(_tstat(pnl), 2),
            "usd_gross": _r(gross_usd, 1), "usd_net": _r(gross_usd - COST_USD_T, 1),
        },
        "sweep": sweep,
        "per_season": per_season,
        "robustness": {
            "gap_corr": _r(r_gap),
            "gap_residualised": _cell(resid_pnl),
            "where_it_accrues": {
                "first15": _cell([(1 if f["ka"] > 0 else -1) * f["first15"] * 100
                                  for f in sel if f["first15"] is not None]),
                "after15": _cell([(1 if f["ka"] > 0 else -1) * f["after15"] * 100
                                  for f in sel if f["after15"] is not None]),
            },
            "bootstrap": {"lo": _r(boots[int(0.025 * len(boots))]),
                          "hi": _r(boots[int(0.975 * len(boots))]),
                          "p_gt0": _r(sum(1 for m in boots if m > 0) / len(boots) * 100, 1)},
            "placebo_random_signs": {"p": _r(p_placebo, 4), "pct95": _r(placebo[int(0.95 * len(placebo))])},
            "placebo_lagged_feature": _cell(lagged),
            "pessimistic_entry_usd": _r(pess_usd, 1),
            "direction_split": direction_split,
        },
        "live": live,
        "trades": [{"date": f["date"], "z": _r(f["z"], 2), "pnl_pct": _r(_signed(f)),
                    "usd": _r(_signed(f) / 100 * f["px"], 1)} for f in sel],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    h = out["headline"]
    print(f"  intraday_drift.json → n={h['n']} hit {h['hit']}% mean {h['mean_pct']}% "
          f"(t {h['t']}) ${h['usd_net']}/t net | lagged placebo t {out['robustness']['placebo_lagged_feature']['t']}")


if __name__ == "__main__":
    export_intraday_drift()
