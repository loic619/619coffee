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
    expected = {"prices", "b3", "origin_prices", "options", "certified",
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


# ── dedup on the report's identity, not its text ─────────────────────────────

class _StubBrief:
    """Minimal brief stand-in exposing just load()."""
    def __init__(self, files): self._f = files
    def load(self, name): return self._f.get(name)


def _stub(monkeypatch, files):
    monkeypatch.setattr(t, "_brief", lambda: _StubBrief(files))


def test_market_topics_dedup_on_the_session_not_the_text(monkeypatch, tmp_path):
    """1.4 re-exports several times a day and acaphe/FX move intraday, so the
    same session's message came out three times on 2026-08-19. The mark must
    be the session, so a recomputation of an already-sent one stays silent."""
    monkeypatch.setattr(t, "_STATE", tmp_path / "state.json")
    _stub(monkeypatch, {"futures_chain.json": {"robusta": {"pub_date": "2026-08-18"}}})

    first = t._dedup_mark("prices", "RC 3,594 ▼-50")
    assert first == "prices@2026-08-18"
    t.mark_sent("prices", first)
    # Numbers drift on the next run — same session, so still suppressed.
    assert t.already_sent("prices", t._dedup_mark("prices", "RC 3,596 ▼-48")) is True

    # A new session gets through even with byte-identical text.
    _stub(monkeypatch, {"futures_chain.json": {"robusta": {"pub_date": "2026-08-19"}}})
    assert t.already_sent("prices", t._dedup_mark("prices", "RC 3,594 ▼-50")) is False


def test_dedup_falls_back_to_content_without_a_key(monkeypatch):
    # A topic with no key keeps the old behaviour…
    assert t._dedup_mark("weather", "🌦 text") == "🌦 text"
    # …and so does a keyed topic whose key is unavailable, so a missing file
    # can never suppress a send.
    _stub(monkeypatch, {})
    assert t._dedup_mark("prices", "RC 3,594") == "RC 3,594"


def test_origin_and_b3_keys_take_the_newest_quote_day(monkeypatch):
    _stub(monkeypatch, {
        "origin_prices_history.json": {"origins": {
            "vietnam": {"history": [{"date": "2026-08-17"}, {"date": "2026-08-18"}]},
            "uganda":  {"history": [{"date": "2026-08-15"}]},
        }},
        "brazil_b3_arabica.json": {"history": [{"date": "2026-08-18", "front_price": 419.0}]},
        "brazil_b3_conilon.json": {"history": [{"date": "2026-08-17", "front_price": 1037.01}]},
    })
    assert t._origin_quote_key() == "2026-08-18"
    assert t._b3_key() == "2026-08-18"


# ── B3 close ─────────────────────────────────────────────────────────────────

def test_b3_reports_both_boards_with_their_own_units(monkeypatch):
    _stub(monkeypatch, {
        "brazil_b3_arabica.json": {"history": [
            {"date": "2026-08-17", "front_month": "Setembro/2026", "front_price": 405.6},
            {"date": "2026-08-18", "front_month": "Setembro/2026", "front_price": 419.0}]},
        "brazil_b3_conilon.json": {"history": [
            {"date": "2026-08-16", "front_month": "Sep '26", "front_price": 1052.28},
            {"date": "2026-08-18", "front_month": "Sep '26", "front_price": 1037.01}]},
    })
    txt = t.compose_b3(dt.datetime.now(dt.UTC))
    assert "B3 close — 2026-08-18" in txt
    assert "• Arábica 4/5 (ICF) US$ 419.00/saca (Setembro/2026) ▲+13.40 (+3.3%)" in txt
    assert "• Conilon 7/8 (CNL) R$ 1,037.01/saca (Sep '26) ▼-15.27 (-1.5%)" in txt


def test_b3_survives_one_board_missing(monkeypatch):
    _stub(monkeypatch, {"brazil_b3_conilon.json": {"history": [
        {"date": "2026-08-18", "front_month": "Sep '26", "front_price": 1037.01}]}})
    txt = t.compose_b3(dt.datetime.now(dt.UTC))
    assert "Conilon" in txt and "Arábica" not in txt
    _stub(monkeypatch, {})
    assert t.compose_b3(dt.datetime.now(dt.UTC)) is None
