"""The population payload must survive an export that did not run the scraper.

demand_stocks.json is rebuilt by four workflows and only the annual one runs
the World Bank scraper. The payload used to live solely in a gitignored cache,
so the other three published `populations: null` and blanked the demand tab's
per-capita chart — 2026-09-02 07:29 wrote 48 countries, the next export the
following morning wrote null, and it stayed null.
"""
import json

import pytest

from scraper.sources import population


@pytest.fixture
def paths(tmp_path, monkeypatch):
    cache = tmp_path / "cache" / "population.json"
    published = tmp_path / "data" / "populations.json"
    monkeypatch.setattr(population, "_CACHE_PATH", cache)
    monkeypatch.setattr(population, "_PUBLISHED_PATH", published)
    return cache, published


PAYLOAD = {
    "source": "World Bank API (SP.POP.TOTL)",
    "last_updated": "2026-09-02",
    "countries": {"usa": {"name": "United States", "iso3": "USA",
                          "latest_year": "2024", "latest_population": 341784857}},
}


def test_published_file_is_used_when_the_cache_is_absent(paths):
    """The exact failure: a job that did not scrape still has the committed
    file at checkout, so it must not fall through to None."""
    _cache, published = paths
    published.parent.mkdir(parents=True)
    published.write_text(json.dumps(PAYLOAD), encoding="utf-8")

    got = population.fetch_latest()
    assert got is not None, "committed payload ignored — populations would publish as null"
    assert got["countries"]["usa"]["latest_population"] == 341784857


def test_cache_wins_over_the_published_file(paths):
    """Within the scraping job the fresh pull must beat the committed copy."""
    cache, published = paths
    cache.parent.mkdir(parents=True)
    published.parent.mkdir(parents=True)
    published.write_text(json.dumps(PAYLOAD), encoding="utf-8")
    fresh = json.loads(json.dumps(PAYLOAD))
    fresh["countries"]["usa"]["latest_population"] = 999
    cache.write_text(json.dumps(fresh), encoding="utf-8")

    assert population.fetch_latest()["countries"]["usa"]["latest_population"] == 999


def test_empty_or_corrupt_sources_fall_through(paths):
    """A truncated or countryless file must not satisfy the lookup — that is
    how a blank chart looked healthy before."""
    cache, published = paths
    cache.parent.mkdir(parents=True)
    published.parent.mkdir(parents=True)
    cache.write_text("{ not json", encoding="utf-8")
    published.write_text(json.dumps({"source": "x", "countries": {}}), encoding="utf-8")

    assert population.fetch_latest() is None
