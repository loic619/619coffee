#!/usr/bin/env python3
"""Build frontend/public/data/workflow_activity.json — a 7-day record of what
GitHub Actions actually RAN.

The sibling inventory (build_workflow_inventory.py) describes what the YAML
DECLARES: triggers, crons, dependencies. That is the plan. This script
records the execution: every run in the window, its conclusion, how it was
triggered and how long it took.

The gap between the two is the point. This session found six pipelines that
were green in every check while their data sat still — a workflow pruned
out from under its data file, a seed builder with no runner, a commit step
whose condition only matched manual dispatches. A declared cron proves
nothing; only a run record does. Reading the two side by side answers
questions the Actions tab cannot:

  · scheduled but never fired      → cron declared, zero runs in the window
  · fired far more than declared   → an unexpected trigger path
  · fires and fails quietly        → runs present, conclusion not success
  · fires, succeeds, changes nothing → visible via the health/freshness pair

Output (all times UTC):
  {
    "generated_at": ..., "window_days": 7, "since": ..., "repo": ...,
    "totals": {"runs":…, "success":…, "failure":…, "cancelled":…, "other":…},
    "days":  ["2026-08-19", …],                  # oldest → newest
    "workflows": [
      {"name":…, "file":…, "runs":…, "success":…, "failure":…, "cancelled":…,
       "by_day": [0,2,0,…],                      # aligned to `days`
       "events": {"schedule": 5, "workflow_dispatch": 1},
       "avg_seconds":…, "last_run":…, "last_conclusion":…}
    ]
  }

Auth: GITHUB_TOKEN (actions:read is enough). Runs in Actions; the dev
sandbox cannot reach api.github.com.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "workflow_activity.json"

WINDOW_DAYS = 7
PER_PAGE = 100
MAX_PAGES = 20          # 2,000 runs — far above a normal week


def _api(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "coffee-intel-activity",
    })
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read())


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("[activity] GITHUB_TOKEN / GITHUB_REPOSITORY unset — skipping", file=sys.stderr)
        return 1

    now = datetime.now(UTC)
    since = (now - timedelta(days=WINDOW_DAYS)).replace(microsecond=0)
    days = [(since + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(WINDOW_DAYS + 1)]
    day_idx = {d: i for i, d in enumerate(days)}

    runs: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        url = (f"https://api.github.com/repos/{repo}/actions/runs"
               f"?per_page={PER_PAGE}&page={page}&created=%3E%3D{since.strftime('%Y-%m-%d')}")
        try:
            batch = _api(url, token).get("workflow_runs") or []
        except urllib.error.HTTPError as e:
            print(f"[activity] API error page {page}: {e}", file=sys.stderr)
            return 1
        runs.extend(batch)
        if len(batch) < PER_PAGE:
            break

    agg: dict[str, dict] = {}
    totals = defaultdict(int)
    for r in runs:
        started = r.get("run_started_at") or r.get("created_at")
        if not started:
            continue
        ts = datetime.fromisoformat(started.replace("Z", "+00:00"))
        if ts < since:
            continue
        day = ts.strftime("%Y-%m-%d")
        if day not in day_idx:
            continue

        name = r.get("name") or "(unnamed)"
        a = agg.setdefault(name, {
            "name": name,
            "file": (r.get("path") or "").rsplit("/", 1)[-1],
            "runs": 0, "success": 0, "failure": 0, "cancelled": 0,
            "by_day": [0] * len(days),
            "events": defaultdict(int),
            "_secs": [], "last_run": None, "last_conclusion": None,
        })
        a["runs"] += 1
        a["by_day"][day_idx[day]] += 1
        a["events"][r.get("event") or "?"] += 1
        totals["runs"] += 1

        concl = r.get("conclusion")
        bucket = concl if concl in ("success", "failure", "cancelled") else "other"
        if bucket in a:
            a[bucket] += 1
        totals[bucket] += 1

        upd = r.get("updated_at")
        if upd:
            try:
                dur = (datetime.fromisoformat(upd.replace("Z", "+00:00")) - ts).total_seconds()
                if 0 <= dur < 6 * 3600:
                    a["_secs"].append(dur)
            except ValueError:
                pass
        # Runs arrive newest-first, so the first one seen per workflow is latest.
        if a["last_run"] is None:
            a["last_run"] = started
            a["last_conclusion"] = concl or r.get("status")

    out_wf = []
    for a in agg.values():
        secs = a.pop("_secs")
        a["avg_seconds"] = round(sum(secs) / len(secs)) if secs else None
        a["events"] = dict(sorted(a["events"].items(), key=lambda kv: -kv[1]))
        out_wf.append(a)
    out_wf.sort(key=lambda w: (-w["runs"], w["name"]))

    payload = {
        "generated_at": now.isoformat(),
        "window_days": WINDOW_DAYS,
        "since": since.isoformat(),
        "repo": repo,
        "totals": {k: totals[k] for k in ("runs", "success", "failure", "cancelled", "other")},
        "days": days,
        "workflows": out_wf,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    print(f"[activity] {totals['runs']} runs across {len(out_wf)} workflows "
          f"({totals['success']} ok / {totals['failure']} failed / {totals['cancelled']} cancelled)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
