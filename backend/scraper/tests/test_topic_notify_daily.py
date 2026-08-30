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
    """Brief stand-in: canned files, but the REAL fx lookup so the currency
    conversion is exercised rather than mocked away."""
    def __init__(self, files): self._f = files
    def load(self, name): return self._f.get(name)

    @staticmethod
    def _fx_close_on(doc, pair, on_date):
        from telegram.handlers.brief import _fx_close_on
        return _fx_close_on(doc, pair, on_date)


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
        "fx_history.json": {"pairs": {"BRL=X": {"history": [
            {"date": "2026-08-18", "close": 5.204454}]}}},
    })
    txt = t.compose_b3(dt.datetime.now(dt.UTC))
    assert "B3 close — 2026-08-18" in txt
    # Arabica is quoted in USD, so the move restates as cents/lb:
    # 13.40 / 132.2774 lb-per-saca × 100 = 10.13 ¢/lb.
    assert "• Arábica 4/5 (ICF) US$ 419.00/saca (Setembro/2026) ▲+13.40 (+3.3%) (+10.13 ¢/lb)" in txt
    # Conilon is BRL, so USD/t needs the session FX:
    # −15.27 × 1000/60 = −254.5 BRL/t ÷ 5.204454 = −48.9 → −49 $/t.
    assert "• Conilon 7/8 (CNL) R$ 1,037.01/saca (Sep '26) ▼-15.27 (-1.5%) (-49 $/t)" in txt


def test_b3_omits_the_usd_conversion_when_fx_is_missing():
    """A BRL move cannot be restated in USD without a rate — say nothing
    rather than guess one."""
    docs = {"brazil_b3_conilon.json": {"history": [
        {"date": "2026-08-16", "front_month": "Sep '26", "front_price": 1052.28},
        {"date": "2026-08-18", "front_month": "Sep '26", "front_price": 1037.01}]}}
    line = t._b3_line(docs["brazil_b3_conilon.json"], "Conilon 7/8 (CNL)", "R$", None)
    assert "▼-15.27 (-1.5%)" in line and "$/t" not in line


def test_b3_survives_one_board_missing(monkeypatch):
    _stub(monkeypatch, {"brazil_b3_conilon.json": {"history": [
        {"date": "2026-08-18", "front_month": "Sep '26", "front_price": 1037.01}]}})
    txt = t.compose_b3(dt.datetime.now(dt.UTC))
    assert "Conilon" in txt and "Arábica" not in txt
    _stub(monkeypatch, {})
    assert t.compose_b3(dt.datetime.now(dt.UTC)) is None


def test_clock_relative_staleness_tag_does_not_count_as_news(state):
    """The certified text re-sent on 2026-08-21 with byte-identical figures:
    the only diff was London gaining '(2d old)' as the clock passed midnight
    UTC. A relative age is not a data change, so it must not mint a new mark."""
    before = ("🪤 <b>Certified stocks</b>\n<b>New York</b>: 2026-08-20\n"
              "· Stocks: 228,378 bags (-836)\n\n<b>London</b>: 2026-08-19\n"
              "· Stocks: 4,603 lots (0)")
    after = before.replace("<b>London</b>: 2026-08-19",
                           "<b>London</b>: 2026-08-19 <i>(2d old)</i>")
    assert t._dedup_mark("certified", before) == t._dedup_mark("certified", after)

    t.mark_sent("certified", t._dedup_mark("certified", before))
    assert t.already_sent("certified", t._dedup_mark("certified", after)) is True

    # A real move still gets through.
    moved = after.replace("4,603 lots (0)", "4,700 lots (+97)")
    assert t.already_sent("certified", t._dedup_mark("certified", moved)) is False


def test_stale_tag_stripping_leaves_the_sent_message_untouched(monkeypatch, state):
    """Only the dedup MARK is normalised — the reader still sees the age."""
    text = "🪤 x\n<b>London</b>: 2026-08-19 <i>(3d old)</i>"
    sent = []
    monkeypatch.setattr(t, "send", lambda s: sent.append(s))
    monkeypatch.setitem(t.TOPICS, "certified", lambda _now: text)
    monkeypatch.setattr(sys, "argv", ["x", "certified"])
    assert t.main() == 0
    assert sent == [text] and "(3d old)" in sent[0]


# ── the B3 header date must never be borrowed by a staler line ───────────────
# One header covers two markets that settle independently. On 2026-08-30 the
# conilon file had advanced (a weekend row) while arabica had not, so Friday's
# arabica close was published under "B3 close — 2026-08-30". A stale number
# wearing a fresh date is worse than no date, so the line says its own.

def _doc(*rows):
    return {"history": [{"date": d, "front_price": p, "front_month": "Sep '26"}
                        for d, p in rows]}


def test_b3_line_flags_itself_when_older_than_the_header():
    doc = _doc(("2026-08-27", 401.95), ("2026-08-28", 404.95))
    line = t._b3_line(doc, "Arábica 4/5 (ICF)", "US$", header_day="2026-08-30")
    assert "as of 2026-08-28" in line


def test_b3_line_stays_clean_when_it_matches_the_header():
    doc = _doc(("2026-08-27", 401.95), ("2026-08-28", 404.95))
    line = t._b3_line(doc, "Arábica 4/5 (ICF)", "US$", header_day="2026-08-28")
    assert "as of" not in line
