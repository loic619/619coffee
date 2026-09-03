"""The API route and the committed snapshot must serve the same payload.

They were two independent implementations and they drifted. By 2026-09 the API
route was still the pre-August exporter and carried four differences the export
path had already fixed:

    vn-ham proxy=False        the ~est. marker appeared on the snapshot and
                              vanished on live, for the same derived number
    `date < cutoff`           the w/w off-by-one from #800
    84-day history cap        the archive opened up in #809
    history from FBX11/FBX01  vn-ham, co-eu and br-us quoted but never charted

page.tsx prefers the live backend and falls back to the snapshot, so which
version a reader saw depended on whether the backend happened to be up. Both now
call build_freight_payload; these tests fail if either grows its own copy again.
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from freight_payload import ROUTE_CONFIG, build_freight_payload
from models import FreightRate


def _seed(db) -> None:
    today = date.today()
    for code, base in (("FBX11", 4000.0), ("FBX01", 7000.0), ("FBX03", 9000.0)):
        for i in (400, 90, 7, 0):
            db.add(FreightRate(index_code=code, date=today - timedelta(days=i),
                               rate=base + i))
    db.commit()


def test_route_config_is_defined_once():
    """Both callers re-export the shared list — same object, not a copy."""
    from scraper.exporters.macro import ROUTE_CONFIG as exporter_cfg
    routes_mod = pytest.importorskip(
        "routes.freight", reason="fastapi not installed in this environment")
    assert exporter_cfg is ROUTE_CONFIG
    assert routes_mod.ROUTE_CONFIG is ROUTE_CONFIG


def test_hamburg_is_flagged_as_the_estimate_it_is():
    """Hamburg is Rotterdam x 1.02, not its own quote."""
    vn_ham = next(c for c in ROUTE_CONFIG if c[0] == "vn-ham")
    assert vn_ham[5] is True, "vn-ham must be marked proxy on every path"


def test_every_derived_route_is_flagged():
    """A multiplier other than 1.00 means the number is scaled, so: proxy."""
    for route_id, _from, _to, _index, mult, is_proxy in ROUTE_CONFIG:
        if mult != 1.00:
            assert is_proxy, f"{route_id} is scaled x{mult} but not flagged proxy"


def test_payload_carries_the_post_august_fixes(db):
    _seed(db)
    payload = build_freight_payload(db)
    today = date.today()

    # `<=`, not `<` — the exactly-7-day-old print is the comparison point.
    vn_eu = next(r for r in payload["routes"] if r["id"] == "vn-eu")
    assert vn_eu["prev_date"] == (today - timedelta(days=7)).isoformat()

    # No 84-day cap: the 400-day-old row survives.
    dates = [r["date"] for r in payload["history"]]
    assert (today - timedelta(days=400)).isoformat() in dates

    # History is driven by ROUTE_CONFIG, so every quoted route is charted.
    latest_row = next(r for r in payload["history"] if r["date"] == today.isoformat())
    for route_id, *_ in ROUTE_CONFIG:
        assert route_id in latest_row, f"{route_id} quoted but missing from history"

    # Indices and basis are present on both paths.
    assert {i["code"] for i in payload["indices"]} >= {"FBX11", "FBX01", "FBX03"}
    assert vn_eu["basis"] == {"index": "FBX11", "multiplier": 1.00}


def test_api_route_returns_the_shared_payload(db):
    """The route is a thin wrapper — no second implementation behind it."""
    routes_mod = pytest.importorskip(
        "routes.freight", reason="fastapi not installed in this environment")
    _seed(db)

    class _Resp:
        headers: dict = {}

    from_route = routes_mod.get_freight(_Resp(), db)
    assert from_route == build_freight_payload(db)
