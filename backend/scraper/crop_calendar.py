"""Per-origin coffee crop calendar: when each phase actually happens.

The ENSO risk map used to ask one question — "is this region dry or wet under
this phase?" — and colour the pin from the answer. That is not enough to trade
on, because the SAME rainfall anomaly is good, neutral or ruinous depending on
what the tree is doing that month.

Uganda is the clean example. El Niño brings ABOVE-normal Oct–Dec rain there
(measured: +18% to +69% across the five belts). Read as "wet = favourable"
that looks like good news. But Oct–Dec is Uganda's MAIN-CROP HARVEST — so the
rain lands on cherries that need to dry. It is a quality and drying risk, not
a yield gift. The same water in Apr–Jun, the main-crop flowering window, would
be genuinely positive.

So risk = anomaly × phase, and this module supplies the phase half.

SOURCES
Flowering windows come from rules/iphm_thresholds.py, which already drives the
blossom-drop rules. Fruit-fill for Brazil and Vietnam is from the same file's
cherry-fill heat-stress rules. Harvest windows and the remaining fill windows
come from the per-origin exporters' own harvest_cal blocks:

    export_ethiopia.py   main Oct-Jan harvest / Feb-Apr flowering, second crop
    export_honduras.py   harvest Oct–Feb, flowering Apr–Jun, development Jul–Sep
    export_uganda.py     main Oct-Feb harvest / Apr-Jun flowering; fly crop inverted
    export_colombia.py   main Oct–Jan harvest; mitaca Apr–Jun, flowering Sep–Oct
    export_indonesia.py  per-island harvest/flowering windows

Fill windows not stated in a source are marked `fill_inferred` — they sit
between that cycle's flowering and its harvest, which is arithmetic rather
than agronomy, but it should be visible that nobody published them.
"""
from __future__ import annotations

PHASES = ("flowering", "fruit_fill", "harvest")

#: What a wet or dry anomaly DOES, per phase: (severity, driver text).
#: Severity 2 is a major yield or quality threat, 1 moderate, 0 benign.
#: These are directional agronomy, not statistics — the measured composite
#: supplies the sign and size, this supplies the meaning.
PHASE_RESPONSE: dict[str, dict[str, tuple[int, str]]] = {
    "flowering": {
        # Coffee needs a dry spell then a soaking to set blossom. Too much rain
        # scatters flowering into uneven passes and drops blossom; too little
        # means the set never happens at all.
        "wet": (1, "Rain through flowering — blossom drop, uneven set"),
        "dry": (2, "Drought at flowering — failed set"),
    },
    "fruit_fill": {
        # Filling wants steady moisture. Wet is broadly fine (disease aside);
        # a deficit here shrinks beans and drops cherries outright.
        "wet": (0, "Wet through cherry fill — favourable"),
        "dry": (2, "Drought at cherry fill — bean size, cherry drop"),
    },
    "harvest": {
        # Picking and drying want it dry. Rain on the harvest is the classic
        # quality event: delayed picking, stalled patios, mould, fermentation
        # defects — worst for naturals, which dry on the cherry.
        "wet": (2, "Rain through harvest — drying, mould, defects"),
        "dry": (0, "Dry harvest — clean drying"),
    },
}


def _m(*months: int) -> list[int]:
    return list(months)


#: origin key → cycles. Keys match scripts/fetch_origin_weather.ORIGINS.
CROP_CALENDAR: dict[str, dict] = {
    "brazil": {
        "cycles": [{
            "label": "main",
            "flowering": _m(9, 10, 11),
            "fruit_fill": _m(12, 1, 2, 3, 4),
            "harvest": _m(5, 6, 7, 8),
        }],
        "source": "iphm_thresholds flowering [8-11] + cherry-fill [12-4]; harvest May–Aug",
    },
    "colombia": {
        "cycles": [
            {"label": "principal", "flowering": _m(1, 2, 3), "fruit_fill": _m(4, 5, 6, 7, 8, 9),
             "harvest": _m(10, 11, 12, 1), "fill_inferred": True},
            {"label": "mitaca", "flowering": _m(9, 10), "fruit_fill": _m(11, 12, 1, 2, 3),
             "harvest": _m(4, 5, 6), "fill_inferred": True},
        ],
        "source": "iphm flowering [1,2,3,8,9,10]; export_colombia mitaca Apr–Jun, main harvest Oct–Jan",
    },
    "honduras": {
        "cycles": [{
            "label": "main",
            "flowering": _m(3, 4, 5),
            "fruit_fill": _m(7, 8, 9),
            "harvest": _m(10, 11, 12, 1, 2),
        }],
        "source": "iphm flowering [3,4,5]; export_honduras harvest Oct–Feb, development Jul–Sep",
    },
    "ethiopia": {
        "cycles": [
            {"label": "main", "flowering": _m(2, 3, 4), "fruit_fill": _m(5, 6, 7, 8, 9),
             "harvest": _m(10, 11, 12, 1), "fill_inferred": True},
            {"label": "second", "flowering": _m(6, 7, 8), "fruit_fill": _m(9, 10, 11, 12, 1, 2),
             "harvest": _m(3, 4, 5), "fill_inferred": True},
        ],
        "source": "export_ethiopia harvest_cal (main Oct-Jan / Feb-Apr, second Mar-May / Jun-Aug)",
    },
    "uganda": {
        "cycles": [
            # The main crop is the one that matters, and its harvest sits
            # squarely in Oct–Feb — the months El Niño makes wettest here.
            {"label": "main", "flowering": _m(4, 5, 6), "fruit_fill": _m(7, 8, 9),
             "harvest": _m(10, 11, 12, 1, 2), "fill_inferred": True},
            {"label": "fly", "flowering": _m(10, 11, 12), "fruit_fill": _m(1, 2, 3),
             "harvest": _m(4, 5, 6), "fill_inferred": True},
        ],
        "source": "export_uganda harvest_cal (main Oct-Feb / Apr-Jun, fly Apr-Jun / Oct-Dec)",
    },
    "indonesia": {
        "cycles": [
            {"label": "robusta (Sumatra)", "flowering": _m(10, 11, 12), "fruit_fill": _m(1, 2),
             "harvest": _m(3, 4, 5, 6, 7, 8), "fill_inferred": True},
            {"label": "arabica", "flowering": _m(4, 5, 6), "fruit_fill": _m(7, 8, 9),
             "harvest": _m(10, 11, 12, 1, 2, 3), "fill_inferred": True},
        ],
        "source": "export_indonesia _HARVEST_WINDOWS (Sumatra robusta Mar–Aug / Oct–Dec; arabica Oct–Mar / Apr–Jun)",
    },
    "vn": {
        "cycles": [{
            "label": "robusta",
            "flowering": _m(1, 2, 3, 4),
            "fruit_fill": _m(5, 6, 7, 8, 9, 10),
            "harvest": _m(11, 12, 1),
        }],
        "source": "iphm flowering [1-4] + cherry-fill [5-10]; harvest Nov–Jan",
    },
}


def phases_for_months(origin: str, months: set[int]) -> list[dict]:
    """Which crop phases the given calendar months land on, for one origin.

    Returns one entry per (cycle, phase) that overlaps, with the overlapping
    months, so a caller can say "this event hits the main crop's harvest and
    the fly crop's flowering" rather than just "this region is at risk".
    """
    cal = CROP_CALENDAR.get(origin)
    if not cal or not months:
        return []
    hits: list[dict] = []
    for cycle in cal["cycles"]:
        for phase in PHASES:
            overlap = sorted(months & set(cycle.get(phase) or []))
            if overlap:
                hits.append({
                    "cycle": cycle["label"],
                    "phase": phase,
                    "months": overlap,
                    "inferred": bool(cycle.get("fill_inferred")) and phase == "fruit_fill",
                })
    return hits
