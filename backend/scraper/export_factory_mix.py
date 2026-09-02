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

# Bbox classification: (lat_min, lat_max, lng_min, lng_max)
#
# These boxes OVERLAP and the first match wins, so their order is load-bearing.
# Africa (-35..37, -20..55) and a single Middle East box (12..42, 25..65) shared
# a lat 12-37 x lng 25-55 corner covering the Levant and western Arabia, and
# Africa was tested first — so Israel, Lebanon, Saudi Arabia and Iran were all
# roasting "in Africa". The chart read Middle East 26 kt against Africa 277 kt;
# only Dubai and Mashhad survived, purely because they sit east of Africa's
# longitude-55 edge.
#
# Simply reordering the two does NOT fix it: Africa's box legitimately contains
# Egypt, whose five plants (54.5 kt, Cairo and Alexandria) would then be
# reported in the Middle East instead. Egypt is in Africa, and no single
# rectangle separates it from Israel — they are 3 degrees of longitude apart.
#
# So the Middle East is defined as its actual country clusters and tested
# first. Turkey, Armenia and Georgia are deliberately NOT included and stay in
# Europe, matching the chart's other regions being continents. Each box is
# bounded to keep the Horn of Africa out; _assert_region_sanity() below pins
# that, because a bbox edge is exactly the kind of thing that silently drifts.
# The Red Sea seam moves east as you go south — Jeddah sits at lng 39.3 while
# Eritrea reaches 43.3 — so the peninsula needs two latitude bands. A single
# box either drops Jeddah into Africa or drags Eritrea into the Middle East.
_MIDDLE_EAST = [
    ("Levant + Iraq",       ( 29.0,  37.5,   34.2,   48.8)),
    ("Arabia (north)",      ( 20.0,  32.5,   38.5,   60.0)),
    ("Arabia (south)",      ( 12.0,  20.0,   43.0,   60.0)),
    ("Iran",                ( 25.0,  40.0,   44.0,   63.5)),
]

_REGIONS = [
    ("North America",  ( 15.0,  72.0, -170.0,  -50.0)),
    ("Latin America",  (-56.0,  15.0, -120.0,  -30.0)),
    ("Europe",         ( 34.0,  72.0,  -25.0,   45.0)),
    ("Africa",         (-35.0,  37.0,  -20.0,   55.0)),
    ("Middle East",    ( 12.0,  42.0,   25.0,   65.0)),
    ("Asia",           (-12.0,  55.0,   60.0,  150.0)),
    ("Oceania",        (-50.0, -10.0,  110.0,  180.0)),
]


def _region_for(lat: float, lng: float) -> str:
    # Middle East first: it is the only non-continental region here, so it is
    # the specific case that the broad continental boxes would otherwise eat.
    for _cluster, (la_min, la_max, ln_min, ln_max) in _MIDDLE_EAST:
        if la_min <= lat <= la_max and ln_min <= lng <= ln_max:
            return "Middle East"
    for name, (la_min, la_max, ln_min, ln_max) in _REGIONS:
        if la_min <= lat <= la_max and ln_min <= lng <= ln_max:
            return name
    return "Other"


# Reference points the classification must get right. Cheap, and it fails loudly
# at export time rather than shipping a chart that quietly moves a continent.
_REGION_FIXTURES = [
    # (label, lat, lng, expected)
    ("Tel Aviv (IL)",     31.936,  34.908, "Middle East"),
    ("Beirut (LB)",       33.876,  35.549, "Middle East"),
    ("Jeddah (SA)",       21.436,  39.261, "Middle East"),
    ("Riyadh (SA)",       24.538,  46.852, "Middle East"),
    ("Tehran (IR)",       35.340,  51.215, "Middle East"),
    ("Dubai (AE)",        25.000,  55.140, "Middle East"),
    # Africa keeps North Africa and the Horn.
    ("Cairo (EG)",        30.044,  31.236, "Africa"),
    ("Alexandria (EG)",   31.200,  29.919, "Africa"),
    ("Addis Ababa (ET)",   9.030,  38.740, "Africa"),
    ("Asmara (ER)",       15.339,  38.932, "Africa"),
    ("Nairobi (KE)",      -1.286,  36.817, "Africa"),
    ("Port Sudan (SD)",   19.617,  37.216, "Africa"),
    ("Djibouti (DJ)",     11.588,  43.145, "Africa"),
    # Yemen is Middle East despite sitting south and west of most of Arabia.
    ("Sana'a (YE)",       15.359,  44.205, "Middle East"),
    ("Mokha (YE)",        13.314,  43.243, "Middle East"),
    # Europe keeps Turkey and the Caucasus.
    ("Istanbul (TR)",     41.012,  29.176, "Europe"),
    ("Yerevan (AM)",      40.180,  44.510, "Europe"),
    ("Tbilisi (GE)",      41.710,  44.820, "Europe"),
]


def _assert_region_sanity() -> None:
    bad = [(lbl, exp, _region_for(la, ln))
           for lbl, la, ln, exp in _REGION_FIXTURES if _region_for(la, ln) != exp]
    if bad:
        raise AssertionError(
            "region classification regressed: "
            + "; ".join(f"{lbl} expected {exp}, got {got}" for lbl, exp, got in bad))


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
        region = _region_for(loc[0], loc[1])
        region_buckets.setdefault(region, {t_: 0.0 for t_ in _CONSUMER_TYPES})
        region_buckets[region][t] = region_buckets[region].get(t, 0.0) + kt
        global_by_type[t] = global_by_type.get(t, 0.0) + kt

    regions_out = []
    for name, _ in _REGIONS:
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
