"""
Probe: (a) does Barchart's options board serve greeks/IV fields?
(b) does core-api/v1/historical answer for option symbols — live AND expired?
Gates the greeks storage design and the expired-contract backfill.
"""
from __future__ import annotations

import asyncio
import json


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"))
        pg = await ctx.new_page()
        await pg.goto("https://www.barchart.com/futures/quotes/KCZ26/options",
                      wait_until="domcontentloaded", timeout=45000)
        await pg.wait_for_timeout(4000)
        out = await pg.evaluate("""async () => {
            function getCookie(n) {
                const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                return v ? decodeURIComponent(v[2]) : null;
            }
            const h = { credentials: 'include',
                        headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                                   'accept': 'application/json' } };
            const res = {};
            const base = 'https://www.barchart.com/proxies/core-api/v1';

            // 1. board WITH greeks fields requested
            const gf = 'symbol,strike,optionType,lastPrice,bidPrice,askPrice,volume,' +
                       'openInterest,impliedVolatility,delta,gamma,theta,vega,rho,' +
                       'tradeTime,expirationDate,daysToExpiration';
            let r = await fetch(base + '/quotes/get?symbol=KCZ26&list=futures.options' +
                                '&fields=' + gf + '&raw=1&limit=6', h);
            res.board = r.ok ? await r.json() : {err: r.status};

            // 2. per-symbol quote of one option with greeks
            r = await fetch(base + '/quotes/get?symbols=KCZ26%7C310C&fields=' + gf + '&raw=1', h);
            res.single = r.ok ? await r.json() : {err: r.status};

            // 3. historical EOD for a LIVE option symbol (two url shapes)
            for (const [k, u] of Object.entries({
                histA: '/historical/get?symbol=KCZ26%7C310C&type=eod&startDate=2026-06-01&endDate=2026-08-15&fields=tradeTime,openPrice,highPrice,lowPrice,lastPrice,volume,openInterest&raw=1&limit=99',
                histB: '/history/get?symbol=KCZ26%7C310C&type=daily&startDate=2026-06-01&maxRecords=90',
            })) {
                r = await fetch(base + u, h);
                let body = null;
                try { body = r.ok ? await r.json() : {err: r.status}; }
                catch (e) { body = {parse: String(e).slice(0, 80)}; }
                res[k] = body;
            }

            // 4. historical EOD for EXPIRED options (U26 expired 14 Aug; Z25 last year)
            for (const [k, sym] of Object.entries({
                expU26: 'KCU26%7C320C', expZ25: 'KCZ25%7C300C', expRMU: 'RMU26%7C3600C',
            })) {
                r = await fetch(base + '/historical/get?symbol=' + sym +
                    '&type=eod&startDate=2024-01-01&endDate=2026-08-15' +
                    '&fields=tradeTime,lastPrice,volume,openInterest&raw=1&limit=400', h);
                let body = null;
                try { body = r.ok ? await r.json() : {err: r.status}; }
                catch (e) { body = {parse: String(e).slice(0, 80)}; }
                res[k] = body;
            }
            return res;
        }""")
        await browser.close()

    for key, val in out.items():
        s = json.dumps(val)
        print(f"\n===== {key} ({len(s)}B) =====")
        if isinstance(val, dict) and isinstance(val.get("data"), (list, dict)):
            d = val["data"]
            n = len(d) if isinstance(d, list) else {k: len(v) for k, v in d.items()}
            print(f"  count={val.get('count')} total={val.get('total')} data-len={n}")
        print(" ", s[:900])


asyncio.run(main())
