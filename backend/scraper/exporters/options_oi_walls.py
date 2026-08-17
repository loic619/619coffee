"""
options_oi_walls.py — OI walls as support and resistance: does price respect
where option open interest piles up?

Research F of the options program — the static complement to the gamma map.
Strike matrices show open interest accumulating at specific levels ("walls").
Folk wisdom says a heavy call strike above spot acts as resistance and a
heavy put strike below as support. This exporter tests that at settlement
resolution with matched-distance controls, and publishes the live wall map.

Construction
============
* Near board (dte ≥ 7) per session; crossings measured on the SAME board's
  consecutive settlements (no roll jumps): strike K is "crossed" between t
  and t+1 when min(F_t, F_t+1) < K ≤ max(F_t, F_t+1). Settlement-resolution
  honesty: intraday touches and rejections are invisible — this tests
  whether settlements END UP beyond the level, the coarser (and harder)
  claim.
* Directional wall definition (the classic hypothesis, pre-specified as the
  primary test): for strikes within 3% of spot, the SIDE-relevant OI — call
  OI for strikes above spot, put OI for strikes below — at ≥ 4× the median
  nonzero strike OI in the ±6% window and above an absolute floor
  (KC 500 / RC 300 lots). Controls are light strikes (total OI ≤ median) in
  the same 0-3% window.
* Inference is session-clustered: within each session, (wall crossing
  share) − (light crossing share); the t-stat is on those per-session
  paired differences, so one price path crossing several adjacent strikes
  counts once.
* Era honesty: walls require OI; the tracked boards carry it only from the
  2026 front era (KC 2025-11-24, RC 2025-12-17) — same scope note as
  Research E.

The falsification family (all reported in the sweep): the same test with
undirected total OI (null), monster-only walls ≥ 10× median (null), a
round-number-vs-not control among light strikes (null — the effect is OI,
not roundness), and a "magnet" test of drift toward the biggest wall
(null). Only the classic directional construction shows an effect, in both
markets independently.

Writes frontend/public/data/options_oi_walls.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR, ROOT

BOARDS = ROOT / "data" / "options_boards_archive.json"
OUT = OUT_DIR / "options_oi_walls.json"

ERA = {"arabica": "2025-11-24", "robusta": "2025-12-17"}
FLOOR = {"arabica": 500, "robusta": 300}
ROUND = {"arabica": 25.0, "robusta": 100.0}
WALL_MULT = 4          # side OI >= 4x median nonzero strike OI
MONSTER_MULT = 10
NEAR_PCT = 0.03        # primary window: within 3% of spot
SCAN_PCT = 0.06        # median computed over +/-6%
MIN_DTE = 7
HIST_SESSIONS = 90     # wall-accumulation history depth

I_STRIKE, I_CALL_OI, I_PUT_OI = 0, 1, 9


def _r(x, n: int = 3):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _near_board(days: dict, dt: str, mk: str) -> dict | None:
    bs = sorted(days[dt].get(mk, []), key=lambda b: b["dte"])
    bs = [b for b in bs if b["dte"] >= MIN_DTE]
    return bs[0] if bs else None


def _paired_t(diffs: list[float]) -> tuple[float | None, float | None]:
    if len(diffs) < 8:
        return (None, None)
    m = st.mean(diffs)
    sd = st.pstdev(diffs)
    return m, (m / (sd / math.sqrt(len(diffs))) if sd else None)


def _win(board: dict, f: float, pct: float) -> list[tuple[float, int, int]]:
    return [(r[I_STRIKE], (r[I_CALL_OI] or 0), (r[I_PUT_OI] or 0))
            for r in board["rows"] if r[I_STRIKE] and abs(r[I_STRIKE] / f - 1) <= pct]


def _crossed(f0: float, f1: float, k: float) -> int:
    return 1 if min(f0, f1) < k <= max(f0, f1) else 0


def _study(days: dict, dates: list[str], mk: str) -> dict:
    ds = [d for d in dates if d >= ERA[mk]]
    diffs, w_rates, l_rates = [], [], []
    und_bands: dict[str, list[float]] = {f"{lo}-{hi}%": [] for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 4), (4, 6))}
    round_diffs: list[float] = []
    monster = {"wall": [], "light": []}
    magnet: list[tuple[int, float]] = []
    side_rates = {"call_above": {"w": [], "l": []}, "put_below": {"w": [], "l": []}}

    for i in range(len(ds) - 1):
        b0, b1 = _near_board(days, ds[i], mk), _near_board(days, ds[i + 1], mk)
        if not b0 or not b1 or b0["u"] != b1["u"]:
            continue
        f0, f1 = b0.get("px"), b1.get("px")
        if not f0 or not f1:
            continue
        win6 = _win(b0, f0, SCAN_PCT)
        nz = [c + p for _, c, p in win6 if c + p > 0]
        if len(nz) < 6:
            continue
        med = st.median(nz)

        # primary: directional side walls vs light strikes, 0-3%
        w_cross, l_cross = [], []
        for k, c, p in win6:
            pct = abs(k / f0 - 1) * 100
            if pct >= NEAR_PCT * 100:
                continue
            side = "call_above" if k > f0 else "put_below"
            side_oi = c if k > f0 else p
            x = _crossed(f0, f1, k)
            if side_oi >= WALL_MULT * med and side_oi >= FLOOR[mk]:
                w_cross.append(x)
                side_rates[side]["w"].append(x)
            elif c + p <= med:
                l_cross.append(x)
                side_rates[side]["l"].append(x)
        if w_cross and l_cross:
            diffs.append(st.mean(w_cross) - st.mean(l_cross))
            w_rates.append(st.mean(w_cross))
            l_rates.append(st.mean(l_cross))

        # falsification: undirected total-OI walls by distance band
        per_band: dict[str, dict[str, list[int]]] = {}
        for k, c, p in win6:
            pct = abs(k / f0 - 1) * 100
            band = next((f"{lo}-{hi}%" for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 4), (4, 6)) if lo <= pct < hi), None)
            if band is None:
                continue
            tier = "wall" if (c + p >= WALL_MULT * med and c + p >= FLOOR[mk]) else ("light" if c + p <= med else None)
            if tier is None:
                continue
            per_band.setdefault(band, {"wall": [], "light": []})[tier].append(_crossed(f0, f1, k))
        for band, tiers in per_band.items():
            if tiers["wall"] and tiers["light"]:
                und_bands[band].append(st.mean(tiers["wall"]) - st.mean(tiers["light"]))

        # falsification: round vs non-round among LIGHT strikes, 0-3%
        r_c, nr_c = [], []
        for k, c, p in win6:
            pct = abs(k / f0 - 1) * 100
            if pct >= 3 or c + p > med:
                continue
            (r_c if k % ROUND[mk] == 0 else nr_c).append(_crossed(f0, f1, k))
        if r_c and nr_c:
            round_diffs.append(st.mean(r_c) - st.mean(nr_c))

        # falsification: monster walls (>= 10x median)
        big = [(k, c, p) for k, c, p in win6 if c + p >= MONSTER_MULT * med and c + p >= 2 * FLOOR[mk]]
        if big:
            k, c, p = max(big, key=lambda x: x[1] + x[2])
            pct = abs(k / f0 - 1) * 100
            monster["wall"].append(_crossed(f0, f1, k))
            lights = [_crossed(f0, f1, k2) for k2, c2, p2 in win6
                      if c2 + p2 <= med and abs(abs(k2 / f0 - 1) * 100 - pct) < 1]
            if lights:
                monster["light"].append(st.mean(lights))

        # falsification: magnet — drift toward the biggest wall over 3 sessions
        if i + 3 < len(ds):
            b3 = _near_board(days, ds[i + 3], mk)
            if b3 and b3["u"] == b0["u"] and b3.get("px"):
                k, c, p = max(win6, key=lambda x: x[1] + x[2])
                if c + p >= WALL_MULT * med and c + p >= FLOOR[mk] and abs(k / f0 - 1) > 0.005:
                    magnet.append((1 if k > f0 else -1, math.log(b3["px"] / f0) * 100))

    m, t = _paired_t(diffs)
    h = len(diffs) // 2
    m1, _ = _paired_t(diffs[:h])
    m2, _ = _paired_t(diffs[h:])
    rm, rt = _paired_t(round_diffs)
    mag = None
    if len(magnet) >= 20:
        sgn = [x[0] for x in magnet]
        ret = [x[1] for x in magnet]
        ms, mr = st.mean(sgn), st.mean(ret)
        num = sum((a - ms) * (b - mr) for a, b in magnet)
        den = math.sqrt(sum((a - ms) ** 2 for a in sgn) * sum((b - mr) ** 2 for b in ret))
        r_ = num / den if den else None
        mag = {"n": len(magnet), "r": _r(r_),
               "t": _r(r_ * math.sqrt(len(magnet) - 2) / math.sqrt(1 - r_ * r_), 2) if r_ is not None else None}

    return {
        "era": ERA[mk], "n_sessions": len(diffs),
        "directional": {
            "diff": _r(m), "t": _r(t, 2),
            "wall_rate": _r(st.mean(w_rates)) if w_rates else None,
            "light_rate": _r(st.mean(l_rates)) if l_rates else None,
            "halves": [_r(m1), _r(m2)],
            "sides": {
                s: {"wall_n": len(v["w"]), "wall_rate": _r(st.mean(v["w"])) if v["w"] else None,
                    "light_n": len(v["l"]), "light_rate": _r(st.mean(v["l"])) if v["l"] else None}
                for s, v in side_rates.items()
            },
        },
        "undirected_bands": [
            {"band": band, "n": len(dd), "diff": _r(_paired_t(dd)[0]), "t": _r(_paired_t(dd)[1], 2)}
            for band, dd in und_bands.items() if len(dd) >= 8
        ],
        "round_control": {"n": len(round_diffs), "diff": _r(rm), "t": _r(rt, 2)},
        "monster": {
            "n": len(monster["wall"]),
            "wall_rate": _r(st.mean(monster["wall"])) if monster["wall"] else None,
            "light_rate": _r(st.mean(monster["light"])) if monster["light"] else None,
        },
        "magnet": mag,
    }


def _live(days: dict, dates: list[str], mk: str) -> dict:
    """Current wall map + accumulation history of today's top walls."""
    b = None
    dt_used = None
    for dt in reversed(dates):
        b = _near_board(days, dt, mk)
        if b and b.get("px"):
            # newest session's OI is null — walk back until strikes carry OI
            if any((r[I_CALL_OI] or 0) + (r[I_PUT_OI] or 0) > 0 for r in b["rows"]):
                dt_used = dt
                break
    if not b or not dt_used:
        return {}
    f = b["px"]
    win = _win(b, f, SCAN_PCT)
    ladder = []
    for k, c, p in win:
        side = "resistance" if k > f else "support"
        side_oi = c if k > f else p
        if side_oi > 0:
            ladder.append({"strike": k, "side": side, "oi": side_oi,
                           "dist_pct": _r((k / f - 1) * 100, 2)})
    ladder.sort(key=lambda x: -x["oi"])
    top = ladder[:6]

    hist_ds = [d for d in dates if d <= dt_used][-HIST_SESSIONS:]
    strikes = [w["strike"] for w in top[:3]]
    history = []
    for d in hist_ds:
        # the current near board was often tracked earlier as a farther-dated
        # board (e.g. RMX26 behind RMU26) — follow the CONTRACT, not the
        # near-board slot, so the accumulation series survives the roll
        hb = next((x for x in days[d].get(mk, []) if x["u"] == b["u"]), None)
        if not hb:
            continue
        row: dict = {"date": d}
        for k in strikes:
            m = next((r for r in hb["rows"] if r[I_STRIKE] == k), None)
            if m:
                row[str(k)] = (m[I_CALL_OI] or 0) if k > f else (m[I_PUT_OI] or 0)
        history.append(row)
    return {"as_of": dt_used, "u": b["u"], "px": f,
            "ladder": sorted(top, key=lambda x: x["strike"]),
            "history_strikes": [str(k) for k in strikes], "history": history}


def export_options_oi_walls():
    arch = _load(BOARDS)
    days = arch.get("days", {})
    if not days:
        raise RuntimeError("options_boards_archive.json missing or empty")
    dates = sorted(days.keys())

    markets = {}
    for mk in ("arabica", "robusta"):
        markets[mk] = {"study": _study(days, dates, mk), "live": _live(days, dates, mk)}

    # pooled evidence for the pre-specified directional test (Stouffer)
    ts = [markets[mk]["study"]["directional"]["t"] for mk in markets]
    pooled_z = _r(sum(-t for t in ts if t is not None) / math.sqrt(len([t for t in ts if t is not None])), 2) \
        if all(t is not None for t in ts) else None

    out = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "method": {
            "wall": "side-relevant OI (calls above spot, puts below) >= 4x median nonzero strike OI in +/-6%, and >= floor (KC 500 / RC 300 lots); window 0-3% of spot",
            "control": "light strikes (total OI <= median) in the same window",
            "crossing": "same-board consecutive settlements; K crossed when min(F0,F1) < K <= max(F0,F1)",
            "inference": "session-clustered paired differences (wall share - light share per session)",
            "resolution": "settlements only — intraday touches/rejections are invisible",
        },
        "pooled_z_directional": pooled_z,
        "markets": markets,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    for mk, blk in markets.items():
        d = blk["study"]["directional"]
        print(f"  options_oi_walls.json → {mk}: n={blk['study']['n_sessions']} "
              f"wall {d['wall_rate']} vs light {d['light_rate']} (diff {d['diff']}, t {d['t']})")


if __name__ == "__main__":
    export_options_oi_walls()
