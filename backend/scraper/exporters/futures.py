"""Futures-chain and OI→FND-chart exporters.

Split out of export_static_json.py as the first per-topic exporter module.
Reads NewsItem futures chains (+ the OI history / 5-year contract archive) and
writes futures_chain.json and oi_fnd_chart.json.
"""
import json
from datetime import date, datetime, timedelta

from contract_dates import calc_fnd as _calc_fnd
from contract_dates import market_for as _market_for
from contract_dates import trading_days_to as _trading_days_to
from models import NewsItem
from scraper import symbols as _sym
from scraper.exporters.base import OUT_DIR, ROOT
from scraper.validate_export import (
    futures_chain_swing_guard,
    safe_write_json,
    validate_futures_chain,
    validate_oi_fnd_chart,
)

# Per-market contract month cycle, ordered. Used to derive the "next contract
# after the front" without depending on whether the next contract has data
# in the [-45, 0] day-to-its-own-FND window the candidates list is filtered by.
_CONTRACT_CYCLE = {
    "KC": ["H", "K", "N", "U", "Z"],
    "RM": ["F", "H", "K", "N", "U", "X"],
    "RC": ["F", "H", "K", "N", "U", "X"],
}


def _next_in_cycle(sym: str) -> str | None:
    """Given e.g. 'RMN26' returns 'RMU26'; 'KCZ26' → 'KCH27' (year wraps).
    Returns None for unparseable symbols or unknown roots."""
    p = _sym.parse(sym)
    if not p:
        return None
    root, letter, yy = p
    cycle = _CONTRACT_CYCLE.get(root)
    if not cycle or letter not in cycle:
        return None
    idx = cycle.index(letter)
    next_idx = (idx + 1) % len(cycle)
    next_yy  = f"{(int(yy) + 1) % 100:02d}" if next_idx == 0 else yy
    return f"{root}{cycle[next_idx]}{next_yy}"


def export_futures_chain(db) -> None:
    # Bound the scan to a recent window rather than pulling the entire
    # news_feed history into memory: we only need the latest chain per market
    # (the validator rejects pub_date > 7d old anyway). Tag membership stays a
    # Python filter because `tags` is a JSON column, not a Postgres array, so a
    # DB-side array containment filter wouldn't be portable to the SQLite tests.
    cutoff = datetime.utcnow() - timedelta(days=120)
    all_items = (
        db.query(NewsItem)
        .filter(NewsItem.meta.isnot(None), NewsItem.pub_date >= cutoff)
        .order_by(NewsItem.pub_date.desc())
        .all()
    )

    result = {}
    for market in ("arabica", "robusta"):
        item = next(
            (i for i in all_items
             if "futures" in (i.tags or [])
             and "price"   in (i.tags or [])
             and market     in (i.tags or [])
             and "b3"   not in (i.tags or [])
             and json.loads(i.meta or "{}").get("contracts")),
            None,
        )
        if not item:
            result[market] = None
            continue
        try:
            meta     = json.loads(item.meta or "{}")
            date_str = (
                item.title.split("–")[-1].strip()
                if "–" in item.title
                else str(item.pub_date)[:10]
            )
            # quote_date (T-1) is the display date for Daily Quotes;
            # date_str from the title is the T-2 trade date used by OI history.
            pub_date = meta.get("quote_date") or date_str
            result[market] = {
                "pub_date":  pub_date,
                "contracts": meta.get("contracts", []),
            }
        except Exception:
            result[market] = None

    path = OUT_DIR / "futures_chain.json"
    written = safe_write_json(path, result, validate_futures_chain,
                              sanity_fn=futures_chain_swing_guard())
    print(f"  futures_chain.json → written:{written} arabica:{result['arabica'] is not None} robusta:{result['robusta'] is not None}")


def _load_oi_history() -> dict:
    """Load oi_history.json (written by fetch_oi_json.py / daily_oi.yml)."""
    path = ROOT / "data" / "oi_history.json"
    if not path.exists():
        path = OUT_DIR / "oi_history.json"
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _load_contract_archive() -> dict:
    """Load the date-keyed per-contract OI+price archive
    (data/contract_prices_archive.json). Shape:
        {market: {YYYY-MM-DD: {SYMBOL: {oi, price}}}}
    This is the 5-year authoritative source — far deeper than the 30-day
    oi_history.json. RM robusta symbols are already normalized to RC here."""
    path = ROOT / "data" / "contract_prices_archive.json"
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def export_oi_fnd_chart(db) -> None:
    # Same memory bound as export_futures_chain: the FND series only needs the
    # last ~45 trading days of chain snapshots, so a 120-day calendar window is
    # ample while keeping the query from scanning the whole news_feed history.
    cutoff = datetime.utcnow() - timedelta(days=120)
    all_items = (
        db.query(NewsItem)
        .filter(NewsItem.meta.isnot(None), NewsItem.pub_date >= cutoff)
        .order_by(NewsItem.pub_date.asc())
        .all()
    )

    today     = date.today()
    cur_yr    = str(today.year)[-2:]
    prev_yr   = str(today.year - 1)[-2:]
    allowed   = {cur_yr, prev_yr}

    # Load oi_history.json — provides daily OI snapshots with full per-contract
    # OI (Playwright-fetched from Barchart), filling the -45…-30 day gap where
    # DB NewsItems may be missing OI (yfinance fallback doesn't supply OI).
    oi_history = _load_oi_history()
    # Load the 5-year per-contract archive — the deepest OI source, gives a
    # complete -45..0 window for every contract.
    contract_archive = _load_contract_archive()

    result = {}
    for market in ("arabica", "robusta"):
        mkt_key = "arabica" if market == "arabica" else "robusta"
        series:       dict[str, dict[int, int]]   = {}  # sym → {day → oi}
        # Per-contract settlement price, indexed the same way. Used by the
        # frontend to render the front calendar spread (next-FND contract
        # − contract after it) on a secondary y-axis. Source is the 5-year
        # archive — same series the OI numbers come from — so price and OI
        # for a given (sym, day) always agree.
        series_price: dict[str, dict[int, float]] = {}  # sym → {day → price}

        # 1. DB-derived points (from daily futures scraper)
        chain_items = [
            i for i in all_items
            if "futures" in (i.tags or [])
            and "price"   in (i.tags or [])
            and market     in (i.tags or [])
        ]
        for item in chain_items:
            try:
                meta       = json.loads(item.meta or "{}")
                trade_date = date.fromisoformat(
                    item.title.split("–")[-1].strip()
                    if "–" in item.title
                    else str(item.pub_date)[:10]
                )
                for c in meta.get("contracts", []):
                    sym = c.get("symbol", "")
                    oi  = c.get("oi")
                    if oi is None:
                        continue
                    fnd = _calc_fnd(sym)
                    if not fnd:
                        continue
                    day_val = _trading_days_to(trade_date, fnd, _market_for(sym) or "us")
                    if day_val < -45 or day_val > 0:
                        continue
                    series.setdefault(sym, {})[day_val] = oi
            except Exception:
                pass

        # 2. oi_history.json — fills in OI from the Playwright-fetched daily
        #    snapshots (always has real OI, extends further back in time).
        for snapshot in oi_history.get(mkt_key, []):
            try:
                snap_date = date.fromisoformat(snapshot["date"])
            except Exception:
                continue
            for c in snapshot.get("contracts", []):
                sym = c.get("symbol", "")
                oi  = c.get("oi")
                if oi is None:
                    continue
                fnd = _calc_fnd(sym)
                if not fnd:
                    continue
                day_val = _trading_days_to(snap_date, fnd, _market_for(sym) or "us")
                if day_val < -45 or day_val > 0:
                    continue
                # Don't overwrite DB-sourced point — DB is authoritative
                series.setdefault(sym, {}).setdefault(day_val, oi)

        # 3. contract_prices_archive.json — the 5-year authoritative per-contract
        #    OI history. Deepest source: gives a complete -45..0 window for
        #    every contract (oi_history only reaches ~21 trading days back).
        #    Archive stores robusta as RC; this chart's pipeline (and frontend
        #    STATIC_SERIES) uses RM, so convert RC→RM here for merge consistency.
        archive_market = contract_archive.get(mkt_key, {})
        # Bound the 5-year archive scan, but keep enough history that every
        # contract in `allowed` (cur_yr + prev_yr) still gets its FULL -45..0
        # window. The earliest contract in `allowed` (e.g. KCH25 if today is
        # 2026) has FND in early Feb and day -45 ≈ Dec of the year before
        # last — ~18 months back. 730 days (~24 months) covers it with margin.
        # The old 200-day bound silently truncated those early points (e.g.
        # KCH25 showing day -30 to 0 instead of -45 to 0) even though the
        # archive holds them.
        archive_cutoff = (today - timedelta(days=730)).isoformat()
        for snap_date_str, contracts in archive_market.items():
            if snap_date_str < archive_cutoff:
                continue
            try:
                snap_date = date.fromisoformat(snap_date_str)
            except Exception:
                continue
            for sym, cell in contracts.items():
                chart_sym = _sym.to_display(sym)  # RC→RM for the FND chart convention
                fnd = _calc_fnd(chart_sym)
                if not fnd:
                    continue
                day_val = _trading_days_to(snap_date, fnd, _market_for(chart_sym) or "us")
                if day_val < -45 or day_val > 0:
                    continue
                oi    = cell.get("oi")
                price = cell.get("price")
                # OI and price live on independent keys in the archive; the
                # latest snapshot is often price-only (intraday). Record
                # whichever is present without forcing both.
                if oi is not None:
                    series.setdefault(chart_sym, {}).setdefault(day_val, oi)
                if price is not None:
                    series_price.setdefault(chart_sym, {}).setdefault(day_val, price)

        candidates = []
        # Build the full set of contracts to emit. Some symbols may have
        # price data but no OI (e.g. when the archive's intraday/latest
        # snapshot only carries prices), so union both keys before filtering.
        all_syms = set(series.keys()) | set(series_price.keys())
        for sym in all_syms:
            if sym[-2:] not in allowed:
                continue
            fnd = _calc_fnd(sym)
            if not fnd:
                continue
            day_oi    = series.get(sym, {})
            day_price = series_price.get(sym, {})
            all_days  = sorted(set(day_oi) | set(day_price))
            data      = []
            for d in all_days:
                row: dict = {"day": d}
                if d in day_oi:
                    row["oi"] = day_oi[d]
                if d in day_price:
                    row["price"] = day_price[d]
                data.append(row)
            candidates.append({
                "symbol": sym,
                "label":  sym.replace("RM", "").replace("KC", ""),
                "fnd":    fnd.isoformat(),
                "data":   data,
            })
        candidates.sort(key=lambda x: x["fnd"])
        result[market] = candidates

        # ── Front calendar spread (front-FND contract − contract after it) ───
        # Each contract's per-day data is indexed to its own FND, so a naive
        # frontend join across {day_front, day_next} compares prices on
        # different calendar dates. And the next-FND contract often sits ~60+
        # trading days from its own FND when the front is near rollover, which
        # is outside the export's [-45, 0] window — so the next contract isn't
        # even in `candidates`.
        #
        # Pre-compute the spread here using calendar dates from the archive,
        # then index it to the FRONT's day-to-FND so the frontend can plot it
        # on a secondary axis directly. The next contract is derived from the
        # contract-month CYCLE — not from `candidates` — so the spread works
        # right up to and through rollover.
        today_iso  = today.isoformat()
        upcoming   = [c for c in candidates if c["fnd"] >= today_iso]
        spread_obj: dict | None = None
        if upcoming:
            front_disp = upcoming[0]["symbol"]                 # display form (RM for robusta)
            next_disp  = _next_in_cycle(front_disp)
            if next_disp:
                # The archive keys robusta as RC, arabica as KC. _sym.to_display()
                # normalises both legs to display form (RM / KC) before comparing.
                archive_market_map = contract_archive.get(mkt_key, {})
                front_prices: dict[str, float] = {}
                next_prices:  dict[str, float] = {}
                for snap_date_str, contracts_at in archive_market_map.items():
                    for s, cell in contracts_at.items():
                        p = cell.get("price")
                        if p is None:
                            continue
                        disp = _sym.to_display(s)
                        if disp == front_disp:
                            front_prices[snap_date_str] = p
                        elif disp == next_disp:
                            next_prices[snap_date_str] = p
                front_fnd   = _calc_fnd(front_disp)
                spread_data = []
                if front_fnd is not None and front_prices and next_prices:
                    # Walk every calendar date with a front price; emit the
                    # spread when the next contract also has a price on the
                    # same date and day_val lands in the chart window.
                    for snap_date_str, fp in front_prices.items():
                        np_ = next_prices.get(snap_date_str)
                        if np_ is None:
                            continue
                        try:
                            snap_date = date.fromisoformat(snap_date_str)
                        except Exception:
                            continue
                        day_val = _trading_days_to(snap_date, front_fnd, _market_for(front_disp) or "us")
                        if day_val < -45 or day_val > 0:
                            continue
                        # Round to 2dp — settle prices come at the exchange's
                        # native precision (0.05 for KC, 1 for RC) so this is
                        # lossless.
                        spread_data.append({"day": day_val, "spread": round(fp - np_, 2)})
                    spread_data.sort(key=lambda r: r["day"])
                    if spread_data:
                        spread_obj = {
                            "frontSym":   front_disp,
                            "nextSym":    next_disp,
                            "frontLabel": _sym.month_label(front_disp),
                            "nextLabel":  _sym.month_label(next_disp),
                            "data":       spread_data,
                        }
        result[f"{market}_front_spread"] = spread_obj

    path = OUT_DIR / "oi_fnd_chart.json"
    written = safe_write_json(path, result, validate_oi_fnd_chart)
    print(f"  oi_fnd_chart.json → written:{written} arabica:{len(result['arabica'])} robusta:{len(result['robusta'])} series")


# Emit at most this many trailing days. ~1400 trading days ≈ 5.5 calendar
# years, so the Industry Pulse 5Y window is fully covered by real daily prices
# (at 820 the line used to start ~3y in). The archive itself keeps ~5Y.
_PRICE_HISTORY_MAX_DAYS = 1400


def _front_price_series(market_archive: dict) -> list[dict]:
    """Front-month daily settlement price series from the per-contract archive.

    `market_archive` is {YYYY-MM-DD: {SYMBOL: {oi, price}}}. For each date the
    front month is the highest-OI contract; when OI is missing (ICE publishes it
    a day behind the price, so the most recent date has price-but-no-OI) we carry
    forward the last OI-determined front, else fall back to the nearest-expiry
    (first-listed) priced contract. Prices are passed through in their native
    unit — arabica in US¢/lb, robusta in USD/MT — matching oi_history so the
    frontend converts them the same way.

    Each row carries the `contract` it was priced from. Rolls are held
    MONOTONIC — the front never returns to an earlier expiry — because raw
    max-OI oscillates around a roll (robusta really did go N26→K26→N26 across
    2026-05-01/05-04), which would otherwise render as spurious contract
    switches. On a roll day the row also carries `prev_contract`/`prev_price`:
    the outgoing contract's settle on that same date, so a consumer can close
    the old price segment where it actually ended instead of leaving it hanging
    at the previous day.
    """
    rows: list[dict] = []
    last_front: str | None = None
    for d in sorted(market_archive):
        day = market_archive[d] or {}
        priced = {s: v for s, v in day.items()
                  if isinstance(v, dict) and v.get("price") is not None}
        if not priced:
            continue
        with_oi = {s: v for s, v in priced.items() if v.get("oi")}
        if with_oi:
            front = max(with_oi, key=lambda s: with_oi[s]["oi"] or 0)
            # Monotonic guard: ignore a max-OI candidate that steps BACK to an
            # earlier expiry while the incumbent is still trading.
            if (last_front and last_front in priced
                    and _sym.expiry_key(front) < _sym.expiry_key(last_front)):
                front = last_front
        elif last_front in priced:
            front = last_front
        else:
            front = next(iter(priced))          # dicts preserve insertion (expiry) order

        row = {"date": d, "price": priced[front]["price"], "contract": front}
        if last_front and front != last_front:
            outgoing = priced.get(last_front)
            if outgoing is not None:
                # Same-day settle of the contract we just rolled out of.
                row["prev_contract"] = last_front
                row["prev_price"] = outgoing["price"]
        last_front = front
        rows.append(row)
    return rows[-_PRICE_HISTORY_MAX_DAYS:]


def export_futures_price_history(db) -> None:
    """Write futures_price_history.json — the front-month KC/RC daily price
    history for the Origin Farmgate overlay.

    The overlay used to read oi_history.json, whose 14-day rolling window (a
    deliberate cap for the OI *visual* tables) truncated the futures line to two
    weeks. This sources the full ~5-year per-contract archive instead, so the
    overlay spans the whole selected window. The 14-day cap stays on the OI
    tables; only this price line is uncapped.
    """
    archive = _load_contract_archive()
    result = {
        "arabica": _front_price_series(archive.get("arabica") or {}),
        "robusta": _front_price_series(archive.get("robusta") or {}),
    }
    path = OUT_DIR / "futures_price_history.json"
    # Shape/liveness gate: both markets present and non-trivially populated.
    def _valid(d: dict) -> tuple[bool, str]:
        for m in ("arabica", "robusta"):
            if not isinstance(d.get(m), list) or len(d[m]) < 2:
                return False, f"{m} series too short"
        return True, "ok"
    written = safe_write_json(path, result, _valid)
    print(f"  futures_price_history.json → written:{written} "
          f"arabica:{len(result['arabica'])} robusta:{len(result['robusta'])} days")
