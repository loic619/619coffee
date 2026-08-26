"""
ice_publish_times.py — when ICE actually publishes the robusta stock report.

Why this exists
===============
The London robusta certified-stock CSV is served under a filename stamped with
the exact SECOND it was generated:

    …/marketdata/…/RobustaStockReport_YYYYMMDD_HHMMSS.csv

There is no index and no "latest" alias, so the only way to fetch it is to
already know that second — and ICE's /marketdata/ host 429s any concurrency
(two parallel GETs once drew a Retry-After of 3600). Workflow 1.13 therefore
guesses sequentially: first the seconds that have worked before, then a
one-request-every-4s sweep of the publish window.

That makes the publish-time distribution the single most valuable thing the
scraper knows about itself. Every second of spread costs a GET, every GET costs
4 seconds of billed runner time, and the shape of this distribution is what
decides whether a day is found in one minute or forty.

`stock_report_hits.json` is the raw record — one entry per date, appended each
time a fetch succeeds, committed back by the workflow so the guesser learns
across runs. This exporter turns it into the published summary the Research tab
reads: the per-minute histogram, the quantiles, and the coverage the current
sweep window buys.

Output: frontend/public/data/ice_publish_times.json
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from scraper.exporters.base import OUT_DIR

HITS = (Path(__file__).resolve().parents[1] / "sources" / "ice_certified_stocks"
        / "stock_report_hits.json")

# Mirrors STOCK_REPORT_SWEEP_RANGE in the orchestrator. Kept as data here so the
# published summary can state what the sweep covers without importing the
# scraper (which pulls requests + the whole ICE module tree).
SWEEP_START_S = 10 * 3600 + 30 * 60          # 10:30:00
SWEEP_END_S = 11 * 3600 + 15 * 60 + 59       # 11:15:59
TIER1_K = 10                                  # top-K seconds retried, each ±2s
SWEEP_INTERVAL_S = 4.0                        # one GET every 4s during the sweep


def _secs(hhmmss: str) -> int | None:
    try:
        return int(hhmmss[:2]) * 3600 + int(hhmmss[2:4]) * 60 + int(hhmmss[4:6])
    except (ValueError, IndexError):
        return None


def _hms(x: int) -> str:
    return f"{x // 3600:02d}:{x % 3600 // 60:02d}:{x % 60:02d}"


def _quantile(sorted_vals: list[int], q: float) -> int:
    if not sorted_vals:
        return 0
    idx = min(len(sorted_vals) - 1, max(0, int(round(q * (len(sorted_vals) - 1)))))
    return sorted_vals[idx]


def build() -> dict:
    raw = json.loads(HITS.read_text(encoding="utf-8")).get("hits", [])
    # "bootstrap" rows are the hardcoded seed guesses shipped before any real
    # capture existed — they are not observations and must not skew the stats.
    obs = [(h["date"], _secs(h["hhmmss"]), h["hhmmss"])
           for h in raw
           if h.get("date") != "bootstrap" and _secs(h.get("hhmmss", "")) is not None]
    obs.sort()
    vals = sorted(s for _d, s, _t in obs)

    by_minute = Counter(s // 60 * 60 for s in vals)
    minutes = [{"minute": _hms(m)[:5], "count": n,
                "share": round(n / len(vals), 4) if vals else 0}
               for m, n in sorted(by_minute.items())]

    # Cumulative coverage — "by 10:33 we have seen 64% of publishes" is the
    # number that decides how early the sweep can give up.
    cum, run = [], 0
    for m, n in sorted(by_minute.items()):
        run += n
        cum.append({"through": _hms(m)[:5], "share": round(run / len(vals), 4)})

    exact = Counter(t for _d, _s, t in obs)
    repeats = sum(1 for _t, n in exact.items() if n > 1)

    return {
        "note": "Observed publish times of the ICE London robusta certified-stock CSV. "
                "The file is served under an HHMMSS-stamped URL with no index, so these "
                "are the seconds workflow 1.13 has to guess.",
        "source": "backend/scraper/sources/ice_certified_stocks/stock_report_hits.json",
        "captures": len(obs),
        "first_date": obs[0][0] if obs else None,
        "last_date": obs[-1][0] if obs else None,
        "earliest": _hms(vals[0]) if vals else None,
        "latest": _hms(vals[-1]) if vals else None,
        "median": _hms(_quantile(vals, 0.5)) if vals else None,
        "p90": _hms(_quantile(vals, 0.9)) if vals else None,
        "distinct_seconds": len(exact),
        "seconds_seen_more_than_once": repeats,
        "by_minute": minutes,
        "cumulative": cum,
        "sweep": {
            "window": f"{_hms(SWEEP_START_S)[:5]}–{_hms(SWEEP_END_S)[:5]}",
            "candidate_seconds": SWEEP_END_S - SWEEP_START_S + 1,
            "interval_s": SWEEP_INTERVAL_S,
            "tier1_k": TIER1_K,
            "observed_max_offset_s": (vals[-1] - SWEEP_START_S) if vals else None,
            "days_inside_window": sum(1 for s in vals if SWEEP_START_S <= s <= SWEEP_END_S),
        },
        "days": [{"date": d, "time": _hms(s)} for d, s, _t in obs],
    }


def export_ice_publish_times() -> None:
    if not HITS.exists():
        print("  ice_publish_times → skipped (no hits file)")
        return
    doc = build()
    (OUT_DIR / "ice_publish_times.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"  ice_publish_times → {doc['captures']} captures, "
          f"{doc['earliest']}–{doc['latest']} (median {doc['median']})")


if __name__ == "__main__":
    export_ice_publish_times()
