"""Tests for scraper.enso_risk — ENSO phase/intensity → crop-risk pins."""
from scraper.enso_risk import (
    _EFFECTS,
    build_risk_pins,
    risk_for_region,
    risk_summary,
)


def test_neutral_is_all_green():
    pins = build_risk_pins("neutral", "Weak")
    assert pins, "expected region pins"
    assert all(p["level"] == "low" for p in pins)
    assert all(p["driver"] == "Near-normal" for p in pins)


def test_drought_region_high_in_el_nino():
    r = risk_for_region("brazil", "Sul de Minas", "el-nino", "Moderate")
    assert r["level"] == "high"
    assert r["driver"] == "Drought"
    assert r["color"] == "#dc2626"


def test_favourable_region_stays_green_even_when_strong():
    # Sul de Minas in La Niña is favourable (sev 0) → never escalates.
    r = risk_for_region("brazil", "Sul de Minas", "la-nina", "Extreme")
    assert r["level"] == "low"


def test_intensity_escalates_moderate_to_high():
    weak = risk_for_region("colombia", "Huila", "la-nina", "Weak")
    strong = risk_for_region("colombia", "Huila", "la-nina", "Strong")
    assert weak["level"] == "moderate"
    assert strong["level"] == "high"


def test_every_region_has_valid_pin_for_every_phase():
    for phase in ("el-nino", "la-nina", "neutral"):
        pins = build_risk_pins(phase, "Strong")
        for p in pins:
            assert p["level"] in ("high", "moderate", "low")
            assert p["color"].startswith("#")
            assert isinstance(p["lat"], (int, float))
            assert p["driver"]


def test_risk_summary_counts_match_pin_count():
    pins = build_risk_pins("el-nino", "Strong")
    s = risk_summary(pins)
    assert sum(s.values()) == len(pins)
    assert s["high"] > 0   # El Niño drives drought across most origins


def test_effects_table_only_active_phase_keys():
    for origin, regions in _EFFECTS.items():
        for region, eff in regions.items():
            assert set(eff).issubset({"el-nino", "la-nina"}), (origin, region)


def test_emerging_is_amber_never_red():
    """An unconfirmed event should warn, not scream. Sul de Minas drought is a
    severity-2 (red) driver under a confirmed El Niño; while the event is only
    emerging it must cap at amber however strong the anomaly reads."""
    for intensity in ("Weak", "Moderate", "Strong", "Extreme"):
        r = risk_for_region("brazil", "Sul de Minas", "el-nino", intensity,
                            status="emerging")
        assert r["level"] == "moderate", intensity
        assert r["status"] == "emerging"
        assert "developing" in r["driver"]


def test_emerging_still_beats_the_old_all_green():
    """The regression this whole change exists to prevent: an emerging El Niño
    must not paint every growing region green."""
    pins = build_risk_pins("el-nino", "Moderate", status="emerging")
    assert any(p["level"] != "low" for p in pins)
    assert all(p["level"] != "high" for p in pins)


def test_benign_region_stays_green_while_emerging():
    # Sul de Minas is favourable in La Niña (sev 0) — no status qualifier.
    r = risk_for_region("brazil", "Sul de Minas", "la-nina", "Strong", status="emerging")
    assert r["level"] == "low"
    assert "status" not in r


def test_official_event_still_reaches_red():
    r = risk_for_region("brazil", "Sul de Minas", "el-nino", "Strong", status="official")
    assert r["level"] == "high"
    assert "status" not in r
