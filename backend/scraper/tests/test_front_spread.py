"""The spread/stocks study's arithmetic.

Three things here can be quietly wrong and would each produce a chart that
looks fine: picking the wrong contract as "front", getting the spread's sign
backwards, and letting a pooled correlation stand for a relationship that only
held in the first half of the sample.
"""
import json

from scraper.exporters import front_spread as F


class TestExpiry:
    def test_decodes_month_codes(self):
        assert F.expiry("KCH27") == (2027, 3)
        assert F.expiry("RCX26") == (2026, 11)
        assert F.expiry("KCF25") == (2025, 1)
        assert F.expiry("KCZ26") == (2026, 12)

    def test_rejects_non_contract_symbols(self):
        for s in ("KC", "KCA26", "", None, "KCH2", "KCH275"):
            assert F.expiry(s) is None

    def test_orders_across_the_year_boundary(self):
        # Dec-26 must sort BEFORE Jan-27. A naive sort on the month letter
        # would put F(1) first and silently make the front contract wrong.
        assert F.expiry("KCZ26") < F.expiry("RCF27")


class TestFrontSpread:
    def test_front_minus_deferred_so_backwardation_is_positive(self):
        board = {"KCU26": {"price": 371.4}, "KCZ26": {"price": 335.5}}
        out = F.front_spread(board)
        assert out["front"] == "KCU26" and out["second"] == "KCZ26"
        assert out["spread"] == 35.9        # front over deferred = backwardation

    def test_contango_reads_negative(self):
        out = F.front_spread({"RCU26": {"price": 3200.0}, "RCX26": {"price": 3238.0}})
        assert out["spread"] == -38.0

    def test_picks_the_two_NEAREST_regardless_of_dict_order(self):
        # Boards arrive in whatever order the source serialised them.
        board = {
            "KCH27": {"price": 321.25},
            "KCZ26": {"price": 335.5},
            "KCU26": {"price": 371.4},
        }
        out = F.front_spread(board)
        assert (out["front"], out["second"]) == ("KCU26", "KCZ26")

    def test_skips_contracts_with_no_usable_price(self):
        board = {"KCU26": {"price": None}, "KCZ26": {"price": 335.5},
                 "KCH27": {"price": 321.25}, "KCK27": {"price": 0}}
        out = F.front_spread(board)
        assert (out["front"], out["second"]) == ("KCZ26", "KCH27")

    def test_needs_two_contracts(self):
        assert F.front_spread({"KCU26": {"price": 371.4}}) is None
        assert F.front_spread({}) is None
        assert F.front_spread(None) is None


class TestMonthlyMean:
    def test_averages_the_month_rather_than_taking_month_end(self):
        # Month-end sits in the front contract's thin final days; one bad print
        # there would move a point meant to describe the whole month.
        daily = {
            "2026-06-01": {"spread": 10.0}, "2026-06-15": {"spread": 20.0},
            "2026-06-30": {"spread": 300.0},
            "2026-07-01": {"spread": 5.0},
        }
        out = F.monthly_mean_spread(daily)
        assert out["2026-06"] == 110.0
        assert out["2026-07"] == 5.0


class TestMonthEndStocks:
    def test_takes_the_LAST_reading_in_each_month(self):
        snaps = [{"date": "2026-06-02", "total_bags": 100_000},
                 {"date": "2026-06-28", "total_bags": 250_000},
                 {"date": "2026-06-10", "total_bags": 900_000}]
        assert F.month_end_stocks(snaps, "total_bags", 1.0) == {"2026-06": 250.0}

    def test_converts_robusta_lots_to_thousand_bags(self):
        # 6,000 lots x 10 t = 60,000 t = 1,000,000 bags = 1,000k bags.
        out = F.month_end_stocks(
            [{"date": "2026-06-30", "total_lots_certified": 6000}],
            "total_lots_certified", F.LOTS_TO_BAGS)
        assert out["2026-06"] == 1000.0

    def test_ignores_zero_and_malformed_rows(self):
        snaps = [{"date": "2026-06-30", "total_bags": 0},
                 {"date": None, "total_bags": 5},
                 {"date": "2026-06-15", "total_bags": "120000"}]
        assert F.month_end_stocks(snaps, "total_bags", 1.0) == {}


def _pts(pairs):
    return [{"month": m, "stocks_k_bags": s, "spread": sp} for m, s, sp in pairs]


class TestAnalyse:
    def test_flags_a_relationship_that_holds_throughout(self):
        # Monotone decreasing spread as stocks rise, across the whole sample.
        pts = _pts([(f"2021-{i:02d}" if i <= 12 else f"2022-{i-12:02d}", i * 100, 50 - i)
                    for i in range(1, 25)])
        a = F.analyse(pts)
        assert a["spearman"] < -0.9
        assert a["holds_in_both_halves"] is True

    def test_refuses_a_pooled_number_when_the_sign_FLIPS_in_the_second_half(self):
        # This is the robusta case: strongly negative early, positive late.
        # Pooling would report a usable-looking correlation for a relationship
        # that stopped.
        early = [(f"2021-{i:02d}", i * 100, 50 - i * 4) for i in range(1, 13)]
        late = [(f"2022-{i:02d}", i * 100, i * 4) for i in range(1, 13)]
        a = F.analyse(_pts(early + late))
        assert a["first_half"]["spearman"] < -0.9
        assert a["second_half"]["spearman"] > 0.9
        assert a["holds_in_both_halves"] is False

    def test_reports_the_span_of_each_half(self):
        pts = _pts([(f"2021-{i:02d}", i * 100, 50 - i) for i in range(1, 13)])
        a = F.analyse(pts)
        assert a["first_half"]["span"] == ["2021-01", "2021-06"]
        assert a["second_half"]["span"] == ["2021-07", "2021-12"]

    def test_declines_to_correlate_a_tiny_sample(self):
        assert F.spearman([1, 2, 3], [3, 2, 1]) is None


class TestExportedPayload:
    """Guards on the file the frontend actually reads."""

    def test_payload_is_well_formed_and_states_its_sign_convention(self, tmp_path, monkeypatch):
        monkeypatch.setattr(F, "OUT_DIR", tmp_path)
        archive = tmp_path / "archive.json"
        archive.write_text(json.dumps({
            "arabica": {"2026-06-01": {"KCU26": {"price": 371.4}, "KCZ26": {"price": 335.5}}},
            "robusta": {"2026-06-01": {"RCU26": {"price": 3200.0}, "RCX26": {"price": 3238.0}}},
        }), encoding="utf-8")
        monkeypatch.setattr(F, "ARCHIVE", archive)
        F.export_front_spread()
        out = json.loads((tmp_path / "front_spread.json").read_text(encoding="utf-8"))
        # The sign convention is the opposite of cot.structure_*; a reader who
        # assumes otherwise inverts the whole chart, so it must be declared.
        assert "front minus deferred" in out["sign_convention"]
        assert out["markets"]["arabica"]["latest"]["spread"] == 35.9
        assert out["markets"]["robusta"]["latest"]["spread"] == -38.0
        # No stocks files in tmp_path, so no paired points — must not crash.
        assert out["markets"]["arabica"]["points"] == []
