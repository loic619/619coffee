"""Phase-3 signal: export_health surfaces a `warnings` entry when the price
exporters fell back to NewsItem regex parsing. Uses a real in-memory SQLite DB
(empty) so the many health queries resolve cleanly without brittle mocks."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import scraper.exporters.base as base
import scraper.exporters.health as health


def _empty_db():
    import models  # noqa: F401 — registers tables on Base
    from database import Base
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_health_flags_regex_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", True)
    health.export_health(_empty_db())
    data = json.loads((tmp_path / "health.json").read_text())
    assert data.get("warnings") == ["latest_prices_used_regex_fallback"]


def test_health_no_warning_when_clean(tmp_path, monkeypatch):
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", False)
    health.export_health(_empty_db())
    data = json.loads((tmp_path / "health.json").read_text())
    assert "warnings" not in data
    assert "scrapers" in data


def test_health_exporters_block_records_published_topics(tmp_path, monkeypatch):
    """Per-topic publish timestamps surface in health.json so a silently-
    failed exporter shows up as stale (rather than masquerading behind
    the per-scraper signal of its upstream data source)."""
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", False)
    published = {"cot": "2026-06-17T05:03:47Z", "freight": "2026-06-17T05:03:48Z"}
    health.export_health(_empty_db(), exporters_published_at=published)
    data = json.loads((tmp_path / "health.json").read_text())
    assert data["exporters"]["cot"]     == "2026-06-17T05:03:47Z"
    assert data["exporters"]["freight"] == "2026-06-17T05:03:48Z"


def test_health_exporters_merge_preserves_previous(tmp_path, monkeypatch):
    """A partial (--only) run touches a subset of topics. The exporters
    that DIDN'T run on this invocation must keep their previous timestamps
    — otherwise a 1-topic re-publish would falsely flag every other topic
    as stale on the next freshness check."""
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", False)
    # First publish — full run lays down two topics.
    health.export_health(
        _empty_db(),
        exporters_published_at={"cot": "2026-06-15T10:00:00Z", "news": "2026-06-15T10:00:01Z"},
    )
    # Second publish — only `cot` re-ran. `news` must keep its prior ts.
    health.export_health(
        _empty_db(),
        exporters_published_at={"cot": "2026-06-17T05:03:47Z"},
    )
    data = json.loads((tmp_path / "health.json").read_text())
    assert data["exporters"]["cot"]  == "2026-06-17T05:03:47Z", "cot should reflect the latest run"
    assert data["exporters"]["news"] == "2026-06-15T10:00:01Z", "news should retain its previous-run ts (merge-preserve)"


def test_health_exporters_failed_topic_keeps_last_ok(tmp_path, monkeypatch):
    """A topic that raised on this run doesn't appear in published_at —
    the orchestrator only records successes. The merge must therefore
    leave its previous (last-successful) timestamp intact, so the
    freshness check fires naturally once the gap exceeds its threshold
    rather than silently resetting the clock."""
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", False)
    health.export_health(
        _empty_db(),
        exporters_published_at={"cot": "2026-06-15T10:00:00Z"},
    )
    # cot failed on this run → orchestrator passes a map without cot
    health.export_health(_empty_db(), exporters_published_at={})
    data = json.loads((tmp_path / "health.json").read_text())
    assert data["exporters"]["cot"] == "2026-06-15T10:00:00Z"


def test_health_exporters_block_empty_when_orchestrator_passes_nothing(tmp_path, monkeypatch):
    """First-run / legacy-caller compat: called with no exporters arg →
    block is still present (so the schema stays stable for the frontend)
    but it's empty until topics start reporting."""
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", False)
    health.export_health(_empty_db())
    data = json.loads((tmp_path / "health.json").read_text())
    assert data["exporters"] == {}


def test_health_exporters_prunes_topics_that_no_longer_exist(tmp_path, monkeypatch):
    """A DELETED exporter must leave the map, not age in it forever.

    The merge above deliberately keeps a topic that didn't run this time. That
    same behaviour kept vn_coffee_imports after #815 removed the whole chain as
    verified dead code: its 2026-08-31 stamp survived every subsequent run and
    the 1.5 freshness check paged every morning about a pipeline that had been
    deliberately deleted. The check reads whatever keys this map holds and
    cannot know which still exist, so the registry has to do the telling-apart.
    """
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", False)
    health.export_health(
        _empty_db(),
        exporters_published_at={"cot": "2026-06-15T10:00:00Z",
                                "gone": "2026-06-15T10:00:01Z"},
    )
    # `gone` has since been removed from the orchestrator's registry. `cot`
    # didn't publish on this run but is still registered, so it keeps its ts.
    health.export_health(
        _empty_db(),
        exporters_published_at={},
        known_exporters={"cot", "news", "health"},
    )
    data = json.loads((tmp_path / "health.json").read_text())
    assert data["exporters"]["cot"] == "2026-06-15T10:00:00Z", \
        "a registered topic that didn't run keeps its previous ts"
    assert "gone" not in data["exporters"], \
        "an unregistered topic must be pruned, not left to age forever"


def test_health_exporters_not_pruned_without_a_registry(tmp_path, monkeypatch):
    """Callers that don't pass the registry keep the old merge behaviour.

    Pruning against an absent or empty set would wipe the whole map, which is
    strictly worse than the stale key it fixes — every topic would then read as
    missing on the next freshness check.
    """
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", False)
    health.export_health(_empty_db(), exporters_published_at={"cot": "2026-06-15T10:00:00Z"})
    health.export_health(_empty_db(), exporters_published_at={})
    data = json.loads((tmp_path / "health.json").read_text())
    assert data["exporters"]["cot"] == "2026-06-15T10:00:00Z"


def test_orchestrator_passes_its_registry_to_health():
    """The wiring, not just the mechanism: every key health prunes against has
    to come from the same registry the export loop iterates, or the fix is
    inert in production while its unit test passes."""
    from scraper.export_static_json import _exporters
    keys = {k for k, _ in _exporters(None)}
    assert "cot" in keys and "freight" in keys, "registry did not build"
    assert "vn_coffee_imports" not in keys, \
        "the removed Vietnam imports topic is back in the registry"
