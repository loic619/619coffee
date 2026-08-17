"""
options_flow_cot.py — options flow as a faster COT: does daily option OI
front-run the weekly managed-money print?

Research E of the options program. The COT report is weekly and three days
stale by publication; option open interest updates daily. If call/put OI
builds led managed-money futures changes, that would be a genuinely faster
positioning read. This exporter aligns daily options flow with the weekly
COT calendar and tests it — with the two honesty controls that decide
whether there is anything here at all.

Construction
============
* OI re-dating: the OI printed on session D reflects the close of D−1 (the
  vendor updates OI overnight; the newest session's OI is always null). The
  flow attributed to session D is therefore OI(printed D+1) − OI(printed D),
  summed per board over boards present on both sessions.
* Delta-weighting: raw call and put OI changes are also collapsed into a
  futures-equivalent net flow, Σ ΔOI_call·Δ − Σ ΔOI_put·|Δ|, with deltas
  Black-76 from the stored per-strike IVs — one convention across the
  archive (same as the skew paper).
* Weekly windows: CFTC/ICE weeks end Tuesday. Option flow is summed over
  sessions in (prev Tuesday, Tuesday]; ΔMM is the same Tuesday-to-Tuesday
  change in managed-money net (NY for KC, London for RC).
* Scope honesty: the tracked boards carried almost no OI before the 2026
  front era (KC tracked option OI: ~0 through mid-2025 → 13k lots Dec-2025
  → 146k Aug-2026). The weekly study therefore starts 2026-01 — 32 weeks,
  growing by one every Friday.

The two controls
================
1. ΔMM is mostly the tape: corr(ΔMM, same-week return) ≈ 0.73 (NY) / 0.76
   (London). Any claim that options flow "nowcasts" the print must survive
   partialling the week's return out — otherwise it is just price twice.
2. The sweep is stated: every channel × market × horizon tested is reported
   with its naive t. With ~16 tests, the honest significance bar sits near
   |t| ≈ 3, not 2.

Also published: the live price-implied ΔMM nowcast for the current
(partial) COT week — slope from the same 32-week fit — which is the part
of the print you can actually know before Friday.

Writes frontend/public/data/options_flow_cot.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR, ROOT

BOARDS = ROOT / "data" / "options_boards_archive.json"
COT = OUT_DIR / "cot.json"
OUT = OUT_DIR / "options_flow_cot.json"

SCAN_FROM = "2025-12-01"    # flows needed from here (weekly study starts 2026-01)
WEEK_START = "2026-01-01"
MIN_SESSIONS_PER_WEEK = 3

I_STRIKE, I_CALL_OI, I_CALL_IV, I_PUT_OI, I_PUT_IV = 0, 1, 4, 9, 12


def _r(x, n: int = 3):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _board_aggs(board: dict) -> dict | None:
    """Total call/put OI and delta-weighted net exposure of one board."""
    f, t = board.get("px"), board["dte"] / 365.0
    if not f or t <= 0:
        return None
    c = p = 0
    dw = 0.0
    for row in board["rows"]:
        k = row[I_STRIKE]
        c_oi = row[I_CALL_OI] or 0
        p_oi = row[I_PUT_OI] or 0
        c += c_oi
        p += p_oi
        iv = None
        for v in (row[I_CALL_IV], row[I_PUT_IV]):
            if v and 0.01 < v < 3:
                iv = v
                break
        if iv and k and k > 0:
            d1 = (math.log(f / k) + 0.5 * iv * iv * t) / (iv * math.sqrt(t))
            dw += c_oi * _ncdf(d1) - p_oi * (1.0 - _ncdf(d1))
    return {"c": c, "p": p, "dw": dw, "px": f, "dte": board["dte"]}


def _corr(a: list[float], b: list[float]) -> float | None:
    if len(a) < 4:
        return None
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    return num / (da * db) if da * db else None


def _partial(a, b, ctrl) -> float | None:
    rab, rac, rbc = _corr(a, b), _corr(a, ctrl), _corr(b, ctrl)
    if None in (rab, rac, rbc):
        return None
    den = math.sqrt((1 - rac * rac) * (1 - rbc * rbc))
    return (rab - rac * rbc) / den if den else None


def _t_of(r: float | None, n: int) -> float | None:
    if r is None or abs(r) >= 1 or n < 3:
        return None
    return r * math.sqrt(n - 2) / math.sqrt(1 - r * r)


def export_options_flow_cot():
    arch = _load(BOARDS)
    days = arch.get("days", {})
    cot = _load(COT)
    if not days or not cot:
        raise RuntimeError("boards archive or cot.json missing")

    dates = sorted(d for d in days if d >= SCAN_FROM)
    cache: dict[str, dict[str, dict]] = {}
    for dt in dates:
        cache[dt] = {}
        for mk in ("arabica", "robusta"):
            per = {}
            for b in days[dt].get(mk, []):
                a = _board_aggs(b)
                if a:
                    per[b["u"]] = a
            cache[dt][mk] = per

    # daily flow attributed to session dates[i]: printed(i+1) − printed(i)
    flows: dict[str, dict[str, dict]] = {"arabica": {}, "robusta": {}}
    for mk in flows:
        for i in range(len(dates) - 1):
            a, b = cache[dates[i]][mk], cache[dates[i + 1]][mk]
            dw = dc = dp = 0.0
            seen = False
            for u in a:
                if u in b:
                    dw += b[u]["dw"] - a[u]["dw"]
                    dc += b[u]["c"] - a[u]["c"]
                    dp += b[u]["p"] - a[u]["p"]
                    seen = True
            if seen:
                flows[mk][dates[i]] = {"dw": dw, "dc": dc, "dp": dp}

    # nearest-board settlement per session (week returns)
    px: dict[str, dict[str, float]] = {"arabica": {}, "robusta": {}}
    for mk in px:
        for dt in dates:
            per = cache[dt][mk]
            if per:
                near = min(per.values(), key=lambda x: x["dte"])
                px[mk][dt] = near["px"]

    def last_px_on_or_before(mk: str, d: str) -> float | None:
        prior = [x for x in dates if x <= d and x in px[mk]]
        return px[mk][prior[-1]] if prior else None

    out_markets = {}
    sweep_rows = []
    for mk, ck, label in (("arabica", "ny", "KC"), ("robusta", "ldn", "RC")):
        seq = [r for r in cot if r.get(ck) and r[ck].get("mm_long") is not None]
        weeks = []
        for i in range(1, len(seq)):
            t0, t1 = seq[i - 1]["date"], seq[i]["date"]
            if t1 < WEEK_START:
                continue
            wsess = [d for d in dates if t0 < d <= t1 and d in flows[mk]]
            if len(wsess) < MIN_SESSIONS_PER_WEEK:
                continue
            p0, p1 = last_px_on_or_before(mk, t0), last_px_on_or_before(mk, t1)
            if not p0 or not p1:
                continue
            weeks.append({
                "t": t1,
                "dmm": (seq[i][ck]["mm_long"] - seq[i][ck]["mm_short"])
                       - (seq[i - 1][ck]["mm_long"] - seq[i - 1][ck]["mm_short"]),
                "dw": round(sum(flows[mk][d]["dw"] for d in wsess)),
                "dc": round(sum(flows[mk][d]["dc"] for d in wsess)),
                "dp": round(sum(flows[mk][d]["dp"] for d in wsess)),
                "ret": _r(math.log(p1 / p0) * 100, 2),
            })
        n = len(weeks)
        dmm = [w["dmm"] for w in weeks]
        ret = [w["ret"] for w in weeks]
        r_mm_ret = _corr(dmm, ret)

        same_week = {}
        for key in ("dw", "dc", "dp"):
            v = [w[key] for w in weeks]
            r0 = _corr(v, dmm)
            rp = _partial(v, dmm, ret)
            same_week[key] = {"r": _r(r0), "t": _r(_t_of(r0, n), 2),
                              "partial_ret": _r(rp), "t_partial": _r(_t_of(rp, n), 2)}
            sweep_rows.append({"market": label, "test": f"{key} same-week", "r": _r(r0), "t": _r(_t_of(r0, n), 2)})

        lead = {}
        for key in ("dw", "dc", "dp"):
            v = [w[key] for w in weeks]
            rl = _corr(v[:-1], dmm[1:])
            pl_ret = _partial(v[:-1], dmm[1:], ret[:-1])
            pl_dmm = _partial(v[:-1], dmm[1:], dmm[:-1])
            h = (n - 1) // 2
            halves = [_r(_corr(v[:h], dmm[1:h + 1])), _r(_corr(v[h:-1], dmm[h + 1:]))]
            lead[key] = {"r": _r(rl), "t": _r(_t_of(rl, n - 1), 2),
                         "partial_ret": _r(pl_ret), "partial_dmm": _r(pl_dmm),
                         "halves": halves}
            sweep_rows.append({"market": label, "test": f"{key} lead 1w", "r": _r(rl), "t": _r(_t_of(rl, n - 1), 2)})

        rt = _corr([w["dw"] for w in weeks][:-1], ret[1:])
        ret_transfer = {"r": _r(rt), "t": _r(_t_of(rt, n - 1), 2)}
        sweep_rows.append({"market": label, "test": "dw → next-week return", "r": _r(rt), "t": _r(_t_of(rt, n - 1), 2)})

        # daily availability-lagged test: flow of session i is knowable only
        # after i+1's OI print → it can only predict the i+1 → i+2 return.
        drows = []
        ds = [d for d in dates if d in flows[mk]]
        for j in range(len(ds) - 2):
            d0, d1, d2 = ds[j], ds[j + 1], ds[j + 2]
            if d1 in px[mk] and d2 in px[mk]:
                drows.append((flows[mk][d0]["dw"], math.log(px[mk][d2] / px[mk][d1]) * 100))
        rd = _corr([x[0] for x in drows], [x[1] for x in drows])
        daily = {"n": len(drows), "r": _r(rd), "t": _r(_t_of(rd, len(drows)), 2)}
        sweep_rows.append({"market": label, "test": "daily dw → next-day return", "r": _r(rd), "t": _r(_t_of(rd, len(drows)), 2)})

        # price-implied ΔMM: fit dmm = a + b·ret, publish the current
        # partial-week estimate.
        b_slope = (r_mm_ret * st.pstdev(dmm) / st.pstdev(ret)) if (r_mm_ret is not None and st.pstdev(ret)) else None
        a_int = st.mean(dmm) - b_slope * st.mean(ret) if b_slope is not None else None
        last_tue = seq[-1]["date"]
        cur_sess = [d for d in dates if d > last_tue]
        p_base = last_px_on_or_before(mk, last_tue)
        p_now = last_px_on_or_before(mk, dates[-1]) if dates else None
        ret_so_far = _r(math.log(p_now / p_base) * 100, 2) if (p_base and p_now and cur_sess) else None
        flow_so_far = round(sum(flows[mk][d]["dw"] for d in cur_sess if d in flows[mk])) if cur_sess else None
        nowcast = _r(a_int + b_slope * ret_so_far, 0) if (b_slope is not None and ret_so_far is not None) else None

        out_markets[mk] = {
            "weeks": weeks,
            "stats": {
                "n": n, "start": weeks[0]["t"] if weeks else None, "end": weeks[-1]["t"] if weeks else None,
                "r_mm_ret": _r(r_mm_ret), "r2_mm_ret": _r(r_mm_ret ** 2 if r_mm_ret is not None else None),
                "same_week": same_week, "lead": lead, "ret_transfer": ret_transfer, "daily": daily,
            },
            "beta": {
                "slope_lots_per_pct": _r(b_slope, 0), "intercept": _r(a_int, 0),
                "week_of": last_tue, "sessions_so_far": len(cur_sess),
                "ret_so_far": ret_so_far, "flow_dw_so_far": flow_so_far,
                "nowcast_dmm": nowcast,
            },
        }

    out = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "method": {
            "oi_redating": "OI printed at session D reflects the close of D-1; flow(D) = printed(D+1) - printed(D), per board present both sessions",
            "delta_weighting": "Black-76 deltas from stored per-strike IVs",
            "weeks": "COT Tuesdays; option flow summed over (prev Tue, Tue]",
            "scope": "tracked boards carry meaningful OI only from the 2026 front era; weekly study starts 2026-01",
            "sweep_note": "all tested channels reported; with ~16 tests the honest bar is |t| ~ 3",
        },
        "sweep": sweep_rows,
        "markets": out_markets,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    for mk, blk in out_markets.items():
        s = blk["stats"]
        print(f"  options_flow_cot.json → {mk}: {s['n']} weeks, corr(dMM, ret)={s['r_mm_ret']} | "
              f"best same-week partial t={max((v['t_partial'] or 0) for v in s['same_week'].values()):.2f} | "
              f"nowcast dMM {blk['beta']['nowcast_dmm']}")


if __name__ == "__main__":
    export_options_flow_cot()
