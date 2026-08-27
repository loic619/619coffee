#!/usr/bin/env python3
"""
backfill_treasury_yields.py — deepen treasury_yields.json to N years.

The daily export only ever asks Treasury for the CURRENT year (plus the prior
one while the series is still short), because the published years never change
and re-fetching them every run cost 37 s — 42% of the whole static export. That
keeps the file current but it can never make it deeper, so the archive starts
wherever the first run happened to land: 2025-01-02, two years.

This walks the year-per-request XML feed backwards and merges the result into
whatever is already published. Re-runnable and safe:

  * The existing history is loaded FIRST and kept. A year that fails to fetch
    costs nothing — the sessions already on disk survive untouched.
  * Fetched rows are appended AFTER the existing ones, so on a date collision
    the freshly fetched print wins. Treasury does revise same-day values.
  * Shaping goes through sources.treasury_yields.shape_curve, the same function
    the daily path uses, so the two cannot produce different file shapes.

A run that fetches NOTHING exits 3 rather than reporting success — the
per-contract price backfill in this repo went green while writing zero cells,
and the lesson is that a backfill's verdict belongs on rows fetched, not on the
absence of an exception.

    PYTHONPATH=backend python backend/scraper/backfill_treasury_yields.py --years 10
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.sources.treasury_yields import _fetch_year, shape_curve  # noqa: E402

OUT = (Path(__file__).resolve().parents[2]
       / "frontend" / "public" / "data" / "treasury_yields.json")


def _load_existing() -> list[dict]:
    if not OUT.exists():
        print(f"  no existing {OUT.name} — starting from scratch")
        return []
    try:
        hist = json.loads(OUT.read_text(encoding="utf-8")).get("history") or []
        if hist:
            print(f"  existing: {len(hist)} sessions  {hist[0]['date']} -> {hist[-1]['date']}")
        return hist
    except Exception as e:  # noqa: BLE001 — a corrupt file must not block a rebuild
        print(f"  existing {OUT.name} unreadable ({type(e).__name__}) — rebuilding from the feed")
        return []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=10,
                    help="How many years back to walk, including the current one")
    args = ap.parse_args()

    this_year = date.today().year
    years = list(range(this_year - args.years + 1, this_year + 1))

    existing = _load_existing()
    before = {r["date"] for r in existing}

    print(f"  fetching {len(years)} years: {years[0]}-{years[-1]}")
    fetched: list[dict] = []
    failed: list[int] = []
    for y in years:
        got = _fetch_year(y)
        if not got:
            failed.append(y)
            continue
        fetched.extend(got)

    if not fetched:
        print("::error::backfill fetched 0 sessions — refusing to report success", file=sys.stderr)
        return 3

    # Existing first so a freshly fetched print supersedes it on collision.
    curve = shape_curve(existing + fetched)
    if not curve:
        print("::error::shaping produced no curve", file=sys.stderr)
        return 3

    hist = curve["history"]
    added = len({r["date"] for r in hist} - before)
    OUT.write_text(json.dumps(curve, indent=2), encoding="utf-8")

    print(f"\n  wrote {OUT}")
    print(f"  sessions: {len(before)} -> {len(hist)}  (+{added} new)")
    print(f"  span    : {hist[0]['date']} -> {hist[-1]['date']}")
    print(f"  size    : {OUT.stat().st_size / 1024:.0f} KB")
    if failed:
        # Not fatal: the years that DID land are still a deepening, and the
        # existing history was preserved regardless. Say which are missing so a
        # gap is never mistaken for "Treasury has no data that far back".
        print(f"  ::warning::no data returned for {failed} — re-run to retry those years")
    if added == 0:
        print("  (no new dates — the archive was already at least this deep)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
