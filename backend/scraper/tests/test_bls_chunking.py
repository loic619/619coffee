"""Tests for the BLS chunking helper — the fix for the frozen-CPI incident.

Root cause being pinned: keyless BLS silently serves only the FIRST 10
calendar years of an over-long window, so us_cpi (2016–2026 requested) froze
at 2025-12 and retail_cpi (2011–2026) froze at 2020-12 while every run
logged REQUEST_SUCCEEDED."""
from scraper.utils import bls


def test_year_chunks_honour_the_10_year_cap():
    # the exact windows that were silently truncated in production:
    assert bls.year_chunks(2016, 2026, 10) == [(2016, 2025), (2026, 2026)]
    assert bls.year_chunks(2011, 2026, 10) == [(2011, 2020), (2021, 2026)]
    # exactly-10-year window stays a single request
    assert bls.year_chunks(2017, 2026, 10) == [(2017, 2026)]
    # keyed 20-year window
    assert bls.year_chunks(2007, 2026, 20) == [(2007, 2026)]


def test_fetch_series_merges_chunks(monkeypatch):
    """Two chunked responses must merge into one continuous series — i.e. the
    2026 data the clamp used to drop now arrives via its own chunk."""
    calls = []

    class FakeResp:
        def __init__(self, payload):
            start, end = int(payload["startyear"]), int(payload["endyear"])
            self._body = {"status": "REQUEST_SUCCEEDED", "Results": {"series": [{
                "seriesID": "CUUR0000SA0",
                "data": [{"year": str(y), "period": "M01", "value": str(100 + y - 2016)}
                         for y in range(start, end + 1)],
            }]}}
        def raise_for_status(self): pass
        def json(self): return self._body

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append((json["startyear"], json["endyear"]))
        return FakeResp(json)

    monkeypatch.setattr(bls.requests, "post", fake_post)
    out = bls.fetch_series(["CUUR0000SA0"], 2016, 2026, api_key="", tag="test")
    assert calls == [("2016", "2025"), ("2026", "2026")]      # two honoured requests
    rows = out["CUUR0000SA0"]
    periods = [r["period"] for r in rows]
    assert periods == sorted(periods)
    assert "2026-01" in periods and "2016-01" in periods       # the frozen year is back
    assert bls.newest_period(out) == "2026-01"


def test_fetch_series_partial_failure_still_returns(monkeypatch):
    """One chunk failing must not lose the other chunk's data."""
    def fake_post(url, headers=None, json=None, timeout=None):
        class R:
            def raise_for_status(self): pass
            def json(self):
                if json["startyear"] == "2016":
                    return {"status": "REQUEST_NOT_PROCESSED", "message": ["boom"]}
                return {"status": "REQUEST_SUCCEEDED", "Results": {"series": [{
                    "seriesID": "X", "data": [{"year": "2026", "period": "M06", "value": "1.5"}]}]}}
        return R()

    monkeypatch.setattr(bls.requests, "post", fake_post)
    out = bls.fetch_series(["X"], 2016, 2026, tag="test")
    assert out == {"X": [{"period": "2026-06", "index": 1.5}]}


def test_fetch_series_total_failure_returns_none(monkeypatch):
    def fake_post(url, headers=None, json=None, timeout=None):
        raise OSError("network down")
    monkeypatch.setattr(bls.requests, "post", fake_post)
    monkeypatch.setattr(bls.time, "sleep", lambda s: None)   # skip retry backoff
    monkeypatch.setattr(bls, "_browser_post_chunk", lambda *a: None)  # hermetic
    assert bls.fetch_series(["X"], 2020, 2026, tag="test") is None


def test_browser_fallback_engages_after_requests_exhausted(monkeypatch):
    """The 2026-08-09 endgame: requests 503s forever (Cloudflare IP block),
    the browser path serves — data must flow through it."""
    def fake_post(url, headers=None, json=None, timeout=None):
        raise OSError("503 blocked")
    monkeypatch.setattr(bls.requests, "post", fake_post)
    monkeypatch.setattr(bls.time, "sleep", lambda s: None)
    monkeypatch.setattr(bls, "_browser_post_chunk", lambda payload, tag, span: {
        "status": "REQUEST_SUCCEEDED", "Results": {"series": [{
            "seriesID": "X", "data": [{"year": "2026", "period": "M06", "value": "3"}]}]}})
    out = bls.fetch_series(["X"], 2020, 2026, tag="test")
    assert out == {"X": [{"period": "2026-06", "index": 3.0}]}


def test_post_chunk_retries_transient_503(monkeypatch):
    """The 2026-08-09 failure mode: BLS 503s a couple of times, then serves."""
    calls = {"n": 0}

    def fake_post(url, headers=None, json=None, timeout=None):
        calls["n"] += 1
        class R:
            def raise_for_status(self):
                if calls["n"] < 3:
                    raise OSError("503 Server Error")
            def json(self):
                return {"status": "REQUEST_SUCCEEDED", "Results": {"series": [{
                    "seriesID": "X", "data": [{"year": "2026", "period": "M06", "value": "2"}]}]}}
        return R()

    monkeypatch.setattr(bls.requests, "post", fake_post)
    monkeypatch.setattr(bls.time, "sleep", lambda s: None)
    out = bls.fetch_series(["X"], 2020, 2026, tag="test")
    assert calls["n"] == 3                                   # two 503s + success
    assert out == {"X": [{"period": "2026-06", "index": 2.0}]}
