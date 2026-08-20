"""
probe_tradespread.py — TEMPORARY. Dump the structure of acaphe.com/tradespread.php
so a parser can be written against it. Delete once the parser exists.

Prints, in one run:
  * raw GET with the logged-in cookies (status, content-type, length, head)
  * the DOM as rendered by Playwright (in case the table is JS-populated)
  * every table: header cells + first rows, so column meaning is inferable
  * any <script> data blobs / fetch URLs the page uses
  * whether the page accepts a date or contract query parameter
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraper.acaphe_poller import HEADERS, playwright_login  # noqa: E402

URL = "https://acaphe.com/tradespread.php"


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _dump_tables(html: str, tag: str) -> None:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    print(f"\n[{tag}] tables found: {len(tables)}")
    for ti, t in enumerate(tables):
        rows = t.find_all("tr")
        print(f"\n[{tag}] --- table #{ti}: {len(rows)} rows, "
              f"id={t.get('id')!r} class={t.get('class')!r}")
        for ri, tr in enumerate(rows[:14]):
            cells = [_clean(c.decode_contents()) for c in tr.find_all(["th", "td"])]
            if cells:
                print(f"[{tag}]   r{ri}: {cells}")
        if len(rows) > 14:
            mid = rows[len(rows) // 2]
            print(f"[{tag}]   … (mid row): "
                  f"{[_clean(c.decode_contents()) for c in mid.find_all(['th', 'td'])]}")
            last = rows[-1]
            print(f"[{tag}]   … (last row): "
                  f"{[_clean(c.decode_contents()) for c in last.find_all(['th', 'td'])]}")


async def main() -> int:
    cookies = await playwright_login()

    # ── 1. plain GET with the session cookies ────────────────────────────────
    r = requests.get(URL, cookies=cookies, headers=HEADERS, timeout=20)
    print(f"\n[raw] status={r.status_code} type={r.headers.get('content-type')} "
          f"len={len(r.text)}")
    print(f"[raw] head 1200 chars:\n{r.text[:1200]}")
    if len(r.text) > 1200:
        print(f"[raw] tail 600 chars:\n{r.text[-600:]}")
    _dump_tables(r.text, "raw")

    # scripts / endpoints the page pulls from
    for m in re.findall(r"(?:url|src|action)\s*[:=]\s*[\"']([^\"']{3,120})[\"']", r.text)[:25]:
        print(f"[raw][endpoint] {m}")
    for m in re.findall(r"\$\.(?:get|post|ajax)\(([^)]{0,160})", r.text)[:10]:
        print(f"[raw][ajax] {m}")
    # inline JS arrays that might hold the ticks
    for m in re.findall(r"var\s+(\w+)\s*=\s*(\[[^;]{0,300})", r.text)[:10]:
        print(f"[raw][jsvar] {m[0]} = {m[1][:300]}")

    # ── 2. Playwright-rendered DOM (JS-populated tables) ─────────────────────
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=HEADERS["User-Agent"])
        await ctx.add_cookies([
            {"name": k, "value": v, "domain": "acaphe.com", "path": "/"}
            for k, v in cookies.items()])
        page = await ctx.new_page()
        seen: list[str] = []
        page.on("request", lambda req: seen.append(req.url)
                if any(x in req.url for x in (".php", "json")) else None)
        await page.goto(URL, wait_until="domcontentloaded", timeout=45_000)
        await page.wait_for_timeout(6000)
        html = await page.content()
        print(f"\n[dom] rendered length={len(html)} title={await page.title()!r}")
        _dump_tables(html, "dom")
        print(f"\n[dom] requests: {sorted(set(seen))[:25]}")
        # visible text as a fallback view of the layout
        txt = await page.evaluate("document.body.innerText")
        print(f"\n[dom] innerText first 2500:\n{txt[:2500]}")
        await browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
