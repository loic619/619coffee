"""Tape analytics for the acaphe tradespread fetch.

The session runs on Vietnam wall-clock and arabica's crosses midnight, which is
where the interesting failure lives — see test_arabica_open15_is_not_the_close.
"""
from scraper.fetch_tradespread import (
    _at_or_before,
    _attach_settle,
    _elapsed,
    _quote_label,
    _rc_close_secs,
    _summarise,
)


def _tape(times, prices=None):
    """[[time, price, cum_vol, lots]] with a rising cumulative volume."""
    prices = prices or [100.0 + i for i in range(len(times))]
    return [[t, p, (i + 1) * 10, 10] for i, (t, p) in enumerate(zip(times, prices))]


# ── the session clock ────────────────────────────────────────────────────────

def test_elapsed_unwraps_midnight():
    ticks = _tape(["15:15:01", "23:59:59", "00:00:30", "00:30:01"])
    secs = _elapsed(ticks)
    assert secs == sorted(secs), "the session clock must be monotonic"
    assert secs[0] == 0                                  # measured from the open
    assert secs[2] == 86400 + 30 - (15 * 3600 + 15 * 60 + 1)


# ── the bug this file exists for ─────────────────────────────────────────────

def test_arabica_open15_is_not_the_close():
    """Regression: arabica trades 15:15 → 00:30 VN. Comparing raw wall-clock
    made the 00:30 settle print (1,800 s) look EARLIER than the 15:15 open
    (54,900 s), so `open15` — the price 15 minutes after the open, which the
    opening model reads — silently resolved to the last tick of the session.
    Every arabica row ever stored carried the close in that field.
    """
    ticks = _tape(
        ["15:15:01", "15:20:00", "15:29:34", "15:45:00", "20:00:00", "00:30:01"],
        [363.0, 364.0, 329.55, 331.0, 340.0, 322.65],
    )
    s = _summarise({"label": "Arabica 12/26", "n_trades": 6, "ticks": ticks},
                   "2026-08-21")
    assert s["open15"]["time"] == "15:29:34"
    assert s["open15"]["price"] == 329.55
    assert s["open15"]["price"] != s["last"]["price"]
    assert s["last"]["time"] == "00:30:01"          # the close is still the close


def test_robusta_open15_unchanged_by_the_fix():
    # Robusta (15:00 → 23:35 VN) never wraps, so it was always correct and must
    # stay bit-for-bit identical.
    ticks = _tape(["15:00:00", "15:12:30", "15:14:51", "16:00:00", "23:29:25"],
                  [3700.0, 3710.0, 3752.0, 3740.0, 3598.0])
    s = _summarise({"label": "Robusta 11/26", "n_trades": 5, "ticks": ticks},
                   "2026-08-21")
    assert s["open15"]["time"] == "15:14:51"


# ── the 17:30 London anchor (what workflow 0.2 used to poll for) ─────────────

def test_rc_close_anchor_follows_british_summer_time():
    base = 15 * 3600                                  # session opens 15:00 VN
    # BST: 17:30 London = 23:30 VN, same calendar day as the open.
    assert _rc_close_secs("2026-08-21", base) == 23 * 3600 + 30 * 60
    # GMT: 17:30 London = 00:30 VN — the next day, so it must unwrap past
    # midnight rather than land before the open.
    assert _rc_close_secs("2026-01-15", base) == 86400 + 30 * 60


def test_at_rc_close_reads_the_price_at_the_london_bell():
    ticks = _tape(
        ["15:15:01", "23:29:42", "23:31:00", "00:30:01"],
        [363.0, 323.7, 324.9, 322.65],
    )
    s = _summarise({"label": "Arabica 12/26", "n_trades": 4, "ticks": ticks},
                   "2026-08-21")
    # 23:29:42 VN is the last print at or before 23:30 VN (= 17:30 London BST).
    assert s["at_rc_close"] == {"time": "23:29:42", "price": 323.7, "stale_s": 18}


def test_at_or_before_returns_none_when_the_anchor_precedes_the_open():
    # _elapsed measures from the first print, so an anchor earlier than the open
    # is negative — there is no price to report, and None must come back rather
    # than the opening tick standing in for it.
    ticks = _tape(["23:59:00"])
    assert _at_or_before(ticks, _elapsed(ticks), -60) is None
    assert _at_or_before(ticks, _elapsed(ticks), 0) == ticks[0]


# ── settlement from the board ────────────────────────────────────────────────

def test_quote_label_joins_the_board_to_the_tape():
    # acaphe writes the board as "AU 09/26" and the tape as "Arabica 09/26".
    assert _quote_label("AU 09/26", "arabica") == "Arabica 09/26"
    assert _quote_label("RK 05/26", "robusta") == "Robusta 05/26"
    assert _quote_label("", "robusta") == ""


def test_close_vs_settle_is_the_gap_between_last_trade_and_settlement():
    s = {"last": {"time": "00:30:01", "price": 322.65}}
    _attach_settle(s, {"last": 323.70, "prev": 318.40, "open": 320.0,
                       "oi": 81848, "vol": 20222})
    assert s["settle"] == 323.70
    assert s["prev_settle"] == 318.40
    assert s["close_vs_settle"] == -1.05
    assert s["oi"] == 81848


def test_a_missing_board_row_leaves_the_tape_stats_intact():
    # iquote can fail independently of the tape; nothing may be invented.
    s = {"last": {"time": "00:30:01", "price": 322.65}}
    _attach_settle(s, None)
    assert s["settle"] is None and s["close_vs_settle"] is None
    assert s["last"]["price"] == 322.65


def test_at_rc_close_reports_how_stale_the_print_was():
    """Real case, Robusta 09/26 on 2026-08-25: four trades all session, and the
    last one before the bell was SIX HOURS old. Without stale_s that reads as an
    89-point eight-minute collapse; with it, as six hours of nothing."""
    ticks = _tape(
        ["15:00:13", "16:34:59", "17:17:01", "23:38:45"],
        [3768.0, 3757.0, 3742.0, 3653.0],
    )
    s = _summarise({"label": "Robusta 09/26", "n_trades": 4, "ticks": ticks},
                   "2026-08-25")
    arc = s["at_rc_close"]
    assert arc["price"] == 3742.0                 # last print before the bell
    assert arc["stale_s"] == 22379                # 6.2 hours old at 23:30
    assert arc["stale_s"] > 6 * 3600
    # The close itself is AFTER the bell and is a different thing entirely.
    assert s["last"]["time"] == "23:38:45"


def test_a_liquid_contract_reports_a_fresh_anchor():
    ticks = _tape(["15:00:00", "23:29:55", "23:31:00"], [3700.0, 3690.0, 3688.0])
    s = _summarise({"label": "Robusta 11/26", "n_trades": 3, "ticks": ticks},
                   "2026-08-25")
    assert s["at_rc_close"]["stale_s"] == 5
