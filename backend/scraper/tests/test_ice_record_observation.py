"""The two operator edits to the ICE publish-time record, and their guards.

These ran in a workflow heredoc until now. The interesting part is not the
writing — it is the consistency rules between the two files, which are exactly
the kind of thing a YAML step grows silently wrong.
"""
from __future__ import annotations

import datetime as dt
import json

import pytest

from scraper.sources.ice_certified_stocks import record_observation as ro

PAST = "2026-08-31"          # a Monday: the UK summer bank holiday
OTHER = "2026-09-02"         # a Wednesday


@pytest.fixture()
def paths(tmp_path):
    hits = tmp_path / "stock_report_hits.json"
    hits.write_text(json.dumps({"hits": [
        {"date": "bootstrap", "hhmmss": "103021"},
        {"date": "2026-08-28", "hhmmss": "104736"},
    ]}), encoding="utf-8")
    return hits, tmp_path / "no_release_days.json"


def read(p):
    return json.loads(p.read_text(encoding="utf-8"))


# ── validation ───────────────────────────────────────────────────────────────

def test_date_must_be_a_past_weekday():
    assert ro.validate_date(" 2026-08-31 ") == PAST
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        ro.validate_date("31/08/2026")
    with pytest.raises(ValueError, match="future"):
        ro.validate_date((dt.date.today() + dt.timedelta(days=1)).isoformat())
    # A Saturday is not a business day, so nothing ever counts it missing and
    # "no release" is not a statement about it.
    with pytest.raises(ValueError, match="weekends"):
        ro.validate_date("2026-08-29")


def test_time_must_be_six_digits_of_wall_clock():
    assert ro.validate_hhmmss("112351") == "112351"
    with pytest.raises(ValueError, match="HHMMSS"):
        ro.validate_hhmmss("11:23:51")
    with pytest.raises(ValueError, match="wall-clock"):
        ro.validate_hhmmss("117051")


def test_reason_is_required_and_normalised():
    assert ro.validate_reason("  market   closed\n") == "market closed"
    with pytest.raises(ValueError, match="reason is required"):
        ro.validate_reason("   ")
    assert len(ro.validate_reason("x" * 500)) == ro.MAX_REASON


# ── recording a time ─────────────────────────────────────────────────────────

def test_recording_a_time_replaces_and_keeps_bootstrap_first(paths):
    hits, nr = paths
    ro.record_time("2026-08-28", "105959", hits_path=hits, no_release_path=nr)
    ro.record_time(OTHER, "104501", hits_path=hits, no_release_path=nr)
    rows = read(hits)["hits"]
    assert [r["date"] for r in rows] == ["bootstrap", "2026-08-28", OTHER]
    assert rows[1]["hhmmss"] == "105959"        # replaced, not duplicated
    assert rows[2]["source"] == "operator"


# ── passing a day ────────────────────────────────────────────────────────────

def test_passing_a_day_writes_a_reasoned_entry(paths):
    hits, nr = paths
    msg = ro.record_no_release(PAST, "UK summer bank holiday", hits_path=hits,
                               no_release_path=nr, at="2026-09-04T00:00:00Z")
    assert PAST in msg
    doc = read(nr)
    assert doc["days"] == [{"date": PAST, "reason": "UK summer bank holiday",
                            "source": "operator", "recorded": "2026-09-04T00:00:00Z"}]
    assert doc["note"]                            # the file explains itself


def test_passing_the_same_day_twice_does_not_duplicate_it(paths):
    hits, nr = paths
    ro.record_no_release(PAST, "market closed", hits_path=hits, no_release_path=nr)
    ro.record_no_release(PAST, "UK bank holiday", hits_path=hits, no_release_path=nr)
    days = read(nr)["days"]
    assert len(days) == 1 and days[0]["reason"] == "UK bank holiday"


def test_a_day_with_a_known_publish_time_cannot_be_passed(paths):
    """The one edit that could destroy data, so it is refused outright."""
    hits, nr = paths
    with pytest.raises(ValueError, match="did release"):
        ro.record_no_release("2026-08-28", "market closed", hits_path=hits, no_release_path=nr)
    assert not nr.exists()


def test_recording_a_time_withdraws_an_earlier_pass(paths):
    """Evidence beats classification: the filename proves the market was open."""
    hits, nr = paths
    ro.record_no_release(PAST, "assumed closed", hits_path=hits, no_release_path=nr)
    msg = ro.record_time(PAST, "112351", hits_path=hits, no_release_path=nr)
    assert "withdrew" in msg
    assert read(nr)["days"] == []
    assert ro.hit_for(read(hits), PAST)["hhmmss"] == "112351"


# ── the CLI the workflow calls ───────────────────────────────────────────────

def test_cli_dispatches_on_whether_a_time_was_given(paths, monkeypatch):
    hits, nr = paths
    monkeypatch.setattr(ro, "HITS", hits)
    monkeypatch.setattr(ro, "NO_RELEASE", nr)
    assert ro.main(["--date", OTHER, "--hhmmss", "104501"]) == 0
    assert ro.main(["--date", PAST, "--reason", "UK summer bank holiday"]) == 0
    assert [d["date"] for d in read(nr)["days"]] == [PAST]
    assert ro.hit_for(read(hits), OTHER)


def test_cli_reports_a_bad_edit_instead_of_raising(paths, monkeypatch, capsys):
    hits, nr = paths
    monkeypatch.setattr(ro, "HITS", hits)
    monkeypatch.setattr(ro, "NO_RELEASE", nr)
    assert ro.main(["--date", PAST]) == 1                     # no time, no reason
    assert "reason is required" in capsys.readouterr().err
