"""export_freight — the twelve-lane index block and the route history.

Two regressions these lock down:

  * history_by_date used to be hardcoded to FBX11 and FBX01, so vn-ham, co-eu
    and br-us appeared in the route table but never in the history chart.
  * only the three indices ROUTE_CONFIG referenced were published, so the nine
    other FBX lanes the scraper now captures accumulated in the database and
    were visible nowhere.
"""
import json
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from models import FreightRate
from scraper.exporters import macro
from scraper.exporters.macro import ROUTE_CONFIG, export_freight


@pytest.fixture
def out_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(macro, "OUT_DIR", tmp_path)
    return tmp_path


def _seed(db, code: str, base: float) -> None:
    """Two prints a week apart — today and exactly seven days back."""
    today = date.today()
    db.add(FreightRate(index_code=code, date=today - timedelta(days=7), rate=base))
    db.add(FreightRate(index_code=code, date=today, rate=base * 1.10))
    db.commit()


def _read(out_dir) -> dict:
    return json.loads((out_dir / "freight.json").read_text(encoding="utf-8"))


def test_publishes_every_stored_index(db, out_dir):
    """A lane with no route attached still reaches freight.json."""
    _seed(db, "FBX11", 4000.0)
    _seed(db, "FBX21", 1500.0)   # NA East Coast -> North Europe: no route uses it
    export_freight(db)

    codes = {i["code"] for i in _read(out_dir)["indices"]}
    assert "FBX21" in codes, "an index with no route must still be published"
    assert "FBX11" in codes


def test_index_entry_carries_name_prev_and_history(db, out_dir):
    _seed(db, "FBX11", 4000.0)   # validate_freight rejects a payload with no routes
    _seed(db, "FBX13", 2000.0)
    export_freight(db)

    entry = next(i for i in _read(out_dir)["indices"] if i["code"] == "FBX13")
    assert entry["name"] == "China → Mediterranean"
    assert entry["rate"] == 2200          # 2000 * 1.10
    assert entry["prev"] == 2000
    assert entry["prev_date"] == (date.today() - timedelta(days=7)).isoformat()
    assert len(entry["history"]) == 2


def test_prev_includes_the_exactly_seven_day_old_print(db, out_dir):
    """`<=`, not `<` — the strict form skipped the ideal comparison point."""
    _seed(db, "FBX11", 4000.0)
    export_freight(db)

    route = next(r for r in _read(out_dir)["routes"] if r["id"] == "vn-eu")
    assert route["prev"] == 4000
    assert route["prev_date"] == (date.today() - timedelta(days=7)).isoformat()


def test_history_covers_every_route_not_just_two_indices(db, out_dir):
    for code in {cfg[3] for cfg in ROUTE_CONFIG}:
        _seed(db, code, 4000.0)
    export_freight(db)

    rows = _read(out_dir)["history"]
    assert rows
    today = date.today().isoformat()
    latest = next(r for r in rows if r["date"] == today)
    for route_id, *_ in ROUTE_CONFIG:
        assert route_id in latest, f"{route_id} missing from the history series"


def test_history_is_not_truncated_to_a_rolling_84_days(db, out_dir):
    """FBX history only exists because we accumulate it — see probes 0.28/0.29.

    Nothing anonymous serves the back series, so an export that dropped
    everything older than twelve weeks was discarding the only copy that will
    ever exist.
    """
    today = date.today()
    for i in (400, 200, 90, 30, 0):     # one row well outside the old window
        db.add(FreightRate(index_code="FBX11", date=today - timedelta(days=i),
                           rate=4000.0 + i))
    db.commit()
    export_freight(db)

    dates = [r["date"] for r in _read(out_dir)["history"]]
    assert (today - timedelta(days=400)).isoformat() in dates
    assert len(dates) == 5


def test_history_is_still_bounded(db, out_dir):
    """The five-year cap is a size guard; rows beyond it are dropped."""
    today = date.today()
    db.add(FreightRate(index_code="FBX11", date=today, rate=4000.0))
    db.add(FreightRate(index_code="FBX11", date=today - timedelta(days=365 * 6), rate=1.0))
    db.commit()
    export_freight(db)

    dates = [r["date"] for r in _read(out_dir)["history"]]
    assert dates == [today.isoformat()]


def test_empty_database_writes_an_empty_indices_list(db, out_dir):
    export_freight(db)
    # safe_write_json rejects an empty routes list, so nothing lands on disk —
    # the point is only that building the payload does not raise.
    assert not (out_dir / "freight.json").exists()
