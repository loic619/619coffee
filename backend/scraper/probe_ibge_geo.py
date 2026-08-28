"""
probe_ibge_geo.py — can we get municipality geometry for the coffee crop layer?

coffee_crop_area.json carries 1,585 municipalities keyed by IBGE geocode, but
the repo has no geometry at all — no GeoJSON, no centroids. So the map cannot
draw them yet. This decides how.

Two possible layers, and the answer depends entirely on payload size:

  polygons  a true choropleth. Best looking, joins by geocode, but 1,585
            municipality boundaries could be several MB even simplified.
  centroids graduated circles, which is the pattern CoffeeMap already uses for
            origin volumes (circleMarker with sqrt-scaled radius). Tiny — about
            40 KB — but loses the shape of each municipality.

IBGE's malhas API can serve either: the country mesh subdivided by municipality,
from which centroids are trivially derived. This probe measures the real sizes
before anything is committed, because a 20 MB geometry file would be a bad thing
to discover after wiring the UI.

Writes nothing. Run via workflow 0.24 (dispatch-only).

    cd backend && python -m scraper.probe_ibge_geo
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; coffee-intel-map/1.0)"}

_MALHAS = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
_CROP_JSON = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "public" / "data" / "coffee_crop_area.json"
)


def _get(url: str, params: dict, timeout: int = 300):
    import requests

    time.sleep(0.5)
    return requests.get(url, params=params, headers=_HEADERS, timeout=timeout)


def _coffee_geocodes() -> set[str]:
    d = json.loads(_CROP_JSON.read_text(encoding="utf-8"))
    codes = {str(m["geocode"]) for m in d["municipalities"]}
    print(f"  {len(codes):,} coffee municipalities to cover")
    return codes


def _ring_centroid(coords) -> tuple[float, float]:
    """Mean of the outer ring's points — good enough to place a circle."""
    pts: list[tuple[float, float]] = []

    def walk(node):
        if (isinstance(node, list) and len(node) == 2
                and all(isinstance(v, (int, float)) for v in node)):
            pts.append((node[0], node[1]))
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(coords)
    if not pts:
        return (0.0, 0.0)
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def main() -> int:
    codes = _coffee_geocodes()

    print("\n=== IBGE malhas, country mesh by municipality ===")
    payload = None
    for qualidade in ("minima", "intermediaria"):
        params = {
            "formato": "application/vnd.geo+json",
            "intrarregiao": "municipio",
            "qualidade": qualidade,
        }
        try:
            r = _get(_MALHAS, params)
        except Exception as e:  # noqa: BLE001
            print(f"  {qualidade}: ERROR {type(e).__name__} — {e}")
            continue
        print(f"  {qualidade}: {r.status_code} {r.headers.get('Content-Type', '?')} "
              f"{len(r.content) / 1e6:.1f} MB")
        if r.status_code == 200 and payload is None:
            try:
                payload = r.json()
            except Exception as e:  # noqa: BLE001
                print(f"    not JSON: {e}")

    if payload is None:
        print("\n  no usable mesh — the layer would need another geometry source")
        return 0

    feats = payload.get("features", [])
    print(f"\n  {len(feats):,} features")
    if not feats:
        return 0
    props = feats[0].get("properties", {})
    print(f"  feature properties: {props}")

    # The join key: IBGE returns the geocode as 'codarea'.
    key = next((k for k in props if str(props[k]).isdigit()
                and len(str(props[k])) == 7), None)
    print(f"  geocode-like property: {key!r}")
    if not key:
        print("  cannot join to coffee data without a 7-digit code")
        return 0

    subset = [f for f in feats if str(f["properties"].get(key)) in codes]
    print(f"  features matching coffee municipalities: {len(subset):,}")

    full = len(json.dumps({"type": "FeatureCollection", "features": subset}))
    print(f"\n  polygon subset as-is:        {full / 1e6:.1f} MB")

    # Rounding coordinates is the cheapest big win; 4 dp is ~11 m.
    def round_coords(node, dp=4):
        if (isinstance(node, list) and len(node) == 2
                and all(isinstance(v, (int, float)) for v in node)):
            return [round(node[0], dp), round(node[1], dp)]
        if isinstance(node, list):
            return [round_coords(c, dp) for c in node]
        return node

    rounded = [{"type": "Feature",
                "properties": {"g": str(f["properties"][key])},
                "geometry": {"type": f["geometry"]["type"],
                             "coordinates": round_coords(f["geometry"]["coordinates"])}}
               for f in subset]
    slim = len(json.dumps({"type": "FeatureCollection", "features": rounded},
                          separators=(",", ":")))
    print(f"  polygon subset, 4dp + minimal props: {slim / 1e6:.1f} MB")

    centroids = {str(f["properties"][key]): [round(c, 4) for c in
                 _ring_centroid(f["geometry"]["coordinates"])] for f in subset}
    cent = len(json.dumps(centroids, separators=(",", ":")))
    print(f"  centroids only:              {cent / 1e3:.0f} KB")

    sample = list(centroids.items())[:3]
    print(f"  sample centroid (lng,lat): {sample}")
    print("\n  Decides: polygons if the slim subset is a couple of MB or less, "
          "otherwise centroids + graduated circles.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
