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
_AJAX = "https://www.freightos.com/wp-admin/admin-ajax.php"
_ACTION = "freightos_get_ticker_data"
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _brief(body: str, n: int = 400) -> str:
    return body[:n].replace("\n", " ")


def _summarise(body: str) -> str:
    """Report the payload as lane->value pairs when it parses, else raw head.

    Must survive a scalar: WordPress answers an unrecognised or unparsed action
    with a bare `0`, which is valid JSON and is not a dict. The first run of this
    probe crashed here on `list(0)` and lost the last two sections.
    """
    try:
        parsed = json.loads(body)
    except Exception:  # noqa: BLE001
        return f"not JSON — {_brief(body, 200)}"
    if not isinstance(parsed, dict):
        # A bare 0 is WordPress saying "no handler ran".
        return f"scalar {parsed!r} — action not handled"
    rows = parsed.get("data")
    if not isinstance(rows, list):
        return f"dict but no data list — keys {list(parsed)[:10]}"
    pairs = [f"{r.get('label')}={r.get('value')}({r.get('change')})"
             for r in rows if isinstance(r, dict)]
    return f"{len(pairs)} lanes · " + " ".join(pairs)


_FORM = {"Content-Type": "application/x-www-form-urlencoded"}


def _post(body: str, label: str) -> str:
    """One POST to the ticker endpoint, reported in a single line."""
    import requests

    try:
        r = requests.post(_AJAX, data=body, timeout=30,
                          headers={"User-Agent": _UA, **_FORM})
    except Exception as e:  # noqa: BLE001
        return f"  {label:38} ERR {type(e).__name__} {str(e)[:60]}"
    return f"  {label:38} [{r.status_code}] {len(r.text):>6}b  {_summarise(r.text)[:120]}"


def nonce_from_html() -> str | None:
    """Can a plain GET find the nonce, with no browser at all?

    This is the whole design question. If the nonce is inlined in the page HTML
    then the scraper is: one GET, one regex, one POST — and Playwright leaves
    workflow 1.2 entirely. If it is minted by JavaScript at runtime, the browser
    stays, though even then one page load beats twelve.
    """
    import re

    import requests

    try:
        r = requests.get(_PAGE, headers={"User-Agent": _UA}, timeout=45)
    except Exception as e:  # noqa: BLE001
        print(f"  page GET failed: {type(e).__name__} {str(e)[:80]}")
        return None
    print(f"  plain GET of the lane page: [{r.status_code}] {len(r.text):,}b")

    # Try the specific pairing first, then any WP-shaped nonce, so a rename of
    # the surrounding variable does not read as "absent".
    for pat, why in (
        (r'freightos_get_ticker_data["\']\s*,\s*["\']?nonce["\']?\s*:\s*["\']([0-9a-f]{8,12})', "next to the action name"),
        (r'["\']?nonce["\']?\s*[:=]\s*["\']([0-9a-f]{8,12})["\']', "a nonce-shaped field"),
        (r'ticker[^<>]{0,200}?([0-9a-f]{10})', "near the word ticker"),
    ):
        m = re.search(pat, r.text, re.I)
        if m:
            print(f"  found {why}: {m.group(1)}")
            return m.group(1)
    print("  no nonce in the served HTML — it is minted client-side")
    return None


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

    # Run 1 proved the captured request replays without cookies. It did NOT
    # show whether the nonce is checked — the nonce used was fresh from that
    # same session. If it is not validated, the scraper needs no page load at
    # all; if it is, we need one GET to harvest it. Very different designs.
    print("\n=== 3. is the nonce actually validated? ===")
    captured = ""
    if req.get("post_data"):
        import re as _re
        m = _re.search(r"nonce=([0-9a-f]+)", req["post_data"])
        captured = m.group(1) if m else ""
    print(_post(f"action={_ACTION}&nonce={captured}", "captured nonce"))
    print(_post(f"action={_ACTION}&nonce=deadbeef01", "obviously bogus nonce"))
    print(_post(f"action={_ACTION}", "no nonce field at all"))
    print(_post(f"action={_ACTION}_typo&nonce={captured}", "wrong action (control)"))
    print(_post("", "empty body (control)"))

    print("\n=== 4. can a plain GET harvest a nonce, no browser? ===")
    html_nonce = nonce_from_html()
    if html_nonce:
        print(_post(f"action={_ACTION}&nonce={html_nonce}", "nonce scraped from HTML"))

    print("\n=== 5. will it serve a past date? ===")
    try_date_arguments(req)

    print("\n=== reading this ===")
    print("  Section 2: confirmed in run 1 — replays fine without cookies.")
    print("  Section 3 decides the design. If the bogus and missing-nonce calls")
    print("  still return 13 lanes, the nonce is decorative and the scraper is a")
    print("  single POST with no page fetch. If they return 0 or 403, we need a")
    print("  nonce, and section 4 says whether a plain GET can get one — which")
    print("  still beats twelve Playwright loads either way.")
    print("  The wrong-action and empty-body controls exist so that a uniform 0")
    print("  can be read as 'rejected' rather than 'the endpoint always says 0'.")
    print("  Section 5 stays a long shot; identical payloads for every argument")
    print("  just re-confirms current-value-only, as 0.28/0.29 found.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
