"""Telegram handlers: the data-source contracts that broke silently.

Both commands pinned here spent months answering an error string to every
caller. Nothing failed — a handler that reads a key which no longer exists
gets `{}` back and reports "no data", which is indistinguishable from a
genuinely empty feed. These tests read the REAL published files, so the next
schema move breaks CI instead of the bot.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from telegram.handlers import brazil, ecf, kaffeesteuer, prices

DATA = Path(__file__).resolve().parents[3] / "frontend" / "public" / "data"


def _live(name: str) -> dict:
    p = DATA / name
    if not p.exists():
        pytest.skip(f"{name} not published in this checkout")
    return json.loads(p.read_text(encoding="utf-8"))


# ── /brazil ──────────────────────────────────────────────────────────────────

def test_brazil_reads_the_v2_cecafe_schema():
    """v1 put the crops at the top level, v2 nests them under
    sources.embarques. Reading v1 against a v2 file yields {} per crop and the
    handler answers 'No Brazil registration data.' — which is what it did."""
    d = _live("cecafe_daily.json")
    assert "arabica" not in d, "file is v1 again — the unwrap in brazil.py needs revisiting"
    assert (d.get("sources") or {}).get("embarques"), "v2 sources.embarques missing"

    out = brazil.handle("", {})
    assert "No Brazil registration data" not in out
    assert "bags" in out and "TOTAL" in out


def test_brazil_states_the_day_and_the_comparison_day():
    """The header carries both dates: the message is a comparison, so "3 Sep"
    alone would leave the reader guessing what it is measured against."""
    head = brazil.handle("", {}).splitlines()[1]
    assert re.match(r"^\d{1,2} \w{3} · vs \d{1,2} \w{3}$", head), head


def test_brazil_agrees_with_the_brief():
    """Both read the same file; a divergence means one of them drifted."""
    from telegram.handlers import brief
    total = re.search(r"TOTAL ([\d,]+) bags", brazil.handle("", {})).group(1)
    assert total in brief.handle("", {}), "brazil and brief disagree on the day's total"


# ── /ecf ─────────────────────────────────────────────────────────────────────

def test_ecf_reads_its_own_file_not_demand_stocks():
    """demand_stocks.json no longer carries an 'ecf' key; the series lives in
    ecf_history.json. The handler followed the old path and answered
    'ECF data empty.' on every call."""
    assert "ecf" not in _live("demand_stocks.json"), \
        "demand_stocks grew an 'ecf' key again — decide which file is canonical"
    hist = _live("ecf_history.json")
    assert hist.get("monthly"), "ecf_history.json has no monthly series"
    assert {"period", "value_mt"} <= set(hist["monthly"][-1]), \
        "monthly entries changed shape — ecf.py formats period/value_mt"

    out = ecf.handle("", {})
    assert "ECF data empty" not in out and "unavailable" not in out
    assert "MT" in out


# ── the commands that were already working ───────────────────────────────────

def test_prices_still_renders_both_boards():
    out = prices.handle("", {})
    assert "unavailable" not in out
    assert "KC " in out and "RC " in out


def test_kaffeesteuer_still_renders():
    out = kaffeesteuer.handle("", {})
    assert "unavailable" not in out and "bags" in out


# ── the brief's footer ───────────────────────────────────────────────────────

def test_brief_footer_only_advertises_registered_commands():
    """It used to list /stock, /certified, /vietnam, /uganda, /freight and
    /macro — six commands that fall through to 'Unknown command.'"""
    from telegram.commands import DISPATCH
    from telegram.handlers import brief

    footer = brief.handle("", {}).splitlines()[-1]
    advertised = {w.lstrip("/") for w in footer.split() if w.startswith("/")}
    assert advertised, "footer no longer lists any commands"
    assert advertised <= set(DISPATCH), f"footer advertises unregistered: {advertised - set(DISPATCH)}"
