"""A wholly-refused ICE run must fail the job, not report success.

On 2026-09-04 ICE began answering /marketdata/publicdocs/ with 403 and an HTML
challenge body. The run made 1,368 requests, every one refused, merged nothing
over the existing snapshots, wrote both JSONs and exited 0. The only symptom
was the certified-stocks data quietly going stale.

Per-source failures stay non-fatal on purpose — one missing report must not
cost the other nine — so the guard keys on "we asked and NOTHING succeeded".
"""
import pytest

from scraper.sources.ice_certified_stocks import orchestrate as o


@pytest.fixture(autouse=True)
def clean_stats():
    keep = dict(o._RUN_STATS)
    o._RUN_STATS.update({"requests": 0, "ok_200": 0, "http_403": 0,
                         "http_429": 0, "http_404": 0})
    yield o._RUN_STATS
    o._RUN_STATS.clear()
    o._RUN_STATS.update(keep)


def test_every_request_refused_raises(clean_stats):
    """The real 2026-09-04 shape."""
    clean_stats.update(requests=1368, http_403=1368)
    with pytest.raises(o.AllRequestsRefused) as e:
        o._assert_not_wholly_refused()
    # The message must say which way to act: a 403 is not a pacing problem.
    assert "0 succeeded" in str(e.value)
    assert "not a rate limit" in str(e.value)


def test_quiet_day_stays_silent(clean_stats):
    """Nothing published means few or no requests — not a failure."""
    clean_stats.update(requests=0)
    o._assert_not_wholly_refused()


def test_one_success_is_enough(clean_stats):
    """A degraded feed is not a dead one; per-source failures stay non-fatal."""
    clean_stats.update(requests=400, ok_200=1, http_403=399)
    o._assert_not_wholly_refused()


def test_below_the_floor_stays_silent(clean_stats):
    """A near-idle run with a couple of 404s must not trip the guard."""
    clean_stats.update(requests=o._REFUSED_MIN_REQUESTS - 1, http_404=9)
    o._assert_not_wholly_refused()


def test_at_the_floor_it_bites(clean_stats):
    clean_stats.update(requests=o._REFUSED_MIN_REQUESTS, http_404=10)
    with pytest.raises(o.AllRequestsRefused):
        o._assert_not_wholly_refused()
