"""Shared ENSO (El Niño / La Niña) classification from a NOAA ONI history.

Previously copy-pasted (logically identical) into export_static_json.py and
every per-origin exporter (colombia/indonesia/ethiopia/uganda/honduras). Kept
here once so a threshold change lands in a single place.

WHY THIS IS NOT JUST NOAA'S RULE
--------------------------------
NOAA declares an ENSO *event* when the ONI has sat past ±0.5 for five
consecutive overlapping seasons. That rule exists to label the historical
record consistently, and it is deliberately retrospective: it confirms an
event four to five months after onset.

Used as the input to a crop-risk map, that lag is the whole ballgame. In
August 2026 the ONI read −0.39 → 0.11 → 0.46 → 0.95 → **1.39** and the Niño 3.4
SST anomaly was **+2.6 °C**, and the five-month rule still said "neutral" — so
every growing region on the map was painted green through Brazil's Sep–Nov
flowering window and the Central Highlands dry-season set-up. The map was
green precisely when it needed to be red.

So this module reports two things instead of one:

    official_phase — NOAA's five-season rule. Correct for labelling an event.
    phase + status — what the ocean is doing NOW, which is what a risk map,
                     a flowering window and a freight book actually care about.

`status` is "official" once NOAA's rule is met, "emerging" while an event is
clearly developing but not yet confirmable, and "neutral" otherwise. Downstream
the map treats "emerging" as amber and reserves red for a confirmed event, so
being early costs a warning colour rather than a false alarm.
"""
from __future__ import annotations

ONI_THRESHOLD = 0.5
#: NOAA's rule — five consecutive overlapping seasons past the threshold.
OFFICIAL_MONTHS = 5
#: Two consecutive months past ±0.5 is a developing event, not month-to-month
#: noise. One month can wobble across the line; two in the same direction is a
#: trend every operational ENSO desk already treats as actionable.
EMERGING_MONTHS = 2
#: A single month this far past the threshold is not noise either — an ONI of
#: ±1.0 has never appeared and then vanished within a month in the 1950→ record.
SINGLE_MONTH_STRONG = 1.0
#: Niño 3.4 weekly SST anomalies lead the ONI (which is a lagged 3-month mean),
#: so they can raise "neutral" to "emerging" before the ONI catches up.
NINO34_THRESHOLD = 0.5
NINO34_WEEKS = 4


def oni_to_dots(oni: float) -> int:
    """Map an ONI value to a 1–4 intensity-dot count (by |ONI|)."""
    a = abs(oni)
    if a >= 2.0:
        return 4
    if a >= 1.5:
        return 3
    if a >= 1.0:
        return 2
    return 1


def _intensity(oni: float) -> str:
    a = abs(oni)
    if a >= 2.0:
        return "Extreme"
    if a >= 1.5:
        return "Strong"
    if a >= 1.0:
        return "Moderate"
    return "Weak"


def _run_past(values: list[float], threshold: float, n: int, warm: bool) -> bool:
    """True when the last `n` values are all past `threshold` in one direction."""
    if len(values) < n:
        return False
    tail = values[-n:]
    return all(v >= threshold for v in tail) if warm else all(v <= -threshold for v in tail)


def _clean(oni_history: list) -> list[dict]:
    """Observed entries only. The legacy 'forecast' key is stripped for
    backwards compat with older DB rows; NOAA's own preliminary values are
    observation-based and are kept."""
    entries = [p for p in oni_history if not p.get("forecast")]
    return entries or list(oni_history)


def classify_enso(oni_history: list, nino34_weekly: list | None = None) -> dict:
    """Full ENSO state: what NOAA would label, and what the ocean is doing now.

    `nino34_weekly` is the optional weekly SST-anomaly series from
    enso_indices.json ({"week_ending", "sst_anomaly"}). It leads the ONI, so it
    can raise a neutral ONI read to "emerging" — never the other way round: it
    can add urgency, it cannot cancel it.
    """
    entries = _clean(oni_history)
    if not entries:
        return {
            "phase": "neutral", "status": "neutral", "intensity": "Weak",
            "oni": 0.0, "official_phase": "neutral", "basis": "no ONI history",
        }

    vals = [p["value"] for p in entries]
    current = vals[-1]

    official = "neutral"
    if _run_past(vals, ONI_THRESHOLD, OFFICIAL_MONTHS, warm=True):
        official = "el-nino"
    elif _run_past(vals, ONI_THRESHOLD, OFFICIAL_MONTHS, warm=False):
        official = "la-nina"

    if official != "neutral":
        phase, status = official, "official"
        basis = f"ONI past ±{ONI_THRESHOLD} for {OFFICIAL_MONTHS} months (NOAA event rule)"
    elif _run_past(vals, ONI_THRESHOLD, EMERGING_MONTHS, warm=True):
        phase, status = "el-nino", "emerging"
        basis = f"ONI past +{ONI_THRESHOLD} for {EMERGING_MONTHS} months, NOAA rule not yet met"
    elif _run_past(vals, ONI_THRESHOLD, EMERGING_MONTHS, warm=False):
        phase, status = "la-nina", "emerging"
        basis = f"ONI past -{ONI_THRESHOLD} for {EMERGING_MONTHS} months, NOAA rule not yet met"
    elif abs(current) >= SINGLE_MONTH_STRONG:
        phase = "el-nino" if current > 0 else "la-nina"
        status, basis = "emerging", f"latest ONI {current:+.2f} past ±{SINGLE_MONTH_STRONG}"
    else:
        phase, status, basis = "neutral", "neutral", "ONI within ±0.5"

    # Niño 3.4 leads the ONI — let it escalate a neutral read, never soften one.
    if status == "neutral" and nino34_weekly:
        sst = [w["sst_anomaly"] for w in nino34_weekly if w.get("sst_anomaly") is not None]
        if _run_past(sst, NINO34_THRESHOLD, NINO34_WEEKS, warm=True):
            phase, status = "el-nino", "emerging"
            basis = f"Niño 3.4 past +{NINO34_THRESHOLD} °C for {NINO34_WEEKS} weeks; ONI still lagging"
        elif _run_past(sst, NINO34_THRESHOLD, NINO34_WEEKS, warm=False):
            phase, status = "la-nina", "emerging"
            basis = f"Niño 3.4 past -{NINO34_THRESHOLD} °C for {NINO34_WEEKS} weeks; ONI still lagging"

    return {
        "phase": phase,
        "status": status,
        "intensity": _intensity(current),
        "oni": current,
        "official_phase": official,
        "basis": basis,
    }


def derive_enso_phase(oni_history: list) -> tuple:
    """(phase, intensity, current_oni) — the long-standing 3-tuple contract.

    Kept so the six exporters that unpack it need no change. `classify_enso`
    is the richer entry point and carries the status the map needs.
    """
    c = classify_enso(oni_history)
    return c["phase"], c["intensity"], c["oni"]


def current_event_peak(oni_history: list, phase: str) -> str:
    """Month label of the peak of the CURRENT event, not of all recorded time.

    The old code took the extremum over the whole published history, so during
    a developing El Niño it happily reported the peak of the *previous* La Niña
    — "peak_month: Nov-25" at −0.61 while the ONI was climbing through +1.39.
    """
    entries = _clean(oni_history)
    if not entries or phase == "neutral":
        return ""
    warm = phase == "el-nino"
    run: list[dict] = []
    for p in reversed(entries):
        v = p["value"]
        if (v > 0) if warm else (v < 0):
            run.append(p)
        else:
            break
    if not run:
        return ""
    return max(run, key=lambda p: abs(p["value"])).get("month", "")
