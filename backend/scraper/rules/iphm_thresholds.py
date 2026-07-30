"""IPHM (Integrated Plant Health Management) v3 ruleset.

Authoritative source-of-truth for the agronomic alert engine. Each rule is a
declarative spec the engine in `scraper.agronomic_alerts` evaluates against
the live weather + VHI feeds. Threshold semantics:

  *_min:  the field's value must be >= the threshold for the condition to hold
  *_max:  the field's value must be <= the threshold for the condition to hold

Fields the engine recognises (must match keys produced by
`agronomic_alerts.extract_region_values`):

  spi_1, spi_3           Standardised Precipitation Index, monthly / 3-month
  spei_1, spei_3         SPEI (water-balance), monthly / 3-month
  vhi                    NOAA STAR Vegetation Health Index (0–100)
  tci                    NOAA STAR Thermal Condition Index (0–100; low = heat stress)
  temp_mean              Latest observed monthly mean temperature, °C
  temp_min               7-day forecast min temperature (worst-case across days), °C
  forecast_7d_rain       Sum of the next 7 days' forecast rain, mm
  forecast_hot_days      Days in the 7-day forecast with Tmax ≥ 34 °C (country-level)
  arabica_share          Region's arabica share of production, 0–1 (rust susceptibility)
  essm                   Latest surface soil-moisture fraction, 0–1 (where available)

Optional rule keys (all evaluated by the engine):
  origins           list[str]  ISO-3 country codes the rule applies to (default: all)
  months            list[int]  Calendar months 1-12 the rule applies to (default: all)
  family            str        Threat family: rules sharing a family form a severity
                               LADDER — only the highest tier that fires is published
                               for a region (default: the rule's threat_id)
  min_persist_days  int        Conditions must hold continuously this many days
                               before the alert is published (anti-flap; default 0)
  exit_conditions   dict       Hysteresis: once published, the alert stays active
                               until ALL exit conditions hold (same *_min/*_max
                               shape). Default: clears as soon as entry fails.

v3 changes (2026-07 threshold review):
  - drought ladder: watch → alert → critical tiers instead of a single cliff,
    with persistence gating and a hysteresis exit on the critical tier.
  - blossom_drop is phenology-scoped: one variant per origin, active only in
    that origin's flowering window (was: everywhere, year-round).
  - rust requires arabica presence (arabica_share ≥ 0.25) — robusta is
    substantially rust-resistant; the unscoped rule could false-fire for
    pure-robusta regions (e.g. Vietnam's Central Highlands).
  - NEW heat_stress family: fill-window hot spells (Brazil + Vietnam first),
    with a satellite-confirmed critical tier via TCI.
  - Vietnam drought severities are additionally conditioned on reservoir /
    river flows (vn_water_levels tbnn_pct) — applied by the engine, not here.

Severity tiers (strict lowercase to match the existing quant-signal
convention; presentation layer applies any title-casing for display):
  "watch"     — informational; visually contained
  "alert"     — act-soon
  "critical"  — act-now
"""

IPHM_RULES: list[dict] = [
    # ── Drought-stress ladder (family: drought_stress) ───────────────────────
    # Two independent witnesses at every tier: the met-model water balance
    # (SPEI-3) AND the satellite canopy read (VHI). Backtest note (see
    # backend/scripts/backtest_drought_alerts.py): on the 1995-2024 seeds the
    # met leg alone marks a mid-single-digit % of region-months at the
    # critical threshold — the VHI conjunction and the persistence gate are
    # what keep the published critical tier rare.
    {
        "threat_id": "drought_stress_watch",
        "family": "drought_stress",
        "name": "Vegetative Drought Stress — early",
        "conditions": {"vhi_max": 45.0, "spei_3_max": -1.0},
        "severity": "watch",
        "min_persist_days": 7,
        "market_impact": "Early canopy stress. Yield impact not locked in yet — monitor.",
    },
    {
        "threat_id": "drought_stress_alert",
        "family": "drought_stress",
        "name": "Drought Stress — established",
        "conditions": {"vhi_max": 40.0, "spei_3_max": -1.2},
        "severity": "alert",
        "min_persist_days": 7,
        "market_impact": "Sustained moisture deficit with visible canopy stress. Bean-fill risk building.",
    },
    {
        "threat_id": "severe_defoliation",       # id kept from v1 for consumers
        "family": "drought_stress",
        "name": "Severe Defoliation / Bean Shrinkage",
        "conditions": {"vhi_max": 35.0, "spei_3_max": -1.5},
        "severity": "critical",
        "min_persist_days": 10,
        # hysteresis: stays active until BOTH the canopy and the water balance recover
        "exit_conditions": {"vhi_min": 40.0, "spei_3_min": -1.0},
        "market_impact": "Irreversible yield reduction likely. Bean size shrinkage.",
    },

    # ── Flowering disruption / blossom drop — phenology-scoped variants ─────
    # The drought-then-sudden-rain sequence only matters inside each origin's
    # flowering window. Same conditions everywhere; only the calendar differs.
    {
        "threat_id": "blossom_drop", "family": "blossom_drop",
        "name": "Flowering Disruption / Blossom Drop",
        "origins": ["BRA"], "months": [8, 9, 10, 11],          # main flowering Sep–Nov (+Aug shoulder)
        "conditions": {"spei_3_max": -1.0, "forecast_7d_rain_min": 50.0},
        "severity": "watch",
        "market_impact": "Potential false flowering or dropped blossoms. Harvest delay.",
    },
    {
        "threat_id": "blossom_drop", "family": "blossom_drop",
        "name": "Flowering Disruption / Blossom Drop",
        "origins": ["VNM"], "months": [1, 2, 3, 4],            # post-dry-season flowering
        "conditions": {"spei_3_max": -1.0, "forecast_7d_rain_min": 50.0},
        "severity": "watch",
        "market_impact": "Potential false flowering or dropped blossoms. Harvest delay.",
    },
    {
        "threat_id": "blossom_drop", "family": "blossom_drop",
        "name": "Flowering Disruption / Blossom Drop",
        "origins": ["COL"], "months": [1, 2, 3, 8, 9, 10],     # two passes (principal + mitaca)
        "conditions": {"spei_3_max": -1.0, "forecast_7d_rain_min": 50.0},
        "severity": "watch",
        "market_impact": "Potential false flowering or dropped blossoms. Harvest delay.",
    },
    {
        "threat_id": "blossom_drop", "family": "blossom_drop",
        "name": "Flowering Disruption / Blossom Drop",
        "origins": ["HND"], "months": [3, 4, 5],               # first-rains flowering
        "conditions": {"spei_3_max": -1.0, "forecast_7d_rain_min": 50.0},
        "severity": "watch",
        "market_impact": "Potential false flowering or dropped blossoms. Harvest delay.",
    },
    {
        "threat_id": "blossom_drop", "family": "blossom_drop",
        "name": "Flowering Disruption / Blossom Drop",
        "origins": ["ETH"], "months": [2, 3, 4],               # Feb–Apr flowering
        "conditions": {"spei_3_max": -1.0, "forecast_7d_rain_min": 50.0},
        "severity": "watch",
        "market_impact": "Potential false flowering or dropped blossoms. Harvest delay.",
    },
    {
        "threat_id": "blossom_drop", "family": "blossom_drop",
        "name": "Flowering Disruption / Blossom Drop",
        "origins": ["UGA"], "months": [2, 3, 4, 8, 9, 10],     # bimodal rains
        "conditions": {"spei_3_max": -1.0, "forecast_7d_rain_min": 50.0},
        "severity": "watch",
        "market_impact": "Potential false flowering or dropped blossoms. Harvest delay.",
    },

    # ── Wet tail: fungal / leaf rust (arabica only) ──────────────────────────
    # Hemileia vastatrix is an arabica disease; robusta is substantially
    # resistant. arabica_share comes from the per-region production split.
    {
        "threat_id": "fungal_rust_outbreak",
        "family": "fungal_rust_outbreak",
        "name": "Elevated Fungal / Leaf Rust Risk",
        "conditions": {
            "spi_1_min":         1.5,     # Extremely wet 1-month rolling
            "temp_mean_min":    21.0,     # Ideal fungal incubation temp
            "temp_mean_max":    25.0,
            "arabica_share_min": 0.25,    # region actually grows arabica
        },
        "severity": "alert",
        "market_impact": "High probability of bean defects and yield reduction.",
    },

    # ── NEW: heat stress during cherry fill (family: heat_stress) ────────────
    # Sustained forecast heat in the bean-fill window. The 7-day Tmax feed is
    # per-origin (not per-region) — coarse but the right sign; TCI (satellite
    # thermal condition) escalates to critical once the per-province feed
    # carries it.
    {
        "threat_id": "heat_stress", "family": "heat_stress",
        "name": "Cherry-Fill Heat Spell",
        "origins": ["BRA"], "months": [12, 1, 2, 3, 4],        # fill Dec–Apr
        "conditions": {"forecast_hot_days_min": 4, "spei_1_max": -0.3},
        "severity": "alert",
        "min_persist_days": 3,
        "market_impact": "Sustained ≥34 °C days during bean fill on a dry balance — bean-mass risk.",
    },
    {
        "threat_id": "heat_stress", "family": "heat_stress",
        "name": "Cherry-Fill Heat Spell",
        "origins": ["VNM"], "months": [5, 6, 7, 8, 9, 10],     # fill May–Oct
        "conditions": {"forecast_hot_days_min": 4, "spei_1_max": -0.3},
        "severity": "alert",
        "min_persist_days": 3,
        "market_impact": "Sustained ≥34 °C days during bean fill on a dry balance — bean-mass risk.",
    },
    {
        "threat_id": "heat_stress_severe", "family": "heat_stress",
        "name": "Cherry-Fill Heat Spell — satellite-confirmed",
        "origins": ["BRA", "VNM"], "months": [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        "conditions": {"forecast_hot_days_min": 4, "spei_1_max": -0.3, "tci_max": 25.0},
        "severity": "critical",
        "min_persist_days": 5,
        "market_impact": "Heat spell confirmed by satellite thermal stress — bean-mass loss likely.",
    },
]
