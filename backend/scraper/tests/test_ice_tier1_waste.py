"""Tier-1 must not re-ask questions the sweep or a previous run already answered.

Tier-1 is a fixed list of ~50 publish seconds learned from OTHER days, tried
against the date in hand at the 5s marketdata throttle — 4+ minutes per date.
Run 33864176535 spent it on three dates (12.5 minutes) before the sweep began.
"""
from datetime import date

import pytest

from scraper.sources.ice_certified_stocks import orchestrate as o


@pytest.fixture
def cursor(tmp_path, monkeypatch):
    monkeypatch.setattr(o, "STOCK_REPORT_CURSOR_PATH", tmp_path / "cursor.json")
    return tmp_path / "cursor.json"


def test_tried_dates_persist_and_are_capped(cursor):
    for i in range(1, 4):
        o._mark_tier1_tried(date(2026, 9, i))
    assert o._tier1_already_tried(date(2026, 9, 2))
    assert not o._tier1_already_tried(date(2026, 9, 9))


def test_marking_survives_a_cursor_write(cursor):
    """The resume cursor and the tried-list have different lifetimes: a sweep
    that stops mid-walk must not wipe the record of which dates tier-1 missed."""
    o._mark_tier1_tried(date(2026, 8, 31))
    o._save_cursor(date(2026, 9, 3), "103340")          # sweep interrupted
    assert o._tier1_already_tried(date(2026, 8, 31)), "tried-list lost on cursor write"
    o._save_cursor(date(2026, 9, 3), None)               # sweep found it — cursor cleared
    assert o._tier1_already_tried(date(2026, 8, 31)), "tried-list lost on cursor clear"


def test_every_tier1_time_currently_falls_inside_the_sweep_window():
    """Which is why tier-1 on the sweep day is 50 GETs of pure duplication —
    the sweep reaches every one of them anyway. If a time outside the window
    is ever recorded (2026-08-25 published 11:23:51), it stays worth trying,
    and the split in pull_stock_report keeps exactly those."""
    in_window = set(o._stock_report_sweep_times())
    tier1 = o._stock_report_tier1_times()
    outside = [t for t in tier1 if t not in in_window]
    assert len(tier1) > 0
    assert outside == [], f"expected all tier-1 inside the window today, got {outside} outside"
