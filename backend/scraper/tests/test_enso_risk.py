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


def test_a_region_whose_rainfall_ignores_enso_scores_nothing():
    """Paraná's rainfall correlates with the ONI at r=0.12 — no measurable
    relationship at any lag. A tidy-looking composite on one crop phase must
    not colour a pin the region has not earned."""
    t = _tele("brazil", "Paraná", "main/fruit_fill", "el-nino",
              anomaly_pct=-11.0, n=4, lag=0)
    t["regions"]["brazil|Paraná"]["lag_r"] = 0.121
    r = region_risk("brazil", "Paraná", "el-nino", "Strong", {12, 1, 2}, t)
    assert r["level"] == "low"
    assert "No measurable ENSO link" in r["driver"]


def test_both_phases_moving_the_same_way_is_not_a_signal():
    """A real teleconnection pushes El Niño and La Niña in opposite
    directions. When both come out dry, something other than ENSO is moving
    the rain."""
    t = _tele("brazil", "Paraná", "main/fruit_fill", "el-nino",
              anomaly_pct=-11.0, n=4, lag=0)
    t["regions"]["brazil|Paraná"]["lag_r"] = 0.55          # strong enough to pass the region gate
    t["regions"]["brazil|Paraná"]["phases"]["main/fruit_fill"]["la-nina"] = {
        "anomaly_pct": -9.6, "n": 3, "consistency": 0.67, "usable": True,
    }
    r = region_risk("brazil", "Paraná", "el-nino", "Strong", {12, 1, 2}, t)
    assert r["level"] == "low"
    assert "same way" in r["phase_hits"][0]["driver"]


def test_opposite_phases_still_score():
    """The guard must not swallow a genuine signal: Vietnam is dry under
    El Niño and wet under La Niña, which is exactly what it should keep."""
    t = _tele("vn", "Dak Lak", "robusta/flowering", "el-nino",
              anomaly_pct=-55.0, n=5, lag=3)
    t["regions"]["vn|Dak Lak"]["lag_r"] = -0.39
    t["regions"]["vn|Dak Lak"]["phases"]["robusta/flowering"]["la-nina"] = {
        "anomaly_pct": 22.0, "n": 4, "consistency": 0.75, "usable": True,
    }
    r = region_risk("vn", "Dak Lak", "el-nino", "Moderate", {1, 2, 3}, t)
    assert r["level"] == "high"


def test_equal_severity_is_broken_by_evidence_not_loop_order():
    """Two phases can both score 2. `max` used to hand the tie to whichever
    the loop reached first, which is the phase ORDER, not the data.

    Mt Elgon is the case: under El Niño its inferred Jul–Sep fill window is
    -12.9% over four events, and its published Oct–Feb main harvest is +41.1%
    over ten. Both severity 2. The fill window came first and the pin read
    "Drought at cherry fill" for a region whose measured El Niño story is rain
    on the harvest.
    """
    t = {"regions": {"uganda|Mt Elgon": {
        "origin": "uganda", "region": "Mt Elgon", "lag_months": 0, "lag_r": 0.21,
        "phases": {
            "main/fruit_fill": {
                "inferred": True,
                "el-nino": {"anomaly_pct": -12.9, "n": 4, "consistency": 0.75, "usable": True},
                "la-nina": {"anomaly_pct": 19.6, "n": 6, "consistency": 0.67, "usable": True},
            },
            "main/harvest": {
                "inferred": False,
                "el-nino": {"anomaly_pct": 41.1, "n": 10, "consistency": 0.70, "usable": True},
                "la-nina": {"anomaly_pct": -22.4, "n": 14, "consistency": 0.64, "usable": True},
            },
        },
    }}}
    # A window covering both the Jul-Sep fill and part of the Oct-Feb harvest.
    r = region_risk("uganda", "Mt Elgon", "el-nino", "Moderate",
                    {7, 8, 9, 10, 11, 12}, t)
    assert r["level"] == "high"
    assert "Rain through harvest" in r["driver"], r["driver"]
    # Both hits are still reported — the tie-break picks the headline, it does
    # not hide the other phase.
    assert {h["phase"] for h in r["phase_hits"] if h["severity"] > 0} == {
        "fruit_fill", "harvest"}


def test_a_published_window_outranks_an_inferred_one_on_a_tie():
    """Same anomaly, same evidence, one window published and one arithmetic:
    the published one carries the pin."""
    same = {"anomaly_pct": -30.0, "n": 6, "consistency": 0.8, "usable": True}
    t = {"regions": {"uganda|Mt Elgon": {
        "origin": "uganda", "region": "Mt Elgon", "lag_months": 0, "lag_r": 0.21,
        "phases": {
            "main/fruit_fill": {"inferred": True, "el-nino": dict(same)},
            "main/flowering": {"inferred": False, "el-nino": dict(same)},
        },
    }}}
    r = region_risk("uganda", "Mt Elgon", "el-nino", "Moderate",
                    {4, 5, 6, 7, 8, 9}, t)
    assert "Drought at flowering" in r["driver"], r["driver"]
