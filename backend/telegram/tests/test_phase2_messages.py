"""Phase-2 messages: /prices, /brazil, /ecf, /kaffeesteuer.

Rendered against the real published files, so a schema move breaks CI rather
than the bot — the failure mode that left /brazil and /ecf answering an error
string for months.
"""
from __future__ import annotations

import re

import pytest

from telegram.formatting.tables import WIDTH_BUDGET, width_of
from telegram.handlers import brazil, ecf, kaffeesteuer, prices

_PRE = re.compile(r"<pre>.*?</pre>", re.S)
_NAMES = ["prices", "brazil", "ecf", "kaffeesteuer"]


@pytest.fixture(scope="module")
def messages() -> dict[str, str]:
    return {"prices": prices.handle("", {}),
            "brazil": brazil.handle("", {}),
            "ecf": ecf.handle("", {}),
            "kaffeesteuer": kaffeesteuer.handle("", {})}


@pytest.mark.parametrize("name", _NAMES)
def test_renders_with_data(messages, name):
    out = messages[name]
    assert out
    for bad in ("unavailable", "data empty", "No Brazil registration data"):
        assert bad not in out


@pytest.mark.parametrize("name", _NAMES)
def test_pre_blocks_fit_the_phone(messages, name):
    for block in _PRE.findall(messages[name]):
        assert width_of(block) <= WIDTH_BUDGET, f"{name}: {width_of(block)} chars"


@pytest.mark.parametrize("name", _NAMES)
def test_pre_blocks_are_escaped_and_unstyled(messages, name):
    """Telegram parses entities inside <pre> (an unescaped one 400s the send)
    and ignores nested tags there."""
    for block in _PRE.findall(messages[name]):
        body = block[len("<pre>"):-len("</pre>")]
        assert "<" not in body and ">" not in body


# ── /prices ──────────────────────────────────────────────────────────────────

def test_prices_shows_the_daily_move(messages):
    """The delta is the point of the rebuild: the old message printed a bare
    level with no indication of direction."""
    block = _PRE.findall(messages["prices"])[0]
    assert re.search(r"[▲▼→]", block), "no direction mark on the futures block"


def test_prices_keeps_the_units(messages):
    block = _PRE.findall(messages["prices"])[0]
    assert "$/MT" in block and "¢/lb" in block


def test_prices_shows_every_published_ticker_not_a_hardcoded_subset(messages):
    """The old handler named three physical labels and three FX pairs, so
    GT SHB, USD/HNL and USD/UGX were published but never shown."""
    from telegram.data import load
    tickers = (load("latest_prices.json") or {}).get("tickers") or []
    out = messages["prices"]
    for t in tickers:
        if t.get("category") in ("physical", "fx"):
            assert t["label"] in out, f"{t['label']} published but not shown"


# ── /brazil ──────────────────────────────────────────────────────────────────

def test_brazil_names_the_comparison_period_in_the_header(messages):
    """"83,991 bags" says nothing without knowing what it is read against."""
    head = messages["brazil"].splitlines()[1]
    assert " vs " in head


def test_brazil_total_equals_the_sum_of_its_crops(messages):
    out = messages["brazil"]
    total = int(re.search(r"TOTAL ([\d,]+) bags", out).group(1).replace(",", ""))
    block = _PRE.findall(out)[0]
    crops = [int(m.replace(",", "")) for m in re.findall(r"^\w+\s+([\d,]+)", block, re.M)]
    assert crops and sum(crops) == total


# ── /ecf ─────────────────────────────────────────────────────────────────────

def test_ecf_shows_a_trend_and_the_window_move(messages):
    out = messages["ecf"]
    rows = _PRE.findall(out)[0].splitlines()
    assert len(rows) >= 2, "trend needs more than one month"
    assert "→" in out.splitlines()[-1], "no window-move line"


# ── /kaffeesteuer ────────────────────────────────────────────────────────────

def test_kaffeesteuer_renders_the_mat_row(messages):
    """Regression: the MAT row was appended to `rows` AFTER table() had
    already rendered them, so it was computed, used for the signal, and never
    shown. table() takes a snapshot."""
    out = messages["kaffeesteuer"]
    assert "MAT 12m" in _PRE.findall(out)[0], "MAT computed but not rendered"
    assert "Signal:" in out


def test_kaffeesteuer_mat_is_calendar_addressed_not_index_addressed():
    """The published series has a hole at 2018-02. Counting twelve list
    entries backwards would span thirteen calendar months and compare unlike
    windows; a missing month must yield None instead."""
    assert kaffeesteuer._months_back("2026-01", 1) == "2025-12"
    assert kaffeesteuer._months_back("2026-07", 12) == "2025-07"
    assert kaffeesteuer._mat({"2026-07": 1}, "2026-07") is None

    full = {kaffeesteuer._months_back("2026-07", i): 10 for i in range(12)}
    assert kaffeesteuer._mat(full, "2026-07") == 120
    del full["2026-01"]
    assert kaffeesteuer._mat(full, "2026-07") is None


def test_kaffeesteuer_signal_matches_the_mat_direction(messages):
    """The signal must describe the annual total it is drawn from, not the
    latest month — the two currently disagree in the live data."""
    out = messages["kaffeesteuer"]
    mat_row = next(r for r in _PRE.findall(out)[0].splitlines() if "MAT 12m" in r)
    signal = out.splitlines()[-1]
    if "▲" in mat_row:
        assert "firmer" in signal or "flat" in signal
    elif "▼" in mat_row:
        assert "softer" in signal or "flat" in signal
