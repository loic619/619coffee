import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://coffee:coffee@localhost:5432/coffee_intel")

_engine = None
_Session = None

def _get_engine():
    global _engine, _Session
    if _engine is None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        _engine = create_engine(DATABASE_URL)
        _Session = sessionmaker(bind=_engine)
    return _engine

def get_session():
    _get_engine()
    return _Session()

def upsert_news_item(db, item: dict):
    from models import NewsItem
    # Replace+insert run in a SINGLE transaction. The previous shape committed
    # the DELETE before attempting the INSERT, so a failed INSERT could not
    # roll the DELETE back — the row was permanently lost. By queuing the
    # DELETE alongside the ADD and committing once at the end, a rollback now
    # reverts both halves atomically.
    tags = item.get("tags", [])
    replace_tags = {"price", "cot", "futures_chain"}
    try:
        if "futures" in tags and "price" in tags and item.get("source"):
            # Futures chain: keep history — only replace same-date entry (title includes date)
            (db.query(NewsItem)
               .filter(NewsItem.title == item["title"])
               .delete(synchronize_session=False))
        elif replace_tags.intersection(tags) and item.get("source"):
            # Other price items: replace by source + title prefix (no history needed)
            title_prefix = item["title"].split("–")[0].strip()
            (db.query(NewsItem)
               .filter(NewsItem.source == item["source"],
                       NewsItem.title.like(f"{title_prefix}%"))
               .delete(synchronize_session=False))
        elif "latest_only" in tags and item.get("source"):
            # Single-snapshot feeds (USDA PSD, AJCA): only the most recent reading
            # is ever needed (health reads the latest by pub_date; exports read the
            # latest row). Replace ALL prior rows for the source so the stored
            # pub_date reflects the real data date — not stale daily-run rows whose
            # pub_date=now would otherwise shadow it on the pub_date.desc() read.
            (db.query(NewsItem)
               .filter(NewsItem.source == item["source"])
               .delete(synchronize_session=False))
        elif db.query(NewsItem).filter_by(title=item["title"]).first():
            return
        db.add(NewsItem(
            title=item["title"],
            body=item.get("body", ""),
            source=item.get("source", ""),
            category=item.get("category", "general"),
            lat=item.get("lat"),
            lng=item.get("lng"),
            tags=item.get("tags", []),
            meta=item.get("meta"),
            pub_date=item.get("pub_date", datetime.utcnow()),
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[db] Failed to upsert '{item.get('title')}': {e}", file=sys.stderr, flush=True)

def upsert_freight_rate(index_code: str, rate_date, rate: float):
    from models import FreightRate
    # `with` calls session.close() on exit (success or exception) — replaces
    # the old try/finally pattern and matches SQLAlchemy 1.4+ idiom.
    with get_session() as db:
        try:
            existing = db.query(FreightRate).filter_by(
                index_code=index_code, date=rate_date
            ).first()
            if existing:
                existing.rate = rate
            else:
                db.add(FreightRate(index_code=index_code, date=rate_date, rate=rate))
            db.commit()
        except Exception:
            db.rollback()
            raise  # Let the caller (scraper loop) decide how to handle failures


def migrate_cot_weekly_columns():
    """No-op kept for backwards-compat with existing scraper entrypoints.

    Older versions added per-category wide columns to cot_weekly. After the
    cot_position migration those columns are dropped (see
    migrate_drop_cot_weekly_position_columns) and per-category data lives in
    CotPosition instead. Callers can keep importing this name without
    changing their code.
    """
    return None


def migrate_drop_cot_weekly_position_columns():
    """Drop the wide per-category position columns from cot_weekly.

    Idempotent (uses IF EXISTS). Run from scraper entrypoints alongside
    create_cot_position_table so a fresh deploy converges to the new schema.

    Position data lives in CotPosition now; cot_weekly only carries the
    (date, market) key + market-level scalars.
    """
    engine = _get_engine()
    from sqlalchemy import text

    cols_to_drop = [
        # Position OI fields (all-crop)
        "pmpu_long", "pmpu_short",
        "swap_long", "swap_short", "swap_spread",
        "mm_long", "mm_short", "mm_spread",
        "other_long", "other_short", "other_spread",
        "nr_long", "nr_short",
        # Trader counts (all-crop only — wide schema never had crop-split traders)
        "t_pmpu_long", "t_pmpu_short",
        "t_swap_long", "t_swap_short", "t_swap_spread",
        "t_mm_long", "t_mm_short", "t_mm_spread",
        "t_other_long", "t_other_short", "t_other_spread",
        "t_nr_long", "t_nr_short",
        # Old-crop split (NY only)
        "pmpu_long_old", "pmpu_short_old",
        "swap_long_old", "swap_short_old", "swap_spread_old",
        "mm_long_old", "mm_short_old", "mm_spread_old",
        "other_long_old", "other_short_old", "other_spread_old",
        "nr_long_old", "nr_short_old",
        # Other-crop split
        "pmpu_long_other", "pmpu_short_other",
        "swap_long_other", "swap_short_other", "swap_spread_other",
        "mm_long_other", "mm_short_other", "mm_spread_other",
        "other_long_other", "other_short_other", "other_spread_other",
        "nr_long_other", "nr_short_other",
    ]

    with engine.connect() as conn:
        dropped = 0
        for col in cols_to_drop:
            try:
                conn.execute(text(f"ALTER TABLE cot_weekly DROP COLUMN IF EXISTS {col}"))
                conn.commit()
                dropped += 1
            except Exception as e:
                print(f"[db] drop col {col}: {e}")
    print(f"[db] migrate_drop_cot_weekly_position_columns: processed {dropped}/{len(cols_to_drop)} columns")


def upsert_cot_weekly(market: str, report_date, fields: dict):
    """Write a CoT week.

    Position fields (mm_long, swap_spread_old, t_pmpu_long, …) are routed
    to the narrow CotPosition table — the wide cot_weekly columns no
    longer exist. Market scalars (oi_total, price_ny, structure_ny, …)
    stay on CotWeekly. See backend/cot_schema.py for the field-name parser
    that drives the routing.

    The CotWeekly row is always upserted (even when only position fields
    are passed) so the (date, market) key acts as the canonical "we have
    data for this week" signal that the routes/exports filter on.
    """
    from cot_schema import field_to_position, position_rows_from_fields
    from models import CotPosition, CotWeekly

    # Split: scalars stay on CotWeekly, position fields go to CotPosition.
    scalar_fields = {k: v for k, v in fields.items() if field_to_position(k) is None}
    position_rows = position_rows_from_fields(fields)

    with get_session() as db:
        try:
            existing = db.query(CotWeekly).filter_by(date=report_date, market=market).first()
            if existing:
                for k, v in scalar_fields.items():
                    setattr(existing, k, v)
            else:
                db.add(CotWeekly(date=report_date, market=market, **scalar_fields))

            for pos in position_rows:
                row = (
                    db.query(CotPosition)
                    .filter_by(date=report_date, market=market,
                               crop=pos["crop"], category=pos["category"],
                               side=pos["side"])
                    .first()
                )
                if row:
                    if pos["oi"]      is not None: row.oi      = pos["oi"]
                    if pos["traders"] is not None: row.traders = pos["traders"]
                else:
                    db.add(CotPosition(
                        date=report_date, market=market,
                        crop=pos["crop"], category=pos["category"],
                        side=pos["side"],
                        oi=pos["oi"], traders=pos["traders"],
                    ))

            db.commit()
        except Exception:
            db.rollback()
            raise


def upsert_cot_price(
    market: str,
    report_date,
    price_field: str,
    value: float,
    *,
    contract: str | None = None,
) -> bool:
    """Store a Tuesday settlement price in cot_weekly only if not already set.

    Prices are immutable once recorded — never overwritten by subsequent runs.
    The matching `price_contract_{ny,ldn}` field records which futures contract
    the price came from, so the Industry Pulse chart can mark week-to-week
    contract switches (the fetch_tuesday_prices script now picks the max-OI
    contract, which can change as liquidity rolls forward).

    Returns True if written, False if skipped (already set).
    """
    from models import CotWeekly
    contract_field = "price_contract_ny" if price_field == "price_ny" else "price_contract_ldn"
    with get_session() as db:
        try:
            existing = db.query(CotWeekly).filter_by(date=report_date, market=market).first()
            if existing:
                if getattr(existing, price_field) is not None:
                    print(f"[db] {market} {price_field} for {report_date} already set — skipping")
                    return False
                setattr(existing, price_field, value)
                if contract is not None:
                    setattr(existing, contract_field, contract)
            else:
                payload = {price_field: value}
                if contract is not None:
                    payload[contract_field] = contract
                db.add(CotWeekly(date=report_date, market=market, **payload))
            db.commit()
            return True
        except Exception:
            db.rollback()
            raise


def create_farmer_economics_tables():
    """Create WeatherSnapshot and FertilizerImport tables if they don't exist."""
    from database import Base
    from models import FertilizerImport, WeatherSnapshot
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[
        WeatherSnapshot.__table__,
        FertilizerImport.__table__,
    ])
    print("[db] farmer_economics tables created/verified")


def create_physical_prices_table():
    """Create physical_prices table if it doesn't exist."""
    from database import Base
    from models import PhysicalPrice
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[PhysicalPrice.__table__])
    print("[db] physical_prices table created/verified")


def create_cot_position_table():
    """Create cot_position table if it doesn't exist.

    Narrow / long form of CotWeekly's per-category position breakdown. Populated
    by dual-write in upsert_cot_weekly during the migration; will become the
    sole source of truth in a follow-up PR.
    """
    from database import Base
    from models import CotPosition
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[CotPosition.__table__])
    print("[db] cot_position table created/verified")


def create_cot_combined_table():
    """Create cot_combined_position if it doesn't exist.

    Holds the futures-AND-OPTIONS combined COT report; the options book the
    positioning gauges draw is combined - futures, derived at export time.
    """
    from database import Base
    from models import CotCombinedPosition
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[CotCombinedPosition.__table__])
    print("[db] cot_combined_position table created/verified")


def upsert_physical_price(db, *, symbol: str, price: float, currency: str,
                          unit: str, source: str, price_date) -> None:
    from models import PhysicalPrice
    existing = db.query(PhysicalPrice).filter_by(symbol=symbol, price_date=price_date).first()
    if existing:
        existing.price = price
        existing.source = source
    else:
        db.add(PhysicalPrice(
            symbol=symbol, price=price, currency=currency,
            unit=unit, source=source, price_date=price_date,
        ))
    try:
        db.commit()
    except Exception:
        db.rollback()


def create_vn_local_prices_table():
    """Create vn_local_prices table if it doesn't exist."""
    from database import Base
    from models import VnLocalPrice
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[VnLocalPrice.__table__])


def upsert_vn_local_price(prices: dict, recorded_at) -> None:
    """Insert a new VN local price snapshot. Keeps last 60 rows, purges older ones."""
    from models import VnLocalPrice
    with get_session() as db:
        try:
            db.add(VnLocalPrice(
                recorded_at=recorded_at,
                local_time=prices.get("local_time"),
                prices=prices,
            ))
            db.commit()
            # Purge rows older than the newest 60
            subq = (
                db.query(VnLocalPrice.id)
                .order_by(VnLocalPrice.recorded_at.desc())
                .limit(60)
                .subquery()
            )
            db.query(VnLocalPrice).filter(~VnLocalPrice.id.in_(subq)).delete(synchronize_session=False)
            db.commit()
        except Exception:
            db.rollback()
            raise


def get_latest_vn_local_price() -> dict | None:
    """Return the most recently captured VN local prices dict, or None."""
    from models import VnLocalPrice
    with get_session() as db:
        try:
            row = db.query(VnLocalPrice).order_by(VnLocalPrice.recorded_at.desc()).first()
            if not row:
                return None
            return {"saved_at": row.recorded_at.isoformat() + "Z", **row.prices}
        except Exception:
            return None


def extract_physical_price(item: dict) -> dict | None:
    """Parse a news item dict → PhysicalPrice kwargs, or None if not a structured price."""
    import json as _json
    import re
    from datetime import date as _date

    tags = set(item.get("tags", []))
    body = item.get("body", "") or ""
    source = item.get("source", "")
    today = _date.today()

    # ── Phase 1: prefer structured price_data emitted by the scraper ─────────
    # The scraper already holds the clean number at scrape time; reading it
    # directly avoids re-parsing the human-readable `body` string (the regex
    # branches below are the transitional fallback for un-migrated sources).
    pd = item.get("price_data")
    if isinstance(pd, dict) and pd.get("symbol") and pd.get("price") is not None:
        try:
            return dict(symbol=pd["symbol"], price=float(pd["price"]),
                        currency=pd.get("currency", ""), unit=pd.get("unit", ""),
                        source=source, price_date=today)
        except (TypeError, ValueError):
            pass  # malformed price_data → fall through to regex

    # FX rates
    if "fx" in tags:
        m = re.search(r"price:\s*([\d.,]+)", body, re.I)
        if not m:
            return None
        rate = float(m.group(1).replace(",", ""))
        sym_map = {
            "brazil": "USD_BRL", "vietnam": "USD_VND", "indonesia": "USD_IDR",
            "honduras": "USD_HNL", "uganda": "USD_UGX",
        }
        for country, sym in sym_map.items():
            if country in tags:
                return dict(symbol=sym, price=rate, currency="USD", unit="rate",
                            source=source, price_date=today)
        return None

    # VN FAQ
    if "price" in tags and "vietnam" in tags and "futures" not in tags:
        m = re.search(r"price:\s*([\d.]+)\s*VND/kg", body, re.I)
        if not m:
            return None
        raw = m.group(1)
        vnd_kg = int(raw.replace(".", "")) if re.match(r"^\d{2,3}\.\d{3}$", raw) else int(float(raw))
        return dict(symbol="VN_FAQ", price=float(vnd_kg), currency="VND", unit="per_kg",
                    source=source, price_date=today)

    # UGA S15
    if "price" in tags and "uganda" in tags and "futures" not in tags:
        # Accept the current "US¢/lb" label and the legacy "USD/cwt" (same
        # number — 1 cwt = 100 lb) so older NewsItems still parse.
        m = re.search(r"price:\s*([\d.]+)\s*(?:US¢/lb|¢/lb|USD/cwt)", body, re.I)
        if not m:
            return None
        return dict(symbol="UGA_S15", price=float(m.group(1)), currency="USD", unit="per_cwt",
                    source=source, price_date=today)

    # CON T7 (Cooabriel — /saca format)
    if "price" in tags and "brazil" in tags and ("conilon" in tags or "robusta" in tags) and "futures" not in tags:
        m = re.search(r"R\$\s*([\d.,]+)/saca", body, re.I)
        if not m:
            return None
        brl_val = float(m.group(1).replace(".", "").replace(",", "."))
        return dict(symbol="CON_T7", price=brl_val, currency="BRL", unit="per_saca",
                    source=source, price_date=today)

    # B3 ICF arabica settlement
    if "futures" in tags and "price" in tags and "arabica" in tags and "b3" in tags:
        m = re.search(r"settlement:\s*([\d.]+)\s*USD/sac", body, re.I)
        if not m:
            return None
        return dict(symbol="B3_ICF", price=float(m.group(1)), currency="USD", unit="per_sac",
                    source=source, price_date=today)

    # KC / RC front month (from meta JSON)
    if "futures" in tags and "price" in tags and "b3" not in tags:
        meta_str = item.get("meta")
        if not meta_str:
            return None
        try:
            front = _json.loads(meta_str).get("contracts", [{}])[0]
            last = front.get("last")
            if last is None:
                return None
            if "arabica" in tags:
                return dict(symbol="KC_FRONT", price=float(last), currency="USD", unit="cts_per_lb",
                            source=source, price_date=today)
            if "robusta" in tags:
                return dict(symbol="RC_FRONT", price=float(last), currency="USD", unit="usd_per_mt",
                            source=source, price_date=today)
        except Exception:
            pass

    return None
