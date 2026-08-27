"""
probe_port_ids.py — one-shot diagnostic for the PortWatch port ids.

Why this exists: after 2026-08 the ids pinned in port_activity.PORTS stopped
returning rows for most ports, while a fresh name lookup resolved New Mangalore
to port811 — an id that used to belong to Panjang. That points at PortWatch
renumbering, which is dangerous in both directions: a pinned id can go empty
(port disappears from the site) or silently point at a *different* port (wrong
data under the right label).

The first version of this probe looked names up in Daily_Ports_Data and timed
out: a LIKE over ~2,065 ports x ~2,000 days per port is far too slow. That is
also why kochi/dar "failed to resolve" in the scraper. So this version:

  1. lists the ArcGIS services in the org folder, to find the small *ports
     reference* table (~2,065 rows) rather than guessing its name, and
  2. checks each pinned id by equality against the daily table, which is fast
     and indexed — that is what tells us if an id is empty or mislabelled.

Writes nothing. Run via workflow 0.22 (dispatch-only), then pin the answers.

    cd backend && python -m scraper.probe_port_ids
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.sources.port_activity import PORTS, _HEADERS, _START_YEAR, _get

_ORG = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services"


def _fetch(url: str, params: dict, timeout: int = 40) -> dict:
    import requests

    time.sleep(1.0)  # be polite; this service throttles bursts
    resp = requests.get(url, params=params, headers=_HEADERS, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _list_services() -> list[str]:
    """Names of every service in the org folder — finds the ports table."""
    try:
        payload = _fetch(_ORG, {"f": "json"})
        return [s.get("name", "") for s in payload.get("services", [])]
    except Exception as e:  # noqa: BLE001
        print(f"  services directory unreadable: {e}")
        return []


def _pinned_identity(portid: str) -> str:
    """What is this id today? Equality on portid is indexed, so this is fast."""
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
            return "EMPTY — no rows (stale or wrong id)"
        a = feats[0]["attributes"]
        latest = f"{int(a['year']):04d}-{int(a['month']):02d}-{int(a['day']):02d}"
        return f"{a.get('portname')} / {a.get('country')} ({a.get('ISO3')}) — latest {latest}"
    except Exception as e:  # noqa: BLE001
        return f"ERROR — {e}"


def _lookup_in_ports_table(service: str, token: str, iso3: str) -> str:
    """Name lookup against the small ports reference table (fast)."""
    url = f"{_ORG}/{service}/FeatureServer/0/query"
    try:
        payload = _fetch(url, {
            "where": f"UPPER(portname) LIKE '%{token}%' AND ISO3='{iso3}'",
            "outFields": "portid,portname,country,ISO3",
            "returnGeometry": "false",
            "f": "json",
        })
        hits = [
            (f["attributes"].get("portid"), f["attributes"].get("portname"))
            for f in payload.get("features", [])
        ]
        if not hits:
            return f"no match for %{token}%/{iso3}"
        return ", ".join(f"{p}={n}" for p, n in hits[:6])
    except Exception as e:  # noqa: BLE001
        return f"ERROR — {type(e).__name__}"


def main() -> int:
    print("=== services in the org folder ===")
    services = _list_services()
    for name in services:
        print(f"  {name}")
    # Anything that looks like the static port list rather than the daily table.
    candidates = [s for s in services if "port" in s.lower() and "daily" not in s.lower()]
    print(f"\nports-table candidates: {candidates or 'none found'}\n")

    iso_by_country = {
        "Vietnam": "VNM", "Brazil": "BRA", "Colombia": "COL", "Indonesia": "IDN",
        "Honduras": "HND", "Guatemala": "GTM", "Djibouti": "DJI", "Kenya": "KEN",
        "India": "IND", "Tanzania": "TZA",
    }

    print("=== what each pinned id actually is today ===")
    print(f"{'key':14} {'pinned':10} identity")
    for spec in PORTS:
        pinned = spec.get("portid")
        identity = _pinned_identity(pinned) if pinned else "(not pinned)"
        print(f"{spec['key']:14} {pinned or '-':10} {identity}")

    if candidates:
        service = candidates[0]
        print(f"\n=== name lookups in '{service}' ===")
        for spec in PORTS:
            iso3 = spec.get("iso3") or iso_by_country.get(spec["country"], "")
            token = spec["label"].upper().split()[-1]
            print(f"{spec['key']:14} {token:12} {iso3:4} "
                  f"{_lookup_in_ports_table(service, token, iso3)}")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
