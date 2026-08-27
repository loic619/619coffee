"""US Treasury par yield curve parsing.

The feed is an Atom envelope with namespaced <m:properties> entries. The parser
reads every BC_* child generically rather than naming tenors, so these tests
lean on that: a renamed or newly added tenor must flow through, and a malformed
one must not take the session with it.
"""
import sys

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


# ── incremental fetch ────────────────────────────────────────────────────────
# Fetching both years every run cost 37.4 s, 41.6% of the whole static export.
# The prior year is now pulled only to top up a short series, which puts the
# published history on the critical path: if the merge drops it, the chart
# silently shortens instead of failing.

def _stub_years(monkeypatch, by_year):
    calls = []

    def fake(y):
        calls.append(y)
        return by_year.get(y, [])

    from scraper.sources import treasury_yields as ty
    monkeypatch.setattr(ty, "_fetch_year", fake)
    return calls


def _rows(n, start_day=1, year=2026):
    return [{"date": f"{year}-01-{d:02d}", "yields": {"2y": 3.5, "10y": 4.2}}
            for d in range(start_day, start_day + n)]


def test_a_long_existing_series_needs_only_the_current_year(monkeypatch):
    from scraper.sources import treasury_yields as ty
    calls = _stub_years(monkeypatch, {2026: _rows(5, 20)})
    out = ty.fetch_curve(existing=_rows(300))
    assert len(calls) == 1, f"expected one fetch, got years {calls}"
    assert len(out["history"]) >= 300


def test_a_cold_start_pulls_the_prior_year_too(monkeypatch):
    from scraper.sources import treasury_yields as ty
    calls = _stub_years(monkeypatch, {2026: _rows(10), 2025: _rows(200, year=2025)})
    out = ty.fetch_curve(existing=None)
    assert len(calls) == 2, "a short series must be topped up"
    assert len(out["history"]) == 210


def test_existing_history_is_never_dropped(monkeypatch):
    """The whole point of passing it in — losing it silently shortens the chart."""
    from scraper.sources import treasury_yields as ty
    _stub_years(monkeypatch, {2026: _rows(3, 20)})
    old = _rows(300)
    out = ty.fetch_curve(existing=old)
    kept = {r["date"] for r in out["history"]}
    assert {r["date"] for r in old} <= kept


def test_a_refetched_session_supersedes_the_carried_one(monkeypatch):
    """Treasury revises same-day prints; the fresh value must win."""
    from scraper.sources import treasury_yields as ty
    stale = [{"date": "2026-01-05", "yields": {"10y": 1.11}}] + _rows(300, 10)
    fresh = [{"date": "2026-01-05", "yields": {"10y": 4.44}}]
    _stub_years(monkeypatch, {2026: fresh})
    out = ty.fetch_curve(existing=stale)
    got = next(r for r in out["history"] if r["date"] == "2026-01-05")
    assert got["yields"]["10y"] == 4.44


def test_a_dead_feed_with_no_history_returns_none(monkeypatch):
    from scraper.sources import treasury_yields as ty
    _stub_years(monkeypatch, {})
    assert ty.fetch_curve(existing=None) is None


def test_a_dead_feed_does_not_rewrite_the_shipped_history(monkeypatch):
    """Carrying history forward must not turn an outage into a good-looking run.

    Before the history was passed in, a failed fetch left nothing to return and
    the exporter kept the previous file. The carried rows would now satisfy
    every downstream check on their own, so the curve would be rewritten every
    day with a fresh scraped_at over data that had not moved.
    """
    from scraper.sources import treasury_yields as ty
    calls = _stub_years(monkeypatch, {})            # every year fails
    assert ty.fetch_curve(existing=_rows(300)) is None
    assert len(calls) == 1, f"a dead current year must not trigger a top-up: {calls}"


# ── retention: unbounded, on purpose ─────────────────────────────────────────
# shape_curve used to end `hist[-500:]`. That is ~2 years, so the very next
# daily export after a 10-year backfill would have deleted eight of them —
# exactly the trap the per-contract price archive documents ("retention must
# cover the span fetched here, or the next nightly trim deletes the work").
# These pin the removal so it cannot come back as a tidy-up.

def _sessions(n, start_year=2016):
    """n synthetic sessions spread across consecutive years."""
    out = []
    for i in range(n):
        y = start_year + i // 250
        d = i % 250
        out.append({"date": f"{y}-{1 + d // 28:02d}-{1 + d % 28:02d}",
                    "yields": {"2y": 3.0, "10y": 4.0}})
    return out


def test_history_is_never_truncated():
    """A decade must survive shaping intact."""
    from scraper.sources.treasury_yields import shape_curve
    rows = _sessions(2500)
    out = shape_curve(rows)
    assert len(out["history"]) == len({r["date"] for r in rows}) == 2500


def test_shaping_keeps_the_oldest_session():
    """Truncation would take from the FRONT, so assert the front specifically."""
    from scraper.sources.treasury_yields import shape_curve
    rows = _sessions(1200)
    oldest = min(r["date"] for r in rows)
    out = shape_curve(rows)
    assert out["history"][0]["date"] == oldest


def test_source_carries_no_slice_on_history():
    """Structural: catch a reintroduced cap even if a future shape changes.

    Looks for a SLICE of the history list specifically. Two things it must not
    trip on: the docstring, which deliberately quotes the removed `hist[-500:]`
    to explain why it went; and `hist[-1]`, which is the legitimate way the
    latest session is read. A substring search for "hist[-" matches both.
    """
    import ast
    import inspect

    from scraper.sources import treasury_yields as ty
    fn = ast.parse(inspect.getsource(ty.shape_curve).lstrip()).body[0]
    body = fn.body[1:] if ast.get_docstring(fn) else fn.body

    slices = [
        ast.unparse(n)
        for stmt in body
        for n in ast.walk(stmt)
        if isinstance(n, ast.Subscript)
        and isinstance(n.slice, ast.Slice)
        and isinstance(n.value, ast.Name)
        and n.value.id == "hist"
    ]
    assert not slices, f"history is being sliced again: {slices} — see the retention note"


def test_the_daily_path_preserves_a_deep_archive():
    """The regression that matters: a daily run over a 10y file must not shrink
    it. fetch_curve merges the current year over what it is handed."""
    from scraper.sources import treasury_yields as ty
    deep = _sessions(2500)
    ty_fetch = ty._fetch_year
    try:
        ty._fetch_year = lambda y: [{"date": "2026-08-26", "yields": {"2y": 4.2, "10y": 4.7}}]
        out = ty.fetch_curve(existing=deep)
    finally:
        ty._fetch_year = ty_fetch
    assert len(out["history"]) >= 2500, "a daily run shrank the archive"
    assert out["latest"]["date"] == "2026-08-26"


# ── the backfill merges rather than replaces ─────────────────────────────────

def test_backfill_keeps_existing_when_a_year_fails(monkeypatch, tmp_path):
    """A failed year must cost nothing — the point of loading existing first."""
    import json as _json

    from scraper import backfill_treasury_yields as bf
    out = tmp_path / "treasury_yields.json"
    existing = _sessions(300, start_year=2024)
    out.write_text(_json.dumps({"history": existing}), encoding="utf-8")
    monkeypatch.setattr(bf, "OUT", out)
    # Only one year answers; the rest return nothing.
    monkeypatch.setattr(bf, "_fetch_year",
                        lambda y: [{"date": "2019-06-03", "yields": {"10y": 2.1}}] if y == 2019 else [])
    monkeypatch.setattr(sys, "argv", ["x", "--years", "10"])
    assert bf.main() == 0
    hist = _json.loads(out.read_text(encoding="utf-8"))["history"]
    dates = {r["date"] for r in hist}
    assert {r["date"] for r in existing} <= dates, "existing sessions were lost"
    assert "2019-06-03" in dates, "the one good year was not merged in"


def test_backfill_fails_loudly_when_nothing_is_fetched(monkeypatch, tmp_path):
    """Going green on zero rows is how a dead backfill hides."""
    import json as _json

    from scraper import backfill_treasury_yields as bf
    out = tmp_path / "treasury_yields.json"
    out.write_text(_json.dumps({"history": _sessions(10)}), encoding="utf-8")
    monkeypatch.setattr(bf, "OUT", out)
    monkeypatch.setattr(bf, "_fetch_year", lambda y: [])
    monkeypatch.setattr(sys, "argv", ["x", "--years", "10"])
    assert bf.main() == 3
