"""Anchor-selection tests for the intraday FX snapshot fetcher.

The fetcher's correctness rests on two deterministic rules, tested here
offline (the Barchart fetch itself reuses the KC/RC mechanism proven in CI):

  * 17:30-London anchor = close of the bar starting 17:15 Europe/London —
    correct across DST including the US/UK mismatch weeks.
  * 03:00-UTC anchor = close of the LATEST bar starting ≤ 02:45 UTC that day —
    unaffected by how late the cron actually fires (later bars never shift it).
"""
import asyncio
import json
import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from scraper import fetch_fx_snapshots as fx
from scraper.fetch_fx_snapshots import _agrees, _anchors, _pair_days, _parse_bars

_CHICAGO = ZoneInfo("America/Chicago")


def _csv_line(utc_dt: datetime, close: float) -> str:
    ct = utc_dt.astimezone(_CHICAGO)
    return f"{ct.strftime('%Y-%m-%d %H:%M')},{ct.day},{close},{close},{close},{close},0"


def test_london_1730_anchor_across_dst():
    # 17:15 London starts: summer (BST, UTC+1) → 16:15Z; winter (GMT) → 17:15Z;
    # US/UK mismatch week (UK switched Oct 26 2025, US not until Nov 2) → 17:15Z.
    cases = [
        (datetime(2025, 7, 16, 16, 15, tzinfo=UTC), "2025-07-16"),
        (datetime(2025, 1, 15, 17, 15, tzinfo=UTC), "2025-01-15"),
        (datetime(2025, 10, 29, 17, 15, tzinfo=UTC), "2025-10-29"),
    ]
    csv = "\n".join(_csv_line(dt, 5.0 + i) for i, (dt, _) in enumerate(cases))
    l1730, _ = _anchors(_parse_bars(csv))
    for i, (_, ldn_date) in enumerate(cases):
        assert l1730[ldn_date] == 5.0 + i


def test_utc_0300_anchor_is_deterministic_under_cron_drift():
    d = datetime(2025, 7, 17, tzinfo=UTC)
    bars = [
        (d.replace(hour=2, minute=30), 1.10),
        (d.replace(hour=2, minute=45), 1.11),   # ← the 03:00 price
        (d.replace(hour=3, minute=0),  1.12),   # exists when cron ran late
        (d.replace(hour=3, minute=15), 1.13),
    ]
    csv = "\n".join(_csv_line(dt, c) for dt, c in bars)
    _, u0300 = _anchors(_parse_bars(csv))
    assert u0300["2025-07-17"] == 1.11          # later bars never shift the anchor
    # Without the late bars the result is identical:
    csv_early = "\n".join(_csv_line(dt, c) for dt, c in bars[:2])
    _, u_early = _anchors(_parse_bars(csv_early))
    assert u_early["2025-07-17"] == 1.11


def test_pair_days_monday_uses_friday_close():
    l1730 = {"2025-07-10": 5.0, "2025-07-11": 5.1}          # Thu, Fri
    u0300 = {"2025-07-11": 5.05, "2025-07-14": 5.2}          # Fri, Mon
    days = _pair_days(l1730, u0300)
    assert days["2025-07-11"]["prev_1730"] == 5.0            # Fri ← Thu 17:30
    assert days["2025-07-14"]["prev_1730"] == 5.1            # Mon ← Fri 17:30
    assert days["2025-07-14"]["at_0300"] == 5.2
    assert days["2025-07-14"]["prev_date"] == "2025-07-11"   # anchor is auditable


def test_a_stale_prior_anchor_is_not_an_overnight_move():
    """Thin pairs quote sporadically — ^USDPEN's 15-min tape is sparse enough
    that a deep pull reaches 2022. Pairing a session with whatever 17:30 print
    happened to exist a fortnight earlier is not an overnight move, and once a
    backfill makes those days clear the model's 6-pair majority it would be
    silently wrong rather than merely absent. Bound it."""
    l1730 = {"2025-06-20": 3.5, "2025-07-11": 3.9}
    u0300 = {"2025-07-11": 3.91, "2025-07-14": 3.92}
    days = _pair_days(l1730, u0300)
    assert "2025-07-14" in days                        # 3 days back — Fri→Mon
    assert "2025-07-11" not in days                    # 21 days back — dropped
    # the bound is a knob, not a hard-coded 4
    assert "2025-07-11" in _pair_days(l1730, u0300, max_gap_days=30)


# ── Backfill merge policy ────────────────────────────────────────────────────

def _synthetic_bars(days: int, rate: float,
                    start=datetime(2026, 1, 5, tzinfo=UTC)):   # a Monday
    """`days` consecutive weekdays of 15-min bars covering both anchor times."""
    out = []
    for i in range(days):
        day = start + timedelta(days=i)
        if day.weekday() >= 5:
            continue
        for hh, mm in ((2, 30), (2, 45), (3, 0), (17, 15)):
            out.append((day.replace(hour=hh, minute=mm),
                        rate + i * 0.01 + mm / 10000))
    return out


def _csv_of(bars) -> str:
    return "\n".join(_csv_line(dt, c) for dt, c in bars)


def _synthetic_csv(days: int, rate: float) -> str:
    return _csv_of(_synthetic_bars(days, rate))


def _stub_fetch(payload):
    """A source that IGNORES any cut-off parameter — i.e. refuses to page."""
    async def _fake(symbols, maxrecords, chunk=0, extra_qs=None):
        return {s: payload.get(s, "") for s in symbols}
    return _fake


def _stub_paged(history, cap):
    """A source that honours `&end=YYYYmmddHHMMSS` and caps each response.

    Mirrors what Barchart actually does: a hard record ceiling per response,
    with a cut-off letting a caller walk backwards through it.
    """
    async def _fake(symbols, maxrecords, chunk=0, extra_qs=None):
        out = {}
        for s in symbols:
            bars = history.get(s, [])
            m = re.search(r"&end=(\d{14})", (extra_qs or {}).get(s, ""))
            if m:
                # the module formats the cut-off in Chicago wall time (that is
                # how queryminutes stamps its rows), so parse it back the same
                cut = datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(
                    tzinfo=_CHICAGO)
                bars = [b for b in bars if b[0] < cut]
            out[s] = _csv_of(bars[-min(maxrecords, cap):])
        return out
    return _fake


def test_backfill_fills_gaps_and_never_overwrites_the_live_record(tmp_path, monkeypatch, capsys):
    """The forward capture IS the record. A deep pull may only fill holes.

    Anything it re-derives for a date we already hold is evidence, not a
    replacement: if the two ever disagreed, silently taking the newer number
    would erase the only copy of what we actually observed at 03:00.
    """
    out = tmp_path / "fx_intraday_snapshots.json"
    monkeypatch.setattr(fx, "OUT_PATH", out)
    # backfill also writes the source-reach report — keep synthetic bar counts
    # out of the committed one (the same trap the open-direction tests hit).
    monkeypatch.setattr(fx, "REPORT_PATH", tmp_path / "reach.json")
    monkeypatch.setattr(fx, "_BARCHART_FX", {"BRL=X": "^USDBRL", "JPY=X": "^USDJPY"})
    monkeypatch.setattr(fx, "_fetch_barchart_15m",
                        _stub_fetch({"^USDBRL": _synthetic_csv(10, 5.0),
                                     "^USDJPY": _synthetic_csv(10, 150.0)}))

    # a live capture already holds one date for BRL, with a DIFFERENT value
    out.write_text(json.dumps({"days": [
        {"date": "2026-01-07", "pairs": {"BRL=X": {"prev_1730": 1.0, "at_0300": 2.0}}},
    ]}), encoding="utf-8")

    fx.run(maxrecords=500, backfill=True)
    saved = {r["date"]: r["pairs"] for r in json.loads(out.read_text())["days"]}

    # the live value survives verbatim…
    assert saved["2026-01-07"]["BRL=X"] == {"prev_1730": 1.0, "at_0300": 2.0}
    # …the disagreement is reported, not swallowed…
    log = capsys.readouterr().out
    assert "MISMATCH 2026-01-07 BRL=X" in log
    # …and every hole is filled, including the other pair on that same date
    assert "JPY=X" in saved["2026-01-07"]
    assert len(saved) > 1 and all("BRL=X" in p for p in saved.values())

    # the source-reach report records what Barchart was willing to serve —
    # this is the output that tells us whether a deeper ask would help at all
    reach = json.loads((tmp_path / "reach.json").read_text())
    assert reach["maxrecords_requested"] == 500
    assert reach["merge"]["mismatched_on_overlap"] == 1
    assert reach["pairs"]["BRL=X"]["bars"] > 0
    assert reach["pairs"]["BRL=X"]["first_day"] <= reach["pairs"]["BRL=X"]["last_day"]


def test_daily_mode_still_lets_the_newest_fetch_win(tmp_path, monkeypatch):
    """Unchanged behaviour for the 03:00 append: re-reading today should pick
    up the later bar, so the daily path must keep overwriting."""
    out = tmp_path / "fx_intraday_snapshots.json"
    monkeypatch.setattr(fx, "OUT_PATH", out)
    monkeypatch.setattr(fx, "_BARCHART_FX", {"BRL=X": "^USDBRL"})
    monkeypatch.setattr(fx, "_fetch_barchart_15m",
                        _stub_fetch({"^USDBRL": _synthetic_csv(10, 5.0)}))
    monkeypatch.setattr(fx, "_update_brent_anchors", lambda bars: 0)
    out.write_text(json.dumps({"days": [
        {"date": "2026-01-07", "pairs": {"BRL=X": {"prev_1730": 1.0, "at_0300": 2.0}}},
    ]}), encoding="utf-8")

    fx.run(maxrecords=500)
    saved = {r["date"]: r["pairs"] for r in json.loads(out.read_text())["days"]}
    assert saved["2026-01-07"]["BRL=X"]["prev_1730"] != 1.0


def test_agrees_tolerates_float_noise_only():
    base = {"prev_1730": 5.4321, "at_0300": 5.4400}
    assert _agrees(base, dict(base))
    assert _agrees(base, {"prev_1730": 5.4321000001, "at_0300": 5.4400000002})
    assert not _agrees(base, {"prev_1730": 5.4321, "at_0300": 5.4405})
    assert not _agrees(base, {"prev_1730": None, "at_0300": 5.44})


# ── Paging past the response cap ─────────────────────────────────────────────

def test_backfill_pages_past_the_response_cap(monkeypatch, capsys):
    """Measured 2026-08-20: queryminutes caps a response at 5,000 records no
    matter what maxrecords asks for — a 40,000 request returned exactly 5,000
    for all twelve pairs. At 96 bars a session that is ~52 sessions, which is
    why the first backfill added no liquid-pair days at all. Depth therefore
    has to come from walking the window backwards, not from a bigger number.
    """
    cap = 40                                   # stand-in for the 5,000 ceiling
    # 60 calendar days ≈ 43 weekdays × 4 bars = ~172 bars, so ~5 pages at this
    # cap — deliberately fewer than _MAX_PAGES, so "stopped early" is a real
    # assertion rather than an artefact of the budget running out.
    hist = {"^USDBRL": _synthetic_bars(60, 5.0)}
    monkeypatch.setattr(fx, "_fetch_barchart_15m", _stub_paged(hist, cap))

    acc, param, pages = asyncio.run(
        fx._deep_bars(["^USDBRL"], maxrecords=cap, target_sessions=400))

    assert param == "end" and pages > 1, "should have discovered a cut-off param"
    assert len(acc["^USDBRL"]) == len(hist["^USDBRL"]), "should reach the full history"
    assert acc["^USDBRL"] == sorted(acc["^USDBRL"]), "pages must merge in order"
    assert len(set(acc["^USDBRL"])) == len(acc["^USDBRL"]), "no duplicated bars"
    # …and it stops once the window stops moving, rather than burning _MAX_PAGES
    assert pages < fx._MAX_PAGES


def test_backfill_degrades_cleanly_when_the_source_refuses_to_page(monkeypatch, capsys):
    """If no cut-off parameter works, say so and return the single page — a
    measured 'this source cannot go deeper', not a silent no-op."""
    monkeypatch.setattr(fx, "_fetch_barchart_15m",
                        _stub_fetch({"^USDBRL": _synthetic_csv(30, 5.0)}))
    acc, param, pages = asyncio.run(
        fx._deep_bars(["^USDBRL"], maxrecords=5000, target_sessions=400))
    assert param is None and pages == 1
    assert acc["^USDBRL"], "the first page is still returned"
    assert "refuses a cut-off parameter" in capsys.readouterr().out


def test_deep_bars_survives_a_pair_with_no_data(monkeypatch):
    """One dead symbol must not stop the others from paging."""
    cap = 40
    hist = {"^USDBRL": _synthetic_bars(60, 5.0), "^USDVND": []}
    monkeypatch.setattr(fx, "_fetch_barchart_15m", _stub_paged(hist, cap))
    acc, param, _pages = asyncio.run(
        fx._deep_bars(["^USDVND", "^USDBRL"], maxrecords=cap, target_sessions=400))
    assert acc["^USDVND"] == []
    assert param == "end" and len(acc["^USDBRL"]) == len(hist["^USDBRL"])
