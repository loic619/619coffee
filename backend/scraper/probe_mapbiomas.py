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
    """Resolve the Drive file past the confirm page — is it per-municipality?

    Large Drive files answer the plain uc?export=download URL with a virus-scan
    interstitial. The real bytes come from drive.usercontent.google.com once the
    hidden form fields (confirm token + uuid) are replayed.
    """
    import re

    import requests

    s = requests.Session()
    s.headers.update(_HEADERS)
    url = f"https://drive.google.com/uc?id={_DRIVE_ID}&export=download"
    try:
        r = s.get(url, timeout=60, allow_redirects=True)
    except Exception as e:  # noqa: BLE001
        print(f"  fetch failed: {e}")
        return
    print(f"  step 1: {r.status_code} {r.headers.get('Content-Type', '?')}")

    if "text/html" in r.headers.get("Content-Type", ""):
        fields = dict(re.findall(
            r'name="([^"]+)"\s+value="([^"]*)"', r.text))
        action = re.search(r'action="([^"]+)"', r.text)
        name = re.search(r'<span class="uc-name-size"><a[^>]*>([^<]+)</a>', r.text)
        print(f"  form fields: {list(fields)}")
        print(f"  file name:   {name.group(1) if name else '?'}")
        if not action:
            print("  no form action — cannot resolve")
            return
        try:
            r = s.get(action.group(1), params=fields, timeout=180, stream=True)
        except Exception as e:  # noqa: BLE001
            print(f"  step 2 failed: {e}")
            return
        print(f"  step 2: {r.status_code} {r.headers.get('Content-Type', '?')} "
              f"{r.headers.get('Content-Length', '?')} bytes")

    head = r.raw.read(4096, decode_content=True) or b""
    if head[:2] != b"PK":
        print(f"  not a zip/xlsx payload: {head[:60]!r}")
        r.close()
        return

    body = head + r.content
    r.close()
    print(f"  → {len(body) / 1e6:.1f} MB archive")

    # It is a zip, not a workbook — list what is inside before parsing anything.
    import zipfile

    import pandas as pd

    try:
        zf = zipfile.ZipFile(io.BytesIO(body))
    except Exception as e:  # noqa: BLE001
        print(f"  not a readable zip: {e}")
        return
    entries = zf.infolist()
    print(f"  archive contents ({len(entries)}):")
    for info in entries:
        print(f"    {info.filename}  {info.file_size / 1e6:.1f} MB uncompressed")

    # Inspect the biggest member — that is the data table.
    target = max(entries, key=lambda i: i.file_size)
    print(f"\n  inspecting {target.filename} …")
    raw = zf.read(target)

    if target.filename.lower().endswith((".csv", ".txt")):
        df = pd.read_csv(io.BytesIO(raw), nrows=200_000)
        _describe(df, target.filename)
        return

    try:
        xls = pd.ExcelFile(io.BytesIO(raw))
    except Exception as e:  # noqa: BLE001
        print(f"  cannot open {target.filename}: {e}")
        return
    print(f"  sheets: {xls.sheet_names}")
    for sheet in xls.sheet_names:
        if not re.search(r"coverage|cobertura", sheet, re.I):
            continue
        print(f"  reading sheet {sheet} (this is the large one) …")
        df = pd.read_excel(xls, sheet_name=sheet)
        _describe(df, sheet)
        break


def _describe(df, label: str) -> None:
    """Columns, municipality granularity, and how much coffee is in here."""
    import re

    cols = [str(c) for c in df.columns]
    muni = [c for c in cols if re.search(r"munic|city|cidade|geocod", c, re.I)]
    print(f"  [{label}] {len(df):,} rows x {len(cols)} cols")
    print(f"    columns: {cols[:14]}")
    print(f"    municipality column(s): {muni or 'NONE'}")
    if "class" not in cols:
        return
    coffee = df[df["class"] == _COFFEE_CLASS]
    print(f"    class {_COFFEE_CLASS} rows: {len(coffee):,}")
    if coffee.empty or not muni:
        return
    key = muni[0]
    print(f"    municipalities with coffee: {coffee[key].nunique():,}")
    if "y2025" in cols:
        top = (coffee.groupby(key)["y2025"].sum()
               .sort_values(ascending=False).head(10))
        print("    top municipalities by 2025 coffee area (ha):")
        for name, ha in top.items():
            print(f"      {str(name)[:32]:34} {ha:10,.0f}")


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
