"""The shared Telegram formatting primitives.

These are the pieces every handler will be rebuilt on, so the invariants that
matter are pinned here rather than re-checked per message: a missing value
never renders as zero or as a move, every delta names its period, and <pre>
content is escaped and aligned.
"""
from __future__ import annotations

from telegram.formatting import indicators as ind
from telegram.formatting import numbers as nb
from telegram.formatting import sections as sec
from telegram.formatting import tables as tb

# ── indicators ───────────────────────────────────────────────────────────────

def test_arrow_directions():
    assert ind.arrow(2, 1) == "▲"
    assert ind.arrow(1, 2) == "▼"
    assert ind.arrow(1, 1) == "→"


def test_arrow_is_flat_when_either_side_is_unknown():
    """A missing comparison must not render as a move that did not happen."""
    assert ind.arrow(None, 1) == "→"
    assert ind.arrow(1, None) == "→"


def test_severity_maps_the_engine_tiers():
    assert ind.severity("alert") == ind.ALERT
    assert ind.severity("INFO") == ind.INFO
    assert ind.severity("nonsense") == ind.INFO      # unknown degrades to context


# ── numbers ──────────────────────────────────────────────────────────────────

def test_missing_numbers_render_as_a_dash_not_zero():
    assert nb.num(None) == "—"
    assert nb.signed(None) == "—"
    assert nb.pct(None) == "—"
    assert nb.num(0) == "0"                           # a real zero still prints


def test_number_formats():
    assert nb.num(3557) == "3,557"
    assert nb.num(310.30, 2) == "310.30"
    assert nb.signed(42) == "+42"
    assert nb.signed(-2.15, 2) == "-2.15"
    assert nb.pct(3.21) == "+3.2%"


def test_delta_pairs_an_arrow_with_a_signed_number():
    assert nb.delta(3557, 3515) == "▲+42"
    assert nb.delta(310.30, 312.45, dp=2) == "▼-2.15"


def test_delta_is_empty_when_there_is_nothing_to_compare():
    """Empty (not '—') so callers can append it unconditionally."""
    assert nb.delta(3557, None) == ""
    assert nb.delta(None, 3515) == ""


def test_percentage_delta_uses_the_magnitude_of_the_base():
    # Producers run net short, so the base is negative; a move to a smaller
    # short is an increase, and the sign must not flip from dividing by <0.
    assert nb.delta(-35429, -38755, as_pct=True).startswith("▲+8.6%")
    assert nb.delta(100, 0, as_pct=True) == ""        # no division by zero


def test_compare_always_names_the_period():
    assert nb.compare(3557, 3515, "d/d") == "▲+42 d/d"
    assert nb.compare(442019, 428882, "MoM", as_pct=True) == "▲+3.1% MoM"
    assert nb.compare(3557, None, "d/d") == ""


# ── sections ─────────────────────────────────────────────────────────────────

def test_header_is_ruled_above_and_below():
    h = sec.header("📈", "market")
    assert h.splitlines() == [sec.RULE, "📈 <b>MARKET</b>", sec.RULE]


def test_footer_normalises_slashes():
    assert sec.footer(["prices", "/cot"]) == "/prices · /cot"


# ── tables ───────────────────────────────────────────────────────────────────

def _body(block: str) -> list[str]:
    return block.replace("<pre>", "").replace("</pre>", "").splitlines()


def test_table_aligns_columns():
    block = tb.table([["RC", "3,557", "▲+2"],
                      ["KC", "310.30", "▲+0.65"]], align="lrr")
    rows = _body(block)
    # Right-aligned numeric columns put the last character of each in the
    # same position — the whole reason these live in <pre>.
    assert rows[0].index("3,557") + len("3,557") == rows[1].index("310.30") + len("310.30")


def test_table_escapes_html_inside_pre():
    """Telegram parses entities inside <pre>; an unescaped & or < returns 400
    and the whole message is silently dropped."""
    block = tb.table([["A&B", "<x>"]])
    assert "&amp;" in block and "&lt;x&gt;" in block
    assert "<x>" not in block


def test_table_renders_none_as_a_dash():
    assert "—" in tb.table([["RC", None]])


def test_table_pads_ragged_rows():
    rows = _body(tb.table([["a", "b", "c"], ["d"]]))
    assert len(rows) == 2 and rows[1].strip() == "d"


def test_empty_table_is_empty_string():
    assert tb.table([]) == ""


def test_kv_is_a_two_column_table():
    assert _body(tb.kv([("Total", "83,991")]))[0].startswith("Total")


def test_a_market_block_fits_the_phone_width_budget():
    """A row wider than ~34 chars scrolls sideways on a phone instead of
    wrapping, which is worse than losing a column."""
    block = tb.table([["RC", "3,557", "▲+2", "RMX26"],
                      ["KC", "310.30", "▲+0.65", "KCZ26"]], align="lrrl")
    assert tb.width_of(block) <= tb.WIDTH_BUDGET


def test_a_group_label_spans_and_does_not_widen_column_zero():
    """"MANAGED MONEY" is a heading inside the block, not a column-0 value —
    if it set that column's width every number below would be indented
    behind it."""
    block = tb.table([["Price", "310.30", "▼-2.10"],
                      ["MANAGED MONEY"],
                      ["Net", "+18,200", "▲+4,600"]], align="lrr")
    rows = _body(block)
    assert rows[1] == "MANAGED MONEY"
    # Column 0 is sized by "Price"/"Net", so the value column starts early.
    assert rows[0].index("310.30") < len("MANAGED MONEY")


def test_blank_row_renders_as_a_blank_line():
    rows = _body(tb.table([["a", "1"], [""], ["b", "2"]], align="lr"))
    assert rows[1] == ""
