"""
coffee_footprint.py — where coffee actually sits, from the MapBiomas raster.

The choropleth answers "how much coffee per municipality". This answers "where
inside the municipality", by reading MapBiomas' 30 m land-cover raster and
keeping class 46 (Coffee).

Why a density grid rather than field polygons. Brazil's ~1.2 M ha of coffee is
roughly 13.7 M pixels at 30 m, and coffee is fragmented, so vectorising the mask
directly yields on the order of 10^5 jagged polygons — megabytes of GeoJSON that
still has to be simplified so hard it stops being field-accurate. Aggregating
into a small grid keeps the honest signal (which valleys grow coffee, not just
which municipalities) at a size a web map can load, and it does not pretend to a
precision the simplification would have destroyed anyway.

Read strategy, measured by probe 0.26: the source is a Cloud-Optimised GeoTIFF
(tiled 512x512, LZW, overviews to 256), so rasterio opens it over HTTP in ~1s
and reads windows on demand. The job therefore never downloads the ~1 GB
national mosaic — it streams only the blocks covering the coffee states.

Cross-check built in: the total area this derives is compared against
coffee_crop_area.json, which comes from MapBiomas' own published statistics via
a completely different path (spreadsheet, not raster). Two independent routes
to the same number is the strongest correctness signal available here.

Writes → frontend/public/data/coffee_footprint.json
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
_OUT_PATH = _DATA_DIR / "coffee_footprint.json"

_BUCKET = "https://storage.googleapis.com/mapbiomas-public/initiatives/brasil"
_COFFEE_CLASS = 46

# Bounding box covering MG, ES, SP, BA, PR, GO — every state with coffee in the
# statistics. Reading only this avoids streaming the whole country.
_BBOX = (-52.0, -25.5, -38.5, -13.0)  # W, S, E, N

# Grid cell in degrees. 0.01 deg is ~1.1 km — fine enough to show where coffee
# sits within a municipality, coarse enough to stay a sane file.
_CELL = 0.01
_WINDOW = 4096          # pixels per read; ~17 MB as uint8
_MIN_CELL_HA = 5.0      # drop near-empty cells; they are mostly speckle

# Guard rails: the derived total must land near the published statistics.
_AREA_TOLERANCE = 0.35
_MAX_BYTES = 4_000_000


def _find_raster() -> tuple[str, int, int]:
    """Newest available (url, collection, year). Paths differ per collection."""
    import requests

    for collection in (11, 10, 9):
        for year in range(2025, 2019, -1):
            url = (f"{_BUCKET}/collection_{collection}/lclu/coverage/"
                   f"brasil_coverage_{year}.tif")
            try:
                r = requests.head(url, timeout=30, allow_redirects=True)
            except Exception:  # noqa: BLE001
                continue
            if r.status_code == 200:
                size = int(r.headers.get("Content-Length", 0) or 0)
                print(f"[footprint] using collection {collection} / {year} "
                      f"({size / 1e6:.0f} MB)")
                return url, collection, year
    raise RuntimeError("no coverage raster found on the public bucket")


def _published_total(year: int) -> float | None:
    """Coffee hectares for `year` from the statistics export, for cross-check."""
    try:
        area = json.loads(_AREA_PATH.read_text(encoding="utf-8"))
        if year in area["years"]:
            return float(area["brazil_total"][area["years"].index(year)])
        return float(area["brazil_total"][-1])
    except Exception:  # noqa: BLE001
        return None


def _accumulate(url: str) -> tuple[dict[tuple[int, int], int], float]:
    """Stream the coffee states and bin class-46 pixels into the grid."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window, from_bounds

    cells: dict[tuple[int, int], int] = {}
    total_px = 0

    with rasterio.open(f"/vsicurl/{url}") as src:
        full = from_bounds(*_BBOX, transform=src.transform)
        col0, row0 = int(full.col_off), int(full.row_off)
        width, height = int(full.width), int(full.height)
        print(f"[footprint] coffee window {width} x {height} px "
              f"({width * height / 1e9:.2f} G px), streaming in {_WINDOW}px blocks")

        done = 0
        for row in range(row0, row0 + height, _WINDOW):
            for col in range(col0, col0 + width, _WINDOW):
                w = Window(col, row,
                           min(_WINDOW, col0 + width - col),
                           min(_WINDOW, row0 + height - row))
                block = src.read(1, window=w)
                ys, xs = np.nonzero(block == _COFFEE_CLASS)
                if ys.size:
                    total_px += int(ys.size)
                    # Pixel indices → lon/lat → grid cell.
                    lon, lat = rasterio.transform.xy(
                        src.transform, (ys + row).tolist(), (xs + col).tolist())
                    gx = np.floor(np.asarray(lon) / _CELL).astype(np.int32)
                    gy = np.floor(np.asarray(lat) / _CELL).astype(np.int32)
                    for key in zip(gx.tolist(), gy.tolist()):
                        cells[key] = cells.get(key, 0) + 1
            done += 1
            if done % 5 == 0:
                print(f"[footprint]   {done} block-rows, {total_px:,} coffee px, "
                      f"{len(cells):,} cells")

        # 30 m pixels, but the raster is in degrees: derive hectares from the
        # actual pixel size at this latitude band rather than assuming 0.09 ha.
        px_deg_x, px_deg_y = abs(src.transform.a), abs(src.transform.e)
        mid_lat = (_BBOX[1] + _BBOX[3]) / 2
        m_per_deg_lat = 111_132.0
        m_per_deg_lon = 111_320.0 * np.cos(np.radians(mid_lat))
        px_ha = (px_deg_x * m_per_deg_lon) * (px_deg_y * m_per_deg_lat) / 10_000
        print(f"[footprint] pixel ≈ {px_ha:.4f} ha at {mid_lat:.1f}°")

    return cells, px_ha


def run() -> dict | None:
    try:
        url, collection, year = _find_raster()
        cells, px_ha = _accumulate(url)
        if not cells:
            raise RuntimeError("no class-46 pixels found; class code changed?")

        # Compact [lon, lat, ha] triples rather than GeoJSON. Every cell is the
        # same known size, so repeating five coordinate pairs per square to say
        # so costs ~5x the bytes: 40k cells measured at 6.0 MB as polygons
        # against ~0.9 MB here. The frontend draws the square from the corner
        # plus cell_degrees.
        out_cells = []
        derived_ha = 0.0
        for (gx, gy), count in cells.items():
            ha = count * px_ha
            derived_ha += ha
            if ha < _MIN_CELL_HA:
                continue
            out_cells.append([round(gx * _CELL, 2), round(gy * _CELL, 2), round(ha)])
        out_cells.sort(key=lambda c: -c[2])

        published = _published_total(year)
        print(f"[footprint] derived {derived_ha / 1e6:.2f} M ha across "
              f"{len(cells):,} cells; kept {len(out_cells):,} above {_MIN_CELL_HA} ha")
        if published:
            drift = abs(derived_ha - published) / published
            print(f"[footprint] published statistics say "
                  f"{published / 1e6:.2f} M ha — drift {drift:.1%}")
            if drift > _AREA_TOLERANCE:
                raise RuntimeError(
                    f"raster total {derived_ha / 1e6:.2f} M ha disagrees with the "
                    f"published {published / 1e6:.2f} M ha by {drift:.0%}; "
                    "wrong class, wrong bbox or wrong pixel area")

        payload = {
            "updated": datetime.now(UTC).isoformat(timespec="seconds"),
            "source": f"MapBiomas Collection {collection} ({year}) — class 46, "
                      f"aggregated to {_CELL}° cells",
            "licence": "CC BY-SA 4.0 — MapBiomas Project",
            "year": year,
            "cell_degrees": _CELL,
            "total_ha": round(derived_ha),
            "note": ("cells are [lon, lat, hectares]; lon/lat is the cell's "
                     "south-west corner and the cell is cell_degrees square. "
                     "Derived from the 30 m classification, then binned — it "
                     "shows where coffee sits, not individual field outlines."),
            "cells": out_cells,
        }

        size = len(json.dumps(payload, separators=(",", ":")).encode())
        print(f"[footprint] {size / 1e6:.2f} MB")
        if size > _MAX_BYTES:
            raise RuntimeError(
                f"{size / 1e6:.1f} MB exceeds the {_MAX_BYTES / 1e6:.0f} MB budget; "
                "raise _CELL to coarsen the grid")
    except Exception as e:  # noqa: BLE001
        print(f"[footprint] FAILED: {e} — retaining existing file")
        return None

    _OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(_OUT_PATH, payload, indent=None, separators=(",", ":"))
    print(f"[footprint] wrote {_OUT_PATH}")
    return payload


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(0 if run() else 1)
