"""
options_gamma_map.py — dealer gamma by price level, and the vol regime it implies.

Research B of the options program. When dealers are net LONG gamma, their
delta-hedging leans against the market (buy dips, sell rips) and dampens
moves; net SHORT gamma flips the hedging to chase the market and amplifies
moves. The map of net gamma by price level — where it flips sign, where the
big walls sit — is therefore a daily read on whether hedging pressure is a
stabiliser or an accelerant, and at which prices that changes.

Gamma is reconstructed with Black-76 from each archived board's stored
per-strike IV (populated for the full history), the underlying settlement and
days-to-expiry:  gamma = phi(d1) / (F * sigma * sqrt(T)).

Dealer-side convention (stated, not hidden): the standard "naive GEX"
assumption — dealers are long the calls and short the puts customers hold —
so net dealer gamma per strike = gamma_call x call_OI − gamma_put x put_OI.
It is a convention, not an observation; the paper carries the caveat.

Scope honesty
=============
The boards archive only ever tracked the six currently-listed contracts, so
a FRONT-board gamma history does not exist before those became the fronts
(RM: July 2026, when RMN26 died; KC: August 2026, when KCU26's options died).
The historical regime test therefore runs on the tracked complex — real OI,
real gamma, but missing the front boards for most of the window — and its
result must be read as attenuated. From now on the tracked boards ARE the
fronts, so the clean regime series accumulates daily, same philosophy as the
expiry ledger.

Writes frontend/public/data/options_gamma_map.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR, ROOT

BOARDS = ROOT / "data" / "options_boards_archive.json"
FUTURES = OUT_DIR / "futures_price_history.json"
OUT = OUT_DIR / "options_gamma_map.json"

GRID_PCT = 15          # price grid ±15% around spot, 0.5% steps
GRID_STEP = 0.5
TREND_WIN = 120        # trailing window for relative-GEX percentile


def _r(x, n: int = 2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _phi(x: float) -> float:
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def _gamma_b76(f: float, k: float, iv: float, t_years: float) -> float:
    """Black-76 gamma per 1 futures-price unit, per contract."""
    if not f or not k or not iv or iv <= 0 or t_years <= 0:
        return 0.0
    srt = iv * math.sqrt(t_years)
    d1 = (math.log(f / k) + 0.5 * iv * iv * t_years) / srt
    return _phi(d1) / (f * srt)


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _board_rows(contract: dict, cols: dict) -> list[dict]:
    """Strikes with OI and a usable IV (own side's IV, other side as fallback)."""
    out = []
    for r in contract["rows"]:
        k = r[cols["strike"]]
        if k is None:
            continue
        c_oi, p_oi = r[cols["call_oi"]] or 0, r[cols["put_oi"]] or 0
        if c_oi + p_oi == 0:
            continue
        c_iv = r[cols["call_iv"]] or r[cols["put_iv"]]
        p_iv = r[cols["put_iv"]] or r[cols["call_iv"]]
        if not c_iv and not p_iv:
            continue
        out.append({"k": k, "call_oi": c_oi, "put_oi": p_oi, "call_iv": c_iv, "put_iv": p_iv})
    return out


def _net_gex(rows: list[dict], f: float, t_years: float) -> float:
    """Net dealer gamma (lots per unit price) at hypothetical future f."""
    g = 0.0
    for r in rows:
        g += _gamma_b76(f, r["k"], r["call_iv"], t_years) * r["call_oi"]
        g -= _gamma_b76(f, r["k"], r["put_iv"], t_years) * r["put_oi"]
    return g


def _session_gex(day: dict, mkt: str, cols: dict) -> dict | None:
    """Aggregate net + absolute gamma across the market's tracked boards, at spot."""
    net = gross = 0.0
    f_front = None
    for c in day.get(mkt) or []:
        f, dte = c.get("px"), c.get("dte")
        if not f or dte is None or dte <= 0:
            continue
        rows = _board_rows(c, cols)
        if not rows:
            continue
        t = dte / 365.0
        if f_front is None:
            f_front = f
        for r in rows:
            gc = _gamma_b76(f, r["k"], r["call_iv"], t) * r["call_oi"]
            gp = _gamma_b76(f, r["k"], r["put_iv"], t) * r["put_oi"]
            net += gc - gp
            gross += gc + gp
    if f_front is None or gross == 0:
        return None
    # hedge-flow interpretation: lots dealers must trade per 1% move at spot
    return {"net_lots_per_1pct": net * f_front * 0.01,
            "gross_lots_per_1pct": gross * f_front * 0.01}


def _live_map(day: dict, mkt: str, cols: dict) -> dict | None:
    """Full by-strike and by-price-level map from the latest boards with OI."""
    boards = []
    for c in day.get(mkt) or []:
        f, dte = c.get("px"), c.get("dte")
        if not f or dte is None or dte <= 0:
            continue
        rows = _board_rows(c, cols)
        if rows:
            boards.append({"u": c["u"], "f": f, "t": dte / 365.0, "dte": dte, "rows": rows})
    if not boards:
        return None
    front = boards[0]
    f0 = front["f"]

    # by-strike net dealer gamma, front board (where the walls live)
    by_strike = []
    for r in front["rows"]:
        gc = _gamma_b76(f0, r["k"], r["call_iv"], front["t"]) * r["call_oi"]
        gp = _gamma_b76(f0, r["k"], r["put_iv"], front["t"]) * r["put_oi"]
        if abs(r["k"] - f0) / f0 <= 0.20:
            by_strike.append({"strike": r["k"], "net_lots_per_1pct": _r((gc - gp) * f0 * 0.01, 1)})

    # net GEX across a hypothetical price grid (sticky-strike IVs), all boards
    grid = []
    steps = int(GRID_PCT / GRID_STEP)
    for i in range(-steps, steps + 1):
        fx = f0 * (1 + i * GRID_STEP / 100)
        net = sum(_net_gex(b["rows"], fx, b["t"]) for b in boards)
        grid.append({"pct": _r(i * GRID_STEP, 1), "price": _r(fx, 2),
                     "net_lots_per_1pct": _r(net * fx * 0.01, 1)})

    # zero-gamma flip: first sign change on the grid, linearly interpolated
    flip = None
    for a, b in zip(grid, grid[1:]):
        ga, gb = a["net_lots_per_1pct"], b["net_lots_per_1pct"]
        if ga is not None and gb is not None and ga * gb < 0:
            w = abs(ga) / (abs(ga) + abs(gb))
            flip = _r(a["price"] + w * (b["price"] - a["price"]), 2)
            break

    spot = next((g for g in grid if g["pct"] == 0), None)
    walls = sorted(by_strike, key=lambda x: -abs(x["net_lots_per_1pct"] or 0))[:3]
    return {
        "front": front["u"], "future": f0, "dte": front["dte"],
        "boards": [{"u": b["u"], "dte": b["dte"]} for b in boards],
        "spot_net_lots_per_1pct": spot["net_lots_per_1pct"] if spot else None,
        "flip_price": flip,
        "flip_pct": _r((flip / f0 - 1) * 100) if flip else None,
        "by_strike": by_strike,
        "grid": grid,
        "walls": walls,
    }


def _regime_test(series: list[dict], rets: dict) -> dict:
    """Does the tracked-complex GEX say anything about the NEXT session's move?

    GEX levels trend as the boards mature, so the conditioning variable is the
    sign of net GEX and its percentile within the trailing TREND_WIN sessions —
    never the raw level.
    """
    rows = []
    dates = [s["date"] for s in series]
    for i, s in enumerate(series):
        nxt = rets.get(s["date"])
        if nxt is None:
            continue
        hist = [x["net_lots_per_1pct"] for x in series[max(0, i - TREND_WIN):i]]
        pct = (sum(1 for h in hist if h <= s["net_lots_per_1pct"]) / len(hist) * 100) if len(hist) >= 40 else None
        rows.append({"date": s["date"], "net": s["net_lots_per_1pct"], "pctile": pct,
                     "ret_next": nxt["ret"], "absret_next": abs(nxt["ret"])})
    if len(rows) < 60:
        return {"n": len(rows)}

    pos = [r for r in rows if r["net"] > 0]
    neg = [r for r in rows if r["net"] < 0]

    def t_diff(a, b):
        if len(a) < 8 or len(b) < 8:
            return float("nan")
        va, vb = st.variance(a), st.variance(b)
        se = math.sqrt(va / len(a) + vb / len(b))
        return (st.mean(a) - st.mean(b)) / se if se else float("nan")

    out = {
        "n": len(rows), "start": dates[0], "end": dates[-1],
        "n_pos": len(pos), "n_neg": len(neg),
        "absret_next_pos": _r(st.mean([r["absret_next"] for r in pos]), 3) if pos else None,
        "absret_next_neg": _r(st.mean([r["absret_next"] for r in neg]), 3) if neg else None,
        "absret_t": _r(t_diff([r["absret_next"] for r in neg], [r["absret_next"] for r in pos]), 2),
    }
    # tercile on the trailing percentile (relative gamma, de-trended by construction)
    ranked = [r for r in rows if r["pctile"] is not None]
    if len(ranked) >= 90:
        ranked.sort(key=lambda r: r["pctile"])
        k = len(ranked) // 3
        lo, hi = ranked[:k], ranked[-k:]
        out["tercile"] = {
            "k": k,
            "absret_low_gex": _r(st.mean([r["absret_next"] for r in lo]), 3),
            "absret_high_gex": _r(st.mean([r["absret_next"] for r in hi]), 3),
            "t": _r(t_diff([r["absret_next"] for r in lo], [r["absret_next"] for r in hi]), 2),
        }
    # sign-conditional next-day autocorrelation: mean-reversion under long gamma?
    def autocorr(sel):
        pair = [(rets[r["date"]]["ret_prev"], r["ret_next"]) for r in sel
                if rets.get(r["date"], {}).get("ret_prev") is not None]
        if len(pair) < 30:
            return {"n": len(pair)}
        x = [a for a, _ in pair]; y = [b for _, b in pair]
        mx, my = st.mean(x), st.mean(y)
        sx = math.sqrt(sum((a - mx) ** 2 for a in x)); sy = math.sqrt(sum((b - my) ** 2 for b in y))
        if not sx or not sy:
            return {"n": len(pair)}
        rho = sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy)
        t = rho * math.sqrt((len(pair) - 2) / (1 - rho * rho)) if abs(rho) < 1 else float("inf")
        return {"n": len(pair), "r": _r(rho, 3), "t": _r(t, 2)}
    out["autocorr_pos_gex"] = autocorr(pos)
    out["autocorr_neg_gex"] = autocorr(neg)
    return out


def export_options_gamma_map() -> None:
    boards = _load(BOARDS)
    futures = _load(FUTURES)
    days = boards.get("days") or {}
    header = boards.get("header") or []
    if not days or not header:
        print("  options_gamma_map → no boards archive; skipping")
        return
    cols = {h: i for i, h in enumerate(header)}
    dates = sorted(days)

    # next-session return map per market from the continuous front series
    def ret_map(key: str) -> dict:
        ser = [p for p in (futures.get(key) or []) if p.get("price")]
        out = {}
        for i in range(1, len(ser) - 1):
            out[ser[i]["date"]] = {
                "ret": (ser[i + 1]["price"] / ser[i]["price"] - 1) * 100,
                "ret_prev": (ser[i]["price"] / ser[i - 1]["price"] - 1) * 100,
            }
        return out

    rets = {"arabica": ret_map("arabica"), "robusta": ret_map("robusta")}

    markets = {}
    for mkt in ("arabica", "robusta"):
        series = []
        for d in dates:
            g = _session_gex(days[d], mkt, cols)
            if g:
                series.append({"date": d, "net_lots_per_1pct": _r(g["net_lots_per_1pct"], 1),
                               "gross_lots_per_1pct": _r(g["gross_lots_per_1pct"], 1)})
        # latest session with OI for the live map (newest session's OI is null)
        live = None
        for d in reversed(dates):
            live = _live_map(days[d], mkt, cols)
            if live:
                live["date"] = d
                break
        markets[mkt] = {
            "series": series,
            "live": live,
            "regime": _regime_test(series, rets[mkt]),
        }

    doc = {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "method": {
            "gamma": "Black-76 from each board's stored per-strike IV, settlement and DTE; "
                     "gamma = phi(d1)/(F*sigma*sqrt(T)).",
            "convention": "Naive dealer-side GEX: dealers long calls, short puts — "
                          "net = gamma_c*OI_c − gamma_p*OI_p per strike. A convention, not an observation.",
            "units": "lots dealers must trade per 1% move at the given price (gamma × OI × F × 1%).",
            "scope": "Boards archive holds only the currently-listed contracts; front-board gamma "
                     "history begins when these became the fronts (RM Jul-2026, KC Aug-2026). The "
                     "historical series is the tracked complex and is attenuated before those dates.",
            "grid": f"±{GRID_PCT}% in {GRID_STEP}% steps, sticky-strike IVs.",
        },
        "markets": markets,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    for mkt, m in markets.items():
        lv = m["live"] or {}
        print(f"  options_gamma_map.json → {mkt}: {len(m['series'])} sessions; live {lv.get('front')} "
              f"net {lv.get('spot_net_lots_per_1pct')} lots/1% flip {lv.get('flip_price')} "
              f"(regime n={m['regime'].get('n')})")


if __name__ == "__main__":
    export_options_gamma_map()
