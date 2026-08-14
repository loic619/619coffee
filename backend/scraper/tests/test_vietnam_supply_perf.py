"""Regression for the 2026-08-14 export-time finding.

`vietnam_supply` was 275 s of a 310 s nightly export (89% of the whole job,
5-10 runs/day). Cause: nso.gov.vn is unreachable from GitHub runners, and the
walk is 3 years x 3 slug candidates at a 30 s CONNECT timeout — 9 x 30 s = 270 s
burned to contribute +0 months.

These tests pin the two guards: one connect failure short-circuits the entire
NSO walk, and a reachable host still works exactly as before.
"""
import requests

from scraper.sources import vietnam_supply as vs


def _reset_breaker():
    vs._nso_host_unreachable = False


def test_one_connect_failure_skips_every_remaining_probe(monkeypatch):
    """The production case: 9 probes collapse to 1."""
    _reset_breaker()
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        raise requests.ConnectionError("connect timed out")

    monkeypatch.setattr(vs.requests, "get", fake_get)
    for year in (2026, 2025, 2024):
        assert vs._fetch_nso_year_page(year) is None
    assert len(calls) == 1, f"expected 1 probe after the breaker trips, got {len(calls)}"


def test_timeout_is_a_short_connect_plus_generous_read(monkeypatch):
    _reset_breaker()
    seen = {}

    def fake_get(url, **kw):
        seen["timeout"] = kw.get("timeout")
        raise requests.ConnectionError("down")

    monkeypatch.setattr(vs.requests, "get", fake_get)
    vs._fetch_nso_year_page(2026)
    connect, read = seen["timeout"]
    assert connect <= 10, "connect timeout must be short — this was the 270s"
    assert read >= 20, "read timeout should stay generous for slow xlsx pages"


def test_reachable_host_still_works(monkeypatch):
    """The guard must not disable a source that actually answers."""
    _reset_breaker()

    class OK:
        status_code = 200
        text = '<a href="/data/file.xlsx">x</a>'
        content = b"x" * 10

    monkeypatch.setattr(vs.requests, "get", lambda url, **kw: OK())
    assert vs._fetch_nso_year_page(2026) == OK.text
    assert vs._nso_host_unreachable is False


def test_non_connection_error_does_not_trip_the_breaker(monkeypatch):
    """A per-URL parse/HTTP oddity should still let other slugs be tried."""
    _reset_breaker()
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        raise ValueError("weird body")

    monkeypatch.setattr(vs.requests, "get", fake_get)
    vs._fetch_nso_year_page(2026)
    assert len(calls) == len(vs._NSO_YEAR_PAGE_TEMPLATES)
    assert vs._nso_host_unreachable is False
