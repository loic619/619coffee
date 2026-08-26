"""front_spread.py — 1st/2nd calendar spread vs exchange certified stocks.

The theory of storage says the two are linked: when the exchange is empty,
whoever needs coffee now must outbid whoever holds it, and the front trades
over the deferred (backwardation). When stocks are ample there is nothing to
bid for and the curve pays carry (contango). Research brokers publish this as
a scatter with a fitted decay curve.

We can test it rather than assume it. `data/contract_prices_archive.json` holds
five years of daily per-contract boards, which gives a real 1st/2nd spread —
and `certified_stocks_*` gives the matching stock level.

Two things this exporter deliberately does NOT do:

  * It does not fit a curve. A fitted line through a cloud is a claim about
    functional form that the data here cannot support, and it is exactly what
    makes a broker scatter look more settled than it is.
  * It does not pool the sample into one number. The relationship is checked in
    halves, because a pooled correlation carried entirely by an early sub-period
    is the failure mode this whole chart invites — and for robusta that is
    precisely what happens.

Output: frontend/public/data/front_spread.json
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from scraper.exporters.base import OUT_DIR

ROOT = Path(__file__).resolve().parents[3]
ARCHIVE = ROOT / "data" / "contract_prices_archive.json"

# Futures month codes.
MONTH_CODE = {"F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
              "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12}
_SYM = re.compile(r"^([A-Z]{2})([FGHJKMNQUVXZ])(\d{2})$")

# Robusta certified stocks are published in LOTS of 10 t. Arabica publishes
# bags directly. Both are put on 60-kg bags so the two panels share a unit.
LOT_T = 10
KG_PER_BAG = 60
LOTS_TO_BAGS = LOT_T * 1000 / KG_PER_BAG


def expiry(symbol: str) -> tuple[int, int] | None:
    """'KCH27' → (2027, 3). None if the symbol is not a dated contract."""
    m = _SYM.match(symbol or "")
    if not m:
        return None
    return (2000 + int(m.group(3)), MONTH_CODE[m.group(2)])


def front_spread(board: dict) -> dict | None:
    """1st minus 2nd nearby from one day's contract board.

    Sign convention is FRONT MINUS DEFERRED, so positive = backwardation —
    the way the trade quotes it and the way a scatter against stocks reads.
    Note this is the OPPOSITE of the `structure_ny/ldn` field on cot rows,
    which stores deferred-minus-front.
    """
    rows = []
    for sym, v in (board or {}).items():
        e = expiry(sym)
        price = (v or {}).get("price")
        if e and isinstance(price, (int, float)) and price > 0:
            rows.append((e, sym, float(price)))
    if len(rows) < 2:
        return None
    rows.sort(key=lambda r: r[0])
    (_, f_sym, f_px), (_, s_sym, s_px) = rows[0], rows[1]
    return {"spread": round(f_px - s_px, 4), "front": f_sym, "second": s_sym}


def monthly_mean_spread(daily: dict[str, dict]) -> dict[str, float]:
    """Calendar-month average of the daily spread.

    A month average, not a month-end reading: the front contract's last days
    are thin and erratic, and one bad print at month end would move a scatter
    point that is meant to describe the whole month.
    """
    buckets: dict[str, list[float]] = defaultdict(list)
    for day, row in daily.items():
        if row:
            buckets[day[:7]].append(row["spread"])
    return {m: round(sum(v) / len(v), 4) for m, v in buckets.items() if v}


def month_end_stocks(snapshots: list[dict], field: str, mult: float) -> dict[str, float]:
    """Last reading in each calendar month, in thousand 60-kg bags."""
    best: dict[str, tuple[str, float]] = {}
    for s in snapshots or []:
        d, v = s.get("date"), s.get(field)
        if not isinstance(d, str) or not isinstance(v, (int, float)) or v <= 0:
            continue
        m = d[:7]
        if m not in best or d > best[m][0]:
            best[m] = (d, float(v) * mult / 1000.0)
    return {m: round(v, 2) for m, (_, v) in best.items()}


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """Rank correlation. The relationship is curved, so a rank measure is the
    honest one — Pearson would understate it and invite a curve fit."""
    n = len(xs)
    if n < 6:
        return None

    def rank(v: list[float]) -> list[float]:
        order = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        for pos, i in enumerate(order):
            r[i] = float(pos)
        return r

    rx, ry = rank(xs), rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return round(num / den, 4) if den else None


def analyse(points: list[dict]) -> dict:
    """Pooled correlation PLUS both halves.

    The halves are the point. A pooled −0.41 that is −0.66 early and +0.27 late
    is not a weak relationship, it is a relationship that stopped — and only the
    split shows the difference.
    """
    pts = sorted(points, key=lambda p: p["month"])
    xs = [p["stocks_k_bags"] for p in pts]
    ys = [p["spread"] for p in pts]
    h = len(pts) // 2
    full = spearman(xs, ys)
    r1 = spearman(xs[:h], ys[:h])
    r2 = spearman(xs[h:], ys[h:])
    holds = (
        None if full is None or r1 is None or r2 is None
        else bool(full < -0.3 and r1 < -0.2 and r2 < -0.2)
    )
    return {
        "n": len(pts),
        "spearman": full,
        "first_half": {"span": [pts[0]["month"], pts[h - 1]["month"]] if h else None, "spearman": r1},
        "second_half": {"span": [pts[h]["month"], pts[-1]["month"]] if pts[h:] else None, "spearman": r2},
        "holds_in_both_halves": holds,
    }


# COT side → the archive's market key.
_STRUCT_MARKETS = {"ny": "arabica", "ldn": "robusta"}

# How far back to walk for a board if the COT date itself has none. COT dates
# are Tuesdays, so a miss means a holiday — a long weekend is the worst case.
_MAX_BOARD_LOOKBACK_DAYS = 5


def overwrite_curve_structure(result: list[dict]) -> None:
    """Recompute `structure_ny` / `structure_ldn` from the contract archive.

    These fields arrived by manual DB import and are NOT one quantity: before
    2026-03-17 they hold something on a ~0.01 scale (a ratio), after it an
    absolute spread on a ~10-100 scale. The sign happens to agree, so the
    backwardation/contango classification survived — but the signal engine also
    derives a magnitude from the week-on-week CHANGE, and a percent change
    across a unit break is meaningless. Two eras under one field name is a trap
    regardless of who reads it next.

    The contract archive holds real per-contract boards, so the spread can just
    be computed. Sign is kept as the engine documents it — DEFERRED MINUS
    FRONT, negative = backwardation — which is the negation of the trade-facing
    convention `front_spread()` returns.

    Dates the archive does not cover are set to None rather than left on the
    old scale. The engine already skips null structure, so those weeks lose
    their curve signals instead of getting wrong ones. The archive starts
    2021-08; earlier COT weeks fill in when it is backfilled deeper.
    """
    if not ARCHIVE.exists():
        print("  cot.json: contract archive missing — structure_* left as imported")
        return
    try:
        archive = json.loads(ARCHIVE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  cot.json: contract archive unreadable ({e}) — structure_* left as imported")
        return

    spreads: dict[str, dict[str, float]] = {}
    for side, mkt in _STRUCT_MARKETS.items():
        board_by_day = archive.get(mkt) or {}
        out: dict[str, float] = {}
        for day, board in board_by_day.items():
            fs = front_spread(board)
            if fs:
                # front-minus-deferred → deferred-minus-front for this field.
                out[day] = round(-fs["spread"], 4)
        spreads[side] = out

    filled = {"ny": 0, "ldn": 0}
    for row in result:
        d = date.fromisoformat(row["date"])
        for side in ("ny", "ldn"):
            block = row.get(side)
            if not block:
                continue
            key = f"structure_{'ny' if side == 'ny' else 'ldn'}"
            table = spreads[side]
            val = None
            for back in range(_MAX_BOARD_LOOKBACK_DAYS + 1):
                got = table.get((d - timedelta(days=back)).isoformat())
                if got is not None:
                    val = got
                    break
            block[key] = val
            if val is not None:
                filled[side] += 1
    print(f"  cot.json: structure recomputed from archive — "
          f"ny {filled['ny']}/{len(result)}, ldn {filled['ldn']}/{len(result)} weeks")


MARKETS = {
    "arabica": {
        "label": "KC · Arabica",
        "unit": "c/lb",
        "stock_files": ["certified_stocks_arabica_deep_2010-2014.json",
                        "certified_stocks_arabica_deep_2015-2019.json",
                        "certified_stocks_arabica_deep_2020-2024.json",
                        "certified_stocks_arabica_deep_2025-2029.json",
                        "certified_stocks_arabica.json"],
        "stock_field": "total_bags",
        "stock_mult": 1.0,
    },
    "robusta": {
        "label": "RC · Robusta",
        "unit": "$/t",
        "stock_files": ["certified_stocks_robusta_deep_1990-1994.json",
                        "certified_stocks_robusta_deep_1995-1999.json",
                        "certified_stocks_robusta_deep_2000-2004.json",
                        "certified_stocks_robusta_deep_2005-2009.json",
                        "certified_stocks_robusta_deep_2010-2014.json",
                        "certified_stocks_robusta_deep_2015-2019.json",
                        "certified_stocks_robusta_deep_2020-2024.json",
                        "certified_stocks_robusta_deep_2025-2029.json",
                        "certified_stocks_robusta.json"],
        "stock_field": "total_lots_certified",
        "stock_mult": LOTS_TO_BAGS,
    },
}


def _load_stock_snapshots(files: list[str]) -> list[dict]:
    out: list[dict] = []
    for name in files:
        p = OUT_DIR / name
        if not p.exists():
            continue
        try:
            out.extend(json.loads(p.read_text(encoding="utf-8")).get("snapshots", []))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def export_front_spread() -> None:
    if not ARCHIVE.exists():
        raise FileNotFoundError(f"contract archive missing: {ARCHIVE}")
    archive = json.loads(ARCHIVE.read_text(encoding="utf-8"))

    payload: dict = {
        "note": ("Front (1st) minus 2nd nearby, from the 5-year per-contract archive, "
                 "against end-month exchange certified stocks. Positive spread = "
                 "backwardation. Stocks in thousand 60-kg bags (robusta lots converted "
                 "at 10 t). No curve is fitted and no single pooled number is presented "
                 "as the answer — see `analysis` for the split-half check."),
        "sign_convention": "front minus deferred (opposite of cot.structure_*)",
        "markets": {},
    }

    for key, cfg in MARKETS.items():
        board = archive.get(key) or {}
        daily = {d: front_spread(b) for d, b in board.items()}
        daily = {d: v for d, v in daily.items() if v}
        m_spread = monthly_mean_spread(daily)
        m_stocks = month_end_stocks(
            _load_stock_snapshots(cfg["stock_files"]), cfg["stock_field"], cfg["stock_mult"])

        months = sorted(set(m_spread) & set(m_stocks))
        points = [{"month": m, "stocks_k_bags": m_stocks[m], "spread": m_spread[m]} for m in months]

        latest_day = max(daily) if daily else None
        payload["markets"][key] = {
            "label": cfg["label"],
            "unit": cfg["unit"],
            "points": points,
            "analysis": analyse(points) if len(points) >= 12 else {"n": len(points)},
            "latest": ({"date": latest_day, **daily[latest_day]} if latest_day else None),
        }

    (OUT_DIR / "front_spread.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8")
