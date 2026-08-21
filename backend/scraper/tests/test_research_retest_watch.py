"""Counter tests for the research retest watchdog.

This module's whole job is to say "the thing you parked is ready now". A
counter that is merely CLOSE is therefore not a small bug — it either cries
wolf or stays silent past the moment that mattered. It has done both:

  * the fade-candidate counter matched bands with endswith("2"), so
    "1 <= |z| < 2" counted as "|z| >= 2" and it would have reported 60/40
    mature when the true figure was 22/40;
  * _cci_trainable_rows counted snapshot days with >=6 pairs that were also
    RC sessions, and reported 314/252 MATURE on 2026-08-20 while the model's
    own active_features() correctly refused the feature at 207 trainable
    rows — it ignored that training is LISTWISE.

So the trainable-row counters get pinned here against synthetic fixtures
whose right answer is countable by hand.
"""
import json

import pytest

from scraper import research_retest_watch as w


def _write(tmp_path, name, payload):
    (tmp_path / name).write_text(json.dumps(payload), encoding="utf-8")


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(w, "DATA", tmp_path)
    return tmp_path


def _intraday_row(date, sym="RMX26", **kw):
    row = {"date": date, "rc_symbol": sym, "rc_open_first": 3700.0,
           "rc_last_1730": 3690.0, "kc_last_1730": 320.0, "kc_last_1830": 321.0}
    row.update(kw)
    return row


# ── the core trainable set ───────────────────────────────────────────────────

def test_core_trainable_excludes_rolls_and_holes(data_dir):
    """A session is trainable only if it carries the label AND the core
    feature. Roll days are unlabelled; kc_after_rc_diff has its own gaps."""
    _write(data_dir, "intraday_kc_rc_15min.json", [
        _intraday_row("2026-01-05"),                          # first row: no prior
        _intraday_row("2026-01-06"),                          # ok
        _intraday_row("2026-01-07", sym="RMH26"),             # ROLL → unlabelled
        _intraday_row("2026-01-08", sym="RMH26"),             # ok
        _intraday_row("2026-01-09", sym="RMH26", rc_open_first=None),   # no target
        _intraday_row("2026-01-12", sym="RMH26"),             # prior has no kc_1830…
    ])
    got = w._core_trainable_sessions()
    assert got == {"2026-01-06", "2026-01-08", "2026-01-12"}
    assert "2026-01-05" not in got, "first row has no prior session"
    assert "2026-01-07" not in got, "roll day must stay unlabelled"
    assert "2026-01-09" not in got, "no rc_open_first → no target"


def test_core_trainable_needs_the_PRIOR_session_kc_pair(data_dir):
    """kc_after_rc_diff is built from the prior session's 17:30→18:30 move, so
    it is the PRIOR row's kc fields that must be present, not today's."""
    _write(data_dir, "intraday_kc_rc_15min.json", [
        _intraday_row("2026-01-05", kc_last_1830=None),   # prior lacks 18:30
        _intraday_row("2026-01-06"),
        _intraday_row("2026-01-07"),
    ])
    assert w._core_trainable_sessions() == {"2026-01-07"}


# ── cci_overnight ────────────────────────────────────────────────────────────

def _pairs(n):
    return {f"P{i}=X": {"prev_1730": 5.0, "at_0300": 5.01} for i in range(n)}


def test_cci_counts_trainable_rows_not_usable_days(data_dir):
    """The 2026-08-20 regression: 6-pair coverage on a real session is NOT
    enough — the row must survive dropna(["y"] + active) as well."""
    _write(data_dir, "intraday_kc_rc_15min.json", [
        _intraday_row("2026-01-05"),
        _intraday_row("2026-01-06"),                       # trainable
        _intraday_row("2026-01-07", sym="RMH26"),          # roll → NOT trainable
        _intraday_row("2026-01-08", sym="RMH26"),          # trainable
    ])
    _write(data_dir, "fx_intraday_snapshots.json", {"days": [
        {"date": "2026-01-06", "pairs": _pairs(10)},       # counts
        {"date": "2026-01-07", "pairs": _pairs(10)},       # roll day — must NOT
        {"date": "2026-01-08", "pairs": _pairs(6)},        # counts (exactly 6)
        {"date": "2026-01-09", "pairs": _pairs(10)},       # not a session at all
    ]})
    assert w._cci_trainable_rows() == 2


def test_cci_requires_a_majority_of_the_basket(data_dir):
    """Five pairs is not a majority — the model's own threshold is 6."""
    _write(data_dir, "intraday_kc_rc_15min.json",
           [_intraday_row("2026-01-05"), _intraday_row("2026-01-06")])
    _write(data_dir, "fx_intraday_snapshots.json", {"days": [
        {"date": "2026-01-06", "pairs": _pairs(5)},
    ]})
    assert w._cci_trainable_rows() == 0
    _write(data_dir, "fx_intraday_snapshots.json", {"days": [
        {"date": "2026-01-06", "pairs": _pairs(6)},
    ]})
    assert w._cci_trainable_rows() == 1


def test_cci_ignores_a_pair_missing_an_anchor(data_dir):
    """A pair with only one of the two anchors contributes no return."""
    _write(data_dir, "intraday_kc_rc_15min.json",
           [_intraday_row("2026-01-05"), _intraday_row("2026-01-06")])
    pairs = _pairs(6)
    pairs["P0=X"] = {"prev_1730": 5.0, "at_0300": None}
    _write(data_dir, "fx_intraday_snapshots.json", {"days": [
        {"date": "2026-01-06", "pairs": pairs},
    ]})
    assert w._cci_trainable_rows() == 0


# ── b3_close_gap ─────────────────────────────────────────────────────────────

def test_b3_trainable_counts_the_SUCCESSOR_session(data_dir):
    """b3_close_gap is shifted: session t−1's gap is pre-open information for
    session t. So a capture on D earns its row only if D's NEXT session is
    trainable — counting D itself would credit gaps that predict a roll day."""
    _write(data_dir, "intraday_kc_rc_15min.json", [
        _intraday_row("2026-01-05"),
        _intraday_row("2026-01-06"),                       # trainable
        _intraday_row("2026-01-07", sym="RMH26"),          # roll → NOT trainable
        _intraday_row("2026-01-08", sym="RMH26"),          # trainable
    ])
    _write(data_dir, "b3_kc_close_snapshots.json", {"days": [
        {"date": "2026-01-05", "gap": 0.004},   # → predicts 01-06, trainable ✓
        {"date": "2026-01-06", "gap": 0.002},   # → predicts 01-07, a ROLL ✗
        {"date": "2026-01-07", "gap": -0.001},  # → predicts 01-08, trainable ✓
        {"date": "2026-01-08", "gap": 0.003},   # → no successor yet ✗
    ]})
    assert w._b3_trainable_rows() == 2


def test_b3_trainable_ignores_rows_without_a_gap(data_dir):
    """The two-phase capture writes b3_final first; a row is only useful once
    the at-KC-close leg lands and the gap becomes computable."""
    _write(data_dir, "intraday_kc_rc_15min.json",
           [_intraday_row("2026-01-05"), _intraday_row("2026-01-06")])
    _write(data_dir, "b3_kc_close_snapshots.json", {"days": [
        {"date": "2026-01-05", "b3_final": 1234.0},          # no gap yet
        {"date": "2026-01-05", "gap": None},
    ]})
    assert w._b3_trainable_rows() == 0


def test_b3_trainable_is_zero_not_none_when_nothing_captured(data_dir):
    """0 is a countable state — 'uncountable' means the file is unreadable,
    and the two must not be confused in the summary line."""
    _write(data_dir, "intraday_kc_rc_15min.json", [_intraday_row("2026-01-05")])
    _write(data_dir, "b3_kc_close_snapshots.json", {"days": []})
    assert w._b3_trainable_rows() == 0


# ── the watch table itself ───────────────────────────────────────────────────

def test_b3_activation_bar_is_trainable_rows_not_captures():
    """Regression, 2026-08-20: the b3 watch was labelled 'LIVE MODEL
    activation gate' at 40 captures, which was the PRE-#719 behaviour. Since
    the trainability gate an optional feature must also leave _MIN_TRAIN
    rows, so 40 captures is the testability milestone and ~252 trainable rows
    is the activation bar. Both are now watched, at their own thresholds."""
    by_key = {row[0]: row for row in w.WATCHES}
    assert by_key["b3_close_gap"][3] == 40
    assert "activation" not in by_key["b3_close_gap"][1].lower()
    assert by_key["b3_trainable"][3] == 252
    # and the same two-tier shape for the feature that taught us the lesson
    assert by_key["cci_trainable"][3] == 252


def test_every_watch_is_well_formed():
    keys = [row[0] for row in w.WATCHES]
    assert len(keys) == len(set(keys)), "watch keys must be unique"
    for key, label, counter, threshold, unit, parked, action in w.WATCHES:
        assert callable(counter), key
        assert isinstance(threshold, int) and threshold > 0, key
        assert label and unit and parked and action, key
