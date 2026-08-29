"""
probe_fbx_lanes.py — which FBX tradelanes actually exist, and do any fit coffee?

Why. freight.json presents seven routes, but only three FBX indices sit behind
them; five are FBX11 (China/East Asia → North Europe) multiplied by a constant.
That is wrong in two ways for the coffee lanes:

  * wrong trade. Santos → Rotterdam is South America → Europe. Pricing it off an
    Asia→Europe index means Red Sea and Asian capacity events move Brazilian
    coffee freight that they do not actually touch.
  * wrong direction. Coffee leaves Brazil on the backhaul leg. Headhaul and
    backhaul price very differently, so even a same-trade index read the wrong
    way round is misleading.

And the multipliers (0.58, 0.55, 0.70, 0.45) are static: whatever ratio held on
the day they were picked is frozen, so the estimate drifts silently.

Search suggests FBX24 is Europe → South America East Coast — the reverse of the
direction coffee moves — and turned up no export-direction lane. But "search did
not find it" is not "it does not exist", and that distinction has already cost
time this session. So this asks Freightos directly: probe the terminal for every
plausible lane code and report which resolve, with their published names.

The answer decides the fix: a real SAEC→Europe lane means Santos gets a genuine
index; no such lane means the honest move is to label those routes as estimates
or drop them, rather than dress one index as five.

Writes nothing. Run via workflow 0.27 (dispatch-only).

    cd backend && python -m scraper.probe_fbx_lanes
"""
from __future__ import annotations

import re
import sys
import time

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}

# The terminal exposes one page per lane. Slugs are descriptive, so rather than
# guessing every slug, fetch the index pages and harvest the links.
_HUBS = [
    "https://www.freightos.com/freightos-baltic-index/",
    "https://terminal.freightos.com/",
    "https://www.freightos.com/enterprise/terminal/",
]

# Lane pages already known to exist, to confirm the slug pattern still holds.
_KNOWN = [
    "fbx-11-china-to-northern-europe",
    "fbx-01-china-to-north-america-west-coast",
    "fbx-03-china-to-north-america-east-coast",
    "fbx-24-europe-to-south-america-east-coast",
]

_SLUG_RE = re.compile(r"/(fbx-\d{2}-[a-z0-9-]+)/", re.I)
# What we are hunting for: anything leaving South/Latin America, or a
# transatlantic leg that could stand in for Santos → Rotterdam.
_COFFEE_RELEVANT = re.compile(
    r"south-america.*to|latin|brazil|santos|"
    r"north-america-east-coast-to-north|to-north(ern)?-europe", re.I)


def _get(url: str, timeout: int = 45):
    import requests

    time.sleep(0.8)
    return requests.get(url, headers=_HEADERS, timeout=timeout,
                        allow_redirects=True)


def main() -> int:
    slugs: set[str] = set()

    print("=== harvesting lane links from the index pages ===")
    for hub in _HUBS:
        try:
            r = _get(hub)
        except Exception as e:  # noqa: BLE001
            print(f"  ERR  {type(e).__name__:16} {hub}")
            continue
        found = set(_SLUG_RE.findall(r.text))
        print(f"  {r.status_code}  {len(found):>2} lane link(s)  {hub}")
        slugs |= {s.lower() for s in found}

    slugs |= set(_KNOWN)
    print(f"\n=== {len(slugs)} distinct lane slug(s) ===")
    for s in sorted(slugs):
        print(f"  {s}")

    print("\n=== which resolve, and what they are called ===")
    live: list[tuple[str, str]] = []
    for slug in sorted(slugs):
        url = f"https://terminal.freightos.com/{slug}/"
        try:
            r = _get(url, timeout=40)
        except Exception as e:  # noqa: BLE001
            print(f"  ERR  {type(e).__name__:16} {slug}")
            continue
        if r.status_code != 200:
            print(f"  {r.status_code}  {slug}")
            continue
        m = re.search(r"<title>([^<]+)</title>", r.text, re.I)
        title = (m.group(1) if m else "").strip()[:80]
        live.append((slug, title))
        print(f"  200  {slug:52} {title}")

    print("\n=== lanes that could serve a coffee export route ===")
    hits = [(s, t) for s, t in live if _COFFEE_RELEVANT.search(s)]
    for slug, title in hits:
        print(f"  {slug:52} {title}")
    if not hits:
        print("  NONE — no export-direction lane for South America or a usable")
        print("  transatlantic leg. Santos/Cartagena/Djibouti have no real index,")
        print("  so they should be labelled estimates rather than quoted as rates.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
