"""Tests for backfill_ecf_history.py parsing (no network).
Uses the REAL ECF table shapes confirmed from the yearly PDFs: end-of-month
date headers ('31-Dec-17') with spacer columns that offset values from their
header cell, port labels pre-2020 and coffee-type labels from 2020 on."""
from scraper import backfill_ecf_history as bh
from scraper.backfill_ecf_history import (
    YEARLY_PDFS,
    _cert_at,
    _classify,
    _date_to_period,
    _ecf_tonnes,
    _european_sum,
    _finalise,
    _month_end,
    _parse_table,
)


def test_certified_european_join_helpers():
    assert _month_end("2026-04") == "2026-04-30"
    assert _month_end("2025-12") == "2025-12-31"
    # Arabica bags → t, European only (HOU/NY excluded):
    assert _european_sum({"ANT": 294416, "HA/BR": 21028, "HOU": 62759, "NY": 11974},
                         0.06) == round((294416 + 21028) * 0.06)
    # Robusta lots ×10 t, uncertain 'NOR' excluded:
    assert _european_sum({"ANT": 2103, "LON": 1721, "FEL": 31, "NOR": 500}, 10) \
        == (2103 + 1721 + 31) * 10
    # Nearest snapshot on/before month-end, within the gap window:
    series = [("2026-03-15", 30000), ("2026-04-20", 38640), ("2026-06-01", 40000)]
    assert _cert_at(series, "2026-04-30") == 38640
    assert _cert_at(series, "2025-01-31") is None       # nothing before
    assert _cert_at(series, "2026-09-30") is None       # too stale (>45d)


def test_date_header_parsing():
    assert _date_to_period("31-Dec-17") == "2017-12"
    assert _date_to_period("29-Feb-20") == "2020-02"
    assert _date_to_period("31-Jan-2026") == "2026-01"
    assert _date_to_period("Antwerp") is None
    assert _date_to_period("Port") is None


def test_ecf_tonnes_strips_separators():
    assert _ecf_tonnes("321.519") == 321519   # dot thousands (older PDFs)
    assert _ecf_tonnes("346,220") == 346220   # comma thousands (newer PDFs)
    assert _ecf_tonnes(None) is None
    assert _ecf_tonnes("Antwerp") is None


def test_classify_port_type_total():
    assert _classify("Antwerp") == ("port", "Antwerp")
    assert _classify("Robusta") == ("type", "robusta_mt")
    assert _classify("Natural Arabica") == ("type", "arabica_unwashed_mt")
    assert _classify("Washed Arabica") == ("type", "arabica_washed_mt")
    assert _classify("Total") == ("total", "total")


def test_parse_real_by_port_table_offset_values():
    """Pre-2020 layout: values sit one cell left of their date header; ordered
    zip must still line them up."""
    table = [
        ["", "Port", "", "", "31-Dec-17", "", "", "31-Jan-18"],
        ["Antwerp", None, None, "321.519", None, None, "313.109", None],
        ["Hamburg", None, None, "112.379", None, None, "115.997", None],
    ]
    pm: dict = {}
    assert _parse_table(table, 2018, "u", pm) == 4
    out = {e["period"]: e for e in _finalise(pm)}
    assert out["2017-12"]["ports"] == {"Antwerp": 321_519, "Hamburg": 112_379}
    assert out["2018-01"]["ports"]["Antwerp"] == 313_109
    # total falls back to sum of ports
    assert out["2017-12"]["value_mt"] == 321_519 + 112_379


def test_parse_real_by_type_table():
    """2020+ layout: coffee-type rows → type breakdown; total = sum of types."""
    table = [
        ["", "Type of coffee", "", "", "31-Jan-20", "", "", "29-Feb-20"],
        ["Robusta", None, None, "312.468", None, None, "308.197", None],
        ["Natural Arabica", None, None, "202.536", None, None, "202.652", None],
    ]
    pm: dict = {}
    assert _parse_table(table, 2020, "u", pm) == 4
    out = {e["period"]: e for e in _finalise(pm)}
    # Type fields are emitted FLAT (the shape StocksPanel reads).
    assert out["2020-01"]["robusta_mt"] == 312_468
    assert out["2020-01"]["arabica_unwashed_mt"] == 202_536
    assert out["2020-01"]["value_mt"] == 312_468 + 202_536


def test_implausible_total_dropped_but_breakdown_kept():
    """A mis-parsed total outside the European band is dropped; ports kept."""
    table = [
        ["", "Port", "", "", "31-Feb-14"],   # single bad value → tiny total
        ["Antwerp", None, None, "874", None],
    ]
    pm: dict = {}
    _parse_table(table, 2014, "u", pm)
    out = {e["period"]: e for e in _finalise(pm)}
    e = out["2014-02"]
    assert "value_mt" not in e          # 874 t dropped
    assert e["ports"] == {"Antwerp": 874}  # breakdown still retained


def test_parse_ignores_non_date_tables():
    table = [["Disclaimer:", "text"], ["more", "text"]]
    pm: dict = {}
    assert _parse_table(table, 2019, "u", pm) == 0


def test_pdf_list_covers_2014_to_present():
    assert min(YEARLY_PDFS) == 2014
    assert 2025 in YEARLY_PDFS and 2026 in YEARLY_PDFS
    assert "_updated" in YEARLY_PDFS[2021]


# ── Current-upload discovery ─────────────────────────────────────────────────
# ECF ships each release by re-uploading the year's PDF under a fresh
# /uploads/YYYY/MM/ path, so the pinned map must yield to a newer one.

_UP = "https://www.ecf-coffee.org/wp-content/uploads"
_PDF_JUN = f"{_UP}/2026/06/2026-Stocks-European-Ports.pdf"
_PDF_AUG = f"{_UP}/2026/08/2026-Stocks-European-Ports.pdf"


def test_upload_key_orders_reissues():
    assert bh.upload_key(_PDF_AUG) > bh.upload_key(_PDF_JUN)
    assert bh.upload_key("nonsense") == (0, 0)


def _stub_pages(monkeypatch, pages: dict):
    monkeypatch.setattr(bh, "_get_text", lambda url, timeout=30: pages.get(url))


def test_discovery_follows_posts_to_the_newest_pdf(monkeypatch):
    post = "https://www.ecf-coffee.org/stocks-in-european-ports-may-june-2026"
    _stub_pages(monkeypatch, {
        bh.INDEX_PAGES[0]: f'<a href="{post}/">May-June 2026</a>',
        post: f'<a href="{_PDF_AUG}">Download</a>',
    })
    assert bh.discover_yearly_pdfs((bh.INDEX_PAGES[0],)) == {2026: _PDF_AUG}


def test_resolve_prefers_newer_upload_but_keeps_pinned_history(monkeypatch):
    monkeypatch.setattr(bh, "discover_yearly_pdfs", lambda *a, **k: {2026: _PDF_AUG})
    urls = bh.resolve_yearly_pdfs()
    assert urls[2026] == _PDF_AUG          # newer re-issue wins
    assert urls[2014] == YEARLY_PDFS[2014]  # untouched years stay pinned


def test_resolve_ignores_older_or_failed_discovery(monkeypatch):
    # An OLDER upload must never downgrade the pinned URL.
    stale = f"{_UP}/2026/03/2026-Stocks-European-Ports.pdf"
    monkeypatch.setattr(bh, "discover_yearly_pdfs", lambda *a, **k: {2026: stale})
    assert bh.resolve_yearly_pdfs()[2026] == YEARLY_PDFS[2026]
    # Discovery blowing up (site down, markup change) falls back to the map.
    def boom(*a, **k):
        raise RuntimeError("site unreachable")
    monkeypatch.setattr(bh, "discover_yearly_pdfs", boom)
    assert bh.resolve_yearly_pdfs() == dict(sorted(YEARLY_PDFS.items()))
