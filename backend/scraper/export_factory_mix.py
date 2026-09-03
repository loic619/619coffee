"""
export_factory_mix.py
Reads backend/seed/factories.json and writes frontend/public/data/factory_mix.json
with consumer-side capacity aggregated by world region × factory type.

Used by the demand tab's "Global Roasting Mix" panel to show structural shape of
green-coffee end-product demand (roasted vs soluble vs capsules vs decaf).

Region classification is bbox-based on lat/lng (rough but visually fine).
Mills are excluded — they're origin processing, not consumer-side capacity.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from scraper.validate_export import safe_write_json

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "backend" / "seed" / "factories.json"
OUT  = ROOT / "frontend" / "public" / "data" / "factory_mix.json"

# Consumer-side types only — mill is origin processing, not demand structure
_CONSUMER_TYPES = ("roastery", "soluble", "capsules", "decaf", "mixed")

# Region is looked up from the plant's COUNTRY, carried as an ISO-3166-1
# alpha-2 `cc` on every row of the seed. It used to be inferred from
# overlapping lat/lng boxes returning the first match, which put the Levant and
# western Arabia in Africa, Algeria and Tunisia in Europe, Papua New Guinea in
# Asia, and split Honduras and Mexico across two regions apiece. Rectangles do
# not have the shape of countries and never will; the `cc` values were derived
# once by point-in-polygon against Natural Earth boundaries and are now data.
#
# "Latin America" sits alongside "North America" here, and Guatemala, Honduras,
# Costa Rica, Nicaragua, El Salvador and Panama are all in it despite being
# continentally North American — so this axis is the Latin/Anglo split, not the
# continental one, and Mexico belongs on the Latin side with them.
_COUNTRY_REGION: dict[str, str] = {
    # Africa — including the Maghreb and Egypt, which are African whatever
    # their trade ties. The Middle East below is a separate axis.
    **dict.fromkeys(
        ["BI", "CD", "CI", "CM", "DZ", "EG", "ET", "KE", "MA", "MG", "MW",
         "RW", "SN", "ST", "TN", "TZ", "UG", "ZA", "ZM"], "Africa"),
    # Asia — Central Asia included; Turkey and the Caucasus are under Europe.
    **dict.fromkeys(
        ["BD", "CN", "HK", "ID", "IN", "JP", "KR", "KZ", "LA", "MM", "MY",
         "PH", "PK", "TH", "TW", "UZ", "VN"], "Asia"),
    **dict.fromkeys(
        ["AL", "AM", "AT", "BE", "BG", "BY", "CH", "DE", "DK", "EE", "ES",
         "FI", "FR", "GB", "GE", "GR", "HR", "HU", "IT", "NL", "NO", "PL",
         "PT", "RO", "RS", "RU", "SE", "TR", "UA"], "Europe"),
    **dict.fromkeys(
        ["BO", "BR", "CO", "CR", "EC", "GT", "HN", "MX", "NI", "PA", "PE",
         "SV"], "Latin America"),
    **dict.fromkeys(["AE", "IL", "IR", "LB", "SA", "YE"], "Middle East"),
    **dict.fromkeys(["CA", "US"], "North America"),
    **dict.fromkeys(["AU", "NZ", "PG"], "Oceania"),
}

# Display order for the chart; also the set of regions considered valid.
_REGION_ORDER = [
    "Europe", "North America", "Asia", "Latin America",
    "Africa", "Middle East", "Oceania",
]


def _region_for(entry: dict) -> str:
    """Region for one seed row, or "Other" if it cannot be determined.

    Never guesses from coordinates. A plant added without a `cc`, or with a
    country this map has not been told about, lands in "Other" and is named on
    stderr — visible, rather than quietly padding whichever region a rectangle
    happened to cover.
    """
    cc = (entry.get("cc") or "").upper()
    if not cc:
        print(f"  [factory_mix] WARNING: no cc on {entry.get('n')!r} -> Other")
        return "Other"
    region = _COUNTRY_REGION.get(cc)
    if region is None:
        print(f"  [factory_mix] WARNING: country {cc} unmapped "
              f"({entry.get('n')!r}) -> Other; add it to _COUNTRY_REGION")
        return "Other"
    return region


# Countries the classification must place correctly, including every case the
# old bounding boxes got wrong. Cheap, and it fails at export time rather than
# shipping a chart that quietly moves a continent.
_REGION_FIXTURES = [
    ("IL", "Middle East"), ("LB", "Middle East"), ("SA", "Middle East"),
    ("IR", "Middle East"), ("AE", "Middle East"), ("YE", "Middle East"),
    ("EG", "Africa"), ("DZ", "Africa"), ("TN", "Africa"), ("MA", "Africa"),
    ("ET", "Africa"), ("KE", "Africa"),
    ("TR", "Europe"), ("AM", "Europe"), ("GE", "Europe"), ("RU", "Europe"),
    ("MX", "Latin America"), ("HN", "Latin America"), ("BR", "Latin America"),
    ("US", "North America"), ("CA", "North America"),
    ("PG", "Oceania"), ("AU", "Oceania"),
]


def _assert_region_sanity() -> None:
    bad = [(cc, exp, _COUNTRY_REGION.get(cc))
           for cc, exp in _REGION_FIXTURES if _COUNTRY_REGION.get(cc) != exp]
    if bad:
        raise AssertionError(
            "region classification regressed: "
            + "; ".join(f"{cc} expected {exp}, got {got}" for cc, exp, got in bad))
    stray = sorted(set(_COUNTRY_REGION.values()) - set(_REGION_ORDER))
    if stray:
        raise AssertionError(f"regions missing from _REGION_ORDER: {stray}")


def _parse_cap_kt(entry: dict) -> float | None:
    """Pull a numeric kt value from the 'cap' string. Returns None if absent/unparseable."""
    cap = entry.get("cap") or ""
    if not cap:
        return None
    # Format examples: "200k", "200k, notes", "1.5 Mt/yr ..."
    token = cap.strip().split(",")[0].split()[0].lower()
    try:
        if token.endswith("k"):
            return float(token[:-1])
        if token.endswith("m") or token.endswith("mt"):
            return float(token.rstrip("mt")) * 1000.0
        return float(token)
    except ValueError:
        return None


def export_factory_mix() -> None:
    _assert_region_sanity()
    data = json.loads(SEED.read_text(encoding="utf-8"))
    factories = data.get("factories", [])

    region_buckets: dict[str, dict[str, float]] = {}
    global_by_type: dict[str, float] = {t: 0.0 for t in _CONSUMER_TYPES}

    for f in factories:
        t = f.get("t")
        if t not in _CONSUMER_TYPES:
            continue
        loc = f.get("l") or []
        if len(loc) != 2:
            continue
        kt = _parse_cap_kt(f)
        if kt is None or kt <= 0:
            continue
        region = _region_for(f)
        region_buckets.setdefault(region, {t_: 0.0 for t_ in _CONSUMER_TYPES})
        region_buckets[region][t] = region_buckets[region].get(t, 0.0) + kt
        global_by_type[t] = global_by_type.get(t, 0.0) + kt

    regions_out = []
    for name in _REGION_ORDER + ["Other"]:
        if name not in region_buckets:
            continue
        by_type = region_buckets[name]
        total = sum(by_type.values())
        if total <= 0:
            continue
        regions_out.append({
            "name":     name,
            "total_kt": round(total, 1),
            "by_type":  {k: round(v, 1) for k, v in by_type.items()},
        })

    # Sort by total desc so the chart reads largest-region-first
    regions_out.sort(key=lambda r: -r["total_kt"])

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source":       "backend/seed/factories.json",
        "note":         "Consumer-side capacity only (mills excluded). Capacity in kilo-tonnes/year, parsed best-effort.",
        "total_kt":     round(sum(global_by_type.values()), 1),
        "global_by_type": {k: round(v, 1) for k, v in global_by_type.items()},
        "regions":      regions_out,
    }

    safe_write_json(OUT, payload, ensure_ascii=False)
    print(
        f"  factory_mix.json -> "
        f"{len(regions_out)} regions, "
        f"{round(payload['total_kt']):,} kt total consumer capacity"
    )


if __name__ == "__main__":
    export_factory_mix()
