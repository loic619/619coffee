"""Pure-rule tests for the IPHM agronomic alert engine."""
from __future__ import annotations

from scraper import agronomic_alerts as ae
from scraper.rules.iphm_thresholds import IPHM_RULES

# ── Rule lookup helpers (so tests don't drift when the rule order changes) ───

def _rule(threat_id: str) -> dict:
    for r in IPHM_RULES:
        if r["threat_id"] == threat_id:
            return r
    raise KeyError(threat_id)


# ── fungal_rust_outbreak: SPI-1 high AND temp_mean in band ───────────────────

class TestFungalRust:
    RULE = _rule("fungal_rust_outbreak")

    def test_fires_when_all_conditions_met(self):
        out = ae.evaluate_rule(self.RULE, {"spi_1": 2.0, "temp_mean": 23.0, "arabica_share": 1.0}, "COL", 5)
        assert out is not None
        assert out["threat_id"] == "fungal_rust_outbreak"
        assert out["severity"] == "alert"
        assert out["timeframe"] == "current"
        assert out["triggers"] == {"spi_1": 2.0, "temp_mean": 23.0, "arabica_share": 1.0}

    def test_skips_when_spi_too_low(self):
        # SPI-1 = 1.4 fails the >= 1.5 floor
        assert ae.evaluate_rule(self.RULE, {"spi_1": 1.4, "temp_mean": 23.0, "arabica_share": 1.0}, "COL", 5) is None

    def test_skips_when_temp_outside_band(self):
        assert ae.evaluate_rule(self.RULE, {"spi_1": 2.0, "temp_mean": 19.0, "arabica_share": 1.0}, "COL", 5) is None
        assert ae.evaluate_rule(self.RULE, {"spi_1": 2.0, "temp_mean": 28.0, "arabica_share": 1.0}, "COL", 5) is None

    def test_skips_when_field_missing(self):
        # No false fires when we lack the data — better silent than wrong.
        assert ae.evaluate_rule(self.RULE, {"spi_1": 2.0}, "COL", 5) is None
        assert ae.evaluate_rule(self.RULE, {"temp_mean": 23.0}, "COL", 5) is None
        assert ae.evaluate_rule(self.RULE, {}, "COL", 5) is None


# ── severe_defoliation: VHI low AND SPEI-3 deep negative ─────────────────────

class TestSevereDefoliation:
    RULE = _rule("severe_defoliation")

    def test_fires_on_double_stress(self):
        out = ae.evaluate_rule(self.RULE, {"vhi": 30.0, "spei_3": -2.0}, "VNM", 5)
        assert out is not None
        assert out["severity"] == "critical"
        assert out["timeframe"] == "current"
        assert out["triggers"] == {"vhi": 30.0, "spei_3": -2.0}

    def test_does_not_fire_on_vhi_alone(self):
        # VHI is stressed but SPEI-3 only mild deficit
        assert ae.evaluate_rule(self.RULE, {"vhi": 30.0, "spei_3": -0.5}, "VNM", 5) is None

    def test_does_not_fire_on_spei_alone(self):
        assert ae.evaluate_rule(self.RULE, {"vhi": 60.0, "spei_3": -2.0}, "VNM", 5) is None


# ── Brazil frost: per-region, physics-based, graduated (iphm-v2) ─────────────

def _fe_doc(region: str, detail: dict | None) -> dict:
    """Minimal farmer_economics.json shape carrying one region's frost_detail."""
    return {"weather": {"regions": [{"name": region, "frost_detail": detail}]}}


class TestBrazilFrostAlerts:
    def test_frost_belt_region_fires_graduated_severity(self):
        # A deep radiative freeze in the frost belt → critical.
        detail = {"risk": "H", "frost_type": "radiative", "surface_c": -3.0,
                  "air_min_c": 1.0, "hours_below_0": 5, "date": "2026-07-15"}
        out = ae.brazil_frost_alerts(_fe_doc("Sul de Minas", detail), month=7)
        assert "Sul de Minas" in out
        alert = out["Sul de Minas"][0]
        assert alert["severity"] == "critical"
        assert alert["threat_id"] == "brazil_frost_risk"
        assert alert["timeframe"] == "forecast"
        assert alert["triggers"]["type"] == "radiative"

    def test_marginal_frost_is_only_a_watch(self):
        detail = {"risk": "M", "frost_type": "none", "surface_c": 1.5,
                  "air_min_c": 3.0, "hours_below_0": 0, "date": "2026-07-15"}
        out = ae.brazil_frost_alerts(_fe_doc("Paraná", detail), month=7)
        assert out["Paraná"][0]["severity"] == "watch"

    def test_coastal_espirito_santo_never_fires(self):
        # Even if a glitch put a frost_detail on the coastal region, it's not
        # in the frost belt → no alert (kills the old country-wide false pos).
        detail = {"risk": "H", "frost_type": "radiative", "surface_c": -2.0,
                  "air_min_c": 1.0, "hours_below_0": 2, "date": "2026-07-15"}
        assert ae.brazil_frost_alerts(_fe_doc("Espírito Santo", detail), month=7) == {}

    def test_no_alert_out_of_frost_season(self):
        detail = {"risk": "H", "frost_type": "radiative", "surface_c": -3.0,
                  "air_min_c": 1.0, "hours_below_0": 5, "date": "2026-01-15"}
        assert ae.brazil_frost_alerts(_fe_doc("Sul de Minas", detail), month=1) == {}

    def test_no_frost_detail_or_missing_file_is_silent(self):
        assert ae.brazil_frost_alerts(_fe_doc("Paraná", None), month=7) == {}
        assert ae.brazil_frost_alerts(None, month=7) == {}

    def test_removed_from_generic_ruleset(self):
        # The crude country-wide rule is gone from IPHM_RULES.
        assert all(r["threat_id"] != "brazil_frost_risk" for r in IPHM_RULES)


# ── blossom_drop: drought THEN sudden heavy rain ─────────────────────────────

class TestBlossomDrop:
    RULE = _rule("blossom_drop")

    def test_fires_on_drought_then_rain(self):
        out = ae.evaluate_rule(
            self.RULE, {"spei_3": -1.2, "forecast_7d_rain": 78.0}, "BRA", 9,
        )
        assert out is not None
        assert out["severity"] == "watch"
        assert out["timeframe"] == "forecast"   # forecast_7d_rain is a forecast field

    def test_does_not_fire_without_drought(self):
        assert ae.evaluate_rule(
            self.RULE, {"spei_3": 0.5, "forecast_7d_rain": 78.0}, "BRA", 9,
        ) is None

    def test_does_not_fire_without_heavy_rain(self):
        assert ae.evaluate_rule(
            self.RULE, {"spei_3": -1.5, "forecast_7d_rain": 20.0}, "BRA", 9,
        ) is None


# ── extract_region_values: shape correctness on synthetic data ──────────────

def test_extract_picks_spi_spei_vhi_and_temps():
    prov = {
        "name": "Sul de Minas",
        "spi_1": 1.7, "spi_3": 0.9, "spei_1": -0.4, "spei_3": -1.2,
        "monthly_actual_temp_cur": [22.0, 23.0, 24.0, 23.5, 22.0, 19.0,
                                    18.0, 19.0, 21.0, 22.5, 23.5, 24.5],
        "forecast_7d_rain": [10.0, 0.0, 5.5, 12.0, 0.0, 0.0, 3.5],
    }
    wx = {"forecast_7d": [
        {"date": "2026-06-01", "temp_min_c": 4.5, "temp_max_c": 18.0, "rain_mm": 0.0},
        {"date": "2026-06-02", "temp_min_c": 2.0, "temp_max_c": 17.0, "rain_mm": 0.0},
        {"date": "2026-06-03", "temp_min_c": 6.0, "temp_max_c": 20.0, "rain_mm": 5.0},
    ]}
    vhi_prov = {"vhi_latest": {"vhi": 58.9, "iso_week": "2026-W22", "severity": "fair"}}

    values = ae.extract_region_values(prov, wx, vhi_prov, cur_month_idx=5)  # June
    assert values["spi_1"] == 1.7
    assert values["spei_3"] == -1.2
    assert values["vhi"] == 58.9
    assert values["temp_mean"] == 19.0          # June index in the array
    assert values["temp_min"] == 2.0            # worst forecast across 3 days
    assert values["forecast_7d_rain"] == 31.0   # sum of the per-province array


def test_extract_skips_absent_fields():
    # Region with thin data — only some fields available
    values = ae.extract_region_values(
        {"name": "X", "spi_1": 0.2}, {}, None, cur_month_idx=0,
    )
    assert values == {"spi_1": 0.2}


# ── Flatten into signals.json shape ──────────────────────────────────────────

def test_flatten_promotes_timeframe_and_passes_severity_through():
    payload = {
        "origins": {
            "brazil": {
                "Sul de Minas": [{
                    "threat_id": "brazil_frost_risk",
                    "name": "Critical Frost Threat",
                    "severity": "critical",
                    "timeframe": "forecast",
                    "market_impact": "Immediate systemic threat.",
                    "triggers": {"temp_min": 1.5},
                }],
            },
        },
    }
    rows = ae.flatten_for_signals(payload)
    assert len(rows) == 1
    r = rows[0]
    # Structured fields — what the UI actually filters on
    assert r["severity"]  == "critical"            # passthrough (was already lowercase)
    assert r["timeframe"] == "forecast"            # promoted from text → top-level
    assert r["category"]  == "AGRO"
    assert r["market"]    == "PHYS"
    assert r["id"]        == "AGRO_brazil_Sul_de_Minas_brazil_frost_risk"
    # text is now informational only — no parseable state. Triggers remain
    # in brackets for Telegram readability.
    assert "(forecast)" not in r["text"]
    assert "temp_min=1.5" in r["text"]


def test_flatten_current_timeframe_pass_through():
    payload = {
        "origins": {
            "colombia": {
                "Huila": [{
                    "threat_id": "fungal_rust_outbreak",
                    "name": "Elevated Fungal / Leaf Rust Risk",
                    "severity": "alert",
                    "timeframe": "current",
                    "market_impact": "…",
                    "triggers": {"spi_1": 1.8, "temp_mean": 22.5},
                }],
            },
        },
    }
    rows = ae.flatten_for_signals(payload)
    assert rows[0]["timeframe"] == "current"
    assert rows[0]["severity"]  == "alert"
    assert "(forecast)" not in rows[0]["text"]


def test_iphm_rules_all_use_lowercase_severities():
    """Guard: no Pascal-case sneaks back into the canonical ruleset."""
    from scraper.rules.iphm_thresholds import IPHM_RULES
    allowed = {"watch", "alert", "critical"}
    for rule in IPHM_RULES:
        assert rule["severity"] in allowed, (
            f"{rule['threat_id']} has severity {rule['severity']!r} — "
            "must be lowercase (watch | alert | critical)."
        )


# ── evaluate_region: stacks alerts ───────────────────────────────────────────

def test_evaluate_region_returns_all_fired_rules():
    values = {
        "spi_1": 2.0, "temp_mean": 23.0,       # fires fungal_rust_outbreak…
        "arabica_share": 1.0,                  # …for an arabica region (v3)
        "vhi": 30.0, "spei_3": -2.0,           # fires the drought ladder
        "forecast_7d_rain": 80.0,              # blossom_drop needs spei_3 ≤ -1.0 too — satisfied
    }
    # month 9 sits inside Colombia's second flowering window (v3 phenology)
    fired = ae.evaluate_region(values, "COL", 9)
    threat_ids = {a["threat_id"] for a in fired}
    assert "fungal_rust_outbreak" in threat_ids
    assert "severe_defoliation" in threat_ids
    assert "blossom_drop" in threat_ids
    # frost is no longer a generic rule (moved to brazil_frost_alerts in v2)
    assert "brazil_frost_risk" not in threat_ids


def test_evaluate_region_returns_empty_on_clear_data():
    values = {"spi_1": 0.2, "temp_mean": 24.0, "vhi": 70.0, "spei_3": 0.3,
              "forecast_7d_rain": 5.0, "temp_min": 12.0}
    assert ae.evaluate_region(values, "BRA", 6) == []


# ── v3: robusta scoping, ladders, phenology, hysteresis, VN water ────────────

class TestV3RobustaScoping:
    RULE = _rule("fungal_rust_outbreak")

    def test_rust_does_not_fire_for_robusta_region(self):
        vals = {"spi_1": 2.0, "temp_mean": 23.0, "arabica_share": 0.0}
        assert ae.evaluate_rule(self.RULE, vals, "VNM", 5) is None

    def test_rust_fires_for_mixed_region(self):
        vals = {"spi_1": 2.0, "temp_mean": 23.0, "arabica_share": 0.5}
        assert ae.evaluate_rule(self.RULE, vals, "UGA", 5) is not None


class TestV3DroughtLadder:
    def test_reduce_keeps_highest_tier_only(self):
        vals = {"vhi": 30.0, "spei_3": -2.0}          # trips all three tiers
        fired = ae.evaluate_region(vals, "BRA", 6)
        drought = [a for a in fired if a["family"] == "drought_stress"]
        assert len(drought) == 3                       # raw: watch+alert+critical
        reduced = ae.reduce_families(fired)
        drought_r = [a for a in reduced if a["family"] == "drought_stress"]
        assert len(drought_r) == 1
        assert drought_r[0]["severity"] == "critical"
        assert drought_r[0]["threat_id"] == "severe_defoliation"

    def test_mid_tier_when_only_alert_conditions_met(self):
        vals = {"vhi": 38.0, "spei_3": -1.3}          # watch+alert, not critical
        reduced = ae.reduce_families(ae.evaluate_region(vals, "BRA", 6))
        drought_r = [a for a in reduced if a["family"] == "drought_stress"]
        assert len(drought_r) == 1
        assert drought_r[0]["severity"] == "alert"


class TestV3Phenology:
    BLOSSOM_VALS = {"spei_3": -1.5, "forecast_7d_rain": 80.0}

    def test_blossom_fires_in_brazil_flowering_window(self):
        fired = ae.evaluate_region(self.BLOSSOM_VALS, "BRA", 9)
        assert any(a["threat_id"] == "blossom_drop" for a in fired)

    def test_blossom_silent_outside_flowering_window(self):
        fired = ae.evaluate_region(self.BLOSSOM_VALS, "BRA", 6)
        assert not any(a["threat_id"] == "blossom_drop" for a in fired)

    def test_vietnam_window_differs_from_brazil(self):
        assert any(a["threat_id"] == "blossom_drop"
                   for a in ae.evaluate_region(self.BLOSSOM_VALS, "VNM", 2))
        assert not any(a["threat_id"] == "blossom_drop"
                       for a in ae.evaluate_region(self.BLOSSOM_VALS, "VNM", 9))


class TestV3HeatStress:
    def test_fires_in_brazil_fill_window_on_dry_heat(self):
        vals = {"forecast_hot_days": 5.0, "spei_1": -0.8}
        fired = ae.evaluate_region(vals, "BRA", 1)
        heat = [a for a in fired if a["family"] == "heat_stress"]
        assert heat and heat[0]["severity"] == "alert"
        assert heat[0]["timeframe"] == "forecast"

    def test_silent_outside_fill_window(self):
        vals = {"forecast_hot_days": 5.0, "spei_1": -0.8}
        assert not [a for a in ae.evaluate_region(vals, "BRA", 8)
                    if a["family"] == "heat_stress"]

    def test_tci_escalates_to_critical(self):
        vals = {"forecast_hot_days": 5.0, "spei_1": -0.8, "tci": 20.0}
        reduced = ae.reduce_families(ae.evaluate_region(vals, "BRA", 1))
        heat = [a for a in reduced if a["family"] == "heat_stress"]
        assert heat and heat[0]["severity"] == "critical"


class TestV3Hysteresis:
    EXITS = _rule("severe_defoliation")["exit_conditions"]

    def test_not_clear_while_either_leg_stressed(self):
        assert not ae.exit_conditions_clear(self.EXITS, {"vhi": 42.0, "spei_3": -1.4})
        assert not ae.exit_conditions_clear(self.EXITS, {"vhi": 36.0, "spei_3": -0.5})

    def test_clear_when_both_recover(self):
        assert ae.exit_conditions_clear(self.EXITS, {"vhi": 45.0, "spei_3": -0.4})

    def test_missing_field_keeps_alert_active(self):
        assert not ae.exit_conditions_clear(self.EXITS, {"vhi": 45.0})


class TestV3VnWaterConditioning:
    ALERT = {"threat_id": "drought_stress_alert", "family": "drought_stress",
             "severity": "alert", "market_impact": "x", "triggers": {}}

    def test_low_flows_escalate(self):
        out = ae._vn_water_adjust(dict(self.ALERT), "Dak Nong", {"Dak Nong": -42.0})
        assert out["severity"] == "critical"
        assert out["triggers"]["water_tbnn_pct"] == -42.0

    def test_healthy_flows_cap_critical(self):
        crit = {**self.ALERT, "threat_id": "severe_defoliation", "severity": "critical"}
        out = ae._vn_water_adjust(crit, "Dak Nong", {"Dak Nong": -5.0})
        assert out["severity"] == "alert"

    def test_unmapped_region_passes_through(self):
        out = ae._vn_water_adjust(dict(self.ALERT), "Gia Lai", {"Dak Nong": -42.0})
        assert out["severity"] == "alert"

    def test_non_drought_family_untouched(self):
        heat = {**self.ALERT, "family": "heat_stress", "severity": "alert"}
        out = ae._vn_water_adjust(heat, "Dak Nong", {"Dak Nong": -42.0})
        assert out["severity"] == "alert"
