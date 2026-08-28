"""
coffee_crop_geo.py — municipality boundaries for the coffee crop map layer.

coffee_crop_area.json carries coffee hectares per IBGE geocode per year, but the
repo has no geometry, so there is nothing to colour. This fetches IBGE's country
mesh subdivided by municipality and keeps only the municipalities that actually
grow coffee.

Measured by the 0.24 probe before committing to this approach:

    polygon subset as-is             0.9 MB
    polygon subset, 4dp + min props  0.8 MB   <- what this writes
    centroids only                    47 KB   (the fallback we did not need)

0.8 MB buys a real choropleth instead of graduated circles, and every one of the
1,585 coffee municipalities is present in the mesh, so no coffee goes undrawn.

Two size choices worth keeping:
  * coordinates rounded to 4 dp — about 11 m, far finer than these boundaries
    are drawn at any usable zoom, and it removes most of the bytes.
  * properties reduced to {"g": geocode}. IBGE's extras are dead weight; the
    name and state already live in coffee_crop_area.json, joined on this key.

Boundaries change rarely, so this runs alongside the yearly area export.

Writes → frontend/public/data/coffee_crop_geo.json
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scraper.validate_export import safe_write_json

_DATA_DIR = Path(__file__).resolve().parents[3] / "frontend" / "public" / "data"
_AREA_PATH = _DATA_DIR / "coffee_crop_area.json"
_OUT_PATH = _DATA_DIR / "coffee_crop_geo.json"

_MALHAS = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; coffee-intel-map/1.0)"}

_DP = 4          # ~11 m; boundaries are never drawn finer than this here
_MIN_COVERAGE = 0.95
_MAX_BYTES = 3_000_000


def _round(node, dp: int = _DP):
    """Round every coordinate pair, whatever the nesting depth."""
    if (isinstance(node, list) and len(node) == 2
            and all(isinstance(v, (int, float)) for v in node)):
        return [round(node[0], dp), round(node[1], dp)]
    if isinstance(node, list):
        return [_round(c, dp) for c in node]
    return node


def _wanted_geocodes() -> set[str]:
    area = json.loads(_AREA_PATH.read_text(encoding="utf-8"))
    return {str(m["geocode"]) for m in area["municipalities"]}


def _fetch_mesh() -> dict:
    import requests

    r = requests.get(_MALHAS, params={
        "formato": "application/vnd.geo+json",
        "intrarregiao": "municipio",
        "qualidade": "minima",
    }, headers=_HEADERS, timeout=600)
    r.raise_for_status()
    return r.json()


def run() -> dict | None:
    """Build the geometry file. Leaves the existing one alone on failure."""
    try:
        wanted = _wanted_geocodes()
        print(f"[crop_geo] {len(wanted):,} coffee municipalities to cover")

        mesh = _fetch_mesh()
        feats = mesh.get("features", [])
        print(f"[crop_geo] mesh has {len(feats):,} municipalities")

        kept = []
        for f in feats:
            code = str(f.get("properties", {}).get("codarea", ""))
            if code not in wanted:
                continue
            kept.append({
                "type": "Feature",
                "properties": {"g": code},
                "geometry": {
                    "type": f["geometry"]["type"],
                    "coordinates": _round(f["geometry"]["coordinates"]),
                },
            })

        coverage = len(kept) / len(wanted) if wanted else 0
        print(f"[crop_geo] matched {len(kept):,} ({coverage:.1%})")
        if coverage < _MIN_COVERAGE:
            # Below this the map would quietly omit real coffee municipalities.
            raise RuntimeError(
                f"only {coverage:.1%} of coffee municipalities found in the mesh; "
                "IBGE geocodes or the API shape changed")

        payload = {
            "type": "FeatureCollection",
            "updated": datetime.now(UTC).isoformat(timespec="seconds"),
            "source": "IBGE malhas territoriais (municipality mesh, minima)",
            "note": ("Boundaries for municipalities present in "
                     "coffee_crop_area.json; join on properties.g == geocode. "
                     f"Coordinates rounded to {_DP} decimal places."),
            "features": kept,
        }

        size = len(json.dumps(payload, separators=(",", ":")).encode())
        print(f"[crop_geo] {size / 1e6:.2f} MB")
        if size > _MAX_BYTES:
            raise RuntimeError(
                f"{size / 1e6:.1f} MB exceeds the {_MAX_BYTES / 1e6:.0f} MB budget")
    except Exception as e:  # noqa: BLE001
        print(f"[crop_geo] FAILED: {e} — retaining existing file")
        return None

    _OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(_OUT_PATH, payload, indent=None, separators=(",", ":"))
    print(f"[crop_geo] wrote {_OUT_PATH}")
    return payload


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(0 if run() else 1)
