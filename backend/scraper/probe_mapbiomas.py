"""
probe_mapbiomas.py — discover how to get MapBiomas coffee-area statistics.

Goal: area in hectares of MapBiomas class 46 (Coffee / Café), by region, by year
(1985→present), so the map can show where coffee is grown and how that footprint
moves over time.

Established so far, against the live site:

  v1  Current release is Collection 11. The statistics page links
      MAPBIOMAS_BRAZIL-COL.11-BIOME_STATE.xlsx (17.9 MB) and a small AMACRO
      extract. There is no usable public GraphQL — /api/graphql 404s and
      /graphql returns the SPA shell, so the spreadsheet is the route.

  v2  BIOME_STATE.xlsx sheets: READ_ME, COVERAGE_11, TRANSITION_11, PIVOT_*,
      METADATA, LEGEND_CODE. COVERAGE_11 is wide:
        ID, country, biome, region, state, class, class_level_0..4, y1985..y2025
      One row per (biome, region, state, class), one column per year — exactly
      the shape needed. It also surfaced a Drive link that may be the
      municipality-level table:
        https://drive.google.com/uc?id=1otOqymHuixvkRGVl65zTTNyfaHo46Gqk

v3 closes the last two gaps before the exporter is written:

  1. Does the Drive file give municipality granularity? That is the difference
     between "Minas grew 12%" and naming the municipalities that grew.
  2. Do class 46 rows actually exist, and are the magnitudes credible? v2's
     "coffee found" hit was a false positive — it matched ID=46, not class=46.
     Brazil's coffee area is roughly 1.8-2.2 M ha, so the totals are checkable.

Writes nothing. Run via workflow 0.23 (dispatch-only).

    cd backend && python -m scraper.probe_mapbiomas
"""
from __future__ import annotations

import io
import sys
import time

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en,pt-BR;q=0.9",
}

_BIOME_STATE_XLSX = (
    "https://brasil.mapbiomas.org/wp-content/uploads/sites/3/2026/08/"
    "MAPBIOMAS_BRAZIL-COL.11-BIOME_STATE.xlsx"
)
_DRIVE_ID = "1otOqymHuixvkRGVl65zTTNyfaHo46Gqk"
_COFFEE_CLASS = 46


def _get(url: str, timeout: int = 180, **kw):
    import requests

    time.sleep(1.0)
    return requests.get(url, headers=_HEADERS, timeout=timeout,
                        allow_redirects=True, **kw)


def _probe_drive() -> None:
    """What is behind the Drive link — and is it per-municipality?"""
    import requests

    url = f"https://drive.google.com/uc?id={_DRIVE_ID}&export=download"
    try:
        r = _get(url, timeout=120, stream=True)
    except Exception as e:  # noqa: BLE001
        print(f"  fetch failed: {e}")
        return

    ctype = r.headers.get("Content-Type", "?")
    size = r.headers.get("Content-Length", "?")
    disp = r.headers.get("Content-Disposition", "")
    print(f"  {r.status_code}  {ctype}  {size} bytes")
    if disp:
        print(f"  filename: {disp}")

    head = r.raw.read(2048, decode_content=True) or b""
    # Drive serves an HTML interstitial for big files instead of the bytes.
    if b"<html" in head[:200].lower() or "text/html" in ctype:
        print("  → HTML interstitial (Drive virus-scan confirm page), not the file.")
        text = head.decode("utf-8", "replace")
        for marker in ("confirm=", "uuid=", "download-form", "filename"):
            if marker in text:
                print(f"     mentions {marker}")
        print("     A confirm token round-trip would be needed to fetch it.")
    else:
        print(f"  → binary payload, first bytes: {head[:8]!r} "
              f"({'xlsx/zip' if head[:2] == b'PK' else 'unknown'})")
    r.close()


def _probe_coverage() -> None:
    """Confirm class 46 exists, at what granularity, and sanity-check totals."""
    import pandas as pd

    try:
        r = _get(_BIOME_STATE_XLSX)
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001
        print(f"  download failed: {e}")
        return
    print(f"  {len(r.content) / 1e6:.1f} MB downloaded")

    df = pd.read_excel(io.BytesIO(r.content), sheet_name="COVERAGE_11")
    print(f"  COVERAGE_11: {len(df):,} rows x {df.shape[1]} cols")

    years = [c for c in df.columns if str(c).startswith("y") and str(c)[1:].isdigit()]
    print(f"  year columns: {years[0]} → {years[-1]} ({len(years)} years)")

    coffee = df[df["class"] == _COFFEE_CLASS]
    print(f"  class {_COFFEE_CLASS} rows: {len(coffee):,}")
    if coffee.empty:
        print("  !! no coffee rows — check the class code against LEGEND_CODE")
        print(f"  distinct classes: {sorted(df['class'].dropna().unique())[:40]}")
        return

    label_cols = [c for c in ("class_level_2", "class_level_3", "class_level_4")
                  if c in coffee.columns]
    for c in label_cols:
        print(f"  {c}: {coffee[c].dropna().unique()[:3]}")

    # Sanity check: Brazil's coffee area is roughly 1.8-2.2 M ha.
    print("\n  Brazil coffee area (M ha):")
    for y in ("y1985", "y2000", "y2015", "y2020", "y2024", "y2025"):
        if y in coffee.columns:
            print(f"    {y[1:]}  {coffee[y].sum() / 1e6:.2f}")

    print("\n  top states by 2025 coffee area (ha):")
    top = (coffee.groupby("state")["y2025"].sum()
           .sort_values(ascending=False).head(8))
    for state, ha in top.items():
        print(f"    {state:22} {ha:12,.0f}")

    print(f"\n  granularity available here: {sorted(coffee['state'].unique())[:5]} …"
          f" ({coffee['state'].nunique()} states, no municipality column)")


def main() -> int:
    print("=== Drive link — municipality table? ===")
    _probe_drive()

    print("\n=== COVERAGE_11 — coffee rows and magnitudes ===")
    _probe_coverage()
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
