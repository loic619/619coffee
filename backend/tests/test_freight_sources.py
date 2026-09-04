"""The FBX lane table, and the dry-bulk cache fallback.

Both guard against silent-nothing failures rather than crashes: a mistyped slug
returns a 404 the scraper logs and moves past, and a missing dry_bulk cache used
to produce a farmer_economics.json with no dry_bulk block at all while every job
reported success.
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scraper.sources import dry_bulk
from scraper.sources.freightos import (
    _URL_TEMPLATES,
    FBX_COMPOSITE_CODE,
    FBX_LANES,
    FBX_NAMES,
    _nonce_candidates,
    _parse_ticker,
)


def test_all_twelve_published_lanes_are_configured():
    """Probe 0.27 resolved exactly twelve live lane pages; all twelve are here."""
    assert len(FBX_LANES) == 12


def test_lane_codes_are_unique_and_match_their_slug():
    codes = [lane["code"] for lane in FBX_LANES]
    assert len(set(codes)) == len(codes)
    for lane in FBX_LANES:
        # FBX11 -> fbx-11-...  A transposed digit here silently 404s.
        assert lane["slug"].startswith(f"fbx-{lane['code'][3:]}-"), lane


def test_lane_names_cover_every_code():
    """Every lane, plus the composite — which is an index, not a thirteenth lane.

    Freightos publishes FBX alongside the twelve on the same ticker call. It is
    a global weighted average, so it belongs in FBX_NAMES (the exporter titles
    indices from there) and deliberately not in FBX_LANES, which anything
    reasoning about tradelanes iterates.
    """
    assert set(FBX_NAMES) == {lane["code"] for lane in FBX_LANES} | {FBX_COMPOSITE_CODE}
    assert all(FBX_NAMES.values())
    assert FBX_COMPOSITE_CODE not in {lane["code"] for lane in FBX_LANES}


def test_url_templates_all_take_a_slug():
    for template in _URL_TEMPLATES:
        assert "{slug}" in template


def test_fetch_or_refresh_uses_a_fresh_cache(monkeypatch):
    fresh = {"last_date": date.today().isoformat(), "last_price": 12.3}
    monkeypatch.setattr(dry_bulk, "fetch_latest", lambda: fresh)
    monkeypatch.setattr(dry_bulk, "_fetch_bdry", lambda: _must_not_fetch())
    assert dry_bulk.fetch_or_refresh() is fresh


def test_fetch_or_refresh_fetches_when_the_cache_is_absent(monkeypatch):
    """The CI case: the cache is gitignored and never reaches the export job."""
    live = {"last_date": date.today().isoformat(), "last_price": 9.9}
    monkeypatch.setattr(dry_bulk, "fetch_latest", lambda: None)
    monkeypatch.setattr(dry_bulk, "_fetch_bdry", lambda: live)
    assert dry_bulk.fetch_or_refresh() is live


def test_fetch_or_refresh_refetches_a_stale_cache(monkeypatch):
    stale = {"last_date": (date.today() - timedelta(days=30)).isoformat(), "last_price": 1.0}
    live  = {"last_date": date.today().isoformat(), "last_price": 9.9}
    monkeypatch.setattr(dry_bulk, "fetch_latest", lambda: stale)
    monkeypatch.setattr(dry_bulk, "_fetch_bdry", lambda: live)
    assert dry_bulk.fetch_or_refresh() is live


def test_fetch_or_refresh_falls_back_to_a_stale_cache_when_offline(monkeypatch):
    """An old price carrying its own date beats an empty panel."""
    stale = {"last_date": (date.today() - timedelta(days=30)).isoformat(), "last_price": 1.0}
    monkeypatch.setattr(dry_bulk, "fetch_latest", lambda: stale)
    monkeypatch.setattr(dry_bulk, "_fetch_bdry", lambda: None)
    assert dry_bulk.fetch_or_refresh() is stale


def _must_not_fetch():  # pragma: no cover - only reached on a regression
    raise AssertionError("a fresh cache must not trigger a network fetch")


# ── the ticker endpoint (probe 0.32) ─────────────────────────────────────────

def test_nonce_candidates_prefer_an_explicit_nonce_field():
    """The right token first, so a normal run is one POST rather than twenty.

    The action name is absent from the served HTML — it lives in a bundled
    script — so there is nothing to anchor a positional regex to, and an
    earlier attempt that matched "a nonce-shaped field" picked a real token
    belonging to something else. Gather, ordered; let the endpoint decide.
    """
    html = '<script>var a={"x":"aaaaaaaaaa"};var t={"nonce":"b981c0691e"};</script>'
    got = _nonce_candidates(html)
    assert got[0] == "b981c0691e", "an explicit nonce field must be tried first"
    assert "aaaaaaaaaa" in got, "other tokens stay as a backstop"


def test_nonce_candidates_are_unique_and_lowercased():
    html = "AAAAAAAAAA aaaaaaaaaa bbbbbbbbbb bbbbbbbbbb"
    got = _nonce_candidates(html)
    assert got == ["aaaaaaaaaa", "bbbbbbbbbb"]


def test_nonce_candidates_empty_when_the_page_has_none():
    assert _nonce_candidates("<html><body>nothing here</body></html>") == []


def test_parse_ticker_reads_the_published_shape():
    payload = {"success": True, "data": [
        {"label": "FBX", "value": "$3,590", "change": "+0.54%"},
        {"label": "FBX01", "value": "$7,621", "change": "+1.73%"},
        {"label": "FBX11", "value": "$4,641", "change": "-1.23%"},
    ]}
    assert _parse_ticker(payload) == {"FBX": 3590.0, "FBX01": 7621.0, "FBX11": 4641.0}


def test_parse_ticker_enforces_the_plausibility_band():
    """A layout change that starts returning zeros costs an observation, not
    a corrupted series — the same guard the per-lane path applies."""
    payload = {"success": True, "data": [
        {"label": "FBX01", "value": "$0"},
        {"label": "FBX03", "value": "$9,791"},
        {"label": "FBX11", "value": "$999,999"},
    ]}
    assert _parse_ticker(payload) == {"FBX03": 9791.0}


def test_parse_ticker_ignores_labels_we_do_not_know():
    payload = {"success": True, "data": [
        {"label": "FBX99", "value": "$1,000"},
        {"label": "", "value": "$1,000"},
        {"label": "FBX11", "value": "$4,641"},
    ]}
    assert _parse_ticker(payload) == {"FBX11": 4641.0}


def test_parse_ticker_survives_a_rejection_payload():
    """A bogus nonce returns {"success": false, "data": "..."} — a string, not
    a list. It must yield nothing rather than raise."""
    assert _parse_ticker({"success": False, "data": "Invalid nonce"}) == {}
    assert _parse_ticker({}) == {}


def _fake_http(monkeypatch, *, page_text="", page_exc=None, replies=None):
    """Stub requests.get/post; `replies` maps nonce -> (status, body)."""
    import requests

    class _R:
        def __init__(self, status, body):
            self.status_code, self.text = status, body
            self.content = body.encode()

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(self.status_code)

        def json(self):
            import json as _j
            return _j.loads(self.text)

    def fake_get(url, **kw):
        if page_exc:
            raise page_exc
        return _R(200, page_text)

    def fake_post(url, data=None, **kw):
        import re as _re
        m = _re.search(r"nonce=([0-9a-f]+)", data or "")
        return _R(*(replies or {}).get(m.group(1) if m else "", (200, "0")))

    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setattr(requests, "post", fake_post)


_GOOD = '{"success":true,"data":[{"label":"FBX11","value":"$4,641"}]}'


def test_fetch_ticker_walks_past_a_rejected_nonce(monkeypatch):
    """A WordPress page carries several nonces; the first tried may not be it."""
    from scraper.sources import freightos as fx

    _fake_http(
        monkeypatch,
        page_text='var a={"nonce":"aaaaaaaaaa"};var b={"nonce":"b981c0691e"};',
        replies={"aaaaaaaaaa": (200, '{"success":false,"data":"x"}'),
                 "b981c0691e": (200, _GOOD)},
    )
    assert fx.fetch_ticker() == {"FBX11": 4641.0}


def test_fetch_ticker_gives_up_quietly_when_none_is_accepted(monkeypatch):
    """{} not an exception — `run` falls back to the browser rather than
    losing the day's prints."""
    from scraper.sources import freightos as fx

    _fake_http(monkeypatch, page_text='{"nonce":"aaaaaaaaaa"}',
               replies={"aaaaaaaaaa": (200, '{"success":false,"data":"x"}')})
    assert fx.fetch_ticker() == {}


def test_fetch_ticker_gives_up_quietly_when_the_page_is_unreachable(monkeypatch):
    from scraper.sources import freightos as fx

    _fake_http(monkeypatch, page_exc=RuntimeError("boom"))
    assert fx.fetch_ticker() == {}


def test_fetch_ticker_ignores_the_bare_zero(monkeypatch):
    """An unhandled action returns `0` — valid JSON, parses to nothing."""
    from scraper.sources import freightos as fx

    _fake_http(monkeypatch, page_text='{"nonce":"aaaaaaaaaa"}',
               replies={"aaaaaaaaaa": (200, "0")})
    assert fx.fetch_ticker() == {}
