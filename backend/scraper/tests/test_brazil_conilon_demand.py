# backend/scraper/tests/test_brazil_conilon_demand.py
"""Conilon blend-share residual: the domain guard and the contiguity rule.

The derivation rests on one assumption — that Brazil's soluble industry runs on
conilon — and that assumption has a domain. Through the 1990s the soluble draw
was as large as the whole conilon crop, so charging all of it to conilon yields
a NEGATIVE blend. These pin the two behaviours that keep such a year out of the
published series, because the failure mode is a plausible-looking line rather
than a crash.
"""
import json

from scraper.sources import brazil_conilon_demand as bcd


def _psd(year: int, robusta: int, soluble_exp: int, soluble_dom: int,
         rg: int = 20_000_000) -> dict:
    return {year: {
        "robusta_production": float(robusta),
        "arabica_production": 40_000_000.0,
        "soluble_exports": float(soluble_exp),
        "soluble_domestic": float(soluble_dom),
        "rg_domestic": float(rg),
        "domestic_use": float(rg + soluble_dom),
        "bean_exports": 30_000_000.0,
    }}


def _wire(monkeypatch, psd: dict, exports: dict) -> None:
    monkeypatch.setattr(bcd, "fetch_psd", lambda *a, **k: psd)
    monkeypatch.setattr(bcd, "_marketing_year_exports", lambda: exports)
    # The cross-check must never be able to sink the series it checks.
    monkeypatch.setattr(bcd, "fetch_conab", lambda *a, **k: {})


def _exports(*years: int, conilon: int = 2_000_000) -> dict:
    return {y: {"conilon": float(conilon), "soluble": 0.0,
                "arabica": 0.0, "months": 12} for y in years}


def test_soluble_heavier_than_half_the_crop_is_refused(monkeypatch):
    """1993's shape: ~5 M bags of soluble against a 4.5 M bag conilon crop."""
    psd = {**_psd(1993, 4_500_000, 4_500_000, 500_000),
           **_psd(2020, 20_000_000, 3_900_000, 900_000)}
    _wire(monkeypatch, psd, _exports(1993, 2020))
    years = [r["year"] for r in bcd.build()["history"]]
    assert 1993 not in years, "a negative-blend year reached the published series"
    assert years == [2020]


def test_a_refusal_takes_every_earlier_year_with_it(monkeypatch):
    """No holes: the reader must never see a line jump a gap unannounced.

    1998 passes the soluble test on its own, but 1999 does not — so 1998 goes
    too, and the series starts after the LAST refusal rather than around it.
    """
    psd = {**_psd(1998, 12_000_000, 3_000_000, 500_000),
           **_psd(1999, 5_000_000, 3_500_000, 500_000),
           **_psd(2000, 14_000_000, 3_000_000, 500_000),
           **_psd(2001, 15_000_000, 3_000_000, 500_000)}
    _wire(monkeypatch, psd, _exports(1998, 1999, 2000, 2001))
    years = [r["year"] for r in bcd.build()["history"]]
    assert years == [2000, 2001], f"expected a contiguous run after 1999, got {years}"


def test_share_is_the_residual_over_roast_and_ground_use(monkeypatch):
    """20 M crop − 2 M exports − 4 M soluble = 14 M into a 20 M blend = 70%."""
    _wire(monkeypatch, _psd(2022, 20_000_000, 3_000_000, 1_000_000, rg=20_000_000),
          _exports(2022))
    row = bcd.build()["history"][0]
    assert row["conilon_blend"] == 14_000_000
    assert row["conilon_share"] == 70.0
    # The second cut counts the soluble Brazilians drink, over ALL domestic use.
    assert row["share_of_total_use"] == 71.4


def test_incomplete_marketing_years_are_skipped(monkeypatch):
    """A part-year of Cecafé months would understate exports and inflate demand."""
    exports = _exports(2024, 2025)
    exports[2025]["months"] = 7
    _wire(monkeypatch, {**_psd(2024, 21_000_000, 3_700_000, 970_000),
                        **_psd(2025, 25_000_000, 3_800_000, 980_000)}, exports)
    assert [r["year"] for r in bcd.build()["history"]] == [2024]


def test_published_series_is_positive_and_contiguous():
    """Guard the artefact itself, not just the code that writes it."""
    doc = json.loads(bcd.OUT.read_text(encoding="utf-8"))
    hist = doc["history"]
    assert hist, "brazil_conilon_demand.json carries no history"
    years = [r["year"] for r in hist]
    assert years == list(range(years[0], years[-1] + 1)), f"gap in {years}"
    for r in hist:
        assert r["conilon_blend"] > 0, f"{r['year']} publishes a negative blend"
        assert 0 < r["conilon_share"] < 100, f"{r['year']} share {r['conilon_share']}"
    assert doc["estimate"] is True, "the series must announce itself as an estimate"
