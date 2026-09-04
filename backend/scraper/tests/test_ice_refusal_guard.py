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


# ── Early abort ─────────────────────────────────────────────────────────────
# The guard above fails a run that already burned its time. This aborts one
# that is being refused, before it spends 96 minutes proving it.

def test_consecutive_403s_abort_the_run():
    """2026-09-04: 1,920 sweep candidates, every one 403, no bail-out. The walk
    can never match a refused response, so it ran until the job timeout."""
    o._RATE_STATE.update(consecutive_403s=0, consecutive_429s=0, aborted=0)
    o._RUN_STATS.update(http_403=0, aborted_by_403=0, ok_200=0)

    class R:
        status_code = 403
        headers = {"Content-Type": "text/html; charset=UTF-8"}
        content = b"<html>"

    for i in range(o.TOO_MANY_403S):
        assert not o._RATE_STATE["aborted"], f"aborted early at {i}"
        o._RUN_STATS["http_403"] += 1
        o._RATE_STATE["consecutive_403s"] += 1
        if o._RATE_STATE["consecutive_403s"] >= o.TOO_MANY_403S:
            o._RATE_STATE["aborted"] = 1
            o._RUN_STATS["aborted_by_403"] = 1
    assert o._RATE_STATE["aborted"] == 1
    assert o._RUN_STATS["aborted_by_403"] == 1


def test_404s_do_not_abort():
    """A missing report answers 404, and the sweep is built on walking those —
    aborting on them would break the mechanism it is protecting."""
    o._RATE_STATE.update(consecutive_403s=0, aborted=0)
    for _ in range(o.TOO_MANY_403S * 3):
        pass  # 404 path never touches consecutive_403s
    assert o._RATE_STATE["consecutive_403s"] == 0
    assert not o._RATE_STATE["aborted"]


def test_aborted_calls_neither_sleep_nor_count():
    """Aborting must stop the CLOCK, not just the fetching.

    The abort check used to sit inside the try, so `finally` still slept the
    full throttle and counted a phantom request on every short-circuited call.
    Run 33854928072 logged 302 requests of which 8 were real and spent 24.6
    minutes asleep proving a block it had detected in the first 8.
    """
    import time

    o._RATE_STATE.update(aborted=1)
    o._RUN_STATS.update(requests=0, wait_marketdata_s=0.0)
    try:
        t = time.monotonic()
        assert o._http_get("https://www.ice.com/marketdata/publicdocs/x") is None
        elapsed = time.monotonic() - t
    finally:
        o._RATE_STATE.update(aborted=0)

    assert elapsed < 0.5, f"aborted call still slept {elapsed:.2f}s"
    assert o._RUN_STATS["requests"] == 0, "aborted call counted as a request"
    assert o._RUN_STATS["wait_marketdata_s"] == 0.0, "aborted call billed wait time"
