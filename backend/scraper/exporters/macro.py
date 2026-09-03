"""Macro exporters (freight routes, retail CPI)."""
import json

from freight_payload import ROUTE_CONFIG, build_freight_payload  # noqa: F401  (re-exported)
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import (
    safe_write_json,
    validate_freight,
)


def export_freight(db) -> None:
    """Write freight.json from the shared payload builder.

    ROUTE_CONFIG and the query logic live in backend/freight_payload.py so the
    live API route and this snapshot cannot drift — they did, for four separate
    fixes, before that module existed. This function is now only the file-writing
    and reporting half.
    """
    result = build_freight_payload(db)

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
