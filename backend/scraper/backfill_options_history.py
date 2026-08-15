"""
backfill_options_history.py — seed the options archive from Barchart's
per-option EOD history (one-shot; re-runnable).

The probe established that /proxies/core-api/v1/historical/get serves a full
daily series (tradeTime, lastPrice, volume, openInterest) for every LIVE
option symbol — RMU26|3600C answered 299 rows back to Jun-2025 — but returns
nothing once an option has expired (KCU26 boards were empty one day after
expiry). So expired contracts are unrecoverable, and the deepest possible
backfill is: every strike of the currently-tracked boards, from listing to
today. From now on the daily archive keeps boards before they die.

For each archived day it also computes Black-76 IV + delta per side, using the
underlying future's settlement from data/contract_prices_archive.json and the
exchange-rule expiry — so the historical rows carry the same reconstruction
fields as the live ones (gamma/theta/vega derive from IV offline).

Run:  python backend/scraper/backfill_options_history.py [start YYYY-MM-DD]
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_options_json import (  # noqa: E402
    ARCHIVE,
    ARCHIVE_HEADER,
    INIT_URL,
    MARKETS,
    MAX_CONTRACTS,
    ROOT,
    _b76_delta,
    _implied_vol,
    _load_archive,
    _rule_expiry,
)

PRICES = ROOT / "data" / "contract_prices_archive.json"
DEFAULT_START = "2024-06-01"


BASE = "https://www.barchart.com/proxies/core-api/v1"

# one small in-page fetch per request: a single monolithic evaluate died
# 20 minutes in when the barchart page auto-navigated and destroyed the
# execution context. Python drives the loop; a destroyed context is healed
# by re-navigating and retrying the one lost request.
_JS_FETCH = """async (url) => {
    function getCookie(n) {
        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
        return v ? decodeURIComponent(v[2]) : null;
    }
    const r = await fetch(url, { credentials: 'include',
        headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                   'accept': 'application/json' } });
    if (!r.ok) return { __status: r.status };
    return await r.json();
}"""


async def _api(pg, url: str, tries: int = 4):
    """Fetch a core-api URL through the page; None on unrecoverable failure.

    Barchart throttles hard after ~60 rapid calls — back off 20/40/60s on
    429/5xx. On a destroyed context (page navigated), reload and retry."""
    for i in range(tries):
        try:
            res = await pg.evaluate(_JS_FETCH, url)
        except Exception:
            try:
                await pg.goto(INIT_URL, wait_until="domcontentloaded",
                              timeout=45000)
                await pg.wait_for_timeout(2000)
            except Exception:
                pass
            continue
        status = res.get("__status") if isinstance(res, dict) else None
        if status is None:
            return res
        if status != 429 and status < 500:
            return None
        await asyncio.sleep(20 * (i + 1))
    return None


def _parse_board(bj: dict | None) -> dict:
    """{optSym: {strike, type}} — side from optionType or the SYMBOL suffix
    (KCZ6|1000C); the strike field is plain numeric, no C/P marker."""
    bd = (bj or {}).get("data")
    arr = bd if isinstance(bd, list) else [
        x for v in (bd or {}).values()
        for x in (v if isinstance(v, list) else [])]
    options: dict = {}
    for it in arr:
        r = it.get("raw") or it
        sym = str(r.get("symbol") or "")
        if not sym:
            continue
        ot = str(r.get("optionType") or "").upper()
        side = ("P" if ot.startswith("P") else "C" if ot.startswith("C")
                else "P" if sym.endswith("P") else "C")
        strike = None
        try:
            strike = float(re.sub(r"[^0-9.\-]", "", str(r.get("strike"))))
        except ValueError:
            if "|" in sym:
                try:
                    strike = float(sym.split("|")[1].rstrip("CP")) / 10
                except ValueError:
                    strike = None
        if strike is None:
            continue
        options[sym] = {"strike": strike, "type": side}
    return options


async def _fetch_histories(start: str) -> dict:
    """{market: [{underlying, options: {optSym: {strike, type}},
                  hist: {optSym: [[date, last, vol, oi], ...]},
                  futHist: {date: px}, fails: int}]}"""
    from playwright.async_api import async_playwright
    out: dict = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"))
        pg = await ctx.new_page()
        await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=45000)
        await pg.wait_for_timeout(3000)
        for mkt, root in MARKETS.items():
            blocks: list = []
            cj = await _api(pg, f"{BASE}/quotes/get?symbol={root}%5EF"
                            "&fields=symbol&orderBy=contractExpirationDate"
                            "&orderDir=asc&limit=6&raw=1")
            chain = [s for s in ((c.get("raw") or c).get("symbol")
                                 for c in (cj or {}).get("data") or []) if s]
            for und in chain:
                if len(blocks) >= MAX_CONTRACTS:
                    break
                await asyncio.sleep(1.0)
                bj = await _api(pg, f"{BASE}/quotes/get?symbol={und}"
                                "&list=futures.options"
                                "&fields=symbol,strike,optionType"
                                "&raw=1&limit=999")
                options = _parse_board(bj)
                if not options:
                    continue
                await asyncio.sleep(1.0)
                fj = await _api(pg, f"{BASE}/historical/get"
                                f"?symbol={quote(und)}&type=eod"
                                f"&startDate={start}"
                                "&fields=tradeTime,lastPrice&raw=1&limit=600")
                fut_hist = {}
                for x in (fj or {}).get("data") or []:
                    r = x.get("raw") or x
                    if r.get("tradeTime") and r.get("lastPrice") is not None:
                        fut_hist[str(r["tradeTime"])[:10]] = r["lastPrice"]
                hist: dict = {}
                fails = 0
                for i, sym in enumerate(options, 1):
                    await asyncio.sleep(0.9)
                    hj = await _api(pg, f"{BASE}/historical/get"
                                    f"?symbol={quote(sym)}&type=eod"
                                    f"&startDate={start}"
                                    "&fields=tradeTime,lastPrice,volume,"
                                    "openInterest&raw=1&limit=600")
                    if hj is None:
                        fails += 1
                        continue
                    rows = []
                    for x in hj.get("data") or []:
                        r = x.get("raw") or x
                        if r.get("tradeTime"):
                            rows.append([r["tradeTime"], r.get("lastPrice"),
                                         r.get("volume"),
                                         r.get("openInterest")])
                    if rows:
                        hist[sym] = rows
                    if i % 50 == 0:
                        print(f"[backfill-options] {mkt} {und}: "
                              f"{i}/{len(options)} series fetched",
                              flush=True)
                blocks.append({"underlying": und, "options": options,
                               "hist": hist, "futHist": fut_hist,
                               "fails": fails})
                print(f"[backfill-options] fetched {mkt} {und}: "
                      f"{len(hist)}/{len(options)} series "
                      f"({fails} failed)", flush=True)
            out[mkt] = blocks
        await browser.close()
    return out


def _future_prices() -> dict:
    """{market: {date: {symbol: price}}} from the per-contract futures archive."""
    try:
        arch = json.loads(PRICES.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict = {}
    for mkt, days in arch.items():
        if mkt.startswith("_") or not isinstance(days, dict):  # skip _meta
            continue
        out[mkt] = {}
        for d, contracts in days.items():
            if not isinstance(contracts, dict):
                continue
            out[mkt][d] = {sym: v.get("price")
                           for sym, v in contracts.items()
                           if isinstance(v, dict)}
    return out


def _one_sided(board: dict) -> bool:
    """True when no row carries any put-side value (index 9+) — the mark of
    a partial/corrupted backfill board; real boards always have both sides."""
    rows = board.get("rows") or []
    return bool(rows) and all(
        all(v is None for v in r[9:]) for r in rows)


def main() -> int:
    start = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_START
    raw = asyncio.run(_fetch_histories(start))
    if not any(raw.values()):
        print("[backfill-options] nothing fetched")
        return 1
    fut = _future_prices()
    archive = _load_archive()
    days = archive.setdefault("days", {})
    n_cols = len(ARCHIVE_HEADER)
    c0, p0 = 1, 9          # call/put column offsets in the 17-col row
    added_days = 0
    replaced = 0

    for mkt, blocks in raw.items():
        # RM prices live under the robusta archive keyed RC-normalised symbols;
        # try both the board symbol and an RC-spelled variant.
        for blk in blocks:
            und = blk["underlying"]
            exp = _rule_expiry(und)
            # per-date per-strike accumulation
            by_day: dict[str, dict[float, list]] = {}
            for sym, series in (blk.get("hist") or {}).items():
                meta = blk["options"].get(sym) or {}
                strike, typ = meta.get("strike"), meta.get("type")
                if strike is None:
                    continue
                off = c0 if typ == "C" else p0
                for d, last, vol, oi in series:
                    d = str(d)[:10]
                    row = by_day.setdefault(d, {}).setdefault(
                        strike, [strike] + [None] * (n_cols - 1))
                    row[off + 0] = oi
                    row[off + 1] = vol
                    row[off + 2] = last
            # IV/delta per day: prefer the future's own fetched settlement
            # series, fall back to the local futures archive (RC-keyed for RM)
            fut_hist = blk.get("futHist") or {}
            px_days = fut.get(mkt) or {}
            for d, strikes in by_day.items():
                px = fut_hist.get(d)
                if px is None:
                    px = (px_days.get(d) or {}).get(und)
                if px is None and und.startswith("RM"):
                    px = (px_days.get(d) or {}).get("RC" + und[2:])
                t = None
                if exp:
                    t = (exp - date.fromisoformat(d)).days / 365.0
                for strike, row in strikes.items():
                    if px and t and t > 0:
                        for off, is_call in ((c0, True), (p0, False)):
                            last = row[off + 2]
                            if last:
                                iv = _implied_vol(last, px, strike, t, is_call)
                                row[off + 3] = iv
                                if iv:
                                    row[off + 4] = _b76_delta(px, strike, t, iv, is_call)
                # merge into archive. Keep an existing board unless ours is
                # strictly richer (more strikes) or the existing one is
                # one-sided (an earlier corrupted/partial backfill) — live
                # boards carry every listed strike so they always win.
                day_slot = days.setdefault(d, {})
                mkt_boards = day_slot.setdefault(mkt, [])
                new_board = {
                    "u": und, "px": px,
                    "dte": (exp - date.fromisoformat(d)).days if exp else None,
                    "rows": [strikes[k] for k in sorted(strikes)],
                    "bf": 1,
                }
                old = next((b for b in mkt_boards if b.get("u") == und), None)
                if old is None:
                    mkt_boards.append(new_board)
                    added_days += 1
                elif (len(new_board["rows"]) > len(old.get("rows") or [])
                      or _one_sided(old)):
                    mkt_boards[mkt_boards.index(old)] = new_board
                    replaced += 1
            print(f"[backfill-options] {mkt} {und}: {len(by_day)} sessions "
                  f"({len(blk.get('hist') or {})} option series, "
                  f"{blk.get('fails') or 0} failed fetches)")

    ARCHIVE.write_text(json.dumps(archive, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")
    print(f"[backfill-options] archive now holds {len(days)} dates "
          f"(+{added_days} board-days, {replaced} replaced), "
          f"{ARCHIVE.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
