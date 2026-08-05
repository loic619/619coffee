# backend/tests/test_weather_analog_rollover.py
"""Crop-cycle rollover grace for the weather-analog builder.

Every Aug 1 the southern-hemisphere origins (brazil_arabica,
indonesia_robusta) flip to a new crop year whose feature vector is empty
until the first phenology stage accumulates. That used to hard-fail the
whole 1.10 workflow daily (with retries + Telegram alerts) until features
appeared. The builder now skips gracefully inside ROLLOVER_GRACE_DAYS and
only errors past it.
"""
import datetime as dt
import importlib.util
import sys
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "compute_weather_analogs",
    Path(__file__).resolve().parents[1] / "scripts" / "compute_weather_analogs.py",
)
cwa = importlib.util.module_from_spec(_SPEC)
sys.modules["compute_weather_analogs"] = cwa
_SPEC.loader.exec_module(cwa)


def test_days_into_cycle_just_after_southern_flip():
    # Aug 5, flip month Aug → 4 days into the new cycle.
    assert cwa._days_into_cycle(dt.date(2026, 8, 5), 8) == 4


def test_days_into_cycle_wraps_to_previous_year():
    # January, flip month Aug → the flip was Aug 1 LAST year.
    assert cwa._days_into_cycle(dt.date(2027, 1, 10), 8) == (dt.date(2027, 1, 10) - dt.date(2026, 8, 1)).days


def test_days_into_cycle_northern_flip():
    # Feb flip (Vietnam): Feb 1 is day 0; Jan 31 is a full cycle minus a day.
    assert cwa._days_into_cycle(dt.date(2026, 2, 1), 2) == 0
    assert cwa._days_into_cycle(dt.date(2026, 1, 31), 2) == (dt.date(2026, 1, 31) - dt.date(2025, 2, 1)).days


def test_grace_covers_first_stage_but_not_forever():
    # The first southern stage spans Aug–Sep; the grace must cover it fully
    # (so no false alarms while features accumulate) yet expire well before
    # the next flip (so a genuinely dead pipeline still alarms).
    aug1  = dt.date(2026, 8, 1)
    sep30 = dt.date(2026, 9, 30)
    dec1  = dt.date(2026, 12, 1)
    assert cwa._days_into_cycle(sep30, 8) <= cwa.ROLLOVER_GRACE_DAYS
    assert cwa._days_into_cycle(dec1, 8) > cwa.ROLLOVER_GRACE_DAYS
    assert cwa._days_into_cycle(aug1, 8) == 0
