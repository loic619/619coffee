"""Tests for the morning brief handler — upcoming events section (issue #132 Body-4)."""
from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from telegram.handlers import brief

# ── Fixtures ─────────────────────────────────────────────────────────────────

# "Now" — picking a fixed date so the test isn't time-dependent. May 30 is
# matched by today's events; May 31 is matched by tomorrow's.
NOW = datetime(2026, 5, 30, 8, 0, tzinfo=UTC)


def _events(*entries: dict) -> dict:
    """Wrap a list of event dicts in the events.json envelope shape."""
    return {"_schema": "test", "events": list(entries)}


# ── Happy path: today + tomorrow render ──────────────────────────────────────

def test_renders_today_and_tomorrow(monkeypatch):
    doc = _events(
        {"date": "2026-05-30", "category": "wasde", "title": "WASDE Crop Production Report"},
        {"date": "2026-05-31", "category": "fnd",   "title": "KCN26 First Notice Day"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    # The "COMING UP" heading is emitted by the assembly in build_brief_message,
    # not by this builder — every section builder returns a body only.
    assert "Today" in out
    assert "Tomorrow" in out
    assert "[WASDE] WASDE Crop Production Report" in out
    assert "[FND] KCN26 First Notice Day" in out


def test_event_title_html_escaped(monkeypatch):
    """A scraped title with HTML metacharacters is escaped, so it can't break
    Telegram's parse_mode=HTML (400 → dropped brief) or inject markup."""
    doc = _events(
        {"date": "2026-05-30", "category": "wasde",
         "title": "Coffee <b>rally</b> & AT&T note"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert "Coffee &lt;b&gt;rally&lt;/b&gt; &amp; AT&amp;T note" in out
    assert "<b>rally</b>" not in out


def test_today_listed_before_tomorrow(monkeypatch):
    """Chronological sort: today rows must come before tomorrow rows."""
    doc = _events(
        {"date": "2026-05-31", "category": "fnd",   "title": "Tomorrow Event"},
        {"date": "2026-05-30", "category": "wasde", "title": "Today Event"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    today_pos = out.index("Today Event")
    tomorrow_pos = out.index("Tomorrow Event")
    assert today_pos < tomorrow_pos


# ── Filtering: only today + tomorrow get through ─────────────────────────────

def test_skips_past_and_future_events(monkeypatch):
    doc = _events(
        {"date": "2026-05-29", "category": "ico",   "title": "Yesterday Event"},  # past
        {"date": "2026-05-30", "category": "wasde", "title": "Today Event"},
        {"date": "2026-05-31", "category": "fnd",   "title": "Tomorrow Event"},
        {"date": "2026-06-01", "category": "cecafe","title": "Day-after Event"},  # future
        {"date": "2026-12-31", "category": "ico",   "title": "Year-end Event"},   # future
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert "Yesterday Event" not in out
    assert "Day-after Event" not in out
    assert "Year-end Event" not in out
    assert "Today Event" in out
    assert "Tomorrow Event" in out


# ── Graceful degradation ─────────────────────────────────────────────────────

def test_returns_none_when_events_json_missing(monkeypatch):
    monkeypatch.setattr(brief, "load", lambda name: None)
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_events_list_empty(monkeypatch):
    monkeypatch.setattr(brief, "load",
                        lambda name: {"_schema": "test", "events": []})
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_no_matching_dates(monkeypatch):
    """events.json may be populated, but none of its rows hit today/tomorrow.
    Currently the case on live data — no upcoming events in 2026-05-30..31."""
    doc = _events(
        {"date": "2025-12-26", "category": "fnd", "title": "Past Event"},
        {"date": "2026-12-31", "category": "ico", "title": "Far-future Event"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_events_json_is_not_a_dict(monkeypatch):
    """Defensive: load() could return a list or None on a malformed file."""
    monkeypatch.setattr(brief, "load", lambda name: ["not", "a", "dict"])
    assert brief._upcoming_events_section(NOW) is None


# ── Category label mapping ──────────────────────────────────────────────────

def test_unknown_category_falls_back_to_evt(monkeypatch):
    doc = _events(
        {"date": "2026-05-30", "category": "novel_category", "title": "X"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert "[EVT] X" in out


@pytest.mark.parametrize("category,label", [
    ("wasde",           "WASDE"),
    ("ico",             "ICO"),
    ("vietnam_customs", "VN"),
    ("cecafe",          "CECAFÉ"),
    ("fnd",             "FND"),
    ("central_bank",    "CB"),
    ("other",           "EVT"),
])
def test_category_label_mapping(monkeypatch, category, label):
    doc = _events({"date": "2026-05-30", "category": category, "title": "Foo"})
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert f"[{label}]" in out


# ── Integration smoke test: full brief tolerates missing optional data ──────

def test_build_brief_message_does_not_crash_with_no_events(monkeypatch):
    """Whole-handler smoke: brief renders even when every optional data
    source returns None (matching a fresh sandbox / cold-cache state)."""
    monkeypatch.setattr(brief, "load", lambda name: None)
    out = brief.build_brief_message()
    assert "COFFEE MORNING BRIEF" in out
    assert "COMING UP" not in out   # section omitted gracefully


# Note: the old `_weather_line` + `_drought_below_seasonal_floor` tests were
# removed in the brief redesign (PR #215). The weather section is now driven
# by `_weather_block` (frost-gate Jun-Aug + Vietnam rain/VHI dual-gate),
# tested in scraper/tests/test_brief_layout.py.


# ── Market prediction call + Coffee Currency Index ───────────────────────────
# Both are expected in EVERY brief: the open call must announce itself even
# when the model has no fresh view, and the CCI carries the FX read.

TODAY = NOW.date()


def _quant(**kw) -> dict:
    return {"quant_report.json": kw}


def _stub_quant(monkeypatch, payload: dict):
    monkeypatch.setattr(brief, "load",
                        lambda name: payload.get(name))


def test_open_call_renders_direction_and_confidence(monkeypatch):
    _stub_quant(monkeypatch, _quant(open_direction={
        "available": True, "for_session": TODAY.isoformat(),
        "direction": "Bearish", "prob_up": 0.2768, "expected_gap_usd_mt": -7.9,
    }))
    out = brief._open_direction_block(TODAY)
    # Confidence is stated in the direction's own terms (72% down, not 28% up).
    assert "RC open call" in out and "<b>Bearish</b> 72%" in out
    assert "exp. -8$/t" in out


def test_open_call_announces_itself_when_missing_or_stale(monkeypatch):
    # Stale: the newest call belongs to another session — say so, never render
    # yesterday's call as if it were today's.
    _stub_quant(monkeypatch, _quant(open_direction={
        "available": True, "for_session": "2026-05-29",
        "direction": "Bullish", "prob_up": 0.8,
    }))
    stale = brief._open_direction_block(TODAY)
    assert "pending" in stale and "2026-05-29" in stale
    assert "Bullish" not in stale
    # Absent / incomplete → an explicit "not available", not silence.
    _stub_quant(monkeypatch, _quant(open_direction={"available": False}))
    assert "not available" in brief._open_direction_block(TODAY)
    _stub_quant(monkeypatch, _quant(open_direction={
        "available": True, "for_session": TODAY.isoformat(), "direction": None, "prob_up": None}))
    assert "not available" in brief._open_direction_block(TODAY)


def test_placeholder_is_off_for_the_standalone_alert(monkeypatch):
    """The combined /brief digest reports 'no call yet' explicitly, but the
    standalone open_call topic must stay SILENT — there, returning text is
    what fires a Telegram push, so a placeholder would be a daily nag."""
    from scraper import topic_notify_daily as tnd

    for payload in (
        {"available": False},
        {"available": True, "for_session": "2026-05-29", "direction": "Bullish", "prob_up": 0.8},
        {"available": True, "for_session": TODAY.isoformat(), "direction": None, "prob_up": None},
    ):
        _stub_quant(monkeypatch, _quant(open_direction=payload))
        assert brief._open_direction_block(TODAY) is not None          # digest: says something
        assert brief._open_direction_block(TODAY, placeholder=False) is None  # alert: silent
        assert tnd.compose_open_call(NOW) is None
    # A genuine call still fires the standalone alert.
    _stub_quant(monkeypatch, _quant(open_direction={
        "available": True, "for_session": TODAY.isoformat(),
        "direction": "Bearish", "prob_up": 0.2768}))
    assert "Bearish" in tnd.compose_open_call(NOW)


def test_currency_index_level_move_and_drivers(monkeypatch):
    _stub_quant(monkeypatch, _quant(currency_index={
        "index_value": 106.694508, "daily_delta_pct": -0.022643, "zscore": 1.268627,
        "currencies": [
            {"ticker": "BRL=X", "daily_chg": -0.4757, "contribution": -0.00244},
            {"ticker": "COP=X", "daily_chg": 0.5642, "contribution": 0.000722},
            {"ticker": "VND=X", "daily_chg": 0.1989, "contribution": 0.000521},
        ],
    }))
    out = brief._currency_index_block()
    assert "<b>CCI</b> 106.69" in out
    # A falling index is price-bearish (producer currencies weakening vs USD).
    assert "▼ -0.02% d/d (bearish)" in out and "z +1.27" in out
    # Drivers are the biggest CONTRIBUTIONS (weight × move), largest first.
    assert "driven by BRL -0.48% · COP +0.56%" in out


def test_currency_index_silent_without_a_level(monkeypatch):
    _stub_quant(monkeypatch, _quant(currency_index={"index_value": None}))
    assert brief._currency_index_block() is None
    _stub_quant(monkeypatch, {})
    assert brief._currency_index_block() is None


# ── Front-contract run into FND (OI vs prior roll cycles) ────────────────────

def _oi_doc(cur_oi: int, peer_ois: list[int], day: int = -7, fnd: str = "2026-06-05"):
    """Newest contract plus peers, all carrying a point at the same day-to-FND."""
    peers = [{"symbol": f"KC{i}", "label": f"P{i}", "fnd": "2025-01-01",
              "data": [{"day": day, "oi": v, "price": 1.0}]}
             for i, v in enumerate(peer_ois)]
    cur = {"symbol": "KCU26", "label": "U26", "fnd": fnd,
           "data": [{"day": day - 1, "oi": cur_oi + 500, "price": 1.0},
                    {"day": day, "oi": cur_oi, "price": 1.0}]}
    return {"arabica": peers + [cur]}


def test_fnd_roll_line_letter_days_oi_and_position(monkeypatch):
    monkeypatch.setattr(brief, "load",
                        lambda n: _oi_doc(31_139, [23_116, 48_263, 29_241]) if n == "oi_fnd_chart.json" else None)
    out = brief._fnd_roll_line("arabica", date(2026, 5, 29))
    # Letter from the contract label; days to FND are calendar days from today,
    # with the trading-session count alongside (Fri 29 May → Fri 5 Jun = 5).
    assert out.strip().startswith("· FND (U) in 7d / 5 sessions")
    assert "OI 31.1k" in out
    # (31139-23116)/(48263-23116) = 31.9% → 32%
    assert "32% min-max" in out and "prior range" not in out


def test_fnd_roll_line_flags_a_broken_envelope(monkeypatch):
    """Clamping alone would render record-heavy OI as a bland '100%'."""
    monkeypatch.setattr(brief, "load",
                        lambda n: _oi_doc(23_751, [13_105, 21_029, 19_148]) if n == "oi_fnd_chart.json" else None)
    assert "100% min-max (above prior range)" in brief._fnd_roll_line("arabica", date(2026, 5, 29))
    monkeypatch.setattr(brief, "load",
                        lambda n: _oi_doc(9_000, [13_105, 21_029, 19_148]) if n == "oi_fnd_chart.json" else None)
    assert "0% min-max (below prior range)" in brief._fnd_roll_line("arabica", date(2026, 5, 29))


def test_fnd_roll_line_compares_like_for_like(monkeypatch):
    """Peers only count at the SAME distance from their own FND — OI drains
    into FND, so an off-day comparison would be meaningless."""
    doc = _oi_doc(31_139, [23_116, 48_263], day=-7)
    # A peer point at a different day-to-FND must be ignored entirely.
    doc["arabica"][0]["data"].append({"day": -30, "oi": 999_999, "price": 1.0})
    monkeypatch.setattr(brief, "load", lambda n: doc if n == "oi_fnd_chart.json" else None)
    assert "32% min-max" in brief._fnd_roll_line("arabica", date(2026, 5, 29))


def test_fnd_roll_line_silent_without_enough_history(monkeypatch):
    # One peer → a range of one value is not a range.
    monkeypatch.setattr(brief, "load",
                        lambda n: _oi_doc(31_139, [23_116]) if n == "oi_fnd_chart.json" else None)
    out = brief._fnd_roll_line("arabica", date(2026, 5, 29))
    assert "min-max" not in out and "OI 31.1k" in out   # still reports FND + OI
    # No chart data at all → nothing to say.
    monkeypatch.setattr(brief, "load", lambda _n: None)
    assert brief._fnd_roll_line("arabica", date(2026, 5, 29)) is None


# ── Speculative exposure into FND and the pace needed to clear it ────────────

def _spec_stub(monkeypatch, oi_doc, cot_rows):
    monkeypatch.setattr(brief, "load", lambda n: {
        "oi_fnd_chart.json": oi_doc, "cot.json": cot_rows}.get(n))


def test_spec_line_apportions_managed_money_and_paces_it(monkeypatch):
    # Front contract holds 20% of market OI → 20% of the MM book is assumed
    # to sit in it; that estimate is then spread over the sessions remaining.
    doc = _oi_doc(20_000, [1, 2], fnd="2026-06-05")          # FND Fri 5 Jun
    cot = [{"date": "2026-05-26", "ny": {"mm_long": 50_000, "mm_short": 10_000,
                                         "oi_total": 100_000}}]
    _spec_stub(monkeypatch, doc, cot)
    out = brief._fnd_spec_line("arabica", date(2026, 5, 29))  # Fri → 5 sessions
    # Net = 10k long − 2k short = +8k; 8,000 / 5 sessions = 1.6k per session.
    assert "Est. spec net position of +8.0k long" in out
    assert "clear pace of 1.6k per session (5 left)" in out


def test_spec_line_omits_pace_once_fnd_is_here(monkeypatch):
    doc = _oi_doc(20_000, [1, 2], fnd="2026-05-29")
    cot = [{"date": "2026-05-26", "ny": {"mm_long": 50_000, "mm_short": 10_000,
                                         "oi_total": 100_000}}]
    _spec_stub(monkeypatch, doc, cot)
    out = brief._fnd_spec_line("arabica", date(2026, 5, 29))
    assert "Est. spec net position" in out and "clear pace" not in out    # no sessions left to divide by


def test_spec_line_reads_the_right_market_and_bails_without_cot(monkeypatch):
    doc = {"robusta": _oi_doc(20_000, [1, 2])["arabica"]}
    cot = [{"date": "2026-05-26",
            "ny":  {"mm_long": 99_000, "mm_short": 99_000, "oi_total": 100_000},
            "ldn": {"mm_long": 50_000, "mm_short": 10_000, "oi_total": 100_000}}]
    _spec_stub(monkeypatch, doc, cot)
    # robusta must use the LDN book, never NY's.
    assert "+8.0k long" in brief._fnd_spec_line("robusta", date(2026, 5, 29))
    # No COT file, or a market block without totals → no estimate at all.
    _spec_stub(monkeypatch, doc, None)
    assert brief._fnd_spec_line("robusta", date(2026, 5, 29)) is None
    _spec_stub(monkeypatch, doc, [{"date": "x", "ldn": {"mm_long": 1, "mm_short": 1}}])
    assert brief._fnd_spec_line("robusta", date(2026, 5, 29)) is None


# ── Decertified stocks ───────────────────────────────────────────────────────

def test_decert_line_is_always_rendered(monkeypatch):
    """A missing line read as 'this exchange isn't tracked' rather than
    'nothing was decertified' — which is how New York looked while London
    showed a figure on the same message."""
    same = {"ANT": 100, "HOU": 50}
    assert brief._decert_line(same, same, "bags") == "· Decertified: none"
    # No prior snapshot to compare against is still an explicit answer.
    assert brief._decert_line(None, same, "bags") == "· Decertified: none"


def test_decert_sums_every_port_that_fell(monkeypatch):
    """Quoting only the largest port understated it badly: on 2026-08-18 four
    arabica ports fell for 2,126 bags while the biggest single one was 750."""
    prev = {"NOLA": 1000, "HOU": 600, "NY": 500, "ANT": 400, "MIAMI": 10}
    cur  = {"NOLA": 250,  "HOU": 75,  "NY": 6,   "ANT": 43,  "MIAMI": 10}
    assert brief._port_decreases(prev, cur) == [
        ("NOLA", 750), ("HOU", 525), ("NY", 494), ("ANT", 357)]
    line = brief._decert_line(prev, cur, "bags")
    assert line == "· Decertified: 2,126 bags across 4 ports (most NOLA 750)"


def test_decert_keeps_the_simple_wording_for_a_single_port():
    line = brief._decert_line({"LON": 120, "ANT": 50}, {"LON": 103, "ANT": 50}, "lots")
    assert line == "· Decertified: 17 lots in LON"


def test_decert_ignores_ports_that_gained():
    """A port taking delivery must not net off another port's decertification."""
    line = brief._decert_line({"ANT": 100, "HOU": 100}, {"ANT": 40, "HOU": 900}, "bags")
    assert line == "· Decertified: 60 bags in ANT"
