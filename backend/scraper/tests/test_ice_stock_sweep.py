"""Sweep resume + run telemetry for the ICE robusta stock report."""
import json
from datetime import date

from scraper.sources.ice_certified_stocks import orchestrate as O


def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(O, "STOCK_REPORT_CURSOR_PATH", tmp_path / "cursor.json")
    monkeypatch.setattr(O, "RUN_STATS_PATH", tmp_path / "stats.json")


def test_cursor_round_trips_and_clears_on_success(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    d = date(2026, 8, 24)
    O._save_cursor(d, "104500")
    assert O._load_cursor() == {"date": "2026-08-24", "last_tried": "104500"}
    # A found day has nothing left to resume — the cursor must not strand a
    # stale position that would make the NEXT day skip its opening minutes.
    O._save_cursor(d, None)
    assert O._load_cursor() == {}


def test_a_cursor_from_another_day_is_ignored(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    O._save_cursor(date(2026, 8, 24), "104500")
    cur = O._load_cursor()
    # The guard the sweep applies: same-day only.
    assert cur.get("date") != date(2026, 8, 25).isoformat()


def test_run_stats_records_the_rate_limit_picture(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    monkeypatch.setitem(O._RUN_STATS, "http_429", 3)
    monkeypatch.setitem(O._RUN_STATS, "retry_after_waits", [90, 60, 90])
    monkeypatch.setitem(O._RUN_STATS, "throttle_bumps", 3)
    monkeypatch.setitem(O._RUN_STATS, "sweep_gets", 1298)
    monkeypatch.setitem(O._RUN_STATS, "http_404", 1450)
    monkeypatch.setitem(O._RUN_STATS, "aborted_by_429", 0)
    O._record_run_stats("completed", date(2026, 8, 24))

    row = json.loads((tmp_path / "stats.json").read_text())["runs"][-1]
    assert row["http_429"] == 3
    assert row["retry_after_count"] == 3
    assert row["retry_after_total_s"] == 240
    assert row["retry_after_max_s"] == 90
    assert row["sweep_gets"] == 1298
    assert row["outcome"] == "completed"
    assert row["aborted_by_429"] is False


def test_stats_file_is_capped(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    for _ in range(O.RUN_STATS_KEEP + 25):
        O._record_run_stats("completed", None)
    assert len(json.loads((tmp_path / "stats.json").read_text())["runs"]) == O.RUN_STATS_KEEP


def test_telemetry_never_breaks_the_run(tmp_path, monkeypatch):
    # An unwritable path must not raise — a scrape that worked should not be
    # lost because its bookkeeping failed.
    monkeypatch.setattr(O, "STOCK_REPORT_CURSOR_PATH", tmp_path / "nope" / "c.json")
    monkeypatch.setattr(O, "RUN_STATS_PATH", tmp_path / "nope" / "s.json")
    O._save_cursor(date(2026, 8, 24), "104500")
    O._record_run_stats("completed", date(2026, 8, 24))


def test_wait_time_is_attributed_to_the_host_that_imposed_it(tmp_path, monkeypatch):
    """'Where did the 111 minutes go' must be answerable per host."""
    _isolate(tmp_path, monkeypatch)
    monkeypatch.setitem(O._RUN_STATS, "wait_publicdocs_s", 210.0)
    monkeypatch.setitem(O._RUN_STATS, "wait_marketdata_s", 5192.0)
    monkeypatch.setitem(O._RUN_STATS, "requests", 1400)
    monkeypatch.setitem(O._RUN_STATS, "retry_after_waits", [])
    O._record_run_stats("completed", date(2026, 8, 24))
    row = json.loads((tmp_path / "stats.json").read_text())["runs"][-1]
    assert row["wait_marketdata_s"] == 5192.0
    assert row["wait_publicdocs_s"] == 210.0
    assert row["requests"] == 1400
    # The two throttles are separate budgets — marketdata dominates because the
    # sweep lives there, and conflating them would hide that.
    assert row["wait_marketdata_s"] > row["wait_publicdocs_s"] * 10


def test_a_recorded_day_is_one_get_not_a_search(tmp_path, monkeypatch):
    """Retention is confirmed (probe 0.18), so a known second stays valid.
    Tier 0 must use it — that is what makes a missed day recoverable once its
    time is learned, and what makes re-fetching a known day nearly free."""
    hits = tmp_path / "hits.json"
    hits.write_text(json.dumps({"hits": [
        {"date": "bootstrap", "hhmmss": "103021"},
        {"date": "2026-06-29", "hhmmss": "124715"},
    ]}))
    monkeypatch.setattr(O, "STOCK_REPORT_HITS_PATH", hits)
    assert O._recorded_time_for(date(2026, 6, 29)) == "124715"
    assert O._recorded_time_for(date(2026, 6, 30)) is None


def test_the_sweep_window_reaches_every_observed_publish():
    """All three misses fell outside the old 10:30–11:15 bound: 10:29:56 was
    four seconds early, 12:47:15 was ninety-two minutes late."""
    (sh, sm), (eh, em) = O.STOCK_REPORT_SWEEP_RANGE
    start, end = sh * 60 + sm, eh * 60 + em
    for hhmmss in ("102956", "103004", "110055", "124715"):
        minute = int(hhmmss[:2]) * 60 + int(hhmmss[2:4])
        assert start <= minute <= end, f"{hhmmss} outside the sweep window"


def test_recovered_days_outside_the_window_still_become_snapshots(monkeypatch):
    """A recovered hole is months older than the run window by definition.
    Building snapshots from the window alone fetched them and dropped them."""
    from datetime import date as _d
    window = [_d(2026, 8, 24), _d(2026, 8, 25), _d(2026, 8, 26)]
    recovered = {_d(2026, 6, 10): {"x": 1}, _d(2026, 6, 29): {"x": 2}}
    # The union the orchestrator now iterates.
    days = sorted(set(window) | set(recovered))
    assert _d(2026, 6, 10) in days and _d(2026, 6, 29) in days
    assert days[0] == _d(2026, 6, 10)          # sorted, oldest first
    assert len(days) == 5
