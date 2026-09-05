"""Don't spend requests proving a block, or re-fetching what we already hold.

Run 33978343636 made 26 requests per attempt. Twenty-one of them asked for
periods already sitting in the published JSON, and eighteen of those ran with a
403 breaker that could never trip:

    arabica ageing   18 requests   already had 2026-08-31   breaker unreachable
    age allowance     3 requests   already had 2026-08-31
    iss/recv          5 requests   2026-07 held, 2026-08 genuinely missing

The breaker was unreachable because `_begin_section` sat INSIDE the month
walk-back, resetting consecutive_403s every six candidates against a threshold
of eight. It also counted one section per month, which is why that run's alert
said "1 of 4" for a job with two fetch sections.
"""
import json

import pytest

from scraper.sources.ice_certified_stocks import orchestrate as o


@pytest.fixture
def stats():
    keep_stats, keep_rate = dict(o._RUN_STATS), dict(o._RATE_STATE)
    o._RUN_STATS.update({"requests": 0, "ok_200": 0, "http_403": 0, "http_429": 0,
                         "http_404": 0, "blocked_sections": [], "sections": 0,
                         "aborted_by_403": 0, "block_signature": None})
    o._RATE_STATE.update({"consecutive_429s": 0, "consecutive_403s": 0,
                          "aborted": 0, "section_blocked": 0})
    yield o._RUN_STATS
    o._RUN_STATS.clear(); o._RUN_STATS.update(keep_stats)
    o._RATE_STATE.clear(); o._RATE_STATE.update(keep_rate)


# ── The breaker ─────────────────────────────────────────────────────────────

def test_breaker_trips_within_one_section_across_the_month_walkback(stats, monkeypatch):
    """Six candidates a month, three months, one threshold of eight.

    With the old per-month _begin_section the counter reset at 6 and the
    breaker never fired: 18 refusals. One section for the walk-back means it
    fires on the 8th.
    """
    calls: list[str] = []

    class R:
        status_code = 403
        headers = {"Content-Type": "text/html"}
        text = "<html>denied</html>"
        url = "https://www.ice.com/publicdocs/x.xls"

    def fake_get(url, **kw):
        calls.append(url)
        return R()

    monkeypatch.setattr(o.requests, "get", fake_get)
    monkeypatch.setattr(o.time, "sleep", lambda s: None)

    o._begin_section("arabica ageing report")
    # 18 candidate URLs, the shape of the real walk-back.
    for i in range(18):
        o._http_get(f"https://www.ice.com/publicdocs/coffee_aging_2026{i:04d}.xls")

    assert len(calls) == o.TOO_MANY_403S, (
        f"{len(calls)} requests issued; the breaker should stop at "
        f"{o.TOO_MANY_403S}")
    assert stats["sections"] == 1, "the walk-back is one section, not one per month"
    assert len(stats["blocked_sections"]) == 1
    assert stats["blocked_sections"][0]["section"] == "arabica ageing report"
    # Everything after the trip is recorded as given up, not as a request.
    assert stats["blocked_sections"][0]["skipped_requests"] == 18 - o.TOO_MANY_403S


def test_a_new_section_gets_a_fresh_slate(stats, monkeypatch):
    """Being refused one source says nothing about the next — that behaviour
    is deliberate and must survive the fix."""
    monkeypatch.setattr(o.time, "sleep", lambda s: None)
    o._begin_section("arabica ageing report")
    o._RATE_STATE["consecutive_403s"] = o.TOO_MANY_403S
    o._RATE_STATE["section_blocked"] = 1
    o._begin_section("robusta monthly reports")
    assert o._RATE_STATE["section_blocked"] == 0
    assert o._RATE_STATE["consecutive_403s"] == 0
    assert stats["sections"] == 2


# ── Already-captured ────────────────────────────────────────────────────────

@pytest.fixture
def out_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(o, "OUT_DIR", tmp_path)
    return tmp_path


def _write(out_dir, ageing_month_end=None, age_allow=(), iss_recv=()):
    (out_dir / "certified_stocks_arabica.json").write_text(json.dumps({
        "ageing_report": {"month_end": ageing_month_end} if ageing_month_end else None}))
    (out_dir / "certified_stocks_robusta.json").write_text(json.dumps({
        "monthly": {
            "age_allowance": [{"month_end": m} for m in age_allow],
            "iss_recv_monthly": [{"month": m} for m in iss_recv],
        }}))


def test_target_month_is_the_previous_calendar_month(out_dir):
    from datetime import date, timedelta
    expected = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    assert o._target_month() == expected


def test_ageing_already_held_for_the_target_month(out_dir):
    target = o._target_month()
    _write(out_dir, ageing_month_end=f"{target}-31")
    assert o._have_ageing_for(target) is True


def test_an_older_ageing_report_does_not_count_as_held(out_dir):
    """The crucial distinction: holding SOME report is not holding THIS one.

    If this ever returns True for a stale report the monthly job stops working
    — it would never fetch a newly published month again.
    """
    _write(out_dir, ageing_month_end="2025-01-31")
    assert o._have_ageing_for(o._target_month()) is False


def test_missing_file_means_not_held(out_dir):
    assert o._have_ageing_for(o._target_month()) is False
    assert o._have_monthly("iss_recv_monthly", "month", "2026-08") is False


def test_monthly_hold_is_per_period_not_per_feed(out_dir):
    """Holding July says nothing about August — the walk-back must still ask."""
    _write(out_dir, age_allow=("2026-07-31",), iss_recv=("2026-07",))
    assert o._have_monthly("age_allowance", "month_end", "2026-07") is True
    assert o._have_monthly("age_allowance", "month_end", "2026-08") is False
    assert o._have_monthly("iss_recv_monthly", "month", "2026-07") is True
    assert o._have_monthly("iss_recv_monthly", "month", "2026-08") is False


def test_todays_incident_shape(out_dir):
    """2026-09-05 exactly: two feeds held for August, one missing.

    The held ones must be skipped and the missing one must still be requested —
    26 requests becomes 5, and none of the 5 is a duplicate.
    """
    _write(out_dir,
           ageing_month_end="2026-08-31",
           age_allow=("2026-08-31",),
           iss_recv=("2026-07",))
    assert o._have_ageing_for("2026-08") is True          # 18 requests saved
    assert o._have_monthly("age_allowance", "month_end", "2026-08") is True   # 3 saved
    assert o._have_monthly("iss_recv_monthly", "month", "2026-08") is False   # still fetched
