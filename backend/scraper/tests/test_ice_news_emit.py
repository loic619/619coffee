"""Wording test for ICE certified-stocks → news-feed commentary.

Exercises the pure compute helpers in
`scraper.sources.ice_certified_stocks.news_emit` so the badge text is
pinned even without a live DB. The DB-upsert wrapper (`emit`) is a
no-op when DATABASE_URL is unset, which is the default in CI.
"""

from scraper.sources.ice_certified_stocks.news_emit import (
    compute_arabica_commentary,
    compute_robusta_commentary,
)


def test_arabica_delta_renders_factual_line():
    snapshots = [
        {"date": "2026-05-29", "total_bags": 844_500, "passed_today_bags": 0,  "failed_today_bags": 0},
        {"date": "2026-05-30", "total_bags": 842_100, "passed_today_bags": 12, "failed_today_bags": 8},
    ]
    result = compute_arabica_commentary(snapshots)
    assert result is not None
    date_iso, text = result
    assert date_iso == "2026-05-30"
    # The signed delta, total, and grading clause should all be present.
    assert "KC Arabica certified stocks shifted by -2,400 bags today" in text
    assert "842,100 bags" in text
    # Graded = passed + failed (12 + 8). Quoting passed_today_bags alone read
    # as "12 graded" on a day 20 bags went through grading, and the unit word
    # said "lots" on an arabica line denominated in bags.
    assert "20 bags graded" in text


def test_arabica_no_grading_drops_clause():
    """When `passed_today_bags` is 0 the grading clause must disappear."""
    snapshots = [
        {"date": "2026-05-29", "total_bags": 100_000, "passed_today_bags": 0, "failed_today_bags": 0},
        {"date": "2026-05-30", "total_bags": 100_500, "passed_today_bags": 0, "failed_today_bags": 0},
    ]
    _, text = compute_arabica_commentary(snapshots)
    assert "+500 bags" in text
    assert "graded" not in text
    assert "decertified" not in text


def test_robusta_renders_lots_units():
    snapshots = [
        {"date": "2026-05-29", "total_lots_certified": 4_075, "lots_graded_today": 0},
        {"date": "2026-05-30", "total_lots_certified": 4_120, "lots_graded_today": 0},
    ]
    _, text = compute_robusta_commentary(snapshots)
    assert "RC Robusta certified stocks shifted by +45 lots today" in text
    assert "4,120 lots" in text


def test_insufficient_history_returns_none():
    """Single-snapshot windows can't produce a delta — return None instead
    of fabricating one."""
    assert compute_arabica_commentary([]) is None
    assert compute_arabica_commentary([{"date": "2026-05-30", "total_bags": 100}]) is None
    assert compute_robusta_commentary([{"date": "2026-05-30", "total_lots_certified": 4_000}]) is None


def test_missing_total_field_returns_none():
    """If the snapshot lacks the required total field, skip rather than crash."""
    snapshots = [
        {"date": "2026-05-29"},
        {"date": "2026-05-30"},
    ]
    assert compute_arabica_commentary(snapshots) is None
    assert compute_robusta_commentary(snapshots) is None
