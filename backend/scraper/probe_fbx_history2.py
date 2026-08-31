"""
probe_fbx_history2.py — second pass at FBX history, fixing two holes in 0.28.

0.28 found no series endpoint on the lane pages: three captured responses, all
HubSpot forms and one `wp-admin/admin-ajax.php`. It reported "chart range
controls: none found", which is itself the interesting result — the terminal
lane page appears to be a marketing page showing one current number, not an
interactive chart. But two things in that probe were wrong, and until they are
fixed "no endpoint" is not a finding, only an absence of evidence:

  1. it never watched the network on fbx.freightos.com. That page was only
     scored as HTML and searched for download links. It is the public front end
     onto the same index and the likeliest place for a chart with real history,
     so not listening there left the main question unasked.
  2. the response filter required a JSON/CSV content-type or a keyword in the
     URL. A series served as, say, `text/html` from a path with none of those
     words would have been dropped before it was ever scored.

This pass therefore captures EVERY response on every page, filters nothing, and
ranks by series-likeness. It also:

  * dumps the admin-ajax.php body, since that is where a WordPress page would
    get a live number from and it may take a date-range argument;
  * scrolls to the bottom and waits, because chart widgets commonly load only
    when they enter the viewport, which "networkidle" alone will not trigger;
  * reports iframes and any <canvas>/<svg> chart nodes, so "there is no chart"
    can be stated as a fact rather than inferred from a missing request.

If this pass is also empty, the answer is settled: FBX history is not reachable
anonymously, and the options are a Freightos subscription, a different index
with open history, or accumulating our own from here.

Writes nothing. Run via workflow 0.29 (dispatch-only).

    cd backend && python -m scraper.probe_fbx_history2
"""
from __future__ import annotations

import asyncio
import re
import sys

_TARGETS = [
    ("public-fbx",   "https://fbx.freightos.com/"),
    ("public-index", "https://www.freightos.com/freightos-baltic-index/"),
    ("lane-FBX11",   "https://www.freightos.com/enterprise/terminal/fbx-11-china-to-northern-europe/"),
]

_DATE_RE = re.compile(r"\b20[12]\d-[01]\d-[0-3]\d\b")
_EPOCH_RE = re.compile(r"\b1[5-8]\d{8}(?:\d{3})?\b")
_NUM_RUN_RE = re.compile(r"\[\s*-?\d[\d.,\s\-]{80,}\]")

# Static assets can be skipped by extension without any guess about semantics.
_ASSET_EXT = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
              ".woff", ".woff2", ".ttf", ".css", ".mp4", ".webm")


def _score(body: str) -> tuple[int, int, int]:
    return (
        len(set(_DATE_RE.findall(body))),
        len(set(_EPOCH_RE.findall(body))),
        len(_NUM_RUN_RE.findall(body)),
    )


async def _probe(browser, label: str, url: str) -> None:
    print(f"\n{'=' * 78}\n=== {label} — {url}")
    page = await browser.new_page()
    seen: list[tuple[str, int, str, str]] = []   # url, status, ctype, body
    pending: list = []

    async def grab(resp):
        u = resp.url
        if any(u.split("?")[0].lower().endswith(e) for e in _ASSET_EXT):
            return
        try:
            body = await resp.text()
        except Exception:  # noqa: BLE001
            return
        seen.append((u, resp.status, (resp.headers or {}).get("content-type", "")[:40], body))

    page.on("response", lambda r: pending.append(asyncio.create_task(grab(r))))

    try:
        await page.goto(url, wait_until="networkidle", timeout=60000)
    except Exception as e:  # noqa: BLE001
        print(f"  nav: {type(e).__name__} — {str(e)[:110]}")

    # Chart widgets usually mount on intersection, not on load. Walk down the
    # page so anything below the fold gets a chance to fetch.
    for _ in range(6):
        try:
            await page.mouse.wheel(0, 1400)
            await page.wait_for_timeout(1200)
        except Exception:  # noqa: BLE001
            break
    await page.wait_for_timeout(5000)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)

    # Is there a chart at all?
    try:
        canvases = await page.locator("canvas").count()
        svgs = await page.locator("svg.highcharts-root, svg[class*=chart], div[class*=chart] svg").count()
        frames = [f.url for f in page.frames if f.url and f.url != url]
        print(f"  chart nodes: {canvases} <canvas>, {svgs} chart-ish <svg> · {len(frames)} subframe(s)")
        for f in frames[:8]:
            print(f"    frame: {f[:120]}")
    except Exception as e:  # noqa: BLE001
        print(f"  dom inspect failed: {type(e).__name__}")

    print(f"  captured {len(seen)} response(s), unfiltered")
    ranked = sorted(seen, key=lambda t: sum(_score(t[3])[:2]) + _score(t[3])[2] * 10, reverse=True)
    for u, status, ctype, body in ranked[:10]:
        d, ep, runs = _score(body)
        flag = "  <-- SERIES?" if (d >= 20 or ep >= 20 or runs) else ""
        print(f"    [{status}] {d:>4}d {ep:>4}e {runs:>2}r {len(body):>9,}b {ctype:<26} {u[:88]}{flag}")

    # The WordPress ajax endpoint is where a live number would come from.
    for u, status, ctype, body in seen:
        if "admin-ajax" in u:
            print(f"\n  --- admin-ajax [{status}] {ctype} {len(body)}b ---")
            print("  " + body[:900].replace("\n", " ")[:900])

    best = ranked[0] if ranked else None
    if best:
        d, ep, runs = _score(best[3])
        if d >= 20 or ep >= 20 or runs:
            print(f"\n  --- best candidate ---\n  {best[0]}")
            print("  " + best[3][:900].replace("\n", " ")[:900])

    await page.close()


async def main() -> int:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for label, url in _TARGETS:
            try:
                await _probe(browser, label, url)
            except Exception as e:  # noqa: BLE001
                print(f"  {label}: FAILED {type(e).__name__} — {str(e)[:140]}")
        await browser.close()
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(asyncio.run(main()))
