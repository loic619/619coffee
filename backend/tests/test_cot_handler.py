"""Tests for the /cot Telegram handler — signals block formatting (issue #132 Body-1).

Rewritten for the message redesign: the signals block is now one `🚨 SIGNALS`
section whose rows carry a severity *mark* and a market prefix
(`🔴 NY · Squeeze Risk (+3)`), replacing the old per-market `Signals (NY):`
headings and `[ALERT]` text tags. The behaviours asserted are the same ones the
pre-redesign tests protected — severity ordering, warn/watch as synonyms, AGRO
rows excluded, and graceful rendering when signals.json is absent.
"""
from __future__ import annotations

import pytest

# Path setup matches the other backend tests (conftest.py adds backend/ to sys.path).
from telegram.formatting.indicators import ALERT, INFO, WATCH
from telegram.handlers import cot

# Minimal cot_recent.json shape — two adjacent weeks so the handler picks
# `latest` + `prev` and renders the per-market header block. Numbers are
# arbitrary; the test asserts on the signals block, not these numbers.
_COT_FIXTURE = [
    {
        "date": "2026-05-19",
        "ny":  {"mm_long": 80_000, "mm_short": 40_000, "pmpu_long": 20_000, "pmpu_short": 70_000,
                "oi_total": 250_000, "price_ny":  330.0},
        "ldn": {"mm_long": 30_000, "mm_short": 20_000, "pmpu_long":  5_000, "pmpu_short": 25_000,
                "oi_total": 130_000, "price_ldn": 4500.0},
    },
    {
        "date": "2026-05-26",
        "ny":  {"mm_long": 85_000, "mm_short": 35_000, "pmpu_long": 22_000, "pmpu_short": 72_000,
                "oi_total": 255_000, "price_ny":  338.0},
        "ldn": {"mm_long": 31_000, "mm_short": 19_000, "pmpu_long":  5_500, "pmpu_short": 25_500,
                "oi_total": 131_000, "price_ldn": 4550.0},
    },
]


def _make_signals_doc():
    """Synthetic signals.json with one row per (severity × market) plus an
    AGRO row that must NOT appear in either NY or LDN block."""
    return {
        "date": "2026-05-26",
        "scoreNY": 4,
        "scoreLDN": 1,
        "signals": [
            {"id": "CR5", "name": "Squeeze Risk", "category": "CR", "categoryLabel": "Spec",
             "market": "NY",  "severity": "alert",    "score":  3, "magnitude": "large",  "text": "..."},
            {"id": "ML5", "name": "Fund Long Exit", "category": "ML", "categoryLabel": "Spec",
             "market": "NY",  "severity": "watch",    "score": -2, "magnitude": "small",  "text": "..."},
            {"id": "CP1", "name": "Normal Hedging", "category": "CP", "categoryLabel": "Producer",
             "market": "NY",  "severity": "info",     "score":  0, "magnitude": "small",  "text": "..."},
            {"id": "CI2", "name": "Commercial Convergence Bearish", "category": "CI", "categoryLabel": "Commercial",
             "market": "LDN", "severity": "critical", "score": -3, "magnitude": "medium", "text": "..."},
            # AGRO row — must be excluded from NY and LDN blocks (market="PHYS").
            {"id": "AGRO_brazil_Cerrado_blossom_drop", "name": "Flowering Disruption",
             "category": "AGRO", "categoryLabel": "Agronomic",
             "market": "PHYS", "severity": "watch", "timeframe": "forecast",
             "score": 0, "magnitude": "medium", "text": "..."},
        ],
        "generatedAt": "2026-05-26T00:00:00Z",
    }


@pytest.fixture
def _patched_load(monkeypatch):
    """Patch the `load` symbol that `cot.py` imported — that's the one the
    handler calls. The default returns cot_recent.json + signals.json shapes."""
    sig_doc = _make_signals_doc()

    def fake_load(filename: str):
        if filename == "cot_recent.json":
            return _COT_FIXTURE
        if filename == "signals.json":
            return sig_doc
        return None

    monkeypatch.setattr(cot, "load", fake_load)
    return sig_doc


def test_signals_block_renders_both_markets(_patched_load):
    """One SIGNALS section now, with the board named on each row."""
    out = cot.handle("", {})
    assert "🚨 <b>SIGNALS</b>" in out
    assert "NY · Squeeze Risk" in out
    assert "LDN · Commercial Convergence Bearish" in out


def test_severity_marks_cover_every_tier(_patched_load):
    """Each tier the engines emit must render as its own mark. `critical` and
    `watch` used to fall through to INFO — the lowest mark — which printed the
    most urgent row as context."""
    out = cot.handle("", {})
    assert f"{ALERT} LDN · Commercial Convergence Bearish" in out  # critical
    assert f"{ALERT} NY · Squeeze Risk"    in out                  # alert
    assert f"{WATCH} NY · Fund Long Exit"  in out                  # watch
    assert f"{INFO} NY · Normal Hedging"   in out                  # info


def test_score_rendered_signed(_patched_load):
    """Magnitude is no longer printed; the signed score still is, and the sign
    is the part that carries direction."""
    out = cot.handle("", {})
    assert "(+3)" in out   # CR5
    assert "(-2)" in out   # ML5
    assert "(+0)" in out   # CP1 — zero still renders with an explicit sign


def test_agro_rows_excluded_from_market_blocks(_patched_load):
    """AGRO rows have market='PHYS' — they belong on a future /agro command,
    not in the NY/LDN signal listings on /cot."""
    out = cot.handle("", {})
    assert "Flowering Disruption" not in out
    assert "AGRO_brazil_Cerrado_blossom_drop" not in out
    assert "PHYS" not in out


def test_critical_sorts_above_alert_above_watch(_patched_load):
    """Within a board, severity rank drives ordering: alert (3) > watch (2) >
    info (1). NY is listed before LDN, whose single row is critical (4)."""
    out = cot.handle("", {})
    sig_pos = out.index("🚨 <b>SIGNALS</b>")
    cr5_pos = out.index("NY · Squeeze Risk")
    ml5_pos = out.index("NY · Fund Long Exit")
    cp1_pos = out.index("NY · Normal Hedging")
    ci2_pos = out.index("LDN · Commercial Convergence Bearish")
    assert sig_pos < cr5_pos < ml5_pos < cp1_pos < ci2_pos


def test_handler_renders_without_signals_file(monkeypatch):
    """signals.json may be absent on a fresh runner — handler must not crash;
    just omit the signals block."""
    def fake_load(filename: str):
        if filename == "cot_recent.json":
            return _COT_FIXTURE
        return None  # signals.json absent

    monkeypatch.setattr(cot, "load", fake_load)
    out = cot.handle("", {})
    assert "COT POSITIONING" in out
    assert "SIGNALS" not in out


def test_handler_omits_market_with_no_signals(monkeypatch):
    """If signals.json has rows but none for a given market, that market simply
    contributes no rows — and never an empty, orphaned mention of itself."""
    def fake_load(filename: str):
        if filename == "cot_recent.json":
            return _COT_FIXTURE
        if filename == "signals.json":
            return {
                "signals": [
                    {"id": "CR5", "name": "Squeeze Risk", "market": "NY",
                     "severity": "alert", "score": 3, "magnitude": "large"},
                ],
            }
        return None

    monkeypatch.setattr(cot, "load", fake_load)
    out = cot.handle("", {})
    assert "NY · Squeeze Risk" in out
    assert "LDN ·" not in out


def test_signal_lines_format_unit():
    """_signal_lines is pure — easy to lock down."""
    lines = cot._signal_lines([
        {"id": "CR5", "name": "Squeeze Risk", "market": "NY",
         "severity": "alert", "score": 3, "magnitude": "large"},
    ], "NY")
    assert lines == [f"{ALERT} NY · Squeeze Risk (+3)"]


def test_signal_lines_negative_score():
    lines = cot._signal_lines([
        {"id": "ML5", "name": "Fund Long Exit", "market": "NY",
         "severity": "watch", "score": -2, "magnitude": "small"},
    ], "NY")
    assert lines == [f"{WATCH} NY · Fund Long Exit (-2)"]


def test_signal_lines_falls_back_to_id_without_a_name():
    """A row that carries no name still has to identify itself."""
    lines = cot._signal_lines([
        {"id": "XX1", "market": "NY", "severity": "info", "score": 5},
    ], "NY")
    assert lines == [f"{INFO} NY · XX1 (+5)"]


def test_warn_and_watch_treated_as_synonyms(monkeypatch):
    """Live drift: quant signals use severity='warn'; agronomic engine uses
    severity='watch'. Both must carry the same mark and rank above info."""
    from telegram.formatting.indicators import severity
    assert severity("warn") == severity("watch") == WATCH
    assert cot._SEVERITY_RANK["warn"] == cot._SEVERITY_RANK["watch"] == 2

    # Integration: a 'warn' row must sort above an 'info' row in the same market.
    def fake_load(filename: str):
        if filename == "cot_recent.json":
            return _COT_FIXTURE
        if filename == "signals.json":
            return {
                "signals": [
                    {"id": "AA1", "name": "Info Row",  "market": "NY",
                     "severity": "info", "score": 0, "magnitude": "small"},
                    {"id": "BB2", "name": "Warn Row",  "market": "NY",
                     "severity": "warn", "score": 1, "magnitude": "small"},
                ],
            }
        return None

    monkeypatch.setattr(cot, "load", fake_load)
    out = cot.handle("", {})
    warn_pos = out.index(f"{WATCH} NY · Warn Row")
    info_pos = out.index(f"{INFO} NY · Info Row")
    assert warn_pos < info_pos, "warn must sort above info regardless of spelling"
