"""
Probe round 3 (Playwright): plain requests to theice.com hit a WAF wall from
CI, so drive a real headless Chromium instead and CAPTURE THE XHR TRAFFIC of
(a) ICE Report Center pages 176/26/27 — does a browser pass the WAF, and which
data endpoints/params do the reports call?  (b) the Coffee C product page —
delayed-market ids + options endpoints.  (c) Barchart KC options — per-strike
OI availability. Prints findings, writes nothing.
"""
from __future__ import annotations

import asyncio
import json


async def capture(page, url, wait_ms=9000, label=None, click_text=None):
    hits = []

    async def on_response(resp):
        try:
            ct = resp.headers.get("content-type", "")
            u = resp.url
            if any(s in u for s in ("/api/", "AsJson", "Json", ".json", "core-api",
                                    "graphql", "report")) or "json" in ct:
                body = ""
                if "json" in ct:
                    try:
                        body = (await resp.text())[:260]
                    except Exception:
                        body = "<body unavailable>"
                hits.append((resp.status, u[:150], body))
        except Exception:
            pass

    page.on("response", on_response)
    print(f"\n=== {label or url} ===")
    try:
        r = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
        print(f"  page status: {r.status if r else '?'}  title: {await page.title()!r}")
        if click_text:
            try:
                await page.click(f"text={click_text}", timeout=5000)
                print(f"  clicked {click_text!r}")
            except Exception as e:
                print(f"  click {click_text!r} failed: {type(e).__name__}")
        await page.wait_for_timeout(wait_ms)
    except Exception as e:
        print(f"  goto ERR {type(e).__name__}: {e}")
    page.remove_listener("response", on_response)
    seen = set()
    for st, u, body in hits:
        key = u.split("?")[0]
        tag = "" if key not in seen else " (dup-path)"
        seen.add(key)
        print(f"  [{st}] {u}{tag}")
        if body and st == 200:
            print(f"        {body!r}")
    if not hits:
        print("  (no api-ish responses captured)")


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
            viewport={"width": 1440, "height": 900},
        )
        page = await ctx.new_page()

        await capture(page, "https://www.ice.com/report/176", label="Report 176 daily vol+OI")
        await capture(page, "https://www.ice.com/report/26",  label="Report 26 hist daily vol futures")
        await capture(page, "https://www.ice.com/report/27",  label="Report 27 hist daily vol options")
        await capture(page, "https://www.ice.com/products/15-Coffee-C-Futures",
                      label="Coffee C product page", wait_ms=10000)
        await capture(page, "https://www.barchart.com/futures/quotes/KCZ26/options",
                      label="Barchart KCZ26 options", wait_ms=12000)

        await browser.close()


asyncio.run(main())
