"""Offline tests for the Sucafina origin-report parsing helpers.

The page fetch itself needs a browser + open network (CI-only); these pin the
two pure functions the pipeline's correctness rests on: date-link recognition
and per-origin section splitting."""
from scraper.fetch_sucafina_reports import _parse_date, _split_origins


def test_parse_date_variants():
    assert _parse_date("22 July 2026") == "2026-07-22"
    assert _parse_date("08 July 2026") == "2026-07-08"
    assert _parse_date("24 Jun 2026") == "2026-06-24"
    assert _parse_date("1 Sept 2025") == "2025-09-01"
    assert _parse_date("  15 July 2026  ") == "2026-07-15"
    # non-dates (nav links, headings) are rejected
    for bad in ("Origin Report", "July 2026", "22", "Read more", "", None):
        assert _parse_date(bad) is None


def test_split_origins_basic():
    text = """Origin Report Week 29

Global
Prices consolidated after last week's rally.
Funds trimmed length.

Brazil
Conilon harvest is 80% complete.
FOB differentials firmed.

Vietnam
Farmers holding back stock; domestic prices at 92,000 VND/kg.
"""
    s = _split_origins(text)
    assert set(s) == {"Global", "Brazil", "Vietnam"}
    assert "Conilon harvest" in s["Brazil"]
    assert "92,000" in s["Vietnam"]
    # lines are joined into flowing text
    assert s["Global"] == "Prices consolidated after last week's rally. Funds trimmed length."


def test_split_origins_heading_variants_and_noise():
    text = """VIETNAM:
Robusta flows slowed.

Ivory Coast
Port arrivals steady.

Not A Heading Because It Is Far Too Long To Be One Of Them
ignored preamble without a current section
"""
    s = _split_origins(text)
    assert "Vietnam" in s and "Ivory Coast" in s
    assert "Robusta flows" in s["Vietnam"]
    # headings are case-insensitive and tolerate trailing colon
    assert len(s) == 2


def test_split_origins_empty_on_image_pdf():
    assert _split_origins("") == {}
    assert _split_origins("just one paragraph of unstructured text") == {}
