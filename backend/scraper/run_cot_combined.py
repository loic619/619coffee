#!/usr/bin/env python3
# backend/scraper/run_cot_combined.py
# Ingest the futures-AND-OPTIONS combined COT report for coffee (NY + LDN).
# The options book the positioning gauges draw is combined - futures, derived
# at export time; this run only stores the combined side.
#
# Usage:
#   cd backend
#   DATABASE_URL=... python -m scraper.run_cot_combined              # current year
#   DATABASE_URL=... COT_COMBINED_YEARS=5 python -m scraper.run_cot_combined
#
# COT_COMBINED_YEARS=N backfills the trailing N calendar years, which is what
# the gauges need: their bars are drawn against a 5-year range, so a
# forward-only ingest would leave the options bars range-less for years.

import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session
from scraper.sources.cot_combined import fetch_and_upsert


def main() -> int:
    # `or "1"`, not a get() default. COT_COMBINED_YEARS is wired from
    # inputs.combined_years, and on a SCHEDULED run that input does not
    # exist, so the workflow sets the variable to the empty string rather
    # than leaving it unset — get()'s default never fires and int("")
    # raises. This killed every scheduled COT run.
    n_years = int(os.environ.get("COT_COMBINED_YEARS") or "1")
    this_year = date.today().year
    years = [this_year - i for i in range(max(1, n_years))]

    db = get_session()
    try:
        written = fetch_and_upsert(db, years=years)
    finally:
        db.close()
    print(f"[cot_combined] done — {written} market-weeks over {years}")
    # A totally empty ingest means both feeds failed; surface that to CI.
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main())
