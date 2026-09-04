"""ENSO crop-risk: project the event, land it on the calendar, score the phase.

The old version answered one question — "is this region dry or wet under this
phase?" — and coloured the pin from a hand-typed table. Three things were
wrong with that, and this module fixes all three.

1 · THE TABLE WAS ASSERTED, NOT MEASURED
    It said El Niño means drought across all five Ugandan belts. Measured
    against this repo's own rainfall history, every belt is WETTER in El Niño
    and drier in La Niña — the sign was inverted. The effect table now comes
    from enso_teleconnection.json, computed from data, carrying its own
    evidence (n events, consistency) so a weak signal cannot masquerade as a
    strong one.

2 · A RAINFALL ANOMALY HAS NO MEANING WITHOUT A CROP PHASE
    Uganda again: El Niño's extra Oct–Dec rain is not a gift, because Oct–Feb
    is the MAIN-CROP HARVEST. The same water in Apr–Jun, at main-crop
    flowering, would be genuinely positive. Risk is anomaly × phase, and
    crop_calendar.PHASE_RESPONSE supplies the second half — rain at harvest is
    a severity-2 quality event, rain at fill is benign.

3 · THE EVENT HAS A DURATION AND A LAG, NOT JUST A STATE
    An El Niño arriving in two months, peaking, and decaying over the
    following six touches specific calendar months — and the WEATHER response
    is offset from the SST signal by a region-specific lag (measured: 1 month
    at Mt Elgon, 2 in Dak Lak). So the question is not "is there an El Niño"
    but "which crop phases will its weather actually land on". That is what
    `project_event_months` and `affected_months` compute.

Severity: 2 = major yield or quality threat, 1 = moderate, 0 = benign. A
Strong/Extreme event escalates an at-risk phase; an event that is only
emerging is capped at amber upstream.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from scraper.crop_calendar import CROP_CALENDAR, PHASE_RESPONSE

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from fetch_origin_weather import ORIGINS  # noqa: E402

DATA = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"
TELECONNECTION_PATH = DATA / "enso_teleconnection.json"

COUNTRY_LABEL = {
    "brazil": "Brazil", "colombia": "Colombia", "honduras": "Honduras",
    "indonesia": "Indonesia", "uganda": "Uganda", "ethiopia": "Ethiopia",
    "vn": "Vietnam",
}

_LEVEL_COLOR = {"high": "#dc2626", "moderate": "#f59e0b", "low": "#16a34a"}

#: A departure smaller than this is not worth colouring a pin over, whatever
#: the phase. Rainfall is noisy, and even on the full record a phase composite
#: rests on 4-14 occurrences, not on the 380 months behind the region gate.
MIN_ANOMALY_PCT = 8.0
#: Below this share of events agreeing with the mean, the composite is
#: cancellation rather than signal.
MIN_CONSISTENCY = 0.6
#: Region-level gate. If a region's rainfall barely correlates with the ONI at
#: ANY lag, it has no measurable ENSO relationship and no crop phase of it
#: should be coloured, however tidy a single phase composite happens to look.
#:
#: This was justified as a natural break in the distribution. On eleven years
#: that was true. On the full 1995-2026 record, measured across all 36 regions
#: on a comparable span for the first time, it is NOT: |r| runs 0.05 / 0.10 /
#: 0.17 / 0.30 / 0.47 (min, p25, median, p75, max) with no gap wider than 0.03
#: anywhere near 0.20. Fifteen of 36 clear it, and they do so continuously —
#: 0.19, 0.21, 0.22 are neighbours, not sides of a divide.
#:
#: So it is a MATERIALITY bar, not a significance one, and it is deliberately
#: the stricter of the two. With ~380 monthly pairs, significance arrives at
#: r ≈ 0.10 (two-sided, p<.05) — on eleven years it took 0.17, which is why
#: the shorter record made this threshold look like a break. Twenty-six of 36
#: regions are now significant. But r = 0.20 is ENSO explaining 4% of monthly
#: rainfall variance, and below that a pin coloured from a phase composite is
#: coloured on something that barely moves with the ocean. Real, and still not
#: worth a trading decision.
#:
#: KNOWN LIMIT, stated because it changes how a dark pin should be read: this
#: correlates every calendar month against the ONI, so a signal confined to
#: one season is diluted by the eleven months it does not touch. That is the
#: likely reason all four Brazilian and all five Honduran regions sit below
#: the bar. "No measurable ENSO link" here means no year-round monthly link,
#: which is the honest claim this measurement supports — not that the region
#: is known to be ENSO-proof.
MIN_LAG_R = 0.20
#: A real teleconnection pushes the two phases in OPPOSITE directions. When El
#: Niño and La Niña both come out dry, whatever is moving the rain is not
#: ENSO — it is a trend, or small-n coincidence. Paraná is the case in point:
#: -11.0% under El Niño and -9.6% under La Niña at cherry fill.
MIN_OPPOSITE_PCT = 5.0
#: How far ahead the projection looks. The analogue overlay supplies six
#: months forward; beyond that the plume is wider than the answer.
FORWARD_MONTHS = 6


def _load_teleconnection() -> dict:
    try:
        return json.loads(TELECONNECTION_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _level(sev: int) -> str:
    if sev >= 2:
        return "high"
    if sev == 1:
        return "moderate"
    return "low"


def _add_months(year: int, month: int, n: int) -> tuple[int, int]:
    idx = (year * 12 + (month - 1)) + n
    return idx // 12, idx % 12 + 1


def project_event_months(
    current: tuple[int, int], oni_now: float, forward: list[float] | None = None,
    threshold: float = 0.5,
) -> list[tuple[int, int]]:
    """The (year, month) pairs this ENSO event is expected to be ACTIVE.

    `forward` is the projected ONI path — in practice the analogue mean, which
    is what the /enso tab already plots. The event runs from now until the
    projection falls back inside the threshold, which is what gives the map a
    duration instead of a snapshot.
    """
    if abs(oni_now) < threshold:
        return []
    warm = oni_now > 0
    months = [current]
    for i, v in enumerate(forward or [], start=1):
        if i > FORWARD_MONTHS:
            break
        # Decay ends the event the moment the projection crosses back.
        if (v < threshold) if warm else (v > -threshold):
            break
        months.append(_add_months(*current, i))
    return months


def affected_months(event_months: list[tuple[int, int]], lag: int) -> set[int]:
    """Calendar months whose WEATHER the event is expected to drive.

    The SST signal leads the rainfall response by a region-specific lag, so an
    event active in Aug–Jan with a 3-month lag lands on Nov–Apr weather.
    """
    return {_add_months(y, m, lag)[1] for y, m in event_months}


def _score(bucket: dict, phase: str, intensity: str,
           opposite: dict | None = None) -> tuple[int, str, dict]:
    """Severity + driver text for one measured bucket on one crop phase."""
    anomaly = bucket.get("anomaly_pct")
    evidence = {
        "anomaly_pct": anomaly, "n": bucket.get("n", 0),
        "consistency": bucket.get("consistency"),
    }
    if anomaly is None or not bucket.get("usable"):
        return 0, "Too few past events to score", evidence
    if (bucket.get("consistency") or 0) < MIN_CONSISTENCY:
        return 0, "Past events disagree — no usable signal", evidence
    if abs(anomaly) < MIN_ANOMALY_PCT:
        return 0, "Near-normal rainfall expected", evidence

    # Does the opposite phase disagree, as a real teleconnection should?
    opp = (opposite or {}).get("anomaly_pct")
    if (opp is not None and (opposite or {}).get("usable")
            and abs(opp) >= MIN_OPPOSITE_PCT and (opp >= 0) == (anomaly >= 0)):
        return 0, "El Niño and La Niña move it the same way — not an ENSO signal", evidence

    direction = "wet" if anomaly > 0 else "dry"
    sev, text = PHASE_RESPONSE[phase][direction]
    if sev > 0 and intensity in ("Strong", "Extreme"):
        sev += 1
    return sev, text, evidence


def _worst_key(hit: dict) -> tuple:
    """Rank one phase hit against another. Severity first, then EVIDENCE.

    Severity alone leaves ties, and `max` resolves a tie by iteration order —
    which is the order the phases are looped, not anything about the data. On
    Uganda's Mt Elgon that handed the pin to a −12.9% El Niño deficit measured
    over four events in an INFERRED fill window, ahead of a +41.1% surplus over
    ten events in the published main-harvest window. Same severity, nothing
    like the same evidence, and the pin read "Drought at cherry fill" while the
    region's actual, well-measured El Niño story is rain on the harvest.

    So after severity: a published window outranks an arithmetic one, then the
    larger anomaly, then the more consistent, then the better-attested. Every
    tier is a statement about how much the number is worth, never about which
    phase we would rather report.
    """
    return (
        hit.get("severity") or 0,
        0 if hit.get("inferred") else 1,
        abs(hit.get("anomaly_pct") or 0.0),
        hit.get("consistency") or 0.0,
        hit.get("n") or 0,
    )


def region_risk(origin: str, region: str, phase: str, intensity: str,
                months: set[int], teleconnection: dict,
                status: str = "official") -> dict:
    """Risk for one region: score every crop phase the event's weather lands
    on, and report the worst — plus the full phase breakdown."""
    if phase == "neutral" or not months:
        return {"level": "low", "color": _LEVEL_COLOR["low"],
                "driver": "Near-normal", "severity": 0, "phase_hits": []}

    rec = (teleconnection.get("regions") or {}).get(f"{origin}|{region}") or {}
    cal = CROP_CALENDAR.get(origin) or {"cycles": []}
    hits: list[dict] = []

    # If the region's rainfall does not track the ONI at any lag, nothing about
    # it is an ENSO risk. Stated on the pin rather than left as a quiet green.
    lag_r = rec.get("lag_r")
    if lag_r is not None and abs(lag_r) < MIN_LAG_R:
        return {"level": "low", "color": _LEVEL_COLOR["low"], "severity": 0,
                "driver": f"No measurable ENSO link here (r={lag_r:+.2f})",
                "phase_hits": [], "lag_months": rec.get("lag_months"), "lag_r": lag_r}

    for cycle in cal["cycles"]:
        for ph in ("flowering", "fruit_fill", "harvest"):
            window = cycle.get(ph) or []
            # Keep the window's own chronological order — a Nov–Jan harvest
            # reads as [11, 12, 1], not the numerically sorted [1, 11, 12].
            overlap = [m for m in window if m in months]
            if not overlap:
                continue
            all_phases = (rec.get("phases") or {}).get(f"{cycle['label']}/{ph}") or {}
            measured = all_phases.get(phase) or {}
            other = "la-nina" if phase == "el-nino" else "el-nino"
            sev, text, evidence = _score(measured, ph, intensity, all_phases.get(other))
            hits.append({
                "cycle": cycle["label"], "phase": ph, "months": overlap,
                "severity": sev, "driver": text,
                # Whether this cycle's window is published or arithmetic. It
                # breaks ties below, and the pin should be able to say so.
                "inferred": bool(all_phases.get("inferred")),
                **evidence,
            })

    scoring = [h for h in hits if h["severity"] > 0]
    if not scoring:
        worst_sev, driver = 0, "No phase at risk in the projected window"
    else:
        worst = max(scoring, key=_worst_key)
        worst_sev = worst["severity"]
        driver = f"{worst['driver']} ({worst['cycle']})"

    if status == "emerging":
        # Unconfirmed events warn rather than shout — see scraper.enso.
        worst_sev = min(worst_sev, 1)
        if worst_sev:
            driver = f"{driver} — developing"

    # Ranked, not loop-ordered: the hit that drove the colour reads first in
    # the popup, and the reader sees the ranking that produced it.
    hits.sort(key=_worst_key, reverse=True)

    level = _level(worst_sev)
    out = {"level": level, "color": _LEVEL_COLOR[level], "driver": driver,
           "severity": worst_sev, "phase_hits": hits,
           "lag_months": rec.get("lag_months"), "lag_r": rec.get("lag_r")}
    if status == "emerging" and worst_sev:
        out["status"] = "emerging"
    return out


def build_risk_pins(phase: str, intensity: str, status: str = "official",
                    event_months: list[tuple[int, int]] | None = None,
                    teleconnection: dict | None = None) -> list[dict]:
    """Risk pin per growing region: name, country, lat/lon, risk, phase hits."""
    tele = teleconnection if teleconnection is not None else _load_teleconnection()
    pins: list[dict] = []
    for origin, regions in ORIGINS.items():
        if origin not in CROP_CALENDAR:
            continue
        country = COUNTRY_LABEL.get(origin, origin.title())
        for reg in regions:
            name = reg["name"]
            rec = (tele.get("regions") or {}).get(f"{origin}|{name}")
            if rec is None:
                # No measured response — usually because the region was added
                # to ORIGINS but its weather file has not been rebuilt with the
                # new belt names yet. Emit the pin anyway, flagged: dropping it
                # would quietly shrink the map, and a region that vanishes is
                # indistinguishable from a region at no risk.
                pins.append({
                    "region": name, "country": country,
                    "lat": reg["lat"], "lon": reg["lon"],
                    "level": "low", "color": _LEVEL_COLOR["low"], "severity": 0,
                    "driver": "No measured ENSO response for this region yet",
                    "measured": False, "phase_hits": [],
                })
                continue
            months = affected_months(event_months or [], rec.get("lag_months") or 0)
            risk = region_risk(origin, name, phase, intensity, months, tele, status)
            pins.append({"region": name, "country": country,
                         "lat": reg["lat"], "lon": reg["lon"], "measured": True, **risk})
    return pins


def unmeasured(pins: list[dict]) -> list[str]:
    """"Country · Region" for every pin with no measured response behind it."""
    return [f"{p['country']} · {p['region']}" for p in pins if not p.get("measured", True)]


def risk_summary(pins: list[dict]) -> dict:
    """Count of regions at each level (for the /enso tab legend/header)."""
    out = {"high": 0, "moderate": 0, "low": 0}
    for p in pins:
        out[p["level"]] = out.get(p["level"], 0) + 1
    return out
