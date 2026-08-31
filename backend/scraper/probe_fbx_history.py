"""
probe_fbx_history.py — is there a way to get FBX *history*, not just today?

Why. The scraper captures a single current value per lane, twice a week, so the
stored series is a step function starting whenever we first scraped that lane —
about two years for FBX11/01/03, and today for the other nine. Every FBX page
renders a chart with real history behind it, which means the history exists and
reaches the browser. The question is whether it arrives in a form we can read.

This does not guess at endpoint names. Guessing is what cost time on the port
ids: three wrong hypotheses before asking the data. So instead it drives a real
browser at the lane pages and records what the page itself fetches, then reports
any response that looks like a time series — many date-like tokens, or a long
run of numbers. Whatever the chart is drawn from will be in that list.

Three things it checks, cheapest first:

  1. inline data — a JSON blob in the HTML (__NEXT_DATA__, a hydration payload)
     already carrying the series, in which case no API call is needed at all.
  2. network — every JSON/CSV/XHR response the page makes, scored for
     series-likeness, with the shape of the best candidates printed.
  3. the public fbx.freightos.com site, which serves the same index to a wider
     audience and may be less locked down than the enterprise terminal.

It also reports how far back the chart's own control offers to go (1M/3M/1Y/…),
since that bounds what any endpoint will return however we call it.

Writes nothing, stores nothing, changes no scraper. Run via workflow 0.28
(dispatch-only), then pin the answer.

    cd backend && python -m scraper.probe_fbx_history
"""
from __future__ import annotations

import asyncio
import json
import re
import sys

# One already-tracked lane and two of the new ones, so a difference in how the
# old and new pages are served would show up rather than hiding behind a single
# sample.
_LANES = [
    ("FBX11", "https://www.freightos.com/enterprise/terminal/fbx-11-china-to-northern-europe/"),
    ("FBX21", "https://terminal.freightos.com/fbx-21-north-america-east-coast-to-northern-europe/"),
    ("FBX24", "https://terminal.freightos.com/fbx-24-europe-to-south-america-east-coast/"),
]

# The public index site, which is a different front end onto the same numbers.
_PUBLIC = [
    "https://fbx.freightos.com/",
    "https://www.freightos.com/freightos-baltic-index/",
]

_DATE_RE = re.compile(r"\b20[12]\d-[01]\d-[0-3]\d\b")
_EPOCH_RE = re.compile(r"\b1[5-8]\d{8}(?:\d{3})?\b")     # 2017-2027 in s or ms
_NUM_RUN_RE = re.compile(r"\[\s*-?\d[\d.,\s\-]{80,}\]")  # a long numeric array

# Chart range controls, to learn how much history the widget itself offers.
_RANGE_RE = re.compile(r"\b(1M|3M|6M|YTD|1Y|2Y|3Y|5Y|MAX|ALL)\b")


def _score(body: str) -> tuple[int, int, int]:
    """How much does this look like a time series? (dates, epochs, numeric runs)"""
    return (
        len(set(_DATE_RE.findall(body))),
        len(set(_EPOCH_RE.findall(body))),
        len(_NUM_RUN_RE.findall(body)),
    )


def _interesting(url: str, ctype: str) -> bool:
    if any(url.endswith(ext) for ext in (".png", ".jpg", ".svg", ".woff", ".woff2", ".css", ".ico")):
        return False
    return (
        "json" in ctype or "csv" in ctype or "text/plain" in ctype
        or any(k in url.lower() for k in ("api", "graphql", "chart", "series", "history", "data"))
    )


async def _probe_lane(browser, code: str, url: str) -> None:
    print(f"\n=== {code} — {url}")
    page = await browser.new_page()
    captured: list[tuple[str, int, str]] = []   # url, status, body

    async def on_response(resp):
        try:
            ctype = (resp.headers or {}).get("content-type", "")
            if not _interesting(resp.url, ctype):
                return
            body = await resp.text()
        except Exception:  # noqa: BLE001 - bodies of redirects/aborts are not readable
            return
        captured.append((resp.url, resp.status, body))

    page.on("response", lambda r: asyncio.create_task(on_response(r)))

    try:
        await page.goto(url, wait_until="networkidle", timeout=60000)
    except Exception as e:  # noqa: BLE001
        print(f"  nav: {type(e).__name__} — {str(e)[:120]}")

    # Let any lazily-rendered chart fire its own request.
    await page.wait_for_timeout(6000)

    html = await page.content()

    # 1 — is the series already in the HTML?
    d, ep, runs = _score(html)
    print(f"  inline HTML: {len(html):>8,} bytes · {d} distinct dates · {ep} epochs · {runs} numeric runs")
    for tag in ("__NEXT_DATA__", "__NUXT__", "window.__INITIAL", "application/ld+json"):
        if tag in html:
            print(f"    contains {tag}")

    # What ranges does the widget offer? Bounds anything we could ask for.
    ranges = sorted(set(_RANGE_RE.findall(html)))
    print(f"  chart range controls on page: {ranges or 'none found'}")

    # 2 — what did it fetch?
    print(f"  captured {len(captured)} candidate response(s)")
    scored = sorted(
        ((_score(b), u, s, b) for u, s, b in captured),
        key=lambda t: (t[0][0] + t[0][1], t[0][2]),
        reverse=True,
    )
    for (d, ep, runs), u, status, body in scored[:6]:
        flag = "  <-- SERIES?" if (d >= 20 or ep >= 20 or runs) else ""
        print(f"    [{status}] {d:>4}d {ep:>4}e {runs:>2}r {len(body):>8,}b  {u[:110]}{flag}")

    # 3 — show the shape of the single best candidate, so the next step is
    # writing a parser rather than another probe.
    if scored:
        (d, ep, runs), u, status, body = scored[0]
        if d >= 20 or ep >= 20 or runs:
            print(f"\n  --- best candidate body head ---\n  {u}")
            try:
                parsed = json.loads(body)
                print("  top-level keys:", list(parsed)[:20] if isinstance(parsed, dict) else f"list[{len(parsed)}]")
            except Exception:  # noqa: BLE001
                pass
            print("  " + body[:700].replace("\n", " ")[:700])

    await page.close()


async def _probe_public(browser, url: str) -> None:
    print(f"\n=== public site — {url}")
    page = await browser.new_page()
    try:
        await page.goto(url, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(4000)
        html = await page.content()
    except Exception as e:  # noqa: BLE001
        print(f"  {type(e).__name__} — {str(e)[:120]}")
        await page.close()
        return
    d, ep, runs = _score(html)
    print(f"  {len(html):>8,} bytes · {d} distinct dates · {ep} epochs · {runs} numeric runs")
    # A download link would be the cleanest possible answer.
    for m in set(re.findall(r'href="([^"]*(?:csv|xlsx|download|export)[^"]*)"', html, re.I)):
        print(f"    download-ish link: {m[:130]}")
    await page.close()


async def main() -> int:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for code, url in _LANES:
            try:
                await _probe_lane(browser, code, url)
            except Exception as e:  # noqa: BLE001
                print(f"  {code}: FAILED {type(e).__name__} — {str(e)[:140]}")
        for url in _PUBLIC:
            try:
                await _probe_public(browser, url)
            except Exception as e:  # noqa: BLE001
                print(f"  {url}: FAILED {type(e).__name__} — {str(e)[:140]}")
        await browser.close()

    print("\n=== what to read from this ===")
    print("  A response marked SERIES? is the endpoint to hit directly — one call")
    print("  per lane backfills years instead of accumulating twice a week.")
    print("  If nothing is marked, the chart is drawn from data we cannot reach")
    print("  anonymously, and the honest answer is that history needs either a")
    print("  Freightos subscription or patience.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(asyncio.run(main()))
