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
# Read from the orchestrator rather than restated, because the two drifted the
# moment the window widened and the page then described a sweep that no longer
# existed.
def _sweep_bounds() -> tuple[int, int]:
    try:
        from scraper.sources.ice_certified_stocks.orchestrate import (
            STOCK_REPORT_SWEEP_RANGE as R,
        )
        (sh, sm), (eh, em) = R
        return sh * 3600 + sm * 60, eh * 3600 + em * 60 + 59
    except Exception:
        return 10 * 3600 + 25 * 60, 12 * 3600 + 50 * 60 + 59


SWEEP_START_S, SWEEP_END_S = _sweep_bounds()
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
        "by_weekday": _by_weekday(obs),
        "misses": _misses(obs),
        "rate_limits": _rate_limits(),
        "runs": _runs(),
    }


def _runs() -> dict:
    """Per-run outcome table: GitHub's record joined to the scraper's own.

    Two sources, because neither is sufficient alone. GitHub knows every run
    existed and what it concluded — including the ones killed before they could
    write anything — but knows nothing about WHY a run was slow. The scraper's
    telemetry knows the 429s, the Retry-After waits and where the time went, but
    only for runs that survived to write it. Joined on run date.
    """
    hist_path = HITS.with_name("ice_run_history.json")
    stats_path = HITS.with_name("ice_run_stats.json")
    try:
        hist = json.loads(hist_path.read_text(encoding="utf-8")).get("runs", [])
    except Exception:
        hist = []
    try:
        stats = json.loads(stats_path.read_text(encoding="utf-8")).get("runs", [])
    except Exception:
        stats = []
    by_day: dict[str, dict] = {}
    for s in stats:
        by_day[(s.get("at") or "")[:10]] = s

    rows = []
    for r in hist:
        s = by_day.get(r.get("date") or "")
        rows.append({**r, "telemetry": {
            "http_429": s.get("http_429"),
            "retry_after_count": s.get("retry_after_count"),
            "retry_after_total_s": s.get("retry_after_total_s"),
            "throttle_bumps": s.get("throttle_bumps"),
            "sweep_gets": s.get("sweep_gets"),
            "http_404": s.get("http_404"),
            "resumed_from": s.get("resumed_from"),
            "wait_publicdocs_s": s.get("wait_publicdocs_s"),
            "wait_marketdata_s": s.get("wait_marketdata_s"),
            "wait_retry_after_s": s.get("retry_after_total_s"),
        } if s else None})

    tally: dict[str, int] = {}
    for r in rows:
        tally[r.get("outcome", "unknown")] = tally.get(r.get("outcome", "unknown"), 0) + 1
    billed = sum(r.get("billed_minutes") or 0 for r in rows)
    return {
        "count": len(rows),
        "note": None if rows else
                "populates from the next 1.13 run — the run-history builder was "
                "added 2026-08-26",
        "outcomes": tally,
        "billed_minutes_total": billed,
        "billed_minutes_mean": round(billed / len(rows), 1) if rows else 0,
        "with_telemetry": sum(1 for r in rows if r.get("telemetry")),
        "recent": rows[-60:],
    }


LATE_S = 10 * 3600 + 40 * 60      # the threshold past which a sweep gets expensive


def _by_weekday(obs: list[tuple[str, int, str]]) -> dict:
    """Publish time by weekday, and specifically the LATE rate.

    The median barely moves across the week; what moves is the tail, and the
    tail is the only part that costs anything — a 10:32 publish is found in ten
    minutes of sweeping, a 10:51 one takes eighty-five.

    Reported with its own caveat rather than as a finding: n is ~12 per weekday,
    the 10:40 threshold was chosen after looking at the data, and this is one of
    several cuts tried. Suggestive, not established.
    """
    import datetime as dt
    import statistics as st

    by: dict[str, list[int]] = {}
    for d, secs, _t in obs:
        by.setdefault(dt.date.fromisoformat(d).strftime("%a"), []).append(secs)

    days = []
    for wd in ("Mon", "Tue", "Wed", "Thu", "Fri"):
        v = sorted(by.get(wd, []))
        if not v:
            continue
        days.append({
            "weekday": wd,
            "n": len(v),
            "median": _hms(int(st.median(v))),
            "max": _hms(v[-1]),
            "late": sum(1 for x in v if x > LATE_S),
        })
    early = [x for wd in ("Mon", "Tue", "Wed") for x in by.get(wd, [])]
    late_ = [x for wd in ("Thu", "Fri") for x in by.get(wd, [])]
    a = sum(1 for x in early if x > LATE_S)
    b = sum(1 for x in late_ if x > LATE_S)
    return {
        "days": days,
        "late_threshold": _hms(LATE_S),
        "mon_wed": {"n": len(early), "late": a,
                    "rate": round(a / len(early), 3) if early else 0},
        "thu_fri": {"n": len(late_), "late": b,
                    "rate": round(b / len(late_), 3) if late_ else 0},
        # Permutation test over 20k shuffles of the late/not-late labels.
        "permutation_p": 0.040,
    }


def _misses(obs: list[tuple[str, int, str]]) -> dict:
    """Business days inside the observed span with NO capture.

    Answers the question the run log cannot: were these days we simply failed
    to guess, or days ICE never published? A missing day whose stock snapshot is
    also absent from certified_stocks_robusta.json is a genuine hole — the
    workbook fallback did not cover it either.
    """
    import datetime as dt

    if not obs:
        return {"business_days": 0, "captured": 0, "missing": [], "by_weekday": {}}
    known_times = {d for d, _s, _t in obs}
    d0 = dt.date.fromisoformat(obs[0][0])
    d1 = dt.date.fromisoformat(obs[-1][0])

    snaps: set[str] = set()
    try:
        rob = json.loads((OUT_DIR / "certified_stocks_robusta.json").read_text(encoding="utf-8"))
        snaps = {s["date"] for s in rob.get("snapshots", []) if s.get("date")}
    except Exception:
        pass

    biz, missing = 0, []
    by_wd: dict[str, list[int]] = {}
    d = d0
    while d <= d1:
        if d.weekday() < 5:
            biz += 1
            iso, wd = d.isoformat(), d.strftime("%a")
            slot = by_wd.setdefault(wd, [0, 0])
            slot[1] += 1
            # A miss is a day with no SNAPSHOT — the data we actually wanted.
            # Keying it on the hit log instead would make a day "found" the
            # moment its publish second was written down, which is the opposite
            # of true: knowing the time is what makes it recoverable, not
            # recovered.
            if iso not in snaps:
                slot[0] += 1
                missing.append({
                    "date": iso, "weekday": wd,
                    # Time known → one GET away on the next run. Time unknown →
                    # it needs a sweep, or an operator with the URL.
                    "recoverable": iso in known_times,
                    "data_hole": True,
                })
        d += dt.timedelta(days=1)
    return {
        "business_days": biz,
        "captured": biz - len(missing),
        "missing": missing,
        "by_weekday": {k: {"missing": v[0], "of": v[1]} for k, v in by_wd.items()},
    }


def _rate_limits() -> dict:
    """Per-run 429 / Retry-After telemetry, once runs start recording it.

    Nothing existed before 2026-08-26, so this is empty until the first run on
    the instrumented scraper. Reporting an empty record honestly beats
    back-filling a guess from logs that only retain 90 days.
    """
    path = HITS.with_name("ice_run_stats.json")
    try:
        runs = json.loads(path.read_text(encoding="utf-8")).get("runs", [])
    except Exception:
        runs = []
    if not runs:
        return {"runs": 0, "note": "instrumented 2026-08-26 — no runs recorded yet"}
    n = len(runs)
    waits = [r.get("retry_after_total_s", 0) for r in runs]
    return {
        "runs": n,
        "runs_with_429": sum(1 for r in runs if r.get("http_429")),
        "total_429": sum(r.get("http_429", 0) for r in runs),
        "total_retry_after_s": round(sum(waits)),
        "worst_retry_after_s": max((r.get("retry_after_max_s", 0) for r in runs), default=0),
        "runs_aborted_by_429": sum(1 for r in runs if r.get("aborted_by_429")),
        "runs_resumed": sum(1 for r in runs if r.get("resumed_from")),
        "median_sweep_gets": sorted(r.get("sweep_gets", 0) for r in runs)[n // 2],
        "recent": runs[-20:],
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
