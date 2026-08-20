"""The kc_close capture window, pinned against real GitHub cron drift.

Regression, 2026-08: the b3_close_gap feature accumulated exactly ZERO
sessions in its first week live, and the file showed only the `final` leg. The
cause was not the B3 API — it was the guard. kc_close fired on cron '33 17'
(EDT) with a 13:28–13:52 NY fence around the 13:30 settle, and GitHub runs
crons late as a matter of course: every scheduled fire landed at 17:52–17:56
UTC, i.e. 13:52–13:56 NY. The first missed by ONE minute.

The guard's actual job is to admit exactly one of the two DST crons per
season, so it can afford to be loose. These cases are the observed fire times
from runs 1–6 of workflow 1.5 plus the boundaries either side.
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


@pytest.mark.parametrize("hh,mm", [
    (17, 25),   # the cron slot itself, no drift
    (17, 33),   # the OLD slot, no drift — used to be the only accepted case
    (17, 52),   # observed: run 4
    (17, 56),   # observed: run 1 — rejected by the old fence
    (18, 15),   # 25 min of drift on top of a late-ish start
])
def test_edt_season_accepts_every_observed_fire(hh, mm):
    assert _accepted(hh, mm), f"{hh}:{mm:02d} UTC would be dropped in EDT"


@pytest.mark.parametrize("hh,mm", [
    (18, 25), (18, 33), (18, 52), (18, 56), (19, 15),
])
def test_est_season_accepts_the_same_drift(hh, mm):
    assert _accepted(hh, mm, month=1), f"{hh}:{mm:02d} UTC would be dropped in EST"


def test_the_other_seasons_cron_is_still_excluded():
    """Both crons fire every weekday; only one may capture. In EDT the 18:25
    slot lands at 14:25 NY and its drift pushes it later still — outside the
    window. In EST the 17:25 slot lands at 12:25 NY, before it opens."""
    assert not _accepted(18, 52)            # EDT: 14:52 NY
    assert not _accepted(19, 8)             # EDT: 15:08 NY (observed run 2/5)
    assert not _accepted(17, 25, month=1)   # EST: 12:25 NY
    assert not _accepted(17, 50, month=1)   # EST: 12:50 NY, 25 min of drift


def test_window_brackets_the_settle_on_both_sides():
    """Opening before the settle is what makes the early-fire wait possible;
    the script sleeps to 13:31 rather than discarding the run."""
    assert _WINDOW_OPEN < _KC_SETTLE < _WINDOW_CLOSE
    assert _KC_SETTLE - _WINDOW_OPEN >= 5      # room to wait, not to miss
    assert _WINDOW_CLOSE - _KC_SETTLE >= 30    # room for GitHub's real drift
