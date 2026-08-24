"""The kc_close capture window, pinned against real GitHub cron drift.

Regression, 2026-08 (first): the b3_close_gap feature accumulated exactly ZERO
sessions in its first week live. The cause was not the B3 API — it was the
guard. kc_close fired on cron '33 17' (EDT) with a 13:28–13:52 NY fence around
the 13:30 settle, and GitHub runs crons late as a matter of course: every fire
landed at 13:52–13:56 NY. The first missed by ONE minute.

Regression, 2026-08 (second): with the fence loosened the captures landed, but
23 min LATE on both sessions, because drift only ever runs one way. The gap
measures B3's move AFTER New York shuts, so a late start silently discards
most of the window it exists to measure.

The shape that works is fire-early-and-wait: crons at :55 (16:55 UTC EDT /
17:55 UTC EST) put the fire at 12:55 NY, ~35 min before the settle, so even a
25-min drift lands early and the script sleeps to 13:31. That moves ALL the
drift headroom to the left of the settle, which in turn lets the window close
at 13:50 — and it must, because the two crons are an hour apart and the other
season's fire now lands at 13:55 NY.

Properties pinned here:
  1. every plausible arrival of the RIGHT cron is accepted, in both seasons;
  2. the OTHER season's cron is rejected, drift included;
  3. the window brackets the settle, with the headroom on the early side.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from scraper.capture_b3_at_kc_close import (
    _KC_SETTLE,
    _WINDOW_CLOSE,
    _WINDOW_OPEN,
)

_NY = ZoneInfo("America/New_York")
_UTC = ZoneInfo("UTC")


def _accepted(utc_hh: int, utc_mm: int, month: int = 8) -> bool:
    """Would the guard let a fire at this UTC time through? month picks the
    DST season (8 = EDT, 1 = EST)."""
    ny = datetime(2026, month, 19, utc_hh, utc_mm, tzinfo=_UTC).astimezone(_NY)
    hm = ny.hour * 60 + ny.minute
    return _WINDOW_OPEN <= hm <= _WINDOW_CLOSE


# EDT: the live cron is 16:55 UTC = 12:55 NY. Drift pushes it later; every
# one of these still has to land, because the script waits out the remainder.
@pytest.mark.parametrize("hh,mm", [
    (16, 55),   # the slot itself, no drift
    (17, 5),    # 10 min
    (17, 15),   # 20 min — the routine case
    (17, 20),   # 25 min — the worst drift observed on this repo
    (17, 45),   # 50 min, well past the settle but still inside the window
])
def test_edt_season_accepts_every_plausible_fire(hh, mm):
    assert _accepted(hh, mm), f"{hh}:{mm:02d} UTC would be dropped in EDT"


# EST: the same clock times, one hour later in UTC (17:55 UTC = 12:55 NY).
@pytest.mark.parametrize("hh,mm", [
    (17, 55), (18, 5), (18, 15), (18, 20), (18, 45),
])
def test_est_season_accepts_the_same_drift(hh, mm):
    assert _accepted(hh, mm, month=1), f"{hh}:{mm:02d} UTC would be dropped in EST"


def test_the_other_seasons_cron_is_excluded():
    """Both crons fire every weekday; only one may capture. In EDT the 17:55
    slot lands at 13:55 NY — past the close — and drift only pushes it further
    out. In EST the 16:55 slot lands at 11:55 NY, before the window opens.

    This is what the 14:30 close broke when the crons moved to :55: 13:55 NY
    sat inside it, so BOTH seasons' crons were admitted in EDT.
    """
    assert not _accepted(17, 55)            # EDT: 13:55 NY, wrong season
    assert not _accepted(18, 20)            # EDT: 14:20 NY, wrong season + drift
    assert not _accepted(16, 55, month=1)   # EST: 11:55 NY, wrong season
    assert not _accepted(17, 20, month=1)   # EST: 12:20 NY, wrong season + drift


def test_window_brackets_the_settle_with_headroom_on_the_early_side():
    """Opening well before the settle is what makes the wait possible: the
    script sleeps to 13:31 rather than capturing late. The closing side needs
    only enough room for a fire that drifted past the settle — too much, and
    the other season's cron gets in (see the test above)."""
    assert _WINDOW_OPEN < _KC_SETTLE < _WINDOW_CLOSE
    assert _KC_SETTLE - _WINDOW_OPEN >= 30      # room to absorb drift, then wait
    assert 15 <= _WINDOW_CLOSE - _KC_SETTLE     # a late fire still counts…
    assert _WINDOW_CLOSE < 13 * 60 + 55         # …but never the wrong season's
