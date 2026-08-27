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


class TestSpreadAsPercent:
    """The % view divides by the FRONT price, and must agree in sign."""

    def test_percent_is_the_spread_over_the_front_price(self):
        out = F.front_spread({"RCU26": {"price": 4000.0}, "RCX26": {"price": 3900.0}})
        assert out["spread"] == 100.0
        assert out["front_price"] == 4000.0
        assert out["spread_pct"] == 2.5           # 100 / 4000

    def test_contango_stays_negative_in_percent(self):
        out = F.front_spread({"RCU26": {"price": 3200.0}, "RCX26": {"price": 3238.0}})
        assert out["spread"] < 0 and out["spread_pct"] < 0
        assert out["spread_pct"] == round(100 * -38.0 / 3200.0, 4)

    def test_the_same_absolute_spread_is_a_different_percent_at_a_different_price(self):
        # This is the entire reason the % view exists. 40 $/t on a 1,500 market
        # is a curve; on a 5,600 market it is noise. The absolute figure cannot
        # tell them apart.
        cheap = F.front_spread({"RCU26": {"price": 1500.0}, "RCX26": {"price": 1460.0}})
        dear = F.front_spread({"RCU26": {"price": 5600.0}, "RCX26": {"price": 5560.0}})
        assert cheap["spread"] == dear["spread"] == 40.0
        assert cheap["spread_pct"] > 2.6 and dear["spread_pct"] < 0.8

    def test_the_denominator_is_never_zero_or_negative(self):
        # front_spread only admits prices > 0, so no board can reach the
        # division with a zero or negative front. Pin it: a bogus 0 front would
        # otherwise blow up the export for every market.
        board = {"KCU26": {"price": 0}, "KCZ26": {"price": -5},
                 "KCH27": {"price": 321.25}, "KCK27": {"price": 318.0}}
        out = F.front_spread(board)
        assert out["front"] == "KCH27" and out["front_price"] == 321.25
        assert out["spread_pct"] == round(100 * 3.25 / 321.25, 4)


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

    def test_percent_month_averages_the_daily_RATIO_not_the_ratio_of_averages(self):
        # A month where the spread is steady but the price level halves. Mean
        # of the daily percentages is (1 + 2) / 2 = 1.5%. Dividing the mean
        # spread by the mean price gives 20 / 1500 = 1.33% — a different
        # number, and the wrong one, because it lets the high-priced days
        # dominate a ratio that is meant to describe each day equally.
        daily = {
            "2026-06-01": {"spread": 20.0, "spread_pct": 1.0},   # 20 / 2000
            "2026-06-15": {"spread": 20.0, "spread_pct": 2.0},   # 20 / 1000
        }
        assert F.monthly_mean_spread(daily, "spread_pct")["2026-06"] == 1.5
        assert F.monthly_mean_spread(daily)["2026-06"] == 20.0

    def test_skips_days_missing_the_requested_field(self):
        daily = {"2026-06-01": {"spread": 10.0},                 # no pct
                 "2026-06-02": {"spread": 12.0, "spread_pct": 3.0},
                 "2026-06-03": None}
        assert F.monthly_mean_spread(daily, "spread_pct") == {"2026-06": 3.0}
        assert F.monthly_mean_spread(daily) == {"2026-06": 11.0}


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

    def test_can_run_the_same_check_on_the_percent_series(self):
        # The % view is a second series, not a redrawing of the first, so the
        # split-half check has to be available on it — a result that only
        # survives in one unit is a result about the unit.
        pts = [{"month": f"2021-{i:02d}", "stocks_k_bags": i * 100,
                "spread": 50 - i, "spread_pct": i - 50}
               for i in range(1, 13)]
        assert F.analyse(pts, "spread")["spearman"] < -0.9
        assert F.analyse(pts, "spread_pct")["spearman"] > 0.9


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
        # The % axis is driven off `latest`/`points`, so the front price and the
        # percentage have to reach the file — they cannot be derived from a
        # spread alone, which is why this is exported rather than computed in
        # the browser.
        ara = out["markets"]["arabica"]["latest"]
        assert ara["front_price"] == 371.4
        assert ara["spread_pct"] == round(100 * 35.9 / 371.4, 4)
        assert out["markets"]["robusta"]["latest"]["spread_pct"] < 0
        # No stocks files in tmp_path, so no paired points — must not crash.
        assert out["markets"]["arabica"]["points"] == []


class TestCurveStructureOverwrite:
    """cot.json's structure_* is recomputed from the archive, not imported."""

    def _rows(self):
        return [
            {"date": "2026-06-02",
             "ny": {"structure_ny": 0.0042}, "ldn": {"structure_ldn": 0.0131}},
            {"date": "2026-06-03", "ny": {"structure_ny": 0.0042}, "ldn": None},
        ]

    def _archive(self):
        return {
            "arabica": {"2026-06-02": {"KCU26": {"price": 371.4}, "KCZ26": {"price": 335.5}}},
            "robusta": {"2026-06-02": {"RCU26": {"price": 3200.0}, "RCX26": {"price": 3238.0}}},
        }

    def _run(self, tmp_path, monkeypatch, rows, archive):
        p = tmp_path / "a.json"
        p.write_text(json.dumps(archive), encoding="utf-8")
        monkeypatch.setattr(F, "ARCHIVE", p)
        F.overwrite_curve_structure(rows)
        return rows

    def test_replaces_the_imported_value_and_flips_to_deferred_minus_front(
            self, tmp_path, monkeypatch):
        rows = self._run(tmp_path, monkeypatch, self._rows(), self._archive())
        # front_spread gives front-minus-deferred (+35.9); this field is the
        # negation, because the signal engine reads negative as backwardation.
        assert rows[0]["ny"]["structure_ny"] == -35.9
        assert rows[0]["ldn"]["structure_ldn"] == 38.0

    def test_nulls_weeks_the_archive_does_not_cover(self, tmp_path, monkeypatch):
        # Better a missing curve signal than one computed on the old scale.
        rows = self._run(tmp_path, monkeypatch,
                         [{"date": "2019-01-08", "ny": {"structure_ny": 0.0042}, "ldn": None}],
                         self._archive())
        assert rows[0]["ny"]["structure_ny"] is None

    def test_walks_back_to_the_last_board_over_a_holiday(self, tmp_path, monkeypatch):
        # COT dates are Tuesdays; a miss means a market holiday.
        rows = self._run(tmp_path, monkeypatch,
                         [{"date": "2026-06-04", "ny": {"structure_ny": 9.9}, "ldn": None}],
                         self._archive())
        assert rows[0]["ny"]["structure_ny"] == -35.9

    def test_does_not_walk_back_indefinitely(self, tmp_path, monkeypatch):
        rows = self._run(tmp_path, monkeypatch,
                         [{"date": "2026-06-30", "ny": {"structure_ny": 9.9}, "ldn": None}],
                         self._archive())
        assert rows[0]["ny"]["structure_ny"] is None

    def test_tolerates_a_missing_market_block(self, tmp_path, monkeypatch):
        rows = self._run(tmp_path, monkeypatch, self._rows(), self._archive())
        assert rows[1]["ldn"] is None          # no crash on a null side

    def test_leaves_values_alone_when_the_archive_is_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(F, "ARCHIVE", tmp_path / "nope.json")
        rows = self._rows()
        F.overwrite_curve_structure(rows)
        assert rows[0]["ny"]["structure_ny"] == 0.0042    # untouched, not nulled


class TestContractPriceBackfill:
    """The 10-year deepening of the per-contract archive."""

    def test_enumerates_only_months_that_trade_on_each_board(self):
        from backend.scraper import backfill_contract_prices as B
        ara = B.contracts_for_span("arabica", 2020, 2020)
        rob = B.contracts_for_span("robusta", 2020, 2020)
        assert ara == ["KCH20", "KCK20", "KCN20", "KCU20", "KCZ20"]
        # Robusta lists Jan and Nov; arabica does not. Enumerating one board's
        # months against the other wastes requests and misses real contracts.
        assert rob == ["RCF20", "RCH20", "RCK20", "RCN20", "RCU20", "RCX20"]

    def test_orders_oldest_first_so_a_partial_run_still_deepens_the_tail(self):
        out = __import__("backend.scraper.backfill_contract_prices", fromlist=["x"]) \
            .contracts_for_span("arabica", 2018, 2020)
        assert out[0] == "KCH18" and out[-1] == "KCZ20"

    def test_parses_both_row_shapes_and_skips_unusable_prices(self):
        from backend.scraper import backfill_contract_prices as B
        payload = {"data": [
            {"raw": {"tradeTime": "2020-03-02T00:00:00", "close": 112.5}},
            {"date": "2020-03-03", "close": "113.25"},
            {"raw": {"tradeTime": "2020-03-04", "close": 0}},      # zero is not a price
            {"raw": {"tradeTime": "2020-03-05", "close": None}},
            {"raw": {"close": 99.0}},                               # no date
        ]}
        assert B.parse_eod(payload) == {"2020-03-02": 112.5, "2020-03-03": 113.25}
        assert B.parse_eod(None) == {}
        assert B.parse_eod({"data": "nonsense"}) == {}

    def test_backfill_never_overwrites_what_the_nightly_fetch_already_wrote(self):
        # The nightly job reads the live board; this reads a vendor history
        # file. Where they disagree the live read wins, so backfill fills gaps
        # only — otherwise a re-run would rewrite good data with vendor data.
        from backend.scraper import backfill_contract_prices as B
        archive = {"arabica": {"2020-03-02": {"KCH20": {"oi": 1234, "price": 999.0}}}}
        added = B.merge_prices(archive, "arabica", "KCH20",
                               {"2020-03-02": 112.5, "2020-03-03": 113.25})
        assert added == 1
        assert archive["arabica"]["2020-03-02"]["KCH20"]["price"] == 999.0   # kept
        assert archive["arabica"]["2020-03-02"]["KCH20"]["oi"] == 1234       # untouched
        assert archive["arabica"]["2020-03-03"]["KCH20"]["price"] == 113.25  # filled

    def test_retention_window_covers_what_the_backfill_fetches(self):
        # If retention is shorter than the backfill span, the next nightly trim
        # deletes the work. This is the guard that keeps the two in step.
        from backend.scraper.fetch_oi_json import ARCHIVE_MAX_DAYS
        assert ARCHIVE_MAX_DAYS >= 261 * 10

    def test_a_refused_fetch_reports_its_status_instead_of_looking_empty(self):
        # The 2026-08-27 run logged "no history" for all 110 contracts — the
        # live front month included — because a non-ok status was flattened to
        # None and became indistinguishable from a contract with no data.
        import asyncio

        from backend.scraper import backfill_contract_prices as B

        class RefusedPage:
            async def evaluate(self, js, url):
                return {"__status": 403}

        payload, reason = asyncio.run(B._api(RefusedPage(), "http://x"))
        assert payload is None
        assert reason == "HTTP 403"

    def test_a_successful_fetch_reports_no_reason(self):
        import asyncio

        from backend.scraper import backfill_contract_prices as B

        class OkPage:
            async def evaluate(self, js, url):
                return {"data": [{"date": "2020-03-02", "close": 112.5}]}

        payload, reason = asyncio.run(B._api(OkPage(), "http://x"))
        assert reason is None
        assert B.parse_eod(payload) == {"2020-03-02": 112.5}

    def test_fetching_nothing_at_all_is_a_FAILURE_not_a_green_run(self):
        # The defect that made the first real run useless: it wrote zero cells,
        # exited 0, and the workflow went green.
        from backend.scraper import backfill_contract_prices as B
        code, msg = B.backfill_verdict(0, 0, {"HTTP 403": 110})
        assert code == 3
        assert "HTTP 403" in msg and "NOT modified" in msg

    def test_zero_new_cells_is_fine_when_rows_actually_came_back(self):
        # A re-run over an already-deep archive legitimately fills nothing,
        # because merge_prices only writes gaps. Judging on cells written would
        # make every second run red; judge on rows fetched instead.
        from backend.scraper import backfill_contract_prices as B
        code, msg = B.backfill_verdict(110, 0, {})
        assert code == 0
        assert "already covered" in msg

    def test_a_partial_sweep_succeeds_but_says_what_it_missed(self):
        from backend.scraper import backfill_contract_prices as B
        code, msg = B.backfill_verdict(95, 4200, {"HTTP 404": 15})
        assert code == 0
        assert "4200 new price cells" in msg and "HTTP 404" in msg

    def test_backfill_aborts_before_touching_the_archive_when_barchart_is_denied(
            self, monkeypatch, tmp_path):
        # The archive is the app's deepest price history. A run that cannot
        # reach the source must leave it exactly as it found it.
        import asyncio
        from datetime import date as _date

        from backend.scraper import backfill_contract_prices as B
        p = tmp_path / "a.json"
        p.write_text('{"arabica":{},"robusta":{}}', encoding="utf-8")
        monkeypatch.setattr(B, "ARCHIVE_FILE", p)
        monkeypatch.setattr(B, "host_reachable", lambda: False)
        before = p.read_text(encoding="utf-8")
        assert asyncio.run(B.run(10, _date(2026, 8, 26))) == 2
        assert p.read_text(encoding="utf-8") == before
