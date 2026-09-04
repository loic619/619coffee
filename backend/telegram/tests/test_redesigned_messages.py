"""The three Phase-1 messages, rendered against the real published data.

These assert on what a redesign is most likely to lose: a field that quietly
stopped being printed, a <pre> block that outgrew the phone, or an unescaped
character that makes Telegram reject the whole sendMessage with a 400.
"""
from __future__ import annotations

import re

import pytest

from telegram.formatting.tables import WIDTH_BUDGET, width_of
from telegram.handlers import brief, cot, quote

_PRE = re.compile(r"<pre>.*?</pre>", re.S)


@pytest.fixture(scope="module")
def messages() -> dict[str, str]:
    return {"brief": brief.handle("", {}),
            "cot":   cot.handle("", {}),
            "quote": quote.handle("", {})}


@pytest.mark.parametrize("name", ["brief", "cot", "quote"])
def test_message_renders(messages, name):
    out = messages[name]
    assert out and "unavailable" not in out.lower()


@pytest.mark.parametrize("name", ["brief", "cot", "quote"])
def test_pre_blocks_fit_the_phone(messages, name):
    """A row past the budget scrolls sideways instead of wrapping, which on a
    phone hides the right-hand column entirely."""
    for block in _PRE.findall(messages[name]):
        assert width_of(block) <= WIDTH_BUDGET, f"{name}: {width_of(block)} chars"


@pytest.mark.parametrize("name", ["brief", "cot", "quote"])
def test_no_raw_angle_brackets_inside_pre(messages, name):
    """Telegram parses entities inside <pre>; an unescaped one 400s the send
    and the message is dropped silently."""
    for block in _PRE.findall(messages[name]):
        body = block[len("<pre>"):-len("</pre>")]
        assert "<" not in body and ">" not in body


@pytest.mark.parametrize("name", ["brief", "cot", "quote"])
def test_no_bold_inside_pre(messages, name):
    """Telegram does not render nested tags in <pre> — a <b> there would print
    literally. Alignment and emphasis are mutually exclusive per block."""
    for block in _PRE.findall(messages[name]):
        assert "&lt;b&gt;" not in block


# ── content preserved ────────────────────────────────────────────────────────

def test_brief_keeps_every_section_it_had(messages):
    out = messages["brief"]
    for label in ("MARKET", "PHYSICAL", "WEATHER", "EXPORTS", "STOCKS"):
        assert label in out, f"brief lost its {label} section"


def test_brief_keeps_the_interpretation_layer(messages):
    """The open call and the currency index are the 'what matters' layer —
    easy to drop when regrouping, and the reason the brief is read."""
    out = messages["brief"]
    assert "open call" in out and "CCI" in out


def test_brief_market_table_carries_both_boards_and_their_spreads(messages):
    block = _PRE.search(messages["brief"]).group(0)
    assert "RC" in block and "KC" in block
    assert "spread" in block


def test_cot_shows_net_signed_for_both_cohorts(messages):
    """Producers run net short and funds net long; the sign is the whole
    story, so both must print with an explicit + or -."""
    out = messages["cot"]
    assert "MANAGED MONEY" in out and "PRODUCERS" in out
    nets = re.findall(r"Net\s+([+-][\d,]+)", out)
    assert len(nets) >= 4, "expected a net line per cohort per board"
    assert any(n.startswith("-") for n in nets), "no short cohort — check the sign"


def test_cot_keeps_the_gross_legs(messages):
    out = messages["cot"]
    assert "Long" in out and "Short" in out


def test_quote_keeps_the_month_to_contract_mapping(messages):
    """The redesign's one hard constraint: 'Nov-26 +178' is not a quotation
    until you know which contract it prices off."""
    block = _PRE.findall(messages["quote"])[-1]
    rows = [r for r in block.splitlines() if re.match(r"^\w{3}-\d{2}", r)]
    assert rows, "no shipment rows"
    for row in rows:
        assert re.search(r"[FGHJKMNQUVXZ]\s*[+-]\d+", row), f"no contract letter: {row}"


def test_quote_adds_the_all_in_price(messages):
    """The column that was missing: the reader was adding basis to futures in
    their head on every row."""
    block = _PRE.findall(messages["quote"])[-1]
    row = next(r for r in block.splitlines() if r.startswith("Sep-"))
    assert len(row.split()) >= 4, f"no price column: {row}"
