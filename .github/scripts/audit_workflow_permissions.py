#!/usr/bin/env python3
"""Check every workflow declares the GITHUB_TOKEN scopes it actually uses.

WHY THIS EXISTS. On 24 Aug 2026 the repository default was set to "Read
repository contents and packages permissions", which grants contents:read and
packages:read and nothing else. Workflows that relied on the old permissive
default lost their scopes silently: the redeploy guard began 403-ing (seven
lost deploys), and check-live-quotes kept reporting success while the rescue
poll it exists to fire never dispatched. A handled failure looks exactly like
no failure, so nothing surfaced either one.

Declaring scopes per workflow makes them independent of that setting. This
script checks the declarations still match the usage.

TWO TRAPS IT ENCODES, both of which bit real fixes here:
  1. Job-level `permissions:` REPLACE the top-level block, they do not merge.
     A top-level actions:read is invisible to a job that declares its own
     contents:read — which is how the scraper-daily fix shipped ineffective.
  2. Run URLs quoted in comments look like API calls. Comments are stripped
     before matching, or the first version of this audit reports 69 broken
     workflows when the real number is 1.

Run: python3 .github/scripts/audit_workflow_permissions.py
Exit 1 if any workflow uses a scope it has not declared.
"""
import re
import sys
import pathlib

import yaml

# What the repository default grants. Update if that setting changes.
DEFAULT = {"contents": "read", "packages": "read"}

# scope, level, and the usage that demands it.
USAGE = [
    ("contents", "write", re.compile(
        r"git push|uses:\s*\./\.github/actions/commit-data|peter-evans/create-pull-request")),
    ("actions", "write", re.compile(
        r"/actions/workflows/[A-Za-z0-9_.-]+\.yml/dispatches")),
    ("actions", "read", re.compile(
        r"api\.github\.com/repos/[^\"\s]*/actions/workflows/[A-Za-z0-9_.-]+\.yml/runs")),
]


def strip_comments(text: str) -> str:
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))


def normalise(perms):
    if perms is None:
        return None
    if isinstance(perms, str):        # read-all / write-all
        return {"_all": perms}
    return dict(perms)


def grants(perms: dict, scope: str, level: str) -> bool:
    if perms.get("_all") == "write-all":
        return True
    if perms.get("_all") == "read-all":
        return level == "read"
    have = perms.get(scope)
    if have is None:
        return False
    return True if level == "read" else have == "write"


def audit(root="."):
    gaps = []
    workflows = sorted(pathlib.Path(root, ".github/workflows").glob("*.yml"))
    for path in workflows:
        raw = path.read_text(encoding="utf-8")
        try:
            doc = yaml.safe_load(raw) or {}
        except yaml.YAMLError as e:
            gaps.append((path.name, f"unparseable: {e}"))
            continue
        body = strip_comments(raw)
        needs = [(s, l) for s, l, rx in USAGE if rx.search(body)]
        if not needs:
            continue
        top = normalise(doc.get("permissions"))
        jobs = {jn: normalise(j.get("permissions"))
                for jn, j in (doc.get("jobs") or {}).items() if isinstance(j, dict)}
        for job_name, job_perms in (jobs.items() or [(None, None)]):
            # Trap 1: job-level replaces top-level, it does not merge.
            effective = job_perms if job_perms is not None else (top if top is not None else DEFAULT)
            for scope, level in needs:
                if not grants(effective, scope, level):
                    gaps.append((path.name, f"{scope}:{level} missing in job '{job_name}'"))
    return workflows, gaps


if __name__ == "__main__":
    workflows, gaps = audit()
    print(f"{len(workflows)} workflows scanned")
    if not gaps:
        print("all declared scopes cover their usage")
        sys.exit(0)
    print(f"\n{len(gaps)} gap(s):\n")
    for name, detail in gaps:
        print(f"  {name}: {detail}")
    sys.exit(1)
