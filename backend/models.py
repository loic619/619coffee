from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class NewsItem(Base):
    __tablename__ = "news_feed"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(200), nullable=True)
    category: Mapped[str] = mapped_column(String(50))  # supply, demand, macro, general
    lat: Mapped[float] = mapped_column(Float, nullable=True)
    lng: Mapped[float] = mapped_column(Float, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    meta: Mapped[str] = mapped_column(Text, nullable=True)
    pub_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class CountryIntel(Base):
    __tablename__ = "country_intel"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    type: Mapped[str] = mapped_column(String(20))  # producer / consumer
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Factory(Base):
    __tablename__ = "factories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    company: Mapped[str] = mapped_column(String(200), nullable=True)
    capacity: Mapped[str] = mapped_column(String(500), nullable=True)
    # Numeric capacity in kilotonnes/year (parsed from the leading "Xk" in
    # `capacity`). Drives pin sizing in the frontend; nullable for legacy
    # rows where the string didn't start with a parsable number.
    cap_kt: Mapped[float] = mapped_column(Float, nullable=True)
    # One of: mill, roastery, soluble, decaf, capsules, mixed, unknown.
    # Drives icon color + popup subtitle on the map; nullable for legacy rows.
    type: Mapped[str] = mapped_column(String(32), nullable=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)

class CertifiedStock(Base):
    __tablename__ = "certified_stocks"

    date: Mapped[date] = mapped_column(Date, primary_key=True, index=True)
    value: Mapped[int] = mapped_column(Integer)

class FreightRate(Base):
    __tablename__ = "freight_rates"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    index_code: Mapped[str]      = mapped_column(String(10), nullable=False)
    date:       Mapped[date]     = mapped_column(Date, nullable=False)
    rate:       Mapped[float]    = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("index_code", "date", name="uq_freight_index_date"),)


class CotWeekly(Base):
    """Per-week, per-market CoT marker row.

    After the cot_weekly → cot_position migration this table holds only:
      * The (date, market) "we have data for this week" key
      * Market-level scalars from the COT Excel "Other" sheet
        (open interest total, settlement price, structure, EFP, vol,
        spread vol — all per market).

    Per-category position breakdowns (mm_long, swap_spread_old, t_pmpu_long,
    …) live in CotPosition. See backend/cot_schema.py for the parser that
    routes fields to the right table.
    """
    __tablename__ = "cot_weekly"

    id:     Mapped[int]  = mapped_column(primary_key=True)
    date:   Mapped[date] = mapped_column(Date, nullable=False, index=True)
    market: Mapped[str]  = mapped_column(String(3), nullable=False)  # "ny" | "ldn"

    # Open interest total for this market+week
    oi_total: Mapped[int | None] = mapped_column(Integer)

    # From Other sheet (joined by report date) — market-level scalars
    price_ny:       Mapped[float | None] = mapped_column(Float)
    price_ldn:      Mapped[float | None] = mapped_column(Float)
    # Contract symbol whose lastPrice was recorded into price_{ny,ldn} for
    # this Tuesday. Populated by fetch_tuesday_prices.py from May 2026 on;
    # NULL for legacy rows. The Industry Pulse chart uses contract changes
    # week-to-week to render switch markers.
    price_contract_ny:  Mapped[str | None] = mapped_column(String(20))
    price_contract_ldn: Mapped[str | None] = mapped_column(String(20))
    structure_ny:   Mapped[float | None] = mapped_column(Float)
    structure_ldn:  Mapped[float | None] = mapped_column(Float)
    exch_oi_ny:     Mapped[int | None]   = mapped_column(Integer)
    exch_oi_ldn:    Mapped[int | None]   = mapped_column(Integer)
    vol_ny:         Mapped[int | None]   = mapped_column(Integer)
    vol_ldn:        Mapped[int | None]   = mapped_column(Integer)
    efp_ny:         Mapped[float | None] = mapped_column(Float)
    efp_ldn:        Mapped[float | None] = mapped_column(Float)
    spread_vol_ny:  Mapped[float | None] = mapped_column(Float)
    spread_vol_ldn: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("date", "market", name="uq_cot_date_market"),
    )


class CotPosition(Base):
    """Narrow / long form of CotWeekly's per-category position breakdown.

    One row per (date, market, crop, category, side) instead of one row with
    ~120 columns. Populated by dual-write inside upsert_cot_weekly so callers
    don't change. Reader code still uses CotWeekly during the migration; this
    table will become the source of truth in a follow-up PR after backfill.

    `oi`      = open interest in lots
    `traders` = trader count (NULL for crop != "all" — wide schema only carries
                trader counts for the all-crop split).
    """
    __tablename__ = "cot_position"

    id:       Mapped[int]  = mapped_column(primary_key=True)
    date:     Mapped[date] = mapped_column(Date, nullable=False, index=True)
    market:   Mapped[str]  = mapped_column(String(3), nullable=False)   # "ny" | "ldn"
    crop:     Mapped[str]  = mapped_column(String(8), nullable=False)   # "all" | "old" | "other"
    category: Mapped[str]  = mapped_column(String(8), nullable=False)   # pmpu | swap | mm | other | nr
    side:     Mapped[str]  = mapped_column(String(8), nullable=False)   # long | short | spread

    oi:       Mapped[int | None] = mapped_column(Integer)
    traders:  Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("date", "market", "crop", "category", "side",
                         name="uq_cot_position"),
    )


class CommodityCot(Base):
    __tablename__ = "commodity_cot"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    date:       Mapped[date]     = mapped_column(Date, nullable=False, index=True)
    symbol:     Mapped[str]      = mapped_column(String(20), nullable=False)
    mm_long:    Mapped[int | None] = mapped_column(Integer)
    mm_short:   Mapped[int | None] = mapped_column(Integer)
    mm_spread:  Mapped[int | None] = mapped_column(Integer)
    oi_total:   Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("date", "symbol", name="uq_commodity_cot_date_symbol"),)


class CommodityPrice(Base):
    __tablename__ = "commodity_prices"

    id:          Mapped[int]        = mapped_column(primary_key=True)
    date:        Mapped[date]       = mapped_column(Date, nullable=False, index=True)
    symbol:      Mapped[str]        = mapped_column(String(20), nullable=False)
    close_price: Mapped[float | None] = mapped_column(Float)
    currency:    Mapped[str]        = mapped_column(String(3), nullable=False, default="USD")
    created_at:  Mapped[datetime]   = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("date", "symbol", name="uq_commodity_price_date_symbol"),)


class WeatherSnapshot(Base):
    __tablename__ = "weather_snapshots"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    region:     Mapped[str]      = mapped_column(String(100), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    daily_data: Mapped[list]     = mapped_column(JSON, default=list)


class FertilizerImport(Base):
    __tablename__ = "fertilizer_imports"

    id:            Mapped[int]           = mapped_column(primary_key=True)
    month:         Mapped[date]          = mapped_column(Date, nullable=False)
    ncm_code:      Mapped[str]           = mapped_column(String(20), nullable=False)
    ncm_label:     Mapped[str | None] = mapped_column(String(100), nullable=True)
    net_weight_kg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fob_usd:       Mapped[float | None] = mapped_column(Float, nullable=True)
    scraped_at:    Mapped[datetime]      = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("month", "ncm_code", name="uq_fert_import_month_ncm"),)


class VnLocalPrice(Base):
    """One row per scrape session where Vietnam local prices were captured.
    Stores the full prices dict as JSON; query latest row for the fallback display."""
    __tablename__ = "vn_local_prices"

    id:          Mapped[int]      = mapped_column(primary_key=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    local_time:  Mapped[str]      = mapped_column(String(20), nullable=True)
    prices:      Mapped[dict]     = mapped_column(JSON, nullable=False)


class PhysicalPrice(Base):
    """One row per (symbol, price_date) — clean typed columns for historical charting."""
    __tablename__ = "physical_prices"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    symbol:     Mapped[str]      = mapped_column(String(32), nullable=False)
    price:      Mapped[float]    = mapped_column(Float, nullable=False)
    currency:   Mapped[str]      = mapped_column(String(8), nullable=False)
    unit:       Mapped[str]      = mapped_column(String(16), nullable=False)
    source:     Mapped[str]      = mapped_column(String(64), nullable=False, default="")
    price_date: Mapped[date]     = mapped_column(Date, nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "price_date", name="uq_physical_price_symbol_date"),
        Index("ix_physical_prices_symbol_date", "symbol", "price_date"),
    )


class CotCombinedPosition(Base):
    """Futures-AND-OPTIONS combined COT positions, narrow form.

    The regular COT feed this project ingests is futures-ONLY (CFTC
    fut_disagg for NY; the "ICE Robusta Coffee Futures" rows for LDN), so the
    options book is invisible to those cohort numbers. This table stores the
    COMBINED report — CFTC com_disagg for NY, the "ICE Robusta Coffee Futures
    and Options" rows for LDN — from which the options book is derived:

        options(cat, side) = combined(cat, side) - futures(cat, side)

    Combined figures are delta-adjusted futures-equivalents, so an options leg
    can legitimately come out NEGATIVE (a delta-short call book reduces a
    cohort's combined long below its futures long). Consumers must handle the
    sign rather than clamp it.

    Only the all-crop split is stored: the positioning gauges that consume it
    read all-crop, and the combined report's crop breakdown isn't needed.
    Shape mirrors CotPosition so the two can be zipped by (date, market,
    category, side).
    """
    __tablename__ = "cot_combined_position"

    id:       Mapped[int]  = mapped_column(primary_key=True)
    date:     Mapped[date] = mapped_column(Date, nullable=False, index=True)
    market:   Mapped[str]  = mapped_column(String(3), nullable=False)   # "ny" | "ldn"
    category: Mapped[str]  = mapped_column(String(8), nullable=False)   # pmpu | swap | mm | other | nr
    side:     Mapped[str]  = mapped_column(String(8), nullable=False)   # long | short | spread

    oi:       Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("date", "market", "category", "side",
                         name="uq_cot_comb_date_market_cat_side"),
        Index("ix_cot_comb_date_market", "date", "market"),
    )
