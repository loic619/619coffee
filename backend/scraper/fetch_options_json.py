"""
fetch_options_json.py — daily KC/RM options-on-futures snapshot from Barchart.

Same Playwright + core-api pattern as fetch_oi_json.py (load a Barchart page,
lift the XSRF cookie, call /proxies/core-api in-page). For each market it takes
the FRONT futures contract (highest-OI, from the same chain call the OI fetcher
uses) and pulls its full options board: per-strike call/put open interest,
volume and last, plus the option expiry.

Writes frontend/public/data/options_oi.json:
  {
    updated, markets: {
      arabica|robusta: {
        underlying, future_price, option_expiry, days_to_expiry,
        strikes: [{strike, call_oi, put_oi, call_vol, put_vol}],   # latest board
        totals:  {call_oi, put_oi, itm_call_oi, itm_put_oi}
      }
    },
    history: [{date, arabica: {underlying, future_price, days_to_expiry,
                               call_oi, put_oi, itm_call_oi, itm_put_oi},
                     robusta: {...}}]
  }
ITM = calls with strike < future price, puts with strike > future price —
the OI that turns into futures positions (or gets defended) into expiry, which
is what the countdown visual tracks. History accumulates one row per day;
per-strike detail is kept for the latest session only (the board chart).

Run standalone:  python backend/scraper/fetch_options_json.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "data" / "options_oi.json"
INIT_URL = "https://www.barchart.com/futures/quotes/KCK26/overview"
HISTORY_MAX_DAYS = 400          # ~1.5y of countdown history is plenty

MARKETS = {"arabica": "KC", "robusta": "RM"}


async def _fetch() -> dict:
    from playwright.async_api import async_playwright
    out: dict = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"))
        pg = await ctx.new_page()
        try:
            await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=45000)
            await pg.wait_for_timeout(3000)
            out = await pg.evaluate(
                """async (roots) => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const h = { credentials: 'include',
                                headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                                           'accept': 'application/json' } };
                    const base = 'https://www.barchart.com/proxies/core-api/v1/quotes/get';
                    const res = {};
                    for (const [mkt, root] of Object.entries(roots)) {
                        // 1. futures chain → pick the front (highest-OI) contract
                        const cf = 'symbol,contractExpirationDate,lastPrice,openInterest,volume';
                        const cu = base + '?symbol=' + root +
                            '%5EF&fields=' + cf +
                            '&orderBy=contractExpirationDate&orderDir=asc&limit=12&raw=1';
                        const cr = await fetch(cu, h);
                        if (!cr.ok) { res[mkt] = {error: 'chain http ' + cr.status}; continue; }
                        const chain = (await cr.json()).data || [];
                        let front = null;
                        for (const c of chain) {
                            const r = c.raw || c;
                            const oi = Number(r.openInterest) || 0;
                            if (!front || oi > front.oi) {
                                front = { symbol: r.symbol || c.symbol, oi,
                                          price: Number(r.lastPrice) || null };
                            }
                        }
                        if (!front || !front.symbol) { res[mkt] = {error: 'no front contract'}; continue; }
                        // 2. that contract's options board, both sides, with OI
                        const of_ = 'strike,optionType,lastPrice,volume,openInterest,' +
                                    'expirationDate,daysToExpiration,tradeTime';
                        const ou = base + '?symbol=' + front.symbol +
                            '&list=futures.options&fields=' + of_ + '&raw=1&limit=999';
                        const or_ = await fetch(ou, h);
                        res[mkt] = {
                            front,
                            options: or_.ok ? await or_.json() : {error: 'options http ' + or_.status},
                        };
                    }
                    return res;
                }""",
                MARKETS,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[fetch_options_json] Barchart fetch error: {e}")
        finally:
            await ctx.close()
            await browser.close()
    return out or {}


def _num(v):
    try:
        if v in (None, "", "N/A", "N\\/A"):
            return None
        return float(str(v).replace(",", "").rstrip("s"))
    except (TypeError, ValueError):
        return None


def _rows(options_payload: dict) -> list[dict]:
    """Flatten Barchart's options payload to [{strike, type, oi, vol, expiry, dte}].

    The grouped shape is {"data": {"Call": [...], "Put": [...]}}; some variants
    return a flat {"data": [...]} with an optionType field. Handle both.
    """
    data = (options_payload or {}).get("data")
    entries: list[tuple[str, dict]] = []
    if isinstance(data, dict):
        for side, arr in data.items():
            for it in arr or []:
                entries.append((side, it))
    elif isinstance(data, list):
        for it in data:
            entries.append((str(it.get("optionType", it.get("raw", {}).get("optionType", "?"))), it))
    rows = []
    for side, it in entries:
        r = it.get("raw", it) or it
        raw_strike = r.get("strike", it.get("strike"))
        s = str(raw_strike)
        typ = ("C" if s.upper().endswith("C") else "P" if s.upper().endswith("P")
               else side[:1].upper())
        strike = _num(s.rstrip("CPcp"))
        if strike is None:
            continue
        rows.append({
            "strike": strike,
            "type": "call" if typ == "C" else "put",
            "oi": _num(r.get("openInterest", it.get("openInterest"))),
            "vol": _num(r.get("volume", it.get("volume"))),
            "expiry": r.get("expirationDate") or it.get("expirationDate"),
            "dte": _num(r.get("daysToExpiration", it.get("daysToExpiration"))),
        })
    return rows


def _market_snapshot(mkt_payload: dict) -> dict | None:
    front = (mkt_payload or {}).get("front") or {}
    rows = _rows((mkt_payload or {}).get("options") or {})
    if not front.get("symbol") or not rows:
        return None
    price = front.get("price")
    by_strike: dict[float, dict] = {}
    for r in rows:
        slot = by_strike.setdefault(r["strike"], {"strike": r["strike"], "call_oi": 0,
                                                  "put_oi": 0, "call_vol": 0, "put_vol": 0})
        if r["type"] == "call":
            slot["call_oi"] += r["oi"] or 0
            slot["call_vol"] += r["vol"] or 0
        else:
            slot["put_oi"] += r["oi"] or 0
            slot["put_vol"] += r["vol"] or 0
    strikes = sorted(by_strike.values(), key=lambda s: s["strike"])
    call_oi = sum(s["call_oi"] for s in strikes)
    put_oi = sum(s["put_oi"] for s in strikes)
    itm_call = sum(s["call_oi"] for s in strikes if price and s["strike"] < price)
    itm_put = sum(s["put_oi"] for s in strikes if price and s["strike"] > price)
    expiry = next((r["expiry"] for r in rows if r["expiry"]), None)
    dte = next((r["dte"] for r in rows if r["dte"] is not None), None)
    return {
        "underlying": front["symbol"],
        "future_price": price,
        "option_expiry": expiry,
        "days_to_expiry": dte,
        "strikes": strikes,
        "totals": {"call_oi": call_oi, "put_oi": put_oi,
                   "itm_call_oi": itm_call, "itm_put_oi": itm_put},
    }


def main() -> int:
    raw = asyncio.run(_fetch())
    markets = {}
    for mkt in MARKETS:
        snap = _market_snapshot(raw.get(mkt) or {})
        if snap:
            markets[mkt] = snap
            print(f"[options] {mkt}: {snap['underlying']} — "
                  f"{len(snap['strikes'])} strikes, call OI {snap['totals']['call_oi']:.0f}, "
                  f"put OI {snap['totals']['put_oi']:.0f}, "
                  f"ITM {snap['totals']['itm_call_oi'] + snap['totals']['itm_put_oi']:.0f}, "
                  f"DTE {snap['days_to_expiry']}")
        else:
            err = (raw.get(mkt) or {}).get("error") or (raw.get(mkt) or {}).get("options", {})
            print(f"[options] {mkt}: no snapshot ({str(err)[:120]})")
    if not markets:
        print("[options] nothing fetched — keeping existing file")
        return 1

    try:
        doc = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        doc = {"history": []}
    doc.setdefault("history", [])

    today = date.today().isoformat()
    hist_row = {"date": today}
    for mkt, snap in markets.items():
        hist_row[mkt] = {
            "underlying": snap["underlying"],
            "future_price": snap["future_price"],
            "days_to_expiry": snap["days_to_expiry"],
            **snap["totals"],
        }
    doc["history"] = ([r for r in doc["history"] if r.get("date") != today] + [hist_row])
    doc["history"] = sorted(doc["history"], key=lambda r: r["date"])[-HISTORY_MAX_DAYS:]
    doc["markets"] = markets
    doc["updated"] = datetime.now(UTC).isoformat()
    doc.setdefault("source", "Barchart core-api (delayed) — options on ICE KC / RM futures")
    doc.setdefault("note", "ITM = calls below / puts above the front future's last price; "
                           "history is one aggregate row per session for the expiry countdown.")
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[options] options_oi.json → {today}: {', '.join(markets)} "
          f"({len(doc['history'])} history rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
