"""research_workflow_failures.py — what a failed workflow run actually means.

This repo runs 94 workflows and the Actions API reports 847 failed runs. Read
as a failure rate that number is alarming and useless, because it counts four
unlike things as one:

    a lint error on a branch          caught before merge; nothing shipped
    a workflow that no longer exists  failures frozen at its retirement date
    a freshness check exiting 1       the check WORKING — data is stale
    a scraper that could not fetch    the only one that is a system failure

The first three are not application failures. Counting them together is what
makes a dashboard everyone learns to ignore.

So this module does two things: it classifies each failure, and — more
importantly — it separates the LANE a failure happened in from its CATEGORY.
The lane is what decides whether anyone should care.

    CATEGORY  what broke            A-E, below
    LANE      where it broke        pre-merge | retired | operational

The headline metric is the ACTIONABLE failure rate: raw failures minus the
pre-merge gate, minus workflows that no longer exist, minus runs that exit
non-zero by design. On the 2026-07/09 sample that takes 240 failures down to
27 — and those 27 are the entire real maintenance surface.

    python -m backend.scraper.research_workflow_failures
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

_HERE = Path(__file__).resolve()
ROOT = _HERE.parents[2]
RAW = ROOT / "data" / "workflow_failures_raw.json"
REPORT = ROOT / "data" / "workflow_failures.json"

# ── the taxonomy ────────────────────────────────────────────────────────────
CATEGORIES = {
    "A": "Deterministic code failure",
    "B": "External transient",
    "C": "External persistent / dead source",
    "D": "Intentional non-zero",
    "E": "Duplicate / recovery failure",
}

LANES = {
    "pre-merge":   "Caught before merge — nothing shipped",
    "retired":     "Workflow no longer exists",
    "operational": "Scheduled or chained job on main",
}

# Workflows whose failure meaning is KNOWN, from their own source and logs.
# `confident` marks the ones read directly from a failing run's log or from the
# workflow's own exit semantics, as opposed to inferred from repo history — the
# page shows the difference rather than presenting both at one confidence.
KNOWN: dict[str, tuple[str, str, bool, str]] = {
    # name: (category, lane, confident, evidence)
    "9.1 – CI Tests": ("A", "pre-merge", True, "test assertions on push/PR"),
    "9.2 – Backend Lint": ("A", "pre-merge", True, "ruff findings on push/PR"),
    "9.3 – Smart-quote guard (TS/TSX)": ("A", "pre-merge", True, "guard rejects smart quotes"),
    "9.4 – CI Frontend": ("A", "pre-merge", True, "tsc/eslint/build on push/PR"),

    "1.6 – Morning Brief": (
        "A", "retired", True,
        "workflow deleted 2026-08-14; its failures stop on exactly that date"),

    "1.5 – Check Data Pipeline Freshness": (
        "D", "operational", True,
        "exits 1 BECAUSE a source/exporter/artifact is stale — the check working"),
    "1.8 – Check Live Quotes Freshness": (
        "D", "operational", True,
        "notify() ends in exit 1 when live_quotes is stale, and dispatches a rescue poll"),

    "1.11 – Port Activity Scraper (PortWatch)": (
        "C", "operational", True,
        "log: 'A configured port produced no data' — HTTP fine, payload empty"),
    "1.10 – Daily Weather Fetch & Accumulate": (
        "A", "operational", True,
        "log: exit 1 after the model step, on a feature-dimension drop"),
    "Z – Backfill: per-contract prices to 10y (manual)": (
        "C", "operational", True,
        "log: HTTP 403 on every contract — Barchart refusing the runner"),

    "1.7 – Cecafe Daily Registration": (
        "B", "operational", False,
        "site intermittently unreachable from runners (scraper retries 3x, keeps last good)"),
    "1.1 – Daily News Scraper": ("B", "operational", False, "upstream fetch failures"),
    "0.1 – Acaphe Live Quotes Poll": (
        "E", "operational", False,
        "failures on workflow_dispatch — rescue runs dispatched by 1.8, not scheduled polls"),
    "1.13 – ICE Certified Stocks (arabica + robusta)": (
        "C", "operational", False, "ICE WAF blocks plain requests"),
    "1.14 – ICE Monthly Reports (arabica ageing + robusta age-allowance)": (
        "C", "operational", False, "monthly file 404s until ICE publishes, sometimes weeks late"),
}


def classify(name: str) -> tuple[str, str, bool, str]:
    """(category, lane, confident, evidence) for one workflow's failures.

    Unknown workflows fall back on their numbering convention: the 9.x block is
    CI and therefore pre-merge; everything else is operational and assumed to be
    an external-source problem, which is the common case here and the one that
    does NOT flatter the result — an unknown counted as C stays in the
    actionable total rather than being explained away.
    """
    if name in KNOWN:
        return KNOWN[name]
    if name.startswith("9."):
        return ("A", "pre-merge", False, "CI workflow (inferred from numbering)")
    return ("C", "operational", False, "unclassified — counted as actionable, not excused")


def summarise(runs: list[dict]) -> dict:
    """Category counts, lane counts, and the actionable rate.

    `actionable` deliberately subtracts three things and nothing else. It does
    NOT subtract categories B or C: a transient that recurs is still a real
    source problem, and pretending otherwise is how a metric stops meaning
    anything.
    """
    cats, lanes = Counter(), Counter()
    per_wf: dict[str, dict] = defaultdict(
        lambda: {"n": 0, "events": Counter(), "durations": []})
    for r in runs:
        cat, lane, conf, ev = classify(r["name"])
        r["category"], r["lane"], r["confident"], r["evidence"] = cat, lane, conf, ev
        cats[cat] += 1
        lanes[lane] += 1
        w = per_wf[r["name"]]
        w["n"] += 1
        w["events"][r["event"]] += 1
        w["durations"].append(r.get("duration_s") or 0)
        w["category"], w["lane"], w["confident"], w["evidence"] = cat, lane, conf, ev

    n = len(runs)
    pre = lanes["pre-merge"]
    retired = lanes["retired"]
    intentional = cats["D"]
    actionable = n - pre - retired - intentional

    workflows = []
    for name, w in sorted(per_wf.items(), key=lambda kv: -kv[1]["n"]):
        ds = sorted(w["durations"])
        workflows.append({
            "name": name, "n": w["n"],
            "category": w["category"], "lane": w["lane"],
            "confident": w["confident"], "evidence": w["evidence"],
            "median_duration_s": ds[len(ds) // 2] if ds else 0,
            "events": dict(w["events"]),
        })

    return {
        "n": n,
        # NOT "categories"/"lanes": those names carry the LABEL dicts in the
        # report, and a same-named count dict silently replaced them.
        "category_counts": {c: cats.get(c, 0) for c in CATEGORIES},
        "lane_counts": {k: lanes.get(k, 0) for k in LANES},
        "deductions": [
            {"label": "Pre-merge CI — nothing shipped", "n": pre},
            {"label": "Retired workflow — no longer exists", "n": retired},
            {"label": "Intentional non-zero (category D)", "n": intentional},
        ],
        "actionable": actionable,
        "actionable_pct": round(100 * actionable / n, 1) if n else 0.0,
        "workflows": workflows,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(RAW))
    a = ap.parse_args(argv)
    p = Path(a.raw)
    if not p.exists():
        print(f"[wf-failures] no raw sample at {p}")
        return 1
    raw = json.loads(p.read_text(encoding="utf-8"))
    runs = raw.get("runs", [])
    out = {
        "question": "What does a failed workflow run actually mean here?",
        "total_failed_runs_reported_by_api": raw.get("total_failed_runs_reported_by_api"),
        "sample_span": raw.get("sample_span"),
        "sampling_note": raw.get("sampling_note"),
        "categories": CATEGORIES,
        "lanes": LANES,
        **summarise(runs),
        "runs": runs,
    }
    REPORT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"[wf-failures] n={out['n']} actionable={out['actionable']} "
          f"({out['actionable_pct']}%) -> {REPORT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
