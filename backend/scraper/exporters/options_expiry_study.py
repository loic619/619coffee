"""
options_expiry_study.py — price behaviour at options expiry vs the ITM overhang.

At option expiry every in-the-money option auto-exercises into a futures
position: the option book's ITM open interest converts, overnight, into
futures OI. The research question (Research A of the options program): does
the size of that overhang — %ITM of option OI, and ITM OI relative to
futures OI — predict how the future behaves into, at and after expiry?

Three layers, honestly separated by what the data can support
=============================================================
HISTORICAL (2021→): expired option BOARDS are unrecoverable (Barchart returns
nothing once a series dies — established by the backfill probe, documented in
backfill_options_history.py). But data/contract_prices_archive.json holds ~5y
of per-contract futures price AND OI, and option expiry dates follow exchange
rules (KC: 2nd Friday of the month preceding the contract month; RM: 3rd
Wednesday). So for every expired contract we can measure the *realized*
conversion footprint — the futures-OI jump across expiry — and the price path
around it. The OI jump is a direct proxy for how much ITM OI exercised, which
lets us run the cross-section (big vs small conversions) without the boards.

LIVE (case zero): the nearest tracked board gives the full predicted side —
%ITM, ITM/futures OI, the strike ladder, max pain — daily, from
options_boards_archive.json and options_oi.json. RMU26 is days from expiry as
this ships: the first event where we hold BOTH the prediction and the outcome.

LEDGER (forward): each time a tracked board dies, its final state is frozen
into an events ledger keyed by contract, so the full-detail backtest
accumulates one event per expiry from now on. Append-once: recorded events
are never recomputed.

Dating note: in contract_prices_archive an entry under key D carries the
settlement OF D and the OI reported FOR D-1 business day (see its _meta).
The OI series is therefore re-dated one business day back before any jump is
measured, and the jump window is [E-1, E+2] to absorb the residual ±1-day
reporting uncertainty, which the paper states.

Writes frontend/public/data/options_expiry_study.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from scraper.exporters.base import OUT_DIR, ROOT

PRICES = ROOT / "data" / "contract_prices_archive.json"
BOARDS = ROOT / "data" / "options_boards_archive.json"
OPTIONS_OI = OUT_DIR / "options_oi.json"
OUT = OUT_DIR / "options_expiry_study.json"
LEDGER = ROOT / "data" / "options_expiry_ledger.json"

_MONTH = {"F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
          "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12}

PRE_D, POST_D = 5, 5          # event-window sessions either side of expiry
MAXPAIN_SESSIONS = 120        # daily max-pain history kept for the live board


# ── small helpers ───────────────────────────────────────────────────────────

def _r(x, n: int = 2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _mean(v):
    return st.mean(v) if v else float("nan")


def _t_mean(v):
    """t-stat of the mean against zero."""
    if len(v) < 3:
        return float("nan")
    sd = st.stdev(v)
    return st.mean(v) / (sd / math.sqrt(len(v))) if sd else float("nan")


def _prepost(pairs: list[tuple[float, float]]) -> dict:
    """corr(pre-expiry run-in, post-expiry drift) + continuation hit-rate."""
    if len(pairs) < 8:
        return {"n": len(pairs)}
    x = [a for a, _ in pairs]; y = [b for _, b in pairs]
    mx, my = st.mean(x), st.mean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x)); sy = math.sqrt(sum((b - my) ** 2 for b in y))
    r = sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy) if sx and sy else float("nan")
    cont = sum(1 for a, b in pairs if a * b > 0)
    return {"n": len(pairs), "corr": _r(r, 3),
            "continuation_pct": _r(cont / len(pairs) * 100, 1)}


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """n-th `weekday` (Mon=0) of a month."""
    d = date(year, month, 1)
    offset = (weekday - d.weekday()) % 7
    return d + timedelta(days=offset + 7 * (n - 1))


def _rule_expiry(symbol: str) -> date | None:
    """Exchange-rule option expiry for a KC/RC futures symbol (see module doc)."""
    s = symbol.strip().upper()
    if len(s) < 5 or s[-3] not in _MONTH:
        return None
    code, yy = s[-3], s[-2:]
    month, year = _MONTH[code], 2000 + int(yy)
    pm, py = (month - 1, year) if month > 1 else (12, year - 1)
    if s.startswith("KC"):
        return _nth_weekday(py, pm, 4, 2)     # 2nd Friday
    if s.startswith("RC") or s.startswith("RM"):
        return _nth_weekday(py, pm, 2, 3)     # 3rd Wednesday
    return None


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


# ── historical layer: the conversion footprint on expired contracts ─────────

def _contract_series(archive_mkt: dict, symbol: str) -> tuple[list[str], dict, dict]:
    """(sorted price dates, {date: settlement}, {date: OI re-dated to its own day})."""
    px, oi_raw = {}, {}
    for d in archive_mkt:
        e = archive_mkt[d].get(symbol)
        if not e:
            continue
        if e.get("price") is not None:
            px[d] = e["price"]
        if e.get("oi") is not None:
            oi_raw[d] = e["oi"]
    dates = sorted(px)
    # OI under key D belongs to the previous business day in this archive.
    oi = {}
    for d, v in oi_raw.items():
        i = dates.index(d) if d in px else None
        if i is not None and i > 0:
            oi[dates[i - 1]] = v
    return dates, px, oi


def _event(dates: list[str], px: dict, oi: dict, expiry: date) -> dict | None:
    """Measure one expiry event from the contract's own daily series."""
    e = expiry.isoformat()
    if not dates or e < dates[0] or e > dates[-1]:
        return None
    # session index of expiry (or last session before it, if a holiday)
    idx = max((i for i, d in enumerate(dates) if d <= e), default=None)
    if idx is None or idx < PRE_D + 3 or idx + POST_D >= len(dates):
        return None
    win = dates[idx - PRE_D: idx + POST_D + 1]
    p = [px.get(d) for d in win]
    if any(v is None for v in p):
        return None

    def ret(a, b):
        return (p[b] / p[a] - 1) * 100

    # conversion footprint: ΔOI across [E-1, E+2], vs the typical daily move
    oi_win = [oi.get(d) for d in win]
    oi_pre = oi_win[PRE_D - 1]
    oi_post = next((oi_win[k] for k in range(PRE_D + 2, PRE_D - 1, -1) if oi_win[k] is not None), None)
    jump = jump_pct = None
    if oi_pre and oi_post is not None:
        jump = oi_post - oi_pre
        jump_pct = jump / oi_pre * 100
    typ = [abs(oi.get(dates[i]) - oi.get(dates[i - 1]))
           for i in range(max(1, idx - 40), idx - 2)
           if oi.get(dates[i]) is not None and oi.get(dates[i - 1]) is not None]
    typical_doi = st.median(typ) if typ else None

    pre_abs = [abs(ret(k - 1, k)) for k in range(1, PRE_D + 1)]
    post_abs = [abs(ret(k - 1, k)) for k in range(PRE_D + 1, PRE_D + POST_D + 1)]
    return {
        "expiry": e, "expiry_session": dates[idx],
        "pre5_pct": _r(ret(0, PRE_D)), "day_pct": _r(ret(PRE_D - 1, PRE_D)),
        "post1_pct": _r(ret(PRE_D, PRE_D + 1)), "post3_pct": _r(ret(PRE_D, PRE_D + 3)),
        "post5_pct": _r(ret(PRE_D, PRE_D + 5)),
        "pre_absmove": _r(_mean(pre_abs)), "post_absmove": _r(_mean(post_abs)),
        "oi_before": oi_pre, "oi_jump": jump, "oi_jump_pct": _r(jump_pct),
        "typical_daily_doi": typical_doi,
        "jump_vs_typical": _r(abs(jump) / typical_doi, 1) if jump is not None and typical_doi else None,
        "price_at_expiry": p[PRE_D],
    }


def _historical(prices: dict, mkt: str, root: str, today: date) -> dict:
    arch = prices.get(mkt) or {}
    symbols = sorted({c for day in arch.values() for c in day})
    events = []
    for sym in symbols:
        exp = _rule_expiry(sym)
        if not exp or exp >= today - timedelta(days=POST_D + 10):
            continue                      # not yet complete, or unparseable
        dates, px, oi = _contract_series(arch, sym)
        ev = _event(dates, px, oi, exp)
        if ev:
            ev["contract"] = sym
            events.append(ev)
    events.sort(key=lambda x: x["expiry"])

    # aggregates + the cross-section on the realized conversion footprint
    def agg(v):
        v = [x for x in v if x is not None]
        return {"n": len(v), "mean": _r(_mean(v)), "median": _r(st.median(v)) if v else None,
                "t": _r(_t_mean(v))} if v else {"n": 0}

    out = {
        "root": root, "n_events": len(events), "events": events,
        "day": agg([e["day_pct"] for e in events]),
        "post3": agg([e["post3_pct"] for e in events]),
        "post5": agg([e["post5_pct"] for e in events]),
        # post/pre |daily move| ratio: excess vs 1 so the t tests "post is livelier"
        "absmove_ratio": agg([e["post_absmove"] / e["pre_absmove"]
                              for e in events if e["pre_absmove"]]),
        "absmove_excess": agg([e["post_absmove"] / e["pre_absmove"] - 1.0
                               for e in events if e["pre_absmove"]]),
        # run-in vs follow-through: does the pre-expiry move continue or unwind?
        "prepost": _prepost([(e["pre5_pct"], e["post3_pct"]) for e in events
                             if e["pre5_pct"] is not None and e["post3_pct"] is not None]),
    }
    # depth of the roll collapse around expiry — the entanglement evidence
    jumps = [abs(e["oi_jump_pct"]) for e in events if e.get("oi_jump_pct") is not None]
    if jumps:
        out["roll_collapse"] = {"n": len(jumps), "mean_abs_pct": _r(_mean(jumps)),
                                "median_abs_pct": _r(st.median(jumps))}
    return out


# ── live layer: the nearest board's countdown + ladder + max pain ───────────

def _max_pain(rows: list[list], header: list[str]) -> float | None:
    """Strike minimizing total intrinsic payout to option holders."""
    i_k, i_c, i_p = header.index("strike"), header.index("call_oi"), header.index("put_oi")
    board = [(r[i_k], r[i_c] or 0, r[i_p] or 0) for r in rows if r[i_k] is not None]
    board = [b for b in board if b[1] or b[2]]
    if len(board) < 5:
        return None
    strikes = [b[0] for b in board]
    best, best_pay = None, None
    for s in strikes:
        pay = sum(c * max(0.0, s - k) + p * max(0.0, k - s) for k, c, p in board)
        if best_pay is None or pay < best_pay:
            best, best_pay = s, pay
    return best


def _live(boards: dict, opt_oi: dict, mkt: str) -> dict | None:
    days = boards.get("days") or {}
    header = boards.get("header") or []
    dates = sorted(days)
    if not dates or not header:
        return None
    # nearest live contract = first in today's list (fetcher orders nearest-first)
    latest = days[dates[-1]].get(mkt) or []
    if not latest:
        return None
    sym = latest[0]["u"]

    # countdown series from options_oi.json history (has ITM split + fut OI)
    countdown = []
    for row in opt_oi.get("history") or []:
        for c in row.get(mkt) or []:
            if c.get("underlying") != sym:
                continue
            tot = (c.get("call_oi") or 0) + (c.get("put_oi") or 0)
            itm = (c.get("itm_call_oi") or 0) + (c.get("itm_put_oi") or 0)
            countdown.append({
                "date": row["date"], "dte": c.get("days_to_expiry"),
                "call_oi": c.get("call_oi"), "put_oi": c.get("put_oi"),
                "itm_call_oi": c.get("itm_call_oi"), "itm_put_oi": c.get("itm_put_oi"),
                "fut_oi": c.get("fut_oi"), "future": c.get("future_price"),
                "atm_iv": c.get("atm_iv"),
                "itm_pct": _r(itm / tot * 100) if tot else None,
                "itm_vs_fut_pct": _r(itm / c["fut_oi"] * 100) if c.get("fut_oi") else None,
            })

    # daily max pain + distance for the trailing window (board archive has OI per strike)
    mp_series = []
    for d in dates[-MAXPAIN_SESSIONS:]:
        for c in days[d].get(mkt) or []:
            if c["u"] != sym:
                continue
            mp = _max_pain(c["rows"], header)
            if mp is not None and c.get("px"):
                mp_series.append({"date": d, "max_pain": mp, "future": c["px"],
                                  "dist_pct": _r((c["px"] - mp) / mp * 100)})

    # final ladder: last session whose board carries OI (newest session's OI is null)
    ladder, ladder_date = None, None
    i_k, i_c, i_p = header.index("strike"), header.index("call_oi"), header.index("put_oi")
    for d in reversed(dates):
        for c in days[d].get(mkt) or []:
            if c["u"] != sym:
                continue
            rows = [(r[i_k], r[i_c], r[i_p]) for r in c["rows"]
                    if r[i_k] is not None and ((r[i_c] or 0) + (r[i_p] or 0) > 0)]
            if rows:
                fut = c.get("px")
                near = [x for x in rows if fut and abs(x[0] - fut) / fut <= 0.25] or rows
                ladder = [{"strike": k, "call_oi": co or 0, "put_oi": po or 0} for k, co, po in near]
                ladder_date = d
                break
        if ladder:
            break

    last = next((c for c in reversed(countdown) if c.get("itm_pct") is not None), {})
    return {
        "contract": sym,
        "expiry_rule": (_rule_expiry(sym) or date.min).isoformat(),
        "countdown": countdown,
        "max_pain_series": mp_series,
        "ladder": ladder, "ladder_date": ladder_date,
        "now": last,
    }


# ── forward ledger: freeze a board's final state when it dies ───────────────

def _update_ledger(boards: dict, opt_oi: dict, today: date) -> dict:
    ledger = _load(LEDGER) or {"events": []}
    recorded = {e["contract"] for e in ledger["events"]}
    days = boards.get("days") or {}
    header = boards.get("header") or []
    dates = sorted(days)
    if not dates:
        return ledger
    live_now = {c["u"] for mkt in ("arabica", "robusta") for c in days[dates[-1]].get(mkt) or []}
    # A contract whose rule expiry has passed and that has left the live list is
    # a completed event: freeze its final observed state.
    seen: dict[tuple[str, str], str] = {}
    for d in dates:
        for mkt in ("arabica", "robusta"):
            for c in days[d].get(mkt) or []:
                seen[(mkt, c["u"])] = d
    for (mkt, sym), last_seen in seen.items():
        exp = _rule_expiry(sym)
        if not exp or sym in recorded or sym in live_now or exp > today:
            continue
        # final board with OI (walk back from the contract's last appearance)
        i_k = header.index("strike"); i_c = header.index("call_oi"); i_p = header.index("put_oi")
        final = None
        for d in reversed([x for x in dates if x <= last_seen]):
            for c in days[d].get(mkt) or []:
                if c["u"] != sym:
                    continue
                rows = [(r[i_k], r[i_c], r[i_p]) for r in c["rows"]
                        if r[i_k] is not None and ((r[i_c] or 0) + (r[i_p] or 0) > 0)]
                if rows:
                    fut = c.get("px")
                    call = sum(x[1] or 0 for x in rows); put = sum(x[2] or 0 for x in rows)
                    itm_c = sum((x[1] or 0) for x in rows if fut and x[0] < fut)
                    itm_p = sum((x[2] or 0) for x in rows if fut and x[0] > fut)
                    final = {"date": d, "future": fut, "call_oi": call, "put_oi": put,
                             "itm_call_oi": itm_c, "itm_put_oi": itm_p,
                             "itm_pct": _r((itm_c + itm_p) / (call + put) * 100) if call + put else None,
                             "max_pain": _max_pain(c["rows"], header)}
                    break
            if final:
                break
        if final:
            ledger["events"].append({"contract": sym, "market": mkt,
                                     "expiry": exp.isoformat(), "final_board": final})
            print(f"    ledger + {sym} (expiry {exp}, final board {final['date']}, "
                  f"ITM {final['itm_pct']}%)")
    ledger["events"].sort(key=lambda e: e["expiry"])
    LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
    return ledger


def export_options_expiry_study() -> None:
    prices = _load(PRICES)
    boards = _load(BOARDS)
    opt_oi = _load(OPTIONS_OI)
    if not prices or not boards:
        print("  options_expiry_study → missing archives; skipping")
        return
    today = date.today()

    hist = {
        "arabica": _historical(prices, "arabica", "KC", today),
        "robusta": _historical(prices, "robusta", "RC", today),
    }
    live = {
        "arabica": _live(boards, opt_oi, "arabica"),
        "robusta": _live(boards, opt_oi, "robusta"),
    }
    ledger = _update_ledger(boards, opt_oi, today)

    doc = {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "method": {
            "expiry_rules": "KC: 2nd Friday of the month preceding the contract month "
                            "(ICE US ch.8). RC/RM: 3rd Wednesday (ICE Europe spec).",
            "oi_dating": "contract_prices_archive stores OI one key-day late; the series "
                         "is re-dated back one session and the jump window is [E-1, E+2].",
            "footprint": "oi_jump_pct = futures OI change across [E-1, E+2] ÷ OI at E-1. "
                         "NOT a clean conversion read: option expiry sits only a few sessions "
                         "before FND, so the delivery roll dominates the net change — exercise "
                         "adds OI while the roll destroys it. Reported as roll-entanglement "
                         "context, never as realized ITM.",
            "max_pain": "strike minimizing total intrinsic payout to holders, from that "
                        "session's full board OI.",
        },
        "historical": hist,
        "live": live,
        "ledger": ledger,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    ka, kr = hist["arabica"], hist["robusta"]
    print(f"  options_expiry_study.json → KC {ka['n_events']} events, RC {kr['n_events']} events; "
          f"live: {', '.join(v['contract'] for v in live.values() if v)}; "
          f"ledger {len(ledger.get('events', []))}")


if __name__ == "__main__":
    export_options_expiry_study()
