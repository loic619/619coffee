"""
treasury_yields.py — US Treasury par yield curve (daily), from Treasury itself.

Source: home.treasury.gov "Daily Treasury Par Yield Curve Rates" XML feed
    .../interest-rates/pages/xml?data=daily_treasury_yield_curve
             &field_tdr_date_value=YYYY
No key, no rate limit, no Cloudflare — it is the issuer publishing its own
curve, so there is no vendor to be blocked by.

Why not Stooq, which is how DXY is fetched: it has no Treasury yield symbols.
Probe run 32826670610 tried 10usy.b / 2usy.b / 5usy.b / 30usy.b / 3musy.b /
1usy.b / 7usy.b / 20usy.b / 6musy.b and then 10usy / 10usy.c / tnx.us / ^tnx /
10ustreas — every one returned HTTP 200 with Stooq's HTML shell rather than
CSV. The same probe got 250,963 bytes of valid XML from Treasury on the first
try.

Why coffee cares: the curve is the cleanest read on where the Fed is going, and
the front end of it drives the dollar. A dollar move reprices every producer
currency in the CCI, and through that the arabica/robusta complex — the same
channel the CCI exporter weights already model. 2s10s is carried because the
slope, not the level, is what shifts risk appetite across commodities.

Schema note: the feed is an Atom envelope whose entries carry
<m:properties> with <d:NEW_DATE> and one <d:BC_*> element per tenor. Tenor
names are NOT hardcoded here — every BC_* child is read generically, so a
tenor Treasury adds or renames cannot silently drop a column or crash the
parse.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime

import requests

_URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        "pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value={year}")
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

# BC_1MONTH -> "1m", BC_10YEAR -> "10y". Ordering for display comes from _ORDER.
_TENOR_RX = re.compile(r"^BC_(\d+)(MONTH|YEAR)$", re.I)
_ORDER = ["1m", "2m", "3m", "4m", "6m", "1y", "2y", "3y", "5y", "7y", "10y", "20y", "30y"]


def _localname(tag: str) -> str:
    """'{namespace}BC_10YEAR' -> 'BC_10YEAR'."""
    return tag.rsplit("}", 1)[-1]


def _tenor_key(field: str) -> str | None:
    m = _TENOR_RX.match(field)
    if not m:
        return None
    n, unit = m.group(1), m.group(2).upper()
    return f"{int(n)}{'m' if unit == 'MONTH' else 'y'}"


def parse_curve(xml_text: str) -> list[dict]:
    """Return [{date, yields:{tenor: pct}}] sorted by date, oldest first."""
    root = ET.fromstring(xml_text)
    rows: list[dict] = []
    for props in root.iter():
        if _localname(props.tag) != "properties":
            continue
        day: str | None = None
        ys: dict[str, float] = {}
        for child in props:
            name = _localname(child.tag)
            text = (child.text or "").strip()
            if name == "NEW_DATE":
                day = text[:10] or None
            elif (key := _tenor_key(name)) and text:
                try:
                    ys[key] = float(text)
                except ValueError:
                    continue
        if day and ys:
            rows.append({"date": day, "yields": ys})
    rows.sort(key=lambda r: r["date"])
    return rows


def _spread(ys: dict, a: str, b: str) -> float | None:
    """b − a in basis points, when both legs are present."""
    if ys.get(a) is None or ys.get(b) is None:
        return None
    return round((ys[b] - ys[a]) * 100, 1)


# Below this many merged sessions the series is too short to chart a year of
# curve history, so the prior year is pulled in to top it up.
_MIN_SESSIONS = 250


def _fetch_year(y: int) -> list[dict]:
    try:
        r = requests.get(_URL.format(year=y), headers=_HEADERS, timeout=(8, 60))
        r.raise_for_status()
        got = parse_curve(r.text)
        print(f"  [treasury] {y}: {len(got)} sessions")
        return got
    except Exception as e:  # noqa: BLE001 — one bad year must not lose the other
        print(f"  [treasury] {y}: FAILED ({type(e).__name__}): {e}")
        return []


def fetch_curve(existing: list[dict] | None = None) -> dict | None:
    """Fetch the current year, merged over `existing` history.

    Fetching both years unconditionally cost 37.4 s — 41.6% of the whole static
    export on the first live run, making this the slowest topic in the job by a
    wide margin. The prior year never changes once it is published, so it is
    pulled only when the merged series is still short: the first run and early
    January take two requests, every other run takes one.

    `existing` is the previously shipped history (the exporter passes it in);
    keeping it here rather than reading the file keeps this module free of any
    knowledge of the export layout.
    """
    this_year = date.today().year
    fresh = _fetch_year(this_year)

    # Carrying history forward changed what a dead feed looks like. It used to
    # leave `rows` empty, so this returned None and the exporter kept the file
    # untouched; now the carried rows alone would satisfy every downstream
    # check and the curve would be rewritten daily with a fresh scraped_at over
    # unchanged data — a feed outage committed as if it were a good run. If the
    # current year gave us nothing and we already had history, the run learned
    # nothing, so say so. A cold start still proceeds: there the prior-year
    # top-up below is real new information rather than a repeat of the file.
    if not fresh and existing:
        print("  [treasury] current year returned nothing — keeping the shipped history")
        return None

    rows: list[dict] = list(existing or [])
    rows.extend(fresh)

    if len({r["date"] for r in rows}) < _MIN_SESSIONS:
        print(f"  [treasury] merged series short (<{_MIN_SESSIONS}) — adding {this_year - 1}")
        rows.extend(_fetch_year(this_year - 1))

    if not rows:
        return None

    # Dedupe on date; a freshly fetched row supersedes a carried-over one
    # because it is appended later (Treasury does revise same-day prints).
    by_date = {r["date"]: r for r in rows}
    hist = [by_date[d] for d in sorted(by_date)]
    latest = hist[-1]
    ys = latest["yields"]
    return {
        "scraped_at":   datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "source":       "US Treasury — Daily Treasury Par Yield Curve Rates",
        "url":          "https://home.treasury.gov/interest-rates-data-csv-archive",
        "unit":         "percent_per_annum",
        "tenor_order":  [t for t in _ORDER if t in ys],
        "latest": {
            "date":         latest["date"],
            "yields":       ys,
            "spread_2s10s": _spread(ys, "2y", "10y"),
            "spread_3m10y": _spread(ys, "3m", "10y"),
        },
        "history": hist[-500:],
    }
