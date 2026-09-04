"""/run — trigger a scraper workflow.

An operational command, so it reports state rather than just echoing. The
distinction that matters is timeout vs failure: a dispatch that times out may
well have been accepted, and telling the user it "failed" invites a second
trigger of a workflow that is already running.
"""
from __future__ import annotations

import os

import requests

from telegram.formatting import title

WORKFLOWS = {
    "prices":       "scraper-prices.yml",
    "cot":          "scraper-cot.yml",
    "cecafe":       "scraper-cecafe.yml",
    "kaffeesteuer": "scraper-kaffeesteuer.yml",
    "ecf":          "scraper-slow-data.yml",
    "brief":        "morning-brief.yml",
}
VALID_NAMES = ", ".join(sorted(WORKFLOWS))


def handle(args: str, context: dict) -> str:
    parts = args.strip().lower().split()
    name  = parts[0] if parts else ""
    if name not in WORKFLOWS:
        return "\n\n".join([
            title("⚙️ RUN", "which scraper?"),
            "\n".join(f"/run {n}" for n in sorted(WORKFLOWS)),
        ])

    head = title(f"⚙️ {name.upper()} UPDATE")

    owner = os.environ.get("GH_OWNER", "")
    repo  = os.environ.get("GH_REPO", "")
    pat   = os.environ.get("GH_PAT", "")
    if not owner or not repo or not pat:
        return f"{head}\n\n⚠️ Not configured.\n\nGH_OWNER, GH_REPO and GH_PAT must be set."

    url = f"https://api.github.com/repos/{owner}/{repo}/actions/workflows/{WORKFLOWS[name]}/dispatches"
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {pat}", "Accept": "application/vnd.github+json"},
            json={"ref": "main"},
            timeout=10,
        )
    except requests.Timeout:
        # NOT a failure: GitHub may have accepted the dispatch and simply been
        # slow to answer. Saying "failed" here invites a second trigger of a
        # workflow that is already running.
        return (f"{head}\n\n⏱ Trigger timed out.\n\n"
                "The workflow may still be running.\nCheck again in ~2 min.")
    except requests.RequestException as e:
        return (f"{head}\n\n⚠️ Could not reach GitHub.\n\n"
                f"{type(e).__name__}. No data was changed.")

    if resp.status_code == 204:
        return f"{head}\n\n✓ Scraper triggered.\n\nExpected update: ~2 min."
    return (f"{head}\n\n⚠️ Trigger failed.\n\n"
            f"GitHub returned HTTP {resp.status_code}.\nNo data was changed.")
