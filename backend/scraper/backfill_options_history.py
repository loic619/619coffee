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
import sys
from datetime import date
from pathlib import Path

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


async def _fetch_histories(start: str) -> dict:
    """{market: [{underlying, options: {optSym: {strike, type}},
                  hist: {optSym: [[date, last, vol, oi], ...]}}]}"""
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
        out = await pg.evaluate(
            """async ([roots, startDate, maxContracts]) => {
                function getCookie(n) {
                    const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                    return v ? decodeURIComponent(v[2]) : null;
                }
                const h = { credentials: 'include',
                            headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                                       'accept': 'application/json' } };
                const base = 'https://www.barchart.com/proxies/core-api/v1';
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                const res = {};
                for (const [mkt, root] of Object.entries(roots)) {
                    const cr = await fetch(base + '/quotes/get?symbol=' + root +
                        '%5EF&fields=symbol&orderBy=contractExpirationDate&orderDir=asc&limit=6&raw=1', h);
                    if (!cr.ok) { res[mkt] = []; continue; }
                    const chain = ((await cr.json()).data || [])
                        .map(c => (c.raw || c).symbol).filter(Boolean);
                    const blocks = [];
                    for (const und of chain) {
                        if (blocks.length >= maxContracts) break;
                        const br = await fetch(base + '/quotes/get?symbol=' + und +
                            '&list=futures.options&fields=symbol,strike,optionType&raw=1&limit=999', h);
                        if (!br.ok) continue;
                        const bd = (await br.json()).data;
                        const arr = Array.isArray(bd) ? bd
                            : bd ? Object.values(bd).flat() : [];
                        const options = {};
                        for (const it of arr) {
                            const r = it.raw || it;
                            if (!r.symbol) continue;
                            options[r.symbol] = {
                                strike: parseFloat(String(r.strike).replace(/[CP]$/i, '')),
                                type: String(r.strike).toUpperCase().endsWith('P') ? 'P' : 'C',
                            };
                        }
                        if (!Object.keys(options).length) continue;
                        const hist = {};
                        for (const sym of Object.keys(options)) {
                            try {
                                const hr = await fetch(base + '/historical/get?symbol=' +
                                    encodeURIComponent(sym) +
                                    '&type=eod&startDate=' + startDate +
                                    '&fields=tradeTime,lastPrice,volume,openInterest&raw=1&limit=600', h);
                                if (hr.ok) {
                                    const rows = ((await hr.json()).data || [])
                                        .map(x => { const r = x.raw || x; return [
                                            r.tradeTime, r.lastPrice, r.volume, r.openInterest]; })
                                        .filter(r => r[0]);
                                    if (rows.length) hist[sym] = rows;
                                }
                            } catch (e) { /* skip symbol */ }
                            await sleep(60);
                        }
                        blocks.push({ underlying: und, options, hist });
                    }
                    res[mkt] = blocks;
                }
                return res;
            }""",
            [MARKETS, start, MAX_CONTRACTS],
        )
        await browser.close()
    return out or {}


def _future_prices() -> dict:
    """{market: {date: {symbol: price}}} from the per-contract futures archive."""
    try:
        arch = json.loads(PRICES.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict = {}
    for mkt, days in arch.items():
        out[mkt] = {}
        for d, contracts in (days or {}).items():
            out[mkt][d] = {sym: (v or {}).get("price")
                           for sym, v in (contracts or {}).items()
                           if isinstance(v, dict)}
    return out


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
            # IV/delta per day from the futures archive settlement
            px_days = fut.get(mkt) or {}
            for d, strikes in by_day.items():
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
                # merge into archive: never overwrite a live-captured board
                day_slot = days.setdefault(d, {})
                mkt_boards = day_slot.setdefault(mkt, [])
                if not any(b.get("u") == und for b in mkt_boards):
                    mkt_boards.append({
                        "u": und, "px": px,
                        "dte": (exp - date.fromisoformat(d)).days if exp else None,
                        "rows": [strikes[k] for k in sorted(strikes)],
                    })
                    added_days += 1
            print(f"[backfill-options] {mkt} {und}: {len(by_day)} sessions "
                  f"({len(blk.get('hist') or {})} option series)")

    ARCHIVE.write_text(json.dumps(archive, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")
    print(f"[backfill-options] archive now holds {len(days)} dates "
          f"(+{added_days} board-days), {ARCHIVE.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
