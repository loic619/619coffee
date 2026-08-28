"""
probe_port_ids.py — one-shot diagnostic for the PortWatch port ids.

Findings so far (2026-08-27), kept here because they shaped the fix:

  * The ids that still work are NOT mislabelled — port2085 really is Cat Lai,
    port1160 Santos, port1368 Vitoria, port294 Djibouti. The renumbering fear
    is disproven for them; the data on the site is correctly labelled.
  * Seven ids return no rows at all: 183, 218, 881, 514, 1036, 1057, 757.
  * port294 (Djibouti) genuinely has no rows after 2026-02-22 upstream. Our
    file is not truncated — PortWatch simply stopped publishing that port.
  * Name lookups belong in PortWatch_ports_database (small), never in
    Daily_Ports_Data (~2,065 ports x ~2,000 days — it times out).

So the remaining question is only: what are the *current* ids for the ports we
lost, plus the new ones? Listing every port in the relevant countries answers
that without guessing at name spellings or accents.

Writes nothing. Run via workflow 0.22 (dispatch-only), then pin the answers.

    cd backend && python -m scraper.probe_port_ids
"""
from __future__ import annotations

import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.sources.port_activity import _HEADERS, _START_YEAR, PORTS, _get

_ORG = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services"
_PORTS_TABLE = "PortWatch_ports_database"

# Countries whose ports we need ids for, plus the ones already working (cheap to
# confirm). Listing a whole country is a handful of rows and removes all guessing.
_COUNTRIES = ["COL", "IDN", "HND", "GTM", "KEN", "IND", "TZA", "BRA", "VNM", "DJI"]

# What we are looking for in each country, so the output is easy to scan.
_WANTED = {
    "COL": ["BUENAVENTURA", "CARTAGENA"],
    "IDN": ["PANJANG", "PRIOK"],
    "HND": ["CORTES"],
    "GTM": ["QUETZAL"],
    "KEN": ["MOMBASA"],
    "IND": ["MANGALORE", "COCHIN", "KOCHI"],
    "TZA": ["SALAAM"],
    "BRA": ["SANTOS", "VITORIA"],
    "VNM": ["CAT LAI", "CHI MINH"],
    "DJI": ["DJIBOUTI"],
}


def _ascii(s: str) -> str:
    """Fold accents so VITÓRIA matches VITORIA."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s or "")
        if unicodedata.category(c) != "Mn"
    ).upper()


def _fetch(url: str, params: dict, timeout: int = 40) -> dict:
    import requests

    time.sleep(1.0)
    resp = requests.get(url, params=params, headers=_HEADERS, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _ports_in(iso3: str) -> list[tuple[str, str]]:
    url = f"{_ORG}/{_PORTS_TABLE}/FeatureServer/0/query"
    payload = _fetch(url, {
        "where": f"ISO3='{iso3}'",
        "outFields": "portid,portname",
        "returnGeometry": "false",
        "resultRecordCount": 400,
        "f": "json",
    })
    out = []
    for f in payload.get("features", []):
        a = f.get("attributes", {})
        if a.get("portid"):
            out.append((a["portid"], a.get("portname") or ""))
    return sorted(out, key=lambda t: t[1])


def _has_data(portid: str) -> str:
    """Does this id carry daily rows, and through when?"""
    try:
        payload = _get({
            "where": f"portid='{portid}' AND year>={_START_YEAR}",
            "outFields": "year,month,day",
            "orderByFields": "year DESC,month DESC,day DESC",
            "resultRecordCount": 1,
            "returnGeometry": "false",
            "f": "json",
        })
        feats = payload.get("features", [])
        if not feats:
            return "no daily rows"
        a = feats[0]["attributes"]
        return f"latest {int(a['year']):04d}-{int(a['month']):02d}-{int(a['day']):02d}"
    except Exception as e:  # noqa: BLE001
        return f"ERROR {type(e).__name__}"


def _with_daily_data(iso3: str) -> list[tuple[str, str]]:
    """Which ports in this country reported on the latest published day?

    Scoped to ONE day on purpose. A distinct-over-the-year query per country is
    a large scan and times the job out; a single date is a handful of rows and
    answers the same question — who is in the daily table right now, and under
    which portid. If the ids here differ from the ports database, the two tables
    have diverged, which would explain the "missing" ports far better than the
    IMF dropping Tanjung Priok and Mombasa.
    """
    try:
        payload = _get({
            "where": f"ISO3='{iso3}' AND year=2026 AND month=8 AND day=21",
            "outFields": "portid,portname",
            "returnGeometry": "false",
            "resultRecordCount": 200,
            "f": "json",
        })
        seen = {
            (f["attributes"].get("portid"), f["attributes"].get("portname"))
            for f in payload.get("features", [])
            if f.get("attributes", {}).get("portid")
        }
        return sorted(seen, key=lambda t: t[1] or "")
    except Exception as e:  # noqa: BLE001
        return [("ERROR", str(e)[:60])]


def main() -> int:
    # The question that actually matters now: PortWatch dropped daily coverage
    # for most of our ports, so which ports in these countries still have data?
    print("=== ports reporting on 2026-08-21 (the latest published day) ===\n")
    for iso3 in _COUNTRIES:
        rows = _with_daily_data(iso3)
        print(f"{iso3}: {len(rows)} port(s) reporting")
        for p, n in rows:
            print(f"    {p:10} {n}")
        print()

    print(f"=== ports per country from {_PORTS_TABLE} ===\n")
    for iso3 in _COUNTRIES:
        try:
            rows = _ports_in(iso3)
        except Exception as e:  # noqa: BLE001
            print(f"{iso3}: ERROR — {e}\n")
            continue
        wanted = _WANTED.get(iso3, [])
        hits = [(p, n) for p, n in rows if any(w in _ascii(n) for w in wanted)]
        print(f"{iso3}: {len(rows)} ports; matches for {wanted}:")
        if not hits:
            # Show everything so a different spelling is still visible.
            for p, n in rows[:40]:
                print(f"    {p:10} {n}")
        for p, n in hits:
            print(f"  → {p:10} {n:38} {_has_data(p)}")
        print()

    print("=== currently configured ===")
    for spec in PORTS:
        print(f"  {spec['key']:14} {spec.get('portid') or '(unpinned)'}")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
