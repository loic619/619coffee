"""US Treasury par yield curve parsing.

The feed is an Atom envelope with namespaced <m:properties> entries. The parser
reads every BC_* child generically rather than naming tenors, so these tests
lean on that: a renamed or newly added tenor must flow through, and a malformed
one must not take the session with it.
"""
from scraper.sources.treasury_yields import _spread, _tenor_key, parse_curve

XML = """<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<feed xml:base="https://home.treasury.gov/" xmlns="http://www.w3.org/2005/Atom"
      xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
      xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <entry><content type="application/xml"><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">2026-08-20T00:00:00</d:NEW_DATE>
    <d:BC_1MONTH>4.31</d:BC_1MONTH>
    <d:BC_3MONTH>4.22</d:BC_3MONTH>
    <d:BC_2YEAR>3.71</d:BC_2YEAR>
    <d:BC_10YEAR>4.28</d:BC_10YEAR>
    <d:BC_30YEAR>4.89</d:BC_30YEAR>
  </m:properties></content></entry>
  <entry><content type="application/xml"><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">2026-08-21T00:00:00</d:NEW_DATE>
    <d:BC_1MONTH>4.30</d:BC_1MONTH>
    <d:BC_3MONTH>4.20</d:BC_3MONTH>
    <d:BC_2YEAR>3.65</d:BC_2YEAR>
    <d:BC_10YEAR>4.33</d:BC_10YEAR>
    <d:BC_30YEAR>4.92</d:BC_30YEAR>
  </m:properties></content></entry>
</feed>"""


def test_parses_every_session_and_tenor():
    rows = parse_curve(XML)
    assert [r["date"] for r in rows] == ["2026-08-20", "2026-08-21"]
    assert rows[1]["yields"] == {"1m": 4.30, "3m": 4.20, "2y": 3.65,
                                 "10y": 4.33, "30y": 4.92}


def test_rows_come_back_oldest_first():
    """History is appended and sliced from the end — reversed input would make
    `latest` the oldest session."""
    reordered = XML.replace("2026-08-20", "2026-12-31")
    rows = parse_curve(reordered)
    assert [r["date"] for r in rows] == ["2026-08-21", "2026-12-31"]


def test_tenor_names_are_derived_not_hardcoded():
    assert _tenor_key("BC_1MONTH") == "1m"
    assert _tenor_key("BC_10YEAR") == "10y"
    assert _tenor_key("BC_20YEAR") == "20y"
    assert _tenor_key("NEW_DATE") is None
    assert _tenor_key("BC_FUTURE_THING") is None


def test_a_new_tenor_flows_through_without_a_code_change():
    """Treasury added the 4-month bill in 2022; the next one must not need us."""
    x = XML.replace("<d:BC_3MONTH>4.22</d:BC_3MONTH>",
                    "<d:BC_3MONTH>4.22</d:BC_3MONTH><d:BC_4MONTH>4.25</d:BC_4MONTH>")
    assert parse_curve(x)[0]["yields"]["4m"] == 4.25


def test_a_blank_or_junk_tenor_does_not_lose_the_session():
    x = XML.replace("<d:BC_2YEAR>3.71</d:BC_2YEAR>", "<d:BC_2YEAR>N/A</d:BC_2YEAR>")
    row = parse_curve(x)[0]
    assert "2y" not in row["yields"]
    assert row["yields"]["10y"] == 4.28, "the rest of the curve must survive"


def test_an_entry_with_no_yields_is_dropped():
    x = XML
    for t in ("BC_1MONTH>4.31</d:BC_1MONTH", "BC_3MONTH>4.22</d:BC_3MONTH",
              "BC_2YEAR>3.71</d:BC_2YEAR", "BC_10YEAR>4.28</d:BC_10YEAR",
              "BC_30YEAR>4.89</d:BC_30YEAR"):
        x = x.replace(f"<d:{t}>", "")
    assert [r["date"] for r in parse_curve(x)] == ["2026-08-21"]


def test_spreads_are_basis_points_and_signed_the_conventional_way():
    ys = {"2y": 3.65, "10y": 4.33, "3m": 4.20}
    assert _spread(ys, "2y", "10y") == 68.0      # positive = upward sloping
    assert _spread(ys, "3m", "10y") == 13.0
    assert _spread(ys, "2y", "missing") is None  # never guess a leg
