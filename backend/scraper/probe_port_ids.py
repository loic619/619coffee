"""
probe_port_ids.py — one-shot diagnostic for the PortWatch port ids.

Why this exists: after 2026-08 the ids pinned in port_activity.PORTS stopped
returning rows for most ports, while a fresh name lookup resolved New Mangalore
to port811 — an id that used to belong to Panjang. That points at PortWatch
renumbering, which is dangerous in both directions: a pinned id can go empty
(port disappears from the site) or silently point at a *different* port (wrong
data under the right label).

This answers two questions per configured port, cheaply and without writing
anything:
  1. What does the currently pinned id actually resolve to now (portname/country,
     row count, latest date)?
  2. What id(s) does the port's *name* resolve to today?

Run via workflow 0.22 (dispatch-only), then pin the answers in PORTS.

    cd backend && python -m scraper.probe_port_ids
"""
from __future__ import annotations

import sys

sys.path.insert(0, __file__.rsplit("/", 2)[0])

from scraper.sources.port_activity import PORTS, _get, _START_YEAR


def _pinned_identity(portid: str) -> str:
    """What is this id today? Name/country plus how much data it holds."""
    try:
        payload = _get({
            "where": f"portid='{portid}' AND year>={_START_YEAR}",
            "outFields": "portid,portname,country,ISO3,year,month,day",
            "orderByFields": "year DESC,month DESC,day DESC",
            "resultRecordCount": 1,
            "returnGeometry": "false",
            "f": "json",
        })
        feats = payload.get("features", [])
        if not feats:
            return "EMPTY — no rows (id is stale or wrong)"
        a = feats[0]["attributes"]
        latest = f"{int(a['year']):04d}-{int(a['month']):02d}-{int(a['day']):02d}"
        return f"{a.get('portname')} / {a.get('country')} ({a.get('ISO3')}) — latest {latest}"
    except Exception as e:  # noqa: BLE001
        return f"ERROR — {e}"


def _by_name(label: str, iso3: str) -> str:
    """What does a name lookup return today? The authoritative answer."""
    token = label.upper().split()[-1]  # last word: 'New Mangalore' -> 'MANGALORE'
    try:
        payload = _get({
            "where": f"UPPER(portname) LIKE '%{token}%' AND ISO3='{iso3}'",
            "outFields": "portid,portname",
            "returnDistinctValues": "true",
            "returnGeometry": "false",
            "f": "json",
        })
        hits = {
            (f["attributes"]["portid"], f["attributes"]["portname"])
            for f in payload.get("features", [])
            if f.get("attributes", {}).get("portid")
        }
        if not hits:
            return f"no match for '%{token}%' / {iso3}"
        return ", ".join(f"{pid}={name}" for pid, name in sorted(hits))
    except Exception as e:  # noqa: BLE001
        return f"ERROR — {e}"


def main() -> int:
    # ISO3 is needed for the name lookup; pinned entries don't carry one, so map
    # from the display country. Kept local to the probe — throwaway diagnostic.
    iso_by_country = {
        "Vietnam": "VNM", "Brazil": "BRA", "Colombia": "COL", "Indonesia": "IDN",
        "Honduras": "HND", "Guatemala": "GTM", "Djibouti": "DJI", "Kenya": "KEN",
        "India": "IND", "Tanzania": "TZA",
    }
    print(f"{'key':14} {'pinned':10} {'what that id is now':58} name lookup")
    print("-" * 150)
    for spec in PORTS:
        pinned = spec.get("portid")
        iso3 = spec.get("iso3") or iso_by_country.get(spec["country"], "")
        identity = _pinned_identity(pinned) if pinned else "(not pinned)"
        lookup = _by_name(spec["label"], iso3) if iso3 else "(no ISO3)"
        print(f"{spec['key']:14} {pinned or '-':10} {identity:58} {lookup}")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
