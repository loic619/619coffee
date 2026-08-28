"""
mapbiomas_coffee.py — Brazilian coffee crop area, per municipality, per year.

Source: MapBiomas Collection 11, class 46 (3.2. Agriculture > 3.2.2. Perennial
Crop > 3.2.2.1. Coffee), 30 m Landsat classification, 1985→2025.

Feeds the coffee crop layer on the map tab: a choropleth with a year slider, so
crop expansion is visible over time rather than as a single snapshot.

IMPORTANT — what this measures. MapBiomas totals ~1.23 M ha for Brazil against
CONAB's survey figure of roughly 2.2 M ha. It under-detects shaded,
intercropped and young plantings, and small holdings, at 30 m. So this is a
*satellite footprint, not a production census*: read it for where coffee is and
which direction it moves, never as an area statistic to quote against official
numbers. The caveat travels in the JSON so the UI can surface it.

Shape of the source, verified by the 0.23 probe:

    MAPBIOMAS_BRAZIL-COL.11-BIOME_STATE_MUNICIPALITY.zip  (78 MB, Google Drive)
      └ ...xlsx → sheet COVERAGE_11, 77,406 rows x 55 cols
          ID, country, biome, region, state, geocode, municipality,
          municipality-state, class, class_level_0..4, y1985 … y2025

A municipality split across two biomes appears on multiple rows (1,779 rows for
1,594 municipalities), so rows are summed per geocode.

Writes → frontend/public/data/coffee_crop_area.json
"""
from __future__ import annotations

import io
import re
import sys
import time
import zipfile
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scraper.validate_export import safe_write_json

_OUT_PATH = (
    Path(__file__).resolve().parents[3]
    / "frontend" / "public" / "data" / "coffee_crop_area.json"
)

_STATS_PAGE = "https://brasil.mapbiomas.org/en/estatisticas/"
# Fallback only. The Drive id changes with each collection, so the page is
# scraped first — otherwise this silently freezes on Collection 11 forever.
_FALLBACK_DRIVE_ID = "1otOqymHuixvkRGVl65zTTNyfaHo46Gqk"

_COFFEE_CLASS = 46
_SHEET = "COVERAGE_11"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en,pt-BR;q=0.9",
}

# Guard rails. If MapBiomas restructures, these fail the run loudly instead of
# publishing a plausible-looking but wrong layer.
_MIN_MUNICIPALITIES = 800
_MIN_YEARS = 30
_BRAZIL_HA_RANGE = (0.5e6, 3.0e6)

# IBGE state code (first two digits of geocode) → UF, for map joins.
_UF_BY_CODE = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP",
    "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
    "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
    "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
    "51": "MT", "52": "GO", "53": "DF",
}


def _find_drive_id() -> str:
    """The municipality workbook's Drive id, read from the statistics page."""
    import requests

    try:
        r = requests.get(_STATS_PAGE, headers=_HEADERS, timeout=45)
        r.raise_for_status()
        ids = re.findall(r"drive\.google\.com/uc\?id=([\w-]+)", r.text)
        if ids:
            if ids[0] != _FALLBACK_DRIVE_ID:
                print(f"[mapbiomas] Drive id changed → {ids[0]} "
                      f"(was {_FALLBACK_DRIVE_ID}); new collection?")
            return ids[0]
        print("[mapbiomas] no Drive link on the page — using fallback id")
    except Exception as e:  # noqa: BLE001
        print(f"[mapbiomas] statistics page unreadable ({e}) — using fallback id")
    return _FALLBACK_DRIVE_ID


def _download(drive_id: str) -> bytes:
    """Fetch the archive, replaying Drive's virus-scan confirm form."""
    import requests

    s = requests.Session()
    s.headers.update(_HEADERS)
    r = s.get(f"https://drive.google.com/uc?id={drive_id}&export=download",
              timeout=60, allow_redirects=True)
    r.raise_for_status()

    if "text/html" in r.headers.get("Content-Type", ""):
        fields = dict(re.findall(r'name="([^"]+)"\s+value="([^"]*)"', r.text))
        action = re.search(r'action="([^"]+)"', r.text)
        if not action:
            raise RuntimeError("Drive confirm form not found")
        time.sleep(1.0)
        r = s.get(action.group(1), params=fields, timeout=600)
        r.raise_for_status()

    if r.content[:2] != b"PK":
        raise RuntimeError(f"not a zip payload: {r.content[:60]!r}")
    print(f"[mapbiomas] downloaded {len(r.content) / 1e6:.1f} MB")
    return r.content


def _read_coverage(archive: bytes):
    import pandas as pd

    zf = zipfile.ZipFile(io.BytesIO(archive))
    member = max(zf.infolist(), key=lambda i: i.file_size)
    print(f"[mapbiomas] reading {member.filename} "
          f"({member.file_size / 1e6:.1f} MB)")
    return pd.read_excel(io.BytesIO(zf.read(member)), sheet_name=_SHEET)


def _build(df) -> dict:
    years = sorted(
        int(c[1:]) for c in df.columns
        if re.fullmatch(r"y\d{4}", str(c))
    )
    if len(years) < _MIN_YEARS:
        raise RuntimeError(f"only {len(years)} year columns; source changed?")
    ycols = [f"y{y}" for y in years]

    coffee = df[df["class"] == _COFFEE_CLASS].copy()
    if coffee.empty:
        raise RuntimeError(f"no class {_COFFEE_CLASS} rows; legend changed?")

    # One row per municipality: a municipality spanning two biomes is split
    # across rows in the source and must be summed, not overwritten.
    grouped = (coffee.groupby(["geocode", "municipality", "state"], as_index=False)[ycols]
               .sum())

    municipalities = []
    for row in grouped.itertuples(index=False):
        series = [round(float(getattr(row, c))) for c in ycols]
        if not any(series):
            continue  # never grew coffee in any year — omit to keep the file small
        geocode = str(row.geocode)
        municipalities.append({
            "geocode": geocode,
            "name": row.municipality,
            "state": row.state,
            "uf": _UF_BY_CODE.get(geocode[:2], ""),
            "series": series,
        })
    municipalities.sort(key=lambda m: m["series"][-1], reverse=True)

    if len(municipalities) < _MIN_MUNICIPALITIES:
        raise RuntimeError(
            f"only {len(municipalities)} municipalities with coffee; expected "
            f">={_MIN_MUNICIPALITIES}")

    # State rollup, for a coarser view and for cross-checks.
    by_state: dict[str, list[int]] = {}
    for m in municipalities:
        acc = by_state.setdefault(m["state"], [0] * len(years))
        for i, v in enumerate(m["series"]):
            acc[i] += v
    states = [{"state": s, "series": v} for s, v in
              sorted(by_state.items(), key=lambda kv: kv[1][-1], reverse=True)]

    total = [sum(m["series"][i] for m in municipalities) for i in range(len(years))]
    latest = total[-1]
    if not _BRAZIL_HA_RANGE[0] <= latest <= _BRAZIL_HA_RANGE[1]:
        raise RuntimeError(
            f"Brazil {years[-1]} total {latest:,.0f} ha outside sane range "
            f"{_BRAZIL_HA_RANGE} — class code or units changed?")

    print(f"[mapbiomas] {len(municipalities):,} municipalities, "
          f"{years[0]}–{years[-1]}, {latest / 1e6:.2f} M ha in {years[-1]}")
    for m in municipalities[:5]:
        print(f"[mapbiomas]   {m['name']} ({m['uf']}) {m['series'][-1]:,} ha")

    return {
        "updated": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": "MapBiomas Collection 11 — class 46 (Coffee)",
        "source_url": _STATS_PAGE,
        "licence": "CC BY-SA 4.0 — MapBiomas Project",
        "unit": "hectares",
        "caveat": (
            "Satellite footprint at 30 m, not a production census. MapBiomas "
            "under-detects shaded, intercropped and young coffee, totalling "
            f"~{latest / 1e6:.2f} M ha against CONAB's ~2.2 M ha. Use for where "
            "coffee is and how it changes, not for absolute area."
        ),
        "years": years,
        "brazil_total": total,
        "states": states,
        "municipalities": municipalities,
    }


def run() -> dict | None:
    """Fetch, transform and write. Leaves the existing file alone on failure."""
    try:
        payload = _build(_read_coverage(_download(_find_drive_id())))
    except Exception as e:  # noqa: BLE001
        print(f"[mapbiomas] FAILED: {e} — retaining existing file")
        return None

    _OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(_OUT_PATH, payload, indent=None, separators=(",", ":"))
    print(f"[mapbiomas] wrote {_OUT_PATH} "
          f"({_OUT_PATH.stat().st_size / 1e6:.2f} MB)")
    return payload


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(0 if run() else 1)
