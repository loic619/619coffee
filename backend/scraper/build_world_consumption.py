"""World consumption as a mean of estimates, not one house view.

The world balance sheet built its demand side from hub lines alone — Europe,
North America, Asia-Pacific and so on — and used their sum, 164.0 M bags, as
world consumption. Every independent estimate available sits well above that:
CCS 171.6, ICO 177.0, USDA-tracked ~178.0. Reporting one of four numbers as
the number is a house view wearing a statement's clothing.

So consumption now works exactly the way production already does on this
sheet: the headline is the MEAN of the sources, and the analyst's own
breakdown supplies the SHAPE, scaled to that headline. Hub lines stay fully
editable and stay meaningful — they say how the world drinks, not how much.

WHICH ESTIMATES, AND THE SEASON EACH REFERS TO
  internal  Our own hub build, summed from world_balance_sheet.json.
  ccs       CCS Coffee's world consumption row. Their most recent column is
            marked PRELIM and is deliberately excluded — a preliminary figure
            should not move a consensus.
  ico       ICO's published Total World Consumption.
  usda      USDA PSD, summed across the tracked consuming markets. It runs at
            ~100.5% of the ICO reference, so it is a world total in practice.

Consumption moves slowly, so a source whose latest published season is behind
the statement's crop year still contributes — but it carries `season` and is
marked `carried_forward`, so a stale estimate is visible rather than silently
weighted equal to a current one.

Run:  PYTHONPATH=. python -m scraper.build_world_consumption
"""
from __future__ import annotations

import json
import statistics
from datetime import UTC, datetime
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"
OUT_PATH = DATA / "world_consumption.json"

MT_PER_M_BAGS = 60_000
#: CCS marks its most recent column PRELIM; excluded from the consensus.
CCS_EXCLUDE_SEASONS = {"2024/25"}


def _load(name: str):
    try:
        return json.loads((DATA / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _internal(wb: dict | None) -> dict | None:
    """Our own hub build — the sum of the analyst-entered consumption lines."""
    if not wb:
        return None
    total = 0.0
    for line in wb.get("demand_hubs") or []:
        for leg in ("arabica_washed", "arabica_natural", "arabica", "robusta"):
            total += line.get(leg) or 0.0
    if total <= 0:
        return None
    return {"key": "internal", "label": "Our hubs", "season": wb.get("crop_year"),
            "m_bags": round(total, 1),
            "note": "Sum of the consumption-by-hub lines on this sheet"}


def _ccs(doc: dict | None) -> dict | None:
    if not doc:
        return None
    seasons = doc.get("seasons") or []
    series = ((doc.get("consumption") or {}).get("total")) or []
    usable = [(s, v) for s, v in zip(seasons, series, strict=False)
              if s not in CCS_EXCLUDE_SEASONS and v]
    if not usable:
        return None
    season, value = usable[-1]
    return {"key": "ccs", "label": "CCS Coffee", "season": season,
            "m_bags": round(float(value), 1),
            "note": "CCS world consumption; their PRELIM column is excluded"}


def _ico(ds: dict | None) -> dict | None:
    ref = ((ds or {}).get("world_consumption") or {}).get("ico_reference") or {}
    mt = ref.get("world_consumption_mt")
    if not mt:
        return None
    return {"key": "ico", "label": "ICO", "season": ref.get("marketing_year"),
            "m_bags": round(mt / MT_PER_M_BAGS, 1),
            "note": ref.get("source") or "ICO Coffee Market Report"}


def _usda(ds: dict | None) -> dict | None:
    wc = (ds or {}).get("world_consumption") or {}
    mt = wc.get("tracked_consumption_mt")
    if not mt:
        return None
    year = wc.get("tracked_latest_year")
    season = f"{int(year) - 1}/{str(int(year))[-2:]}" if str(year).isdigit() else None
    return {"key": "usda", "label": "USDA PSD", "season": season,
            "m_bags": round(mt / MT_PER_M_BAGS, 1),
            "note": f"Summed across {wc.get('tracked_countries', '?')} tracked consuming markets"}


def build() -> dict:
    wb = _load("world_balance_sheet.json")
    ds = _load("demand_stocks.json")
    crop_year = (wb or {}).get("crop_year")

    sources = [s for s in (_internal(wb), _ccs(_load("ccs_sd.json")), _ico(ds), _usda(ds)) if s]
    for s in sources:
        s["carried_forward"] = bool(crop_year and s.get("season") and s["season"] != crop_year)

    values = [s["m_bags"] for s in sources]
    mean = round(statistics.mean(values), 1) if values else None

    return {
        "generated": datetime.now(UTC).isoformat(timespec="seconds"),
        "crop_year": crop_year,
        "unit": "million 60-kg bags",
        "sources": sources,
        "mean": mean,
        "spread": [min(values), max(values)] if values else None,
        "note": (
            "World consumption as the mean of the available published estimates, mirroring how "
            "production is derived on this sheet. The hub lines supply the SHAPE of demand and are "
            "scaled to this headline, so they stay editable and stay meaningful — they say how the "
            "world drinks, not how much. A source whose latest season trails the statement's crop "
            "year is marked carried_forward: consumption moves slowly enough for it to be "
            "informative, but not so slowly that the staleness should be invisible."
        ),
    }


def export() -> None:
    doc = build()
    OUT_PATH.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    parts = ", ".join(f"{s['label']} {s['m_bags']}" for s in doc["sources"])
    print(f"[world-consumption] mean {doc['mean']} M bags from {len(doc['sources'])} estimates "
          f"({parts}) → {OUT_PATH.name}")


if __name__ == "__main__":
    export()
