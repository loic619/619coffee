"""
fetch_intraday_kc_rc.py
Gather the intraday data points the open-direction feature needs, at 15-minute
resolution, for both ICE Robusta (RM) and ICE Arabica (KC), from Barchart.

Per London trading day it records:
  1. at 17:30 London (RC close): last-traded KC and RC   → kc_last_1730, rc_last_1730
  2. at 18:30 London (KC settle): last-traded KC          → kc_last_1830
  3. official SETTLEMENT for KC and RC (from the daily
     archive — distinct from last-traded; used later)     → kc_settle, rc_settle
  4. RC 15 min after open (close of the first 15m bar)    → rc_open_0915
  5. RC open = first trade of the day (open of first bar) → rc_open_first
  6. at 16:30 London (start of RC's LAST HOUR): last RC   → rc_last_1630
     (added 2026-08 for the harvest pre-hedging study — the London-side
     last-hour move rc_last_1730/rc_last_1630 − 1 accrues forward from
     here; the historical backfill never stored this anchor)

Source
======
Barchart's `queryminutes.ashx` serves 15-min OHLCV for both RM and KC (the one
intraday source that carries robusta — Yahoo has none). We reach it with the
same Playwright + XSRF-token session the OI scraper uses (fetch_oi_json.py), so
it works wherever that does (GitHub Actions). ~5000 bars/contract per call
(~7–9 months); this module is scoped to a ~1-month window first for validation.

Barchart timestamps are US Central time; we localise to America/Chicago and
convert to Europe/London. 15-min bars stay on :00/:15/:30/:45 boundaries under
that whole-hour offset, so the target London times land exactly on bar edges:
  - "price at 17:30" = CLOSE of the bar that STARTS 17:15 London
  - "price at 18:30" = CLOSE of the bar that STARTS 18:15 London
  - "RC open / +15min" = OPEN / CLOSE of robusta's first bar (starts 09:00)

Settlements come from data/contract_prices_archive.json, looked up for the SAME
contract symbol we fetched intraday (so last-traded and settle are the same
delivery month).

Writes frontend/public/data/intraday_kc_rc_15min.json.

Usage (needs chromium):
    cd backend
    python -m scraper.fetch_intraday_kc_rc [--maxrecords 2000]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from scraper.validate_export import safe_write_json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ROOT     = Path(__file__).parents[1]
_REPO     = Path(__file__).parents[2]
_ARCHIVE  = _REPO / "data" / "contract_prices_archive.json"
_CHAIN    = _REPO / "frontend" / "public" / "data" / "futures_chain.json"
OUT_PATH  = _REPO / "frontend" / "public" / "data" / "intraday_kc_rc_15min.json"

_CHICAGO  = ZoneInfo("America/Chicago")
_LONDON   = ZoneInfo("Europe/London")

# London start-times of the bars we read.
_T_1730 = "17:15"   # bar 17:15→17:30  → close = price at 17:30
_T_1830 = "18:15"   # bar 18:15→18:30  → close = price at 18:30
_T_1630 = "16:15"   # bar 16:15→16:30  → close = price at 16:30 (RC last-hour start)
_T_OPEN = "09:00"   # robusta first bar 09:00→09:15 → open=first trade, close=+15min


def _front_symbol(market: str) -> str | None:
    """Most-liquid (max-OI) front contract symbol for 'arabica'/'robusta' from
    futures_chain.json, e.g. 'RMU26'. None if unavailable."""
    try:
        chain = json.loads(_CHAIN.read_text(encoding="utf-8"))
    except Exception:
        return None
    contracts = (chain.get(market) or {}).get("contracts") or []
    best = max(contracts, key=lambda c: c.get("oi") or 0, default=None)
    return best.get("symbol") if best else None


async def _fetch_barchart_15m(symbols: list[str], maxrecords: int) -> dict[str, str]:
    """{symbol: raw_csv} of 15-min bars via Barchart queryminutes.ashx.

    Mirrors fetch_oi_json.py: open a Barchart page to get the XSRF cookie, then
    in-page fetch the timeseries endpoint with that token.
    """
    from playwright.async_api import async_playwright
    out: dict[str, str] = {}
    init = f"https://www.barchart.com/futures/quotes/{symbols[0]}/interactive-chart"
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
            out = await pg.evaluate(
                """async ({syms, maxrec}) => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const xsrf = getCookie('XSRF-TOKEN');
                    const h = { credentials: 'include',
                                headers: { 'x-xsrf-token': xsrf, 'accept': 'text/plain,*/*' } };
                    const res = {};
                    for (const s of syms) {
                        const url = 'https://www.barchart.com/proxies/timeseries/queryminutes.ashx?symbol='
                            + encodeURIComponent(s)
                            + '&interval=15&maxrecords=' + maxrec
                            + '&order=asc&volume=contract&contractroll=combined';
                        try { const r = await fetch(url, h); res[s] = r.ok ? await r.text() : ''; }
                        catch (e) { res[s] = ''; }
                    }
                    return res;
                }""",
                {"syms": symbols, "maxrec": maxrecords},
            )
        except Exception as e:  # noqa: BLE001
            print(f"[intraday] Barchart fetch error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return out or {}


def _parse_csv_to_london(csv_text: str) -> dict[str, dict[str, dict]]:
    """Parse queryminutes CSV → {london_date: {london_HH:MM: {open, close}}}.

    Each row: '<CT datetime>,<dayOfMonth>,<open>,<high>,<low>,<close>,<volume>'.
    We take field[0] as the CT timestamp and the LAST 5 fields as O,H,L,C,V
    (robust to the redundant day column / a symbol prefix on continuous feeds).
    """
    out: dict[str, dict[str, dict]] = defaultdict(dict)
    for line in (csv_text or "").strip().splitlines():
        parts = line.split(",")
        if len(parts) < 6:
            continue
        try:
            ct = datetime.strptime(parts[0].strip(), "%Y-%m-%d %H:%M").replace(tzinfo=_CHICAGO)
            o, _h, _l, c, _v = (float(x) for x in parts[-5:])
        except (ValueError, TypeError):
            continue
        ldn = ct.astimezone(_LONDON)
        out[ldn.strftime("%Y-%m-%d")][ldn.strftime("%H:%M")] = {"open": o, "close": c}
    return out


def _archive_settle(market: str, symbol: str) -> dict[str, float]:
    """{date: settle} for one contract symbol from the daily archive.

    The archive keys robusta in CANONICAL form (RC…, e.g. RCU26) while
    futures_chain gives the DISPLAY form (RM…, e.g. RMU26), so we convert
    via symbols.to_canonical (RM→RC; KC unchanged) before the lookup.
    """
    from scraper.symbols import to_canonical
    key = to_canonical(symbol)
    try:
        arch = json.loads(_ARCHIVE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, float] = {}
    for day, contracts in (arch.get(market) or {}).items():
        rec = (contracts or {}).get(key)
        if rec and rec.get("price") is not None:
            out[day] = float(rec["price"])
    return out


def run(maxrecords: int = 2000) -> dict:
    kc_sym = _front_symbol("arabica")
    rc_sym = _front_symbol("robusta")
    if not kc_sym or not rc_sym:
        return {"ok": False, "reason": "could not resolve front symbols from futures_chain"}
    print(f"[intraday] front contracts: KC={kc_sym} RC={rc_sym} (maxrecords={maxrecords})")

    raw = asyncio.run(_fetch_barchart_15m([rc_sym, kc_sym], maxrecords))
    rc_idx = _parse_csv_to_london(raw.get(rc_sym, ""))
    kc_idx = _parse_csv_to_london(raw.get(kc_sym, ""))
    if not rc_idx and not kc_idx:
        return {"ok": False, "reason": "no intraday bars returned from Barchart"}

    kc_settle = _archive_settle("arabica", kc_sym)
    rc_settle = _archive_settle("robusta", rc_sym)

    days = sorted(set(rc_idx) | set(kc_idx))
    rows = []
    for day in days:
        kd, rd = kc_idx.get(day, {}), rc_idx.get(day, {})
        first_rc = rd.get(_T_OPEN)
        rows.append({
            "date":          day,
            "kc_last_1730":  (kd.get(_T_1730) or {}).get("close"),
            "rc_last_1730":  (rd.get(_T_1730) or {}).get("close"),
            "rc_last_1630":  (rd.get(_T_1630) or {}).get("close"),
            "kc_last_1830":  (kd.get(_T_1830) or {}).get("close"),
            "rc_open_first": (first_rc or {}).get("open"),
            "rc_open_0915":  (first_rc or {}).get("close"),
            "kc_settle":     kc_settle.get(day),
            "rc_settle":     rc_settle.get(day),
            "kc_symbol":     kc_sym,
            "rc_symbol":     rc_sym,
        })

    safe_write_json(OUT_PATH, rows, ensure_ascii=False, trailing_newline=True)

    def _cov(k): return sum(1 for r in rows if r.get(k) is not None)
    print(f"[intraday] {len(rows)} days. coverage: "
          + ", ".join(f"{k}={_cov(k)}" for k in
                      ["rc_open_first", "rc_open_0915", "rc_last_1730",
                       "kc_last_1730", "kc_last_1830", "rc_settle", "kc_settle"]))
    print("\n date        rc_open  rc_0915  rc_1730  kc_1730  kc_1830  rc_settle kc_settle")
    for r in rows[-22:]:
        def f(x): return f"{x:8.2f}" if isinstance(x, (int, float)) else "    —   "
        print(f" {r['date']}  {f(r['rc_open_first'])} {f(r['rc_open_0915'])} {f(r['rc_last_1730'])} "
              f"{f(r['kc_last_1730'])} {f(r['kc_last_1830'])} {f(r['rc_settle'])} {f(r['kc_settle'])}")
    print(f"\n[intraday] wrote {OUT_PATH}")
    return {"ok": True, "days": len(rows)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Fetch KC/RC 15-min intraday points from Barchart.")
    ap.add_argument("--maxrecords", type=int, default=2000,
                    help="bars per contract (~2000 ≈ 1.5 months at 15m)")
    args = ap.parse_args()
    status = run(maxrecords=args.maxrecords)
    sys.exit(0 if status.get("ok") else 1)
