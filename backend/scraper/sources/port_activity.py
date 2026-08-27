"""
port_activity.py — Weekly scraper for IMF PortWatch port-activity time series.

Source: IMF PortWatch "Daily Port Activity Data and Trade Estimates" (built on
the UN Global Platform AIS feed). Public ArcGIS Feature Service, no auth.

  Daily_Ports_Data/FeatureServer/0
    portid, portname, country, ISO3, year, month, day
    portcalls            — daily vessel-call count ("Arrival of Ships")
    portcalls_<type>     — split by vessel type
    import               — estimated import volume, metric tons ("Incoming Shipment")
    import_<type>        — split by vessel type
    export               — estimated export volume, metric tons ("Outgoing Shipment")
    export_<type>        — split by vessel type
  where <type> ∈ {container, dry_bulk, general_cargo, roro, tanker}

PortWatch refreshes weekly (Tuesdays ~09:00 ET). We track a curated set of
coffee export gateways. To keep page loads light, each port's full series is
written to its own file and a small `index.json` lists the ports (no series);
the Freight page loads the index up front and fetches one port on demand.

Writes → frontend/public/data/port_activity/index.json
         frontend/public/data/port_activity/<key>.json   (one per port)
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from scraper.validate_export import safe_write_json

# Repo layout: backend/scraper/sources/port_activity.py → frontend/public/data
_OUT_DIR = (
    Path(__file__).resolve().parents[3]
    / "frontend" / "public" / "data" / "port_activity"
)

_BASE = (
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/"
    "Daily_Ports_Data/FeatureServer/0/query"
)

# Only fetch from this year forward — keeps the committed JSON to a sane size
# while still covering the 1m/3m/6m/YTD/1y/All zoom levels with multiple years.
_START_YEAR = 2021

# Vessel types as they appear in the field suffixes (and the chart legend).
_TYPES = ["container", "dry_bulk", "general_cargo", "roro", "tanker"]

_METRICS = ["portcalls", "import", "export"]

# date pieces let us build YYYY-MM-DD without epoch/timezone ambiguity.
_FIELDS = ["portid", "portname", "country", "ISO3", "year", "month", "day"]
for _m in _METRICS:
    _FIELDS.append(_m)
    _FIELDS += [f"{_m}_{t}" for t in _TYPES]

_OUT_FIELDS = ",".join(_FIELDS)

# ArcGIS FeatureServers cap each page; paginate with resultOffset.
_PAGE = 2000

# Minimum spacing between requests, and per-request read timeout. See _pace().
_THROTTLE_S = 1.5
_TIMEOUT_S = 60
_last_request = 0.0

# How many passes over the still-failing ports before giving up on a run.
_PASSES = 3

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# Curated coffee export gateways.
#
# `portid` is pinned wherever it is known — resolving by name at runtime is an
# extra network round-trip that can fail and, historically, did: a broken
# resolve wiped ten ports from the site. Ports without a known id give `match`
# (a name substring, or a list of aliases to try in order) + `iso3`, and the id
# is resolved once on the runner; pin it here afterwards.
PORTS: list[dict] = [
    {"key": "hcmc",          "portid": "port2085", "label": "Ho Chi Minh City", "country": "Vietnam",   "note": "Vietnam robusta export gateway (Cat Lai / Saigon New Port)"},
    {"key": "santos",        "portid": "port1160", "label": "Santos",          "country": "Brazil",     "note": "World's largest coffee export port (arabica)"},
    {"key": "vitoria",       "portid": "port1368", "label": "Vitória",         "country": "Brazil",     "note": "Espírito Santo conilon/robusta & arabica export port"},
    {"key": "buenaventura",  "portid": "port183",  "label": "Buenaventura",    "country": "Colombia",   "note": "Colombia's main Pacific coffee export port"},
    {"key": "cartagena_co",  "portid": "port218",  "label": "Cartagena",       "country": "Colombia",   "note": "Colombia Caribbean coffee export port"},
    {"key": "panjang",       "portid": "port881",  "label": "Panjang",         "country": "Indonesia",  "note": "Lampung robusta export port"},
    {"key": "tanjungpriok",  "portid": "port514",  "label": "Tanjung Priok",   "country": "Indonesia",  "note": "Jakarta — Indonesia's largest port"},
    {"key": "cortes",        "portid": "port1036", "label": "Puerto Cortés",   "country": "Honduras",   "note": "Honduras' main coffee export port"},
    {"key": "quetzal",       "portid": "port1057", "label": "Puerto Quetzal",  "country": "Guatemala",  "note": "Guatemala Pacific coffee export port"},
    {"key": "djibouti",      "portid": "port294",  "label": "Djibouti",        "country": "Djibouti",   "note": "Outlet for landlocked Ethiopia's coffee"},
    {"key": "mombasa",       "portid": "port757",  "label": "Mombasa",         "country": "Kenya",      "note": "Main outlet for landlocked Uganda's coffee"},
    # Resolved on first run, then pin the id above.
    {"key": "mangalore",     "match": ["NEW MANGALORE", "MANGALORE"], "iso3": "IND", "label": "New Mangalore", "country": "India",    "note": "Karnataka robusta/arabica — India's main coffee export port"},
    {"key": "kochi",         "match": ["COCHIN", "KOCHI"],            "iso3": "IND", "label": "Kochi",         "country": "India",    "note": "Kerala coffee & spice export port"},
    {"key": "dar",           "match": ["DAR ES SALAAM"],              "iso3": "TZA", "label": "Dar es Salaam", "country": "Tanzania", "note": "Secondary outlet for Uganda/Great-Lakes coffee"},
]


def _pace() -> None:
    """Space out requests. Firing ~45 queries back-to-back gets this service to
    throttle: it starts returning empty pages and then timing out, which reads
    as 'no rows' rather than as an error. Politeness here is load-bearing.
    """
    import time

    global _last_request
    wait = _THROTTLE_S - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()


def _get(params: dict) -> dict:
    """GET the query endpoint with light retries. Raises on persistent failure."""
    import time

    import requests

    last_err: Exception | None = None
    for attempt in range(4):
        try:
            _pace()
            resp = requests.get(_BASE, params=params, headers=_HEADERS, timeout=_TIMEOUT_S)
            # Don't burn retries on permanent client errors (403/404/...) — only
            # transient ones (429 rate-limit, 5xx) and network faults are worth it.
            if resp.status_code in (400, 401, 403, 404, 410):
                resp.raise_for_status()
            resp.raise_for_status()
            payload = resp.json()
            if "error" in payload:
                raise RuntimeError(f"ArcGIS error: {payload['error']}")
            return payload
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else None
            if code in (400, 401, 403, 404, 410):
                raise
            last_err = e
            time.sleep(2 ** attempt)
        except Exception as e:  # noqa: BLE001 — network/JSON faults: retry
            last_err = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"request failed after retries: {last_err}")


def _resolve_portid(match: str | list[str], iso3: str) -> tuple[str, str] | None:
    """Resolve a (portid, portname) for a name substring within a country.

    `match` may be a list of aliases, tried in order, so a port that PortWatch
    spells differently than we do ('COCHIN' vs 'KOCHI') still resolves.

    Picks the candidate with the highest recent activity when several match,
    so 'SANTOS' resolves to the main port rather than a tiny berth.
    """
    for alias in [match] if isinstance(match, str) else match:
        found = _resolve_one(alias, iso3)
        if found:
            return found
    return None


def _resolve_one(match: str, iso3: str) -> tuple[str, str] | None:
    where = f"UPPER(portname) LIKE '%{match.upper()}%' AND ISO3='{iso3}'"
    payload = _get({
        "where": where,
        "outFields": "portid,portname",
        "returnDistinctValues": "true",
        # ArcGIS rejects returnDistinctValues unless geometry is off. Omitting
        # this is what broke every name-resolved port and emptied the site.
        "returnGeometry": "false",
        "f": "json",
    })
    feats = payload.get("features", [])
    cands = [
        (f["attributes"]["portid"], f["attributes"]["portname"])
        for f in feats
        if f.get("attributes", {}).get("portid")
    ]
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0]

    # Disambiguate by total recent port calls (busiest = the one we want).
    best, best_calls = cands[0], -1.0
    for portid, portname in cands:
        agg = _get({
            "where": f"portid='{portid}' AND year>={_START_YEAR}",
            "outStatistics": json.dumps([{
                "statisticType": "sum",
                "onStatisticField": "portcalls",
                "outStatisticFieldName": "tc",
            }]),
            "f": "json",
        })
        tc = (agg.get("features") or [{}])[0].get("attributes", {}).get("tc") or 0
        if tc > best_calls:
            best, best_calls = (portid, portname), tc
    return best


def _fetch_series(portid: str) -> list[dict]:
    """Fetch the full (windowed) daily series for one portid, paginated.

    PortWatch's FeatureServer caps each page at its own maxRecordCount (1000),
    which can be smaller than what we request — so we page until the server
    stops setting `exceededTransferLimit`, advancing by the rows it actually
    returns (never by the requested page size).

    Raises if the server promised more rows and then returned an empty page:
    under throttling that looked like a clean finish and silently wrote a
    truncated series (Djibouti once published 6 months short this way).
    """
    rows: list[dict] = []
    offset = 0
    more_expected = False
    while True:
        payload = _get({
            "where": f"portid='{portid}' AND year>={_START_YEAR}",
            "outFields": _OUT_FIELDS,
            "orderByFields": "year,month,day",
            "resultOffset": offset,
            "resultRecordCount": _PAGE,
            "returnGeometry": "false",
            "f": "json",
        })
        feats = payload.get("features", [])
        if not feats:
            if more_expected:
                raise RuntimeError(
                    f"truncated at {len(rows)} rows: server set exceededTransferLimit "
                    "then returned an empty page (throttled?)"
                )
            break
        for f in feats:
            a = f.get("attributes", {})
            if a.get("year") is None:
                continue
            point = {"date": f"{int(a['year']):04d}-{int(a['month']):02d}-{int(a['day']):02d}"}
            for m in _METRICS:
                point[m] = _num(a.get(m))
                for t in _TYPES:
                    point[f"{m}_{t}"] = _num(a.get(f"{m}_{t}"))
            rows.append(point)
        offset += len(feats)
        more_expected = bool(payload.get("exceededTransferLimit", False))
        if not more_expected:
            break
    return rows


def _num(v) -> float | int:
    """Round to trim JSON size; ints stay ints (port-call counts)."""
    if v is None:
        return 0
    f = round(float(v), 1)
    return int(f) if f.is_integer() else f


def _write_json(path: Path, obj) -> None:
    safe_write_json(path, obj, indent=None, separators=(",", ":"))


def _fetch_pass(specs: list[dict], fresh: dict[str, dict]) -> list[dict]:
    """Fetch one pass over `specs`, writing each success into `fresh` and its
    per-port file. Returns the specs that still need retrying.
    """
    still: list[dict] = []
    for spec in specs:
        key = spec["key"]
        try:
            portid = spec.get("portid")
            portname = None
            if not portid:
                resolved = _resolve_portid(spec["match"], spec["iso3"])
                if not resolved:
                    print(f"[port_activity] {key}: no portid match for "
                          f"{spec['match']} / {spec['iso3']}")
                    still.append(spec)
                    continue
                portid, portname = resolved
                print(f"[port_activity] {key}: resolved → {portid} ({portname}) "
                      f"— pin this id in PORTS")

            series = _fetch_series(portid)
            if not series:
                # Usually throttling rather than a genuinely empty port, so this
                # is retried rather than silently accepted as "no data".
                print(f"[port_activity] {key} ({portid}): no rows")
                still.append(spec)
                continue

            meta = {
                "key": key,
                "portid": portid,
                "name": portname or spec["label"],
                "label": spec["label"],
                "country": spec["country"],
                "note": spec["note"],
                "start": series[0]["date"],
                "end": series[-1]["date"],
            }
            fresh[key] = meta

            _OUT_DIR.mkdir(parents=True, exist_ok=True)
            _write_json(_OUT_DIR / f"{key}.json", {**meta, "vessel_types": _TYPES, "series": series})
            print(f"[port_activity] {key} ({portid}): {len(series)} days "
                  f"{series[0]['date']}→{series[-1]['date']}")
        except Exception as e:  # noqa: BLE001 — one port must not sink the rest
            print(f"[port_activity] {key}: ERROR — {e}")
            still.append(spec)
    return still


def run() -> dict | None:
    """Fetch all configured ports and write per-port files + an index.

    Each port → `<key>.json` (metadata + series); `index.json` lists the ports
    without their series. Returns the index payload (None if nothing fetched).
    """
    import time

    fresh: dict[str, dict] = {}   # key → meta, fetched successfully this run
    pending = list(PORTS)
    for attempt in range(_PASSES):
        if not pending:
            break
        if attempt:
            # Throttling is the usual reason a port fails, so back off and let
            # the service recover rather than losing the port for a whole week.
            pause = 60 * attempt
            print(f"[port_activity] retrying {len(pending)} port(s) in {pause}s "
                  f"(pass {attempt + 1}/{_PASSES})")
            time.sleep(pause)
        pending = _fetch_pass(pending, fresh)
    failed = [s["key"] for s in pending]

    if not fresh:
        print("[port_activity] No ports fetched — retaining existing files")
        return None

    # A port that failed this run keeps the data it already has: reuse its
    # previous index entry so a transient outage can't drop it from the site.
    # (Deleting on failure is what silently emptied the port list before.)
    previous = {}
    try:
        prior = json.loads((_OUT_DIR / "index.json").read_text(encoding="utf-8"))
        previous = {p["key"]: p for p in prior.get("ports", [])}
    except Exception:  # noqa: BLE001 — no/unreadable index is fine on first run
        pass

    index_ports, retained = [], []
    for spec in PORTS:  # config order, so the dropdown is stable
        key = spec["key"]
        if key in fresh:
            index_ports.append(fresh[key])
        elif key in previous and (_OUT_DIR / f"{key}.json").exists():
            index_ports.append(previous[key])
            retained.append(key)

    index = {
        "updated": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": "IMF PortWatch (UN Global Platform; PortWatch)",
        "dataset": "Daily Port Activity Data and Trade Estimates",
        "metrics": {
            "portcalls": "Daily vessel-call count (Arrival of Ships)",
            "import": "Estimated import volume, metric tons (Incoming Shipment)",
            "export": "Estimated export volume, metric tons (Outgoing Shipment)",
        },
        "vessel_types": _TYPES,
        "ports": index_ports,
    }

    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    _write_json(_OUT_DIR / "index.json", index)

    # Prune only files whose port was deliberately removed from PORTS — never
    # because a fetch failed, which would delete good data on a transient error.
    keep = {f"{s['key']}.json" for s in PORTS} | {"index.json"}
    for old in _OUT_DIR.glob("*.json"):
        if old.name not in keep:
            old.unlink()
            print(f"[port_activity] removed de-configured {old.name}")

    if retained:
        print(f"[port_activity] WARNING retained previous data for: {', '.join(retained)}")
    if failed:
        print(f"[port_activity] WARNING {len(failed)} port(s) failed: {', '.join(failed)}")
    print(f"[port_activity] wrote {len(fresh)} fresh, {len(index_ports)} total → {_OUT_DIR}")
    return index


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    run()
