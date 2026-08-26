"""
probe_stock_report_access.py — settle two assumptions the sweep is built on.

Both are load-bearing and neither has ever been tested. They are cheap to
answer (a handful of requests) and each one, if false, changes the design.

Q1 · Is there a directory index?
    The entire HHMMSS-guessing apparatus exists because we believe there is no
    listing. If `stock_reports/` (or a sibling path) returns one, the sweep can
    be deleted outright: read the index, take the filename, one GET.

Q2 · Are historical reports retained?
    orchestrate.py says "ICE only keeps one per day", and that claim is why the
    scraper stopped probing older days. But the evidence for it was a run log
    showing "1 of 5 days captured" — which is equally explained by tier-1
    guessing wrong on the other four, since the publish second is near-unique.
    The operator supplied working URLs for 2026-06-10 and 2026-06-29 in August,
    which suggests retention is real. If it is, a missed day is recoverable and
    the sweep should resume across runs rather than give up.

Run:  cd backend && PYTHONPATH=. python -m scraper.sources.ice_certified_stocks.probe_stock_report_access
"""
from __future__ import annotations

import sys
import time

import requests

from scraper.sources.ice_certified_stocks import fetchers as F

BASE = "https://www.ice.com/marketdata/publicdocs/liffe/coffee"
PAUSE = 5.0          # the marketdata throttle — this probe must not draw a ban

# Confirmed publish times, supplied by the operator. Two are months old, which
# is exactly what makes them the retention test.
KNOWN = [
    ("2026-06-10", "102956"),
    ("2026-06-29", "124715"),
    ("2026-08-18", "110055"),
]

INDEX_CANDIDATES = [
    f"{BASE}/stock_reports/",
    f"{BASE}/stock_reports/index.html",
    f"{BASE}/",
]


def _get(url: str, method: str = "GET") -> tuple[int, int, str]:
    try:
        r = requests.request(method, url, headers=F.HEADERS, timeout=30,
                             allow_redirects=True)
        return r.status_code, len(r.content or b""), r.headers.get("Content-Type", "")[:40]
    except Exception as e:  # noqa: BLE001
        return -1, 0, f"{type(e).__name__}: {e}"[:60]
    finally:
        time.sleep(PAUSE)


def main() -> int:
    print("Q1 — directory index?")
    index_found = False
    for u in INDEX_CANDIDATES:
        code, size, ctype = _get(u)
        print(f"  {code:>4}  {size:>8}b  {ctype:<40} {u}")
        if code == 200 and size > 0:
            index_found = True
    print(f"  → {'AN INDEX RESPONDS — the sweep may be replaceable' if index_found else 'no index; guessing stays necessary'}\n")

    print("Q2 — are historical reports retained?")
    retained = 0
    for day, hhmmss in KNOWN:
        url = F.ROBUSTA_STOCK_REPORT_CSV.format(yyyymmdd=day.replace("-", ""), hhmmss=hhmmss)
        code, size, ctype = _get(url)
        ok = code == 200 and size > 0
        retained += ok
        print(f"  {code:>4}  {size:>8}b  {day} {hhmmss}  {'RETAINED' if ok else 'gone'}")
    print(f"  → {retained}/{len(KNOWN)} historical reports still served")
    if retained == len(KNOWN):
        print("  → retention CONFIRMED: a missed day is recoverable. The sweep should")
        print("    resume across runs, and older days are worth re-probing.")
    elif retained == 0:
        print("  → retention DISPROVED: only the current day exists; a miss is permanent")
        print("    and probing older days is pure waste.")
    else:
        print("  → mixed — retention has a horizon; measure it before relying on it.")

    print("\nQ3 — is HEAD honoured? (a cheaper sweep if so)")
    day, hhmmss = KNOWN[-1]
    url = F.ROBUSTA_STOCK_REPORT_CSV.format(yyyymmdd=day.replace("-", ""), hhmmss=hhmmss)
    code, size, ctype = _get(url, method="HEAD")
    print(f"  HEAD {code} {size}b {ctype}")
    print(f"  → {'HEAD works — same request count but far less bytes' if code == 200 else 'HEAD not usable'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
