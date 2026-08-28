"""
probe_mapbiomas_tiles.py — find the tile endpoint behind the MapBiomas platform.

Option A of the crop layer is the raster: MapBiomas' own 30 m classification
drawn over Brazil, per year, so the actual coffee polygons are visible rather
than a municipality aggregate. Licensing is settled (CC BY / CC BY-SA), so the
only open question is which URL actually serves the tiles.

Guessing has already been tried and was wrong: the one MapBiomas GeoServer that
turns up in search is maps.alerta.mapbiomas.org, which is the *deforestation
alerts* product, not the coverage collection. So this asks their own application
instead of guessing:

  1. Fetch plataforma.mapbiomas.org and pull out its JS bundles.
  2. Grep those bundles for tile/WMS/Earth-Engine URL patterns — whatever the
     app itself calls to draw the layer is by definition the right answer.
  3. Separately try GetCapabilities on the plausible GeoServer hosts, to see if
     a standard WMS exists that Leaflet could consume via L.tileLayer.wms.

Worth knowing in advance: if the platform turns out to mint short-lived Google
Earth Engine tile URLs server-side, they cannot be hotlinked and Option A would
need its own tile generation — which is a much larger job than the choropleth
already shipped, and worth saying so plainly rather than discovering late.

Writes nothing. Run via workflow 0.25 (dispatch-only).

    cd backend && python -m scraper.probe_mapbiomas_tiles
"""
from __future__ import annotations

import re
import sys
import time

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}

_APP = "https://plataforma.mapbiomas.org"

# shared-geoserver is the one their own app calls, found in the JS bundle. It
# serves GeoWebCache tiles (pre-rendered, cache-friendly) rather than raw WMS.
_CAPS = [
    "https://shared-geoserver.mapbiomas.org/geoserver/wms",
    "https://maps.alerta.mapbiomas.org/geoserver/wms",
]
_WMTS_CAPS = (
    "https://shared-geoserver.mapbiomas.org/geoserver/gwc/service/wmts"
    "?REQUEST=GetCapabilities"
)

# What a tile source looks like in a bundled SPA.
_PATTERNS = [
    (r"https?://[^\s\"'`]*earthengine[^\s\"'`]{0,120}", "earth engine"),
    (r"https?://[^\s\"'`]*\{z\}[^\s\"'`]{0,80}", "xyz template"),
    (r"https?://[^\s\"'`]*geoserver[^\s\"'`]{0,80}", "geoserver"),
    (r"https?://[^\s\"'`]*/wms[^\s\"'`]{0,80}", "wms path"),
    (r"https?://[^\s\"'`]*tiles?\.[^\s\"'`]{0,80}", "tile host"),
    (r"https?://[^\s\"'`]*storage\.googleapis[^\s\"'`]{0,80}", "gcs"),
    (r"https?://api[^\s\"'`]{0,80}mapbiomas[^\s\"'`]{0,60}", "mapbiomas api"),
]


def _get(url: str, timeout: int = 60):
    import requests

    time.sleep(0.6)
    return requests.get(url, headers=_HEADERS, timeout=timeout)


def _scan(text: str, label: str) -> None:
    for pattern, what in _PATTERNS:
        hits = {h.rstrip("\\\"',);") for h in re.findall(pattern, text, re.I)}
        for h in sorted(hits)[:6]:
            print(f"    [{what}] {h[:150]}")


def main() -> int:
    print("=== the platform's own bundles ===")
    try:
        r = _get(_APP)
        print(f"  {r.status_code} index.html, {len(r.text) // 1024} KB")
        scripts = re.findall(r'src="([^"]+\.js)"', r.text)
        print(f"  {len(scripts)} script tag(s): {scripts[:6]}")
    except Exception as e:  # noqa: BLE001
        print(f"  cannot fetch app: {e}")
        scripts = []

    for src in scripts[:6]:
        url = src if src.startswith("http") else f"{_APP}{src}"
        try:
            js = _get(url, timeout=120)
        except Exception as e:  # noqa: BLE001
            print(f"  {url[:90]}: {type(e).__name__}")
            continue
        print(f"\n  {url[-60:]}  ({len(js.text) // 1024} KB)")
        _scan(js.text, src)

    print("\n=== GetCapabilities on plausible GeoServers ===")
    for base in _CAPS:
        try:
            r = _get(base, timeout=45)
        except Exception as e:  # noqa: BLE001
            print(f"  {base}: {type(e).__name__}")
            continue
        ok = r.status_code == 200
        print(f"  {r.status_code} {base}  {r.headers.get('Content-Type', '?')}")
        if not ok:
            continue
        try:
            caps = _get(f"{base}?service=WMS&request=GetCapabilities&version=1.3.0",
                        timeout=120)
            names = re.findall(r"<Name>([^<]+)</Name>", caps.text)
            coffee = [n for n in names if re.search(r"cobertura|coverage|colecao|"
                                                    r"collection|lulc", n, re.I)]
            print(f"    {len(names)} layer names; coverage-ish: {coffee[:10]}")
        except Exception as e:  # noqa: BLE001
            print(f"    capabilities failed: {type(e).__name__}")

    print("\n=== WMTS layers on shared-geoserver (the app's own tile source) ===")
    try:
        caps = _get(_WMTS_CAPS, timeout=120)
        print(f"  {caps.status_code}  {len(caps.text) // 1024} KB")
        ids = re.findall(r"<ows:Identifier>([^<]+)</ows:Identifier>", caps.text)
        layers = [i for i in ids if ":" in i or "mapbiomas" in i.lower()]
        print(f"  {len(layers)} layer identifier(s)")
        for name in layers[:60]:
            print(f"    {name}")
        # What we actually need: land cover / coverage, ideally per year.
        want = [n for n in layers
                if re.search(r"cobertura|coverage|lulc|colecao|collection|uso", n, re.I)]
        print(f"\n  coverage/LULC candidates: {want or 'NONE'}")
        matrix = sorted(set(re.findall(r"<TileMatrixSet>([^<]+)</TileMatrixSet>", caps.text)))
        print(f"  tile matrix sets: {matrix[:8]}")
    except Exception as e:
        print(f"  WMTS capabilities failed: {type(e).__name__} — {e}")

    print("\nDecides: a coverage layer here means Option A is a small Leaflet "
          "change against a cached tile service.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
