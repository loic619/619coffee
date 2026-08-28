"""vn_midmonth.py — the first-half share of Vietnam's monthly coffee exports.

Reads the study report produced by `research_vn_midmonth` and shapes it for the
research page. The study does the crawling and the arithmetic; this only
arranges it, and adds the two aggregations the page needs that would be wrong
to compute in the browser:

  * a per-YEAR roll-up, so the chart's x-axis can switch between months and
    years. A year is shown as a RANGE, not a single average — averaging twelve
    months into one dot is exactly the move that makes a variable series look
    settled, which is the thing this study exists to disprove.
  * a histogram, binned here so the bin edges are fixed and reproducible
    rather than a function of whatever the chart library picks.

Defective months are carried through, flagged. They are excluded from every
statistic and from the histogram, and kept in `points` so the page can draw
them and say why. See `research_vn_midmonth.pair_defect`.

Output: frontend/public/data/vn_midmonth.json
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

from scraper.exporters.base import OUT_DIR

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "data" / "vn_midmonth_ratio.json"

# Fixed bin edges, 5 percentage points wide across the plausible range. Chosen
# here rather than left to the chart so the shape cannot change when the sample
# grows by a month.
BIN_LO, BIN_HI, BIN_W = 0.25, 0.75, 0.05


def year_rollup(points: list[dict]) -> list[dict]:
    """Per-year summary of the VALID months only, carrying its own spread."""
    by_year: dict[str, list[float]] = {}
    for p in points:
        if p.get("valid"):
            by_year.setdefault(p["month"][:4], []).append(p["ratio"])
    out = []
    for year in sorted(by_year):
        rs = sorted(by_year[year])
        out.append({
            "year": year,
            "n": len(rs),
            "mean": round(statistics.mean(rs), 4),
            "median": round(statistics.median(rs), 4),
            "min": round(rs[0], 4),
            "max": round(rs[-1], 4),
        })
    return out


def histogram(points: list[dict]) -> list[dict]:
    """Counts of valid ratios per fixed bin, lower edge inclusive."""
    rs = [p["ratio"] for p in points if p.get("valid")]
    bins: list[dict] = []
    edge = BIN_LO
    while edge < BIN_HI - 1e-9:
        hi = round(edge + BIN_W, 4)
        bins.append({
            "lo": round(edge, 4),
            "hi": hi,
            "mid": round(edge + BIN_W / 2, 4),
            "count": sum(1 for r in rs if edge <= r < hi),
        })
        edge = hi
    return bins


def export_vn_midmonth() -> None:
    if not REPORT.exists():
        print(f"  vn_midmonth.json: no study report at {REPORT} — skipped")
        return
    d = json.loads(REPORT.read_text(encoding="utf-8"))
    pairs = d.get("pairs") or []

    points = [{
        "month": p["month"],
        "ratio": p.get("ratio"),
        "pct": round(100 * p["ratio"], 2) if p.get("ratio") else None,
        "k1_tonnes": p.get("k1_tonnes"),
        "full_tonnes": p.get("full_tonnes"),
        "valid": bool(p.get("valid", True)),
        "defect": p.get("defect"),
        "url": p.get("url"),
    } for p in sorted(pairs, key=lambda z: z["month"])]

    payload = {
        "question": d.get("question"),
        "method": d.get("method"),
        "note": ("Every month the crawl paired is here, including the one that is "
                 "arithmetically impossible. Defective months are flagged, drawn, and "
                 "excluded from the statistics — not dropped."),
        "months_requested": d.get("months_requested"),
        "months_paired": len(points),
        "months_missing_k1": d.get("months_missing_k1") or [],
        "stats": d.get("stats") or {},
        "points": points,
        "by_year": year_rollup(points),
        "histogram": histogram(points),
        "bin_width": BIN_W,
    }
    (OUT_DIR / "vn_midmonth.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
