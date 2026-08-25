"""ENSO crop-risk matrix: phase + intensity → per-growing-region risk level.

Cross-references the ENSO phase/intensity (from enso.derive_enso_phase) with a
static per-region effect table and the region centroids already maintained in
scripts/fetch_origin_weather.ORIGINS, producing Red/Amber/Green risk pins for
the map and a summary for the /enso tab. Pure (no I/O); the exporter feeds it
the current phase and writes the pins JSON.

Severity scale per (region, phase): 2 = major coffee-yield threat (drought at
flowering, frost), 1 = moderate (excess rain / disease / flood), 0 = benign or
favourable. A Strong/Extreme phase bumps an at-risk region one level hotter; a
favourable region (sev 0) stays green regardless of intensity.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from fetch_origin_weather import ORIGINS  # noqa: E402

COUNTRY_LABEL = {
    "brazil": "Brazil", "colombia": "Colombia", "honduras": "Honduras",
    "indonesia": "Indonesia", "uganda": "Uganda", "ethiopia": "Ethiopia",
    "vn": "Vietnam",
}

# Per-region effect per active phase: {origin: {region: {phase: (driver, severity)}}}.
# Grounded in the per-origin _*_ENSO_IMPACT prose already in the exporters.
_EFFECTS: dict[str, dict[str, dict[str, tuple[str, int]]]] = {
    "brazil": {
        "Sul de Minas":   {"el-nino": ("Drought", 2),    "la-nina": ("Wet (favourable)", 0)},
        "Cerrado":        {"el-nino": ("Drought", 2),    "la-nina": ("Wet (favourable)", 0)},
        "Paraná":         {"el-nino": ("Frost risk", 2), "la-nina": ("Reduced frost", 0)},
        "Espírito Santo": {"el-nino": ("Excess rain", 1), "la-nina": ("Drought", 2)},
    },
    "colombia": {
        r: {"el-nino": ("Drought", 2), "la-nina": ("Excess rain / disease", 1)}
        for r in ("Huila", "Antioquia", "Cauca", "Caldas", "Nariño")
    },
    "honduras": {
        r: {"el-nino": ("Drought", 2), "la-nina": ("Flood / landslide", 1)}
        for r in ("El Paraíso", "Copán", "Santa Bárbara", "Montecillos", "Agalta")
    },
    "indonesia": {
        r: {"el-nino": ("Drought", 2), "la-nina": ("Excess rain / disease", 1)}
        for r in ("Lampung", "Gayo", "Java", "Toraja", "Flores")
    },
    "uganda": {
        r: {"el-nino": ("Drought / heat", 2), "la-nina": ("Flooding risk", 1)}
        for r in ("Greater Masaka", "Central", "Western", "Busoga",
                  "Mt Elgon", "West Nile", "Rwenzori")
    },
    "ethiopia": {
        "Sidama/Yirgacheffe": {"el-nino": ("Drought", 2), "la-nina": ("Wet (favourable)", 0)},
        "Jimma": {"el-nino": ("Drought", 2), "la-nina": ("Excess rain", 1)},
        "Limu":  {"el-nino": ("Drought", 2), "la-nina": ("Excess rain", 1)},
        "Kaffa": {"el-nino": ("Drought", 2), "la-nina": ("Fungal disease", 1)},
        "Harrar": {"el-nino": ("Drought", 2), "la-nina": ("Excess moisture", 1)},
    },
    "vn": {
        r: {"el-nino": ("Drought (Robusta)", 2), "la-nina": ("Excess rain at harvest", 1)}
        for r in ("Dak Lak", "Lam Dong", "Dak Nong", "Gia Lai", "Kon Tum")
    },
}

_LEVEL_COLOR = {"high": "#dc2626", "moderate": "#f59e0b", "low": "#16a34a"}


def _effective_severity(base: int, intensity: str, status: str = "official") -> int:
    """A Strong/Extreme phase escalates an at-risk region; benign stays benign.

    `status` is the confidence in the phase itself (see scraper.enso). While an
    event is only "emerging" — the ocean has clearly turned but NOAA's
    five-season rule has not yet been met — risk is capped at amber. Being
    early then costs a warning colour instead of a false red, which is the
    trade this map should be making: the alternative, waiting for
    confirmation, leaves every region green through the flowering window.
    """
    if base <= 0:
        return 0
    if status == "emerging":
        return min(base, 1)
    if intensity in ("Strong", "Extreme"):
        return base + 1
    return base


def _level(sev: int) -> str:
    if sev >= 2:
        return "high"
    if sev == 1:
        return "moderate"
    return "low"


def risk_for_region(origin: str, region: str, phase: str, intensity: str,
                    status: str = "official") -> dict:
    """{level, color, driver, severity, status} for one region under the given
    ENSO state."""
    eff = _EFFECTS.get(origin, {}).get(region, {})
    if phase == "neutral" or phase not in eff:
        driver, base = "Near-normal", 0
    else:
        driver, base = eff[phase]
    sev = _effective_severity(base, intensity, status)
    level = _level(sev)
    out = {"level": level, "color": _LEVEL_COLOR[level], "driver": driver, "severity": sev}
    # Carry the confidence onto the pin so the map can say "developing" rather
    # than presenting an unconfirmed event with the same weight as a confirmed
    # one. Only meaningful where there is actually a risk to qualify.
    if status == "emerging" and base > 0:
        out["status"] = "emerging"
        out["driver"] = f"{driver} (developing)"
    return out


def build_risk_pins(phase: str, intensity: str, status: str = "official") -> list[dict]:
    """Risk pin per growing region: name, country, lat/lon (from ORIGINS), risk."""
    pins: list[dict] = []
    for origin, regions in ORIGINS.items():
        country = COUNTRY_LABEL.get(origin, origin.title())
        effects = _EFFECTS.get(origin, {})
        for reg in regions:
            name = reg["name"]
            if name not in effects:
                continue
            risk = risk_for_region(origin, name, phase, intensity, status)
            pins.append({
                "region": name,
                "country": country,
                "lat": reg["lat"],
                "lon": reg["lon"],
                **risk,
            })
    return pins


def risk_summary(pins: list[dict]) -> dict:
    """Count of regions at each level (for the /enso tab legend/header)."""
    out = {"high": 0, "moderate": 0, "low": 0}
    for p in pins:
        out[p["level"]] = out.get(p["level"], 0) + 1
    return out
