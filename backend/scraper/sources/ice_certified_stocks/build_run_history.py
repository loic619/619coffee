"""
build_run_history.py — per-run outcome record for workflow 1.13.

The scraper's own telemetry (ice_run_stats.json) only exists from 2026-08-26
onward, and it can only describe runs that got far enough to write it. A run
killed by the 120-minute timeout, or cancelled in the concurrency queue before
it started, never records anything about itself.

GitHub knows those. This walks the Actions API for 1.13 and writes one row per
run — when, what triggered it, what it concluded, how long the JOB actually ran
(not the run, which includes queue time and is not billed), and which step was
in flight when it ended. That last field is what distinguishes "timed out inside
the sweep" from "cancelled before it did any work".

Classification
==============
    success            completed and committed
    timeout            ran to (or past) the job timeout — the sweep never found
                       the file, or found it too late
    queue_cancelled    cancelled with almost no runtime: the concurrency group
                       holds one queued run and drops the pending one when a
                       third arrives. Costs nothing but produces nothing.
    cancelled          cancelled mid-run for some other reason
    failure            the step exited non-zero

Run:  cd backend && GH_TOKEN=... python -m scraper.sources.ice_certified_stocks.build_run_history
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

REPO = os.environ.get("GH_REPO", "loic619/619coffee")
WORKFLOW = "scraper-ice-certified-stocks.yml"
OUT = Path(__file__).with_name("ice_run_history.json")
TIMEOUT_MIN = 120          # `timeout-minutes:` in the workflow
QUEUE_CANCEL_MAX_S = 90    # below this, a cancelled run never really started
KEEP = 400


def _api(path: str) -> dict:
    tok = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={"Accept": "application/vnd.github+json",
                 "User-Agent": "619coffee-run-history",
                 **({"Authorization": f"Bearer {tok}"} if tok else {})},
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read())


def _secs(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return int((datetime.strptime(b, fmt) - datetime.strptime(a, fmt)).total_seconds())


def _classify(conclusion: str, job_s: int | None) -> str:
    if conclusion == "success":
        return "success"
    if conclusion == "failure":
        return "failure"
    if conclusion == "cancelled":
        if job_s is None or job_s <= QUEUE_CANCEL_MAX_S:
            return "queue_cancelled"
        # GitHub reports a job killed by `timeout-minutes` as cancelled. Allow a
        # minute of slack for the runner's own teardown.
        if job_s >= (TIMEOUT_MIN - 1) * 60:
            return "timeout"
        return "cancelled"
    return conclusion or "unknown"


def build(max_runs: int = KEEP) -> list[dict]:
    rows: list[dict] = []
    page = 1
    while len(rows) < max_runs:
        data = _api(f"/repos/{REPO}/actions/workflows/{WORKFLOW}/runs"
                    f"?per_page=100&page={page}")
        runs = data.get("workflow_runs") or []
        if not runs:
            break
        for r in runs:
            job_s = last_step = None
            try:
                jobs = _api(f"/repos/{REPO}/actions/runs/{r['id']}/jobs").get("jobs") or []
                if jobs:
                    j = jobs[0]
                    job_s = _secs(j.get("started_at"), j.get("completed_at"))
                    # The step that was in flight when the job ended.
                    done = [s for s in (j.get("steps") or []) if s.get("conclusion")]
                    running = [s for s in (j.get("steps") or []) if not s.get("conclusion")]
                    last_step = (running[0]["name"] if running
                                 else done[-1]["name"] if done else None)
            except Exception as e:  # noqa: BLE001 — a missing job must not stop the walk
                print(f"  ! jobs for {r['id']}: {e}", file=sys.stderr)
            rows.append({
                "id": r["id"],
                "date": (r.get("run_started_at") or r.get("created_at") or "")[:10],
                "started": r.get("run_started_at"),
                "event": r.get("event"),
                "conclusion": r.get("conclusion"),
                "attempt": r.get("run_attempt"),
                # Job seconds, not run seconds: queue time is not billed.
                "job_seconds": job_s,
                "billed_minutes": (job_s + 59) // 60 if job_s else 0,
                "last_step": last_step,
                "outcome": _classify(r.get("conclusion") or "", job_s),
            })
            if len(rows) >= max_runs:
                break
        page += 1
    rows.sort(key=lambda x: x.get("started") or "")
    return rows


def main() -> int:
    rows = build()
    OUT.write_text(json.dumps({"runs": rows}, indent=1) + "\n", encoding="utf-8")
    tally: dict[str, int] = {}
    for r in rows:
        tally[r["outcome"]] = tally.get(r["outcome"], 0) + 1
    billed = sum(r["billed_minutes"] for r in rows)
    print(f"[run-history] {len(rows)} runs → {OUT.name}")
    print(f"[run-history] outcomes: {tally}")
    print(f"[run-history] billed: {billed} min total, "
          f"{billed / max(1, len(rows)):.1f} min/run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
