"""Guards on the CNL daily accumulator.

B3's DerivativeQuotation endpoint serves "the current snapshot" with no date of
its own, so every row is dated by when we looked. That is fine on a trading day
and wrong on every other one, and the consequence was not confined to the file:
topic_notify_daily._b3_key() dedups the B3 Telegram message on the newest date
across the two B3 files, so a weekend row advanced the key and the message went
out on Saturday and again on Sunday for sessions that never happened
(2026-08-15/16, -22/23, -29/30).
"""
import datetime as dt
import json

import pytest

from scraper.sources import brazil_b3_conilon as m

CURVE = [{"month": "Sep '26", "symb": "CNLU26", "price": 1024.12, "oi": 10,
          "expiry": "2026-09-01"}]
OTHER = [{"month": "Sep '26", "symb": "CNLU26", "price": 1010.05, "oi": 10,
          "expiry": "2026-09-01"}]


@pytest.fixture
def out(tmp_path, monkeypatch):
    p = tmp_path / "brazil_b3_conilon.json"
    monkeypatch.setattr(m, "OUT", p)
    return p


def _seed(path, *rows):
    path.write_text(json.dumps({
        "unit": "BRL/saca_60kg", "source": "t", "history":
        [{"date": d, "front_month": "Sep '26", "front_price": c[0]["price"],
          "contracts": c} for d, c in rows]}), encoding="utf-8")


def _run(monkeypatch, today, curve):
    class _D(dt.date):
        @classmethod
        def today(cls):
            return dt.date.fromisoformat(today)
    monkeypatch.setattr(m, "date", _D)
    monkeypatch.setattr(m, "fetch", lambda: curve)
    m.export_brazil_b3_conilon()


def _dates(path):
    return [e["date"] for e in json.loads(path.read_text())["history"]]


def test_saturday_is_not_written(out, monkeypatch):
    _seed(out, ("2026-08-28", CURVE))
    _run(monkeypatch, "2026-08-29", OTHER)          # Saturday
    assert _dates(out) == ["2026-08-28"]


def test_sunday_is_not_written(out, monkeypatch):
    _seed(out, ("2026-08-28", CURVE))
    _run(monkeypatch, "2026-08-30", OTHER)          # Sunday
    assert _dates(out) == ["2026-08-28"]


def test_weekday_with_a_moved_curve_is_written(out, monkeypatch):
    _seed(out, ("2026-08-27", CURVE))
    _run(monkeypatch, "2026-08-28", OTHER)          # Friday, new settlement
    assert _dates(out) == ["2026-08-27", "2026-08-28"]


def test_weekday_repeating_the_previous_curve_is_skipped(out, monkeypatch):
    """A holiday, or any day B3 has not settled by the time we call. Writing it
    would render as '→+0.00 (+0.0%)' — a session that reads as real and flat."""
    _seed(out, ("2026-08-27", CURVE))
    _run(monkeypatch, "2026-08-28", CURVE)
    assert _dates(out) == ["2026-08-27"]


def test_identity_is_the_whole_curve_not_the_front_price(out, monkeypatch):
    """Two sessions can settle the front at the same number by coincidence; the
    back of the curve is what says whether the API actually moved."""
    moved_back = [dict(CURVE[0]), {"month": "Nov '26", "symb": "CNLX26",
                                  "price": 1031.0, "oi": 4,
                                  "expiry": "2026-11-01"}]
    _seed(out, ("2026-08-27", CURVE))
    _run(monkeypatch, "2026-08-28", moved_back)
    assert _dates(out) == ["2026-08-27", "2026-08-28"]
