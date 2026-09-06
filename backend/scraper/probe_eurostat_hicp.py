"""
probe_eurostat_hicp.py — why does the EU coffee HICP series stop at 2025-12?

Why. `retail_cpi.json`'s `eu` series ends **2025-12** while the US and Brazil
run to 2026-07, and it has been frozen there across at least two successful
scraper runs (2026-08-16 and 2026-09-01, identical: 121 periods, same last
value). The retail pass-through study (#852) had to demote the euro area to a
robustness check because of it.

The scraper is not obviously broken. `_fetch_eurostat` already tries the
EU27_2020 aggregate, decides it is stale, and falls back to a weighted
DE/FR/IT/ES basket whose whole justification is that member states publish
2-3 weeks after month-end. Both runs took the fallback path — the shipped
series is named "(DE/FR/IT/ES basket proxy)" — and the fallback ALSO ended at
2025-12.

That is the shape worth explaining. Five geos stopping on the same month is not
five independent publication lags, and a lag does not land exactly on a
year boundary. The leading hypothesis is that the request is pinned to a
retired index base: the URL hardcodes `unit=I15` (2015 = 100), and HICP is
rebased on the fives — 2005, 2015, and on this timing 2025 = 100 arriving with
the January 2026 index. If that happened, `I15` legitimately has no data after
2025-12 and the current numbers live under a different `unit` code.

That is a hypothesis, not a finding, and it is exactly the kind that is cheap to
test against the source and expensive to guess at. So this asks Eurostat three
things directly:

  1. WHICH UNITS EXIST for prc_hicp_midx, from the dataflow's own codelist —
     rather than assuming I15 and I25 are the only candidates.
  2. FOR EACH (unit x geo), the first and last period actually returned, so a
     retired base and a genuine publication lag can be told apart: a retired
     base ends on a year boundary for every geo at once; a lag ends raggedly
     and differently per country.
  3. WHETHER THE BASKET'S ALL-FOUR RULE is what truncates it. `_fetch_eurostat_basket`
     keeps only periods present in all of DE/FR/IT/ES, so one laggard country
     silently caps the whole series. Printed per country so that can be ruled
     in or out independently of the unit question.

Read the output before changing the scraper. If a newer base is current, the fix
is to stop hardcoding a base and select the freshest available; if instead every
unit stops at 2025-12, the series really is discontinued at source and the
honest fix is to say so on the chart rather than to keep fetching.

Writes nothing, commits nothing. Run via workflow 0.29 (dispatch-only).

    cd backend && python -m scraper.probe_eurostat_hicp
"""
from __future__ import annotations

import json
import sys
from datetime import date

import requests

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0"
DATAFLOW = "prc_hicp_midx"
COICOP = "CP01211"                       # Coffee, tea and cocoa → Coffee
GEOS = ("EU27_2020", "DE", "FR", "IT", "ES")
#: The unit the scraper hardcodes today, plus the base a 2026 rebase would use.
#: The codelist lookup below supersedes this if it succeeds — these are only the
#: fallback when the structure endpoint is unavailable.
FALLBACK_UNITS = ("I15", "I25", "I05")

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
    "Accept": "application/json",
}


def _get(url: str, timeout: int = 45):
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
    except Exception as e:
        return None, f"request failed: {e}"
    if r.status_code != 200:
        return None, f"HTTP {r.status_code}"
    try:
        return r.json(), None
    except Exception as e:
        return None, f"not JSON: {e}"


def available_units() -> list[str]:
    """Ask the dataflow which unit codes it actually carries.

    Eurostat answers a dimension-only request with the full codelist, so one
    call with no unit filter names every base without downloading the data.
    """
    body, err = _get(f"{BASE}/data/{DATAFLOW}?format=JSON&lang=EN&coicop={COICOP}"
                     f"&geo=DE&lastTimePeriod=1")
    if err:
        print(f"  codelist lookup failed ({err}) — falling back to {FALLBACK_UNITS}")
        return list(FALLBACK_UNITS)
    try:
        cat = body["dimension"]["unit"]["category"]
        labels = cat.get("label") or {}
        codes = list(cat["index"]) if not isinstance(cat["index"], dict) else list(cat["index"].keys())
        for c in codes:
            print(f"    {c:8s} {labels.get(c, '')}")
        # a one-period request pins the unit dimension to whatever was returned,
        # so merge with the fallbacks rather than trusting it to be exhaustive
        return sorted(set(codes) | set(FALLBACK_UNITS))
    except (KeyError, TypeError):
        print(f"  codelist absent from response — falling back to {FALLBACK_UNITS}")
        return list(FALLBACK_UNITS)


def span(unit: str, geo: str) -> tuple[str | None, str | None, int, str | None]:
    """(first, last, n, error) for one unit x geo combination."""
    url = (f"{BASE}/data/{DATAFLOW}?format=JSON&lang=EN"
           f"&unit={unit}&coicop={COICOP}&geo={geo}")
    body, err = _get(url)
    if err:
        return None, None, 0, err
    try:
        idx = body["dimension"]["time"]["category"]["index"]
        values = body["value"]
    except (KeyError, TypeError):
        return None, None, 0, "unexpected JSON-stat shape"
    periods = (sorted(idx, key=lambda p: idx[p]) if isinstance(idx, dict) else list(idx))
    have = [p for i, p in enumerate(periods)
            if (values.get(str(i)) if isinstance(values, dict) else
                (values[i] if i < len(values) else None)) is not None]
    if not have:
        return None, None, 0, "no observations"
    return have[0], have[-1], len(have), None


def months_behind(period: str | None, today: date) -> int | None:
    if not period or len(period) < 7:
        return None
    try:
        y, m = int(period[:4]), int(period[5:7])
    except ValueError:
        return None
    return (today.year - y) * 12 + (today.month - m)


def main() -> int:
    today = date.today()
    print(f"Eurostat {DATAFLOW} / coicop={COICOP} — probe run {today}")
    print("The shipped series ends 2025-12. Scraper hardcodes unit=I15.\n")

    print("1. Units the dataflow carries")
    units = available_units()
    print(f"  probing: {', '.join(units)}\n")

    print("2. First and last observation, per unit x geo")
    print(f"  {'unit':6s} {'geo':10s} {'first':9s} {'last':9s} {'n':>5s}  lag  note")
    grid: dict[str, dict[str, str | None]] = {}
    for unit in units:
        grid[unit] = {}
        for geo in GEOS:
            first, last, n, err = span(unit, geo)
            grid[unit][geo] = last
            lag = months_behind(last, today)
            lag_s = "—" if lag is None else f"{lag:>3d}"
            note = err or ("CURRENT" if lag is not None and lag <= 2 else "")
            print(f"  {unit:6s} {geo:10s} {first or '—':9s} {last or '—':9s} {n:>5d}  {lag_s}  {note}")

    print("\n3. Reading")
    fresh = {u: {g: p for g, p in row.items() if (months_behind(p, today) or 99) <= 2}
             for u, row in grid.items()}
    winners = [u for u, row in fresh.items() if row]
    if winners:
        print("  A current base EXISTS. The series is not discontinued — the scraper is")
        print("  pinned to a retired one. Freshest units and how far they reach:")
        for u in winners:
            print(f"    unit={u}: " + ", ".join(f"{g}→{p}" for g, p in sorted(fresh[u].items())))
        print("  Fix: stop hardcoding unit=I15; pick the freshest base the dataflow offers.")
    else:
        print("  NO unit is current for any geo. Either coffee HICP really did stop at")
        print("  2025-12 at source, or the request shape is wrong in some other way.")
        print("  Do NOT 'fix' the scraper on this evidence — label the chart instead.")

    i15 = grid.get("I15", {})
    ends = {g: p for g, p in i15.items() if p}
    if ends and len(set(ends.values())) == 1:
        print(f"\n  Every geo on I15 ends at the SAME period ({next(iter(set(ends.values())))}).")
        print("  That is a retired base, not five independent publication lags.")
    elif ends:
        print(f"\n  I15 end dates DIFFER by geo: {ends}")
        print("  That is a publication lag. Note the basket keeps only periods present")
        print("  in all four countries, so the earliest of these caps the whole series —")
        print("  which would be a scraper bug independent of the unit question.")

    print("\n4. Raw grid (for the PR)")
    print(json.dumps(grid, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
