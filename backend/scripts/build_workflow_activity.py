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
# Runs are collected PER WORKFLOW, not from the repo-wide listing. That
# listing is capped at 1,000 results however you paginate it, and this repo
# burns through 1,000 runs in about five days — so the repo-wide call
# silently truncated the oldest days of the window and reported them as
# zero-activity. A file whose whole purpose is "what actually ran" cannot
# quietly under-report, and the failure looked exactly like the real thing
# it exists to detect: a workflow that stopped firing.
#
# Per workflow the ceiling is nowhere near binding — the busiest job here
# runs ~300 times a week — and the window is enforced against each run's own
# timestamp, so correctness no longer depends on the API's `created` filter
# behaving.
MAX_PAGES = 10          # 1,000 runs for a single workflow in one week


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

    # 1 — every workflow the repo declares, including ones that never fired.
    workflows: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        url = (f"https://api.github.com/repos/{repo}/actions/workflows"
               f"?per_page={PER_PAGE}&page={page}")
        try:
            batch = _api(url, token).get("workflows") or []
        except urllib.error.HTTPError as e:
            print(f"[activity] workflow list error page {page}: {e}", file=sys.stderr)
            return 1
        workflows.extend(batch)
        if len(batch) < PER_PAGE:
            break

    # 2 — each workflow's runs inside the window. `created` narrows the
    # request; the window is re-checked per run below, so an ignored filter
    # costs bandwidth, not accuracy.
    runs: list[dict] = []
    capped: list[str] = []
    for wf in workflows:
        wf_id = wf.get("id")
        if wf_id is None:
            continue
        for page in range(1, MAX_PAGES + 1):
            url = (f"https://api.github.com/repos/{repo}/actions/workflows/{wf_id}/runs"
                   f"?per_page={PER_PAGE}&page={page}"
                   f"&created=%3E%3D{since.strftime('%Y-%m-%d')}")
            try:
                batch = _api(url, token).get("workflow_runs") or []
            except urllib.error.HTTPError as e:
                print(f"[activity] runs error {wf.get('name')} page {page}: {e}", file=sys.stderr)
                return 1
            # A run's own `name` is the workflow title CACHED WHEN THE RUN
            # WAS CREATED, and GitHub never backfills it after a rename — a
            # run created today still carries last month's title. Aggregating
            # on it splits one workflow across every name it has ever had and
            # makes none of them match the inventory, which is read from the
            # current YAML. That reported eight healthy jobs as "scheduled but
            # never fired" — the exact false alarm this file exists to rule
            # out. Carry the owning workflow instead; it comes from the
            # workflow listing, so it is always current.
            for r in batch:
                r["_wf_name"] = wf.get("name")
                r["_wf_path"] = wf.get("path") or ""
                r["_wf_id"] = wf_id
            runs.extend(batch)
            if len(batch) < PER_PAGE:
                break
        else:
            # Ran out of pages with a full last batch — say so in the file
            # rather than shipping a quiet undercount.
            capped.append(wf.get("name") or str(wf_id))
    if capped:
        print(f"[activity] page cap hit for: {', '.join(capped)}", file=sys.stderr)

    # The per-workflow endpoint can return the same run twice across pages
    # when a run lands mid-pagination.
    seen: set[int] = set()
    deduped = []
    for r in runs:
        rid = r.get("id")
        if rid in seen:
            continue
        seen.add(rid)
        deduped.append(r)
    runs = deduped

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

        # Keyed by file, which is the workflow's real identity: it survives
        # renames, and it is what the inventory joins on.
        path = r.get("_wf_path") or r.get("path") or ""
        file = path.rsplit("/", 1)[-1]
        name = r.get("_wf_name") or r.get("name") or "(unnamed)"
        a = agg.setdefault(file or name, {
            "name": name,
            "file": file,
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

    # Renames are not cosmetic here: `workflow_run` triggers match on the
    # exact display title, so a renamed workflow silently stops waking its
    # listeners. Surfacing the drift makes that checkable.
    renamed = sorted({
        f"{r.get('name')} → {r.get('_wf_name')}"
        for r in runs
        if r.get("_wf_name") and r.get("name") and r["_wf_name"] != r["name"]
    })

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
        # Non-empty means a workflow exceeded the page cap and its counts
        # are a floor, not a total.
        "capped_workflows": capped,
        # "old title → current title" for workflows renamed inside the
        # window. Each one is a workflow_run trigger to re-check.
        "renamed_in_window": renamed,
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
    for line in renamed:
        print(f"[activity] renamed in window: {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
