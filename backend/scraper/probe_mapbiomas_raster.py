"""
probe_mapbiomas_raster.py — can we derive coffee polygons from the rasters in CI?

The plan chosen for Option A: pull MapBiomas' land-cover raster, keep only class
46 (Coffee), vectorise and simplify it, and commit the result as a static
GeoJSON. No GCP account, no Earth Engine licensing question, no runtime
dependency on anyone's tile server — the same shape as everything else here.

The coverage raster is not on their public tile host (probe 0.25: that GeoServer
carries only the semi-arid programme and vector overlays), so the rasters have
to come from the download bucket.

Three things decide whether this is viable, and all three are measurable:

  1. Where the GeoTIFFs actually are. MapBiomas publishes to a public GCS
     bucket, but the path template differs between collections, so candidates
     are tested by HEAD rather than assumed.
  2. How big one year of Brazil is. A national 30 m mosaic is plausibly a
     gigabyte or more, which matters on a runner with finite disk.
  3. Whether it is a Cloud-Optimised GeoTIFF. If it is, rasterio can read a
     window over HTTP and we never download the whole thing — that is the
     difference between a tractable CI job and an untenable one. Coffee sits in
     a handful of states, so windowed reads would touch a small fraction.

Writes nothing. Run via workflow 0.26 (dispatch-only).

    cd backend && python -m scraper.probe_mapbiomas_raster
"""
from __future__ import annotations

import sys
import time

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; coffee-intel-map/1.0)"}

_BUCKET = "https://storage.googleapis.com/mapbiomas-public"

# Path templates seen across collections; the newest naming is unknown, so try
# a spread rather than betting on one.
_CANDIDATES = [
    f"{_BUCKET}/initiatives/brasil/collection_11/lclu/coverage/brasil_coverage_2025.tif",
    f"{_BUCKET}/initiatives/brasil/collection_10/lclu/coverage/brasil_coverage_2024.tif",
    f"{_BUCKET}/initiatives/brasil/collection_9/lclu/coverage/brasil_coverage_2023.tif",
    f"{_BUCKET}/brasil/collection_11/lclu/coverage/brasil_coverage_2025.tif",
    f"{_BUCKET}/brasil/collection_9/lclu/coverage/brasil_coverage_2023.tif",
    f"{_BUCKET}/collection_9/lclu/coverage/brasil_coverage_2023.tif",
]

# Minas Gerais + Espírito Santo — where most Brazilian coffee is. A windowed
# read here is the realistic unit of work for the vectorising job.
_COFFEE_BBOX = (-51.05, -22.95, -39.85, -14.20)  # W, S, E, N


def main() -> int:
    import requests

    print("=== locating the coverage rasters ===")
    found: list[tuple[str, int]] = []
    for url in _CANDIDATES:
        try:
            time.sleep(0.4)
            r = requests.head(url, headers=_HEADERS, timeout=45, allow_redirects=True)
            size = int(r.headers.get("Content-Length", 0) or 0)
            print(f"  {r.status_code}  {size / 1e6:8.1f} MB  {url.split('/mapbiomas-public/')[-1]}")
            if r.status_code == 200 and size:
                found.append((url, size))
        except Exception as e:  # noqa: BLE001
            print(f"  ERR  {type(e).__name__:18} {url.split('/mapbiomas-public/')[-1]}")

    if not found:
        print("\n  No raster located. The download page would need scraping for "
              "the real path, or the files are not on this bucket.")
        return 0

    url, size = found[0]
    print(f"\n=== is it a COG? {url.rsplit('/', 1)[-1]} ({size / 1e6:.0f} MB) ===")
    try:
        import rasterio
        from rasterio.windows import from_bounds
    except ImportError:
        print("  rasterio not installed in this job — cannot test windowed reads")
        return 0

    try:
        t0 = time.time()
        with rasterio.open(f"/vsicurl/{url}") as src:
            print(f"  opened remotely in {time.time() - t0:.1f}s")
            print(f"  size {src.width} x {src.height}, crs {src.crs}, "
                  f"dtype {src.dtypes[0]}")
            print(f"  tiled={src.profile.get('tiled')} "
                  f"blocks={src.profile.get('blockxsize')}x{src.profile.get('blockysize')} "
                  f"compress={src.profile.get('compress')}")
            print(f"  overviews: {src.overviews(1)[:8] or 'none'}")

            # The real question: can we pull just the coffee region cheaply?
            t1 = time.time()
            win = from_bounds(*_COFFEE_BBOX, transform=src.transform)
            data = src.read(1, window=win, out_shape=(1, 2000, 2000))
            took = time.time() - t1
            import numpy as np
            coffee = int(np.count_nonzero(data == 46))
            classes, counts = np.unique(data, return_counts=True)
            top = sorted(zip(classes.tolist(), counts.tolist()),
                         key=lambda kv: -kv[1])[:6]
            print(f"\n  windowed read of the coffee states: {took:.1f}s "
                  f"for a {data.shape} decimated view")
            print(f"  class 46 pixels in that view: {coffee:,}")
            print(f"  most common classes: {top}")
            print("\n  A fast windowed read means the vectorising job never "
                  "downloads the whole mosaic.")
    except Exception as e:  # noqa: BLE001
        print(f"  remote read failed: {type(e).__name__} — {e}")
        print("  Fallback would be downloading the full file per year, which is "
              f"~{size / 1e6:.0f} MB each and much slower.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
