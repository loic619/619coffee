"""Macro exporters (freight routes, retail CPI)."""
import json
from datetime import date, timedelta

from models import (
    FreightRate,
)
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import (
    safe_write_json,
    validate_freight,
)

# Probe 0.27 enumerated all twelve FBX tradelanes. They are China<->NAWC,
# China<->NAEC, China<->N.Europe, China<->Med, NAEC<->N.Europe, and Europe->SAEC
# / Europe->SAWC. Two facts follow, and they bound what this file can honestly
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
# vn-ham is a proxy too — Hamburg is Rotterdam x 1.02, not its own quote. It was
# previously flagged False, which understated how much of this table is derived.
ROUTE_CONFIG = [
    ("vn-eu",  "Ho Chi Minh", "Rotterdam",   "FBX11", 1.00, False),
    ("vn-ham", "Ho Chi Minh", "Hamburg",     "FBX11", 1.02, True),
    ("vn-us",  "Ho Chi Minh", "Los Angeles", "FBX01", 1.00, False),
    ("br-eu",  "Santos",      "Rotterdam",   "FBX11", 0.58, True),
    ("co-eu",  "Cartagena",   "Rotterdam",   "FBX11", 0.55, True),
    ("et-eu",  "Djibouti",    "Rotterdam",   "FBX11", 0.70, True),
    ("br-us",  "Santos",      "New York",    "FBX03", 0.45, True),
]


def _fbx_names() -> dict[str, str]:
    """code → published lane name, or {} if the scraper module cannot be imported.

    Imported lazily: the exporter runs in jobs that do not install the scraper's
    Playwright dependencies, and a missing name is cosmetic — it must never take
    freight.json down with it.
    """
    try:
        from scraper.sources.freightos import FBX_NAMES
        return dict(FBX_NAMES)
    except Exception:  # noqa: BLE001
        return {}


def export_freight(db) -> None:
    # Every index in the table, not just the ones ROUTE_CONFIG references. The
    # scraper now captures all twelve FBX lanes; publishing only the three the
    # route table uses would leave the other nine accumulating in the database
    # and visible nowhere.
    known_codes = set(_fbx_names())
    stored_codes = {
        code for (code,) in db.query(FreightRate.index_code).distinct().all() if code
    }
    indices   = sorted(known_codes | stored_codes | {cfg[3] for cfg in ROUTE_CONFIG})
    cutoff_wk = date.today() - timedelta(days=7)
    # Publish the whole stored series, not a rolling 84-day slice.
    #
    # There is no anonymous route to Freightos' own history — probes 0.28 and
    # 0.29 captured every response on the lane pages and the public index site
    # and found no series endpoint, no chart element (0 canvas, 0 chart svg) and
    # no export link; the page carries one current number and nothing else. So
    # the only FBX history that will ever exist here is the one we accumulate,
    # which makes throwing away everything older than twelve weeks the wrong
    # default. Whatever we have collected is now published, and the frontend
    # picks the window it wants to draw.
    #
    # The five-year bound is a size guard, not a data decision: it caps
    # freight.json's growth long before it matters (twelve lanes at two prints a
    # week is ~1,250 rows a year) while sitting far beyond anything stored.
    cutoff_hist = date.today() - timedelta(days=365 * 5)

    latest, prev = {}, {}
    for idx in indices:
        row = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == idx)
            .order_by(FreightRate.date.desc())
            .first()
        )
        latest[idx] = row
        # `<=`, not `<`. A strict comparison skips the observation dated exactly
        # seven days back — which is the ideal comparison point — and silently
        # falls through to one 9-14 days old, while the brief still says "w/w".
        # Replayed over the committed history this misstated the change on 9 of
        # 18 observations, e.g. +19.4% reported where the true 7-day move was
        # +8.3%. The index is only scraped Fri/Sun, so an exact-7-day hit is
        # common rather than a corner case.
        row2 = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == idx, FreightRate.date <= cutoff_wk)
            .order_by(FreightRate.date.desc())
            .first()
        )
        prev[idx] = row2

    if all(v is None for v in latest.values()):
        result = {"updated": date.today().isoformat(), "routes": [], "history": [], "indices": []}
    else:
        routes = []
        for route_id, from_, to, index, mult, is_proxy in ROUTE_CONFIG:
            latest_row = latest.get(index)
            if latest_row is None:
                continue
            prev_row = prev.get(index)
            rate     = round(latest_row.rate * mult)
            prev_rate = round(prev_row.rate * mult) if prev_row else rate
            routes.append({
                "id": route_id, "from": from_, "to": to,
                "rate": rate, "prev": prev_rate, "unit": "USD/FEU", "proxy": is_proxy,
                # The date `prev` actually came from. Observations are Fri/Sun
                # only, so the span is not always seven days and consumers
                # should say what they are comparing rather than assume w/w.
                "prev_date": prev_row.date.isoformat() if prev_row else None,
                # Which index this came from and how it was scaled, so a reader
                # can see that five routes share one signal rather than guessing
                # why their percentages always match.
                "basis": {"index": index, "multiplier": mult},
            })

        # One window per index, fetched once and reused for both the route
        # history and the per-index series below.
        window: dict[str, list] = {}
        for idx in indices:
            window[idx] = (
                db.query(FreightRate)
                .filter(FreightRate.index_code == idx, FreightRate.date >= cutoff_hist)
                .order_by(FreightRate.date.asc()).all()
            )

        # Driven by ROUTE_CONFIG rather than a hardcoded FBX11/FBX01 pair, which
        # silently left vn-ham, co-eu and br-us out of the history chart even
        # though the route table quoted them.
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

        result = {
            "updated": updated,
            "routes":  routes,
            "history": sorted(history_by_date.values(), key=lambda x: x["date"]),
            # Every FBX lane we hold, coffee-relevant or not. None of these is a
            # coffee corridor — FBX publishes no South America -> Europe and no
            # African lane — so they are presented as indices, not as routes.
            "indices": index_out,
        }

    path = OUT_DIR / "freight.json"
    written = safe_write_json(path, result, validate_freight)
    hist = result.get("history", [])
    span = f"{hist[0]['date']}..{hist[-1]['date']}" if hist else "none"
    print(f"  freight.json → written:{written} {len(result.get('routes', []))} routes, "
          f"{len(result.get('indices', []))} FBX indices, {len(hist)} history rows ({span})")
    # Per-lane depth, so a lane that quietly stops accumulating is visible in
    # the job log rather than only in the chart months later.
    for entry in result.get("indices", []):
        h = entry.get("history") or []
        if h:
            print(f"    {entry['code']:6} {len(h):>4} rows  {h[0]['date']}..{h[-1]['date']}")


def export_retail_cpi(db) -> None:
    """Mirror the retail_cpi cache to /data so the frontend can read it directly."""
    try:
        from scraper.sources import retail_cpi as _retail_cpi
        payload = _retail_cpi.fetch_latest()
        if not payload:
            from models import NewsItem
            item = (
                db.query(NewsItem)
                .filter(NewsItem.source == "Retail CPI")
                .order_by(NewsItem.pub_date.desc())
                .first()
            )
            if item and item.meta:
                try:
                    payload = json.loads(item.meta)
                except Exception:
                    payload = None
        if not payload:
            print("  retail_cpi.json → no data")
            return
        path = OUT_DIR / "retail_cpi.json"
        safe_write_json(path, payload, ensure_ascii=False)
        n = len(payload.get("series") or {})
        print(f"  retail_cpi.json → {n} series, last_updated={payload.get('last_updated')}")
    except Exception as e:
        print(f"  retail_cpi.json → FAILED: {e}")


def export_us_cpi(db) -> None:
    """Publish headline US CPI (CPI-U) to /data/us_cpi.json for the Macro tab.

    Resilient lookup order: the scraper's cache file (gitignored, may be lost
    cross-job in CI) → the DB news item the scraper stashes → a fresh BLS
    fetch. The fresh-fetch fallback means a full cron export reproduces the
    file even when no scraper ran in the same job.
    """
    try:
        from scraper.sources import us_cpi as _us_cpi

        payload = _us_cpi.fetch_latest()
        if not payload:
            from models import NewsItem
            item = (
                db.query(NewsItem)
                .filter(NewsItem.source == "US CPI")
                .order_by(NewsItem.pub_date.desc())
                .first()
            )
            if item and item.meta:
                try:
                    payload = json.loads(item.meta)
                except Exception:
                    payload = None
        if not payload:
            payload = _us_cpi._build_payload()
        if not payload:
            print("  us_cpi.json → no data")
            return
        path = OUT_DIR / "us_cpi.json"
        safe_write_json(path, payload, ensure_ascii=False)
        n = len(payload.get("series") or {})
        print(f"  us_cpi.json → {n} series, last_updated={payload.get('last_updated')}")
    except Exception as e:
        print(f"  us_cpi.json → FAILED: {e}")

def export_treasury_yields() -> None:
    """Write treasury_yields.json — the US par yield curve, straight from Treasury.

    Standalone (no `db`): the curve is fetched live rather than staged through
    the database, same shape as the brazil_b3_* exporters.
    """
    import json as _json

    from scraper.sources.treasury_yields import fetch_curve
    path = OUT_DIR / "treasury_yields.json"

    # Carry the published history forward so the fetch only needs the current
    # year. Missing/corrupt file just means a cold start — two requests instead
    # of one, never a wrong series.
    existing: list[dict] = []
    if path.exists():
        try:
            existing = _json.loads(path.read_text(encoding="utf-8")).get("history") or []
        except Exception as e:  # noqa: BLE001
            print(f"  treasury_yields.json → unreadable ({type(e).__name__}), refetching in full")

    curve = fetch_curve(existing)
    if not curve:
        print("  treasury_yields.json → no curve returned — keeping previous file")
        return
    safe_write_json(
        path, curve,
        lambda d: (bool(d.get("history")) and bool(d.get("latest", {}).get("yields")),
                   "empty curve"),
    )
    lat = curve["latest"]
    print(f"  treasury_yields.json → {lat['date']}: "
          f"2y {lat['yields'].get('2y')}% / 10y {lat['yields'].get('10y')}% "
          f"· 2s10s {lat['spread_2s10s']}bp · {len(curve['history'])} sessions")
