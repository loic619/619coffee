"""
price_elasticity.py — how much of a futures move each origin's local market
actually absorbs, tracked through time.

The question: London rises USD 100/t. Vietnam's farmgate rises USD 50, Brazil
conilon USD 20. Vietnam absorbed half the move, Brazil a fifth — Vietnam is
where the futures move is being priced, so Vietnam is leading. Do that every
day, per coffee type, and leadership rotation becomes visible.

Both legs are converted to USD/t first. That is not cosmetic: a price quoted in
VND rises when the dong weakens even if the coffee did not move, and an
elasticity computed on local-currency prices would read FX drift as
pass-through.

Three things this has to get right, each of which silently produces
plausible-looking nonsense if ignored.

1. PUBLICATION LAG — the one that matters most
   ------------------------------------------
   Acaphe posts Vietnamese farmgate around 09:00 ICT, which is BEFORE London
   trades that day. So the Vietnam quote dated D reflects London's close on
   D−1, and comparing it to RC(D) compares a price against a session that had
   not happened yet. Measured over 970 paired observations:

       lag −2:  8.5%     lag −1: 71.7%     lag 0: 9.3%     lag +1: 12.6%

   Aligned correctly Vietnam is a 72% pass-through market. Aligned naively it
   looks like no relationship at all. Every origin publishing ahead of its
   futures market's session needs the same treatment, and `lag` below is pinned
   per origin from that scan (n in the comment beside each). It is deliberately
   NOT chosen at runtime: picking the best-fitting lag on every build is data
   snooping, and would let the published number drift with no one noticing.

2. SPARSE SERIES — do not difference a carried-forward price
   --------------------------------------------------------
   Uganda and Guatemala publish weekly. On a daily grid with the last print
   carried forward, four days in five have Δlocal exactly zero and the fifth
   carries a week of movement against one day of futures. That does not add
   noise, it destroys the covariance — the first cut of this file had Guatemala
   "positive 9% of days". Changes are therefore measured PRINT TO PRINT, with
   the futures change taken over the same span, so a weekly origin contributes
   real week-over-week observations.

3. CONTRACT ROLLS
   --------------
   futures_price_history stamps each row with its front contract, and the price
   gaps by the calendar spread when that changes — 2.4% of robusta days, 0.8%
   of arabica. A roll gap is not a market move, so any pair whose futures span
   crosses one is dropped.

Why a rolling beta and not a ratio of changes
============================================
The intuitive Δlocal ÷ Δfutures is unusable: futures spend weeks roughly flat,
the denominator crosses zero, and the ratio explodes on days when nothing
happened. The same quantity estimated over many observations at once is the
through-origin OLS slope

    beta = Σ(Δf·Δl) / Σ(Δf²)      over a trailing window

— identical to the ratio when futures move monotonically, stable when they
chop, and it degrades to "not enough signal" rather than to nonsense.

DERIVED: reads already-published static JSON (origin_prices_history, fx_history,
futures_price_history). Must run AFTER all three in the export order.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from scraper.exporters._series import asof, ffill_map, load_json, to_usd_mt
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import safe_write_json

OUT_PATH = OUT_DIR / "price_elasticity.json"

LB_PER_MT = 2204.62

# Trailing window for the beta, in CALENDAR days — the same horizon for every
# origin, which matters because the whole point is comparing them. A window in
# observations would give a weekly origin five months of history and a daily one
# one month, and their lines would not be answering the same question.
_WINDOW_DAYS = 90
_MIN_PAIRS = 8          # paired observations required before a beta is published
_MIN_SS = 1.0           # Σ(Δf²) floor, USD²/t² — below this the fit is noise
_TILE_DAYS = 7          # tiles average the beta over the last week

# Grades are averaged into one series per country per market: the question is
# which ORIGIN leads, and Guatemala's three ANACAFE grades move together, so
# carrying them separately would let one country occupy three slots.
#
# `lag` is in futures sessions, from the scan documented at the top of the file.
_MARKETS = {
    "robusta": {
        "label": "Robusta · ICE London (RC)",
        "futures_key": "robusta",
        "futures_unit": "usd_mt",
        "origins": {
            "vietnam": {"name": "Vietnam", "color": "#f59e0b", "lag": -1,
                        # 71.7% at −1 vs 9.3% at 0, n=970. Acaphe posts 09:00 ICT.
                        "grades": ["vietnam"]},
            "brazil": {"name": "Brazil (conilon)", "color": "#34d399", "lag": 0,
                       # 32.4% at 0, n=1032. CEPEA publishes after Brazil's close.
                       "grades": ["brazil_conilon"]},
            "uganda": {"name": "Uganda", "color": "#38bdf8", "lag": -2,
                       # 82.2% at −2, n=77 — coherent with a weekly UCDA report
                       # quoting a market already a couple of sessions old, but
                       # a thin sample; revisit once UCDA history deepens.
                       "grades": ["uganda"]},
        },
    },
    "arabica": {
        "label": "Arabica · ICE New York (KC)",
        "futures_key": "arabica",
        "futures_unit": "cents_lb",
        "origins": {
            "brazil": {"name": "Brazil (arabica)", "color": "#34d399", "lag": 0,
                       # 60.2% at 0, n=794.
                       "grades": ["brazil_arabica"]},
            "uganda": {"name": "Uganda", "color": "#38bdf8", "lag": -2,
                       # 83.0% / 82.8% at −2 across both grades, n=54 each.
                       "grades": ["uganda_drugar", "uganda_wugar"]},
            "guatemala": {"name": "Guatemala", "color": "#a78bfa", "lag": -1,
                          # 87.7% at −1 across all three grades, n=53. ANACAFE
                          # posts in the morning UTC−6, ahead of New York.
                          "grades": ["guatemala_prima_lavado", "guatemala_duro",
                                     "guatemala_estrictamente_duro"]},
        },
    },
}


def _fx_lookup(fx_pairs: dict, code: str):
    hist = (fx_pairs.get(code) or {}).get("history") or []
    return ffill_map([(r["date"], r.get("close")) for r in hist])


def _grade_usd_mt(grade: dict, fx_pairs: dict) -> dict[str, float]:
    """One grade's PRINTS converted to USD/t, keyed by their own dates."""
    unit = grade.get("unit") or ""
    ccy = (grade.get("currency") or "USD").upper()
    fx_dates, fx_by_date = ([], {})
    if ccy != "USD":
        fx_dates, fx_by_date = _fx_lookup(fx_pairs, f"{ccy}=X")
    out: dict[str, float] = {}
    for row in grade.get("history") or []:
        d, px = row.get("date"), row.get("price")
        if not d:
            continue
        fx = asof(fx_dates, fx_by_date, d) if ccy != "USD" else None
        usd = to_usd_mt(px, fx, unit)
        if usd is not None:
            out[d] = usd
    return out


def _country_series(ocfg: dict, origins: dict, fx_pairs: dict) -> dict[str, float]:
    """Mean of the country's grades, on dates where at least one grade printed."""
    parts = [_grade_usd_mt(origins[g], fx_pairs) for g in ocfg["grades"] if g in origins]
    if not parts:
        return {}
    merged: dict[str, float] = {}
    for d in {d for p in parts for d in p}:
        vals = [p[d] for p in parts if d in p]
        merged[d] = sum(vals) / len(vals)
    return merged


def _beta(pairs: list[tuple[float, float]]) -> float | None:
    """Through-origin OLS slope of Δlocal on Δfutures, or None if too thin."""
    moves = [(df, dl) for df, dl in pairs if abs(df) > 1e-9]
    if len(moves) < _MIN_PAIRS:
        return None
    ss = sum(df * df for df, _ in moves)
    if ss < _MIN_SS:
        return None
    return sum(df * dl for df, dl in moves) / ss


def _observations(local: dict[str, float], fdates: list[str], fprice: list[float],
                  fcontract: list[str], lag: int) -> list[tuple[str, float, float]]:
    """(date, Δfutures, Δlocal) for each consecutive pair of local PRINTS.

    The futures change is taken over the same span, shifted by `lag`, and the
    pair is dropped when a contract roll falls inside it — the gap there is the
    calendar spread, not a market move.
    """
    idx = {d: i for i, d in enumerate(fdates)}
    prints = [d for d in sorted(local) if d in idx]
    obs = []
    for a, b in zip(prints, prints[1:]):
        ia, ib = idx[a] + lag, idx[b] + lag
        if not (0 <= ia < ib < len(fdates)):
            continue
        if fcontract[ia] != fcontract[ib]:
            continue
        if len(set(fcontract[ia:ib + 1])) > 1:
            continue
        obs.append((b, fprice[ib] - fprice[ia], local[b] - local[a]))
    return obs


def _build_market(cfg: dict, futures: dict, origins: dict, fx_pairs: dict) -> dict | None:
    rows = [r for r in (futures.get(cfg["futures_key"]) or [])
            if r.get("date") and isinstance(r.get("price"), (int, float))]
    if not rows:
        return None
    rows.sort(key=lambda r: r["date"])
    scale = (1 / 100 * LB_PER_MT) if cfg["futures_unit"] == "cents_lb" else 1.0
    fdates = [r["date"] for r in rows]
    fprice = [r["price"] * scale for r in rows]
    fcontract = [r.get("contract") or "?" for r in rows]

    obs_by_origin: dict[str, list[tuple[str, float, float]]] = {}
    for key, ocfg in cfg["origins"].items():
        local = _country_series(ocfg, origins, fx_pairs)
        if not local:
            continue
        obs = _observations(local, fdates, fprice, fcontract, ocfg["lag"])
        if obs:
            obs_by_origin[key] = obs
    if not obs_by_origin:
        return None

    out_rows = []
    for i, d in enumerate(fdates):
        cutoff = (date.fromisoformat(d) - timedelta(days=_WINDOW_DAYS)).isoformat()
        elast: dict[str, float] = {}
        for key, obs in obs_by_origin.items():
            window = [(df, dl) for od, df, dl in obs if cutoff < od <= d]
            beta = _beta(window)
            if beta is not None:
                elast[key] = round(beta * 100.0, 1)
        # "Leading" is a comparison — never call it off a single series.
        leader = max(elast, key=elast.get) if len(elast) >= 2 else None
        out_rows.append({
            "date": d,
            "futures": round(fprice[i], 2),
            "leader": leader,
            "elasticity": elast,
        })

    tail = out_rows[-_TILE_DAYS:]
    acc: dict[str, list[float]] = {}
    for r in tail:
        for k, v in r["elasticity"].items():
            acc.setdefault(k, []).append(v)
    means = {k: round(sum(v) / len(v), 1) for k, v in acc.items() if v}
    lead_key = max(means, key=means.get) if len(means) >= 2 else None
    recent = [r["leader"] for r in tail if r["leader"]]

    return {
        "label": cfg["label"],
        "origins": {k: {"name": v["name"], "color": v["color"], "lag": v["lag"]}
                    for k, v in cfg["origins"].items() if k in obs_by_origin},
        "series": out_rows,
        "leader_7d": None if lead_key is None else {
            "origin": lead_key,
            "elasticity": means[lead_key],
            "days_led": recent.count(lead_key),
            "of_days": len(recent),
            "all": means,
        },
    }


def build() -> dict:
    origins = (load_json(OUT_DIR, "origin_prices_history.json") or {}).get("origins") or {}
    futures = load_json(OUT_DIR, "futures_price_history.json") or {}
    fx_pairs = (load_json(OUT_DIR, "fx_history.json") or {}).get("pairs") or {}

    markets = {}
    for name, cfg in _MARKETS.items():
        built = _build_market(cfg, futures, origins, fx_pairs)
        if built and built["series"]:
            markets[name] = built

    return {
        "unit": "usd_per_tonne",
        "window_days": _WINDOW_DAYS,
        "tile_days": _TILE_DAYS,
        "method": (
            "Both legs in USD/t. Local changes are measured print to print (never "
            "off a carried-forward value), the futures change is taken over the "
            f"same span shifted by each origin's publication lag, and a trailing "
            f"{_WINDOW_DAYS}-day through-origin OLS slope of Δlocal on Δfutures "
            "gives the pass-through. Reported as a percentage: 50% means half of "
            "each futures move reaches that origin's local price. The leading "
            "origin is the highest pass-through that day, named only when at "
            "least two origins have a reading."
        ),
        "caveat": (
            "Pass-through is not causation — a high reading says an origin's local "
            "market is tracking the futures closely, not that it is pushing them. "
            "Read the near-total readings with that in mind: UCDA and ANACAFE "
            "publish indicative prices referenced off the terminal market, so for "
            "Uganda and Guatemala a high number is partly mechanical, and their "
            "lags rest on ~55 weekly observations against Vietnam's ~970. The "
            "informative comparisons are between origins that set their own price "
            "— Vietnam's farmgate against Brazil's domestic market."
        ),
        "updated": datetime.now(UTC).isoformat(),
        "markets": markets,
    }


def export_price_elasticity() -> None:
    doc = build()
    if not doc["markets"]:
        print("  price_elasticity.json → no market could be built — keeping previous file")
        return
    safe_write_json(
        OUT_PATH, doc,
        lambda d: (bool(d.get("markets"))
                   and all(m.get("series") for m in d["markets"].values()),
                   "empty market"),
    )
    for name, m in doc["markets"].items():
        lead = m.get("leader_7d")
        tail = (f"{lead['origin']} at {lead['elasticity']}% "
                f"({lead['days_led']}/{lead['of_days']} days)") if lead else "no leader"
        print(f"  price_elasticity.json → {name}: {len(m['series'])} sessions, {tail}")
