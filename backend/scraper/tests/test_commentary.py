import pytest

from scraper.commentary import CommentaryError, render
from scraper.commentary.builder import signed, thousep

# ── Helpers ──────────────────────────────────────────────────────────────────

def test_signed_zero_drops_sign():
    assert signed(0) == "0"


def test_signed_positive_includes_plus():
    assert signed(1234) == "+1,234"


def test_signed_negative_includes_minus():
    assert signed(-2400) == "-2,400"


def test_thousep_no_sign():
    assert thousep(842100) == "842,100"


# ── ICE certified stocks — both example shapes from the spec ─────────────────

def test_ice_with_grading_and_decert():
    text = render("ice_certified_stocks", {
        "market":        "KC Arabica",
        "delta_signed":  signed(-2400),
        "units":         "bags",
        "total":         thousep(842100),
        "grading_delta": 12,
        "decert_delta":  8,
        "port":          "Antwerp",
    })
    assert text == (
        "KC Arabica certified stocks shifted by -2,400 bags today, bringing "
        "global visible exchange inventory to 842,100 bags. 12 bags graded. "
        "8 bags decertified in Antwerp."
    )


def test_ice_without_grading_or_decert():
    """When grading_delta is falsy, the grading clause disappears entirely."""
    text = render("ice_certified_stocks", {
        "market":        "RC Robusta",
        "delta_signed":  signed(45),
        "units":         "lots",
        "total":         thousep(4120),
        "grading_delta": 0,
        "decert_delta":  0,
        "port":          None,
    })
    assert text == (
        "RC Robusta certified stocks shifted by +45 lots today, bringing "
        "global visible exchange inventory to 4,120 lots."
    )


# ── Physical price — confirms the user's exact wording ───────────────────────

def test_physical_price_factual_wording():
    """User's locked wording: 'x% of the market change has gone into the local
    price' — no sentiment labels, no 'moderate/strong' editorialising."""
    text = render("physical_price", {
        "origin":               "Vietnam Robusta",
        "phys_delta_signed":    signed(55),
        "currency":             "USD",
        "benchmark":            "London Robusta",
        "futures_delta_signed": signed(100),
        "ratio":                55,
    })
    assert text == (
        "Vietnam Robusta physical cash price adjusted by +55 USD/ton today "
        "while London Robusta moved by +100 USD/ton. 55% of the market change "
        "has gone into the local price."
    )


def test_physical_price_no_futures_move_uses_dedicated_template():
    """Divide-by-zero guard: when futures didn't move, callers pick the
    'no_futures_move' template instead of computing ratio."""
    text = render("physical_price_no_futures_move", {
        "origin":            "Vietnam Robusta",
        "phys_delta_signed": signed(15),
        "currency":          "USD",
        "benchmark":         "London Robusta",
    })
    assert "no transmission ratio is computable" in text


# ── Weather — drought-risk gate ──────────────────────────────────────────────

def test_weather_at_risk_includes_thresholds():
    text = render("weather_risk", {
        "origin":       "Vietnam",
        "provinces":    "Đắk Lắk, Gia Lai",
        "forecast_mm":  42,
        "vhi":          31,
    })
    assert "Vietnam (Đắk Lắk, Gia Lai)" in text
    assert "at drought risk" in text
    assert "42mm" in text
    assert "31" in text


def test_weather_normal_compact():
    text = render("weather_normal", {
        "origin":    "Brazil",
        "provinces": "Minas Gerais",
    })
    assert text == "Agronomic Status Update: Brazil (Minas Gerais) is currently flagged as normal."


# ── Failure modes ────────────────────────────────────────────────────────────

def test_unknown_event_type_raises():
    with pytest.raises(CommentaryError, match="Unknown commentary event_type"):
        render("does_not_exist", {})


def test_missing_required_key_raises_loudly():
    """StrictUndefined: a missing context key fails the render rather than
    leaving `{{ var }}` in the published news feed."""
    with pytest.raises(CommentaryError, match="Render failed"):
        render("ice_certified_stocks", {"market": "KC"})  # missing delta_signed etc.


def test_comment_keys_are_not_renderable():
    """`_comment` and similar metadata keys in templates.json must not be
    accessible via render() — they're documentation, not templates."""
    with pytest.raises(CommentaryError, match="Unknown commentary event_type"):
        render("_comment", {})
