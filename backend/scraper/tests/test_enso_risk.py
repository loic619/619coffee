"""Tests for scraper.enso_risk — event projection → crop phase → risk.

The behaviour under test is the thing the old table got wrong: a rainfall
anomaly has no meaning until you know which crop phase it lands on, and which
phase it lands on depends on when the event runs and how long the region's
teleconnection lags behind the ocean.
"""
from scraper.enso_risk import (
    affected_months,
    build_risk_pins,
    project_event_months,
    region_risk,
    risk_summary,
)


def _tele(origin, region, phase_key, phase, **stats):
    """Minimal teleconnection doc for one region/phase bucket."""
    return {"regions": {f"{origin}|{region}": {
        "origin": origin, "region": region, "lag_months": stats.pop("lag", 0),
        "lag_r": 0.5,
        "phases": {phase_key: {phase: {"usable": True, "consistency": 1.0, **stats}}},
    }}}


# ── projection ──────────────────────────────────────────────────────────────

def test_event_runs_until_the_projection_decays():
    months = project_event_months((2026, 6), 1.39, [1.1, 1.3, 1.6, 0.2, 0.1])
    assert months == [(2026, 6), (2026, 7), (2026, 8), (2026, 9)]


def test_no_event_when_the_ocean_is_inside_the_band():
    assert project_event_months((2026, 6), 0.2, [1.5, 1.8]) == []


def test_event_wraps_the_year_end():
    months = project_event_months((2026, 11), 1.2, [1.2, 1.2])
    assert months == [(2026, 11), (2026, 12), (2027, 1)]


def test_lag_moves_the_weather_window():
    """The ocean signal leads the rainfall response, so an event active in
    Jun–Aug with a 3-month lag lands on Sep–Nov weather."""
    event = [(2026, 6), (2026, 7), (2026, 8)]
    assert affected_months(event, 0) == {6, 7, 8}
    assert affected_months(event, 3) == {9, 10, 11}


# ── phase scoring: the same anomaly, different meanings ─────────────────────

def test_rain_is_ruinous_at_harvest_and_benign_at_fill():
    wet = {"anomaly_pct": 60.0, "n": 5}
    at_harvest = region_risk("uganda", "Mt Elgon", "el-nino", "Moderate", {10, 11},
                             _tele("uganda", "Mt Elgon", "main/harvest", "el-nino", **wet))
    at_fill = region_risk("uganda", "Mt Elgon", "el-nino", "Moderate", {7, 8},
                          _tele("uganda", "Mt Elgon", "main/fruit_fill", "el-nino", **wet))
    assert at_harvest["level"] == "high"
    assert "harvest" in at_harvest["driver"].lower()
    assert at_fill["level"] == "low"


def test_drought_is_ruinous_at_flowering_and_welcome_at_harvest():
    dry = {"anomaly_pct": -55.0, "n": 5}
    at_flowering = region_risk("vn", "Dak Lak", "el-nino", "Moderate", {1, 2, 3},
                               _tele("vn", "Dak Lak", "robusta/flowering", "el-nino", **dry))
    at_harvest = region_risk("vn", "Dak Lak", "el-nino", "Moderate", {11, 12},
                             _tele("vn", "Dak Lak", "robusta/harvest", "el-nino", **dry))
    assert at_flowering["level"] == "high"
    assert at_harvest["level"] == "low"
    assert "clean drying" in at_harvest["phase_hits"][0]["driver"]


# ── evidence gates: a weak composite must not colour a pin ──────────────────

def test_inconsistent_history_scores_nothing():
    t = _tele("uganda", "Mt Elgon", "main/harvest", "el-nino", anomaly_pct=66.0, n=4)
    t["regions"]["uganda|Mt Elgon"]["phases"]["main/harvest"]["el-nino"]["consistency"] = 0.5
    r = region_risk("uganda", "Mt Elgon", "el-nino", "Moderate", {10, 11}, t)
    assert r["level"] == "low"
    assert "disagree" in r["phase_hits"][0]["driver"]


def test_too_few_events_scores_nothing():
    t = _tele("uganda", "Mt Elgon", "main/harvest", "el-nino", anomaly_pct=66.0, n=2)
    t["regions"]["uganda|Mt Elgon"]["phases"]["main/harvest"]["el-nino"]["usable"] = False
    r = region_risk("uganda", "Mt Elgon", "el-nino", "Moderate", {10, 11}, t)
    assert r["level"] == "low"
    assert "Too few" in r["phase_hits"][0]["driver"]


def test_a_small_departure_is_not_a_risk():
    t = _tele("uganda", "Mt Elgon", "main/harvest", "el-nino", anomaly_pct=3.0, n=5)
    r = region_risk("uganda", "Mt Elgon", "el-nino", "Moderate", {10, 11}, t)
    assert r["level"] == "low"
    assert "Near-normal" in r["phase_hits"][0]["driver"]


# ── phase / status plumbing ─────────────────────────────────────────────────

def test_neutral_is_low_everywhere():
    pins = build_risk_pins("neutral", "Weak", event_months=[])
    assert pins
    assert all(p["level"] == "low" for p in pins)
    # Measured regions read "Near-normal"; unmeasured ones say so instead of
    # borrowing a reassuring label they have not earned.
    assert all(p["driver"] == "Near-normal" for p in pins if p["measured"])


def test_strong_event_escalates_an_at_risk_phase():
    dry = {"anomaly_pct": -55.0, "n": 5}
    t = _tele("vn", "Dak Lak", "robusta/fruit_fill", "el-nino", **dry)
    weak = region_risk("vn", "Dak Lak", "el-nino", "Moderate", {5, 6}, t)
    strong = region_risk("vn", "Dak Lak", "el-nino", "Strong", {5, 6}, t)
    assert strong["severity"] > weak["severity"]


def test_emerging_caps_at_amber():
    t = _tele("uganda", "Mt Elgon", "main/harvest", "el-nino", anomaly_pct=60.0, n=5)
    r = region_risk("uganda", "Mt Elgon", "el-nino", "Extreme", {10, 11}, t, status="emerging")
    assert r["level"] == "moderate"
    assert r["status"] == "emerging"
    assert "developing" in r["driver"]


def test_a_region_with_no_measured_response_is_flagged_not_dropped():
    """Dropping it would quietly shrink the map, and a region that vanishes is
    indistinguishable from a region at no risk."""
    pins = build_risk_pins("el-nino", "Strong", event_months=[(2026, 10)], teleconnection={})
    assert pins, "regions must still appear"
    assert all(p["measured"] is False for p in pins)
    assert all(p["severity"] == 0 for p in pins)
    assert all("No measured" in p["driver"] for p in pins)


def test_risk_summary_counts_match_pin_count():
    pins = build_risk_pins("neutral", "Weak", event_months=[])
    s = risk_summary(pins)
    assert sum(s.values()) == len(pins)
