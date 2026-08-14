"""Regression for the 2026-08-14 export-time finding.

`vietnam_supply` was 275 s of a 310 s nightly export (89% of the whole job,
5-10 runs/day). Cause: two source tiers — NSO Vietnam and the ICO CSV — that
had never contributed a month from CI. NSO is unroutable from GitHub runners
and the walk was 3 years x 3 slug candidates at a 30 s CONNECT timeout, so
9 x 30 s = 270 s burned per run for +0 months. Both tiers were deleted; the
surviving chain is Customs cache -> static snapshot, and the merged output is
byte-identical to what it was with the dead tiers present.

These tests pin the properties that keep it that way: the chain does no
network at all, and it still produces the same shape from the same two
sources.
"""
import json
from pathlib import Path

import pytest

from scraper.sources import vietnam_supply as vs

# ── the actual fix: no network in this chain at all ──────────────────────────

def test_the_chain_makes_no_network_calls(monkeypatch):
    """The 270 s was connect timeouts. A chain with no HTTP cannot regress.

    Guards against someone re-adding a remote tier without re-reading why the
    last two were removed. If a future source genuinely needs the network, it
    must set its own connect timeout — and this test should be updated
    deliberately, not deleted.
    """
    import socket

    # A raising guard is NOT enough here: fetch_exports wraps every source in
    # try/except, so it would swallow the assertion and the test would pass
    # while the socket was in fact opened. Record the attempt in a flag that
    # survives that handler.
    opened: list[str] = []

    def no_sockets(*a, **kw):
        opened.append(repr(a[:1]))
        raise OSError("blocked by test")

    monkeypatch.setattr(socket.socket, "connect", no_sockets)
    monkeypatch.setattr(socket, "create_connection", no_sockets)
    assert vs.fetch_exports() is not None
    assert not opened, (
        f"vietnam_supply opened {len(opened)} socket(s) — every source here "
        f"must be a local read. See the module docstring on NSO/ICO. {opened}"
    )


def test_requests_is_not_even_imported():
    """No HTTP client in the module — the cheapest possible statement of the
    same property, and it catches a new remote source at import time."""
    assert not hasattr(vs, "requests")
    assert not hasattr(vs, "_HEADERS")


def test_the_dead_tiers_are_gone():
    for attr in ("_fetch_nso_exports", "_fetch_ico_exports",
                 "_fetch_nso_year_page", "_parse_nso_xlsx",
                 "_parse_ico_exports", "_NSO_YEAR_PAGE_TEMPLATES",
                 "_ICO_CSV_URL"):
        assert not hasattr(vs, attr), f"{attr} came back — see module docstring"


# ── the chain still works ────────────────────────────────────────────────────

def test_both_surviving_sources_actually_contribute():
    """If either tier stopped contributing it would be dead weight in turn."""
    result = vs.fetch_exports()
    assert result is not None
    assert "customs.gov.vn" in result["source"]
    assert "vn_export_destination_port" in result["source"]


def test_customs_wins_over_static_for_a_shared_month(monkeypatch):
    monkeypatch.setattr(vs, "_fetch_customs_exports",
                        lambda: [{"month": "2026-07", "total_k_bags": 111.0}])
    monkeypatch.setattr(vs, "_fetch_static_exports",
                        lambda: [{"month": "2026-07", "total_k_bags": 999.0},
                                 {"month": "2026-06", "total_k_bags": 222.0}])
    out = vs.fetch_exports()
    by_month = {r["month"]: r["total_k_bags"] for r in out["monthly"]}
    assert by_month["2026-07"] == 111.0, "Customs must win the shared month"
    assert by_month["2026-06"] == 222.0, "static must still fill the gap"


def test_a_failing_source_does_not_sink_the_other(monkeypatch):
    def boom():
        raise RuntimeError("cache unreadable")
    monkeypatch.setattr(vs, "_fetch_customs_exports", boom)
    out = vs.fetch_exports()
    assert out is not None and out["monthly"], "static alone must still publish"


def test_output_matches_the_shipped_file():
    """End-to-end: the deletion changed nothing a consumer can see."""
    shipped_path = (Path(__file__).resolve().parents[3]
                    / "frontend" / "public" / "data" / "vietnam_supply.json")
    if not shipped_path.exists():
        pytest.skip("shipped vietnam_supply.json not present")
    shipped = json.loads(shipped_path.read_text(encoding="utf-8"))["exports"]
    fresh = vs.fetch_exports()
    assert fresh["source"] == shipped["source"]
    assert fresh["last_updated"] == shipped["last_updated"]
    assert fresh["monthly"] == shipped["monthly"]
