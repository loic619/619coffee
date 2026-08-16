"""Tests for the per-source Telegram texts that replaced the morning brief.

The property that matters most: chained triggers fire whenever their workflow
completes — several times a day for 1.4 Export-and-Publish — so an alert must
send only when its numbers actually changed, never on every trigger.
"""
import datetime as dt
import sys

import pytest

from scraper import topic_notify_daily as t


@pytest.fixture
def state(tmp_path, monkeypatch):
    monkeypatch.setattr(t, "_STATE", tmp_path / "topic_notify_state.json")
    return tmp_path / "topic_notify_state.json"


# ── idempotency (the whole point of the fingerprint) ─────────────────────────

def test_repeat_trigger_with_unchanged_text_is_suppressed(state):
    msg = "📈 Futures — session 2026-08-13\nRC 3,644"
    assert t.already_sent("prices", msg) is False     # first ever
    t.mark_sent("prices", msg)
    assert t.already_sent("prices", msg) is True      # 1.4 fires again, same data
    assert t.already_sent("prices", msg + " ▼") is False   # numbers moved → send


def test_topics_do_not_share_state(state):
    t.mark_sent("prices", "same text")
    assert t.already_sent("prices", "same text") is True
    assert t.already_sent("weather", "same text") is False


def test_state_survives_reload_and_is_readable(state):
    t.mark_sent("cci", "💱 CCI 106.33")
    assert state.exists()
    import json
    doc = json.loads(state.read_text())
    assert set(doc["cci"]) == {"fingerprint", "sent_at"}
    assert t.already_sent("cci", "💱 CCI 106.33") is True


def test_corrupt_state_file_does_not_block_sending(state):
    state.write_text("{ not json")
    assert t.already_sent("prices", "anything") is False   # degrades to "send"


# ── composers ────────────────────────────────────────────────────────────────

def test_every_topic_is_registered_and_callable():
    expected = {"prices", "origin_prices", "options", "certified",
                "brazil_daily", "cci", "open_call", "weather", "week_ahead"}
    assert set(t.TOPICS) == expected
    assert all(callable(fn) for fn in t.TOPICS.values())


def test_cci_composer_formats_and_flags_stretch(monkeypatch):
    class FakeBrief:
        @staticmethod
        def load(_name):
            return {"currency_index": {"index_value": 106.334,
                                       "daily_delta_pct": -0.07, "zscore": 1.42}}
    monkeypatch.setattr(t, "_brief", lambda: FakeBrief)
    out = t.compose_cci(dt.datetime.now(dt.UTC))
    assert "106.33" in out and "-0.07%" in out and "stretched strong" in out


def test_composers_return_none_when_data_absent(monkeypatch):
    class EmptyBrief:
        @staticmethod
        def load(_name):
            return None
        @staticmethod
        def _cert_stocks_block():
            return None
        @staticmethod
        def _weather_block(_d):
            return None
        @staticmethod
        def _upcoming_events_section(_n):
            return None
        @staticmethod
        def _open_direction_block(_d, placeholder=True):
            return None
    monkeypatch.setattr(t, "_brief", lambda: EmptyBrief)
    now = dt.datetime.now(dt.UTC)
    for name in ("prices", "certified", "weather", "week_ahead", "open_call", "cci"):
        assert t.TOPICS[name](now) is None, name


def test_a_broken_composer_never_fails_the_scraper(monkeypatch, state):
    """The notify step runs inside data workflows — it must not break them."""
    def boom(_now):
        raise RuntimeError("upstream shape changed")
    monkeypatch.setitem(t.TOPICS, "prices", boom)
    monkeypatch.setattr(sys, "argv", ["x", "prices"])
    assert t.main() == 0
