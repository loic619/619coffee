"""
Standalone runner for the IMF PortWatch port-activity scraper.
Used by GitHub Actions (workflow 1.11) — fetches the curated coffee export
ports and writes frontend/public/data/port_activity.json. No DB, no browser.

    cd backend && python -m scraper.run_port_activity
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.sources.port_activity import PORTS, run

if __name__ == "__main__":
    payload = run()
    if not payload:
        # Nothing fetched at all — existing files retained untouched. Retryable.
        sys.exit(1)

    # A configured port with no data at all (bad match string, dead portid) is a
    # real problem, but the data we *did* write is still worth committing — so
    # exit 2 rather than 1: the workflow commits, then fails the job on the gate.
    present = {p["key"] for p in payload["ports"]}
    missing = [s["key"] for s in PORTS if s["key"] not in present]
    if missing:
        print(f"[port_activity] INCOMPLETE — no data for: {', '.join(missing)}")
        sys.exit(2)
    sys.exit(0)
