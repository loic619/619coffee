"""How a business day with no snapshot is accounted for.

Three outcomes, not two: captured, missed, or no session at all. The third only
exists because an operator says so — there is no feed that announces an ICE
closure — so the accounting has to be explicit about what it does with that
claim, and specifically must not let it quietly inflate the capture rate.
"""
from __future__ import annotations

import json

import pytest

from scraper.exporters import ice_publish_times as ipt

# The span runs from the first capture to the last, so it opens on Fri 08-28 and
# closes on Fri 09-04: six business days, four of them captured. Mon 08-31 is the
# bank holiday, Wed 09-02 a genuine hole.
OBS = [("2026-08-28", 37_700, "102820"),
       ("2026-09-01", 37_800, "103000"),
       ("2026-09-03", 37_900, "103140"),
       ("2026-09-04", 37_950, "103230")]


@pytest.fixture()
def wired(tmp_path, monkeypatch):
    (tmp_path / "certified_stocks_robusta.json").write_text(json.dumps(
        {"snapshots": [{"date": d} for d, _s, _t in OBS]}), encoding="utf-8")
    monkeypatch.setattr(ipt, "OUT_DIR", tmp_path)
    monkeypatch.setattr(ipt, "NO_RELEASE", tmp_path / "no_release_days.json")
    return tmp_path


def pass_day(dirpath, date, reason="UK summer bank holiday"):
    (dirpath / "no_release_days.json").write_text(json.dumps(
        {"days": [{"date": date, "reason": reason}]}), encoding="utf-8")


def test_without_the_mark_a_closure_is_an_unrecoverable_miss(wired):
    m = ipt._misses(OBS)
    assert [r["date"] for r in m["missing"]] == ["2026-08-31", "2026-09-02"]
    assert m["sessions"] == m["business_days"] == 6
    assert m["captured"] == 4


def test_a_passed_day_leaves_the_pending_list(wired):
    pass_day(wired, "2026-08-31")
    m = ipt._misses(OBS)
    assert [r["date"] for r in m["missing"]] == ["2026-09-02"]
    assert m["no_release"] == [{"date": "2026-08-31", "weekday": "Mon",
                                "reason": "UK summer bank holiday"}]


def test_it_comes_off_the_denominator_rather_than_counting_as_captured(wired):
    """The failure mode this guards: a closure marked and then scored as a hit,
    which would let anyone raise the capture rate by passing days."""
    pass_day(wired, "2026-08-31")
    m = ipt._misses(OBS)
    assert m["business_days"] == 6      # unchanged — it is still a weekday
    assert m["sessions"] == 5           # but there was no session to capture
    assert m["captured"] == 4           # and no extra capture was invented
    assert m["by_weekday"]["Mon"] == {"missing": 0, "of": 0}


def test_a_day_we_actually_hold_is_not_reported_as_closed(wired):
    """Data outranks the classification: a snapshot proves the market was open."""
    pass_day(wired, "2026-09-01")
    m = ipt._misses(OBS)
    assert m["no_release"] == []
    assert m["captured"] == 4 and m["sessions"] == 6


def test_a_mark_outside_the_observed_span_is_ignored(wired):
    pass_day(wired, "2026-07-06")
    m = ipt._misses(OBS)
    assert m["no_release"] == [] and m["business_days"] == 6


def test_a_missing_or_unreadable_file_is_not_a_failure(wired):
    (wired / "no_release_days.json").write_text("{ not json", encoding="utf-8")
    assert ipt._misses(OBS)["no_release"] == []
