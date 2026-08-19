"""
backfill_intraday_kc_rc.py
Deep backfill of the 15-min intraday points for ICE Robusta (RM) and Arabica
(KC) from Barchart, by fetching each real delivery contract and stitching them
into a front-month series.

Why per-contract (not the continuous RM*0)
==========================================
Barchart's continuous front symbol returned only ~2.5y, labelled EVERY bar with
the current front contract (breaking the per-day settle join), and had poor
coverage. Fetching each specific contract (RMU26, RMN26, …) instead gives clean
bars, the correct contract symbol per day (so the archive settle join works),
and we stitch by first-notice-day roll. The achievable horizon is whatever
Barchart retains per-contract intraday — reported, never silently truncated.

Per London trading day we extract the five points + settles, same schema as the
1-month fetcher. Barchart timestamps are US Central → localised and converted to
Europe/London (15-min bars stay on :00/:15/:30/:45).

Writes frontend/public/data/intraday_kc_rc_15min.json.

Usage (needs chromium):
    cd backend
    python -m scraper.backfill_intraday_kc_rc [--years 5]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_REPO    = Path(__file__).parents[2]
_ARCHIVE = _REPO / "data" / "contract_prices_archive.json"
OUT_PATH = _REPO / "frontend" / "public" / "data" / "intraday_kc_rc_15min.json"

_CHICAGO = ZoneInfo("America/Chicago")
_LONDON  = ZoneInfo("Europe/London")
_T_1730, _T_1830, _T_OPEN = "17:15", "18:15", "09:00"
# RC last-hour start (16:30 London) — added 2026-08 for the harvest
# pre-hedging study; the daily refresher records it forward from here.
_T_1630 = "16:15"
_MAXREC  = 5000

# Delivery-month codes per market, and the first-notice-day offset (business
# days before the 1st business day of the delivery month) used as the roll.
_RC_MONTHS = {"F": 1, "H": 3, "K": 5, "N": 7, "U": 9, "X": 11}
_KC_MONTHS = {"H": 3, "K": 5, "N": 7, "U": 9, "Z": 12}
_FND_OFFSET = {"robusta": 4, "arabica": 7}


def _first_biz_day(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def _sub_biz_days(d: date, n: int) -> date:
    while n > 0:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def _fnd(market: str, year: int, month: int) -> date:
    return _sub_biz_days(_first_biz_day(year, month), _FND_OFFSET[market])


def _contracts(market: str, years: int) -> list[tuple[str, date]]:
    """[(symbol, fnd_date)] for the market over the window, sorted by fnd.
    e.g. ('RMU26', date(2026,8,26))."""
    root = "RM" if market == "robusta" else "KC"
    months = _RC_MONTHS if market == "robusta" else _KC_MONTHS
    today = datetime.now(_LONDON).date()
    lo = today - timedelta(days=365 * years + 30)
    hi = today + timedelta(days=120)
    out = []
    for yr in range(lo.year, hi.year + 1):
        for code, m in months.items():
            f = _fnd(market, yr, m)
            if lo <= f <= hi:
                out.append((f"{root}{code}{yr % 100:02d}", f))
    return sorted(out, key=lambda x: x[1])


async def _fetch_contracts(symbols: list[str]) -> dict[str, str]:
    """{symbol: raw_csv} for each contract's 15-min bars (one Barchart session)."""
    from playwright.async_api import async_playwright
    out: dict[str, str] = {}
    init = "https://www.barchart.com/futures/quotes/RMU26/interactive-chart"
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"))
        pg = await ctx.new_page()
        try:
            await pg.goto(init, wait_until="domcontentloaded", timeout=30000)
            await pg.wait_for_timeout(3500)
            for sym in symbols:
                csv = await pg.evaluate(
                    """async ({sym, maxrec}) => {
                        function getCookie(n){const v=document.cookie.match('(^|;) ?'+n+'=([^;]*)(;|$)');return v?decodeURIComponent(v[2]):null;}
                        const h={credentials:'include',headers:{'x-xsrf-token':getCookie('XSRF-TOKEN'),'accept':'text/plain,*/*'}};
                        const url='https://www.barchart.com/proxies/timeseries/queryminutes.ashx?symbol='
                          +encodeURIComponent(sym)+'&interval=15&maxrecords='+maxrec
                          +'&order=asc&volume=contract&contractroll=expiration';
                        try{const r=await fetch(url,h);return r.ok?await r.text():'';}catch(e){return '';}
                    }""",
                    {"sym": sym, "maxrec": _MAXREC},
                )
                out[sym] = csv or ""
                n = len((csv or "").strip().splitlines())
                if n:
                    print(f"[backfill] {sym}: {n} bars")
                await pg.wait_for_timeout(500)
        except Exception as e:  # noqa: BLE001
            print(f"[backfill] fetch error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return out


def _parse_day_index(csv_text: str) -> dict[str, dict]:
    """{london_date: {"bars": {HH:MM: {open, close}}, "vol": total_day_volume}}
    from a specific-contract CSV ('<CT datetime>,<day>,O,H,L,C,V'). The daily
    volume lets the stitcher pick the genuinely liquid front contract."""
    out: dict[str, dict] = defaultdict(lambda: {"bars": {}, "vol": 0.0})
    for line in (csv_text or "").strip().splitlines():
        parts = line.split(",")
        if len(parts) < 6:
            continue
        try:
            ct = datetime.strptime(parts[0].strip(), "%Y-%m-%d %H:%M").replace(tzinfo=_CHICAGO)
            o, _h, _l, c, v = (float(x) for x in parts[-5:])
        except (ValueError, TypeError):
            continue
        ldn = ct.astimezone(_LONDON)
        day = out[ldn.strftime("%Y-%m-%d")]
        day["bars"][ldn.strftime("%H:%M")] = {"open": o, "close": c}
        day["vol"] += v
    return out


def _archive_settles() -> dict:
    try:
        arch = json.loads(_ARCHIVE.read_text(encoding="utf-8"))
    except Exception:
        return {"arabica": {}, "robusta": {}}
    out = {"arabica": {}, "robusta": {}}
    for market in ("arabica", "robusta"):
        for day, contracts in (arch.get(market) or {}).items():
            for sym, rec in (contracts or {}).items():
                if rec and rec.get("price") is not None:
                    out[market][f"{day}|{sym}"] = float(rec["price"])
    return out


def _stitch(market: str, contracts: list[tuple[str, date]],
            parsed: dict[str, dict]) -> dict[str, tuple[str, dict]]:
    """{date: (front_symbol, day_bars)}. The front contract each day is the
    most-TRADED one (max daily volume) — the genuine liquid front. This is
    roll-correct without modelling FND: near a roll, liquidity has already
    moved to the next contract, so the dying illiquid contract is never picked
    even though it's still nominally nearer expiry."""
    by_date: dict[str, list] = defaultdict(list)
    for sym, _f in contracts:
        for day, rec in parsed.get(sym, {}).items():
            by_date[day].append((rec["vol"], sym, rec["bars"]))
    out: dict[str, tuple[str, dict]] = {}
    for day, cands in by_date.items():
        vol, sym, bars = max(cands, key=lambda c: c[0])
        out[day] = (sym, bars)
    return out


def run(years: int = 5) -> dict:
    from scraper.symbols import to_canonical
    rc_contracts = _contracts("robusta", years)
    kc_contracts = _contracts("arabica", years)
    print(f"[backfill] fetching {len(rc_contracts)} RC + {len(kc_contracts)} KC contracts "
          f"(~{years}y target)")

    raw = asyncio.run(_fetch_contracts([s for s, _ in rc_contracts] + [s for s, _ in kc_contracts]))
    rc_parsed = {s: _parse_day_index(raw.get(s, "")) for s, _ in rc_contracts}
    kc_parsed = {s: _parse_day_index(raw.get(s, "")) for s, _ in kc_contracts}

    rc_front = _stitch("robusta", rc_contracts, rc_parsed)
    kc_front = _stitch("arabica", kc_contracts, kc_parsed)
    if not rc_front and not kc_front:
        return {"ok": False, "reason": "no intraday bars returned"}

    settles = _archive_settles()

    def _settle(market, day, sym):
        return settles[market].get(f"{day}|{to_canonical(sym)}") if sym else None

    days = sorted(set(rc_front) | set(kc_front))
    rows = []
    for day in days:
        rc_sym, rd = rc_front.get(day, (None, {}))
        kc_sym, kd = kc_front.get(day, (None, {}))
        first_rc = rd.get(_T_OPEN)
        rows.append({
            "date":          day,
            "rc_open_first": (first_rc or {}).get("open"),
            "rc_open_0915":  (first_rc or {}).get("close"),
            "rc_last_1730":  (rd.get(_T_1730) or {}).get("close"),
            "kc_last_1730":  (kd.get(_T_1730) or {}).get("close"),
            "kc_last_1830":  (kd.get(_T_1830) or {}).get("close"),
            "rc_settle":     _settle("robusta", day, rc_sym),
            "kc_settle":     _settle("arabica", day, kc_sym),
            "rc_symbol":     rc_sym,
            "kc_symbol":     kc_sym,
        })

    OUT_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    span = f"{rows[0]['date']} → {rows[-1]['date']}" if rows else "—"
    def _cov(k): return sum(1 for r in rows if r.get(k) is not None)
    n_rc_syms = len({r["rc_symbol"] for r in rows if r.get("rc_symbol")})
    print(f"[backfill] {len(rows)} days, span {span}, {n_rc_syms} RC contracts stitched")
    print("[backfill] coverage: " + ", ".join(
        f"{k}={_cov(k)}" for k in
        ["rc_open_first", "rc_open_0915", "rc_last_1730", "kc_last_1730",
         "kc_last_1830", "rc_settle", "kc_settle"]))
    print(f"[backfill] wrote {OUT_PATH}")
    return {"ok": True, "days": len(rows), "span": span}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Per-contract intraday backfill of KC/RC 15-min points.")
    ap.add_argument("--years", type=int, default=5)
    args = ap.parse_args()
    status = run(years=args.years)
    sys.exit(0 if status.get("ok") else 1)
