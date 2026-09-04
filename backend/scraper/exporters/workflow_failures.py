"""workflow_failures.py — the failure taxonomy, shaped for the research page.

The study (research_workflow_failures) does the classification. This only
arranges it and adds the one series the page needs that would be wrong to
compute in the browser: failures per day split by lane, so the reader can see
that operational failures are a thin, flat line under a spiky CI one rather
than inferring it from two totals.

Output: frontend/public/data/workflow_failures.json
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from scraper.exporters.base import OUT_DIR

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "data" / "workflow_failures.json"


def daily_by_lane(runs: list[dict]) -> list[dict]:
    """One row per day: failures in each lane.

    Every day in the span appears, including zero days — a bar chart that skips
    quiet days makes a sporadic problem look continuous.
    """
    if not runs:
        return []
    by: dict[str, dict[str, int]] = defaultdict(
        lambda: {"pre-merge": 0, "retired": 0, "operational": 0})
    for r in runs:
        by[r["created_at"][:10]][r.get("lane", "operational")] += 1
    days = sorted(by)
    from datetime import date, timedelta
    d0 = date.fromisoformat(days[0])
    d1 = date.fromisoformat(days[-1])
    out = []
    d = d0
    while d <= d1:
        k = d.isoformat()
        row = by.get(k, {"pre-merge": 0, "retired": 0, "operational": 0})
        out.append({"date": k, **row, "total": sum(row.values())})
        d += timedelta(days=1)
    return out


def export_workflow_failures() -> None:
    if not REPORT.exists():
        print(f"  workflow_failures.json: no study report at {REPORT} — skipped")
        return
    d = json.loads(REPORT.read_text(encoding="utf-8"))
    runs = d.get("runs") or []
    payload = {
        "question": d.get("question"),
        "total_failed_runs_reported_by_api": d.get("total_failed_runs_reported_by_api"),
        "sample_span": d.get("sample_span"),
        "sampling_note": d.get("sampling_note"),
        "categories": d.get("categories"),      # code -> label
        "lanes": d.get("lanes"),                # lane -> label
        "n": d.get("n"),
        "category_counts": d.get("category_counts"),
        "lane_counts": d.get("lane_counts"),
        "deductions": d.get("deductions"),
        "actionable": d.get("actionable"),
        "actionable_pct": d.get("actionable_pct"),
        "workflows": d.get("workflows"),
        "daily": daily_by_lane(runs),
    }
    (OUT_DIR / "workflow_failures.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
