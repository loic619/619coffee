"""The CCI basket widened to eight origins; the model's feature did not.

Honduras, Uganda and Ethiopia joined the published index on 2026-08-25. The
danger in that change is not the index — it is `open_direction._cci_overnight_series`,
which applies FX weights to INTRADAY snapshots covering only the original twelve
Barchart pairs, zero-fills anything missing, and gates only on `used >= 6`. Point
it at the wider table and every historical value shrinks by the weight that moved
to the new three, silently, with the gate still green.

These tests pin both halves of that split.
"""
from scraper.quant_model.fetch_currency_index import (
    EXPORTERS,
    IMPORTERS,
    SNAPSHOT_EXPORTERS,
    SNAPSHOT_IMPORTERS,
)

NEW_THREE = {"HNL=X", "UGX=X", "ETB=X"}


# ── the published index ──────────────────────────────────────────────────────

def test_published_basket_carries_the_three_new_origins():
    tickers = {t for t, _n, _w in EXPORTERS}
    assert NEW_THREE <= tickers, f"missing: {NEW_THREE - tickers}"
    assert len(EXPORTERS) == 8


def test_weights_normalise_to_one():
    """A basket that does not sum to 1 silently rescales the whole index."""
    assert abs(sum(w for _t, _n, w in EXPORTERS) - 1.0) < 0.005
    assert abs(sum(w for _t, _n, w in IMPORTERS) - 1.0) < 0.005


def test_weights_track_usda_export_volumes():
    """Weights are PSD MY2024 shares — so the ordering must follow the volumes."""
    by_ticker = {t: w for t, _n, w in EXPORTERS}
    # Brazil > Vietnam > Colombia > Ethiopia > Indonesia > Uganda > Honduras > Peru
    order = ["BRL=X", "VND=X", "COP=X", "ETB=X", "IDR=X", "UGX=X", "HNL=X", "PEN=X"]
    weights = [by_ticker[t] for t in order]
    assert weights == sorted(weights, reverse=True), dict(zip(order, weights))


def test_no_duplicate_tickers_across_the_two_sides():
    exp = {t for t, _n, _w in EXPORTERS}
    imp = {t for t, _n, _w in IMPORTERS}
    assert not (exp & imp), f"a currency cannot be both sides: {exp & imp}"


def test_every_ticker_resolves_to_an_api_currency():
    """The FX API is keyed on lowercase ISO codes; a malformed ticker would
    fetch nothing and drop that origin's weight on the floor."""
    from scraper.quant_model.fetch_currency_index import _ticker_to_currency
    for t, _n, _w in EXPORTERS + IMPORTERS:
        code, _invert = _ticker_to_currency(t)
        assert len(code) == 3 and code.islower(), f"{t} -> {code!r}"


# ── the model's frozen basket ────────────────────────────────────────────────

def test_model_basket_excludes_the_new_three():
    """No intraday snapshot contains them, so including them would shrink every
    historical cci_overnight value without failing anything."""
    tickers = {t for t, _n, _w in SNAPSHOT_EXPORTERS}
    assert not (NEW_THREE & tickers), "model basket must stay on snapshot coverage"
    assert len(SNAPSHOT_EXPORTERS) == 5


def test_model_basket_matches_what_barchart_actually_captures():
    """The frozen basket is only correct as long as it equals the snapshot map."""
    from scraper.fetch_fx_snapshots import _BARCHART_FX
    model = {t for t, _n, _w in SNAPSHOT_EXPORTERS + SNAPSHOT_IMPORTERS}
    assert model == set(_BARCHART_FX), (
        f"drifted — only in basket: {model - set(_BARCHART_FX)}; "
        f"only in Barchart map: {set(_BARCHART_FX) - model}")


def test_open_direction_reads_the_frozen_basket_not_the_published_one():
    """Guards the actual regression: re-coupling these silently rescales the
    model's feature history."""
    import inspect

    from scraper.quant_model import open_direction
    src = inspect.getsource(open_direction._cci_overnight_series)
    assert "SNAPSHOT_EXPORTERS" in src and "SNAPSHOT_IMPORTERS" in src
