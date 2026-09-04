"""Guards on the CNL daily accumulator.

B3's DerivativeQuotation endpoint serves "the current snapshot" with no date of
its own, and the field read is prvsDayAdjstmntPric — the PREVIOUS session's
settlement. Two things follow, both of which this file pins:

  * A fetch on D reports the session of the last weekday before D, and the row
    is dated that way. Dating rows by the fetch date put every conilon print
    one session late — visible as "CNL lags the other boards by a day".
  * Weekend fetches see Friday's settlement again. They used to become
    Saturday and Sunday rows, which advanced the file's newest date daily and
    made topic_notify_daily._b3_key() fire the B3 Telegram message on days no
    session happened (2026-08-15/16, -22/23, -29/30). Weekends are skipped, and
    a Monday fetch that repeats Friday's snapshot is skipped by the
    identical-curve guard.
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


def test_previous_business_day():
    assert m.previous_business_day(dt.date(2026, 8, 28)) == dt.date(2026, 8, 27)   # Fri → Thu
    assert m.previous_business_day(dt.date(2026, 8, 31)) == dt.date(2026, 8, 28)   # Mon → Fri
    assert m.previous_business_day(dt.date(2026, 8, 29)) == dt.date(2026, 8, 28)   # Sat → Fri


def test_friday_fetch_records_thursdays_session(out, monkeypatch):
    _seed(out, ("2026-08-26", CURVE))                  # Wednesday's session on file
    _run(monkeypatch, "2026-08-28", OTHER)             # fetched Friday → Thursday's settlement
    assert _dates(out) == ["2026-08-26", "2026-08-27"]


def test_saturday_and_sunday_are_not_written(out, monkeypatch):
    _seed(out, ("2026-08-27", CURVE))
    _run(monkeypatch, "2026-08-29", OTHER)             # Saturday
    _run(monkeypatch, "2026-08-30", OTHER)             # Sunday
    assert _dates(out) == ["2026-08-27"]


def test_monday_fetch_records_friday_once_only(out, monkeypatch):
    """Monday's fetch sees Friday's settlement. If Friday is already on file
    from a different snapshot it is the same session and is not re-dated to
    Monday; if the curve is identical to the newest row, nothing is written."""
    _seed(out, ("2026-08-27", CURVE))
    _run(monkeypatch, "2026-08-31", OTHER)             # Monday → Friday 28th's session
    assert _dates(out) == ["2026-08-27", "2026-08-28"]
    _run(monkeypatch, "2026-08-31", OTHER)             # same fetch again → identical → skipped
    assert _dates(out) == ["2026-08-27", "2026-08-28"]


def test_weekday_repeating_the_previous_curve_is_skipped(out, monkeypatch):
    """A B3 holiday, or any day the API has not moved: the snapshot equals the
    newest row's, so it is not dated afresh — that would render as a session
    with a "→+0.00" move that never happened."""
    _seed(out, ("2026-08-27", CURVE))
    _run(monkeypatch, "2026-08-31", CURVE)             # Monday, but the curve is Thursday's still
    assert _dates(out) == ["2026-08-27"]


def test_identity_is_the_whole_curve_not_the_front_price(out, monkeypatch):
    moved_back = [dict(CURVE[0]), {"month": "Nov '26", "symb": "CNLX26",
                                  "price": 1031.0, "oi": 4, "expiry": "2026-11-01"}]
    _seed(out, ("2026-08-27", CURVE))
    _run(monkeypatch, "2026-08-31", moved_back)
    assert _dates(out) == ["2026-08-27", "2026-08-28"]
