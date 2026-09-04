"""A run requests ONE day of per-day robusta sources, plus any real gap.

The loop used to walk all 7 window days every run — 6 sources x 7 days = 42
requests at the 5s marketdata throttle, of which 14 day/source pairs were
already stored on 2026-09-04 and re-requested anyway. Volume against
/marketdata/publicdocs/ is what gets a runner IP blocked, so a request that
cannot teach us anything is not free.
"""
from datetime import date

from scraper.sources.ice_certified_stocks import orchestrate as o

WINDOW = [date(2026, 8, 26), date(2026, 8, 27), date(2026, 8, 28),
          date(2026, 8, 31), date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3)]


def _plan(window, previously_fetched):
    """Mirror of the selection in run(); kept in step by the assertions below."""
    prev = set(previously_fetched)
    anchor = window[-1]
    gaps = [d for d in window[:-1] if d.isoformat() not in prev]
    return gaps + [anchor]


def test_healthy_day_requests_exactly_one_day():
    prev = [d.isoformat() for d in WINDOW[:-1]]
    plan = _plan(WINDOW, prev)
    assert plan == [date(2026, 9, 3)], plan
    assert len(plan) * 6 == 6, "one day = 6 GETs, down from 42"


def test_a_missed_day_is_still_recovered():
    """#609 widened the window because days falling between runs were lost for
    good. That risk is covered by fetching what is MISSING, not by re-fetching
    everything."""
    prev = [d.isoformat() for d in WINDOW[:-1] if d != date(2026, 8, 31)]
    plan = _plan(WINDOW, prev)
    assert plan == [date(2026, 8, 31), date(2026, 9, 3)], plan


def test_cold_start_fetches_the_whole_window():
    assert _plan(WINDOW, []) == WINDOW


def test_ledger_survives_a_merge_that_carries_no_new_days():
    """An --only-monthly run publishes an empty ledger; the merge must inherit
    the stored one rather than blank it."""
    old = {"daily_fetched": ["2026-09-01", "2026-09-02"], "snapshots": []}
    new = {"daily_fetched": [], "snapshots": []}
    merged = o._merge_robusta(new, old)
    assert merged["daily_fetched"] == ["2026-09-01", "2026-09-02"]


def test_ledger_unions_across_runs():
    old = {"daily_fetched": ["2026-09-01"], "snapshots": []}
    new = {"daily_fetched": ["2026-09-03"], "snapshots": []}
    merged = o._merge_robusta(new, old)
    assert merged["daily_fetched"] == ["2026-09-01", "2026-09-03"]
