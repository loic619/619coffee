"""
probe_fbx_ajax.py — can we call the FBX ticker endpoint directly?

Probe 0.29 caught freightos.com/wp-admin/admin-ajax.php returning all thirteen
values in one 898-byte JSON — the twelve lanes plus the FBX composite, which we
do not track — each with Freightos' own change figure:

    {"success":true,"data":[{"label":"FBX","value":"$3,590","change":"+0.54%", ...},
                            {"label":"FBX01","value":"$7,621","change":"+1.73%", ...}, ...]}

If that call can be made on its own, the scraper drops from twelve Playwright
page loads to one HTTP request, gains the composite, and gains a second opinion
on our own w/w arithmetic. That is worth having.

But 0.29 recorded the *response*. It never recorded the *request*, so the method,
the `action` parameter and any nonce are all unknown. Guessing them is precisely
the mistake that cost three wrong hypotheses on the PortWatch port ids, so this
asks the page instead: drive it, capture the outbound request in full, then
immediately try to replay it with plain `requests` and no browser at all.

The replay is the part that decides. A WordPress ajax action commonly needs a
per-session nonce or a cookie, in which case it is not usable from a scraper and
the twelve page loads stay. Better to learn that here than halfway through a
rewrite.

Three questions, in order:

  1. what exactly does the page send?
  2. does the same request work cold — no browser, no cookies, no referer?
  3. does it take a date argument? A `change` field implies the server knows a
     previous value, and if it will hand back an arbitrary date then the whole
     "FBX history is unreachable" finding from 0.28/0.29 reopens. Low odds,
     near-zero cost while we are here.

Writes nothing. Run via workflow 0.32 (dispatch-only).

    cd backend && python -m scraper.probe_fbx_ajax
"""
from __future__ import annotations

import asyncio
import json
import sys

_PAGE = "https://www.freightos.com/enterprise/terminal/fbx-11-china-to-northern-europe/"
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _brief(body: str, n: int = 400) -> str:
    return body[:n].replace("\n", " ")


def _summarise(body: str) -> str:
    """Report the payload as lane->value pairs when it parses, else raw head."""
    try:
        parsed = json.loads(body)
    except Exception:  # noqa: BLE001
        return f"not JSON — {_brief(body, 200)}"
    rows = parsed.get("data") if isinstance(parsed, dict) else None
    if not isinstance(rows, list):
        return f"JSON but no data list — keys {list(parsed)[:10]}"
    pairs = [f"{r.get('label')}={r.get('value')}({r.get('change')})"
             for r in rows if isinstance(r, dict)]
    return f"{len(pairs)} lanes · " + " ".join(pairs)


async def capture() -> dict | None:
    """Drive the page and record the admin-ajax request in full."""
    from playwright.async_api import async_playwright

    found: dict = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page(user_agent=_UA)

        def on_request(req):
            if "admin-ajax" not in req.url or found:
                return
            found.update({
                "method": req.method,
                "url": req.url,
                "post_data": req.post_data,
                "headers": dict(req.headers),
            })

        page.on("request", on_request)
        try:
            await page.goto(_PAGE, wait_until="networkidle", timeout=60000)
        except Exception as e:  # noqa: BLE001
            print(f"  nav: {type(e).__name__} — {str(e)[:110]}")
        await page.wait_for_timeout(6000)

        cookies = await page.context.cookies()
        found["cookie_names"] = sorted({c["name"] for c in cookies})
        await browser.close()

    return found or None


def replay(req: dict) -> None:
    """Try the same call without a browser, stripping context step by step."""
    import requests

    interesting = ("content-type", "x-requested-with", "referer", "origin", "accept")
    hdrs = {k: v for k, v in req["headers"].items() if k.lower() in interesting}

    attempts = [
        ("full headers, no cookies", hdrs),
        ("minimal — UA + content-type only", {
            k: v for k, v in hdrs.items() if k.lower() == "content-type"}),
        ("bare — UA only", {}),
    ]
    for label, extra in attempts:
        headers = {"User-Agent": _UA, **extra}
        try:
            if req["method"] == "POST":
                r = requests.post(req["url"], data=req["post_data"],
                                  headers=headers, timeout=30)
            else:
                r = requests.get(req["url"], headers=headers, timeout=30)
        except Exception as e:  # noqa: BLE001
            print(f"  {label:34} ERR {type(e).__name__} {str(e)[:70]}")
            continue
        print(f"  {label:34} [{r.status_code}] {len(r.text):>6}b  {_summarise(r.text)[:150]}")


def try_date_arguments(req: dict) -> None:
    """Does the endpoint serve anything but today? Cheap to ask, huge if yes."""
    from datetime import date, timedelta

    import requests
    target = (date.today() - timedelta(days=30)).isoformat()
    base = req["post_data"] or ""

    for name in ("date", "day", "from", "start", "period", "range"):
        payload = f"{base}&{name}={target}" if base else None
        params = None if payload else {name: target}
        try:
            if req["method"] == "POST":
                r = requests.post(req["url"], data=payload,
                                  headers={"User-Agent": _UA}, timeout=30)
            else:
                r = requests.get(req["url"], params=params,
                                 headers={"User-Agent": _UA}, timeout=30)
        except Exception as e:  # noqa: BLE001
            print(f"  {name:8} ERR {type(e).__name__}")
            continue
        print(f"  {name:8} [{r.status_code}] {_summarise(r.text)[:130]}")


def main() -> int:
    print("=== 1. what does the page send? ===")
    req = asyncio.run(capture())
    if not req:
        print("  no admin-ajax request seen — the page may have changed.")
        return 0

    print(f"  method     {req['method']}")
    print(f"  url        {req['url'][:150]}")
    print(f"  post_data  {(req.get('post_data') or '(none)')[:300]}")
    print(f"  cookies    {req.get('cookie_names')}")
    for k, v in sorted(req["headers"].items()):
        if k.lower() in ("content-type", "x-requested-with", "referer", "origin", "accept"):
            print(f"  hdr {k:18} {v[:90]}")

    print("\n=== 2. does it work cold, with no browser? ===")
    replay(req)

    print("\n=== 3. will it serve a past date? ===")
    try_date_arguments(req)

    print("\n=== reading this ===")
    print("  Section 2 decides the rewrite: a 200 carrying 13 lanes on the bare")
    print("  attempt means one request replaces twelve page loads. Anything that")
    print("  needs the browser's cookies or a nonce means we keep Playwright.")
    print("  Section 3 is a long shot — identical payloads for every argument")
    print("  just confirms the endpoint is current-value-only, as 0.28/0.29 found.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
