"""
fetch_oi_json.py
Fetches KC (Arabica) and RM (Robusta) OI chain data from Barchart using
Playwright, then prepends today's snapshot to data/oi_history.json.
Keeps the last 30 trading-day snapshots per market.

ALSO appends the same snapshot to data/contract_prices_archive.json — an
UNBOUNDED, never-trimmed per-contract price+OI history. oi_history.json is
the 14-day rolling window the frontend's OI tables read; the archive is the
permanent record so we accumulate true per-contract daily prices over time
(the data we lacked when the Stooq backfill went wrong — see RUNBOOK).

Run standalone:
    python backend/scraper/fetch_oi_json.py
"""

import asyncio
import json
import os
import sys
from datetime import UTC, date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pathlib import Path

import symbols  # noqa: E402  (sibling module: KC/RM/RC conventions)

from scraper.validate_export import safe_write_json  # noqa: E402

# Resolve project root (works both from repo root and from backend/)
ROOT = Path(__file__).resolve().parents[2]   # …/Coffee-intel-map
DATA_FILE = ROOT / "data" / "oi_history.json"
ARCHIVE_FILE = ROOT / "data" / "contract_prices_archive.json"
MAX_DAYS = 14
# Permanent archive retention: 10 years of trading days.
#
# The Industry Pulse price line only needs 5, but the archive is also the
# research series behind the certified-stocks/spread study — and that study
# found the robusta relationship CHANGES REGIME inside a 5-year window, which
# is precisely the case where a short sample misleads. Depth is the cheap fix.
#
# This must stay >= whatever backfill_contract_prices.py has fetched: the trim
# below runs nightly and would silently delete anything beyond the window.
# ~261 trading days/yr × 10 + buffer.
ARCHIVE_MAX_DAYS = 2640

BARCHART_INIT_URL = "https://www.barchart.com/futures/quotes/KCK26/overview"


def _prev_biz_day(d: date, n: int = 2) -> str:
    """Return d minus n business days as YYYY-MM-DD.

    Relative to the reference date (see _reference_date), per Barchart's lag:
      n=1 → the PRICE date (previous business day's settlement)
      n=2 → the OI date   (ICE open-interest is published a further day behind)
    """
    count = 0
    while count < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            count += 1
    return d.isoformat()


# The settle-date offsets above assume the job runs the MORNING AFTER a session,
# so date.today() − 1 biz day is the session that just settled. To let the job
# also run in the EVENING of the session itself (after ICE settlements publish,
# ~17:30 London robusta / ~13:30 ET arabica), we advance the reference date to
# "tomorrow" once past this UTC hour on a weekday — so the same N-1/N-2 offsets
# still land on the just-settled session. Morning runs are unchanged.
_SETTLE_HOUR_UTC = 20


def _reference_date(now: "datetime | None" = None) -> date:
    """Date the N-1/N-2 settlement offsets are computed from. Backward-compatible:
    a pre-settle (morning/daytime) run reuses today; a post-settle evening run on
    a weekday advances to the next day so an evening capture stamps the correct
    (just-settled) session instead of the prior one."""
    now = now or datetime.now(UTC)
    d = now.date()
    settled_today = d.weekday() < 5 and now.hour >= _SETTLE_HOUR_UTC
    return d + timedelta(days=1) if settled_today else d


async def _fetch_chains() -> dict:
    from playwright.async_api import async_playwright
    result = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        )
        pg = await ctx.new_page()
        try:
            await pg.goto(BARCHART_INIT_URL, wait_until="domcontentloaded", timeout=30000)
            await pg.wait_for_timeout(3000)
            data = await pg.evaluate(
                """async () => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const xsrf = getCookie('XSRF-TOKEN');
                    const h = { credentials: 'include', headers: { 'x-xsrf-token': xsrf, 'accept': 'application/json' } };
                    const base = 'https://www.barchart.com/proxies/core-api/v1/quotes/get';
                    const fields = 'symbol,contractName,contractExpirationDate,lastPrice,priceChange,openInterest,volume,symbolCode';
                    const opts = '&orderBy=contractExpirationDate&orderDir=asc&limit=12&raw=1';
                    const [kcResp, rmResp] = await Promise.all([
                        fetch(base + '?symbol=KC%5EF&fields=' + fields + opts, h),
                        fetch(base + '?symbol=RM%5EF&fields=' + fields + opts, h),
                    ]);
                    return {
                        kc: kcResp.ok ? await kcResp.json() : null,
                        rm: rmResp.ok ? await rmResp.json() : null,
                    };
                }"""
            )
            result = data or {}
        except Exception as e:
            print(f"[fetch_oi_json] Barchart fetch error: {e}")
        finally:
            await ctx.close()
            await browser.close()
    return result


def _parse(raw: dict, min_oi: int = 100) -> list[dict]:
    """Extract per-contract (symbol, oi, last_price) from the Barchart payload.

    Snapshotting `last_price` alongside `oi` lets a future operator reconstruct
    the COT-Tuesday max-OI price for any day in the 30-day window — the
    Industry Pulse chart now uses max-OI as the price anchor (see
    fetch_tuesday_prices.py::_front_price), and without the per-contract
    price recorded here, the price track can only be revised going forward.
    """
    from datetime import date, timedelta
    cutoff = date.today() + timedelta(days=14)
    contracts = []
    for it in (raw or {}).get("data", []):
        r = it.get("raw", it)
        oi = r.get("openInterest")
        if oi is None or int(oi) < min_oi:
            continue
        exp_str = r.get("contractExpirationDate", "")
        try:
            if date.fromisoformat(exp_str) <= cutoff:
                continue
        except Exception:
            pass
        entry = {"symbol": r.get("symbol", ""), "oi": int(oi)}
        last_price = r.get("lastPrice")
        if last_price is not None:
            try:
                entry["last_price"] = float(last_price)
            except (TypeError, ValueError):
                pass
        contracts.append(entry)
    return contracts


def _save_history(history: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(DATA_FILE, history)


def _derive_oi_history_from_archive(archive: dict) -> dict:
    """Build the 14-day rolling oi_history.json view FROM the archive — the
    single OI source of truth. Returns {market: [{date, contracts:[{symbol,
    oi, last_price?}]}]} newest-first, symbols in DISPLAY form (RM for
    robusta) to match the futures-page OI table. Only dates that actually
    carry OI are included (price-only N-1 rows are excluded)."""
    out: dict = {}
    for market in ("arabica", "robusta"):
        dated = []
        for d, cells in archive.get(market, {}).items():
            contracts = []
            for s, v in cells.items():
                if v.get("oi") is None:
                    continue
                entry = {"symbol": symbols.to_display(s), "oi": v["oi"]}
                if v.get("price") is not None:
                    entry["last_price"] = v["price"]
                contracts.append(entry)
            if contracts:
                dated.append((d, contracts))
        dated.sort(key=lambda x: x[0], reverse=True)
        out[market] = [{"date": d, "contracts": cs} for d, cs in dated[:MAX_DAYS]]
    return out


def _norm_symbol(sym: str) -> tuple[str, str] | None:
    """('RMN26') → ('robusta','RCN26'); ('KCN26') → ('arabica','KCN26')."""
    market = symbols.market_of(sym)
    if not market:
        return None
    return market, symbols.to_canonical(sym)


def _load_archive() -> dict:
    """Date-keyed per-contract OI+price archive:
        {market: {YYYY-MM-DD: {SYMBOL: {oi, price}}}}
    OI is written under oi_date (N-2), price under price_date (N-1); each
    trading date accumulates both over successive fetches."""
    if ARCHIVE_FILE.exists():
        with open(ARCHIVE_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {
        "_meta": {
            "description": (
                "Authoritative per-contract daily OI + price history, date-keyed. "
                "Each date → {contract: {oi, price}}. OI stamped at oi_date (N-2), "
                "price at price_date (N-1). RM robusta symbols stored as RC. "
                "Industry Pulse sources its price line from here."
            ),
            "started": date.today().isoformat(),
            "sources": [],
        },
        "arabica": {},
        "robusta": {},
    }


def _write_cells(archive: dict, contracts: list[dict], oi_date: str, price_date: str) -> None:
    """Write each contract's OI under oi_date and price under price_date,
    normalizing RM→RC. Merges into existing cells without clobbering the
    other field."""
    for c in contracts:
        ms = _norm_symbol(c.get("symbol", ""))
        if not ms:
            continue
        market, sym = ms
        if c.get("oi") is not None:
            archive.setdefault(market, {}).setdefault(oi_date, {}).setdefault(sym, {})["oi"] = c["oi"]
        if c.get("last_price") is not None:
            archive.setdefault(market, {}).setdefault(price_date, {}).setdefault(sym, {})["price"] = c["last_price"]


def _trim_archive(archive: dict) -> None:
    """Drop date keys older than the 5y retention window."""
    from datetime import datetime
    cutoff_ord = date.today().toordinal() - ARCHIVE_MAX_DAYS * 7 // 5  # ~calendar span for N trading days
    for market in ("arabica", "robusta"):
        days = archive.get(market, {})
        stale = [d for d in days if datetime.strptime(d, "%Y-%m-%d").date().toordinal() < cutoff_ord]
        for d in stale:
            del days[d]


def _save_archive(archive: dict) -> None:
    ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Compact — this file grows to ~1MB over 5y; no need for indent.
    safe_write_json(ARCHIVE_FILE, archive, indent=None, separators=(",", ":"))


async def main() -> None:
    print("[fetch_oi_json] Fetching OI chains from Barchart...")
    chains = await _fetch_chains()

    kc = _parse(chains.get("kc"))
    rm = _parse(chains.get("rm"))

    ref = _reference_date()
    oi_date    = _prev_biz_day(ref, n=2)   # OI lag: N-2 biz days
    price_date = _prev_biz_day(ref, n=1)   # price: N-1 biz day
    print(f"[fetch_oi_json] ref={ref.isoformat()}  price_date(N-1)={price_date}  oi_date(N-2)={oi_date}")
    print(f"[fetch_oi_json] Arabica contracts: {[c['symbol'] for c in kc]}")
    print(f"[fetch_oi_json] Robusta contracts:  {[c['symbol'] for c in rm]}")

    if not kc and not rm:
        print("[fetch_oi_json] No data fetched — aborting.")
        sys.exit(1)

    archive = _load_archive()

    # Single OI source: write the fetch into the date-keyed archive first
    # (OI → oi_date N-2, price → price_date N-1), then DERIVE the 30-day
    # oi_history.json view from it. No independently-maintained OI file.
    _write_cells(archive, kc, oi_date, price_date)
    _write_cells(archive, rm, oi_date, price_date)
    _trim_archive(archive)

    history = _derive_oi_history_from_archive(archive)

    _save_history(history)
    _save_archive(archive)
    arch_counts = f"arabica={len(archive.get('arabica', {}))} robusta={len(archive.get('robusta', {}))} dates"
    print(f"[fetch_oi_json] Saved 30-day OI window to {DATA_FILE} (oi_date={oi_date})")
    print(f"[fetch_oi_json] Updated archive {ARCHIVE_FILE} ({arch_counts}); oi→{oi_date} price→{price_date}")

    # News-feed badge — additive, never fails the snapshot.
    try:
        from scraper.oi_news_emit import emit_from_history_path
        emit_from_history_path(DATA_FILE)
    except Exception as e:  # noqa: BLE001
        print(f"[oi-news] FAILED: {e!r} — snapshot already written")


if __name__ == "__main__":
    asyncio.run(main())
