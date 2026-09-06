"""The Eurostat leg of retail_cpi — the request shape, and the guards around it.

There were no tests on this scraper at all, which is part of why it shipped a
series frozen at 2025-12 for months while its runs logged OK. These do not
reach the network: they assert the URL that gets built, and the decisions taken
around a fetch that returns nothing.

The URL matters more than it looks. Eurostat retired `prc_hicp_midx` with the
January 2026 index and the replacement changed three things at once — the
dataflow id, the item DIMENSION name (`coicop18`, not `coicop`) and coffee's
item CODE (`CP01220`, not `CP01211`). Any one of those left behind produces an
empty or wrong answer rather than an error, so they are pinned here.
"""
from __future__ import annotations

from scraper.sources import retail_cpi as R


class _Resp:
    def __init__(self, body, status=200):
        self._body, self.status_code = body, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._body


def _jsonstat(periods: list[str], values: list[float | None]) -> dict:
    return {
        "dimension": {"time": {"category": {"index": {p: i for i, p in enumerate(periods)}}}},
        "value": {str(i): v for i, v in enumerate(values) if v is not None},
    }


def _capture(monkeypatch, body=None):
    """Record every URL requested; answer each with `body` (or an empty series)."""
    seen: list[str] = []

    def fake_get(url, **_kw):
        seen.append(url)
        return _Resp(body if body is not None else _jsonstat([], []))

    monkeypatch.setattr(R.requests, "get", fake_get)
    return seen


# ── the request shape ────────────────────────────────────────────────────────

def test_the_url_names_the_live_dataflow_not_the_retired_one(monkeypatch):
    seen = _capture(monkeypatch)
    R._fetch_eurostat_series("DE")
    assert len(seen) == 1
    url = seen[0]
    assert "/prc_hicp_minr?" in url
    # prc_hicp_midx is frozen at 2025-12; reading it is the bug this file guards
    assert "prc_hicp_midx" not in url


def test_the_url_uses_the_ecoicop_v2_dimension_and_code(monkeypatch):
    seen = _capture(monkeypatch)
    R._fetch_eurostat_series("EU27_2020")
    url = seen[0]
    assert "coicop18=CP01220" in url
    # the old dimension name and the old code both silently return nothing
    assert "coicop=CP01211" not in url
    assert "&coicop=" not in url
    assert "geo=EU27_2020" in url


def test_the_2015_base_is_tried_before_the_2025_one(monkeypatch):
    # The shipped history is on 2015=100. Splicing a 2025-based index onto it
    # would put a cliff in the YoY the panel draws.
    assert R._EUROSTAT_UNITS[0] == "I15"
    seen = _capture(monkeypatch)
    R._fetch_eurostat_geo("DE")
    assert [u.split("unit=")[1].split("&")[0] for u in seen] == list(R._EUROSTAT_UNITS)


def test_a_base_that_returns_data_stops_the_search(monkeypatch):
    body = _jsonstat(["2026-06", "2026-07"], [101.0, 102.0])
    seen = _capture(monkeypatch, body)
    rows, unit = R._fetch_eurostat_geo("DE")
    assert unit == "I15" and len(seen) == 1
    assert [r["period"] for r in rows] == ["2026-06", "2026-07"]


def test_a_fetch_failure_is_none_not_an_exception(monkeypatch):
    def boom(*_a, **_kw):
        raise TimeoutError("upstream")
    monkeypatch.setattr(R.requests, "get", boom)
    assert R._fetch_eurostat_series("DE") is None
    assert R._fetch_eurostat_geo("DE") == (None, None)


# ── the guards ───────────────────────────────────────────────────────────────

def test_the_basket_refuses_to_average_across_index_bases(monkeypatch):
    """Two indices on different bases do not average into an index of anything.

    DE answers on I15; the other three only on I25. Emitting the weighted mean
    would produce a plausible-looking number that means nothing.
    """
    i15 = _jsonstat(["2026-07"], [150.0])
    i25 = _jsonstat(["2026-07"], [102.0])

    def fake_get(url, **_kw):
        unit = url.split("unit=")[1].split("&")[0]
        geo = url.split("geo=")[1].split("&")[0]
        if geo == "DE":
            return _Resp(i15 if unit == "I15" else _jsonstat([], []))
        return _Resp(i25 if unit == "I25" else _jsonstat([], []))

    monkeypatch.setattr(R.requests, "get", fake_get)
    assert R._fetch_eurostat_basket() is None


def test_the_basket_keeps_only_periods_every_contributor_has(monkeypatch):
    """One laggard country caps the basket — by design, but it must be visible.

    Substituting a carried-forward value for the missing country would smear
    the YoY, so the basket ends where its slowest member ends.
    """
    full = _jsonstat(["2026-06", "2026-07"], [100.0, 110.0])
    short = _jsonstat(["2026-06"], [100.0])

    def fake_get(url, **_kw):
        geo = url.split("geo=")[1].split("&")[0]
        unit = url.split("unit=")[1].split("&")[0]
        if unit != "I15":
            return _Resp(_jsonstat([], []))
        return _Resp(short if geo == "ES" else full)

    monkeypatch.setattr(R.requests, "get", fake_get)
    basket = R._fetch_eurostat_basket()
    assert [r["period"] for r in basket] == ["2026-06"]


def test_a_current_aggregate_is_used_and_says_which_base_it_is_on(monkeypatch):
    from datetime import date
    this_month = date.today().strftime("%Y-%m")
    body = _jsonstat([this_month], [123.0])
    monkeypatch.setattr(R.requests, "get", lambda url, **_kw: _Resp(body))
    out = R._fetch_eurostat()
    assert "EU27" in out["name"] and "2015=100" in out["name"]
    assert out["source_url"].endswith(R._EUROSTAT_DATAFLOW)


def test_yoy_is_none_without_a_prior_year_rather_than_zero():
    rows = R._yoy_series([{"period": "2026-07", "index": 110.0}])
    assert rows[0]["yoy_pct"] is None
    rows = R._yoy_series([{"period": "2025-07", "index": 100.0},
                          {"period": "2026-07", "index": 110.0}])
    assert rows[1]["yoy_pct"] == 10.0
