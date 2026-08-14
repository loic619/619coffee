import datetime
from datetime import UTC

from scraper.morning_brief import (
    _pct_change,
    _rain_cue,
    _split_message,
    _supply_weather_section,
)
from scraper.sources._weather_baseline import mtd_rain_mm


def test_pct_change():
    assert _pct_change(-5.45, 300.35) == -5.45 / 300.35 * 100
    assert _pct_change(None, 100) is None
    assert _pct_change(5, 0) is None


def test_rain_cue_buckets():
    assert _rain_cue(5, 30, 140) == "record-dry"   # below historical min
    assert _rain_cue(200, 30, 140) == "record-wet"  # above historical max
    assert _rain_cue(42, 18, 96) == "normal"        # mid-envelope
    assert _rain_cue(30, 18, 96) == "dry"           # bottom quartile
    assert _rain_cue(90, 18, 96) == "wet"           # top quartile
    assert _rain_cue(50, 50, 50) == "normal"        # zero-width envelope


def test_mtd_rain_mm_sums_current_month_only():
    daily = [
        {"date": "2026-04-30", "precip_mm": 99},   # prior month, ignored
        {"date": "2026-05-01", "precip_mm": 10},
        {"date": "2026-05-02", "precip_mm": 5.5},
    ]
    assert mtd_rain_mm(daily, datetime.date(2026, 5, 22)) == 15.5
    assert mtd_rain_mm([], datetime.date(2026, 5, 22)) is None


def test_split_message_respects_limit_and_keeps_sections():
    text = "\n\n".join(f"<b>S{i}</b>\n" + ("x" * 1200) for i in range(6))
    chunks = _split_message(text, limit=3900)
    assert len(chunks) >= 2
    assert all(len(c) <= 3900 for c in chunks)
    # Every section survives the split exactly once.
    rejoined = "\n\n".join(chunks)
    for i in range(6):
        assert f"<b>S{i}</b>" in rejoined


def test_supply_weather_rain_mode(monkeypatch):
    import scraper.morning_brief as mb

    fake = {
        "farmer_economics": {"weather": {"regions": [
            {"name": "Cerrado", "drought": "MED", "csi_30d_level": "NONE",
             "rain_mtd_mm": 42.0, "rain_hist_min": 18.0, "rain_hist_max": 96.0},
        ]}},
    }
    monkeypatch.setattr(mb, "_load", lambda fn: fake.get(fn.replace(".json", "")))
    out = _supply_weather_section()
    assert "Cerrado" in out
    assert "MTD 42mm" in out
    assert "18–96" in out
    assert "normal" in out


# ── Freshness gate ────────────────────────────────────────────────────────────

def test_expected_session_rolls_over_weekend():
    from datetime import datetime

    from scraper.morning_brief import _expected_session
    # Monday 03:00 UTC → expected session is the prior Friday.
    mon = datetime(2026, 6, 29, 3, 0, tzinfo=UTC)   # 2026-06-29 is a Monday
    assert _expected_session(mon).isoformat() == "2026-06-26"
    # Wednesday → expected is Tuesday.
    wed = datetime(2026, 7, 1, 3, 0, tzinfo=UTC)
    assert _expected_session(wed).isoformat() == "2026-06-30"


def test_send_decision(monkeypatch):
    from datetime import date, datetime

    import scraper.morning_brief as mb

    def at(h):
        return datetime(2026, 7, 1, h, 0, tzinfo=UTC)   # Wed → expected 06-30

    # fresh data (futures shows the expected session) inside the window → send
    monkeypatch.setattr(mb, "_futures_pub_date", lambda: date(2026, 6, 30))
    assert mb._send_decision(at(4))[0] is True

    # stale data before the fallback hour → skip (wait for fresh)
    monkeypatch.setattr(mb, "_futures_pub_date", lambda: date(2026, 6, 29))
    assert mb._send_decision(at(4))[0] is False

    # stale data past the fallback hour → send anyway (holiday / pipeline failure)
    assert mb._send_decision(at(8))[0] is True

    # outside the morning window → skip regardless of freshness
    monkeypatch.setattr(mb, "_futures_pub_date", lambda: date(2026, 6, 30))
    assert mb._send_decision(at(21))[0] is False
    assert mb._send_decision(at(1))[0] is False
