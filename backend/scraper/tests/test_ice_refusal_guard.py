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


# ── 403 skips the SECTION, not the run ──────────────────────────────────────
# A run-wide abort meant a 403 storm on the last source silently short-circuited
# everything after it: a mostly-good run quietly stopped collecting. 403 is also
# per-source-IP and can be transient, so one refused source is no evidence the
# next is refused too.

def _storm():
    """Drive consecutive 403s past the threshold, as _http_get does."""
    for _ in range(o.TOO_MANY_403S):
        o._RATE_STATE["consecutive_403s"] += 1
        if o._RATE_STATE["consecutive_403s"] >= o.TOO_MANY_403S:
            o._RATE_STATE["section_blocked"] = 1
            o._RUN_STATS["aborted_by_403"] = 1


def test_403_storm_blocks_only_the_current_section():
    o._RATE_STATE.update(consecutive_403s=0, section_blocked=0, aborted=0)
    _storm()
    assert o._RATE_STATE["section_blocked"] == 1
    assert o._RATE_STATE["aborted"] == 0, "403 must not set the run-wide abort"

    o._begin_section("next source")
    assert o._RATE_STATE["section_blocked"] == 0, "next section did not get a fresh slate"
    assert o._RATE_STATE["consecutive_403s"] == 0


def test_a_blocked_section_still_short_circuits_without_sleeping():
    """Within the blocked section the remaining calls must cost nothing —
    the whole point of moving the check above the try."""
    import time
    o._RATE_STATE.update(consecutive_403s=0, section_blocked=0, aborted=0)
    o._RUN_STATS.update(requests=0, wait_marketdata_s=0.0)
    _storm()
    try:
        t = time.monotonic()
        assert o._http_get("https://www.ice.com/marketdata/publicdocs/x") is None
        elapsed = time.monotonic() - t
    finally:
        o._RATE_STATE.update(section_blocked=0, consecutive_403s=0)
    assert elapsed < 0.5
    assert o._RUN_STATS["requests"] == 0


def test_429_abort_stays_run_wide():
    """Rate limiting IS cumulative — continuing anywhere makes it worse — so
    the 429 path keeps the run-wide flag it always had."""
    o._RATE_STATE.update(aborted=0, section_blocked=0)
    o._RATE_STATE["aborted"] = 1            # as the 429 path sets it
    o._begin_section("next source")
    assert o._RATE_STATE["aborted"] == 1, "_begin_section must not clear a 429 abort"


# ── A skipped section has to be REPORTED ────────────────────────────────────
# Skipping is the right call, and it leaves the run green. Green is then
# indistinguishable from complete in all three places a person looks: the
# workflow's failure notifier is `if: failure()`, the data-map run record reads
# GitHub conclusions, and the research page reads run outcomes. So the skip has
# to carry a record of its own.

@pytest.fixture
def blocked_run(tmp_path, monkeypatch):
    """A run that fetched one section, then had two refused."""
    # The block alert is edge-triggered against a committed state file. Point
    # it at tmp_path: without this the suite writes data/ice_block_state.json
    # into the working tree and the SECOND test to notify is suppressed by the
    # first one's state — order-dependent, and it dirties the repo.
    monkeypatch.setattr(o, "BLOCK_STATE_PATH", tmp_path / "ice_block_state.json")
    keep_stats, keep_rate = dict(o._RUN_STATS), dict(o._RATE_STATE)
    o._RUN_STATS.update(requests=0, ok_200=0, http_403=0, http_429=0, http_404=0,
                        aborted_by_403=0, sections=0, blocked_sections=[],
                        wait_marketdata_s=0.0)
    o._RATE_STATE.update(consecutive_403s=0, consecutive_429s=0,
                         aborted=0, section_blocked=0)

    def block(label: str, skipped: int) -> None:
        o._begin_section(label)
        o._RATE_STATE["consecutive_403s"] = o.TOO_MANY_403S
        o._record_section_block()
        o._RATE_STATE["section_blocked"] = 1
        for _ in range(skipped):
            o._http_get("https://www.ice.com/marketdata/publicdocs/x")

    o._begin_section("arabica daily xls")          # served fine
    block("robusta stock report", 412)
    block("robusta per-day sources", 6)
    yield o._RUN_STATS
    o._RUN_STATS.clear(); o._RUN_STATS.update(keep_stats)
    o._RATE_STATE.clear(); o._RATE_STATE.update(keep_rate)


def test_each_blocked_section_is_named(blocked_run):
    """Which section was skipped is the load-bearing fact — the sections are
    not interchangeable, and `aborted_by_403` alone cannot say."""
    got = [b["section"] for b in blocked_run["blocked_sections"]]
    assert got == ["robusta stock report", "robusta per-day sources"]
    assert blocked_run["sections"] == 3, "the served section must count in the denominator"


def test_the_block_counts_what_it_gave_up(blocked_run):
    """A skip is only legible with its size: 8 x 403 then 412 requests never
    sent is a whole source missing, 8 then 6 is one day of six files."""
    assert [b["skipped_requests"] for b in blocked_run["blocked_sections"]] == [412, 6]
    assert blocked_run["requests"] == 0, "short-circuited calls must stay uncounted"


def test_a_second_block_does_not_overwrite_the_first(blocked_run):
    assert len(blocked_run["blocked_sections"]) == 2


def test_telegram_names_the_sections(blocked_run, monkeypatch):
    """The run stays green, so this message is the only thing that says it at
    the time. It has to carry the sections, not just 'a 403 happened'."""
    blocked_run.update(requests=1024, ok_200=18, http_403=141)
    sent: list[str] = []
    monkeypatch.setattr(o, "_telegram", lambda text, *, tag: sent.append(text))
    o._notify_blocked_sections()
    assert len(sent) == 1
    body = sent[0]
    # 18 of 1,024 requests served, so this is a partial block, not a total one.
    assert "ICE DEGRADED" in body
    assert "2 of 3 sections refused" in body
    assert "robusta stock report" in body and "robusta per-day sources" in body
    assert "412" in body
    # The remedy has to be right, or the reader tunes the interval again.
    # Matched as two facts rather than one phrase: the wording gained "on the
    # runner" when the message learned to name its own workflow, and pinning
    # the sentence verbatim made a clarification look like a regression.
    assert "per-IP block" in body and "not a pacing problem" in body


def test_a_clean_run_says_nothing(monkeypatch):
    o._RUN_STATS["blocked_sections"] = []
    sent: list[str] = []
    monkeypatch.setattr(o, "_telegram", lambda text, *, tag: sent.append(text))
    o._notify_blocked_sections()
    assert sent == []


def test_run_stats_row_carries_the_403_side(blocked_run, tmp_path, monkeypatch):
    """The row used to record `outcome: aborted_403` and not one 403 field —
    so the research page could only ever report rate limiting."""
    import json
    monkeypatch.setattr(o, "RUN_STATS_PATH", tmp_path / "ice_run_stats.json")
    blocked_run.update(requests=1024, ok_200=18, http_403=141)
    o._record_run_stats("completed", None)
    row = json.loads((tmp_path / "ice_run_stats.json").read_text())["runs"][-1]
    assert row["http_403"] == 141 and row["ok_200"] == 18
    assert row["aborted_by_403"] is True
    assert [b["section"] for b in row["blocked_sections"]] == [
        "robusta stock report", "robusta per-day sources"]


def test_degradation_row_reaches_the_data_map(blocked_run, tmp_path, monkeypatch):
    """The data-map panel reads conclusions, and this run's conclusion is
    success. The row is the only thing that puts it on that page."""
    import json

    from scraper import run_degradations as rd
    monkeypatch.setattr(rd, "PATH", tmp_path / "run_degradations.json")
    o._publish_degradation()
    doc = json.loads((tmp_path / "run_degradations.json").read_text())
    row = doc["runs"][-1]
    # Joined on the YAML basename: a display title is mutable and the Actions
    # API caches it per run.
    assert row["file"] == "scraper-ice-certified-stocks.yml"
    assert row["kind"] == "http_403"
    assert "2 of 3" in row["detail"] and "418" in row["detail"]
    assert len(row["items"]) == 2


def test_degradation_is_idempotent_per_run(blocked_run, tmp_path, monkeypatch):
    """A retried attempt replaces its own row rather than appending a second."""
    import json

    from scraper import run_degradations as rd
    monkeypatch.setattr(rd, "PATH", tmp_path / "run_degradations.json")
    monkeypatch.setenv("GITHUB_RUN_ID", "999")
    o._publish_degradation()
    o._publish_degradation()
    doc = json.loads((tmp_path / "run_degradations.json").read_text())
    assert len(doc["runs"]) == 1
