"""COT + cross-commodity (macro_cot) exporters."""
from datetime import date, timedelta

from cot_schema import serialize_cot_row
from models import (
    CommodityCot,
    CommodityPrice,
    CotCombinedPosition,
    CotPosition,
    CotWeekly,
)
from scraper.exporters.base import OUT_DIR
from scraper.exporters.front_spread import overwrite_curve_structure
from scraper.price_sanity import (
    baselines_by_symbol,
    corrupt_batch_dates,
    is_price_sane,
)
from scraper.sources.macro_cot import (
    COMMODITY_SPECS,
    _front_month_price_from_archive,
)
from scraper.validate_export import (
    safe_write_json,
    validate_cot,
    validate_cot_recent,
    validate_macro_cot,
)


def export_cot(db) -> None:
    rows = db.query(CotWeekly).order_by(CotWeekly.date.asc()).all()

    # Bulk-load every CotPosition row once, then index by (date, market) for
    # O(1) lookups in the row loop. Avoids N+1 queries on a 1.5k-row history.
    pos_rows = db.query(CotPosition).all()
    positions_by_week: dict[tuple, dict] = {}
    for p in pos_rows:
        positions_by_week.setdefault((p.date, p.market), {})[(p.crop, p.category, p.side)] = p

    # Futures-AND-OPTIONS combined book, same bulk-load shape. serialize_cot_row
    # turns it into the `*_opt` fields (combined - futures) the positioning
    # gauges draw. Missing weeks simply omit those fields.
    combined_by_week: dict[tuple, dict] = {}
    try:
        for c in db.query(CotCombinedPosition).all():
            combined_by_week.setdefault((c.date, c.market), {})[(c.category, c.side)] = c.oi
    except Exception as e:   # table absent on a DB that hasn't run the scraper yet
        print(f"  cot.json: combined positions unavailable ({e})")

    merged: dict = {}
    for row in rows:
        d = row.date.isoformat()
        if d not in merged:
            merged[d] = {"date": d, "ny": None, "ldn": None}
        positions = positions_by_week.get((row.date, row.market))
        # include_crop_split=True keeps the NY-only old/other crop fields
        # that the CotDashboard frontend expects in cot.json.
        merged[d][row.market] = serialize_cot_row(
            row, positions=positions, include_crop_split=True,
            combined=combined_by_week.get((row.date, row.market)),
        )
    result = sorted(merged.values(), key=lambda x: x["date"])
    overwrite_curve_structure(result)

    # Publish only the window the dashboard renders. The COT signal engine uses
    # 52-week percentiles (+8-week historical look-back) and the Industry Pulse
    # has a 5Y (260-week) view, so 312 weeks (~6y) amply covers every visual
    # with margin. Full history stays in the DB and is served by /api/cot for
    # anyone who needs it. Trimming drops cot.json from ~3 MB (980 wk) to ~1 MB.
    COT_PUBLISH_WEEKS = 312
    published = result[-COT_PUBLISH_WEEKS:]

    path = OUT_DIR / "cot.json"
    written = safe_write_json(path, published, validate_cot)
    print(f"  cot.json → written:{written} {len(published)} weeks (of {len(result)} total)")

    recent = result[-12:]
    path_r = OUT_DIR / "cot_recent.json"
    written_r = safe_write_json(path_r, recent, validate_cot_recent)
    print(f"  cot_recent.json → written:{written_r} {len(recent)} weeks (tail)")


def export_macro_cot(db) -> None:
    cutoff = date.today() - timedelta(weeks=52)
    cot_rows = (
        db.query(CommodityCot)
        .filter(CommodityCot.date > cutoff)
        .order_by(CommodityCot.date.asc())
        .all()
    )
    price_rows = (
        db.query(CommodityPrice)
        .filter(CommodityPrice.date > cutoff)
        .all()
    )
    # Reject corrupt/misaligned prices (yfinance batch glitches — see
    # price_sanity): compute a robust per-symbol baseline and drop any price
    # that's >3x off it, so a garbage value can't balloon the money flow. Bad
    # prices fall out of both lookups and get carried forward from the last good
    # value by the fallbacks below.
    baseline = baselines_by_symbol(price_rows)
    corrupt_dates = corrupt_batch_dates(price_rows, baseline)

    def _sane(p) -> bool:
        return p.date not in corrupt_dates and is_price_sane(p.close_price, baseline.get(p.symbol))

    price_map = {(p.date, p.symbol): p.close_price for p in price_rows if _sane(p)}
    symbol_latest: dict = {}
    for p in price_rows:
        if _sane(p):
            if p.symbol not in symbol_latest or p.date > symbol_latest[p.symbol][0]:
                symbol_latest[p.symbol] = (p.date, p.close_price)

    weeks: dict = {}
    for row in cot_rows:
        spec = COMMODITY_SPECS.get(row.symbol)
        if spec is None:
            continue
        mm_long   = row.mm_long   or 0
        mm_short  = row.mm_short  or 0
        mm_spread = row.mm_spread or 0
        close_price = price_map.get((row.date, row.symbol))
        if close_price is None:
            latest = symbol_latest.get(row.symbol)
            if latest and abs((row.date - latest[0]).days) <= 14:
                close_price = latest[1]
        # Last resort for archive-priced symbols (robusta): the DB CommodityPrice
        # rows are backfilled on a fragile weekly cadence and routinely leave
        # gaps, which silently drops the contract out of the Global Money Flow.
        # The per-contract archive we ship in-repo always has the front-month
        # price for every COT Tuesday, so read it straight from there on the COT
        # report date — same source #245 wired into the scraper, just applied at
        # export time so display no longer depends on backfill timing.
        if close_price is None and spec.get("price_source") == "internal_archive":
            close_price = _front_month_price_from_archive(
                spec["internal_market"], row.date
            )

        cv = close_price * spec["contract_unit"] if close_price else None
        # Initial margin = lots × exchange initial-margin rate. The MM gross
        # leg (long + short) pays the outright rate; the MM spread leg pays
        # the (much smaller) calendar-spread rate. RJO margin guide eff.
        # 3/14/2026 sources both rates (see COMMODITY_SPECS comment in
        # macro_cot.py). None when the spec is missing a margin entry —
        # which currently doesn't happen (all 28 entries populated) but
        # the guard keeps the export resilient if a future entry forgets.
        m_out = spec.get("margin_outright_usd")
        m_spd = spec.get("margin_spread_usd")
        initial_margin_usd = (
            (mm_long + mm_short) * m_out + mm_spread * m_spd
            if m_out is not None and m_spd is not None
            else None
        )
        entry = {
            "symbol":             row.symbol,
            "sector":             spec["sector"],
            "name":               spec["name"],
            "mm_long":            mm_long,
            "mm_short":           mm_short,
            "mm_spread":          mm_spread,
            "oi_total":           row.oi_total or 0,
            "close_price":        close_price,
            "gross_exposure_usd": (mm_long + mm_short) * cv if cv else None,
            "net_exposure_usd":   (mm_long - mm_short) * cv if cv else None,
            "initial_margin_usd": initial_margin_usd,
        }
        weeks.setdefault(row.date, []).append(entry)

    result = [
        {"date": d.isoformat(), "commodities": weeks[d]}
        for d in sorted(weeks.keys())
    ]

    path = OUT_DIR / "macro_cot.json"
    written = safe_write_json(path, result, validate_macro_cot)
    print(f"  macro_cot.json → written:{written} {len(result)} weeks")
