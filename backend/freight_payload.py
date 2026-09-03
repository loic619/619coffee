"""freight.json's shape, built once and served by both paths.

The Freight page can be fed from either the live API (routes/freight.py) or the
committed snapshot (scraper/exporters/macro.py), whichever is reachable. Those
were two independent implementations of the same payload, and they drifted: by
2026-09 the API route was still the pre-August exporter, missing four separate
fixes that had been merged into the export path.

  * vn-ham was flagged proxy=False, so Ho Chi Minh -> Hamburg showed the ~est.
    marker on the snapshot and hid it on live, for the same derived number.
  * `date < cutoff` rather than `<=`, the off-by-one that skips the print dated
    exactly seven days back and silently compares against one 9-14 days old
    while still calling it w/w.
  * an 84-day history window, dropping the archive that was opened up once we
    established FBX back-history is unreachable and ours is the only copy.
  * history hardcoded to FBX11 + FBX01, so vn-ham, co-eu and br-us appeared in
    the route table but never in the chart.

Two copies of a payload will always drift; the fix is to have one. Both callers
now build the payload here, so a change reaches the page by either route or
neither. tests/test_freight_parity.py asserts they cannot diverge again.
"""
from __future__ import annotations

from datetime import date, timedelta

from models import FreightRate

# Probe 0.27 enumerated all twelve FBX tradelanes. They are China<->NAWC,
# China<->NAEC, China<->N.Europe, China<->Med, NAEC<->N.Europe, and Europe->SAEC
# / Europe->SAWC. Two facts follow, and they bound what this table can honestly
# claim:
#
#   * There is NO South America -> Europe lane. FBX24/26 run Europe -> South
#     America, the import direction; coffee leaves on the unpublished leg.
#   * There are no Africa and no Caribbean lanes at all.
#
# So only the Vietnam routes have a genuinely matching index. The rest are one
# index scaled by a constant picked at some past date, which means they share a
# single signal: their percentage moves are identical by construction, not by
# corroboration. `proxy` marks those so consumers can say so out loud.
#
# vn-ham is a proxy too — Hamburg is Rotterdam x 1.02, not its own quote.
ROUTE_CONFIG = [
    ("vn-eu",  "Ho Chi Minh", "Rotterdam",   "FBX11", 1.00, False),
    ("vn-ham", "Ho Chi Minh", "Hamburg",     "FBX11", 1.02, True),
    ("vn-us",  "Ho Chi Minh", "Los Angeles", "FBX01", 1.00, False),
    ("br-eu",  "Santos",      "Rotterdam",   "FBX11", 0.58, True),
    ("co-eu",  "Cartagena",   "Rotterdam",   "FBX11", 0.55, True),
    ("et-eu",  "Djibouti",    "Rotterdam",   "FBX11", 0.70, True),
    ("br-us",  "Santos",      "New York",    "FBX03", 0.45, True),
]

# Size guard, not a data decision: twelve lanes at two prints a week is ~1,250
# rows a year, so this sits far beyond anything stored while capping growth.
HISTORY_DAYS = 365 * 5


def _fbx_names() -> dict[str, str]:
    """code → published lane name, or {} if the scraper module is unavailable.

    Imported lazily: this module is loaded by the API process too, and a missing
    lane name is cosmetic — it must never take the payload down with it.
    """
    try:
        from scraper.sources.freightos import FBX_NAMES
        return dict(FBX_NAMES)
    except Exception:  # noqa: BLE001
        return {}


def build_freight_payload(db) -> dict:
    """The full freight.json body: routes, route history, and every FBX index."""
    # Every index in the table, not just the ones ROUTE_CONFIG references. The
    # scraper captures all twelve FBX lanes; publishing only the three the route
    # table uses would leave the other nine accumulating in the database and
    # visible nowhere.
    known_codes = set(_fbx_names())
    stored_codes = {
        code for (code,) in db.query(FreightRate.index_code).distinct().all() if code
    }
    indices = sorted(known_codes | stored_codes | {cfg[3] for cfg in ROUTE_CONFIG})

    cutoff_wk = date.today() - timedelta(days=7)
    cutoff_hist = date.today() - timedelta(days=HISTORY_DAYS)

    latest: dict[str, FreightRate | None] = {}
    prev: dict[str, FreightRate | None] = {}
    for idx in indices:
        latest[idx] = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == idx)
            .order_by(FreightRate.date.desc())
            .first()
        )
        # `<=`, not `<`. A strict comparison skips the observation dated exactly
        # seven days back — the ideal comparison point — and falls through to one
        # 9-14 days old while the brief still says "w/w". Replayed over the
        # committed history this misstated the change on 9 of 18 observations.
        # The index is scraped Fri/Sun, so an exact-7-day hit is the common case.
        prev[idx] = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == idx, FreightRate.date <= cutoff_wk)
            .order_by(FreightRate.date.desc())
            .first()
        )

    if all(v is None for v in latest.values()):
        return {"updated": date.today().isoformat(), "routes": [], "history": [], "indices": []}

    routes = []
    for route_id, from_, to, index, mult, is_proxy in ROUTE_CONFIG:
        latest_row = latest.get(index)
        if latest_row is None:
            continue
        prev_row = prev.get(index)
        routes.append({
            "id": route_id, "from": from_, "to": to,
            "rate": round(latest_row.rate * mult),
            "prev": round(prev_row.rate * mult) if prev_row else round(latest_row.rate * mult),
            "unit": "USD/FEU", "proxy": is_proxy,
            # The date `prev` actually came from. Observations are Fri/Sun only,
            # so the span is not always seven days and consumers should say what
            # they are comparing rather than assume w/w.
            "prev_date": prev_row.date.isoformat() if prev_row else None,
            # Which index this came from and how it was scaled, so a reader can
            # see that five routes share one signal.
            "basis": {"index": index, "multiplier": mult},
        })

    # One window per index, fetched once and reused for both the route history
    # and the per-index series.
    window: dict[str, list] = {}
    for idx in indices:
        window[idx] = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == idx, FreightRate.date >= cutoff_hist)
            .order_by(FreightRate.date.asc()).all()
        )

    # Driven by ROUTE_CONFIG rather than a hardcoded FBX11/FBX01 pair, so the
    # table and the chart cannot disagree about which routes exist.
    history_by_date: dict = {}
    for route_id, _from, _to, index, mult, _proxy in ROUTE_CONFIG:
        for row in window.get(index, []):
            d = row.date.isoformat()
            history_by_date.setdefault(d, {"date": d})
            history_by_date[d][route_id] = round(row.rate * mult)

    names = _fbx_names()
    index_out = []
    for idx in indices:
        row = latest.get(idx)
        if row is None:
            continue
        prev_row = prev.get(idx)
        index_out.append({
            "code": idx,
            "name": names.get(idx, idx),
            "rate": round(row.rate),
            "date": row.date.isoformat(),
            "prev": round(prev_row.rate) if prev_row else None,
            "prev_date": prev_row.date.isoformat() if prev_row else None,
            "history": [
                {"date": r.date.isoformat(), "rate": round(r.rate)}
                for r in window.get(idx, [])
            ],
        })

    updated = max(
        (r.date for r in latest.values() if r is not None),
        default=date.today()
    ).isoformat()

    return {
        "updated": updated,
        "routes": routes,
        "history": sorted(history_by_date.values(), key=lambda x: x["date"]),
        # Every FBX lane we hold, coffee-relevant or not. None of these is a
        # coffee corridor, so they are presented as indices, not as routes.
        "indices": index_out,
    }
