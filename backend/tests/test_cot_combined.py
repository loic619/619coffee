# backend/tests/test_cot_combined.py
"""Futures-AND-OPTIONS combined COT: parsing, and the options derivation.

options(cat, side) = combined(cat, side) - futures(cat, side)

Combined figures are delta-adjusted futures-equivalents, so a leg can come out
NEGATIVE — the real robusta print has MM long 47,408 futures vs 45,971
combined, i.e. a −1,437 delta-short call book. Nothing may clamp that.
"""
import pandas as pd
import pytest

from cot_schema import serialize_cot_row
from scraper.sources.cot_combined import COMBINED_FILTERS, parse_combined


class _Row:
    """Minimal stand-in for a CotWeekly ORM row."""
    def __init__(self, **kw):
        self.oi_total = kw.pop("oi_total", None)
        for k, v in kw.items():
            setattr(self, k, v)

    def __getattr__(self, _name):        # unset wide columns read as None
        return None


def _cftc_frame(rows):
    return pd.DataFrame([{
        "Market_and_Exchange_Names": name,
        "As_of_Date_In_Form_YYMMDD": yymmdd,
        "Prod_Merc_Positions_Long_All": vals.get("pmpu_long", 0),
        "Prod_Merc_Positions_Short_All": vals.get("pmpu_short", 0),
        "Swap_Positions_Long_All": vals.get("swap_long", 0),
        "Swap_Positions_Short_All": vals.get("swap_short", 0),
        "Swap_Positions_Spread_All": vals.get("swap_spread", 0),
        "M_Money_Positions_Long_All": vals.get("mm_long", 0),
        "M_Money_Positions_Short_All": vals.get("mm_short", 0),
        "M_Money_Positions_Spread_All": vals.get("mm_spread", 0),
        "Other_Rept_Positions_Long_All": vals.get("other_long", 0),
        "Other_Rept_Positions_Short_All": vals.get("other_short", 0),
        "Other_Rept_Positions_Spread_All": vals.get("other_spread", 0),
        "NonRept_Positions_Long_All": vals.get("nr_long", 0),
        "NonRept_Positions_Short_All": vals.get("nr_short", 0),
    } for name, yymmdd, vals in rows])


def test_parse_combined_reads_every_category_side():
    df = _cftc_frame([(COMBINED_FILTERS["ny"], 260811, {
        "pmpu_long": 10, "pmpu_short": 20,
        "swap_long": 30, "swap_short": 40, "swap_spread": 50,
        "mm_long": 60, "mm_short": 70, "mm_spread": 80,
        "other_long": 90, "other_short": 100, "other_spread": 110,
        "nr_long": 120, "nr_short": 130,
    })])
    out = parse_combined(df, COMBINED_FILTERS["ny"])
    (d, fields), = out.items()
    assert d.isoformat() == "2026-08-11"
    assert fields[("pmpu", "long")] == 10
    assert fields[("mm", "spread")] == 80
    assert fields[("nr", "short")] == 130
    # pmpu / nr have no spread column in the report
    assert ("pmpu", "spread") not in fields
    assert ("nr", "spread") not in fields


def test_parse_combined_ignores_the_futures_only_rows():
    # Both variants live in the same ICE file; the combined name must not
    # pick up "ICE Robusta Coffee Futures" (a strict prefix of it).
    df = _cftc_frame([
        ("ICE Robusta Coffee Futures - ICE Futures Europe", 260811, {"mm_long": 47_408}),
        (COMBINED_FILTERS["ldn"], 260811, {"mm_long": 45_971}),
    ])
    out = parse_combined(df, COMBINED_FILTERS["ldn"])
    (_, fields), = out.items()
    assert fields[("mm", "long")] == 45_971


def test_parse_combined_newest_first_and_windowed():
    df = _cftc_frame([
        (COMBINED_FILTERS["ny"], 260728, {"mm_long": 1}),
        (COMBINED_FILTERS["ny"], 260804, {"mm_long": 2}),
        (COMBINED_FILTERS["ny"], 260811, {"mm_long": 3}),
    ])
    assert len(parse_combined(df, COMBINED_FILTERS["ny"])) == 3
    windowed = parse_combined(df, COMBINED_FILTERS["ny"], weeks_back=2)
    assert sorted(d.isoformat() for d in windowed) == ["2026-08-04", "2026-08-11"]


def test_parse_combined_unknown_market_is_empty():
    df = _cftc_frame([(COMBINED_FILTERS["ny"], 260811, {"mm_long": 1})])
    assert parse_combined(df, "NO SUCH MARKET") == {}


# ── options derivation in the serializer ─────────────────────────────────────

def test_options_book_is_combined_minus_futures():
    row = _Row(oi_total=100)
    positions = {("all", "mm", "long"): (47_408, None), ("all", "mm", "short"): (2_749, None)}
    combined = {("mm", "long"): 45_971, ("mm", "short"): 2_900}
    out = serialize_cot_row(row, positions=positions, combined=combined)
    # The real robusta print: a delta-SHORT call book against the MM long leg.
    assert out["mm_long_opt"] == -1_437
    assert out["mm_short_opt"] == 151
    assert out["mm_long"] == 47_408          # futures untouched


def test_options_fields_absent_without_a_combined_report():
    row = _Row(oi_total=100)
    positions = {("all", "mm", "long"): (47_408, None)}
    out = serialize_cot_row(row, positions=positions, combined=None)
    assert "mm_long_opt" not in out          # absent, NOT zero


def test_options_field_skipped_when_one_side_missing():
    row = _Row(oi_total=100)
    positions = {("all", "mm", "long"): (47_408, None)}
    # combined lacks mm_short; futures lacks swap_long
    out = serialize_cot_row(row, positions=positions,
                            combined={("mm", "long"): 45_971, ("swap", "long"): 10})
    assert out["mm_long_opt"] == -1_437
    assert "mm_short_opt" not in out
    assert "swap_long_opt" not in out


@pytest.mark.parametrize("comb,fut,expected", [(120, 100, 20), (80, 100, -20), (100, 100, 0)])
def test_options_sign_is_preserved(comb, fut, expected):
    row = _Row(oi_total=1)
    out = serialize_cot_row(row, positions={("all", "mm", "long"): (fut, None)},
                            combined={("mm", "long"): comb})
    assert out["mm_long_opt"] == expected
