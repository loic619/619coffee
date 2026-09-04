"""Mid-month expectation vs actual — Brazil (Cecafé daily) and Vietnam (k1)."""
from scraper.exporters import export_expectations as m

DAILY = {"sources": {"embarques": {
    # Not monotonic on purpose: day 13 < day 12 (next month's fetch stored the
    # page's prior-month figure there), so "through 15" must be a running max.
    "arabica":  {"2026-06": {"2": 19587, "12": 582625, "13": 363015, "15": 693075, "30": 1787492}},
    "conillon": {"2026-06": {"2": 5000, "15": 200000, "30": 619988}},
    "soluvel":  {"2026-06": {"15": 100000, "30": 361398}},
}}}
MONTHLY = {"series": [{"date": "2026-06", "total": 3091837}]}


def test_cum_through_is_a_running_max():
    assert m.cum_through(DAILY["sources"]["embarques"]["arabica"]["2026-06"], 13) == 582625
    assert m.cum_through(DAILY["sources"]["embarques"]["arabica"]["2026-06"], 15) == 693075
    assert m.cum_through({}, 15) is None


def test_brazil_single_closed_month_falls_back_to_the_calendar_scale():
    rows, share, n = m.brazil_rows(DAILY, MONTHLY)
    assert len(rows) == 1 and n == 1
    r = rows[0]
    assert r["month"] == "2026-06"
    assert r["cum_at_basis"] == 693075 + 200000 + 100000
    assert r["method"] == "calendar"                       # no other month to learn a share from
    assert r["expected"] == round((693075 + 200000 + 100000) * 30 / 15)
    assert r["actual"] == 3091837
    assert r["share_actual"] == round((693075 + 200000 + 100000) / 3091837, 4)
    assert round(share, 4) == r["share_actual"]


def _daily(cum15: dict[str, float]) -> dict:
    return {"sources": {"embarques": {"arabica": {ym: {"15": v} for ym, v in cum15.items()},
                                      "conillon": {}, "soluvel": {}}}}


def test_brazil_uses_the_measured_day_15_share_leave_one_out():
    # Three closed months whose first half carried 30%, 35% and 40% of the
    # month, and an open month. Port loadings are back-loaded: the calendar
    # scale (×2) would understate every one of them.
    daily = _daily({"2026-05": 300, "2026-06": 350, "2026-07": 400, "2026-08": 360})
    monthly = {"series": [{"date": "2026-05", "total": 1000}, {"date": "2026-06", "total": 1000},
                          {"date": "2026-07", "total": 1000}]}
    rows, share, n = m.brazil_rows(daily, monthly)
    by = {r["month"]: r for r in rows}
    assert (share, n) == (0.35, 3)
    # May scored with the median of the OTHER two shares (0.35, 0.40) = 0.375
    assert by["2026-05"]["method"] == "share" and by["2026-05"]["share_used"] == 0.375
    assert by["2026-05"]["expected"] == round(300 / 0.375)
    assert by["2026-05"]["error_pct"] == round((round(300 / 0.375) - 1000) / 1000 * 100, 1)
    # Open month: full median 0.35, no actual yet
    aug = by["2026-08"]
    assert aug["actual"] is None and aug["error_pct"] is None
    assert aug["share_used"] == 0.35 and aug["expected"] == round(360 / 0.35)


REPORT = {"stats": {"median": 0.4651, "n": 24}, "pairs": [
    {"month": "2026-06", "k1_tonnes": 57983.0, "full_tonnes": 126436.0, "ratio": 0.4586, "valid": True, "defect": None},
    {"month": "2026-07", "k1_tonnes": 175431.0, "full_tonnes": 147890.0, "ratio": 1.1862, "valid": False,
     "defect": "first half exceeds the full month"},
]}


def test_vietnam_rows_divide_k1_by_the_median_ratio_and_carry_defects():
    rows, ratio, n = m.vietnam_rows(REPORT, {"month": "2026-08", "k1_tonnes": 60000.0, "url": "u"})
    assert (ratio, n) == (0.4651, 24)
    assert [r["month"] for r in rows] == ["2026-06", "2026-07", "2026-08"]
    jun = rows[0]
    assert jun["expected"] == round(57983.0 / 0.4651)
    assert jun["error_pct"] == round((jun["expected"] - 126436.0) / 126436.0 * 100, 1)
    jul = rows[1]
    assert jul["defect"] and jul["error_pct"] is None      # impossible pair: shown, not scored
    aug = rows[2]
    assert aug["actual"] is None and aug["expected"] == round(60000.0 / 0.4651)


def test_vietnam_current_k1_is_ignored_when_already_paired():
    rows, _, _ = m.vietnam_rows(REPORT, {"month": "2026-06", "k1_tonnes": 1.0})
    assert [r["month"] for r in rows] == ["2026-06", "2026-07"]
