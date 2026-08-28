"""
probe_mapbiomas.py — discover how to get MapBiomas coffee-area statistics.

Goal: area in hectares of MapBiomas class 46 (Coffee / Café), by region, by year
(1985→present), so the map can show where coffee is grown and how that footprint
moves over time.

Probe v1 established (2026-08-28), against the live site:

  * The statistics page links two spreadsheets directly:
      MAPBIOMAS_BRAZIL-COL.11-BIOME_STATE.xlsx                  17.9 MB
      MAPBIOMAS_BRAZIL-COVERAGE_STATISTIC_COL.11-AMACRO_...xlsx  0.1 MB
    So the current release is Collection 11.
  * There is no usable public GraphQL: /api/graphql 404s and /graphql returns
    the SPA's HTML shell.
  * The page mentions drive.google.com, so the municipality-level table is
    probably behind a Drive link that a file-extension regex cannot see.

v2 answers the two questions that decide what can actually be built:

  1. What is inside BIOME_STATE.xlsx — sheet names, columns, and whether class
     46 is present per state per year. That is the fallback data layer.
  2. Is there a municipality-level table? Dump every outbound link on the page
     (not just ones ending in a file extension) so Drive/other hosts show up.

Writes nothing. Run via workflow 0.23 (dispatch-only).

    cd backend && python -m scraper.probe_mapbiomas
"""
from __future__ import annotations

import io
import re
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

_STATS_PAGE = "https://brasil.mapbiomas.org/en/estatisticas/"
_BIOME_STATE_XLSX = (
    "https://brasil.mapbiomas.org/wp-content/uploads/sites/3/2026/08/"
    "MAPBIOMAS_BRAZIL-COL.11-BIOME_STATE.xlsx"
)

_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
# Links worth a human look: downloads, drive, or anything naming a region level.
_INTERESTING = re.compile(
    r"drive\.google|docs\.google|storage\.googleapis|dropbox|"
    r"munic|city|cidade|download|estatistic|statistic|\.xlsx|\.csv|\.zip", re.I)


def _get(url: str, timeout: int = 120):
    import requests

    time.sleep(1.0)
    return requests.get(url, headers=_HEADERS, timeout=timeout, allow_redirects=True)


def _dump_links() -> None:
    """Every outbound link on the statistics page, so nothing is missed."""
    try:
        r = _get(_STATS_PAGE, timeout=45)
    except Exception as e:  # noqa: BLE001
        print(f"  page fetch failed: {e}")
        return
    links = {h for h in _HREF_RE.findall(r.text) if _INTERESTING.search(h)}
    print(f"  {len(links)} interesting link(s) on {_STATS_PAGE}")
    for h in sorted(links):
        print(f"    {h}")


def _inspect_xlsx() -> None:
    """Sheet names, columns, and whether coffee (class 46) is actually in here."""
    import pandas as pd

    print(f"  downloading {_BIOME_STATE_XLSX.rsplit('/', 1)[-1]} …")
    try:
        r = _get(_BIOME_STATE_XLSX)
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001
        print(f"  download failed: {e}")
        return
    print(f"  {len(r.content) / 1e6:.1f} MB downloaded")

    buf = io.BytesIO(r.content)
    try:
        xls = pd.ExcelFile(buf)
    except Exception as e:  # noqa: BLE001
        print(f"  cannot open workbook: {e}")
        return

    print(f"  sheets: {xls.sheet_names}")
    for sheet in xls.sheet_names[:6]:
        try:
            df = pd.read_excel(xls, sheet_name=sheet, nrows=400)
        except Exception as e:  # noqa: BLE001
            print(f"  [{sheet}] unreadable: {e}")
            continue
        print(f"\n  [{sheet}] {df.shape[0]}+ rows sampled, {df.shape[1]} cols")
        print(f"    columns: {list(df.columns)[:18]}")

        # Is coffee here? Look for the class id and the label in any column.
        for col in df.columns:
            vals = df[col].astype(str)
            if vals.str.contains(r"^(?:46|Coffee|Caf[eé])$", case=False,
                                 regex=True, na=False).any():
                sample = df[vals.str.contains(r"^(?:46|Coffee|Caf[eé])$",
                                              case=False, regex=True, na=False)]
                print(f"    ✓ coffee found in column '{col}' — "
                      f"{len(sample)} row(s) in sample")
                with __import__("pandas").option_context("display.width", 200,
                                                         "display.max_columns", 14):
                    print(sample.head(3).to_string()[:900])
                break


def main() -> int:
    print("=== every interesting link on the statistics page ===")
    _dump_links()

    print("\n=== inside BIOME_STATE.xlsx ===")
    _inspect_xlsx()

    print("\nDecides: municipality table if a link exists; otherwise state-level "
          "from this workbook, which is still every Brazilian coffee region.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
