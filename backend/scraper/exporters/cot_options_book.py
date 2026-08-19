"""
cot_options_book.py — publish the CFTC options book for the COT tab.

Reads data/cftc_options_book.json (produced by sources/cftc_options_book.py,
which fetches BOTH CFTC disaggregated files and subtracts) and shapes it for
the "Options book" section: the per-cohort delta-equivalent options position
the futures-only feed omits, its share of each cohort's futures net, and how
that has trended.

Publishes an empty-but-valid document when the source file is absent, so the
section can ship before the first Actions run rather than crashing.

Writes frontend/public/data/cot_options_book.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR, ROOT

SRC = ROOT / "data" / "cftc_options_book.json"
OUT = OUT_DIR / "cot_options_book.json"

COHORT_LABELS = {
    "mm": "Managed money",
    "pmpu": "Producer / merchant",
    "swap": "Swap dealers",
    "other": "Other reportables",
    "nonrept": "Non-reportable",
}
TREND_WEEKS = 156       # ~3y of the published series
RECENT = 52


def _r(x, n: int = 1):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def export_cot_options_book():
    src = _load(SRC)
    hist = (src or {}).get("history") or []

    if not hist:
        OUT.write_text(json.dumps({
            "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "available": False,
            "reason": "cftc_options_book.json not fetched yet — runs on GitHub Actions "
                      "(cftc.gov is unreachable from some environments).",
            "cohorts": [], "series": [], "latest": None,
        }, ensure_ascii=False), encoding="utf-8")
        print("  cot_options_book.json → source not present; published empty shell")
        return

    series = [{
        "date": r["date"],
        **{k: r[k]["opt_net"] for k in COHORT_LABELS if k in r},
        "oi_fut": r.get("oi_fut"), "oi_com": r.get("oi_com"),
    } for r in hist[-TREND_WEEKS:]]

    last = hist[-1]
    recent = hist[-RECENT:]
    cohorts = []
    for key, label in COHORT_LABELS.items():
        if key not in last:
            continue
        cur = last[key]
        opts = [r[key]["opt_net"] for r in recent if key in r]
        futs = [abs(r[key]["fut_net"]) for r in recent if key in r]
        share = (st.mean(abs(o) for o in opts) / st.mean(futs) * 100) if futs and st.mean(futs) else None
        cohorts.append({
            "key": key, "label": label,
            "fut_net": cur["fut_net"], "com_net": cur["com_net"], "opt_net": cur["opt_net"],
            "opt_long": cur["opt_long"], "opt_short": cur["opt_short"],
            "share_of_fut_pct": _r(cur["opt_net"] / abs(cur["fut_net"]) * 100, 1) if cur["fut_net"] else None,
            "avg_abs_share_52w_pct": _r(share, 1),
            "min_52w": min(opts) if opts else None, "max_52w": max(opts) if opts else None,
        })

    oi_gap = last.get("oi_com", 0) - last.get("oi_fut", 0)
    out = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "available": True,
        "source": (src or {}).get("source"),
        "note": (src or {}).get("note"),
        "weeks": len(hist), "span": [hist[0]["date"], last["date"]],
        "latest": {
            "date": last["date"], "oi_fut": last.get("oi_fut"), "oi_com": last.get("oi_com"),
            "oi_options": oi_gap,
            "oi_options_pct": _r(oi_gap / last["oi_fut"] * 100, 1) if last.get("oi_fut") else None,
        },
        "cohorts": cohorts,
        "series": series,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    mm = next((c for c in cohorts if c["key"] == "mm"), None)
    print(f"  cot_options_book.json → {len(hist)} weeks; latest options OI {oi_gap:,} "
          f"({out['latest']['oi_options_pct']}% of futures OI); MM opt_net "
          f"{mm['opt_net'] if mm else '—'}")


if __name__ == "__main__":
    export_cot_options_book()
