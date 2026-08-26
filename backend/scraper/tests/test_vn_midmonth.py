"""The mid-month study's pure parts, tested without a network.

The fetch needs files.customs.gov.vn. Everything that decides WHAT the study
concludes — the URL prediction and the verdict logic — does not, and those are
the parts that can be quietly wrong.
"""
import json

import pytest
from backend.scraper import research_vn_midmonth as R


class TestShift:
    def test_wraps_forward_and_back(self):
        assert R.shift(2026, 12, 1) == (2027, 1)
        assert R.shift(2026, 1, -1) == (2025, 12)
        assert R.shift(2026, 6, 0) == (2026, 6)

    def test_walks_a_full_year_back_and_returns(self):
        y, m = 2026, 3
        for _ in range(12):
            y, m = R.shift(y, m, -1)
        assert (y, m) == (2025, 3)


class TestMonthsBack:
    def test_starts_at_the_previous_month_not_the_current_one(self):
        # The running month has no full-month bulletin yet; including it would
        # pair a partial k1 against a missing full month.
        out = R.months_back(3, 2026, 8)
        assert out == [(2026, 7), (2026, 6), (2026, 5)]

    def test_crosses_the_year_boundary(self):
        assert R.months_back(3, 2026, 2) == [(2026, 1), (2025, 12), (2025, 11)]


class TestK1Urls:
    def test_every_url_carries_the_k1_marker_and_the_export_type(self):
        urls = R.k1_candidate_urls(2026, 6)
        assert urls, "predictor produced nothing"
        for u in urls:
            assert "k1-2x" in u, u          # k1 = through the 15th; 2x = exports
            assert "k2" not in u

    def test_names_the_data_month_not_the_publication_month(self):
        for u in R.k1_candidate_urls(2026, 6):
            stem = u.rsplit("/", 1)[1]
            assert stem.startswith("2026-t6k1") or stem.startswith("2026-T6k1") \
                or stem.startswith("2026-t06k1") or stem.startswith("2026-T06k1"), stem

    def test_searches_both_the_data_month_and_the_next(self):
        # k1 for June can publish late in June or early in July.
        urls = R.k1_candidate_urls(2026, 6)
        assert any("/2026/6/" in u for u in urls)
        assert any("/2026/7/" in u for u in urls)

    def test_december_k1_can_publish_in_january(self):
        urls = R.k1_candidate_urls(2026, 12)
        assert any("/2027/1/" in u for u in urls)

    def test_no_duplicates(self):
        urls = R.k1_candidate_urls(2026, 6)
        assert len(urls) == len(set(urls))


def _pairs(ratios):
    return [{"month": f"2026-{i+1:02d}", "ratio": r} for i, r in enumerate(ratios)]


class TestRatioStats:
    def test_refuses_to_conclude_from_two_months(self):
        s = R.ratio_stats(_pairs([0.5, 0.5]))
        assert s["n"] == 2
        assert "insufficient" in s["verdict"]

    def test_tight_cluster_at_half_endorses_doubling(self):
        s = R.ratio_stats(_pairs([0.49, 0.50, 0.51, 0.50, 0.49, 0.51]))
        assert s["verdict"] == "doubling is reliable"
        assert s["within_tolerance_pct"] == 100.0
        assert s["half_inside_observed_range"] is True

    def test_wide_spread_is_rejected_even_when_the_MEAN_is_exactly_half(self):
        # The failure this guards: mean 0.50 from 0.30/0.70 looks perfect in a
        # headline and is useless in a trade. Dispersion must override the mean.
        s = R.ratio_stats(_pairs([0.30, 0.70, 0.32, 0.68, 0.31, 0.69]))
        assert abs(s["mean"] - 0.50) < 0.01
        assert s["verdict"].startswith("doubling is NOT reliable")

    def test_consistent_bias_away_from_half_is_also_rejected(self):
        # A stable 0.40 is a real finding — but doubling still misses by 20%,
        # so the verdict must not endorse doubling just because sd is low.
        s = R.ratio_stats(_pairs([0.40, 0.41, 0.39, 0.40, 0.41, 0.40]))
        assert s["stdev"] < 0.05
        assert s["within_tolerance"] == 0
        assert s["verdict"].startswith("doubling is NOT reliable")
        assert s["half_inside_observed_range"] is False

    def test_reports_spread_and_counts_honestly(self):
        s = R.ratio_stats(_pairs([0.45, 0.55, 0.50, 0.52, 0.48]))
        assert s["n"] == 5
        assert s["min"] == 0.45 and s["max"] == 0.55
        assert s["spread"] == pytest.approx(0.10, abs=1e-9)

    def test_ignores_rows_with_no_ratio(self):
        rows = _pairs([0.5, 0.5, 0.5]) + [{"month": "2026-04", "ratio": None}]
        assert R.ratio_stats(rows)["n"] == 3


class TestFullMonthSeries:
    def test_missing_cache_returns_empty_rather_than_raising(self, monkeypatch, tmp_path):
        monkeypatch.setattr(R, "_CACHE_PATH", tmp_path / "nope.json")
        assert R.full_month_series() == {}

    def test_skips_zero_and_malformed_rows(self, monkeypatch, tmp_path):
        p = tmp_path / "c.json"
        p.write_text(json.dumps({"monthly": [
            {"month": "2026-01", "tonnes": 100.0},
            {"month": "2026-02", "tonnes": 0},        # zero would divide badly
            {"month": None, "tonnes": 50.0},
            {"month": "2026-04", "tonnes": "170"},    # string, not a number
        ]}), encoding="utf-8")
        monkeypatch.setattr(R, "_CACHE_PATH", p)
        assert R.full_month_series() == {"2026-01": 100.0}

    def test_corrupt_json_returns_empty(self, monkeypatch, tmp_path):
        p = tmp_path / "c.json"
        p.write_text("{not json", encoding="utf-8")
        monkeypatch.setattr(R, "_CACHE_PATH", p)
        assert R.full_month_series() == {}


class TestMainGuards:
    def test_exits_nonzero_when_there_is_no_full_month_cache(self, monkeypatch):
        monkeypatch.setattr(R, "full_month_series", lambda: {})
        assert R.main(6, 2026, 8) == 1


class TestReachabilityGuard:
    def test_aborts_before_fanning_out_when_the_host_is_unreachable(self, monkeypatch):
        # Without this guard a blocked host costs hundreds of 30s timeouts per
        # month and still concludes nothing. Fail in seconds, and say why.
        calls = []
        monkeypatch.setattr(R, "full_month_series", lambda: {"2026-07": 100.0})
        monkeypatch.setattr(R, "host_reachable", lambda: False)
        monkeypatch.setattr(R, "fetch_k1", lambda y, m: calls.append((y, m)))
        assert R.main(6, 2026, 8) == 2
        assert calls == [], "fanned out despite an unreachable host"
