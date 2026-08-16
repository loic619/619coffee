"""
fetch_options_json.py — daily KC/RM options-on-futures snapshot from Barchart.

Same Playwright + core-api pattern as fetch_oi_json.py (load a Barchart page,
lift the XSRF cookie, call /proxies/core-api in-page). For each market it pulls
the options boards of the NEAREST few futures contracts whose options are
still alive (positioning rolls to the back months well before the front's
options expire, so a highest-OI pick used to skip the board that matters most
in expiry week — e.g. RMU26 four days from option expiry while OI sat in X26).

Writes frontend/public/data/options_oi.json:
  {
    updated, markets: {
      arabica|robusta: { contracts: [                # nearest expiry first
        { underlying, future_price, option_expiry, days_to_expiry,
          expiry_source, strikes: [{strike, call_oi, put_oi, call_vol, put_vol}],
          totals: {call_oi, put_oi, itm_call_oi, itm_put_oi} }, ...] }
    },
    history: [{date, arabica: [{underlying, future_price, days_to_expiry,
                                call_oi, put_oi, itm_call_oi, itm_put_oi}, ...],
                     robusta: [...]}]
  }
(Older rows/snapshots used a single-contract object; the panel normalises.)
ITM = calls with strike < future price, puts with strike > future price —
the OI that turns into futures positions (or gets defended) into expiry, which
is what the countdown visual tracks. History accumulates one row per day;
per-strike detail is kept for the latest session only (the board chart).

Run standalone:  python backend/scraper/fetch_options_json.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "data" / "options_oi.json"
STRIKE_HIST_OUT = ROOT / "frontend" / "public" / "data" / "options_strike_history.json"
INIT_URL = "https://www.barchart.com/futures/quotes/KCK26/overview"
HISTORY_MAX_DAYS = 400          # ~1.5y of countdown history is plenty
MAX_CONTRACTS = 3               # nearest live option boards per market
ARCHIVE = ROOT / "data" / "options_boards_archive.json"
PRICES = ROOT / "data" / "contract_prices_archive.json"
# Archive row layout (per strike, one array per strike):
ARCHIVE_HEADER = ["strike",
                  "call_oi", "call_vol", "call_last", "call_iv", "call_delta",
                  "call_gamma", "call_theta", "call_vega",
                  "put_oi", "put_vol", "put_last", "put_iv", "put_delta",
                  "put_gamma", "put_theta", "put_vega"]

MARKETS = {"arabica": "KC", "robusta": "RM"}


async def _fetch() -> dict:
    from playwright.async_api import async_playwright
    out: dict = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"))
        pg = await ctx.new_page()
        try:
            await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=45000)
            await pg.wait_for_timeout(3000)
            out = await pg.evaluate(
                """async (roots) => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const h = { credentials: 'include',
                                headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                                           'accept': 'application/json' } };
                    const base = 'https://www.barchart.com/proxies/core-api/v1/quotes/get';
                    const res = {};
                    for (const [mkt, root] of Object.entries(roots)) {
                        // 1. futures chain → pick the front (highest-OI) contract
                        const cf = 'symbol,contractExpirationDate,lastPrice,openInterest,volume';
                        const cu = base + '?symbol=' + root +
                            '%5EF&fields=' + cf +
                            '&orderBy=contractExpirationDate&orderDir=asc&limit=12&raw=1';
                        const cr = await fetch(cu, h);
                        if (!cr.ok) { res[mkt] = {error: 'chain http ' + cr.status}; continue; }
                        const chain = (await cr.json()).data || [];
                        // Nearest contracts first (chain is expiry-ascending);
                        // Python filters out those whose options already
                        // expired and trims to MAX_CONTRACTS live boards.
                        const picks = [];
                        for (const c of chain) {
                            const r = c.raw || c;
                            const sym = r.symbol || c.symbol;
                            if (!sym) continue;
                            picks.push({ symbol: sym,
                                         oi: Number(r.openInterest) || 0,
                                         price: Number(r.lastPrice) || null });
                            if (picks.length >= 5) break;
                        }
                        if (!picks.length) { res[mkt] = {error: 'no contracts'}; continue; }
                        const of_ = 'symbol,strike,optionType,lastPrice,volume,openInterest,' +
                                    'impliedVolatility,delta,gamma,theta,vega,expirationDate,daysToExpiration,tradeTime';
                        const boards = [];
                        for (const pk of picks) {
                            const ou = base + '?symbol=' + pk.symbol +
                                '&list=futures.options&fields=' + of_ + '&raw=1&limit=999';
                            const or_ = await fetch(ou, h);
                            boards.push({
                                front: pk,
                                options: or_.ok ? await or_.json()
                                                : {error: 'options http ' + or_.status},
                            });
                        }
                        res[mkt] = { boards };
                    }
                    return res;
                }""",
                MARKETS,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[fetch_options_json] Barchart fetch error: {e}")
        finally:
            await ctx.close()
            await browser.close()
    return out or {}


_MONTH_CODES = {"F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
                "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12}


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """n-th `weekday` (Mon=0) of a month."""
    d = date(year, month, 1)
    off = (weekday - d.weekday()) % 7
    return d.replace(day=1 + off + 7 * (n - 1))


def _rule_expiry(underlying: str) -> date | None:
    """Exchange-rule option expiry for a KC/RM futures symbol.

    KC: last trading day is the SECOND FRIDAY of the calendar month preceding
    the contract month (ICE Futures US rulebook ch.8; a rarely-hit proviso can
    pull it earlier when FND is close). RM: 12:30 London on the THIRD
    WEDNESDAY of the month preceding expiry (ICE Futures Europe spec; noted as
    subject to change for post-Jul-2026 expiries, hence expiry_source="rule"
    marks these as approximations whenever the API doesn't answer).
    """
    m = (underlying or "").strip().upper()
    if len(m) < 5 or m[-3] not in _MONTH_CODES:
        return None
    root, code, yy = m[:-3], m[-3], m[-2:]
    try:
        year = 2000 + int(yy)
    except ValueError:
        return None
    month = _MONTH_CODES[code]
    pm, py = (month - 1, year) if month > 1 else (12, year - 1)
    if root.startswith("KC"):
        return _nth_weekday(py, pm, 4, 2)      # 2nd Friday
    if root.startswith("RM") or root.startswith("RC"):
        return _nth_weekday(py, pm, 2, 3)      # 3rd Wednesday
    return None



# ── Black-76 (options on futures, zero discounting over short DTE) ──────────
def _norm_cdf(x: float) -> float:
    import math
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _black76(f: float, k: float, t: float, sigma: float, call: bool) -> float:
    import math
    if t <= 0 or sigma <= 0 or f <= 0 or k <= 0:
        return max(0.0, (f - k) if call else (k - f))
    sq = sigma * math.sqrt(t)
    d1 = (math.log(f / k) + 0.5 * sigma * sigma * t) / sq
    d2 = d1 - sq
    if call:
        return f * _norm_cdf(d1) - k * _norm_cdf(d2)
    return k * _norm_cdf(-d2) - f * _norm_cdf(-d1)


def _implied_vol(price: float, f: float, k: float, t: float, call: bool) -> float | None:
    """Bisection Black-76 IV. None when the premium is outside no-arbitrage
    bounds (stale last on an illiquid strike — better a gap than a lie)."""
    intrinsic = max(0.0, (f - k) if call else (k - f))
    if t <= 0 or price <= intrinsic + 1e-9 or price >= (f if call else k):
        return None
    lo, hi = 1e-3, 4.0
    for _ in range(64):
        mid = (lo + hi) / 2
        if _black76(f, k, t, mid, call) > price:
            hi = mid
        else:
            lo = mid
    iv = (lo + hi) / 2
    return round(iv, 4) if 1e-3 < iv < 3.999 else None


def _b76_delta(f: float, k: float, t: float, sigma: float, call: bool) -> float | None:
    import math
    if t <= 0 or sigma is None or sigma <= 0 or f <= 0 or k <= 0:
        return None
    d1 = (math.log(f / k) + 0.5 * sigma * sigma * t) / (sigma * math.sqrt(t))
    return round(_norm_cdf(d1) if call else _norm_cdf(d1) - 1.0, 3)


def _num(v):
    try:
        if v in (None, "", "N/A", "N\\/A"):
            return None
        return float(str(v).replace(",", "").rstrip("s"))
    except (TypeError, ValueError):
        return None


def _rows(options_payload: dict) -> list[dict]:
    """Flatten Barchart's options payload to [{strike, type, oi, vol, expiry, dte}].

    The grouped shape is {"data": {"Call": [...], "Put": [...]}}; some variants
    return a flat {"data": [...]} with an optionType field. Handle both.
    """
    data = (options_payload or {}).get("data")
    entries: list[tuple[str, dict]] = []
    if isinstance(data, dict):
        for side, arr in data.items():
            for it in arr or []:
                entries.append((side, it))
    elif isinstance(data, list):
        for it in data:
            entries.append((str(it.get("optionType", it.get("raw", {}).get("optionType", "?"))), it))
    rows = []
    for side, it in entries:
        r = it.get("raw", it) or it
        raw_strike = r.get("strike", it.get("strike"))
        s = str(raw_strike)
        typ = ("C" if s.upper().endswith("C") else "P" if s.upper().endswith("P")
               else side[:1].upper())
        strike = _num(s.rstrip("CPcp"))
        if strike is None:
            continue
        rows.append({
            "strike": strike,
            "type": "call" if typ == "C" else "put",
            "oi": _num(r.get("openInterest", it.get("openInterest"))),
            "vol": _num(r.get("volume", it.get("volume"))),
            "last": _num(r.get("lastPrice", it.get("lastPrice"))),
            "iv": _num(r.get("impliedVolatility", it.get("impliedVolatility"))),
            "delta": _num(r.get("delta", it.get("delta"))),
            "gamma": _num(r.get("gamma", it.get("gamma"))),
            "theta": _num(r.get("theta", it.get("theta"))),
            "vega": _num(r.get("vega", it.get("vega"))),
            "expiry": r.get("expirationDate") or it.get("expirationDate"),
            "dte": _num(r.get("daysToExpiration", it.get("daysToExpiration"))),
            "trade": r.get("tradeTime", it.get("tradeTime")),
        })
    return rows


def _trade_date(v) -> str | None:
    """tradeTime → YYYY-MM-DD; epoch numbers and ISO-ish strings both occur."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and v > 1e9:
        from datetime import datetime as _dt
        return _dt.fromtimestamp(v, UTC).date().isoformat()
    s = str(v)[:10]
    return s if len(s) == 10 and s[4] == "-" else None


def _fill_iv(snap: dict) -> None:
    """IV + delta: prefer Barchart's own values; otherwise back them out of the
    last premium via Black-76 (F, K, T known; r≈0 over these horizons). A stale
    last that violates no-arbitrage bounds yields None, not a fake IV.

    Idempotent (only fills None slots) — main() calls it again after the
    rule-based expiry lands, because the board payload itself carries no
    expiry fields and days_to_expiry is unknown at snapshot time."""
    price, dte = snap.get("future_price"), snap.get("days_to_expiry")
    if not price or not dte or dte <= 0:
        return
    t = dte / 365.0
    for slot in snap["strikes"]:
        for side, is_call in (("call", True), ("put", False)):
            if slot[f"{side}_iv"] is None and slot[f"{side}_last"]:
                slot[f"{side}_iv"] = _implied_vol(slot[f"{side}_last"], price,
                                                  slot["strike"], t, is_call)
            if slot[f"{side}_delta"] is None and slot[f"{side}_iv"]:
                slot[f"{side}_delta"] = _b76_delta(price, slot["strike"], t,
                                                   slot[f"{side}_iv"], is_call)


def _market_snapshot(mkt_payload: dict) -> dict | None:
    front = (mkt_payload or {}).get("front") or {}
    rows = _rows((mkt_payload or {}).get("options") or {})
    if not front.get("symbol") or not rows:
        return None
    price = front.get("price")
    by_strike: dict[float, dict] = {}
    for r in rows:
        slot = by_strike.setdefault(r["strike"], {"strike": r["strike"], "call_oi": 0,
                                                  "put_oi": 0, "call_vol": 0, "put_vol": 0,
                                                  "call_last": None, "put_last": None,
                                                  "call_iv": None, "put_iv": None,
                                                  "call_delta": None, "put_delta": None,
                                                  "call_gamma": None, "put_gamma": None,
                                                  "call_theta": None, "put_theta": None,
                                                  "call_vega": None, "put_vega": None})
        side = "call" if r["type"] == "call" else "put"
        slot[f"{side}_oi"] += r["oi"] or 0
        slot[f"{side}_vol"] += r["vol"] or 0
        if r.get("last") is not None:
            slot[f"{side}_last"] = r["last"]
        if r.get("iv") is not None:
            slot[f"{side}_iv"] = r["iv"]
        if r.get("delta") is not None:
            slot[f"{side}_delta"] = r["delta"]
        for g in ("gamma", "theta", "vega"):
            if r.get(g) is not None:
                slot[f"{side}_{g}"] = r[g]
    strikes = sorted(by_strike.values(), key=lambda s: s["strike"])
    call_oi = sum(s["call_oi"] for s in strikes)
    put_oi = sum(s["put_oi"] for s in strikes)
    itm_call = sum(s["call_oi"] for s in strikes if price and s["strike"] < price)
    itm_put = sum(s["put_oi"] for s in strikes if price and s["strike"] > price)
    expiry = next((r["expiry"] for r in rows if r["expiry"]), None)
    dte = next((r["dte"] for r in rows if r["dte"] is not None), None)
    if dte is None and expiry:
        try:
            from datetime import datetime as _dt
            dte = ( _dt.fromisoformat(str(expiry)[:10]).date() - date.today() ).days
        except ValueError:
            pass
    snap = {
        "underlying": front["symbol"],
        "future_price": price,
        "option_expiry": expiry,
        "days_to_expiry": dte,
        "strikes": strikes,
        "totals": {"call_oi": call_oi, "put_oi": put_oi,
                   "itm_call_oi": itm_call, "itm_put_oi": itm_put},
        # newest trade date on the board = the session this data belongs to
        # (on weekends/holidays Barchart keeps serving the last session)
        "session_date": max((d for d in (_trade_date(r.get("trade"))
                                         for r in rows) if d), default=None),
    }
    _fill_iv(snap)
    return snap



def _load_archive() -> dict:
    try:
        return json.loads(ARCHIVE.read_text(encoding="utf-8"))
    except Exception:
        return {
            "note": ("Per-session options boards for research/backtests. rows follow "
                     "`header`; IV is Black-76-implied from the last premium when "
                     "Barchart does not serve it (None = no fresh/arbitrage-consistent "
                     "premium). IV+underlying+DTE reconstruct premiums and all greeks."),
            "header": ARCHIVE_HEADER,
            "days": {},
        }


def _prev_board(archive: dict, mkt: str, underlying: str, before: str) -> dict[float, tuple]:
    """{strike: (call_oi, put_oi)} from the latest archived session < `before`
    whose OI has been published — a session archived before ICE posted its
    final OI carries all-None OI columns and is skipped, not read as zeros."""
    days = archive.get("days") or {}
    for d in sorted(days.keys(), reverse=True):
        if d >= before:
            continue
        for b in days[d].get(mkt) or []:
            if b.get("u") == underlying:
                out = {}
                filled = False
                for row in b.get("rows") or []:
                    try:
                        # header: put_oi at index 9 (17-col rows) or 6 (legacy 11-col)
                        p_idx = 9 if len(row) >= 17 else 6
                        if row[1] is not None or row[p_idx] is not None:
                            filled = True
                        out[float(row[0])] = (row[1] or 0, row[p_idx] or 0)
                    except (TypeError, ValueError, IndexError):
                        continue
                if out and filled:
                    return out
    return {}


def _apply_oi_change(snap: dict, prev: dict[float, tuple]) -> None:
    """Per-strike day-over-day OI change vs the previous archived session.
    None (not 0) when there is no prior board to diff against."""
    for slot in snap["strikes"]:
        p = prev.get(slot["strike"])
        slot["call_chg"] = (slot["call_oi"] - p[0]) if p else None
        slot["put_chg"] = (slot["put_oi"] - p[1]) if p else None


def _future_oi() -> dict:
    """{market: {date: {symbol: oi}}} from the per-contract futures archive
    (session-close convention there too; RM robusta symbols stored as RC)."""
    try:
        arch = json.loads(PRICES.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict = {}
    for mkt, days in arch.items():
        if mkt.startswith("_") or not isinstance(days, dict):
            continue
        out[mkt] = {}
        for d, contracts in days.items():
            if isinstance(contracts, dict):
                out[mkt][d] = {sym: v.get("oi") for sym, v in contracts.items()
                               if isinstance(v, dict)}
    return out


def _history_from_archive(archive: dict, markets: dict) -> list[dict]:
    """Rebuild the per-session history (countdown + ATM IV) from the FULL
    archive, so the charts are deep from day one — the archive holds the
    backfilled sessions, not just days the live fetch has run. Only the
    currently tracked underlyings are surfaced; dead boards stay in the
    archive for research but drop out of the frontend series."""
    tracked = {mkt: {c["underlying"] for c in block["contracts"]}
               for mkt, block in markets.items()}
    fut_oi = _future_oi()
    out = []
    for d in sorted(archive.get("days") or {}):
        row: dict = {"date": d}
        for mkt, boards in (archive["days"][d] or {}).items():
            entries = []
            for b in boards or []:
                und = b.get("u")
                if und not in tracked.get(mkt, set()):
                    continue
                px = b.get("px")
                call_oi = put_oi = itm_c = itm_p = 0
                oi_published = False
                atm_iv, atm_dist = None, None
                for r in b.get("rows") or []:
                    k = r[0]
                    p_off = 9 if len(r) >= 17 else 6   # legacy 11-col rows
                    if r[1] is not None or r[p_off] is not None:
                        oi_published = True
                    c_oi, p_oi = r[1] or 0, r[p_off] or 0
                    call_oi += c_oi
                    put_oi += p_oi
                    if px:
                        if k < px:
                            itm_c += c_oi
                        if k > px:
                            itm_p += p_oi
                        if len(r) >= 17:
                            ivs = [v for v in (r[4], r[12]) if v]
                            if ivs and (atm_dist is None
                                        or abs(k - px) < atm_dist):
                                atm_dist = abs(k - px)
                                atm_iv = round(sum(ivs) / len(ivs), 4)
                # A session whose final OI hasn't been published yet (all
                # OI columns None) reports None, not zeros — the countdown
                # line stops instead of plunging to 0.
                day_oi = (fut_oi.get(mkt) or {}).get(d) or {}
                f_oi = day_oi.get(und)
                if f_oi is None and und.startswith("RM"):
                    f_oi = day_oi.get("RC" + und[2:])
                entries.append({"underlying": und, "future_price": px,
                                "days_to_expiry": b.get("dte"),
                                "call_oi": call_oi if oi_published else None,
                                "put_oi": put_oi if oi_published else None,
                                "itm_call_oi": itm_c if oi_published else None,
                                "itm_put_oi": itm_p if oi_published else None,
                                "fut_oi": f_oi,
                                "atm_iv": atm_iv})
            if entries:
                row[mkt] = entries
        if len(row) > 1:
            out.append(row)
    return out[-HISTORY_MAX_DAYS:]


def _retro_fill_oi(archive: dict, prev_sess: str | None, markets: dict) -> None:
    """Write the live board's OI into the PREVIOUS session's archived rows.

    ICE publishes an option session's final OI the next business morning, so
    the OI visible on today's board is the CLOSING OI of the session before
    the board's own trade date. Each session's row therefore gets its OI one
    run later; the newest session stores None until its OI is published."""
    if not prev_sess:
        return
    day = (archive.get("days") or {}).get(prev_sess) or {}
    for mkt, block in markets.items():
        for snap in block["contracts"]:
            board = next((b for b in day.get(mkt) or []
                          if b.get("u") == snap["underlying"]), None)
            if board is None:
                continue
            rows = board.setdefault("rows", [])
            by_strike = {r[0]: r for r in rows if r}
            for sl in snap["strikes"]:
                row = by_strike.get(sl["strike"])
                if row is None:
                    row = [sl["strike"]] + [None] * (len(ARCHIVE_HEADER) - 1)
                    rows.append(row)
                    by_strike[sl["strike"]] = row
                if len(row) >= 17:          # legacy 11-col rows keep their shape
                    row[1], row[9] = sl["call_oi"], sl["put_oi"]
            rows.sort(key=lambda r: r[0])


def _session_dte(snap: dict, session: str) -> float | None:
    """DTE relative to the SESSION date (the archive key), so a weekend run
    stores the same countdown value the session itself would have."""
    if snap.get("option_expiry"):
        try:
            return (date.fromisoformat(str(snap["option_expiry"])[:10])
                    - date.fromisoformat(session)).days
        except ValueError:
            pass
    return snap["days_to_expiry"]


def _strike_history(archive: dict, markets: dict) -> dict:
    """Slim per-strike OI matrix for the frontend's date/period selector:
    {market: {underlying: {dates, strikes, call[[...]], put[[...]]}}} — OI
    only, published sessions only, capped to HISTORY_MAX_DAYS. The full
    per-strike IV/greeks history stays in the research archive."""
    out: dict = {}
    day_keys = sorted(archive.get("days") or {})
    for mkt, block in markets.items():
        mm = out.setdefault(mkt, {})
        for snap in block["contracts"]:
            und = snap["underlying"]
            per_day = []
            for d in day_keys:
                b = next((x for x in (archive["days"][d].get(mkt) or [])
                          if x.get("u") == und), None)
                if b is None:
                    continue
                cells, published = {}, False
                for r in b.get("rows") or []:
                    p_off = 9 if len(r) >= 17 else 6
                    c, p = r[1], r[p_off]
                    if c is not None or p is not None:
                        published = True
                    cells[r[0]] = (c, p)
                if published:
                    per_day.append((d, cells))
            per_day = per_day[-HISTORY_MAX_DAYS:]
            if not per_day:
                continue
            strikes = sorted({k for _, cells in per_day for k in cells})
            mm[und] = {
                "dates": [d for d, _ in per_day],
                "strikes": strikes,
                "call": [[None if (v := (cells.get(k) or (None, None))[0]) is None
                          else int(v) for k in strikes] for _, cells in per_day],
                "put": [[None if (v := (cells.get(k) or (None, None))[1]) is None
                         else int(v) for k in strikes] for _, cells in per_day],
            }
    return out


def _archive_boards(archive: dict, session: str, markets: dict) -> None:
    day = {}
    for mkt, block in markets.items():
        day[mkt] = [
            {
                "u": snap["underlying"], "px": snap["future_price"],
                "dte": _session_dte(snap, session),
                # OI columns start as None: the OI on today's board belongs to
                # the PREVIOUS session (see _retro_fill_oi), and this session's
                # own closing OI arrives with the next run's retro-fill.
                "rows": [
                    [sl["strike"],
                     None, sl["call_vol"], sl["call_last"],
                     sl["call_iv"], sl["call_delta"],
                     sl["call_gamma"], sl["call_theta"], sl["call_vega"],
                     None, sl["put_vol"], sl["put_last"],
                     sl["put_iv"], sl["put_delta"],
                     sl["put_gamma"], sl["put_theta"], sl["put_vega"]]
                    for sl in snap["strikes"]
                ],
            }
            for snap in block["contracts"]
        ]
    archive.setdefault("days", {})[session] = day
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_text(json.dumps(archive, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")


def main() -> int:
    raw = asyncio.run(_fetch())
    markets = {}
    for mkt in MARKETS:
        snaps = []
        for board in (raw.get(mkt) or {}).get("boards") or []:
            snap = _market_snapshot(board)
            if not snap:
                continue
            if not snap.get("option_expiry"):
                rd = _rule_expiry(snap["underlying"])
                if rd:
                    snap["option_expiry"] = rd.isoformat()
                    snap["days_to_expiry"] = (rd - date.today()).days
                    snap["expiry_source"] = "rule"
                    _fill_iv(snap)  # dte only just became known
            else:
                snap["expiry_source"] = "api"
            # A board whose options already expired is history, not signal —
            # drop it so the front chip is always a LIVE expiry.
            if snap.get("days_to_expiry") is not None and snap["days_to_expiry"] < 0:
                print(f"[options] {mkt}: {snap['underlying']} options expired "
                      f"{snap['option_expiry']} — skipped")
                continue
            snaps.append(snap)
            print(f"[options] {mkt}: {snap['underlying']} — "
                  f"{len(snap['strikes'])} strikes, call OI {snap['totals']['call_oi']:.0f}, "
                  f"put OI {snap['totals']['put_oi']:.0f}, "
                  f"ITM {snap['totals']['itm_call_oi'] + snap['totals']['itm_put_oi']:.0f}, "
                  f"DTE {snap['days_to_expiry']} ({snap.get('expiry_source')})")
            if len(snaps) >= MAX_CONTRACTS:
                break
        if snaps:
            markets[mkt] = {"contracts": snaps}
        else:
            err = (raw.get(mkt) or {}).get("error")
            print(f"[options] {mkt}: no live boards ({str(err)[:120]})")
    if not markets:
        print("[options] nothing fetched — keeping existing file")
        return 1

    # Everything is stamped with the SESSION the boards belong to (newest
    # trade date seen), not the wall-clock date: a Saturday/holiday run just
    # re-upserts Friday's session instead of minting a bogus new day.
    today_iso = date.today().isoformat()
    session = max((s["session_date"] for b in markets.values()
                   for s in b["contracts"] if s.get("session_date")),
                  default=today_iso)
    if session != today_iso:
        print(f"[options] boards belong to session {session} (ran {today_iso})")
    archive = _load_archive()
    # The OI on the live board is the CLOSING OI of the session before
    # `session` (ICE posts it the next business morning). It is written back
    # into that previous session's row, and the ΔOI published with the board
    # is that session's change: close(prev) − close(prev−1).
    prev_sess = max((d for d in (archive.get("days") or {}) if d < session),
                    default=None)
    for mkt, block in markets.items():
        for snap in block["contracts"]:
            _apply_oi_change(snap, _prev_board(archive, mkt, snap["underlying"],
                                               prev_sess or session))
    _retro_fill_oi(archive, prev_sess, markets)
    _archive_boards(archive, session, markets)
    print(f"[options] archive → {len(archive['days'])} sessions stored")

    try:
        doc = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        doc = {"history": []}
    doc.setdefault("history", [])

    today = today_iso
    # History is DERIVED from the archive (which now includes today's boards),
    # so backfilled sessions feed the countdown and ATM-IV charts immediately.
    doc["history"] = _history_from_archive(archive, markets)
    doc["markets"] = markets
    doc["updated"] = datetime.now(UTC).isoformat()
    doc.setdefault("source", "Barchart core-api (delayed) — options on ICE KC / RM futures")
    doc.setdefault("note", "ITM = calls below / puts above the front future's last price; "
                           "history is one aggregate row per session (rebuilt from "
                           "data/options_boards_archive.json) for the countdown and ATM-IV charts.")
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    STRIKE_HIST_OUT.write_text(json.dumps(
        {"updated": doc["updated"], "markets": _strike_history(archive, markets)},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = {m: len(b["contracts"]) for m, b in markets.items()}
    print(f"[options] options_oi.json → {today}: {n} "
          f"({len(doc['history'])} history rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
