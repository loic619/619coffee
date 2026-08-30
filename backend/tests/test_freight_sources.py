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
from scraper.sources.freightos import _URL_TEMPLATES, FBX_LANES, FBX_NAMES


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
    assert set(FBX_NAMES) == {lane["code"] for lane in FBX_LANES}
    assert all(FBX_NAMES.values())


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
