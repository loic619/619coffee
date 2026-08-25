"""Tests for the shared scraper.enso classification (deduped from 6 exporters)."""
from scraper.enso import (
    classify_enso,
    current_event_peak,
    derive_enso_phase,
    oni_to_dots,
)


def _h(vals, **extra):
    return [{"value": v, **extra} for v in vals]


def test_el_nino_when_five_warm():
    phase, intensity, oni = derive_enso_phase(_h([0.6, 0.7, 0.8, 0.9, 1.0]))
    assert phase == "el-nino"
    assert intensity == "Moderate"   # |1.0| → Moderate
    assert oni == 1.0


def test_la_nina_when_five_cold():
    phase, _, _ = derive_enso_phase(_h([-0.6, -0.7, -0.8, -0.9, -1.0]))
    assert phase == "la-nina"


def test_neutral_when_the_run_is_broken():
    # A single month back inside the band breaks the run: 0.4 is not an event.
    assert derive_enso_phase(_h([0.6, 0.7, 0.8, 0.4, 0.9]))[0] == "neutral"
    # ...and one warm month on its own is still noise.
    assert derive_enso_phase(_h([0.2, 0.6]))[0] == "neutral"


def test_short_warm_run_is_emerging_not_neutral():
    """Three warm months used to read as 'neutral' because NOAA's rule needs
    five. On a risk map that is the failure mode, not the safe default."""
    c = classify_enso(_h([0.6, 0.7, 0.8]))
    assert c["phase"] == "el-nino"
    assert c["status"] == "emerging"
    assert c["official_phase"] == "neutral"


def test_the_august_2026_case():
    """The observed series that painted every region green while Niño 3.4 sat
    at +2.6 °C. Two months past +0.5 → emerging, NOAA rule not yet met."""
    c = classify_enso(_h([-0.39, -0.21, 0.11, 0.46, 0.95, 1.39]))
    assert (c["phase"], c["status"]) == ("el-nino", "emerging")
    assert c["official_phase"] == "neutral"
    assert c["intensity"] == "Moderate"


def test_official_outranks_emerging():
    c = classify_enso(_h([0.6, 0.7, 0.8, 0.9, 1.0]))
    assert (c["phase"], c["status"], c["official_phase"]) == ("el-nino", "official", "el-nino")


def test_single_strong_month_is_emerging():
    # One month at ±1.0 is not month-to-month wobble.
    assert classify_enso(_h([0.0, 1.2]))["status"] == "emerging"
    assert classify_enso(_h([0.0, -1.2]))["phase"] == "la-nina"


def test_nino34_escalates_a_lagging_oni_but_never_softens():
    warm_weeks = [{"sst_anomaly": v} for v in (0.6, 0.9, 1.4, 2.0)]
    # ONI still inside the band, Niño 3.4 clearly past it → emerging.
    c = classify_enso(_h([0.0, 0.1]), nino34_weekly=warm_weeks)
    assert (c["phase"], c["status"]) == ("el-nino", "emerging")
    # A cool Niño 3.4 cannot cancel a confirmed El Niño.
    cool_weeks = [{"sst_anomaly": -0.9}] * 4
    c = classify_enso(_h([0.6, 0.7, 0.8, 0.9, 1.0]), nino34_weekly=cool_weeks)
    assert (c["phase"], c["status"]) == ("el-nino", "official")


def test_current_event_peak_ignores_the_previous_event():
    """peak_month used to scan all of history, so a developing El Niño
    reported the previous La Niña's trough as its peak."""
    hist = [{"value": v, "month": m} for v, m in [
        (-0.61, "Nov-25"), (-0.6, "Dec-25"), (-0.39, "Jan-26"), (-0.21, "Feb-26"),
        (0.11, "Mar-26"), (0.46, "Apr-26"), (0.95, "May-26"), (1.39, "Jun-26"),
    ]]
    assert current_event_peak(hist, "el-nino") == "Jun-26"
    assert current_event_peak(hist, "neutral") == ""


def test_empty_history_defaults_neutral_weak():
    assert derive_enso_phase([]) == ("neutral", "Weak", 0.0)


def test_intensity_tiers():
    assert derive_enso_phase(_h([2.1] * 5))[1] == "Extreme"
    assert derive_enso_phase(_h([1.6] * 5))[1] == "Strong"
    assert derive_enso_phase(_h([1.1] * 5))[1] == "Moderate"
    assert derive_enso_phase(_h([0.6] * 5))[1] == "Weak"


def test_legacy_forecast_entries_stripped():
    # forecast=True entries are ignored; the real 5 warm values still classify
    hist = [{"value": 0.9, "forecast": True}] * 3 + _h([0.6, 0.7, 0.8, 0.9, 1.0])
    assert derive_enso_phase(hist)[0] == "el-nino"


def test_oni_to_dots_tiers():
    assert [oni_to_dots(x) for x in (2.5, 1.7, 1.2, 0.4)] == [4, 3, 2, 1]
    assert [oni_to_dots(-x) for x in (2.5, 1.7, 1.2, 0.4)] == [4, 3, 2, 1]
